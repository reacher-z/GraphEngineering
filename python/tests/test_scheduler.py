from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path
from typing import Any

from graph_engineering import (
    AsyncScheduler,
    FailureCode,
    NodeContext,
    NodeStatus,
    RunStatus,
    compile_graph,
    run_graph,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec/conformance"


def load_json(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text())


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
