from __future__ import annotations

import copy
import json
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any, cast

import pytest

from graph_engineering.cycle_contract import (
    CycleErrorCode,
    CycleRuntimeError,
    capture_portable_json,
    patch_hash,
    revision_hash,
    validate_cycle_policy,
    validate_cycle_request,
)

ROOT = Path(__file__).resolve().parents[2]
CONFORMANCE = ROOT / "spec" / "conformance"


def fixture(name: str) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((CONFORMANCE / name).read_text(encoding="utf-8")),
    )


def apply_mutation(document: dict[str, Any], mutation: dict[str, Any]) -> dict[str, Any]:
    changed = copy.deepcopy(document)
    path = mutation["path"].strip("/").split("/")
    target: Any = changed
    for token in path[:-1]:
        target = target[token]
    operation = mutation["op"]
    if operation == "remove":
        del target[path[-1]]
    elif operation in {"add", "replace"}:
        if "valueFrom" in mutation:
            source: Any = changed
            for token in mutation["valueFrom"].strip("/").split("/"):
                source = source[token]
            target[path[-1]] = copy.deepcopy(source)
        else:
            target[path[-1]] = mutation["value"]
    else:  # pragma: no cover - fixture guard
        raise AssertionError(f"unsupported fixture mutation: {operation}")
    return changed


def test_shared_controller_request_drives_native_domain_hashes() -> None:
    manifest = fixture("cycle-controller.case.json")
    case = manifest["validRequests"][0]

    validated = validate_cycle_request(case["document"])

    assert validated.objective_hash == case["expectObjectiveHash"]
    assert validated.controller_hash == case["expectControllerHash"]
    assert validated.request_hash == case["expectRequestHash"]
    assert validated.document is not case["document"]
    assert validated.model.policy.max_iterations == 1


def test_shared_policy_corpus_is_native_and_closed() -> None:
    manifest = fixture("cycle-controller.case.json")
    policies = {item["name"]: item["document"] for item in manifest["validPolicies"]}

    for document in policies.values():
        captured, model = validate_cycle_policy(document)
        assert captured == document
        assert model.mode == document["mode"]

    base = policies["until-dry-all-effective-bounds"]
    for case in manifest["invalidPolicyCases"]:
        source = policies.get(case.get("base"), base)
        changed = apply_mutation(source, case["mutation"])
        with pytest.raises(CycleRuntimeError) as raised:
            validate_cycle_policy(changed)
        assert raised.value.code is CycleErrorCode.INVALID_POLICY


def test_shared_patch_and_revision_hashes_use_python_canonical_bytes() -> None:
    manifest = fixture("graph-patch.case.json")

    for case in manifest["validCases"]:
        assert patch_hash(case["document"]) == case["expectPatchHash"]
    for case in manifest["revisionHashCases"]:
        assert revision_hash(case["body"]) == case["expectRevisionHash"]


class HostileMapping(Mapping[str, object]):
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


def test_capture_rejects_host_objects_without_mapping_or_model_dispatch() -> None:
    HostileMapping.calls = 0

    with pytest.raises(CycleRuntimeError, match="exact portable JSON"):
        validate_cycle_request(HostileMapping())

    assert HostileMapping.calls == 0


def test_capture_enforces_depth_value_numbers_cycles_and_detachment() -> None:
    nested: list[Any] = []
    cursor = nested
    for _ in range(101):
        child: list[Any] = []
        cursor.append(child)
        cursor = child
    with pytest.raises(CycleRuntimeError, match="depth"):
        capture_portable_json(nested)

    cycle: list[Any] = []
    cycle.append(cycle)
    with pytest.raises(CycleRuntimeError, match="cycle"):
        capture_portable_json(cycle)

    with pytest.raises(CycleRuntimeError, match="safe range"):
        capture_portable_json(2**53)
    with pytest.raises(CycleRuntimeError, match="finite"):
        capture_portable_json(float("nan"))

    caller = {"nested": [{"value": 1}]}
    captured = capture_portable_json(caller)
    caller["nested"][0]["value"] = 2
    assert captured == {"nested": [{"value": 1}]}


def test_request_payload_and_resulting_hashes_reject_post_validation_mutation() -> None:
    case = fixture("cycle-controller.case.json")["validRequests"][0]
    caller = copy.deepcopy(case["document"])
    validated = validate_cycle_request(caller)
    caller["objective"]["canonicalJson"] = '"mutated"'
    caller["policy"]["maxIterations"] = 999

    objective = cast(dict[str, Any], validated.document["objective"])
    policy = cast(dict[str, Any], validated.document["policy"])
    assert objective["canonicalJson"] == '"audit auth routes"'
    assert policy["maxIterations"] == 1
    assert validated.request_hash == case["expectRequestHash"]
