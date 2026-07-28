from __future__ import annotations

from collections.abc import Callable

import pytest

import graph_engineering.sqlite_operation_baseline_handoff as handoff_module
from graph_engineering.sqlite_operation_baseline import (
    BaselineAccumulator,
    BaselineProjectionIdentity,
    capture_baseline_entry,
    create_baseline_id,
)
from graph_engineering.sqlite_operation_baseline_cooperation import (
    _stream_sqlite_v1_baseline_source_into_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_handoff import (
    _project_ordered_sqlite_v1_baseline_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    _SQLiteCursorCapability,
    capture_sqlite_v1_baseline_source_summary,
)
from graph_engineering.sqlite_operation_baseline_stage import (
    SQLiteV1BaselineTempStage,
    configure_sqlite_v1_baseline_temp_storage,
    create_sqlite_v1_baseline_temp_stage,
)
from tests.test_sqlite_operation_baseline_cooperation import (
    _populate_1_024_mixed_entries,
    _populate_all_kinds,
)
from tests.test_sqlite_operation_baseline_source import NOW, database

Populate = Callable[[SQLiteV1BaselineConnectionOwner], None]


def _loaded_stage(
    populate: Populate | None = None,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    SQLiteV1BaselineTempStage,
]:
    connection = database()
    if populate is not None:
        populate(connection)
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("BEGIN EXCLUSIVE").close()
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    summary = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
    _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
    return connection, summary, stage


def _materialized_identity(populate: Populate | None = None) -> BaselineProjectionIdentity:
    connection = database()
    try:
        if populate is not None:
            populate(connection)
        connection.execute("BEGIN EXCLUSIVE").close()
        summary = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
        accumulator = BaselineAccumulator(
            create_baseline_id(summary.source_envelope),
            summary.expected_entry_count,
        )
        for item in summary.iter_identity_entries():
            accumulator.append(item)
        return accumulator.finish()
    finally:
        connection.rollback()
        connection.close()


class _CursorProxy:
    def __init__(
        self,
        cursor: _SQLiteCursorCapability,
        mode: str,
        connection: SQLiteV1BaselineConnectionOwner,
    ) -> None:
        self.cursor = cursor
        self.mode = mode
        self.connection = connection
        self.calls = 0
        self.cached: tuple[object, ...] | None = None
        self.second: tuple[object, ...] | None = None
        self.closed = False
        self.injected = False

    def fetchone(self) -> tuple[object, ...] | None:
        self.calls += 1
        if self.mode == "missing" and self.calls == 2:
            return None
        if self.mode == "reorder":
            if self.calls == 1:
                self.cached = self.cursor.fetchone()
                self.second = self.cursor.fetchone()
                return self.second
            if self.calls == 2:
                return self.cached
        row = self.cursor.fetchone()
        if self.cached is None and row is not None:
            self.cached = row
        if self.mode == "rank-kind" and self.calls == 1 and row is not None:
            return (1, row[1], row[2], row[3])
        if self.mode == "kind-swap" and self.calls == 2:
            replacement = capture_baseline_entry(
                "legal-hold",
                {"holdId": "hold-substitute", "streamId": "stream-substitute", "tenantId": "t"},
                {
                    "holdId": "hold-substitute",
                    "placedAtMs": NOW,
                    "streamId": "stream-substitute",
                    "tenantId": "t",
                },
            )
            return (8, replacement.entry_kind, replacement.key_bytes, replacement.state_bytes)
        if self.mode == "noncanonical" and self.calls == 1 and row is not None:
            key_blob = row[2]
            assert isinstance(key_blob, bytes)
            return (row[0], row[1], b"{ " + key_blob[1:], row[3])
        if self.mode == "duplicate" and self.calls == 2:
            return self.cached
        if self.mode == "extra" and row is None and not self.injected:
            self.injected = True
            return self.cached
        if self.mode in {"dml-row", "dml-eof"} and not self.injected:
            should_inject = (self.mode == "dml-row" and row is not None) or (
                self.mode == "dml-eof" and row is None
            )
            if should_inject:
                self.injected = True
                self.connection.execute(
                    "UPDATE temp.ge_blr_stage SET state_blob = state_blob "
                    "WHERE kind_rank = 0"
                ).close()
        return row

    def fetchmany(self, _size: int) -> list[tuple[object, ...]]:
        raise AssertionError("ordered TEMP handoff must never call fetchmany")

    @property
    def rowcount(self) -> int:
        return self.cursor.rowcount

    def close(self) -> None:
        self.closed = True
        self.cursor.close()
        if self.mode == "close-poison":
            raise RuntimeError("hostile close failure")


def _install_ordered_proxy(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
) -> list[_CursorProxy]:
    original = SQLiteV1BaselineConnectionOwner.execute
    proxies: list[_CursorProxy] = []

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        cursor = original(owner, sql, parameters)
        if "SELECT kind_rank, entry_kind, key_blob, state_blob" not in sql:
            return cursor
        proxy = _CursorProxy(cursor, mode, owner)
        proxies.append(proxy)
        return proxy  # type: ignore[return-value]

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    return proxies


def _cleanup(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
) -> None:
    try:
        stage.dispose()
    finally:
        connection.rollback()
        connection.close()


def test_pristine_three_entry_projection_matches_shared_cross_runtime_golden() -> None:
    connection, summary, stage = _loaded_stage()
    try:
        assert _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage) == (
            BaselineProjectionIdentity(
                baseline_id=(
                    "v2-57ddf5826fc8d0a7b30a8dbcc961a66953e1604d73e2e43b8e4d229c0b9f3612"
                ),
                entry_count=3,
                legacy_operation_count=0,
                first_entry_hash=(
                    "bfb3045f4b4e17ed490877a6030fc4b0151fbbb892290e476369040d065d5928"
                ),
                final_entry_hash=(
                    "1ad91f22d750f258b129d5dbd9e6deef8f04368b95e3497a5a9a268319f62e06"
                ),
                projection_sha256=(
                    "7d9dc721b57bfd9272887e8f2b991c53d344e12921b2aaddef88b978ac0de245"
                ),
            )
        )
        assert stage._ordered_handoff_completed
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("populate", "expected_count"),
    [(_populate_all_kinds, 12), (_populate_1_024_mixed_entries, 1_024)],
)
def test_ordered_handoff_matches_materialized_projection_at_exact_scales(
    monkeypatch: pytest.MonkeyPatch,
    populate: Populate,
    expected_count: int,
) -> None:
    def forbidden_fetchmany(
        _cursor: _SQLiteCursorCapability,
        _size: int,
    ) -> list[tuple[object, ...]]:
        raise AssertionError("ordered TEMP handoff must use fetchone only")

    connection, summary, stage = _loaded_stage(populate)
    try:
        expected_identity = _materialized_identity(populate)
        monkeypatch.setattr(_SQLiteCursorCapability, "fetchmany", forbidden_fetchmany)
        identity = _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        assert identity == expected_identity
        assert identity.entry_count == expected_count
    finally:
        _cleanup(connection, stage)


def test_second_handoff_is_rejected_and_poisons_stage() -> None:
    connection, summary, stage = _loaded_stage()
    try:
        _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        with pytest.raises(ValueError, match="ONESHOT"):
            _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_direct_early_close_poisons_and_finalizes_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proxies = _install_ordered_proxy(monkeypatch, "normal")
    connection, summary, stage = _loaded_stage()
    try:
        reader = stage._open_ordered_projection_reader(summary)
        with pytest.raises(ValueError, match="EARLY_CLOSE"):
            reader.close()
        assert proxies[0].closed
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_iterating_same_reader_twice_is_rejected() -> None:
    connection, summary, stage = _loaded_stage()
    try:
        reader = stage._open_ordered_projection_reader(summary)
        assert iter(reader) is reader
        with pytest.raises(ValueError, match="ONESHOT"):
            iter(reader)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("mode", "message"),
    [
        ("missing", "COUNT"),
        ("extra", "count exceeds"),
        ("reorder", "canonical order"),
        ("duplicate", "duplicate"),
        ("kind-swap", "kind counts"),
        ("rank-kind", "ROW"),
        ("noncanonical", "ROW"),
        ("dml-row", "UNEXPLAINED_WRITE"),
        ("dml-eof", "UNEXPLAINED_WRITE"),
    ],
)
def test_hostile_ordered_rows_and_fetch_boundaries_poison_handoff(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
    message: str,
) -> None:
    proxies = _install_ordered_proxy(monkeypatch, mode)
    connection, summary, stage = _loaded_stage()
    try:
        with pytest.raises(ValueError, match=message):
            _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        assert proxies[0].closed
        assert stage.state == "poisoned"
        assert summary._identity_iteration_state.poisoned
    finally:
        _cleanup(connection, stage)


def test_count_preserving_external_mutation_is_rejected() -> None:
    connection, summary, stage = _loaded_stage()
    try:
        connection.execute(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0"
        ).close()
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("boundary", ["post-append", "terminal-counts", "post-root", "complete"])
def test_dml_at_post_fetch_boundaries_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
    boundary: str,
) -> None:
    connection, summary, stage = _loaded_stage()
    injected = False

    def inject_once() -> None:
        nonlocal injected
        if injected:
            return
        injected = True
        connection.execute(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0"
        ).close()

    if boundary == "post-append":
        original_append = BaselineAccumulator.append

        def append(accumulator: BaselineAccumulator, item: object) -> object:
            result = original_append(accumulator, item)  # type: ignore[arg-type]
            inject_once()
            return result

        monkeypatch.setattr(BaselineAccumulator, "append", append)
    elif boundary == "terminal-counts":
        original_counts = SQLiteV1BaselineTempStage.assert_common_counts
        calls = 0

        def assert_counts(stage_value: SQLiteV1BaselineTempStage, expected: object) -> None:
            nonlocal calls
            original_counts(stage_value, expected)  # type: ignore[arg-type]
            calls += 1
            if calls == 2:
                inject_once()

        monkeypatch.setattr(SQLiteV1BaselineTempStage, "assert_common_counts", assert_counts)
    elif boundary == "post-root":
        original_finish = BaselineAccumulator.finish

        def finish(accumulator: BaselineAccumulator) -> BaselineProjectionIdentity:
            identity = original_finish(accumulator)
            inject_once()
            return identity

        monkeypatch.setattr(BaselineAccumulator, "finish", finish)
    else:
        original_complete = SQLiteV1BaselineTempStage._complete_ordered_projection_reader

        def complete(stage_value: SQLiteV1BaselineTempStage, reader: object) -> None:
            inject_once()
            original_complete(stage_value, reader)  # type: ignore[arg-type]

        monkeypatch.setattr(
            SQLiteV1BaselineTempStage,
            "_complete_ordered_projection_reader",
            complete,
        )

    try:
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        assert injected
        assert stage.state == "poisoned"
        assert not stage._ordered_handoff_completed
    finally:
        _cleanup(connection, stage)


def test_catalog_replacement_epoch_is_rejected() -> None:
    connection, summary, stage = _loaded_stage()
    try:
        connection.execute("DROP INDEX temp.ge_blr_records_stream_position_idx").close()
        with pytest.raises(ValueError, match=r"BINDING|TRANSACTION_CHANGED|CATALOG"):
            _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_rollback_and_rebegin_cannot_rebind_stage() -> None:
    connection, summary, stage = _loaded_stage()
    try:
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match=r"BINDING|TRANSACTION_CHANGED"):
            _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_wrong_connection_summary_is_rejected() -> None:
    connection_a, summary_a, stage_a = _loaded_stage()
    connection_b, summary_b, stage_b = _loaded_stage()
    try:
        del summary_a
        with pytest.raises(ValueError, match="BINDING"):
            _project_ordered_sqlite_v1_baseline_temp_stage(summary_b, stage_a)
        assert stage_a.state == "poisoned"
        assert summary_b._identity_iteration_state.poisoned
    finally:
        _cleanup(connection_a, stage_a)
        _cleanup(connection_b, stage_b)


def test_finish_rejects_exact_shape_summary_replacement() -> None:
    connection, summary, stage = _loaded_stage()
    try:
        replacement = SQLiteV1BaselineSourceSummary(
            summary._source_envelope_bytes,
            summary.counts_by_kind,
            summary.expected_entry_count,
            summary.maximum_observed_at_ms,
            summary._connection,
            summary._latest_migration_applied_at_ms,
            summary._source_total_changes,
            summary._captured_transaction_epoch,
        )
        replacement._identity_iteration_state.started = True
        replacement._identity_iteration_state.completed = True
        reader = stage._open_ordered_projection_reader(summary)
        for _item in reader:
            pass
        with pytest.raises(ValueError, match="COUNT"):
            stage._finish_ordered_projection_reader(replacement, reader)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_dispose_with_active_reader_finalizes_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proxies = _install_ordered_proxy(monkeypatch, "normal")
    connection, summary, stage = _loaded_stage()
    try:
        stage._open_ordered_projection_reader(summary)
        stage.dispose()
        assert proxies[0].closed
        assert stage.state == "disposed"
    finally:
        connection.rollback()
        connection.close()


def test_dispose_surfaces_active_reader_close_failure_after_catalog_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proxies = _install_ordered_proxy(monkeypatch, "close-poison")
    connection, summary, stage = _loaded_stage()
    try:
        stage._open_ordered_projection_reader(summary)
        with pytest.raises(ValueError, match="HANDOFF_CLEANUP"):
            stage.dispose()
        assert proxies[0].closed
        cursor = connection.execute(
            "SELECT count(*) FROM temp.sqlite_schema "
            "WHERE substr(lower(name), 1, 7) = 'ge_blr_'"
        )
        try:
            assert cursor.fetchone() == (0,)
        finally:
            cursor.close()
    finally:
        connection.rollback()
        connection.close()


def test_catalog_cursor_close_failure_poisons_handoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage = _loaded_stage()
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    proxy: _CursorProxy | None = None

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal proxy
        cursor = original_execute(owner, sql, parameters)
        if proxy is None and "FROM temp.sqlite_schema" in sql:
            proxy = _CursorProxy(cursor, "close-poison", owner)
            return proxy  # type: ignore[return-value]
        return cursor

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    try:
        with pytest.raises(ValueError, match="HANDOFF_CATALOG"):
            handoff_module._project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        assert proxy is not None and proxy.closed
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_cleanup_failure_does_not_replace_primary_row_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proxies = _install_ordered_proxy(monkeypatch, "close-poison")
    connection, summary, stage = _loaded_stage()
    try:
        # Force a primary recapture failure while close() independently throws.
        original = proxies
        del original
        reader = stage._open_ordered_projection_reader(summary)
        proxy = proxies[0]
        proxy.mode = "rank-kind"
        with pytest.raises(ValueError, match="ROW"):
            next(reader)
        assert proxy.closed
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)
