from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import time
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any, cast

import pytest

from graph_engineering import canonical_json, compile_graph
from graph_engineering.cycle_contract import (
    CYCLE_EVENT_TYPES,
    CycleErrorCode,
    CycleRuntimeError,
    GraphPatchLimits,
)
from graph_engineering.cycle_controller import (
    CycleCancellation,
    CycleHandlers,
    fork_cycle,
    pause_cycle,
    renew_cycle_lease,
    replay_cycle,
    resolve_cycle_in_doubt_activity,
    resume_cycle,
    start_cycle,
)
from graph_engineering.cycle_faults import (
    CYCLE_ACTIVITY_INTERRUPTION_TRIGGERS,
    CYCLE_ACTIVITY_PHASES,
    CYCLE_DURABLE_FAULT_STAGES,
    CYCLE_FAULT_KINDS,
    CYCLE_OPERATION_INTERRUPTION_BOUNDARIES,
    CYCLE_PUBLIC_OPERATIONS,
    build_cycle_activity_interruption_matrix,
    build_cycle_durable_fault_matrix,
    build_cycle_operation_interruption_matrix,
    cycle_durable_fault_boundary,
)
from graph_engineering.cycle_fold import validate_checkpoint
from graph_engineering.cycle_store import MemoryCycleStore
from graph_engineering.graph_patch import GraphPatchRuntime, PatchAuthority, PatchReservation

ROOT = Path(__file__).resolve().parents[2]
CONFORMANCE = ROOT / "spec" / "conformance"


def request_document(*, max_iterations: int = 1, dry_rounds: int = 2) -> dict[str, Any]:
    manifest = json.loads(
        (CONFORMANCE / "cycle-controller.case.json").read_text(encoding="utf-8")
    )
    document = copy.deepcopy(manifest["validRequests"][0]["document"])
    document["policy"]["maxIterations"] = max_iterations
    document["policy"]["consecutiveDryRounds"] = dry_rounds
    return cast(dict[str, Any], document)


def lease(
    *,
    epoch: int = 1,
    lease_id: str = "lease-1",
    holder_id: str = "python-test",
) -> dict[str, Any]:
    return {
        "leaseId": lease_id,
        "holderId": holder_id,
        "leaseEpoch": epoch,
        "fencingToken": epoch,
        "acquiredAt": "2026-07-26T00:00:00Z",
        "expiresAt": "2026-07-26T00:01:00Z",
    }


def fixed_clock() -> str:
    return "2026-07-26T00:00:00Z"


def resolution_command(
    request: dict[str, Any],
    events: tuple[Any, ...],
    activity_key: str,
    *,
    resolution_id: str = "resolution-1",
    holder_id: str = "operator-1",
) -> dict[str, Any]:
    tail = events[-1]
    return {
        "apiVersion": (
            "graphengineering.reacher-z.github.io/"
            "cycle-in-doubt-resolutions/v1alpha1"
        ),
        "kind": "CycleInDoubtResolution",
        "resolutionId": resolution_id,
        "controllerRunId": request["controllerRunId"],
        "controllerHash": tail.controller_hash,
        "requestHash": tail.request_hash,
        "eventStreamId": request["eventStreamId"],
        "expectedSequence": tail.sequence,
        "expectedHistoryPrefixHash": tail.record_hash,
        "activityKey": activity_key,
        "disposition": "confirmed-applied",
        "evidenceHash": "e" * 64,
        "authoritySnapshot": {
            "principalHash": "1" * 64,
            "grantHash": "2" * 64,
            "policyHash": "3" * 64,
            "leaseHolderHash": hashlib.sha256(holder_id.encode("utf-8")).hexdigest(),
        },
    }


def test_cycle_surface_is_exported_from_the_native_python_package() -> None:
    import graph_engineering as ge

    assert ge.start_cycle is start_cycle
    assert ge.resume_cycle is resume_cycle
    assert ge.replay_cycle is replay_cycle
    assert ge.fork_cycle is fork_cycle
    assert ge.pause_cycle is pause_cycle
    assert ge.renew_cycle_lease is renew_cycle_lease
    assert ge.resolve_cycle_in_doubt_activity is resolve_cycle_in_doubt_activity
    assert ge.MemoryCycleStore is MemoryCycleStore
    assert ge.GraphPatchRuntime is GraphPatchRuntime
    assert ge.CYCLE_EVENT_TYPES is CYCLE_EVENT_TYPES
    assert ge.CYCLE_DURABLE_FAULT_STAGES is CYCLE_DURABLE_FAULT_STAGES
    assert ge.CYCLE_FAULT_KINDS is CYCLE_FAULT_KINDS
    assert ge.CYCLE_ACTIVITY_PHASES is CYCLE_ACTIVITY_PHASES
    assert ge.CYCLE_ACTIVITY_INTERRUPTION_TRIGGERS is CYCLE_ACTIVITY_INTERRUPTION_TRIGGERS
    assert ge.CYCLE_OPERATION_INTERRUPTION_BOUNDARIES is CYCLE_OPERATION_INTERRUPTION_BOUNDARIES
    assert ge.CYCLE_PUBLIC_OPERATIONS is CYCLE_PUBLIC_OPERATIONS
    assert (
        ge.build_cycle_activity_interruption_matrix
        is build_cycle_activity_interruption_matrix
    )
    assert ge.build_cycle_durable_fault_matrix is build_cycle_durable_fault_matrix
    assert (
        ge.build_cycle_operation_interruption_matrix
        is build_cycle_operation_interruption_matrix
    )


def handler_binding(
    activity_id: str,
    *,
    attempts: int = 1,
    cost: int | float = 0,
    side_effects: str = "none",
    timeout_ms: int = 100,
) -> dict[str, Any]:
    return {
        "activityId": activity_id,
        "implementationHash": (activity_id.encode().hex() + "1" * 64)[:64],
        "sideEffects": side_effects,
        "maxAttemptsPerRound": attempts,
        "maxCostUsdPerAttempt": cost,
        "timeoutMs": timeout_ms,
    }


def handlers_for_mode(
    request: dict[str, Any],
    *,
    mode: str,
) -> None:
    request["policy"]["mode"] = mode
    request["policy"].pop("consecutiveDryRounds", None)
    if mode == "while":
        request["activities"]["condition"] = handler_binding("condition")
        request["activities"]["optimizerEvaluator"] = None
    elif mode == "evaluator-optimizer":
        request["activities"]["condition"] = None
        request["activities"]["optimizerEvaluator"] = handler_binding("optimizer-evaluator")


def patch_runtime() -> GraphPatchRuntime:
    graph = compile_graph(
        json.loads((CONFORMANCE / "diamond.graph.json").read_text(encoding="utf-8"))
    )
    return GraphPatchRuntime(
        graph,
        revision_hash_value="a" * 64,
        limits=GraphPatchLimits.model_validate(
            {
                "maxNodes": 100,
                "maxEdges": 200,
                "maxOutputs": 100,
                "maxDepth": 20,
                "maxFanOut": 20,
            }
        ),
        succeeded_nodes=frozenset({"merge"}),
    )


def patch_authority() -> PatchAuthority:
    return PatchAuthority(
        proposer_activity_key="0" * 64,
        principal_hash="2" * 64,
        proposer_grant_hash="3" * 64,
        run_grant_hash="4" * 64,
        tenant_grant_hash="5" * 64,
        deployment_grant_hash="6" * 64,
        effective_grant_hash="7" * 64,
        policy_hash="8" * 64,
        approval_hash=None,
    )


def accepted_patch(runtime: GraphPatchRuntime, patch_id: str = "round-review") -> dict[str, Any]:
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/patches/v1alpha1",
        "kind": "GraphPatch",
        "patchId": patch_id,
        "base": copy.deepcopy(runtime.coordinate),
        "append": {
            "nodes": [
                {
                    "id": "review",
                    "kind": "validator",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
            ],
            "edges": [
                {
                    "id": "merge-review",
                    "from": {"node": "merge"},
                    "to": {"node": "review"},
                    "mode": "value",
                }
            ],
            "outputs": {"reviewResult": {"node": "review"}},
        },
    }


def patch_request(runtime: GraphPatchRuntime, *, max_iterations: int = 1) -> dict[str, Any]:
    request = request_document(max_iterations=max_iterations)
    request["initialGraph"] = copy.deepcopy(runtime.coordinate)
    return request


def fork_request(
    parent: dict[str, Any],
    *,
    parent_sequence: int,
    parent_history_hash: str,
) -> dict[str, Any]:
    child = copy.deepcopy(parent)
    child["controllerRunId"] = "cycle-run-child"
    child["controllerId"] = "auth-discovery-child"
    child["eventStreamId"] = "cycle-run-child.events"
    child["checkpointScope"] = "cycle-run-child.checkpoints"
    child["lineage"] = {
        "origin": "fork",
        "parentControllerRunId": parent["controllerRunId"],
        "parentSequence": parent_sequence,
        "parentHistoryHash": parent_history_hash,
    }
    return child


def test_shared_request_runs_native_until_dry_and_replays_without_dispatch() -> None:
    async def run() -> None:
        store = MemoryCycleStore()
        calls = {"finder": 0, "evaluator": 0}

        def finder(_: object) -> list[object]:
            calls["finder"] += 1
            return []

        def evaluator(_: object) -> list[object]:
            calls["evaluator"] += 1
            return []

        request = request_document(max_iterations=2, dry_rounds=2)
        result = await start_cycle(
            request,
            CycleHandlers(finder=finder, candidate_evaluator=evaluator),
            store=store,
            lease=lease(),
            clock=fixed_clock,
        )

        # The hard iteration bound is simultaneous with convergence and wins by
        # portable precedence, while the convergence observation remains durable.
        assert result.result["exitReason"] == "MAX_ITERATIONS"
        assert calls == {"finder": 2, "evaluator": 2}
        writes = store.append_count

        replayed = await replay_cycle(request["eventStreamId"], store=store)

        assert replayed.result == result.result
        assert store.append_count == writes

    asyncio.run(run())


def test_global_seen_set_is_preserved_across_rounds() -> None:
    async def run() -> None:
        store = MemoryCycleStore()
        batches = iter(
            [
                [
                    {"key": "finding-a", "value": {"round": 1}},
                    {"key": "finding-a", "value": {"round": 1, "duplicate": True}},
                ],
                [{"key": "finding-a", "value": {"round": 2}}],
            ]
        )

        def finder(_: object) -> object:
            return next(batches)

        def evaluator(context: Any) -> list[dict[str, str]]:
            return [
                {"key": candidate["key"], "verdict": "reject"}
                for candidate in context.input["candidates"]
            ]

        request = request_document(max_iterations=2, dry_rounds=1)
        result = await start_cycle(
            request,
            CycleHandlers(finder=finder, candidate_evaluator=evaluator),
            store=store,
            lease=lease(),
            clock=fixed_clock,
        )

        assert result.result["exitReason"] == "MAX_ITERATIONS"
        assert result.result["seenCount"] == 1
        assert result.result["rejectedCount"] == 1
        rounds = cast(
            list[dict[str, Any]],
            [event.data["record"] for event in result.events if event.type == "RoundCommitted"],
        )
        assert rounds[0]["freshKeys"] == ["finding-a"]
        assert rounds[0]["duplicateKeys"] == ["finding-a"]
        assert rounds[1]["freshKeys"] == []
        assert rounds[1]["duplicateKeys"] == ["finding-a"]

    asyncio.run(run())


@pytest.mark.parametrize(
    ("mode", "mode_output", "expected"),
    [
        ("while", False, "CONDITION_FALSE"),
        ("evaluator-optimizer", "accept", "EVALUATOR_ACCEPTED"),
    ],
)
def test_native_while_and_evaluator_optimizer_converge(
    mode: str,
    mode_output: object,
    expected: str,
) -> None:
    async def run() -> None:
        request = request_document(max_iterations=3)
        handlers_for_mode(request, mode=mode)
        mode_calls = 0

        def decide(_: object) -> object:
            nonlocal mode_calls
            mode_calls += 1
            return mode_output

        result = await start_cycle(
            request,
            CycleHandlers(
                finder=lambda _: [],
                candidate_evaluator=lambda _: [],
                condition=decide if mode == "while" else None,
                optimizer_evaluator=(
                    decide if mode == "evaluator-optimizer" else None
                ),
            ),
            store=MemoryCycleStore(),
            lease=lease(),
            clock=fixed_clock,
        )

        assert result.result["exitReason"] == expected
        assert result.result["status"] == "converged"
        assert mode_calls == 1

    asyncio.run(run())


@pytest.mark.parametrize("bound", ["attempts", "cost"])
def test_unsound_first_round_reservation_fails_before_any_dispatch(bound: str) -> None:
    async def run() -> None:
        request = request_document(max_iterations=3)
        expected = "MAX_TOTAL_ATTEMPTS"
        if bound == "attempts":
            request["policy"]["maxTotalAttempts"] = 1
        else:
            request["policy"]["maxCostUsd"] = 0.5
            request["activities"]["finder"]["maxCostUsdPerAttempt"] = 1
            expected = "MAX_COST"
        calls = 0

        def forbidden(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            return []

        result = await start_cycle(
            request,
            CycleHandlers(finder=forbidden, candidate_evaluator=forbidden),
            store=MemoryCycleStore(),
            lease=lease(),
            clock=fixed_clock,
        )

        assert result.result["exitReason"] == expected
        assert calls == 0
        assert not any(event.type == "RoundReserved" for event in result.events)

    asyncio.run(run())


@pytest.mark.parametrize("bound", ["attempts", "cost"])
def test_native_round_plan_never_shrinks_request_bound_retry_envelopes(bound: str) -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        request["activities"]["finder"]["maxAttemptsPerRound"] = 3
        request["activities"]["candidateEvaluator"]["maxAttemptsPerRound"] = 2
        request["activities"]["patchPlanner"]["maxAttemptsPerRound"] = 4
        expected = "MAX_TOTAL_ATTEMPTS"
        if bound == "attempts":
            # One attempt per phase would fit, but the complete 3 + 2 + 4
            # request-bound retry envelope does not.
            request["policy"]["maxTotalAttempts"] = 8
        else:
            request["activities"]["finder"]["maxCostUsdPerAttempt"] = 0.25
            request["activities"]["candidateEvaluator"]["maxCostUsdPerAttempt"] = 0.5
            request["activities"]["patchPlanner"]["maxCostUsdPerAttempt"] = 0.75
            request["policy"]["maxCostUsd"] = 4.5
            expected = "MAX_COST"
        calls = 0

        def forbidden(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            return []

        result = await start_cycle(
            request,
            CycleHandlers(finder=forbidden, candidate_evaluator=forbidden),
            store=MemoryCycleStore(),
            lease=lease(),
            clock=fixed_clock,
        )

        assert result.result["exitReason"] == expected
        assert result.result["attemptsUsed"] == 0
        assert calls == 0
        assert not any(event.type == "RoundReserved" for event in result.events)

    asyncio.run(run())


def test_patch_enabled_round_reserves_planner_then_skips_unrouted_dispatch() -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        request["activities"]["finder"]["maxAttemptsPerRound"] = 2
        request["activities"]["candidateEvaluator"]["maxAttemptsPerRound"] = 3
        request["activities"]["patchPlanner"]["maxAttemptsPerRound"] = 4
        result = await start_cycle(
            request,
            CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
            store=MemoryCycleStore(),
            lease=lease(),
            clock=fixed_clock,
        )

        reserved = next(event for event in result.events if event.type == "RoundReserved")
        assert reserved.data["maximum"] == {
            "attempts": 9,
            "costUsd": 0,
            "dynamicNodes": request["policy"]["maxDynamicNodes"],
        }
        reserved_plan = cast(dict[str, Any], reserved.data["plan"])
        planner_plan = cast(dict[str, Any], reserved_plan["patchPlanner"])
        assert planner_plan["maxAttempts"] == 4
        assert not any(
            event.type == "ActivityStarted"
            and event.data["phase"] == "patch-planner"
            for event in result.events
        )
        release = next(
            event
            for event in result.events
            if event.type == "BudgetReservationReleased"
            and event.data["reason"] == "round-complete"
        )
        assert release.data["released"] == {
            # Finder and evaluator each used one attempt; every unused retry
            # plus the unrouted planner envelope is released atomically.
            "attempts": 7,
            "costUsd": 0,
            "dynamicNodes": request["policy"]["maxDynamicNodes"],
        }

    asyncio.run(run())


def test_deadline_and_pre_cancel_stop_before_round_or_handler() -> None:
    async def deadline_run() -> None:
        request = request_document(max_iterations=3)
        moments = iter(
            [
                "2026-07-26T00:00:00Z",
                "2026-07-26T00:00:00Z",
                "2026-07-26T00:00:01Z",
                "2026-07-26T00:00:01Z",
                "2026-07-26T00:00:01Z",
            ]
        )
        calls = 0

        def forbidden(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            return []

        result = await start_cycle(
            request,
            CycleHandlers(finder=forbidden, candidate_evaluator=forbidden),
            store=MemoryCycleStore(),
            lease=lease(),
            clock=lambda: next(moments),
        )
        assert result.result["exitReason"] == "MAX_DURATION"
        assert calls == 0
        assert not any(event.type == "RoundReserved" for event in result.events)

    async def cancellation_run() -> None:
        cancellation = CycleCancellation()
        cancellation.cancel()
        calls = 0

        def forbidden(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            return []

        result = await start_cycle(
            request_document(max_iterations=3),
            CycleHandlers(finder=forbidden, candidate_evaluator=forbidden),
            store=MemoryCycleStore(),
            lease=lease(),
            cancellation=cancellation,
            clock=fixed_clock,
        )
        assert result.result["exitReason"] == "CANCELLED"
        assert calls == 0

    asyncio.run(deadline_run())
    asyncio.run(cancellation_run())


class HostileOutput(Mapping[str, object]):
    calls = 0

    def __getitem__(self, key: str) -> object:
        del key
        type(self).calls += 1
        raise AssertionError("hostile getter executed")

    def __iter__(self) -> Iterator[str]:
        type(self).calls += 1
        raise AssertionError("hostile iterator executed")

    def __len__(self) -> int:
        type(self).calls += 1
        raise AssertionError("hostile length executed")


def test_hostile_finder_output_fails_once_without_getters_or_downstream_dispatch() -> None:
    async def run() -> None:
        HostileOutput.calls = 0
        evaluator_calls = 0

        def evaluator(_: object) -> list[object]:
            nonlocal evaluator_calls
            evaluator_calls += 1
            return []

        result = await start_cycle(
            request_document(max_iterations=3),
            CycleHandlers(finder=lambda _: HostileOutput(), candidate_evaluator=evaluator),
            store=MemoryCycleStore(),
            lease=lease(),
            clock=fixed_clock,
        )

        assert result.result["exitReason"] == "FAILED"
        assert HostileOutput.calls == 0
        assert evaluator_calls == 0
        assert not any(event.type == "DiscoveryCommitted" for event in result.events)
        failures = [event for event in result.events if event.type == "ActivityFailed"]
        assert len(failures) == 1
        failure = cast(dict[str, Any], failures[0].data["failure"])
        assert failure["code"] == "GE_ACTIVITY_OUTPUT_INVALID"

    asyncio.run(run())


def test_invalid_evaluator_coverage_never_dispatches_a_later_phase() -> None:
    async def run() -> None:
        request = request_document(max_iterations=3)
        handlers_for_mode(request, mode="while")
        condition_calls = 0

        def condition(_: object) -> bool:
            nonlocal condition_calls
            condition_calls += 1
            return True

        result = await start_cycle(
            request,
            CycleHandlers(
                finder=lambda _: [{"key": "a", "value": None}],
                candidate_evaluator=lambda _: [],
                condition=condition,
            ),
            store=MemoryCycleStore(),
            lease=lease(),
            clock=fixed_clock,
        )

        assert result.result["exitReason"] == "FAILED"
        assert result.result["seenCount"] == 1
        assert result.result["unevaluatedCount"] == 1
        assert condition_calls == 0
        assert not any(event.type == "CandidateEvaluationCommitted" for event in result.events)

    asyncio.run(run())


def test_none_activity_retries_with_one_stable_key_and_runtime_derived_cost() -> None:
    async def run() -> None:
        request = request_document(max_iterations=2, dry_rounds=1)
        request["activities"]["finder"]["maxAttemptsPerRound"] = 2
        request["activities"]["finder"]["maxCostUsdPerAttempt"] = 0.25
        calls = 0

        def finder(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("first attempt fails")
            return []

        result = await start_cycle(
            request,
            CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
            store=MemoryCycleStore(),
            lease=lease(),
            clock=fixed_clock,
        )

        starts = [
            event for event in result.events
            if event.type == "ActivityStarted" and event.data["phase"] == "finder"
        ]
        assert result.result["exitReason"] == "DRY"
        assert calls == 2
        assert [event.data["attempt"] for event in starts] == [1, 2]
        assert len({event.data["activityKey"] for event in starts}) == 1
        assert result.result["costUsd"] == 0.5

    asyncio.run(run())


class Crash(BaseException):
    pass


def test_fault_matrix_is_derived_from_all_event_stage_kind_combinations() -> None:
    matrix = build_cycle_durable_fault_matrix()

    assert len(CYCLE_EVENT_TYPES) == 17
    assert len(CYCLE_DURABLE_FAULT_STAGES) == 11
    assert len(CYCLE_FAULT_KINDS) == 5
    assert len(matrix) == 855
    assert len({(entry.event_type, entry.stage, entry.fault_kind) for entry in matrix}) == 855
    for event_type in CYCLE_EVENT_TYPES:
        expected = 55 if event_type == "ControllerTerminated" else 50
        assert sum(entry.event_type == event_type for entry in matrix) == expected
    terminal = [entry.to_dict() for entry in matrix if entry.stage == "terminal-result-delivery"]
    assert terminal == [
        {
            "eventType": "ControllerTerminated",
            "stage": "terminal-result-delivery",
            "faultKind": fault_kind,
            "boundary": "terminal:ControllerTerminated:during-delivery",
            "durability": "terminal-event-committed",
        }
        for fault_kind in CYCLE_FAULT_KINDS
    ]
    with pytest.raises(ValueError, match="unknown cycle-controller event type"):
        cycle_durable_fault_boundary(cast(Any, "Unknown"), "before-event-construction")
    with pytest.raises(ValueError, match="unknown durable fault stage"):
        cycle_durable_fault_boundary("ControllerCreated", cast(Any, "unknown"))


def test_patch_accepted_visibility_fault_campaign_is_closed() -> None:
    stages = {
        "before-event-construction",
        "after-event-construction",
        "after-prospective-fold",
        "before-store-commit",
        "after-store-commit",
        "after-store-return",
        "after-state-update",
    }
    matrix = [
        entry.to_dict()
        for entry in build_cycle_durable_fault_matrix()
        if entry.event_type == "PatchAccepted" and entry.stage in stages
    ]
    canonical = canonical_json(matrix)

    assert len(matrix) == 35
    assert sum(entry["durability"] == "event-not-committed" for entry in matrix) == 20
    assert sum(entry["durability"] == "event-committed" for entry in matrix) == 15
    assert {entry["faultKind"] for entry in matrix} == set(CYCLE_FAULT_KINDS)
    assert len(canonical.encode("utf-8")) == 6249
    assert hashlib.sha256(canonical.encode("utf-8")).hexdigest() == (
        "160ed0853f3da4783f39440b7d3ade46b56a1d83f47248be2cb97a37dc46dfd2"
    )


def test_activity_interruption_matrix_is_closed_and_complete() -> None:
    matrix = build_cycle_activity_interruption_matrix()

    assert len(matrix) == 68
    assert len({entry.id for entry in matrix}) == 68
    assert sum(entry.interruption == "attempt-timeout" for entry in matrix) == 15
    assert sum(entry.trigger == "before-claim" for entry in matrix) == 5
    assert sum(entry.side_effects is None for entry in matrix) == 7
    assert sum(entry.phase == "finder" for entry in matrix) == 14
    assert matrix[0].to_dict() == {
        "id": "before-first-round",
        "interruption": "caller-cancellation",
        "trigger": "before-first-round",
        "phase": None,
        "sideEffects": None,
    }
    assert matrix[-1].id == "finder:repeated-cancellation:none"


def test_operation_interruption_matrix_is_closed_and_complete() -> None:
    matrix = build_cycle_operation_interruption_matrix()

    assert CYCLE_PUBLIC_OPERATIONS == ("pause", "resume", "replay", "fork")
    assert len(matrix) == 25
    assert tuple(entry.boundary for entry in matrix) == CYCLE_OPERATION_INTERRUPTION_BOUNDARIES
    assert len({entry.id for entry in matrix}) == 25
    assert sum(entry.durability == "read-only" for entry in matrix) == 4
    assert sum(entry.durability == "operation-not-committed" for entry in matrix) == 14
    assert sum(entry.outcome == "operation-cancelled" for entry in matrix) == 18
    assert sum(entry.outcome == "controller-cancelled" for entry in matrix) == 3
    assert sum(entry.outcome == "committed-result" for entry in matrix) == 4
    assert matrix[0].to_dict() == {
        "id": "operation:pause:before-read",
        "operation": "pause",
        "boundary": "operation:pause:before-read",
        "durability": "operation-not-committed",
        "outcome": "operation-cancelled",
    }
    assert matrix[-1].to_dict() == {
        "id": "operation:fork:before-return",
        "operation": "fork",
        "boundary": "operation:fork:before-return",
        "durability": "operation-committed",
        "outcome": "committed-result",
    }


@pytest.mark.parametrize(
    ("boundary", "committed"),
    [
        ("event:DiscoveryCommitted:before-construction", False),
        ("event:DiscoveryCommitted:after-construction", False),
        ("event:DiscoveryCommitted:after-fold-before-cas", False),
        ("store:event:DiscoveryCommitted:before-commit", False),
        ("store:event:DiscoveryCommitted:after-commit-before-return", True),
        ("event:DiscoveryCommitted:after-store-before-state", True),
        ("event:DiscoveryCommitted:after-state-before-dispatch", True),
    ],
)
def test_canonical_event_boundary_recovers_without_duplicate_success(
    boundary: str,
    committed: bool,
) -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        fired = False

        def inject(seen: str) -> None:
            nonlocal fired
            if not fired and seen == boundary:
                fired = True
                raise Crash()

        store_boundary = boundary.startswith("store:")
        store = MemoryCycleStore(fault_hook=inject if store_boundary else None)
        finder_calls = 0
        evaluator_calls = 0

        def finder(_: object) -> list[dict[str, object]]:
            nonlocal finder_calls
            finder_calls += 1
            return [{"key": "boundary", "value": True}]

        def evaluator(context: Any) -> list[dict[str, str]]:
            nonlocal evaluator_calls
            evaluator_calls += 1
            return [
                {"key": candidate["key"], "verdict": "accept"}
                for candidate in context.input["candidates"]
            ]

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(finder=finder, candidate_evaluator=evaluator),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=None if store_boundary else inject,
            )
        assert fired
        interrupted = await store.read(request["eventStreamId"])
        assert (interrupted[-1].type == "DiscoveryCommitted") is committed
        assert sum(event.type == "DiscoveryCommitted" for event in interrupted) == int(committed)

        result = await resume_cycle(
            request,
            CycleHandlers(finder=finder, candidate_evaluator=evaluator),
            store=store,
            expected_version=len(interrupted) - 1,
            lease=lease(epoch=2, lease_id="boundary-lease-2"),
            clock=fixed_clock,
        )
        assert result.result["exitReason"] == "MAX_ITERATIONS"
        assert finder_calls == (1 if committed else 2)
        assert evaluator_calls == 1
        terminal = await store.read(request["eventStreamId"])
        assert sum(event.type == "DiscoveryCommitted" for event in terminal) == 1
        replayed = await replay_cycle(request["eventStreamId"], store=store)
        assert replayed.result == result.result

    asyncio.run(run())


@pytest.mark.parametrize(
    ("boundary", "checkpoint_committed"),
    [
        ("checkpoint:ControllerTerminated:before-construction", False),
        ("checkpoint:ControllerTerminated:after-construction-before-save", False),
        ("checkpoint:ControllerTerminated:after-save-before-ack", True),
    ],
)
def test_terminal_checkpoint_boundaries_retain_authoritative_event_truth(
    boundary: str,
    checkpoint_committed: bool,
) -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        store = MemoryCycleStore()
        fired = False
        finder_calls = 0

        def inject(seen: str) -> None:
            nonlocal fired
            if not fired and seen == boundary:
                fired = True
                raise Crash()

        def finder(_: object) -> list[object]:
            nonlocal finder_calls
            finder_calls += 1
            return []

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=inject,
            )
        interrupted = await store.read(request["eventStreamId"])
        assert interrupted[-1].type == "ControllerTerminated"
        checkpoint = await store.load_checkpoint(
            request["checkpointScope"],
            f"{request['controllerRunId']}-terminal",
        )
        assert (checkpoint is not None) is checkpoint_committed
        writes = store.append_count
        resumed = await resume_cycle(
            request,
            CycleHandlers(
                finder=lambda _: (_ for _ in ()).throw(AssertionError("terminal dispatch")),
                candidate_evaluator=lambda _: (_ for _ in ()).throw(
                    AssertionError("terminal dispatch")
                ),
            ),
            store=store,
            expected_version=len(interrupted) - 1,
            lease=lease(epoch=2, lease_id="checkpoint-lease-2"),
            clock=lambda: (_ for _ in ()).throw(AssertionError("terminal clock")),
        )
        assert resumed.result["exitReason"] == "MAX_ITERATIONS"
        assert store.append_count == writes
        assert finder_calls == 1

    asyncio.run(run())


def test_terminal_delivery_process_loss_is_read_only_on_resume() -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        store = MemoryCycleStore()
        finder_calls = 0

        def finder(_: object) -> list[object]:
            nonlocal finder_calls
            finder_calls += 1
            return []

        def lose_delivery(boundary: str) -> None:
            if boundary == "terminal:ControllerTerminated:during-delivery":
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=lose_delivery,
            )
        interrupted = await store.read(request["eventStreamId"])
        assert interrupted[-1].type == "ControllerTerminated"
        writes = store.append_count
        resumed = await resume_cycle(
            request,
            CycleHandlers(
                finder=lambda _: (_ for _ in ()).throw(AssertionError("terminal dispatch")),
                candidate_evaluator=lambda _: (_ for _ in ()).throw(
                    AssertionError("terminal dispatch")
                ),
            ),
            store=store,
            expected_version=len(interrupted) - 1,
            lease=lease(epoch=2, lease_id="delivery-lease-2"),
        )
        assert resumed.result["exitReason"] == "MAX_ITERATIONS"
        assert store.append_count == writes
        assert finder_calls == 1

    asyncio.run(run())


def test_resume_after_discovery_cas_reuses_finder_output_exactly() -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        store = MemoryCycleStore()
        finder_calls = 0
        crashed = False

        def finder(_: object) -> list[dict[str, object]]:
            nonlocal finder_calls
            finder_calls += 1
            return [{"key": "a", "value": None}]

        def evaluator(context: Any) -> list[dict[str, str]]:
            return [
                {"key": item["key"], "verdict": "accept"}
                for item in context.input["candidates"]
            ]

        def crash_once(boundary: str) -> None:
            nonlocal crashed
            if boundary == "event:DiscoveryCommitted:after-cas" and not crashed:
                crashed = True
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(
                    finder=finder,
                    candidate_evaluator=evaluator,
                ),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=crash_once,
            )
        interrupted = await store.read(request["eventStreamId"])
        assert interrupted[-1].type == "DiscoveryCommitted"

        result = await resume_cycle(
            request,
            CycleHandlers(
                finder=finder,
                candidate_evaluator=evaluator,
            ),
            store=store,
            expected_version=len(interrupted) - 1,
            lease=lease(epoch=2, lease_id="lease-2"),
            clock=fixed_clock,
        )

        assert result.result["exitReason"] == "MAX_ITERATIONS"
        assert finder_calls == 1
        assert result.result["acceptedCount"] == 1

    asyncio.run(run())


@pytest.mark.parametrize("side_effects", ["none", "non-idempotent"])
def test_resume_open_activity_honors_idempotency_and_in_doubt(side_effects: str) -> None:
    async def run() -> None:
        request = request_document(max_iterations=3)
        request["activities"]["finder"]["sideEffects"] = side_effects
        request["activities"]["finder"]["maxAttemptsPerRound"] = 2
        store = MemoryCycleStore()
        calls = 0
        crashed = False

        def finder(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            return []

        def crash_once(boundary: str) -> None:
            nonlocal crashed
            if boundary == "event:ActivityStarted:after-cas" and not crashed:
                crashed = True
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=crash_once,
            )
        interrupted = await store.read(request["eventStreamId"])

        if side_effects == "non-idempotent":
            with pytest.raises(CycleRuntimeError) as raised:
                await resume_cycle(
                    request,
                    CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
                    store=store,
                    expected_version=len(interrupted) - 1,
                    lease=lease(epoch=2, lease_id="lease-2"),
                    clock=fixed_clock,
                )
            assert raised.value.code is CycleErrorCode.IN_DOUBT_SIDE_EFFECT
            assert calls == 0
            assert await store.read(request["eventStreamId"]) == interrupted
            replayed = await replay_cycle(
                request["eventStreamId"],
                store=store,
                through_sequence=interrupted[-1].sequence,
            )
            open_round = cast(dict[str, Any], replayed.state["openRound"])
            open_activity = cast(dict[str, Any], open_round["openActivity"])
            assert open_activity["sideEffects"] == "non-idempotent"
        else:
            result = await resume_cycle(
                request,
                CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
                store=store,
                expected_version=len(interrupted) - 1,
                lease=lease(epoch=2, lease_id="lease-2"),
                clock=fixed_clock,
            )
            starts = [
                event for event in result.events
                if event.type == "ActivityStarted" and event.data["phase"] == "finder"
            ]
            first_round = [event for event in starts if event.data["iteration"] == 1]
            assert [event.data["attempt"] for event in first_round] == [1]
            assert calls == len(starts)

    asyncio.run(run())


def test_late_noncooperative_handler_is_charged_but_never_committed() -> None:
    async def run() -> None:
        request = request_document(max_iterations=3)
        request["activities"]["finder"]["timeoutMs"] = 1
        request["activities"]["finder"]["maxCostUsdPerAttempt"] = 0.5

        def late(_: object) -> list[dict[str, object]]:
            time.sleep(0.03)
            return [{"key": "late", "value": None}]

        result = await start_cycle(
            request,
            CycleHandlers(finder=late, candidate_evaluator=lambda _: []),
            store=MemoryCycleStore(),
            lease=lease(),
            clock=fixed_clock,
        )

        assert result.result["exitReason"] == "FAILED"
        assert result.result["costUsd"] == 0.5
        assert result.result["seenCount"] == 0
        assert not any(event.type == "DiscoveryCommitted" for event in result.events)

    asyncio.run(run())


def test_invalid_patch_output_records_failure_without_revision_or_extra_round() -> None:
    async def run() -> None:
        runtime = patch_runtime()
        request = patch_request(runtime, max_iterations=3)
        finder_calls = 0
        planner_calls = 0

        def finder(_: object) -> list[object]:
            nonlocal finder_calls
            finder_calls += 1
            return []

        def planner(_: object) -> dict[str, object]:
            nonlocal planner_calls
            planner_calls += 1
            return {"not": "a GraphPatch"}

        result = await start_cycle(
            request,
            CycleHandlers(
                finder=finder,
                candidate_evaluator=lambda _: [],
                patch_planner=planner,
            ),
            store=MemoryCycleStore(),
            lease=lease(),
            clock=fixed_clock,
            patch_runtime=runtime,
            patch_authority=patch_authority(),
            patch_each_round=True,
        )

        assert result.result["exitReason"] == "FAILED"
        assert finder_calls == 1
        assert planner_calls == 1
        assert runtime.decision_count == 0
        assert runtime.coordinate["graphRevision"] == 1
        assert not any(
            event.type in {"PatchAccepted", "PatchRejected"} for event in result.events
        )

    asyncio.run(run())


def test_patch_acceptance_and_crash_restore_rebuild_full_native_revision() -> None:
    async def run() -> None:
        original = patch_runtime()
        request = patch_request(original)
        store = MemoryCycleStore()
        planner_calls = 0
        crashed = False

        def planner(_: object) -> dict[str, Any]:
            nonlocal planner_calls
            planner_calls += 1
            return accepted_patch(original)

        def crash_once(boundary: str) -> None:
            nonlocal crashed
            if boundary == "event:PatchAccepted:after-cas" and not crashed:
                crashed = True
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(
                    finder=lambda _: [],
                    candidate_evaluator=lambda _: [],
                    patch_planner=planner,
                ),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=crash_once,
                patch_runtime=original,
                patch_authority=patch_authority(),
                patch_each_round=True,
            )
        assert original.coordinate["graphRevision"] == 1
        interrupted = await store.read(request["eventStreamId"])
        assert interrupted[-1].type == "PatchAccepted"

        restored = patch_runtime()
        result = await resume_cycle(
            request,
            CycleHandlers(
                finder=lambda _: (_ for _ in ()).throw(AssertionError("finder reran")),
                candidate_evaluator=lambda _: (_ for _ in ()).throw(
                    AssertionError("evaluator reran")
                ),
                patch_planner=lambda _: (_ for _ in ()).throw(
                    AssertionError("planner reran")
                ),
            ),
            store=store,
            expected_version=len(interrupted) - 1,
            lease=lease(epoch=2, lease_id="lease-2"),
            clock=fixed_clock,
            patch_runtime=restored,
            patch_authority=patch_authority(),
            patch_each_round=True,
        )

        assert planner_calls == 1
        assert restored.coordinate["graphRevision"] == 2
        assert restored.graph.spec.nodes[-1].id == "review"
        assert restored.decision_count == 1
        assert result.result["lastGraphRevision"] == 2
        assert result.result["dynamicNodes"] == 1

        retry = await restored.apply(
            accepted_patch(patch_runtime()),
            authority=patch_authority(),
            policy_snapshot_hash="f" * 64,
            reservation=PatchReservation("ignored-on-exact-retry", 1, 0, 0),
            record=lambda _: (_ for _ in ()).throw(AssertionError("restored retry wrote")),
        )
        assert retry.authority_snapshot["proposerActivityKey"] != "0" * 64
        assert retry.policy_snapshot_hash == "8" * 64
        assert retry.budget_outcome["committed"] == {
            "attempts": 1,
            "costUsd": 0,
            "dynamicNodes": 1,
        }
        assert retry.diagnostics == ()

    asyncio.run(run())


def test_terminal_resume_and_prefix_replay_are_strictly_read_only() -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        store = MemoryCycleStore()
        completed = await start_cycle(
            request,
            CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
            store=store,
            lease=lease(),
            clock=fixed_clock,
        )
        writes = store.append_count
        calls = 0

        def forbidden(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            raise AssertionError("terminal resume dispatched")

        resumed = await resume_cycle(
            request,
            CycleHandlers(finder=forbidden, candidate_evaluator=forbidden),
            store=store,
            expected_version=len(completed.events) - 1,
            lease={"invalid": "terminal path must not inspect this"},
            clock=lambda: (_ for _ in ()).throw(AssertionError("terminal clock read")),
        )
        prefix = await replay_cycle(
            request["eventStreamId"],
            store=store,
            through_sequence=2,
        )

        assert resumed.result == completed.result
        assert prefix.result is None
        assert prefix.terminal is False
        assert prefix.state["nextIteration"] == 2
        assert calls == 0
        assert store.append_count == writes

    asyncio.run(run())


def test_dual_resume_has_one_cas_winner_and_one_dispatch_path() -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        store = MemoryCycleStore()
        crashed = False

        def crash_once(boundary: str) -> None:
            nonlocal crashed
            if boundary == "event:RoundReserved:after-cas" and not crashed:
                crashed = True
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=crash_once,
            )
        interrupted = await store.read(request["eventStreamId"])
        calls = 0

        def finder(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            return []

        async def contender(epoch: int) -> object:
            try:
                return await resume_cycle(
                    request,
                    CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
                    store=store,
                    expected_version=len(interrupted) - 1,
                    lease=lease(epoch=epoch, lease_id=f"lease-{epoch}"),
                    clock=fixed_clock,
                )
            except BaseException as exc:
                return exc

        outcomes = await asyncio.gather(contender(2), contender(3))

        assert sum(not isinstance(item, BaseException) for item in outcomes) == 1
        assert calls == 1
        history = await store.read(request["eventStreamId"])
        assert sum(event.type == "ControllerTerminated" for event in history) == 1

    asyncio.run(run())


def test_rejected_patch_restore_preserves_diagnostics_and_exact_retry() -> None:
    async def run() -> None:
        original = patch_runtime()
        request = patch_request(original, max_iterations=3)
        store = MemoryCycleStore()
        rejected = accepted_patch(original, patch_id="stale-proposal")
        rejected["base"]["revisionHash"] = "f" * 64
        crashed = False

        def crash_once(boundary: str) -> None:
            nonlocal crashed
            if boundary == "event:PatchRejected:after-cas" and not crashed:
                crashed = True
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(
                    finder=lambda _: [],
                    candidate_evaluator=lambda _: [],
                    patch_planner=lambda _: rejected,
                ),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=crash_once,
                patch_runtime=original,
                patch_authority=patch_authority(),
                patch_each_round=True,
            )
        interrupted = await store.read(request["eventStreamId"])
        assert interrupted[-1].type == "PatchRejected"

        restored = patch_runtime()
        result = await resume_cycle(
            request,
            CycleHandlers(
                finder=lambda _: [],
                candidate_evaluator=lambda _: [],
                patch_planner=lambda _: rejected,
            ),
            store=store,
            expected_version=len(interrupted) - 1,
            lease=lease(epoch=2, lease_id="lease-2"),
            clock=fixed_clock,
            patch_runtime=restored,
            patch_authority=patch_authority(),
            patch_each_round=True,
        )

        assert result.result["exitReason"] == "PATCH_REJECTED"
        assert restored.coordinate["graphRevision"] == 1
        assert restored.decision_count == 1
        exact = await restored.apply(
            rejected,
            authority=patch_authority(),
            policy_snapshot_hash="f" * 64,
            reservation=PatchReservation("ignored", 1, 0, 0),
            record=lambda _: (_ for _ in ()).throw(AssertionError("retry wrote")),
        )
        assert exact.outcome == "rejected"
        assert exact.error_code is CycleErrorCode.PATCH_STALE_BASE
        assert exact.diagnostics[0].path == "/base"
        assert exact.authority_snapshot["proposerActivityKey"] != "0" * 64

    asyncio.run(run())


def test_event_identity_store_checkpoint_and_clock_fail_closed() -> None:
    async def event_identity() -> None:
        store = MemoryCycleStore()

        def broken_id(_: str, __: int) -> str:
            raise RuntimeError("identity unavailable")

        with pytest.raises(CycleRuntimeError) as raised:
            await start_cycle(
                request_document(),
                CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                event_id_factory=broken_id,
            )
        assert raised.value.code is CycleErrorCode.STORE_FAILED
        assert store.append_count == 0

    async def store_failure() -> None:
        def fail_inside(boundary: str) -> None:
            if boundary == "store:inside-append-before-commit":
                raise RuntimeError("store unavailable")

        store = MemoryCycleStore(fault_hook=fail_inside)
        with pytest.raises(CycleRuntimeError) as raised:
            await start_cycle(
                request_document(),
                CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
                store=store,
                lease=lease(),
                clock=fixed_clock,
            )
        assert raised.value.code is CycleErrorCode.STORE_FAILED
        assert store.append_count == 0

    async def checkpoint_failure() -> None:
        def fail_checkpoint(boundary: str) -> None:
            if boundary == "checkpoint:before-save":
                raise RuntimeError("cache unavailable")

        store = MemoryCycleStore(fault_hook=fail_checkpoint)
        request = request_document()
        result = await start_cycle(
            request,
            CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
            store=store,
            lease=lease(),
            clock=fixed_clock,
        )
        assert result.checkpoint_warning is not None
        assert result.checkpoint_warning.code is CycleErrorCode.STORE_FAILED
        replayed = await replay_cycle(request["eventStreamId"], store=store)
        assert replayed.result == result.result

    async def clock_rollback() -> None:
        moments = iter(
            [
                "2026-07-26T00:00:01Z",
                "2026-07-26T00:00:01Z",
                "2026-07-26T00:00:00Z",
            ]
        )
        store = MemoryCycleStore()
        calls = 0

        def forbidden(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            return []

        with pytest.raises(CycleRuntimeError) as raised:
            await start_cycle(
                request_document(max_iterations=3),
                CycleHandlers(finder=forbidden, candidate_evaluator=forbidden),
                store=store,
                lease=lease(),
                clock=lambda: next(moments),
            )
        assert raised.value.code is CycleErrorCode.CLOCK_ROLLBACK
        assert calls == 0
        assert store.append_count == 2

    asyncio.run(event_identity())
    asyncio.run(store_failure())
    asyncio.run(checkpoint_failure())
    asyncio.run(clock_rollback())


@pytest.mark.parametrize(
    ("side_effects", "expected_in_doubt"),
    [("none", 0), ("idempotent", 1)],
)
def test_cancellation_racing_output_retains_only_external_claims(
    side_effects: str,
    expected_in_doubt: int,
) -> None:
    async def run() -> None:
        cancellation = CycleCancellation()
        store = MemoryCycleStore()
        request = request_document(max_iterations=3)
        request["activities"]["finder"]["sideEffects"] = side_effects
        request["activities"]["finder"]["maxCostUsdPerAttempt"] = 0.25

        async def finder(_: object) -> list[dict[str, object]]:
            cancellation.cancel()
            return [{"key": "must-not-commit", "value": None}]

        result = await start_cycle(
            request,
            CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
            store=store,
            lease=lease(),
            clock=fixed_clock,
            cancellation=cancellation,
        )

        assert result.result["exitReason"] == "CANCELLED"
        assert result.result["attemptsUsed"] == 1
        assert result.result["costUsd"] == 0.25
        assert result.result["seenCount"] == 0
        assert not any(event.type == "DiscoveryCommitted" for event in result.events)
        assert not any(event.type == "ActivityFailed" for event in result.events)
        replayed = await replay_cycle(request["eventStreamId"], store=store)
        in_doubt = cast(list[dict[str, Any]], replayed.state["inDoubtActivities"])
        assert len(in_doubt) == expected_in_doubt
        if in_doubt:
            assert in_doubt[0]["sideEffects"] == "idempotent"

    asyncio.run(run())


@pytest.mark.parametrize(
    ("side_effects", "expected_attempts", "expected_cost", "expected_in_doubt"),
    [
        ("none", 2, 0.5, 0),
        ("idempotent", 2, 0.5, 1),
        ("non-idempotent", 1, 0.25, 1),
    ],
)
def test_activity_timeout_charging_retry_and_failure_code_are_exact(
    side_effects: str,
    expected_attempts: int,
    expected_cost: float,
    expected_in_doubt: int,
) -> None:
    async def run() -> None:
        store = MemoryCycleStore()
        request = request_document(max_iterations=2)
        finder_binding = request["activities"]["finder"]
        finder_binding["sideEffects"] = side_effects
        finder_binding["maxAttemptsPerRound"] = 2
        finder_binding["maxCostUsdPerAttempt"] = 0.25
        finder_binding["timeoutMs"] = 1
        calls = 0

        async def finder(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            await asyncio.Event().wait()
            return []

        result = await start_cycle(
            request,
            CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
            store=store,
            lease=lease(),
            clock=fixed_clock,
        )
        failures = [event for event in result.events if event.type == "ActivityFailed"]
        replayed = await replay_cycle(request["eventStreamId"], store=store)
        in_doubt = cast(list[dict[str, Any]], replayed.state["inDoubtActivities"])

        assert result.result["exitReason"] == "FAILED"
        assert result.result["status"] == "failed"
        assert result.result["attemptsUsed"] == expected_attempts
        assert result.result["costUsd"] == expected_cost
        assert calls == expected_attempts
        assert len(failures) == expected_attempts
        assert all(
            event.data["failure"]["code"] == "GE_CYCLE_ACTIVITY_TIMEOUT"
            and event.data["usage"]["costUsd"] == 0.25
            for event in failures
        )
        assert len(in_doubt) == expected_in_doubt
        terminal_observation = cast(
            dict[str, Any], replayed.state["terminalObservation"]
        )
        assert terminal_observation["failureCode"] == "GE_CYCLE_ACTIVITY_TIMEOUT"
        assert replayed.result == result.result

    asyncio.run(run())


def test_idempotent_ambiguous_retries_coalesce_and_success_resolves_singleton() -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        request["activities"]["finder"]["sideEffects"] = "idempotent"
        request["activities"]["finder"]["maxAttemptsPerRound"] = 2
        store = MemoryCycleStore()
        calls = 0

        def finder(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise CycleRuntimeError(
                    CycleErrorCode.ACTIVITY_FAILED,
                    "ambiguous idempotent provider result",
                )
            return []

        result = await start_cycle(
            request,
            CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
            store=store,
            lease=lease(),
            clock=fixed_clock,
        )
        replayed = await replay_cycle(request["eventStreamId"], store=store)
        finder_starts = [
            event
            for event in result.events
            if event.type == "ActivityStarted" and event.data["phase"] == "finder"
        ]
        failures = [event for event in result.events if event.type == "ActivityFailed"]

        assert result.result["exitReason"] == "MAX_ITERATIONS"
        assert calls == 2
        assert [event.data["attempt"] for event in finder_starts] == [1, 2]
        assert finder_starts[0].data["activityKey"] == finder_starts[1].data["activityKey"]
        assert failures[0].data["failure"]["inDoubt"] is True
        assert replayed.state["inDoubtActivities"] == []

    asyncio.run(run())


def test_exhausted_idempotent_ambiguity_retains_one_latest_attempt() -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        request["activities"]["finder"]["sideEffects"] = "idempotent"
        request["activities"]["finder"]["maxAttemptsPerRound"] = 2
        store = MemoryCycleStore()
        calls = 0

        def finder(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            raise CycleRuntimeError(
                CycleErrorCode.ACTIVITY_FAILED,
                "ambiguous idempotent provider result",
            )

        result = await start_cycle(
            request,
            CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
            store=store,
            lease=lease(),
            clock=fixed_clock,
        )
        replayed = await replay_cycle(request["eventStreamId"], store=store)
        in_doubt = cast(list[dict[str, Any]], replayed.state["inDoubtActivities"])
        failures = [event for event in result.events if event.type == "ActivityFailed"]

        assert result.result["exitReason"] == "MAX_ITERATIONS"
        assert calls == 2
        assert len(failures) == 2
        assert all(event.data["failure"]["inDoubt"] is True for event in failures)
        assert replayed.state["terminalObservation"]["failed"] is True
        assert replayed.state["terminalObservation"]["failureCode"] == "GE_ACTIVITY_FAILED"
        assert len(in_doubt) == 1
        assert in_doubt[0]["attempt"] == 2
        assert in_doubt[0]["activityKey"] == failures[-1].data["activityKey"]

    asyncio.run(run())


def test_terminal_in_doubt_resolution_is_fenced_idempotent_and_checkpointed() -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        request["activities"]["finder"]["sideEffects"] = "idempotent"
        request["activities"]["finder"]["maxAttemptsPerRound"] = 2
        store = MemoryCycleStore()

        def finder(_: object) -> list[object]:
            raise CycleRuntimeError(
                CycleErrorCode.ACTIVITY_FAILED,
                "ambiguous idempotent provider result",
            )

        terminal = await start_cycle(
            request,
            CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
            store=store,
            lease=lease(),
            clock=fixed_clock,
        )
        terminal_result = copy.deepcopy(terminal.result)
        terminal_events = terminal.events
        replayed = await replay_cycle(request["eventStreamId"], store=store)
        in_doubt = cast(list[dict[str, Any]], replayed.state["inDoubtActivities"])
        assert len(in_doubt) == 1
        command = resolution_command(
            request,
            terminal_events,
            cast(str, in_doubt[0]["activityKey"]),
        )
        initial_appends = store.append_count

        malformed = copy.deepcopy(command)
        malformed["unexpected"] = True
        with pytest.raises(CycleRuntimeError) as invalid_error:
            await resolve_cycle_in_doubt_activity(
                request,
                malformed,
                store=store,
                lease=lease(epoch=2, lease_id="operator-lease-2"),
                clock=fixed_clock,
            )
        assert invalid_error.value.code is CycleErrorCode.RESOLUTION_INVALID
        assert store.append_count == initial_appends

        wrong_target = copy.deepcopy(command)
        wrong_target["activityKey"] = "f" * 64
        with pytest.raises(CycleRuntimeError) as target_error:
            await resolve_cycle_in_doubt_activity(
                request,
                wrong_target,
                store=store,
                lease=lease(
                    epoch=2,
                    lease_id="operator-lease-2",
                    holder_id="operator-1",
                ),
                clock=fixed_clock,
            )
        assert target_error.value.code is CycleErrorCode.RESOLUTION_TARGET_MISMATCH
        assert store.append_count == initial_appends

        stale_tail = copy.deepcopy(command)
        stale_tail["expectedSequence"] -= 1
        with pytest.raises(CycleRuntimeError) as tail_error:
            await resolve_cycle_in_doubt_activity(
                request,
                stale_tail,
                store=store,
                lease=lease(
                    epoch=2,
                    lease_id="operator-lease-2",
                    holder_id="operator-1",
                ),
                clock=fixed_clock,
            )
        assert tail_error.value.code is CycleErrorCode.RESOLUTION_STALE
        assert store.append_count == initial_appends

        with pytest.raises(CycleRuntimeError) as fence_error:
            await resolve_cycle_in_doubt_activity(
                request,
                command,
                store=store,
                lease=lease(
                    epoch=1,
                    lease_id="operator-lease-stale",
                    holder_id="operator-1",
                ),
                clock=fixed_clock,
            )
        assert fence_error.value.code is CycleErrorCode.STALE_LEASE
        assert store.append_count == initial_appends

        with pytest.raises(CycleRuntimeError) as authority_error:
            await resolve_cycle_in_doubt_activity(
                request,
                command,
                store=store,
                lease=lease(
                    epoch=2,
                    lease_id="operator-lease-2",
                    holder_id="attacker",
                ),
                clock=fixed_clock,
            )
        assert authority_error.value.code is CycleErrorCode.RESOLUTION_AUTHORITY_MISMATCH
        assert store.append_count == initial_appends

        resolved = await resolve_cycle_in_doubt_activity(
            request,
            command,
            store=store,
            lease=lease(
                epoch=2,
                lease_id="operator-lease-2",
                holder_id="operator-1",
            ),
            clock=fixed_clock,
            checkpoint_id=f"{request['controllerRunId']}-latest",
        )
        assert resolved.duplicate is False
        assert resolved.event.type == "InDoubtActivityResolved"
        assert resolved.event.data["commandHash"] == resolved.command_hash
        assert resolved.fold.terminal is True
        assert resolved.fold.state["inDoubtActivities"] == []
        assert resolved.fold.terminal_result == terminal_result
        assert store.append_count == initial_appends + 1
        assert store.checkpoint_write_count == 2

        checkpoint_id = f"{request['controllerRunId']}-latest"
        checkpoint = await store.load_checkpoint(request["checkpointScope"], checkpoint_id)
        assert checkpoint is not None
        checkpoint_fold = validate_checkpoint(
            checkpoint,
            await store.read(request["eventStreamId"]),
        )
        assert checkpoint_fold.state["inDoubtActivities"] == []
        assert checkpoint_fold.terminal_result == terminal_result

        duplicate_clock_calls = 0

        def forbidden_clock() -> str:
            nonlocal duplicate_clock_calls
            duplicate_clock_calls += 1
            raise AssertionError("duplicate resolution must not sample the clock")

        duplicate = await resolve_cycle_in_doubt_activity(
            request,
            command,
            store=store,
            lease={"malformed": True},
            clock=forbidden_clock,
            checkpoint_id="must-not-write",
        )
        assert duplicate.duplicate is True
        assert duplicate.event.record_hash == resolved.event.record_hash
        assert duplicate_clock_calls == 0
        assert store.append_count == initial_appends + 1
        assert store.checkpoint_write_count == 2

        changed = copy.deepcopy(command)
        changed["evidenceHash"] = "d" * 64
        with pytest.raises(CycleRuntimeError) as conflict_error:
            await resolve_cycle_in_doubt_activity(
                request,
                changed,
                store=store,
                lease={"malformed": True},
                clock=forbidden_clock,
            )
        assert conflict_error.value.code is CycleErrorCode.RESOLUTION_CONFLICT
        assert duplicate_clock_calls == 0
        assert store.append_count == initial_appends + 1

        resumed = await resume_cycle(
            request,
            CycleHandlers(
                finder=lambda _: (_ for _ in ()).throw(AssertionError("no dispatch")),
                candidate_evaluator=lambda _: (_ for _ in ()).throw(
                    AssertionError("no dispatch")
                ),
            ),
            store=store,
            expected_version=resolved.event.sequence,
            lease={"malformed": True},
            clock=forbidden_clock,
        )
        assert resumed.result == terminal_result
        assert store.append_count == initial_appends + 1

    asyncio.run(run())


def test_in_doubt_resolution_rejects_a_nonterminal_interrupted_claim() -> None:
    async def run() -> None:
        request = request_document(max_iterations=2)
        request["activities"]["finder"]["sideEffects"] = "idempotent"
        store = MemoryCycleStore()

        def crash_after_claim(boundary: str) -> None:
            if boundary == "event:ActivityStarted:after-cas":
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=crash_after_claim,
            )
        interrupted = await store.read(request["eventStreamId"])
        replayed = await replay_cycle(
            request["eventStreamId"],
            store=store,
            through_sequence=interrupted[-1].sequence,
        )
        open_round = cast(dict[str, Any], replayed.state["openRound"])
        open_activity = cast(dict[str, Any], open_round["openActivity"])
        command = resolution_command(
            request,
            interrupted,
            cast(str, open_activity["activityKey"]),
        )
        initial_appends = store.append_count

        with pytest.raises(CycleRuntimeError) as raised:
            await resolve_cycle_in_doubt_activity(
                request,
                command,
                store=store,
                lease=lease(
                    epoch=2,
                    lease_id="operator-lease-2",
                    holder_id="operator-1",
                ),
                clock=fixed_clock,
            )
        assert raised.value.code is CycleErrorCode.RESOLUTION_NOT_TERMINAL
        assert store.append_count == initial_appends
        assert await store.read(request["eventStreamId"]) == interrupted

    asyncio.run(run())


def test_pause_handoff_and_stale_fence_are_zero_dispatch_operations() -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        checkpoint_failures = 0

        def fail_first_checkpoint(boundary: str) -> None:
            nonlocal checkpoint_failures
            if boundary == "checkpoint:before-save" and checkpoint_failures == 0:
                checkpoint_failures += 1
                raise RuntimeError("checkpoint cache unavailable")

        store = MemoryCycleStore(fault_hook=fail_first_checkpoint)
        crashed = False

        def crash_once(boundary: str) -> None:
            nonlocal crashed
            if boundary == "event:RoundReserved:after-cas" and not crashed:
                crashed = True
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
                store=store,
                lease=lease(epoch=5, lease_id="lease-5"),
                clock=fixed_clock,
                fault_hook=crash_once,
            )
        interrupted = await store.read(request["eventStreamId"])
        extended_lease = {
            **lease(epoch=5, lease_id="lease-5"),
            "expiresAt": "2026-07-26T00:02:00Z",
        }
        administration_clock_calls = 0

        def administration_clock() -> str:
            nonlocal administration_clock_calls
            administration_clock_calls += 1
            return fixed_clock()

        renewed = await renew_cycle_lease(
            request,
            store=store,
            expected_version=len(interrupted) - 1,
            lease=extended_lease,
            clock=administration_clock,
        )
        assert renewed.event.type == "LeaseRenewed"
        assert renewed.event.data == {
            "previousExpiresAt": "2026-07-26T00:01:00Z",
            "newExpiresAt": "2026-07-26T00:02:00Z",
        }
        assert renewed.fold.active_lease == extended_lease
        assert renewed.checkpoint_warning is not None
        assert renewed.checkpoint_warning.code is CycleErrorCode.STORE_FAILED
        assert checkpoint_failures == 1
        appends_after_renew = store.append_count
        with pytest.raises(CycleRuntimeError) as wrong_holder:
            await renew_cycle_lease(
                request,
                store=store,
                expected_version=renewed.event.sequence,
                lease={**extended_lease, "holderId": "different-holder"},
                clock=administration_clock,
            )
        assert wrong_holder.value.code is CycleErrorCode.LEASE_CONFLICT
        with pytest.raises(CycleRuntimeError) as no_extension:
            await renew_cycle_lease(
                request,
                store=store,
                expected_version=renewed.event.sequence,
                lease=extended_lease,
                clock=administration_clock,
            )
        assert no_extension.value.code is CycleErrorCode.STALE_LEASE
        assert store.append_count == appends_after_renew
        assert administration_clock_calls == 1
        with pytest.raises(CycleRuntimeError) as stale_pause:
            await pause_cycle(
                request,
                store=store,
                expected_version=len(interrupted) - 1,
                reason="handoff",
                clock=administration_clock,
            )
        assert stale_pause.value.code is CycleErrorCode.VERSION_CONFLICT
        paused = await pause_cycle(
            request,
            store=store,
            expected_version=renewed.event.sequence,
            reason="handoff",
            clock=administration_clock,
        )
        assert paused.event.type == "LeaseReleased"
        assert paused.event.lease is not None
        assert paused.event.lease.expires_at == "2026-07-26T00:02:00Z"
        assert paused.fold.active_lease is None
        assert paused.checkpoint_warning is None
        assert administration_clock_calls == 2
        checkpoint = await store.load_checkpoint(
            request["checkpointScope"],
            f"{request['controllerRunId']}-latest",
        )
        assert checkpoint is not None
        assert checkpoint["lastSequence"] == paused.event.sequence
        assert checkpoint["lease"] is None
        calls = 0

        def finder(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            return []

        writes = store.append_count
        with pytest.raises(CycleRuntimeError) as stale:
            await resume_cycle(
                request,
                CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
                store=store,
                expected_version=len(paused.events) - 1,
                lease=lease(epoch=5, lease_id="stale-lease"),
                clock=fixed_clock,
            )
        assert stale.value.code is CycleErrorCode.STALE_LEASE
        assert calls == 0
        assert store.append_count == writes

        result = await resume_cycle(
            request,
            CycleHandlers(finder=finder, candidate_evaluator=lambda _: []),
            store=store,
            expected_version=len(paused.events) - 1,
            lease=lease(epoch=6, lease_id="lease-6"),
            clock=fixed_clock,
        )
        assert result.result["exitReason"] == "MAX_ITERATIONS"
        assert calls == 1
        leases = [event for event in result.events if event.type == "LeaseAcquired"]
        assert leases[-1].data == {"reason": "resume", "previousLeaseId": "lease-5"}

    asyncio.run(run())


def test_concurrent_lease_administration_commits_exactly_one_cas_winner() -> None:
    async def run() -> None:
        request = request_document(max_iterations=1)
        store = MemoryCycleStore()
        initial_lease = lease(epoch=7, lease_id="lease-race-7")
        crashed = False

        def stop_before_dispatch(boundary: str) -> None:
            nonlocal crashed
            if boundary == "event:RoundReserved:after-cas" and not crashed:
                crashed = True
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                request,
                CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
                store=store,
                lease=initial_lease,
                clock=fixed_clock,
                fault_hook=stop_before_dispatch,
            )
        before = await store.read(request["eventStreamId"])
        expected_version = before[-1].sequence
        arrivals = 0
        gate = asyncio.Event()

        async def race_at_cas(boundary: str) -> None:
            nonlocal arrivals
            if boundary not in {
                "event:LeaseRenewed:before-cas",
                "event:LeaseReleased:before-cas",
            }:
                return
            arrivals += 1
            if arrivals == 2:
                gate.set()
            await gate.wait()

        outcomes = await asyncio.gather(
            renew_cycle_lease(
                request,
                store=store,
                expected_version=expected_version,
                lease={**initial_lease, "expiresAt": "2026-07-26T00:02:00Z"},
                clock=fixed_clock,
                fault_hook=race_at_cas,
            ),
            pause_cycle(
                request,
                store=store,
                expected_version=expected_version,
                reason="handoff",
                clock=fixed_clock,
                fault_hook=race_at_cas,
            ),
            return_exceptions=True,
        )
        failures = [outcome for outcome in outcomes if isinstance(outcome, BaseException)]
        assert len(failures) == 1
        assert isinstance(failures[0], CycleRuntimeError)
        assert failures[0].code is CycleErrorCode.VERSION_CONFLICT
        after = await store.read(request["eventStreamId"])
        assert len(after) == len(before) + 1
        assert sum(
            event.type in {"LeaseRenewed", "LeaseReleased"} for event in after
        ) == 1

    asyncio.run(run())


def test_fork_binds_exact_prefix_inherits_seen_and_diverges_independently() -> None:
    async def run() -> None:
        parent = request_document(max_iterations=3)
        store = MemoryCycleStore()
        crashed = False

        def crash_once(boundary: str) -> None:
            nonlocal crashed
            if boundary == "event:DiscoveryCommitted:after-cas" and not crashed:
                crashed = True
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                parent,
                CycleHandlers(
                    finder=lambda _: [{"key": "finding-a", "value": {"parent": True}}],
                    candidate_evaluator=lambda _: [],
                ),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=crash_once,
            )
        parent_prefix = await store.read(parent["eventStreamId"])
        parent_tail = parent_prefix[-1]
        child = fork_request(
            parent,
            parent_sequence=parent_tail.sequence,
            parent_history_hash=parent_tail.record_hash,
        )
        child["policy"]["maxIterations"] = 2
        child_calls = 0

        def child_finder(_: object) -> list[dict[str, object]]:
            nonlocal child_calls
            child_calls += 1
            return [{"key": "finding-a", "value": {"child": True}}]

        result = await fork_cycle(
            child,
            CycleHandlers(finder=child_finder, candidate_evaluator=lambda _: []),
            store=store,
            lease=lease(lease_id="child-lease"),
            parent_controller_run_id=parent["controllerRunId"],
            parent_sequence=parent_tail.sequence,
            parent_history_hash=parent_tail.record_hash,
            clock=fixed_clock,
        )

        assert result.result["exitReason"] == "MAX_ITERATIONS"
        assert result.result["seenCount"] == 1
        assert child_calls == 1
        child_round = next(
            cast(dict[str, Any], event.data["record"])
            for event in result.events
            if event.type == "RoundCommitted"
        )
        assert child_round["iteration"] == 2
        assert child_round["freshKeys"] == []
        assert child_round["duplicateKeys"] == ["finding-a"]
        replayed = await replay_cycle(child["eventStreamId"], store=store)
        assert replayed.state["seenKeys"] == ["finding-a"]
        assert await store.read(parent["eventStreamId"]) == parent_prefix

    asyncio.run(run())


def test_fork_rejects_parent_hash_substitution_before_child_write() -> None:
    async def run() -> None:
        parent = request_document(max_iterations=1)
        store = MemoryCycleStore()
        completed = await start_cycle(
            parent,
            CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
            store=store,
            lease=lease(),
            clock=fixed_clock,
        )
        parent_tail = completed.events[-1]
        child = fork_request(
            parent,
            parent_sequence=parent_tail.sequence,
            parent_history_hash="f" * 64,
        )

        with pytest.raises(CycleRuntimeError) as raised:
            await fork_cycle(
                child,
                CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
                store=store,
                lease=lease(lease_id="child-lease"),
                parent_controller_run_id=parent["controllerRunId"],
                parent_sequence=parent_tail.sequence,
                parent_history_hash="f" * 64,
                clock=fixed_clock,
            )

        assert raised.value.code is CycleErrorCode.INVALID_HISTORY
        assert await store.read(child["eventStreamId"]) == ()

    asyncio.run(run())


@pytest.mark.parametrize("side_effects", ["idempotent", "non-idempotent"])
def test_fork_open_external_claim_is_in_doubt_without_dispatch(side_effects: str) -> None:
    async def run() -> None:
        parent = request_document(max_iterations=3)
        parent["activities"]["finder"]["sideEffects"] = side_effects
        parent["activities"]["finder"]["maxCostUsdPerAttempt"] = 0.75
        store = MemoryCycleStore()
        crashed = False

        def crash_once(boundary: str) -> None:
            nonlocal crashed
            if boundary == "event:ActivityStarted:after-cas" and not crashed:
                crashed = True
                raise Crash()

        with pytest.raises(Crash):
            await start_cycle(
                parent,
                CycleHandlers(finder=lambda _: [], candidate_evaluator=lambda _: []),
                store=store,
                lease=lease(),
                clock=fixed_clock,
                fault_hook=crash_once,
            )
        parent_prefix = await store.read(parent["eventStreamId"])
        tail = parent_prefix[-1]
        child = fork_request(
            parent,
            parent_sequence=tail.sequence,
            parent_history_hash=tail.record_hash,
        )
        calls = 0

        def forbidden(_: object) -> list[object]:
            nonlocal calls
            calls += 1
            raise AssertionError("fork dispatched an inherited in-doubt activity")

        with pytest.raises(CycleRuntimeError) as raised:
            await fork_cycle(
                child,
                CycleHandlers(finder=forbidden, candidate_evaluator=forbidden),
                store=store,
                lease=lease(lease_id="child-lease"),
                parent_controller_run_id=parent["controllerRunId"],
                parent_sequence=tail.sequence,
                parent_history_hash=tail.record_hash,
                clock=fixed_clock,
            )

        assert raised.value.code is CycleErrorCode.IN_DOUBT_SIDE_EFFECT
        assert calls == 0
        child_events = await store.read(child["eventStreamId"])
        assert [event.type for event in child_events] == ["ControllerCreated"]
        replayed = await replay_cycle(
            child["eventStreamId"],
            store=store,
            through_sequence=child_events[-1].sequence,
        )
        in_doubt = cast(list[dict[str, Any]], replayed.state["inDoubtActivities"])
        assert len(in_doubt) == 1
        assert in_doubt[0]["sideEffects"] == side_effects
        assert replayed.state["attemptsUsed"] == 0
        assert replayed.state["costUsd"] == 0

    asyncio.run(run())
