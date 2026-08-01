"""Shared durable-run protection fixtures for the test suite.

``redaction-semantics.md`` Section 4.2 makes a configured
:class:`~graph_engineering.redaction.protect.ProtectedPayloadStore` and
:class:`~graph_engineering.redaction.keys.KeyProvider` a precondition of every
durable run, so every durable test has to supply one.  The providers here are
the clearly named deterministic test providers Section 5.2 permits for fixed
conformance vectors; they are not a KMS and are never a production
configuration.
"""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from typing import Any

from graph_engineering.canonical import canonical_sha256
from graph_engineering.durable_protection import PayloadProtection
from graph_engineering.events import ProtectedGraphEvent
from graph_engineering.models import JsonValue
from graph_engineering.persistence.protected_journal import (
    EVENT_DISPOSITIONS,
    EVENT_V1ALPHA2_API_VERSION,
    GuardedJsonlEventStore,
    GuardedMemoryEventStore,
)
from graph_engineering.redaction.errors import RedactionFailure
from graph_engineering.redaction.keys import DeterministicTestKeyProvider
from graph_engineering.redaction.protect import (
    FileProtectedPayloadStore,
    MemoryProtectedPayloadStore,
    ProtectedAad,
    authority_binding_hash,
    graph_input_context,
    node_input_context,
    node_output_context,
    node_result_context,
    protect_value,
    run_result_context,
    tenant_scope_hash,
    value_mac,
)


def memory_protection(*, key_ref: str = "test://deterministic/key-1") -> PayloadProtection:
    """An in-memory protection authority for a durable run under test."""

    return PayloadProtection(
        key_provider=DeterministicTestKeyProvider(key_ref=key_ref),
        payload_store=MemoryProtectedPayloadStore(),
    )


def file_protection(
    root: str | os.PathLike[str],
    *,
    key_ref: str = "test://deterministic/key-1",
) -> PayloadProtection:
    """A protection authority whose blobs land on disk, for byte-level scans."""

    return PayloadProtection(
        key_provider=DeterministicTestKeyProvider(key_ref=key_ref),
        payload_store=FileProtectedPayloadStore(os.fspath(root)),
    )


def memory_journal(
    legacy_histories: Mapping[str, Sequence[Mapping[str, JsonValue]]] | None = None,
) -> GuardedMemoryEventStore:
    return GuardedMemoryEventStore(legacy_histories)


def file_journal(root: str | os.PathLike[str]) -> GuardedJsonlEventStore:
    return GuardedJsonlEventStore(root)


# ----------------------------------------------------------------------
# Adversarial history construction.
#
# A guarded sink deliberately has no public way to write a record the guard did
# not prepare, so a test cannot forge a history through the runtime API. These
# helpers reach into the in-memory store directly. That is a property of the
# test harness, not of the runtime: nothing in `graph_engineering` exposes an
# equivalent seam, and the recovery fold still has to reject what they install.


def resign(event: ProtectedGraphEvent, data: dict[str, Any]) -> ProtectedGraphEvent:
    """Rewrite one event's data and its `payloadHash` so only intent differs."""

    return event.model_copy(update={"data": data, "payload_hash": canonical_sha256(data)})


def forged_protected_event(
    *,
    run_id: str,
    sequence: int,
    event_type: str,
    data: dict[str, Any],
    capture_policy_hash: str,
    node_id: str | None = None,
    edge_id: str | None = None,
    attempt: int | None = None,
    timestamp: str = "2026-07-26T12:00:00.000Z",
    payload_disposition: str | None = None,
    redacted: bool = False,
) -> ProtectedGraphEvent:
    document: dict[str, Any] = {
        "apiVersion": EVENT_V1ALPHA2_API_VERSION,
        "eventId": f"forged:{sequence}",
        "type": event_type,
        "timestamp": timestamp,
        "runId": run_id,
        "graphRevision": 1,
        "sequence": sequence,
        "payloadHash": canonical_sha256(data),
        "capturePolicyHash": capture_policy_hash,
        "redacted": redacted,
        "payloadDisposition": (
            payload_disposition
            if payload_disposition is not None
            else EVENT_DISPOSITIONS.get(event_type, "metadata-only")
        ),
        "data": data,
    }
    if node_id is not None:
        document["nodeId"] = node_id
    if edge_id is not None:
        document["edgeId"] = edge_id
    if attempt is not None:
        document["attempt"] = attempt
    return ProtectedGraphEvent.model_validate(document)


def install_history(
    store: GuardedMemoryEventStore,
    run_id: str,
    events: Sequence[ProtectedGraphEvent],
) -> None:
    """Place an exact history into an in-memory guarded store, bypassing the guard."""

    store._streams[run_id] = list(events)


#: The protected field pair and semantic context of each `protected-ref` event.
PROTECTED_FIELDS: Mapping[str, tuple[str, str, str]] = {
    "RunCreated": ("inputRef", "inputMac", "graph-input"),
    "NodeScheduled": ("inputRef", "inputMac", "node-input"),
    "NodeSucceeded": ("outputRef", "outputMac", "node-output"),
    "NodeSettledWithoutAttempt": ("resultRef", "resultMac", "node-result"),
    "RunSucceeded": ("resultRef", "resultMac", "run-result"),
    "RunFailed": ("resultRef", "resultMac", "run-result"),
    "RunCancelled": ("resultRef", "resultMac", "run-result"),
}


def semantic_context_for(kind: str, run_id: str, node_id: str | None) -> dict[str, JsonValue]:
    if kind == "graph-input":
        return graph_input_context(run_id, 1)
    if kind == "run-result":
        return run_result_context(run_id, 1)
    assert node_id is not None
    if kind == "node-input":
        return node_input_context(run_id, 1, node_id)
    if kind == "node-output":
        return node_output_context(run_id, 1, node_id)
    return node_result_context(run_id, 1, node_id)


def rebind_event(
    protection: PayloadProtection,
    event: ProtectedGraphEvent,
    **updates: Any,
) -> ProtectedGraphEvent:
    """Move one committed event to a different occurrence, honestly.

    A protected reference is bound to its exact event AAD, so simply copying a
    record to another sequence or event id produces a reference that cannot
    authenticate. That is a real defence, but it is not the property most of
    these tests are about: they ask whether the *fold* rejects a semantically
    impossible history. So the value is recovered and protected again under the
    new occurrence, leaving the fold no cryptographic excuse.
    """

    fields = PROTECTED_FIELDS.get(event.type)
    moved = event.model_copy(update=updates)
    if fields is None:
        return moved
    reference_field, mac_field, kind = fields
    value = recover_occurrence(
        protection,
        event=event,
        reference_field=reference_field,
        semantic_context=semantic_context_for(kind, event.run_id, event.node_id),
    )
    return reprotect(
        protection,
        event=moved,
        reference_field=reference_field,
        mac_field=mac_field,
        value=value,
        semantic_context=semantic_context_for(kind, moved.run_id, moved.node_id),
    )


def protect_occurrence(
    protection: PayloadProtection,
    *,
    event: ProtectedGraphEvent,
    field_path: str,
    value: Any,
    semantic_context: Mapping[str, JsonValue],
) -> tuple[dict[str, JsonValue], str]:
    """Protect ``value`` as if the guard had written it into ``event``.

    Returns the closed reference document and its adjacent MAC, so an
    adversarial history can be structurally perfect — correct AAD, correct
    ciphertext hash, correct adjacent MAC — and still be semantically wrong.
    That is the interesting case: a fold that only checked cryptography would
    accept it.
    """

    identity_key = protection.identity_key(event.run_id)
    mac = value_mac(identity_key, semantic_context, value)
    tenant = tenant_scope_hash(identity_key, "tenant-local")
    reference_hash = protection.key_ref_digest
    aad = ProtectedAad(
        run_id=event.run_id,
        graph_revision=event.graph_revision,
        record_kind="event",
        record_type=event.type,
        sequence=event.sequence,
        field_path=field_path,
        capture_policy_hash=event.capture_policy_hash,
        key_ref_hash=reference_hash,
        authority_binding_hash=authority_binding_hash(
            identity_key,
            authority_provider_id="authority-local",
            authority_subject_id="subject-local",
            tenant_scope=tenant,
            run_id=event.run_id,
            capture_policy_hash=event.capture_policy_hash,
            key_reference_hash=reference_hash,
        ),
        tenant_scope_hash=tenant,
        value_mac=mac,
        event_id=event.event_id,
        node_id=event.node_id,
        edge_id=event.edge_id,
        attempt=event.attempt,
    )
    protected = protect_value(value, aad=aad, key_provider=protection.key_provider)
    assert not isinstance(protected, RedactionFailure), protected
    protection.payload_store.put(protected.reference, protected.blob_bytes)
    return protected.reference.as_document(), mac


def recover_occurrence(
    protection: PayloadProtection,
    *,
    event: ProtectedGraphEvent,
    reference_field: str,
    semantic_context: Mapping[str, JsonValue],
) -> Any:
    """Read one committed protected value back, for tests that mutate it."""

    reference = protection.reference_from_document(event.data[reference_field])
    assert not isinstance(reference, RedactionFailure), reference
    value = protection.recover(
        reference,
        run_id=event.run_id,
        graph_revision=event.graph_revision,
        record_type=event.type,
        event_id=event.event_id,
        sequence=event.sequence,
        field_path=f"/data/{reference_field}",
        capture_policy_hash_value=event.capture_policy_hash,
        semantic_context=semantic_context,
        node_id=event.node_id,
        edge_id=event.edge_id,
        attempt=event.attempt,
    )
    assert not isinstance(value, RedactionFailure), value
    return value


def reprotect(
    protection: PayloadProtection,
    *,
    event: ProtectedGraphEvent,
    reference_field: str,
    mac_field: str,
    value: Any,
    semantic_context: Mapping[str, JsonValue],
    extra: Mapping[str, JsonValue] | None = None,
) -> ProtectedGraphEvent:
    """Return ``event`` carrying a correctly protected replacement value."""

    document, mac = protect_occurrence(
        protection,
        event=event,
        field_path=f"/data/{reference_field}",
        value=value,
        semantic_context=semantic_context,
    )
    data: dict[str, Any] = dict(event.data)
    data[reference_field] = document
    data[mac_field] = mac
    if extra:
        data.update(extra)
    return resign(event, data)
