"""Emit exact native-Python H03B public-operation cancellation evidence."""

from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path
from typing import Any, cast

from graph_engineering import (
    CycleCancellation,
    CycleErrorCode,
    CycleHandlers,
    CycleRuntimeError,
    MemoryCycleStore,
    build_cycle_operation_interruption_matrix,
    canonical_json,
    compile_graph,
    fork_cycle,
    pause_cycle,
    replay_cycle,
    resume_cycle,
    start_cycle,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"
STARTED_AT = "2026-07-27T12:00:00.000Z"


class SetupCrash(BaseException):
    pass


def _binding(activity_id: str, digit: str) -> dict[str, Any]:
    return {
        "activityId": activity_id,
        "implementationHash": digit * 64,
        "sideEffects": "none",
        "maxAttemptsPerRound": 1,
        "maxCostUsdPerAttempt": 0,
        "timeoutMs": 100,
    }


def _configure_request(
    base: dict[str, Any],
    index: int,
    graph_hash: str,
    suffix: str = "root",
) -> dict[str, Any]:
    request = copy.deepcopy(base)
    identity = f"cycle-operation-{index:03d}-{suffix}"
    request.update(
        {
            "controllerRunId": identity,
            "controllerId": f"{identity}-controller",
            "hostRun": {
                "relationship": "standalone-child-controller",
                "runId": f"{identity}-host",
            },
            "eventStreamId": f"{identity}.events",
            "checkpointScope": f"{identity}.checkpoints",
            "initialGraph": {
                "graphRevision": 1,
                "graphHash": graph_hash,
                "revisionHash": "1" * 64,
            },
            "lineage": {"origin": "start"},
            "patches": {"enabled": False, "limits": None},
        }
    )
    request["policy"].update(
        {
            "mode": "until-dry",
            "maxIterations": 1,
            "maxDurationMs": 10_000,
            "maxCostUsd": 10,
            "maxTotalAttempts": 10,
            "maxDiscoveries": 10,
            "maxDynamicNodes": 0,
            "maxCandidatesPerRound": 10,
            "maxCandidateBytes": 4_096,
            "maxCandidateBatchBytes": 16_384,
            "consecutiveDryRounds": 2,
        }
    )
    request["activities"] = {
        "finder": _binding("finder", "1"),
        "candidateEvaluator": _binding("candidate-evaluator", "2"),
        "condition": None,
        "optimizerEvaluator": None,
        "patchPlanner": None,
    }
    return request


def _lease(run_id: str, epoch: int) -> dict[str, Any]:
    return {
        "leaseId": f"{run_id}-lease-{epoch}",
        "holderId": "cycle-operation-holder",
        "leaseEpoch": epoch,
        "fencingToken": epoch,
        "acquiredAt": STARTED_AT,
        "expiresAt": "2026-07-27T12:05:00.000Z",
    }


def _handlers(counter: dict[str, int]) -> CycleHandlers:
    def finder(_: object) -> list[object]:
        counter["finder"] += 1
        return []

    def evaluator(_: object) -> list[object]:
        counter["candidateEvaluator"] += 1
        return []

    return CycleHandlers(finder=finder, candidate_evaluator=evaluator)


def _event_document(event: Any) -> dict[str, Any]:
    return cast(dict[str, Any], event.model_dump(mode="json", by_alias=True))


async def _create_active_prefix(
    request: dict[str, Any],
    store: MemoryCycleStore,
) -> None:
    crashed = False

    def fault_hook(boundary: str) -> None:
        nonlocal crashed
        if not crashed and boundary == "event:LeaseAcquired:after-state-before-dispatch":
            crashed = True
            raise SetupCrash()

    try:
        await start_cycle(
            request,
            _handlers({"finder": 0, "candidateEvaluator": 0}),
            store=store,
            lease=_lease(cast(str, request["controllerRunId"]), 1),
            clock=lambda: STARTED_AT,
            fault_hook=fault_hook,
        )
    except SetupCrash:
        pass
    else:  # pragma: no cover - campaign invariant
        raise AssertionError("active-prefix setup did not stop after LeaseAcquired")
    events = await store.read(cast(str, request["eventStreamId"]))
    assert [event.type for event in events] == ["ControllerCreated", "LeaseAcquired"]


async def _create_terminal_prefix(
    request: dict[str, Any],
    store: MemoryCycleStore,
) -> None:
    await start_cycle(
        request,
        _handlers({"finder": 0, "candidateEvaluator": 0}),
        store=store,
        lease=_lease(cast(str, request["controllerRunId"]), 1),
        clock=lambda: STARTED_AT,
    )


async def _exercise_entry(
    *,
    entry: dict[str, str],
    index: int,
    base_request: dict[str, Any],
    graph_hash: str,
) -> dict[str, Any]:
    store = MemoryCycleStore()
    root_request = _configure_request(base_request, index, graph_hash)
    operation_request = root_request
    target_stream_id = cast(str, root_request["eventStreamId"])
    parent_canonical: list[str] = []

    if entry["operation"] in {"pause", "resume", "fork"}:
        await _create_active_prefix(root_request, store)
    else:
        await _create_terminal_prefix(root_request, store)

    if entry["operation"] == "resume":
        prefix = await store.read(target_stream_id)
        await pause_cycle(
            root_request,
            store=store,
            expected_version=prefix[-1].sequence,
            clock=lambda: STARTED_AT,
        )

    if entry["operation"] == "fork":
        parent_events = await store.read(target_stream_id)
        parent_replay = await replay_cycle(
            target_stream_id,
            store=store,
            through_sequence=parent_events[-1].sequence,
        )
        child = _configure_request(base_request, index, graph_hash, "child")
        child["initialGraph"] = copy.deepcopy(parent_replay.state["currentRevision"])
        child["lineage"] = {
            "origin": "fork",
            "parentControllerRunId": root_request["controllerRunId"],
            "parentSequence": parent_events[-1].sequence,
            "parentHistoryHash": parent_events[-1].record_hash,
        }
        operation_request = child
        target_stream_id = cast(str, child["eventStreamId"])
        parent_canonical = [
            canonical_json(_event_document(event)) for event in parent_events
        ]

    before = await store.read(target_stream_id)
    cancellation = CycleCancellation()
    handler_calls = {"finder": 0, "candidateEvaluator": 0}
    boundary_hits = 0

    def fault_hook(boundary: str) -> None:
        nonlocal boundary_hits
        if boundary == entry["boundary"]:
            boundary_hits += 1
            cancellation.cancel()

    operation_result: object | None = None
    error: CycleRuntimeError | None = None
    try:
        if entry["operation"] == "pause":
            operation_result = await pause_cycle(
                operation_request,
                store=store,
                expected_version=before[-1].sequence,
                clock=lambda: STARTED_AT,
                cancellation=cancellation,
                fault_hook=fault_hook,
            )
        elif entry["operation"] == "resume":
            operation_result = await resume_cycle(
                operation_request,
                _handlers(handler_calls),
                store=store,
                expected_version=before[-1].sequence,
                lease=_lease(cast(str, operation_request["controllerRunId"]), 2),
                clock=lambda: STARTED_AT,
                cancellation=cancellation,
                fault_hook=fault_hook,
            )
        elif entry["operation"] == "replay":
            operation_result = await replay_cycle(
                target_stream_id,
                store=store,
                cancellation=cancellation,
                fault_hook=fault_hook,
            )
        else:
            lineage = cast(dict[str, Any], operation_request["lineage"])
            operation_result = await fork_cycle(
                operation_request,
                _handlers(handler_calls),
                store=store,
                lease=_lease(cast(str, operation_request["controllerRunId"]), 1),
                parent_controller_run_id=cast(str, lineage["parentControllerRunId"]),
                parent_sequence=cast(int, lineage["parentSequence"]),
                parent_history_hash=cast(str, lineage["parentHistoryHash"]),
                clock=lambda: STARTED_AT,
                cancellation=cancellation,
                fault_hook=fault_hook,
            )
    except CycleRuntimeError as caught:
        error = caught

    assert boundary_hits == 1
    after = await store.read(target_stream_id)
    appended = after[len(before) :]
    error_code = error.code.value if error is not None else None
    result_document: dict[str, Any] | None
    if entry["operation"] == "pause":
        result_document = None
    elif entry["operation"] == "replay":
        result_document = cast(Any, operation_result).result if operation_result else None
    else:
        result_document = cast(Any, operation_result).result if operation_result else None
    observed_outcome = (
        "operation-cancelled"
        if error_code == CycleErrorCode.OPERATION_CANCELLED.value
        else (
            "controller-cancelled"
            if result_document is not None
            and result_document.get("exitReason") == "CANCELLED"
            else "committed-result"
        )
    )
    assert observed_outcome == entry["outcome"]
    if entry["outcome"] == "operation-cancelled":
        assert error is not None
        assert error.code is CycleErrorCode.OPERATION_CANCELLED
        assert dict(error.details) == {
            "operation": entry["operation"],
            "boundary": entry["boundary"],
        }
        assert not appended
    else:
        assert error is None
        assert appended
    if entry["outcome"] == "controller-cancelled":
        assert result_document is not None
        assert result_document["exitReason"] == "CANCELLED"
        assert sum(handler_calls.values()) == 0
    if entry["operation"] == "replay":
        assert not appended
        assert sum(handler_calls.values()) == 0
    if entry["operation"] == "pause" and entry["outcome"] == "committed-result":
        assert [event.type for event in appended] == ["LeaseReleased"]
    checkpoint = None
    if entry["operation"] == "pause" and entry["outcome"] == "committed-result":
        checkpoint = await store.load_checkpoint(
            cast(str, operation_request["checkpointScope"]),
            f"{operation_request['controllerRunId']}-latest",
        )
        assert checkpoint is not None
    return {
        "entry": entry,
        "boundaryHits": boundary_hits,
        "observedOutcome": observed_outcome,
        "errorCode": error_code,
        "errorDetails": dict(error.details) if error is not None else None,
        "operationResultCanonical": (
            canonical_json(result_document) if result_document is not None else None
        ),
        "handlerCalls": handler_calls,
        "baselineEventCount": len(before),
        "appendedEventTypes": [event.type for event in appended],
        "appendedEventCanonical": [
            canonical_json(_event_document(event)) for event in appended
        ],
        "streamEventTypes": [event.type for event in after],
        "streamEventCanonical": [
            canonical_json(_event_document(event)) for event in after
        ],
        "recordHashes": [event.record_hash for event in after],
        "parentCanonical": parent_canonical,
        "checkpointCanonical": canonical_json(checkpoint) if checkpoint else None,
    }


async def _main() -> None:
    fixture = json.loads(
        (
            FIXTURES / "cycle-controller-operation-interruption.case.json"
        ).read_text(encoding="utf-8")
    )
    graph_document = json.loads(
        (FIXTURES / "diamond.graph.json").read_text(encoding="utf-8")
    )
    graph_hash = compile_graph(graph_document).graph_hash
    controller_fixture = json.loads(
        (FIXTURES / "cycle-controller.case.json").read_text(encoding="utf-8")
    )
    base_request = cast(
        dict[str, Any],
        controller_fixture["validRequests"][0]["document"],
    )
    matrix = [entry.to_dict() for entry in build_cycle_operation_interruption_matrix()]
    assert len(matrix) == fixture["expect"]["matrixEntryCount"]
    outcomes = []
    for index, entry in enumerate(matrix):
        outcomes.append(
            await _exercise_entry(
                entry=entry,
                index=index,
                base_request=base_request,
                graph_hash=graph_hash,
            )
        )
    print(
        json.dumps(
            {
                "campaignId": fixture["id"],
                "requiredAssertions": fixture["requiredAssertions"],
                "matrix": matrix,
                "obligationCount": len(outcomes),
                "outcomes": outcomes,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    asyncio.run(_main())
