"""Transaction-external TEMP storage preparation for SQLite baseline staging."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .sqlite_operation_baseline_source import SQLiteV1BaselineConnectionOwner

DEFAULT_SQLITE_V1_BASELINE_TEMP_CACHE_KIB = 8_192
MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB = 1_024
MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB = 65_536


@dataclass(frozen=True, slots=True)
class SQLiteV1BaselineTempStorageConfiguration:
    """Read-back evidence for the bounded FILE-backed TEMP configuration."""

    temp_store: Literal["file"]
    cache_kib: int
    cache_spill: Literal[True]


def _require_outside_transaction(connection: SQLiteV1BaselineConnectionOwner) -> None:
    if connection.in_transaction:
        raise ValueError("SQLite v1 baseline TEMP storage must be configured outside a transaction")


def _execute_pragma(connection: SQLiteV1BaselineConnectionOwner, sql: str) -> None:
    cursor = connection.execute(sql)
    cursor.close()


def _read_pragma_integer(connection: SQLiteV1BaselineConnectionOwner, sql: str) -> int:
    cursor = connection.execute(sql)
    try:
        row = cursor.fetchone()
    finally:
        cursor.close()
    if row is None or len(row) != 1 or type(row[0]) is not int:
        raise ValueError("SQLite v1 baseline TEMP storage read-back is invalid")
    return row[0]


def _checked_cache_kib(value: object) -> int:
    if (
        type(value) is not int
        or value < MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
        or value > MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
    ):
        raise ValueError("SQLite v1 baseline TEMP cache size is outside bounds")
    return value


def read_sqlite_v1_baseline_temp_storage(
    connection: SQLiteV1BaselineConnectionOwner,
) -> SQLiteV1BaselineTempStorageConfiguration:
    """Read and validate the exact baseline TEMP configuration outside a transaction."""

    _require_outside_transaction(connection)
    temp_store = _read_pragma_integer(connection, "PRAGMA temp_store")
    temp_cache_size = _read_pragma_integer(connection, "PRAGMA temp.cache_size")
    cache_spill_threshold = _read_pragma_integer(connection, "PRAGMA cache_spill")
    if (
        temp_store != 1
        or temp_cache_size >= 0
        or -temp_cache_size < MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
        or -temp_cache_size > MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
        or cache_spill_threshold <= 0
    ):
        raise ValueError("SQLite v1 baseline TEMP storage configuration drifted")
    return SQLiteV1BaselineTempStorageConfiguration(
        temp_store="file",
        cache_kib=-temp_cache_size,
        cache_spill=True,
    )


def configure_sqlite_v1_baseline_temp_storage(
    connection: SQLiteV1BaselineConnectionOwner,
    *,
    cache_kib: int = DEFAULT_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
) -> SQLiteV1BaselineTempStorageConfiguration:
    """Configure bounded FILE-backed TEMP storage without accepting a directory path."""

    _require_outside_transaction(connection)
    checked_cache_kib = _checked_cache_kib(cache_kib)
    _execute_pragma(connection, "PRAGMA temp_store = FILE")
    _execute_pragma(
        connection,
        f"PRAGMA temp.cache_size = {-checked_cache_kib}",
    )
    _execute_pragma(connection, "PRAGMA cache_spill = ON")
    profile = read_sqlite_v1_baseline_temp_storage(connection)
    if profile.cache_kib != checked_cache_kib:
        raise ValueError("SQLite v1 baseline TEMP cache size read-back drifted")
    return profile
