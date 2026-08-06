"""The shared deterministic sink-before-write guard of Section 7.

    immutable snapshot + portable validation
      -> classify field and sink
      -> compute keyed semantic identity for authoritative values
      -> apply immutable capture policy
      -> redact observational derivative OR protect authoritative bytes
      -> validate disposition, receipt, refs, and closed sink schema
      -> run canary/credential defense-in-depth scan
      -> canonicalize and hash the persisted representation
      -> write or export

For every classified source/sink pair the guard is a total host-code function:
it returns ``suppressed``, a structured failure, or one opaque in-memory
:class:`PreparedSinkWrite`.  It never throws caller or provider text, never
returns a partly transformed object, and never uses ``None`` as failure.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Final, Literal, SupportsIndex, TypeAlias

from ..canonical import canonical_bytes
from ..models import JsonValue
from .disposition import PayloadDisposition, validate_disposition
from .errors import (
    ExecutorOutcome,
    GuardPhase,
    RedactionFailure,
    RetryDisposition,
    SideEffects,
    failure,
)
from .flow import evaluate_flow
from .inventory import (
    NEVER_REDACTABLE_SINKS,
    NEVER_REDACTABLE_SOURCE_CLASSES,
    sink_row,
    source_row,
)
from .keys import KeyProvider, Protector
from .limits import (
    DEFAULT_LIMITS,
    PortableLimits,
    SnapshotError,
    SnapshotKeyCollisionError,
    portable_snapshot,
)
from .pointer import (
    PointerSyntaxError,
    PointerTransformResult,
    apply_pointer_transform,
    contains_transformed_material,
    decode_pointer,
)
from .policy import CapturePolicy, capture_policy_hash, policy_enabled_for
from .protect import (
    ProtectedAad,
    ProtectedPayloadStore,
    ProtectedValueRef,
    authority_binding_hash,
    deterministic_reference_id,
    key_ref_hash,
    protect_value,
    tenant_scope_hash,
    value_mac,
)
from .receipt import RedactionReceipt, TransformOccurrence, build_receipt, verify_receipt
from .scan import CanaryRegistry

SINK_GUARD_DECISION_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/sink-guard-decision/v1alpha1"
)

AuthorityClass: TypeAlias = Literal["authoritative", "observational"]
SideEffectsInput: TypeAlias = SideEffects | Literal["not-applicable"]

_NORMALIZED_SIDE_EFFECTS: Final[frozenset[str]] = frozenset(
    {"none", "idempotent", "non-idempotent", "unspecified"}
)

# The explicit "no application payload field was sourced" marker. ``None`` is a
# legitimate JSON payload, so absence needs its own sentinel.
NO_PAYLOAD: Final = object()

_CONSTRUCTION_TOKEN: Final = object()


class PreparedSinkWriteMisuse(RuntimeError):
    """Raised when a prepared write is copied, serialized, or reused."""


class PreparedSinkWrite:
    """One opaque, single-use authorization to write exact bytes to one sink.

    The constructor is private to the guard: a forged structural object, a
    serialized guard decision, a protected reference, or a store envelope cannot
    manufacture one.  It cannot be serialized or cloned, and the matching sink
    consumes it at most once.  Changed bytes, destination, policy, or decision
    require a new guard evaluation.
    """

    __slots__ = (
        "_consumed",
        "_decision_id",
        "_disposition",
        "_payload_bytes",
        "_payload_hash",
        "_policy_hash",
        "_sink",
        "_sink_instance",
    )

    def __init__(
        self,
        token: object,
        *,
        sink: str,
        sink_instance: object,
        payload_bytes: bytes,
        payload_hash: str,
        policy_hash: str,
        decision_id: str,
        disposition: PayloadDisposition,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise PreparedSinkWriteMisuse(
                "PreparedSinkWrite is constructed only by the sink guard"
            )
        self._sink = sink
        self._sink_instance = sink_instance
        self._payload_bytes = payload_bytes
        self._payload_hash = payload_hash
        self._policy_hash = policy_hash
        self._decision_id = decision_id
        self._disposition: PayloadDisposition = disposition
        self._consumed = False

    @property
    def sink(self) -> str:
        return self._sink

    @property
    def payload_hash(self) -> str:
        return self._payload_hash

    @property
    def policy_hash(self) -> str:
        return self._policy_hash

    @property
    def decision_id(self) -> str:
        return self._decision_id

    @property
    def payload_disposition(self) -> PayloadDisposition:
        return self._disposition

    @property
    def consumed(self) -> bool:
        return self._consumed

    def consume(self, sink_instance: object) -> bytes:
        """Return the canonical final bytes, exactly once, for the bound sink."""

        if self._consumed:
            raise PreparedSinkWriteMisuse("a prepared sink write is consumed at most once")
        if sink_instance is not self._sink_instance:
            raise PreparedSinkWriteMisuse("a prepared sink write binds one sink instance")
        self._consumed = True
        return self._payload_bytes

    # A prepared write is a capability, not data. Every path that would let it
    # escape the process or be duplicated is closed.
    def __reduce__(self) -> tuple[object, ...]:
        raise PreparedSinkWriteMisuse("a prepared sink write cannot be serialized")

    # ``protocol`` is typed as the supertype's ``SupportsIndex`` so the override
    # is substitutable: a narrower ``int`` would let ``pickle`` reach
    # ``object.__reduce_ex__`` through a base-class reference and serialize the
    # capability after all. The body still refuses every protocol.
    def __reduce_ex__(self, protocol: SupportsIndex) -> tuple[object, ...]:
        raise PreparedSinkWriteMisuse("a prepared sink write cannot be serialized")

    def __getstate__(self) -> object:
        raise PreparedSinkWriteMisuse("a prepared sink write cannot be serialized")

    def __copy__(self) -> PreparedSinkWrite:
        raise PreparedSinkWriteMisuse("a prepared sink write cannot be copied")

    def __deepcopy__(self, memo: dict[int, object]) -> PreparedSinkWrite:
        raise PreparedSinkWriteMisuse("a prepared sink write cannot be copied")

    def __repr__(self) -> str:
        return (
            f"PreparedSinkWrite(sink={self._sink!r}, decisionId={self._decision_id!r}, "
            f"consumed={self._consumed})"
        )


@dataclass(frozen=True, slots=True)
class OccurrenceContext:
    """The persisted occurrence a protected value or receipt is bound to."""

    run_id: str
    graph_revision: int
    record_kind: Literal["event", "checkpoint"]
    record_type: str
    occurrence_id: str
    sequence: int
    field_path: str
    occurred_at: str
    node_id: str | None = None
    edge_id: str | None = None
    attempt: int | None = None


@dataclass(frozen=True, slots=True)
class GuardPayloadField:
    """One authoritative application value bound to the field receiving its ref.

    The TypeScript lane's ``GuardPayloadField`` verbatim: ``field_path`` is the
    RFC 6901 pointer to the member of the final record that will hold the
    protected reference, ``mac_field_path`` optionally names the adjacent
    ``*Mac`` member (Section 6.1 requires it to equal ``valueMac``), and
    ``value`` is the raw application value, which is snapshotted and never
    serialized inline.
    """

    field_path: str
    semantic_context: Mapping[str, JsonValue]
    value: object
    mac_field_path: str | None = None


@dataclass(frozen=True, slots=True)
class SinkWriteRequest:
    """One candidate write.

    ``payload`` is the pre-transform application value.  The guard snapshots it;
    the caller must not place it into ``metadata`` itself.
    """

    source_class: str
    sink: str
    sink_instance: object
    authority_class: AuthorityClass
    occurrence: OccurrenceContext
    metadata: Mapping[str, JsonValue] = field(default_factory=dict)
    payload: object = NO_PAYLOAD
    semantic_context: Mapping[str, JsonValue] | None = None
    mac_field_path: str | None = None
    # Guard-owned envelope finalization. Section 8.1 step 7 computes the event
    # payload hash over the exact persisted payload *after* refs are placed, so
    # the guard performs it; a caller callback here would be an injection point.
    payload_hash_field: str | None = None
    payload_hash_source: str = "/data"
    decision_id: str | None = None
    side_effects: SideEffectsInput = "not-applicable"
    executor_outcome: ExecutorOutcome = "not-applicable"
    #: The control the sink row names for this write (Section 7). ``None`` means
    #: "the first control this sink declares", which is what the shared
    #: conformance sweeps use. It is never the *source* row's control: a source
    #: control is not a control this sink owns, and passing one here is the
    #: divergence that made the Python guard accept writes the TypeScript guard
    #: refused.
    policy_control: str | None = None
    #: Multi-payload records (the ``checkpoints/v1alpha2`` projection). Each
    #: field carries its own pointer, semantic context, and raw value, exactly
    #: like the TypeScript guard's ``payloads``. Mutually exclusive with the
    #: single ``payload``/``semantic_context``/``mac_field_path`` members.
    payloads: tuple[GuardPayloadField, ...] = ()
    #: Optional RFC 6901 pointer at which the guard writes the Section 6.2
    #: record content hash: SHA-256 of canonical UTF-8 JSON of the entire
    #: closed record with only this member omitted. Guard-owned finalization
    #: for the same reason ``payload_hash_field`` is: the hash must cover the
    #: placed protected references, which only exist after the guard's own
    #: transform.
    content_hash_field: str | None = None

    @property
    def has_payload(self) -> bool:
        return self.payload is not NO_PAYLOAD


@dataclass(frozen=True, slots=True)
class SinkGuardDecision:
    """The closed metadata-only audit projection.

    Even a record with ``writeAuthorized: true`` is not the opaque capability and
    cannot be passed to a sink, protected store, scheduler fold, or dependent
    release gate.
    """

    decision_id: str
    source_class: str
    sink: str
    authority_class: AuthorityClass
    capture_policy_hash: str
    outcome: Literal[
        "suppressed",
        "metadata-only",
        "protected-ref",
        "redacted",
        "inline-unredacted",
        "failed",
    ]
    write_authorized: bool
    prepared_payload_hash: str | None = None
    protected_refs: tuple[ProtectedValueRef, ...] = ()
    redaction_receipt: RedactionReceipt | None = None
    failure_code: str | None = None
    executor_outcome: ExecutorOutcome | None = None
    retry_disposition: RetryDisposition | None = None

    def as_document(self) -> dict[str, JsonValue]:
        document: dict[str, JsonValue] = {
            "apiVersion": SINK_GUARD_DECISION_API_VERSION,
            "decisionId": self.decision_id,
            "sourceClass": self.source_class,
            "sink": self.sink,
            "authorityClass": self.authority_class,
            "capturePolicyHash": self.capture_policy_hash,
            "outcome": self.outcome,
            "writeAuthorized": self.write_authorized,
        }
        if self.prepared_payload_hash is not None:
            document["preparedPayloadHash"] = self.prepared_payload_hash
        if self.protected_refs:
            document["protectedRefs"] = [ref.as_document() for ref in self.protected_refs]
        if self.redaction_receipt is not None:
            document["redactionReceipt"] = self.redaction_receipt.as_document()
        if self.outcome == "failed":
            document["failureCode"] = self.failure_code
            document["executorOutcome"] = self.executor_outcome
            document["retryDisposition"] = self.retry_disposition
        return document


@dataclass(frozen=True, slots=True)
class GuardSuppressed:
    """The representation is not permitted; nothing is written and nothing fails."""

    decision: SinkGuardDecision


@dataclass(frozen=True, slots=True)
class GuardFailed:
    """A structured denial with a stable code, phase, and retry disposition.

    ``cleaned_blobs`` counts protected blobs this evaluation published and then
    destroyed because the same evaluation failed.  They are not safe orphans: an
    orphan is a blob the guard successfully authorized and a later sink write
    failed to reference, which is outside this result.
    """

    failure: RedactionFailure
    decision: SinkGuardDecision
    cleaned_blobs: int = 0


@dataclass(frozen=True, slots=True)
class GuardPrepared:
    """One authorization to write exactly these bytes to exactly this sink."""

    prepared: PreparedSinkWrite
    decision: SinkGuardDecision
    document: Mapping[str, JsonValue]
    protected_refs: tuple[ProtectedValueRef, ...] = ()
    receipt: RedactionReceipt | None = None


GuardOutcome: TypeAlias = GuardSuppressed | GuardFailed | GuardPrepared


def normalize_side_effects(graph_value: object) -> SideEffects | RedactionFailure:
    """Section 6.1 side-effect normalization.

    Graph IR omission is normalized exactly once to the explicit v1alpha2 value
    ``unspecified``; it is never inferred as ``none``.  An unknown string fails
    before an event, protected-store write, or executor call.
    """

    if graph_value is None:
        return "unspecified"
    if graph_value in _NORMALIZED_SIDE_EFFECTS:
        return graph_value  # type: ignore[return-value]
    return failure("REDACTION_POLICY_INVALID", "classification")


def open_attempt_retry_disposition(side_effects: SideEffects) -> RetryDisposition:
    """Recovery classification for an open attempt committed with ``sideEffects``."""

    return "safe-new-attempt" if side_effects == "none" else "in-doubt-effect"


def retry_disposition_for(
    executor_outcome: ExecutorOutcome,
    side_effects: SideEffectsInput,
) -> RetryDisposition:
    """Section 10.1 disposition for a failed guard evaluation."""

    if side_effects == "not-applicable":
        return "not-applicable"
    if executor_outcome == "succeeded":
        return open_attempt_retry_disposition(side_effects)
    if executor_outcome == "not-applicable":
        return "not-applicable"
    return "forbidden"


class SinkGuard:
    """The one shared guard every default runtime sink writes through."""

    def __init__(
        self,
        *,
        policy: CapturePolicy | None,
        key_provider: KeyProvider | None = None,
        store: ProtectedPayloadStore | None = None,
        tenant_scope_id: str = "tenant-local",
        authority_provider_id: str = "authority-local",
        authority_subject_id: str = "subject-local",
        protector: Protector | None = None,
        canaries: CanaryRegistry | None = None,
        limits: PortableLimits = DEFAULT_LIMITS,
        fault_probe: Callable[[GuardPhase], RedactionFailure | None] | None = None,
    ) -> None:
        self._policy = policy
        self._policy_hash = capture_policy_hash(policy) if policy is not None else ""
        self._key_provider = key_provider
        self._store = store
        self._tenant_scope_id = tenant_scope_id
        self._authority_provider_id = authority_provider_id
        self._authority_subject_id = authority_subject_id
        self._protector = protector
        self._canaries = canaries if canaries is not None else CanaryRegistry()
        self._limits = limits
        # A declared fault seam. It can only turn an evaluation into a structured
        # failure; it can never authorize a write, widen a policy, or produce a
        # prepared write. The conformance corpus injects a failure at each named
        # phase and asserts the no-write / no-executor / retry-disposition rules,
        # which is not observable without one.
        self._fault_probe = fault_probe

    @property
    def policy_hash(self) -> str:
        return self._policy_hash

    @property
    def canaries(self) -> CanaryRegistry:
        return self._canaries

    def prepare(self, request: SinkWriteRequest) -> GuardOutcome:
        """Evaluate one candidate write. Total: never ``None``, never partial."""

        decision_id = request.decision_id or f"decision-{uuid.uuid4().hex[:16]}"
        try:
            return self._prepare(request, decision_id)
        except Exception:
            # An internal exception never produces a partial candidate and never
            # escapes into a raw diagnostic.
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_FAILED", "protect"),
            )

    def _probe(self, phase: GuardPhase) -> RedactionFailure | None:
        if self._fault_probe is None:
            return None
        return self._fault_probe(phase)

    def _prepare(self, request: SinkWriteRequest, decision_id: str) -> GuardOutcome:
        injected = self._probe("classification")
        if injected is not None:
            return self._failed(request, decision_id, injected)
        injected = self._probe("policy")
        if injected is not None:
            return self._failed(request, decision_id, injected)

        if self._policy is None:
            return self._failed(
                request,
                decision_id,
                failure("REDACTION_POLICY_REQUIRED", "policy"),
            )
        policy = self._policy

        # Side-effect classification is rejected before any store write or
        # executor call; omission never becomes ``none``.
        if request.side_effects != "not-applicable":
            normalized = normalize_side_effects(request.side_effects)
            if isinstance(normalized, RedactionFailure):
                return self._failed(request, decision_id, normalized)

        # Step 2: classify field and sink against the closed inventories.
        row = source_row(request.source_class)
        destination = sink_row(request.sink)
        if row is None or destination is None:
            return self._failed(
                request,
                decision_id,
                failure("REDACTION_POLICY_INVALID", "classification"),
            )
        try:
            decode_pointer(request.occurrence.field_path, limits=self._limits)
        except PointerSyntaxError:
            return self._failed(
                request,
                decision_id,
                failure("REDACTION_POLICY_INVALID", "classification", field="fieldPath"),
            )

        flow = evaluate_flow(
            request.source_class,
            request.sink,
            request.policy_control
            if request.policy_control is not None
            else destination.policy_controls[0],
            policy_enabled=policy_enabled_for(policy, request.source_class, request.sink),
        )
        if flow.outcome == "failed":
            assert flow.failure is not None
            return self._failed(request, decision_id, flow.failure)
        if flow.outcome == "suppressed":
            return GuardSuppressed(
                decision=SinkGuardDecision(
                    decision_id=decision_id,
                    source_class=request.source_class,
                    sink=request.sink,
                    authority_class=request.authority_class,
                    capture_policy_hash=self._policy_hash,
                    outcome="suppressed",
                    write_authorized=False,
                )
            )

        injected = self._probe("snapshot")
        if injected is not None:
            return self._failed(request, decision_id, injected)

        # Step 1: one immutable pre-transform snapshot.
        snapshot: JsonValue = None
        if request.has_payload:
            try:
                snapshot, _ = portable_snapshot(request.payload, limits=self._limits)
            except SnapshotKeyCollisionError:
                return self._failed(
                    request,
                    decision_id,
                    failure("REDACTION_RECEIPT_INVALID", "snapshot"),
                )
            except SnapshotError:
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_FAILED", "snapshot"),
                )
            # Section 7.1: a retry re-enters from the immutable pre-transform
            # snapshot and never re-transforms an already transformed value.
            if contains_transformed_material(snapshot):
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_FAILED", "snapshot"),
                )

        try:
            metadata_snapshot, _ = portable_snapshot(dict(request.metadata), limits=self._limits)
        except SnapshotError:
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_FAILED", "snapshot"),
            )
        assert isinstance(metadata_snapshot, dict)

        if request.authority_class == "authoritative" and flow.outcome != "protected-ref":
            # An authoritative value has exactly one legal representation here.
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_REQUIRED", "classification"),
            )

        if request.payloads:
            # A multi-payload record mixes with neither the single-payload form
            # nor a redacted derivative (Section 3.2).
            if request.has_payload or request.semantic_context is not None:
                return self._failed(
                    request,
                    decision_id,
                    failure("REDACTION_POLICY_INVALID", "classification"),
                )
            if flow.outcome != "protected-ref":
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_REQUIRED", "classification"),
                )
            return self._prepare_protected_many(request, decision_id, metadata_snapshot)

        if flow.outcome == "metadata-only":
            return self._prepare_metadata_only(request, decision_id, metadata_snapshot)

        # ``protected-ref`` requested. An observational source whose sink mode is
        # ``redacted`` produces a redacted derivative instead.
        rule = policy.rule_for_sink(request.sink)
        wants_redaction = (
            request.authority_class == "observational"
            and rule is not None
            and request.source_class not in NEVER_REDACTABLE_SOURCE_CLASSES
            and request.sink not in NEVER_REDACTABLE_SINKS
        )
        if wants_redaction:
            assert rule is not None
            return self._prepare_redacted(
                request, decision_id, metadata_snapshot, snapshot, rule
            )
        return self._prepare_protected(request, decision_id, metadata_snapshot, snapshot)

    # ------------------------------------------------------------------
    # representations

    def _prepare_metadata_only(
        self,
        request: SinkWriteRequest,
        decision_id: str,
        metadata: dict[str, JsonValue],
    ) -> GuardOutcome:
        if request.has_payload:
            # A metadata-only record containing an application payload or an
            # unapproved derivative is invalid.
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_REQUIRED", "classification"),
            )
        return self._finalize(request, decision_id, metadata, "metadata-only")

    def _prepare_protected(
        self,
        request: SinkWriteRequest,
        decision_id: str,
        metadata: dict[str, JsonValue],
        snapshot: JsonValue,
    ) -> GuardOutcome:
        if not request.has_payload:
            return self._finalize(request, decision_id, metadata, "metadata-only")
        if self._store is None or self._key_provider is None:
            # Section 4.2: fail before the first event, checkpoint, log, error
            # payload, temporary plaintext file, or executor invocation. Never
            # generate a key beside the ciphertext; never fall back to inline.
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_REQUIRED", "policy"),
            )
        if request.semantic_context is None:
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_FAILED", "mac"),
            )

        for phase in ("encode", "mac"):
            injected = self._probe(phase)
            if injected is not None:
                return self._failed(request, decision_id, injected)

        occurrence = request.occurrence
        identity_key = self._key_provider.run_identity_key(occurrence.run_id)
        mac = value_mac(identity_key, request.semantic_context, snapshot)
        tenant = tenant_scope_hash(identity_key, self._tenant_scope_id)
        reference_key_hash = key_ref_hash(self._key_provider.key_ref)
        authority = authority_binding_hash(
            identity_key,
            authority_provider_id=self._authority_provider_id,
            authority_subject_id=self._authority_subject_id,
            tenant_scope=tenant,
            run_id=occurrence.run_id,
            capture_policy_hash=self._policy_hash,
            key_reference_hash=reference_key_hash,
        )
        aad = ProtectedAad(
            run_id=occurrence.run_id,
            graph_revision=occurrence.graph_revision,
            record_kind=occurrence.record_kind,
            record_type=occurrence.record_type,
            sequence=occurrence.sequence,
            field_path=occurrence.field_path,
            capture_policy_hash=self._policy_hash,
            key_ref_hash=reference_key_hash,
            authority_binding_hash=authority,
            tenant_scope_hash=tenant,
            value_mac=mac,
            event_id=occurrence.occurrence_id if occurrence.record_kind == "event" else None,
            checkpoint_id=(
                occurrence.occurrence_id if occurrence.record_kind == "checkpoint" else None
            ),
            node_id=occurrence.node_id,
            edge_id=occurrence.edge_id,
            attempt=occurrence.attempt,
        )
        injected = self._probe("protect")
        if injected is not None:
            return self._failed(request, decision_id, injected)
        protection = protect_value(
            snapshot,
            aad=aad,
            key_provider=self._key_provider,
            protector=self._protector,
        )
        if isinstance(protection, RedactionFailure):
            return self._failed(request, decision_id, protection)

        injected = self._probe("atomic-publish")
        if injected is not None:
            return self._failed(request, decision_id, injected)
        try:
            self._store.put(protection.reference, protection.blob_bytes)
        except Exception:
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_FAILED", "atomic-publish"),
            )

        document = dict(metadata)
        placed = _insert_at_pointer(
            document, occurrence.field_path, protection.reference.as_document()
        )
        if not placed:
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_FAILED", "canonicalize", field="fieldPath"),
                safe_orphans=(protection.reference,),
            )
        if request.mac_field_path is not None and not _insert_at_pointer(
            document, request.mac_field_path, mac
        ):
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_FAILED", "canonicalize", field="fieldPath"),
                safe_orphans=(protection.reference,),
            )

        # Section 3.2: `protected-ref` containing plaintext beside the reference
        # is invalid. "Beside" is the container the reference is placed in, not
        # the whole record: a closed envelope legitimately carries graph-declared
        # identifiers, and a node whose output happens to equal its own node id
        # is not a plaintext leak. Every other member of that container is
        # caller-supplied inline material, which is exactly what this forbids.
        if _contains_payload_bytes(
            _reference_container(metadata, occurrence.field_path), snapshot
        ):
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_REQUIRED", "classification"),
                safe_orphans=(protection.reference,),
            )

        return self._finalize(
            request,
            decision_id,
            document,
            "protected-ref",
            protected_refs=(protection.reference,),
            safe_orphans=(protection.reference,),
        )

    def _prepare_protected_many(
        self,
        request: SinkWriteRequest,
        decision_id: str,
        metadata: dict[str, JsonValue],
    ) -> GuardOutcome:
        """Protect every payload field of one multi-payload record.

        The TypeScript guard's multi-payload branch verbatim, plus the
        deterministic reference derivation both lanes share:
        ``pv_`` + HMAC(identityKey, canonicalTagged(["protected-ref/v1alpha1",
        aadHash, ciphertextHash]))[:26], so identical inputs under the
        deterministic test provider produce byte-identical records.
        """

        import dataclasses

        if self._store is None or self._key_provider is None:
            # Section 4.2: fail before the first checkpoint byte, temporary
            # plaintext file, or executor invocation. Never fall back to inline.
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_REQUIRED", "policy"),
            )
        if len(request.payloads) > self._limits.max_protected_refs_per_record:
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_FAILED", "canonicalize"),
            )

        occurrence = request.occurrence
        identity_key = self._key_provider.run_identity_key(occurrence.run_id)
        tenant = tenant_scope_hash(identity_key, self._tenant_scope_id)
        reference_key_hash = key_ref_hash(self._key_provider.key_ref)
        authority = authority_binding_hash(
            identity_key,
            authority_provider_id=self._authority_provider_id,
            authority_subject_id=self._authority_subject_id,
            tenant_scope=tenant,
            run_id=occurrence.run_id,
            capture_policy_hash=self._policy_hash,
            key_reference_hash=reference_key_hash,
        )

        document = dict(metadata)
        refs: list[ProtectedValueRef] = []
        for field_spec in request.payloads:
            for pointer in (field_spec.field_path, field_spec.mac_field_path):
                if pointer is None:
                    continue
                try:
                    decode_pointer(pointer, limits=self._limits)
                except PointerSyntaxError:
                    return self._failed(
                        request,
                        decision_id,
                        failure(
                            "REDACTION_POLICY_INVALID", "classification", field="fieldPath"
                        ),
                        safe_orphans=tuple(refs),
                    )
            try:
                snapshot, _ = portable_snapshot(field_spec.value, limits=self._limits)
            except SnapshotKeyCollisionError:
                return self._failed(
                    request,
                    decision_id,
                    failure("REDACTION_RECEIPT_INVALID", "snapshot"),
                    safe_orphans=tuple(refs),
                )
            except SnapshotError:
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_FAILED", "snapshot"),
                    safe_orphans=tuple(refs),
                )
            # Section 7.1: never re-transform an already transformed value.
            if contains_transformed_material(snapshot):
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_FAILED", "snapshot"),
                    safe_orphans=tuple(refs),
                )

            mac = value_mac(identity_key, field_spec.semantic_context, snapshot)
            aad = ProtectedAad(
                run_id=occurrence.run_id,
                graph_revision=occurrence.graph_revision,
                record_kind=occurrence.record_kind,
                record_type=occurrence.record_type,
                sequence=occurrence.sequence,
                field_path=field_spec.field_path,
                capture_policy_hash=self._policy_hash,
                key_ref_hash=reference_key_hash,
                authority_binding_hash=authority,
                tenant_scope_hash=tenant,
                value_mac=mac,
                event_id=(
                    occurrence.occurrence_id if occurrence.record_kind == "event" else None
                ),
                checkpoint_id=(
                    occurrence.occurrence_id
                    if occurrence.record_kind == "checkpoint"
                    else None
                ),
                node_id=occurrence.node_id,
                edge_id=occurrence.edge_id,
                attempt=occurrence.attempt,
            )
            injected = self._probe("protect")
            if injected is not None:
                return self._failed(request, decision_id, injected, safe_orphans=tuple(refs))
            protection = protect_value(
                snapshot,
                aad=aad,
                key_provider=self._key_provider,
                protector=self._protector,
            )
            if isinstance(protection, RedactionFailure):
                return self._failed(request, decision_id, protection, safe_orphans=tuple(refs))
            reference = dataclasses.replace(
                protection.reference,
                ref=deterministic_reference_id(
                    identity_key,
                    aad_hash=protection.reference.aad_hash,
                    ciphertext_hash=protection.reference.ciphertext_hash,
                ),
            )

            injected = self._probe("atomic-publish")
            if injected is not None:
                return self._failed(request, decision_id, injected, safe_orphans=tuple(refs))
            try:
                self._store.put(reference, protection.blob_bytes)
            except Exception:
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_FAILED", "atomic-publish"),
                    safe_orphans=tuple(refs),
                )
            refs.append(reference)

            if not _insert_at_pointer(
                document, field_spec.field_path, reference.as_document()
            ):
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_FAILED", "canonicalize", field="fieldPath"),
                    safe_orphans=tuple(refs),
                )
            if field_spec.mac_field_path is not None and not _insert_at_pointer(
                document, field_spec.mac_field_path, mac
            ):
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_FAILED", "canonicalize", field="fieldPath"),
                    safe_orphans=tuple(refs),
                )
            # Section 3.2: plaintext beside the reference is invalid.
            if _contains_payload_bytes(
                _reference_container(metadata, field_spec.field_path), snapshot
            ):
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_REQUIRED", "classification"),
                    safe_orphans=tuple(refs),
                )

        return self._finalize(
            request,
            decision_id,
            document,
            "protected-ref",
            protected_refs=tuple(refs),
            safe_orphans=tuple(refs),
        )

    def _prepare_redacted(
        self,
        request: SinkWriteRequest,
        decision_id: str,
        metadata: dict[str, JsonValue],
        snapshot: JsonValue,
        rule: object,
    ) -> GuardOutcome:
        from .policy import RedactionRule

        assert isinstance(rule, RedactionRule)
        policy = self._policy
        assert policy is not None
        if self._key_provider is None:
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_REQUIRED", "policy"),
            )
        if not request.has_payload:
            return self._finalize(request, decision_id, metadata, "metadata-only")

        transformed = apply_pointer_transform(
            snapshot, list(rule.paths), rule.replacement_mode, limits=self._limits
        )
        if not isinstance(transformed, PointerTransformResult):
            return self._failed(request, decision_id, transformed.failure)

        occurrence = request.occurrence
        identity_key = self._key_provider.run_identity_key(occurrence.run_id)
        tenant = tenant_scope_hash(identity_key, self._tenant_scope_id)
        authority = authority_binding_hash(
            identity_key,
            authority_provider_id=self._authority_provider_id,
            authority_subject_id=self._authority_subject_id,
            tenant_scope=tenant,
            run_id=occurrence.run_id,
            capture_policy_hash=self._policy_hash,
            key_reference_hash=key_ref_hash(self._key_provider.key_ref),
        )
        transform_occurrence = TransformOccurrence(
            source_class=request.source_class,
            sink=request.sink,
            decision_id=decision_id,
            run_id=occurrence.run_id,
            graph_revision=occurrence.graph_revision,
            occurrence_kind="sink-write",
            occurrence_id=occurrence.occurrence_id,
            occurrence_sequence=occurrence.sequence,
            occurred_at=occurrence.occurred_at,
            field_path=occurrence.field_path,
        )
        receipt = build_receipt(
            identity_key=identity_key,
            policy_hash=self._policy_hash,
            transform_implementation_hash=policy.transform_implementation_hash,
            rule_registry_hash=policy.rule_registry_hash,
            rule_registry_version=policy.rule_registry_version,
            rule_resolution_id=f"resolution-{policy.rule_registry_version}",
            authority_binding_hash=authority,
            tenant_scope_hash=tenant,
            occurrence=transform_occurrence,
            rules=(rule,),
            source_snapshot=snapshot,
            transformed=transformed.output,
            paths=transformed.canonical_paths,
            replacement_mode=rule.replacement_mode,
        )
        # The guard deterministically replays the transform and compares the
        # exact persisted result before a sink can be authorized.
        invalid = verify_receipt(
            receipt,
            identity_key=identity_key,
            source_snapshot=snapshot,
            persisted_result=transformed.output,
            occurrence=transform_occurrence,
            limits=self._limits,
        )
        if invalid is not None:
            return self._failed(request, decision_id, invalid)

        document = dict(metadata)
        if not _insert_at_pointer(document, occurrence.field_path, transformed.output):
            return self._failed(
                request,
                decision_id,
                failure("REDACTION_RECEIPT_INVALID", "canonicalize", field="fieldPath"),
            )
        return self._finalize(request, decision_id, document, "redacted", receipt=receipt)

    # ------------------------------------------------------------------
    # finalization

    def _finalize(
        self,
        request: SinkWriteRequest,
        decision_id: str,
        document: dict[str, JsonValue],
        disposition: PayloadDisposition,
        *,
        protected_refs: tuple[ProtectedValueRef, ...] = (),
        receipt: RedactionReceipt | None = None,
        safe_orphans: tuple[ProtectedValueRef, ...] = (),
    ) -> GuardOutcome:
        if request.payload_hash_field is not None:
            source = _read_at_pointer(document, request.payload_hash_source)
            if source is _MISSING or not _insert_at_pointer(
                document,
                request.payload_hash_field,
                hashlib.sha256(canonical_bytes(source)).hexdigest(),
            ):
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_FAILED", "canonicalize", field="payloadHash"),
                    safe_orphans=safe_orphans,
                )

        if request.content_hash_field is not None:
            # Section 6.2: SHA-256 of canonical UTF-8 JSON of the entire closed
            # record with only the content-hash member omitted. The metadata
            # already carries the disposition facts, so the covered set matches
            # the TypeScript guard byte for byte.
            digest = hashlib.sha256(canonical_bytes(document)).hexdigest()
            if not _insert_at_pointer(document, request.content_hash_field, digest):
                return self._failed(
                    request,
                    decision_id,
                    failure("PAYLOAD_PROTECTION_FAILED", "canonicalize", field="contentHash"),
                    safe_orphans=safe_orphans,
                )

        injected = self._probe("receipt")
        if injected is not None:
            return self._failed(request, decision_id, injected, safe_orphans=safe_orphans)

        facts: dict[str, JsonValue] = {
            "payloadDisposition": disposition,
            "redacted": disposition == "redacted",
        }
        if receipt is not None:
            facts["redactionReceipt"] = receipt.as_document()
        invalid = validate_disposition(facts, source_class=request.source_class)
        if invalid is not None:
            return self._failed(request, decision_id, invalid, safe_orphans=safe_orphans)

        injected = self._probe("canonicalize")
        if injected is not None:
            return self._failed(request, decision_id, injected, safe_orphans=safe_orphans)

        try:
            payload_bytes = canonical_bytes(document)
        except (TypeError, ValueError):
            return self._failed(
                request,
                decision_id,
                failure("PAYLOAD_PROTECTION_FAILED", "canonicalize"),
                safe_orphans=safe_orphans,
            )

        injected = self._probe("scan")
        if injected is not None:
            return self._failed(request, decision_id, injected, safe_orphans=safe_orphans)

        detection = self._canaries.scan(payload_bytes, sink=request.sink)
        if detection is not None:
            # Report only the canary identifier and the sink; never the value.
            return self._failed(
                request,
                decision_id,
                failure(
                    "SECRET_CANARY_DETECTED",
                    "scan",
                    canaryId=detection.canary_id,
                    sink=detection.sink,
                ),
                safe_orphans=safe_orphans,
            )

        payload_hash = hashlib.sha256(payload_bytes).hexdigest()
        prepared = PreparedSinkWrite(
            _CONSTRUCTION_TOKEN,
            sink=request.sink,
            sink_instance=request.sink_instance,
            payload_bytes=payload_bytes,
            payload_hash=payload_hash,
            policy_hash=self._policy_hash,
            decision_id=decision_id,
            disposition=disposition,
        )
        decision = SinkGuardDecision(
            decision_id=decision_id,
            source_class=request.source_class,
            sink=request.sink,
            authority_class=request.authority_class,
            capture_policy_hash=self._policy_hash,
            outcome=disposition,
            write_authorized=True,
            prepared_payload_hash=payload_hash,
            protected_refs=protected_refs,
            redaction_receipt=receipt,
        )
        return GuardPrepared(
            prepared=prepared,
            decision=decision,
            document=document,
            protected_refs=protected_refs,
            receipt=receipt,
        )

    def _failed(
        self,
        request: SinkWriteRequest,
        decision_id: str,
        redaction_failure: RedactionFailure,
        *,
        safe_orphans: tuple[ProtectedValueRef, ...] = (),
    ) -> GuardFailed:
        cleaned = 0
        for reference in safe_orphans:
            # Section 10.1: bytes belonging to a failed evaluation are destroyed
            # rather than treated as an orphan. No event or checkpoint reference
            # to them was ever committed.
            if self._store is not None:
                try:
                    self._store.delete(reference)
                except Exception:
                    continue
            cleaned += 1
        decision = SinkGuardDecision(
            decision_id=decision_id,
            source_class=request.source_class,
            sink=request.sink,
            authority_class=request.authority_class,
            capture_policy_hash=self._policy_hash,
            outcome="failed",
            write_authorized=False,
            failure_code=redaction_failure.code,
            executor_outcome=request.executor_outcome,
            retry_disposition=retry_disposition_for(
                request.executor_outcome, request.side_effects
            ),
        )
        return GuardFailed(
            failure=redaction_failure,
            decision=decision,
            cleaned_blobs=cleaned,
        )


_ARRAY_INDEX: Final = re.compile(r"^(?:0|[1-9][0-9]*)$")


def _insert_at_pointer(document: dict[str, JsonValue], pointer: str, value: JsonValue) -> bool:
    """Place one value at an RFC 6901 pointer inside the record envelope.

    Only a fresh object member may be created: overwriting an existing member
    would let a caller pre-place plaintext and have the guard bless it.
    An intermediate array token must be canonical and address an existing
    element, and the leaf can never be an array element — the exact
    ``defineAtPointer`` rules of the TypeScript guard.
    """

    try:
        tokens = decode_pointer(pointer)
    except PointerSyntaxError:
        return False
    current: JsonValue = document
    for token in tokens[:-1]:
        if type(current) is list:
            if _ARRAY_INDEX.fullmatch(token) is None:
                return False
            index = int(token)
            if index >= len(current):
                return False
            current = current[index]
            continue
        if type(current) is not dict:
            return False
        assert isinstance(current, dict)
        if token not in current:
            current[token] = {}
        current = current[token]
    if type(current) is not dict:
        return False
    assert isinstance(current, dict)
    if tokens[-1] in current:
        return False
    current[tokens[-1]] = value
    return True


_MISSING: Final = object()


def _read_at_pointer(document: dict[str, JsonValue], pointer: str) -> JsonValue:
    try:
        tokens = decode_pointer(pointer)
    except PointerSyntaxError:
        return _MISSING  # type: ignore[return-value]
    current: JsonValue = document
    for token in tokens:
        if type(current) is not dict:
            return _MISSING  # type: ignore[return-value]
        assert isinstance(current, dict)
        if token not in current:
            return _MISSING  # type: ignore[return-value]
        current = current[token]
    return current


def _reference_container(
    metadata: Mapping[str, JsonValue],
    field_path: str,
) -> Mapping[str, JsonValue]:
    """The object the protected reference will be inserted into.

    Falls back to the complete record when the parent cannot be resolved, so an
    unresolvable path never narrows the check.
    """

    try:
        tokens = decode_pointer(field_path)
    except PointerSyntaxError:
        return metadata
    if len(tokens) < 2:
        return metadata
    current: JsonValue = dict(metadata)
    for token in tokens[:-1]:
        if type(current) is list:
            if _ARRAY_INDEX.fullmatch(token) is None or int(token) >= len(current):
                return metadata
            current = current[int(token)]
            continue
        if type(current) is not dict or token not in current:
            return metadata
        current = current[token]
    if type(current) is not dict:
        return metadata
    return current


def _contains_payload_bytes(metadata: Mapping[str, JsonValue], snapshot: JsonValue) -> bool:
    if snapshot is None or snapshot == "" or snapshot == {} or snapshot == []:
        return False
    payload = canonical_bytes(snapshot)
    if len(payload) < 3:
        return False
    return payload in canonical_bytes(dict(metadata))


def guard_phase_of(redaction_failure: RedactionFailure) -> GuardPhase:
    return redaction_failure.phase


def decision_documents(decisions: Sequence[SinkGuardDecision]) -> list[JsonValue]:
    return [decision.as_document() for decision in decisions]
