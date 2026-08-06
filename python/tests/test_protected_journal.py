"""The guarded durable write path, and the seeded-canary property.

The property that matters is not that a flag says ``redacted``: it is that a
payload written through the real durable path is absent from every byte the
runtime left on disk.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from graph_engineering.canonical import canonical_sha256
from graph_engineering.durable_json import encode_durable_json
from graph_engineering.events import GraphEvent
from graph_engineering.persistence.protected_journal import (
    EVENT_V1ALPHA2_API_VERSION,
    GuardedJsonlEventStore,
    ProtectedEventJournal,
    UnguardedWriteError,
    reject_legacy_history,
    validate_protected_event,
)
from graph_engineering.redaction.guard import (
    GuardPrepared,
    OccurrenceContext,
    PreparedSinkWriteMisuse,
    SinkGuard,
    SinkWriteRequest,
)
from graph_engineering.redaction.keys import DeterministicTestKeyProvider
from graph_engineering.redaction.legacy import classify_history
from graph_engineering.redaction.policy import default_stable_profile
from graph_engineering.redaction.protect import (
    FileProtectedPayloadStore,
    key_ref_hash,
    node_output_context,
    unprotect_value,
)
from graph_engineering.redaction.scan import encoded_forms

TRANSFORM_HASH = "11" * 32
REGISTRY_HASH = "22" * 32

# Seven distinct synthetic canaries, one per seed point the campaign can reach
# in a provider-free candidate run.
CANARIES: dict[str, str] = {
    "graph-input": "SYNTHETIC-CANARY-GRAPH-INPUT-1a2b3c4d",
    "node-input": "SYNTHETIC-CANARY-NODE-INPUT-2b3c4d5e",
    "node-output": "SYNTHETIC-CANARY-NODE-OUTPUT-3c4d5e6f",
    "run-result": "SYNTHETIC-CANARY-RUN-RESULT-4d5e6f70",
}


def _components(root: Path) -> tuple[SinkGuard, GuardedJsonlEventStore, Any]:
    key_provider = DeterministicTestKeyProvider()
    blob_store = FileProtectedPayloadStore(root / "protected")
    policy = default_stable_profile(
        transform_implementation_hash=TRANSFORM_HASH,
        rule_registry_version=1,
        rule_registry_hash=REGISTRY_HASH,
        key_ref=key_provider.key_ref,
    )
    guard = SinkGuard(policy=policy, key_provider=key_provider, store=blob_store)
    return guard, GuardedJsonlEventStore(root), key_provider


async def _write_history(root: Path) -> tuple[GuardedJsonlEventStore, Any, list[Any]]:
    guard, journal_store, key_provider = _components(root)
    journal = ProtectedEventJournal(
        run_id="run-1", graph_revision=1, guard=guard, store=journal_store
    )
    identity_key = key_provider.run_identity_key("run-1")
    appends = [
        await journal.append_run_created(
            event_id="evt-0",
            timestamp="2026-07-30T00:00:00Z",
            graph_input={"question": CANARIES["graph-input"]},
            graph_hash="aa" * 32,
            implementation_hash="bb" * 32,
            key_ref_digest=key_ref_hash(key_provider.key_ref),
            max_total_attempts=8,
        ),
        await journal.append_node_scheduled(
            event_id="evt-1",
            timestamp="2026-07-30T00:00:01Z",
            node_id="worker",
            attempt=1,
            node_input={"prompt": CANARIES["node-input"]},
            identity_key=identity_key,
            side_effects="none",
        ),
        await journal.append_node_started(
            event_id="evt-2",
            timestamp="2026-07-30T00:00:02Z",
            node_id="worker",
            attempt=1,
            input_mac="cc" * 32,
            activity="dd" * 32,
        ),
        await journal.append_node_succeeded(
            event_id="evt-3",
            timestamp="2026-07-30T00:00:03Z",
            node_id="worker",
            attempt=1,
            output={"answer": CANARIES["node-output"]},
            input_mac="cc" * 32,
        ),
        await journal.append_run_succeeded(
            event_id="evt-4",
            timestamp="2026-07-30T00:00:04Z",
            result={"value": CANARIES["run-result"]},
        ),
    ]
    return journal_store, key_provider, appends


def test_seeded_canaries_are_absent_from_every_byte_on_disk(tmp_path: Path) -> None:
    """The seeded-canary gate.

    Four distinct synthetic canaries are seeded into graph input, bound node
    input, executor output, and the terminal run result, written through the real
    guarded durable path, and then every file the runtime produced is scanned for
    every encoding form the scanner recognizes.
    """

    _journal_store, _, appends = asyncio.run(_write_history(tmp_path))
    assert len(appends) == 5

    files = sorted(path for path in tmp_path.rglob("*") if path.is_file())
    assert files, "the run must have produced durable bytes to scan"
    # The journal file plus one protected blob per protected occurrence.
    assert sum(1 for path in files if path.suffix == ".jsonl") == 1
    assert sum(1 for path in files if path.suffix == ".blob") == 4

    hits: list[tuple[str, str, str]] = []
    for path in files:
        raw = path.read_bytes()
        for canary_id, value in CANARIES.items():
            for form, encoded in encoded_forms(value).items():
                haystack = raw.lower() if form == "hex" else raw
                needle = encoded.lower() if form == "hex" else encoded
                if needle in haystack:
                    hits.append((str(path.relative_to(tmp_path)), canary_id, form))
    assert hits == [], f"canary reached a sink: {hits}"

    # A positive control proves the scan can in fact see a leak.
    leaked = tmp_path / "unsafe-control.txt"
    leaked.write_text(CANARIES["node-output"], encoding="utf-8")
    assert CANARIES["node-output"].encode("utf-8") in leaked.read_bytes()


def test_every_persisted_event_is_a_valid_protected_envelope(tmp_path: Path) -> None:
    journal_store, _, _ = asyncio.run(_write_history(tmp_path))
    documents = journal_store.read_documents("run-1")
    assert len(documents) == 5
    for sequence, document in enumerate(documents):
        assert validate_protected_event(document) is None
        assert document["redacted"] is False
        assert document["payloadDisposition"] in ("metadata-only", "protected-ref")
        assert document["sequence"] == sequence
        # No event may carry an inline application payload field.
        assert not set(document["data"]) & {"input", "output", "result", "state"}


def test_protected_values_are_recoverable_only_through_authentication(
    tmp_path: Path,
) -> None:
    _journal_store, key_provider, appends = asyncio.run(_write_history(tmp_path))
    store = FileProtectedPayloadStore(tmp_path / "protected")
    succeeded = appends[3]
    reference = succeeded.protected_refs[0]

    from graph_engineering.redaction.protect import ProtectedAad

    aad = ProtectedAad(
        run_id="run-1",
        graph_revision=1,
        record_kind="event",
        record_type="NodeSucceeded",
        sequence=3,
        field_path="/data/outputRef",
        capture_policy_hash=succeeded.document["capturePolicyHash"],
        key_ref_hash=reference.key_ref_hash,
        authority_binding_hash="",
        tenant_scope_hash="",
        value_mac=reference.value_mac,
        event_id="evt-3",
        node_id="worker",
        attempt=1,
    )
    # A reconstructed AAD with the wrong authority binding cannot open the blob.
    failed = unprotect_value(
        reference,
        aad=aad,
        semantic_context=node_output_context("run-1", 1, "worker"),
        store=store,
        key_provider=key_provider,
    )
    assert getattr(failed, "code", None) == "PROTECTED_PAYLOAD_CORRUPT"


def test_the_sink_accepts_only_a_prepared_write(tmp_path: Path) -> None:
    guard, journal_store, _ = _components(tmp_path)

    with pytest.raises(UnguardedWriteError):
        asyncio.run(journal_store.write("run-1", b'{"type":"NodeSucceeded"}'))  # type: ignore[arg-type]

    # A serialized guard decision is not a capability either.
    request = SinkWriteRequest(
        source_class="node-output",
        sink="event-journal",
        sink_instance=journal_store,
        authority_class="authoritative",
        occurrence=OccurrenceContext(
            run_id="run-1",
            graph_revision=1,
            record_kind="event",
            record_type="NodeSucceeded",
            occurrence_id="evt-9",
            sequence=0,
            field_path="/data/outputRef",
            occurred_at="2026-07-30T00:00:00Z",
            node_id="worker",
            attempt=1,
        ),
        metadata={"data": {}},
        payload={"answer": "synthetic"},
        semantic_context=node_output_context("run-1", 1, "worker"),
        mac_field_path="/data/outputMac",
    )
    outcome = guard.prepare(request)
    assert isinstance(outcome, GuardPrepared)
    with pytest.raises(UnguardedWriteError):
        asyncio.run(journal_store.write("run-1", outcome.decision.as_document()))  # type: ignore[arg-type]

    asyncio.run(journal_store.write("run-1", outcome.prepared))
    # Replaying the same token cannot write a second record.
    with pytest.raises(PreparedSinkWriteMisuse):
        asyncio.run(journal_store.write("run-1", outcome.prepared))
    assert len(journal_store.read_documents("run-1")) == 1


def test_a_prepared_write_is_bound_to_one_sink_instance(tmp_path: Path) -> None:
    guard, journal_store, _ = _components(tmp_path)
    other = GuardedJsonlEventStore(tmp_path / "other")
    request = SinkWriteRequest(
        source_class="runtime-generated-identifier",
        sink="event-journal",
        sink_instance=journal_store,
        authority_class="observational",
        occurrence=OccurrenceContext(
            run_id="run-1",
            graph_revision=1,
            record_kind="event",
            record_type="NodeStarted",
            occurrence_id="evt-9",
            sequence=0,
            field_path="/data",
            occurred_at="2026-07-30T00:00:00Z",
        ),
        metadata={"data": {}},
    )
    outcome = guard.prepare(request)
    assert isinstance(outcome, GuardPrepared)
    with pytest.raises(PreparedSinkWriteMisuse):
        asyncio.run(other.write("run-1", outcome.prepared))


# ----------------------------------------------------------------------
# v1alpha1 truth hotfix and legacy histories


def test_absent_redacted_flag_remains_absent_in_the_native_model() -> None:
    document = {
        "apiVersion": "graphengineering.reacher-z.github.io/events/v1alpha1",
        "eventId": "evt-1",
        "type": "NodeSucceeded",
        "timestamp": "2026-07-30T00:00:00Z",
        "runId": "run-1",
        "graphRevision": 1,
        "sequence": 0,
        "data": {},
    }
    event = GraphEvent.model_validate(document)
    assert event.redacted is None
    assert event.claims_redacted is False

    from graph_engineering.models import capture_graph_model_document

    assert "redacted" not in capture_graph_model_document(event, GraphEvent)


def test_the_durable_writer_emits_only_the_protected_v1alpha2_envelope() -> None:
    """The durable writer has no v1alpha1 code path left to be truthful about.

    Section 3.1 made the old inline writer stop claiming ``redacted: true``;
    truthful was never the goal. The durable runtime now writes only the guarded
    ``events/v1alpha2`` envelope, whose ``redacted`` is an unconditional false
    beside a real ``payloadDisposition``, and there is no fallback branch that
    could emit an inline v1alpha1 record instead.
    """

    source = Path(__file__).resolve().parents[1] / "src" / "graph_engineering" / "durable.py"
    text = source.read_text(encoding="utf-8")
    assert '"redacted": False,' in text
    assert '"redacted": True,' not in text
    assert 'apiVersion": "graphengineering.reacher-z.github.io/events/v1alpha1' not in text
    assert "EVENT_V1ALPHA2_API_VERSION" in text
    assert "encode_durable_json" not in text


def _legacy_event(**overrides: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "apiVersion": "graphengineering.reacher-z.github.io/events/v1alpha1",
        "eventId": "evt-1",
        "type": "NodeSucceeded",
        "timestamp": "2026-07-30T00:00:00Z",
        "runId": "run-1",
        "graphRevision": 1,
        "sequence": 0,
        "redacted": True,
        "data": {"output": encode_durable_json({"answer": "synthetic-sensitive-value"})},
    }
    document.update(overrides)
    return document


def test_a_misleading_v1alpha1_history_is_rejected_before_resume() -> None:
    events = [_legacy_event()]
    result = reject_legacy_history(events)
    assert result is not None
    assert result.code == "LEGACY_REDACTION_MISMATCH"

    absent = _legacy_event()
    del absent["redacted"]
    result = reject_legacy_history([absent])
    assert result is not None
    assert result.code == "LEGACY_REDACTION_MISMATCH"


def test_a_truthful_inline_v1alpha1_history_is_still_unsafe() -> None:
    result = reject_legacy_history([_legacy_event(redacted=False)])
    assert result is not None
    assert result.code == "INLINE_CAPTURE_NOT_AUTHORIZED"


def test_a_metadata_only_v1alpha1_history_is_not_a_legacy_shape() -> None:
    metadata_only = _legacy_event(type="NodeStarted", data={"inputHash": "aa" * 32})
    assert reject_legacy_history([metadata_only]) is None


def test_legacy_detection_never_rewrites_the_source(tmp_path: Path) -> None:
    path = tmp_path / "legacy.jsonl"
    events = [_legacy_event()]
    original = json.dumps(events[0], sort_keys=True).encode("utf-8") + b"\n"
    path.write_bytes(original)

    disposition = classify_history(events, authorization="migration")
    assert disposition is not None
    assert disposition.action == "quarantine"
    assert disposition.source_rewritten is False
    assert path.read_bytes() == original


def test_a_non_conforming_attempt_failure_is_rejected_before_it_reaches_disk() -> None:
    """`$defs.attemptFailure` is the one sub-object the event schema closes.

    Nothing checked it: the envelope was validated, the `data` member names were
    counted, and the object inside `failure` was never looked at.  Both runtimes
    therefore wrote a non-conforming `NodeAttemptFailed` for as long as the
    defect existed, and each rejected the other's record.
    """

    conforming: dict[str, Any] = {
        "phase": "execute",
        "code": "NODE_EXECUTION_FAILED",
        "messageTemplate": "node-execution-failed/v1",
        "retryable": False,
        "causeCode": "EXECUTOR_REJECTED",
    }

    def document(failure: Any) -> dict[str, Any]:
        data: dict[str, Any] = {"terminal": True, "failure": failure}
        return {
            "apiVersion": EVENT_V1ALPHA2_API_VERSION,
            "eventId": "e1",
            "type": "NodeAttemptFailed",
            "timestamp": "2026-07-26T12:00:00.000Z",
            "runId": "r1",
            "graphRevision": 1,
            "sequence": 3,
            "nodeId": "root",
            "attempt": 1,
            "payloadHash": canonical_sha256(data),
            "capturePolicyHash": "b" * 64,
            "redacted": False,
            "payloadDisposition": "metadata-only",
            "data": data,
        }

    assert validate_protected_event(document(conforming)) is None

    rejected: tuple[tuple[str, Any], ...] = (
        # The exact shape both runtimes used to emit.
        ("duplicates the envelope node identity", {**conforming, "nodeId": "root"}),
        ("duplicates the envelope attempt", {**conforming, "attempt": 1}),
        # Producer-derived text. This is the member the contract exists for.
        ("carries producer text", {**conforming, "message": "db://user:pa55word@host"}),
        ("carries a host cause name", {**conforming, "causeName": "ECONNREFUSED"}),
        (
            "omits the message template",
            {"phase": "execute", "code": "NODE_EXECUTION_FAILED", "retryable": False},
        ),
        ("uses a settle-without-attempt code", {**conforming, "code": "EXECUTOR_NOT_FOUND"}),
        ("invents a message template", {**conforming, "messageTemplate": "node-exploded/v1"}),
        ("invents a cause code", {**conforming, "causeCode": "GREMLINS"}),
        ("uses a non-execute phase", {**conforming, "phase": "output"}),
        ("uses a non-boolean retry flag", {**conforming, "retryable": "no"}),
        ("is not an object", "NODE_EXECUTION_FAILED"),
    )
    for label, failure in rejected:
        invalid = validate_protected_event(document(failure))
        assert invalid is not None, label
        assert invalid.code in {"REDACTION_POLICY_INVALID", "PAYLOAD_PROTECTION_REQUIRED"}, label


def test_the_attempt_failed_disposition_must_match_the_evidence_it_carries() -> None:
    """Section 6.1 ties the disposition to the evidence, in both directions."""

    failure = {
        "phase": "execute",
        "code": "NODE_CANCELLED",
        "messageTemplate": "node-cancelled/v1",
        "retryable": False,
        "causeCode": "CANCELLED",
    }

    def document(disposition: str, *, evidence: bool) -> dict[str, Any]:
        data: dict[str, Any] = {"terminal": True, "failure": failure}
        if evidence:
            data["evidenceRef"] = {"apiVersion": "x"}
            data["evidenceMac"] = "c" * 64
        return {
            "apiVersion": EVENT_V1ALPHA2_API_VERSION,
            "eventId": "e1",
            "type": "NodeAttemptFailed",
            "timestamp": "2026-07-26T12:00:00.000Z",
            "runId": "r1",
            "graphRevision": 1,
            "sequence": 3,
            "nodeId": "root",
            "attempt": 1,
            "payloadHash": canonical_sha256(data),
            "capturePolicyHash": "b" * 64,
            "redacted": False,
            "payloadDisposition": disposition,
            "data": data,
        }

    assert validate_protected_event(document("metadata-only", evidence=False)) is None
    assert validate_protected_event(document("protected-ref", evidence=True)) is None
    # A record claiming protection while carrying no evidence, and one carrying
    # evidence while claiming none, are both refused.
    assert validate_protected_event(document("protected-ref", evidence=False)) is not None
    assert validate_protected_event(document("metadata-only", evidence=True)) is not None


def test_a_settled_without_attempt_sentinel_failure_code_is_rejected() -> None:
    """`$defs.settledFailureCode` is closed and carries no sentinel member."""

    def document(failure_code: str) -> dict[str, Any]:
        data: dict[str, Any] = {
            "resultRef": {"apiVersion": "x"},
            "resultMac": "c" * 64,
            "status": "skipped",
            "attempts": 0,
            "failureCode": failure_code,
        }
        return {
            "apiVersion": EVENT_V1ALPHA2_API_VERSION,
            "eventId": "e2",
            "type": "NodeSettledWithoutAttempt",
            "timestamp": "2026-07-26T12:00:00.000Z",
            "runId": "r1",
            "graphRevision": 1,
            "sequence": 4,
            "nodeId": "root",
            "payloadHash": canonical_sha256(data),
            "capturePolicyHash": "b" * 64,
            "redacted": False,
            "payloadDisposition": "protected-ref",
            "data": data,
        }

    assert validate_protected_event(document("ROUTE_NOT_SELECTED")) is None
    for code in ("SETTLED_WITHOUT_FAILURE", "NODE_EXECUTION_FAILED"):
        assert validate_protected_event(document(code)) is not None, code


def test_barrier_satisfied_pins_the_protected_ref_disposition() -> None:
    """The `BarrierSatisfied` disposition mirror of `events-v1alpha2.ts`.

    The decision document is authoritative content, so the type pins exactly
    `protected-ref`; a `metadata-only` claim is refused before disk.
    """

    from graph_engineering.persistence.protected_journal import (
        EVENT_DISPOSITIONS,
        event_disposition,
    )

    assert EVENT_DISPOSITIONS["BarrierSatisfied"] == frozenset({"protected-ref"})
    assert event_disposition("BarrierSatisfied", has_payload=True) == "protected-ref"

    def document(disposition: str) -> dict[str, Any]:
        data: dict[str, Any] = {
            "decisionRef": {"apiVersion": "x"},
            "decisionMac": "c" * 64,
            "policyHash": "d" * 64,
            "decisionId": "e" * 64,
            "satisfied": True,
            "resolution": "satisfied",
        }
        return {
            "apiVersion": EVENT_V1ALPHA2_API_VERSION,
            "eventId": "e3",
            "type": "BarrierSatisfied",
            "timestamp": "2026-07-26T12:00:00.000Z",
            "runId": "r1",
            "graphRevision": 1,
            "sequence": 5,
            "nodeId": "gate",
            "payloadHash": canonical_sha256(data),
            "capturePolicyHash": "b" * 64,
            "redacted": False,
            "payloadDisposition": disposition,
            "data": data,
        }

    assert validate_protected_event(document("protected-ref")) is None
    assert validate_protected_event(document("metadata-only")) is not None
