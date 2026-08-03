from __future__ import annotations

import gc
import sqlite3
from pathlib import Path
from typing import cast
from weakref import ref

import pytest

import graph_engineering.sqlite_cursor_publication_transaction_owner as transaction
from graph_engineering.sqlite_operation_baseline_source import SQLiteV1BaselineConnectionOwner
from tests.test_sqlite_operation_baseline_source import (
    add_checkpoint_history,
)
from tests.test_sqlite_operation_baseline_source import (
    database as memory_source_v1_database,
)


def _source_v1(path: Path) -> SQLiteV1BaselineConnectionOwner:
    memory = memory_source_v1_database()
    target = SQLiteV1BaselineConnectionOwner(str(path))
    memory_raw = cast(
        sqlite3.Connection,
        object.__getattribute__(memory, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    target_raw = cast(
        sqlite3.Connection,
        object.__getattribute__(target, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    memory_raw.backup(target_raw)
    memory.close()
    return target


def _source_v1_with_history(path: Path) -> SQLiteV1BaselineConnectionOwner:
    memory = memory_source_v1_database()
    add_checkpoint_history(memory)
    # The shared baseline iterator fixture deliberately uses a sparse revision
    # value (10). Transaction-owner source-v1 requires provider semantic
    # validity, so normalize this test copy to the contiguous provider history.
    memory.execute(
        "UPDATE ge_cycle_checkpoint_revisions SET revision = 3 WHERE revision = 10"
    ).close()
    memory.execute(
        "UPDATE ge_cycle_checkpoints SET checkpoint_revision = 3 "
        "WHERE checkpoint_revision = 10"
    ).close()
    memory.commit()
    target = SQLiteV1BaselineConnectionOwner(str(path))
    memory_raw = cast(
        sqlite3.Connection,
        object.__getattribute__(memory, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    target_raw = cast(
        sqlite3.Connection,
        object.__getattribute__(target, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    memory_raw.backup(target_raw)
    memory.close()
    return target


def _active(path: Path) -> tuple[SQLiteV1BaselineConnectionOwner, object, object]:
    connection = _source_v1(path)
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    receipt = transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    return connection, owner, receipt


def _assert_terminal_graph_is_cleared(owner: object, receipt: object, primary: object) -> None:
    for field in ("owner", "connection", "lineage", "generation", "mode"):
        assert (
            object.__getattribute__(
                receipt, f"_SQLiteCursorPublicationBeginReceipt__{field}"
            )
            is None
        )
    assert (
        object.__getattribute__(
            primary, "_SQLiteCursorPublicationAuthenticatedFailure__owner"
        )
        is None
    )
    for field in (
        "connection",
        "lineage",
        "generation",
        "receipt",
        "primary",
        "source_fingerprint",
    ):
        assert (
            object.__getattribute__(
                owner, f"_SQLiteCursorPublicationTransactionOwner__{field}"
            )
            is None
        )


def test_registration_begin_guard_failure_cleanup_and_reopen_v1(tmp_path: Path) -> None:
    connection, owner, receipt = _active(tmp_path / "owner.sqlite")
    active = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert active.lifecycle == "active"
    assert active.registration_count == 1
    assert active.provisional_generation_mint_count == 1
    assert active.provisional_generation_promotion_count == 1
    assert active.provisional_generation_tombstone_count == 0
    assert active.begin_attempt_count == 1
    assert active.begin_native_return_count == 1
    assert active.begin_receipt_mint_count == 1
    assert active.runtime_transaction_control_count == 1
    assert active.commit_attempt_count == 0
    assert active.commit_hard_disabled is True
    assert active.exact_generation_active is True
    assert active.exact_lineage_selected is True
    assert active.transaction_mode == "exclusive"
    assert active.transaction_epoch_advanced_exactly_once_by_owner is True
    assert active.total_changes_unchanged_by_begin is True
    receipt_snapshot = (
        transaction._read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
            owner, receipt
        )
    )
    assert receipt_snapshot[:5] == (True, True, True, True, True)
    assert receipt_snapshot.temp_mutation_epoch == active.temp_mutation_epoch
    assert active.temp_mutation_epoch_unchanged_by_begin is True

    cursor = connection.execute("SELECT 1")
    assert cursor.fetchone() == (1,)
    cursor.close()

    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_COMMIT_HARD_DISABLED"):
        transaction._commit_sqlite_cursor_publication_transaction_intrinsic(owner, object())
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_COMMIT_HARD_DISABLED"):
        connection.commit()
    assert connection.transaction_epoch == before_epoch
    assert connection.total_changes == before_changes

    primary = (
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
            owner
        )
    )
    with pytest.raises(BaseException) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )
    assert raised.value is primary
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.rollback_native_return_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.close_native_return_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.reopen_source_v1_count == 1
    assert terminal.runtime_transaction_control_count == 2
    assert terminal.commit_attempt_count == 0
    assert terminal.exact_generation_active is False
    assert terminal.exact_lineage_selected is False
    assert terminal.transaction_mode is None
    assert all(
        isinstance(value, (str, int, bool, tuple)) or value is None
        for value in terminal
    )
    _assert_terminal_graph_is_cleared(owner, receipt, primary)
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_BEGIN_RECEIPT"):
        transaction._read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
            owner, receipt
        )
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_PRIMARY"):
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )


def test_relative_source_path_is_pinned_across_cwd_switch_before_reopen(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_directory = tmp_path / "original"
    substitute_directory = tmp_path / "substitute"
    original_directory.mkdir()
    substitute_directory.mkdir()
    monkeypatch.chdir(original_directory)
    connection = _source_v1(Path("same-name.sqlite"))

    # An empty SQLite database under the same relative spelling makes a
    # cwd-based registration/reopen fail source-v1 validation.  The owner must
    # instead retain the absolute path frozen before its original native
    # connect for registration, BEGIN, close, and reopen.
    sqlite3.connect(substitute_directory / "same-name.sqlite").close()
    monkeypatch.chdir(substitute_directory)
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    receipt = transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    primary = (
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
            owner
        )
    )
    with pytest.raises(transaction._SQLiteCursorPublicationAuthenticatedFailure) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )
    assert raised.value is primary
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.reopen_source_v1_count == 1
    assert terminal.transaction_mode is None
    _assert_terminal_graph_is_cleared(owner, receipt, primary)


@pytest.mark.parametrize(
    ("operation", "sql", "code"),
    [
        ("execute", "COMMIT", "GE_SQLITE_TX_OWNER_COMMIT_HARD_DISABLED"),
        ("execute", "ROLLBACK", "GE_SQLITE_TX_OWNER_GUARD"),
        ("execute", "BEGIN EXCLUSIVE", "GE_SQLITE_TX_OWNER_GUARD"),
        ("execute", "SAVEPOINT x", "GE_SQLITE_TX_OWNER_GUARD"),
        ("executescript", "SELECT 1; COMMIT;", "GE_SQLITE_TX_OWNER_GUARD"),
        ("execute", "PRAGMA user_version=2", "GE_SQLITE_TX_OWNER_GUARD"),
        ("execute", "VACUUM", "GE_SQLITE_TX_OWNER_GUARD"),
        ("execute", "ATTACH ':memory:' AS x", "GE_SQLITE_TX_OWNER_GUARD"),
        ("execute", "INSERT INTO missing VALUES (1)", "GE_SQLITE_TX_OWNER_GUARD"),
    ],
)
def test_live_owner_public_surfaces_reject_before_io(
    tmp_path: Path,
    operation: str,
    sql: str,
    code: str,
) -> None:
    connection, owner, _receipt = _active(tmp_path / f"{operation}-{len(sql)}.sqlite")
    before = (connection.transaction_epoch, connection.total_changes)
    call = getattr(connection, operation)
    with pytest.raises(ValueError, match=code):
        call(sql)
    assert (connection.transaction_epoch, connection.total_changes) == before
    primary = (
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
            owner
        )
    )
    with pytest.raises(transaction._SQLiteCursorPublicationAuthenticatedFailure):
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )


def test_guard_inventory_is_real_routes_or_absent_capabilities(tmp_path: Path) -> None:
    connection, owner, receipt = _active(tmp_path / "guard-inventory.sqlite")
    before = (connection.transaction_epoch, connection.total_changes)
    operations = [
        (0, connection.commit, ()),
        (1, connection.rollback, ()),
        (2, connection.execute, ("END",)),
        (3, connection.execute, ("ROLLBACK",)),
        (5, connection.execute, ("RELEASE x",)),
        (6, connection.execute, ("SELECT 1; COMMIT",)),
        (8, connection.executescript, ("SELECT 1; COMMIT;",)),
        (9, connection.execute, ("BEGIN",)),
        (10, connection.close, ()),
        (11, connection.execute, ("UPDATE missing SET value = 1",)),
        (13, connection.execute, ("CREATE TABLE forbidden(value)",)),
        (15, connection.execute, ("PRAGMA user_version=2",)),
        (16, connection.execute, ("REINDEX",)),
        (17, connection.execute, ("DETACH forbidden",)),
        (18, connection.execute, ("WITH value AS (SELECT 1) SELECT * FROM value",)),
    ]
    for _index, call, arguments in operations:
        with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_"):
            call(*arguments)
        assert (connection.transaction_epoch, connection.total_changes) == before
    snapshot = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    for index, _call, _arguments in operations:
        assert snapshot.guard_rejection_counts[index] == 1
    assert snapshot.guard_rejection_counts[4] == 0  # registered BEGIN is tested separately
    # The wrapper never exposes a prepare API and its cursor capability cannot
    # execute, so the three already/prepared bypass classes have no runtime route.
    assert not hasattr(connection, "prepare")
    cursor = connection.execute("SELECT 1")
    assert not hasattr(cursor, "execute")
    assert not hasattr(cursor, "executemany")
    cursor.close()
    assert snapshot.guard_rejection_counts[7] == 0
    assert snapshot.guard_rejection_counts[12] == 0
    assert snapshot.guard_rejection_counts[14] == 0
    receipt_snapshot = (
        transaction._read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
            owner, receipt
        )
    )
    assert receipt_snapshot.exact_owner is True
    primary = (
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
            owner
        )
    )
    with pytest.raises(transaction._SQLiteCursorPublicationAuthenticatedFailure):
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )


def test_abandoned_owner_never_releases_live_connection_guard(tmp_path: Path) -> None:
    connection = _source_v1(tmp_path / "abandoned.sqlite")
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    owner_ref = ref(owner)
    del owner
    gc.collect()
    assert owner_ref() is None
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_ABANDONED"):
        connection.execute("SELECT 1")
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_ABANDONED"):
        connection.close()


def test_memory_database_and_replay_are_rejected_without_transaction_io() -> None:
    memory = SQLiteV1BaselineConnectionOwner(":memory:")
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_REGISTRATION"):
        transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(memory)
    assert memory.transaction_epoch == 0
    assert memory.total_changes == 0
    memory.close()


def test_temp_epoch_conservatively_tracks_every_native_mutation_class() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    for sql in ("SELECT 1", "VALUES (1)", "EXPLAIN SELECT 1"):
        cursor = connection.execute(sql)
        cursor.close()
    assert connection.temp_mutation_epoch == 0
    connection.execute("BEGIN EXCLUSIVE").close()
    assert connection.temp_mutation_epoch == 0
    connection.rollback()
    assert connection.temp_mutation_epoch == 1
    connection.execute("CREATE TABLE main_value(value INTEGER)").close()
    assert connection.temp_mutation_epoch == 2
    connection.execute("INSERT INTO main_value VALUES (1)").close()
    assert connection.temp_mutation_epoch == 3
    connection.commit()
    assert connection.temp_mutation_epoch == 4
    connection.execute("PRAGMA user_version=1").close()
    assert connection.temp_mutation_epoch == 5
    connection.close()


def test_begin_receipt_commits_independent_temp_mutation_epoch(tmp_path: Path) -> None:
    connection = _source_v1(tmp_path / "temp-epoch.sqlite")
    cursor = connection.execute("CREATE TEMP TABLE temp.before_owner(value INTEGER)")
    cursor.close()
    assert connection.temp_mutation_epoch == 1
    raw = cast(
        sqlite3.Connection,
        object.__getattribute__(connection, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    raw.execute("INSERT INTO temp.before_owner VALUES (1)").close()
    raw.commit()
    # SQLite drops the TEMP schema when temp_store changes, leaving a high
    # mutation epoch but the registration closed set restored.
    raw.execute("PRAGMA temp_store=MEMORY").close()
    assert connection.temp_mutation_epoch == 4
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    receipt = transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    receipt_snapshot = (
        transaction._read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
            owner, receipt
        )
    )
    assert receipt_snapshot.temp_mutation_epoch >= 4
    snapshot = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert snapshot.temp_mutation_epoch == receipt_snapshot.temp_mutation_epoch
    assert snapshot.temp_mutation_epoch_unchanged_by_begin is True
    primary = (
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
            owner
        )
    )
    with pytest.raises(transaction._SQLiteCursorPublicationAuthenticatedFailure):
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )


def test_begin_guard_classifies_registered_and_active_lifecycle(tmp_path: Path) -> None:
    registered_connection = _source_v1(tmp_path / "registered-begin.sqlite")
    registered_owner = (
        transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
            registered_connection
        )
    )
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_GUARD"):
        registered_connection.execute("BEGIN EXCLUSIVE")
    registered = (
        transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
            registered_owner
        )
    )
    assert registered.guard_rejection_counts[4] == 1
    assert registered.guard_rejection_counts[9] == 0

    active_connection, active_owner, _receipt = _active(tmp_path / "active-begin.sqlite")
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_GUARD"):
        active_connection.execute("BEGIN EXCLUSIVE")
    active = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        active_owner
    )
    assert active.guard_rejection_counts[4] == 0
    assert active.guard_rejection_counts[9] == 1
    primary = (
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
            active_owner
        )
    )
    with pytest.raises(transaction._SQLiteCursorPublicationAuthenticatedFailure):
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            active_owner, primary
        )


def test_connection_guard_cannot_be_discarded_while_transaction_is_live(
    tmp_path: Path,
) -> None:
    connection, owner, _receipt = _active(tmp_path / "live-discard.sqlite")
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_LIVE_GUARD"):
        connection._discard_publication_transaction_guard(owner)
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_GUARD"):
        connection.rollback()
    primary = (
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
            owner
        )
    )
    with pytest.raises(transaction._SQLiteCursorPublicationAuthenticatedFailure):
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )


@pytest.mark.parametrize("kind", ["empty", "v2", "intermediate"])
def test_registration_rejects_non_v1_before_begin_io(tmp_path: Path, kind: str) -> None:
    connection = (
        SQLiteV1BaselineConnectionOwner(str(tmp_path / f"{kind}.sqlite"))
        if kind == "empty"
        else _source_v1(tmp_path / f"{kind}.sqlite")
    )
    raw = cast(
        sqlite3.Connection,
        object.__getattribute__(connection, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    if kind == "v2":
        raw.execute("PRAGMA user_version=2").close()
    elif kind == "intermediate":
        raw.execute("DROP TABLE ge_cycle_schema").close()
    before_epoch = connection.transaction_epoch
    with pytest.raises((ValueError, sqlite3.DatabaseError)):
        transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
            connection
        )
    assert connection.in_transaction is False
    assert connection.transaction_epoch == before_epoch
    connection.close()


@pytest.mark.parametrize(
    ("kind", "sql"),
    [
        ("side-table", "CREATE TABLE hostile_side_table(value INTEGER)"),
        (
            "side-index",
            "CREATE INDEX hostile_side_index ON ge_cycle_schema(current_version)",
        ),
        ("side-view", "CREATE VIEW hostile_side_view AS SELECT 1 AS value"),
        (
            "side-trigger",
            "CREATE TRIGGER hostile_side_trigger AFTER UPDATE ON ge_cycle_schema "
            "BEGIN SELECT 1; END",
        ),
        ("attach", "ATTACH DATABASE ':memory:' AS hostile_attached"),
        ("temp-table", "CREATE TEMP TABLE hostile_temp_table(value INTEGER)"),
        ("temp-view", "CREATE TEMP VIEW hostile_temp_view AS SELECT 1 AS value"),
        (
            "temp-trigger",
            "CREATE TEMP TRIGGER hostile_temp_trigger AFTER UPDATE ON main.ge_cycle_schema "
            "BEGIN SELECT 1; END",
        ),
    ],
)
def test_registration_rejects_noncanonical_catalog_topology_and_temp_closed_sets(
    tmp_path: Path,
    kind: str,
    sql: str,
) -> None:
    connection = _source_v1(tmp_path / f"{kind}.sqlite")
    raw = cast(
        sqlite3.Connection,
        object.__getattribute__(connection, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    raw.executescript(sql)
    raw.commit()
    before_epoch = connection.transaction_epoch
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_SOURCE_V1"):
        transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
            connection
        )
    assert connection.in_transaction is False
    assert connection.transaction_epoch == before_epoch
    connection.close()


def test_registration_rejects_application_semantic_corruption_before_begin_io(
    tmp_path: Path,
) -> None:
    connection = _source_v1_with_history(tmp_path / "semantic-corruption.sqlite")
    raw = cast(
        sqlite3.Connection,
        object.__getattribute__(connection, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    assert raw.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert raw.execute("PRAGMA foreign_key_check").fetchall() == []
    raw.execute(
        "UPDATE ge_cycle_records SET value_blob = zeroblob(value_bytes)"
    ).close()
    raw.commit()
    assert raw.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert raw.execute("PRAGMA foreign_key_check").fetchall() == []
    before_epoch = connection.transaction_epoch
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_SOURCE_V1"):
        transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
            connection
        )
    assert connection.in_transaction is False
    assert connection.transaction_epoch == before_epoch
    connection.close()


def test_reopen_failure_still_clears_entire_terminal_capability_graph(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _connection, owner, receipt = _active(tmp_path / "reopen-unavailable.sqlite")
    primary = (
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
            owner
        )
    )

    def reopen_unavailable(_connection: object, _owner: object) -> object:
        raise OSError("reopen unavailable")

    monkeypatch.setattr(transaction, "_REOPEN_FINGERPRINT", reopen_unavailable)
    with pytest.raises(
        ValueError, match="GE_SQLITE_TX_OWNER_REOPEN_UNAVAILABLE"
    ) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )
    assert raised.value.__cause__ is primary
    snapshot = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert snapshot.lifecycle == "finalized"
    assert snapshot.rollback_native_return_count == 1
    assert snapshot.close_native_return_count == 1
    assert snapshot.reopen_attempt_count == 1
    assert snapshot.reopen_source_v1_count == 0
    _assert_terminal_graph_is_cleared(owner, receipt, primary)
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_BEGIN_RECEIPT"):
        transaction._read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
            owner, receipt
        )
    with pytest.raises(ValueError, match="GE_SQLITE_TX_OWNER_PRIMARY"):
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )


def test_reopen_corruption_dominates_primary_and_still_finalizes_graph(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _connection, owner, receipt = _active(tmp_path / "reopen-corruption.sqlite")
    primary = (
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
            owner
        )
    )
    original_reopen = transaction._REOPEN_FINGERPRINT

    def reopen_with_fingerprint_corruption(
        connection: SQLiteV1BaselineConnectionOwner,
        candidate: object,
    ) -> tuple[object, ...]:
        reopened = list(original_reopen(connection, candidate))
        reopened[0] = ("hostile-logical-dump",)
        return tuple(reopened)

    monkeypatch.setattr(
        transaction,
        "_REOPEN_FINGERPRINT",
        reopen_with_fingerprint_corruption,
    )
    with pytest.raises(
        ValueError, match="GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION"
    ) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )
    assert raised.value.__cause__ is primary
    snapshot = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert snapshot.lifecycle == "finalized"
    assert snapshot.rollback_native_return_count == 1
    assert snapshot.close_native_return_count == 1
    assert snapshot.reopen_attempt_count == 1
    assert snapshot.reopen_source_v1_count == 0
    _assert_terminal_graph_is_cleared(owner, receipt, primary)


def test_external_writer_registration_to_begin_race_is_terminal_corruption(
    tmp_path: Path,
) -> None:
    path = tmp_path / "external-writer-race.sqlite"
    connection = _source_v1(path)
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    external = sqlite3.connect(path)
    try:
        external.execute(
            "UPDATE ge_cycle_migration_lock SET updated_at_ms = updated_at_ms + 1 "
            "WHERE singleton = 1"
        ).close()
        external.commit()
    finally:
        external.close()

    with pytest.raises(
        ValueError, match="GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION"
    ) as raised:
        transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    assert isinstance(raised.value.__cause__, ValueError)
    assert str(raised.value.__cause__) == "GE_SQLITE_TX_OWNER_BEGIN_POSTFLIGHT"
    snapshot = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert snapshot.lifecycle == "finalized"
    assert snapshot.begin_attempt_count == 1
    assert snapshot.begin_native_return_count == 1
    assert snapshot.provisional_generation_tombstone_count == 1
    assert snapshot.rollback_attempt_count == 1
    assert snapshot.rollback_native_return_count == 1
    assert snapshot.close_native_return_count == 1
    assert snapshot.reopen_attempt_count == 1
    assert snapshot.reopen_source_v1_count == 0


def test_external_writer_semantic_corruption_is_not_reopen_unavailable(
    tmp_path: Path,
) -> None:
    path = tmp_path / "external-semantic-race.sqlite"
    connection = _source_v1_with_history(path)
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    external = sqlite3.connect(path)
    try:
        external.execute(
            "UPDATE ge_cycle_records SET value_blob = zeroblob(value_bytes)"
        ).close()
        external.commit()
        assert external.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert external.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        external.close()

    with pytest.raises(
        ValueError, match="GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION"
    ) as raised:
        transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    assert isinstance(raised.value.__cause__, ValueError)
    assert str(raised.value.__cause__) == "GE_SQLITE_TX_OWNER_BEGIN_POSTFLIGHT"
    snapshot = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert snapshot.lifecycle == "finalized"
    assert snapshot.rollback_native_return_count == 1
    assert snapshot.reopen_attempt_count == 1
    assert snapshot.reopen_source_v1_count == 0


def test_begin_revalidates_semantics_after_registration_fingerprint_race(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "registration-fingerprint-race.sqlite"
    connection = _source_v1_with_history(path)
    original_fingerprint = transaction._SOURCE_FINGERPRINT
    registration_call = True

    def fingerprint_with_one_external_race(
        candidate: SQLiteV1BaselineConnectionOwner,
        owner: object,
    ) -> tuple[object, ...]:
        nonlocal registration_call
        if registration_call:
            registration_call = False
            external = sqlite3.connect(path)
            try:
                external.execute(
                    "UPDATE ge_cycle_records SET value_blob = zeroblob(value_bytes)"
                ).close()
                external.commit()
            finally:
                external.close()
        return original_fingerprint(candidate, owner)

    monkeypatch.setattr(
        transaction,
        "_SOURCE_FINGERPRINT",
        fingerprint_with_one_external_race,
    )
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    with pytest.raises(
        ValueError, match="GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION"
    ) as raised:
        transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    assert isinstance(raised.value.__cause__, ValueError)
    assert str(raised.value.__cause__) == "GE_SQLITE_TX_OWNER_BEGIN_POSTFLIGHT"
    snapshot = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert snapshot.lifecycle == "finalized"
    assert snapshot.begin_native_return_count == 1
    assert snapshot.provisional_generation_promotion_count == 0
    assert snapshot.begin_receipt_mint_count == 0
    assert snapshot.rollback_native_return_count == 1
    assert snapshot.reopen_source_v1_count == 0


def test_portable_report_retains_p9_reopen_and_commit_nonclaims() -> None:
    from tests.sqlite_cursor_publication_transaction_owner_report import build_report

    report = build_report()
    claims = cast(dict[str, bool], report["claims"])
    nonclaims = cast(list[str], report["nonclaims"])
    assert claims["completeV2Classifier"] is False
    assert claims["commitRuntime"] is False
    assert claims["successPath"] is False
    assert "complete-v2-reopen-classifier" in nonclaims
    assert "runtime-commit-execution" in nonclaims
    assert "success-path" in nonclaims
