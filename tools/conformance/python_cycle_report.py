"""Emit exact native-Python D7 cycle bytes for the cross-language join."""

from __future__ import annotations

import asyncio
import copy
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
    canonical_json,
    compile_graph,
    fold_cycle_events,
    resume_cycle,
    start_cycle,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"
STARTED_AT = "2026-07-26T12:00:00.000Z"
CHECKPOINT_AT = "2026-07-26T12:00:01.000Z"


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
            finder=finder,
            candidate_evaluator=evaluator,
            patch_planner=planner,
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
            CycleHandlers(finder=finder, candidate_evaluator=evaluator),
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
        CycleHandlers(finder=finder, candidate_evaluator=evaluator),
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
            finder=finder,
            candidate_evaluator=evaluator,
            condition=decide if mode == "while" else None,
            optimizer_evaluator=decide if mode != "while" else None,
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
        CycleHandlers(finder=finder, candidate_evaluator=evaluator),
        store=MemoryCycleStore(),
        lease=_lease(),
        clock=lambda: STARTED_AT,
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
    }
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(_main())
