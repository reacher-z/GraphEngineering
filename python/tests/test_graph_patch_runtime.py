from __future__ import annotations

import asyncio
import copy
import json
import subprocess
import sys
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any, cast

import pytest

from graph_engineering import compile_graph
from graph_engineering.cycle_contract import CycleErrorCode, CycleRuntimeError, GraphPatchLimits
from graph_engineering.graph_patch import (
    GraphPatchRuntime,
    PatchAuthority,
    PatchDecision,
    PatchReservation,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"
HASH = "a" * 64


def diamond() -> Any:
    document = json.loads((FIXTURES / "diamond.graph.json").read_text(encoding="utf-8"))
    return compile_graph(document)


def limits(**changes: int) -> GraphPatchLimits:
    document = {
        "maxNodes": 100,
        "maxEdges": 200,
        "maxOutputs": 100,
        "maxDepth": 20,
        "maxFanOut": 20,
        **changes,
    }
    return GraphPatchLimits.model_validate(document)


def authority(*capabilities: str) -> PatchAuthority:
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


def patch(
    runtime: GraphPatchRuntime,
    patch_id: str = "append-review",
    *,
    node_id: str = "review",
    edge_mode: str = "value",
    capabilities: list[str] | None = None,
) -> dict[str, Any]:
    config: dict[str, Any] = {}
    if capabilities is not None:
        config["capabilities"] = capabilities
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/patches/v1alpha1",
        "kind": "GraphPatch",
        "patchId": patch_id,
        "base": copy.deepcopy(runtime.coordinate),
        "append": {
            "nodes": [
                {
                    "id": node_id,
                    "kind": "validator",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": config,
                    "sideEffects": "none",
                }
            ],
            "edges": [
                {
                    "id": f"merge-{node_id}",
                    "from": {"node": "merge"},
                    "to": {"node": node_id},
                    "mode": edge_mode,
                }
            ],
            "outputs": {f"{node_id}Result": {"node": node_id}},
        },
    }


def reservation(dynamic_nodes: int = 10) -> PatchReservation:
    return PatchReservation("round-1", 1, 0, dynamic_nodes)


async def accept(_: PatchDecision) -> None:
    return None


def test_patch_acceptance_is_recorded_before_graph_exposure_and_retry_is_exact() -> None:
    async def scenario() -> None:
        runtime = GraphPatchRuntime(
            diamond(),
            revision_hash_value=HASH,
            limits=limits(),
            succeeded_nodes=frozenset({"merge"}),
        )
        caller = patch(runtime)
        observed_revisions: list[int] = []

        async def recorder(decision: PatchDecision) -> None:
            observed_revisions.append(cast(int, runtime.coordinate["graphRevision"]))
            assert decision.outcome == "accepted"

        decision = await runtime.apply(
            caller,
            authority=authority(),
            policy_snapshot_hash="9" * 64,
            reservation=reservation(),
            record=recorder,
        )
        caller["append"]["nodes"][0]["id"] = "caller-mutated"

        assert observed_revisions == [1]
        assert runtime.coordinate["graphRevision"] == 2
        assert runtime.graph.spec.nodes[-1].id == "review"
        assert decision.outcome == "accepted"
        assert decision.resulting_revision is not None

        exact = patch_idempotent_document(decision)
        retried = await runtime.apply(
            exact,
            authority=authority(),
            policy_snapshot_hash="0" * 64,
            reservation=reservation(),
            record=lambda _: (_ for _ in ()).throw(AssertionError("retry recorded twice")),
        )
        assert retried is decision
        assert runtime.decision_count == 1

        changed = copy.deepcopy(exact)
        changed["append"]["nodes"][0]["config"] = {"changed": True}
        with pytest.raises(CycleRuntimeError) as conflict:
            await runtime.apply(
                changed,
                authority=authority(),
                policy_snapshot_hash="9" * 64,
                reservation=reservation(),
                record=accept,
            )
        assert conflict.value.code is CycleErrorCode.PATCH_IDEMPOTENCY_CONFLICT

    asyncio.run(scenario())


def patch_idempotent_document(decision: PatchDecision) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(decision.canonical_json))


def test_dry_run_repeats_gates_without_decision_budget_or_graph_mutation() -> None:
    async def scenario() -> None:
        runtime = GraphPatchRuntime(
            diamond(),
            revision_hash_value=HASH,
            limits=limits(),
            succeeded_nodes=frozenset({"merge"}),
        )
        document = patch(runtime)
        before = copy.deepcopy(runtime.coordinate)
        decision = await runtime.apply(
            document,
            authority=authority(),
            policy_snapshot_hash="9" * 64,
            reservation=reservation(),
            dry_run=True,
        )
        assert decision.outcome == "accepted"
        assert decision.dry_run
        assert runtime.coordinate == before
        assert runtime.decision_count == 0
        assert all(node.id != "review" for node in runtime.graph.spec.nodes)

    asyncio.run(scenario())


def test_recorder_failure_keeps_graph_and_patch_id_unmodified() -> None:
    async def scenario() -> None:
        runtime = GraphPatchRuntime(
            diamond(),
            revision_hash_value=HASH,
            limits=limits(),
            succeeded_nodes=frozenset({"merge"}),
        )

        async def fail(_: PatchDecision) -> None:
            raise OSError("event store down")

        with pytest.raises(OSError, match="event store down"):
            await runtime.apply(
                patch(runtime),
                authority=authority(),
                policy_snapshot_hash="9" * 64,
                reservation=reservation(),
                record=fail,
            )
        assert runtime.coordinate["graphRevision"] == 1
        assert runtime.decision_count == 0

        accepted = await runtime.apply(
            patch(runtime),
            authority=authority(),
            policy_snapshot_hash="9" * 64,
            reservation=reservation(),
            record=accept,
        )
        assert accepted.outcome == "accepted"

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("mutation", "code"),
    [
        ("incoming-existing", CycleErrorCode.PATCH_STATE_CONFLICT),
        ("existing-source-not-succeeded", CycleErrorCode.PATCH_STATE_CONFLICT),
        ("stream", CycleErrorCode.PATCH_UNSUPPORTED),
        ("authority", CycleErrorCode.PATCH_AUTHORITY_EXPANSION),
        ("budget", CycleErrorCode.PATCH_BUDGET_EXCEEDED),
    ],
)
def test_malicious_patch_decisions_fail_closed_and_are_idempotent(
    mutation: str,
    code: CycleErrorCode,
) -> None:
    async def scenario() -> None:
        succeeded = (
            frozenset()
            if mutation == "existing-source-not-succeeded"
            else frozenset({"merge"})
        )
        runtime = GraphPatchRuntime(
            diamond(),
            revision_hash_value=HASH,
            limits=limits(),
            succeeded_nodes=succeeded,
        )
        document = patch(
            runtime,
            edge_mode="stream" if mutation == "stream" else "value",
            capabilities=["network"] if mutation == "authority" else None,
        )
        if mutation == "incoming-existing":
            document["append"]["edges"][0]["to"] = {"node": "left"}
        selected_reservation = reservation(0) if mutation == "budget" else reservation()
        recorded: list[PatchDecision] = []

        async def recorder(decision: PatchDecision) -> None:
            recorded.append(decision)

        decision = await runtime.apply(
            document,
            authority=authority(),
            policy_snapshot_hash="9" * 64,
            reservation=selected_reservation,
            record=recorder,
        )
        assert decision.outcome == "rejected"
        assert decision.error_code is code
        assert len(recorded) == 1
        assert runtime.coordinate["graphRevision"] == 1
        assert all(node.id != "review" for node in runtime.graph.spec.nodes)
        retried = await runtime.apply(
            document,
            authority=authority("network"),
            policy_snapshot_hash="0" * 64,
            reservation=reservation(),
            record=lambda _: (_ for _ in ()).throw(AssertionError("retry wrote")),
        )
        assert retried is decision

    asyncio.run(scenario())


def test_same_base_concurrency_has_one_cas_winner() -> None:
    async def scenario() -> None:
        runtime = GraphPatchRuntime(
            diamond(),
            revision_hash_value=HASH,
            limits=limits(),
            succeeded_nodes=frozenset({"merge"}),
        )
        first = patch(runtime, "first", node_id="review-a")
        second = patch(runtime, "second", node_id="review-b")
        decisions = await asyncio.gather(
            runtime.apply(
                first,
                authority=authority(),
                policy_snapshot_hash="9" * 64,
                reservation=reservation(),
                record=accept,
            ),
            runtime.apply(
                second,
                authority=authority(),
                policy_snapshot_hash="9" * 64,
                reservation=reservation(),
                record=accept,
            ),
        )
        assert [item.outcome for item in decisions].count("accepted") == 1
        rejected = next(item for item in decisions if item.outcome == "rejected")
        assert rejected.error_code is CycleErrorCode.PATCH_STALE_BASE
        assert runtime.coordinate["graphRevision"] == 2

    asyncio.run(scenario())


class HostileMapping(Mapping[str, object]):
    calls = 0

    def __getitem__(self, key: str) -> object:
        del key
        type(self).calls += 1
        raise AssertionError("getter ran")

    def __iter__(self) -> Iterator[str]:
        type(self).calls += 1
        raise AssertionError("iterator ran")

    def __len__(self) -> int:
        type(self).calls += 1
        raise AssertionError("length ran")


def test_hostile_patch_object_is_rejected_before_compiler_or_recorder() -> None:
    async def scenario() -> None:
        HostileMapping.calls = 0
        runtime = GraphPatchRuntime(
            diamond(), revision_hash_value=HASH, limits=limits()
        )
        writes = 0

        async def recorder(_: PatchDecision) -> None:
            nonlocal writes
            writes += 1

        with pytest.raises(CycleRuntimeError) as raised:
            await runtime.apply(
                HostileMapping(),
                authority=authority(),
                policy_snapshot_hash="9" * 64,
                reservation=reservation(),
                record=recorder,
            )
        assert raised.value.code is CycleErrorCode.PATCH_INVALID
        assert HostileMapping.calls == 0
        assert writes == 0
        assert runtime.decision_count == 0

    asyncio.run(scenario())


@pytest.mark.parametrize("mutation", ["missing-node-config", "missing-edge-from", "empty-port"])
def test_patch_fragments_are_fully_validated_before_compiler_or_recorder(
    mutation: str,
) -> None:
    async def scenario() -> None:
        runtime = GraphPatchRuntime(
            diamond(), revision_hash_value=HASH, limits=limits()
        )
        document = patch(runtime)
        if mutation == "missing-node-config":
            del document["append"]["nodes"][0]["config"]
        elif mutation == "missing-edge-from":
            del document["append"]["edges"][0]["from"]
        else:
            document["append"]["outputs"]["reviewResult"]["port"] = ""
        writes = 0

        async def recorder(_: PatchDecision) -> None:
            nonlocal writes
            writes += 1

        with pytest.raises(CycleRuntimeError) as raised:
            await runtime.apply(
                document,
                authority=authority(),
                policy_snapshot_hash="9" * 64,
                reservation=reservation(),
                record=recorder,
            )

        assert raised.value.code is CycleErrorCode.PATCH_INVALID
        assert raised.value.path.startswith("/append/")
        assert writes == 0
        assert runtime.decision_count == 0
        assert runtime.coordinate["graphRevision"] == 1

    asyncio.run(scenario())


def test_closed_hostile_shape_corpus_fails_before_graph_mutation() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            str(ROOT / "tools" / "conformance" / "python_graph_patch_hostile_shape_report.py"),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    report = json.loads(completed.stdout)

    assert report["attackCount"] == 54
    assert report["corpusCanonicalUtf8Bytes"] == 8934
    assert report["corpusSha256"] == (
        "cd229d4e9a9559140bc8f457b2237c861ddec1b39baa537d7130e5d2d91156f4"
    )
    assert all(
        outcome["errorCode"] == "GE_PATCH_INVALID"
        and outcome["coordinateUnchanged"]
        and outcome["dynamicNodes"] == 0
        and not outcome["decisionRecorded"]
        and outcome["callerUnchanged"]
        for outcome in report["outcomes"]
    )
