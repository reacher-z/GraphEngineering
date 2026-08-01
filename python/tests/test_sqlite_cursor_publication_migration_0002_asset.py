from __future__ import annotations

import inspect
import os
import shutil
import sqlite3
import weakref
from pathlib import Path

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_migration_0002_asset as asset_module
from graph_engineering.sqlite_cursor_publication_migration_0002_asset import (
    SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME,
    SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
    SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
    SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
    SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_NAME,
    SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
    SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_UTF8_BYTES,
    SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
    _checked_preview_manifest,
    _checked_utf8_lf,
    _load_sqlite_cursor_migration_0002_asset_intrinsic,
    _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic,
    _split_fixed_statements,
    _SQLiteCursorMigration0002Asset,
    _SQLiteCursorMigration0002PreviewManifestIdentity,
)


def test_loads_exact_installed_asset_and_manifest_as_one_opaque_proof() -> None:
    asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()
    snapshot = _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(asset)

    assert (
        asset_module._resource_path(SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_NAME)
        .stat()
        .st_size
        == SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_UTF8_BYTES
    )
    assert snapshot.asset_name == SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME
    assert snapshot.asset_sha256 == SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256
    assert snapshot.asset_utf8_bytes == SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES
    assert snapshot.fixed_statement_count == SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
    assert snapshot.preview_manifest_sha256 == SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256
    assert snapshot.schema_sql_sha256 == SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256
    assert len(snapshot.statements) == SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
    assert all(statement.endswith(";") for statement in snapshot.statements)
    assert all(sqlite3.complete_statement(statement) for statement in snapshot.statements)
    assert snapshot.statements[0].endswith("PRAGMA defer_foreign_keys = ON;")
    assert snapshot.statements[-1] == "PRAGMA user_version = 2;"

    second_asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()
    second_snapshot = _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(second_asset)
    assert second_asset is not asset
    assert second_snapshot.preview_manifest_identity is not snapshot.preview_manifest_identity
    assert second_snapshot.statements == snapshot.statements


def _copy_package_assets(root: Path) -> dict[str, Path]:
    copied: dict[str, Path] = {}
    for name in (
        SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME,
        SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_NAME,
    ):
        destination = root / name
        shutil.copyfile(asset_module._resource_path(name), destination)
        copied[name] = destination
    return copied


def test_each_load_rereads_both_regular_package_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    copied = _copy_package_assets(tmp_path)
    monkeypatch.setattr(asset_module, "_resource_path", lambda name: copied[name])

    original_asset = copied[SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME].read_bytes()
    original_manifest = copied[SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_NAME].read_bytes()
    proof = _load_sqlite_cursor_migration_0002_asset_intrinsic()

    copied[SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME].write_bytes(
        bytes([original_asset[0] ^ 1]) + original_asset[1:]
    )
    with pytest.raises(ValueError, match="package asset bytes drifted"):
        _load_sqlite_cursor_migration_0002_asset_intrinsic()
    assert _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(proof).statements

    copied[SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME].write_bytes(original_asset)
    copied[SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_NAME].write_bytes(
        original_manifest[:-2] + bytes([original_manifest[-2] ^ 1]) + original_manifest[-1:]
    )
    with pytest.raises(ValueError, match="preview manifest bytes drifted"):
        _load_sqlite_cursor_migration_0002_asset_intrinsic()


def test_snapshot_mutation_cannot_poison_registered_canonical_state() -> None:
    asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()
    first = _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(asset)
    original_identity = first.preview_manifest_identity
    original_statements = first.statements

    object.__setattr__(first, "asset_name", "hostile.sql")
    object.__setattr__(first, "asset_sha256", "0" * 64)
    object.__setattr__(first, "statements", ("DROP TABLE ge_cycle_schema;",))
    object.__setattr__(
        first,
        "preview_manifest_identity",
        object.__new__(_SQLiteCursorMigration0002PreviewManifestIdentity),
    )

    second = _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(asset)
    assert second is not first
    assert second.asset_name == SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME
    assert second.asset_sha256 == SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256
    assert second.statements == original_statements
    assert second.preview_manifest_identity is original_identity


def test_descriptor_close_fault_is_stable_and_primary_validation_failure_wins(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_close = os.close
    close_count = 0

    def close_then_fail(descriptor: int) -> None:
        nonlocal close_count
        close_count += 1
        real_close(descriptor)
        raise OSError("hostile close")

    monkeypatch.setattr(asset_module.os, "close", close_then_fail)
    with pytest.raises(ValueError, match=r"package asset is unavailable$"):
        asset_module._read_exact_bytes(
            SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME,
            SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
            SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
            "SQLite migration 0002 package asset",
        )

    copied = _copy_package_assets(tmp_path)
    original = copied[SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME].read_bytes()
    copied[SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME].write_bytes(
        bytes([original[0] ^ 1]) + original[1:]
    )
    monkeypatch.setattr(asset_module, "_resource_path", lambda name: copied[name])
    with pytest.raises(ValueError, match=r"package asset bytes drifted$"):
        asset_module._read_exact_bytes(
            SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME,
            SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
            SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
            "SQLite migration 0002 package asset",
        )
    assert close_count == 2


def test_rejects_a_symlink_instead_of_following_it(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    copied = _copy_package_assets(tmp_path)
    target = copied[SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME]
    link = tmp_path / "migration-link.sql"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("symlinks are unavailable on this platform")
    copied[SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME] = link
    monkeypatch.setattr(asset_module, "_resource_path", lambda name: copied[name])

    with pytest.raises(ValueError, match="package asset is invalid"):
        _load_sqlite_cursor_migration_0002_asset_intrinsic()


@pytest.mark.parametrize(
    "raw",
    [
        b"\xef\xbb\xbfSELECT 1;\n",
        b"SELECT 1;\r\n",
        b"SELECT 1;",
        b"SELECT 1;\n\n",
        b"SELECT '\xff';\n",
    ],
)
def test_rejects_noncanonical_utf8_lf(raw: bytes) -> None:
    with pytest.raises(ValueError, match="not canonical UTF-8/LF"):
        _checked_utf8_lf(raw, "hostile asset")
    assert _checked_utf8_lf(b"SELECT 1;\n", "control") == "SELECT 1;\n"


def test_statement_scanner_ignores_semicolons_in_quotes_and_comments() -> None:
    sources = [
        "-- leading ; comment\nSELECT ';';",
        '/* block ; comment */ SELECT "a;";',
        "SELECT `b;`;",
        "SELECT [c;];",
        "SELECT 'it''s;';",
        *[f"SELECT {index};" for index in range(15)],
    ]
    sql = "\n".join(sources) + "\n"

    statements = _split_fixed_statements(sql)

    assert len(statements) == 20
    assert len(sql.split(";")) > 21
    assert statements[:5] == tuple(sources[:5])
    assert all(sqlite3.complete_statement(statement) for statement in statements)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1;\n" * 19,
        ("SELECT 1;\n" * 20) + "SELECT 2",
        "SELECT 'unterminated;\n" + ("SELECT 1;\n" * 19),
        "/* unterminated ;\n" + ("SELECT 1;\n" * 20),
        ("SELECT 1;\n" * 20) + "-- unterminated comment",
    ],
)
def test_statement_scanner_rejects_count_quote_comment_and_trailing_drift(sql: str) -> None:
    with pytest.raises(ValueError, match="statement framing drifted"):
        _split_fixed_statements(sql)


def test_preview_manifest_checks_schema_and_migration_commitments() -> None:
    manifest_path = asset_module._resource_path(SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_NAME)
    text = manifest_path.read_text(encoding="utf-8")
    assert _checked_preview_manifest(text).migration["id"] == "v1-to-v2-operation-replay"

    hostile_schema = text.replace(
        SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
        "0" * 64,
        1,
    )
    with pytest.raises(ValueError, match="manifest identity drifted"):
        _checked_preview_manifest(hostile_schema)

    hostile_migration = text.replace(
        SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
        "f" * 64,
        1,
    )
    with pytest.raises(ValueError, match="manifest identity drifted"):
        _checked_preview_manifest(hostile_migration)

    duplicate = text.replace(
        '  "formatVersion": 1,',
        '  "formatVersion": 1,\n  "formatVersion": 1,',
        1,
    )
    with pytest.raises(ValueError, match="duplicate keys"):
        _checked_preview_manifest(duplicate)


def test_forged_objects_and_package_root_exports_are_rejected() -> None:
    with pytest.raises(TypeError, match="module-minted"):
        _SQLiteCursorMigration0002Asset(object())
    with pytest.raises(TypeError, match="module-minted"):
        _SQLiteCursorMigration0002PreviewManifestIdentity(object())

    forged = object.__new__(_SQLiteCursorMigration0002Asset)
    with pytest.raises(ValueError, match="asset proof is invalid"):
        _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(forged)

    for name in (
        "load_sqlite_cursor_migration_0002_asset",
        "read_sqlite_cursor_migration_0002_asset_snapshot",
        "SQLiteCursorMigration0002Asset",
        "SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256",
    ):
        assert not hasattr(graph_engineering, name)


def test_snapshot_reader_rejects_cross_type_equality_hash_and_proxy_before_lookup() -> None:
    asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()

    class CrossTypeEqual:
        hash_calls = 0
        equality_calls = 0

        def __hash__(self) -> int:
            type(self).hash_calls += 1
            return object.__hash__(asset)

        def __eq__(self, other: object) -> bool:
            type(self).equality_calls += 1
            return other is asset

    class ThrowingKey:
        def __hash__(self) -> int:
            raise AssertionError("hostile hash was invoked")

        def __eq__(self, other: object) -> bool:
            raise AssertionError(f"hostile equality was invoked for {other!r}")

    hostile_values = (CrossTypeEqual(), ThrowingKey(), weakref.proxy(asset))
    for hostile in hostile_values:
        with pytest.raises(ValueError, match=r"^SQLite migration 0002 asset proof is invalid$"):
            _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(hostile)  # type: ignore[arg-type]

    assert CrossTypeEqual.hash_calls == 0
    assert CrossTypeEqual.equality_calls == 0
    assert _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(asset).statements


def test_asset_module_has_no_sql_executor_or_transaction_owner() -> None:
    source = inspect.getsource(asset_module)
    assert "executescript(" not in source
    assert "sqlite3.Connection" not in source
    assert "commit(" not in source
    assert "rollback(" not in source
    assert os.path.basename(asset_module.__file__) == (
        "sqlite_cursor_publication_migration_0002_asset.py"
    )
