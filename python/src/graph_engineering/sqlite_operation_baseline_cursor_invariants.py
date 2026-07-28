"""Private SQLite v1 cursor immutable-seal primitives.

This module deliberately has no database or migration-stage integration.  It
validates one physical cursor row at a time, discards its raw blobs after
deriving bounded evidence, and streams closed carriers into a constant-space
seal accumulator.  Descriptor and schema identities are receipt bindings, not
immutable seal inputs.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Never, cast

from .canonical import canonical_bytes
from .models import MAX_SAFE_INTEGER, JsonObject, JsonValue
from .portable_json import portable_json_snapshot

SQLITE_CURSOR_SEAL_ALGORITHM_VERSION = "sqlite-cursor-seal/v1"
SQLITE_CURSOR_SEAL_ROW_DOMAIN = b"graph-engineering/sqlite-cursor-seal-row/v1\0"
SQLITE_CURSOR_SEAL_DOMAIN = b"graph-engineering/sqlite-cursor-seal/v1\0"
SQLITE_CURSOR_SEAL_EMPTY_ROOT = hashlib.sha256(
    SQLITE_CURSOR_SEAL_DOMAIN
    + b"\x02"
    + (0).to_bytes(8, "big")
    + hashlib.sha256(SQLITE_CURSOR_SEAL_DOMAIN + b"\x00").digest()
).hexdigest()
SQLITE_CURSOR_REQUEST_SCOPE_MAX_BYTES = 1_048_576
SQLITE_CURSOR_SNAPSHOT_MAX_BYTES = 16_777_216
SQLITE_CURSOR_MAX_COUNT = MAX_SAFE_INTEGER

SQLITE_CURSOR_PHYSICAL_FIELDS: tuple[str, ...] = (
    "tenant_id",
    "token_hash",
    "kind",
    "principal_hash",
    "authorization_hash",
    "stream_id",
    "checkpoint_scope",
    "request_scope_blob",
    "page_size",
    "next_position",
    "snapshot_tail_sequence",
    "snapshot_tail_record_hash",
    "descriptor_hash",
    "schema_identity_sha256",
    "snapshot_blob",
    "created_at_ms",
    "expires_at_ms",
    "consumed_at_ms",
)

SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS: tuple[str, ...] = (
    "tenant_id",
    "token_hash",
    "kind",
    "principal_hash",
    "authorization_hash",
    "stream_id",
    "checkpoint_scope",
    "request_scope_blob",
    "page_size",
    "next_position",
    "snapshot_tail_sequence",
    "snapshot_tail_record_hash",
    "snapshot_blob",
    "created_at_ms",
    "expires_at_ms",
    "consumed_at_ms",
)

SQLITE_CURSOR_MUTABLE_REBIND_FIELDS: tuple[str, ...] = (
    "descriptor_hash",
    "schema_identity_sha256",
)

SQLITE_CURSOR_SEAL_CARRIER_FIELDS: tuple[str, ...] = (
    "authorizationHash",
    "checkpointScope",
    "consumedAtMs",
    "createdAtMs",
    "expiresAtMs",
    "kind",
    "nextPosition",
    "pageSize",
    "principalHash",
    "requestScopeBlobSha256",
    "requestScopeByteLength",
    "snapshotBlobSha256",
    "snapshotByteLength",
    "snapshotTailRecordHash",
    "snapshotTailSequence",
    "streamId",
    "tenantId",
    "tokenHash",
)

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_HASH = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True, weakref_slot=True)
class SQLiteCursorImmutableSealCarrier:
    """Closed immutable carrier for one validated cursor row."""

    tenant_id: str
    token_hash: str
    kind: str
    principal_hash: str
    authorization_hash: str
    stream_id: str | None
    checkpoint_scope: str | None
    request_scope_byte_length: int
    request_scope_blob_sha256: str
    page_size: int
    next_position: int
    snapshot_tail_sequence: int | None
    snapshot_tail_record_hash: str | None
    snapshot_byte_length: int
    snapshot_blob_sha256: str
    created_at_ms: int
    expires_at_ms: int
    consumed_at_ms: int | None


@dataclass(frozen=True, slots=True, weakref_slot=True)
class SQLiteCursorSealRow:
    """One carrier plus the independently validated mutable identities."""

    carrier: SQLiteCursorImmutableSealCarrier
    descriptor_hash: str
    schema_identity_sha256: str


@dataclass(frozen=True, slots=True)
class SQLiteCursorImmutableSealReceipt:
    """Frozen seal plus the separately bound source identities."""

    cursor_count: int
    immutable_root_sha256: str
    source_descriptor_hash: str
    source_schema_identity_sha256: str


def _identifier(value: object) -> str:
    if type(value) is not str or _IDENTIFIER.fullmatch(value) is None or value in {".", ".."}:
        raise ValueError("cursor row identifier is invalid")
    return value


def _nullable_identifier(value: object) -> str | None:
    return None if value is None else _identifier(value)


def _hash(value: object) -> str:
    if type(value) is not str or _HASH.fullmatch(value) is None:
        raise ValueError("cursor row hash is invalid")
    return value


def _nullable_hash(value: object) -> str | None:
    return None if value is None else _hash(value)


def _integer(value: object, minimum: int, maximum: int) -> int:
    if type(value) is not int or value < minimum or value > maximum:
        raise ValueError("cursor row integer is outside bounds")
    return value


def _reject_duplicate_object(pairs: list[tuple[str, JsonValue]]) -> JsonObject:
    result: JsonObject = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _reject_json_constant(_token: str) -> Never:
    raise ValueError("invalid JSON constant")


def _decode_canonical_blob(value: object, maximum_bytes: int) -> bytes:
    try:
        if (
            type(value) is not bytes
            or not 2 <= len(value) <= maximum_bytes
            or value.startswith(b"\xef\xbb\xbf")
        ):
            raise ValueError("canonical blob is outside bounds")
        decoded = cast(
            object,
            json.loads(
                value.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_object,
                parse_constant=_reject_json_constant,
            ),
        )
        captured = portable_json_snapshot(decoded)
        if canonical_bytes(captured) != value:
            raise ValueError("canonical blob identity drifted")
        return value
    except Exception as exc:
        raise ValueError("cursor row canonical blob is invalid") from exc


def decode_sqlite_v1_cursor_seal_row(row: object) -> SQLiteCursorSealRow:
    """Decode exactly one physical v1 cursor row into a blob-free seal row."""

    if type(row) is not tuple or len(row) != len(SQLITE_CURSOR_PHYSICAL_FIELDS):
        raise ValueError("cursor row physical shape is invalid")

    tenant_id = _identifier(row[0])
    token_hash = _hash(row[1])
    kind = row[2]
    if kind not in ("event", "checkpoint"):
        raise ValueError("cursor row kind is invalid")
    principal_hash = _hash(row[3])
    authorization_hash = _hash(row[4])
    stream_id = _nullable_identifier(row[5])
    checkpoint_scope = _nullable_identifier(row[6])
    request_scope_blob = _decode_canonical_blob(row[7], SQLITE_CURSOR_REQUEST_SCOPE_MAX_BYTES)
    page_size = _integer(row[8], 1, 256)
    next_position = _integer(row[9], 0, MAX_SAFE_INTEGER)
    tail_sequence = None if row[10] is None else _integer(row[10], -1, MAX_SAFE_INTEGER)
    tail_hash = _nullable_hash(row[11])
    descriptor_hash = _hash(row[12])
    schema_identity_sha256 = _hash(row[13])
    snapshot_blob = _decode_canonical_blob(row[14], SQLITE_CURSOR_SNAPSHOT_MAX_BYTES)
    created_at_ms = _integer(row[15], 0, MAX_SAFE_INTEGER)
    expires_at_ms = _integer(row[16], 0, MAX_SAFE_INTEGER)
    consumed_at_ms = None if row[17] is None else _integer(row[17], 0, MAX_SAFE_INTEGER)
    if expires_at_ms <= created_at_ms or (
        consumed_at_ms is not None and consumed_at_ms < created_at_ms
    ):
        raise ValueError("cursor row clock interval is invalid")

    if kind == "event":
        if stream_id is None or checkpoint_scope is not None or tail_sequence is None:
            raise ValueError("cursor row event scope is invalid")
        if tail_sequence == -1:
            if tail_hash is not None:
                raise ValueError("cursor row empty event snapshot is inconsistent")
        elif tail_hash is None:
            raise ValueError("cursor row event snapshot is inconsistent")
    else:
        if (
            stream_id is not None
            or checkpoint_scope is None
            or tail_sequence is not None
            or tail_hash is not None
        ):
            raise ValueError("cursor row checkpoint scope is invalid")

    carrier = SQLiteCursorImmutableSealCarrier(
        tenant_id=tenant_id,
        token_hash=token_hash,
        kind=kind,
        principal_hash=principal_hash,
        authorization_hash=authorization_hash,
        stream_id=stream_id,
        checkpoint_scope=checkpoint_scope,
        request_scope_byte_length=len(request_scope_blob),
        request_scope_blob_sha256=hashlib.sha256(request_scope_blob).hexdigest(),
        page_size=page_size,
        next_position=next_position,
        snapshot_tail_sequence=tail_sequence,
        snapshot_tail_record_hash=tail_hash,
        snapshot_byte_length=len(snapshot_blob),
        snapshot_blob_sha256=hashlib.sha256(snapshot_blob).hexdigest(),
        created_at_ms=created_at_ms,
        expires_at_ms=expires_at_ms,
        consumed_at_ms=consumed_at_ms,
    )
    return SQLiteCursorSealRow(carrier, descriptor_hash, schema_identity_sha256)


def _validate_cursor_seal_carrier(
    carrier: SQLiteCursorImmutableSealCarrier,
) -> SQLiteCursorImmutableSealCarrier:
    if type(carrier) is not SQLiteCursorImmutableSealCarrier:
        raise TypeError("cursor seal carrier is invalid")
    _identifier(carrier.tenant_id)
    _hash(carrier.token_hash)
    if carrier.kind not in ("event", "checkpoint"):
        raise ValueError("cursor row kind is invalid")
    _hash(carrier.principal_hash)
    _hash(carrier.authorization_hash)
    stream_id = _nullable_identifier(carrier.stream_id)
    checkpoint_scope = _nullable_identifier(carrier.checkpoint_scope)
    _integer(
        carrier.request_scope_byte_length,
        2,
        SQLITE_CURSOR_REQUEST_SCOPE_MAX_BYTES,
    )
    _hash(carrier.request_scope_blob_sha256)
    _integer(carrier.page_size, 1, 256)
    _integer(carrier.next_position, 0, MAX_SAFE_INTEGER)
    tail_sequence = (
        None
        if carrier.snapshot_tail_sequence is None
        else _integer(carrier.snapshot_tail_sequence, -1, MAX_SAFE_INTEGER)
    )
    tail_hash = _nullable_hash(carrier.snapshot_tail_record_hash)
    _integer(carrier.snapshot_byte_length, 2, SQLITE_CURSOR_SNAPSHOT_MAX_BYTES)
    _hash(carrier.snapshot_blob_sha256)
    created_at_ms = _integer(carrier.created_at_ms, 0, MAX_SAFE_INTEGER)
    expires_at_ms = _integer(carrier.expires_at_ms, 0, MAX_SAFE_INTEGER)
    consumed_at_ms = (
        None
        if carrier.consumed_at_ms is None
        else _integer(carrier.consumed_at_ms, 0, MAX_SAFE_INTEGER)
    )
    if expires_at_ms <= created_at_ms or (
        consumed_at_ms is not None and consumed_at_ms < created_at_ms
    ):
        raise ValueError("cursor row clock interval is invalid")
    if carrier.kind == "event":
        if stream_id is None or checkpoint_scope is not None or tail_sequence is None:
            raise ValueError("cursor row event scope is invalid")
        if (tail_sequence == -1 and tail_hash is not None) or (
            tail_sequence >= 0 and tail_hash is None
        ):
            raise ValueError("cursor row event snapshot is inconsistent")
    elif (
        stream_id is not None
        or checkpoint_scope is None
        or tail_sequence is not None
        or tail_hash is not None
    ):
        raise ValueError("cursor row checkpoint scope is invalid")
    return carrier


def sqlite_cursor_seal_carrier_document(
    carrier: SQLiteCursorImmutableSealCarrier,
) -> JsonObject:
    """Return the closed cross-language canonical carrier document."""

    carrier = _validate_cursor_seal_carrier(carrier)
    return cast(
        JsonObject,
        {
            "authorizationHash": carrier.authorization_hash,
            "checkpointScope": carrier.checkpoint_scope,
            "consumedAtMs": carrier.consumed_at_ms,
            "createdAtMs": carrier.created_at_ms,
            "expiresAtMs": carrier.expires_at_ms,
            "kind": carrier.kind,
            "nextPosition": carrier.next_position,
            "pageSize": carrier.page_size,
            "principalHash": carrier.principal_hash,
            "requestScopeBlobSha256": carrier.request_scope_blob_sha256,
            "requestScopeByteLength": carrier.request_scope_byte_length,
            "snapshotBlobSha256": carrier.snapshot_blob_sha256,
            "snapshotByteLength": carrier.snapshot_byte_length,
            "snapshotTailRecordHash": carrier.snapshot_tail_record_hash,
            "snapshotTailSequence": carrier.snapshot_tail_sequence,
            "streamId": carrier.stream_id,
            "tenantId": carrier.tenant_id,
            "tokenHash": carrier.token_hash,
        },
    )


def sqlite_cursor_seal_row_digest(carrier: SQLiteCursorImmutableSealCarrier) -> bytes:
    """Hash one carrier with the frozen row domain and length framing."""

    encoded = canonical_bytes(sqlite_cursor_seal_carrier_document(carrier))
    return hashlib.sha256(
        SQLITE_CURSOR_SEAL_ROW_DOMAIN + len(encoded).to_bytes(8, "big") + encoded
    ).digest()


class SQLiteCursorSealAccumulator:
    """Stream preordered cursor seal rows while retaining constant-sized state."""

    __slots__ = (
        "_count",
        "_expected_count",
        "_finished",
        "_last_tenant_bytes",
        "_last_token_bytes",
        "_source_descriptor_hash",
        "_source_schema_identity_sha256",
        "_state",
    )

    def __init__(
        self,
        expected_count: int,
        source_descriptor_hash: str,
        source_schema_identity_sha256: str,
    ) -> None:
        self._expected_count = _integer(expected_count, 0, SQLITE_CURSOR_MAX_COUNT)
        self._source_descriptor_hash = _hash(source_descriptor_hash)
        self._source_schema_identity_sha256 = _hash(source_schema_identity_sha256)
        self._count = 0
        self._state = hashlib.sha256(SQLITE_CURSOR_SEAL_DOMAIN + b"\x00").digest()
        self._last_token_bytes: bytes | None = None
        self._last_tenant_bytes: bytes | None = None
        self._finished = False

    @property
    def cursor_count(self) -> int:
        return self._count

    @property
    def chain_state(self) -> bytes:
        return bytes(self._state)

    @property
    def last_sort_key(self) -> tuple[bytes, bytes] | None:
        if self._last_token_bytes is None or self._last_tenant_bytes is None:
            return None
        return bytes(self._last_token_bytes), bytes(self._last_tenant_bytes)

    @property
    def is_finished(self) -> bool:
        return self._finished

    def append(self, row: SQLiteCursorSealRow) -> None:
        """Validate and append one source-bound row atomically in byte order."""

        if self._finished:
            raise ValueError("cursor seal accumulator is already finished")
        if self._count >= self._expected_count:
            raise ValueError("cursor seal row count exceeds expected count")
        if not isinstance(row, SQLiteCursorSealRow):
            raise TypeError("cursor seal row is invalid")
        if (
            _hash(row.descriptor_hash) != self._source_descriptor_hash
            or _hash(row.schema_identity_sha256) != self._source_schema_identity_sha256
        ):
            raise ValueError("cursor seal mutable identity is inconsistent")
        carrier = _validate_cursor_seal_carrier(row.carrier)

        # Compute and validate every candidate before committing state.  A
        # rejected append therefore cannot advance the chain or sort cursor.
        token_bytes = carrier.token_hash.encode("utf-8")
        tenant_bytes = carrier.tenant_id.encode("utf-8")
        if self._last_token_bytes is not None and self._last_tenant_bytes is not None:
            current_key = (token_bytes, tenant_bytes)
            previous_key = (self._last_token_bytes, self._last_tenant_bytes)
            if current_key == previous_key:
                raise ValueError("duplicate cursor seal sort key")
            if current_key < previous_key:
                raise ValueError("cursor seal rows are outside canonical order")
        row_digest = sqlite_cursor_seal_row_digest(carrier)
        next_count = self._count + 1
        next_state = hashlib.sha256(
            SQLITE_CURSOR_SEAL_DOMAIN
            + b"\x01"
            + self._state
            + next_count.to_bytes(8, "big")
            + row_digest
        ).digest()

        self._count = next_count
        self._state = next_state
        self._last_token_bytes = token_bytes
        self._last_tenant_bytes = tenant_bytes

    def finish(self) -> SQLiteCursorImmutableSealReceipt:
        """Finish exactly once and return a frozen immutable-seal receipt."""

        if self._finished:
            raise ValueError("cursor seal accumulator is already finished")
        if self._count != self._expected_count:
            raise ValueError("cursor seal row count is below expected count")
        immutable_root = hashlib.sha256(
            SQLITE_CURSOR_SEAL_DOMAIN + b"\x02" + self._count.to_bytes(8, "big") + self._state
        ).hexdigest()
        receipt = SQLiteCursorImmutableSealReceipt(
            cursor_count=self._count,
            immutable_root_sha256=immutable_root,
            source_descriptor_hash=self._source_descriptor_hash,
            source_schema_identity_sha256=self._source_schema_identity_sha256,
        )
        self._finished = True
        return receipt


def seal_sqlite_v1_cursor_rows(
    rows: Iterable[object],
    *,
    expected_count: int,
    source_descriptor_hash: str,
    source_schema_identity_sha256: str,
) -> SQLiteCursorImmutableSealReceipt:
    """Decode and seal a one-pass iterable without proportional row capture."""

    accumulator = SQLiteCursorSealAccumulator(
        expected_count,
        source_descriptor_hash,
        source_schema_identity_sha256,
    )
    for physical_row in rows:
        decoded = decode_sqlite_v1_cursor_seal_row(physical_row)
        accumulator.append(decoded)
        del decoded
    return accumulator.finish()
