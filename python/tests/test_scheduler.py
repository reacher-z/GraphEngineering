from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path
from typing import Any

import pytest

from graph_engineering import (
    AsyncScheduler,
    DiagnosticCode,
    FailureCode,
    NodeContext,
    NodeResult,
    NodeStatus,
    RunStatus,
    compile_graph,
    run_graph,
    try_compile_graph,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec/conformance"


def load_json(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text())


def registered_loop_condition_graph() -> Any:
    corpus = load_json("integrated-router.case.json")
    fixture = next(
        item
        for item in corpus["compilerCases"]
        if item["name"] == "registered-loop-condition-families-remain-compiler-valid"
    )
    return compile_graph(fixture["graph"])


def make_node(node_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "kind": "transform",
        "inputSchema": {},
        "outputSchema": {},
        "config": {},
        **overrides,
    }


def make_graph(**overrides: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "scheduler-test", "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["root"],
        "outputs": {"result": {"node": "root"}},
        "nodes": [make_node("root")],
        "edges": [],
    }
    document.update(overrides)
    return document


def route_condition(route_key: str) -> dict[str, str]:
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
        "kind": "RouteEquals",
        "routeKey": route_key,
    }


def route_result(*selected: str) -> dict[str, Any]:
    return {
        "routed": bool(selected),
        "reasonCode": "REQUESTED_ROUTES_SELECTED" if selected else "NO_REQUESTED_ROUTE",
        "requestedRoutes": list(selected),
        "selectedRoutes": list(selected),
        "unknownRoutes": [],
        "confidenceBasisPoints": None,
        "usedDefault": False,
        "escalated": False,
    }


def routed_graph(*, allowed_routes: list[str] | None = None) -> dict[str, Any]:
    allowed = allowed_routes or ["quick", "security"]
    return make_graph(
        outputs={"result": {"node": "merge"}},
        nodes=[
            make_node(
                "classify",
                kind="router",
                config={"kind": "single", "allowedRoutes": allowed},
            ),
            make_node("quick", kind="agent"),
            make_node("security", kind="agent"),
            make_node("merge", kind="barrier"),
        ],
        entrypoints=["classify"],
        edges=[
            {
                "id": "route-quick",
                "from": {"node": "classify"},
                "to": {"node": "quick"},
                "condition": route_condition("quick"),
            },
            {
                "id": "route-security",
                "from": {"node": "classify"},
                "to": {"node": "security"},
                "condition": route_condition("security"),
            },
            {
                "id": "quick-merge",
                "from": {"node": "quick"},
                "to": {"node": "merge", "port": "quick"},
            },
            {
                "id": "security-merge",
                "from": {"node": "security"},
                "to": {"node": "merge", "port": "security"},
            },
        ],
    )


def test_ready_queue_conformance_has_no_implicit_layer_barrier() -> None:
    case = load_json("runtime-ready-queue.case.json")
    graph = compile_graph(case["graph"])
    mock = case["mock"]
    expected = case["expect"]
    captured_inputs: dict[str, Any] = {}
    completed: list[str] = []

    async def execute(context: NodeContext) -> Any:
        captured_inputs[context.node.id] = context.input
        await asyncio.sleep(mock["delaysMs"][context.node.id] / 1000)
        completed.append(context.node.id)
        return copy.deepcopy(mock["returns"][context.node.id])

    result = asyncio.run(run_graph(graph, mock["graphInput"], {"*": execute}))

    assert result.status is RunStatus.SUCCEEDED
    assert result.max_observed_concurrency == expected["maxObservedConcurrency"]
    assert captured_inputs == expected["inputs"]
    assert dict(result.outputs or {}) == expected["outputs"]
    for first, second in expected["mustCompleteBefore"]:
        assert completed.index(first) < completed.index(second)
    assert completed.index("after-fast") < completed.index("slow")


def test_diamond_binds_named_inputs_and_respects_concurrency_cap() -> None:
    graph = compile_graph(load_json("diamond.graph.json"))
    active = 0
    peak = 0

    async def split(context: NodeContext) -> Any:
        return {"value": context.input["seed"]}

    async def branch(context: NodeContext) -> Any:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return {"branch": context.node.id}

    def merge(context: NodeContext) -> Any:
        return dict(context.inputs)

    result = asyncio.run(
        run_graph(
            graph,
            {"seed": 2},
            {"split": split, "left": branch, "right": branch, "merge": merge},
            max_concurrency=99,
        )
    )

    assert result.succeeded
    assert peak == 2
    assert result.max_observed_concurrency == 2
    assert result.scheduled_order == ("split", "left", "right", "merge")
    assert dict(result.outputs or {}) == {
        "result": {"left": {"branch": "left"}, "right": {"branch": "right"}}
    }


def test_failure_is_contained_and_descendant_is_structurally_skipped() -> None:
    document = make_graph(
        entrypoints=["bad", "independent"],
        outputs={"dependent": {"node": "dependent"}, "other": {"node": "independent"}},
        nodes=[make_node("bad"), make_node("dependent"), make_node("independent")],
        edges=[{"id": "bad-dependent", "from": {"node": "bad"}, "to": {"node": "dependent"}}],
    )
    independent_ran = False

    def fail(_: NodeContext) -> Any:
        raise RuntimeError("boom")

    def independent(_: NodeContext) -> Any:
        nonlocal independent_ran
        independent_ran = True
        return "still-ran"

    result = asyncio.run(
        run_graph(
            compile_graph(document),
            {},
            {"bad": fail, "independent": independent, "dependent": lambda _: "no"},
        )
    )

    assert result.status is RunStatus.FAILED
    assert independent_ran
    assert result.nodes["bad"].failure is not None
    assert result.nodes["bad"].failure.code is FailureCode.NODE_EXECUTION_FAILED
    assert result.nodes["dependent"].status is NodeStatus.SKIPPED
    assert result.nodes["dependent"].failure is not None
    assert result.nodes["dependent"].failure.upstream_nodes == ("bad",)
    assert result.outputs is None


def test_router_executes_only_selected_edge_and_merge_binds_only_active_branch() -> None:
    called: list[str] = []

    def branch(context: NodeContext) -> Any:
        called.append(context.node.id)
        return {"branch": context.node.id}

    result = asyncio.run(
        run_graph(
            compile_graph(routed_graph()),
            {"requestedRoutes": ["quick"]},
            {
                "quick": branch,
                "security": branch,
            },
        )
    )

    assert result.status is RunStatus.SUCCEEDED
    assert called == ["quick"]
    assert result.nodes["security"].status is NodeStatus.SKIPPED
    assert result.nodes["security"].attempts == 0
    assert result.nodes["security"].failure is not None
    assert result.nodes["security"].failure.code is FailureCode.ROUTE_NOT_SELECTED
    assert result.nodes["merge"].input == {"quick": {"branch": "quick"}}
    assert dict(result.outputs or {}) == {"result": {"quick": {"branch": "quick"}}}
    assert result.failures == ()
    assert result.total_attempts == 3


def test_missing_declared_route_case_is_rejected_before_executor_access() -> None:
    prepared_calls: list[str] = []
    prepared = {
        "quick": lambda _: prepared_calls.append("quick"),
        "security": lambda _: prepared_calls.append("security"),
    }
    result = try_compile_graph(routed_graph(allowed_routes=["quick", "security", "other"]))

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INCOMPLETE_ROUTE_COVERAGE]
    assert prepared
    assert prepared_calls == []


def test_custom_router_decision_is_recomputed_before_it_can_be_committed() -> None:
    contradictory = route_result("quick")
    contradictory["selectedRoutes"] = ["security"]
    document = routed_graph()
    document["nodes"][0]["retry"] = {"maxAttempts": 3}

    result = asyncio.run(
        run_graph(
            compile_graph(document),
            {"requestedRoutes": ["quick"]},
            {"classify": lambda _: contradictory},
        )
    )

    assert result.nodes["classify"].status is NodeStatus.FAILED
    assert result.nodes["classify"].failure is not None
    assert result.nodes["classify"].failure.code is FailureCode.INVALID_ROUTE_SELECTION
    assert result.nodes["classify"].attempts == 1
    assert result.total_attempts == 1
    assert result.nodes["quick"].status is NodeStatus.SKIPPED
    assert result.nodes["security"].status is NodeStatus.SKIPPED


def test_custom_router_cannot_replace_the_authoritative_request_evidence() -> None:
    self_consistent_but_wrong_request = route_result("security")

    result = asyncio.run(
        run_graph(
            compile_graph(routed_graph()),
            {"requestedRoutes": ["quick"]},
            {"classify": lambda _: self_consistent_but_wrong_request},
        )
    )

    router = result.nodes["classify"]
    assert router.status is NodeStatus.FAILED
    assert router.failure is not None
    assert router.failure.code is FailureCode.INVALID_ROUTE_SELECTION
    assert result.total_attempts == 1


def test_invalid_builtin_router_policy_is_rejected_before_executor_access() -> None:
    document = routed_graph()
    document["nodes"][0]["config"] = {}
    document["nodes"][0]["retry"] = {"maxAttempts": 3}

    prepared_calls: list[str] = []
    result = try_compile_graph(document)

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_ROUTER_POLICY]
    assert prepared_calls == []


def test_restored_successful_router_decision_is_revalidated_before_scheduling() -> None:
    restored = NodeResult(
        node_id="classify",
        sequence=0,
        status=NodeStatus.SUCCEEDED,
        attempts=1,
        input={"requestedRoutes": ["quick"]},
        value={
            "routed": True,
            "reasonCode": "REQUESTED_ROUTES_SELECTED",
            "requestedRoutes": ["security"],
            "selectedRoutes": ["security"],
            "unknownRoutes": [],
            "confidenceBasisPoints": None,
            "usedDefault": False,
            "escalated": False,
        },
    )

    with pytest.raises(TypeError, match="invalid successful router decision"):
        asyncio.run(
            AsyncScheduler()._run(
                compile_graph(routed_graph()),
                {},
                initial_results={"classify": restored},
                attempt_offsets={"classify": 1},
                initial_total_attempts=1,
            )
        )


@pytest.mark.parametrize(
    "mutation",
    [
        "missing-field",
        "extra-field",
        "requested-not-list",
        "selected-not-list",
        "duplicate-selected",
        "non-string-selected",
        "unsafe-selected",
        "unknown-outside-requested",
        "confidence-boolean",
        "flag-not-boolean",
        "unknown-reason",
        "routed-mismatch",
    ],
)
def test_malformed_route_result_is_a_structured_router_failure(mutation: str) -> None:
    malformed = route_result("quick")
    if mutation == "missing-field":
        del malformed["reasonCode"]
    elif mutation == "extra-field":
        malformed["extra"] = True
    elif mutation == "requested-not-list":
        malformed["requestedRoutes"] = "quick"
    elif mutation == "selected-not-list":
        malformed["selectedRoutes"] = "quick"
    elif mutation == "duplicate-selected":
        malformed["selectedRoutes"] = ["quick", "quick"]
    elif mutation == "non-string-selected":
        malformed["selectedRoutes"] = [1]
    elif mutation == "unsafe-selected":
        malformed["selectedRoutes"] = ["../quick"]
    elif mutation == "unknown-outside-requested":
        malformed["unknownRoutes"] = ["security"]
    elif mutation == "confidence-boolean":
        malformed["confidenceBasisPoints"] = True
    elif mutation == "flag-not-boolean":
        malformed["usedDefault"] = 0
    elif mutation == "unknown-reason":
        malformed["reasonCode"] = "MAYBE"
    else:
        assert mutation == "routed-mismatch"
        malformed["routed"] = False

    result = asyncio.run(
        run_graph(
            compile_graph(routed_graph()),
            {"requestedRoutes": ["quick"]},
            {"classify": lambda _: malformed},
        )
    )

    router = result.nodes["classify"]
    assert router.status is NodeStatus.FAILED
    assert router.failure is not None
    assert router.failure.code is FailureCode.INVALID_ROUTE_SELECTION
    assert router.failure.attempt == 1
    assert all(result.nodes[node_id].attempts == 0 for node_id in ("quick", "security", "merge"))


def test_unsupported_route_condition_is_rejected_before_executor_access() -> None:
    document = routed_graph()
    document["edges"][0]["condition"] = {
        "apiVersion": "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
        "kind": "Unknown",
        "routeKey": "quick",
    }

    prepared_calls: list[str] = []
    prepared = {
        "quick": lambda _: prepared_calls.append("quick"),
        "security": lambda _: prepared_calls.append("security"),
    }
    result = try_compile_graph(document)

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.UNSUPPORTED_EDGE_CONDITION]
    assert prepared
    assert prepared_calls == []


def test_route_condition_from_non_router_source_is_rejected_at_compile_gate() -> None:
    document = make_graph(
        outputs={"result": {"node": "target"}},
        nodes=[make_node("root"), make_node("target", kind="agent")],
        edges=[
            {
                "id": "invalid-route-source",
                "from": {"node": "root"},
                "to": {"node": "target"},
                "condition": route_condition("quick"),
            }
        ],
    )

    prepared_calls: list[str] = []
    prepared = {
        "root": lambda _: prepared_calls.append("root"),
        "target": lambda _: prepared_calls.append("target"),
    }
    result = try_compile_graph(document)

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.CONDITION_SOURCE_NOT_ROUTER
    ]
    assert prepared
    assert prepared_calls == []


def test_unsupported_conditions_follow_edge_declaration_order_at_compile_gate() -> None:
    document = make_graph(
        outputs={"result": {"node": "left"}},
        nodes=[
            make_node("root", kind="router"),
            make_node("left", kind="agent"),
            make_node("right", kind="agent"),
        ],
        edges=[
            {
                "id": "z-condition",
                "from": {"node": "root"},
                "to": {"node": "right"},
                "condition": {"kind": "Unknown"},
            },
            {
                "id": "a-condition",
                "from": {"node": "root"},
                "to": {"node": "left"},
                "condition": {"kind": "Unknown"},
            },
        ],
    )

    prepared_calls: list[str] = []
    result = try_compile_graph(document)

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.INVALID_ROUTER_POLICY,
        DiagnosticCode.UNSUPPORTED_EDGE_CONDITION,
        DiagnosticCode.UNSUPPORTED_EDGE_CONDITION,
    ]
    assert [item.edge_id for item in result.diagnostics] == [
        None,
        "z-condition",
        "a-condition",
    ]
    assert prepared_calls == []


def test_registered_foreign_conditions_fail_whole_graph_before_handler_access() -> None:
    handler_calls: list[str] = []

    def source(_: NodeContext) -> dict[str, bool]:
        handler_calls.append("source")
        return {"done": True}

    result = asyncio.run(run_graph(registered_loop_condition_graph(), {}, {"source": source}))

    assert result.status is RunStatus.FAILED
    assert result.total_attempts == 0
    assert dict(result.nodes) == {}
    assert result.scheduled_order == ()
    assert result.completion_order == ()
    assert len(result.failures) == 1
    failure = result.failures[0]
    assert failure.code is FailureCode.UNSUPPORTED_EDGE_CONDITION
    assert failure.node_id == "source"
    assert failure.attempt == 0
    assert "to-continue" in failure.message
    assert "to-dry" in failure.message
    assert "to-bound" in failure.message
    assert failure.message.index("to-continue") < failure.message.index("to-dry")
    assert failure.message.index("to-dry") < failure.message.index("to-bound")
    assert handler_calls == []


def test_foreign_condition_failure_order_uses_node_then_edge_declaration() -> None:
    condition_version = "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1"
    document = make_graph(
        entrypoints=["z-source", "a-source"],
        outputs={"z": {"node": "z-target"}, "a": {"node": "a-target"}},
        nodes=[
            make_node("z-source"),
            make_node("z-target"),
            make_node("a-source"),
            make_node("a-target"),
        ],
        edges=[
            {
                "id": "z-edge-declared-first",
                "from": {"node": "a-source"},
                "to": {"node": "a-target"},
                "condition": {
                    "apiVersion": condition_version,
                    "kind": "LoopDryVerdict",
                    "maxRounds": 3,
                    "round": 1,
                    "roundKey": "r1",
                },
            },
            {
                "id": "a-edge-declared-second",
                "from": {"node": "z-source"},
                "to": {"node": "z-target"},
                "condition": {
                    "apiVersion": condition_version,
                    "kind": "LoopContinue",
                    "maxRounds": 3,
                    "round": 0,
                    "roundKey": "r0",
                },
            },
        ],
    )
    handler_calls: list[str] = []

    def handler(context: NodeContext) -> dict[str, str]:
        handler_calls.append(context.node.id)
        return {"node": context.node.id}

    result = asyncio.run(
        run_graph(
            compile_graph(document),
            {},
            {"z-source": handler, "a-source": handler},
        )
    )

    assert result.total_attempts == 0
    assert dict(result.nodes) == {}
    assert [failure.node_id for failure in result.failures] == ["z-source", "a-source"]
    assert "a-edge-declared-second" in result.failures[0].message
    assert "z-edge-declared-first" in result.failures[1].message
    assert handler_calls == []


def test_retry_succeeds_inside_node_and_global_attempt_budgets() -> None:
    graph = compile_graph(
        make_graph(
            nodes=[make_node("root", retry={"maxAttempts": 3})],
            policies={"maxTotalAttempts": 3},
        )
    )
    calls = 0

    def flaky(context: NodeContext) -> Any:
        nonlocal calls
        calls += 1
        assert context.attempt == calls
        if calls < 3:
            raise RuntimeError("transient")
        return "ok"

    result = asyncio.run(run_graph(graph, {}, {"root": flaky}))

    assert result.succeeded
    assert result.nodes["root"].attempts == 3
    assert result.total_attempts == 3
    assert dict(result.outputs or {}) == {"result": "ok"}


def test_global_attempt_budget_exhaustion_is_structured() -> None:
    graph = compile_graph(
        make_graph(
            nodes=[make_node("root", retry={"maxAttempts": 3})],
            policies={"maxTotalAttempts": 2},
        )
    )

    def always_fails(_: NodeContext) -> Any:
        raise RuntimeError("still broken")

    result = asyncio.run(run_graph(graph, {}, {"root": always_fails}))

    assert result.status is RunStatus.FAILED
    assert result.total_attempts == 2
    assert result.nodes["root"].attempts == 2
    assert result.nodes["root"].failure is not None
    assert result.nodes["root"].failure.code is FailureCode.NODE_EXECUTION_FAILED
    assert not result.nodes["root"].failure.retryable


def test_restored_attempt_offsets_are_preserved_without_another_attempt() -> None:
    resumable = compile_graph(
        make_graph(nodes=[make_node("root", kind="agent", retry={"maxAttempts": 3})])
    )

    missing = asyncio.run(
        AsyncScheduler()._run(
            resumable,
            {},
            attempt_offsets={"root": 2},
            initial_total_attempts=2,
        )
    )
    assert missing.nodes["root"].attempts == 2
    assert missing.nodes["root"].failure is not None
    assert missing.nodes["root"].failure.attempt == 2
    assert missing.nodes["root"].failure.code is FailureCode.EXECUTOR_NOT_FOUND

    cancelled_event = asyncio.Event()
    cancelled_event.set()
    cancelled = asyncio.run(
        AsyncScheduler({"root": lambda _: "must-not-run"})._run(
            resumable,
            {},
            cancel_event=cancelled_event,
            attempt_offsets={"root": 2},
            initial_total_attempts=2,
        )
    )
    assert cancelled.nodes["root"].attempts == 2
    assert cancelled.nodes["root"].failure is not None
    assert cancelled.nodes["root"].failure.attempt == 2
    assert cancelled.nodes["root"].failure.code is FailureCode.NODE_CANCELLED

    exhausted = compile_graph(
        make_graph(nodes=[make_node("root", kind="agent", retry={"maxAttempts": 2})])
    )
    budget = asyncio.run(
        AsyncScheduler({"root": lambda _: "must-not-run"})._run(
            exhausted,
            {},
            attempt_offsets={"root": 2},
            initial_total_attempts=2,
        )
    )
    assert budget.nodes["root"].attempts == 2
    assert budget.nodes["root"].failure is not None
    assert budget.nodes["root"].failure.attempt == 2
    assert budget.nodes["root"].failure.code is FailureCode.ATTEMPT_BUDGET_EXHAUSTED


def test_retry_delay_is_capped_without_overflow_and_never_below_initial_delay() -> None:
    compiled = compile_graph(
        make_graph(
            nodes=[
                make_node(
                    "root",
                    retry={
                        "maxAttempts": 100,
                        "initialDelayMs": 10,
                        "maxDelayMs": 1,
                        "backoffMultiplier": float(2**53 - 1),
                    },
                )
            ]
        )
    )

    assert AsyncScheduler._retry_delay_ms(compiled.nodes["root"], 100) == 10


def test_timeout_is_structured() -> None:
    graph = compile_graph(make_graph(nodes=[make_node("root", timeoutMs=2)]))

    async def too_slow(_: NodeContext) -> Any:
        await asyncio.sleep(0.03)
        return "late"

    result = asyncio.run(run_graph(graph, {}, {"root": too_slow}))

    assert result.status is RunStatus.FAILED
    assert result.nodes["root"].failure is not None
    assert result.nodes["root"].failure.code is FailureCode.NODE_TIMEOUT
    assert result.nodes["root"].failure.attempt == 1


def test_source_and_public_output_ports_are_selected() -> None:
    graph = compile_graph(
        make_graph(
            outputs={"answer": {"node": "consumer", "port": "answer"}},
            nodes=[make_node("root"), make_node("consumer")],
            edges=[
                {
                    "id": "value",
                    "from": {"node": "root", "port": "value"},
                    "to": {"node": "consumer"},
                }
            ],
        )
    )

    def consume(context: NodeContext) -> Any:
        return {"answer": context.input["root"] + 1}

    result = asyncio.run(
        run_graph(
            graph,
            {},
            {"root": lambda _: {"value": 41, "ignored": True}, "consumer": consume},
        )
    )

    assert result.succeeded
    assert dict(result.outputs or {}) == {"answer": 42}


def test_input_collision_and_missing_output_port_are_structured() -> None:
    collision = compile_graph(
        make_graph(
            entrypoints=["left", "right"],
            outputs={"result": {"node": "merge"}},
            nodes=[make_node("left"), make_node("right"), make_node("merge")],
            edges=[
                {"id": "a", "from": {"node": "left"}, "to": {"node": "merge", "port": "same"}},
                {"id": "b", "from": {"node": "right"}, "to": {"node": "merge", "port": "same"}},
            ],
        )
    )
    collision_result = asyncio.run(run_graph(collision, {}))
    assert collision_result.nodes["merge"].failure is not None
    assert collision_result.nodes["merge"].failure.code is FailureCode.INPUT_BINDING_FAILED

    missing_output = compile_graph(
        make_graph(outputs={"answer": {"node": "root", "port": "missing"}})
    )
    output_result = asyncio.run(run_graph(missing_output, {}))
    assert output_result.status is RunStatus.FAILED
    assert output_result.outputs is None
    assert output_result.failures[-1].code is FailureCode.OUTPUT_BINDING_FAILED
    assert output_result.failures[-1].output_name == "answer"


def test_missing_executor_and_invalid_json_output_are_structured() -> None:
    missing = compile_graph(make_graph(nodes=[make_node("root", kind="agent")]))
    missing_result = asyncio.run(AsyncScheduler().run(missing, {}))
    assert missing_result.nodes["root"].failure is not None
    assert missing_result.nodes["root"].failure.code is FailureCode.EXECUTOR_NOT_FOUND
    assert missing_result.total_attempts == 0

    invalid = compile_graph(make_graph(nodes=[make_node("root", kind="agent")]))
    invalid_result = asyncio.run(run_graph(invalid, {}, {"root": lambda _: {1, 2}}))  # type: ignore[dict-item]
    assert invalid_result.nodes["root"].failure is not None
    assert invalid_result.nodes["root"].failure.code is FailureCode.INVALID_OUTPUT
