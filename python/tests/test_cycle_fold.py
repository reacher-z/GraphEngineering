from __future__ import annotations

import copy
import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import pytest

from graph_engineering.canonical import canonical_json
from graph_engineering.cycle_contract import (
    CYCLE_EVENT_DOMAIN,
    CycleErrorCode,
    CycleRuntimeError,
    domain_hash,
    make_cycle_event,
    validate_cycle_request,
)
from graph_engineering.cycle_fold import (
    HardStopFacts,
    build_checkpoint,
    classify_candidates,
    fold_cycle_events,
    select_exit_reason,
    validate_checkpoint,
)
from graph_engineering.models import JsonObject

ROOT = Path(__file__).resolve().parents[2]
CONFORMANCE = ROOT / "spec" / "conformance"


def fixture(name: str) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((CONFORMANCE / name).read_text(encoding="utf-8")),
    )


def inline_payload(value: object) -> dict[str, Any]:
    canonical = canonical_json(value)
    raw = canonical.encode("utf-8")
    return {
        "disposition": "inline-unredacted",
        "redacted": False,
        "encoding": "canonical-json/v1alpha1",
        "canonicalJson": canonical,
        "utf8ByteLength": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def durable_material() -> tuple[
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
]:
    controllers = fixture("cycle-controller.case.json")
    patches = fixture("graph-patch.case.json")
    durable = fixture("cycle-controller-durable.case.json")
    recipe = durable["validHistory"]
    request = next(
        case["document"]
        for case in controllers["validRequests"]
        if case["name"] == recipe["requestFixture"]
    )
    result = next(
        case["document"]
        for case in controllers["validResults"]
        if case["name"] == recipe["resultFixture"]
    )
    patch = next(
        case["document"]
        for case in patches["validCases"]
        if case["name"] == recipe["patchFixture"]
    )
    revision = next(
        case["document"]
        for case in controllers["validRevisions"]
        if case["name"] == recipe["revisionFixture"]
    )
    return controllers, durable, request, result, {"patch": patch, "revision": revision}


def materialize_events() -> tuple[list[JsonObject], dict[str, Any]]:
    controllers, durable, request, result, related = durable_material()
    recipe = durable["validHistory"]
    validated = validate_cycle_request(request)
    documents: list[JsonObject] = []
    patch_payload = inline_payload(related["patch"])

    def materialize(value: Any, previous_hash: str | None) -> Any:
        if type(value) is list:
            return [materialize(item, previous_hash) for item in value]
        if type(value) is dict:
            if set(value) == {"$fixture"}:
                marker = value["$fixture"]
                if marker == "request":
                    return copy.deepcopy(request)
                if marker == "policy":
                    return copy.deepcopy(request["policy"])
                if marker == "patch-payload":
                    return copy.deepcopy(patch_payload)
                if marker == "revision":
                    return copy.deepcopy(related["revision"])
                if marker == "lease":
                    return copy.deepcopy(recipe["lease"])
                if marker == "round-record":
                    data = cast(dict[str, Any], documents[14]["data"])
                    return copy.deepcopy(data["record"])
                if marker == "terminal-record-hash":
                    return documents[-1]["recordHash"]
                if marker == "result":
                    terminal = copy.deepcopy(result)
                    terminal["historyPrefixHash"] = previous_hash or documents[14]["recordHash"]
                    return terminal
                raise AssertionError(f"unknown marker {marker}")
            return {key: materialize(item, previous_hash) for key, item in value.items()}
        return value

    observed_duration = 0
    start = datetime(2026, 7, 26, tzinfo=UTC)
    previous_hash: str | None = None
    for sequence, event_recipe in enumerate(recipe["events"]):
        data = materialize(event_recipe["data"], previous_hash)
        nested_record = data.get("record") if type(data) is dict else None
        nested_result = data.get("result") if type(data) is dict else None
        candidates = [
            data.get("durationMs", 0),
            data.get("decidedAtDurationMs", 0),
            nested_record.get("durationMs", 0) if type(nested_record) is dict else 0,
            nested_result.get("durationMs", 0) if type(nested_result) is dict else 0,
        ]
        observed_duration = max(observed_duration, *candidates)
        timestamp = (
            "2026-07-26T00:00:00Z"
            if observed_duration == 0
            else (start + timedelta(milliseconds=observed_duration))
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
        event = make_cycle_event(
            event_id=f"cycle-run-1-{sequence}",
            event_type=event_recipe["type"],
            timestamp=timestamp,
            request=validated,
            graph_revision=event_recipe["graphRevision"],
            sequence=sequence,
            previous_event_hash=previous_hash,
            lease=None if sequence == 0 else recipe["lease"],
            data=data,
        )
        document = cast(JsonObject, event.model_dump(by_alias=True))
        documents.append(document)
        previous_hash = event.record_hash

    assert controllers["validRequests"][0]["expectControllerHash"] == validated.controller_hash
    return documents, durable


def test_shared_sixteen_event_golden_drives_native_fold_and_checkpoint() -> None:
    documents, durable = materialize_events()
    expected = durable["validHistory"]

    assert [item["recordHash"] for item in documents] == expected["expectEventRecordHashes"]
    fold = fold_cycle_events(documents, require_terminal=True)

    assert fold.tail_hash == expected["expectTerminalRecordHash"]
    assert fold.terminal
    assert fold.terminal_result is not None
    assert fold.terminal_result["exitReason"] == "MAX_ITERATIONS"
    assert fold.state["seenKeys"] == ["finding-a"]
    assert fold.state["decidedPatches"] == [
        {
            "patchId": "round-2-node",
            "patchHash": "ca6ba9762870a8b7f3de18607cd1f6db191bc3ecb473825516b3e26627a6ea07",
            "outcome": "accepted",
            "decisionSequence": 11,
        }
    ]

    checkpoint = build_checkpoint(
        fold,
        checkpoint_id="cycle-run-1-terminal",
        created_at="2026-07-26T00:00:16Z",
    )
    assert checkpoint["contentHash"] == durable["checkpoint"]["expectContentHash"]
    assert validate_checkpoint(checkpoint, documents).state == fold.state


def test_shared_until_dry_fold_vectors_execute_native_seen_logic() -> None:
    durable = fixture("cycle-controller-durable.case.json")
    policy_document = fixture("cycle-controller.case.json")["validPolicies"][0]["document"]
    policy_document["maxIterations"] = 10
    policy_document["maxDiscoveries"] = 10
    from graph_engineering.cycle_contract import validate_cycle_policy

    _, policy = validate_cycle_policy(policy_document)

    for case in durable["untilDryFoldCases"]:
        seen: list[str] = []
        dry = 0
        for round_case in case["rounds"]:
            batch = [{"key": key, "value": None} for key in round_case["candidateKeys"]]
            classified = classify_candidates(batch, seen_keys=seen, policy=policy)
            assert list(classified.fresh_keys) == round_case["expectFreshKeys"]
            assert list(classified.duplicate_keys) == round_case["expectDuplicateKeys"]
            seen.extend(classified.seen_additions)
            dry = dry + 1 if not classified.fresh_keys else 0
            assert dry == round_case["expectConsecutiveDryRounds"]
        assert seen == case["expectSeenKeys"]
        assert ("DRY" if dry >= case["consecutiveDryRounds"] else None) == case[
            "expectExitReason"
        ]


def test_shared_hard_stop_vectors_execute_normative_precedence() -> None:
    durable = fixture("cycle-controller-durable.case.json")
    policy_document = {
        "apiVersion": "graphengineering.reacher-z.github.io/cycle-policies/v1alpha1",
        "kind": "CycleControllerPolicy",
        "mode": "until-dry",
        **durable["hardStopPolicy"],
        "maxCandidatesPerRound": 10,
        "maxCandidateBytes": 1024,
        "maxCandidateBatchBytes": 4096,
        "consecutiveDryRounds": 2,
    }
    from graph_engineering.cycle_contract import validate_cycle_policy

    _, policy = validate_cycle_policy(policy_document)
    for case in durable["hardStopFoldCases"]:
        data = case["fold"]
        facts = HardStopFacts(
            cancelled=data["cancelled"],
            duration_ms=data["durationMs"],
            cost_usd=data["costUsd"],
            attempts_used=data["attemptsUsed"],
            dynamic_nodes=data["dynamicNodes"],
            seen_count=data["seenCount"],
            iterations=data["iterations"],
            patch_rejected=data["patchRejected"],
            failed=data["failed"],
            unknown_verdict=data["unknownVerdict"],
            convergence_reason=data["convergenceReason"],
        )
        assert select_exit_reason(facts, policy) == case["expectExitReason"]


def test_hash_valid_but_semantically_substituted_history_fails_closed() -> None:
    documents, _ = materialize_events()
    changed = copy.deepcopy(documents)
    changed_data = cast(dict[str, Any], changed[4]["data"])
    changed_data["seenAdditions"] = ["forged"]
    for index in range(4, len(changed)):
        if index > 4:
            changed[index]["previousEventHash"] = changed[index - 1]["recordHash"]
        changed[index]["payloadHash"] = hashlib.sha256(
            canonical_json(changed[index]["data"]).encode("utf-8")
        ).hexdigest()
        record = dict(changed[index])
        record.pop("recordHash")
        changed[index]["recordHash"] = domain_hash(CYCLE_EVENT_DOMAIN, record)

    with pytest.raises(CycleRuntimeError) as raised:
        fold_cycle_events(changed)
    assert raised.value.code is CycleErrorCode.INVALID_HISTORY
    assert "seen additions" in str(raised.value)


def test_resigned_history_cannot_bypass_graph_patch_fragment_schema() -> None:
    documents, _ = materialize_events()
    changed = copy.deepcopy(documents)
    patch_index = next(
        index for index, event in enumerate(changed) if event["type"] == "PatchAccepted"
    )
    patch_data = cast(dict[str, Any], changed[patch_index]["data"])
    patch_document = json.loads(patch_data["patch"]["canonicalJson"])
    del patch_document["append"]["nodes"][0]["config"]
    replacement_payload = inline_payload(patch_document)
    patch_data["patch"] = replacement_payload
    patch_data["patchHash"] = replacement_payload["sha256"]

    # Re-sign the entire suffix to prove that hash-chain integrity alone is
    # insufficient authority for an embedded GraphPatch fragment.
    for index in range(patch_index, len(changed)):
        if index > patch_index:
            changed[index]["previousEventHash"] = changed[index - 1]["recordHash"]
        changed[index]["payloadHash"] = hashlib.sha256(
            canonical_json(changed[index]["data"]).encode("utf-8")
        ).hexdigest()
        record = dict(changed[index])
        record.pop("recordHash")
        changed[index]["recordHash"] = domain_hash(CYCLE_EVENT_DOMAIN, record)

    with pytest.raises(CycleRuntimeError) as raised:
        fold_cycle_events(changed)
    assert raised.value.code is CycleErrorCode.INVALID_HISTORY
    assert "GraphPatch schema" in str(raised.value)
