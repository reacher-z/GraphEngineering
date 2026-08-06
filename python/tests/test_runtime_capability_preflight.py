from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest

from graph_engineering import (
    FailureCode,
    NodeContext,
    ProtectedGraphEvent,
    RunStatus,
    compile_graph,
    resume_graph_run,
    run_graph,
    start_graph_run,
)
from graph_engineering.integrated_barrier import claims_integrated_barrier_policy
from graph_engineering.models import JsonValue
from graph_engineering.redaction.guard import PreparedSinkWrite
from tests.durable_support import memory_journal, memory_protection

ROOT = Path(__file__).resolve().parents[2]
CAPABILITY_CORPUS: dict[str, Any] = json.loads(
    (ROOT / "spec/conformance/runtime-capability.case.json").read_text()
)

# redaction-semantics.md Section 4.2: a durable run without a configured
# protected store and key provider refuses before preflight can even report a
# capability failure, so these tests configure one.
PROTECTION = memory_protection()


def node(node_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "kind": "transform",
        "inputSchema": {},
        "outputSchema": {},
        "config": {},
        **overrides,
    }


def graph(**overrides: Any) -> Any:
    document: dict[str, Any] = {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "runtime-capability", "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["root"],
        "outputs": {"result": {"node": "root"}},
        "nodes": [node("root")],
        "edges": [],
    }
    document.update(overrides)
    return compile_graph(document)


def capability_message(capability: str, path: str) -> str:
    return (
        f"Runtime capability '{capability}' at '{path}' "
        "is not implemented by runtime-capability/v1alpha1"
    )


def unsupported_graph() -> Any:
    return graph(
        stateSchema={"type": "object"},
        inputSchema={"type": "object"},
        outputSchema={"type": "object"},
        outputs={"result": {"node": "child"}},
        nodes=[
            node(
                "root",
                kind="subgraph",
                inputSchema={"type": "object"},
                outputSchema={"type": "object"},
                cache={},
                resources={},
                isolation={},
                retry={"maxAttempts": 2, "jitter": True},
            ),
            node("child", kind="human"),
        ],
        edges=[
            {
                "id": "unsupported-edge",
                "from": {"node": "root"},
                "to": {"node": "child"},
                "map": {},
                "mode": "artifact-ref",
                "schema": {},
            }
        ],
        policies={
            "maxConcurrency": 2,
            "maxDepth": 2,
            "maxFanOut": 1,
            "maxTotalAttempts": 2,
            "maxDynamicNodes": 0,
            "maxDurationMs": 100,
            "maxCostUsd": 0,
            "z/key": True,
            "a~key": True,
        },
    )


def combined_runtime_and_condition_graph() -> Any:
    corpus = json.loads((ROOT / "spec/conformance/integrated-router.case.json").read_text())
    fixture = next(
        item
        for item in corpus["compilerCases"]
        if item["name"] == "registered-loop-condition-families-remain-compiler-valid"
    )
    document = fixture["graph"]
    document["stateSchema"] = {"type": "object"}
    return compile_graph(document)


EXPECTED_ISSUES = (
    ("root", "graph-state", "#/stateSchema"),
    ("root", "node-kind:subgraph", "#/nodes/0/kind"),
    ("root", "node-cache", "#/nodes/0/cache"),
    ("root", "resource-admission", "#/nodes/0/resources"),
    ("root", "isolation-provider", "#/nodes/0/isolation"),
    ("root", "retry-jitter", "#/nodes/0/retry/jitter"),
    ("child", "node-kind:human", "#/nodes/1/kind"),
    ("root", "edge-map", "#/edges/0/map"),
    ("root", "edge-mode:artifact-ref", "#/edges/0/mode"),
    ("root", "dynamic-graph-patch", "#/policies/maxDynamicNodes"),
    ("root", "graph-deadline", "#/policies/maxDurationMs"),
    ("root", "cost-budget", "#/policies/maxCostUsd"),
    ("root", "policy:a~key", "#/policies/a~0key"),
    ("root", "policy:z/key", "#/policies/z~1key"),
)


def assert_capability_failure(result: Any) -> None:
    assert result.status is RunStatus.FAILED
    assert result.total_attempts == 0
    assert dict(result.nodes) == {}
    assert result.outputs is None
    assert result.scheduled_order == ()
    assert result.completion_order == ()
    assert result.max_observed_concurrency == 0
    assert [
        (failure.node_id, failure.code, failure.attempt, failure.message)
        for failure in result.failures
    ] == [
        (
            owner,
            FailureCode.UNSUPPORTED_RUNTIME_CAPABILITY,
            0,
            capability_message(capability, path),
        )
        for owner, capability, path in EXPECTED_ISSUES
    ]


def assert_literal_corpus_failure(result: Any, case: dict[str, Any]) -> None:
    projection = CAPABILITY_CORPUS["failureProjection"]
    assert result.status.value == projection["status"]
    assert len(result.nodes) == projection["nodeCount"]
    assert result.total_attempts == projection["totalAttempts"]
    assert list(result.scheduled_order) == projection["scheduledOrder"]
    assert list(result.completion_order) == projection["completionOrder"]
    assert result.max_observed_concurrency == 0
    assert [
        {
            "code": failure.code.value,
            "nodeId": failure.node_id,
            "message": failure.message,
        }
        for failure in result.failures
    ] == case["expect"]["failures"]
    assert all(failure.attempt == 0 for failure in result.failures)


def _claims_integrated_barrier(graph: dict[str, Any]) -> bool:
    return any(
        node["kind"] == "barrier" and claims_integrated_barrier_policy(node["config"])
        for node in graph["nodes"]
    )


@pytest.mark.parametrize(
    "case",
    CAPABILITY_CORPUS["cases"],
    ids=[case["name"] for case in CAPABILITY_CORPUS["cases"]],
)
def test_ordinary_runtime_consumes_capability_corpus_literally(case: dict[str, Any]) -> None:
    assert CAPABILITY_CORPUS["contract"] == "runtime-capability/v1alpha1"
    assert CAPABILITY_CORPUS["failureCode"] == FailureCode.UNSUPPORTED_RUNTIME_CAPABILITY.value
    calls: list[str] = []

    def handler(context: NodeContext) -> Any:
        calls.append(context.node.id)
        return context.input

    claimed = _claims_integrated_barrier(case["graph"])
    handlers = (
        {node["id"]: handler for node in case["graph"]["nodes"] if node["kind"] != "barrier"}
        if case["expect"]["supported"] or claimed
        else {"*": handler}
    )
    result = asyncio.run(run_graph(compile_graph(case["graph"]), {}, handlers))

    if claimed:
        # The corpus refusal belongs to the entry points that do not implement
        # barrier satisfaction (pinned by the durable test below). The ordinary
        # scheduler executes the integrated barrier itself with zero executor
        # attempts, so it must not report the capability failure.
        assert not case["expect"]["supported"]
        assert not any(
            failure.code is FailureCode.UNSUPPORTED_RUNTIME_CAPABILITY
            for failure in result.failures
        )
        assert result.status is RunStatus.SUCCEEDED
        assert calls == [
            node["id"] for node in case["graph"]["nodes"] if node["kind"] != "barrier"
        ]
        for node in case["graph"]["nodes"]:
            if node["kind"] == "barrier":
                assert result.nodes[node["id"]].attempts == 0
        assert result.decision_events != ()
    elif case["expect"]["supported"]:
        assert result.status is RunStatus.SUCCEEDED
        assert result.failures == ()
        assert calls == [node["id"] for node in case["graph"]["nodes"] if node["kind"] != "barrier"]
    else:
        assert_literal_corpus_failure(result, case)
        assert len(calls) == CAPABILITY_CORPUS["failureProjection"]["executorCalls"]


@pytest.mark.parametrize(
    "case",
    CAPABILITY_CORPUS["cases"],
    ids=[case["name"] for case in CAPABILITY_CORPUS["cases"]],
)
def test_durable_runtime_consumes_capability_corpus_literally(case: dict[str, Any]) -> None:
    async def scenario() -> None:
        calls: list[str] = []

        def handler(context: NodeContext) -> Any:
            calls.append(context.node.id)
            return context.input

        compiled = compile_graph(case["graph"])
        handlers = (
            {node["id"]: handler for node in case["graph"]["nodes"] if node["kind"] != "barrier"}
            if case["expect"]["supported"]
            else {"*": handler}
        )
        if case["expect"]["supported"]:
            store: Any = memory_journal()
        else:
            store = NoIoEventStore()
        run_id = f"capability-{case['name']}"
        started = await start_graph_run(
            compiled,
            {},
            handlers,
            run_id=run_id,
            implementation_id="runtime-capability@1",
            event_store=store,
            payload_protection=PROTECTION,
        )
        resumed = await resume_graph_run(
            compiled,
            handlers,
            run_id=run_id,
            implementation_id="runtime-capability@1",
            event_store=store,
            payload_protection=PROTECTION,
        )

        if case["expect"]["supported"]:
            assert started.status is RunStatus.SUCCEEDED
            assert resumed == started
            assert calls == [
                node["id"] for node in case["graph"]["nodes"] if node["kind"] != "barrier"
            ]
        else:
            assert_literal_corpus_failure(started, case)
            assert resumed == started
            projection = CAPABILITY_CORPUS["failureProjection"]
            assert store.read_calls == projection["durableReadCalls"]
            assert store.append_calls == projection["durableAppendCalls"]
            assert len(calls) == projection["executorCalls"]

    asyncio.run(scenario())


def test_ordinary_preflight_reports_all_issues_without_handler_calls() -> None:
    calls: list[str] = []

    def handler(context: NodeContext) -> dict[str, str]:
        calls.append(context.node.id)
        return {"unexpected": context.node.id}

    result = asyncio.run(run_graph(unsupported_graph(), {}, {"*": handler}))

    assert_capability_failure(result)
    assert calls == []


class NoIoEventStore:
    def __init__(self) -> None:
        self.read_calls = 0
        self.append_calls = 0

    async def read(
        self, run_id: str, from_sequence: int = 0
    ) -> tuple[ProtectedGraphEvent, ...]:
        self.read_calls += 1
        raise AssertionError(f"unexpected durable read for {run_id!r} at {from_sequence}")

    async def append(
        self,
        run_id: str,
        expected_version: int,
        prepared: Sequence[PreparedSinkWrite],
    ) -> int:
        self.append_calls += 1
        raise AssertionError(
            f"unexpected durable append for {run_id!r} at {expected_version}"
        )

    def legacy_documents(self, run_id: str) -> tuple[Mapping[str, JsonValue], ...]:
        raise AssertionError(f"unexpected legacy history probe for {run_id!r}")


def test_durable_start_and_resume_preflight_perform_zero_store_io() -> None:
    async def scenario() -> None:
        store = NoIoEventStore()
        calls: list[str] = []

        def handler(context: NodeContext) -> dict[str, str]:
            calls.append(context.node.id)
            return {"unexpected": context.node.id}

        compiled = unsupported_graph()
        started = await start_graph_run(
            compiled,
            {},
            {"*": handler},
            run_id="unsupported-start",
            implementation_id="runtime@1",
            event_store=store,
            payload_protection=PROTECTION,
        )
        resumed = await resume_graph_run(
            compiled,
            {"*": handler},
            run_id="unsupported-resume",
            implementation_id="runtime@1",
            event_store=store,
            payload_protection=PROTECTION,
        )

        assert_capability_failure(started)
        assert resumed == started
        assert store.read_calls == 0
        assert store.append_calls == 0
        assert calls == []

    asyncio.run(scenario())


def test_runtime_issues_precede_foreign_condition_issues_with_zero_side_effects() -> None:
    async def scenario() -> None:
        compiled = combined_runtime_and_condition_graph()
        store = NoIoEventStore()
        calls: list[str] = []

        def handler(context: NodeContext) -> dict[str, str]:
            calls.append(context.node.id)
            return {"unexpected": context.node.id}

        ordinary = await run_graph(compiled, {}, {"*": handler})
        durable = await start_graph_run(
            compiled,
            {},
            {"*": handler},
            run_id="combined-capability-start",
            implementation_id="runtime@1",
            event_store=store,
            payload_protection=PROTECTION,
        )
        resumed = await resume_graph_run(
            compiled,
            {"*": handler},
            run_id="combined-capability-resume",
            implementation_id="runtime@1",
            event_store=store,
            payload_protection=PROTECTION,
        )

        assert ordinary == durable == resumed
        assert [failure.code for failure in ordinary.failures] == [
            FailureCode.UNSUPPORTED_RUNTIME_CAPABILITY,
            FailureCode.UNSUPPORTED_EDGE_CONDITION,
        ]
        assert ordinary.failures[0].message == capability_message("graph-state", "#/stateSchema")
        assert ordinary.total_attempts == 0
        assert dict(ordinary.nodes) == {}
        assert store.read_calls == 0
        assert store.append_calls == 0
        assert calls == []

    asyncio.run(scenario())


def test_supported_runtime_subset_still_executes() -> None:
    compiled = graph(
        outputs={"result": {"node": "target"}},
        nodes=[
            node("root", kind="agent", retry={"maxAttempts": 1, "jitter": False}),
            node("target", kind="transform"),
        ],
        edges=[
            {
                "id": "value-edge",
                "from": {"node": "root"},
                "to": {"node": "target"},
                "mode": "value",
            }
        ],
        policies={
            "maxConcurrency": 2,
            "maxDepth": 2,
            "maxFanOut": 1,
            "maxTotalAttempts": 2,
        },
    )
    calls: list[str] = []

    def handler(context: NodeContext) -> Any:
        calls.append(context.node.id)
        return context.input

    result = asyncio.run(run_graph(compiled, {"ok": True}, {"*": handler}))

    assert result.status is RunStatus.SUCCEEDED
    assert result.total_attempts == 2
    assert calls == ["root", "target"]
    assert dict(result.outputs or {}) == {"result": {"root": {"ok": True}}}


def test_compile_only_schemas_and_typed_ports_policy_are_accepted() -> None:
    string_schema = {"type": "string"}
    object_schema = {
        "type": "object",
        "properties": {"value": string_schema},
        "required": ["value"],
        "additionalProperties": False,
    }
    output_schema = {
        "type": "object",
        "properties": {"result": string_schema},
        "required": ["result"],
        "additionalProperties": False,
    }
    compiled = graph(
        inputSchema=object_schema,
        outputSchema=output_schema,
        outputs={"result": {"node": "root", "port": "value"}},
        nodes=[
            node(
                "root",
                inputSchema=object_schema,
                outputSchema=object_schema,
            )
        ],
        policies={
            "graphengineering.reacher-z.github.io/typed-ports": {
                "apiVersion": "graphengineering.reacher-z.github.io/typed-ports/v1alpha1",
                "mode": "strict-exact",
            }
        },
    )

    result = asyncio.run(run_graph(compiled, {"value": "ok"}))

    assert result.status is RunStatus.SUCCEEDED
    assert result.failures == ()
    assert dict(result.outputs or {}) == {"result": "ok"}


def test_barrier_accepts_only_the_static_all_success_config() -> None:
    for config in ({}, {"condition": "all"}):
        result = asyncio.run(
            run_graph(
                graph(nodes=[node("root", kind="barrier", config=config)]),
                {"ok": True},
            )
        )
        assert result.status is RunStatus.SUCCEEDED

    result = asyncio.run(
        run_graph(
            graph(nodes=[node("root", kind="barrier", config={"condition": "minimum"})]),
            {"ok": True},
        )
    )

    assert [failure.message for failure in result.failures] == [
        capability_message("node-config:barrier", "#/nodes/0/config")
    ]
