from __future__ import annotations

import copy
import gc
import hashlib
import json
import pickle
from dataclasses import replace
from pathlib import Path
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_operation_baseline_cursor_stage_ownership as ownership
import graph_engineering.sqlite_operation_baseline_stage as stage_module
from graph_engineering.sqlite_cursor_publication_migration_0002_asset import (
    _load_sqlite_cursor_migration_0002_asset_intrinsic,
    _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic,
)
from graph_engineering.sqlite_operation_baseline import BaselineProjectionIdentity
from graph_engineering.sqlite_operation_baseline_cursor_campaign import (
    _run_sqlite_cursor_pre_rebind_campaign,
)
from graph_engineering.sqlite_operation_baseline_cursor_ownership import (
    SQLiteCursorPreRebindReceipt,
)
from graph_engineering.sqlite_operation_baseline_cursor_source_fence import (
    _assert_sqlite_cursor_captured_source_connection_provenance,
)
from graph_engineering.sqlite_operation_baseline_cursor_stage_ownership import (
    _assert_sqlite_cursor_stage_ownership_initial_publication_adopted_intrinsic,
    _assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic,
    _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic,
    _assert_sqlite_cursor_stage_ownership_post_ddl_reader_terminal_intrinsic,
    _assert_sqlite_cursor_stage_ownership_pre_rebind_complete_intrinsic,
    _assert_sqlite_cursor_stage_ownership_transfer,
    _begin_sqlite_cursor_stage_ownership_transfer,
    _complete_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic,
    _create_sqlite_cursor_seal_temp_table,
    _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic,
    _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic,
    _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic,
    _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _register_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic,
    _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _SQLiteCursorStageOwnershipTransfer,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)
from graph_engineering.sqlite_operation_baseline_stage import (
    _SQLITE_V1_CURSOR_SEAL_XINFO,
    SQLITE_CURSOR_INITIAL_PUBLICATION_TARGET_CATALOG_SHA256,
    SQLITE_V1_CURSOR_SEAL_SQLITE_SCHEMA_SQL,
    SQLITE_V1_CURSOR_SEAL_TEMP_TABLE_DDL,
    SQLITE_V1_CURSOR_SEAL_TEMP_TABLE_DDL_SHA256,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorInitialPublicationOuterLedgerWatermark,
    _SQLiteCursorInitialPublicationStageWatermark,
)
from tests.test_sqlite_operation_baseline_checkpoint_invariants import _cleanup
from tests.test_sqlite_operation_baseline_cursor_source_fence import (
    _mint_receipt,
    _prepared_fence,
)


def _cursor_temp_objects(connection: SQLiteV1BaselineConnectionOwner) -> tuple[str, ...]:
    cursor = connection.execute(
        "SELECT name FROM temp.sqlite_schema WHERE lower(name) LIKE 'ge_blr_cursor%' ORDER BY name"
    )
    try:
        names: list[str] = []
        while True:
            row = cursor.fetchone()
            if row is None:
                return tuple(names)
            names.append(str(row[0]))
    finally:
        cursor.close()


def _one_row(
    connection: SQLiteV1BaselineConnectionOwner,
    sql: str,
    parameters: tuple[object, ...] = (),
) -> tuple[object, ...]:
    cursor = connection.execute(sql, parameters)
    try:
        row = cursor.fetchone()
        assert row is not None
        assert cursor.fetchone() is None
        return row
    finally:
        cursor.close()


def _reserved_temp_count(connection: SQLiteV1BaselineConnectionOwner) -> int:
    row = _one_row(
        connection,
        "SELECT count(*) FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_'",
    )
    assert len(row) == 1 and type(row[0]) is int
    return row[0]


def _completed_b2_graph() -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    SQLiteCursorPreRebindReceipt,
    BaselineProjectionIdentity,
    _SQLiteCursorStageOwnershipTransfer,
]:
    connection, _summary, stage, identity, receipt = _prepared_fence()
    transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
    _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
    outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
    assert outcome.status == "pre-rebind-complete"
    assert outcome.projection_identity is identity
    return connection, stage, receipt, identity, transfer


def _owned_outer_graph() -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    SQLiteCursorPreRebindReceipt,
    BaselineProjectionIdentity,
    _SQLiteCursorStageOwnershipTransfer,
    object,
]:
    connection, stage, receipt, identity, transfer = _completed_b2_graph()
    mint = _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic(
        connection, stage, receipt, identity, transfer
    )
    _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic(
        connection,
        stage,
        receipt,
        identity,
        transfer,
        mint.authority,
        mint.tail,
    )
    _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic(mint.tail)
    _assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic(
        connection, stage, receipt, identity, transfer, mint.authority
    )
    return connection, stage, receipt, identity, transfer, mint.authority


def _adoption_watermark(
    connection: SQLiteV1BaselineConnectionOwner,
    affected_rows_watermark: int,
    fixed_statement_count: int,
) -> _SQLiteCursorInitialPublicationStageWatermark:
    return _SQLiteCursorInitialPublicationStageWatermark(
        _SQLiteCursorInitialPublicationOuterLedgerWatermark(
            affected_rows_watermark,
            fixed_statement_count,
            4,
        ),
        SQLITE_CURSOR_INITIAL_PUBLICATION_TARGET_CATALOG_SHA256,
        connection.total_changes,
        connection.transaction_epoch,
    )


def _apply_real_migration_0002(
    connection: SQLiteV1BaselineConnectionOwner,
) -> tuple[int, int]:
    asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()
    snapshot = _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(asset)
    affected_rows = 0
    for statement in snapshot.statements:
        before_changes = connection.total_changes
        connection.execute(statement).close()
        affected_rows += connection.total_changes - before_changes
    return affected_rows, snapshot.fixed_statement_count


def test_outer_publication_tail_is_armed_once_replay_safe_and_weakrefable() -> None:
    connection, stage, receipt, identity, transfer = _completed_b2_graph()
    try:
        assert (
            _assert_sqlite_cursor_stage_ownership_pre_rebind_complete_intrinsic(
                connection, stage, receipt, identity, transfer
            )
            is transfer
        )
        mint = _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic(
            connection, stage, receipt, identity, transfer
        )
        repeated = _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic(
            connection, stage, receipt, identity, transfer
        )
        assert repeated is not mint
        assert repeated.authority is mint.authority
        assert repeated.tail is mint.tail
        assert ref(mint.authority)() is mint.authority
        with pytest.raises(ValueError, match="outer publication tail is invalid"):
            _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic(mint.tail)
        _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic(
            connection,
            stage,
            receipt,
            identity,
            transfer,
            mint.authority,
            mint.tail,
        )
        _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic(mint.tail)
        assert (
            _assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic(
                connection,
                stage,
                receipt,
                identity,
                transfer,
                mint.authority,
            )
            is transfer
        )
        with pytest.raises(ValueError, match="outer publication tail is invalid"):
            _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic(mint.tail)
        assert (
            _assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic(
                connection,
                stage,
                receipt,
                identity,
                transfer,
                mint.authority,
            )
            is transfer
        )
    finally:
        _cleanup(connection, stage)


def test_outer_mint_transfer_and_stage_graph_is_collectable_after_cleanup() -> None:
    gc.collect()
    transfers_before = len(ownership._TRANSFERS)
    connection, stage, receipt, identity, transfer = _completed_b2_graph()
    mint = _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic(
        connection, stage, receipt, identity, transfer
    )
    authority_reference = ref(mint.authority)
    transfer_reference = ref(transfer)
    stage_reference = ref(stage)
    assert len(ownership._TRANSFERS) == transfers_before + 1

    _cleanup(connection, stage)
    del mint
    del transfer
    del stage
    del connection
    del receipt
    del identity
    gc.collect()
    gc.collect()

    assert authority_reference() is None
    assert transfer_reference() is None
    assert stage_reference() is None
    assert len(ownership._TRANSFERS) == transfers_before


def test_lost_outer_authority_makes_live_tail_terminally_invalid() -> None:
    connection, stage, receipt, identity, transfer = _completed_b2_graph()
    try:
        mint = _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic(
            connection, stage, receipt, identity, transfer
        )
        _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic(
            connection,
            stage,
            receipt,
            identity,
            transfer,
            mint.authority,
            mint.tail,
        )
        authority_reference = ref(mint.authority)
        tail = mint.tail
        del mint
        gc.collect()
        gc.collect()

        assert authority_reference() is None
        with pytest.raises(ValueError, match="outer publication tail is invalid"):
            _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic(tail)
        with pytest.raises(ValueError, match="outer publication authority is invalid"):
            _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic(
                connection, stage, receipt, identity, transfer
            )
        with pytest.raises(ValueError, match="outer publication tail is invalid"):
            _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic(tail)
    finally:
        _cleanup(connection, stage)


def test_retire_burns_armed_outer_tail_without_reviving_transfer() -> None:
    connection, stage, receipt, identity, transfer = _completed_b2_graph()
    try:
        mint = _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic(
            connection, stage, receipt, identity, transfer
        )
        _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic(
            connection,
            stage,
            receipt,
            identity,
            transfer,
            mint.authority,
            mint.tail,
        )
        _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic(transfer, mint.authority)
        with pytest.raises(ValueError, match="outer publication tail is invalid"):
            _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic(mint.tail)
        with pytest.raises(ValueError, match="transfer context is invalid"):
            _assert_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt, transfer)
        assert stage._cursor_outer_publication_state == "retired"
    finally:
        _cleanup(connection, stage)


def test_reader_terminal_and_adoption_tails_are_exact_single_use() -> None:
    connection, stage, receipt, identity, transfer, authority = _owned_outer_graph()
    lease = object()
    cleanup_calls = 0

    def cleanup() -> None:
        nonlocal cleanup_calls
        cleanup_calls += 1

    try:
        _register_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic(
            transfer, authority, lease, cleanup
        )
        with pytest.raises(ValueError, match="reader is not terminal"):
            _assert_sqlite_cursor_stage_ownership_post_ddl_reader_terminal_intrinsic(
                transfer, authority, lease
            )
        _complete_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic(
            transfer, authority, lease, True
        )
        _assert_sqlite_cursor_stage_ownership_post_ddl_reader_terminal_intrinsic(
            transfer, authority, lease
        )
        assert cleanup_calls == 0

        affected_rows, statement_count = _apply_real_migration_0002(connection)
        watermark = _adoption_watermark(
            connection,
            affected_rows,
            statement_count,
        )
        mint = _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(
            connection,
            stage,
            receipt,
            identity,
            transfer,
            authority,
            lease,
            watermark,
        )
        repeated = _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(
            connection,
            stage,
            receipt,
            identity,
            transfer,
            authority,
            lease,
            watermark,
        )
        assert repeated is mint
        assert repeated.tail is mint.tail
        assert repeated.watermark is mint.watermark
        assert repeated.retired_b2_fence is mint.retired_b2_fence
        _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(mint.tail)
        assert (
            _assert_sqlite_cursor_stage_ownership_initial_publication_adopted_intrinsic(
                connection,
                stage,
                receipt,
                identity,
                transfer,
                authority,
                lease,
                mint.retired_b2_fence,
                mint.watermark,
            )
            is transfer
        )
        with pytest.raises(ValueError, match="adoption tail is invalid"):
            _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(mint.tail)
        assert (
            _assert_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt, transfer)
            is transfer
        )
    finally:
        _cleanup(connection, stage)


def test_poison_closes_active_reader_once_and_burns_outer_tail() -> None:
    connection, stage, receipt, identity, transfer = _completed_b2_graph()
    cleanup_calls = 0

    def cleanup() -> None:
        nonlocal cleanup_calls
        cleanup_calls += 1

    try:
        mint = _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic(
            connection, stage, receipt, identity, transfer
        )
        _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic(
            connection,
            stage,
            receipt,
            identity,
            transfer,
            mint.authority,
            mint.tail,
        )
        _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic(mint.tail)
        lease = object()
        _register_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic(
            transfer, mint.authority, lease, cleanup
        )
        with pytest.raises(ValueError, match="forced ownership poison"):
            _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic(
                transfer, mint.authority, "forced ownership poison"
            )
        assert cleanup_calls == 1
        assert stage.state == "poisoned"
        with pytest.raises(ValueError, match="outer publication authority is invalid"):
            _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic(
                transfer, mint.authority, "replay"
            )
        assert cleanup_calls == 1
    finally:
        _cleanup(connection, stage)


def test_stage_dispose_then_ownership_retire_attempts_reader_cleanup_exactly_once() -> None:
    connection, stage, _receipt, _identity, transfer, authority = _owned_outer_graph()
    lease = object()
    cleanup_calls = 0

    def cleanup() -> None:
        nonlocal cleanup_calls
        cleanup_calls += 1

    try:
        _register_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic(
            transfer,
            authority,
            lease,
            cleanup,
        )
        stage.dispose()
        assert cleanup_calls == 1
        _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic(
            transfer,
            authority,
        )
        assert cleanup_calls == 1
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("terminal_action", ["retire", "poison"])
def test_terminal_outer_action_burns_prepared_adoption_tail(
    terminal_action: str,
) -> None:
    connection, stage, receipt, identity, transfer, authority = _owned_outer_graph()
    lease = object()
    try:
        _register_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic(
            transfer, authority, lease, lambda: None
        )
        _complete_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic(
            transfer, authority, lease, True
        )
        affected_rows, statement_count = _apply_real_migration_0002(connection)
        watermark = _adoption_watermark(
            connection,
            affected_rows,
            statement_count,
        )
        mint = _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(
            connection,
            stage,
            receipt,
            identity,
            transfer,
            authority,
            lease,
            watermark,
        )

        if terminal_action == "retire":
            _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic(transfer, authority)
            assert stage._cursor_outer_publication_state == "retired"
        else:
            with pytest.raises(ValueError, match="terminal adoption poison"):
                _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic(
                    transfer, authority, "terminal adoption poison"
                )
            assert stage.state == "poisoned"

        with pytest.raises(ValueError, match="adoption tail is invalid"):
            _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(mint.tail)
        with pytest.raises(ValueError, match="transfer context is invalid"):
            _assert_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt, transfer)
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_lower_stage_adoption_publish_drift_terminally_poisons_outer_wrapper() -> None:
    connection, stage, receipt, identity, transfer, authority = _owned_outer_graph()
    lease = object()
    try:
        _register_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic(
            transfer, authority, lease, lambda: None
        )
        _complete_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic(
            transfer, authority, lease, True
        )
        affected_rows, statement_count = _apply_real_migration_0002(connection)
        watermark = _adoption_watermark(connection, affected_rows, statement_count)
        mint = _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(
            connection,
            stage,
            receipt,
            identity,
            transfer,
            authority,
            lease,
            watermark,
        )

        connection.execute("CREATE TABLE hostile_after_adoption_prepare(value INTEGER)").close()
        with pytest.raises(ValueError, match="BLR_TRANSACTION_CHANGED"):
            _ = stage.common_entry_count
        assert stage.state == "poisoned"
        with pytest.raises(
            ValueError,
            match="SQLite cursor initial publication adoption tail is invalid",
        ) as failure:
            _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(mint.tail)

        assert failure.traceback[-1].name == "_publish_cursor_initial_publication_adoption"
        metadata = ownership._TRANSFERS.get(transfer)
        assert metadata is not None and metadata.lifecycle == "poisoned"
        with pytest.raises(ValueError, match="adoption tail is invalid"):
            _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(mint.tail)
        with pytest.raises(ValueError, match="adoption owner is invalid"):
            _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(
                connection,
                stage,
                receipt,
                identity,
                transfer,
                authority,
                lease,
                watermark,
            )
        with pytest.raises(ValueError, match="transfer context is invalid"):
            _assert_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt, transfer)
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_complete_real_lifecycle_transfers_once_without_sql_epoch_or_change() -> None:
    connection, summary, stage, identity, receipt = _prepared_fence()
    try:
        before_epoch = connection.transaction_epoch
        before_changes = connection.total_changes
        before_objects = _cursor_temp_objects(connection)
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(
            connection,
            stage,
            receipt,
        )
        assert type(transfer) is _SQLiteCursorStageOwnershipTransfer
        assert not hasattr(transfer, "__dict__")
        assert stage._cooperative_summary is summary
        assert stage._ordered_projection_identity is identity
        assert stage._cursor_transfer_state == "active"
        assert stage._cursor_transfer_capture_epoch == summary._captured_transaction_epoch
        assert stage._cursor_transfer_stage_epoch == before_epoch
        assert stage._cursor_transfer_allowed_total_changes == before_changes
        assert summary._source_total_changes < before_changes
        assert connection.transaction_epoch == before_epoch
        assert connection.total_changes == before_changes
        assert _cursor_temp_objects(connection) == before_objects == ()
        assert (
            _assert_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                receipt,
                transfer,
            )
            is transfer
        )
        assert (
            _assert_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                receipt,
                transfer,
            )
            is transfer
        )
        assert connection.transaction_epoch == before_epoch
        assert connection.total_changes == before_changes
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:transfer-clone"])
def test_transfer_is_exact_registered_identity_and_registry_is_weak(
    _b2_case: None,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        gc.collect()
        before = len(ownership._TRANSFERS)
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert len(ownership._TRANSFERS) == before + 1
        clones = [
            copy.copy(transfer),
            copy.deepcopy(transfer),
            _SQLiteCursorStageOwnershipTransfer(ownership._CONSTRUCTION_TOKEN),
        ]
        for clone in clones:
            assert clone is not transfer
            with pytest.raises(ValueError, match="transfer provenance"):
                _assert_sqlite_cursor_stage_ownership_transfer(
                    connection,
                    stage,
                    receipt,
                    clone,
                )
        try:
            pickled_clone = pickle.loads(pickle.dumps(transfer))
        except (TypeError, pickle.PickleError):
            pickled_clone = None
        if pickled_clone is not None:
            with pytest.raises(ValueError, match="transfer provenance"):
                _assert_sqlite_cursor_stage_ownership_transfer(
                    connection,
                    stage,
                    receipt,
                    pickled_clone,
                )
        transfer_reference = ref(transfer)
        del transfer
        del clones
        del pickled_clone
        gc.collect()
        assert transfer_reference() is None
        assert len(ownership._TRANSFERS) == before
    finally:
        _cleanup(connection, stage)


def test_stage_factory_registration_rejects_copied_and_direct_stages() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        copied_stage = copy.copy(stage)
        assert type(copied_stage) is SQLiteV1BaselineTempStage
        with pytest.raises(ValueError, match="stage provenance"):
            _begin_sqlite_cursor_stage_ownership_transfer(
                connection,
                copied_stage,
                receipt,
            )
        assert stage.state == "open"
        assert stage._cursor_transfer_state == "unused"
    finally:
        _cleanup(connection, stage)


def test_replaced_b0a_witness_is_rejected_before_stage_state() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        witness = _assert_sqlite_cursor_captured_source_connection_provenance(
            connection,
            receipt,
        )
        clone = replace(witness)
        with pytest.raises(ValueError, match="witness provenance"):
            stage._begin_cursor_stage_transfer(connection, receipt, clone)
        assert stage.state == "open"
        assert stage._cursor_transfer_state == "unused"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:projection-clone"])
def test_equal_value_projection_clone_cannot_bind_the_stage(_b2_case: None) -> None:
    connection, summary, stage, identity, _receipt = _prepared_fence()
    try:
        cloned_identity = replace(identity)
        assert cloned_identity == identity
        assert cloned_identity is not identity
        cloned_receipt = _mint_receipt(summary, cloned_identity)
        with pytest.raises(ValueError, match="predecessors are incomplete"):
            _begin_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                cloned_receipt,
            )
        assert stage.state == "poisoned"
        assert _cursor_temp_objects(connection) == ()
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    "field",
    [
        "_ordered_handoff_completed",
        "_stream_record_campaign_completed",
        "_checkpoint_campaign_completed",
        "_lease_lock_hold_campaign_completed",
        "_legacy_campaign_completed",
    ],
    ids=[
        "ordered-handoff-incomplete",
        "stream-record-campaign-incomplete",
        "checkpoint-campaign-incomplete",
        "lease-lock-hold-campaign-incomplete",
        "b2:before-legacy-complete",
    ],
)
def test_each_incomplete_predecessor_campaign_burns_transfer(
    field: str,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        setattr(stage, field, False)
        with pytest.raises(ValueError, match="predecessors are incomplete"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert stage.state == "poisoned"
        assert stage._cursor_transfer_state == "poisoned"
        assert _cursor_temp_objects(connection) == ()
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("_ordered_handoff_reader", object()),
        ("_legacy_campaign_session", object()),
        ("_cooperative_write_active", True),
    ],
)
def test_active_predecessor_owner_slots_are_rejected(field: str, value: object) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        setattr(stage, field, value)
        with pytest.raises(ValueError, match="predecessors are incomplete"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert stage.state == "poisoned"
        assert _cursor_temp_objects(connection) == ()
    finally:
        # The synthetic reader is not a real closeable stage reader.
        if field == "_ordered_handoff_reader":
            stage._ordered_handoff_reader = None
        _cleanup(connection, stage)


def test_unexplained_temp_write_is_caught_by_stage_not_source_fence() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        witness = _assert_sqlite_cursor_captured_source_connection_provenance(
            connection,
            receipt,
        )
        before_epoch = connection.transaction_epoch
        connection.execute(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob "
            "WHERE key_blob = (SELECT key_blob FROM temp.ge_blr_stage LIMIT 1)"
        ).close()
        assert connection.transaction_epoch == before_epoch
        witness._assert_current()
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert stage.state == "poisoned"
        assert _cursor_temp_objects(connection) == ()
    finally:
        _cleanup(connection, stage)


def test_rollback_rebegin_and_wrong_connection_fail_before_stage_begin() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    other = SQLiteV1BaselineConnectionOwner(":memory:")
    other.execute("BEGIN EXCLUSIVE").close()
    try:
        with pytest.raises(ValueError, match="connection ownership"):
            _begin_sqlite_cursor_stage_ownership_transfer(other, stage, receipt)
        assert stage._cursor_transfer_state == "unused"
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match="transaction epoch"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert stage._cursor_transfer_state == "unused"
    finally:
        other.rollback()
        other.close()
        _cleanup(connection, stage)


def test_closed_owner_and_invalid_receipt_preserve_a2b_first_order() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    connection.close()
    with pytest.raises(TypeError, match="pre-rebind receipt"):
        _begin_sqlite_cursor_stage_ownership_transfer(
            connection,
            stage,
            object(),  # type: ignore[arg-type]
        )
    assert stage._cursor_transfer_state == "unused"
    with pytest.raises(ValueError, match="closed or unavailable"):
        _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
    assert stage._cursor_transfer_state == "unused"


def test_second_begin_same_or_distinct_receipt_is_terminal() -> None:
    connection, summary, stage, identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        with pytest.raises(ValueError, match="ALREADY_STARTED"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert stage.state == "poisoned"
        with pytest.raises(ValueError, match="binding drifted"):
            _assert_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                receipt,
                transfer,
            )
    finally:
        _cleanup(connection, stage)

    connection, summary, stage, identity, receipt = _prepared_fence()
    try:
        other_receipt = _mint_receipt(summary, identity)
        _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        with pytest.raises(ValueError, match="ALREADY_STARTED"):
            _begin_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                other_receipt,
            )
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("_cooperative_pending_receipt", object()),
        ("_cooperative_write_active", True),
        ("_ordered_handoff_reader", object()),
        ("_stream_record_campaign_session", object()),
        ("_checkpoint_campaign_cursor", object()),
        ("_lease_lock_hold_campaign_cursor", object()),
        ("_legacy_campaign_session", object()),
        ("_stream_record_campaign_completed", False),
        ("_cursor_transfer_capture_epoch", -1),
    ],
)
def test_retained_fence_rechecks_every_predecessor_owner_lane(
    field: str,
    value: object,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        setattr(stage, field, value)
        with pytest.raises(ValueError, match="binding drifted"):
            _assert_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                receipt,
                transfer,
            )
        assert stage.state == "poisoned"
        assert stage._cursor_transfer_state == "poisoned"
        assert _cursor_temp_objects(connection) == ()
    finally:
        if field == "_ordered_handoff_reader":
            stage._ordered_handoff_reader = None
        _cleanup(connection, stage)


def test_catalog_toctou_write_is_caught_before_publication(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    original = SQLiteV1BaselineTempStage._assert_legacy_main_catalog
    injected = False
    transfers_before = len(ownership._TRANSFERS)

    def inject_after_catalog(self: SQLiteV1BaselineTempStage) -> None:
        nonlocal injected
        original(self)
        if not injected:
            injected = True
            connection.execute(
                "UPDATE temp.ge_blr_stage SET state_blob = state_blob "
                "WHERE key_blob = (SELECT key_blob FROM temp.ge_blr_stage LIMIT 1)"
            ).close()

    monkeypatch.setattr(
        SQLiteV1BaselineTempStage,
        "_assert_legacy_main_catalog",
        inject_after_catalog,
    )
    try:
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert injected
        assert len(ownership._TRANSFERS) == transfers_before
        assert stage.state == "poisoned"
        assert _cursor_temp_objects(connection) == ()
    finally:
        _cleanup(connection, stage)


def test_package_root_does_not_export_b0b_runtime_symbols() -> None:
    assert not hasattr(graph_engineering, "_begin_sqlite_cursor_stage_ownership_transfer")
    assert not hasattr(graph_engineering, "_assert_sqlite_cursor_stage_ownership_transfer")
    assert not hasattr(graph_engineering, "_SQLiteCursorStageOwnershipTransfer")


def test_frozen_b1_catalog_contract_is_byte_identical_to_shared_fixture() -> None:
    fixture_path = (
        Path(__file__).resolve().parents[2]
        / "spec/conformance/sqlite-cursor-stage-ownership.case.json"
    )
    fixture = json.loads(fixture_path.read_text())
    assert list(fixture) == [
        "contract",
        "cursorSealTempTableDdl",
        "cursorSealTempTableDdlSha256",
        "sqliteSchemaSql",
        "rootpageRule",
        "tableList",
        "xinfo",
        "outcomes",
        "requiredScenarios",
    ]
    assert fixture["contract"] == (
        "graphengineering.reacher-z.github.io/sqlite-cursor-stage-ownership/v1alpha1"
    )
    assert fixture["cursorSealTempTableDdl"] == SQLITE_V1_CURSOR_SEAL_TEMP_TABLE_DDL
    assert (
        fixture["cursorSealTempTableDdlSha256"]
        == SQLITE_V1_CURSOR_SEAL_TEMP_TABLE_DDL_SHA256
        == hashlib.sha256(SQLITE_V1_CURSOR_SEAL_TEMP_TABLE_DDL.encode()).hexdigest()
    )
    assert fixture["sqliteSchemaSql"] == SQLITE_V1_CURSOR_SEAL_SQLITE_SCHEMA_SQL
    assert fixture["rootpageRule"] == {
        "type": "safe-positive-integer",
        "stableWithinStageSession": True,
    }
    assert fixture["tableList"] == {
        "name": "ge_blr_cursor_seal",
        "type": "table",
        "ncol": 30,
        "wr": 1,
        "strict": 1,
    }
    assert (
        tuple(
            (
                row["cid"],
                row["name"],
                row["type"],
                row["notnull"],
                row["dfltValue"],
                row["pk"],
                row["hidden"],
            )
            for row in fixture["xinfo"]
        )
        == _SQLITE_V1_CURSOR_SEAL_XINFO
    )
    assert fixture["outcomes"] == [
        "accepted",
        "invalid-authority",
        "stale-epoch",
        "unexplained-write",
        "incomplete-stage",
        "already-started",
        "poisoned",
        "disposed",
    ]
    assert {scenario["name"]: scenario["expect"] for scenario in fixture["requiredScenarios"]} == {
        "b0-complete-real-predecessors": "accepted",
        "b0-incomplete-predecessor": "incomplete-stage",
        "b0-invalid-receipt-a2b-first": "invalid-authority",
        "b0-second-begin": "already-started",
        "b0-stale-capture-epoch": "stale-epoch",
        "b0-unexplained-stage-write": "unexplained-write",
        "b0-wrong-exact-owner": "invalid-authority",
        "b1-caller-ddl": "stale-epoch",
        "b1-capture-epoch-immutable": "accepted",
        "b1-catalog-shape-drift": "poisoned",
        "b1-disposed-stage": "disposed",
        "b1-epoch-plus-two": "stale-epoch",
        "b1-epoch-plus-zero": "stale-epoch",
        "b1-historical-witness-stale-retained-transfer-live": "accepted",
        "b1-owned-exact-create": "accepted",
        "b1-row-change-drift": "unexplained-write",
        "b1-transaction-replacement": "stale-epoch",
    }


def test_hostile_stage_and_witness_class_methods_are_never_dispatched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    calls: list[str] = []

    def hostile_method(*_args: object, **_kwargs: object) -> object:
        calls.append("method")
        raise AssertionError("mutable class method was dispatched")

    monkeypatch.setattr(SQLiteV1BaselineTempStage, "_begin_cursor_stage_transfer", hostile_method)
    monkeypatch.setattr(SQLiteV1BaselineTempStage, "_assert_cursor_stage_transfer", hostile_method)
    from graph_engineering.sqlite_operation_baseline_cursor_source_fence import (
        _SQLiteCursorCapturedSourceConnectionWitness,
    )

    monkeypatch.setattr(
        _SQLiteCursorCapturedSourceConnectionWitness,
        "_assert_current",
        hostile_method,
    )
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert (
            _assert_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                receipt,
                transfer,
            )
            is transfer
        )
        assert calls == []
    finally:
        monkeypatch.undo()
        _cleanup(connection, stage)


@pytest.mark.parametrize("descriptor", ["transaction_epoch", "total_changes"])
def test_hostile_owner_descriptor_cannot_hide_real_epoch_or_write(
    descriptor: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    original_epoch = ownership._OWNER_TRANSACTION_EPOCH_GETTER
    original_changes = SQLiteV1BaselineConnectionOwner.total_changes.fget
    assert original_changes is not None
    frozen_epoch = original_epoch(connection)
    frozen_changes = original_changes(connection)
    injected = False

    def hostile_epoch(_connection: SQLiteV1BaselineConnectionOwner) -> int:
        nonlocal injected
        if not injected:
            injected = True
            connection.execute("PRAGMA user_version").close()
        return frozen_epoch

    def hostile_changes(_connection: SQLiteV1BaselineConnectionOwner) -> int:
        nonlocal injected
        if not injected:
            injected = True
            connection.execute(
                "UPDATE temp.ge_blr_stage SET state_blob = state_blob "
                "WHERE key_blob = (SELECT key_blob FROM temp.ge_blr_stage LIMIT 1)"
            ).close()
        return frozen_changes

    monkeypatch.setattr(
        SQLiteV1BaselineConnectionOwner,
        descriptor,
        property(hostile_epoch if descriptor == "transaction_epoch" else hostile_changes),
    )
    try:
        with pytest.raises(ValueError, match=r"FENCE|witness drifted"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert injected
        assert stage.state == "poisoned"
        assert stage._cursor_transfer_state == "poisoned"
    finally:
        monkeypatch.undo()
        _cleanup(connection, stage)


def test_real_main_dml_and_real_pragma_cannot_hide_behind_b0_source_witness() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        connection.execute("UPDATE ge_cycle_schema SET updated_at_ms = updated_at_ms").close()
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)

    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        connection.execute("PRAGMA user_version").close()
        with pytest.raises(ValueError, match="transaction epoch"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert stage._cursor_transfer_state == "unused"
    finally:
        _cleanup(connection, stage)


def test_wrong_exact_stage_is_terminally_poisoned_after_source_acceptance() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    other_connection, _other_summary, other_stage, _other_identity, _other_receipt = (
        _prepared_fence()
    )
    try:
        with pytest.raises(ValueError, match="stage provenance"):
            _begin_sqlite_cursor_stage_ownership_transfer(
                connection,
                other_stage,
                receipt,
            )
        assert stage.state == "open"
        assert stage._cursor_transfer_state == "unused"
        assert other_stage.state == "poisoned"
        assert other_stage._cursor_transfer_state == "poisoned"
    finally:
        _cleanup(connection, stage)
        _cleanup(other_connection, other_stage)


def test_publication_failure_preserves_primary_error_and_poisons_stage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()

    class RejectPublication:
        def __setitem__(self, _key: object, _value: object) -> None:
            raise RuntimeError("publication-primary-marker")

    monkeypatch.setattr(ownership, "_TRANSFERS", RejectPublication())
    try:
        with pytest.raises(RuntimeError, match="publication-primary-marker"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        assert stage.state == "poisoned"
        assert stage._cursor_transfer_state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_b1_exact_owned_create_adopts_only_live_epoch_and_retains_transfer() -> None:
    connection, summary, stage, _identity, receipt = _prepared_fence()
    try:
        historical_witness = _assert_sqlite_cursor_captured_source_connection_provenance(
            connection,
            receipt,
        )
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        capture_epoch = stage._cursor_transfer_capture_epoch
        before_epoch = connection.transaction_epoch
        before_changes = connection.total_changes
        assert (
            _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer) is transfer
        )
        assert connection.transaction_epoch == before_epoch + 1
        assert connection.total_changes == before_changes
        assert stage._transaction_epoch == before_epoch + 1
        assert stage._cursor_transfer_stage_epoch == before_epoch + 1
        assert stage._cursor_transfer_capture_epoch == capture_epoch
        assert stage._cursor_transfer_capture_epoch == summary._captured_transaction_epoch
        with pytest.raises(ValueError, match="transaction epoch"):
            historical_witness._assert_current()
        assert (
            _assert_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                receipt,
                transfer,
            )
            is transfer
        )
        schema_row = _one_row(
            connection,
            "SELECT type, name, tbl_name, rootpage, sql FROM temp.sqlite_schema "
            "WHERE name = 'ge_blr_cursor_seal'",
        )
        assert schema_row[:3] == ("table", "ge_blr_cursor_seal", "ge_blr_cursor_seal")
        assert type(schema_row[3]) is int and schema_row[3] > 0
        assert schema_row[4] == SQLITE_V1_CURSOR_SEAL_SQLITE_SCHEMA_SQL
        assert _one_row(
            connection,
            "SELECT name, type, ncol, wr, strict FROM pragma_table_list "
            "WHERE schema = 'temp' AND name = 'ge_blr_cursor_seal'",
        ) == ("ge_blr_cursor_seal", "table", 30, 1, 1)
    finally:
        _cleanup(connection, stage)


def test_b1_first_ddl_cursor_close_failure_preserves_primary_and_cleans_all_owned_objects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    original_close = stage_module._CURSOR_CLOSE
    close_calls = 0

    def fail_first_close(cursor: object) -> None:
        nonlocal close_calls
        close_calls += 1
        if close_calls == 1:
            raise RuntimeError("ddl-close-primary-marker")
        original_close(cursor)  # type: ignore[arg-type]

    monkeypatch.setattr(stage_module, "_CURSOR_CLOSE", fail_first_close)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        with pytest.raises(RuntimeError, match="ddl-close-primary-marker"):
            _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        assert close_calls >= 3
        assert stage.state == "poisoned"
        assert "ge_blr_cursor_seal" not in _cursor_temp_objects(connection)
        stage.dispose()
        assert stage.state == "disposed"
        assert _reserved_temp_count(connection) == 0
    finally:
        monkeypatch.undo()
        if stage.state != "disposed":
            stage.dispose()
        connection.rollback()
        connection.close()


def test_b1_class_fence_replacement_cannot_admit_fake_receipt_or_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    class_fence_calls = 0

    def forged_class_fence(*_args: object, **_kwargs: object) -> None:
        nonlocal class_fence_calls
        class_fence_calls += 1

    monkeypatch.setattr(
        SQLiteV1BaselineTempStage,
        "_assert_cursor_stage_transfer",
        forged_class_fence,
    )
    try:
        with pytest.raises(TypeError, match="pre-rebind receipt"):
            ownership._STAGE_CREATE_CURSOR_SEAL_TEMP_TABLE(
                stage,
                connection,
                object(),  # type: ignore[arg-type]
                object(),
            )
        assert class_fence_calls == 0
        assert connection.transaction_epoch == before_epoch
        assert connection.total_changes == before_changes
        assert "ge_blr_cursor_seal" not in _cursor_temp_objects(connection)
        assert (
            _assert_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                receipt,
                transfer,
            )
            is transfer
        )
    finally:
        monkeypatch.undo()
        _cleanup(connection, stage)


def test_b1_cleanup_never_drops_rollback_rebegin_same_name_replacement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    original_close = stage_module._CURSOR_CLOSE
    replaced = False

    def replace_during_first_close(cursor: object) -> None:
        nonlocal replaced
        if not replaced:
            replaced = True
            connection.rollback()
            connection.execute("BEGIN EXCLUSIVE").close()
            connection.execute(SQLITE_V1_CURSOR_SEAL_TEMP_TABLE_DDL).close()
            raise RuntimeError("replacement-primary-marker")
        original_close(cursor)  # type: ignore[arg-type]

    monkeypatch.setattr(stage_module, "_CURSOR_CLOSE", replace_during_first_close)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        with pytest.raises(RuntimeError, match="replacement-primary-marker"):
            _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        assert replaced
        replacement_identity = _one_row(
            connection,
            "SELECT type, name, tbl_name, rootpage, sql FROM temp.sqlite_schema "
            "WHERE name = 'ge_blr_cursor_seal'",
        )
        assert replacement_identity[4] == SQLITE_V1_CURSOR_SEAL_SQLITE_SCHEMA_SQL
        with pytest.raises(ValueError, match="reserved objects remain"):
            stage.dispose()
        assert stage.state == "poisoned"
        assert (
            _one_row(
                connection,
                "SELECT type, name, tbl_name, rootpage, sql FROM temp.sqlite_schema "
                "WHERE name = 'ge_blr_cursor_seal'",
            )
            == replacement_identity
        )
    finally:
        monkeypatch.undo()
        connection.rollback()
        connection.close()


def test_b1_caller_ddl_row_drift_and_second_create_are_terminal() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        connection.execute(SQLITE_V1_CURSOR_SEAL_TEMP_TABLE_DDL).close()
        with pytest.raises(ValueError, match=r"FENCE|TRANSACTION_CHANGED"):
            _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("epoch_delta", [0, 2])
def test_b1_rejects_nonadjacent_owned_ddl_epoch(
    epoch_delta: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    original_execute = stage_module._OWNER_EXECUTE

    def skew_owned_ddl(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> object:
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_V1_CURSOR_SEAL_TEMP_TABLE_DDL:
            current = ownership._OWNER_TRANSACTION_EPOCH_GETTER(owner)
            object.__setattr__(
                owner,
                "_SQLiteV1BaselineConnectionOwner__transaction_epoch",
                current + epoch_delta - 1,
            )
        return cursor

    monkeypatch.setattr(stage_module, "_OWNER_EXECUTE", skew_owned_ddl)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        with pytest.raises(ValueError, match=r"exact \+1 epoch/\+0 changes"):
            _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        assert stage.state == "poisoned"
        assert stage._cursor_transfer_state == "poisoned"
        assert _cursor_temp_objects(connection) == ()
    finally:
        monkeypatch.undo()
        _cleanup(connection, stage)


def test_b1_rejects_transaction_replacement_and_disposed_stage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    original_execute = stage_module._OWNER_EXECUTE

    def replace_transaction(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> object:
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_V1_CURSOR_SEAL_TEMP_TABLE_DDL:
            owner.commit()
        return cursor

    monkeypatch.setattr(stage_module, "_OWNER_EXECUTE", replace_transaction)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        with pytest.raises(ValueError, match=r"exact \+1 epoch/\+0 changes"):
            _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        assert stage.state == "poisoned"
    finally:
        monkeypatch.undo()
        connection.close()

    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        stage.dispose()
        with pytest.raises(ValueError, match="disposed"):
            _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
    finally:
        _cleanup(connection, stage)


def test_b1_catalog_replacement_poisons_retained_transfer() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        connection.execute("DROP TABLE temp.ge_blr_cursor_seal").close()
        connection.execute(
            "CREATE TEMP TABLE ge_blr_cursor_seal (token_hash TEXT PRIMARY KEY) STRICT"
        ).close()
        with pytest.raises(ValueError, match=r"TRANSACTION_CHANGED|FENCE"):
            _assert_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                receipt,
                transfer,
            )
        assert stage.state == "poisoned"
        assert stage._cursor_transfer_state == "poisoned"
    finally:
        with pytest.raises(ValueError, match="reserved objects remain"):
            stage.dispose()
        assert stage.state == "poisoned"
        connection.rollback()
        connection.close()

    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        connection.execute(
            "INSERT INTO temp.ge_blr_cursor_seal VALUES ("
            "'a','b','event','p','a',NULL,NULL,0,'h',1,0,NULL,NULL,0,'h',0,1,NULL,"
            "'d','s',1,1,1,1,1,1,1,1,1,1)"
        ).close()
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            _assert_sqlite_cursor_stage_ownership_transfer(
                connection,
                stage,
                receipt,
                transfer,
            )
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)

    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match="ALREADY_STARTED"):
            _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)
