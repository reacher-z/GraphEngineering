from __future__ import annotations

import gc
import sqlite3
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import Protocol, cast
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_outer_authority as outer_module
import graph_engineering.sqlite_cursor_publication_target_catalog as target_module
from graph_engineering.sqlite_cursor_publication_outer_authority import (
    _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic,
    _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic,
    _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic,
    _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic,
    _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic,
    _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteMigration0002CatalogRebuildReceipt,
)
from graph_engineering.sqlite_cursor_publication_target_catalog import (
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_cursor_publication_migration_0002_execution import (
    _active,
    _cleanup_graph,
    _raw,
)

_PROOF_SCOPE = "post-0002-physical-target-catalog-before-baseline-publication"


class _CursorProbeTarget(Protocol):
    def fetchmany(self, size: int) -> list[tuple[object, ...]]: ...

    def fetchone(self) -> tuple[object, ...] | None: ...

    def close(self) -> None: ...


class _DeferredCloseCatalogCursor:
    def __init__(self, delegate: _CursorProbeTarget) -> None:
        self.delegate = delegate
        self.close_count = 0

    def fetchmany(self, size: int) -> list[tuple[object, ...]]:
        return self.delegate.fetchmany(size)

    def close(self) -> None:
        self.close_count += 1
        self.delegate.close()
        raise RuntimeError("injected catalog iterator close failure")


class _CorruptMetadataCursor:
    def __init__(self, delegate: _CursorProbeTarget) -> None:
        self.delegate = delegate
        self.read_count = 0

    def fetchone(self) -> tuple[object, ...] | None:
        row = self.delegate.fetchone()
        self.read_count += 1
        if self.read_count == 1:
            assert row is not None
            return (1_195_724_358, row[1])
        return row

    def close(self) -> None:
        self.delegate.close()


def _migrated(
    legacy_count: int = 0,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteMigration0002CatalogRebuildReceipt,
]:
    connection, stage, authority = _active(legacy_count)
    receipt = _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
    return connection, stage, authority, receipt


def _safe_cleanup(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
) -> None:
    """Dispose a graph even when the hostile case already closed its owner."""

    with suppress(BaseException):
        if connection.in_transaction:
            connection.rollback()
    with suppress(BaseException):
        stage.dispose()
    with suppress(BaseException):
        connection.close()


def _trace(
    connection: SQLiteV1BaselineConnectionOwner,
    operation: Callable[[], object],
) -> list[str]:
    statements: list[str] = []
    raw = _raw(connection)
    raw.set_trace_callback(statements.append)
    try:
        operation()
    finally:
        raw.set_trace_callback(None)
    return statements


def _assert_only_catalog_reads(statements: list[str]) -> None:
    assert statements
    assert any("sqlite_schema" in statement for statement in statements)
    forbidden = (
        "BEGIN",
        "COMMIT",
        "ROLLBACK",
        "CREATE",
        "DROP",
        "ALTER",
        "INSERT",
        "UPDATE",
        "DELETE",
        "REPLACE",
    )
    assert all(not statement.lstrip().upper().startswith(forbidden) for statement in statements)


@pytest.mark.parametrize("legacy_count", [0, 2])
def test_real_l0_l2_mints_exact_reusable_fresh_fence_without_mutation(
    legacy_count: int,
) -> None:
    connection, stage, authority, receipt = _migrated(legacy_count)
    receipt_snapshot = _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
        receipt
    )
    epoch_before = connection.transaction_epoch
    changes_before = connection.total_changes
    generation_before = connection._transaction_generation
    ledger_before = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        authority
    ).outer_ledger
    holder: list[_SQLiteCursorPostDdlCatalogFence] = []
    try:
        mint_trace = _trace(
            connection,
            lambda: holder.append(
                _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
            ),
        )
        _assert_only_catalog_reads(mint_trace)
        fence = holder[0]
        assert type(fence) is _SQLiteCursorPostDdlCatalogFence

        snapshot = _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(fence)
        repeated = _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(fence)
        assert repeated == snapshot
        assert repeated is not snapshot
        assert snapshot.application_id == (
            SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID
        )
        assert snapshot.authority is authority
        assert snapshot.catalog_canonical_utf8_bytes == (
            SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES
        )
        assert snapshot.catalog_digest_domain_utf8 == (
            SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8
        )
        assert snapshot.catalog_inventory == (
            SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY
        )
        assert snapshot.catalog_query == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY
        assert snapshot.catalog_query_sha256 == (
            SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256
        )
        assert snapshot.catalog_row_count == (
            SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
        )
        assert snapshot.catalog_sha256 == receipt_snapshot.post_ddl_catalog_sha256
        assert snapshot.catalog_sha256 == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        assert snapshot.connection is connection
        assert snapshot.consumes_any_write_receipt is False
        assert snapshot.is_final_v2_semantic_proof is False
        assert snapshot.migration_0002_receipt is receipt
        assert snapshot.mint_count == 1
        assert snapshot.outer_ledger_watermark == ledger_before
        assert snapshot.outer_ledger_watermark == (1 + legacy_count, 20, 1)
        assert snapshot.proof_scope == _PROOF_SCOPE
        assert snapshot.total_changes_watermark == changes_before
        assert snapshot.transaction_epoch == epoch_before
        assert snapshot.transaction_generation is generation_before
        assert snapshot.user_version == (
            SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION
        )

        assert (
            _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt, fence)
            is fence
        )
        assert connection.transaction_epoch == epoch_before
        assert connection.total_changes == changes_before
        assert connection._transaction_generation is generation_before
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "active"
        assert owner.outer_ledger == ledger_before
        assert owner.post_ddl_catalog_fence is fence
        assert owner.post_ddl_catalog_fence_mint_count == 1
        assert owner.write_phase == "post-ddl-catalog-fence"
    finally:
        _cleanup_graph(connection, stage)


def test_mint_read_and_assert_each_perform_a_fresh_catalog_read_only() -> None:
    connection, stage, authority, receipt = _migrated()
    fence_holder: list[_SQLiteCursorPostDdlCatalogFence] = []
    before = (
        connection.transaction_epoch,
        connection.total_changes,
        connection._transaction_generation,
    )
    try:
        mint_trace = _trace(
            connection,
            lambda: fence_holder.append(
                _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
            ),
        )
        fence = fence_holder[0]
        read_trace = _trace(
            connection,
            lambda: _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(fence),
        )
        assert_trace = _trace(
            connection,
            lambda: _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
                authority, receipt, fence
            ),
        )
        for statements in (mint_trace, read_trace, assert_trace):
            _assert_only_catalog_reads(statements)
            assert sum("sqlite_schema" in statement for statement in statements) == 1
        assert (
            connection.transaction_epoch,
            connection.total_changes,
            connection._transaction_generation,
        ) == before
    finally:
        _cleanup_graph(connection, stage)


def test_substituted_receipt_is_zero_sql_non_poison_and_corrected_pair_succeeds() -> None:
    connection, stage, authority, receipt = _migrated()
    other_connection, other_stage, _other_authority, other_receipt = _migrated()
    before = (
        connection.transaction_epoch,
        connection.total_changes,
        connection._transaction_generation,
    )
    try:
        statements: list[str] = []
        raw = _raw(connection)
        raw.set_trace_callback(statements.append)
        try:
            with pytest.raises(ValueError, match=r"POST_DDL.*RECEIPT|FENCE.*RECEIPT"):
                _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, other_receipt)
        finally:
            raw.set_trace_callback(None)
        assert statements == []
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "active"
        assert owner.post_ddl_catalog_fence_mint_count == 0
        assert owner.write_phase == "0002-complete"
        assert (
            connection.transaction_epoch,
            connection.total_changes,
            connection._transaction_generation,
        ) == before
        assert (
            type(_mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt))
            is _SQLiteCursorPostDdlCatalogFence
        )
    finally:
        _cleanup_graph(other_connection, other_stage)
        _cleanup_graph(connection, stage)


def test_premature_mint_precedes_receipt_validation_and_is_zero_sql_terminal() -> None:
    connection, stage, authority = _active()
    before = (connection.transaction_epoch, connection.total_changes)
    statements: list[str] = []
    raw = _raw(connection)
    raw.set_trace_callback(statements.append)
    try:
        with pytest.raises(ValueError, match=r"POST_DDL.*PREMATURE|FENCE.*PHASE"):
            _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
                authority,
                object(),  # type: ignore[arg-type]
            )
    finally:
        raw.set_trace_callback(None)
    try:
        assert statements == []
        assert (connection.transaction_epoch, connection.total_changes) == before
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.outer_ledger == (0, 0, 0)
        assert owner.post_ddl_catalog_fence_mint_count == 0
    finally:
        _cleanup_graph(connection, stage)


def test_second_mint_is_zero_sql_terminal_and_preserves_completed_watermarks() -> None:
    connection, stage, authority, receipt = _migrated()
    try:
        fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
        before = (connection.transaction_epoch, connection.total_changes)
        statements: list[str] = []
        raw = _raw(connection)
        raw.set_trace_callback(statements.append)
        try:
            with pytest.raises(ValueError, match=r"POST_DDL.*REPLAY|FENCE.*REUSE"):
                _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
        finally:
            raw.set_trace_callback(None)
        assert statements == []
        assert (connection.transaction_epoch, connection.total_changes) == before
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.outer_ledger == (1, 20, 1)
        assert owner.post_ddl_catalog_fence is fence
        assert owner.post_ddl_catalog_fence_mint_count == 1
        with pytest.raises(ValueError):
            _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(fence)
    finally:
        _cleanup_graph(connection, stage)


def test_forged_cloned_and_cross_run_fences_are_zero_sql_non_poison() -> None:
    connection, stage, authority, receipt = _migrated()
    other_connection, other_stage, other_authority, other_receipt = _migrated()
    try:
        fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
        other_fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
            other_authority, other_receipt
        )
        clone = object.__new__(_SQLiteCursorPostDdlCatalogFence)
        snapshot_copy = _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(
            fence
        )._asdict()
        for hostile in (object(), clone, snapshot_copy, other_fence):
            statements: list[str] = []
            raw = _raw(connection)
            raw.set_trace_callback(statements.append)
            try:
                with pytest.raises(ValueError, match=r"POST_DDL.*FENCE"):
                    _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
                        authority,
                        receipt,
                        hostile,  # type: ignore[arg-type]
                    )
            finally:
                raw.set_trace_callback(None)
            assert statements == []
        assert (
            _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt, fence)
            is fence
        )
        assert (
            _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
                other_authority, other_receipt, other_fence
            )
            is other_fence
        )
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "active"
        )
    finally:
        _cleanup_graph(other_connection, other_stage)
        _cleanup_graph(connection, stage)


def test_forged_fence_read_fails_without_invoking_sqlite() -> None:
    for hostile in (object(), object.__new__(_SQLiteCursorPostDdlCatalogFence)):
        with pytest.raises(ValueError, match=r"POST_DDL.*FENCE"):
            _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(
                hostile  # type: ignore[arg-type]
            )


def test_rollback_rebegin_retires_exact_fence_and_remains_terminal() -> None:
    connection, stage, authority, receipt = _migrated()
    fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
    try:
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match=r"STALE_FENCE|RETIRED"):
            _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(fence)
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "retired"
        )
        with pytest.raises(ValueError, match=r"STALE_FENCE|RETIRED"):
            _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt, fence)
    finally:
        _cleanup_graph(connection, stage)


def test_closed_connection_translates_unavailable_and_never_leaks_programming_error() -> None:
    connection, stage, authority, receipt = _migrated()
    fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
    connection.close()
    try:
        with pytest.raises(ValueError, match=r"POST_DDL.*UNAVAILABLE|OUTER.*UNAVAILABLE") as raised:
            _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(fence)
        assert not isinstance(raised.value.__cause__, sqlite3.ProgrammingError)
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "poisoned"
        )
        with pytest.raises(ValueError):
            _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(fence)
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("when", ["before-mint", "after-mint"])
def test_same_count_catalog_sql_replacement_is_detected_and_poisoned(when: str) -> None:
    connection, stage, authority, receipt = _migrated()
    fence: _SQLiteCursorPostDdlCatalogFence | None = None
    raw = _raw(connection)

    def replace_sql() -> None:
        raw.execute("DROP INDEX main.ge_cycle_cursors_open_idx")
        raw.execute(
            "CREATE INDEX ge_cycle_cursors_open_idx "
            "ON ge_cycle_cursors(tenant_id, token_hash, expires_at_ms)"
        )

    try:
        if when == "before-mint":
            replace_sql()
            with pytest.raises(ValueError, match=r"TARGET_CATALOG|POST_DDL.*CATALOG"):
                _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
        else:
            fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
            replace_sql()
            with pytest.raises(ValueError, match=r"TARGET_CATALOG|POST_DDL.*CATALOG"):
                _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt, fence)
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.outer_ledger == (1, 20, 1)
    finally:
        _cleanup_graph(connection, stage)


@pytest.mark.parametrize("drift", ["epoch", "total-changes"])
def test_unauthorized_watermark_drift_is_terminal(drift: str) -> None:
    connection, stage, authority, receipt = _migrated()
    fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
    raw = _raw(connection)
    try:
        if drift == "epoch":
            connection.execute("CREATE TABLE main.unrelated_epoch_drift(value INTEGER)").close()
        else:
            raw.execute(
                "UPDATE main.ge_cycle_schema SET updated_at_ms=updated_at_ms+1 WHERE singleton=1"
            )
        with pytest.raises(ValueError, match=r"LEDGER|WATERMARK|DRIFT"):
            _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt, fence)
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "poisoned"
        )
    finally:
        _cleanup_graph(connection, stage)


@pytest.mark.parametrize("corrupt_metadata", [True, False])
def test_catalog_iterator_deferred_close_obeys_primary_failure_precedence(
    monkeypatch: pytest.MonkeyPatch,
    corrupt_metadata: bool,
) -> None:
    """Catalog corruption wins over cleanup; cleanup wins only after full validity."""

    connection, stage, authority, receipt = _migrated()
    original_execute = target_module._OWNER_EXECUTE
    catalog_probes: list[_DeferredCloseCatalogCursor] = []

    def injected_execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> object:
        cursor = cast(_CursorProbeTarget, original_execute(owner, sql, parameters))
        if sql == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY:
            probe = _DeferredCloseCatalogCursor(cursor)
            catalog_probes.append(probe)
            return probe
        if corrupt_metadata:
            return _CorruptMetadataCursor(cursor)
        return cursor

    monkeypatch.setattr(target_module, "_OWNER_EXECUTE", injected_execute)
    try:
        expected = (
            r"^GE_CURSOR_B3_TARGET_CATALOG_MISMATCH$"
            if corrupt_metadata
            else r"^GE_CURSOR_B3_TARGET_CATALOG_CLEANUP$"
        )
        with pytest.raises(ValueError, match=expected):
            _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
        assert len(catalog_probes) == 1
        assert catalog_probes[0].close_count == 1
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.post_ddl_catalog_fence is None
        assert owner.post_ddl_catalog_fence_mint_count == 0
        assert owner.outer_ledger == (1, 20, 1)
    finally:
        monkeypatch.undo()
        _cleanup_graph(connection, stage)


def test_captured_target_reader_and_owner_dependencies_resist_late_replacement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt = _migrated()

    def replaced(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("late dependency replacement reached post-DDL fence")

    monkeypatch.setattr(target_module, "_read_target_catalog_observation_intrinsic", replaced)
    monkeypatch.setattr(target_module, "_read_validated_target_catalog_intrinsic", replaced)
    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", replaced)
    try:
        fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
        assert (
            _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(fence).catalog_sha256
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        )
        assert (
            _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt, fence)
            is fence
        )
    finally:
        monkeypatch.undo()
        _cleanup_graph(connection, stage)


def test_package_root_keeps_fence_capability_and_intrinsics_private() -> None:
    for name in (
        "SQLiteCursorPostDdlCatalogFence",
        "mint_sqlite_cursor_post_ddl_catalog_fence",
        "assert_sqlite_cursor_post_ddl_catalog_fence",
        "read_sqlite_cursor_post_ddl_catalog_fence_snapshot",
        "_SQLiteCursorPostDdlCatalogFence",
        "_mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic",
        "_assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic",
        "_read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic",
    ):
        assert not hasattr(graph_engineering, name)


def test_joint_authority_receipt_and_fence_graph_collects_to_registry_baselines() -> None:
    gc.collect()
    gc.collect()
    authority_baseline = len(outer_module._AUTHORITIES)
    receipt_baseline = len(outer_module._MIGRATION_0002_RECEIPTS)
    fence_baseline = len(outer_module._POST_DDL_CATALOG_FENCES)

    def abandon() -> tuple[object, object, object, object]:
        connection, stage, authority, receipt = _migrated()
        fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
        authority_reference = ref(authority)
        receipt_reference = ref(receipt)
        fence_reference = ref(fence)
        stage_reference = ref(stage)
        _cleanup_graph(connection, stage)
        return (
            authority_reference,
            receipt_reference,
            fence_reference,
            stage_reference,
        )

    authority_ref, receipt_ref, fence_ref, stage_ref = abandon()
    gc.collect()
    gc.collect()
    assert authority_ref() is None  # type: ignore[operator]
    assert receipt_ref() is None  # type: ignore[operator]
    assert fence_ref() is None  # type: ignore[operator]
    assert stage_ref() is None  # type: ignore[operator]
    assert len(outer_module._AUTHORITIES) == authority_baseline
    assert len(outer_module._MIGRATION_0002_RECEIPTS) == receipt_baseline
    assert len(outer_module._POST_DDL_CATALOG_FENCES) == fence_baseline


def test_fence_owner_source_contains_no_transaction_completion_or_reader_lease_leaf() -> None:
    source = Path(cast(str, outer_module.__file__)).read_text(encoding="utf-8")
    fence_start = source.index("def _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic")
    next_leaf = source.find("def _mint_sqlite_cursor_post_ddl_publication_reader", fence_start)
    fence_leaf = source[fence_start : next_leaf if next_leaf >= 0 else len(source)]
    for forbidden in (".commit(", ".rollback(", ".rebind(", "executescript("):
        assert forbidden not in fence_leaf
