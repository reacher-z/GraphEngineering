"""Emit exact native-Python H03C PatchAccepted visibility fault evidence."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, cast

from graph_engineering import (
    CycleActivityContext,
    CycleHandlers,
    GraphPatchLimits,
    GraphPatchRuntime,
    MemoryCycleStore,
    PatchAuthority,
    build_cycle_checkpoint,
    build_cycle_durable_fault_matrix,
    canonical_json,
    compile_graph,
    fold_cycle_events,
    replay_cycle,
    resume_cycle,
    start_cycle,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"
STARTED_AT = "2026-07-26T12:00:00.000Z"
CHECKPOINT_AT = "2026-07-26T12:00:01.000Z"

FAULT_SIGNALS = {
    "process-loss": "coordinator-process-lost",
    "store-error": "durable-store-error",
    "timeout": "operation-deadline-exceeded",
    "cancellation": "operation-cancelled",
    "commit-then-throw": "commit-acknowledgement-lost",
}


class PatchVisibilityFault(BaseException):
    """Uncatchable-by-runtime deterministic campaign interruption."""

    def __init__(self, fault_kind: str) -> None:
        self.fault_kind = fault_kind
        self.signal = FAULT_SIGNALS[fault_kind]
        super().__init__(self.signal)


class PatchVisibilitySeedStop(BaseException):
    pass


def _binding(phase: str, side_effects: str = "none") -> dict[str, Any]:
    digit = "1" if phase == "finder" else "2" if phase == "candidate-evaluator" else "5"
    return {
        "activityId": phase,
        "implementationHash": digit * 64,
        "sideEffects": side_effects,
        "maxAttemptsPerRound": 1,
        "maxCostUsdPerAttempt": 0,
        "timeoutMs": 100,
    }


def _configure_request(
    base: dict[str, Any],
    graph_hash: str,
    index: int,
) -> dict[str, Any]:
    request = copy.deepcopy(base)
    suffix = f"{index:03d}"
    request.update(
        {
            "controllerRunId": f"cycle-patch-visibility-{suffix}",
            "controllerId": f"cycle-patch-visibility-{suffix}-controller",
            "hostRun": {
                "relationship": "standalone-child-controller",
                "runId": f"cycle-patch-visibility-{suffix}-host",
            },
            "eventStreamId": f"cycle-patch-visibility-{suffix}.events",
            "checkpointScope": f"cycle-patch-visibility-{suffix}.checkpoints",
            "initialGraph": {
                "graphRevision": 1,
                "graphHash": graph_hash,
                "revisionHash": "1" * 64,
            },
        }
    )
    request["policy"].update(
        {
            "mode": "until-dry",
            "consecutiveDryRounds": 2,
            "maxIterations": 1,
            "maxDurationMs": 10_000,
            "maxCostUsd": 10,
            "maxTotalAttempts": 10,
            "maxDiscoveries": 10,
            "maxDynamicNodes": 2,
            "maxCandidatesPerRound": 10,
            "maxCandidateBytes": 4_096,
            "maxCandidateBatchBytes": 16_384,
        }
    )
    request["activities"] = {
        "finder": _binding("finder"),
        "candidateEvaluator": _binding("candidate-evaluator"),
        "condition": None,
        "optimizerEvaluator": None,
        "patchPlanner": _binding("patch-planner", "idempotent"),
    }
    request["patches"] = {
        "enabled": True,
        "limits": {
            "maxNodes": 100,
            "maxEdges": 200,
            "maxOutputs": 100,
            "maxDepth": 20,
            "maxFanOut": 20,
        },
    }
    return request


def _lease(run_id: str, epoch: int) -> dict[str, Any]:
    return {
        "leaseId": f"{run_id}-lease-{epoch}",
        "holderId": f"cycle-patch-visibility-holder-{epoch}",
        "leaseEpoch": epoch,
        "fencingToken": epoch,
        "acquiredAt": STARTED_AT,
        "expiresAt": f"2026-07-26T12:0{epoch}:00.000Z",
    }


def _authority() -> PatchAuthority:
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


def _patch_runtime(
    graph_document: dict[str, Any],
    request: dict[str, Any],
) -> GraphPatchRuntime:
    return GraphPatchRuntime(
        compile_graph(graph_document),
        revision_hash_value="1" * 64,
        limits=GraphPatchLimits.model_validate(request["patches"]["limits"]),
        succeeded_nodes=frozenset({"merge"}),
    )


def _patch_output(context: CycleActivityContext, index: int) -> dict[str, Any]:
    suffix = f"{index:03d}"
    node_id = f"patch-visibility-review-{suffix}"
    current = cast(dict[str, Any], context.input)["currentRevision"]
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/patches/v1alpha1",
        "kind": "GraphPatch",
        "patchId": f"cycle-patch-visibility-patch-{suffix}",
        "base": current,
        "append": {
            "nodes": [
                {
                    "id": node_id,
                    "kind": "validator",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
            ],
            "edges": [
                {
                    "id": f"patch-visibility-edge-{suffix}",
                    "from": {"node": "merge"},
                    "to": {"node": node_id},
                    "mode": "value",
                }
            ],
            "outputs": {
                f"patchVisibilityReview{suffix}": {"node": node_id},
            },
        },
    }


def _event_document(event: Any) -> dict[str, Any]:
    return cast(dict[str, Any], event.model_dump(mode="json", by_alias=True))


async def _exercise_entry(
    *,
    graph_document: dict[str, Any],
    graph_hash: str,
    base_request: dict[str, Any],
    fixture: dict[str, Any],
    entry: dict[str, Any],
    index: int,
) -> dict[str, Any]:
    request = _configure_request(base_request, graph_hash, index)
    checkpoint_interval = cast(
        int | None,
        fixture["linearization"].get("checkpointEveryEvents"),
    )
    checkpoint_id = (
        f"{request['controllerRunId']}"
        f"{fixture['linearization'].get('checkpointIdSuffix', '-latest')}"
    )
    target_fired = False

    def target_hook(boundary: str) -> None:
        nonlocal target_fired
        if not target_fired and boundary == entry["boundary"]:
            target_fired = True
            raise PatchVisibilityFault(cast(str, entry["faultKind"]))

    store = MemoryCycleStore(fault_hook=target_hook)
    seed_finder_calls = 0
    seed_evaluator_calls = 0

    def seed_finder(_: object) -> list[object]:
        nonlocal seed_finder_calls
        seed_finder_calls += 1
        return []

    def seed_evaluator(_: object) -> list[object]:
        nonlocal seed_evaluator_calls
        seed_evaluator_calls += 1
        return []

    def seed_hook(boundary: str) -> None:
        target_hook(boundary)
        if boundary == fixture["seedBoundary"]:
            raise PatchVisibilitySeedStop()

    try:
        await start_cycle(
            request,
            CycleHandlers(
                finder=seed_finder,
                candidate_evaluator=seed_evaluator,
                patch_planner=lambda _: (_ for _ in ()).throw(
                    AssertionError("patch-visibility seed dispatched the planner")
                ),
            ),
            store=store,
            lease=_lease(cast(str, request["controllerRunId"]), 1),
            clock=lambda: STARTED_AT,
            fault_hook=seed_hook,
            patch_runtime=_patch_runtime(graph_document, request),
            patch_authority=_authority(),
            patch_each_round=True,
            checkpoint_every_events=checkpoint_interval,
        )
    except PatchVisibilitySeedStop:
        pass
    else:
        raise AssertionError("patch-visibility seed did not stop before planner dispatch")
    assert seed_finder_calls == 1
    assert seed_evaluator_calls == 1
    seed_events = await store.read(cast(str, request["eventStreamId"]))
    assert seed_events[-1].type == "ModeOutcomeCommitted"
    assert not any(event.type == "PatchAccepted" for event in seed_events)

    planner_calls = 0
    planner_keys: list[str] = []
    forbidden_calls = {"finder": 0, "evaluator": 0}

    def forbidden_finder(_: object) -> object:
        forbidden_calls["finder"] += 1
        raise AssertionError("patch-visibility recovery reran finder")

    def forbidden_evaluator(_: object) -> object:
        forbidden_calls["evaluator"] += 1
        raise AssertionError("patch-visibility recovery reran evaluator")

    def planner(context: CycleActivityContext) -> dict[str, Any]:
        nonlocal planner_calls
        planner_calls += 1
        planner_keys.append(context.activity_key)
        return _patch_output(context, index)

    handlers = CycleHandlers(
        finder=forbidden_finder,
        candidate_evaluator=forbidden_evaluator,
        patch_planner=planner,
    )
    first_runtime = _patch_runtime(graph_document, request)
    try:
        await resume_cycle(
            request,
            handlers,
            store=store,
            expected_version=len(seed_events) - 1,
            lease=_lease(cast(str, request["controllerRunId"]), 2),
            clock=lambda: STARTED_AT,
            fault_hook=target_hook,
            patch_runtime=first_runtime,
            patch_authority=_authority(),
            patch_each_round=True,
            checkpoint_id=checkpoint_id if checkpoint_interval is not None else None,
            checkpoint_every_events=checkpoint_interval,
        )
    except PatchVisibilityFault as exc:
        assert exc.fault_kind == entry["faultKind"]
        observed_fault_signal = exc.signal
    else:
        raise AssertionError(f"{entry['stage']}/{entry['faultKind']} did not fire")
    assert target_fired
    assert observed_fault_signal == FAULT_SIGNALS[entry["faultKind"]]
    assert planner_calls == 1
    assert forbidden_calls == {"finder": 0, "evaluator": 0}
    assert first_runtime.coordinate["graphRevision"] == fixture["linearization"][
        "initialGraphRevision"
    ]

    interrupted = await store.read(cast(str, request["eventStreamId"]))
    interrupted_fold = fold_cycle_events(interrupted)
    expected_committed = entry["durability"] != "event-not-committed"
    target_at_fault = next(
        (event for event in interrupted if event.type == "PatchAccepted"),
        None,
    )
    assert sum(event.type == "PatchAccepted" for event in interrupted) == int(
        expected_committed
    )
    assert (target_at_fault is not None) is expected_committed
    assert interrupted_fold.current_revision["graphRevision"] == (
        fixture["linearization"]["acceptedGraphRevision"]
        if expected_committed
        else fixture["linearization"]["initialGraphRevision"]
    )
    checkpoint_writes_at_fault = store.checkpoint_write_count
    checkpoint_at_fault = (
        None
        if checkpoint_interval is None
        else await store.load_checkpoint(
            cast(str, request["checkpointScope"]),
            checkpoint_id,
        )
    )
    if checkpoint_interval is not None:
        assert checkpoint_at_fault is not None
        assert target_at_fault is not None
        expected_lag = fixture["linearization"]["checkpointLagEvents"][entry["stage"]]
        checkpoint_last_sequence = cast(int, checkpoint_at_fault["lastSequence"])
        assert target_at_fault.sequence - checkpoint_last_sequence == expected_lag
        assert checkpoint_at_fault["historyPrefixHash"] == interrupted[
            checkpoint_last_sequence
        ].record_hash
        assert (entry["durability"] == "event-and-checkpoint-committed") is (
            expected_lag == 0
        )

    recovered_runtime = _patch_runtime(graph_document, request)
    result = await resume_cycle(
        request,
        handlers,
        store=store,
        expected_version=len(interrupted) - 1,
        lease=_lease(cast(str, request["controllerRunId"]), 3),
        clock=lambda: STARTED_AT,
        patch_runtime=recovered_runtime,
        patch_authority=_authority(),
        patch_each_round=True,
        checkpoint_id=checkpoint_id if checkpoint_interval is not None else None,
        checkpoint_every_events=checkpoint_interval,
    )
    expected_planner_calls = fixture["linearization"][
        "committedPlannerCalls" if expected_committed else "preCommitPlannerCalls"
    ]
    assert planner_calls == expected_planner_calls
    assert len(set(planner_keys)) == 1
    assert forbidden_calls == {"finder": 0, "evaluator": 0}
    assert result.result["exitReason"] == "MAX_ITERATIONS", (
        entry,
        result.result,
    )
    assert result.result["lastGraphRevision"] == fixture["linearization"][
        "acceptedGraphRevision"
    ]
    assert result.result["dynamicNodes"] == fixture["linearization"][
        "acceptedDynamicNodes"
    ]
    assert recovered_runtime.coordinate["graphRevision"] == fixture["linearization"][
        "acceptedGraphRevision"
    ]
    assert recovered_runtime.graph.spec.nodes[-1].id == f"patch-visibility-review-{index:03d}"

    final_events = await store.read(cast(str, request["eventStreamId"]))
    final_fold = fold_cycle_events(final_events, require_terminal=True)
    accepted = [event for event in final_events if event.type == "PatchAccepted"]
    patch_starts = [
        event
        for event in final_events
        if event.type == "ActivityStarted" and event.data["phase"] == "patch-planner"
    ]
    patch_settlements = [
        event
        for event in final_events
        if event.type == "BudgetReservationSettled"
        and event.data["phase"] == "patch-planner"
    ]
    assert len(accepted) == 1
    assert len(patch_starts) == 1
    assert len(patch_settlements) == 1
    assert sum(event.type == "RoundCommitted" for event in final_events) == 1
    assert sum(event.type == "ControllerTerminated" for event in final_events) == 1
    assert accepted[0].data["plannerActivityKey"] == patch_starts[0].data["activityKey"]
    assert patch_settlements[0].data["committed"] == {
        "attempts": 1,
        "costUsd": 0,
        "dynamicNodes": fixture["linearization"]["acceptedDynamicNodes"],
    }
    assert final_fold.current_revision["graphRevision"] == fixture["linearization"][
        "acceptedGraphRevision"
    ]

    appends_before_replay = store.append_count
    checkpoint_writes_before_replay = store.checkpoint_write_count
    replayed = await replay_cycle(cast(str, request["eventStreamId"]), store=store)
    assert replayed.result == result.result
    assert store.append_count == appends_before_replay
    assert store.checkpoint_write_count == checkpoint_writes_before_replay

    terminal_handler_calls = 0
    terminal_clock_calls = 0

    def terminal_forbidden(_: object) -> object:
        nonlocal terminal_handler_calls
        terminal_handler_calls += 1
        raise AssertionError("patch-visibility terminal resume dispatched a handler")

    def terminal_clock() -> str:
        nonlocal terminal_clock_calls
        terminal_clock_calls += 1
        raise AssertionError("patch-visibility terminal resume sampled the clock")

    terminal = await resume_cycle(
        request,
        CycleHandlers(
            finder=terminal_forbidden,
            candidate_evaluator=terminal_forbidden,
            patch_planner=terminal_forbidden,
        ),
        store=store,
        expected_version=len(final_events) - 1,
        lease=_lease(cast(str, request["controllerRunId"]), 4),
        clock=terminal_clock,
    )
    assert terminal.result == result.result
    assert store.append_count == appends_before_replay
    assert store.checkpoint_write_count == checkpoint_writes_before_replay
    assert terminal_handler_calls == 0
    assert terminal_clock_calls == 0

    target = accepted[0]
    checkpoint = build_cycle_checkpoint(
        final_fold,
        checkpoint_id=f"{request['controllerRunId']}-final",
        created_at=CHECKPOINT_AT,
    )
    final_stored_checkpoint = (
        None
        if checkpoint_interval is None
        else await store.load_checkpoint(
            cast(str, request["checkpointScope"]),
            checkpoint_id,
        )
    )
    if checkpoint_interval is not None:
        assert final_stored_checkpoint is not None
        assert final_stored_checkpoint["lastSequence"] == final_events[-1].sequence
        assert final_stored_checkpoint["historyPrefixHash"] == final_events[-1].record_hash
    event_documents = [_event_document(event) for event in final_events]
    outcome = {
        "entry": entry,
        "index": index,
        "faultSignal": observed_fault_signal,
        "eventCommittedAtFault": expected_committed,
        "interruptedTailHash": interrupted_fold.tail_hash,
        "interruptedRecordHashes": [event.record_hash for event in interrupted],
        "targetEventAtFaultCanonical": (
            None
            if target_at_fault is None
            else canonical_json(_event_document(target_at_fault))
        ),
        "targetEventCanonical": canonical_json(_event_document(target)),
        "plannerCallsAtFault": 1,
        "plannerCalls": planner_calls,
        "plannerActivityKey": patch_starts[0].data["activityKey"],
        "resultCanonical": canonical_json(result.result),
        "finalEventTypes": [event.type for event in final_events],
        "finalEventCanonical": [canonical_json(event) for event in event_documents],
        "finalRecordHashes": [event.record_hash for event in final_events],
        "finalCheckpointCanonical": canonical_json(checkpoint),
        "replayZeroWrite": True,
        "terminalResumeZeroWrite": True,
        "terminalResumeHandlerCalls": terminal_handler_calls,
        "terminalResumeClockCalls": terminal_clock_calls,
    }
    if checkpoint_interval is not None:
        assert checkpoint_at_fault is not None
        assert target_at_fault is not None
        assert final_stored_checkpoint is not None
        outcome.update(
            {
                "checkpointId": checkpoint_id,
                "checkpointWritesAtFault": checkpoint_writes_at_fault,
                "checkpointAtFaultCanonical": canonical_json(checkpoint_at_fault),
                "checkpointLagEventsAtFault": (
                    target_at_fault.sequence
                    - cast(int, checkpoint_at_fault["lastSequence"])
                ),
                "checkpointTargetsPatchAtFault": (
                    cast(int, checkpoint_at_fault["lastSequence"])
                    == target_at_fault.sequence
                ),
                "finalStoredCheckpointCanonical": canonical_json(
                    final_stored_checkpoint
                ),
                "finalCheckpointWriteCount": store.checkpoint_write_count,
            }
        )
    return outcome


async def run_patch_visibility_campaign(fixture_name: str) -> dict[str, Any]:
    fixture = cast(
        dict[str, Any],
        json.loads(
            (FIXTURES / fixture_name).read_text(encoding="utf-8")
        ),
    )
    graph_document = cast(
        dict[str, Any],
        json.loads((FIXTURES / "diamond.graph.json").read_text(encoding="utf-8")),
    )
    graph = compile_graph(graph_document)
    base_fixture = json.loads(
        (FIXTURES / "cycle-controller.case.json").read_text(encoding="utf-8")
    )
    base_request = cast(
        dict[str, Any],
        copy.deepcopy(base_fixture["validRequests"][0]["document"]),
    )
    stage_set = set(cast(list[str], fixture["stages"]))
    fault_set = set(cast(list[str], fixture["faultKinds"]))
    matrix = [
        entry.to_dict()
        for entry in build_cycle_durable_fault_matrix()
        if entry.event_type == fixture["eventType"]
        and entry.stage in stage_set
        and entry.fault_kind in fault_set
    ]
    assert len(matrix) == fixture["expect"]["matrixEntryCount"]
    canonical = canonical_json(matrix)
    assert len(canonical.encode("utf-8")) == fixture["expect"][
        "matrixCanonicalUtf8Bytes"
    ]
    assert hashlib.sha256(canonical.encode("utf-8")).hexdigest() == fixture["expect"][
        "matrixSha256"
    ]
    outcomes = []
    for index, entry in enumerate(matrix):
        outcomes.append(
            await _exercise_entry(
                graph_document=graph_document,
                graph_hash=graph.graph_hash,
                base_request=base_request,
                fixture=fixture,
                entry=entry,
                index=index,
            )
        )
    report = {
        "campaignId": fixture["id"],
        "requiredAssertions": fixture["requiredAssertions"],
        "matrix": matrix,
        "obligationCount": len(outcomes),
        "outcomes": outcomes,
    }
    return report


async def _main() -> None:
    report = await run_patch_visibility_campaign(
        "cycle-controller-patch-visibility-fault.case.json"
    )
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(_main())
