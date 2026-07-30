"""Emit exact native-Python D7 cycle bytes for the cross-language join."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, cast

from graph_engineering import (
    CYCLE_DURABLE_FAULT_STAGES,
    CYCLE_EVENT_TYPES,
    CYCLE_FAULT_KINDS,
    CycleActivityContext,
    CycleErrorCode,
    CycleHandlers,
    CycleRuntimeError,
    GraphPatchLimits,
    GraphPatchRuntime,
    MemoryCycleStore,
    PatchAuthority,
    build_cycle_checkpoint,
    build_cycle_durable_fault_matrix,
    canonical_json,
    compile_graph,
    fold_cycle_events,
    pause_cycle,
    renew_cycle_lease,
    replay_cycle,
    resolve_cycle_in_doubt_activity,
    resume_cycle,
    start_cycle,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"
STARTED_AT = "2026-07-26T12:00:00.000Z"
CHECKPOINT_AT = "2026-07-26T12:00:01.000Z"
RESOLUTION_AT = CHECKPOINT_AT


def _inline(handler: Callable[[Any], Any]) -> Callable[[Any], Awaitable[Any]]:
    """Dispatch a campaign handler inline on the event loop.

    The controller offloads a plain synchronous handler to `asyncio.to_thread`,
    and that thread hop races the binding's wall-clock `timeoutMs` (100 ms in
    this campaign) whenever the host is loaded, aborting an attempt this
    campaign never intends to time out. A coroutine handler runs to completion
    in its first loop step, so the timer can never preempt it -- which is how
    the TypeScript reference controller executes the same handlers.
    """

    async def invoke(context: Any) -> Any:
        return handler(context)

    return invoke


def _request(graph_hash: str) -> dict[str, Any]:
    fixture = json.loads(
        (FIXTURES / "cycle-controller.case.json").read_text(encoding="utf-8")
    )
    document = copy.deepcopy(fixture["validRequests"][0]["document"])
    document["controllerRunId"] = "cycle-cross-language"
    document["controllerId"] = "cycle-cross-language-controller"
    document["hostRun"] = {
        "relationship": "standalone-child-controller",
        "runId": "cycle-cross-language-host",
    }
    document["eventStreamId"] = "cycle-cross-language.events"
    document["checkpointScope"] = "cycle-cross-language.checkpoints"
    document["initialGraph"] = {
        "graphRevision": 1,
        "graphHash": graph_hash,
        "revisionHash": "1" * 64,
    }
    document["policy"].update(
        {
            "mode": "until-dry",
            "maxIterations": 4,
            "maxDurationMs": 10_000,
            "maxCostUsd": 10,
            "maxTotalAttempts": 30,
            "maxDiscoveries": 20,
            "maxDynamicNodes": 10,
            "maxCandidatesPerRound": 20,
            "maxCandidateBytes": 4_096,
            "maxCandidateBatchBytes": 16_384,
            "consecutiveDryRounds": 2,
        }
    )
    return cast(dict[str, Any], document)


def _lease() -> dict[str, Any]:
    return {
        "leaseId": "cycle-cross-language-lease",
        "holderId": "cycle-cross-language-holder",
        "leaseEpoch": 1,
        "fencingToken": 1,
        "acquiredAt": STARTED_AT,
        "expiresAt": "2026-07-26T12:01:00.000Z",
    }


def _event_projection(
    result: Any,
    *,
    inputs: list[dict[str, Any]],
    checkpoint_id: str,
) -> dict[str, Any]:
    fold = fold_cycle_events(result.events, require_terminal=True)
    checkpoint = build_cycle_checkpoint(
        fold,
        checkpoint_id=checkpoint_id,
        created_at=CHECKPOINT_AT,
    )
    event_documents = [
        event.model_dump(mode="json", by_alias=True) for event in result.events
    ]
    return {
        "result": result.result,
        "resultCanonical": canonical_json(result.result),
        "eventTypes": [event.type for event in result.events],
        "eventCanonical": [canonical_json(event) for event in event_documents],
        "recordHashes": [event.record_hash for event in result.events],
        "activityKeys": [
            event.data["activityKey"]
            for event in result.events
            if event.type == "ActivityStarted"
        ],
        "inputsCanonical": [canonical_json(item) for item in inputs],
        "checkpoint": checkpoint,
        "checkpointCanonical": canonical_json(checkpoint),
        "checkpointStateCanonical": canonical_json(checkpoint["state"]),
    }


async def _accepted_patch_report(
    graph_document: dict[str, Any],
    graph_hash: str,
) -> dict[str, Any]:
    request = _request(graph_hash)
    request["controllerRunId"] = "cycle-cross-language-patch"
    request["controllerId"] = "cycle-cross-language-patch-controller"
    request["hostRun"]["runId"] = "cycle-cross-language-patch-host"
    request["eventStreamId"] = "cycle-cross-language-patch.events"
    request["checkpointScope"] = "cycle-cross-language-patch.checkpoints"
    request["policy"]["maxIterations"] = 1
    graph = compile_graph(graph_document)
    runtime = GraphPatchRuntime(
        graph,
        revision_hash_value="1" * 64,
        limits=GraphPatchLimits.model_validate(request["patches"]["limits"]),
        succeeded_nodes=frozenset({"merge"}),
    )
    authority = PatchAuthority(
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
    inputs: list[dict[str, Any]] = []

    def finder(context: CycleActivityContext) -> list[object]:
        inputs.append(
            {"phase": context.phase.value, "iteration": context.iteration, "input": context.input}
        )
        return []

    def evaluator(context: CycleActivityContext) -> list[object]:
        inputs.append(
            {"phase": context.phase.value, "iteration": context.iteration, "input": context.input}
        )
        return []

    def planner(context: CycleActivityContext) -> dict[str, Any]:
        inputs.append(
            {"phase": context.phase.value, "iteration": context.iteration, "input": context.input}
        )
        current = cast(dict[str, Any], cast(dict[str, Any], context.input)["currentRevision"])
        return {
            "apiVersion": "graphengineering.reacher-z.github.io/patches/v1alpha1",
            "kind": "GraphPatch",
            "patchId": "cycle-cross-language-review",
            "base": current,
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

    patch_lease = _lease()
    patch_lease["leaseId"] = "cycle-cross-language-patch-lease"
    result = await start_cycle(
        request,
        CycleHandlers(
            finder=_inline(finder),
            candidate_evaluator=_inline(evaluator),
            patch_planner=_inline(planner),
        ),
        store=MemoryCycleStore(),
        lease=patch_lease,
        clock=lambda: STARTED_AT,
        patch_runtime=runtime,
        patch_authority=authority,
        patch_each_round=True,
    )
    assert result.result["exitReason"] == "MAX_ITERATIONS"
    assert runtime.coordinate["graphRevision"] == 2
    assert any(event.type == "PatchAccepted" for event in result.events)
    projection = _event_projection(
        result,
        inputs=inputs,
        checkpoint_id="cycle-cross-language-patch-terminal",
    )
    projection["finalGraphHash"] = runtime.coordinate["graphHash"]
    return projection


class _ProcessLost(BaseException):
    """Model process loss after a durable CAS without normal failure handling."""


async def _resume_report(
    graph_hash: str,
) -> dict[str, Any]:
    request = _request(graph_hash)
    request["controllerRunId"] = "cycle-cross-language-resume"
    request["controllerId"] = "cycle-cross-language-resume-controller"
    request["hostRun"]["runId"] = "cycle-cross-language-resume-host"
    request["eventStreamId"] = "cycle-cross-language-resume.events"
    request["checkpointScope"] = "cycle-cross-language-resume.checkpoints"
    request["policy"]["maxIterations"] = 1
    store = MemoryCycleStore()
    inputs: list[dict[str, Any]] = []
    finder_calls = 0
    evaluator_calls = 0
    lost = False

    def finder(context: CycleActivityContext) -> list[dict[str, Any]]:
        nonlocal finder_calls
        finder_calls += 1
        inputs.append(
            {"phase": context.phase.value, "iteration": context.iteration, "input": context.input}
        )
        return [{"key": "durable", "value": {"source": "finder"}}]

    def evaluator(context: CycleActivityContext) -> list[dict[str, str]]:
        nonlocal evaluator_calls
        evaluator_calls += 1
        inputs.append(
            {"phase": context.phase.value, "iteration": context.iteration, "input": context.input}
        )
        candidates = cast(list[dict[str, Any]], cast(dict[str, Any], context.input)["candidates"])
        return [{"key": candidate["key"], "verdict": "accept"} for candidate in candidates]

    def lose_after_discovery(boundary: str) -> None:
        nonlocal lost
        if boundary == "event:DiscoveryCommitted:after-cas" and not lost:
            lost = True
            raise _ProcessLost

    first_lease = _lease()
    first_lease["leaseId"] = "cycle-cross-language-resume-lease-1"
    try:
        await start_cycle(
            request,
            CycleHandlers(finder=_inline(finder), candidate_evaluator=_inline(evaluator)),
            store=store,
            lease=first_lease,
            clock=lambda: STARTED_AT,
            fault_hook=lose_after_discovery,
        )
    except _ProcessLost:
        pass
    else:  # pragma: no cover - conformance invariant
        raise AssertionError("resume scenario did not lose the process")
    interrupted = await store.read(request["eventStreamId"])
    second_lease = {
        **_lease(),
        "leaseId": "cycle-cross-language-resume-lease-2",
        "holderId": "cycle-cross-language-resume-holder-2",
        "leaseEpoch": 2,
        "fencingToken": 2,
    }
    result = await resume_cycle(
        request,
        CycleHandlers(finder=_inline(finder), candidate_evaluator=_inline(evaluator)),
        store=store,
        expected_version=len(interrupted) - 1,
        lease=second_lease,
        clock=lambda: STARTED_AT,
    )
    assert finder_calls == 1
    assert evaluator_calls == 1
    projection = _event_projection(
        result,
        inputs=inputs,
        checkpoint_id="cycle-cross-language-resume-terminal",
    )
    projection.update(
        {
            "preCrashEventTypes": [event.type for event in interrupted],
            "preCrashRecordHashes": [event.record_hash for event in interrupted],
            "finderCalls": finder_calls,
            "evaluatorCalls": evaluator_calls,
        }
    )
    return projection


def _mode_binding(activity_id: str, implementation_digit: str) -> dict[str, Any]:
    return {
        "activityId": activity_id,
        "implementationHash": implementation_digit * 64,
        "sideEffects": "none",
        "maxAttemptsPerRound": 1,
        "maxCostUsdPerAttempt": 0,
        "timeoutMs": 100,
    }


async def _mode_report(
    graph_hash: str,
    mode: str,
) -> dict[str, Any]:
    request = _request(graph_hash)
    suffix = "while" if mode == "while" else "optimizer"
    request["controllerRunId"] = f"cycle-cross-language-{suffix}"
    request["controllerId"] = f"cycle-cross-language-{suffix}-controller"
    request["hostRun"]["runId"] = f"cycle-cross-language-{suffix}-host"
    request["eventStreamId"] = f"cycle-cross-language-{suffix}.events"
    request["checkpointScope"] = f"cycle-cross-language-{suffix}.checkpoints"
    request["policy"]["mode"] = mode
    request["policy"].pop("consecutiveDryRounds")
    if mode == "while":
        request["activities"]["condition"] = _mode_binding("condition", "5")
        request["activities"]["optimizerEvaluator"] = None
    else:
        request["activities"]["condition"] = None
        request["activities"]["optimizerEvaluator"] = _mode_binding(
            "optimizer-evaluator", "6"
        )
    inputs: list[dict[str, Any]] = []

    def remember(context: CycleActivityContext) -> None:
        inputs.append(
            {"phase": context.phase.value, "iteration": context.iteration, "input": context.input}
        )

    def finder(context: CycleActivityContext) -> list[object]:
        remember(context)
        return []

    def evaluator(context: CycleActivityContext) -> list[object]:
        remember(context)
        return []

    def decide(context: CycleActivityContext) -> bool | str:
        remember(context)
        return False if mode == "while" else "accept"

    mode_lease = _lease()
    mode_lease["leaseId"] = f"cycle-cross-language-{suffix}-lease"
    result = await start_cycle(
        request,
        CycleHandlers(
            finder=_inline(finder),
            candidate_evaluator=_inline(evaluator),
            condition=_inline(decide) if mode == "while" else None,
            optimizer_evaluator=_inline(decide) if mode != "while" else None,
        ),
        store=MemoryCycleStore(),
        lease=mode_lease,
        clock=lambda: STARTED_AT,
    )
    expected = "CONDITION_FALSE" if mode == "while" else "EVALUATOR_ACCEPTED"
    assert result.result["exitReason"] == expected
    return _event_projection(
        result,
        inputs=inputs,
        checkpoint_id=f"cycle-cross-language-{suffix}-terminal",
    )


async def _in_doubt_report(
    graph_hash: str,
    *,
    exhausted: bool,
) -> dict[str, Any]:
    request = _request(graph_hash)
    suffix = "exhausted" if exhausted else "recovered"
    request["controllerRunId"] = f"cycle-cross-language-in-doubt-{suffix}"
    request["controllerId"] = f"cycle-cross-language-in-doubt-{suffix}-controller"
    request["hostRun"]["runId"] = f"cycle-cross-language-in-doubt-{suffix}-host"
    request["eventStreamId"] = f"cycle-cross-language-in-doubt-{suffix}.events"
    request["checkpointScope"] = f"cycle-cross-language-in-doubt-{suffix}.checkpoints"
    request["policy"]["maxIterations"] = 1
    request["activities"]["finder"]["sideEffects"] = "idempotent"
    request["activities"]["finder"]["maxAttemptsPerRound"] = 2
    inputs: list[dict[str, Any]] = []
    finder_calls = 0

    def remember(context: CycleActivityContext) -> None:
        inputs.append(
            {"phase": context.phase.value, "iteration": context.iteration, "input": context.input}
        )

    def finder(context: CycleActivityContext) -> list[object]:
        nonlocal finder_calls
        finder_calls += 1
        remember(context)
        if finder_calls == 1 or exhausted:
            raise CycleRuntimeError(
                CycleErrorCode.ACTIVITY_FAILED,
                "ambiguous idempotent provider result",
            )
        return []

    def evaluator(context: CycleActivityContext) -> list[object]:
        remember(context)
        return []

    in_doubt_lease = _lease()
    in_doubt_lease["leaseId"] = f"cycle-cross-language-in-doubt-{suffix}-lease"
    result = await start_cycle(
        request,
        CycleHandlers(finder=_inline(finder), candidate_evaluator=_inline(evaluator)),
        store=MemoryCycleStore(),
        lease=in_doubt_lease,
        clock=lambda: STARTED_AT,
    )
    projection = _event_projection(
        result,
        inputs=inputs,
        checkpoint_id=f"cycle-cross-language-in-doubt-{suffix}-terminal",
    )
    in_doubt = cast(
        list[dict[str, Any]],
        cast(dict[str, Any], projection["checkpoint"])["state"]["inDoubtActivities"],
    )
    assert result.result["exitReason"] == "MAX_ITERATIONS"
    assert finder_calls == 2
    if exhausted:
        assert len(in_doubt) == 1
        assert in_doubt[0]["attempt"] == 2
    else:
        assert in_doubt == []
    projection["inDoubtActivities"] = in_doubt
    projection["finderCalls"] = finder_calls
    return projection


async def _resolution_report(graph_hash: str) -> dict[str, Any]:
    request = _request(graph_hash)
    request["controllerRunId"] = "cycle-cross-language-resolution"
    request["controllerId"] = "cycle-cross-language-resolution-controller"
    request["hostRun"]["runId"] = "cycle-cross-language-resolution-host"
    request["eventStreamId"] = "cycle-cross-language-resolution.events"
    request["checkpointScope"] = "cycle-cross-language-resolution.checkpoints"
    request["policy"]["maxIterations"] = 1
    request["activities"]["finder"]["sideEffects"] = "idempotent"
    request["activities"]["finder"]["maxAttemptsPerRound"] = 2
    store = MemoryCycleStore()
    inputs: list[dict[str, Any]] = []

    def finder(context: CycleActivityContext) -> list[object]:
        inputs.append(
            {"phase": context.phase.value, "iteration": context.iteration, "input": context.input}
        )
        raise CycleRuntimeError(
            CycleErrorCode.ACTIVITY_FAILED,
            "ambiguous idempotent provider result",
        )

    initial_lease = {
        **_lease(),
        "leaseId": "cycle-cross-language-resolution-lease-1",
    }
    terminal = await start_cycle(
        request,
        CycleHandlers(
            finder=_inline(finder),
            candidate_evaluator=_inline(lambda _: []),
        ),
        store=store,
        lease=initial_lease,
        clock=lambda: STARTED_AT,
    )
    before = fold_cycle_events(terminal.events, require_terminal=True)
    unresolved = cast(list[dict[str, Any]], before.state["inDoubtActivities"])
    assert len(unresolved) == 1
    operator_id = "cycle-cross-language-resolution-operator"
    resolution_lease = {
        "leaseId": "cycle-cross-language-resolution-lease-2",
        "holderId": operator_id,
        "leaseEpoch": 2,
        "fencingToken": 2,
        "acquiredAt": STARTED_AT,
        "expiresAt": "2026-07-26T12:01:00.000Z",
    }
    command: dict[str, Any] = {
        "apiVersion": (
            "graphengineering.reacher-z.github.io/"
            "cycle-in-doubt-resolutions/v1alpha1"
        ),
        "kind": "CycleInDoubtResolution",
        "resolutionId": "cycle-cross-language-resolution-1",
        "controllerRunId": request["controllerRunId"],
        "controllerHash": before.request.controller_hash,
        "requestHash": before.request.request_hash,
        "eventStreamId": request["eventStreamId"],
        "expectedSequence": before.tail_sequence,
        "expectedHistoryPrefixHash": before.tail_hash,
        "activityKey": unresolved[0]["activityKey"],
        "disposition": "confirmed-not-applied",
        "evidenceHash": "d" * 64,
        "authoritySnapshot": {
            "principalHash": "a" * 64,
            "grantHash": "b" * 64,
            "policyHash": "c" * 64,
            "leaseHolderHash": hashlib.sha256(operator_id.encode("utf-8")).hexdigest(),
        },
    }

    async def rejection_code(
        command_value: object,
        lease_value: object,
        timestamp: str = RESOLUTION_AT,
    ) -> str:
        appends = store.append_count
        try:
            await resolve_cycle_in_doubt_activity(
                request,
                command_value,
                store=store,
                lease=lease_value,
                clock=lambda: timestamp,
            )
        except CycleRuntimeError as exc:
            assert store.append_count == appends
            return exc.code.value
        raise AssertionError("hostile resolution unexpectedly succeeded")

    malformed = {**command, "unexpected": True}
    wrong_target = {**command, "activityKey": "f" * 64}
    stale_tail = {**command, "expectedSequence": command["expectedSequence"] - 1}
    stale_fence = {**resolution_lease, "leaseEpoch": 1, "fencingToken": 1}
    wrong_holder = {**resolution_lease, "holderId": "attacker"}
    errors = {
        "malformed": await rejection_code(malformed, resolution_lease),
        "wrongTarget": await rejection_code(wrong_target, resolution_lease),
        "staleTail": await rejection_code(stale_tail, resolution_lease),
        "staleFence": await rejection_code(command, stale_fence),
        "wrongHolder": await rejection_code(command, wrong_holder),
        "regressedClock": await rejection_code(
            command,
            resolution_lease,
            "2026-07-26T11:59:59.999Z",
        ),
        "expiredLease": await rejection_code(
            command,
            resolution_lease,
            "2026-07-26T12:01:00.000Z",
        ),
    }

    checkpoint_id = f"{request['controllerRunId']}-latest"
    resolved = await resolve_cycle_in_doubt_activity(
        request,
        command,
        store=store,
        lease=resolution_lease,
        clock=lambda: RESOLUTION_AT,
        checkpoint_id=checkpoint_id,
    )
    events = await store.read(request["eventStreamId"])
    checkpoint = await store.load_checkpoint(request["checkpointScope"], checkpoint_id)
    assert checkpoint is not None
    assert resolved.fold.state["inDoubtActivities"] == []
    assert resolved.fold.terminal_result == terminal.result

    appends = store.append_count
    clock_calls = 0

    def forbidden_clock() -> str:
        nonlocal clock_calls
        clock_calls += 1
        raise AssertionError("duplicate resolution sampled the clock")

    duplicate = await resolve_cycle_in_doubt_activity(
        request,
        command,
        store=store,
        lease={"malformed": True},
        clock=forbidden_clock,
    )
    duplicate_zero_write = store.append_count == appends
    changed = {**command, "disposition": "confirmed-applied"}
    conflict = await rejection_code(changed, {"malformed": True})
    absent = {
        **command,
        "resolutionId": "cycle-cross-language-resolution-2",
        "expectedSequence": resolved.event.sequence,
        "expectedHistoryPrefixHash": resolved.event.record_hash,
    }
    absent_target = await rejection_code(absent, resolution_lease)

    event_documents = [event.model_dump(mode="json", by_alias=True) for event in events]
    event_document = resolved.event.model_dump(mode="json", by_alias=True)
    return {
        "command": command,
        "commandCanonical": canonical_json(command),
        "commandHash": resolved.command_hash,
        "result": terminal.result,
        "resultCanonical": canonical_json(terminal.result),
        "eventTypes": [event.type for event in events],
        "eventCanonical": [canonical_json(event) for event in event_documents],
        "recordHashes": [event.record_hash for event in events],
        "inputsCanonical": [canonical_json(item) for item in inputs],
        "resolutionEvent": event_document,
        "resolutionEventCanonical": canonical_json(event_document),
        "stateCanonical": canonical_json(resolved.fold.state),
        "preResolutionInDoubt": unresolved,
        "postResolutionInDoubt": resolved.fold.state["inDoubtActivities"],
        "checkpoint": checkpoint,
        "checkpointCanonical": canonical_json(checkpoint),
        "checkpointStateCanonical": canonical_json(checkpoint["state"]),
        "errors": {
            **errors,
            "conflict": conflict,
            "absentTarget": absent_target,
        },
        "duplicate": {
            "duplicate": duplicate.duplicate,
            "commandHash": duplicate.command_hash,
            "eventRecordHash": duplicate.event.record_hash,
            "zeroWrite": duplicate_zero_write,
            "clockCalls": clock_calls,
        },
    }


_CAMPAIGN_FAULT_SIGNALS = {
    "process-loss": "coordinator-process-lost",
    "store-error": "durable-store-error",
    "timeout": "operation-deadline-exceeded",
    "cancellation": "operation-cancelled",
    "commit-then-throw": "commit-acknowledgement-lost",
}


class _CampaignFault(BaseException):
    def __init__(self, fault_kind: str) -> None:
        self.fault_kind = fault_kind
        self.signal = _CAMPAIGN_FAULT_SIGNALS[fault_kind]
        super().__init__(self.signal)


class _SeedStop(BaseException):
    pass


async def _administer_campaign_lease(
    event_type: str,
    request: dict[str, Any],
    store: MemoryCycleStore,
    renewal: dict[str, Any],
    expected_version: int,
    fault_hook: Any,
) -> object:
    if event_type == "LeaseRenewed":
        return await renew_cycle_lease(
            request,
            store=store,
            expected_version=expected_version,
            lease=renewal,
            clock=lambda: STARTED_AT,
            fault_hook=fault_hook,
        )
    return await pause_cycle(
        request,
        store=store,
        expected_version=expected_version,
        reason="handoff",
        clock=lambda: STARTED_AT,
        fault_hook=fault_hook,
    )


async def _lease_fault_campaign(
    graph_hash: str,
    campaign: dict[str, Any],
) -> dict[str, Any]:
    matrix = [
        entry
        for entry in build_cycle_durable_fault_matrix()
        if entry.event_type in campaign["eventTypes"]
        and entry.stage in campaign["stages"]
        and entry.fault_kind in campaign["faultKinds"]
    ]
    assert len(matrix) == campaign["expectedObligationCount"]
    outcomes: list[dict[str, Any]] = []
    for index, obligation in enumerate(matrix):
        suffix = f"{index:03d}"
        request = _request(graph_hash)
        request.update(
            {
                "controllerRunId": f"cycle-lease-fault-{suffix}",
                "controllerId": f"cycle-lease-fault-{suffix}-controller",
                "hostRun": {
                    "relationship": "standalone-child-controller",
                    "runId": f"cycle-lease-fault-{suffix}-host",
                },
                "eventStreamId": f"cycle-lease-fault-{suffix}.events",
                "checkpointScope": f"cycle-lease-fault-{suffix}.checkpoints",
            }
        )
        request["policy"]["maxIterations"] = 1
        initial_lease = {
            "leaseId": f"cycle-lease-fault-{suffix}-lease-1",
            "holderId": "cycle-lease-fault-holder",
            "leaseEpoch": 1,
            "fencingToken": 1,
            "acquiredAt": STARTED_AT,
            "expiresAt": "2026-07-26T12:01:00.000Z",
        }
        extended_lease = {
            **initial_lease,
            "expiresAt": "2026-07-26T12:02:00.000Z",
        }
        target_fired = False

        def target_hook(
            boundary: str,
            target_boundary: str = obligation.boundary,
            target_fault_kind: str = obligation.fault_kind,
        ) -> None:
            nonlocal target_fired
            if not target_fired and boundary == target_boundary:
                target_fired = True
                raise _CampaignFault(target_fault_kind)

        store = MemoryCycleStore(fault_hook=target_hook)

        def seed_hook(boundary: str) -> None:
            target_hook(boundary)
            if boundary == campaign["seedBoundary"]:
                raise _SeedStop()

        try:
            await start_cycle(
                request,
                CycleHandlers(
                    finder=_inline(
                        lambda _: (_ for _ in ()).throw(
                            AssertionError("seed dispatched finder")
                        )
                    ),
                    candidate_evaluator=_inline(
                        lambda _: (_ for _ in ()).throw(
                            AssertionError("seed dispatched evaluator")
                        )
                    ),
                ),
                store=store,
                lease=initial_lease,
                clock=lambda: STARTED_AT,
                fault_hook=seed_hook,
            )
        except _SeedStop:
            pass
        else:
            raise AssertionError("lease campaign seed did not stop at RoundReserved")
        seed_events = await store.read(request["eventStreamId"])
        assert seed_events[-1].type == "RoundReserved"
        seed_tail = seed_events[-1].sequence

        try:
            await _administer_campaign_lease(
                obligation.event_type,
                request,
                store,
                extended_lease,
                seed_tail,
                target_hook,
            )
        except _CampaignFault as exc:
            assert exc.fault_kind == obligation.fault_kind
            observed_fault_signal = exc.signal
        else:
            raise AssertionError(
                f"{obligation.event_type}/{obligation.stage}/{obligation.fault_kind} did not fire"
            )
        assert target_fired
        assert observed_fault_signal == _CAMPAIGN_FAULT_SIGNALS[obligation.fault_kind]
        interrupted = await store.read(request["eventStreamId"])
        interrupted_fold = fold_cycle_events(interrupted)
        target_at_fault = sum(
            event.type == obligation.event_type for event in interrupted
        )
        expected_committed = obligation.durability != "event-not-committed"
        assert target_at_fault == int(expected_committed)
        checkpoint_id = f"{request['controllerRunId']}-latest"
        checkpoint_at_fault = await store.load_checkpoint(
            request["checkpointScope"],
            checkpoint_id,
        )
        expected_checkpoint = obligation.durability == "event-and-checkpoint-committed"
        assert (checkpoint_at_fault is not None) is expected_checkpoint

        if not expected_committed:
            await _administer_campaign_lease(
                obligation.event_type,
                request,
                store,
                extended_lease,
                seed_tail,
                None,
            )
        recovered_events = await store.read(request["eventStreamId"])
        assert sum(event.type == obligation.event_type for event in recovered_events) == 1
        stale_version_writes = store.append_count
        try:
            await _administer_campaign_lease(
                obligation.event_type,
                request,
                store,
                extended_lease,
                seed_tail,
                None,
            )
        except CycleRuntimeError as exc:
            stale_version_code = exc.code.value
        else:
            raise AssertionError("stale lease administration version unexpectedly committed")
        assert stale_version_code == CycleErrorCode.VERSION_CONFLICT.value
        stale_version_zero_write = store.append_count == stale_version_writes
        assert stale_version_zero_write

        stale_finder_calls = 0

        def stale_finder(_: object) -> list[object]:
            nonlocal stale_finder_calls
            stale_finder_calls += 1
            return []

        stale_fence_writes = store.append_count
        try:
            await resume_cycle(
                request,
                CycleHandlers(
                    finder=_inline(stale_finder),
                    candidate_evaluator=_inline(lambda _: []),
                ),
                store=store,
                expected_version=len(recovered_events) - 1,
                lease={
                    **initial_lease,
                    "leaseId": f"cycle-lease-fault-{suffix}-stale",
                },
                clock=lambda: STARTED_AT,
            )
        except CycleRuntimeError as exc:
            stale_fence_code = exc.code.value
        else:
            raise AssertionError("stale lease fence unexpectedly resumed")
        assert stale_fence_code == CycleErrorCode.STALE_LEASE.value
        stale_fence_zero_write = (
            stale_finder_calls == 0 and store.append_count == stale_fence_writes
        )
        assert stale_fence_zero_write

        finder_calls = 0
        evaluator_calls = 0

        def finder(_: object) -> list[object]:
            nonlocal finder_calls
            finder_calls += 1
            return []

        def evaluator(_: object) -> list[object]:
            nonlocal evaluator_calls
            evaluator_calls += 1
            return []

        resumed = await resume_cycle(
            request,
            CycleHandlers(finder=_inline(finder), candidate_evaluator=_inline(evaluator)),
            store=store,
            expected_version=len(recovered_events) - 1,
            lease={
                "leaseId": f"cycle-lease-fault-{suffix}-lease-2",
                "holderId": "cycle-lease-fault-holder-2",
                "leaseEpoch": 2,
                "fencingToken": 2,
                "acquiredAt": STARTED_AT,
                "expiresAt": "2026-07-26T12:03:00.000Z",
            },
            clock=lambda: STARTED_AT,
        )
        assert resumed.result["exitReason"] == "MAX_ITERATIONS"
        assert finder_calls == 1
        final_events = await store.read(request["eventStreamId"])
        final_fold = fold_cycle_events(final_events, require_terminal=True)
        assert sum(event.type == obligation.event_type for event in final_events) == 1
        replayed = await replay_cycle(request["eventStreamId"], store=store)
        assert replayed.result == resumed.result
        appends_before_terminal_resume = store.append_count
        terminal_clock_calls = 0

        def terminal_clock() -> str:
            nonlocal terminal_clock_calls
            terminal_clock_calls += 1
            raise AssertionError("terminal resume sampled clock")

        terminal = await resume_cycle(
            request,
            CycleHandlers(
                finder=_inline(
                    lambda _: (_ for _ in ()).throw(
                        AssertionError("terminal resume dispatched finder")
                    )
                ),
                candidate_evaluator=_inline(
                    lambda _: (_ for _ in ()).throw(
                        AssertionError("terminal resume dispatched evaluator")
                    )
                ),
            ),
            store=store,
            expected_version=len(final_events) - 1,
            lease={
                "leaseId": f"cycle-lease-fault-{suffix}-lease-3",
                "holderId": "cycle-lease-fault-holder-3",
                "leaseEpoch": 3,
                "fencingToken": 3,
                "acquiredAt": STARTED_AT,
                "expiresAt": "2026-07-26T12:04:00.000Z",
            },
            clock=terminal_clock,
        )
        assert terminal.result == resumed.result
        terminal_zero_write = store.append_count == appends_before_terminal_resume
        assert terminal_zero_write and terminal_clock_calls == 0
        target_event = next(
            event for event in final_events if event.type == obligation.event_type
        )
        final_checkpoint = build_cycle_checkpoint(
            final_fold,
            checkpoint_id=f"cycle-lease-fault-{suffix}-final",
            created_at=CHECKPOINT_AT,
        )
        outcomes.append(
            {
                **obligation.to_dict(),
                "index": index,
                "faultSignal": observed_fault_signal,
                "eventCommittedAtFault": expected_committed,
                "checkpointCommittedAtFault": expected_checkpoint,
                "interruptedTailHash": interrupted_fold.tail_hash,
                "interruptedRecordHashes": [event.record_hash for event in interrupted],
                "checkpointAtFaultCanonical": (
                    None
                    if checkpoint_at_fault is None
                    else canonical_json(checkpoint_at_fault)
                ),
                "targetEventCanonical": canonical_json(
                    target_event.model_dump(mode="json", by_alias=True)
                ),
                "staleVersionCode": stale_version_code,
                "staleVersionZeroWrite": stale_version_zero_write,
                "staleFenceCode": stale_fence_code,
                "staleFenceZeroWrite": stale_fence_zero_write,
                "finderCalls": finder_calls,
                "evaluatorCalls": evaluator_calls,
                "resultCanonical": canonical_json(resumed.result),
                "finalEventTypes": [event.type for event in final_events],
                "finalRecordHashes": [event.record_hash for event in final_events],
                "finalCheckpointCanonical": canonical_json(final_checkpoint),
                "terminalResumeZeroWrite": terminal_zero_write,
                "terminalResumeClockCalls": terminal_clock_calls,
            }
        )
    return {
        "campaignId": campaign["id"],
        "requiredAssertions": campaign["requiredAssertions"],
        "obligationCount": len(outcomes),
        "outcomes": outcomes,
    }


async def _main() -> None:
    graph_document = json.loads(
        (FIXTURES / "diamond.graph.json").read_text(encoding="utf-8")
    )
    graph = compile_graph(graph_document)
    request = _request(graph.graph_hash)
    inputs: list[dict[str, Any]] = []

    def finder(context: CycleActivityContext) -> list[dict[str, Any]]:
        inputs.append(
            {
                "phase": context.phase.value,
                "iteration": context.iteration,
                "input": context.input,
            }
        )
        if context.iteration == 1:
            return [
                {"key": "finding-a", "value": {"source": "first"}},
                {"key": "finding-a", "value": {"source": "duplicate"}},
            ]
        if context.iteration == 2:
            return [{"key": "finding-a", "value": {"source": "rediscovered"}}]
        return []

    def evaluator(context: CycleActivityContext) -> list[dict[str, str]]:
        inputs.append(
            {
                "phase": context.phase.value,
                "iteration": context.iteration,
                "input": context.input,
            }
        )
        candidates = cast(list[dict[str, Any]], cast(dict[str, Any], context.input)["candidates"])
        return [{"key": candidate["key"], "verdict": "reject"} for candidate in candidates]

    result = await start_cycle(
        request,
        CycleHandlers(finder=_inline(finder), candidate_evaluator=_inline(evaluator)),
        store=MemoryCycleStore(),
        lease=_lease(),
        clock=lambda: STARTED_AT,
    )
    fault_matrix = [entry.to_dict() for entry in build_cycle_durable_fault_matrix()]
    fault_matrix_canonical = canonical_json(fault_matrix)
    fault_fixture = json.loads(
        (FIXTURES / "cycle-controller-fault-matrix.case.json").read_text(
            encoding="utf-8"
        )
    )
    lease_campaign = next(
        campaign
        for campaign in fault_fixture["retainedCampaigns"]
        if campaign["id"] == "lease-administration-v1alpha1"
    )
    report: dict[str, Any] = {
        "requestCanonical": canonical_json(request),
        **_event_projection(
            result,
            inputs=inputs,
            checkpoint_id="cycle-cross-language-terminal",
        ),
        "acceptedPatch": await _accepted_patch_report(
            cast(dict[str, Any], graph_document),
            graph.graph_hash,
        ),
        "resumed": await _resume_report(graph.graph_hash),
        "modes": {
            "while": await _mode_report(graph.graph_hash, "while"),
            "evaluatorOptimizer": await _mode_report(
                graph.graph_hash,
                "evaluator-optimizer",
            ),
        },
        "inDoubt": {
            "recovered": await _in_doubt_report(graph.graph_hash, exhausted=False),
            "exhausted": await _in_doubt_report(graph.graph_hash, exhausted=True),
        },
        "resolution": await _resolution_report(graph.graph_hash),
        "leaseFaultCampaign": await _lease_fault_campaign(
            graph.graph_hash,
            lease_campaign,
        ),
        "faultMatrix": {
            "eventTypes": list(CYCLE_EVENT_TYPES),
            "stages": list(CYCLE_DURABLE_FAULT_STAGES),
            "faultKinds": list(CYCLE_FAULT_KINDS),
            "matrix": fault_matrix,
            "matrixCanonical": fault_matrix_canonical,
            "matrixCanonicalUtf8Bytes": len(fault_matrix_canonical.encode("utf-8")),
            "matrixSha256": hashlib.sha256(
                fault_matrix_canonical.encode("utf-8")
            ).hexdigest(),
        },
    }
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(_main())
