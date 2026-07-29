"""Private tolerant inspection for SQLite v1 cursor pre-rebind campaigns.

Unlike the A1 seal decoder, this module never turns a tenant-row defect into
an exception.  It derives the nine independent B2 rule flags, retains only
bounded scalar/digest evidence for TEMP staging, and calls the strict A1
decoder only after every rule prerequisite has succeeded.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Never, cast

from .canonical import canonical_bytes
from .cycle_store_provider import (
    CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
    cycle_store_adapter_codec,
)
from .models import MAX_SAFE_INTEGER, JsonObject, JsonValue
from .portable_json import portable_json_snapshot
from .sqlite_operation_baseline_cursor_invariants import (
    SQLITE_CURSOR_PHYSICAL_FIELDS,
    SQLITE_CURSOR_REQUEST_SCOPE_MAX_BYTES,
    SQLITE_CURSOR_SNAPSHOT_MAX_BYTES,
    SQLiteCursorSealRow,
    decode_sqlite_v1_cursor_seal_row,
)

_HASH = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SENTINEL_DOMAIN = b"graph-engineering/sqlite-cursor-inspection-sentinel/v1\0"


@dataclass(frozen=True, slots=True)
class _CanonicalBlob:
    byte_length: int
    sha256: str
    decoded: JsonValue


@dataclass(frozen=True, slots=True)
class _SQLiteCursorRowInspection:
    """Closed, blob-free evidence for one physical source row."""

    staged_values: tuple[object, ...]
    stageable: bool
    source_key_storage_ok: bool
    authorization_ok: bool
    scope_ok: bool
    blobs_canonical_ok: bool
    position_ok: bool
    clock_ok: bool
    catalog_ok: bool
    shape_ok: bool
    event_binding_ok: bool
    checkpoint_binding_ok: bool
    seal_row: SQLiteCursorSealRow | None

    @property
    def rule_flags(self) -> tuple[bool, ...]:
        return (
            self.authorization_ok,
            self.scope_ok,
            self.blobs_canonical_ok,
            self.position_ok,
            self.clock_ok,
            self.catalog_ok,
            self.shape_ok,
            self.event_binding_ok,
            self.checkpoint_binding_ok,
        )

    @property
    def seal_eligible(self) -> bool:
        return self.seal_row is not None and all(self.rule_flags)

    @property
    def insert_values(self) -> tuple[object, ...]:
        """Return the exact 30-column B1 TEMP-table insert tuple."""

        return (
            *self.staged_values,
            *(1 if flag else 0 for flag in self.rule_flags),
            1 if self.seal_eligible else 0,
        )


def _reject_duplicate_object(pairs: list[tuple[str, JsonValue]]) -> JsonObject:
    result: JsonObject = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _reject_json_constant(_token: str) -> Never:
    raise ValueError("invalid JSON constant")


def _canonical_blob(value: object, maximum_bytes: int) -> _CanonicalBlob | None:
    if type(value) is not bytes or not 2 <= len(value) <= maximum_bytes:
        return None
    if value.startswith(b"\xef\xbb\xbf"):
        return None
    try:
        decoded = cast(
            JsonValue,
            json.loads(
                value.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_object,
                parse_constant=_reject_json_constant,
            ),
        )
        captured = portable_json_snapshot(decoded)
        if canonical_bytes(captured) != value:
            return None
        return _CanonicalBlob(len(value), hashlib.sha256(value).hexdigest(), captured)
    except Exception:
        return None


def _safe_integer(value: object, minimum: int = 0) -> bool:
    return type(value) is int and minimum <= value <= MAX_SAFE_INTEGER


def _nullable_safe_integer(value: object, minimum: int = 0) -> bool:
    return value is None or _safe_integer(value, minimum)


def _valid_identifier(value: object) -> bool:
    return (
        type(value) is str and _IDENTIFIER.fullmatch(value) is not None and value not in {".", ".."}
    )


def _valid_hash(value: object) -> bool:
    return type(value) is str and _HASH.fullmatch(value) is not None


def _sentinel_hash(source_ordinal: int, field: str) -> str:
    frame = f"{source_ordinal}:{field}".encode("ascii")
    return hashlib.sha256(_SENTINEL_DOMAIN + frame).hexdigest()


def _sentinel_identifier(source_ordinal: int, field: str) -> str:
    # ``!`` is outside the legal main-table identifier alphabet. TEMP accepts
    # arbitrary TEXT, so a legal tenant can never preoccupy this namespace;
    # the source ordinal then makes every invalid identifier mapping unique.
    return f"!ge-invalid-{source_ordinal}-{field}"


def _sentinel_token(source_ordinal: int) -> str:
    # Main token hashes are exactly 64 lowercase hexadecimal characters.  The
    # TEMP table deliberately has no hash CHECK because diagnosed rows must be
    # stageable, so keep invalid tokens in a namespace that no valid main token
    # can occupy.  The ordinal prevents two hostile rows for one tenant from
    # colliding with each other in the composite TEMP primary key.
    return f"!ge-invalid-token-{source_ordinal}"


def _integer_or(value: object, fallback: int, minimum: int = 0) -> int:
    return cast(int, value) if _safe_integer(value, minimum) else fallback


def _nullable_integer_or(value: object, fallback: int, minimum: int = 0) -> int | None:
    if value is None:
        return None
    return cast(int, value) if _safe_integer(value, minimum) else fallback


def _exact_document(value: JsonValue, expected: JsonValue) -> bool:
    try:
        return canonical_bytes(value) == canonical_bytes(expected)
    except Exception:
        return False


def _checkpoint_precedes(left: JsonObject, right: JsonObject) -> bool:
    """Return whether left strictly precedes right in the frozen B2 order."""

    left_sequence = cast(int, left["boundSequence"])
    right_sequence = cast(int, right["boundSequence"])
    if left_sequence != right_sequence:
        return left_sequence > right_sequence
    left_created = cast(str, left["createdAt"])
    right_created = cast(str, right["createdAt"])
    if left_created != right_created:
        return left_created > right_created
    return cast(str, left["checkpointId"]).encode() < cast(str, right["checkpointId"]).encode()


def _inspect_sqlite_v1_cursor_row(
    row: object,
    *,
    source_ordinal: int,
    source_descriptor_hash: str,
    source_schema_identity_sha256: str,
    provider_high_water_at_ms: int,
    event_tail_exists: Callable[[str, str, int, str], bool],
    checkpoint_revision_exists: Callable[[str, str, str, bytes], bool],
) -> _SQLiteCursorRowInspection:
    """Inspect one source row without retaining raw BLOB or decoded snapshots."""

    if type(source_ordinal) is not int or source_ordinal < 0:
        raise ValueError("cursor source ordinal is invalid")
    physical = row if type(row) is tuple else ()
    arity_ok = len(physical) == len(SQLITE_CURSOR_PHYSICAL_FIELDS)
    values = tuple(physical[index] if index < len(physical) else None for index in range(18))

    tenant_value, token_value, kind_value = values[0], values[1], values[2]
    principal_value, authorization_value = values[3], values[4]
    stream_value, checkpoint_value = values[5], values[6]
    request_value, snapshot_value = values[7], values[14]

    tenant_ok = _valid_identifier(tenant_value)
    token_ok = _valid_hash(token_value)
    authorization_storage_ok = arity_ok and all(
        type(value) is str
        for value in (tenant_value, token_value, principal_value, authorization_value)
    )
    authorization_ok = not authorization_storage_ok or (
        tenant_ok and token_ok and _valid_hash(principal_value) and _valid_hash(authorization_value)
    )
    # Lexically invalid but bounded TEXT keys are still exact source identities
    # and remain unique under the source table's primary key.  Only rows that
    # cannot supply such a key use the campaign's bounded pre-stage counters.
    stageable = arity_ok and type(tenant_value) is str and type(token_value) is str
    source_key_storage_ok = type(tenant_value) is str and type(token_value) is str

    request_blob = _canonical_blob(request_value, SQLITE_CURSOR_REQUEST_SCOPE_MAX_BYTES)
    snapshot_blob = _canonical_blob(snapshot_value, SQLITE_CURSOR_SNAPSHOT_MAX_BYTES)
    blob_storage_ok = arity_ok and type(request_value) is bytes and type(snapshot_value) is bytes
    blobs_canonical_ok = not blob_storage_ok or (
        request_blob is not None and snapshot_blob is not None
    )

    page_ok = _safe_integer(values[8], 1) and cast(int, values[8]) <= 256
    next_ok = _safe_integer(values[9])
    tail_sequence_ok = _nullable_safe_integer(values[10], -1)
    created_ok = _safe_integer(values[15])
    expires_ok = _safe_integer(values[16])
    consumed_ok = _nullable_safe_integer(values[17])

    storage_ok = (
        arity_ok
        and all(type(values[index]) is str for index in range(5))
        and (values[5] is None or type(values[5]) is str)
        and (values[6] is None or type(values[6]) is str)
        and type(values[7]) is bytes
        and type(values[8]) is int
        and type(values[9]) is int
        and (values[10] is None or type(values[10]) is int)
        and (values[11] is None or type(values[11]) is str)
        and type(values[12]) is str
        and type(values[13]) is str
        and type(values[14]) is bytes
        and type(values[15]) is int
        and type(values[16]) is int
        and (values[17] is None or type(values[17]) is int)
    )

    kind = values[2] if type(values[2]) is str else ""
    stream_id = values[5] if type(values[5]) is str else None
    checkpoint_scope = values[6] if type(values[6]) is str else None
    page_size = values[8] if page_ok else 1
    next_position = values[9] if next_ok else 0
    tail_sequence = values[10] if tail_sequence_ok else None
    tail_hash = values[11] if type(values[11]) is str else None

    scope_storage_ok = (
        arity_ok
        and type(values[2]) is str
        and (values[5] is None or type(values[5]) is str)
        and (values[6] is None or type(values[6]) is str)
        and type(values[7]) is bytes
        and type(values[8]) is int
    )
    if not scope_storage_ok:
        scope_ok = True
        expected_scope: JsonValue = {}
    elif kind == "event":
        scope_ok = _valid_identifier(stream_id) and values[6] is None
        expected_scope = {
            "contractVersion": CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
            "pageSize": page_size,
            "streamId": stream_id,
        }
    elif kind == "checkpoint":
        scope_ok = values[5] is None and _valid_identifier(checkpoint_scope)
        expected_scope = {
            "checkpointScope": checkpoint_scope,
            "contractVersion": CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
            "pageSize": page_size,
        }
    else:
        scope_ok = False
        expected_scope = {}
    if scope_storage_ok and request_blob is not None and page_ok:
        scope_ok = scope_ok and _exact_document(request_blob.decoded, expected_scope)

    position_storage_ok = (
        arity_ok
        and type(values[2]) is str
        and type(values[8]) is int
        and type(values[9]) is int
        and (values[10] is None or type(values[10]) is int)
        and (values[11] is None or type(values[11]) is str)
        and type(values[14]) is bytes
    )
    position_ok = not position_storage_ok or (page_ok and next_ok)
    if kind == "event" and position_storage_ok:
        position_ok = position_ok and tail_sequence_ok and tail_sequence is not None
    event_binding_ok = True
    checkpoint_binding_ok = True

    # Rule 3 owns an uninspectable snapshot BLOB; Rule 9 stays
    # non-cascading until canonical snapshot evidence exists.
    if (
        kind == "event"
        and position_storage_ok
        and snapshot_blob is not None
        and tail_sequence_ok
        and tail_sequence is not None
        and tenant_ok
        and _valid_identifier(stream_id)
    ):
        tail_tuple_ok = tail_hash is None if tail_sequence == -1 else _valid_hash(tail_hash)
        expected_tail: JsonValue = {
            "exists": tail_sequence != -1,
            "recordHash": tail_hash,
            "sequence": tail_sequence,
        }
        event_binding_ok = tail_tuple_ok and _exact_document(snapshot_blob.decoded, expected_tail)
        if tail_sequence == -1:
            position_ok = position_ok and next_position == 0
        else:
            position_ok = position_ok and next_position <= tail_sequence
            if event_binding_ok and stream_id is not None and tail_hash is not None:
                event_binding_ok = bool(
                    event_tail_exists(cast(str, tenant_value), stream_id, tail_sequence, tail_hash)
                )

    if kind == "checkpoint" and tenant_ok and _valid_identifier(checkpoint_scope):
        # As above, an invalid BLOB is Rule 3 only.  A canonical non-list or a
        # bad summary/history binding is owned by Rule 10.
        if snapshot_blob is not None and type(snapshot_blob.decoded) is list:
            snapshot_items = snapshot_blob.decoded
            position_ok = position_ok and cast(int, next_position) <= len(snapshot_items)
            checkpoint_binding_ok = True
            previous: JsonObject | None = None
            for item in snapshot_items:
                try:
                    encoded_item = canonical_bytes(item)
                    summary = cast(
                        JsonObject,
                        cycle_store_adapter_codec.decode_ledger_result(
                            "save-checkpoint", encoded_item
                        ),
                    )
                    encoded_summary = cycle_store_adapter_codec.encode_ledger_result(
                        "save-checkpoint", summary
                    )
                    if encoded_summary != encoded_item:
                        raise ValueError("checkpoint summary identity drifted")
                    if (
                        summary["checkpointScope"] != checkpoint_scope
                        or (previous is not None and not _checkpoint_precedes(previous, summary))
                        or not checkpoint_revision_exists(
                            cast(str, tenant_value),
                            cast(str, checkpoint_scope),
                            cast(str, summary["checkpointId"]),
                            encoded_summary,
                        )
                    ):
                        checkpoint_binding_ok = False
                    previous = summary
                except Exception:
                    checkpoint_binding_ok = False
                    break
        elif snapshot_blob is not None:
            checkpoint_binding_ok = False

    clock_storage_ok = (
        arity_ok
        and type(values[15]) is int
        and type(values[16]) is int
        and (values[17] is None or type(values[17]) is int)
    )
    clock_ok = not clock_storage_ok or (
        created_ok
        and expires_ok
        and consumed_ok
        and cast(int, values[16]) > cast(int, values[15])
        and (values[17] is None or cast(int, values[17]) >= cast(int, values[15]))
        and cast(int, values[15]) <= provider_high_water_at_ms
        and (values[17] is None or cast(int, values[17]) <= provider_high_water_at_ms)
    )
    catalog_storage_ok = arity_ok and type(values[12]) is str and type(values[13]) is str
    catalog_ok = not catalog_storage_ok or (
        values[12] == source_descriptor_hash and values[13] == source_schema_identity_sha256
    )
    shape_ok = storage_ok

    if not arity_ok:
        authorization_ok = True
        scope_ok = True
        blobs_canonical_ok = True
        position_ok = True
        clock_ok = True
        catalog_ok = True
        event_binding_ok = True
        checkpoint_binding_ok = True

    placeholder_tenant = _sentinel_identifier(source_ordinal, "tenant")
    placeholder_token = _sentinel_token(source_ordinal)
    request_bytes = request_value if type(request_value) is bytes else b""
    snapshot_bytes = snapshot_value if type(snapshot_value) is bytes else b""
    staged_values: tuple[object, ...] = (
        token_value if token_ok else placeholder_token,
        tenant_value if tenant_ok else placeholder_tenant,
        kind_value if kind_value in {"event", "checkpoint"} else "event",
        principal_value
        if _valid_hash(principal_value)
        else _sentinel_hash(source_ordinal, "principal"),
        authorization_value
        if _valid_hash(authorization_value)
        else _sentinel_hash(source_ordinal, "authorization"),
        stream_value
        if stream_value is None or _valid_identifier(stream_value)
        else _sentinel_identifier(source_ordinal, "stream"),
        checkpoint_value
        if checkpoint_value is None or _valid_identifier(checkpoint_value)
        else _sentinel_identifier(source_ordinal, "checkpoint"),
        len(request_bytes),
        hashlib.sha256(request_bytes).hexdigest(),
        _integer_or(values[8], 1, 1),
        _integer_or(values[9], 0),
        _nullable_integer_or(values[10], -1, -1),
        values[11]
        if values[11] is None or _valid_hash(values[11])
        else _sentinel_hash(source_ordinal, "tail"),
        len(snapshot_bytes),
        hashlib.sha256(snapshot_bytes).hexdigest(),
        _integer_or(values[15], 0),
        _integer_or(values[16], 1),
        _nullable_integer_or(values[17], 0),
        values[12] if _valid_hash(values[12]) else _sentinel_hash(source_ordinal, "descriptor"),
        values[13] if _valid_hash(values[13]) else _sentinel_hash(source_ordinal, "schema"),
    )

    flags = (
        authorization_ok,
        scope_ok,
        blobs_canonical_ok,
        position_ok,
        clock_ok,
        catalog_ok,
        shape_ok,
        event_binding_ok,
        checkpoint_binding_ok,
    )
    seal_row: SQLiteCursorSealRow | None = None
    if all(flags):
        try:
            seal_row = decode_sqlite_v1_cursor_seal_row(physical)
        except Exception:
            shape_ok = False

    return _SQLiteCursorRowInspection(
        staged_values=staged_values,
        stageable=stageable,
        source_key_storage_ok=source_key_storage_ok,
        authorization_ok=authorization_ok,
        scope_ok=scope_ok,
        blobs_canonical_ok=blobs_canonical_ok,
        position_ok=position_ok,
        clock_ok=clock_ok,
        catalog_ok=catalog_ok,
        shape_ok=shape_ok,
        event_binding_ok=event_binding_ok,
        checkpoint_binding_ok=checkpoint_binding_ok,
        seal_row=seal_row,
    )
