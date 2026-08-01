"""Package-private B3 target physical-catalog observation and validation."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Final, NamedTuple, NoReturn, Protocol, TypeVar

from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    _SQLiteCursorCapability,
)

SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY: Final = (
    "SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema "
    "WHERE lower(name) GLOB 'ge_cycle_*' AND sql IS NOT NULL "
    "ORDER BY type COLLATE BINARY, name COLLATE BINARY"
)
SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256: Final = (
    "bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c"
)
SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8: Final = (
    "graph-engineering/sqlite-target-physical-catalog/v1\0"
)
SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES: Final = 5_785
SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT: Final = 34
SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256: Final = (
    "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf"
)
SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID: Final = 1_195_724_359
SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION: Final = 2


class _TargetDescriptor(NamedTuple):
    """Tuple-backed descriptor whose fields resist ``object.__setattr__``."""

    schema_version: int
    descriptor_hash: str
    descriptor_body_sha256: str
    descriptor_canonical_sha256: str
    schema_identity_sha256: str


SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR: Final = _TargetDescriptor(
    schema_version=2,
    descriptor_hash="f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92",
    descriptor_body_sha256=("7bb784e57922facd28034dfdd504b37bd60c89e6c09fcd0d3f9adabb8456e214"),
    descriptor_canonical_sha256=(
        "27cfd73833b3a8ff29f0b33d2a73a51d1409b40a07e62c96ec4d9910a705a7d9"
    ),
    schema_identity_sha256=("9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634"),
)

SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY: Final = (
    "index:ge_cycle_checkpoint_revisions_lookup_idx:ge_cycle_checkpoint_revisions:"
    "9e51c4c421ba6a66fd3bdced00ef64173635c35cff91bf4609d4e424c75c10d4",
    "index:ge_cycle_checkpoints_order_idx:ge_cycle_checkpoints:"
    "76364679ad3068fa3b6a7b675f999917cdb517c2d77a8d6b679986c2e175122e",
    "index:ge_cycle_cursors_expiry_idx:ge_cycle_cursors:"
    "974a760be2f7fb492447c021dbdc86bc82f26abb07c6238892143087efa72f2a",
    "index:ge_cycle_cursors_open_idx:ge_cycle_cursors:"
    "1699d5eb1866230afd3604569e85294b67bef6eab73d854444a8da9ba1fb5fea",
    "index:ge_cycle_holds_lookup_idx:ge_cycle_legal_holds:"
    "55f4107f5a881ba5bc5c385feeffc26baf337814877d77d7fde894661b678b59",
    "index:ge_cycle_leases_expiry_idx:ge_cycle_leases:"
    "c1327bb8445d47494c87ae11f02cb7d03ad3d4f7dc432125053bd4ab9711b4e3",
    "index:ge_cycle_operation_baseline_entries_hash_uq:ge_cycle_operation_baseline_entries:"
    "dfccdf277787c39ea7434cb62f3ecb566200748f53e89faa07fd43c4d50ca64a",
    "index:ge_cycle_operation_baseline_entries_key_uq:ge_cycle_operation_baseline_entries:"
    "f67c4c3c8d26aee7ab355066c973ded45098bca135ad8f6329a1b0094f0e19e1",
    "index:ge_cycle_operations_commit_idx:ge_cycle_operations:"
    "e6327b988d646d54e985ac400bcf4874dbbaa1a533cd38b69ef38ea5acf5c5cc",
    "index:ge_cycle_operations_replay_idx:ge_cycle_operations:"
    "adead2ffcd16460f81c93445cadb8a358cb7e34a468d76d7aa4744869a49a71a",
    "index:ge_cycle_operations_sequence_uq:ge_cycle_operations:"
    "2bc47f53a077b24919689d37b4b0e4003804454fe801be5478ebeea2058638b5",
    "index:ge_cycle_records_range_idx:ge_cycle_records:"
    "0df5a752800279303577d5ca0dac3fd1e5686a93577c2d8b89a014897e703497",
    "index:ge_cycle_records_stream_hash_uq:ge_cycle_records:"
    "632ba77e052a08614d52e354a0a664e12899f90a508f4ea7add7805305646993",
    "index:ge_cycle_records_stream_sequence_hash_uq:ge_cycle_records:"
    "69a32763f756ad96d8dbaee38e8d942ec6fd0e52ab568b024121fd3890acfc58",
    "index:ge_cycle_records_tenant_hash_uq:ge_cycle_records:"
    "4c37cade016d684799fe836cc4297e472540fb5c10baeaac3717fcf4926fbf38",
    "index:ge_cycle_records_tenant_record_id_uq:ge_cycle_records:"
    "ed0019bc10cc21c26b4b14298e1d981f855f08edde0ba548cc28f11530248ed5",
    "index:ge_cycle_used_lease_ids_fence_uq:ge_cycle_used_lease_ids:"
    "22ad08b207d9617ccea4b98e32774f9de4f2c7a255cb6609ad545079b49b7533",
    "index:ge_cycle_used_migration_lock_ids_fence_uq:ge_cycle_used_migration_lock_ids:"
    "8cdff91e036b679adfa94bbe598a65350a27df3dc7dcdeef1e4bf1405fc4138b",
    "table:ge_cycle_checkpoint_revisions:ge_cycle_checkpoint_revisions:"
    "6cd5ca1cb83b687ad5d545d03f0c15a3edb02c9d88c0afdd9984ae4376d44c5c",
    "table:ge_cycle_checkpoints:ge_cycle_checkpoints:"
    "bad0a0f8e72991764c3e00ce476c6c917039b4909afa41113bcb7f40c437839d",
    "table:ge_cycle_cursors:ge_cycle_cursors:"
    "519abf879eee49cee95d6c99c5026ca629fba7bdb5037a8791a5ec03f295dcb9",
    "table:ge_cycle_leases:ge_cycle_leases:"
    "a1d6c0a18be2702fb2e8b505c1387b368bbd1b89029c43071a17c6191dc4f13d",
    "table:ge_cycle_legal_holds:ge_cycle_legal_holds:"
    "a7cfe19503c510818eebc43ddcf0b89a1847b14b8d6a577e6154df1c6368c745",
    "table:ge_cycle_migration_lock:ge_cycle_migration_lock:"
    "ef0718cd3244fd1957cfd66356735c2c2e599c27194a9af9a102fc95ab6e7aca",
    "table:ge_cycle_migrations:ge_cycle_migrations:"
    "50980e7a5377134f84888a058f99ac6150ee2049d64732c4c17729f5eaebc85a",
    "table:ge_cycle_operation_baseline_entries:ge_cycle_operation_baseline_entries:"
    "977738c76fe937c912b24cc3d17b5613d5071f9e257f2ae0c7308949869c5de7",
    "table:ge_cycle_operation_baselines:ge_cycle_operation_baselines:"
    "367358b632119e17495eb95aac470b1df11d9a6d60bc793f5cfa6ce753942679",
    "table:ge_cycle_operation_sequence:ge_cycle_operation_sequence:"
    "096a0ed10877cc23c0c62c2d5d7f90ae798378178d020e848b999ee3887372a5",
    "table:ge_cycle_operations:ge_cycle_operations:"
    "13884236ec7903d7c58654dd15f88735f5b9b454ca2b99131a17269e53d93028",
    "table:ge_cycle_records:ge_cycle_records:"
    "18864cc98a9b33c2e192473be94189f161fa21c3f0ece7489aa6f1a26fbd2cdc",
    "table:ge_cycle_schema:ge_cycle_schema:"
    "d274a42f456db9c36303b55b30500409bfab7d5f5d8980a18e19d6e552867e44",
    "table:ge_cycle_streams:ge_cycle_streams:"
    "7aea433bad2282847a12d44fd07edc4ccdc19de7431415d89e2d53bce09396ee",
    "table:ge_cycle_used_lease_ids:ge_cycle_used_lease_ids:"
    "6bba50213cc40e3e76fe475ceb8e15799658fe002357de831e1e099f31f5042e",
    "table:ge_cycle_used_migration_lock_ids:ge_cycle_used_migration_lock_ids:"
    "fefc267ccd3367aca2079d1666dbecb466a9a491a57cb0c732369bf8ab9bd71b",
)

_MAXIMUM_OBSERVED_ROWS: Final = SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT + 1
_METADATA_QUERY: Final = (
    "SELECT application_id, user_version "
    "FROM main.pragma_application_id(), main.pragma_user_version()"
)
_OWNER_EXECUTE = SQLiteV1BaselineConnectionOwner.execute
_CURSOR_CLOSE = _SQLiteCursorCapability.close
_CURSOR_FETCHMANY = _SQLiteCursorCapability.fetchmany
_CURSOR_FETCHONE = _SQLiteCursorCapability.fetchone

_T = TypeVar("_T")


class _ClosableCursor(Protocol):
    def close(self) -> None: ...


class _CatalogCursor(_ClosableCursor, Protocol):
    def fetchmany(self, size: int) -> list[tuple[object, ...]]: ...


class _MetadataCursor(_ClosableCursor, Protocol):
    def fetchone(self) -> tuple[object, ...] | None: ...


def _close_catalog_cursor_intrinsic(cursor: _ClosableCursor) -> None:
    if type(cursor) is _SQLiteCursorCapability:
        _CURSOR_CLOSE(cursor)
    else:
        cursor.close()


def _fetchmany_catalog_cursor_intrinsic(
    cursor: _CatalogCursor,
    size: int,
) -> list[tuple[object, ...]]:
    if type(cursor) is _SQLiteCursorCapability:
        return _CURSOR_FETCHMANY(cursor, size)
    return cursor.fetchmany(size)


def _fetchone_metadata_cursor_intrinsic(
    cursor: _MetadataCursor,
) -> tuple[object, ...] | None:
    if type(cursor) is _SQLiteCursorCapability:
        return _CURSOR_FETCHONE(cursor)
    return cursor.fetchone()


_CLOSE_CATALOG_CURSOR = _close_catalog_cursor_intrinsic
_FETCHMANY_CATALOG_CURSOR = _fetchmany_catalog_cursor_intrinsic
_FETCHONE_METADATA_CURSOR = _fetchone_metadata_cursor_intrinsic


@dataclass(frozen=True, slots=True)
class _TargetCatalogCanonicalRow:
    name: str
    sql_sha256: str
    table_name: str
    type: str


@dataclass(frozen=True, slots=True)
class _TargetCatalogSnapshot:
    application_id: int
    canonical_json: str
    canonical_rows: tuple[_TargetCatalogCanonicalRow, ...]
    canonical_utf8_bytes: int
    catalog_sha256: str
    inventory: tuple[str, ...]
    query: str
    query_sha256: str
    row_count: int
    target_descriptor: _TargetDescriptor
    user_version: int


def _fail(code: str) -> NoReturn:
    raise ValueError(code)


def _sha256_utf8(*parts: str) -> str:
    digest = hashlib.sha256()
    try:
        for part in parts:
            digest.update(part.encode("utf-8", "strict"))
    except UnicodeError:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_TEXT")
    return digest.hexdigest()


def _safe_metadata_integer(value: object) -> int:
    if type(value) is not int or value < 0 or value > 0x7FFF_FFFF:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_METADATA")
    return value


def _checked_unicode_text(value: object) -> str:
    if type(value) is not str:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_ROW")
    if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
        _fail("GE_CURSOR_B3_TARGET_CATALOG_TEXT")
    return value


def _checked_row(value: object) -> tuple[str, str, str, str]:
    if type(value) is not tuple or len(value) != 4:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_ROW")
    row_type, name, table_name, sql = value
    return (
        _checked_unicode_text(row_type),
        _checked_unicode_text(name),
        _checked_unicode_text(table_name),
        _checked_unicode_text(sql),
    )


def _read_then_close_intrinsic(
    cursor: _ClosableCursor,
    reader: Callable[[], _T],
    read_failure_code: str,
) -> _T:
    """Read once and close, preserving a read failure over a cleanup failure."""

    result, cleanup_failed = _read_then_close_deferred_cleanup_intrinsic(
        cursor,
        reader,
        read_failure_code,
    )
    if cleanup_failed:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_CLEANUP")
    return result


def _read_then_close_deferred_cleanup_intrinsic(
    cursor: _ClosableCursor,
    reader: Callable[[], _T],
    read_failure_code: str,
) -> tuple[_T, bool]:
    """Return a successful read plus a deferred exact-once close failure."""

    try:
        result = reader()
    except Exception:
        with suppress(Exception):
            _CLOSE_CATALOG_CURSOR(cursor)
        _fail(read_failure_code)
    try:
        _CLOSE_CATALOG_CURSOR(cursor)
    except Exception:
        return result, True
    return result, False


def _read_catalog_rows_from_cursor_intrinsic(
    cursor: _CatalogCursor,
) -> tuple[tuple[object, ...], ...]:
    rows, cleanup_failed = _read_catalog_rows_with_deferred_cleanup_intrinsic(cursor)
    if cleanup_failed:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_CLEANUP")
    return rows


def _read_catalog_rows_with_deferred_cleanup_intrinsic(
    cursor: _CatalogCursor,
) -> tuple[tuple[tuple[object, ...], ...], bool]:
    raw_rows, cleanup_failed = _read_then_close_deferred_cleanup_intrinsic(
        cursor,
        lambda: _FETCHMANY_CATALOG_CURSOR(cursor, _MAXIMUM_OBSERVED_ROWS),
        "GE_CURSOR_B3_TARGET_CATALOG_QUERY",
    )
    try:
        return tuple(raw_rows), cleanup_failed
    except Exception:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_QUERY")


def _read_metadata_from_cursor_intrinsic(
    cursor: _MetadataCursor,
) -> tuple[object, ...]:
    metadata, cleanup_failed = _read_metadata_with_deferred_cleanup_intrinsic(cursor)
    if cleanup_failed:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_CLEANUP")
    return metadata


def _read_metadata_with_deferred_cleanup_intrinsic(
    cursor: _MetadataCursor,
) -> tuple[tuple[object, ...], bool]:
    (metadata, trailing), cleanup_failed = _read_then_close_deferred_cleanup_intrinsic(
        cursor,
        lambda: (
            _FETCHONE_METADATA_CURSOR(cursor),
            _FETCHONE_METADATA_CURSOR(cursor),
        ),
        "GE_CURSOR_B3_TARGET_CATALOG_METADATA",
    )
    if type(metadata) is not tuple or trailing is not None or len(metadata) != 2:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_METADATA")
    return metadata, cleanup_failed


def _build_target_catalog_observation_intrinsic(
    application_id_value: object,
    user_version_value: object,
    rows_value: object,
) -> _TargetCatalogSnapshot:
    if type(rows_value) is not tuple:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_ROWS")
    application_id = _safe_metadata_integer(application_id_value)
    user_version = _safe_metadata_integer(user_version_value)
    canonical_payload: list[dict[str, str]] = []
    canonical_rows: list[_TargetCatalogCanonicalRow] = []
    inventory: list[str] = []
    previous_order: tuple[str, str] | None = None
    for raw_row in rows_value:
        row_type, name, table_name, sql = _checked_row(raw_row)
        order = (row_type, name)
        if previous_order is not None and order <= previous_order:
            _fail("GE_CURSOR_B3_TARGET_CATALOG_ORDER")
        previous_order = order
        sql_sha256 = _sha256_utf8(sql)
        canonical_payload.append(
            {"name": name, "sqlSha256": sql_sha256, "tableName": table_name, "type": row_type}
        )
        canonical_rows.append(_TargetCatalogCanonicalRow(name, sql_sha256, table_name, row_type))
        inventory.append(f"{row_type}:{name}:{table_name}:{sql_sha256}")
    canonical_json = json.dumps(
        canonical_payload,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    snapshot = _TargetCatalogSnapshot(
        application_id=application_id,
        canonical_json=canonical_json,
        canonical_rows=tuple(canonical_rows),
        canonical_utf8_bytes=len(canonical_json.encode("utf-8", "strict")),
        catalog_sha256=_sha256_utf8(
            SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8,
            canonical_json,
        ),
        inventory=tuple(inventory),
        query=SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY,
        query_sha256=SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256,
        row_count=len(canonical_rows),
        target_descriptor=SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR,
        user_version=user_version,
    )
    return snapshot


def _validate_target_catalog_snapshot_intrinsic(
    snapshot: _TargetCatalogSnapshot,
) -> _TargetCatalogSnapshot:
    if type(snapshot) is not _TargetCatalogSnapshot or (
        snapshot.application_id != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID
        or snapshot.user_version != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION
        or snapshot.row_count != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
        or snapshot.canonical_utf8_bytes
        != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES
        or snapshot.catalog_sha256 != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        or snapshot.inventory != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY
        or _sha256_utf8(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY)
        != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256
    ):
        _fail("GE_CURSOR_B3_TARGET_CATALOG_MISMATCH")
    return snapshot


def _snapshot_target_catalog_observation_intrinsic(
    application_id_value: object,
    user_version_value: object,
    rows_value: object,
) -> _TargetCatalogSnapshot:
    """Build and validate the exact frozen v2 target observation."""

    return _validate_target_catalog_snapshot_intrinsic(
        _build_target_catalog_observation_intrinsic(
            application_id_value,
            user_version_value,
            rows_value,
        )
    )


def _read_target_catalog_observation_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
) -> _TargetCatalogSnapshot:
    """Read a canonical physical-catalog observation at any schema version."""

    snapshot, cleanup_failed = _read_target_catalog_observation_with_cleanup_intrinsic(connection)
    if cleanup_failed:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_CLEANUP")
    return snapshot


def _read_target_catalog_observation_with_cleanup_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
) -> tuple[_TargetCatalogSnapshot, bool]:
    """Build the observation while deferring catalog and metadata cleanup."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_CONNECTION")
    try:
        cursor = _OWNER_EXECUTE(connection, SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY)
    except Exception:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_QUERY")
    rows, cleanup_failed = _read_catalog_rows_with_deferred_cleanup_intrinsic(cursor)
    try:
        metadata_cursor = _OWNER_EXECUTE(connection, _METADATA_QUERY)
    except Exception:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_METADATA")
    metadata, metadata_cleanup_failed = _read_metadata_with_deferred_cleanup_intrinsic(
        metadata_cursor
    )
    return (
        _build_target_catalog_observation_intrinsic(metadata[0], metadata[1], rows),
        cleanup_failed or metadata_cleanup_failed,
    )


_READ_TARGET_CATALOG_OBSERVATION = _read_target_catalog_observation_intrinsic
_READ_TARGET_CATALOG_OBSERVATION_WITH_CLEANUP = (
    _read_target_catalog_observation_with_cleanup_intrinsic
)


def _read_validated_target_catalog_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
) -> _TargetCatalogSnapshot:
    snapshot, cleanup_failed = _READ_TARGET_CATALOG_OBSERVATION_WITH_CLEANUP(connection)
    validated = _validate_target_catalog_snapshot_intrinsic(snapshot)
    if cleanup_failed:
        _fail("GE_CURSOR_B3_TARGET_CATALOG_CLEANUP")
    return validated
