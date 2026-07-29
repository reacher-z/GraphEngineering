"""Private cursor pre-rebind ownership capabilities and receipts.

This module is deliberately database independent.  It executes no SQL, owns
no TEMP object, performs no cursor rebind, and does not advance migration stage
state.  It only closes the in-memory A2b ownership boundary that a later Slice
B campaign must present.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal, cast
from weakref import WeakKeyDictionary

from .canonical import canonical_bytes
from .models import MAX_SAFE_INTEGER, JsonObject
from .sqlite_operation_baseline import (
    BASELINE_EMPTY_ROOT,
    BASELINE_ENTRY_KINDS,
    BASELINE_PROJECTION_DOMAIN,
    BaselineProjectionIdentity,
    create_baseline_id,
)
from .sqlite_operation_baseline_cursor_invariants import (
    SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS,
    SQLITE_CURSOR_PHYSICAL_FIELDS,
    SQLITE_CURSOR_SEAL_ALGORITHM_VERSION,
    SQLITE_CURSOR_SEAL_EMPTY_ROOT,
    SQLiteCursorImmutableSealReceipt,
)
from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineClockEvidence,
    SQLiteV1BaselineSourceSummary,
)

SQLITE_CURSOR_OWNERSHIP_CONTRIBUTION_DOMAIN = (
    b"graph-engineering/sqlite-cursor-ownership-contribution/v1\0"
)
SQLITE_CURSOR_CAPTURE_SESSION_DOMAIN = b"graph-engineering/sqlite-cursor-capture-session/v1\0"
SQLITE_CURSOR_EXACT_PROJECTION_DOMAIN = b"graph-engineering/sqlite-cursor-exact-projection/v1\0"
SQLITE_CURSOR_BASELINE_PROJECTION_REFERENCE_DOMAIN = (
    b"graph-engineering/sqlite-cursor-baseline-projection-reference/v1\0"
)
SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN = b"graph-engineering/sqlite-cursor-pre-rebind-receipt/v1\0"

SQLITE_CURSOR_MAIN_PROJECTION_SQL = (
    "SELECT tenant_id, token_hash, kind, principal_hash, authorization_hash, stream_id, "
    "checkpoint_scope, request_scope_blob, page_size, next_position, snapshot_tail_sequence, "
    "snapshot_tail_record_hash, descriptor_hash, schema_identity_sha256, snapshot_blob, "
    "created_at_ms, expires_at_ms, consumed_at_ms FROM main.ge_cycle_cursors "
    "ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY"
)

SQLITE_CURSOR_STATIC_CONTRACT_FIELDS: tuple[str, ...] = (
    "immutablePhysicalFields",
    "normalizedQuerySha256",
    "physicalFields",
    "sealAlgorithmVersion",
)
SQLITE_CURSOR_BASELINE_PROJECTION_REFERENCE_FIELDS: tuple[str, ...] = (
    "baselineId",
    "cursorContractSha256",
    "entryCount",
    "finalEntryHash",
    "firstEntryHash",
    "legacyOperationCount",
    "projectionSha256",
)
SQLITE_CURSOR_CAPTURE_SESSION_FIELDS: tuple[str, ...] = (
    "campaignOwnershipSha256",
    "connectionOwnershipSha256",
    "nonceSha256",
    "sourceStageOwnershipSha256",
    "tenantOwnershipSha256",
)
SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS: tuple[str, ...] = (
    "campaignOwnershipSha256",
    "captureSessionSha256",
    "capturedAtMs",
    "connectionOwnershipSha256",
    "cursorCount",
    "immutableRootSha256",
    "maximumNonCursorObservedAtMs",
    "projectionReferenceSha256",
    "providerHighWaterAtMs",
    "sourceDescriptorHash",
    "sourceSchemaIdentitySha256",
    "sourceStageOwnershipSha256",
    "tenantOwnershipSha256",
)

SQLiteCursorOwnershipKind = Literal["tenant", "source-stage", "campaign", "connection"]
_OWNERSHIP_KINDS = frozenset({"tenant", "source-stage", "campaign", "connection"})
_BASELINE_ID = re.compile(r"^v2-[0-9a-f]{64}$")
_CONSTRUCTION_TOKEN = object()


def _u64(value: int) -> bytes:
    return value.to_bytes(8, "big")


def _framed_hash(domain: bytes, document: JsonObject) -> str:
    encoded = canonical_bytes(document)
    return hashlib.sha256(domain + _u64(len(encoded)) + encoded).hexdigest()


def _hash(value: object, label: str) -> str:
    if (
        type(value) is not str
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(f"cursor ownership {label} is invalid")
    return value


def _integer(value: object, label: str) -> int:
    if type(value) is not int or value < 0 or value > MAX_SAFE_INTEGER:
        raise ValueError(f"cursor ownership {label} is outside bounds")
    return value


def _reference_bytes(value: bytes | bytearray | memoryview, label: str) -> bytes:
    try:
        copied = bytes(value)
    except Exception:
        raise TypeError(f"cursor ownership {label} reference is invalid") from None
    if len(copied) != 32:
        raise ValueError(f"cursor ownership {label} reference must contain exactly 32 bytes")
    return copied


def _contribution(kind: str, reference: bytes) -> str:
    kind_bytes = kind.encode("utf-8")
    return hashlib.sha256(
        SQLITE_CURSOR_OWNERSHIP_CONTRIBUTION_DOMAIN
        + _u64(len(kind_bytes))
        + kind_bytes
        + _u64(len(reference))
        + reference
    ).hexdigest()


class SQLiteCursorOwnershipCapability:
    """Opaque identity capability; all provenance lives in module-private storage."""

    __slots__ = ("__weakref__",)

    def __init__(self, construction_token: object) -> None:
        if construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor ownership capabilities are module-minted")


@dataclass(frozen=True, slots=True)
class _CapabilityMetadata:
    kind: SQLiteCursorOwnershipKind
    contribution_sha256: str


_CAPABILITIES: WeakKeyDictionary[SQLiteCursorOwnershipCapability, _CapabilityMetadata] = (
    WeakKeyDictionary()
)


def create_sqlite_cursor_ownership_capability(
    kind: SQLiteCursorOwnershipKind,
    reference_bytes: bytes | bytearray | memoryview,
) -> SQLiteCursorOwnershipCapability:
    """Mint one opaque, kind-bound capability from a defensively copied reference."""

    if kind not in _OWNERSHIP_KINDS:
        raise ValueError("cursor ownership capability kind is invalid")
    reference = _reference_bytes(reference_bytes, kind)
    capability = SQLiteCursorOwnershipCapability(_CONSTRUCTION_TOKEN)
    _CAPABILITIES[capability] = _CapabilityMetadata(kind, _contribution(kind, reference))
    return capability


def _capability(
    value: object,
    expected_kind: SQLiteCursorOwnershipKind,
) -> _CapabilityMetadata:
    if type(value) is not SQLiteCursorOwnershipCapability:
        raise TypeError(f"cursor {expected_kind} ownership capability is invalid")
    metadata = _CAPABILITIES.get(value)
    if metadata is None or metadata.kind != expected_kind:
        raise ValueError(f"cursor {expected_kind} ownership capability is invalid")
    return metadata


class SQLiteCursorCaptureSession:
    """Opaque identity tying tenant, stage, campaign and connection capabilities."""

    __slots__ = ("__weakref__",)

    def __init__(self, construction_token: object) -> None:
        if construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor capture sessions are module-minted")


@dataclass(frozen=True, slots=True)
class _CaptureSessionMetadata:
    tenant_ownership: SQLiteCursorOwnershipCapability
    source_stage_ownership: SQLiteCursorOwnershipCapability
    campaign_ownership: SQLiteCursorOwnershipCapability
    connection_ownership: SQLiteCursorOwnershipCapability
    tenant_ownership_sha256: str
    source_stage_ownership_sha256: str
    campaign_ownership_sha256: str
    connection_ownership_sha256: str
    nonce_sha256: str
    capture_session_sha256: str


_CAPTURE_SESSIONS: WeakKeyDictionary[SQLiteCursorCaptureSession, _CaptureSessionMetadata] = (
    WeakKeyDictionary()
)


def create_sqlite_cursor_capture_session(
    *,
    tenant_ownership: SQLiteCursorOwnershipCapability,
    source_stage_ownership: SQLiteCursorOwnershipCapability,
    campaign_ownership: SQLiteCursorOwnershipCapability,
    connection_ownership: SQLiteCursorOwnershipCapability,
    nonce: bytes | bytearray | memoryview,
) -> SQLiteCursorCaptureSession:
    """Mint a capture session without retaining any raw reference or nonce bytes."""

    tenant = _capability(tenant_ownership, "tenant")
    source_stage = _capability(source_stage_ownership, "source-stage")
    campaign = _capability(campaign_ownership, "campaign")
    connection = _capability(connection_ownership, "connection")
    copied_nonce = _reference_bytes(nonce, "nonce")
    nonce_sha256 = _contribution("nonce", copied_nonce)
    document = cast(
        JsonObject,
        {
            "campaignOwnershipSha256": campaign.contribution_sha256,
            "connectionOwnershipSha256": connection.contribution_sha256,
            "nonceSha256": nonce_sha256,
            "sourceStageOwnershipSha256": source_stage.contribution_sha256,
            "tenantOwnershipSha256": tenant.contribution_sha256,
        },
    )
    if tuple(document) != SQLITE_CURSOR_CAPTURE_SESSION_FIELDS:
        raise AssertionError("cursor capture session field order drifted")
    capture_session_sha256 = _framed_hash(SQLITE_CURSOR_CAPTURE_SESSION_DOMAIN, document)
    session = SQLiteCursorCaptureSession(_CONSTRUCTION_TOKEN)
    _CAPTURE_SESSIONS[session] = _CaptureSessionMetadata(
        tenant_ownership,
        source_stage_ownership,
        campaign_ownership,
        connection_ownership,
        tenant.contribution_sha256,
        source_stage.contribution_sha256,
        campaign.contribution_sha256,
        connection.contribution_sha256,
        nonce_sha256,
        capture_session_sha256,
    )
    return session


def _session(value: object) -> _CaptureSessionMetadata:
    if type(value) is not SQLiteCursorCaptureSession:
        raise TypeError("cursor capture session is invalid")
    metadata = _CAPTURE_SESSIONS.get(value)
    if metadata is None:
        raise ValueError("cursor capture session provenance is invalid")
    return metadata


def _normalized_main_projection_sql() -> str:
    return " ".join(SQLITE_CURSOR_MAIN_PROJECTION_SQL.split())


def sqlite_cursor_static_contract_document() -> JsonObject:
    document = cast(
        JsonObject,
        {
            "immutablePhysicalFields": list(SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS),
            "normalizedQuerySha256": hashlib.sha256(
                _normalized_main_projection_sql().encode("utf-8")
            ).hexdigest(),
            "physicalFields": list(SQLITE_CURSOR_PHYSICAL_FIELDS),
            "sealAlgorithmVersion": SQLITE_CURSOR_SEAL_ALGORITHM_VERSION,
        },
    )
    if tuple(document) != SQLITE_CURSOR_STATIC_CONTRACT_FIELDS:
        raise AssertionError("cursor static contract field order drifted")
    return document


SQLITE_CURSOR_STATIC_CONTRACT_SHA256 = _framed_hash(
    SQLITE_CURSOR_EXACT_PROJECTION_DOMAIN,
    sqlite_cursor_static_contract_document(),
)


class SQLiteCursorExactProjectionReference:
    """Opaque module-minted reference to one exact baseline projection object."""

    __slots__ = ("__weakref__",)

    def __init__(self, construction_token: object) -> None:
        if construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor projection references are module-minted")


@dataclass(frozen=True, slots=True)
class _ProjectionReferenceMetadata:
    projection_identity: BaselineProjectionIdentity
    projection_reference_sha256: str
    document: JsonObject


_PROJECTION_REFERENCES: WeakKeyDictionary[
    SQLiteCursorExactProjectionReference, _ProjectionReferenceMetadata
] = WeakKeyDictionary()


def _projection_document(identity: BaselineProjectionIdentity) -> JsonObject:
    if type(identity) is not BaselineProjectionIdentity:
        raise TypeError("cursor baseline projection identity is invalid")
    if (
        type(identity.baseline_id) is not str
        or _BASELINE_ID.fullmatch(identity.baseline_id) is None
    ):
        raise ValueError("cursor baseline projection identifier is invalid")
    entry_count = _integer(identity.entry_count, "projection entry count")
    legacy_count = _integer(identity.legacy_operation_count, "projection legacy count")
    if legacy_count > entry_count:
        raise ValueError("cursor baseline projection legacy count exceeds entry count")
    first = _hash(identity.first_entry_hash, "projection first entry hash")
    final = _hash(identity.final_entry_hash, "projection final entry hash")
    if (entry_count == 0) != (first == BASELINE_EMPTY_ROOT) or (entry_count == 0) != (
        final == BASELINE_EMPTY_ROOT
    ):
        raise ValueError("cursor empty baseline projection hashes are invalid")
    projection_input = cast(
        JsonObject,
        {
            "baselineId": identity.baseline_id,
            "entryCount": entry_count,
            "finalEntryHash": final,
            "firstEntryHash": first,
            "legacyOperationCount": legacy_count,
        },
    )
    expected_projection_sha256 = hashlib.sha256(
        BASELINE_PROJECTION_DOMAIN.encode("utf-8") + canonical_bytes(projection_input)
    ).hexdigest()
    if _hash(identity.projection_sha256, "projection hash") != expected_projection_sha256:
        raise ValueError("cursor baseline projection hash is inconsistent")
    document = cast(
        JsonObject,
        {
            "baselineId": identity.baseline_id,
            "cursorContractSha256": SQLITE_CURSOR_STATIC_CONTRACT_SHA256,
            "entryCount": entry_count,
            "finalEntryHash": final,
            "firstEntryHash": first,
            "legacyOperationCount": legacy_count,
            "projectionSha256": expected_projection_sha256,
        },
    )
    if tuple(document) != SQLITE_CURSOR_BASELINE_PROJECTION_REFERENCE_FIELDS:
        raise AssertionError("cursor baseline projection reference field order drifted")
    return document


def create_sqlite_cursor_exact_projection_reference(
    projection_identity: BaselineProjectionIdentity,
) -> SQLiteCursorExactProjectionReference:
    document = _projection_document(projection_identity)
    reference = SQLiteCursorExactProjectionReference(_CONSTRUCTION_TOKEN)
    _PROJECTION_REFERENCES[reference] = _ProjectionReferenceMetadata(
        projection_identity,
        _framed_hash(SQLITE_CURSOR_BASELINE_PROJECTION_REFERENCE_DOMAIN, document),
        document,
    )
    return reference


def _projection_reference(value: object) -> _ProjectionReferenceMetadata:
    if type(value) is not SQLiteCursorExactProjectionReference:
        raise TypeError("cursor exact projection reference is invalid")
    metadata = _PROJECTION_REFERENCES.get(value)
    if metadata is None:
        raise ValueError("cursor exact projection reference provenance is invalid")
    if _projection_document(metadata.projection_identity) != metadata.document:
        raise ValueError("cursor exact projection reference drifted")
    return metadata


@dataclass(frozen=True, slots=True)
class SQLiteCursorPreRebindReceiptCandidate:
    source_summary: SQLiteV1BaselineSourceSummary
    clock_evidence: SQLiteV1BaselineClockEvidence
    immutable_seal_receipt: SQLiteCursorImmutableSealReceipt
    projection_identity: BaselineProjectionIdentity
    projection_reference: SQLiteCursorExactProjectionReference
    capture_session: SQLiteCursorCaptureSession
    tenant_ownership: SQLiteCursorOwnershipCapability
    source_stage_ownership: SQLiteCursorOwnershipCapability
    campaign_ownership: SQLiteCursorOwnershipCapability
    connection_ownership: SQLiteCursorOwnershipCapability


@dataclass(frozen=True, slots=True)
class _ValidatedCandidate:
    candidate: SQLiteCursorPreRebindReceiptCandidate
    session: _CaptureSessionMetadata
    projection: _ProjectionReferenceMetadata
    receipt_document: JsonObject


def _validate_candidate(candidate: SQLiteCursorPreRebindReceiptCandidate) -> _ValidatedCandidate:
    if type(candidate) is not SQLiteCursorPreRebindReceiptCandidate:
        raise TypeError("cursor pre-rebind receipt candidate is invalid")
    summary = candidate.source_summary
    clock = candidate.clock_evidence
    seal = candidate.immutable_seal_receipt
    identity = candidate.projection_identity
    if type(summary) is not SQLiteV1BaselineSourceSummary:
        raise TypeError("cursor source summary is invalid")
    if type(clock) is not SQLiteV1BaselineClockEvidence or clock is not summary.clock_evidence:
        raise ValueError("cursor source clock evidence ownership is invalid")
    if type(seal) is not SQLiteCursorImmutableSealReceipt:
        raise TypeError("cursor immutable seal receipt is invalid")
    if type(identity) is not BaselineProjectionIdentity:
        raise TypeError("cursor baseline projection identity is invalid")
    if tuple(summary.counts_by_kind) != BASELINE_ENTRY_KINDS:
        raise ValueError("cursor source summary count families are invalid")
    source_count_total = 0
    for source_kind in BASELINE_ENTRY_KINDS:
        count = _integer(
            summary.counts_by_kind[source_kind],
            f"{source_kind} source count",
        )
        if source_count_total > MAX_SAFE_INTEGER - count:
            raise ValueError("cursor source summary count total is outside bounds")
        source_count_total += count
    expected_entry_count = _integer(summary.expected_entry_count, "expected source entry count")
    if source_count_total != expected_entry_count:
        raise ValueError("cursor source summary count total is inconsistent")
    projection = _projection_reference(candidate.projection_reference)
    if projection.projection_identity is not identity:
        raise ValueError("cursor baseline projection reference ownership is invalid")
    session = _session(candidate.capture_session)
    capabilities = (
        (candidate.tenant_ownership, session.tenant_ownership, "tenant"),
        (candidate.source_stage_ownership, session.source_stage_ownership, "source-stage"),
        (candidate.campaign_ownership, session.campaign_ownership, "campaign"),
        (candidate.connection_ownership, session.connection_ownership, "connection"),
    )
    for actual, expected, capability_kind in capabilities:
        _capability(actual, cast(SQLiteCursorOwnershipKind, capability_kind))
        if actual is not expected:
            raise ValueError(f"cursor {capability_kind} ownership capability was substituted")

    projection_document = _projection_document(identity)
    if projection_document != projection.document:
        raise ValueError("cursor baseline projection reference drifted")
    if identity.entry_count != expected_entry_count:
        raise ValueError("cursor baseline projection entry count differs from source summary")
    if identity.legacy_operation_count != summary.counts_by_kind["legacy-operation"]:
        raise ValueError("cursor baseline projection legacy count differs from source summary")
    envelope = summary.source_envelope
    if create_baseline_id(envelope) != identity.baseline_id:
        raise ValueError("cursor baseline projection identity differs from source envelope")
    captured = _integer(clock.captured_at_ms, "capture clock")
    maximum_non_cursor = _integer(
        clock.maximum_non_cursor_observed_at_ms,
        "maximum non-cursor clock",
    )
    provider_high_water = _integer(clock.provider_high_water_at_ms, "provider high-water")
    if envelope.get("capturedAtMs") != captured:
        raise ValueError("cursor source envelope capture clock is inconsistent")
    if provider_high_water < maximum_non_cursor or captured < provider_high_water:
        raise ValueError("cursor source clock ordering is invalid")
    descriptor = _hash(envelope.get("sourceDescriptorHash"), "source descriptor hash")
    schema = _hash(envelope.get("sourceSchemaIdentitySha256"), "source schema identity")
    cursor_count = _integer(seal.cursor_count, "cursor count")
    immutable_root = _hash(seal.immutable_root_sha256, "immutable cursor root")
    if (cursor_count == 0) != (immutable_root == SQLITE_CURSOR_SEAL_EMPTY_ROOT):
        raise ValueError("cursor immutable seal empty root is inconsistent")
    if (
        _hash(seal.source_descriptor_hash, "seal source descriptor hash") != descriptor
        or _hash(seal.source_schema_identity_sha256, "seal source schema identity") != schema
    ):
        raise ValueError("cursor immutable seal source identity differs from source summary")
    document = cast(
        JsonObject,
        {
            "campaignOwnershipSha256": session.campaign_ownership_sha256,
            "captureSessionSha256": session.capture_session_sha256,
            "capturedAtMs": captured,
            "connectionOwnershipSha256": session.connection_ownership_sha256,
            "cursorCount": cursor_count,
            "immutableRootSha256": immutable_root,
            "maximumNonCursorObservedAtMs": maximum_non_cursor,
            "projectionReferenceSha256": projection.projection_reference_sha256,
            "providerHighWaterAtMs": provider_high_water,
            "sourceDescriptorHash": descriptor,
            "sourceSchemaIdentitySha256": schema,
            "sourceStageOwnershipSha256": session.source_stage_ownership_sha256,
            "tenantOwnershipSha256": session.tenant_ownership_sha256,
        },
    )
    if tuple(document) != SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS:
        raise AssertionError("cursor pre-rebind receipt field order drifted")
    return _ValidatedCandidate(candidate, session, projection, document)


class SQLiteCursorPreRebindReceipt:
    """Opaque, module-minted A2b receipt capability."""

    __slots__ = ("__weakref__",)

    def __init__(self, construction_token: object) -> None:
        if construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor pre-rebind receipts are module-minted")


@dataclass(frozen=True, slots=True)
class SQLiteCursorPreRebindReceiptProvenance:
    """Package-private fence witness retaining the exact owned object graph."""

    receipt_sha256: str
    projection_reference_sha256: str
    source_summary: SQLiteV1BaselineSourceSummary
    clock_evidence: SQLiteV1BaselineClockEvidence
    immutable_seal_receipt: SQLiteCursorImmutableSealReceipt
    projection_identity: BaselineProjectionIdentity
    projection_reference: SQLiteCursorExactProjectionReference
    capture_session: SQLiteCursorCaptureSession
    tenant_ownership: SQLiteCursorOwnershipCapability
    source_stage_ownership: SQLiteCursorOwnershipCapability
    campaign_ownership: SQLiteCursorOwnershipCapability
    connection_ownership: SQLiteCursorOwnershipCapability


_RECEIPTS: WeakKeyDictionary[
    SQLiteCursorPreRebindReceipt, SQLiteCursorPreRebindReceiptProvenance
] = WeakKeyDictionary()


class SQLiteCursorPreRebindReceiptIssuer:
    """Issue exactly one receipt from one exact, fully validated object graph."""

    __slots__ = ("_expected", "_expected_document", "_issued")

    def __init__(self, expected: SQLiteCursorPreRebindReceiptCandidate) -> None:
        validated = _validate_candidate(expected)
        self._expected = expected
        self._expected_document = canonical_bytes(validated.receipt_document)
        self._issued = False

    @property
    def is_issued(self) -> bool:
        return self._issued

    def issue(
        self,
        candidate: SQLiteCursorPreRebindReceiptCandidate,
    ) -> SQLiteCursorPreRebindReceipt:
        if self._issued:
            raise ValueError("cursor pre-rebind receipt issuer is already consumed")
        validated = _validate_candidate(candidate)
        expected = self._expected
        exact_pairs = (
            (candidate.source_summary, expected.source_summary, "source summary"),
            (candidate.clock_evidence, expected.clock_evidence, "clock evidence"),
            (
                candidate.immutable_seal_receipt,
                expected.immutable_seal_receipt,
                "immutable seal receipt",
            ),
            (candidate.projection_identity, expected.projection_identity, "projection identity"),
            (
                candidate.projection_reference,
                expected.projection_reference,
                "projection reference",
            ),
            (candidate.capture_session, expected.capture_session, "capture session"),
            (candidate.tenant_ownership, expected.tenant_ownership, "tenant ownership"),
            (
                candidate.source_stage_ownership,
                expected.source_stage_ownership,
                "source-stage ownership",
            ),
            (candidate.campaign_ownership, expected.campaign_ownership, "campaign ownership"),
            (
                candidate.connection_ownership,
                expected.connection_ownership,
                "connection ownership",
            ),
        )
        for actual, exact, label in exact_pairs:
            if actual is not exact:
                raise ValueError(f"cursor pre-rebind {label} was substituted")
        if canonical_bytes(validated.receipt_document) != self._expected_document:
            raise ValueError("cursor pre-rebind receipt contribution drifted")

        receipt_sha256 = _framed_hash(
            SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN,
            validated.receipt_document,
        )
        receipt = SQLiteCursorPreRebindReceipt(_CONSTRUCTION_TOKEN)
        provenance = SQLiteCursorPreRebindReceiptProvenance(
            receipt_sha256,
            validated.projection.projection_reference_sha256,
            candidate.source_summary,
            candidate.clock_evidence,
            candidate.immutable_seal_receipt,
            candidate.projection_identity,
            candidate.projection_reference,
            candidate.capture_session,
            candidate.tenant_ownership,
            candidate.source_stage_ownership,
            candidate.campaign_ownership,
            candidate.connection_ownership,
        )
        _RECEIPTS[receipt] = provenance
        # The only state transition is deliberately last and non-throwing.
        self._issued = True
        return receipt


def assert_sqlite_cursor_pre_rebind_receipt_provenance(
    receipt: SQLiteCursorPreRebindReceipt,
) -> SQLiteCursorPreRebindReceiptProvenance:
    """Re-prove module minting and return the retained exact-context witness.

    This assertion is repeatable and has no lifecycle side effect.  Slice B may
    later consume the witness, but A2b neither starts nor advances a campaign.
    """

    if type(receipt) is not SQLiteCursorPreRebindReceipt:
        raise TypeError("cursor pre-rebind receipt is invalid")
    provenance = _RECEIPTS.get(receipt)
    if provenance is None:
        raise ValueError("cursor pre-rebind receipt provenance is invalid")
    expected = _validate_candidate(
        SQLiteCursorPreRebindReceiptCandidate(
            provenance.source_summary,
            provenance.clock_evidence,
            provenance.immutable_seal_receipt,
            provenance.projection_identity,
            provenance.projection_reference,
            provenance.capture_session,
            provenance.tenant_ownership,
            provenance.source_stage_ownership,
            provenance.campaign_ownership,
            provenance.connection_ownership,
        )
    )
    if (
        _framed_hash(SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN, expected.receipt_document)
        != provenance.receipt_sha256
    ):
        raise ValueError("cursor pre-rebind receipt provenance drifted")
    return provenance
