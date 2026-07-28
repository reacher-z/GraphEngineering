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
import json
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
CycleStoreProviderProfile: TypeAlias = JsonObject
CycleStoreProviderCanonicalRequest: TypeAlias = JsonObject
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
    if (
        raw.get("apiVersion") != CYCLE_STORE_PROVIDER_API_VERSION
        or raw.get("contractVersion") != CYCLE_STORE_PROVIDER_CONTRACT_VERSION
    ):
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
    if (
        protection["payloadProtection"] not in ("external", "provider-managed")
        or protection["encryptionAtRest"] not in ("none", "provider-managed", "external")
        or protection["rawPayloadObservability"] is not False
    ):
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
    return cycle_store_adapter_codec.create_descriptor(
        {
            "providerId": safe_provider_id,
            "schemaVersion": body["schemaVersion"],
            "compatibility": body["compatibility"],
            "limits": body["limits"],
            "capabilities": body["capabilities"],
            "protection": body["protection"],
            "governance": body["governance"],
        }
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


def _cursor_token(value: object, operation: CycleStoreProviderOperation) -> str:
    if type(value) is not str or _IDENTIFIER.fullmatch(value) is None:
        _fail("GE_CYCLE_STORE_INVALID_CURSOR", operation, "cursor token is malformed")
    return value


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


def _parse_checkpoint_summary(
    value: object,
    operation: CycleStoreProviderOperation,
) -> CycleStoreCheckpointSummary:
    summary = _capture_object(value, operation, "checkpoint summary")
    _exact_keys(
        summary,
        (
            "checkpointScope",
            "checkpointId",
            "streamId",
            "boundSequence",
            "boundRecordHash",
            "createdAt",
            "valueHash",
            "valueBytes",
        ),
        operation,
        "checkpoint summary",
    )
    return cast(
        JsonObject,
        {
            "checkpointScope": _identifier(
                summary["checkpointScope"], operation, "checkpointScope"
            ),
            "checkpointId": _identifier(summary["checkpointId"], operation, "checkpointId"),
            "streamId": _identifier(summary["streamId"], operation, "streamId"),
            "boundSequence": _integer(
                summary["boundSequence"], 0, MAX_SAFE_INTEGER, operation, "boundSequence"
            ),
            "boundRecordHash": _hash(summary["boundRecordHash"], operation, "boundRecordHash"),
            "createdAt": _timestamp(summary["createdAt"], operation, "createdAt"),
            "valueHash": _hash(summary["valueHash"], operation, "valueHash"),
            "valueBytes": _integer(
                summary["valueBytes"],
                0,
                MAX_CYCLE_STORE_CHECKPOINT_BYTES,
                operation,
                "valueBytes",
            ),
        },
    )


def _parse_lease(value: object, operation: CycleStoreProviderOperation) -> CycleStoreLease:
    lease = _capture_object(value, operation, "lease")
    _exact_keys(
        lease,
        (
            "leaseId",
            "holderId",
            "leaseEpoch",
            "fencingToken",
            "acquiredAt",
            "expiresAt",
        ),
        operation,
        "lease",
    )
    captured = cast(
        JsonObject,
        {
            "leaseId": _identifier(lease["leaseId"], operation, "leaseId"),
            "holderId": _identifier(lease["holderId"], operation, "holderId"),
            "leaseEpoch": _integer(
                lease["leaseEpoch"], 1, MAX_SAFE_INTEGER, operation, "leaseEpoch"
            ),
            "fencingToken": _integer(
                lease["fencingToken"], 1, MAX_SAFE_INTEGER, operation, "fencingToken"
            ),
            "acquiredAt": _timestamp(lease["acquiredAt"], operation, "acquiredAt"),
            "expiresAt": _timestamp(lease["expiresAt"], operation, "expiresAt"),
        },
    )
    if datetime.fromisoformat(cast(str, captured["expiresAt"]).replace("Z", "+00:00")) <= (
        datetime.fromisoformat(cast(str, captured["acquiredAt"]).replace("Z", "+00:00"))
    ):
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "lease interval is invalid")
    return captured


def _parse_lease_inspection(
    value: object,
    operation: CycleStoreProviderOperation,
) -> CycleStoreLeaseInspection:
    inspection = _capture_object(value, operation, "lease inspection")
    _exact_keys(
        inspection,
        ("status", "lease", "lastLeaseEpoch", "lastFencingToken"),
        operation,
        "lease inspection",
    )
    status = inspection["status"]
    if status not in ("none", "active", "expired", "released"):
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "lease status is invalid")
    lease = None if inspection["lease"] is None else _parse_lease(inspection["lease"], operation)
    last_epoch = _integer(
        inspection["lastLeaseEpoch"], 0, MAX_SAFE_INTEGER, operation, "lastLeaseEpoch"
    )
    last_fence = _integer(
        inspection["lastFencingToken"],
        0,
        MAX_SAFE_INTEGER,
        operation,
        "lastFencingToken",
    )
    if (
        (status == "none" and (lease is not None or last_epoch != 0 or last_fence != 0))
        or (status in ("active", "expired") and lease is None)
        or (status == "released" and lease is not None)
    ):
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "lease inspection is inconsistent")
    return cast(
        JsonObject,
        {
            "status": status,
            "lease": lease,
            "lastLeaseEpoch": last_epoch,
            "lastFencingToken": last_fence,
        },
    )


def _parse_governance_inspection(
    value: object,
    operation: CycleStoreProviderOperation,
) -> CycleStoreGovernanceInspection:
    inspection = _capture_object(value, operation, "governance inspection")
    _exact_keys(
        inspection,
        ("legalHoldIds", "retentionMode", "archiveMode", "compactionMode"),
        operation,
        "governance inspection",
    )
    raw_hold_ids = inspection["legalHoldIds"]
    if type(raw_hold_ids) is not list:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "legalHoldIds must be an array")
    hold_ids = [_identifier(item, operation, "legalHoldId") for item in raw_hold_ids]
    if hold_ids != sorted(set(hold_ids)):
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "legalHoldIds are not canonical")
    if (
        inspection["retentionMode"] != "retain-authoritative-history"
        or inspection["archiveMode"] != "lossless-before-delete"
        or inspection["compactionMode"] != "logical-history-preserving"
    ):
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "governance modes are invalid")
    return cast(
        JsonObject,
        {
            "legalHoldIds": hold_ids,
            "retentionMode": "retain-authoritative-history",
            "archiveMode": "lossless-before-delete",
            "compactionMode": "logical-history-preserving",
        },
    )


def _parse_migration_lock(
    value: object,
    operation: CycleStoreProviderOperation,
) -> CycleStoreMigrationLock:
    lock = _capture_object(value, operation, "migration lock")
    _exact_keys(
        lock,
        (
            "lockId",
            "ownerId",
            "sourceSchemaVersion",
            "targetSchemaVersion",
            "lockEpoch",
            "fencingToken",
            "acquiredAt",
            "expiresAt",
        ),
        operation,
        "migration lock",
    )
    source_version = _integer(
        lock["sourceSchemaVersion"], 1, MAX_SAFE_INTEGER, operation, "sourceSchemaVersion"
    )
    target_version = _integer(
        lock["targetSchemaVersion"], 1, MAX_SAFE_INTEGER, operation, "targetSchemaVersion"
    )
    if target_version <= source_version:
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "migration interval is invalid")
    captured = cast(
        JsonObject,
        {
            "lockId": _identifier(lock["lockId"], operation, "lockId"),
            "ownerId": _identifier(lock["ownerId"], operation, "ownerId"),
            "sourceSchemaVersion": source_version,
            "targetSchemaVersion": target_version,
            "lockEpoch": _integer(lock["lockEpoch"], 1, MAX_SAFE_INTEGER, operation, "lockEpoch"),
            "fencingToken": _integer(
                lock["fencingToken"], 1, MAX_SAFE_INTEGER, operation, "fencingToken"
            ),
            "acquiredAt": _timestamp(lock["acquiredAt"], operation, "acquiredAt"),
            "expiresAt": _timestamp(lock["expiresAt"], operation, "expiresAt"),
        },
    )
    if datetime.fromisoformat(cast(str, captured["expiresAt"]).replace("Z", "+00:00")) <= (
        datetime.fromisoformat(cast(str, captured["acquiredAt"]).replace("Z", "+00:00"))
    ):
        _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "migration lock interval is invalid")
    return captured


def _reject_duplicate_object(pairs: list[tuple[str, JsonValue]]) -> JsonObject:
    result: JsonObject = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _reject_json_constant(token: str) -> Never:
    raise ValueError(f"invalid JSON constant: {token}")


def _decode_canonical_blob(
    value: bytes,
    operation: CycleStoreProviderOperation,
    label: str,
    maximum_bytes: int,
) -> JsonValue:
    try:
        if type(value) is not bytes or len(value) > maximum_bytes:
            raise ValueError("canonical blob is outside bounds")
        decoded = json.loads(
            value.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_object,
            parse_constant=_reject_json_constant,
        )
        captured = portable_json_snapshot(decoded)
        if canonical_bytes(captured) != value:
            raise ValueError("canonical blob identity drifted")
        return captured
    except Exception:
        _fail("GE_CYCLE_STORE_CORRUPTION", operation, f"{label} bytes are corrupt")


_MUTATING_CYCLE_STORE_OPERATIONS: frozenset[CycleStoreProviderOperation] = frozenset(
    {
        "append",
        "save-checkpoint",
        "delete-checkpoint",
        "acquire-lease",
        "renew-lease",
        "release-lease",
        "set-legal-hold",
        "acquire-migration-lock",
        "release-migration-lock",
    }
)


def _canonical_mutation_request_maximum_bytes(
    operation: CycleStoreProviderOperation,
) -> int:
    return (
        MAX_CYCLE_STORE_CHECKPOINT_BYTES + MAX_CYCLE_STORE_RECORD_BYTES
        if operation == "save-checkpoint"
        else MAX_CYCLE_STORE_APPEND_BYTES
    )


@dataclass(frozen=True, slots=True)
class CycleStoreProviderAdapterCodec:
    """Bounded, provider-neutral adapter authoring surface.

    Adapters call :meth:`capture_request` synchronously before their first
    await, then persist the returned detached request and its operation hash.
    Stored authoritative values and idempotency results cross canonical byte
    boundaries through this codec so database implementations cannot invent a
    second serialization or validation contract.
    """

    def create_descriptor(self, profile_value: object) -> CycleStoreProviderDescriptor:
        """Build and validate a descriptor from one exact closed provider profile."""

        operation: CycleStoreProviderOperation = "describe"
        profile = _capture_object(
            profile_value,
            operation,
            "provider profile",
            MAX_CYCLE_STORE_RECORD_BYTES,
        )
        _exact_keys(
            profile,
            (
                "providerId",
                "schemaVersion",
                "compatibility",
                "limits",
                "capabilities",
                "protection",
                "governance",
            ),
            operation,
            "provider profile",
        )
        provider_id = _identifier(profile["providerId"], operation, "providerId")
        reference = _descriptor_body(provider_id)
        body = cast(
            JsonObject,
            {
                **reference,
                "schemaVersion": profile["schemaVersion"],
                "compatibility": profile["compatibility"],
                "limits": profile["limits"],
                "capabilities": profile["capabilities"],
                "protection": profile["protection"],
                "governance": profile["governance"],
            },
        )
        return validate_cycle_store_provider_descriptor(
            {
                **body,
                "descriptorHash": _domain_hash(CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN, body),
            }
        )

    def capture_request(
        self,
        operation: CycleStoreProviderOperation,
        request_value: object,
        descriptor_value: object,
    ) -> CycleStoreProviderCanonicalRequest:
        """Synchronously capture one detached, closed, operation-specific request."""

        if operation not in CYCLE_STORE_PROVIDER_OPERATIONS or operation == "describe":
            raise TypeError("operation does not accept a provider request")
        descriptor = validate_cycle_store_provider_descriptor(descriptor_value)
        limits = cast(JsonObject, descriptor["limits"])

        def limit(name: str) -> int:
            return cast(int, limits[name])

        if operation in ("inspect-schema", "inspect-migration-lock"):
            return cast(
                JsonObject,
                {"context": _authorization_context(request_value, operation)},
            )

        if operation in ("read-tail", "inspect-lease", "inspect-governance"):
            labels = {
                "read-tail": "tail request",
                "inspect-lease": "inspect lease request",
                "inspect-governance": "governance request",
            }
            label = labels[operation]
            request = _capture_object(request_value, operation, label)
            _exact_keys(request, ("context", "streamId"), operation, label)
            return cast(
                JsonObject,
                {
                    "context": _authorization_context(request["context"], operation),
                    "streamId": _identifier(request["streamId"], operation, "streamId"),
                },
            )

        if operation == "append":
            request = _capture_object(request_value, operation, "append request")
            _exact_keys(
                request,
                ("context", "streamId", "expectedTail", "lease", "records"),
                operation,
                "append request",
            )
            context = _mutation_context(request["context"], operation)
            stream_id = _identifier(request["streamId"], operation, "streamId")
            expected_tail = _parse_tail(request["expectedTail"], operation, "expectedTail")
            lease = (
                None if request["lease"] is None else _lease_binding(request["lease"], operation)
            )
            raw_records = request["records"]
            if type(raw_records) is not list or not raw_records:
                _fail(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "append records must be nonempty",
                )
            if len(raw_records) > limit("maxAppendRecords"):
                _fail(
                    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                    operation,
                    "append record count exceeds provider limit",
                )
            records = tuple(_parse_record(item, operation) for item in raw_records)
            batch_bytes = 0
            for record in records:
                record_bytes = len(canonical_bytes(record))
                if record_bytes > limit("maxRecordBytes"):
                    _fail(
                        "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                        operation,
                        "record exceeds provider byte limit",
                    )
                batch_bytes += record_bytes
                if batch_bytes > limit("maxAppendBytes"):
                    _fail(
                        "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                        operation,
                        "append exceeds provider byte limit",
                    )
            return cast(
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

        if operation == "read-event-page":
            request = _capture_object(request_value, operation, "event page request")
            _exact_keys(
                request,
                ("context", "streamId", "fromSequence", "pageSize", "cursor"),
                operation,
                "event page request",
            )
            context = _authorization_context(request["context"], operation)
            stream_id = _identifier(request["streamId"], operation, "streamId")
            page_size = _integer(
                request["pageSize"], 1, limit("maxPageSize"), operation, "pageSize"
            )
            cursor = (
                None if request["cursor"] is None else _cursor_token(request["cursor"], operation)
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
            return cast(
                JsonObject,
                {
                    "context": context,
                    "streamId": stream_id,
                    "fromSequence": from_sequence,
                    "pageSize": page_size,
                    "cursor": cursor,
                },
            )

        if operation == "save-checkpoint":
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
            return cast(
                JsonObject,
                _clone(
                    {
                        "context": _mutation_context(request["context"], operation),
                        "checkpoint": _parse_checkpoint(request["checkpoint"], operation),
                        "lease": (
                            None
                            if request["lease"] is None
                            else _lease_binding(request["lease"], operation)
                        ),
                    }
                ),
            )

        if operation == "load-checkpoint":
            request = _capture_object(request_value, operation, "load checkpoint request")
            _exact_keys(
                request,
                ("context", "checkpointScope", "checkpointId"),
                operation,
                "load checkpoint request",
            )
            return cast(
                JsonObject,
                {
                    "context": _authorization_context(request["context"], operation),
                    "checkpointScope": _identifier(
                        request["checkpointScope"], operation, "checkpointScope"
                    ),
                    "checkpointId": _identifier(request["checkpointId"], operation, "checkpointId"),
                },
            )

        if operation == "list-checkpoints":
            request = _capture_object(request_value, operation, "list checkpoint request")
            _exact_keys(
                request,
                ("context", "checkpointScope", "pageSize", "cursor"),
                operation,
                "list checkpoint request",
            )
            return cast(
                JsonObject,
                {
                    "context": _authorization_context(request["context"], operation),
                    "checkpointScope": _identifier(
                        request["checkpointScope"], operation, "checkpointScope"
                    ),
                    "pageSize": _integer(
                        request["pageSize"], 1, limit("maxPageSize"), operation, "pageSize"
                    ),
                    "cursor": (
                        None
                        if request["cursor"] is None
                        else _cursor_token(request["cursor"], operation)
                    ),
                },
            )

        if operation == "delete-checkpoint":
            request = _capture_object(request_value, operation, "delete checkpoint request")
            _exact_keys(
                request,
                ("context", "checkpointScope", "checkpointId", "expectedValueHash"),
                operation,
                "delete checkpoint request",
            )
            return cast(
                JsonObject,
                {
                    "context": _mutation_context(request["context"], operation),
                    "checkpointScope": _identifier(
                        request["checkpointScope"], operation, "checkpointScope"
                    ),
                    "checkpointId": _identifier(request["checkpointId"], operation, "checkpointId"),
                    "expectedValueHash": (
                        None
                        if request["expectedValueHash"] is None
                        else _hash(request["expectedValueHash"], operation, "expectedValueHash")
                    ),
                },
            )

        if operation == "acquire-lease":
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
            stream_id = _identifier(request["streamId"], operation, "streamId")
            lease_id = _identifier(request["leaseId"], operation, "leaseId")
            holder_id = _identifier(request["holderId"], operation, "holderId")
            ttl_ms = _integer(request["ttlMs"], 1, limit("maxLeaseTtlMs"), operation, "ttlMs")
            mode = request["mode"]
            if mode not in ("acquire", "takeover"):
                _fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "lease mode is invalid")
            expected_fencing_token = _integer(
                request["expectedFencingToken"],
                0,
                MAX_SAFE_INTEGER,
                operation,
                "expectedFencingToken",
            )
            return cast(
                JsonObject,
                {
                    "context": context,
                    "streamId": stream_id,
                    "leaseId": lease_id,
                    "holderId": holder_id,
                    "ttlMs": ttl_ms,
                    "mode": mode,
                    "expectedFencingToken": expected_fencing_token,
                },
            )

        if operation == "renew-lease":
            request = _capture_object(request_value, operation, "renew lease request")
            _exact_keys(
                request,
                ("context", "streamId", "lease", "ttlMs"),
                operation,
                "renew lease request",
            )
            return cast(
                JsonObject,
                {
                    "context": _mutation_context(request["context"], operation),
                    "streamId": _identifier(request["streamId"], operation, "streamId"),
                    "lease": _lease_binding(request["lease"], operation),
                    "ttlMs": _integer(
                        request["ttlMs"], 1, limit("maxLeaseTtlMs"), operation, "ttlMs"
                    ),
                },
            )

        if operation == "release-lease":
            request = _capture_object(request_value, operation, "release lease request")
            _exact_keys(
                request,
                ("context", "streamId", "lease"),
                operation,
                "release lease request",
            )
            return cast(
                JsonObject,
                {
                    "context": _mutation_context(request["context"], operation),
                    "streamId": _identifier(request["streamId"], operation, "streamId"),
                    "lease": _lease_binding(request["lease"], operation),
                },
            )

        if operation == "set-legal-hold":
            request = _capture_object(request_value, operation, "legal hold request")
            _exact_keys(
                request,
                ("context", "streamId", "holdId", "action"),
                operation,
                "legal hold request",
            )
            context = _mutation_context(request["context"], operation)
            stream_id = _identifier(request["streamId"], operation, "streamId")
            hold_id = _identifier(request["holdId"], operation, "holdId")
            action = request["action"]
            if action not in ("place", "release"):
                _fail(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "legal hold action is invalid",
                )
            return cast(
                JsonObject,
                {
                    "context": context,
                    "streamId": stream_id,
                    "holdId": hold_id,
                    "action": action,
                },
            )

        if operation == "acquire-migration-lock":
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
            if source_version != descriptor["schemaVersion"] or target_version <= source_version:
                _fail(
                    "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
                    operation,
                    "migration schema interval is unsupported",
                )
            ttl_ms = _integer(request["ttlMs"], 1, limit("maxLeaseTtlMs"), operation, "ttlMs")
            mode = request["mode"]
            if mode not in ("acquire", "takeover"):
                _fail(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "migration lock mode is invalid",
                )
            expected_fencing_token = _integer(
                request["expectedFencingToken"],
                0,
                MAX_SAFE_INTEGER,
                operation,
                "expectedFencingToken",
            )
            return cast(
                JsonObject,
                {
                    "context": context,
                    "lockId": lock_id,
                    "ownerId": owner_id,
                    "sourceSchemaVersion": source_version,
                    "targetSchemaVersion": target_version,
                    "ttlMs": ttl_ms,
                    "mode": mode,
                    "expectedFencingToken": expected_fencing_token,
                },
            )

        if operation == "release-migration-lock":
            request = _capture_object(request_value, operation, "migration release request")
            _exact_keys(
                request,
                ("context", "lockId", "ownerId", "fencingToken"),
                operation,
                "migration release request",
            )
            return cast(
                JsonObject,
                {
                    "context": _mutation_context(request["context"], operation),
                    "lockId": _identifier(request["lockId"], operation, "lockId"),
                    "ownerId": _identifier(request["ownerId"], operation, "ownerId"),
                    "fencingToken": _integer(
                        request["fencingToken"],
                        1,
                        MAX_SAFE_INTEGER,
                        operation,
                        "fencingToken",
                    ),
                },
            )

        raise AssertionError(f"unhandled provider operation: {operation}")

    def operation_request_hash(
        self,
        operation: CycleStoreProviderOperation,
        canonical_request: object,
    ) -> str:
        """Hash a captured mutation request under the portable operation domain."""

        if operation not in _MUTATING_CYCLE_STORE_OPERATIONS:
            raise TypeError("operation does not use the idempotency ledger")
        request = self._capture_canonical_mutation_request(operation, canonical_request)
        return _domain_hash(
            CYCLE_STORE_OPERATION_DOMAIN,
            {"operation": operation, "request": request},
        )

    def encode_canonical_mutation_request(
        self,
        operation: CycleStoreProviderOperation,
        canonical_request: object,
    ) -> bytes:
        """Encode one closed mutation request as detached canonical UTF-8 bytes."""

        request = self._capture_canonical_mutation_request(operation, canonical_request)
        return canonical_bytes(request)

    def decode_canonical_mutation_request(
        self,
        operation: CycleStoreProviderOperation,
        request_bytes: bytes,
    ) -> CycleStoreProviderCanonicalRequest:
        """Decode hostile stored request bytes without exposing parser diagnostics."""

        if operation not in _MUTATING_CYCLE_STORE_OPERATIONS:
            raise TypeError("operation does not use the idempotency ledger")
        try:
            maximum_bytes = _canonical_mutation_request_maximum_bytes(operation)
            decoded = _decode_canonical_blob(
                request_bytes,
                operation,
                "operation ledger request",
                maximum_bytes,
            )
            request = self._capture_canonical_mutation_request(operation, decoded)
            if canonical_bytes(request) != request_bytes:
                raise ValueError("canonical request byte identity drifted")
            return request
        except Exception:
            _fail(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "operation ledger request bytes are corrupt",
            )

    def _capture_canonical_mutation_request(
        self,
        operation: CycleStoreProviderOperation,
        request_value: object,
    ) -> CycleStoreProviderCanonicalRequest:
        if operation not in _MUTATING_CYCLE_STORE_OPERATIONS:
            raise TypeError("operation does not use the idempotency ledger")
        request = _capture_object(
            request_value,
            operation,
            "canonical mutation request",
            _canonical_mutation_request_maximum_bytes(operation),
        )
        source_version = request.get("sourceSchemaVersion")
        schema_version = (
            source_version
            if operation == "acquire-migration-lock"
            and type(source_version) is int
            and source_version >= 1
            else 1
        )
        reference = create_reference_cycle_store_provider_descriptor("canonical-storage-codec")
        descriptor = self.create_descriptor(
            {
                "providerId": reference["providerId"],
                "schemaVersion": schema_version,
                "compatibility": {
                    "minReaderVersion": schema_version,
                    "maxReaderVersion": schema_version,
                    "minWriterVersion": schema_version,
                    "maxWriterVersion": schema_version,
                },
                "limits": reference["limits"],
                "capabilities": reference["capabilities"],
                "protection": reference["protection"],
                "governance": reference["governance"],
            }
        )
        return self.capture_request(operation, request, descriptor)

    def parse_stored_record(
        self,
        value: object,
        operation: CycleStoreProviderOperation,
    ) -> CycleStoreRecord:
        """Revalidate one stored record object or exact canonical UTF-8 byte string."""

        try:
            decoded = (
                _decode_canonical_blob(
                    value,
                    operation,
                    "record",
                    MAX_CYCLE_STORE_RECORD_BYTES * 2,
                )
                if type(value) is bytes
                else value
            )
            return _parse_record(decoded, operation)
        except CycleStoreProviderError as error:
            if error.code == "GE_CYCLE_STORE_CORRUPTION" and error.operation == operation:
                raise
            _fail("GE_CYCLE_STORE_CORRUPTION", operation, "record bytes are corrupt")
        except Exception:
            _fail("GE_CYCLE_STORE_CORRUPTION", operation, "record bytes are corrupt")

    def parse_stored_checkpoint(
        self,
        value: object,
        operation: CycleStoreProviderOperation,
    ) -> CycleStoreCheckpoint:
        """Revalidate one stored checkpoint object or exact canonical byte string."""

        maximum_bytes = MAX_CYCLE_STORE_CHECKPOINT_BYTES + MAX_CYCLE_STORE_RECORD_BYTES
        try:
            decoded = (
                _decode_canonical_blob(value, operation, "checkpoint", maximum_bytes)
                if type(value) is bytes
                else value
            )
            return _parse_checkpoint(decoded, operation)
        except CycleStoreProviderError as error:
            if error.code == "GE_CYCLE_STORE_CORRUPTION" and error.operation == operation:
                raise
            _fail("GE_CYCLE_STORE_CORRUPTION", operation, "checkpoint bytes are corrupt")
        except Exception:
            _fail("GE_CYCLE_STORE_CORRUPTION", operation, "checkpoint bytes are corrupt")

    def encode_ledger_result(
        self,
        operation: CycleStoreProviderOperation,
        result_value: object,
    ) -> bytes:
        """Validate and encode one mutation result as exact canonical UTF-8 bytes."""

        return canonical_bytes(self._capture_ledger_result(operation, result_value))

    def decode_ledger_result(
        self,
        operation: CycleStoreProviderOperation,
        result_bytes: bytes,
    ) -> JsonValue:
        """Decode one canonical ledger result and reject schema or byte drift."""

        if operation not in _MUTATING_CYCLE_STORE_OPERATIONS:
            raise TypeError("operation does not use the idempotency ledger")
        try:
            decoded = _decode_canonical_blob(
                result_bytes,
                operation,
                "idempotency result",
                MAX_CYCLE_STORE_CHECKPOINT_BYTES + MAX_CYCLE_STORE_RECORD_BYTES,
            )
            return self._capture_ledger_result(operation, decoded)
        except CycleStoreProviderError as error:
            if error.code == "GE_CYCLE_STORE_CORRUPTION" and error.operation == operation:
                raise
            _fail(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "idempotency result bytes are corrupt",
            )
        except Exception:
            _fail(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "idempotency result bytes are corrupt",
            )

    @staticmethod
    def _capture_ledger_result(
        operation: CycleStoreProviderOperation,
        result_value: object,
    ) -> JsonValue:
        if operation not in _MUTATING_CYCLE_STORE_OPERATIONS:
            raise TypeError("operation does not use the idempotency ledger")
        if operation == "release-migration-lock":
            if result_value is not None:
                _fail(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "migration release result must be null",
                )
            return None
        if operation == "append":
            result = _capture_object(result_value, operation, "append result")
            _exact_keys(result, ("tail", "appendedRecords"), operation, "append result")
            return cast(
                JsonObject,
                {
                    "tail": _parse_tail(result["tail"], operation, "tail"),
                    "appendedRecords": _integer(
                        result["appendedRecords"],
                        1,
                        MAX_CYCLE_STORE_APPEND_RECORDS,
                        operation,
                        "appendedRecords",
                    ),
                },
            )
        if operation == "save-checkpoint":
            return _parse_checkpoint_summary(result_value, operation)
        if operation == "delete-checkpoint":
            result = _capture_object(result_value, operation, "checkpoint deletion result")
            _exact_keys(result, ("deleted",), operation, "checkpoint deletion result")
            if type(result["deleted"]) is not bool:
                _fail(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "deleted must be a boolean",
                )
            return cast(JsonObject, {"deleted": result["deleted"]})
        if operation in ("acquire-lease", "renew-lease"):
            return _parse_lease(result_value, operation)
        if operation == "release-lease":
            inspection = _parse_lease_inspection(result_value, operation)
            if inspection["status"] != "released":
                _fail(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "lease release result is inconsistent",
                )
            return inspection
        if operation == "set-legal-hold":
            return _parse_governance_inspection(result_value, operation)
        if operation == "acquire-migration-lock":
            return _parse_migration_lock(result_value, operation)
        raise AssertionError(f"unhandled ledger operation: {operation}")


cycle_store_adapter_codec = CycleStoreProviderAdapterCodec()


def decode_canonical_mutation_request(
    operation: CycleStoreProviderOperation,
    request_bytes: bytes,
) -> CycleStoreProviderCanonicalRequest:
    """Decode one exact stored mutation request through the shared codec."""

    return cycle_store_adapter_codec.decode_canonical_mutation_request(operation, request_bytes)


def encode_canonical_mutation_request(
    operation: CycleStoreProviderOperation,
    canonical_request: object,
) -> bytes:
    """Encode one exact stored mutation request through the shared codec."""

    return cycle_store_adapter_codec.encode_canonical_mutation_request(operation, canonical_request)


@dataclass(slots=True)
class _IdempotencyEntry:
    operation: CycleStoreProviderOperation
    request_hash: str
    result_bytes: bytes


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
        self._injected_failures: dict[CycleStoreProviderOperation, CycleStoreProviderErrorCode] = {}

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
            request_hash = cycle_store_adapter_codec.operation_request_hash(
                operation,
                canonical_request,
            )
            existing = self._idempotency.get(ledger_key)
            if existing is not None:
                if existing.operation != operation or existing.request_hash != request_hash:
                    _fail(
                        "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT",
                        operation,
                        "operationId was reused with a different canonical request",
                    )
                return cycle_store_adapter_codec.decode_ledger_result(
                    operation,
                    existing.result_bytes,
                )
            await self._run_fault(f"provider:{operation}:before-commit", operation)
            result_bytes = cycle_store_adapter_codec.encode_ledger_result(operation, action())
            self._idempotency[ledger_key] = _IdempotencyEntry(
                operation=operation,
                request_hash=request_hash,
                result_bytes=result_bytes,
            )
            await self._run_fault(
                f"provider:{operation}:after-commit-before-return",
                operation,
            )
            return cycle_store_adapter_codec.decode_ledger_result(operation, result_bytes)

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

    async def describe(self) -> CycleStoreProviderDescriptor:
        return cast(JsonObject, _clone(self._descriptor))

    async def inspect_schema(self, context_value: object) -> CycleStoreSchemaInspection:
        operation: CycleStoreProviderOperation = "inspect-schema"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            context_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        stream_id = cast(str, request["streamId"])
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            records = self._records.get(
                self._stream_key(cast(str, context["tenantId"]), stream_id), ()
            )
            return cast(JsonObject, _clone(_tail(records)))

    async def append(self, request_value: object) -> JsonObject:
        operation: CycleStoreProviderOperation = "append"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        expected_tail = cast(JsonObject, request["expectedTail"])
        lease = cast(CycleStoreLeaseBinding | None, request["lease"])
        records = tuple(cast(list[CycleStoreRecord], request["records"]))
        canonical_request = request

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
                if (
                    record["sequence"] != next_sequence
                    or record["previousRecordHash"] != previous_hash
                ):
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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        page_size = cast(int, request["pageSize"])
        cursor = cast(str | None, request["cursor"])
        from_sequence = cast(int | None, request["fromSequence"])
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
                cycle_store_adapter_codec.parse_stored_record(record, operation)
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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        checkpoint = cast(JsonObject, request["checkpoint"])
        lease = cast(CycleStoreLeaseBinding | None, request["lease"])
        canonical_request = request

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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        scope = cast(str, request["checkpointScope"])
        checkpoint_id = cast(str, request["checkpointId"])
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            checkpoint = self._checkpoints.get(
                self._checkpoint_key(cast(str, context["tenantId"]), scope, checkpoint_id)
            )
            if checkpoint is None:
                return None
            try:
                return cycle_store_adapter_codec.parse_stored_checkpoint(checkpoint, operation)
            except CycleStoreProviderError:
                _fail(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "checkpoint bytes are corrupt",
                    cast(JsonObject, {"checkpointId": checkpoint_id}),
                )

    async def list_checkpoints(self, request_value: object) -> CycleStoreCheckpointPage:
        operation: CycleStoreProviderOperation = "list-checkpoints"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        checkpoint_scope = cast(str, request["checkpointScope"])
        page_size = cast(int, request["pageSize"])
        cursor = cast(str | None, request["cursor"])
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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        checkpoint_scope = cast(str, request["checkpointScope"])
        checkpoint_id = cast(str, request["checkpointId"])
        expected_hash = cast(str | None, request["expectedValueHash"])
        canonical_request = request

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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        lease_id = cast(str, request["leaseId"])
        holder_id = cast(str, request["holderId"])
        ttl_ms = cast(int, request["ttlMs"])
        mode = cast(Literal["acquire", "takeover"], request["mode"])
        expected_fencing_token = cast(int, request["expectedFencingToken"])
        canonical_request = request

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
            active_expired = (
                state.active is not None
                and self._parse_time(cast(str, state.active["expiresAt"])) <= now_ms
            )
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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        binding = cast(JsonObject, request["lease"])
        ttl_ms = cast(int, request["ttlMs"])
        canonical_request = request

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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        binding = cast(JsonObject, request["lease"])
        canonical_request = request

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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        stream_id = cast(str, request["streamId"])
        await self._authorize(context, operation)
        async with self._lock:
            self._maybe_fail(operation)
            return cast(
                JsonObject,
                _clone(
                    self._lease_inspection(cast(str, context["tenantId"]), stream_id, operation)
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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        hold_id = cast(str, request["holdId"])
        action = cast(Literal["place", "release"], request["action"])
        canonical_request = request

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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        lock_id = cast(str, request["lockId"])
        owner_id = cast(str, request["ownerId"])
        source_version = cast(int, request["sourceSchemaVersion"])
        target_version = cast(int, request["targetSchemaVersion"])
        ttl_ms = cast(int, request["ttlMs"])
        mode = cast(Literal["acquire", "takeover"], request["mode"])
        expected_fencing_token = cast(int, request["expectedFencingToken"])
        canonical_request = request

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
            active_expired = (
                state.active is not None
                and self._parse_time(cast(str, state.active["expiresAt"])) <= now_ms
            )
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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            context_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
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
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        lock_id = cast(str, request["lockId"])
        owner_id = cast(str, request["ownerId"])
        fencing_token = cast(int, request["fencingToken"])
        canonical_request = request

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
                    "resultHash": hashlib.sha256(entry.result_bytes).hexdigest(),
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
                    "legalHoldCount": sum(len(holds) for holds in self._legal_holds.values()),
                    "migration": {
                        "lastEpoch": self._migration.last_epoch,
                        "lastFencingToken": self._migration.last_fencing_token,
                        "active": (
                            None
                            if active_migration is None
                            else {
                                "sourceSchemaVersion": active_migration["sourceSchemaVersion"],
                                "targetSchemaVersion": active_migration["targetSchemaVersion"],
                                "lockEpoch": active_migration["lockEpoch"],
                                "fencingToken": active_migration["fencingToken"],
                                "expiresAt": active_migration["expiresAt"],
                            }
                        ),
                    },
                }
            ),
        )
