"""Emit exact native-Python H03 activity interruption campaign evidence."""

from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path
from typing import Any, cast

from graph_engineering import (
    CycleActivityContext,
    CycleCancellation,
    CycleHandlers,
    GraphPatchLimits,
    GraphPatchRuntime,
    MemoryCycleStore,
    PatchAuthority,
    build_cycle_activity_interruption_matrix,
    build_cycle_checkpoint,
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
PHASES = (
    "finder",
    "candidate-evaluator",
    "condition",
    "optimizer-evaluator",
    "patch-planner",
)


def _binding(phase: str) -> dict[str, Any]:
    digit = str(PHASES.index(phase) + 1)
    return {
        "activityId": phase,
        "implementationHash": digit * 64,
        "sideEffects": "none",
        "maxAttemptsPerRound": 1,
        "maxCostUsdPerAttempt": 0,
        "timeoutMs": 100,
    }


def _phase_mode(phase: str | None) -> str:
    if phase == "condition":
        return "while"
    if phase == "optimizer-evaluator":
        return "evaluator-optimizer"
    return "until-dry"


def _configure_request(
    base: dict[str, Any],
    entry: dict[str, Any],
    index: int,
    graph_hash: str,
    fixture: dict[str, Any],
) -> dict[str, Any]:
    request = copy.deepcopy(base)
    suffix = f"{index:03d}"
    request.update(
        {
            "controllerRunId": f"cycle-interruption-{suffix}",
            "controllerId": f"cycle-interruption-{suffix}-controller",
            "hostRun": {
                "relationship": "standalone-child-controller",
                "runId": f"cycle-interruption-{suffix}-host",
            },
            "eventStreamId": f"cycle-interruption-{suffix}.events",
            "checkpointScope": f"cycle-interruption-{suffix}.checkpoints",
            "initialGraph": {
                "graphRevision": 1,
                "graphHash": graph_hash,
                "revisionHash": "1" * 64,
            },
        }
    )
    mode = _phase_mode(cast(str | None, entry["phase"]))
    request["policy"].update(
        {
            "mode": mode,
            "maxIterations": 2,
            "maxDurationMs": 10_000,
            "maxCostUsd": 10,
            "maxTotalAttempts": 30,
            "maxDiscoveries": 20,
            "maxDynamicNodes": 10 if entry["phase"] == "patch-planner" else 0,
            "maxCandidatesPerRound": 20,
            "maxCandidateBytes": 4_096,
            "maxCandidateBatchBytes": 16_384,
        }
    )
    if mode == "until-dry":
        request["policy"]["consecutiveDryRounds"] = 2
    else:
        request["policy"].pop("consecutiveDryRounds", None)
    request["activities"] = {
        "finder": _binding("finder"),
        "candidateEvaluator": _binding("candidate-evaluator"),
        "condition": _binding("condition") if mode == "while" else None,
        "optimizerEvaluator": (
            _binding("optimizer-evaluator")
            if mode == "evaluator-optimizer"
            else None
        ),
        "patchPlanner": (
            _binding("patch-planner")
            if entry["phase"] == "patch-planner"
            else None
        ),
    }
    request["patches"] = (
        {
            "enabled": True,
            "limits": {
                "maxNodes": 100,
                "maxEdges": 200,
                "maxOutputs": 100,
                "maxDepth": 20,
                "maxFanOut": 20,
            },
        }
        if entry["phase"] == "patch-planner"
        else {"enabled": False, "limits": None}
    )
    if entry["phase"] is not None and entry["sideEffects"] is not None:
        key = {
            "finder": "finder",
            "candidate-evaluator": "candidateEvaluator",
            "condition": "condition",
            "optimizer-evaluator": "optimizerEvaluator",
            "patch-planner": "patchPlanner",
        }[entry["phase"]]
        target = cast(dict[str, Any], request["activities"][key])
        target["sideEffects"] = entry["sideEffects"]
        target["maxCostUsdPerAttempt"] = fixture["timeoutPolicy"][
            "maxCostUsdPerAttempt"
        ]
        if entry["trigger"] == "attempt-timeout":
            target["maxAttemptsPerRound"] = fixture["timeoutPolicy"][
                "maxAttemptsPerRound"
            ]
            target["timeoutMs"] = 1
    return request


def _normal_output(
    phase: str,
    context: CycleActivityContext,
    index: int,
) -> object:
    if phase == "finder":
        return [{"key": f"candidate-{index:03d}", "value": {"source": "h03"}}]
    if phase == "candidate-evaluator":
        candidates = cast(dict[str, Any], context.input)["candidates"]
        return [
            {"key": candidate["key"], "verdict": "accept"}
            for candidate in cast(list[dict[str, Any]], candidates)
        ]
    if phase == "condition":
        return False
    if phase == "optimizer-evaluator":
        return "accept"
    suffix = f"{index:03d}"
    current = cast(dict[str, Any], context.input)["currentRevision"]
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/patches/v1alpha1",
        "kind": "GraphPatch",
        "patchId": f"cycle-interruption-patch-{suffix}",
        "base": current,
        "append": {
            "nodes": [
                {
                    "id": f"interrupt-review-{suffix}",
                    "kind": "validator",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
            ],
            "edges": [
                {
                    "id": f"interrupt-review-edge-{suffix}",
                    "from": {"node": "merge"},
                    "to": {"node": f"interrupt-review-{suffix}"},
                    "mode": "value",
                }
            ],
            "outputs": {
                f"interruptReview{suffix}": {
                    "node": f"interrupt-review-{suffix}"
                }
            },
        },
    }


def _target_outcome_type(phase: str) -> str:
    return {
        "finder": "DiscoveryCommitted",
        "candidate-evaluator": "CandidateEvaluationCommitted",
        "condition": "ModeOutcomeCommitted",
        "optimizer-evaluator": "ModeOutcomeCommitted",
        "patch-planner": "PatchAccepted",
    }[phase]


def _before_claim_settlement_ordinal(phase: str | None) -> int | None:
    if phase is None:
        return None
    return {
        "candidate-evaluator": 1,
        "condition": 2,
        "optimizer-evaluator": 2,
    }.get(phase)


def _expected_timeout_calls(
    entry: dict[str, Any],
    fixture: dict[str, Any],
) -> int:
    if entry["sideEffects"] in fixture["timeoutPolicy"]["nonRetryableSideEffects"]:
        return 1
    return cast(int, fixture["timeoutPolicy"]["maxAttemptsPerRound"])


def _target_in_doubt_count(entry: dict[str, Any]) -> int:
    if entry["sideEffects"] in {None, "none"}:
        return 0
    if entry["trigger"] in {
        "during-handler",
        "after-handler-before-outcome",
        "attempt-timeout",
    }:
        return 1
    return 0


def _event_document(event: Any) -> dict[str, Any]:
    return cast(dict[str, Any], event.model_dump(mode="json", by_alias=True))


def _activity_path(events: tuple[Any, ...]) -> list[dict[str, Any]]:
    path: list[dict[str, Any]] = []
    for event in events:
        phase = None
        if event.type in {"ActivityStarted", "BudgetReservationSettled"}:
            phase = event.data["phase"]
        elif event.type == "ActivityFailed":
            phase = event.data["failure"]["phase"]
        path.append({"type": event.type, "phase": phase})
    return path


async def _exercise_entry(
    *,
    graph_document: dict[str, Any],
    graph_hash: str,
    base_request: dict[str, Any],
    fixture: dict[str, Any],
    entry: dict[str, Any],
    index: int,
) -> dict[str, Any]:
    request = _configure_request(base_request, entry, index, graph_hash, fixture)
    store = MemoryCycleStore()
    cancellation = CycleCancellation()
    handler_calls = dict.fromkeys(PHASES, 0)
    repeated_cancellation_count = 0
    settlement_count = 0

    def fault_hook(boundary: str) -> None:
        nonlocal settlement_count
        if boundary == "event:BudgetReservationSettled:after-state-before-dispatch":
            settlement_count += 1
        if entry["trigger"] == "before-claim" and (
            (
                entry["phase"] == "finder"
                and boundary == "event:RoundReserved:after-state-before-dispatch"
            ) or (
                entry["phase"] == "patch-planner"
                and boundary
                == "event:ModeOutcomeCommitted:after-state-before-dispatch"
            ) or (
                _before_claim_settlement_ordinal(entry["phase"]) == settlement_count
                and boundary
                == "event:BudgetReservationSettled:after-state-before-dispatch"
            )
        ):
            cancellation.cancel()
        if (
            entry["trigger"] == "after-outcome-before-next-dispatch"
            and entry["phase"] is not None
            and boundary
            == (
                f"event:{_target_outcome_type(entry['phase'])}:"
                "after-state-before-dispatch"
            )
        ):
            cancellation.cancel()
        if (
            entry["trigger"] == "after-round-commit"
            and boundary == "event:RoundCommitted:after-state-before-dispatch"
        ):
            cancellation.cancel()

    def make_handler(phase: str) -> Any:
        async def handler(context: CycleActivityContext) -> object:
            nonlocal repeated_cancellation_count
            handler_calls[phase] += 1
            if entry["phase"] == phase and entry["trigger"] in {
                "during-handler",
                "repeated-cancellation",
            }:
                cancellation.cancel()
                repeated_cancellation_count += 1
                if entry["trigger"] == "repeated-cancellation":
                    cancellation.cancel()
                    repeated_cancellation_count += 1
                await asyncio.Future()
            if entry["phase"] == phase and entry["trigger"] == "attempt-timeout":
                await asyncio.Future()
            output = (
                []
                if entry["trigger"] == "after-round-commit" and phase == "finder"
                else _normal_output(phase, context, index)
            )
            if (
                entry["phase"] == phase
                and entry["trigger"] == "after-handler-before-outcome"
            ):
                cancellation.cancel()
            return output

        return handler

    if entry["trigger"] == "before-first-round":
        cancellation.cancel()
    patch_runtime = None
    patch_authority = None
    if entry["phase"] == "patch-planner":
        graph = compile_graph(graph_document)
        patch_runtime = GraphPatchRuntime(
            graph,
            revision_hash_value="1" * 64,
            limits=GraphPatchLimits.model_validate(request["patches"]["limits"]),
            succeeded_nodes=frozenset({"merge"}),
        )
        patch_authority = PatchAuthority(
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
    handlers = CycleHandlers(
        finder=make_handler("finder"),
        candidate_evaluator=make_handler("candidate-evaluator"),
        condition=(
            make_handler("condition")
            if request["policy"]["mode"] == "while"
            else None
        ),
        optimizer_evaluator=(
            make_handler("optimizer-evaluator")
            if request["policy"]["mode"] == "evaluator-optimizer"
            else None
        ),
        patch_planner=(
            make_handler("patch-planner")
            if entry["phase"] == "patch-planner"
            else None
        ),
    )
    result = await start_cycle(
        request,
        handlers,
        store=store,
        lease={
            "leaseId": f"{request['controllerRunId']}-lease-1",
            "holderId": "cycle-interruption-holder",
            "leaseEpoch": 1,
            "fencingToken": 1,
            "acquiredAt": STARTED_AT,
            "expiresAt": "2026-07-26T12:01:00.000Z",
        },
        clock=lambda: STARTED_AT,
        cancellation=cancellation,
        fault_hook=fault_hook,
        patch_runtime=patch_runtime,
        patch_authority=patch_authority,
        patch_each_round=entry["phase"] == "patch-planner",
    )
    events = await store.read(request["eventStreamId"])
    fold = fold_cycle_events(events, require_terminal=True)
    expected_exit = "FAILED" if entry["trigger"] == "attempt-timeout" else "CANCELLED"
    assert result.result["exitReason"] == expected_exit
    assert result.result["status"] == (
        "failed" if expected_exit == "FAILED" else "cancelled"
    )
    assert events[-1].type == "ControllerTerminated"
    assert sum(event.type == "ControllerTerminated" for event in events) == 1
    if entry["trigger"] == "before-first-round":
        assert not any(event.type == "RoundReserved" for event in events)
        assert not any(event.type == "ActivityStarted" for event in events)
        assert result.result["attemptsUsed"] == 0
    if entry["trigger"] == "after-round-commit":
        assert sum(event.type == "RoundCommitted" for event in events) == 1
        assert result.result["consecutiveDryRounds"] == 1
    if entry["phase"] is not None:
        starts = [
            event
            for event in events
            if event.type == "ActivityStarted"
            and event.data["phase"] == entry["phase"]
        ]
        outcomes = [
            event
            for event in events
            if event.type == _target_outcome_type(entry["phase"])
        ]
        failures = [
            event
            for event in events
            if event.type == "ActivityFailed"
            and cast(dict[str, Any], event.data["failure"])["phase"]
            == entry["phase"]
        ]
        phase_settlements = [
            event
            for event in events
            if event.type == "BudgetReservationSettled"
            and event.data["phase"] == entry["phase"]
        ]
        if entry["trigger"] == "before-claim":
            assert handler_calls[entry["phase"]] == 0
            assert not starts
            assert not phase_settlements
        elif entry["trigger"] == "attempt-timeout":
            expected_calls = _expected_timeout_calls(entry, fixture)
            assert handler_calls[entry["phase"]] == expected_calls
            assert len(starts) == expected_calls
            assert len(failures) == expected_calls
            assert len(phase_settlements) == expected_calls
            assert not outcomes
            for failure in failures:
                failure_detail = cast(dict[str, Any], failure.data["failure"])
                usage = cast(dict[str, Any], failure.data["usage"])
                assert (
                    failure_detail["code"]
                    == fixture["timeoutPolicy"]["stableFailureCode"]
                )
                assert failure_detail["retryable"] is True
                assert (
                    failure_detail["inDoubt"]
                    is (entry["sideEffects"] != "none")
                )
                assert (
                    usage["costUsd"]
                    == fixture["timeoutPolicy"]["maxCostUsdPerAttempt"]
                )
            for settlement in phase_settlements:
                assert settlement.data["committed"] == {
                    "attempts": 1,
                    "costUsd": fixture["timeoutPolicy"]["maxCostUsdPerAttempt"],
                    "dynamicNodes": 0,
                }
            assert result.result["costUsd"] == (
                expected_calls
                * fixture["timeoutPolicy"]["maxCostUsdPerAttempt"]
            )
            terminal_observation = cast(
                dict[str, Any], fold.state["terminalObservation"]
            )
            assert (
                terminal_observation["failureCode"]
                == fixture["timeoutPolicy"]["stableFailureCode"]
            )
        else:
            assert handler_calls[entry["phase"]] == 1
            assert len(starts) == 1
            assert not failures
            assert len(phase_settlements) == 1
            expected_dynamic_nodes = int(
                entry["phase"] == "patch-planner"
                and entry["trigger"] == "after-outcome-before-next-dispatch"
            )
            expected_settlement = {
                "attempts": 1,
                "costUsd": fixture["timeoutPolicy"]["maxCostUsdPerAttempt"],
                "dynamicNodes": expected_dynamic_nodes,
            }
            assert phase_settlements[0].data["committed"] == expected_settlement, (
                entry["id"],
                phase_settlements[0].data["committed"],
            )
            assert (
                result.result["costUsd"]
                == fixture["timeoutPolicy"]["maxCostUsdPerAttempt"]
            )
            assert len(outcomes) == int(
                entry["trigger"] == "after-outcome-before-next-dispatch"
            )
        in_doubt = cast(list[dict[str, Any]], fold.state["inDoubtActivities"])
        assert len(in_doubt) == _target_in_doubt_count(entry)
        if (
            entry["trigger"] == "after-outcome-before-next-dispatch"
            and entry["phase"] == "patch-planner"
        ):
            assert result.result["lastGraphRevision"] == 2
        if (
            entry["trigger"] == "after-outcome-before-next-dispatch"
            and entry["phase"] == "finder"
        ):
            assert result.result["seenCount"] == 1
        if (
            entry["trigger"] == "after-outcome-before-next-dispatch"
            and entry["phase"] == "candidate-evaluator"
        ):
            assert result.result["acceptedCount"] == 1
    if entry["trigger"] != "after-round-commit":
        assert not any(event.type == "RoundCommitted" for event in events)
        assert result.result["consecutiveDryRounds"] == 0
    if entry["trigger"] == "repeated-cancellation":
        assert repeated_cancellation_count == 2
        assert sum(event.type == "ControllerTerminated" for event in events) == 1

    replayed = await replay_cycle(request["eventStreamId"], store=store)
    assert replayed.result == result.result
    appends_before_terminal_resume = store.append_count
    terminal_handler_calls = 0
    terminal_clock_calls = 0

    def forbidden(_: object) -> object:
        nonlocal terminal_handler_calls
        terminal_handler_calls += 1
        raise AssertionError(f"{entry['id']}: terminal resume dispatched a handler")

    def terminal_clock() -> str:
        nonlocal terminal_clock_calls
        terminal_clock_calls += 1
        raise AssertionError(f"{entry['id']}: terminal resume sampled the clock")

    terminal = await resume_cycle(
        request,
        CycleHandlers(
            finder=forbidden,
            candidate_evaluator=forbidden,
            condition=forbidden,
            optimizer_evaluator=forbidden,
            patch_planner=forbidden,
        ),
        store=store,
        expected_version=len(events) - 1,
        lease={
            "leaseId": f"{request['controllerRunId']}-lease-2",
            "holderId": "cycle-interruption-terminal-holder",
            "leaseEpoch": 2,
            "fencingToken": 2,
            "acquiredAt": STARTED_AT,
            "expiresAt": "2026-07-26T12:02:00.000Z",
        },
        clock=terminal_clock,
    )
    assert terminal.result == result.result
    assert store.append_count == appends_before_terminal_resume
    assert terminal_handler_calls == 0
    assert terminal_clock_calls == 0
    checkpoint = build_cycle_checkpoint(
        fold,
        checkpoint_id=f"{request['controllerRunId']}-terminal",
        created_at=CHECKPOINT_AT,
    )
    event_documents = [_event_document(event) for event in events]
    return {
        "entry": entry,
        "resultCanonical": canonical_json(result.result),
        "eventTypes": [event.type for event in events],
        "eventCanonical": [canonical_json(event) for event in event_documents],
        "recordHashes": [event.record_hash for event in events],
        "activityPath": _activity_path(events),
        "handlerCalls": handler_calls,
        "repeatedCancellationCount": repeated_cancellation_count,
        "failures": [
            event.data for event in events if event.type == "ActivityFailed"
        ],
        "settlements": [
            event.data
            for event in events
            if event.type == "BudgetReservationSettled"
        ],
        "inDoubtActivities": cast(
            list[dict[str, Any]], fold.state["inDoubtActivities"]
        ),
        "checkpointCanonical": canonical_json(checkpoint),
        "terminalResumeZeroWrite": True,
        "terminalResumeHandlerCalls": terminal_handler_calls,
        "terminalResumeClockCalls": terminal_clock_calls,
    }


async def _main() -> None:
    fixture = json.loads(
        (
            FIXTURES / "cycle-controller-activity-interruption.case.json"
        ).read_text(encoding="utf-8")
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
    matrix = [
        entry.to_dict() for entry in build_cycle_activity_interruption_matrix()
    ]
    assert len(matrix) == fixture["expect"]["matrixEntryCount"]
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
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(_main())
