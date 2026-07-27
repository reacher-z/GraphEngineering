"""Emit native-Python D7-H05A hostile GraphPatch shape evidence."""

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
    PatchReservation,
    canonical_json,
    compile_graph,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"


def _pointer_tokens(path: str) -> list[str]:
    assert path.startswith("/")
    return [token.replace("~1", "/").replace("~0", "~") for token in path[1:].split("/")]


def _parent_at(document: object, path: str) -> tuple[dict[str, Any] | list[Any], str]:
    tokens = _pointer_tokens(path)
    assert tokens
    parent = document
    for token in tokens[:-1]:
        if isinstance(parent, list):
            parent = parent[int(token)]
        else:
            assert type(parent) is dict
            parent = cast(dict[str, Any], parent)[token]
    assert type(parent) is dict or isinstance(parent, list)
    return cast(dict[str, Any] | list[Any], parent), tokens[-1]


def _assign(parent: dict[str, Any] | list[Any], token: str, value: object) -> None:
    if isinstance(parent, list):
        parent[int(token)] = value
    else:
        parent[token] = value


def _remove(parent: dict[str, Any] | list[Any], token: str) -> None:
    if isinstance(parent, list):
        del parent[int(token)]
    else:
        del parent[token]


def _nested_object(key: str, depth: int) -> object:
    assert key
    assert depth > 0
    value: object = "leaf"
    for _ in range(depth):
        value = {key: value}
    return value


def materialize_graph_patch_hostile_shape(
    seed_document: object,
    mutation: dict[str, Any],
) -> object:
    """Reconstruct one attack without importing the TypeScript materializer."""

    if mutation["op"] == "replace-root":
        return copy.deepcopy(mutation["value"])

    document = copy.deepcopy(seed_document)
    parent, token = _parent_at(document, cast(str, mutation["path"]))
    operation = mutation["op"]
    if operation == "remove":
        _remove(parent, token)
    elif operation in {"add", "replace"}:
        _assign(parent, token, copy.deepcopy(mutation["value"]))
    elif operation == "repeat-string":
        character = cast(str, mutation["character"])
        length = cast(int, mutation["length"])
        assert len(character) == 1
        assert length >= 0
        _assign(parent, token, character * length)
    elif operation == "nest-object":
        _assign(
            parent,
            token,
            _nested_object(cast(str, mutation["key"]), cast(int, mutation["depth"])),
        )
    else:  # pragma: no cover - fixture validator closes this vocabulary
        raise AssertionError(f"unsupported hostile GraphPatch mutation {operation!r}")
    return document


def _category_counts(cases: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for attack in cases:
        category = cast(str, attack["category"])
        counts[category] = counts.get(category, 0) + 1
    return dict(sorted(counts.items()))


def _authority() -> PatchAuthority:
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
    )


def _runtime(graph_document: dict[str, Any]) -> GraphPatchRuntime:
    return GraphPatchRuntime(
        compile_graph(graph_document),
        revision_hash_value="1" * 64,
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


async def build_report() -> dict[str, Any]:
    fixture = cast(
        dict[str, Any],
        json.loads((FIXTURES / "graph-patch-hostile-shape.case.json").read_text()),
    )
    graph_document = cast(
        dict[str, Any],
        json.loads((FIXTURES / cast(str, fixture["baseGraph"])).read_text()),
    )
    cases = cast(list[dict[str, Any]], fixture["cases"])
    expected = cast(dict[str, Any], fixture["expect"])
    assert fixture["schemaVersion"] == 1
    assert fixture["id"] == "graph-patch-hostile-shape-v1alpha1"
    assert len(cases) == expected["caseCount"]
    assert len({cast(str, attack["id"]) for attack in cases}) == len(cases)
    assert _category_counts(cases) == expected["categoryCounts"]
    assert sum(attack["layer"] == "schema" for attack in cases) == expected["schemaCaseCount"]
    assert sum(attack["layer"] == "runtime-capture" for attack in cases) == expected[
        "runtimeCaptureCaseCount"
    ]
    corpus_canonical = canonical_json(cases)
    assert len(corpus_canonical.encode()) == expected["casesCanonicalUtf8Bytes"]
    assert hashlib.sha256(corpus_canonical.encode()).hexdigest() == expected["casesSha256"]

    seed = copy.deepcopy(fixture["seedDocument"])
    seed_runtime = _runtime(graph_document)
    assert seed_runtime.coordinate["graphHash"] == cast(dict[str, Any], seed)["base"]["graphHash"]
    seed_decision = await seed_runtime.apply(
        seed,
        authority=_authority(),
        policy_snapshot_hash="8" * 64,
        reservation=PatchReservation("hostile-shape-reservation", 1, 0, 10),
        dry_run=True,
    )
    assert seed_decision.outcome == "accepted"
    seed_canonical = canonical_json(seed)
    seed_patch_hash = seed_decision.patch_hash

    outcomes: list[dict[str, Any]] = []
    for index, attack in enumerate(cases):
        document = materialize_graph_patch_hostile_shape(seed, attack["mutation"])
        input_canonical = canonical_json(document)
        runtime = _runtime(graph_document)
        before_coordinate = canonical_json(runtime.coordinate)
        observed_code: str | None = None
        try:
            await runtime.apply(
                document,
                authority=_authority(),
                policy_snapshot_hash="8" * 64,
                reservation=PatchReservation("hostile-shape-reservation", 1, 0, 10),
                dry_run=True,
            )
        except CycleRuntimeError as exc:
            observed_code = exc.code.value
        assert observed_code == attack["expectCode"], (
            f"{attack['id']}: unexpected Python error {observed_code}"
        )
        assert canonical_json(document) == input_canonical
        assert canonical_json(runtime.coordinate) == before_coordinate
        assert len(runtime.graph.spec.nodes) == len(seed_runtime.graph.spec.nodes)
        assert runtime.decision_count == 0
        outcomes.append(
            {
                "index": index,
                "id": attack["id"],
                "category": attack["category"],
                "layer": attack["layer"],
                "inputCanonicalUtf8Bytes": len(input_canonical.encode()),
                "inputSha256": hashlib.sha256(input_canonical.encode()).hexdigest(),
                "errorCode": observed_code,
                "coordinateUnchanged": True,
                "dynamicNodes": 0,
                "decisionRecorded": False,
                "callerUnchanged": True,
            }
        )

    return {
        "campaignId": fixture["id"],
        "attackCount": len(outcomes),
        "categoryCounts": _category_counts(cases),
        "corpusCanonicalUtf8Bytes": len(corpus_canonical.encode()),
        "corpusSha256": hashlib.sha256(corpus_canonical.encode()).hexdigest(),
        "seedCanonicalUtf8Bytes": len(seed_canonical.encode()),
        "seedPatchHash": seed_patch_hash,
        "requiredAssertions": fixture["requiredAssertions"],
        "outcomes": outcomes,
    }


if __name__ == "__main__":
    print(canonical_json(asyncio.run(build_report())))
