from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_target_catalog as target_catalog
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
    SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR,
    _read_catalog_rows_from_cursor_intrinsic,
    _read_validated_target_catalog_intrinsic,
    _snapshot_target_catalog_observation_intrinsic,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_V2 = ROOT / "spec/migrations/sqlite/schema-v2.sql"
SCHEMA_V1 = ROOT / "spec/migrations/sqlite/schema-v1.sql"
MIGRATION_0002 = ROOT / "spec/migrations/sqlite/0002-v1-to-v2-operation-replay.sql"
REBIND_CASE = ROOT / "spec/conformance/sqlite-cursor-publication-rebind-v2.case.json"


class _ProbeCatalogCursor:
    def __init__(
        self,
        rows: list[tuple[object, ...]],
        *,
        fail_read: bool = False,
        fail_close: bool = False,
    ) -> None:
        self.rows = rows
        self.fail_read = fail_read
        self.fail_close = fail_close
        self.requested_sizes: list[int] = []
        self.close_count = 0

    def fetchmany(self, size: int) -> list[tuple[object, ...]]:
        self.requested_sizes.append(size)
        if self.fail_read:
            raise RuntimeError("hostile read")
        return self.rows[:size]

    def close(self) -> None:
        self.close_count += 1
        if self.fail_close:
            raise RuntimeError("hostile close")


def _open_target() -> SQLiteV1BaselineConnectionOwner:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    connection.executescript(SCHEMA_V2.read_text(encoding="utf-8"))
    connection.execute("BEGIN EXCLUSIVE").close()
    return connection


def _close_target(connection: SQLiteV1BaselineConnectionOwner) -> None:
    try:
        if connection.in_transaction:
            connection.rollback()
    finally:
        connection.close()


def _raw_rows(connection: SQLiteV1BaselineConnectionOwner) -> tuple[tuple[object, ...], ...]:
    cursor = connection.execute(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY)
    try:
        return tuple(cursor.fetchmany(35))
    finally:
        cursor.close()


def _expect(code: str) -> pytest.RaisesExc[ValueError]:
    return pytest.raises(ValueError, match=f"^{code}$")


def test_query_and_target_descriptor_are_exact_frozen_contract_values() -> None:
    assert hashlib.sha256(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY.encode()).hexdigest() == (
        SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256
    )
    assert SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.schema_version == 2
    assert SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.descriptor_hash == (
        "f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92"
    )
    assert SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.descriptor_body_sha256 == (
        "7bb784e57922facd28034dfdd504b37bd60c89e6c09fcd0d3f9adabb8456e214"
    )
    assert SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.descriptor_canonical_sha256 == (
        "27cfd73833b3a8ff29f0b33d2a73a51d1409b40a07e62c96ec4d9910a705a7d9"
    )
    assert SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.schema_identity_sha256 == (
        "9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634"
    )
    with pytest.raises(AttributeError, match="can't set attribute"):
        SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.schema_version = 3  # type: ignore[misc]
    with pytest.raises(AttributeError, match="can't set attribute"):
        object.__setattr__(
            SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR,
            "descriptor_hash",
            "0" * 64,
        )


def test_hostile_descriptor_mutation_cannot_poison_later_validation() -> None:
    connection = _open_target()
    try:
        before = _read_validated_target_catalog_intrinsic(connection)
        with pytest.raises(AttributeError, match="can't set attribute"):
            object.__setattr__(before.target_descriptor, "descriptor_hash", "0" * 64)
        after = _read_validated_target_catalog_intrinsic(connection)
        assert after.target_descriptor is before.target_descriptor
        assert after.target_descriptor is SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR
        assert after.target_descriptor.descriptor_hash == (
            "f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92"
        )
    finally:
        _close_target(connection)


def test_reads_exact_real_sqlite_v2_target_catalog() -> None:
    connection = _open_target()
    try:
        snapshot = _read_validated_target_catalog_intrinsic(connection)
        assert (
            snapshot.application_id
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID
        )
        assert (
            snapshot.user_version == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION
        )
        assert snapshot.row_count == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
        assert snapshot.canonical_utf8_bytes == (
            SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES
        )
        assert snapshot.catalog_sha256 == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        assert snapshot.inventory == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY
        assert snapshot.target_descriptor is SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR
        assert snapshot.query == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY
        assert snapshot.query_sha256 == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256
        assert len(snapshot.canonical_rows) == 34
        assert snapshot.canonical_json.startswith(
            '[{"name":"ge_cycle_checkpoint_revisions_lookup_idx","sqlSha256":"'
        )
        assert snapshot.canonical_json.endswith('"type":"table"}]')
    finally:
        _close_target(connection)


def test_reads_exact_real_v1_then_0002_migrated_target_catalog() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    try:
        connection.executescript(SCHEMA_V1.read_text(encoding="utf-8"))
        connection.executescript(MIGRATION_0002.read_text(encoding="utf-8"))
        connection.execute("BEGIN EXCLUSIVE").close()
        snapshot = _read_validated_target_catalog_intrinsic(connection)
        assert snapshot.row_count == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
        assert snapshot.catalog_sha256 == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        assert snapshot.inventory == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY
    finally:
        _close_target(connection)


def test_constants_and_canonical_bytes_are_bound_to_conformance_fixture() -> None:
    case = json.loads(REBIND_CASE.read_text(encoding="utf-8"))
    contract = case["authority"]["postDdlCatalogFence"]["catalogReadContract"]
    assert contract["sql"] == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY
    assert contract["querySha256"] == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256
    assert contract["digestDomainUtf8"] == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8
    assert contract["expectedCanonicalRowBytes"] == (
        SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES
    )
    assert contract["expectedRowCount"] == (
        SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
    )
    assert tuple(contract["expectedInventory"]) == (
        SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY
    )
    assert contract["expectedDigestSha256"] == (
        SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
    )
    assert contract["expectedApplicationId"] == (
        SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID
    )
    assert contract["expectedUserVersion"] == (
        SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION
    )

    connection = _open_target()
    try:
        snapshot = _read_validated_target_catalog_intrinsic(connection)
        assert (
            len(snapshot.canonical_json.encode("utf-8", "strict"))
            == (contract["expectedCanonicalRowBytes"])
        )
    finally:
        _close_target(connection)


def test_rejects_strict_row_shapes_types_and_order() -> None:
    connection = _open_target()
    try:
        rows = _raw_rows(connection)
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_ROWS"):
            _snapshot_target_catalog_observation_intrinsic(1_195_724_359, 2, list(rows))
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_ROW"):
            _snapshot_target_catalog_observation_intrinsic(
                1_195_724_359,
                2,
                (("table", "ge_cycle_bad", "ge_cycle_bad", b"CREATE TABLE bad(x)"),),
            )
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_ORDER"):
            _snapshot_target_catalog_observation_intrinsic(1_195_724_359, 2, tuple(reversed(rows)))
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_METADATA"):
            _snapshot_target_catalog_observation_intrinsic(True, 2, rows)
    finally:
        _close_target(connection)


@pytest.mark.parametrize("field_index", range(4))
def test_rejects_non_scalar_surrogate_in_each_catalog_text_field(field_index: int) -> None:
    connection = _open_target()
    try:
        rows = list(_raw_rows(connection))
        hostile = list(rows[0])
        hostile[field_index] = f"{hostile[field_index]}\ud800"
        rows[0] = tuple(hostile)
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_TEXT"):
            _snapshot_target_catalog_observation_intrinsic(1_195_724_359, 2, tuple(rows))
    finally:
        _close_target(connection)


@pytest.mark.parametrize("scalar_text", ["\u00e9", "e\u0301", "\U0001f680"])
def test_accepts_nfc_nfd_and_non_bmp_scalars_without_normalization(scalar_text: str) -> None:
    connection = _open_target()
    try:
        rows = list(_raw_rows(connection))
        row_type, name, table_name, sql = rows[0]
        rows[0] = (row_type, name, table_name, f"{sql} -- {scalar_text}")
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_MISMATCH"):
            _snapshot_target_catalog_observation_intrinsic(1_195_724_359, 2, tuple(rows))
    finally:
        _close_target(connection)


@pytest.mark.parametrize(
    "sql",
    [
        "CREATE VIEW main.GE_CYCLE_UPPER_VIEW AS SELECT 1 AS hostile_value",
        "CREATE VIEW main.Ge_CyClE_Mixed_View AS SELECT 1 AS hostile_value",
        (
            "CREATE TRIGGER main.GE_CYCLE_UPPER_TRIGGER AFTER INSERT ON ge_cycle_streams "
            "BEGIN SELECT 1; END"
        ),
        (
            "CREATE TRIGGER main.Ge_CyClE_Mixed_Trigger AFTER INSERT ON ge_cycle_streams "
            "BEGIN SELECT 1; END"
        ),
        "DROP INDEX main.ge_cycle_operations_commit_idx",
    ],
)
def test_rejects_extra_or_missing_owned_catalog_object(sql: str) -> None:
    connection = _open_target()
    try:
        connection.execute(sql).close()
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_MISMATCH"):
            _read_validated_target_catalog_intrinsic(connection)
    finally:
        _close_target(connection)


def test_unrelated_catalog_object_does_not_change_owned_projection() -> None:
    connection = _open_target()
    try:
        before = _read_validated_target_catalog_intrinsic(connection)
        connection.execute("CREATE VIEW main.unrelated_projection AS SELECT 1 AS value").close()
        after = _read_validated_target_catalog_intrinsic(connection)
        assert after == before
    finally:
        _close_target(connection)


def test_seventy_extra_owned_rows_are_rejected_with_one_bounded_read() -> None:
    probe = _ProbeCatalogCursor([(str(index),) for index in range(70)])
    observed = _read_catalog_rows_from_cursor_intrinsic(probe)
    assert len(observed) == 35
    assert probe.requested_sizes == [35]
    assert probe.close_count == 1

    connection = _open_target()
    try:
        for index in range(70):
            connection.execute(
                f"CREATE VIEW main.ge_cycle_extra_{index:02d} AS SELECT {index} AS value"
            ).close()
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_MISMATCH"):
            _read_validated_target_catalog_intrinsic(connection)
    finally:
        _close_target(connection)


def test_query_and_metadata_sqlite_failures_have_stable_codes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _open_target()
    try:
        monkeypatch.setattr(
            target_catalog,
            "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY",
            "SELECT missing_column FROM main.missing_catalog",
        )
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_QUERY"):
            _read_validated_target_catalog_intrinsic(connection)
        monkeypatch.undo()

        monkeypatch.setattr(
            target_catalog,
            "_METADATA_QUERY",
            "SELECT missing_column FROM main.missing_metadata",
        )
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_METADATA"):
            _read_validated_target_catalog_intrinsic(connection)
    finally:
        _close_target(connection)


def test_read_failure_wins_over_close_failure_and_sole_close_failure_is_stable() -> None:
    primary = _ProbeCatalogCursor([], fail_read=True, fail_close=True)
    with _expect("GE_CURSOR_B3_TARGET_CATALOG_QUERY"):
        _read_catalog_rows_from_cursor_intrinsic(primary)
    assert primary.close_count == 1

    cleanup = _ProbeCatalogCursor([], fail_close=True)
    with _expect("GE_CURSOR_B3_TARGET_CATALOG_CLEANUP"):
        _read_catalog_rows_from_cursor_intrinsic(cleanup)
    assert cleanup.close_count == 1


@pytest.mark.parametrize(
    "pragma_sql",
    ["PRAGMA application_id = 1195724358", "PRAGMA user_version = 3"],
)
def test_application_and_user_version_drift_are_rejected(pragma_sql: str) -> None:
    connection = _open_target()
    try:
        connection.execute(pragma_sql).close()
        with _expect("GE_CURSOR_B3_TARGET_CATALOG_MISMATCH"):
            _read_validated_target_catalog_intrinsic(connection)
    finally:
        _close_target(connection)


def test_validation_read_has_no_write_or_transaction_side_effect() -> None:
    connection = _open_target()
    try:
        before = (
            connection.in_transaction,
            connection.in_exclusive_transaction,
            connection.transaction_mode,
            connection.transaction_epoch,
            connection.total_changes,
            connection._transaction_generation,
        )
        _read_validated_target_catalog_intrinsic(connection)
        after = (
            connection.in_transaction,
            connection.in_exclusive_transaction,
            connection.transaction_mode,
            connection.transaction_epoch,
            connection.total_changes,
            connection._transaction_generation,
        )
        assert after == before
        assert after[-1] is before[-1]
    finally:
        _close_target(connection)


def test_module_remains_package_private() -> None:
    forbidden_root_exports = (
        "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY",
        "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256",
        "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8",
        "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES",
        "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT",
        "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY",
        "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256",
        "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID",
        "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION",
        "SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR",
        "TargetCatalogCanonicalRow",
        "TargetCatalogSnapshot",
        "SQLiteCursorPublicationTargetCatalogSnapshot",
        "read_validated_target_catalog",
        "snapshot_target_catalog_observation",
        "_read_catalog_rows_from_cursor_intrinsic",
        "_read_metadata_from_cursor_intrinsic",
        "_read_validated_target_catalog_intrinsic",
        "_snapshot_target_catalog_observation_intrinsic",
    )
    assert set(forbidden_root_exports).isdisjoint(vars(graph_engineering))
