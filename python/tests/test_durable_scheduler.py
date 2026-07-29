from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from graph_engineering import (
    AsyncScheduler,
    DiagnosticCode,
    DurableRunError,
    DurableRunErrorCode,
    FailureCode,
    GraphCompileError,
    GraphEvent,
    NodeContext,
    NodeFailure,
    RunStatus,
    compile_graph,
    decode_durable_json,
    durable_json_hash,
    encode_durable_json,
    resume_graph_run,
    start_graph_run,
    try_compile_graph,
)
from graph_engineering.canonical import canonical_sha256
from graph_engineering.durable import _DurableJournal, _EventDraft, _strict_rfc3339
from graph_engineering.persistence import EventStore, MemoryEventStore, VersionConflictError
from graph_engineering.scheduler import _AttemptIdentity

ROOT = Path(__file__).parents[2]
FIXED_TIME = "2026-07-26T12:00:00.000Z"


def registered_loop_condition_graph() -> Any:
    corpus = json.loads((ROOT / "spec/conformance/integrated-router.case.json").read_text())
    fixture = next(
        item
        for item in corpus["compilerCases"]
        if item["name"] == "registered-loop-condition-families-remain-compiler-valid"
    )
    return compile_graph(fixture["graph"])


class ProcessLost(BaseException):
    pass


def fixed_clock() -> str:
    return FIXED_TIME


def test_durable_timestamp_parser_consumes_shared_strict_rfc3339_corpus() -> None:
    corpus = json.loads((ROOT / "spec/conformance/strict-rfc3339.case.json").read_text())

    for timestamp in corpus["valid"]:
        _strict_rfc3339(timestamp)
    for timestamp in corpus["invalid"]:
        with pytest.raises(ValueError):
            _strict_rfc3339(timestamp)


def graph(
    node: dict[str, Any] | None = None,
    *,
    policies: dict[str, Any] | None = None,
) -> Any:
    document = {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "durable-test", "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["root"],
        "outputs": {"result": {"node": "root"}},
        "nodes": [
            node
            or {
                "id": "root",
                "kind": "agent",
                "inputSchema": {},
                "outputSchema": {},
                "config": {},
                "sideEffects": "none",
            }
        ],
        "edges": [],
    }
    if policies is not None:
        document["policies"] = policies
    return compile_graph(document)


def durable_routed_graph(*, router_retry: bool = False) -> Any:
    condition_version = "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1"
    router: dict[str, Any] = {
        "id": "classify",
        "kind": "router",
        "inputSchema": {},
        "outputSchema": {},
        "config": {"kind": "single", "allowedRoutes": ["quick", "security"]},
    }
    if router_retry:
        router["retry"] = {"maxAttempts": 3}
    return compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "durable-router", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["classify"],
            "outputs": {"result": {"node": "merge"}},
            "nodes": [
                router,
                {
                    "id": "quick",
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                },
                {
                    "id": "security",
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                },
                {
                    "id": "merge",
                    "kind": "barrier",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                },
            ],
            "edges": [
                {
                    "id": "route-quick",
                    "from": {"node": "classify"},
                    "to": {"node": "quick"},
                    "condition": {
                        "apiVersion": condition_version,
                        "kind": "RouteEquals",
                        "routeKey": "quick",
                    },
                },
                {
                    "id": "route-security",
                    "from": {"node": "classify"},
                    "to": {"node": "security"},
                    "condition": {
                        "apiVersion": condition_version,
                        "kind": "RouteEquals",
                        "routeKey": "security",
                    },
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
        }
    )


def unsupported_condition_document() -> dict[str, Any]:
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "unsupported-condition", "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["root"],
        "outputs": {"result": {"node": "child"}},
        "nodes": [
            {
                "id": "root",
                "kind": "router",
                "inputSchema": {},
                "outputSchema": {},
                "config": {"kind": "single", "allowedRoutes": ["quick"]},
            },
            {
                "id": "child",
                "kind": "agent",
                "inputSchema": {},
                "outputSchema": {},
                "config": {},
            },
        ],
        "edges": [
            {
                "id": "unsupported",
                "from": {"node": "root"},
                "to": {"node": "child"},
                "condition": {"kind": "Unknown"},
            }
        ],
    }


async def events(store: EventStore, run_id: str) -> tuple[GraphEvent, ...]:
    return await store.read(run_id)


def resign(event: GraphEvent, data: dict[str, Any]) -> GraphEvent:
    return event.model_copy(update={"data": data, "payload_hash": canonical_sha256(data)})


def forged_event(
    *,
    run_id: str,
    sequence: int,
    event_type: str,
    data: dict[str, Any],
    node_id: str | None = None,
    attempt: int | None = None,
) -> GraphEvent:
    document: dict[str, Any] = {
        "apiVersion": "graphengineering.reacher-z.github.io/events/v1alpha1",
        "eventId": f"forged:{sequence}",
        "type": event_type,
        "timestamp": FIXED_TIME,
        "runId": run_id,
        "graphRevision": 1,
        "sequence": sequence,
        "payloadHash": canonical_sha256(data),
        "redacted": True,
        "data": data,
    }
    if node_id is not None:
        document["nodeId"] = node_id
    if attempt is not None:
        document["attempt"] = attempt
    return GraphEvent.model_validate(document)


class TrackingStore:
    def __init__(self, delegate: MemoryEventStore | None = None) -> None:
        self.delegate = delegate or MemoryEventStore()
        self.read_calls = 0
        self.append_calls = 0

    async def read(self, run_id: str, from_sequence: int = 0) -> tuple[GraphEvent, ...]:
        self.read_calls += 1
        return await self.delegate.read(run_id, from_sequence)

    async def append(
        self,
        run_id: str,
        expected_version: int,
        values: Sequence[GraphEvent],
    ) -> int:
        self.append_calls += 1
        return await self.delegate.append(run_id, expected_version, values)


def test_start_commits_claim_before_handler_and_terminal_resume_is_idempotent() -> None:
    async def scenario() -> None:
        store = MemoryEventStore()
        observed_identity: tuple[str | None, str | None, str | None] | None = None

        async def handler(context: NodeContext) -> Any:
            nonlocal observed_identity
            history = await store.read("run-start")
            assert history[-1].type == "NodeStarted"
            observed_identity = (
                context.run_id,
                context.attempt_id,
                context.idempotency_key,
            )
            return {"decimal": 0.1}

        result = await start_graph_run(
            graph(),
            {"seed": 1.5},
            {"root": handler},
            run_id="run-start",
            implementation_id="handlers@1",
            event_store=store,
            clock=fixed_clock,
        )
        history = await store.read("run-start")
        assert result.status is RunStatus.SUCCEEDED
        assert [item.type for item in history] == [
            "RunCreated",
            "RunStarted",
            "NodeScheduled",
            "NodeStarted",
            "NodeSucceeded",
            "RunSucceeded",
        ]
        assert all(item.payload_hash == canonical_sha256(item.data) for item in history)
        assert observed_identity is not None
        assert observed_identity[0] == "run-start"
        assert observed_identity[1] == "run-start/root/1"
        assert observed_identity[2] == history[2].data["activityKey"]

        calls = 0

        def must_not_run(_: NodeContext) -> Any:
            nonlocal calls
            calls += 1
            raise AssertionError("terminal resume invoked an executor")

        before = len(history)
        resumed = await resume_graph_run(
            graph(),
            {"root": must_not_run},
            run_id="run-start",
            implementation_id="handlers@1",
            event_store=store,
            clock=fixed_clock,
        )
        assert resumed == result
        assert calls == 0
        assert len(await store.read("run-start")) == before

        with pytest.raises(DurableRunError) as duplicate:
            await start_graph_run(
                graph(),
                {},
                run_id="run-start",
                implementation_id="handlers@1",
                event_store=store,
                clock=fixed_clock,
            )
        assert duplicate.value.code is DurableRunErrorCode.RUN_ALREADY_EXISTS

    asyncio.run(scenario())


def test_durable_route_skip_and_active_join_resume_without_reexecution() -> None:
    async def scenario() -> None:
        store = MemoryEventStore()
        compiled = durable_routed_graph()
        result = await start_graph_run(
            compiled,
            {"requestedRoutes": ["quick"]},
            {"quick": lambda _: {"branch": "quick"}},
            run_id="durable-route",
            implementation_id="router@1",
            event_store=store,
            clock=fixed_clock,
        )

        assert result.status is RunStatus.SUCCEEDED
        assert result.failures == ()
        assert dict(result.outputs or {}) == {"result": {"quick": {"branch": "quick"}}}
        assert result.nodes["security"].failure is not None
        assert result.nodes["security"].failure.code is FailureCode.ROUTE_NOT_SELECTED
        history = await store.read("durable-route")
        settled = [item for item in history if item.type == "NodeSettledWithoutAttempt"]
        assert [item.node_id for item in settled] == ["security"]

        resumed = await resume_graph_run(
            compiled,
            {"*": lambda _: (_ for _ in ()).throw(AssertionError("must not run"))},
            run_id="durable-route",
            implementation_id="router@1",
            event_store=store,
            clock=fixed_clock,
        )
        assert resumed == result

    asyncio.run(scenario())


def test_invalid_durable_route_result_never_commits_success_and_never_retries() -> None:
    async def scenario() -> None:
        store = MemoryEventStore()
        compiled = durable_routed_graph(router_retry=True)
        invalid = {
            "routed": True,
            "reasonCode": "REQUESTED_ROUTES_SELECTED",
            "requestedRoutes": ["quick"],
            "selectedRoutes": ["security"],
            "unknownRoutes": [],
            "confidenceBasisPoints": None,
            "usedDefault": False,
            "escalated": False,
        }
        result = await start_graph_run(
            compiled,
            {"requestedRoutes": ["quick"]},
            {"classify": lambda _: invalid},
            run_id="durable-invalid-route",
            implementation_id="router@1",
            event_store=store,
            clock=fixed_clock,
        )

        assert result.status is RunStatus.FAILED
        assert result.total_attempts == 1
        assert result.nodes["classify"].failure is not None
        assert result.nodes["classify"].failure.code is FailureCode.INVALID_ROUTE_SELECTION
        history = await store.read("durable-invalid-route")
        assert not any(
            item.type == "NodeSucceeded" and item.node_id == "classify" for item in history
        )
        failures = [
            item
            for item in history
            if item.type == "NodeAttemptFailed" and item.node_id == "classify"
        ]
        assert len(failures) == 1
        assert failures[0].data["terminal"] is True

        resumed = await resume_graph_run(
            compiled,
            run_id="durable-invalid-route",
            implementation_id="router@1",
            event_store=store,
            clock=fixed_clock,
        )
        assert resumed == result

    asyncio.run(scenario())


def test_durable_router_success_is_bound_to_its_committed_input() -> None:
    async def scenario() -> None:
        compiled = durable_routed_graph()
        source = MemoryEventStore()
        await start_graph_run(
            compiled,
            {"requestedRoutes": ["quick"]},
            {"quick": lambda _: "quick"},
            run_id="durable-authoritative-route-input",
            implementation_id="router@1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("durable-authoritative-route-input"))
        forged_output = {
            "routed": True,
            "reasonCode": "REQUESTED_ROUTES_SELECTED",
            "requestedRoutes": ["security"],
            "selectedRoutes": ["security"],
            "unknownRoutes": [],
            "confidenceBasisPoints": None,
            "usedDefault": False,
            "escalated": False,
        }
        for index, event in enumerate(history):
            if event.type == "NodeSucceeded" and event.node_id == "classify":
                data = dict(event.data)
                data["output"] = encode_durable_json(forged_output)
                data["outputHash"] = durable_json_hash(forged_output)
                history[index] = resign(event, data)
                break
        forged = MemoryEventStore()
        await forged.append(
            "durable-authoritative-route-input",
            -1,
            tuple(history),
        )

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                compiled,
                run_id="durable-authoritative-route-input",
                implementation_id="router@1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_durable_history_rejects_scheduling_an_inactive_route_branch() -> None:
    async def scenario() -> None:
        compiled = durable_routed_graph()
        source = MemoryEventStore()
        await start_graph_run(
            compiled,
            {"requestedRoutes": ["quick"]},
            {"quick": lambda _: "quick"},
            run_id="forged-inactive-route-schedule",
            implementation_id="router@1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("forged-inactive-route-schedule"))
        inactive = next(
            event
            for event in history
            if event.type == "NodeSettledWithoutAttempt" and event.node_id == "security"
        )
        forged_data = {
            "input": encode_durable_json({}),
            "inputHash": durable_json_hash({}),
            "activityKey": durable_json_hash(
                [
                    "activity/v1alpha1",
                    "forged-inactive-route-schedule",
                    1,
                    "security",
                    durable_json_hash({}),
                ]
            ),
            "sideEffects": "none",
        }
        forged_scheduled = inactive.model_copy(
            update={
                "type": "NodeScheduled",
                "attempt": 1,
                "data": forged_data,
                "payload_hash": canonical_sha256(forged_data),
            }
        )
        inactive_index = history.index(inactive)
        forged = MemoryEventStore()
        await forged.append(
            "forged-inactive-route-schedule",
            -1,
            tuple([*history[:inactive_index], forged_scheduled]),
        )

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                compiled,
                run_id="forged-inactive-route-schedule",
                implementation_id="router@1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY
        assert "unselected route" in str(error.value)

    asyncio.run(scenario())


def test_unsupported_condition_cannot_enter_durable_run_or_call_executor() -> None:
    prepared_calls: list[str] = []
    prepared = {"*": lambda _: prepared_calls.append("executor")}
    result = try_compile_graph(unsupported_condition_document())

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.UNSUPPORTED_EDGE_CONDITION]
    assert prepared
    assert prepared_calls == []


def test_unsupported_condition_has_no_compiled_graph_for_forged_history() -> None:
    prepared_calls: list[str] = []
    result = try_compile_graph(unsupported_condition_document())

    assert result.graph is None
    with pytest.raises(GraphCompileError) as error:
        compile_graph(unsupported_condition_document())
    assert [item.code for item in error.value.diagnostics] == [
        DiagnosticCode.UNSUPPORTED_EDGE_CONDITION
    ]
    assert prepared_calls == []


def test_registered_foreign_conditions_preflight_durable_start_and_resume() -> None:
    async def scenario() -> None:
        store = TrackingStore()
        handler_calls: list[str] = []

        def source(_: NodeContext) -> dict[str, bool]:
            handler_calls.append("source")
            return {"done": True}

        compiled = registered_loop_condition_graph()
        started = await start_graph_run(
            compiled,
            {},
            {"source": source},
            run_id="registered-loop-preflight",
            implementation_id="runtime@1",
            event_store=store,
            clock=fixed_clock,
        )
        assert started.status is RunStatus.FAILED
        assert started.total_attempts == 0
        assert dict(started.nodes) == {}
        assert started.scheduled_order == ()
        assert started.completion_order == ()
        assert len(started.failures) == 1
        assert started.failures[0].code is FailureCode.UNSUPPORTED_EDGE_CONDITION
        assert store.read_calls == 0
        assert store.append_calls == 0
        assert handler_calls == []

        resumed = await resume_graph_run(
            compiled,
            {"source": source},
            run_id="registered-loop-preflight",
            implementation_id="runtime@1",
            event_store=store,
            clock=fixed_clock,
        )
        assert resumed == started
        assert store.read_calls == 0
        assert store.append_calls == 0
        assert handler_calls == []

    asyncio.run(scenario())


def test_durable_scheduled_order_preserves_interleaved_first_event_order() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "durable-interleaving", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["a", "b"],
            "outputs": {"result": {"node": "b-child"}},
            "nodes": [
                {
                    "id": node_id,
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                }
                for node_id in ("a", "b", "a-child", "b-child")
            ],
            "edges": [
                {"id": "a-child", "from": {"node": "a"}, "to": {"node": "a-child"}},
                {"id": "b-child", "from": {"node": "b"}, "to": {"node": "b-child"}},
            ],
        }
    )

    async def scenario() -> None:
        store = MemoryEventStore()
        a_started = asyncio.Event()
        release_a = asyncio.Event()

        async def slow_a(_: NodeContext) -> Any:
            a_started.set()
            await release_a.wait()
            raise RuntimeError("a failed after b-child ran")

        async def fast_b(_: NodeContext) -> Any:
            await a_started.wait()
            return "b"

        def b_child(_: NodeContext) -> Any:
            release_a.set()
            return "b-child"

        result = await start_graph_run(
            compiled,
            {},
            {
                "a": slow_a,
                "b": fast_b,
                "a-child": lambda _: (_ for _ in ()).throw(
                    AssertionError("failed descendant must not run")
                ),
                "b-child": b_child,
            },
            run_id="durable-interleaving",
            implementation_id="interleaving@1",
            event_store=store,
            clock=fixed_clock,
        )

        assert result.status is RunStatus.FAILED
        assert result.scheduled_order == ("a", "b", "b-child", "a-child")
        history = await store.read("durable-interleaving")
        first_seen = tuple(
            event.node_id
            for event in history
            if event.type in {"NodeScheduled", "NodeSettledWithoutAttempt"}
        )
        assert first_seen == result.scheduled_order

        resumed = await resume_graph_run(
            compiled,
            run_id="durable-interleaving",
            implementation_id="interleaving@1",
            event_store=store,
            clock=fixed_clock,
        )
        assert resumed == result

    asyncio.run(scenario())


def test_shared_resume_fixture_reuses_success_and_advances_open_attempt() -> None:
    fixture = json.loads(
        (ROOT / "spec/conformance/durable-resume.case.json").read_text(encoding="utf-8")
    )
    compiled = compile_graph(fixture["graph"])

    async def scenario() -> None:
        store = MemoryEventStore()

        async def left(_: NodeContext) -> Any:
            return fixture["preCrash"]["succeeded"]["output"]

        async def right_crashes(_: NodeContext) -> Any:
            await asyncio.sleep(0.02)
            raise ProcessLost

        with pytest.raises(ProcessLost):
            await start_graph_run(
                compiled,
                fixture["graphInput"],
                {"left": left, "right": right_crashes, "merge": lambda _: None},
                run_id=fixture["runId"],
                implementation_id=fixture["implementationId"],
                event_store=store,
                clock=fixed_clock,
            )
        pre_resume_count = len(await store.read(fixture["runId"]))

        calls: list[tuple[str, int]] = []
        merge_input: object = None
        right_keys: list[str | None] = []

        def never_left(_: NodeContext) -> Any:
            raise AssertionError("committed successful node ran again")

        def right(context: NodeContext) -> Any:
            calls.append((context.node.id, context.attempt))
            right_keys.append(context.activity_key)
            return fixture["resumeReturns"]["right"]

        def merge(context: NodeContext) -> Any:
            nonlocal merge_input
            calls.append((context.node.id, context.attempt))
            merge_input = context.input
            return fixture["resumeReturns"]["merge"]

        result = await resume_graph_run(
            compiled,
            {"left": never_left, "right": right, "merge": merge},
            run_id=fixture["runId"],
            implementation_id=fixture["implementationId"],
            event_store=store,
            clock=fixed_clock,
        )
        assert calls == [
            (item["nodeId"], item["attempt"]) for item in fixture["expect"]["executorCalls"]
        ]
        assert merge_input == fixture["expect"]["mergeInput"]
        assert result.status.value == fixture["expect"]["status"]
        assert dict(result.outputs or {}) == fixture["expect"]["output"]
        assert result.total_attempts == fixture["expect"]["totalAttempts"]

        resumed_history = await store.read(fixture["runId"])
        assert [item.type for item in resumed_history[pre_resume_count : pre_resume_count + 3]] == [
            "RunResumed",
            "NodeAttemptFailed",
            "NodeRetried",
        ]
        right_schedules = [
            item
            for item in resumed_history
            if item.type == "NodeScheduled" and item.node_id == "right"
        ]
        assert len(right_schedules) == 2
        assert right_schedules[0].data["activityKey"] == right_schedules[1].data["activityKey"]
        assert right_keys == [right_schedules[0].data["activityKey"]]

        terminal_version = len(await store.read(fixture["runId"]))
        terminal = await resume_graph_run(
            compiled,
            {"*": never_left},
            run_id=fixture["runId"],
            implementation_id=fixture["implementationId"],
            event_store=store,
            clock=fixed_clock,
        )
        assert terminal == result
        assert len(await store.read(fixture["runId"])) == terminal_version

    asyncio.run(scenario())


def test_resume_rejects_implementation_graph_input_and_payload_identity() -> None:
    async def scenario() -> None:
        store = MemoryEventStore()
        await start_graph_run(
            graph(),
            {"seed": 1},
            {"root": lambda _: "ok"},
            run_id="identity",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )
        with pytest.raises(DurableRunError) as implementation:
            await resume_graph_run(
                graph(),
                run_id="identity",
                implementation_id="v2",
                event_store=store,
            )
        assert implementation.value.code is DurableRunErrorCode.IMPLEMENTATION_MISMATCH

        changed = graph(
            {
                "id": "root",
                "kind": "agent",
                "inputSchema": {},
                "outputSchema": {},
                "config": {"changed": True},
                "sideEffects": "none",
            }
        )
        with pytest.raises(DurableRunError) as graph_error:
            await resume_graph_run(
                changed,
                run_id="identity",
                implementation_id="v1",
                event_store=store,
            )
        assert graph_error.value.code is DurableRunErrorCode.GRAPH_HASH_MISMATCH

        original = await store.read("identity")
        tampered_store = MemoryEventStore()
        data = dict(original[0].data)
        data["inputHash"] = "0" * 64
        tampered = original[0].model_copy(
            update={"data": data, "payload_hash": canonical_sha256(data)}
        )
        await tampered_store.append("identity", -1, (tampered, *original[1:]))
        with pytest.raises(DurableRunError) as input_error:
            await resume_graph_run(
                graph(),
                run_id="identity",
                implementation_id="v1",
                event_store=tampered_store,
            )
        assert input_error.value.code is DurableRunErrorCode.INPUT_HASH_MISMATCH

        bad_hash_store = MemoryEventStore()
        bad_hash = original[2].model_copy(update={"payload_hash": "f" * 64})
        await bad_hash_store.append(
            "identity",
            -1,
            (*original[:2], bad_hash, *original[3:]),
        )
        with pytest.raises(DurableRunError) as history_error:
            await resume_graph_run(
                graph(),
                run_id="identity",
                implementation_id="v1",
                event_store=bad_hash_store,
            )
        assert history_error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_undeclared_interrupted_side_effect_is_in_doubt_and_never_reinvoked() -> None:
    unsafe_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2},
        }
    )

    async def scenario() -> None:
        store = MemoryEventStore()
        with pytest.raises(ProcessLost):
            await start_graph_run(
                unsafe_graph,
                {},
                {"root": lambda _: (_ for _ in ()).throw(ProcessLost())},
                run_id="unsafe",
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        calls = 0

        def handler(_: NodeContext) -> Any:
            nonlocal calls
            calls += 1
            return "bad"

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                unsafe_graph,
                {"root": handler},
                run_id="unsafe",
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        assert error.value.code is DurableRunErrorCode.IN_DOUBT_SIDE_EFFECT
        assert calls == 0
        event_count = len(await store.read("unsafe"))
        with pytest.raises(DurableRunError) as repeated:
            await resume_graph_run(
                unsafe_graph,
                {"root": handler},
                run_id="unsafe",
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        assert repeated.value.code is DurableRunErrorCode.IN_DOUBT_SIDE_EFFECT
        assert calls == 0
        assert len(await store.read("unsafe")) == event_count

    asyncio.run(scenario())


def test_interrupted_idempotent_node_reuses_activity_key_on_retry() -> None:
    idempotent_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2},
            "sideEffects": "idempotent",
        }
    )

    async def scenario() -> None:
        store = MemoryEventStore()
        first_key: str | None = None

        def crashes(context: NodeContext) -> Any:
            nonlocal first_key
            first_key = context.activity_key
            raise ProcessLost

        with pytest.raises(ProcessLost):
            await start_graph_run(
                idempotent_graph,
                {"value": 0.1},
                {"root": crashes},
                run_id="idempotent",
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        second_key: str | None = None

        def succeeds(context: NodeContext) -> Any:
            nonlocal second_key
            second_key = context.idempotency_key
            assert context.attempt == 2
            return "ok"

        result = await resume_graph_run(
            idempotent_graph,
            {"root": succeeds},
            run_id="idempotent",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )
        assert result.succeeded
        assert first_key == second_key

    asyncio.run(scenario())


def test_resigned_forged_terminal_output_is_invalid_history() -> None:
    async def scenario() -> None:
        source = MemoryEventStore()
        await start_graph_run(
            graph(),
            {"seed": 1},
            {"root": lambda _: "real"},
            run_id="forged-terminal",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("forged-terminal"))
        terminal = history[-1]
        result = decode_durable_json(terminal.data["result"])
        assert isinstance(result, dict)
        result["output"] = {"result": "forged"}
        terminal_data = {"result": encode_durable_json(result)}
        history[-1] = resign(terminal, terminal_data)
        forged = MemoryEventStore()
        await forged.append("forged-terminal", -1, history)

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                graph(),
                run_id="forged-terminal",
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "field_name",
    ["status", "nodes", "failures", "scheduledOrder", "completionOrder", "maxConcurrency"],
)
def test_resigned_forged_terminal_projection_is_invalid_history(field_name: str) -> None:
    async def scenario() -> None:
        run_id = f"forged-terminal-{field_name}"
        source = MemoryEventStore()
        await start_graph_run(
            graph(),
            {},
            {"root": lambda _: "real"},
            run_id=run_id,
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read(run_id))
        terminal = history[-1]
        result = decode_durable_json(terminal.data["result"])
        assert isinstance(result, dict)
        if field_name == "status":
            result["status"] = "failed"
        elif field_name == "nodes":
            nodes = result["nodes"]
            assert isinstance(nodes, list) and isinstance(nodes[0], dict)
            nodes[0]["output"] = "forged"
        elif field_name == "failures":
            failures = result["failures"]
            assert isinstance(failures, list)
            failures.append(
                {
                    "phase": "execute",
                    "code": "NODE_EXECUTION_FAILED",
                    "message": "forged",
                    "nodeId": "root",
                    "attempt": 1,
                    "retryable": False,
                }
            )
        elif field_name == "scheduledOrder":
            result["scheduledOrder"] = []
        elif field_name == "completionOrder":
            result["completionOrder"] = []
        else:
            result["maxObservedConcurrency"] = 2
        history[-1] = resign(terminal, {"result": encode_durable_json(result)})
        forged = MemoryEventStore()
        await forged.append(run_id, -1, history)

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                graph(),
                run_id=run_id,
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_self_consistent_forged_scheduled_input_is_invalid_history() -> None:
    async def scenario() -> None:
        source = MemoryEventStore()
        await start_graph_run(
            graph(),
            {"seed": 1},
            {"root": lambda _: "ok"},
            run_id="forged-input",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("forged-input"))
        scheduled_index = next(
            index for index, item in enumerate(history) if item.type == "NodeScheduled"
        )
        started_index = next(
            index for index, item in enumerate(history) if item.type == "NodeStarted"
        )
        succeeded_index = next(
            index for index, item in enumerate(history) if item.type == "NodeSucceeded"
        )
        forged_input = {"seed": 999}
        input_hash = durable_json_hash(forged_input)
        activity_key = durable_json_hash(
            ["activity/v1alpha1", "forged-input", 1, "root", input_hash]
        )
        history[scheduled_index] = resign(
            history[scheduled_index],
            {
                "input": encode_durable_json(forged_input),
                "inputHash": input_hash,
                "activityKey": activity_key,
                "sideEffects": "none",
            },
        )
        history[started_index] = resign(
            history[started_index],
            {"inputHash": input_hash, "activityKey": activity_key},
        )
        succeeded_data = dict(history[succeeded_index].data)
        succeeded_data["inputHash"] = input_hash
        history[succeeded_index] = resign(history[succeeded_index], succeeded_data)
        terminal = history[-1]
        result = decode_durable_json(terminal.data["result"])
        assert isinstance(result, dict)
        nodes = result["nodes"]
        assert isinstance(nodes, list) and isinstance(nodes[0], dict)
        nodes[0]["input"] = forged_input
        history[-1] = resign(terminal, {"result": encode_durable_json(result)})
        forged = MemoryEventStore()
        await forged.append("forged-input", -1, history)

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                graph(),
                run_id="forged-input",
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_run_resumed_lists_must_match_folded_facts_without_overlap() -> None:
    retry_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2},
            "sideEffects": "none",
        }
    )

    async def scenario() -> None:
        source = MemoryEventStore()
        with pytest.raises(ProcessLost):
            await start_graph_run(
                retry_graph,
                {},
                {"root": lambda _: (_ for _ in ()).throw(ProcessLost())},
                run_id="forged-resume-lists",
                implementation_id="v1",
                event_store=source,
                clock=fixed_clock,
            )
        await resume_graph_run(
            retry_graph,
            {"root": lambda _: "ok"},
            run_id="forged-resume-lists",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("forged-resume-lists"))
        index = next(
            item_index for item_index, item in enumerate(history) if item.type == "RunResumed"
        )
        history[index] = resign(
            history[index],
            {"reusedNodeIds": ["root"], "interruptedNodeIds": ["root"]},
        )
        forged = MemoryEventStore()
        await forged.append("forged-resume-lists", -1, history)

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                retry_graph,
                run_id="forged-resume-lists",
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("max_attempts", "max_total_attempts"),
    [(1, None), (2, 1)],
)
def test_retry_beyond_node_or_global_attempt_budget_is_invalid_history(
    max_attempts: int,
    max_total_attempts: int | None,
) -> None:
    limited_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": max_attempts},
            "sideEffects": "none",
        },
        policies=(
            {"maxTotalAttempts": max_total_attempts} if max_total_attempts is not None else None
        ),
    )
    run_id = f"over-budget-{max_attempts}-{max_total_attempts}"

    async def scenario() -> None:
        store = MemoryEventStore()
        with pytest.raises(ProcessLost):
            await start_graph_run(
                limited_graph,
                {},
                {"root": lambda _: (_ for _ in ()).throw(ProcessLost())},
                run_id=run_id,
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        history = await store.read(run_id)
        version = history[-1].sequence
        scheduled = next(item for item in history if item.type == "NodeScheduled")
        activity_key = str(scheduled.data["activityKey"])
        input_hash = str(scheduled.data["inputHash"])
        failure = {
            "phase": "execute",
            "code": "NODE_EXECUTION_INTERRUPTED",
            "message": "process ended before the attempt outcome was durably recorded",
            "nodeId": "root",
            "attempt": 1,
            "retryable": True,
            "causeName": "ProcessLost",
        }
        suffix = (
            forged_event(
                run_id=run_id,
                sequence=version + 1,
                event_type="NodeAttemptFailed",
                data={"terminal": False, "failure": failure},
                node_id="root",
                attempt=1,
            ),
            forged_event(
                run_id=run_id,
                sequence=version + 2,
                event_type="NodeRetried",
                data={"availableAt": FIXED_TIME, "activityKey": activity_key},
                node_id="root",
                attempt=2,
            ),
            forged_event(
                run_id=run_id,
                sequence=version + 3,
                event_type="NodeScheduled",
                data={
                    "input": scheduled.data["input"],
                    "inputHash": input_hash,
                    "activityKey": activity_key,
                    "sideEffects": "none",
                },
                node_id="root",
                attempt=2,
            ),
            forged_event(
                run_id=run_id,
                sequence=version + 4,
                event_type="NodeStarted",
                data={"inputHash": input_hash, "activityKey": activity_key},
                node_id="root",
                attempt=2,
            ),
        )
        await store.append(run_id, version, suffix)

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                limited_graph,
                run_id=run_id,
                implementation_id="v1",
                event_store=store,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


class ConflictStore:
    def __init__(self, delegate: MemoryEventStore) -> None:
        self.delegate = delegate

    async def read(self, run_id: str, from_sequence: int = 0) -> tuple[GraphEvent, ...]:
        return await self.delegate.read(run_id, from_sequence)

    async def append(
        self,
        run_id: str,
        expected_version: int,
        values: Sequence[GraphEvent],
    ) -> int:
        actual = len(await self.delegate.read(run_id)) - 1
        raise VersionConflictError(run_id, expected_version, actual + 1)


def test_resume_cas_conflict_invokes_no_executor() -> None:
    async def scenario() -> None:
        store = MemoryEventStore()
        with pytest.raises(ProcessLost):
            await start_graph_run(
                graph(
                    {
                        "id": "root",
                        "kind": "agent",
                        "inputSchema": {},
                        "outputSchema": {},
                        "config": {},
                        "retry": {"maxAttempts": 2},
                        "sideEffects": "none",
                    }
                ),
                {},
                {"root": lambda _: (_ for _ in ()).throw(ProcessLost())},
                run_id="conflict",
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        calls = 0
        before = len(await store.read("conflict"))

        def handler(_: NodeContext) -> Any:
            nonlocal calls
            calls += 1
            return "bad"

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                graph(
                    {
                        "id": "root",
                        "kind": "agent",
                        "inputSchema": {},
                        "outputSchema": {},
                        "config": {},
                        "retry": {"maxAttempts": 2},
                        "sideEffects": "none",
                    }
                ),
                {"root": handler},
                run_id="conflict",
                implementation_id="v1",
                event_store=ConflictStore(store),
                clock=fixed_clock,
            )
        assert error.value.code is DurableRunErrorCode.RESUME_CONFLICT
        assert calls == 0
        assert len(await store.read("conflict")) == before

    asyncio.run(scenario())


def test_durable_entrypoints_recompile_a_detached_graph_before_store_access() -> None:
    async def scenario() -> None:
        compiled = graph(
            {
                "id": "root",
                "kind": "agent",
                "inputSchema": {},
                "outputSchema": {},
                "config": {},
                "sideEffects": "none",
            }
        )
        config = compiled.spec.nodes[0].config
        assert isinstance(config, dict)
        config["unsafe"] = 2**53
        store = TrackingStore()

        with pytest.raises(GraphCompileError):
            await start_graph_run(
                compiled,
                {},
                run_id="unsafe-start",
                implementation_id="v1",
                event_store=store,
            )
        with pytest.raises(GraphCompileError):
            await resume_graph_run(
                compiled,
                run_id="unsafe-resume",
                implementation_id="v1",
                event_store=store,
            )

        assert store.read_calls == 0
        assert store.append_calls == 0

    asyncio.run(scenario())


def test_mutating_the_original_compiled_graph_does_not_reach_later_handlers() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "snapshot-isolation", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["root"],
            "outputs": {"result": {"node": "next"}},
            "nodes": [
                {
                    "id": "root",
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                },
                {
                    "id": "next",
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {"marker": "original"},
                    "sideEffects": "none",
                },
            ],
            "edges": [{"id": "root-next", "from": {"node": "root"}, "to": {"node": "next"}}],
        }
    )

    async def scenario() -> None:
        store = MemoryEventStore()

        def mutate_original(_: NodeContext) -> Any:
            original_config = compiled.spec.nodes[1].config
            assert isinstance(original_config, dict)
            original_config["marker"] = "mutated"
            return "root"

        def observe_fresh(context: NodeContext) -> Any:
            assert isinstance(context.node.config, dict)
            assert context.node.config["marker"] == "original"
            assert isinstance(context.graph.nodes[1].config, dict)
            assert context.graph.nodes[1].config["marker"] == "original"
            return context.node.config["marker"]

        result = await start_graph_run(
            compiled,
            {},
            {"root": mutate_original, "next": observe_fresh},
            run_id="snapshot-isolation",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )

        assert result.succeeded
        assert dict(result.outputs or {}) == {"result": "original"}

    asyncio.run(scenario())


def test_resume_recomputes_graph_hash_after_nested_graph_mutation() -> None:
    async def scenario() -> None:
        compiled = graph(
            {
                "id": "root",
                "kind": "agent",
                "inputSchema": {},
                "outputSchema": {},
                "config": {"revision": 1},
                "sideEffects": "none",
            }
        )
        store = MemoryEventStore()
        await start_graph_run(
            compiled,
            {},
            {"root": lambda _: "ok"},
            run_id="mutated-hash",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )
        config = compiled.spec.nodes[0].config
        assert isinstance(config, dict)
        config["revision"] = 2

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                compiled,
                run_id="mutated-hash",
                implementation_id="v1",
                event_store=store,
            )

        assert error.value.code is DurableRunErrorCode.GRAPH_HASH_MISMATCH

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "available_at",
    ["2026-07-26T12:00:00", "2026-02-30T12:00:00Z"],
)
def test_retry_available_at_requires_strict_real_rfc3339_before_append(
    available_at: str,
) -> None:
    retry_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2},
            "sideEffects": "none",
        }
    )

    async def scenario() -> None:
        run_id = "bad-time-date" if available_at.endswith("Z") else "bad-time-offset"
        source = MemoryEventStore()
        calls = 0

        def flaky(_: NodeContext) -> Any:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("retry")
            return "ok"

        await start_graph_run(
            retry_graph,
            {},
            {"root": flaky},
            run_id=run_id,
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read(run_id))
        retry_index = next(
            index for index, event in enumerate(history) if event.type == "NodeRetried"
        )
        retry_data = dict(history[retry_index].data)
        retry_data["availableAt"] = available_at
        history[retry_index] = resign(history[retry_index], retry_data)
        forged = MemoryEventStore()
        await forged.append(run_id, -1, history)
        tracked = TrackingStore(forged)

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                retry_graph,
                run_id=run_id,
                implementation_id="v1",
                event_store=tracked,
            )

        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY
        assert tracked.read_calls == 1
        assert tracked.append_calls == 0

    asyncio.run(scenario())


@pytest.mark.parametrize("mutation", ["hidden-output", "retryable", "phase", "skipped"])
def test_terminal_node_outcomes_reject_resigned_semantic_contradictions(
    mutation: str,
) -> None:
    async def scenario() -> None:
        run_id = f"terminal-semantics-{mutation}"
        source = MemoryEventStore()
        await start_graph_run(
            graph(),
            {},
            {"root": lambda _: (_ for _ in ()).throw(RuntimeError("failed"))},
            run_id=run_id,
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read(run_id))
        terminal = history[-1]
        result = decode_durable_json(terminal.data["result"])
        assert isinstance(result, dict)
        nodes = result["nodes"]
        assert isinstance(nodes, list) and isinstance(nodes[0], dict)
        failure = nodes[0]["failure"]
        assert isinstance(failure, dict)
        if mutation == "hidden-output":
            nodes[0]["output"] = "forged"
        elif mutation == "retryable":
            failure["retryable"] = True
        elif mutation == "phase":
            failure["phase"] = "output"
        else:
            nodes[0]["status"] = "skipped"
        history[-1] = resign(terminal, {"result": encode_durable_json(result)})
        forged = MemoryEventStore()
        await forged.append(run_id, -1, history)

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                graph(),
                run_id=run_id,
                implementation_id="v1",
                event_store=forged,
            )

        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_safe_interrupted_attempt_cannot_be_forged_terminal_while_budget_remains() -> None:
    retry_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2},
            "sideEffects": "none",
        }
    )

    async def scenario() -> None:
        run_id = "forged-terminal-interruption"
        store = MemoryEventStore()
        with pytest.raises(ProcessLost):
            await start_graph_run(
                retry_graph,
                {},
                {"root": lambda _: (_ for _ in ()).throw(ProcessLost())},
                run_id=run_id,
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        history = await store.read(run_id)
        failure = {
            "phase": "execute",
            "code": "NODE_EXECUTION_INTERRUPTED",
            "message": "forged terminal interruption",
            "nodeId": "root",
            "attempt": 1,
            "retryable": False,
            "causeName": "ProcessLost",
        }
        terminal_result = {
            "status": "failed",
            "graphHash": retry_graph.graph_hash,
            "nodes": [
                {
                    "nodeId": "root",
                    "sequence": 0,
                    "status": "failed",
                    "attempts": 1,
                    "input": {},
                    "failure": failure,
                }
            ],
            "failures": [failure],
            "scheduledOrder": ["root"],
            "completionOrder": ["root"],
            "maxObservedConcurrency": 1,
            "totalAttempts": 1,
        }
        await store.append(
            run_id,
            history[-1].sequence,
            (
                forged_event(
                    run_id=run_id,
                    sequence=len(history),
                    event_type="NodeAttemptFailed",
                    data={"terminal": True, "failure": failure},
                    node_id="root",
                    attempt=1,
                ),
                forged_event(
                    run_id=run_id,
                    sequence=len(history) + 1,
                    event_type="RunFailed",
                    data={"result": encode_durable_json(terminal_result)},
                ),
            ),
        )

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                retry_graph,
                run_id=run_id,
                implementation_id="v1",
                event_store=store,
            )

        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_safe_interrupted_attempt_may_be_terminal_only_after_retry_budget_exhaustion() -> None:
    exhausted_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 1},
            "sideEffects": "none",
        }
    )

    async def scenario() -> None:
        store = MemoryEventStore()
        with pytest.raises(ProcessLost):
            await start_graph_run(
                exhausted_graph,
                {},
                {"root": lambda _: (_ for _ in ()).throw(ProcessLost())},
                run_id="exhausted-interruption",
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )

        result = await resume_graph_run(
            exhausted_graph,
            run_id="exhausted-interruption",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )
        assert result.status is RunStatus.FAILED
        assert result.nodes["root"].failure is not None
        assert result.nodes["root"].failure.code is FailureCode.NODE_EXECUTION_INTERRUPTED
        assert not result.nodes["root"].failure.retryable

        assert (
            await resume_graph_run(
                exhausted_graph,
                run_id="exhausted-interruption",
                implementation_id="v1",
                event_store=store,
            )
            == result
        )

    asyncio.run(scenario())


def test_global_budget_does_not_emit_an_unfunded_single_node_retry() -> None:
    limited_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2},
            "sideEffects": "none",
        },
        policies={"maxTotalAttempts": 1},
    )

    async def scenario() -> None:
        store = MemoryEventStore()
        result = await start_graph_run(
            limited_graph,
            {},
            {"root": lambda _: (_ for _ in ()).throw(RuntimeError("failed"))},
            run_id="single-reservation",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )
        history = await store.read("single-reservation")

        assert result.total_attempts == 1
        assert result.nodes["root"].attempts == 1
        assert not any(event.type == "NodeRetried" for event in history)
        attempt_failure = next(event for event in history if event.type == "NodeAttemptFailed")
        assert attempt_failure.data["terminal"] is True
        assert (
            await resume_graph_run(
                limited_graph,
                run_id="single-reservation",
                implementation_id="v1",
                event_store=store,
            )
            == result
        )

    asyncio.run(scenario())


def test_concurrent_failures_compete_for_one_global_retry_reservation() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "reservation-race", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["left", "right"],
            "outputs": {"left": {"node": "left"}, "right": {"node": "right"}},
            "nodes": [
                {
                    "id": node_id,
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "retry": {"maxAttempts": 2},
                    "sideEffects": "none",
                }
                for node_id in ("left", "right")
            ],
            "edges": [],
            "policies": {"maxConcurrency": 2, "maxTotalAttempts": 3},
        }
    )

    async def scenario() -> None:
        store = MemoryEventStore()
        both_started = asyncio.Event()
        first_attempts = 0

        async def fail_together(context: NodeContext) -> Any:
            nonlocal first_attempts
            if context.attempt == 1:
                first_attempts += 1
                if first_attempts == 2:
                    both_started.set()
                await both_started.wait()
            raise RuntimeError("failed")

        result = await start_graph_run(
            compiled,
            {},
            {"*": fail_together},
            run_id="reservation-race",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )
        history = await store.read("reservation-race")

        assert result.status is RunStatus.FAILED
        assert result.total_attempts == 3
        assert sorted(node.attempts for node in result.nodes.values()) == [1, 2]
        assert sum(event.type == "NodeRetried" for event in history) == 1
        assert (
            sum(
                event.type == "NodeAttemptFailed" and event.data["terminal"] is False
                for event in history
            )
            == 1
        )
        assert (
            await resume_graph_run(
                compiled,
                run_id="reservation-race",
                implementation_id="v1",
                event_store=store,
            )
            == result
        )

    asyncio.run(scenario())


def test_persisted_retry_reservation_is_counted_before_new_attempt_admission() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "persisted-reservation", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["a", "b"],
            "outputs": {"a": {"node": "a"}, "b": {"node": "b"}},
            "nodes": [
                {
                    "id": node_id,
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    **(
                        {"retry": {"maxAttempts": 2}, "sideEffects": "none"}
                        if node_id == "a"
                        else {}
                    ),
                }
                for node_id in ("a", "b")
            ],
            "edges": [],
            "policies": {"maxConcurrency": 1, "maxTotalAttempts": 2},
        }
    )

    async def scenario() -> None:
        run_id = "persisted-reservation"
        store = MemoryEventStore()
        input_hash = durable_json_hash({})
        activity_key = durable_json_hash(["activity/v1alpha1", run_id, 1, "a", input_hash])
        failure = {
            "phase": "execute",
            "code": "NODE_EXECUTION_FAILED",
            "message": "retry me",
            "nodeId": "a",
            "attempt": 1,
            "retryable": True,
            "causeName": "RuntimeError",
        }
        documents: tuple[tuple[str, dict[str, Any], str | None, int | None], ...] = (
            (
                "RunCreated",
                {
                    "contractVersion": "scheduler-recovery/v1alpha1",
                    "graphHash": compiled.graph_hash,
                    "implementationHash": durable_json_hash("v1"),
                    "input": encode_durable_json({}),
                    "inputHash": input_hash,
                    "maxTotalAttempts": 2,
                },
                None,
                None,
            ),
            ("RunStarted", {}, None, None),
            (
                "NodeScheduled",
                {
                    "input": encode_durable_json({}),
                    "inputHash": input_hash,
                    "activityKey": activity_key,
                    "sideEffects": "none",
                },
                "a",
                1,
            ),
            (
                "NodeStarted",
                {
                    "inputHash": input_hash,
                    "activityKey": activity_key,
                },
                "a",
                1,
            ),
            (
                "NodeAttemptFailed",
                {
                    "terminal": False,
                    "failure": failure,
                },
                "a",
                1,
            ),
            (
                "NodeRetried",
                {
                    "availableAt": FIXED_TIME,
                    "activityKey": activity_key,
                },
                "a",
                2,
            ),
            (
                "NodeSettledWithoutAttempt",
                {
                    "result": encode_durable_json(
                        {
                            "nodeId": "b",
                            "sequence": 1,
                            "status": "failed",
                            "attempts": 0,
                            "input": {},
                            "failure": {
                                "phase": "execute",
                                "code": "ATTEMPT_BUDGET_EXHAUSTED",
                                "message": "foreign scheduler budget wording",
                                "nodeId": "b",
                                "attempt": 0,
                                "retryable": False,
                            },
                        }
                    )
                },
                "b",
                None,
            ),
        )
        await store.append(
            run_id,
            -1,
            tuple(
                forged_event(
                    run_id=run_id,
                    sequence=index,
                    event_type=event_type,
                    data=data,
                    node_id=node_id,
                    attempt=attempt,
                )
                for index, (event_type, data, node_id, attempt) in enumerate(documents)
            ),
        )
        b_calls = 0

        def b_handler(_: NodeContext) -> Any:
            nonlocal b_calls
            b_calls += 1
            return "must-not-run"

        result = await resume_graph_run(
            compiled,
            {"a": lambda context: f"a-attempt-{context.attempt}", "b": b_handler},
            run_id=run_id,
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )

        assert result.total_attempts == 2
        assert result.nodes["a"].attempts == 2
        assert result.nodes["a"].succeeded
        assert result.nodes["b"].attempts == 0
        assert result.nodes["b"].failure is not None
        assert result.nodes["b"].failure.code is FailureCode.ATTEMPT_BUDGET_EXHAUSTED
        assert b_calls == 0
        assert (
            await resume_graph_run(
                compiled,
                run_id=run_id,
                implementation_id="v1",
                event_store=store,
            )
            == result
        )

    asyncio.run(scenario())


def test_budget_rejection_does_not_inflate_durable_concurrency() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "budget-concurrency", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["a", "b"],
            "outputs": {"a": {"node": "a"}, "b": {"node": "b"}},
            "nodes": [
                {
                    "id": node_id,
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
                for node_id in ("a", "b")
            ],
            "edges": [],
            "policies": {"maxConcurrency": 2, "maxTotalAttempts": 1},
        }
    )

    async def scenario() -> None:
        store = MemoryEventStore()
        calls: list[str] = []

        async def execute(context: NodeContext) -> Any:
            calls.append(context.node.id)
            await asyncio.sleep(0.01)
            return context.node.id

        result = await start_graph_run(
            compiled,
            {},
            {"*": execute},
            run_id="budget-concurrency",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )
        history = await store.read("budget-concurrency")

        assert result.max_observed_concurrency == 1
        assert result.total_attempts == 1
        assert len(calls) == 1
        assert sum(event.type == "NodeStarted" for event in history) == 1
        assert (
            await resume_graph_run(
                compiled,
                run_id="budget-concurrency",
                implementation_id="v1",
                event_store=store,
            )
            == result
        )

    asyncio.run(scenario())


def test_failure_is_committed_before_a_single_slot_admits_the_next_node() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "failure-slot-order", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["a", "b"],
            "outputs": {"a": {"node": "a"}, "b": {"node": "b"}},
            "nodes": [
                {
                    "id": node_id,
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
                for node_id in ("a", "b")
            ],
            "edges": [],
            "policies": {"maxConcurrency": 1},
        }
    )

    async def scenario() -> None:
        store = MemoryEventStore()
        result = await start_graph_run(
            compiled,
            {},
            {
                "a": lambda _: (_ for _ in ()).throw(RuntimeError("failed")),
                "b": lambda _: "ok",
            },
            run_id="failure-slot-order",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )
        history = await store.read("failure-slot-order")
        failed_index = next(
            index
            for index, event in enumerate(history)
            if event.type == "NodeAttemptFailed" and event.node_id == "a"
        )
        next_started_index = next(
            index
            for index, event in enumerate(history)
            if event.type == "NodeStarted" and event.node_id == "b"
        )

        assert failed_index < next_started_index
        assert result.max_observed_concurrency == 1
        assert (
            await resume_graph_run(
                compiled,
                run_id="failure-slot-order",
                implementation_id="v1",
                event_store=store,
            )
            == result
        )

    asyncio.run(scenario())


def test_durable_journal_latches_the_first_concurrent_store_failure() -> None:
    class FailingStore:
        def __init__(self) -> None:
            self.append_calls = 0

        async def read(self, run_id: str, from_sequence: int = 0) -> tuple[GraphEvent, ...]:
            return ()

        async def append(
            self,
            run_id: str,
            expected_version: int,
            values: Sequence[GraphEvent],
        ) -> int:
            self.append_calls += 1
            await asyncio.sleep(0)
            raise RuntimeError("store unavailable")

    async def scenario() -> None:
        store = FailingStore()
        journal = _DurableJournal(
            graph=graph(),
            run_id="fatal-latch",
            store=store,
            version=-1,
            clock=fixed_clock,
            event_id_factory=lambda run_id, sequence: f"{run_id}:{sequence}",
        )
        results = await asyncio.gather(
            journal.append([_EventDraft("RunStarted", {})]),
            journal.append([_EventDraft("RunStarted", {})]),
            return_exceptions=True,
        )

        assert store.append_calls == 1
        assert all(isinstance(item, DurableRunError) for item in results)
        first, second = results
        assert first is second
        assert isinstance(first, DurableRunError)
        assert first.code is DurableRunErrorCode.DURABILITY_STORE_FAILED

    asyncio.run(scenario())


def test_durable_journal_failure_does_not_wait_for_handler_ignoring_cancellation() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "journal-failure-cancellation", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["a", "b"],
            "outputs": {"a": {"node": "a"}, "b": {"node": "b"}},
            "nodes": [
                {
                    "id": node_id,
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
                for node_id in ("a", "b")
            ],
            "edges": [],
            "policies": {"maxConcurrency": 2},
        }
    )

    class FailFirstSuccessStore:
        def __init__(self) -> None:
            self.delegate = MemoryEventStore()

        async def read(
            self,
            run_id: str,
            from_sequence: int = 0,
        ) -> tuple[GraphEvent, ...]:
            return await self.delegate.read(run_id, from_sequence)

        async def append(
            self,
            run_id: str,
            expected_version: int,
            values: Sequence[GraphEvent],
        ) -> int:
            if any(event.type == "NodeSucceeded" and event.node_id == "a" for event in values):
                raise RuntimeError("store unavailable")
            return await self.delegate.append(run_id, expected_version, values)

    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        previous_handler = loop.get_exception_handler()
        unhandled: list[dict[str, Any]] = []
        loop.set_exception_handler(lambda _loop, context: unhandled.append(context))
        b_started = asyncio.Event()
        b_cancelled = asyncio.Event()
        release_b = asyncio.Event()
        b_finished = asyncio.Event()

        async def a_handler(_: NodeContext) -> Any:
            await b_started.wait()
            return "a"

        async def b_handler(_: NodeContext) -> Any:
            b_started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                b_cancelled.set()
                await release_b.wait()
                raise RuntimeError("late handler failure") from None
            finally:
                b_finished.set()

        try:
            run = asyncio.create_task(
                start_graph_run(
                    compiled,
                    {},
                    {"a": a_handler, "b": b_handler},
                    run_id="journal-failure-cancellation",
                    implementation_id="v1",
                    event_store=FailFirstSuccessStore(),
                    clock=fixed_clock,
                )
            )
            with pytest.raises(DurableRunError) as error:
                await asyncio.wait_for(asyncio.shield(run), timeout=0.25)
            assert error.value.code is DurableRunErrorCode.DURABILITY_STORE_FAILED
            await asyncio.wait_for(b_cancelled.wait(), timeout=0.25)

            release_b.set()
            await asyncio.wait_for(b_finished.wait(), timeout=0.25)
            for _ in range(3):
                await asyncio.sleep(0)
            assert unhandled == []
        finally:
            release_b.set()
            loop.set_exception_handler(previous_handler)

    asyncio.run(scenario())


def test_durable_journal_rejects_and_latches_an_inexact_returned_version() -> None:
    class WrongVersionStore:
        def __init__(self) -> None:
            self.append_calls = 0

        async def read(self, run_id: str, from_sequence: int = 0) -> tuple[GraphEvent, ...]:
            return ()

        async def append(
            self,
            run_id: str,
            expected_version: int,
            values: Sequence[GraphEvent],
        ) -> int:
            self.append_calls += 1
            return expected_version

    async def scenario() -> None:
        store = WrongVersionStore()
        journal = _DurableJournal(
            graph=graph(),
            run_id="wrong-version",
            store=store,
            version=-1,
            clock=fixed_clock,
            event_id_factory=lambda run_id, sequence: f"{run_id}:{sequence}",
        )
        with pytest.raises(DurableRunError) as first:
            await journal.append([_EventDraft("RunStarted", {})])
        with pytest.raises(DurableRunError) as second:
            await journal.append([_EventDraft("RunStarted", {})])

        assert first.value.code is DurableRunErrorCode.DURABILITY_STORE_FAILED
        assert first.value.details == {"expectedVersion": 0, "actualVersion": -1}
        assert second.value is first.value
        assert store.append_calls == 1

    asyncio.run(scenario())


def test_missing_executor_commits_explicit_outcome_and_terminal_resume_is_read_only() -> None:
    async def scenario() -> None:
        store = MemoryEventStore()
        result = await start_graph_run(
            graph(),
            {"realNull": None},
            run_id="missing-executor-outcome",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )
        history = await store.read("missing-executor-outcome")

        assert [event.type for event in history] == [
            "RunCreated",
            "RunStarted",
            "NodeSettledWithoutAttempt",
            "RunFailed",
        ]
        settled = decode_durable_json(history[2].data["result"])
        assert isinstance(settled, dict)
        assert settled["attempts"] == 0
        assert settled["input"] == {"realNull": None}
        assert settled["failure"]["code"] == "EXECUTOR_NOT_FOUND"

        tracked = TrackingStore(store)
        calls = 0

        def must_not_run(_: NodeContext) -> Any:
            nonlocal calls
            calls += 1
            return "forged"

        resumed = await resume_graph_run(
            graph(),
            {"root": must_not_run},
            run_id="missing-executor-outcome",
            implementation_id="v1",
            event_store=tracked,
        )
        assert resumed == result
        assert calls == 0
        assert tracked.read_calls == 1
        assert tracked.append_calls == 0

    asyncio.run(scenario())


def test_node_settlement_commits_before_a_failed_descendant_is_released() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "settle-before-release", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["root"],
            "outputs": {"result": {"node": "child"}},
            "nodes": [
                {
                    "id": node_id,
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
                for node_id in ("root", "child")
            ],
            "edges": [{"id": "root-child", "from": {"node": "root"}, "to": {"node": "child"}}],
        }
    )

    class GateStore:
        def __init__(self) -> None:
            self.delegate = MemoryEventStore()
            self.root_settle_entered = asyncio.Event()
            self.release_root_settle = asyncio.Event()
            self.appended_node_ids: list[str | None] = []

        async def read(self, run_id: str, from_sequence: int = 0) -> tuple[GraphEvent, ...]:
            return await self.delegate.read(run_id, from_sequence)

        async def append(
            self,
            run_id: str,
            expected_version: int,
            values: Sequence[GraphEvent],
        ) -> int:
            first = values[0]
            if first.type == "NodeSettledWithoutAttempt":
                self.appended_node_ids.append(first.node_id)
            if first.type == "NodeSettledWithoutAttempt" and first.node_id == "root":
                self.root_settle_entered.set()
                await self.release_root_settle.wait()
            return await self.delegate.append(run_id, expected_version, values)

    async def scenario() -> None:
        store = GateStore()
        task = asyncio.create_task(
            start_graph_run(
                compiled,
                {},
                run_id="settle-before-release",
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        )
        await store.root_settle_entered.wait()
        assert store.appended_node_ids == ["root"]
        assert [event.type for event in await store.delegate.read("settle-before-release")] == [
            "RunCreated",
            "RunStarted",
        ]
        store.release_root_settle.set()
        result = await task
        history = await store.delegate.read("settle-before-release")
        outcomes = [event.node_id for event in history if event.type == "NodeSettledWithoutAttempt"]
        assert outcomes == ["root", "child"]
        child_event = next(
            event
            for event in history
            if event.type == "NodeSettledWithoutAttempt" and event.node_id == "child"
        )
        child_document = decode_durable_json(child_event.data["result"])
        assert isinstance(child_document, dict) and "input" not in child_document
        assert result.nodes["child"].attempts == 0

    asyncio.run(scenario())


def test_retry_delay_cancellation_settles_with_the_preserved_attempt_offset() -> None:
    retry_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2, "initialDelayMs": 1000},
            "sideEffects": "none",
        }
    )

    async def scenario() -> None:
        store = MemoryEventStore()
        cancel = asyncio.Event()

        def fail_then_cancel(_: NodeContext) -> Any:
            asyncio.get_running_loop().call_soon(cancel.set)
            raise RuntimeError("retryable")

        result = await start_graph_run(
            retry_graph,
            None,
            {"root": fail_then_cancel},
            run_id="retry-delay-cancel",
            implementation_id="v1",
            event_store=store,
            cancel_event=cancel,
            clock=fixed_clock,
        )
        history = await store.read("retry-delay-cancel")
        settled_event = next(
            event for event in history if event.type == "NodeSettledWithoutAttempt"
        )
        settled = decode_durable_json(settled_event.data["result"])
        assert isinstance(settled, dict)
        assert settled["attempts"] == 1
        assert "input" in settled and settled["input"] is None
        assert settled["failure"]["code"] == "NODE_CANCELLED"
        assert result.total_attempts == 1
        assert result.status is RunStatus.CANCELLED
        assert (
            await resume_graph_run(
                retry_graph,
                run_id="retry-delay-cancel",
                implementation_id="v1",
                event_store=store,
            )
            == result
        )

    asyncio.run(scenario())


def test_start_and_resume_snapshot_handler_registries_before_store_io() -> None:
    class BlockingReadStore:
        def __init__(self, delegate: MemoryEventStore) -> None:
            self.delegate = delegate
            self.read_entered = asyncio.Event()
            self.release_read = asyncio.Event()

        async def read(self, run_id: str, from_sequence: int = 0) -> tuple[GraphEvent, ...]:
            self.read_entered.set()
            await self.release_read.wait()
            return await self.delegate.read(run_id, from_sequence)

        async def append(
            self,
            run_id: str,
            expected_version: int,
            values: Sequence[GraphEvent],
        ) -> int:
            return await self.delegate.append(run_id, expected_version, values)

    async def scenario() -> None:
        start_delegate = MemoryEventStore()
        start_store = BlockingReadStore(start_delegate)
        start_calls: list[str] = []
        registry = {"root": lambda _: start_calls.append("original") or "original"}
        start_task = asyncio.create_task(
            start_graph_run(
                graph(),
                {},
                registry,
                run_id="handler-snapshot-start",
                implementation_id="v1",
                event_store=start_store,
                clock=fixed_clock,
            )
        )
        await start_store.read_entered.wait()
        registry["root"] = lambda _: start_calls.append("replacement") or "replacement"
        start_store.release_read.set()
        started = await start_task
        assert start_calls == ["original"]
        assert dict(started.outputs or {}) == {"result": "original"}

        retry_graph = graph(
            {
                "id": "root",
                "kind": "agent",
                "inputSchema": {},
                "outputSchema": {},
                "config": {},
                "retry": {"maxAttempts": 2},
                "sideEffects": "none",
            }
        )
        resume_delegate = MemoryEventStore()
        with pytest.raises(ProcessLost):
            await start_graph_run(
                retry_graph,
                {},
                {"root": lambda _: (_ for _ in ()).throw(ProcessLost())},
                run_id="handler-snapshot-resume",
                implementation_id="v1",
                event_store=resume_delegate,
                clock=fixed_clock,
            )
        resume_store = BlockingReadStore(resume_delegate)
        resume_calls: list[str] = []
        resume_registry = {"root": lambda _: resume_calls.append("original") or "original"}
        resume_task = asyncio.create_task(
            resume_graph_run(
                retry_graph,
                resume_registry,
                run_id="handler-snapshot-resume",
                implementation_id="v1",
                event_store=resume_store,
                clock=fixed_clock,
            )
        )
        await resume_store.read_entered.wait()
        resume_registry["root"] = lambda _: resume_calls.append("replacement") or "replacement"
        resume_store.release_read.set()
        resumed = await resume_task
        assert resume_calls == ["original"]
        assert dict(resumed.outputs or {}) == {"result": "original"}

    asyncio.run(scenario())


def test_each_attempt_gets_a_fresh_graph_context_and_cannot_corrupt_history() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "attempt-context-isolation", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["root"],
            "outputs": {"result": {"node": "child"}},
            "nodes": [
                {
                    "id": "root",
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {"marker": "root-original"},
                    "retry": {"maxAttempts": 2},
                    "sideEffects": "none",
                },
                {
                    "id": "child",
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {"marker": "child-original"},
                    "sideEffects": "none",
                },
            ],
            "edges": [{"id": "root-child", "from": {"node": "root"}, "to": {"node": "child"}}],
        }
    )

    async def scenario() -> None:
        store = MemoryEventStore()

        def root(context: NodeContext) -> Any:
            assert isinstance(context.node.config, dict)
            assert context.node.config["marker"] == "root-original"
            child_config = context.graph.nodes[1].config
            assert isinstance(child_config, dict)
            child_config["marker"] = "poisoned"
            context.graph.outputs.clear()
            context.node.config["marker"] = "attempt-local"
            if context.attempt == 1:
                raise RuntimeError("retry with a fresh graph")
            return "root-ok"

        def child(context: NodeContext) -> Any:
            assert isinstance(context.node.config, dict)
            assert context.node.config["marker"] == "child-original"
            assert "result" in context.graph.outputs
            return "child-ok"

        result = await start_graph_run(
            compiled,
            {},
            {"root": root, "child": child},
            run_id="attempt-context-isolation",
            implementation_id="v1",
            event_store=store,
            clock=fixed_clock,
        )
        assert result.succeeded
        assert result.nodes["root"].attempts == 2
        assert dict(result.outputs or {}) == {"result": "child-ok"}
        assert (
            await resume_graph_run(
                compiled,
                run_id="attempt-context-isolation",
                implementation_id="v1",
                event_store=store,
            )
            == result
        )

    asyncio.run(scenario())


def test_durable_completion_order_uses_outcome_commit_ordinals() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "commit-order", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["a", "b"],
            "outputs": {"a": {"node": "a"}, "b": {"node": "b"}},
            "nodes": [
                {
                    "id": node_id,
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
                for node_id in ("a", "b")
            ],
            "edges": [],
        }
    )

    class CoordinatedJournal:
        def __init__(self) -> None:
            self.committed: set[str] = set()
            self.both_committed = asyncio.Event()
            self.terminal_completion: tuple[str, ...] | None = None

        async def before_attempt(self, node: Any, node_input: Any, attempt: int) -> Any:
            return _AttemptIdentity("commit-order", f"{node.id}/{attempt}", node.id)

        async def node_succeeded(
            self, node: Any, node_input: Any, attempt: int, output: Any
        ) -> int:
            self.committed.add(node.id)
            if len(self.committed) == 2:
                self.both_committed.set()
            await self.both_committed.wait()
            return 1 if node.id == "b" else 2

        async def attempt_failed(self, *args: Any, **kwargs: Any) -> int:
            raise AssertionError("unexpected attempt failure")

        async def node_settled_without_attempt(self, *args: Any, **kwargs: Any) -> int:
            raise AssertionError("unexpected settlement")

        async def run_terminal(self, result: Any) -> None:
            self.terminal_completion = result.completion_order

    async def scenario() -> None:
        journal = CoordinatedJournal()
        result = await AsyncScheduler({"*": lambda context: context.node.id})._run(
            compiled,
            {},
            journal=journal,
        )
        assert result.completion_order == ("b", "a")
        assert journal.terminal_completion == ("b", "a")

    asyncio.run(scenario())


def test_output_binding_failure_uses_canonical_shape_and_semantic_message_matching() -> None:
    output_graph = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "output-failure-shape", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["root"],
            "outputs": {"answer": {"node": "root", "port": "missing"}},
            "nodes": [
                {
                    "id": "root",
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
            ],
            "edges": [],
        }
    )

    async def scenario() -> None:
        source = MemoryEventStore()
        result = await start_graph_run(
            output_graph,
            {},
            {"root": lambda _: {}},
            run_id="output-failure-shape",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("output-failure-shape"))
        terminal = history[-1]
        document = decode_durable_json(terminal.data["result"])
        assert isinstance(document, dict)
        failures = document["failures"]
        assert isinstance(failures, list) and isinstance(failures[0], dict)
        failure = failures[0]
        assert set(failure) == {
            "phase",
            "code",
            "message",
            "outputName",
            "nodeId",
            "port",
        }
        assert failure["port"] == "missing"
        assert result.failures[-1].output_port == "missing"

        failure["message"] = "Foreign runtime wording is allowed"
        history[-1] = resign(terminal, {"result": encode_durable_json(document)})
        foreign = MemoryEventStore()
        await foreign.append("output-failure-shape", -1, history)
        resumed = await resume_graph_run(
            output_graph,
            run_id="output-failure-shape",
            implementation_id="v1",
            event_store=foreign,
        )
        assert resumed.failures[-1].message == "Foreign runtime wording is allowed"

        del failure["port"]
        history[-1] = resign(terminal, {"result": encode_durable_json(document)})
        missing_port = MemoryEventStore()
        await missing_port.append("output-failure-shape", -1, history)
        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                output_graph,
                run_id="output-failure-shape",
                implementation_id="v1",
                event_store=missing_port,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


@pytest.mark.parametrize("mutation", ["duplicate-event-id", "terminal-node-identity"])
def test_fold_rejects_duplicate_event_ids_and_extraneous_terminal_identity(
    mutation: str,
) -> None:
    async def scenario() -> None:
        source = MemoryEventStore()
        await start_graph_run(
            graph(),
            {},
            {"root": lambda _: "ok"},
            run_id=f"event-identity-{mutation}",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read(f"event-identity-{mutation}"))
        if mutation == "duplicate-event-id":
            history[-1] = history[-1].model_copy(update={"event_id": history[0].event_id})
        else:
            history[-1] = history[-1].model_copy(update={"node_id": "root"})
        forged = MemoryEventStore()
        await forged.append(f"event-identity-{mutation}", -1, history)

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                graph(),
                run_id=f"event-identity-{mutation}",
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_writer_rejects_duplicate_event_ids_before_any_store_write() -> None:
    async def scenario() -> None:
        store = TrackingStore()
        with pytest.raises(DurableRunError) as error:
            await start_graph_run(
                graph(),
                {},
                {"root": lambda _: "ok"},
                run_id="duplicate-writer-id",
                implementation_id="v1",
                event_store=store,
                event_id_factory=lambda _run_id, _sequence: "constant",
                clock=fixed_clock,
            )
        assert error.value.code is DurableRunErrorCode.DURABILITY_STORE_FAILED
        assert store.append_calls == 0
        assert await store.read("duplicate-writer-id") == ()

    asyncio.run(scenario())


def test_resume_writer_rejects_an_event_id_that_collides_with_history() -> None:
    retry_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2},
            "sideEffects": "none",
        }
    )

    async def scenario() -> None:
        delegate = MemoryEventStore()
        with pytest.raises(ProcessLost):
            await start_graph_run(
                retry_graph,
                {},
                {"root": lambda _: (_ for _ in ()).throw(ProcessLost())},
                run_id="resume-id-collision",
                implementation_id="v1",
                event_store=delegate,
                clock=fixed_clock,
            )
        store = TrackingStore(delegate)
        calls = 0

        def handler(_: NodeContext) -> Any:
            nonlocal calls
            calls += 1
            return "must-not-run"

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                retry_graph,
                {"root": handler},
                run_id="resume-id-collision",
                implementation_id="v1",
                event_store=store,
                event_id_factory=lambda _run_id, _sequence: "resume-id-collision:0",
                clock=fixed_clock,
            )
        assert error.value.code is DurableRunErrorCode.DURABILITY_STORE_FAILED
        assert store.append_calls == 0
        assert calls == 0

    asyncio.run(scenario())


def test_retry_timestamp_overflow_is_mapped_and_fatal_latched() -> None:
    retry_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2, "initialDelayMs": 1},
            "sideEffects": "none",
        }
    )

    async def scenario() -> None:
        store = TrackingStore()
        journal = _DurableJournal(
            graph=retry_graph,
            run_id="clock-overflow",
            store=store,
            version=-1,
            clock=lambda: "9999-12-31T23:59:59.999Z",
            event_id_factory=lambda run_id, sequence: f"{run_id}:{sequence}",
        )
        await journal.before_attempt(retry_graph.nodes["root"], {}, 1)
        failure = NodeFailure(
            FailureCode.NODE_EXECUTION_FAILED,
            "retry",
            "root",
            1,
            retryable=True,
        )
        with pytest.raises(DurableRunError) as first:
            await journal.attempt_failed(
                failure,
                will_retry=True,
                retry_delay_ms=1,
            )
        with pytest.raises(DurableRunError) as second:
            await journal.append([_EventDraft("RunStarted", {})])
        assert first.value.code is DurableRunErrorCode.DURABILITY_STORE_FAILED
        assert second.value is first.value
        assert store.append_calls == 1

    asyncio.run(scenario())


def test_terminal_event_cannot_supply_an_uncommitted_node_outcome() -> None:
    async def scenario() -> None:
        source = MemoryEventStore()
        await start_graph_run(
            graph(),
            {},
            run_id="terminal-without-outcome",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("terminal-without-outcome"))
        terminal = history[-1].model_copy(
            update={"sequence": 2, "event_id": "terminal-without-outcome:terminal"}
        )
        forged = MemoryEventStore()
        await forged.append("terminal-without-outcome", -1, (*history[:2], terminal))

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                graph(),
                run_id="terminal-without-outcome",
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_attempt_event_rejects_a_non_attempt_failure_code() -> None:
    async def scenario() -> None:
        source = MemoryEventStore()
        await start_graph_run(
            graph(),
            {},
            {"root": lambda _: (_ for _ in ()).throw(RuntimeError("failed"))},
            run_id="forged-attempt-code",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("forged-attempt-code"))
        index = next(i for i, event in enumerate(history) if event.type == "NodeAttemptFailed")
        data = dict(history[index].data)
        failure = dict(data["failure"])
        failure["code"] = "EXECUTOR_NOT_FOUND"
        data["failure"] = failure
        history[index] = resign(history[index], data)
        forged = MemoryEventStore()
        await forged.append("forged-attempt-code", -1, history)

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                graph(),
                run_id="forged-attempt-code",
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_settled_node_cannot_be_started_again_after_success() -> None:
    async def scenario() -> None:
        source = MemoryEventStore()
        await start_graph_run(
            graph(),
            {},
            {"root": lambda _: "ok"},
            run_id="second-start",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("second-start"))
        started = next(event for event in history if event.type == "NodeStarted")
        terminal = history[-1]
        second_start = forged_event(
            run_id="second-start",
            sequence=terminal.sequence,
            event_type="NodeStarted",
            data=dict(started.data),
            node_id="root",
            attempt=1,
        )
        shifted_terminal = terminal.model_copy(
            update={
                "sequence": terminal.sequence + 1,
                "event_id": "second-start:shifted-terminal",
            }
        )
        forged = MemoryEventStore()
        await forged.append(
            "second-start",
            -1,
            (*history[:-1], second_start, shifted_terminal),
        )

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                graph(),
                run_id="second-start",
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_retry_reservation_cannot_be_consumed_by_restarting_the_old_attempt() -> None:
    retry_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2},
            "sideEffects": "none",
        }
    )

    async def scenario() -> None:
        source = MemoryEventStore()
        calls = 0

        def flaky(_: NodeContext) -> Any:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("retry")
            return "ok"

        await start_graph_run(
            retry_graph,
            {},
            {"root": flaky},
            run_id="old-attempt-restart",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("old-attempt-restart"))
        retry_index = next(i for i, event in enumerate(history) if event.type == "NodeRetried")
        first_started = next(event for event in history if event.type == "NodeStarted")
        forged_old_start = forged_event(
            run_id="old-attempt-restart",
            sequence=retry_index + 1,
            event_type="NodeStarted",
            data=dict(first_started.data),
            node_id="root",
            attempt=1,
        )
        forged = MemoryEventStore()
        await forged.append(
            "old-attempt-restart",
            -1,
            (*history[: retry_index + 1], forged_old_start),
        )

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                retry_graph,
                run_id="old-attempt-restart",
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_downstream_cannot_settle_before_its_upstream_has_an_outcome() -> None:
    compiled = compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "premature-settlement", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["root"],
            "outputs": {"result": {"node": "child"}},
            "nodes": [
                {
                    "id": node_id,
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
                for node_id in ("root", "child")
            ],
            "edges": [{"id": "root-child", "from": {"node": "root"}, "to": {"node": "child"}}],
        }
    )

    async def scenario() -> None:
        source = MemoryEventStore()
        await start_graph_run(
            compiled,
            {},
            run_id="premature-settlement",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("premature-settlement"))
        root = next(
            event
            for event in history
            if event.type == "NodeSettledWithoutAttempt" and event.node_id == "root"
        )
        child = next(
            event
            for event in history
            if event.type == "NodeSettledWithoutAttempt" and event.node_id == "child"
        )
        premature_child = child.model_copy(
            update={"sequence": 2, "event_id": "premature-settlement:child-first"}
        )
        late_root = root.model_copy(
            update={"sequence": 3, "event_id": "premature-settlement:root-second"}
        )
        forged = MemoryEventStore()
        await forged.append(
            "premature-settlement",
            -1,
            (*history[:2], premature_child, late_root),
        )

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                compiled,
                run_id="premature-settlement",
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())


def test_terminal_event_rejects_a_pending_retry_reservation() -> None:
    retry_graph = graph(
        {
            "id": "root",
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "retry": {"maxAttempts": 2},
            "sideEffects": "none",
        }
    )

    async def scenario() -> None:
        source = MemoryEventStore()
        calls = 0

        def flaky(_: NodeContext) -> Any:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("retry")
            return "ok"

        await start_graph_run(
            retry_graph,
            {},
            {"root": flaky},
            run_id="terminal-pending-reservation",
            implementation_id="v1",
            event_store=source,
            clock=fixed_clock,
        )
        history = list(await source.read("terminal-pending-reservation"))
        retry_index = next(i for i, event in enumerate(history) if event.type == "NodeRetried")
        terminal = history[-1].model_copy(
            update={
                "sequence": retry_index + 1,
                "event_id": "terminal-pending-reservation:early-terminal",
            }
        )
        forged = MemoryEventStore()
        await forged.append(
            "terminal-pending-reservation",
            -1,
            (*history[: retry_index + 1], terminal),
        )

        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                retry_graph,
                run_id="terminal-pending-reservation",
                implementation_id="v1",
                event_store=forged,
            )
        assert error.value.code is DurableRunErrorCode.INVALID_RUN_HISTORY

    asyncio.run(scenario())
