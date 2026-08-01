"""Canonical SQLite operation-ledger v2 baseline byte protocol.

This module contains only deterministic, provider-neutral transforms.  It does
not read SQLite, allocate clocks, or mutate caller-owned values.  Database
adapters remain responsible for presenting source rows in the canonical order
and persisting the returned exact bytes and hashes atomically.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from itertools import pairwise
from typing import Literal, TypeAlias, cast

from .canonical import canonical_bytes
from .models import MAX_SAFE_INTEGER, JsonObject, JsonValue
from .portable_json import portable_json_snapshot

BASELINE_ID_DOMAIN = "graph-engineering/sqlite-operation-baseline-id/v1\0"
BASELINE_ENTRY_DOMAIN = "graph-engineering/sqlite-operation-baseline-entry/v1\0"
BASELINE_PROJECTION_DOMAIN = "graph-engineering/sqlite-operation-baseline-projection/v1\0"
BASELINE_GENESIS_DOMAIN = "graph-engineering/sqlite-operation-baseline-genesis/v1\0"
BASELINE_EMPTY_DOMAIN = "graph-engineering/sqlite-operation-baseline-empty/v1\0"
LEDGER_REPLAY_DIGEST_DOMAIN = "graph-engineering/sqlite-operation-ledger-replay/v1\0"

BASELINE_GENESIS_HASH = "5311dba7ae8b844fc3efccd55dd90c3f78e02a7f7e222d7a0a513fd1aff9ec96"
BASELINE_EMPTY_ROOT = "66a081bbc7369b674fa093cb2e3e1d269a1eb506698e24dfc2899074bf06b82a"

MAX_BASELINE_KEY_BYTES = 4_096
MAX_BASELINE_STATE_BYTES = 2_097_152
MAX_BASELINE_POLICY_BYTES = 1_048_576
MAX_RECORD_VALUE_BYTES = 1_048_576
MAX_CHECKPOINT_VALUE_BYTES = 16_777_216

BaselineEntryKind: TypeAlias = Literal[
    "schema-envelope",
    "migration-lineage",
    "stream-head",
    "record-identity",
    "checkpoint-current",
    "checkpoint-revision",
    "lease-current",
    "used-lease-identity",
    "legal-hold",
    "migration-lock-current",
    "used-migration-lock-identity",
    "legacy-operation",
]

BASELINE_ENTRY_KINDS: tuple[BaselineEntryKind, ...] = (
    "schema-envelope",
    "migration-lineage",
    "stream-head",
    "record-identity",
    "checkpoint-current",
    "checkpoint-revision",
    "lease-current",
    "used-lease-identity",
    "legal-hold",
    "migration-lock-current",
    "used-migration-lock-identity",
    "legacy-operation",
)

_KIND_RANK = {kind: rank for rank, kind in enumerate(BASELINE_ENTRY_KINDS)}
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_HASH = re.compile(r"^[0-9a-f]{64}$")
_BASELINE_ID = re.compile(r"^v2-[0-9a-f]{64}$")
_RFC3339 = re.compile(
    r"^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])"
    r"T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)
_MUTATIONS = frozenset(
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

_KEY_FIELDS: dict[BaselineEntryKind, tuple[str, ...]] = {
    "schema-envelope": ("scope",),
    "migration-lineage": ("version",),
    "stream-head": ("streamId", "tenantId"),
    "record-identity": ("recordId", "tenantId"),
    "checkpoint-current": ("checkpointId", "checkpointScope", "tenantId"),
    "checkpoint-revision": ("checkpointScope", "revision", "tenantId"),
    "lease-current": ("streamId", "tenantId"),
    "used-lease-identity": ("leaseId", "streamId", "tenantId"),
    "legal-hold": ("holdId", "streamId", "tenantId"),
    "migration-lock-current": ("singleton",),
    "used-migration-lock-identity": ("lockId",),
    "legacy-operation": ("operationId", "tenantId"),
}

_STATE_FIELDS: dict[BaselineEntryKind, tuple[str, ...]] = {
    "schema-envelope": (
        "createdAtMs",
        "currentVersion",
        "latestMigrationAppliedAtMs",
        "latestMigrationSha256",
        "maxReaderVersion",
        "maxWriterVersion",
        "minReaderVersion",
        "minWriterVersion",
        "providerDescriptorHash",
        "schemaIdentitySha256",
        "updatedAtMs",
    ),
    "migration-lineage": (
        "appliedAtMs",
        "migrationId",
        "postconditions",
        "previousVersion",
        "reversibility",
        "schemaIdentitySha256",
        "sqlSha256",
        "version",
    ),
    "stream-head": (
        "createdAtMs",
        "streamId",
        "tailRecordHash",
        "tailSequence",
        "tenantId",
        "updatedAtMs",
    ),
    "record-identity": (
        "committedAtMs",
        "previousRecordHash",
        "recordHash",
        "recordId",
        "sequence",
        "streamId",
        "tenantId",
        "valueBytes",
        "valueHash",
    ),
    "checkpoint-current": (
        "boundRecordHash",
        "boundSequence",
        "checkpointId",
        "checkpointRevision",
        "checkpointScope",
        "committedAtMs",
        "createdAt",
        "streamId",
        "summary",
        "tenantId",
        "valueBytes",
        "valueHash",
    ),
    "checkpoint-revision": (
        "action",
        "boundRecordHash",
        "boundSequence",
        "checkpointCreatedAt",
        "checkpointId",
        "checkpointScope",
        "recordedAtMs",
        "revision",
        "summary",
        "tenantId",
        "valueBytes",
        "valueHash",
    ),
    "lease-current": (
        "activeAcquiredAtMs",
        "activeExpiresAtMs",
        "activeFencingToken",
        "activeHolderId",
        "activeLeaseEpoch",
        "activeLeaseId",
        "lastFencingToken",
        "lastLeaseEpoch",
        "streamId",
        "tenantId",
        "updatedAtMs",
    ),
    "used-lease-identity": (
        "fencingToken",
        "firstUsedAtMs",
        "leaseEpoch",
        "leaseId",
        "streamId",
        "tenantId",
    ),
    "legal-hold": ("holdId", "placedAtMs", "streamId", "tenantId"),
    "migration-lock-current": (
        "activeAcquiredAtMs",
        "activeExpiresAtMs",
        "activeFencingToken",
        "activeLockEpoch",
        "activeLockId",
        "activeOwnerId",
        "activeSourceVersion",
        "activeTargetVersion",
        "lastFencingToken",
        "lastLockEpoch",
        "singleton",
        "updatedAtMs",
    ),
    "used-migration-lock-identity": (
        "fencingToken",
        "firstUsedAtMs",
        "lockEpoch",
        "lockId",
    ),
    "legacy-operation": (
        "committedAtMs",
        "operationId",
        "operationName",
        "requestHash",
        "resultBlobSha256",
        "resultHash",
        "tenantId",
    ),
}


@dataclass(frozen=True, slots=True)
class BaselineEntryInput:
    """One detached baseline entry before ordinal and hash-chain assignment."""

    entry_kind: BaselineEntryKind
    key: JsonObject
    state: JsonObject
    key_bytes: bytes
    state_bytes: bytes


@dataclass(frozen=True, slots=True)
class BaselineEntry:
    """One canonical, ordered, hash-chained baseline entry."""

    baseline_id: str
    entry_kind: BaselineEntryKind
    ordinal: int
    key_bytes: bytes
    state_bytes: bytes
    previous_entry_hash: str
    entry_hash: str

    @property
    def key(self) -> JsonObject:
        """Return a detached key so callers cannot mutate the hashed projection."""

        return cast(JsonObject, json.loads(self.key_bytes))

    @property
    def state(self) -> JsonObject:
        """Return detached state so callers cannot mutate the hashed projection."""

        return cast(JsonObject, json.loads(self.state_bytes))


@dataclass(frozen=True, slots=True)
class BaselineProjection:
    """Identity fields for one complete canonical baseline projection."""

    baseline_id: str
    entries: tuple[BaselineEntry, ...]
    entry_count: int
    legacy_operation_count: int
    first_entry_hash: str
    final_entry_hash: str
    projection_sha256: str


@dataclass(frozen=True, slots=True)
class BaselineProjectionIdentity:
    """Immutable identity of a completed constant-memory baseline stream."""

    baseline_id: str
    entry_count: int
    legacy_operation_count: int
    first_entry_hash: str
    final_entry_hash: str
    projection_sha256: str


def _domain_hash(domain: str, value: object) -> str:
    digest = hashlib.sha256()
    digest.update(domain.encode("utf-8"))
    digest.update(canonical_bytes(value))
    return digest.hexdigest()


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _validate_baseline_id(value: object) -> str:
    if type(value) is not str or _BASELINE_ID.fullmatch(value) is None:
        raise ValueError("baselineId is invalid")
    return value


def _object(value: object, fields: Sequence[str], label: str) -> JsonObject:
    try:
        captured = portable_json_snapshot(value)
    except Exception as exc:
        raise ValueError(f"{label} must be bounded portable JSON") from exc
    if type(captured) is not dict:
        raise ValueError(f"{label} must be an object")
    if set(captured) != set(fields):
        raise ValueError(f"{label} must be closed")
    return captured


def _integer(value: JsonValue, label: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum or value > MAX_SAFE_INTEGER:
        raise ValueError(f"{label} is outside bounds")
    return value


def _nullable_integer(value: JsonValue, label: str, minimum: int = 0) -> int | None:
    return None if value is None else _integer(value, label, minimum)


def _identifier(value: JsonValue, label: str) -> str:
    if type(value) is not str or value in {".", ".."} or _IDENTIFIER.fullmatch(value) is None:
        raise ValueError(f"{label} is invalid")
    return value


def _nullable_identifier(value: JsonValue, label: str) -> str | None:
    return None if value is None else _identifier(value, label)


def _hash(value: JsonValue, label: str) -> str:
    if type(value) is not str or _HASH.fullmatch(value) is None:
        raise ValueError(f"{label} is invalid")
    return value


def _nullable_hash(value: JsonValue, label: str) -> str | None:
    return None if value is None else _hash(value, label)


def _string(value: JsonValue, label: str) -> str:
    if type(value) is not str or not value:
        raise ValueError(f"{label} must be a nonempty string")
    return value


def _timestamp(value: JsonValue, label: str) -> str:
    timestamp = _string(value, label)
    if _RFC3339.fullmatch(timestamp) is None:
        raise ValueError(f"{label} is not RFC3339")
    try:
        datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} is not RFC3339") from exc
    return timestamp


def _checkpoint_summary(value: JsonValue) -> JsonObject:
    summary = _object(
        value,
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
        "checkpoint summary",
    )
    for name in ("checkpointScope", "checkpointId", "streamId"):
        _identifier(summary[name], name)
    _integer(summary["boundSequence"], "boundSequence")
    _hash(summary["boundRecordHash"], "boundRecordHash")
    _timestamp(summary["createdAt"], "createdAt")
    _hash(summary["valueHash"], "valueHash")
    value_bytes = _integer(summary["valueBytes"], "valueBytes", 1)
    if value_bytes > MAX_CHECKPOINT_VALUE_BYTES:
        raise ValueError("valueBytes is outside bounds")
    return summary


def _validate_checkpoint_summary_consistency(
    summary: JsonObject,
    outer: JsonObject,
    *,
    revision: bool,
) -> None:
    field_pairs: list[tuple[str, str]] = [
        ("checkpointScope", "checkpointScope"),
        ("checkpointId", "checkpointId"),
        ("boundSequence", "boundSequence"),
        ("boundRecordHash", "boundRecordHash"),
        ("createdAt", "checkpointCreatedAt" if revision else "createdAt"),
        ("valueHash", "valueHash"),
        ("valueBytes", "valueBytes"),
    ]
    if not revision:
        field_pairs.append(("streamId", "streamId"))
    if any(summary[summary_name] != outer[outer_name] for summary_name, outer_name in field_pairs):
        raise ValueError("checkpoint summary and baseline state disagree")


def validate_baseline_source_envelope(value: object) -> JsonObject:
    """Capture the exact closed v1 source envelope used to derive a baseline ID."""

    envelope = _object(
        value,
        (
            "capturedAtMs",
            "sourceApplicationId",
            "sourceDescriptorHash",
            "sourceMigrationLineageId",
            "sourceMigrationLineageSha256",
            "sourceSchemaIdentitySha256",
            "sourceUserVersion",
        ),
        "baseline source envelope",
    )
    _integer(envelope["capturedAtMs"], "capturedAtMs")
    if envelope["sourceApplicationId"] != 1_195_724_359:
        raise ValueError("sourceApplicationId is invalid")
    _hash(envelope["sourceDescriptorHash"], "sourceDescriptorHash")
    _identifier(envelope["sourceMigrationLineageId"], "sourceMigrationLineageId")
    _hash(envelope["sourceMigrationLineageSha256"], "sourceMigrationLineageSha256")
    _hash(envelope["sourceSchemaIdentitySha256"], "sourceSchemaIdentitySha256")
    if envelope["sourceUserVersion"] != 1:
        raise ValueError("sourceUserVersion is invalid")
    return envelope


def create_baseline_id(source_envelope: object) -> str:
    """Derive ``v2-<digest>`` from one validated source envelope."""

    return "v2-" + _domain_hash(
        BASELINE_ID_DOMAIN,
        validate_baseline_source_envelope(source_envelope),
    )


def create_baseline_policy() -> JsonObject:
    """Return a detached copy of the exact frozen format-1 baseline policy."""

    return cast(
        JsonObject,
        portable_json_snapshot(
            {
                "baselineFormatVersion": 1,
                "canonicalEncoding": "graph-engineering/canonical-json/v1",
                "cursorReplay": "independent-semantic-audit",
                "emptyRoot": BASELINE_EMPTY_ROOT,
                "entryHashDomain": BASELINE_ENTRY_DOMAIN,
                "entryKinds": list(BASELINE_ENTRY_KINDS),
                "genesisHash": BASELINE_GENESIS_HASH,
                "legacyRequestRecovery": False,
                "maxEntryKeyBytes": MAX_BASELINE_KEY_BYTES,
                "maxEntryStateBytes": MAX_BASELINE_STATE_BYTES,
                "payloadOmissions": ["checkpoint-value", "record-blob", "record-value"],
                "projectionHashDomain": BASELINE_PROJECTION_DOMAIN,
                "replayStartsAtCommitSequence": 1,
                "sort": ["entry-kind-rank", "entry-key-utf8-bytes"],
            }
        ),
    )


def encode_baseline_policy() -> bytes:
    encoded = canonical_bytes(create_baseline_policy())
    if not 2 <= len(encoded) <= MAX_BASELINE_POLICY_BYTES:
        raise AssertionError("frozen baseline policy exceeds its storage bound")
    return encoded


def _validate_key(kind: BaselineEntryKind, key: JsonObject) -> None:
    if kind == "schema-envelope":
        if key["scope"] != "cycle-store":
            raise ValueError("schema-envelope scope is invalid")
    elif kind in {"migration-lineage", "checkpoint-revision"}:
        integer = key["version"] if kind == "migration-lineage" else key["revision"]
        _integer(integer, "key integer", 1)
    elif kind == "migration-lock-current":
        if key["singleton"] != 1:
            raise ValueError("migration-lock-current singleton is invalid")
    else:
        for name, value in key.items():
            _identifier(value, name)


def _validate_state(kind: BaselineEntryKind, state: JsonObject) -> None:
    ids = {
        "tenantId",
        "streamId",
        "recordId",
        "checkpointId",
        "checkpointScope",
        "leaseId",
        "holdId",
        "lockId",
        "migrationId",
    }
    required_hashes = {
        "latestMigrationSha256",
        "providerDescriptorHash",
        "schemaIdentitySha256",
        "sqlSha256",
        "recordHash",
        "requestHash",
        "resultBlobSha256",
        "resultHash",
    }
    nullable_ids = {"activeHolderId", "activeLeaseId", "activeLockId", "activeOwnerId"}
    for name in ids & state.keys():
        _identifier(state[name], name)
    for name in required_hashes & state.keys():
        _hash(state[name], name)
    for name in nullable_ids & state.keys():
        _nullable_identifier(state[name], name)

    if kind == "schema-envelope":
        for name in ("createdAtMs", "latestMigrationAppliedAtMs", "updatedAtMs"):
            _integer(state[name], name)
        version_names = (
            "currentVersion",
            "minReaderVersion",
            "maxReaderVersion",
            "minWriterVersion",
            "maxWriterVersion",
        )
        for name in version_names:
            _integer(state[name], name, 1)
        if any(state[name] != 1 for name in version_names):
            raise ValueError("source schema version must be 1")
        if cast(int, state["updatedAtMs"]) < cast(int, state["createdAtMs"]):
            raise ValueError("schema timestamps are inconsistent")
    elif kind == "migration-lineage":
        version = _integer(state["version"], "version", 1)
        if _integer(state["previousVersion"], "previousVersion") != version - 1:
            raise ValueError("migration lineage is not contiguous")
        _integer(state["appliedAtMs"], "appliedAtMs")
        if state["reversibility"] != "rebuild-from-verified-backup-only":
            raise ValueError("migration reversibility is invalid")
        postconditions = _object(
            state["postconditions"],
            ("requiredPostconditions",),
            "migration postconditions",
        )
        required = postconditions["requiredPostconditions"]
        if (
            type(required) is not list
            or not required
            or any(type(item) is not str or not item for item in required)
        ):
            raise ValueError("requiredPostconditions must be nonempty strings")
    elif kind == "stream-head":
        tail = _integer(state["tailSequence"], "tailSequence", -1)
        tail_hash = _nullable_hash(state["tailRecordHash"], "tailRecordHash")
        if (tail == -1) != (tail_hash is None):
            raise ValueError("stream tail is inconsistent")
        _integer(state["createdAtMs"], "createdAtMs")
        if _integer(state["updatedAtMs"], "updatedAtMs") < cast(int, state["createdAtMs"]):
            raise ValueError("stream timestamps are inconsistent")
    elif kind == "record-identity":
        sequence = _integer(state["sequence"], "sequence")
        previous = _nullable_hash(state["previousRecordHash"], "previousRecordHash")
        if (sequence == 0) != (previous is None):
            raise ValueError("record predecessor is inconsistent")
        value_bytes = _integer(state["valueBytes"], "valueBytes", 1)
        if value_bytes > MAX_RECORD_VALUE_BYTES:
            raise ValueError("valueBytes is outside bounds")
        _hash(state["valueHash"], "valueHash")
        _integer(state["committedAtMs"], "committedAtMs")
    elif kind == "checkpoint-current":
        _hash(state["boundRecordHash"], "boundRecordHash")
        _hash(state["valueHash"], "valueHash")
        for name in ("boundSequence", "committedAtMs"):
            _integer(state[name], name)
        for name in ("checkpointRevision", "valueBytes"):
            _integer(state[name], name, 1)
        if cast(int, state["valueBytes"]) > MAX_CHECKPOINT_VALUE_BYTES:
            raise ValueError("valueBytes is outside bounds")
        _timestamp(state["createdAt"], "createdAt")
        summary = _checkpoint_summary(state["summary"])
        _validate_checkpoint_summary_consistency(summary, state, revision=False)
    elif kind == "checkpoint-revision":
        revision = _integer(state["revision"], "revision", 1)
        _integer(state["recordedAtMs"], "recordedAtMs")
        action = state["action"]
        optional = (
            "boundRecordHash",
            "boundSequence",
            "checkpointCreatedAt",
            "summary",
            "valueBytes",
            "valueHash",
        )
        if action == "put":
            _hash(state["boundRecordHash"], "boundRecordHash")
            _integer(state["boundSequence"], "boundSequence")
            _timestamp(state["checkpointCreatedAt"], "checkpointCreatedAt")
            summary = _checkpoint_summary(state["summary"])
            value_bytes = _integer(state["valueBytes"], "valueBytes", 1)
            if value_bytes > MAX_CHECKPOINT_VALUE_BYTES:
                raise ValueError("valueBytes is outside bounds")
            _hash(state["valueHash"], "valueHash")
            _validate_checkpoint_summary_consistency(summary, state, revision=True)
        elif action == "delete":
            if any(state[name] is not None for name in optional):
                raise ValueError("deleted checkpoint revision payload must be null")
        else:
            raise ValueError("checkpoint revision action is invalid")
        if revision < 1:
            raise AssertionError("unreachable invalid revision")
    elif kind == "lease-current":
        _validate_active_lease_or_lock(state, lease=True)
    elif kind == "used-lease-identity":
        epoch = _integer(state["leaseEpoch"], "leaseEpoch", 1)
        if _integer(state["fencingToken"], "fencingToken", 1) != epoch:
            raise ValueError("used lease fence is inconsistent")
        _integer(state["firstUsedAtMs"], "firstUsedAtMs")
    elif kind == "legal-hold":
        _integer(state["placedAtMs"], "placedAtMs")
    elif kind == "migration-lock-current":
        if state["singleton"] != 1:
            raise ValueError("migration lock singleton is invalid")
        _validate_active_lease_or_lock(state, lease=False)
    elif kind == "used-migration-lock-identity":
        epoch = _integer(state["lockEpoch"], "lockEpoch", 1)
        if _integer(state["fencingToken"], "fencingToken", 1) != epoch:
            raise ValueError("used migration lock fence is inconsistent")
        _integer(state["firstUsedAtMs"], "firstUsedAtMs")
    elif kind == "legacy-operation":
        _integer(state["committedAtMs"], "committedAtMs")
        _string(state["operationName"], "operationName")
        if state["operationName"] not in _MUTATIONS:
            raise ValueError("legacy operation name is invalid")


def _validate_key_state_consistency(
    kind: BaselineEntryKind,
    key: JsonObject,
    state: JsonObject,
) -> None:
    shared_fields: dict[BaselineEntryKind, tuple[str, ...]] = {
        "schema-envelope": (),
        "migration-lineage": ("version",),
        "stream-head": ("streamId", "tenantId"),
        "record-identity": ("recordId", "tenantId"),
        "checkpoint-current": ("checkpointId", "checkpointScope", "tenantId"),
        "checkpoint-revision": ("checkpointScope", "revision", "tenantId"),
        "lease-current": ("streamId", "tenantId"),
        "used-lease-identity": ("leaseId", "streamId", "tenantId"),
        "legal-hold": ("holdId", "streamId", "tenantId"),
        "migration-lock-current": ("singleton",),
        "used-migration-lock-identity": ("lockId",),
        "legacy-operation": ("operationId", "tenantId"),
    }
    if any(key[name] != state[name] for name in shared_fields[kind]):
        raise ValueError("baseline entry key and state disagree")


def _validate_active_lease_or_lock(state: JsonObject, *, lease: bool) -> None:
    prefix = "Lease" if lease else "Lock"
    epoch_name = "activeLeaseEpoch" if lease else "activeLockEpoch"
    last_epoch_name = "lastLeaseEpoch" if lease else "lastLockEpoch"
    identity_names = (
        ("activeLeaseId", "activeHolderId") if lease else ("activeLockId", "activeOwnerId")
    )
    version_names = () if lease else ("activeSourceVersion", "activeTargetVersion")
    active_names = (
        identity_names
        + version_names
        + (
            epoch_name,
            "activeFencingToken",
            "activeAcquiredAtMs",
            "activeExpiresAtMs",
        )
    )
    last_epoch = _integer(state[last_epoch_name], last_epoch_name)
    last_fence = _integer(state["lastFencingToken"], "lastFencingToken")
    if last_epoch != last_fence:
        raise ValueError(f"{prefix.lower()} high-water is inconsistent")
    active = tuple(state[name] for name in active_names)
    if all(value is None for value in active):
        pass
    elif all(value is not None for value in active):
        epoch = _integer(state[epoch_name], epoch_name, 1)
        fence = _integer(state["activeFencingToken"], "activeFencingToken", 1)
        acquired = _integer(state["activeAcquiredAtMs"], "activeAcquiredAtMs")
        expires = _integer(state["activeExpiresAtMs"], "activeExpiresAtMs")
        if epoch != last_epoch or fence != last_fence or expires <= acquired:
            raise ValueError(f"active {prefix.lower()} is inconsistent")
        if not lease:
            source = _integer(state["activeSourceVersion"], "activeSourceVersion", 1)
            target = _integer(state["activeTargetVersion"], "activeTargetVersion", 2)
            if target <= source:
                raise ValueError("migration lock version edge is invalid")
    else:
        raise ValueError(f"active {prefix.lower()} fields must be all null or all present")
    _integer(state["updatedAtMs"], "updatedAtMs")


def capture_baseline_entry(
    kind: BaselineEntryKind,
    key: object,
    state: object,
) -> BaselineEntryInput:
    """Validate, detach, and canonically encode one closed baseline entry."""

    if kind not in _KIND_RANK:
        raise ValueError("baseline entry kind is invalid")
    captured_key = _object(key, _KEY_FIELDS[kind], f"{kind} key")
    captured_state = _object(state, _STATE_FIELDS[kind], f"{kind} state")
    _validate_key(kind, captured_key)
    _validate_state(kind, captured_state)
    _validate_key_state_consistency(kind, captured_key, captured_state)
    key_bytes = canonical_bytes(captured_key)
    state_bytes = canonical_bytes(captured_state)
    if not 2 <= len(key_bytes) <= MAX_BASELINE_KEY_BYTES:
        raise ValueError("baseline entry key exceeds its canonical byte bound")
    if not 2 <= len(state_bytes) <= MAX_BASELINE_STATE_BYTES:
        raise ValueError("baseline entry state exceeds its canonical byte bound")
    return BaselineEntryInput(kind, captured_key, captured_state, key_bytes, state_bytes)


def sort_baseline_entries(entries: Iterable[BaselineEntryInput]) -> tuple[BaselineEntryInput, ...]:
    """Sort by fixed kind rank then unsigned canonical key bytes; reject duplicates."""

    captured = tuple(entries)
    for item in captured:
        if type(item) is not BaselineEntryInput:
            raise TypeError("baseline entry input is invalid")
        validated = capture_baseline_entry(item.entry_kind, item.key, item.state)
        if validated.key_bytes != item.key_bytes or validated.state_bytes != item.state_bytes:
            raise ValueError("baseline entry canonical bytes drifted")
    ordered = tuple(
        sorted(captured, key=lambda item: (_KIND_RANK[item.entry_kind], item.key_bytes))
    )
    for previous, current in pairwise(ordered):
        if previous.entry_kind == current.entry_kind and previous.key_bytes == current.key_bytes:
            raise ValueError("duplicate baseline entry key")
    return ordered


# Baseline accumulators are security boundaries for provider-owned streaming
# reads.  Capture validation once so late module replacement cannot redirect a
# live accumulator after its projection authority was minted.
_CAPTURE_BASELINE_ENTRY_INTRINSIC = capture_baseline_entry


class BaselineAccumulator:
    """Hash an already ordered baseline while retaining constant-sized state.

    ``append`` returns each immutable entry to its caller immediately.  The
    accumulator deliberately does not retain returned entries or state bytes;
    a database migration can therefore persist and release each row before
    requesting the next one.
    """

    __slots__ = (
        "_baseline_id",
        "_count",
        "_expected_entry_count",
        "_finished_result",
        "_first_entry_hash",
        "_last_key_bytes",
        "_last_rank",
        "_legacy_operation_count",
        "_previous_entry_hash",
    )

    def __init__(self, baseline_id: str, expected_entry_count: int) -> None:
        self._baseline_id = _validate_baseline_id(baseline_id)
        if (
            type(expected_entry_count) is not int
            or expected_entry_count < 0
            or expected_entry_count > MAX_SAFE_INTEGER
        ):
            raise ValueError("expected baseline entry count is outside bounds")
        self._expected_entry_count = expected_entry_count
        self._count = 0
        self._legacy_operation_count = 0
        self._first_entry_hash: str | None = None
        self._previous_entry_hash = BASELINE_GENESIS_HASH
        self._last_rank: int | None = None
        self._last_key_bytes: bytes | None = None
        self._finished_result: BaselineProjectionIdentity | None = None

    @property
    def baseline_id(self) -> str:
        """Return the validated baseline identity."""

        return self._baseline_id

    @property
    def expected_entry_count(self) -> int:
        """Return the exact count declared before streaming starts."""

        return self._expected_entry_count

    @property
    def entry_count(self) -> int:
        """Return the number of successfully appended entries."""

        return self._count

    @property
    def legacy_operation_count(self) -> int:
        """Return the number of successfully appended legacy operations."""

        return self._legacy_operation_count

    @property
    def previous_entry_hash(self) -> str:
        """Return the current chain tail, or the genesis hash before entry zero."""

        return self._previous_entry_hash

    @property
    def last_sort_key(self) -> tuple[int, bytes] | None:
        """Return a detached diagnostic copy of the last accepted sort key."""

        if self._last_rank is None or self._last_key_bytes is None:
            return None
        return self._last_rank, bytes(self._last_key_bytes)

    @property
    def is_finished(self) -> bool:
        """Report whether a successful ``finish`` sealed this accumulator."""

        return self._finished_result is not None

    def append(self, item: BaselineEntryInput) -> BaselineEntry:
        """Validate and hash one preordered entry without retaining its state."""

        if self._finished_result is not None:
            raise ValueError("baseline accumulator is already finished")
        if self._count >= self._expected_entry_count:
            raise ValueError("baseline entry count exceeds expected count")
        if type(item) is not BaselineEntryInput:
            raise TypeError("baseline entry input is invalid")

        # Build every candidate value before mutating accumulator state.  This
        # makes validation, ordering, duplicate, and hashing failures atomic.
        validated = _CAPTURE_BASELINE_ENTRY_INTRINSIC(item.entry_kind, item.key, item.state)
        if validated.key_bytes != item.key_bytes or validated.state_bytes != item.state_bytes:
            raise ValueError("baseline entry canonical bytes drifted")
        rank, key_bytes = baseline_entry_sort_key(validated)
        if self._last_rank is not None and self._last_key_bytes is not None:
            if rank < self._last_rank or (
                rank == self._last_rank and key_bytes < self._last_key_bytes
            ):
                raise ValueError("baseline entries are not in canonical order")
            if rank == self._last_rank and key_bytes == self._last_key_bytes:
                raise ValueError("duplicate baseline entry key")

        ordinal = self._count
        previous_hash = self._previous_entry_hash
        entry_hash = _domain_hash(
            BASELINE_ENTRY_DOMAIN,
            {
                "baselineId": self._baseline_id,
                "entryKeySha256": _sha256(key_bytes),
                "entryKind": validated.entry_kind,
                "entryStateSha256": _sha256(validated.state_bytes),
                "ordinal": ordinal,
                "previousEntryHash": previous_hash,
            },
        )
        result = BaselineEntry(
            self._baseline_id,
            validated.entry_kind,
            ordinal,
            bytes(key_bytes),
            bytes(validated.state_bytes),
            previous_hash,
            entry_hash,
        )

        self._count = ordinal + 1
        self._legacy_operation_count += validated.entry_kind == "legacy-operation"
        if self._first_entry_hash is None:
            self._first_entry_hash = entry_hash
        self._previous_entry_hash = entry_hash
        self._last_rank = rank
        self._last_key_bytes = bytes(key_bytes)
        return result

    def finish(self) -> BaselineProjectionIdentity:
        """Seal a complete stream and return its exact projection identity."""

        if self._finished_result is not None:
            return self._finished_result
        if self._count != self._expected_entry_count:
            raise ValueError("baseline entry count is below expected count")
        first_hash = self._first_entry_hash or BASELINE_EMPTY_ROOT
        final_hash = self._previous_entry_hash if self._count else BASELINE_EMPTY_ROOT
        projection_sha256 = _domain_hash(
            BASELINE_PROJECTION_DOMAIN,
            {
                "baselineId": self._baseline_id,
                "entryCount": self._count,
                "finalEntryHash": final_hash,
                "firstEntryHash": first_hash,
                "legacyOperationCount": self._legacy_operation_count,
            },
        )
        result = BaselineProjectionIdentity(
            self._baseline_id,
            self._count,
            self._legacy_operation_count,
            first_hash,
            final_hash,
            projection_sha256,
        )
        self._finished_result = result
        return result


def build_baseline_projection(
    baseline_id: str,
    entries: Iterable[BaselineEntryInput],
) -> BaselineProjection:
    """Sort, assign contiguous ordinals, build the hash chain, and project identity."""

    _validate_baseline_id(baseline_id)
    ordered = sort_baseline_entries(entries)
    accumulator = BaselineAccumulator(baseline_id, len(ordered))
    chained = tuple(accumulator.append(item) for item in ordered)
    completed = accumulator.finish()
    return BaselineProjection(
        completed.baseline_id,
        chained,
        completed.entry_count,
        completed.legacy_operation_count,
        completed.first_entry_hash,
        completed.final_entry_hash,
        completed.projection_sha256,
    )


def baseline_entry_sort_key(entry: BaselineEntryInput) -> tuple[int, bytes]:
    """Expose the protocol sort key for bounded streaming database readers."""

    return _KIND_RANK[entry.entry_kind], entry.key_bytes


def baseline_projection_document(
    projection: BaselineProjection | BaselineProjectionIdentity,
) -> JsonObject:
    """Return the exact closed object hashed as the projection identity."""

    return cast(
        JsonObject,
        {
            "baselineId": projection.baseline_id,
            "entryCount": projection.entry_count,
            "finalEntryHash": projection.final_entry_hash,
            "firstEntryHash": projection.first_entry_hash,
            "legacyOperationCount": projection.legacy_operation_count,
        },
    )


def validate_preordered_baseline_entries(
    entries: Iterable[BaselineEntryInput],
) -> tuple[BaselineEntryInput, ...]:
    """Validate a database streaming order without silently reordering rows."""

    captured = tuple(entries)
    previous: tuple[int, bytes] | None = None
    for item in captured:
        if type(item) is not BaselineEntryInput:
            raise TypeError("baseline entry input is invalid")
        validated = capture_baseline_entry(item.entry_kind, item.key, item.state)
        if validated.key_bytes != item.key_bytes or validated.state_bytes != item.state_bytes:
            raise ValueError("baseline entry canonical bytes drifted")
        current = baseline_entry_sort_key(item)
        if previous is not None and current <= previous:
            if current == previous:
                raise ValueError("duplicate baseline entry key")
            raise ValueError("baseline entries are not in canonical order")
        previous = current
    return captured


def baseline_policy_matches(value: Mapping[str, object]) -> bool:
    """Compare a decoded policy without accepting caller-defined mappings as canonical."""

    try:
        return canonical_bytes(dict(value)) == encode_baseline_policy()
    except Exception:
        return False
