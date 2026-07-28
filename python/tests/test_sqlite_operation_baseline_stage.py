from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    _SQLiteCursorCapability,
)
from graph_engineering.sqlite_operation_baseline_stage import (
    DEFAULT_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
    MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
    MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
    configure_sqlite_v1_baseline_temp_storage,
    read_sqlite_v1_baseline_temp_storage,
)


def test_owner_conservatively_tracks_and_proves_exclusive_transaction_mode() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    try:
        assert connection.transaction_mode is None
        assert not connection.in_exclusive_transaction

        connection.execute("BEGIN").close()
        assert connection.transaction_mode == "deferred"
        assert not connection.in_exclusive_transaction
        connection.execute("ROLLBACK").close()

        connection.execute("; /* prefix */ BEGIN /* mode */ IMMEDIATE").close()
        assert connection.transaction_mode == "immediate"
        assert not connection.in_exclusive_transaction
        connection.rollback()

        connection.execute(";; -- prefix\n BEGIN /* mode */ EXCLUSIVE").close()
        assert connection.transaction_mode == "exclusive"
        assert connection.in_exclusive_transaction
        connection.execute("SAVEPOINT nested").close()
        connection.execute("ROLLBACK TO nested").close()
        connection.execute("RELEASE nested").close()
        assert connection.transaction_mode == "exclusive"
        assert connection.in_exclusive_transaction
        connection.commit()
        assert connection.transaction_mode is None
        assert not connection.in_exclusive_transaction

        connection.executescript("BEGIN EXCLUSIVE;")
        assert connection.transaction_mode == "unknown"
        assert not connection.in_exclusive_transaction
        connection.rollback()

        connection.execute("SAVEPOINT only_savepoint").close()
        assert connection.transaction_mode == "deferred"
        assert not connection.in_exclusive_transaction
        connection.rollback()

        with pytest.raises(Exception, match="definitely_missing_table"):
            connection.executescript(
                "BEGIN EXCLUSIVE; SELECT * FROM definitely_missing_table;"
            )
        assert connection.in_transaction
        assert connection.transaction_mode == "unknown"
        assert not connection.in_exclusive_transaction
        connection.rollback()

        connection.execute("CREATE TABLE implicit_transaction (value INTEGER)").close()
        connection.execute("INSERT INTO implicit_transaction VALUES (1)").close()
        assert connection.transaction_mode == "deferred"
        assert not connection.in_exclusive_transaction
    finally:
        connection.close()


def test_configures_and_reads_bounded_file_backed_temp_without_directory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    statements: list[str] = []
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def observed_execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        statements.append(sql)
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", observed_execute)
    try:
        configured = configure_sqlite_v1_baseline_temp_storage(connection)
        assert configured.temp_store == "file"
        assert configured.cache_kib == DEFAULT_SQLITE_V1_BASELINE_TEMP_CACHE_KIB == 8_192
        assert configured.cache_spill is True
        assert read_sqlite_v1_baseline_temp_storage(connection) == configured
        assert any(statement == "PRAGMA temp_store = FILE" for statement in statements)
        assert any(statement == "PRAGMA temp.cache_size = -8192" for statement in statements)
        assert any(statement == "PRAGMA cache_spill = ON" for statement in statements)
        assert all("temp_store_directory" not in statement.lower() for statement in statements)
        with pytest.raises(FrozenInstanceError):
            configured.cache_kib = 1  # type: ignore[misc]
    finally:
        connection.close()


def test_temp_configuration_rejects_transaction_scope_and_readback_drift() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    try:
        configure_sqlite_v1_baseline_temp_storage(connection)
        connection.execute("PRAGMA temp_store = MEMORY").close()
        with pytest.raises(ValueError, match="configuration drifted"):
            read_sqlite_v1_baseline_temp_storage(connection)

        configure_sqlite_v1_baseline_temp_storage(connection)
        connection.execute("PRAGMA temp.cache_spill = OFF").close()
        with pytest.raises(ValueError, match="configuration drifted"):
            read_sqlite_v1_baseline_temp_storage(connection)

        configure_sqlite_v1_baseline_temp_storage(connection)
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match="outside a transaction"):
            configure_sqlite_v1_baseline_temp_storage(connection)
        with pytest.raises(ValueError, match="outside a transaction"):
            read_sqlite_v1_baseline_temp_storage(connection)
    finally:
        connection.close()


def test_temp_cache_boundaries_and_directory_pragma_are_closed() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    try:
        assert configure_sqlite_v1_baseline_temp_storage(
            connection,
            cache_kib=MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
        ).cache_kib == MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
        assert configure_sqlite_v1_baseline_temp_storage(
            connection,
            cache_kib=MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
        ).cache_kib == MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
        for cache_kib in (
            MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB - 1,
            MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB + 1,
            1.5,
            True,
        ):
            with pytest.raises(ValueError, match="outside bounds"):
                configure_sqlite_v1_baseline_temp_storage(
                    connection,
                    cache_kib=cache_kib,  # type: ignore[arg-type]
                )
        for sql in (
            "PRAGMA main.temp_store_directory = '/tmp'",
            "PRAGMA /* hostile */ [temp_store_directory] = '/tmp'",
        ):
            with pytest.raises(ValueError, match="temp_store_directory is forbidden"):
                connection.execute(sql)
        with pytest.raises(ValueError, match="temp_store_directory is forbidden"):
            connection.executescript("SELECT 1; PRAGMA temp_store_directory = '/tmp';")
    finally:
        connection.close()
