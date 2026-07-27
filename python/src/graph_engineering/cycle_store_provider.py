"""Provider-neutral CycleStore contract and deterministic reference model.

The memory implementation is an executable oracle for adapter conformance. It
is process-local, deliberately non-durable, and never claims distributed
fencing. SQLite and PostgreSQL adapters implement this protocol without
depending on these in-memory containers.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, Never, Protocol, TypeAlias, cast, runtime_checkable

from .canonical import canonical_bytes, canonical_json, canonical_sha256
from .models import MAX_SAFE_INTEGER, JsonObject, JsonValue
from .portable_json import portable_json_snapshot

CYCLE_STORE_PROVIDER_API_VERSION = (
    "graphengineering.reacher-z.github.io/cycle-store-providers/v1alpha1"
)
CYCLE_STORE_PROVIDER_CONTRACT_VERSION = "cycle-store-provider/v1alpha1"
CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN = (
    "graph-engineering/cycle-store-provider-descriptor/v1alpha1\0"
)
CYCLE_STORE_RECORD_DOMAIN = "graph-engineering/cycle-store-record/v1alpha1\0"
CYCLE_STORE_OPERATION_DOMAIN = "graph-engineering/cycle-store-operation/v1alpha1\0"

MAX_CYCLE_STORE_APPEND_RECORDS = 64
MAX_CYCLE_STORE_RECORD_BYTES = 1_048_576
MAX_CYCLE_STORE_APPEND_BYTES = 8_388_608
MAX_CYCLE_STORE_PAGE_SIZE = 256
MAX_CYCLE_STORE_CHECKPOINT_BYTES = 16_777_216
MAX_CYCLE_STORE_LEASE_TTL_MS = 86_400_000
MAX_CYCLE_STORE_CURSOR_COUNT = 4_096
CYCLE_STORE_CURSOR_TTL_MS = 300_000

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_HASH = re.compile(r"^[0-9a-f]{64}$")
_RFC3339 = re.compile(
    r"^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])"
    r"T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)

CycleStoreProviderOperation: TypeAlias = Literal[
    "describe",
    "inspect-schema",
    "read-tail",
    "append",
    "read-event-page",
    "save-checkpoint",
    "load-checkpoint",
    "list-checkpoints",
    "delete-checkpoint",
    "acquire-lease",
    "renew-lease",
    "release-lease",
    "inspect-lease",
    "set-legal-hold",
    "inspect-governance",
    "acquire-migration-lock",
    "inspect-migration-lock",
    "release-migration-lock",
]

CYCLE_STORE_PROVIDER_OPERATIONS: tuple[CycleStoreProviderOperation, ...] = (
    "describe",
    "inspect-schema",
    "read-tail",
    "append",
    "read-event-page",
    "save-checkpoint",
    "load-checkpoint",
    "list-checkpoints",
    "delete-checkpoint",
    "acquire-lease",
    "renew-lease",
    "release-lease",
    "inspect-lease",
    "set-legal-hold",
    "inspect-governance",
    "acquire-migration-lock",
    "inspect-migration-lock",
    "release-migration-lock",
)

CycleStoreProviderErrorCode: TypeAlias = Literal[
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    "GE_CYCLE_STORE_INVALID_CURSOR",
    "GE_CYCLE_STORE_NOT_FOUND",
    "GE_CYCLE_STORE_CONFLICT",
    "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT",
    "GE_CYCLE_STORE_LEASE_CONFLICT",
    "GE_CYCLE_STORE_STALE_FENCE",
    "GE_CYCLE_STORE_UNAVAILABLE",
    "GE_CYCLE_STORE_CORRUPTION",
    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
    "GE_CYCLE_STORE_PERMISSION_DENIED",
    "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
    "GE_CYCLE_STORE_LEGAL_HOLD",
    "GE_CYCLE_STORE_MIGRATION_LOCKED",
    "GE_CYCLE_STORE_INTERNAL",
]

CYCLE_STORE_PROVIDER_ERROR_CODES: tuple[CycleStoreProviderErrorCode, ...] = (
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    "GE_CYCLE_STORE_INVALID_CURSOR",
    "GE_CYCLE_STORE_NOT_FOUND",
    "GE_CYCLE_STORE_CONFLICT",
    "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT",
    "GE_CYCLE_STORE_LEASE_CONFLICT",
    "GE_CYCLE_STORE_STALE_FENCE",
    "GE_CYCLE_STORE_UNAVAILABLE",
    "GE_CYCLE_STORE_CORRUPTION",
    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
    "GE_CYCLE_STORE_PERMISSION_DENIED",
    "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
    "GE_CYCLE_STORE_LEGAL_HOLD",
    "GE_CYCLE_STORE_MIGRATION_LOCKED",
    "GE_CYCLE_STORE_INTERNAL",
)

_RETRYABLE_CODES: frozenset[CycleStoreProviderErrorCode] = frozenset(
    {
        "GE_CYCLE_STORE_CONFLICT",
        "GE_CYCLE_STORE_LEASE_CONFLICT",
        "GE_CYCLE_STORE_STALE_FENCE",
        "GE_CYCLE_STORE_UNAVAILABLE",
        "GE_CYCLE_STORE_MIGRATION_LOCKED",
        "GE_CYCLE_STORE_INTERNAL",
    }
)

CycleStoreProviderDescriptor: TypeAlias = JsonObject
CycleStoreAuthorizationContext: TypeAlias = JsonObject
CycleStoreMutationContext: TypeAlias = JsonObject
CycleStoreTail: TypeAlias = JsonObject
CycleStoreRecord: TypeAlias = JsonObject
CycleStoreLeaseBinding: TypeAlias = JsonObject
CycleStoreLease: TypeAlias = JsonObject
CycleStoreLeaseInspection: TypeAlias = JsonObject
CycleStoreCheckpoint: TypeAlias = JsonObject
CycleStoreCheckpointSummary: TypeAlias = JsonObject
CycleStoreEventPage: TypeAlias = JsonObject
CycleStoreCheckpointPage: TypeAlias = JsonObject
CycleStoreMigrationLock: TypeAlias = JsonObject
CycleStoreSchemaInspection: TypeAlias = JsonObject
CycleStoreGovernanceInspection: TypeAlias = JsonObject


class CycleStoreProviderError(Exception):
    """Closed, portable provider failure without raw causes or payloads."""

    def __init__(
        self,
        code: CycleStoreProviderErrorCode,
        operation: CycleStoreProviderOperation,
        message: str,
        details: JsonObject | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.operation = operation
        self.retryable = code in _RETRYABLE_CODES
        self.details = cast(JsonObject, portable_json_snapshot(details or {}))

    def to_dict(self) -> JsonObject:
        return cast(
            JsonObject,
            portable_json_snapshot(
                {
                    "name": "CycleStoreProviderError",
                    "code": self.code,
                    "operation": self.operation,
                    "retryable": self.retryable,
                    "message": str(self),
                    "details": self.details,
                }
            ),
        )


def _fail(
    code: CycleStoreProviderErrorCode,
    operation: CycleStoreProviderOperation,
    message: str,
    details: JsonObject | None = None,
) -> Never:
    raise CycleStoreProviderError(code, operation, message, details)


def _domain_hash(domain: str, value: object) -> str:
    digest = hashlib.sha256()
    digest.update(domain.encode("utf-8"))
    digest.update(canonical_bytes(value))
    return digest.hexdigest()


def _clone(value: object) -> JsonValue:
    return portable_json_snapshot(value)


def _capture_bounded_json(value: object, maximum_bytes: int) -> tuple[JsonValue, int]:
    captured = portable_json_snapshot(value)
    byte_count = len(canonical_bytes(captured))
    if byte_count > maximum_bytes:
        raise ValueError("portable JSON exceeds its canonical byte bound")
    return captured, byte_count


def _capture_object(
    value: object,
    operation: CycleStoreProviderOperation,
    label: str,
    maximum_bytes: int = MAX_CYCLE_STORE_APPEND_BYTES,
) -> JsonObject:
    try:
        captured, _ = _capture_bounded_json(value, maximum_bytes)
    except Exception:
        _fail(
            "GE_CYCLE_STORE_INVALID_ARGUMENT",
            operation,
            f"{label} is not bounded portable JSON",
        )
    if type(captured) is not dict:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{label} must be an object")
    return captured


def _exact_keys(
    value: JsonObject,
    keys: Sequence[str],
    operation: CycleStoreProviderOperation,
    label: str,
) -> None:
    actual = sorted(value)
    expected = sorted(keys)
    if actual != expected:
        _fail(
            "GE_CYCLE_STORE_INVALID_ARGUMENT",
            operation,
            f"{label} must be closed",
            cast(JsonObject, {"actual": actual, "expected": expected}),
        )


def _identifier(value: object, operation: CycleStoreProviderOperation, label: str) -> str:
    if type(value) is not str or _IDENTIFIER.fullmatch(value) is None or value in {".", ".."}:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{label} is invalid")
    return value


def _hash(value: object, operation: CycleStoreProviderOperation, label: str) -> str:
    if type(value) is not str or _HASH.fullmatch(value) is None:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{label} is invalid")
    return value


def _integer(
    value: object,
    minimum: int,
    maximum: int,
    operation: CycleStoreProviderOperation,
    label: str,
) -> int:
    if type(value) is not int or value < minimum or value > maximum:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{label} is outside bounds")
    return value


def _timestamp(value: object, operation: CycleStoreProviderOperation, label: str) -> str:
    if type(value) is not str or _RFC3339.fullmatch(value) is None:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{label} is invalid")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{label} is invalid")
    return value


def _authorization_context(
    value: object,
    operation: CycleStoreProviderOperation,
) -> CycleStoreAuthorizationContext:
    context = _capture_object(value, operation, "authorization context")
    _exact_keys(
        context,
        ("tenantId", "principalHash", "authorizationHash"),
        operation,
        "authorization context",
    )
    return cast(
        JsonObject,
        {
            "tenantId": _identifier(context["tenantId"], operation, "tenantId"),
            "principalHash": _hash(context["principalHash"], operation, "principalHash"),
            "authorizationHash": _hash(
                context["authorizationHash"], operation, "authorizationHash"
            ),
        },
    )


def _mutation_context(value: object, operation: CycleStoreProviderOperation) -> JsonObject:
    context = _capture_object(value, operation, "mutation context")
    _exact_keys(
        context,
        ("tenantId", "principalHash", "authorizationHash", "operationId"),
        operation,
        "mutation context",
    )
    return cast(
        JsonObject,
        {
            "tenantId": _identifier(context["tenantId"], operation, "tenantId"),
            "principalHash": _hash(context["principalHash"], operation, "principalHash"),
            "authorizationHash": _hash(
                context["authorizationHash"], operation, "authorizationHash"
            ),
            "operationId": _identifier(context["operationId"], operation, "operationId"),
        },
    )


def _empty_tail() -> CycleStoreTail:
    return cast(JsonObject, {"exists": False, "sequence": -1, "recordHash": None})


def _parse_tail(
    value: object,
    operation: CycleStoreProviderOperation,
    label: str,
) -> CycleStoreTail:
    tail = _capture_object(value, operation, label)
    _exact_keys(tail, ("exists", "sequence", "recordHash"), operation, label)
    exists = tail["exists"]
    if type(exists) is not bool:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{label}.exists is invalid")
    sequence = _integer(tail["sequence"], -1, MAX_SAFE_INTEGER, operation, f"{label}.sequence")
    record_hash = (
        None
        if tail["recordHash"] is None
        else _hash(tail["recordHash"], operation, f"{label}.recordHash")
    )
    if (not exists and (sequence != -1 or record_hash is not None)) or (
        exists and (sequence < 0 or record_hash is None)
    ):
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{label} is inconsistent")
    return cast(JsonObject, {"exists": exists, "sequence": sequence, "recordHash": record_hash})


def _tail(records: Sequence[CycleStoreRecord]) -> CycleStoreTail:
    if not records:
        return _empty_tail()
    last = records[-1]
    return cast(
        JsonObject,
        {"exists": True, "sequence": last["sequence"], "recordHash": last["recordHash"]},
    )


def create_cycle_store_record(
    *,
    record_id: str,
    sequence: int,
    previous_record_hash: str | None,
    value: object,
) -> CycleStoreRecord:
    operation: CycleStoreProviderOperation = "append"
    safe_id = _identifier(record_id, operation, "recordId")
    safe_sequence = _integer(sequence, 0, MAX_SAFE_INTEGER, operation, "sequence")
    previous = (
        None
        if previous_record_hash is None
        else _hash(previous_record_hash, operation, "previousRecordHash")
    )
    if (safe_sequence == 0) != (previous is None):
        _fail(
            "GE_CYCLE_STORE_INVALID_ARGUMENT",
            operation,
            "record sequence and previous hash are inconsistent",
        )
    try:
        captured, value_bytes = _capture_bounded_json(value, MAX_CYCLE_STORE_RECORD_BYTES)
    except Exception:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "record value exceeds its bound")
    body = cast(
        JsonObject,
        {
            "recordId": safe_id,
            "sequence": safe_sequence,
            "previousRecordHash": previous,
            "valueHash": canonical_sha256(captured),
            "valueBytes": value_bytes,
            "value": captured,
        },
    )
    return cast(JsonObject, {**body, "recordHash": _domain_hash(CYCLE_STORE_RECORD_DOMAIN, body)})


def _parse_record(value: object, operation: CycleStoreProviderOperation) -> CycleStoreRecord:
    record = _capture_object(value, operation, "record", MAX_CYCLE_STORE_RECORD_BYTES * 2)
    _exact_keys(
        record,
        (
            "recordId",
            "sequence",
            "previousRecordHash",
            "valueHash",
            "valueBytes",
            "value",
            "recordHash",
        ),
        operation,
        "record",
    )
    expected = create_cycle_store_record(
        record_id=cast(str, record["recordId"]),
        sequence=cast(int, record["sequence"]),
        previous_record_hash=cast(str | None, record["previousRecordHash"]),
        value=record["value"],
    )
    if canonical_json(record) != canonical_json(expected):
        _fail(
            "GE_CYCLE_STORE_INVALID_ARGUMENT",
            operation,
            "record hash or byte identity drifted",
        )
    return expected


def _descriptor_body(provider_id: str) -> CycleStoreProviderDescriptor:
    return cast(
        JsonObject,
        {
            "apiVersion": CYCLE_STORE_PROVIDER_API_VERSION,
            "kind": "CycleStoreProviderDescriptor",
            "contractVersion": CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
            "providerId": provider_id,
            "schemaVersion": 1,
            "compatibility": {
                "minReaderVersion": 1,
                "maxReaderVersion": 1,
                "minWriterVersion": 1,
                "maxWriterVersion": 1,
            },
            "limits": {
                "maxAppendRecords": MAX_CYCLE_STORE_APPEND_RECORDS,
                "maxRecordBytes": MAX_CYCLE_STORE_RECORD_BYTES,
                "maxAppendBytes": MAX_CYCLE_STORE_APPEND_BYTES,
                "maxPageSize": MAX_CYCLE_STORE_PAGE_SIZE,
                "maxCheckpointBytes": MAX_CYCLE_STORE_CHECKPOINT_BYTES,
                "maxLeaseTtlMs": MAX_CYCLE_STORE_LEASE_TTL_MS,
            },
            "guarantees": {
                "appendAtomicity": "all-or-nothing",
                "tailConsistency": "strong",
                "pagination": "snapshot-no-skip-no-duplicate",
                "checkpointAuthority": "cache-only",
                "idempotency": "operation-id-canonical-request",
                "leaseClock": "provider-authoritative",
                "tenantIsolation": "mandatory",
            },
            "capabilities": {
                "durability": "process-local",
                "distributedFencing": False,
                "snapshotPagination": True,
                "checkpointCrud": True,
                "legalHold": "reference-state-machine",
                "backupRestore": "declared",
                "compaction": "logical-history-preserving",
            },
            "protection": {
                "payloadProtection": "external",
                "encryptionAtRest": "none",
                "rawPayloadObservability": False,
            },
            "governance": {
                "retention": "descriptor-only",
                "archival": "descriptor-only",
                "legalHoldBlocksDeletion": True,
                "migrationLock": "exclusive-fenced",
                "backupIdentity": "content-addressed",
            },
            "observability": {
                "safeFields": [
                    "operation",
                    "resultCode",
                    "durationBucket",
                    "canonicalByteCount",
                    "recordCount",
                    "pageCount",
                    "retryClass",
                    "tenantHash",
                    "providerId",
                ],
                "payloadLabels": False,
                "authorizationLabels": False,
            },
        },
    )


def _section(
    value: object,
    keys: Sequence[str],
    label: str,
) -> JsonObject:
    operation: CycleStoreProviderOperation = "describe"
    if type(value) is not dict:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{label} must be an object")
    section = cast(JsonObject, value)
    _exact_keys(section, keys, operation, label)
    return section


def _descriptor_limit(value: object, ceiling: int, label: str) -> int:
    operation: CycleStoreProviderOperation = "describe"
    if type(value) is not int or value < 1:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{label} is outside bounds")
    if value > ceiling:
        _fail(
            "GE_CYCLE_STORE_QUOTA_EXCEEDED",
            operation,
            f"{label} exceeds the contract ceiling",
        )
    return value


def validate_cycle_store_provider_descriptor(value: object) -> CycleStoreProviderDescriptor:
    operation: CycleStoreProviderOperation = "describe"
    raw = _capture_object(value, operation, "provider descriptor", MAX_CYCLE_STORE_RECORD_BYTES)
    if raw.get("apiVersion") != CYCLE_STORE_PROVIDER_API_VERSION or raw.get(
        "contractVersion"
    ) != CYCLE_STORE_PROVIDER_CONTRACT_VERSION:
        _fail(
            "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
            operation,
            "provider descriptor version is unsupported",
        )
    _exact_keys(
        raw,
        (*_descriptor_body("memory-reference"), "descriptorHash"),
        operation,
        "provider descriptor",
    )
    if raw["kind"] != "CycleStoreProviderDescriptor":
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "provider descriptor kind is invalid")
    _identifier(raw["providerId"], operation, "providerId")
    schema_version = _integer(raw["schemaVersion"], 1, MAX_SAFE_INTEGER, operation, "schemaVersion")

    compatibility = _section(
        raw["compatibility"],
        ("minReaderVersion", "maxReaderVersion", "minWriterVersion", "maxWriterVersion"),
        "compatibility",
    )
    compatibility_values = tuple(
        _integer(compatibility[key], 1, MAX_SAFE_INTEGER, operation, key)
        for key in (
            "minReaderVersion",
            "maxReaderVersion",
            "minWriterVersion",
            "maxWriterVersion",
        )
    )
    if not (
        compatibility_values[0] <= schema_version <= compatibility_values[1]
        and compatibility_values[2] <= schema_version <= compatibility_values[3]
    ):
        _fail(
            "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
            operation,
            "provider schema version is outside its compatibility window",
        )

    limits = _section(
        raw["limits"],
        (
            "maxAppendRecords",
            "maxRecordBytes",
            "maxAppendBytes",
            "maxPageSize",
            "maxCheckpointBytes",
            "maxLeaseTtlMs",
        ),
        "limits",
    )
    for key, ceiling in (
        ("maxAppendRecords", MAX_CYCLE_STORE_APPEND_RECORDS),
        ("maxRecordBytes", MAX_CYCLE_STORE_RECORD_BYTES),
        ("maxAppendBytes", MAX_CYCLE_STORE_APPEND_BYTES),
        ("maxPageSize", MAX_CYCLE_STORE_PAGE_SIZE),
        ("maxCheckpointBytes", MAX_CYCLE_STORE_CHECKPOINT_BYTES),
        ("maxLeaseTtlMs", MAX_CYCLE_STORE_LEASE_TTL_MS),
    ):
        _descriptor_limit(limits[key], ceiling, key)

    reference = _descriptor_body(cast(str, raw["providerId"]))
    guarantees_document = cast(JsonObject, reference["guarantees"])
    guarantees = _section(raw["guarantees"], tuple(guarantees_document), "guarantees")
    if guarantees != reference["guarantees"]:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "provider guarantees are invalid")

    capabilities = _section(
        raw["capabilities"],
        (
            "durability",
            "distributedFencing",
            "snapshotPagination",
            "checkpointCrud",
            "legalHold",
            "backupRestore",
            "compaction",
        ),
        "capabilities",
    )
    allowed_capabilities: dict[str, tuple[object, ...]] = {
        "durability": ("process-local", "durable"),
        "distributedFencing": (False, True),
        "snapshotPagination": (True,),
        "checkpointCrud": (True,),
        "legalHold": ("reference-state-machine", "enforced"),
        "backupRestore": ("declared", "enforced"),
        "compaction": ("logical-history-preserving",),
    }
    for key, allowed in allowed_capabilities.items():
        if capabilities[key] not in allowed or (
            isinstance(capabilities[key], bool)
            and not any(type(item) is bool and capabilities[key] is item for item in allowed)
        ):
            _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, f"{key} is invalid")

    protection = _section(
        raw["protection"],
        ("payloadProtection", "encryptionAtRest", "rawPayloadObservability"),
        "protection",
    )
    if protection["payloadProtection"] not in ("external", "provider-managed") or protection[
        "encryptionAtRest"
    ] not in ("none", "provider-managed", "external") or protection[
        "rawPayloadObservability"
    ] is not False:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "protection declaration is invalid")

    governance = _section(
        raw["governance"],
        ("retention", "archival", "legalHoldBlocksDeletion", "migrationLock", "backupIdentity"),
        "governance",
    )
    if (
        governance["retention"] not in ("descriptor-only", "enforced")
        or governance["archival"] not in ("descriptor-only", "enforced")
        or governance["legalHoldBlocksDeletion"] is not True
        or governance["migrationLock"] != "exclusive-fenced"
        or governance["backupIdentity"] != "content-addressed"
    ):
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "governance declaration is invalid")

    observability = _section(
        raw["observability"],
        tuple(cast(JsonObject, reference["observability"])),
        "observability",
    )
    if observability != reference["observability"]:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "observability declaration is invalid")

    declared_hash = _hash(raw["descriptorHash"], operation, "descriptorHash")
    body = cast(JsonObject, {key: item for key, item in raw.items() if key != "descriptorHash"})
    if _domain_hash(CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN, body) != declared_hash:
        _fail("GE_CYCLE_STORE_CORRUPTION", operation, "provider descriptor hash drifted")
    return cast(JsonObject, _clone({**body, "descriptorHash": declared_hash}))


def create_reference_cycle_store_provider_descriptor(
    provider_id: str = "memory-reference",
) -> CycleStoreProviderDescriptor:
    safe_provider_id = _identifier(provider_id, "describe", "providerId")
    body = _descriptor_body(safe_provider_id)
    return validate_cycle_store_provider_descriptor(
        {**body, "descriptorHash": _domain_hash(CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN, body)}
    )


def create_cycle_store_checkpoint(
    *,
    checkpoint_scope: str,
    checkpoint_id: str,
    stream_id: str,
    bound_sequence: int,
    bound_record_hash: str,
    created_at: str,
    value: object,
) -> CycleStoreCheckpoint:
    operation: CycleStoreProviderOperation = "save-checkpoint"
    try:
        captured, value_bytes = _capture_bounded_json(value, MAX_CYCLE_STORE_CHECKPOINT_BYTES)
    except Exception:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "checkpoint value exceeds its bound")
    return cast(
        JsonObject,
        {
            "checkpointScope": _identifier(checkpoint_scope, operation, "checkpointScope"),
            "checkpointId": _identifier(checkpoint_id, operation, "checkpointId"),
            "streamId": _identifier(stream_id, operation, "streamId"),
            "boundSequence": _integer(
                bound_sequence, 0, MAX_SAFE_INTEGER, operation, "boundSequence"
            ),
            "boundRecordHash": _hash(bound_record_hash, operation, "boundRecordHash"),
            "createdAt": _timestamp(created_at, operation, "createdAt"),
            "valueHash": canonical_sha256(captured),
            "valueBytes": value_bytes,
            "value": captured,
        },
    )


def _parse_checkpoint(
    value: object,
    operation: CycleStoreProviderOperation,
) -> CycleStoreCheckpoint:
    checkpoint = _capture_object(
        value,
        operation,
        "checkpoint",
        MAX_CYCLE_STORE_CHECKPOINT_BYTES + MAX_CYCLE_STORE_RECORD_BYTES,
    )
    _exact_keys(
        checkpoint,
        (
            "checkpointScope",
            "checkpointId",
            "streamId",
            "boundSequence",
            "boundRecordHash",
            "createdAt",
            "valueHash",
            "valueBytes",
            "value",
        ),
        operation,
        "checkpoint",
    )
    expected = create_cycle_store_checkpoint(
        checkpoint_scope=cast(str, checkpoint["checkpointScope"]),
        checkpoint_id=cast(str, checkpoint["checkpointId"]),
        stream_id=cast(str, checkpoint["streamId"]),
        bound_sequence=cast(int, checkpoint["boundSequence"]),
        bound_record_hash=cast(str, checkpoint["boundRecordHash"]),
        created_at=cast(str, checkpoint["createdAt"]),
        value=checkpoint["value"],
    )
    if canonical_json(checkpoint) != canonical_json(expected):
        _fail(
            "GE_CYCLE_STORE_INVALID_ARGUMENT",
            operation,
            "checkpoint hash or byte identity drifted",
        )
    return expected


def _checkpoint_summary(checkpoint: CycleStoreCheckpoint) -> CycleStoreCheckpointSummary:
    return cast(JsonObject, {key: value for key, value in checkpoint.items() if key != "value"})


@dataclass(slots=True)
class _IdempotencyEntry:
    operation: CycleStoreProviderOperation
    request_hash: str
    result: JsonValue


@dataclass(slots=True)
class _LeaseState:
    active: CycleStoreLease | None = None
    last_lease_epoch: int = 0
    last_fencing_token: int = 0
    used_lease_ids: set[str] = field(default_factory=set)


@dataclass(slots=True)
class _EventCursor:
    context: CycleStoreAuthorizationContext
    stream_id: str
    page_size: int
    next_sequence: int
    snapshot_tail: CycleStoreTail
    expires_at_ms: int = 0


@dataclass(slots=True)
class _CheckpointCursor:
    context: CycleStoreAuthorizationContext
    checkpoint_scope: str
    page_size: int
    next_index: int
    snapshot: tuple[CycleStoreCheckpointSummary, ...]
    expires_at_ms: int = 0


_Cursor: TypeAlias = _EventCursor | _CheckpointCursor


@dataclass(slots=True)
class _MigrationState:
    active: CycleStoreMigrationLock | None = None
    last_epoch: int = 0
    last_fencing_token: int = 0
    used_lock_ids: set[str] = field(default_factory=set)


CycleStoreAuthorizationHook: TypeAlias = Callable[
    [CycleStoreAuthorizationContext, CycleStoreProviderOperation],
    bool | Awaitable[bool],
]
CycleStoreProviderFaultHook: TypeAlias = Callable[[str], Awaitable[None] | None]
CycleStoreClockHook: TypeAlias = Callable[[], datetime]


@runtime_checkable
class CycleStoreProvider(Protocol):
    async def describe(self) -> CycleStoreProviderDescriptor: ...

    async def inspect_schema(self, context: object) -> CycleStoreSchemaInspection: ...

    async def read_tail(self, request: object) -> CycleStoreTail: ...

    async def append(self, request: object) -> JsonObject: ...

    async def read_event_page(self, request: object) -> CycleStoreEventPage: ...

    async def save_checkpoint(self, request: object) -> CycleStoreCheckpointSummary: ...

    async def load_checkpoint(self, request: object) -> CycleStoreCheckpoint | None: ...

    async def list_checkpoints(self, request: object) -> CycleStoreCheckpointPage: ...

    async def delete_checkpoint(self, request: object) -> JsonObject: ...

    async def acquire_lease(self, request: object) -> CycleStoreLease: ...

    async def renew_lease(self, request: object) -> CycleStoreLease: ...

    async def release_lease(self, request: object) -> CycleStoreLeaseInspection: ...

    async def inspect_lease(self, request: object) -> CycleStoreLeaseInspection: ...

    async def set_legal_hold(self, request: object) -> CycleStoreGovernanceInspection: ...

    async def inspect_governance(self, request: object) -> CycleStoreGovernanceInspection: ...

    async def acquire_migration_lock(self, request: object) -> CycleStoreMigrationLock: ...

    async def inspect_migration_lock(self, context: object) -> CycleStoreMigrationLock | None: ...

    async def release_migration_lock(self, request: object) -> CycleStoreMigrationLock | None: ...


def _allow_all(
    _context: CycleStoreAuthorizationContext,
    _operation: CycleStoreProviderOperation,
) -> bool:
    return True


class MemoryCycleStoreProvider:
    """Deterministic process-local reference model for the v1alpha1 contract."""

    def __init__(
        self,
        *,
        provider_id: str = "memory-reference",
        initial_time: str = "2026-07-27T00:00:00Z",
        now: CycleStoreClockHook | None = None,
        authorize: CycleStoreAuthorizationHook | None = None,
        fault_hook: CycleStoreProviderFaultHook | None = None,
    ) -> None:
        self._descriptor = create_reference_cycle_store_provider_descriptor(provider_id)
        self._authorize_hook = authorize or _allow_all
        self._fault_hook = fault_hook
        self._external_now = now
        safe_initial = _timestamp(initial_time, "describe", "initialTime")
        self._manual_now_ms = int(
            datetime.fromisoformat(safe_initial.replace("Z", "+00:00")).timestamp() * 1_000
        )
        self._last_observed_now_ms = self._manual_now_ms
        self._lock = asyncio.Lock()
        self._records: dict[str, tuple[CycleStoreRecord, ...]] = {}
        self._record_ids: dict[str, str] = {}
        self._checkpoints: dict[str, CycleStoreCheckpoint] = {}
        self._leases: dict[str, _LeaseState] = {}
        self._idempotency: dict[str, _IdempotencyEntry] = {}
        self._cursors: dict[str, _Cursor] = {}
        self._cursor_counter = 0
        self._legal_holds: dict[str, set[str]] = {}
        self._migration = _MigrationState()
        self._injected_failures: dict[
            CycleStoreProviderOperation, CycleStoreProviderErrorCode
        ] = {}

    def _limit(self, key: str) -> int:
        limits = cast(JsonObject, self._descriptor["limits"])
        return cast(int, limits[key])

    def _now(self, operation: CycleStoreProviderOperation) -> int:
        if self._external_now is None:
            milliseconds = self._manual_now_ms
        else:
            try:
                value = self._external_now()
                if type(value) is not datetime or value.tzinfo is None:
                    _fail(
                        "GE_CYCLE_STORE_UNAVAILABLE",
                        operation,
                        "provider clock is invalid",
                    )
                milliseconds = int(value.timestamp() * 1_000)
            except CycleStoreProviderError:
                raise
            except Exception:
                _fail("GE_CYCLE_STORE_UNAVAILABLE", operation, "provider clock is invalid")
        if milliseconds < self._last_observed_now_ms:
            _fail(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "provider clock moved backwards",
            )
        self._last_observed_now_ms = milliseconds
        return milliseconds

    @staticmethod
    def _iso_time(milliseconds: int) -> str:
        return (
            datetime.fromtimestamp(milliseconds / 1_000, tz=UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )

    async def _authorize(
        self,
        context: CycleStoreAuthorizationContext,
        operation: CycleStoreProviderOperation,
    ) -> None:
        try:
            outcome = self._authorize_hook(context, operation)
            allowed = await outcome if inspect.isawaitable(outcome) else outcome
        except Exception:
            _fail(
                "GE_CYCLE_STORE_INTERNAL",
                operation,
                "provider authorization hook failed",
            )
        if type(allowed) is not bool:
            _fail("GE_CYCLE_STORE_INTERNAL", operation, "authorization hook returned invalid data")
        if not allowed:
            _fail(
                "GE_CYCLE_STORE_PERMISSION_DENIED",
                operation,
                "provider operation is not authorized",
            )

    def _maybe_fail(self, operation: CycleStoreProviderOperation) -> None:
        code = self._injected_failures.pop(operation, None)
        if code is not None:
            _fail(code, operation, "injected provider failure")

    async def _run_fault(
        self,
        boundary: str,
        operation: CycleStoreProviderOperation,
    ) -> None:
        if self._fault_hook is None:
            return
        try:
            outcome = self._fault_hook(boundary)
            if inspect.isawaitable(outcome):
                await outcome
        except CycleStoreProviderError:
            raise
        except Exception:
            raise CycleStoreProviderError(
                "GE_CYCLE_STORE_UNAVAILABLE",
                operation,
                "provider acknowledgement is unavailable",
                cast(JsonObject, {"boundary": boundary}),
            ) from None

    async def _mutate(
        self,
        operation: CycleStoreProviderOperation,
        context: CycleStoreMutationContext,
        canonical_request: JsonValue,
        action: Callable[[], JsonValue],
    ) -> JsonValue:
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            ledger_key = f"{context['tenantId']}\0{context['operationId']}"
            request_hash = _domain_hash(
                CYCLE_STORE_OPERATION_DOMAIN,
                {"operation": operation, "request": canonical_request},
            )
            existing = self._idempotency.get(ledger_key)
            if existing is not None:
                if existing.operation != operation or existing.request_hash != request_hash:
                    _fail(
                        "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT",
                        operation,
                        "operationId was reused with a different canonical request",
                    )
                return _clone(existing.result)
            await self._run_fault(f"provider:{operation}:before-commit", operation)
            result = _clone(action())
            self._idempotency[ledger_key] = _IdempotencyEntry(
                operation=operation,
                request_hash=request_hash,
                result=result,
            )
            await self._run_fault(
                f"provider:{operation}:after-commit-before-return",
                operation,
            )
            return _clone(result)

    @staticmethod
    def _stream_key(tenant_id: str, stream_id: str) -> str:
        return f"{tenant_id}\0{stream_id}"

    @staticmethod
    def _record_key(tenant_id: str, record_id: str) -> str:
        return f"{tenant_id}\0{record_id}"

    @staticmethod
    def _checkpoint_key(tenant_id: str, scope: str, checkpoint_id: str) -> str:
        return f"{tenant_id}\0{scope}\0{checkpoint_id}"

    def _lease_state(self, tenant_id: str, stream_id: str) -> _LeaseState:
        return self._leases.get(self._stream_key(tenant_id, stream_id), _LeaseState())

    def _assert_online_writer_compatible(
        self,
        operation: CycleStoreProviderOperation,
    ) -> None:
        active = self._migration.active
        if active is not None and self._parse_time(cast(str, active["expiresAt"])) > self._now(
            operation
        ):
            _fail(
                "GE_CYCLE_STORE_MIGRATION_LOCKED",
                operation,
                "online mutation is blocked by an active incompatible migration",
                cast(JsonObject, {"migrationFencingToken": active["fencingToken"]}),
            )

    def _assert_write_lease(
        self,
        tenant_id: str,
        stream_id: str,
        binding: CycleStoreLeaseBinding | None,
        operation: CycleStoreProviderOperation,
    ) -> None:
        state = self._lease_state(tenant_id, stream_id)
        if state.last_fencing_token == 0:
            if binding is not None:
                _fail("GE_CYCLE_STORE_STALE_FENCE", operation, "stream has no fenced owner")
            return
        active = state.active
        if (
            active is None
            or self._parse_time(cast(str, active["expiresAt"])) <= self._now(operation)
            or binding is None
            or binding["leaseId"] != active["leaseId"]
            or binding["holderId"] != active["holderId"]
            or binding["fencingToken"] != active["fencingToken"]
        ):
            _fail(
                "GE_CYCLE_STORE_STALE_FENCE",
                operation,
                "write lease is stale or inactive",
                cast(JsonObject, {"lastFencingToken": state.last_fencing_token}),
            )

    @staticmethod
    def _parse_time(value: str) -> int:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1_000)

    def _new_cursor(
        self,
        state: _Cursor,
        operation: CycleStoreProviderOperation,
    ) -> str:
        if len(self._cursors) >= MAX_CYCLE_STORE_CURSOR_COUNT:
            _fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "cursor quota exceeded")
        self._cursor_counter += 1
        token = f"cursor-{self._cursor_counter:08d}"
        state.expires_at_ms = self._now(operation) + CYCLE_STORE_CURSOR_TTL_MS
        self._cursors[token] = state
        return token

    @staticmethod
    def _cursor_token(value: object, operation: CycleStoreProviderOperation) -> str:
        if type(value) is not str or _IDENTIFIER.fullmatch(value) is None:
            _fail("GE_CYCLE_STORE_INVALID_CURSOR", operation, "cursor token is malformed")
        return value

    @staticmethod
    def _lease_binding(
        value: object,
        operation: CycleStoreProviderOperation,
    ) -> CycleStoreLeaseBinding:
        binding = _capture_object(value, operation, "lease binding")
        _exact_keys(binding, ("leaseId", "holderId", "fencingToken"), operation, "lease binding")
        return cast(
            JsonObject,
            {
                "leaseId": _identifier(binding["leaseId"], operation, "leaseId"),
                "holderId": _identifier(binding["holderId"], operation, "holderId"),
                "fencingToken": _integer(
                    binding["fencingToken"], 1, MAX_SAFE_INTEGER, operation, "fencingToken"
                ),
            },
        )

    async def describe(self) -> CycleStoreProviderDescriptor:
        return cast(JsonObject, _clone(self._descriptor))

    async def inspect_schema(self, context_value: object) -> CycleStoreSchemaInspection:
        operation: CycleStoreProviderOperation = "inspect-schema"
        context = _authorization_context(context_value, operation)
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            compatibility = cast(JsonObject, self._descriptor["compatibility"])
            return cast(
                JsonObject,
                _clone(
                    {
                        "descriptorHash": self._descriptor["descriptorHash"],
                        "schemaVersion": self._descriptor["schemaVersion"],
                        "minReaderVersion": compatibility["minReaderVersion"],
                        "maxReaderVersion": compatibility["maxReaderVersion"],
                        "minWriterVersion": compatibility["minWriterVersion"],
                        "maxWriterVersion": compatibility["maxWriterVersion"],
                        "migrationLock": self._migration.active,
                    }
                ),
            )

    async def read_tail(self, request_value: object) -> CycleStoreTail:
        operation: CycleStoreProviderOperation = "read-tail"
        request = _capture_object(request_value, operation, "tail request")
        _exact_keys(request, ("context", "streamId"), operation, "tail request")
        context = _authorization_context(request["context"], operation)
        stream_id = _identifier(request["streamId"], operation, "streamId")
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            records = self._records.get(
                self._stream_key(cast(str, context["tenantId"]), stream_id), ()
            )
            return cast(JsonObject, _clone(_tail(records)))

    async def append(self, request_value: object) -> JsonObject:
        operation: CycleStoreProviderOperation = "append"
        request = _capture_object(request_value, operation, "append request")
        _exact_keys(
            request,
            ("context", "streamId", "expectedTail", "lease", "records"),
            operation,
            "append request",
        )
        context = _mutation_context(request["context"], operation)
        tenant_id = cast(str, context["tenantId"])
        stream_id = _identifier(request["streamId"], operation, "streamId")
        expected_tail = _parse_tail(request["expectedTail"], operation, "expectedTail")
        lease = (
            None if request["lease"] is None else self._lease_binding(request["lease"], operation)
        )
        raw_records = request["records"]
        if type(raw_records) is not list or not raw_records:
            _fail(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "append records must be nonempty",
            )
        if len(raw_records) > self._limit("maxAppendRecords"):
            _fail(
                "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                operation,
                "append record count exceeds provider limit",
            )
        records = tuple(_parse_record(item, operation) for item in raw_records)
        batch_bytes = 0
        for record in records:
            record_bytes = len(canonical_bytes(record))
            if record_bytes > self._limit("maxRecordBytes"):
                _fail(
                    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                    operation,
                    "record exceeds provider byte limit",
                )
            batch_bytes += record_bytes
            if batch_bytes > self._limit("maxAppendBytes"):
                _fail(
                    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                    operation,
                    "append exceeds provider byte limit",
                )
        canonical_request = cast(
            JsonObject,
            _clone(
                {
                    "context": context,
                    "streamId": stream_id,
                    "expectedTail": expected_tail,
                    "lease": lease,
                    "records": list(records),
                }
            ),
        )

        def commit() -> JsonValue:
            self._assert_online_writer_compatible(operation)
            stream_key = self._stream_key(tenant_id, stream_id)
            current = self._records.get(stream_key, ())
            actual_tail = _tail(current)
            if actual_tail != expected_tail:
                _fail(
                    "GE_CYCLE_STORE_CONFLICT",
                    operation,
                    "append lost expected-tail CAS",
                    cast(
                        JsonObject,
                        {
                            "expectedSequence": expected_tail["sequence"],
                            "actualSequence": actual_tail["sequence"],
                        },
                    ),
                )
            self._assert_write_lease(tenant_id, stream_id, lease, operation)
            previous_hash = actual_tail["recordHash"]
            next_sequence = cast(int, actual_tail["sequence"]) + 1
            batch_ids: set[str] = set()
            for record in records:
                record_id = cast(str, record["recordId"])
                if record["sequence"] != next_sequence or record[
                    "previousRecordHash"
                ] != previous_hash:
                    _fail(
                        "GE_CYCLE_STORE_CONFLICT",
                        operation,
                        "append record chain is not contiguous",
                    )
                if (
                    record_id in batch_ids
                    or self._record_key(tenant_id, record_id) in self._record_ids
                ):
                    _fail(
                        "GE_CYCLE_STORE_CONFLICT",
                        operation,
                        "recordId is already committed",
                        cast(JsonObject, {"recordId": record_id}),
                    )
                batch_ids.add(record_id)
                previous_hash = record["recordHash"]
                next_sequence += 1
            stored_records = tuple(cast(JsonObject, _clone(record)) for record in records)
            self._records[stream_key] = (*current, *stored_records)
            for record in records:
                self._record_ids[self._record_key(tenant_id, cast(str, record["recordId"]))] = (
                    stream_id
                )
            return cast(
                JsonObject,
                {"tail": _tail(self._records[stream_key]), "appendedRecords": len(records)},
            )

        return cast(JsonObject, await self._mutate(operation, context, canonical_request, commit))

    async def read_event_page(self, request_value: object) -> CycleStoreEventPage:
        operation: CycleStoreProviderOperation = "read-event-page"
        request = _capture_object(request_value, operation, "event page request")
        _exact_keys(
            request,
            ("context", "streamId", "fromSequence", "pageSize", "cursor"),
            operation,
            "event page request",
        )
        context = _authorization_context(request["context"], operation)
        tenant_id = cast(str, context["tenantId"])
        stream_id = _identifier(request["streamId"], operation, "streamId")
        page_size = _integer(
            request["pageSize"], 1, self._limit("maxPageSize"), operation, "pageSize"
        )
        cursor = (
            None
            if request["cursor"] is None
            else self._cursor_token(request["cursor"], operation)
        )
        from_sequence = (
            None
            if request["fromSequence"] is None
            else _integer(
                request["fromSequence"], 0, MAX_SAFE_INTEGER, operation, "fromSequence"
            )
        )
        if (cursor is None) == (from_sequence is None):
            _fail(
                "GE_CYCLE_STORE_INVALID_CURSOR",
                operation,
                "exactly one of cursor and fromSequence is required",
            )
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            stream_records = self._records.get(self._stream_key(tenant_id, stream_id), ())
            if cursor is None:
                state = _EventCursor(
                    context=cast(JsonObject, _clone(context)),
                    stream_id=stream_id,
                    page_size=page_size,
                    next_sequence=cast(int, from_sequence),
                    snapshot_tail=_tail(stream_records),
                )
            else:
                stored = self._cursors.get(cursor)
                if (
                    not isinstance(stored, _EventCursor)
                    or stored.stream_id != stream_id
                    or stored.page_size != page_size
                    or stored.context != context
                ):
                    _fail(
                        "GE_CYCLE_STORE_INVALID_CURSOR",
                        operation,
                        "event cursor is invalid or expired",
                    )
                if stored.expires_at_ms <= self._now(operation):
                    del self._cursors[cursor]
                    _fail(
                        "GE_CYCLE_STORE_INVALID_CURSOR",
                        operation,
                        "event cursor is invalid or expired",
                    )
                state = stored
                del self._cursors[cursor]
            final_exclusive = (
                cast(int, state.snapshot_tail["sequence"]) + 1
                if state.snapshot_tail["exists"]
                else 0
            )
            page_end = min(state.next_sequence + page_size, final_exclusive)
            page_records = [
                cast(JsonObject, _clone(record))
                for record in stream_records[state.next_sequence : page_end]
            ]
            next_cursor = (
                self._new_cursor(
                    _EventCursor(
                        context=cast(JsonObject, _clone(context)),
                        stream_id=stream_id,
                        page_size=page_size,
                        next_sequence=page_end,
                        snapshot_tail=cast(JsonObject, _clone(state.snapshot_tail)),
                    ),
                    operation,
                )
                if page_end < final_exclusive
                else None
            )
            return cast(
                JsonObject,
                _clone(
                    {
                        "exists": state.snapshot_tail["exists"],
                        "snapshotTail": state.snapshot_tail,
                        "records": page_records,
                        "nextCursor": next_cursor,
                    }
                ),
            )

    async def save_checkpoint(self, request_value: object) -> CycleStoreCheckpointSummary:
        operation: CycleStoreProviderOperation = "save-checkpoint"
        request = _capture_object(
            request_value,
            operation,
            "save checkpoint request",
            MAX_CYCLE_STORE_CHECKPOINT_BYTES + MAX_CYCLE_STORE_RECORD_BYTES,
        )
        _exact_keys(
            request,
            ("context", "checkpoint", "lease"),
            operation,
            "save checkpoint request",
        )
        context = _mutation_context(request["context"], operation)
        tenant_id = cast(str, context["tenantId"])
        checkpoint = _parse_checkpoint(request["checkpoint"], operation)
        lease = (
            None if request["lease"] is None else self._lease_binding(request["lease"], operation)
        )
        canonical_request = cast(
            JsonObject,
            _clone({"context": context, "checkpoint": checkpoint, "lease": lease}),
        )

        def commit() -> JsonValue:
            self._assert_online_writer_compatible(operation)
            stream_id = cast(str, checkpoint["streamId"])
            records = self._records.get(self._stream_key(tenant_id, stream_id), ())
            tail = _tail(records)
            if (
                not tail["exists"]
                or tail["sequence"] != checkpoint["boundSequence"]
                or tail["recordHash"] != checkpoint["boundRecordHash"]
            ):
                _fail(
                    "GE_CYCLE_STORE_CONFLICT",
                    operation,
                    "checkpoint is not bound to the current event tail",
                    cast(
                        JsonObject,
                        {
                            "actualSequence": tail["sequence"],
                            "expectedSequence": checkpoint["boundSequence"],
                        },
                    ),
                )
            self._assert_write_lease(tenant_id, stream_id, lease, operation)
            key = self._checkpoint_key(
                tenant_id,
                cast(str, checkpoint["checkpointScope"]),
                cast(str, checkpoint["checkpointId"]),
            )
            existing = self._checkpoints.get(key)
            if existing is not None:
                if existing != checkpoint:
                    _fail(
                        "GE_CYCLE_STORE_CONFLICT",
                        operation,
                        "checkpointId is immutable until deleted",
                    )
                return _checkpoint_summary(existing)
            self._checkpoints[key] = cast(JsonObject, _clone(checkpoint))
            return _checkpoint_summary(checkpoint)

        return cast(JsonObject, await self._mutate(operation, context, canonical_request, commit))

    async def load_checkpoint(self, request_value: object) -> CycleStoreCheckpoint | None:
        operation: CycleStoreProviderOperation = "load-checkpoint"
        request = _capture_object(request_value, operation, "load checkpoint request")
        _exact_keys(
            request,
            ("context", "checkpointScope", "checkpointId"),
            operation,
            "load checkpoint request",
        )
        context = _authorization_context(request["context"], operation)
        scope = _identifier(request["checkpointScope"], operation, "checkpointScope")
        checkpoint_id = _identifier(request["checkpointId"], operation, "checkpointId")
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            checkpoint = self._checkpoints.get(
                self._checkpoint_key(cast(str, context["tenantId"]), scope, checkpoint_id)
            )
            if checkpoint is None:
                return None
            try:
                return cast(JsonObject, _clone(_parse_checkpoint(checkpoint, operation)))
            except Exception:
                _fail(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "checkpoint bytes are corrupt",
                    cast(JsonObject, {"checkpointId": checkpoint_id}),
                )

    async def list_checkpoints(self, request_value: object) -> CycleStoreCheckpointPage:
        operation: CycleStoreProviderOperation = "list-checkpoints"
        request = _capture_object(request_value, operation, "list checkpoint request")
        _exact_keys(
            request,
            ("context", "checkpointScope", "pageSize", "cursor"),
            operation,
            "list checkpoint request",
        )
        context = _authorization_context(request["context"], operation)
        tenant_id = cast(str, context["tenantId"])
        checkpoint_scope = _identifier(
            request["checkpointScope"], operation, "checkpointScope"
        )
        page_size = _integer(
            request["pageSize"], 1, self._limit("maxPageSize"), operation, "pageSize"
        )
        cursor = (
            None
            if request["cursor"] is None
            else self._cursor_token(request["cursor"], operation)
        )
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            if cursor is None:
                prefix = f"{tenant_id}\0{checkpoint_scope}\0"
                summaries = [
                    _checkpoint_summary(checkpoint)
                    for key, checkpoint in self._checkpoints.items()
                    if key.startswith(prefix)
                ]
                summaries.sort(key=lambda item: cast(str, item["checkpointId"]))
                summaries.sort(key=lambda item: cast(str, item["createdAt"]), reverse=True)
                summaries.sort(key=lambda item: cast(int, item["boundSequence"]), reverse=True)
                state = _CheckpointCursor(
                    context=cast(JsonObject, _clone(context)),
                    checkpoint_scope=checkpoint_scope,
                    page_size=page_size,
                    next_index=0,
                    snapshot=tuple(cast(JsonObject, _clone(item)) for item in summaries),
                )
            else:
                stored = self._cursors.get(cursor)
                if (
                    not isinstance(stored, _CheckpointCursor)
                    or stored.checkpoint_scope != checkpoint_scope
                    or stored.page_size != page_size
                    or stored.context != context
                ):
                    _fail(
                        "GE_CYCLE_STORE_INVALID_CURSOR",
                        operation,
                        "checkpoint cursor is invalid or expired",
                    )
                if stored.expires_at_ms <= self._now(operation):
                    del self._cursors[cursor]
                    _fail(
                        "GE_CYCLE_STORE_INVALID_CURSOR",
                        operation,
                        "checkpoint cursor is invalid or expired",
                    )
                state = stored
                del self._cursors[cursor]
            end = min(state.next_index + page_size, len(state.snapshot))
            checkpoints = [
                cast(JsonObject, _clone(item)) for item in state.snapshot[state.next_index : end]
            ]
            next_cursor = (
                self._new_cursor(
                    _CheckpointCursor(
                        context=cast(JsonObject, _clone(context)),
                        checkpoint_scope=checkpoint_scope,
                        page_size=page_size,
                        next_index=end,
                        snapshot=state.snapshot,
                    ),
                    operation,
                )
                if end < len(state.snapshot)
                else None
            )
            return cast(
                JsonObject,
                _clone({"checkpoints": checkpoints, "nextCursor": next_cursor}),
            )

    async def delete_checkpoint(self, request_value: object) -> JsonObject:
        operation: CycleStoreProviderOperation = "delete-checkpoint"
        request = _capture_object(request_value, operation, "delete checkpoint request")
        _exact_keys(
            request,
            ("context", "checkpointScope", "checkpointId", "expectedValueHash"),
            operation,
            "delete checkpoint request",
        )
        context = _mutation_context(request["context"], operation)
        tenant_id = cast(str, context["tenantId"])
        checkpoint_scope = _identifier(
            request["checkpointScope"], operation, "checkpointScope"
        )
        checkpoint_id = _identifier(request["checkpointId"], operation, "checkpointId")
        expected_hash = (
            None
            if request["expectedValueHash"] is None
            else _hash(request["expectedValueHash"], operation, "expectedValueHash")
        )
        canonical_request = cast(
            JsonObject,
            _clone(
                {
                    "context": context,
                    "checkpointScope": checkpoint_scope,
                    "checkpointId": checkpoint_id,
                    "expectedValueHash": expected_hash,
                }
            ),
        )

        def commit() -> JsonValue:
            self._assert_online_writer_compatible(operation)
            key = self._checkpoint_key(tenant_id, checkpoint_scope, checkpoint_id)
            existing = self._checkpoints.get(key)
            if existing is None:
                return cast(JsonObject, {"deleted": False})
            if expected_hash is None or existing["valueHash"] != expected_hash:
                _fail(
                    "GE_CYCLE_STORE_CONFLICT",
                    operation,
                    "checkpoint content hash differs from expected value",
                )
            del self._checkpoints[key]
            return cast(JsonObject, {"deleted": True})

        return cast(JsonObject, await self._mutate(operation, context, canonical_request, commit))

    def _lease_inspection(
        self,
        tenant_id: str,
        stream_id: str,
        operation: CycleStoreProviderOperation,
    ) -> CycleStoreLeaseInspection:
        state = self._lease_state(tenant_id, stream_id)
        if state.active is None:
            status = "none" if state.last_fencing_token == 0 else "released"
        else:
            status = (
                "expired"
                if self._parse_time(cast(str, state.active["expiresAt"])) <= self._now(operation)
                else "active"
            )
        return cast(
            JsonObject,
            {
                "status": status,
                "lease": None if state.active is None else _clone(state.active),
                "lastLeaseEpoch": state.last_lease_epoch,
                "lastFencingToken": state.last_fencing_token,
            },
        )

    async def acquire_lease(self, request_value: object) -> CycleStoreLease:
        operation: CycleStoreProviderOperation = "acquire-lease"
        request = _capture_object(request_value, operation, "acquire lease request")
        _exact_keys(
            request,
            (
                "context",
                "streamId",
                "leaseId",
                "holderId",
                "ttlMs",
                "mode",
                "expectedFencingToken",
            ),
            operation,
            "acquire lease request",
        )
        context = _mutation_context(request["context"], operation)
        tenant_id = cast(str, context["tenantId"])
        stream_id = _identifier(request["streamId"], operation, "streamId")
        lease_id = _identifier(request["leaseId"], operation, "leaseId")
        holder_id = _identifier(request["holderId"], operation, "holderId")
        ttl_ms = _integer(
            request["ttlMs"], 1, self._limit("maxLeaseTtlMs"), operation, "ttlMs"
        )
        mode_value = request["mode"]
        if mode_value not in ("acquire", "takeover"):
            _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "lease mode is invalid")
        mode = cast(Literal["acquire", "takeover"], mode_value)
        expected_fencing_token = _integer(
            request["expectedFencingToken"],
            0,
            MAX_SAFE_INTEGER,
            operation,
            "expectedFencingToken",
        )
        canonical_request = cast(
            JsonObject,
            _clone(
                {
                    "context": context,
                    "streamId": stream_id,
                    "leaseId": lease_id,
                    "holderId": holder_id,
                    "ttlMs": ttl_ms,
                    "mode": mode,
                    "expectedFencingToken": expected_fencing_token,
                }
            ),
        )

        def commit() -> JsonValue:
            self._assert_online_writer_compatible(operation)
            stream_key = self._stream_key(tenant_id, stream_id)
            if not self._records.get(stream_key, ()):
                _fail("GE_CYCLE_STORE_NOT_FOUND", operation, "lease stream does not exist")
            state = self._lease_state(tenant_id, stream_id)
            if expected_fencing_token != state.last_fencing_token:
                _fail(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "expected lease fence is stale",
                    cast(JsonObject, {"lastFencingToken": state.last_fencing_token}),
                )
            now_ms = self._now(operation)
            active_expired = state.active is not None and self._parse_time(
                cast(str, state.active["expiresAt"])
            ) <= now_ms
            if mode == "takeover":
                if state.active is None or not active_expired:
                    _fail(
                        "GE_CYCLE_STORE_LEASE_CONFLICT",
                        operation,
                        "lease takeover requires an expired active lease",
                    )
            elif state.active is not None:
                _fail(
                    "GE_CYCLE_STORE_LEASE_CONFLICT",
                    operation,
                    (
                        "expired lease requires takeover mode"
                        if active_expired
                        else "stream already has an active lease"
                    ),
                )
            if lease_id in state.used_lease_ids:
                _fail(
                    "GE_CYCLE_STORE_LEASE_CONFLICT",
                    operation,
                    "leaseId cannot be reused",
                )
            if (
                state.last_lease_epoch == MAX_SAFE_INTEGER
                or state.last_fencing_token == MAX_SAFE_INTEGER
            ):
                _fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "lease fence exhausted")
            lease = cast(
                JsonObject,
                {
                    "leaseId": lease_id,
                    "holderId": holder_id,
                    "leaseEpoch": state.last_lease_epoch + 1,
                    "fencingToken": state.last_fencing_token + 1,
                    "acquiredAt": self._iso_time(now_ms),
                    "expiresAt": self._iso_time(now_ms + ttl_ms),
                },
            )
            self._leases[stream_key] = _LeaseState(
                active=cast(JsonObject, _clone(lease)),
                last_lease_epoch=cast(int, lease["leaseEpoch"]),
                last_fencing_token=cast(int, lease["fencingToken"]),
                used_lease_ids={*state.used_lease_ids, lease_id},
            )
            return lease

        return cast(JsonObject, await self._mutate(operation, context, canonical_request, commit))

    async def renew_lease(self, request_value: object) -> CycleStoreLease:
        operation: CycleStoreProviderOperation = "renew-lease"
        request = _capture_object(request_value, operation, "renew lease request")
        _exact_keys(
            request,
            ("context", "streamId", "lease", "ttlMs"),
            operation,
            "renew lease request",
        )
        context = _mutation_context(request["context"], operation)
        tenant_id = cast(str, context["tenantId"])
        stream_id = _identifier(request["streamId"], operation, "streamId")
        binding = self._lease_binding(request["lease"], operation)
        ttl_ms = _integer(
            request["ttlMs"], 1, self._limit("maxLeaseTtlMs"), operation, "ttlMs"
        )
        canonical_request = cast(
            JsonObject,
            _clone(
                {
                    "context": context,
                    "streamId": stream_id,
                    "lease": binding,
                    "ttlMs": ttl_ms,
                }
            ),
        )

        def commit() -> JsonValue:
            self._assert_online_writer_compatible(operation)
            state = self._lease_state(tenant_id, stream_id)
            active = state.active
            now_ms = self._now(operation)
            if (
                active is None
                or self._parse_time(cast(str, active["expiresAt"])) <= now_ms
                or active["leaseId"] != binding["leaseId"]
                or active["holderId"] != binding["holderId"]
                or active["fencingToken"] != binding["fencingToken"]
            ):
                _fail(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "lease renewal identity is stale",
                    cast(JsonObject, {"lastFencingToken": state.last_fencing_token}),
                )
            new_expiry = now_ms + ttl_ms
            if new_expiry <= self._parse_time(cast(str, active["expiresAt"])):
                _fail(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "lease renewal must strictly extend expiry",
                )
            renewed = cast(JsonObject, {**active, "expiresAt": self._iso_time(new_expiry)})
            self._leases[self._stream_key(tenant_id, stream_id)] = _LeaseState(
                active=cast(JsonObject, _clone(renewed)),
                last_lease_epoch=state.last_lease_epoch,
                last_fencing_token=state.last_fencing_token,
                used_lease_ids=set(state.used_lease_ids),
            )
            return renewed

        return cast(JsonObject, await self._mutate(operation, context, canonical_request, commit))

    async def release_lease(self, request_value: object) -> CycleStoreLeaseInspection:
        operation: CycleStoreProviderOperation = "release-lease"
        request = _capture_object(request_value, operation, "release lease request")
        _exact_keys(
            request,
            ("context", "streamId", "lease"),
            operation,
            "release lease request",
        )
        context = _mutation_context(request["context"], operation)
        tenant_id = cast(str, context["tenantId"])
        stream_id = _identifier(request["streamId"], operation, "streamId")
        binding = self._lease_binding(request["lease"], operation)
        canonical_request = cast(
            JsonObject,
            _clone({"context": context, "streamId": stream_id, "lease": binding}),
        )

        def commit() -> JsonValue:
            self._assert_online_writer_compatible(operation)
            state = self._lease_state(tenant_id, stream_id)
            active = state.active
            if (
                active is None
                or active["leaseId"] != binding["leaseId"]
                or active["holderId"] != binding["holderId"]
                or active["fencingToken"] != binding["fencingToken"]
                or self._parse_time(cast(str, active["expiresAt"])) <= self._now(operation)
            ):
                _fail(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "lease release identity is stale",
                    cast(JsonObject, {"lastFencingToken": state.last_fencing_token}),
                )
            self._leases[self._stream_key(tenant_id, stream_id)] = _LeaseState(
                active=None,
                last_lease_epoch=state.last_lease_epoch,
                last_fencing_token=state.last_fencing_token,
                used_lease_ids=set(state.used_lease_ids),
            )
            return cast(
                JsonObject,
                {
                    "status": "released",
                    "lease": None,
                    "lastLeaseEpoch": state.last_lease_epoch,
                    "lastFencingToken": state.last_fencing_token,
                },
            )

        return cast(JsonObject, await self._mutate(operation, context, canonical_request, commit))

    async def inspect_lease(self, request_value: object) -> CycleStoreLeaseInspection:
        operation: CycleStoreProviderOperation = "inspect-lease"
        request = _capture_object(request_value, operation, "inspect lease request")
        _exact_keys(request, ("context", "streamId"), operation, "inspect lease request")
        context = _authorization_context(request["context"], operation)
        stream_id = _identifier(request["streamId"], operation, "streamId")
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            return cast(
                JsonObject,
                _clone(
                    self._lease_inspection(
                        cast(str, context["tenantId"]), stream_id, operation
                    )
                ),
            )

    def _governance_inspection(
        self,
        tenant_id: str,
        stream_id: str,
    ) -> CycleStoreGovernanceInspection:
        holds = sorted(self._legal_holds.get(self._stream_key(tenant_id, stream_id), set()))
        return cast(
            JsonObject,
            {
                "legalHoldIds": holds,
                "retentionMode": "retain-authoritative-history",
                "archiveMode": "lossless-before-delete",
                "compactionMode": "logical-history-preserving",
            },
        )

    async def set_legal_hold(self, request_value: object) -> CycleStoreGovernanceInspection:
        operation: CycleStoreProviderOperation = "set-legal-hold"
        request = _capture_object(request_value, operation, "legal hold request")
        _exact_keys(
            request,
            ("context", "streamId", "holdId", "action"),
            operation,
            "legal hold request",
        )
        context = _mutation_context(request["context"], operation)
        tenant_id = cast(str, context["tenantId"])
        stream_id = _identifier(request["streamId"], operation, "streamId")
        hold_id = _identifier(request["holdId"], operation, "holdId")
        action_value = request["action"]
        if action_value not in ("place", "release"):
            _fail(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "legal hold action is invalid",
            )
        action = cast(Literal["place", "release"], action_value)
        canonical_request = cast(
            JsonObject,
            _clone(
                {
                    "context": context,
                    "streamId": stream_id,
                    "holdId": hold_id,
                    "action": action,
                }
            ),
        )

        def commit() -> JsonValue:
            self._assert_online_writer_compatible(operation)
            key = self._stream_key(tenant_id, stream_id)
            if key not in self._records:
                _fail(
                    "GE_CYCLE_STORE_NOT_FOUND",
                    operation,
                    "legal hold stream does not exist",
                )
            holds = set(self._legal_holds.get(key, set()))
            if action == "place":
                holds.add(hold_id)
            else:
                holds.discard(hold_id)
            self._legal_holds[key] = holds
            return self._governance_inspection(tenant_id, stream_id)

        return cast(JsonObject, await self._mutate(operation, context, canonical_request, commit))

    async def inspect_governance(
        self,
        request_value: object,
    ) -> CycleStoreGovernanceInspection:
        operation: CycleStoreProviderOperation = "inspect-governance"
        request = _capture_object(request_value, operation, "governance request")
        _exact_keys(request, ("context", "streamId"), operation, "governance request")
        context = _authorization_context(request["context"], operation)
        tenant_id = cast(str, context["tenantId"])
        stream_id = _identifier(request["streamId"], operation, "streamId")
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            if self._stream_key(tenant_id, stream_id) not in self._records:
                _fail(
                    "GE_CYCLE_STORE_NOT_FOUND",
                    operation,
                    "governance stream does not exist",
                )
            return cast(
                JsonObject,
                _clone(self._governance_inspection(tenant_id, stream_id)),
            )

    async def acquire_migration_lock(self, request_value: object) -> CycleStoreMigrationLock:
        operation: CycleStoreProviderOperation = "acquire-migration-lock"
        request = _capture_object(request_value, operation, "migration lock request")
        _exact_keys(
            request,
            (
                "context",
                "lockId",
                "ownerId",
                "sourceSchemaVersion",
                "targetSchemaVersion",
                "ttlMs",
                "mode",
                "expectedFencingToken",
            ),
            operation,
            "migration lock request",
        )
        context = _mutation_context(request["context"], operation)
        lock_id = _identifier(request["lockId"], operation, "lockId")
        owner_id = _identifier(request["ownerId"], operation, "ownerId")
        source_version = _integer(
            request["sourceSchemaVersion"],
            1,
            MAX_SAFE_INTEGER,
            operation,
            "sourceSchemaVersion",
        )
        target_version = _integer(
            request["targetSchemaVersion"],
            1,
            MAX_SAFE_INTEGER,
            operation,
            "targetSchemaVersion",
        )
        schema_version = cast(int, self._descriptor["schemaVersion"])
        if source_version != schema_version or target_version <= source_version:
            _fail(
                "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
                operation,
                "migration schema interval is unsupported",
            )
        ttl_ms = _integer(
            request["ttlMs"], 1, self._limit("maxLeaseTtlMs"), operation, "ttlMs"
        )
        mode_value = request["mode"]
        if mode_value not in ("acquire", "takeover"):
            _fail(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "migration lock mode is invalid",
            )
        mode = cast(Literal["acquire", "takeover"], mode_value)
        expected_fencing_token = _integer(
            request["expectedFencingToken"],
            0,
            MAX_SAFE_INTEGER,
            operation,
            "expectedFencingToken",
        )
        canonical_request = cast(
            JsonObject,
            _clone(
                {
                    "context": context,
                    "lockId": lock_id,
                    "ownerId": owner_id,
                    "sourceSchemaVersion": source_version,
                    "targetSchemaVersion": target_version,
                    "ttlMs": ttl_ms,
                    "mode": mode,
                    "expectedFencingToken": expected_fencing_token,
                }
            ),
        )

        def commit() -> JsonValue:
            state = self._migration
            if expected_fencing_token != state.last_fencing_token:
                _fail(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "migration fence is stale",
                    cast(JsonObject, {"lastFencingToken": state.last_fencing_token}),
                )
            now_ms = self._now(operation)
            active_expired = state.active is not None and self._parse_time(
                cast(str, state.active["expiresAt"])
            ) <= now_ms
            if mode == "takeover":
                if state.active is None or not active_expired:
                    _fail(
                        "GE_CYCLE_STORE_MIGRATION_LOCKED",
                        operation,
                        "migration takeover requires an expired lock",
                    )
            elif state.active is not None:
                _fail(
                    "GE_CYCLE_STORE_MIGRATION_LOCKED",
                    operation,
                    (
                        "expired migration lock requires takeover"
                        if active_expired
                        else "migration lock is active"
                    ),
                )
            if lock_id in state.used_lock_ids:
                _fail(
                    "GE_CYCLE_STORE_MIGRATION_LOCKED",
                    operation,
                    "migration lockId cannot be reused",
                )
            if state.last_epoch == MAX_SAFE_INTEGER or state.last_fencing_token == MAX_SAFE_INTEGER:
                _fail(
                    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                    operation,
                    "migration fence exhausted",
                )
            migration_lock = cast(
                JsonObject,
                {
                    "lockId": lock_id,
                    "ownerId": owner_id,
                    "sourceSchemaVersion": source_version,
                    "targetSchemaVersion": target_version,
                    "lockEpoch": state.last_epoch + 1,
                    "fencingToken": state.last_fencing_token + 1,
                    "acquiredAt": self._iso_time(now_ms),
                    "expiresAt": self._iso_time(now_ms + ttl_ms),
                },
            )
            self._migration = _MigrationState(
                active=cast(JsonObject, _clone(migration_lock)),
                last_epoch=cast(int, migration_lock["lockEpoch"]),
                last_fencing_token=cast(int, migration_lock["fencingToken"]),
                used_lock_ids={*state.used_lock_ids, lock_id},
            )
            return migration_lock

        return cast(JsonObject, await self._mutate(operation, context, canonical_request, commit))

    async def inspect_migration_lock(self, context_value: object) -> CycleStoreMigrationLock | None:
        operation: CycleStoreProviderOperation = "inspect-migration-lock"
        context = _authorization_context(context_value, operation)
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            return (
                None
                if self._migration.active is None
                else cast(JsonObject, _clone(self._migration.active))
            )

    async def release_migration_lock(
        self,
        request_value: object,
    ) -> CycleStoreMigrationLock | None:
        operation: CycleStoreProviderOperation = "release-migration-lock"
        request = _capture_object(request_value, operation, "migration release request")
        _exact_keys(
            request,
            ("context", "lockId", "ownerId", "fencingToken"),
            operation,
            "migration release request",
        )
        context = _mutation_context(request["context"], operation)
        lock_id = _identifier(request["lockId"], operation, "lockId")
        owner_id = _identifier(request["ownerId"], operation, "ownerId")
        fencing_token = _integer(
            request["fencingToken"], 1, MAX_SAFE_INTEGER, operation, "fencingToken"
        )
        canonical_request = cast(
            JsonObject,
            _clone(
                {
                    "context": context,
                    "lockId": lock_id,
                    "ownerId": owner_id,
                    "fencingToken": fencing_token,
                }
            ),
        )

        def commit() -> JsonValue:
            active = self._migration.active
            if (
                active is None
                or active["lockId"] != lock_id
                or active["ownerId"] != owner_id
                or active["fencingToken"] != fencing_token
            ):
                _fail(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "migration release identity is stale",
                    cast(
                        JsonObject,
                        {"lastFencingToken": self._migration.last_fencing_token},
                    ),
                )
            self._migration = _MigrationState(
                active=None,
                last_epoch=self._migration.last_epoch,
                last_fencing_token=self._migration.last_fencing_token,
                used_lock_ids=set(self._migration.used_lock_ids),
            )
            return None

        result = await self._mutate(operation, context, canonical_request, commit)
        return cast(CycleStoreMigrationLock | None, result)

    def unsafe_advance_clock_for_test(self, milliseconds: int) -> None:
        """Advance the built-in deterministic clock; never a provider operation."""

        if self._external_now is not None:
            raise TypeError("cannot advance an externally supplied provider clock")
        if type(milliseconds) is not int or milliseconds < 0 or milliseconds > MAX_SAFE_INTEGER:
            raise TypeError("clock advancement must be a nonnegative safe integer")
        self._manual_now_ms += milliseconds

    def unsafe_inject_failure_for_test(
        self,
        operation: CycleStoreProviderOperation,
        code: CycleStoreProviderErrorCode,
    ) -> None:
        if operation not in CYCLE_STORE_PROVIDER_OPERATIONS or code not in (
            CYCLE_STORE_PROVIDER_ERROR_CODES
        ):
            raise TypeError("unknown provider failure injection")
        self._injected_failures[operation] = code

    def unsafe_corrupt_checkpoint_for_test(
        self,
        tenant_id: str,
        checkpoint_scope: str,
        checkpoint_id: str,
        replacement: object,
    ) -> None:
        key = self._checkpoint_key(tenant_id, checkpoint_scope, checkpoint_id)
        if key not in self._checkpoints:
            raise TypeError("checkpoint does not exist")
        self._checkpoints[key] = cast(JsonObject, _clone(replacement))

    def unsafe_set_lease_counters_for_test(
        self,
        tenant_id: str,
        stream_id: str,
        lease_epoch: int,
        fencing_token: int,
    ) -> None:
        if (
            type(lease_epoch) is not int
            or type(fencing_token) is not int
            or lease_epoch < 0
            or fencing_token < 0
            or lease_epoch > MAX_SAFE_INTEGER
            or fencing_token > MAX_SAFE_INTEGER
        ):
            raise TypeError("lease counters must be nonnegative safe integers")
        state = self._lease_state(tenant_id, stream_id)
        self._leases[self._stream_key(tenant_id, stream_id)] = _LeaseState(
            active=None,
            last_lease_epoch=lease_epoch,
            last_fencing_token=fencing_token,
            used_lease_ids=set(state.used_lease_ids),
        )

    def unsafe_state_counters_for_test(self) -> JsonObject:
        return cast(
            JsonObject,
            {
                "streams": len(self._records),
                "records": sum(len(records) for records in self._records.values()),
                "recordIds": len(self._record_ids),
                "checkpoints": len(self._checkpoints),
                "leaseStreams": len(self._leases),
                "idempotencyEntries": len(self._idempotency),
                "cursors": len(self._cursors),
                "legalHolds": sum(len(holds) for holds in self._legal_holds.values()),
                "migrationFence": self._migration.last_fencing_token,
            },
        )

    def unsafe_state_snapshot_for_test(self) -> JsonObject:
        streams = sorted(
            (
                {
                    "scopeHash": canonical_sha256(scope),
                    "tail": _tail(records),
                    "recordHashes": [record["recordHash"] for record in records],
                }
                for scope, records in self._records.items()
            ),
            key=lambda item: cast(str, item["scopeHash"]),
        )
        checkpoints = sorted(
            (
                {
                    "scopeHash": canonical_sha256(scope),
                    "checkpointHash": canonical_sha256(checkpoint),
                }
                for scope, checkpoint in self._checkpoints.items()
            ),
            key=lambda item: item["scopeHash"],
        )
        leases = sorted(
            (
                {
                    "scopeHash": canonical_sha256(scope),
                    "lastLeaseEpoch": state.last_lease_epoch,
                    "lastFencingToken": state.last_fencing_token,
                    "active": (
                        None
                        if state.active is None
                        else {
                            "leaseEpoch": state.active["leaseEpoch"],
                            "fencingToken": state.active["fencingToken"],
                            "expiresAt": state.active["expiresAt"],
                        }
                    ),
                }
                for scope, state in self._leases.items()
            ),
            key=lambda item: cast(str, item["scopeHash"]),
        )
        operations = sorted(
            (
                {
                    "scopeHash": canonical_sha256(scope),
                    "operation": entry.operation,
                    "requestHash": entry.request_hash,
                    "resultHash": canonical_sha256(entry.result),
                }
                for scope, entry in self._idempotency.items()
            ),
            key=lambda item: item["scopeHash"],
        )
        active_migration = self._migration.active
        return cast(
            JsonObject,
            _clone(
                {
                    "descriptorHash": self._descriptor["descriptorHash"],
                    "observedAt": self._iso_time(self._last_observed_now_ms),
                    "streams": streams,
                    "checkpoints": checkpoints,
                    "leases": leases,
                    "operations": operations,
                    "cursorCount": len(self._cursors),
                    "legalHoldCount": sum(
                        len(holds) for holds in self._legal_holds.values()
                    ),
                    "migration": {
                        "lastEpoch": self._migration.last_epoch,
                        "lastFencingToken": self._migration.last_fencing_token,
                        "active": (
                            None
                            if active_migration is None
                            else {
                                "sourceSchemaVersion": active_migration[
                                    "sourceSchemaVersion"
                                ],
                                "targetSchemaVersion": active_migration[
                                    "targetSchemaVersion"
                                ],
                                "lockEpoch": active_migration["lockEpoch"],
                                "fencingToken": active_migration["fencingToken"],
                                "expiresAt": active_migration["expiresAt"],
                            }
                        ),
                    },
                }
            ),
        )
