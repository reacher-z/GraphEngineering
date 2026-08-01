"""Guard, prepared-write, receipt, and protected-payload obligations."""

from __future__ import annotations

import copy
import hashlib
import hmac
import pickle
from dataclasses import replace
from typing import Any

import pytest

from graph_engineering.canonical import canonical_bytes
from graph_engineering.durable_json import encode_durable_json
from graph_engineering.redaction.aead import (
    AeadError,
    aes_256_gcm_decrypt,
    aes_256_gcm_encrypt,
)
from graph_engineering.redaction.disposition import (
    DISPOSITION_TRUTH_TABLE,
    PAYLOAD_DISPOSITIONS,
    validate_disposition,
)
from graph_engineering.redaction.guard import (
    NO_PAYLOAD,
    GuardFailed,
    GuardPrepared,
    GuardSuppressed,
    OccurrenceContext,
    PreparedSinkWrite,
    PreparedSinkWriteMisuse,
    SinkGuard,
    SinkWriteRequest,
)
from graph_engineering.redaction.keys import DeterministicTestKeyProvider
from graph_engineering.redaction.pointer import REDACTION_TOKEN
from graph_engineering.redaction.policy import (
    RedactionRule,
    capture_policy_hash,
    default_stable_profile,
)
from graph_engineering.redaction.protect import (
    MemoryProtectedPayloadStore,
    ProtectedAad,
    ProtectedValueRef,
    ProtectionResult,
    activity_key,
    canonical_tagged,
    key_ref_hash,
    node_output_context,
    protect_value,
    unprotect_value,
    value_mac,
)
from graph_engineering.redaction.receipt import (
    TransformOccurrence,
    build_receipt,
    verify_receipt,
)
from graph_engineering.redaction.scan import CanaryRegistry, encoded_forms
from graph_engineering.redaction.wire import validate_guard_decision_document

TRANSFORM_HASH = "11" * 32
REGISTRY_HASH = "22" * 32


def _policy(**overrides: Any) -> Any:
    key_provider = DeterministicTestKeyProvider()
    policy = default_stable_profile(
        transform_implementation_hash=TRANSFORM_HASH,
        rule_registry_version=1,
        rule_registry_hash=REGISTRY_HASH,
        key_ref=key_provider.key_ref,
    )
    return replace(policy, **overrides) if overrides else policy


def _occurrence(**overrides: Any) -> OccurrenceContext:
    base = {
        "run_id": "run-1",
        "graph_revision": 1,
        "record_kind": "event",
        "record_type": "NodeSucceeded",
        "occurrence_id": "evt-3",
        "sequence": 3,
        "field_path": "/data/outputRef",
        "occurred_at": "2026-07-26T20:00:00Z",
        "node_id": "worker",
        "attempt": 1,
    }
    base.update(overrides)
    return OccurrenceContext(**base)  # type: ignore[arg-type]


def _guard(store: Any = None, **overrides: Any) -> tuple[SinkGuard, Any, Any]:
    key_provider = DeterministicTestKeyProvider()
    blob_store = store if store is not None else MemoryProtectedPayloadStore()
    guard = SinkGuard(
        policy=_policy(**overrides),
        key_provider=key_provider,
        store=blob_store,
    )
    return guard, key_provider, blob_store


def _request(sink_instance: object, **overrides: Any) -> SinkWriteRequest:
    base: dict[str, Any] = {
        "source_class": "node-output",
        "sink": "event-journal",
        "sink_instance": sink_instance,
        "authority_class": "authoritative",
        "occurrence": _occurrence(),
        "metadata": {"data": {}},
        "payload": {"answer": "synthetic-value"},
        "semantic_context": node_output_context("run-1", 1, "worker"),
        "mac_field_path": "/data/outputMac",
        "side_effects": "none",
        "executor_outcome": "succeeded",
    }
    base.update(overrides)
    return SinkWriteRequest(**base)


# ----------------------------------------------------------------------
# totality


def test_guard_is_total_over_every_sink_for_one_source() -> None:
    from graph_engineering.redaction.inventory import SINK_CLASSES

    guard, _, store = _guard()
    for sink in SINK_CLASSES:
        outcome = guard.prepare(_request(store, sink=sink))
        assert outcome is not None
        assert isinstance(outcome, (GuardSuppressed, GuardFailed, GuardPrepared))


def test_guard_without_a_policy_fails_closed() -> None:
    guard = SinkGuard(policy=None)
    store = MemoryProtectedPayloadStore()
    outcome = guard.prepare(_request(store))
    assert isinstance(outcome, GuardFailed)
    assert outcome.failure.code == "REDACTION_POLICY_REQUIRED"


def test_authoritative_write_without_a_store_requires_protection() -> None:
    guard = SinkGuard(policy=_policy(), key_provider=DeterministicTestKeyProvider(), store=None)
    outcome = guard.prepare(_request(object()))
    assert isinstance(outcome, GuardFailed)
    assert outcome.failure.code == "PAYLOAD_PROTECTION_REQUIRED"


def test_a_failure_never_echoes_the_offending_value() -> None:
    guard, _, store = _guard()
    secret = "synthetic-sensitive-value-9f2b"
    outcome = guard.prepare(_request(store, sink="stdout", payload={"secret": secret}))
    assert isinstance(outcome, (GuardFailed, GuardSuppressed))
    rendered = repr(outcome)
    assert secret not in rendered


def test_plaintext_beside_the_reference_is_refused() -> None:
    """Section 3.2: `protected-ref` carrying plaintext beside the ref is invalid."""

    guard, _, store = _guard()
    outcome = guard.prepare(
        _request(
            store,
            metadata={"nodeId": "worker", "data": {"echo": {"answer": "synthetic-value"}}},
            payload={"answer": "synthetic-value"},
        )
    )
    assert isinstance(outcome, GuardFailed)
    assert outcome.failure.code == "PAYLOAD_PROTECTION_REQUIRED"


def test_a_closed_envelope_identifier_is_not_plaintext_beside_the_reference() -> None:
    """A value that coincides with a closed identifier is not an inline leak.

    "Beside the reference" is the container the reference is inserted into. A
    node whose output happens to equal its own node id would otherwise be
    permanently unwritable, and refusing it would say something false about the
    record: the envelope's `nodeId` is graph-declared metadata, not a copy of
    the protected application value.
    """

    guard, _, store = _guard()
    outcome = guard.prepare(
        _request(
            store,
            metadata={"nodeId": "worker", "data": {}},
            payload="worker",
        )
    )
    assert isinstance(outcome, GuardPrepared)
    assert outcome.document["data"]["outputRef"]["apiVersion"].endswith(
        "protected-value/v1alpha1"
    )
    assert "worker" not in str(outcome.document["data"])


def test_metadata_only_record_cannot_carry_an_application_payload() -> None:
    guard, _, store = _guard()
    outcome = guard.prepare(
        _request(
            store,
            source_class="runtime-generated-identifier",
            sink="cli-json",
            authority_class="observational",
            payload={"leak": "synthetic-value"},
            semantic_context=None,
            mac_field_path=None,
        )
    )
    assert isinstance(outcome, GuardFailed)
    assert outcome.failure.code == "PAYLOAD_PROTECTION_REQUIRED"


# ----------------------------------------------------------------------
# prepared write


def test_prepared_write_constructor_is_private_to_the_guard() -> None:
    with pytest.raises(PreparedSinkWriteMisuse):
        PreparedSinkWrite(
            object(),
            sink="event-journal",
            sink_instance=object(),
            payload_bytes=b"{}",
            payload_hash="0" * 64,
            policy_hash="0" * 64,
            decision_id="decision-1",
            disposition="metadata-only",
        )


def test_prepared_write_is_single_use_and_bound_to_one_sink_instance() -> None:
    guard, _, store = _guard()
    outcome = guard.prepare(_request(store))
    assert isinstance(outcome, GuardPrepared)
    prepared = outcome.prepared

    with pytest.raises(PreparedSinkWriteMisuse):
        prepared.consume(object())
    payload = prepared.consume(store)
    assert payload == canonical_bytes(outcome.document)
    assert prepared.consumed is True
    with pytest.raises(PreparedSinkWriteMisuse):
        prepared.consume(store)


def test_prepared_write_cannot_be_serialized_or_copied() -> None:
    guard, _, store = _guard()
    outcome = guard.prepare(_request(store))
    assert isinstance(outcome, GuardPrepared)
    prepared = outcome.prepared
    with pytest.raises(PreparedSinkWriteMisuse):
        pickle.dumps(prepared)
    with pytest.raises(PreparedSinkWriteMisuse):
        copy.copy(prepared)
    with pytest.raises(PreparedSinkWriteMisuse):
        copy.deepcopy(prepared)
    assert not hasattr(prepared, "__dict__")


def test_guard_decision_projection_is_metadata_only_and_valid() -> None:
    guard, _, store = _guard()
    outcome = guard.prepare(_request(store))
    assert isinstance(outcome, GuardPrepared)
    document = outcome.decision.as_document()
    assert validate_guard_decision_document(document) is None
    assert b"synthetic-value" not in canonical_bytes(document)

    unprotected = SinkGuard(
        policy=_policy(), key_provider=DeterministicTestKeyProvider(), store=None
    )
    denied = unprotected.prepare(_request(store))
    assert isinstance(denied, GuardFailed)
    assert validate_guard_decision_document(denied.decision.as_document()) is None

    # An unknown sink has no audit projection at all: the enum is closed, so the
    # decision cannot be serialized as a valid document rather than inventing a
    # nearest-known sink for it.
    unknown = guard.prepare(_request(store, sink="future-sink"))
    assert isinstance(unknown, GuardFailed)
    assert validate_guard_decision_document(unknown.decision.as_document()) is not None


# ----------------------------------------------------------------------
# Section 7.1 retry


def test_retry_from_the_same_snapshot_recomputes_an_identical_prepared_write() -> None:
    guard, _, store = _guard()
    payload = {"answer": "synthetic-value"}
    first = guard.prepare(_request(store, payload=payload, decision_id="decision-1"))
    second = guard.prepare(_request(store, payload=payload, decision_id="decision-1"))
    assert isinstance(first, GuardPrepared)
    assert isinstance(second, GuardPrepared)
    # The blob nonce advances, so ciphertext differs, but the logical identity
    # and the receipt-bearing facts are stable across the retry.
    assert first.protected_refs[0].value_mac == second.protected_refs[0].value_mac
    assert first.decision.decision_id == second.decision.decision_id


def test_retry_refuses_an_already_transformed_input() -> None:
    guard, _, store = _guard()
    already_tokenized = {"answer": REDACTION_TOKEN}
    outcome = guard.prepare(_request(store, payload=already_tokenized))
    assert isinstance(outcome, GuardFailed)
    assert outcome.failure.code == "PAYLOAD_PROTECTION_FAILED"
    assert outcome.failure.phase == "snapshot"


def test_retry_refuses_an_already_protected_reference_as_input() -> None:
    guard, _key_provider, store = _guard()
    first = guard.prepare(_request(store))
    assert isinstance(first, GuardPrepared)
    reference = first.protected_refs[0].as_document()
    outcome = guard.prepare(_request(store, payload={"outputRef": reference}))
    assert isinstance(outcome, GuardFailed)
    assert outcome.failure.code == "PAYLOAD_PROTECTION_FAILED"


def test_source_hash_over_a_replaced_token_is_not_accepted_as_proof() -> None:
    """Section 7.1 defect 2, stated as a test.

    Hashing the post-transform token as though it were the source yields a
    receipt whose ``sourceHash`` attests to a value nobody held.  Replay from the
    real snapshot must reject it.
    """

    key_provider = DeterministicTestKeyProvider()
    identity_key = key_provider.run_identity_key("run-1")
    rule = RedactionRule(
        rule_id="log-v1",
        registry_version=1,
        sink="runtime-log",
        paths=("/message",),
        replacement_mode="constant-token",
    )
    snapshot = {"message": "synthetic-sensitive-value"}
    transformed = {"message": REDACTION_TOKEN}
    occurrence = TransformOccurrence(
        source_class="log-field",
        sink="runtime-log",
        decision_id="decision-1",
        run_id="run-1",
        graph_revision=1,
        occurrence_kind="sink-write",
        occurrence_id="write-1",
        occurrence_sequence=0,
        occurred_at="2026-07-26T20:00:00Z",
        field_path="/payload/message",
    )
    honest = build_receipt(
        identity_key=identity_key,
        policy_hash="aa" * 32,
        transform_implementation_hash=TRANSFORM_HASH,
        rule_registry_hash=REGISTRY_HASH,
        rule_registry_version=1,
        rule_resolution_id="resolution-1",
        authority_binding_hash="bb" * 32,
        tenant_scope_hash="cc" * 32,
        occurrence=occurrence,
        rules=(rule,),
        source_snapshot=snapshot,
        transformed=transformed,
        paths=("/message",),
        replacement_mode="constant-token",
    )
    assert (
        verify_receipt(
            honest,
            identity_key=identity_key,
            source_snapshot=snapshot,
            persisted_result=transformed,
            occurrence=occurrence,
        )
        is None
    )

    dishonest = build_receipt(
        identity_key=identity_key,
        policy_hash="aa" * 32,
        transform_implementation_hash=TRANSFORM_HASH,
        rule_registry_hash=REGISTRY_HASH,
        rule_registry_version=1,
        rule_resolution_id="resolution-1",
        authority_binding_hash="bb" * 32,
        tenant_scope_hash="cc" * 32,
        occurrence=occurrence,
        rules=(rule,),
        source_snapshot=transformed,  # the token, not the value
        transformed=transformed,
        paths=("/message",),
        replacement_mode="constant-token",
    )
    invalid = verify_receipt(
        dishonest,
        identity_key=identity_key,
        source_snapshot=snapshot,
        persisted_result=transformed,
        occurrence=occurrence,
    )
    assert invalid is not None
    assert invalid.code == "REDACTION_RECEIPT_INVALID"


def test_receipt_rejects_a_changed_occurrence_or_result() -> None:
    key_provider = DeterministicTestKeyProvider()
    identity_key = key_provider.run_identity_key("run-1")
    rule = RedactionRule(
        rule_id="log-v1",
        registry_version=1,
        sink="runtime-log",
        paths=("/message",),
        replacement_mode="constant-token",
    )
    snapshot = {"message": "synthetic-sensitive-value"}
    transformed = {"message": REDACTION_TOKEN}
    occurrence = TransformOccurrence(
        source_class="log-field",
        sink="runtime-log",
        decision_id="decision-1",
        run_id="run-1",
        graph_revision=1,
        occurrence_kind="sink-write",
        occurrence_id="write-1",
        occurrence_sequence=0,
        occurred_at="2026-07-26T20:00:00Z",
        field_path="/payload/message",
    )
    receipt = build_receipt(
        identity_key=identity_key,
        policy_hash="aa" * 32,
        transform_implementation_hash=TRANSFORM_HASH,
        rule_registry_hash=REGISTRY_HASH,
        rule_registry_version=1,
        rule_resolution_id="resolution-1",
        authority_binding_hash="bb" * 32,
        tenant_scope_hash="cc" * 32,
        occurrence=occurrence,
        rules=(rule,),
        source_snapshot=snapshot,
        transformed=transformed,
        paths=("/message",),
        replacement_mode="constant-token",
    )
    moved = replace(occurrence, occurrence_id="write-2")
    assert (
        verify_receipt(
            receipt,
            identity_key=identity_key,
            source_snapshot=snapshot,
            persisted_result=transformed,
            occurrence=moved,
        )
        is not None
    )
    assert (
        verify_receipt(
            receipt,
            identity_key=identity_key,
            source_snapshot=snapshot,
            persisted_result={"message": "something-else"},
            occurrence=occurrence,
        )
        is not None
    )


def test_a_receipt_can_never_name_an_authoritative_source_or_a_store_sink() -> None:
    from graph_engineering.redaction.receipt import validate_receipt_document

    valid = {
        "apiVersion": "graphengineering.reacher-z.github.io/redaction-receipt/v1alpha2",
        "policyHash": "aa" * 32,
        "sourceHash": "bb" * 32,
        "resultHash": "cc" * 32,
        "ruleSetHash": "dd" * 32,
        "transform": "json-pointer-rules/v1alpha2",
        "transformImplementationHash": "ee" * 32,
        "ruleRegistryHash": "ff" * 32,
        "ruleRegistryVersion": 1,
        "ruleResolutionId": "resolution-1",
        "authorityBindingHash": "11" * 32,
        "tenantScopeHash": "22" * 32,
        "sourceClass": "log-field",
        "sink": "runtime-log",
        "decisionId": "decision-1",
        "runId": "run-1",
        "graphRevision": 1,
        "occurrenceKind": "sink-write",
        "occurrenceId": "write-1",
        "occurrenceSequence": 0,
        "occurredAt": "2026-07-26T20:00:00Z",
        "fieldPath": "/payload/message",
        "paths": ["/message"],
        "replacementMode": "constant-token",
        "count": 1,
    }
    assert validate_receipt_document(valid) is None
    assert validate_receipt_document({**valid, "sourceClass": "node-output"}) is not None
    assert validate_receipt_document({**valid, "sink": "protected-blob-final"}) is not None
    assert validate_receipt_document({**valid, "count": 2}) is not None
    assert (
        validate_receipt_document({**valid, "paths": ["/z", "/a"], "count": 2}) is not None
    )


# ----------------------------------------------------------------------
# disposition truth table


def test_disposition_truth_table_is_exactly_the_contract() -> None:
    assert set(PAYLOAD_DISPOSITIONS) == set(DISPOSITION_TRUTH_TABLE)
    for disposition, (redacted, _) in DISPOSITION_TRUTH_TABLE.items():
        assert (disposition == "redacted") is redacted


def test_every_invalid_disposition_pair_is_rejected() -> None:
    for disposition in PAYLOAD_DISPOSITIONS:
        expected_redacted, _ = DISPOSITION_TRUTH_TABLE[disposition]
        wrong = {"payloadDisposition": disposition, "redacted": not expected_redacted}
        assert validate_disposition(wrong) is not None
    assert validate_disposition({"payloadDisposition": "unknown", "redacted": False}) is not None


def test_a_receipt_on_a_non_redacted_disposition_is_invalid() -> None:
    receipt = {
        "apiVersion": "graphengineering.reacher-z.github.io/redaction-receipt/v1alpha2",
    }
    assert (
        validate_disposition(
            {
                "payloadDisposition": "protected-ref",
                "redacted": False,
                "redactionReceipt": receipt,
            }
        )
        is not None
    )


# ----------------------------------------------------------------------
# protected payload primitives


def test_aes_256_gcm_matches_the_published_vectors() -> None:
    key = bytes(32)
    nonce = bytes(12)
    ciphertext, tag = aes_256_gcm_encrypt(key, nonce, b"", b"")
    assert ciphertext == b""
    assert tag.hex() == "530f8afbc74536b9a963b4f1c4cb738b"

    ciphertext, tag = aes_256_gcm_encrypt(key, nonce, bytes(16), b"")
    assert ciphertext.hex() == "cea7403d4d606b6e074ec5d3baf39d18"
    assert tag.hex() == "d0d1c8a799996bf0265b98b5d48ab919"
    assert aes_256_gcm_decrypt(key, nonce, ciphertext, tag, b"") == bytes(16)

    with pytest.raises(AeadError):
        aes_256_gcm_decrypt(key, nonce, ciphertext, bytes(16), b"")
    with pytest.raises(AeadError):
        aes_256_gcm_decrypt(key, nonce, ciphertext, tag, b"different-aad")


def test_key_ref_hash_is_the_tagged_digest_of_the_closed_pair() -> None:
    expected = hashlib.sha256(
        canonical_bytes(encode_durable_json(["key-ref/v1alpha1", "kms://operator/key-1"]))
    ).hexdigest()
    assert key_ref_hash("kms://operator/key-1") == expected


def test_value_mac_excludes_attempt_and_is_stable_within_a_run() -> None:
    key_provider = DeterministicTestKeyProvider()
    identity_key = key_provider.run_identity_key("run-1")
    context = node_output_context("run-1", 1, "worker")
    first = value_mac(identity_key, context, {"answer": 1})
    second = value_mac(identity_key, context, {"answer": 1})
    assert first == second
    expected = hmac.new(
        identity_key,
        canonical_tagged(["value-mac/v1alpha1", dict(context), {"answer": 1}]),
        hashlib.sha256,
    ).hexdigest()
    assert first == expected

    other_run = DeterministicTestKeyProvider().run_identity_key("run-2")
    assert value_mac(other_run, node_output_context("run-2", 1, "worker"), {"answer": 1}) != first


def test_activity_key_is_stable_across_attempts() -> None:
    key_provider = DeterministicTestKeyProvider()
    identity_key = key_provider.run_identity_key("run-1")
    mac = "aa" * 32
    first = activity_key(
        identity_key, run_id="run-1", graph_revision=1, node_id="worker", input_mac=mac
    )
    second = activity_key(
        identity_key, run_id="run-1", graph_revision=1, node_id="worker", input_mac=mac
    )
    assert first == second
    different = activity_key(
        identity_key, run_id="run-1", graph_revision=1, node_id="other", input_mac=mac
    )
    assert different != first


def _aad(**overrides: Any) -> ProtectedAad:
    base: dict[str, Any] = {
        "run_id": "run-1",
        "graph_revision": 1,
        "record_kind": "event",
        "record_type": "NodeSucceeded",
        "sequence": 3,
        "field_path": "/data/outputRef",
        "capture_policy_hash": "aa" * 32,
        "key_ref_hash": "bb" * 32,
        "authority_binding_hash": "cc" * 32,
        "tenant_scope_hash": "dd" * 32,
        "value_mac": "ee" * 32,
        "event_id": "evt-3",
        "node_id": "worker",
        "attempt": 1,
    }
    base.update(overrides)
    return ProtectedAad(**base)


def test_protected_value_round_trips_and_rejects_a_copied_occurrence() -> None:
    key_provider = DeterministicTestKeyProvider()
    store = MemoryProtectedPayloadStore()
    identity_key = key_provider.run_identity_key("run-1")
    context = node_output_context("run-1", 1, "worker")
    logical = {"answer": "synthetic-value", "count": 3}
    mac = value_mac(identity_key, context, logical)
    aad = _aad(value_mac=mac)

    protection = protect_value(logical, aad=aad, key_provider=key_provider)
    # ``protect_value`` returns ``ProtectionResult | RedactionFailure``; naming
    # the success type asserts more than the previous ``is not None`` check did.
    assert isinstance(protection, ProtectionResult)
    reference = protection.reference
    store.put(reference, protection.blob_bytes)
    assert b"synthetic-value" not in protection.blob_bytes

    recovered = unprotect_value(
        reference,
        aad=aad,
        semantic_context=context,
        store=store,
        key_provider=key_provider,
    )
    assert recovered == logical

    # Copying the reference into another occurrence fails authentication.
    moved = _aad(value_mac=mac, sequence=4)
    failed = unprotect_value(
        reference,
        aad=moved,
        semantic_context=context,
        store=store,
        key_provider=key_provider,
    )
    assert getattr(failed, "code", None) == "PROTECTED_PAYLOAD_CORRUPT"


def test_event_aad_requires_an_event_id_and_forbids_a_checkpoint_id() -> None:
    assert _aad().validate() is None
    assert _aad(event_id=None).validate() is not None
    assert _aad(checkpoint_id="cp-1").validate() is not None
    checkpoint = _aad(record_kind="checkpoint", event_id=None, checkpoint_id="cp-1")
    assert checkpoint.validate() is None


def test_reference_never_carries_a_path_or_a_key_identifier() -> None:
    from graph_engineering.redaction.protect import validate_reference_document

    reference = ProtectedValueRef(
        ref="pv_01J00000000000000000000000",
        ciphertext_hash="aa" * 32,
        value_mac="bb" * 32,
        key_ref_hash="cc" * 32,
        aad_hash="dd" * 32,
    )
    assert validate_reference_document(reference.as_document()) is None
    unsafe = dict(reference.as_document())
    unsafe["ref"] = "../../operator-key"
    result = validate_reference_document(unsafe)
    assert result is not None
    assert result.code == "PROTECTED_PAYLOAD_UNAUTHORIZED"


# ----------------------------------------------------------------------
# canary scanner


def test_canary_scanner_finds_every_declared_encoding_form() -> None:
    registry = CanaryRegistry()
    registry.register("canary-1", "SYNTHETIC-CANARY-0001")
    for form, encoded in encoded_forms("SYNTHETIC-CANARY-0001").items():
        detection = registry.scan(b"prefix" + encoded + b"suffix", sink="event-journal")
        assert detection is not None, form
        assert detection.canary_id == "canary-1"
    assert registry.scan(b"clean bytes", sink="event-journal") is None


def test_canary_detection_blocks_the_write_and_reports_only_identity() -> None:
    guard, _, store = _guard()
    guard.canaries.register("canary-1", "SYNTHETIC-CANARY-0002")
    outcome = guard.prepare(
        _request(
            store,
            metadata={"data": {}, "note": "SYNTHETIC-CANARY-0002"},
            payload=NO_PAYLOAD,
            semantic_context=None,
            mac_field_path=None,
        )
    )
    assert isinstance(outcome, GuardFailed)
    assert outcome.failure.code == "SECRET_CANARY_DETECTED"
    assert set(outcome.failure.detail) == {"canaryId", "sink"}
    assert "SYNTHETIC-CANARY-0002" not in repr(outcome.failure)


# ----------------------------------------------------------------------
# policy


def test_policy_hash_is_stable_and_covers_the_closed_object() -> None:
    policy = _policy()
    assert capture_policy_hash(policy) == capture_policy_hash(_policy())
    widened = replace(policy, traces="protected")
    assert capture_policy_hash(widened) != capture_policy_hash(policy)
