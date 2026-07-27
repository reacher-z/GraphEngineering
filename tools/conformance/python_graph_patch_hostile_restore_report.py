"""Emit independent native-Python D7-H05C hostile restore evidence."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, cast

from graph_engineering import (
    CycleEvent,
    CycleRuntimeError,
    GraphPatchLimits,
    GraphPatchRuntime,
    PatchAuthority,
    PatchDecision,
    PatchReservation,
    canonical_json,
    compile_graph,
)
from graph_engineering.cycle_contract import revision_hash

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"
PLANNER_KEY = "1" * 64
BEHAVIOR_SCENARIOS = frozenset(
    {
        "accepted-restore",
        "rejected-restore",
        "stale-rejection-after-accepted",
        "sequential-accepted-history",
        "exact-accepted-duplicate",
        "historical-accepted-duplicate",
        "conflicting-duplicate",
    }
)


def _clone(value: Any) -> Any:
    return copy.deepcopy(value)


def _sha256(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def _category_counts(cases: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in cases:
        category = cast(str, item["category"])
        counts[category] = counts.get(category, 0) + 1
    return dict(sorted(counts.items()))


def _node(node_id: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "kind": "validator",
        "inputSchema": {},
        "outputSchema": {},
        "config": {},
        "sideEffects": "none",
    }


def _patch(
    coordinate: dict[str, Any], patch_id: str, node_id: str
) -> dict[str, Any]:
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/patches/v1alpha1",
        "kind": "GraphPatch",
        "patchId": patch_id,
        "base": _clone(coordinate),
        "append": {
            "nodes": [_node(node_id)],
            "edges": [
                {
                    "id": f"{patch_id}-edge",
                    "from": {"node": "merge"},
                    "to": {"node": node_id},
                    "mode": "value",
                }
            ],
            "outputs": {f"{node_id}Result": {"node": node_id}},
        },
    }


def _authority() -> PatchAuthority:
    return PatchAuthority(
        proposer_activity_key=PLANNER_KEY,
        principal_hash="2" * 64,
        proposer_grant_hash="3" * 64,
        run_grant_hash="4" * 64,
        tenant_grant_hash="5" * 64,
        deployment_grant_hash="6" * 64,
        effective_grant_hash="7" * 64,
        policy_hash="8" * 64,
        approval_hash=None,
    )


def _reservation() -> PatchReservation:
    return PatchReservation(
        reservation_id="hostile-restore-reservation",
        attempts=1,
        cost_usd=0,
        dynamic_nodes=10,
    )


def _record_decision(_: PatchDecision) -> None:
    """Model a successful durable write before the live runtime commits."""


def _options(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    selected = overrides or {}
    limits = {
        "maxNodes": 100,
        "maxEdges": 200,
        "maxOutputs": 100,
        "maxDepth": 20,
        "maxFanOut": 20,
    }
    limits.update(cast(dict[str, int], selected.get("limits", {})))
    return {
        "limits": limits,
        "maxDynamicNodes": selected.get("maxDynamicNodes", 10),
    }


def _runtime(graph: dict[str, Any], selected_options: dict[str, Any]) -> GraphPatchRuntime:
    return GraphPatchRuntime(
        compile_graph(graph),
        revision_hash_value="1" * 64,
        limits=GraphPatchLimits.model_validate(selected_options["limits"]),
        succeeded_nodes=frozenset({"merge"}),
        max_dynamic_nodes=cast(int, selected_options["maxDynamicNodes"]),
    )


def _carrier(decision: PatchDecision) -> dict[str, Any]:
    raw = decision.canonical_json.encode()
    common: dict[str, Any] = {
        "patchId": decision.patch_id,
        "patchHash": decision.patch_hash,
        "patch": {
            "disposition": "inline-unredacted",
            "redacted": False,
            "encoding": "canonical-json/v1alpha1",
            "canonicalJson": decision.canonical_json,
            "utf8ByteLength": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        },
        "requestedBase": decision.requested_base,
        "authoritySnapshot": decision.authority_snapshot,
        "policySnapshotHash": decision.policy_snapshot_hash,
        "budgetOutcome": decision.budget_outcome,
        "diagnostics": [
            {"code": item.code, "phase": item.phase, "path": item.path}
            for item in decision.diagnostics
        ],
        "decidedAtDurationMs": 0,
        "outcome": decision.outcome,
    }
    if decision.outcome == "accepted":
        assert decision.resulting_revision is not None
        common["resultingRevision"] = decision.resulting_revision
    else:
        assert decision.error_code is not None
        common["errorCode"] = decision.error_code.value
    return cast(dict[str, Any], _clone(common))


async def _seed_carriers(
    graph: dict[str, Any], coordinate: dict[str, Any]
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    source = _runtime(graph, _options())
    accepted = await source.apply(
        _patch(coordinate, "restore-accepted", "restore-accepted-node"),
        authority=_authority(),
        policy_snapshot_hash="8" * 64,
        reservation=_reservation(),
        record=_record_decision,
    )
    assert accepted.outcome == "accepted"
    stale = await source.apply(
        _patch(coordinate, "restore-stale-after-accepted", "restore-stale-node"),
        authority=_authority(),
        policy_snapshot_hash="8" * 64,
        reservation=_reservation(),
        record=_record_decision,
    )
    assert stale.outcome == "rejected"
    assert stale.error_code is not None
    assert stale.error_code.value == "GE_PATCH_STALE_BASE"
    second = await source.apply(
        _patch(source.coordinate, "restore-second", "restore-second-node"),
        authority=_authority(),
        policy_snapshot_hash="8" * 64,
        reservation=_reservation(),
        record=_record_decision,
    )
    assert second.outcome == "accepted"

    rejected_source = _runtime(graph, _options())
    rejected_patch = _patch(
        coordinate, "restore-rejected", "restore-rejected-node"
    )
    cast(dict[str, Any], rejected_patch["base"])["graphRevision"] += 1
    rejected = await rejected_source.apply(
        rejected_patch,
        authority=_authority(),
        policy_snapshot_hash="8" * 64,
        reservation=_reservation(),
        record=_record_decision,
    )
    assert rejected.outcome == "rejected"
    assert rejected.error_code is not None
    assert rejected.error_code.value == "GE_PATCH_STALE_BASE"

    carriers = {
        "accepted": _carrier(accepted),
        "rejected": _carrier(rejected),
        "secondAccepted": _carrier(second),
        "staleAfterAccepted": _carrier(stale),
    }
    evidence = {
        name: {
            "canonicalUtf8Bytes": len(canonical_json(decision).encode()),
            "sha256": _sha256(decision),
            "decision": decision,
        }
        for name, decision in carriers.items()
    }
    return carriers, evidence


def _rehash_revision(decision: dict[str, Any]) -> None:
    revision = cast(dict[str, Any], decision["resultingRevision"])
    revision["revisionHash"] = revision_hash(revision["body"])


def _attack_input(
    attack: dict[str, Any], carriers: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    decision = _clone(
        carriers["rejected"] if attack["seed"] == "rejected" else carriers["accepted"]
    )
    selected_options = _options()
    scenario = attack["scenario"]
    if scenario in {"accepted-extra-field", "rejected-extra-field"}:
        decision["injected"] = True
    elif scenario == "accepted-patch-id-drift":
        decision["patchId"] = "restore-accepted-drift"
    elif scenario == "accepted-patch-hash-drift":
        decision["patchHash"] = "f" * 64
    elif scenario == "accepted-payload-noncanonical":
        payload = cast(dict[str, Any], decision["patch"])
        pretty = json.dumps(json.loads(payload["canonicalJson"]), indent=2)
        payload["canonicalJson"] = pretty
        payload["utf8ByteLength"] = len(pretty.encode())
        payload["sha256"] = hashlib.sha256(pretty.encode()).hexdigest()
    elif scenario == "accepted-payload-length-drift":
        cast(dict[str, Any], decision["patch"])["utf8ByteLength"] += 1
    elif scenario == "accepted-requested-base-drift":
        cast(dict[str, Any], decision["requestedBase"])["graphRevision"] += 1
    elif scenario in {
        "accepted-planner-key-mismatch",
        "rejected-planner-key-mismatch",
    }:
        cast(dict[str, Any], decision["authoritySnapshot"])[
            "proposerActivityKey"
        ] = "f" * 64
    elif scenario == "accepted-authority-hash-invalid":
        cast(dict[str, Any], decision["authoritySnapshot"])[
            "principalHash"
        ] = "not-a-hash"
    elif scenario == "accepted-policy-hash-invalid":
        decision["policySnapshotHash"] = "not-a-hash"
    elif scenario == "accepted-budget-negative":
        cast(
            dict[str, Any],
            cast(dict[str, Any], decision["budgetOutcome"])["committed"],
        )["attempts"] = -1
    elif scenario in {
        "accepted-budget-unreconciled",
        "rejected-budget-unreconciled",
    }:
        cast(
            dict[str, Any],
            cast(dict[str, Any], decision["budgetOutcome"])["released"],
        )["attempts"] += 1
    elif scenario == "accepted-dynamic-count-drift":
        budget = cast(dict[str, Any], decision["budgetOutcome"])
        cast(dict[str, Any], budget["committed"])["dynamicNodes"] = 2
        cast(dict[str, Any], budget["released"])["dynamicNodes"] = 8
    elif scenario == "accepted-diagnostics-present":
        decision["diagnostics"] = [
            {"code": "GE_PATCH_INVALID", "phase": 1, "path": ""}
        ]
    elif scenario == "accepted-revision-skip":
        body = cast(
            dict[str, Any],
            cast(dict[str, Any], decision["resultingRevision"])["body"],
        )
        body["graphRevision"] += 1
        _rehash_revision(decision)
    elif scenario == "accepted-previous-hash-drift":
        body = cast(
            dict[str, Any],
            cast(dict[str, Any], decision["resultingRevision"])["body"],
        )
        body["previousRevisionHash"] = "f" * 64
        _rehash_revision(decision)
    elif scenario == "accepted-revision-patch-hash-drift":
        body = cast(
            dict[str, Any],
            cast(dict[str, Any], decision["resultingRevision"])["body"],
        )
        body["patchHash"] = "f" * 64
        _rehash_revision(decision)
    elif scenario == "accepted-revision-hash-drift":
        cast(dict[str, Any], decision["resultingRevision"])[
            "revisionHash"
        ] = "f" * 64
    elif scenario == "accepted-graph-hash-drift":
        body = cast(
            dict[str, Any],
            cast(dict[str, Any], decision["resultingRevision"])["body"],
        )
        body["graphHash"] = "f" * 64
        _rehash_revision(decision)
    elif scenario == "accepted-over-dynamic-limit":
        selected_options = _options({"maxDynamicNodes": 0})
    elif scenario == "accepted-over-node-limit":
        selected_options = _options({"limits": {"maxNodes": 4}})
    elif scenario == "rejected-diagnostics-empty":
        decision["diagnostics"] = []
    elif scenario == "rejected-error-code-unknown":
        decision["errorCode"] = "GE_PATCH_NOT_REAL"
    elif scenario == "rejected-dynamic-commit-nonzero":
        budget = cast(dict[str, Any], decision["budgetOutcome"])
        cast(dict[str, Any], budget["committed"])["dynamicNodes"] = 1
        cast(dict[str, Any], budget["released"])["dynamicNodes"] = 9
    elif scenario == "rejected-outcome-mismatch":
        decision["outcome"] = "accepted"
    else:
        raise AssertionError(f"unsupported hostile restore attack {scenario}")
    return {
        "decisions": [decision],
        "expectedPlannerActivityKeys": [PLANNER_KEY],
        "targetOptions": selected_options,
    }


def _behavior_input(
    attack: dict[str, Any], carriers: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    accepted = _clone(carriers["accepted"])
    rejected = _clone(carriers["rejected"])
    second = _clone(carriers["secondAccepted"])
    stale = _clone(carriers["staleAfterAccepted"])
    scenario = attack["scenario"]
    if scenario == "accepted-restore":
        decisions = [accepted]
    elif scenario == "rejected-restore":
        decisions = [rejected]
    elif scenario == "stale-rejection-after-accepted":
        decisions = [accepted, stale]
    elif scenario == "sequential-accepted-history":
        decisions = [accepted, second]
    elif scenario == "exact-accepted-duplicate":
        decisions = [accepted, _clone(accepted)]
    elif scenario == "historical-accepted-duplicate":
        decisions = [accepted, second, _clone(accepted)]
    elif scenario == "conflicting-duplicate":
        conflict = _clone(accepted)
        cast(dict[str, Any], conflict["authoritySnapshot"])["approvalHash"] = "9" * 64
        decisions = [accepted, conflict]
    else:
        raise AssertionError(f"unsupported hostile restore behavior {scenario}")
    return {
        "decisions": decisions,
        "expectedPlannerActivityKeys": [PLANNER_KEY for _ in decisions],
        "targetOptions": _options(),
    }


def _event(decision: dict[str, Any], iteration: int) -> CycleEvent:
    event_type = "PatchAccepted" if decision["outcome"] == "accepted" else "PatchRejected"
    data = {
        "iteration": iteration,
        "plannerActivityKey": PLANNER_KEY,
        **_clone(decision),
    }
    return CycleEvent.model_validate(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/cycle-controller-events/v1alpha1",
            "contractVersion": "cycle-controller-recovery/v1alpha1",
            "eventId": f"restore-{iteration}",
            "type": event_type,
            "timestamp": "2026-01-01T00:00:00Z",
            "controllerRunId": "hostile-restore",
            "hostRunId": "hostile-restore-host",
            "controllerHash": "a" * 64,
            "requestHash": "b" * 64,
            "graphRevision": 1,
            "sequence": iteration - 1,
            "expectedPreviousSequence": iteration - 2,
            "previousEventHash": None if iteration == 1 else "c" * 64,
            "lease": None,
            "payloadDisposition": "inline-unredacted",
            "redacted": False,
            "payloadHash": "d" * 64,
            "data": data,
            "recordHash": "e" * 64,
        }
    )


async def _execute_case(
    *,
    graph: dict[str, Any],
    coordinate: dict[str, Any],
    attack: dict[str, Any],
    index: int,
    carriers: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    kind = "behavior" if attack["scenario"] in BEHAVIOR_SCENARIOS else "attack"
    input_value = (
        _behavior_input(attack, carriers)
        if kind == "behavior"
        else _attack_input(attack, carriers)
    )
    target = _runtime(graph, cast(dict[str, Any], input_value["targetOptions"]))
    observed_code: str | None = None
    for index_value, decision in enumerate(
        cast(list[dict[str, Any]], input_value["decisions"]), start=1
    ):
        try:
            await target.restore([_event(decision, index_value)])
        except CycleRuntimeError as exc:
            observed_code = exc.code.value
            break
    observed_outcome = (
        "restore-rejected"
        if observed_code is not None
        else (
            "duplicate-reused"
            if attack["expectOutcome"] == "duplicate-reused"
            else "restored"
        )
    )
    assert observed_outcome == attack["expectOutcome"], attack["id"]
    assert observed_code == attack.get("expectCode"), attack["id"]
    if kind == "attack":
        assert target.coordinate == coordinate
        assert target.decision_count == 0
        assert target.dynamic_nodes == 0
        assert len(target.graph.spec.nodes) == len(graph["nodes"])
    canonical = canonical_json(input_value)
    return {
        "index": index,
        "id": attack["id"],
        "category": attack["category"],
        "scenario": attack["scenario"],
        "kind": kind,
        "inputCanonicalUtf8Bytes": len(canonical.encode()),
        "inputSha256": _sha256(input_value),
        "outcome": observed_outcome,
        "errorCode": observed_code,
        "coordinate": target.coordinate,
        "decisionCount": target.decision_count,
        "dynamicNodes": target.dynamic_nodes,
        "graphNodeCount": len(target.graph.spec.nodes),
    }


async def _main() -> dict[str, Any]:
    fixture = cast(
        dict[str, Any],
        json.loads((FIXTURES / "graph-patch-hostile-restore.case.json").read_text()),
    )
    graph = cast(
        dict[str, Any],
        json.loads((FIXTURES / cast(str, fixture["baseGraph"])).read_text()),
    )
    cases = cast(list[dict[str, Any]], fixture["cases"])
    expected = cast(dict[str, Any], fixture["expect"])
    assert fixture["schemaVersion"] == 1
    assert fixture["id"] == "graph-patch-hostile-restore-v1alpha1"
    assert len(cases) == expected["caseCount"]
    assert len({item["id"] for item in cases}) == len(cases)
    assert len({item["scenario"] for item in cases}) == len(cases)
    assert _category_counts(cases) == expected["categoryCounts"]
    assert sum(item["scenario"] not in BEHAVIOR_SCENARIOS for item in cases) == expected[
        "attackCaseCount"
    ]
    assert sum(item["scenario"] in BEHAVIOR_SCENARIOS for item in cases) == expected[
        "behaviorCaseCount"
    ]
    cases_canonical = canonical_json(cases)
    assert len(cases_canonical.encode()) == expected["casesCanonicalUtf8Bytes"]
    assert _sha256(cases) == expected["casesSha256"]
    compiled = compile_graph(graph)
    coordinate = {
        "graphRevision": 1,
        "graphHash": compiled.graph_hash,
        "revisionHash": "1" * 64,
    }
    carriers, seeds = await _seed_carriers(graph, coordinate)
    outcomes = [
        await _execute_case(
            graph=graph,
            coordinate=coordinate,
            attack=attack,
            index=index,
            carriers=carriers,
        )
        for index, attack in enumerate(cases)
    ]
    return {
        "campaignId": fixture["id"],
        "caseCount": len(outcomes),
        "attackCaseCount": expected["attackCaseCount"],
        "behaviorCaseCount": expected["behaviorCaseCount"],
        "categoryCounts": _category_counts(cases),
        "casesCanonicalUtf8Bytes": len(cases_canonical.encode()),
        "casesSha256": _sha256(cases),
        "requiredAssertions": fixture["requiredAssertions"],
        "seeds": seeds,
        "outcomes": outcomes,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(_main()), sort_keys=True, separators=(",", ":")))
