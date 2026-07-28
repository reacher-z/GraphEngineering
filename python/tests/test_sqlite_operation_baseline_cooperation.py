from __future__ import annotations

import sqlite3

import pytest

import graph_engineering.sqlite_operation_baseline_stage as stage_module
from graph_engineering.sqlite_operation_baseline_cooperation import (
    _stream_sqlite_v1_baseline_source_into_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    _CooperativeSourceItem,
    _CooperativeWriteReceipt,
    _issue_cooperative_write_receipt,
    _SQLiteCursorCapability,
    capture_sqlite_v1_baseline_source_summary,
)
from graph_engineering.sqlite_operation_baseline_stage import (
    SQLiteV1BaselineTempStage,
    configure_sqlite_v1_baseline_temp_storage,
    create_sqlite_v1_baseline_temp_stage,
)
from tests.test_sqlite_operation_baseline_source import (
    NOW,
    add_checkpoint_history,
    database,
    insert_legacy_operation,
)


def _prepare_minimal() -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    SQLiteV1BaselineTempStage,
]:
    connection = database()
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("BEGIN EXCLUSIVE").close()
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    summary = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
    return connection, summary, stage


def _common_count(connection: SQLiteV1BaselineConnectionOwner) -> int:
    cursor = connection.execute("SELECT count(*) FROM temp.ge_blr_stage")
    try:
        row = cursor.fetchone()
    finally:
        cursor.close()
    assert row is not None
    value = row[0]
    assert isinstance(value, int)
    return value


def _relation_count(connection: SQLiteV1BaselineConnectionOwner) -> int:
    cursor = connection.execute("SELECT count(*) FROM temp.ge_blr_relation_keys")
    try:
        row = cursor.fetchone()
    finally:
        cursor.close()
    assert row is not None
    value = row[0]
    assert isinstance(value, int)
    return value


def _populate_all_kinds(connection: SQLiteV1BaselineConnectionOwner) -> None:
    add_checkpoint_history(connection)
    connection.execute(
        "UPDATE ge_cycle_checkpoints SET checkpoint_revision = 1"
    ).close()
    connection.execute(
        "DELETE FROM ge_cycle_checkpoint_revisions WHERE revision <> 1"
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_leases
           (tenant_id, stream_id, active_lease_id, active_holder_id,
            active_lease_epoch, active_fencing_token, active_acquired_at_ms,
            active_expires_at_ms, last_lease_epoch, last_fencing_token,
            updated_at_ms)
           VALUES ('tenant-a', 'stream-a', 'lease-a', 'holder-a',
                   1, 1, 900, 1100, 1, 1, ?)""",
        (NOW,),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_used_lease_ids
           (tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
            first_used_at_ms)
           VALUES ('tenant-a', 'stream-a', 'lease-a', 1, 1, ?)""",
        (NOW,),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_legal_holds
           (tenant_id, stream_id, hold_id, placed_at_ms)
           VALUES ('tenant-a', 'stream-a', 'hold-a', ?)""",
        (NOW,),
    ).close()
    connection.execute(
        """UPDATE ge_cycle_migration_lock
              SET last_lock_epoch = 1, last_fencing_token = 1
            WHERE singleton = 1"""
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_used_migration_lock_ids
           (lock_id, lock_epoch, fencing_token, first_used_at_ms)
           VALUES ('lock-a', 1, 1, ?)""",
        (NOW,),
    ).close()
    insert_legacy_operation(connection, operation_id="operation-a")
    connection.commit()


def _populate_1_024_mixed_entries(connection: SQLiteV1BaselineConnectionOwner) -> None:
    for index in range(510):
        connection.execute(
            """INSERT INTO ge_cycle_streams
               (tenant_id, stream_id, tail_sequence, tail_record_hash,
                created_at_ms, updated_at_ms)
               VALUES ('tenant-scale', ?, -1, NULL, ?, ?)""",
            (f"stream-{index:04d}", NOW, NOW),
        ).close()
    for index in range(511):
        connection.execute(
            """INSERT INTO ge_cycle_legal_holds
               (tenant_id, stream_id, hold_id, placed_at_ms)
               VALUES ('tenant-scale', ?, ?, ?)""",
            (f"stream-{index % 510:04d}", f"hold-{index:04d}", NOW),
        ).close()
    connection.commit()


def test_streams_real_all_twelve_kind_source_with_exact_pairs_and_coverage() -> None:
    connection = database()
    try:
        _populate_all_kinds(connection)
        configure_sqlite_v1_baseline_temp_storage(connection)
        connection.execute("BEGIN EXCLUSIVE").close()
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        summary = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
        assert set(summary.counts_by_kind.values()) != {0}
        assert all(summary.counts_by_kind[kind] > 0 for kind in summary.counts_by_kind)
        before = connection.total_changes

        written = _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)

        assert written == summary.expected_entry_count == 12
        assert connection.total_changes == before + 2 * written
        assert stage.common_entry_count == written
        assert stage.state == "open"
        assert stage._cooperative_pending_receipt is None
        assert summary._identity_iteration_state.completed
        stage.dispose()
    finally:
        connection.rollback()
        connection.close()


def test_streams_1_024_mixed_entries_one_row_at_a_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = database()
    try:
        _populate_1_024_mixed_entries(connection)
        configure_sqlite_v1_baseline_temp_storage(connection)
        connection.execute("BEGIN EXCLUSIVE").close()
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        summary = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
        assert summary.expected_entry_count == 1_024

        def forbidden_fetchmany(
            _cursor: _SQLiteCursorCapability,
            _size: int,
        ) -> list[tuple[object, ...]]:
            raise AssertionError("cooperative source must fetch exactly one row")

        monkeypatch.setattr(_SQLiteCursorCapability, "fetchmany", forbidden_fetchmany)
        before = connection.total_changes
        assert _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage) == 1_024
        assert connection.total_changes == before + 2_048
        assert stage.common_entry_count == 1_024
        assert stage._cooperative_pending_receipt is None
        stage.dispose()
    finally:
        connection.rollback()
        connection.close()


def test_early_walker_close_finalizes_cursor_and_poisons_both_sides(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    closed = 0
    original_close = _SQLiteCursorCapability.close

    def observed_close(cursor: _SQLiteCursorCapability) -> None:
        nonlocal closed
        closed += 1
        original_close(cursor)

    monkeypatch.setattr(_SQLiteCursorCapability, "close", observed_close)
    try:
        walker = summary._cooperative_identity_entries(
            stage._cooperative_stage_session,
            stage._poison_cooperative_state,
        )
        next(walker)
        walker.close()
        assert closed == 1
        assert summary._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


@pytest.mark.parametrize("attack", ["missing", "replay", "foreign"])
def test_wrong_or_replayed_receipt_is_terminal(attack: str) -> None:
    connection, summary, stage = _prepare_minimal()
    other: SQLiteV1BaselineConnectionOwner | None = None
    try:
        walker = summary._cooperative_identity_entries(
            stage._cooperative_stage_session,
            stage._poison_cooperative_state,
        )
        item = next(walker)
        receipt = stage._insert_cooperative_entry(item)
        presented: object = None
        if attack == "replay":
            next_item = walker.send(receipt)
            assert receipt._consumed
            item = next_item
            presented = receipt
        elif attack == "foreign":
            other, other_summary, other_stage = _prepare_minimal()
            other_walker = other_summary._cooperative_identity_entries(
                other_stage._cooperative_stage_session,
                other_stage._poison_cooperative_state,
            )
            foreign_item = next(other_walker)
            presented = other_stage._insert_cooperative_entry(foreign_item)
            other_walker.close()
        with pytest.raises(ValueError, match=r"BLR_COOP_(RECEIPT|SOURCE_CHANGED)"):
            walker.send(presented)  # type: ignore[arg-type]
        assert stage.state == "poisoned"
        assert summary._identity_iteration_state.poisoned
        with pytest.raises(StopIteration):
            walker.send(receipt)
    finally:
        connection.rollback()
        connection.close()
        if other is not None:
            other.rollback()
            other.close()


def test_external_dml_after_pair_before_receipt_consume_is_not_allowed() -> None:
    connection, summary, stage = _prepare_minimal()
    try:
        walker = summary._cooperative_identity_entries(
            stage._cooperative_stage_session,
            stage._poison_cooperative_state,
        )
        item = next(walker)
        receipt = stage._insert_cooperative_entry(item)
        connection.execute(
            "UPDATE ge_cycle_migration_lock SET updated_at_ms = updated_at_ms + 1"
        ).close()
        with pytest.raises(ValueError, match="BLR_COOP_SOURCE_CHANGED"):
            walker.send(receipt)
        assert stage.state == "poisoned"
        assert summary._identity_iteration_state.poisoned
    finally:
        connection.rollback()
        connection.close()


def test_external_dml_before_common_is_rejected_by_coordinator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    original = SQLiteV1BaselineTempStage._insert_cooperative_entry

    def injected(
        active_stage: SQLiteV1BaselineTempStage,
        item: object,
    ) -> _CooperativeWriteReceipt:
        connection.execute(
            "UPDATE ge_cycle_migration_lock SET updated_at_ms = updated_at_ms + 1"
        ).close()
        return original(active_stage, item)  # type: ignore[arg-type]

    monkeypatch.setattr(SQLiteV1BaselineTempStage, "_insert_cooperative_entry", injected)
    try:
        with pytest.raises(ValueError, match="BLR_UNEXPLAINED_WRITE"):
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert stage.state == "poisoned"
        assert summary._identity_iteration_state.poisoned
    finally:
        connection.rollback()
        connection.close()


def test_external_dml_after_relation_before_receipt_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    issue = _issue_cooperative_write_receipt

    def injected_receipt(
        item: _CooperativeSourceItem,
        stage_session: object,
        after_total_changes: int,
    ) -> _CooperativeWriteReceipt:
        connection.execute(
            "UPDATE ge_cycle_migration_lock SET updated_at_ms = updated_at_ms + 1"
        ).close()
        return issue(item, stage_session, after_total_changes)

    monkeypatch.setattr(stage_module, "_issue_cooperative_write_receipt", injected_receipt)
    try:
        with pytest.raises(ValueError, match="BLR_UNEXPLAINED_WRITE"):
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert stage.state == "poisoned"
        assert summary._identity_iteration_state.poisoned
    finally:
        connection.rollback()
        connection.close()


def test_external_dml_between_common_and_relation_is_terminal_with_exact_delta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    injected = False

    def inject_between_pair(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal injected
        if not injected and "INSERT INTO temp.ge_blr_schema" in sql:
            injected = True
            original_execute(
                owner,
                "UPDATE ge_cycle_migration_lock SET updated_at_ms = updated_at_ms + 1",
            ).close()
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", inject_between_pair)
    before = connection.total_changes
    try:
        with pytest.raises(ValueError, match="paired TEMP stage insert changed") as raised:
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert str(raised.value) == (
            "BLR_STAGE_WRITE_COUNT: paired TEMP stage insert changed the wrong count"
        )
        assert injected
        assert connection.total_changes == before + 3
        assert _common_count(connection) == 1
        assert _relation_count(connection) == 1
        assert summary._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


def test_external_dml_during_receipt_validation_is_terminal_with_exact_delta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    original_consume = SQLiteV1BaselineSourceSummary._consume_cooperative_receipt
    injected = False

    def inject_during_validation(
        active_summary: SQLiteV1BaselineSourceSummary,
        item: _CooperativeSourceItem,
        receipt: _CooperativeWriteReceipt,
        expected_total_changes: int,
    ) -> int:
        nonlocal injected
        if not injected:
            injected = True
            connection.execute(
                "UPDATE ge_cycle_migration_lock SET updated_at_ms = updated_at_ms + 1"
            ).close()
        return original_consume(active_summary, item, receipt, expected_total_changes)

    monkeypatch.setattr(
        SQLiteV1BaselineSourceSummary,
        "_consume_cooperative_receipt",
        inject_during_validation,
    )
    before = connection.total_changes
    try:
        with pytest.raises(ValueError, match="BLR_COOP_SOURCE_CHANGED") as raised:
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert str(raised.value) == (
            "BLR_COOP_SOURCE_CHANGED: cooperative source transaction changed"
        )
        assert injected
        assert connection.total_changes == before + 3
        assert _common_count(connection) == 1
        assert _relation_count(connection) == 1
        assert summary._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


def test_external_dml_between_receipt_and_next_source_fetch_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    original_consume = SQLiteV1BaselineSourceSummary._consume_cooperative_receipt
    injected = False

    def inject_before_next_fetch(
        active_summary: SQLiteV1BaselineSourceSummary,
        item: _CooperativeSourceItem,
        receipt: _CooperativeWriteReceipt,
        expected_total_changes: int,
    ) -> int:
        nonlocal injected
        accepted = original_consume(active_summary, item, receipt, expected_total_changes)
        if not injected:
            injected = True
            connection.execute(
                "UPDATE ge_cycle_migration_lock SET updated_at_ms = updated_at_ms + 1"
            ).close()
        return accepted

    monkeypatch.setattr(
        SQLiteV1BaselineSourceSummary,
        "_consume_cooperative_receipt",
        inject_before_next_fetch,
    )
    before = connection.total_changes
    try:
        with pytest.raises(ValueError, match="BLR_COOP_SOURCE_CHANGED") as raised:
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert str(raised.value) == (
            "BLR_COOP_SOURCE_CHANGED: cooperative source transaction changed"
        )
        assert injected
        assert connection.total_changes == before + 3
        assert _common_count(connection) == 1
        assert _relation_count(connection) == 1
        assert summary._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


@pytest.mark.parametrize("attack", ["execute-ddl", "executescript-ddl"])
def test_prepared_or_trusted_ddl_epoch_change_is_terminal(
    attack: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    original = SQLiteV1BaselineTempStage._insert_cooperative_entry

    def inject_ddl(
        active_stage: SQLiteV1BaselineTempStage,
        item: _CooperativeSourceItem,
    ) -> _CooperativeWriteReceipt:
        if attack == "execute-ddl":
            connection.execute("CREATE TEMP TABLE hostile_prepared(value INTEGER)").close()
        else:
            connection.executescript("CREATE TEMP TABLE hostile_trusted(value INTEGER);")
        return original(active_stage, item)

    monkeypatch.setattr(SQLiteV1BaselineTempStage, "_insert_cooperative_entry", inject_ddl)
    before = connection.total_changes
    try:
        with pytest.raises(
            ValueError,
            match=r"BLR_(TRANSACTION_CHANGED|EXCLUSIVE_TRANSACTION_REQUIRED)",
        ):
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert connection.total_changes == before
        assert summary._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


@pytest.mark.parametrize("field", ["before", "after", "epoch", "sequence"])
def test_individually_forged_receipt_binding_is_terminal_with_owned_delta(
    field: str,
) -> None:
    connection, summary, stage = _prepare_minimal()
    before = connection.total_changes
    try:
        walker = summary._cooperative_identity_entries(
            stage._cooperative_stage_session,
            stage._poison_cooperative_state,
        )
        item = next(walker)
        receipt = stage._insert_cooperative_entry(item)
        if field == "before":
            receipt._before_total_changes += 1
        elif field == "after":
            receipt._after_total_changes += 1
        elif field == "epoch":
            receipt._transaction_epoch += 1
        else:
            receipt._sequence += 1

        with pytest.raises(ValueError, match="BLR_COOP_RECEIPT") as raised:
            walker.send(receipt)
        assert str(raised.value) == "BLR_COOP_RECEIPT: cooperative write receipt is invalid"
        assert connection.total_changes == before + 2
        assert _common_count(connection) == 1
        assert _relation_count(connection) == 1
        assert summary._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
        with pytest.raises(StopIteration):
            walker.send(receipt)
    finally:
        connection.rollback()
        connection.close()


def test_handshake_rejects_summary_before_stage_and_prior_standalone_write() -> None:
    connection = database()
    try:
        configure_sqlite_v1_baseline_temp_storage(connection)
        connection.execute("BEGIN EXCLUSIVE").close()
        summary = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        with pytest.raises(ValueError, match="BLR_COOP_HANDSHAKE"):
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert summary._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()

    connection, summary, stage = _prepare_minimal()
    try:
        entries = {entry.entry_kind: entry for entry in summary.iter_identity_entries()}
        entry = entries["schema-envelope"]
        stage.insert_entry_with_relation(entry)
        fresh = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
        with pytest.raises(ValueError, match="BLR_COOP_HANDSHAKE"):
            _stream_sqlite_v1_baseline_source_into_temp_stage(fresh, stage)
        assert fresh._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


@pytest.mark.parametrize("attack", ["savepoint", "rollback-rebegin"])
def test_transaction_epoch_change_is_terminal(
    attack: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    original = SQLiteV1BaselineTempStage._insert_cooperative_entry

    def changed_epoch(
        active_stage: SQLiteV1BaselineTempStage,
        item: object,
    ) -> _CooperativeWriteReceipt:
        if attack == "savepoint":
            connection.execute("SAVEPOINT hostile").close()
        else:
            connection.rollback()
            connection.execute("BEGIN EXCLUSIVE").close()
        return original(active_stage, item)  # type: ignore[arg-type]

    monkeypatch.setattr(SQLiteV1BaselineTempStage, "_insert_cooperative_entry", changed_epoch)
    try:
        with pytest.raises(ValueError, match=r"BLR_(TRANSACTION_CHANGED|EXCLUSIVE)"):
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert summary._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


def test_legacy_carrier_mutation_between_capture_and_projection_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = database()
    _populate_all_kinds(connection)
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("BEGIN EXCLUSIVE").close()
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    summary = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
    original = SQLiteV1BaselineTempStage._insert_cooperative_entry
    mutated = False

    def mutate_legacy(
        active_stage: SQLiteV1BaselineTempStage,
        item: object,
    ) -> _CooperativeWriteReceipt:
        nonlocal mutated
        cooperative_item = item  # preserve the exact opaque item for the owned call
        if (
            type(cooperative_item) is _CooperativeSourceItem
            and cooperative_item._entry.entry_kind == "legacy-operation"
        ):
            mutated = True
            connection.execute(
                """UPDATE ge_cycle_operations
                      SET request_hash = ?
                    WHERE tenant_id = 'tenant-a' AND operation_id = 'operation-a'""",
                ("2" * 64,),
            ).close()
        return original(active_stage, cooperative_item)  # type: ignore[arg-type]

    monkeypatch.setattr(SQLiteV1BaselineTempStage, "_insert_cooperative_entry", mutate_legacy)
    try:
        with pytest.raises(ValueError, match="BLR_UNEXPLAINED_WRITE"):
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert mutated
        assert summary._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


def test_relation_failure_keeps_common_evidence_and_preserves_primary_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def failing_relation(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        if "INSERT INTO temp.ge_blr_schema" in sql:
            raise sqlite3.OperationalError("primary-relation-failure")
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", failing_relation)
    before = connection.total_changes
    try:
        with pytest.raises(ValueError, match="normalized TEMP relation insert failed") as raised:
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert str(raised.value) == "BLR_STAGE_WRITE_COUNT: normalized TEMP relation insert failed"
        assert connection.total_changes == before + 1
        assert stage.state == "poisoned"
        assert summary._identity_iteration_state.poisoned
    finally:
        connection.rollback()
        connection.close()


def test_cleanup_poison_failures_never_replace_primary_relation_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def failing_relation(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        if "INSERT INTO temp.ge_blr_schema" in sql:
            raise sqlite3.OperationalError("authoritative-relation-failure")
        return original_execute(owner, sql, parameters)

    def failing_source_poison(_summary: SQLiteV1BaselineSourceSummary) -> None:
        raise RuntimeError("secondary-source-poison-failure")

    def failing_stage_poison(_stage: SQLiteV1BaselineTempStage) -> None:
        raise RuntimeError("secondary-stage-poison-failure")

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", failing_relation)
    monkeypatch.setattr(
        SQLiteV1BaselineSourceSummary,
        "_poison_cooperative_state",
        failing_source_poison,
    )
    monkeypatch.setattr(
        SQLiteV1BaselineTempStage,
        "_poison_cooperative_state",
        failing_stage_poison,
    )
    before = connection.total_changes
    try:
        with pytest.raises(ValueError) as raised:
            _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert str(raised.value) == (
            "BLR_STAGE_WRITE_COUNT: normalized TEMP relation insert failed"
        )
        assert isinstance(raised.value.__context__, sqlite3.OperationalError)
        assert str(raised.value.__context__) == "authoritative-relation-failure"
        assert connection.total_changes == before + 1
        assert _common_count(connection) == 1
        assert _relation_count(connection) == 0
        assert summary._identity_iteration_state.poisoned
        assert stage.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


def test_direct_common_write_during_pending_receipt_is_terminal() -> None:
    connection, summary, stage = _prepare_minimal()
    try:
        walker = summary._cooperative_identity_entries(
            stage._cooperative_stage_session,
            stage._poison_cooperative_state,
        )
        item = next(walker)
        stage._insert_cooperative_entry(item)
        before = _common_count(connection)

        with pytest.raises(ValueError, match="direct common writes cannot enter"):
            stage.insert_common_entry(item._entry)

        after = _common_count(connection)
        assert before == after == 1
        assert stage.state == "poisoned"
        walker.close()
    finally:
        connection.rollback()
        connection.close()


def test_direct_common_write_after_cooperative_completion_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _prepare_minimal()
    original = SQLiteV1BaselineTempStage._insert_cooperative_entry
    retained: list[_CooperativeSourceItem] = []

    def capture_item(
        active_stage: SQLiteV1BaselineTempStage,
        item: _CooperativeSourceItem,
    ) -> _CooperativeWriteReceipt:
        if not retained:
            retained.append(item)
        return original(active_stage, item)

    monkeypatch.setattr(SQLiteV1BaselineTempStage, "_insert_cooperative_entry", capture_item)
    try:
        written = _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        assert retained
        before = _common_count(connection)

        with pytest.raises(ValueError, match="direct common writes cannot enter"):
            stage.insert_common_entry(retained[0]._entry)

        after = _common_count(connection)
        assert before == after == written
        assert stage.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()
