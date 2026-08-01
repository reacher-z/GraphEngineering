"""Operator-owned payload protection for a durable run.

``redaction-semantics.md`` Section 4.2 is the whole point of this module: if a
durable start or checkpoint would persist an authoritative application value and
a compatible ``ProtectedPayloadStore`` plus ``KeyProvider`` are not configured,
the operation fails with ``PAYLOAD_PROTECTION_REQUIRED`` before the first event,
checkpoint, log, error payload, temporary plaintext file, or executor
invocation.  There is deliberately no no-op key provider, no in-process default
store, and no fallback to the legacy inline writer, because each of those would
turn a refusal into silent plaintext on disk.

A :class:`PayloadProtection` bundles the three things the durable runtime needs
and cannot invent for itself: the key authority, the protected blob store, and
the immutable effective capture policy.  From them it builds the one shared
:class:`~graph_engineering.redaction.guard.SinkGuard` every durable sink write
passes through, and it provides the inverse operation the recovery fold needs to
turn a committed protected reference back into an application value.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final

from .canonical import canonical_sha256
from .models import JsonValue
from .redaction.errors import RedactionFailure, failure
from .redaction.guard import SinkGuard
from .redaction.keys import KeyProvider, Protector
from .redaction.limits import DEFAULT_LIMITS, PortableLimits
from .redaction.policy import CapturePolicy, capture_policy_hash, default_stable_profile
from .redaction.protect import (
    ProtectedAad,
    ProtectedPayloadStore,
    ProtectedValueRef,
    authority_binding_hash,
    key_ref_hash,
    tenant_scope_hash,
    unprotect_value,
    validate_reference_document,
)
from .redaction.scan import CanaryRegistry

#: The transform implementation this package ships. Section 4.1 requires the
#: effective policy to name one; it identifies the pointer-transform code, and it
#: is never derived from source or result bytes.
TRANSFORM_IMPLEMENTATION_MANIFEST: Final = (
    "graph-engineering/python/redaction/json-pointer-rules/v1alpha2"
)
TRANSFORM_IMPLEMENTATION_HASH: Final = canonical_sha256(
    ["transform-implementation/v1alpha2", TRANSFORM_IMPLEMENTATION_MANIFEST]
)

#: The default profile enables no redaction rule at all, so the registry
#: snapshot this runtime resolves is the empty ordered registry at version 1.
RULE_REGISTRY_VERSION: Final = 1
RULE_REGISTRY_HASH: Final = canonical_sha256(["rule-registry/v1alpha2", RULE_REGISTRY_VERSION, []])


def default_durable_capture_policy(key_ref: str) -> CapturePolicy:
    """The Section 4.1 default stable profile pinned to one key reference."""

    return default_stable_profile(
        transform_implementation_hash=TRANSFORM_IMPLEMENTATION_HASH,
        rule_registry_version=RULE_REGISTRY_VERSION,
        rule_registry_hash=RULE_REGISTRY_HASH,
        key_ref=key_ref,
    )


class PayloadProtection:
    """The configured protection authority for one durable runtime.

    Construction requires a real key provider and a real protected payload
    store.  Neither has a default, so "unconfigured" is representable only as
    the absence of this object, which the durable entry points reject.
    """

    __slots__ = (
        "_authority_provider_id",
        "_authority_subject_id",
        "_guard",
        "_key_provider",
        "_limits",
        "_payload_store",
        "_policy",
        "_policy_hash",
        "_protector",
        "_tenant_scope_id",
    )

    def __init__(
        self,
        *,
        key_provider: KeyProvider,
        payload_store: ProtectedPayloadStore,
        policy: CapturePolicy | None = None,
        protector: Protector | None = None,
        tenant_scope_id: str = "tenant-local",
        authority_provider_id: str = "authority-local",
        authority_subject_id: str = "subject-local",
        canaries: CanaryRegistry | None = None,
        limits: PortableLimits = DEFAULT_LIMITS,
    ) -> None:
        if not isinstance(key_provider, KeyProvider):
            raise TypeError("payload protection requires a KeyProvider")
        if not isinstance(payload_store, ProtectedPayloadStore):
            raise TypeError("payload protection requires a ProtectedPayloadStore")
        resolved = policy if policy is not None else default_durable_capture_policy(
            key_provider.key_ref
        )
        if resolved.key_ref != key_provider.key_ref:
            raise ValueError("capture policy keyRef does not match the configured key provider")
        self._key_provider = key_provider
        self._payload_store = payload_store
        self._policy = resolved
        self._policy_hash = capture_policy_hash(resolved)
        self._protector = protector
        self._tenant_scope_id = tenant_scope_id
        self._authority_provider_id = authority_provider_id
        self._authority_subject_id = authority_subject_id
        self._limits = limits
        self._guard = SinkGuard(
            policy=resolved,
            key_provider=key_provider,
            store=payload_store,
            tenant_scope_id=tenant_scope_id,
            authority_provider_id=authority_provider_id,
            authority_subject_id=authority_subject_id,
            protector=protector,
            canaries=canaries,
            limits=limits,
        )

    @property
    def guard(self) -> SinkGuard:
        return self._guard

    @property
    def key_provider(self) -> KeyProvider:
        return self._key_provider

    @property
    def payload_store(self) -> ProtectedPayloadStore:
        return self._payload_store

    @property
    def policy(self) -> CapturePolicy:
        return self._policy

    @property
    def policy_hash(self) -> str:
        return self._policy_hash

    @property
    def key_ref_digest(self) -> str:
        return key_ref_hash(self._key_provider.key_ref)

    def identity_key(self, run_id: str) -> bytes:
        """The Section 5.3 run identity key, stable across resume."""

        return self._key_provider.run_identity_key(run_id)

    def reference_from_document(
        self, document: object
    ) -> ProtectedValueRef | RedactionFailure:
        """Validate one committed closed reference before it can affect state."""

        invalid = validate_reference_document(document)
        if invalid is not None:
            return invalid
        assert isinstance(document, Mapping)
        return ProtectedValueRef(
            ref=str(document["ref"]),
            ciphertext_hash=str(document["ciphertextHash"]),
            value_mac=str(document["valueMac"]),
            key_ref_hash=str(document["keyRefHash"]),
            aad_hash=str(document["aadHash"]),
        )

    def recover(
        self,
        reference: ProtectedValueRef,
        *,
        run_id: str,
        graph_revision: int,
        record_type: str,
        event_id: str,
        sequence: int,
        field_path: str,
        capture_policy_hash_value: str,
        semantic_context: Mapping[str, JsonValue],
        node_id: str | None = None,
        edge_id: str | None = None,
        attempt: int | None = None,
    ) -> JsonValue | RedactionFailure:
        """Authenticate one committed reference under its exact event AAD.

        The AAD is rebuilt from the persisted occurrence rather than stored
        beside the reference, so a reference copied from another event, run,
        field path, or capture policy fails authentication before the fold can
        observe any value.
        """

        if reference.key_ref_hash != self.key_ref_digest:
            return failure("PROTECTED_PAYLOAD_UNAUTHORIZED", "protect", runId=run_id)
        identity_key = self.identity_key(run_id)
        tenant = tenant_scope_hash(identity_key, self._tenant_scope_id)
        aad = ProtectedAad(
            run_id=run_id,
            graph_revision=graph_revision,
            record_kind="event",
            record_type=record_type,
            sequence=sequence,
            field_path=field_path,
            capture_policy_hash=capture_policy_hash_value,
            key_ref_hash=self.key_ref_digest,
            authority_binding_hash=authority_binding_hash(
                identity_key,
                authority_provider_id=self._authority_provider_id,
                authority_subject_id=self._authority_subject_id,
                tenant_scope=tenant,
                run_id=run_id,
                capture_policy_hash=capture_policy_hash_value,
                key_reference_hash=self.key_ref_digest,
            ),
            tenant_scope_hash=tenant,
            value_mac=reference.value_mac,
            event_id=event_id,
            node_id=node_id,
            edge_id=edge_id,
            attempt=attempt,
        )
        return unprotect_value(
            reference,
            aad=aad,
            semantic_context=semantic_context,
            store=self._payload_store,
            key_provider=self._key_provider,
            protector=self._protector,
        )
