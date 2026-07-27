"""Emit independent native-Python D7-H05B GraphPatch semantic evidence."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, cast

from graph_engineering import (
    CycleRuntimeError,
    GraphPatchLimits,
    GraphPatchRuntime,
    PatchAuthority,
    PatchDecision,
    PatchReservation,
    canonical_json,
    compile_graph,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"


def _sha256(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def _category_counts(cases: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for attack in cases:
        category = cast(str, attack["category"])
        counts[category] = counts.get(category, 0) + 1
    return dict(sorted(counts.items()))


def _node(node_id: str, **overrides: object) -> dict[str, Any]:
    value: dict[str, Any] = {
        "id": node_id,
        "kind": "validator",
        "inputSchema": {},
        "outputSchema": {},
        "config": {},
        "sideEffects": "none",
    }
    value.update(overrides)
    return value


def _patch(
    coordinate: dict[str, Any],
    patch_id: str,
    node_id: str,
    *,
    nodes: list[dict[str, Any]] | None = None,
    edges: list[dict[str, Any]] | None = None,
    outputs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/patches/v1alpha1",
        "kind": "GraphPatch",
        "patchId": patch_id,
        "base": copy.deepcopy(coordinate),
        "append": {
            "nodes": nodes if nodes is not None else [_node(node_id)],
            "edges": edges
            if edges is not None
            else [
                {
                    "id": f"{patch_id}-edge",
                    "from": {"node": "merge"},
                    "to": {"node": node_id},
                    "mode": "value",
                }
            ],
            "outputs": outputs
            if outputs is not None
            else {f"{node_id}Result": {"node": node_id}},
        },
    }


def _authority(*capabilities: str) -> PatchAuthority:
    return PatchAuthority(
        proposer_activity_key="1" * 64,
        principal_hash="2" * 64,
        proposer_grant_hash="3" * 64,
        run_grant_hash="4" * 64,
        tenant_grant_hash="5" * 64,
        deployment_grant_hash="6" * 64,
        effective_grant_hash="7" * 64,
        policy_hash="8" * 64,
        approval_hash=None,
        allowed_capabilities=frozenset(capabilities),
    )


def _limits(**overrides: int) -> GraphPatchLimits:
    values = {
        "maxNodes": 100,
        "maxEdges": 200,
        "maxOutputs": 100,
        "maxDepth": 20,
        "maxFanOut": 20,
    }
    aliases = {
        "max_nodes": "maxNodes",
        "max_edges": "maxEdges",
        "max_outputs": "maxOutputs",
        "max_depth": "maxDepth",
        "max_fan_out": "maxFanOut",
    }
    for name, value in overrides.items():
        values[aliases[name]] = value
    return GraphPatchLimits.model_validate(values)


def _runtime(
    graph_document: dict[str, Any],
    *,
    succeeded_nodes: frozenset[str] = frozenset({"merge"}),
    max_dynamic_nodes: int = 10,
    limit_overrides: dict[str, int] | None = None,
) -> GraphPatchRuntime:
    return GraphPatchRuntime(
        compile_graph(graph_document),
        revision_hash_value="1" * 64,
        limits=_limits(**(limit_overrides or {})),
        succeeded_nodes=succeeded_nodes,
        max_dynamic_nodes=max_dynamic_nodes,
    )


def _reservation(
    *,
    attempts: int = 1,
    dynamic_nodes: int = 10,
) -> PatchReservation:
    return PatchReservation(
        "hostile-semantic-reservation",
        attempts,
        0,
        dynamic_nodes,
    )


async def _accept(_: PatchDecision) -> None:
    return None


def _normalized_decision(decision: PatchDecision) -> dict[str, Any]:
    resulting_coordinate: dict[str, Any] | None = None
    if decision.outcome == "accepted":
        assert decision.resulting_revision is not None
        body = cast(dict[str, Any], decision.resulting_revision["body"])
        resulting_coordinate = {
            "graphRevision": body["graphRevision"],
            "graphHash": body["graphHash"],
            "revisionHash": decision.resulting_revision["revisionHash"],
        }
    return {
        "patchId": decision.patch_id,
        "patchHash": decision.patch_hash,
        "patchCanonicalUtf8Bytes": len(decision.canonical_json.encode()),
        "outcome": decision.outcome,
        "errorCode": decision.error_code.value if decision.error_code is not None else None,
        "diagnosticCodes": sorted({issue.code for issue in decision.diagnostics}),
        "requestedBase": decision.requested_base,
        "budgetOutcome": decision.budget_outcome,
        "resultingCoordinate": resulting_coordinate,
        "authoritySnapshotHash": _sha256(decision.authority_snapshot),
        "policySnapshotHash": decision.policy_snapshot_hash,
    }


def _scenario_input(
    coordinate: dict[str, Any],
    attack: dict[str, Any],
) -> tuple[
    dict[str, Any],
    frozenset[str],
    PatchReservation,
    int,
    dict[str, int],
]:
    suffix = cast(str, attack["id"])
    node_id = f"{suffix}-node"
    proposal = _patch(coordinate, f"semantic-{suffix}", node_id)
    succeeded_nodes = frozenset({"merge"})
    reservation = _reservation()
    max_dynamic_nodes = 10
    limit_overrides: dict[str, int] = {}
    scenario = attack["scenario"]
    append = cast(dict[str, Any], proposal["append"])
    nodes = cast(list[dict[str, Any]], append["nodes"])
    edges = cast(list[dict[str, Any]], append["edges"])
    if scenario == "stale-base":
        cast(dict[str, Any], proposal["base"])["graphRevision"] += 1
    elif scenario == "duplicate-existing-node":
        nodes[0]["id"] = "split"
        cast(dict[str, Any], edges[0]["to"])["node"] = "split"
        append["outputs"] = {"duplicateNode": {"node": "split"}}
    elif scenario == "duplicate-new-node":
        nodes.append(copy.deepcopy(nodes[0]))
    elif scenario == "duplicate-existing-edge":
        edges[0]["id"] = "left-merge"
    elif scenario == "duplicate-new-edge":
        edges.append(copy.deepcopy(edges[0]))
    elif scenario == "duplicate-existing-output":
        append["outputs"] = {"result": {"node": node_id}}
    elif scenario == "incoming-existing-target":
        cast(dict[str, Any], edges[0]["to"])["node"] = "left"
    elif scenario == "source-not-succeeded":
        succeeded_nodes = frozenset()
    elif scenario == "unsupported-stream-edge":
        edges[0]["mode"] = "stream"
    elif scenario == "config-capability-expansion":
        nodes[0]["config"] = {"capabilities": ["network"]}
    elif scenario == "resource-capability-expansion":
        nodes[0]["resources"] = {"capabilities": ["network"]}
    elif scenario == "zero-dynamic-reservation":
        reservation = _reservation(dynamic_nodes=0)
    elif scenario == "runtime-dynamic-limit":
        max_dynamic_nodes = 0
    elif scenario == "maximum-node-limit":
        limit_overrides = {"max_nodes": 4}
    elif scenario == "maximum-edge-limit":
        limit_overrides = {"max_edges": 4}
    elif scenario == "maximum-output-limit":
        limit_overrides = {"max_outputs": 1}
    elif scenario == "maximum-depth-limit":
        limit_overrides = {"max_depth": 3}
    elif scenario == "maximum-fanout-limit":
        limit_overrides = {"max_fan_out": 1}
    elif scenario == "candidate-cycle":
        left = f"{suffix}-left"
        right = f"{suffix}-right"
        append["nodes"] = [_node(left), _node(right)]
        append["edges"] = [
            {
                "id": f"{suffix}-entry",
                "from": {"node": "merge"},
                "to": {"node": left},
                "mode": "value",
            },
            {
                "id": f"{suffix}-forward",
                "from": {"node": left},
                "to": {"node": right},
                "mode": "value",
            },
            {
                "id": f"{suffix}-cycle",
                "from": {"node": right},
                "to": {"node": left},
                "mode": "value",
            },
        ]
        append["outputs"] = {"cycleResult": {"node": right}}
    else:  # pragma: no cover - fixture vocabulary is closed below
        raise AssertionError(f"unsupported semantic decision scenario {scenario!r}")
    return proposal, succeeded_nodes, reservation, max_dynamic_nodes, limit_overrides


async def _decision_case(
    graph_document: dict[str, Any],
    coordinate: dict[str, Any],
    attack: dict[str, Any],
    index: int,
) -> dict[str, Any]:
    proposal, succeeded, reservation, maximum, limit_overrides = _scenario_input(
        coordinate,
        attack,
    )
    input_canonical = canonical_json(proposal)
    runtime = _runtime(
        graph_document,
        succeeded_nodes=succeeded,
        max_dynamic_nodes=maximum,
        limit_overrides=limit_overrides,
    )
    before_coordinate = runtime.coordinate
    decision = await runtime.apply(
        proposal,
        authority=_authority(),
        policy_snapshot_hash="8" * 64,
        reservation=reservation,
        dry_run=True,
    )
    assert decision.outcome == attack["expectOutcome"]
    assert decision.error_code is not None
    assert decision.error_code.value == attack["expectCode"]
    assert runtime.coordinate == before_coordinate
    assert runtime.dynamic_nodes == 0
    assert runtime.decision_count == 0
    return {
        "index": index,
        "id": attack["id"],
        "category": attack["category"],
        "scenario": attack["scenario"],
        "kind": "decision",
        "inputCanonicalUtf8Bytes": len(input_canonical.encode()),
        "inputSha256": hashlib.sha256(input_canonical.encode()).hexdigest(),
        "decision": _normalized_decision(decision),
        "beforeCoordinate": before_coordinate,
        "afterCoordinate": runtime.coordinate,
        "decisionCount": 0,
        "dynamicNodes": 0,
        "graphNodeCount": len(cast(list[Any], graph_document["nodes"])),
    }


def _rejected_proposal(coordinate: dict[str, Any], patch_id: str) -> dict[str, Any]:
    proposal = _patch(coordinate, patch_id, f"{patch_id}-node")
    nodes = cast(list[dict[str, Any]], cast(dict[str, Any], proposal["append"])["nodes"])
    nodes[0]["config"] = {"capabilities": ["network"]}
    return proposal


async def _behavior_case(
    graph_document: dict[str, Any],
    coordinate: dict[str, Any],
    attack: dict[str, Any],
    index: int,
) -> dict[str, Any]:
    runtime = _runtime(graph_document)
    scenario = attack["scenario"]
    observations: dict[str, Any]
    if scenario == "exact-rejected-retry":
        proposal = _rejected_proposal(coordinate, "semantic-retry-rejected")
        first = await runtime.apply(
            proposal,
            authority=_authority(),
            policy_snapshot_hash="8" * 64,
            reservation=_reservation(),
            record=_accept,
        )
        retry = await runtime.apply(
            proposal,
            authority=_authority("network"),
            policy_snapshot_hash="8" * 64,
            reservation=_reservation(),
            record=_accept,
        )
        observations = {
            "first": _normalized_decision(first),
            "retry": _normalized_decision(retry),
            "decisionsEqual": retry is first,
            "decisionCount": runtime.decision_count,
            "runtimeRevision": runtime.coordinate["graphRevision"],
            "dynamicNodes": runtime.dynamic_nodes,
        }
    elif scenario == "changed-decided-id":
        proposal = _rejected_proposal(coordinate, "semantic-changed-id")
        first = await runtime.apply(
            proposal,
            authority=_authority(),
            policy_snapshot_hash="8" * 64,
            reservation=_reservation(),
            record=_accept,
        )
        changed = copy.deepcopy(proposal)
        cast(dict[str, Any], changed["append"])["outputs"] = {
            "changedOutput": {
                "node": cast(
                    list[dict[str, Any]], cast(dict[str, Any], changed["append"])["nodes"]
                )[0]["id"]
            }
        }
        observed_code: str | None = None
        try:
            await runtime.apply(
                changed,
                authority=_authority("network"),
                policy_snapshot_hash="8" * 64,
                reservation=_reservation(),
                record=_accept,
            )
        except CycleRuntimeError as exc:
            observed_code = exc.code.value
        assert observed_code == attack["expectCode"]
        observations = {
            "first": _normalized_decision(first),
            "conflictCode": observed_code,
            "decisionCount": runtime.decision_count,
            "runtimeRevision": runtime.coordinate["graphRevision"],
            "dynamicNodes": runtime.dynamic_nodes,
        }
    elif scenario == "historical-accepted-retry":
        first_proposal = _patch(coordinate, "semantic-history-first", "history-first-node")
        first = await runtime.apply(
            first_proposal,
            authority=_authority(),
            policy_snapshot_hash="8" * 64,
            reservation=_reservation(),
            record=_accept,
        )
        second_proposal = _patch(
            cast(dict[str, Any], runtime.coordinate),
            "semantic-history-second",
            "history-second-node",
        )
        second = await runtime.apply(
            second_proposal,
            authority=_authority(),
            policy_snapshot_hash="8" * 64,
            reservation=_reservation(),
            record=_accept,
        )
        retry = await runtime.apply(
            first_proposal,
            authority=_authority(),
            policy_snapshot_hash="8" * 64,
            reservation=_reservation(),
            record=_accept,
        )
        observations = {
            "first": _normalized_decision(first),
            "second": _normalized_decision(second),
            "retry": _normalized_decision(retry),
            "retryEqualsFirst": retry is first,
            "decisionCount": runtime.decision_count,
            "runtimeRevision": runtime.coordinate["graphRevision"],
            "dynamicNodes": runtime.dynamic_nodes,
        }
    elif scenario == "dry-run-id-reuse":
        dry_proposal = _patch(coordinate, "semantic-dry-reuse", "dry-first-node")
        dry = await runtime.apply(
            dry_proposal,
            authority=_authority(),
            policy_snapshot_hash="8" * 64,
            reservation=_reservation(),
            dry_run=True,
        )
        after_dry = {
            "decisionCount": runtime.decision_count,
            "runtimeRevision": runtime.coordinate["graphRevision"],
            "dynamicNodes": runtime.dynamic_nodes,
        }
        real_proposal = _patch(coordinate, "semantic-dry-reuse", "dry-real-node")
        real = await runtime.apply(
            real_proposal,
            authority=_authority(),
            policy_snapshot_hash="8" * 64,
            reservation=_reservation(),
            record=_accept,
        )
        observations = {
            "dry": _normalized_decision(dry),
            "afterDry": after_dry,
            "real": _normalized_decision(real),
            "decisionCount": runtime.decision_count,
            "runtimeRevision": runtime.coordinate["graphRevision"],
            "dynamicNodes": runtime.dynamic_nodes,
        }
    elif scenario == "same-base-one-winner":
        first_proposal = _patch(coordinate, "semantic-race-first", "race-first-node")
        second_proposal = _patch(coordinate, "semantic-race-second", "race-second-node")
        first = await runtime.apply(
            first_proposal,
            authority=_authority(),
            policy_snapshot_hash="8" * 64,
            reservation=_reservation(),
            record=_accept,
        )
        second = await runtime.apply(
            second_proposal,
            authority=_authority(),
            policy_snapshot_hash="8" * 64,
            reservation=_reservation(),
            record=_accept,
        )
        decisions = [_normalized_decision(first), _normalized_decision(second)]
        observations = {
            "decisions": decisions,
            "acceptedCount": sum(item["outcome"] == "accepted" for item in decisions),
            "staleCount": sum(
                item["errorCode"] == "GE_PATCH_STALE_BASE" for item in decisions
            ),
            "decisionCount": runtime.decision_count,
            "runtimeRevision": runtime.coordinate["graphRevision"],
            "dynamicNodes": runtime.dynamic_nodes,
        }
    else:  # pragma: no cover - fixture vocabulary is closed below
        raise AssertionError(f"unsupported semantic behavior scenario {scenario!r}")
    return {
        "index": index,
        "id": attack["id"],
        "category": attack["category"],
        "scenario": scenario,
        "kind": "behavior",
        "observations": observations,
    }


async def build_report() -> dict[str, Any]:
    fixture = cast(
        dict[str, Any],
        json.loads((FIXTURES / "graph-patch-hostile-semantic.case.json").read_text()),
    )
    graph_document = cast(
        dict[str, Any],
        json.loads((FIXTURES / cast(str, fixture["baseGraph"])).read_text()),
    )
    cases = cast(list[dict[str, Any]], fixture["cases"])
    expected = cast(dict[str, Any], fixture["expect"])
    assert fixture["schemaVersion"] == 1
    assert fixture["id"] == "graph-patch-hostile-semantic-v1alpha1"
    assert len(cases) == expected["caseCount"]
    assert len({cast(str, attack["id"]) for attack in cases}) == len(cases)
    assert len({cast(str, attack["scenario"]) for attack in cases}) == len(cases)
    assert _category_counts(cases) == expected["categoryCounts"]
    assert sum(attack["expectOutcome"] == "rejected" for attack in cases) == expected[
        "decisionCaseCount"
    ]
    assert sum(attack["expectOutcome"] != "rejected" for attack in cases) == expected[
        "behaviorCaseCount"
    ]
    cases_canonical = canonical_json(cases)
    assert len(cases_canonical.encode()) == expected["casesCanonicalUtf8Bytes"]
    assert hashlib.sha256(cases_canonical.encode()).hexdigest() == expected["casesSha256"]
    base_runtime = _runtime(graph_document)
    coordinate = base_runtime.coordinate

    outcomes: list[dict[str, Any]] = []
    for index, attack in enumerate(cases):
        if attack["expectOutcome"] == "rejected":
            outcomes.append(await _decision_case(graph_document, coordinate, attack, index))
        else:
            outcomes.append(await _behavior_case(graph_document, coordinate, attack, index))
    return {
        "campaignId": fixture["id"],
        "caseCount": len(outcomes),
        "decisionCaseCount": expected["decisionCaseCount"],
        "behaviorCaseCount": expected["behaviorCaseCount"],
        "categoryCounts": _category_counts(cases),
        "casesCanonicalUtf8Bytes": len(cases_canonical.encode()),
        "casesSha256": hashlib.sha256(cases_canonical.encode()).hexdigest(),
        "requiredAssertions": fixture["requiredAssertions"],
        "outcomes": outcomes,
    }


if __name__ == "__main__":
    print(canonical_json(asyncio.run(build_report())))
