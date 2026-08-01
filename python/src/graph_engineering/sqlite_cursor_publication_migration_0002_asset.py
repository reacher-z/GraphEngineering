"""Package-private proof for the immutable SQLite migration 0002 asset.

The publication owner, not this module, executes the returned statements.  A
fresh proof rereads both installed package files and validates every byte before
it exposes the fixed execution plan.  No transaction or SQLite connection is
owned here.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
from contextlib import suppress
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
from typing import Never
from weakref import ReferenceType, ref

SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME = "0002-v1-to-v2-operation-replay.sql"
SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256 = (
    "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d"
)
SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES = 9_523
SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT = 20
SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_NAME = "manifest-v2.preview.json"
SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256 = (
    "f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf"
)
SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_UTF8_BYTES = 4_908
SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256 = (
    "5a0923462f7fa5eb1627955292aa3657253258fc5832e365257dc913740866a5"
)

_MIGRATION_PACKAGE = "graph_engineering._sqlite_migrations"
_MAXIMUM_ASSET_BYTES = 262_144
_TARGET_SCHEMA_IDENTITY_SHA256 = "9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634"
_CONSTRUCTION_TOKEN = object()


class _SQLiteCursorMigration0002Asset:
    """Empty exact-identity proof backed only by a weak registry."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("SQLite migration 0002 assets are module-minted")


class _SQLiteCursorMigration0002PreviewManifestIdentity:
    """Opaque identity of one independently verified preview manifest."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("SQLite migration 0002 preview manifests are module-minted")


@dataclass(frozen=True, slots=True)
class _SQLiteCursorMigration0002AssetSnapshot:
    asset_name: str
    asset_sha256: str
    asset_utf8_bytes: int
    fixed_statement_count: int
    preview_manifest_sha256: str
    preview_manifest_identity: _SQLiteCursorMigration0002PreviewManifestIdentity
    schema_sql_sha256: str
    statements: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _PreviewManifestRecord:
    manifest: dict[str, object]
    migration: dict[str, object]


@dataclass(frozen=True, slots=True)
class _SQLiteCursorMigration0002AssetRecord:
    """Canonical registry state that is never returned to a caller."""

    asset_name: str
    asset_sha256: str
    asset_utf8_bytes: int
    fixed_statement_count: int
    preview_manifest_sha256: str
    preview_manifest_identity: _SQLiteCursorMigration0002PreviewManifestIdentity
    schema_sql_sha256: str
    statements: tuple[str, ...]


_ASSETS: dict[
    int,
    tuple[
        ReferenceType[_SQLiteCursorMigration0002Asset],
        _SQLiteCursorMigration0002AssetRecord,
    ],
] = {}
_PREVIEW_MANIFESTS: dict[
    int,
    tuple[
        ReferenceType[_SQLiteCursorMigration0002PreviewManifestIdentity],
        _PreviewManifestRecord,
    ],
] = {}


def _fail(message: str) -> Never:
    raise ValueError(message)


def _register_preview_manifest_identity(
    identity: _SQLiteCursorMigration0002PreviewManifestIdentity,
    record: _PreviewManifestRecord,
) -> None:
    object_id = id(identity)

    def discard(
        reference: ReferenceType[_SQLiteCursorMigration0002PreviewManifestIdentity],
    ) -> None:
        current = _PREVIEW_MANIFESTS.get(object_id)
        if current is not None and current[0] is reference:
            _PREVIEW_MANIFESTS.pop(object_id, None)

    reference = ref(identity, discard)
    _PREVIEW_MANIFESTS[object_id] = (reference, record)


def _has_registered_preview_manifest_identity(
    identity: object,
) -> bool:
    if type(identity) is not _SQLiteCursorMigration0002PreviewManifestIdentity:
        return False
    current = _PREVIEW_MANIFESTS.get(id(identity))
    return current is not None and current[0]() is identity


def _register_asset(
    asset: _SQLiteCursorMigration0002Asset,
    record: _SQLiteCursorMigration0002AssetRecord,
) -> None:
    object_id = id(asset)

    def discard(reference: ReferenceType[_SQLiteCursorMigration0002Asset]) -> None:
        current = _ASSETS.get(object_id)
        if current is not None and current[0] is reference:
            _ASSETS.pop(object_id, None)

    reference = ref(asset, discard)
    _ASSETS[object_id] = (reference, record)


def _resource_path(name: str) -> Path:
    resource = files(_MIGRATION_PACKAGE).joinpath(name)
    if not isinstance(resource, os.PathLike):
        _fail(f"SQLite migration 0002 package asset {name} is not a regular file")
    return Path(os.fspath(resource))


def _read_exact_bytes(
    name: str,
    expected_bytes: int,
    expected_sha256: str,
    label: str,
) -> bytes:
    path = _resource_path(name)
    try:
        before = os.lstat(path)
    except FileNotFoundError:
        _fail(f"{label} is missing")
    except OSError:
        _fail(f"{label} is unavailable")
    if (
        not stat.S_ISREG(before.st_mode)
        or before.st_size != expected_bytes
        or before.st_size > _MAXIMUM_ASSET_BYTES
    ):
        _fail(f"{label} is invalid")

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        _fail(f"{label} is unavailable")
    try:
        try:
            opened = os.fstat(descriptor)
            if (
                not stat.S_ISREG(opened.st_mode)
                or opened.st_size != expected_bytes
                or opened.st_dev != before.st_dev
                or opened.st_ino != before.st_ino
            ):
                _fail(f"{label} changed while it was opened")
            chunks: list[bytes] = []
            remaining = expected_bytes + 1
            while remaining > 0:
                chunk = os.read(descriptor, min(65_536, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            raw = b"".join(chunks)
        except OSError:
            _fail(f"{label} is unavailable")
        if len(raw) != expected_bytes or hashlib.sha256(raw).hexdigest() != expected_sha256:
            _fail(f"{label} bytes drifted")
    except BaseException:
        with suppress(BaseException):
            os.close(descriptor)
        raise
    try:
        os.close(descriptor)
    except BaseException:
        _fail(f"{label} is unavailable")
    return raw


def _checked_utf8_lf(raw: bytes, label: str) -> str:
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        _fail(f"{label} is not canonical UTF-8/LF")
    if (
        text.encode("utf-8") != raw
        or raw.startswith(b"\xef\xbb\xbf")
        or b"\r" in raw
        or not raw.endswith(b"\n")
        or raw.endswith(b"\n\n")
    ):
        _fail(f"{label} is not canonical UTF-8/LF")
    return text


def _split_fixed_statements(sql: str) -> tuple[str, ...]:
    if type(sql) is not str:
        _fail("SQLite migration 0002 statement framing drifted")
    statements: list[str] = []
    start = 0
    quote: str | None = None
    line_comment = False
    block_comment = False
    index = 0
    while index < len(sql):
        current = sql[index]
        next_character = sql[index + 1] if index + 1 < len(sql) else ""
        if line_comment:
            if current == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if current == "*" and next_character == "/":
                block_comment = False
                index += 2
            else:
                index += 1
            continue
        if quote is not None:
            close = "]" if quote == "[" else quote
            if current == close:
                if quote != "[" and next_character == close:
                    index += 2
                    continue
                quote = None
            index += 1
            continue
        if current == "-" and next_character == "-":
            line_comment = True
            index += 2
            continue
        if current == "/" and next_character == "*":
            block_comment = True
            index += 2
            continue
        if current in {"'", '"', "`", "["}:
            quote = current
            index += 1
            continue
        if current == ";":
            statement = sql[start : index + 1].strip()
            if statement:
                statements.append(statement)
            start = index + 1
        index += 1

    trailing = sql[start:].strip()
    if (
        quote is not None
        or line_comment
        or block_comment
        or trailing
        or len(statements) != SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
    ):
        _fail("SQLite migration 0002 statement framing drifted")
    return tuple(statements)


def _strict_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            _fail("SQLite migration 0002 preview manifest JSON has duplicate keys")
        result[key] = value
    return result


def _reject_json_constant(token: str) -> Never:
    _fail(f"SQLite migration 0002 preview manifest JSON constant {token} is invalid")


def _checked_preview_manifest(text: str) -> _PreviewManifestRecord:
    try:
        value = json.loads(
            text,
            object_pairs_hook=_strict_json_object,
            parse_constant=_reject_json_constant,
        )
    except (TypeError, json.JSONDecodeError):
        _fail("SQLite migration 0002 preview manifest JSON is invalid")
    if type(value) is not dict:
        _fail("SQLite migration 0002 preview manifest identity drifted")
    manifest: dict[str, object] = value
    schema = manifest.get("schema")
    migrations = manifest.get("migrations")
    if (
        type(schema) is not dict
        or type(migrations) is not list
        or len(migrations) < 2
        or type(migrations[1]) is not dict
    ):
        _fail("SQLite migration 0002 preview manifest identity drifted")
    migration: dict[str, object] = migrations[1]
    if (
        manifest.get("$schema") != "./manifest-v2.preview.schema.json"
        or type(manifest.get("formatVersion")) is not int
        or manifest.get("formatVersion") != 1
        or manifest.get("engine") != "sqlite"
        or type(manifest.get("applicationId")) is not int
        or manifest.get("applicationId") != 1_195_724_359
        or type(manifest.get("latestVersion")) is not int
        or manifest.get("latestVersion") != 2
        or manifest.get("hashAlgorithm") != "sha256"
        or manifest.get("byteEncoding") != "utf-8-lf"
        or type(schema.get("version")) is not int
        or schema.get("version") != 2
        or schema.get("sqlSha256") != SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256
        or schema.get("schemaIdentitySha256") != _TARGET_SCHEMA_IDENTITY_SHA256
        or migration.get("id") != "v1-to-v2-operation-replay"
        or type(migration.get("fromVersion")) is not int
        or migration.get("fromVersion") != 1
        or type(migration.get("toVersion")) is not int
        or migration.get("toVersion") != 2
        or migration.get("sqlPath") != SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME
        or migration.get("sqlSha256") != SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256
        or migration.get("targetSchemaIdentitySha256") != _TARGET_SCHEMA_IDENTITY_SHA256
        or migration.get("transactionMode") != "caller-begin-exclusive"
        or migration.get("finalization") != "manifest-bound-prepared-statements-before-commit"
    ):
        _fail("SQLite migration 0002 preview manifest identity drifted")
    return _PreviewManifestRecord(manifest=manifest, migration=migration)


def _load_preview_manifest_identity() -> _SQLiteCursorMigration0002PreviewManifestIdentity:
    raw = _read_exact_bytes(
        SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_NAME,
        SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_UTF8_BYTES,
        SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
        "SQLite migration 0002 preview manifest",
    )
    text = _checked_utf8_lf(raw, "SQLite migration 0002 preview manifest")
    record = _checked_preview_manifest(text)
    identity = _SQLiteCursorMigration0002PreviewManifestIdentity(_CONSTRUCTION_TOKEN)
    _register_preview_manifest_identity(identity, record)
    return identity


def _load_sqlite_cursor_migration_0002_asset_intrinsic() -> _SQLiteCursorMigration0002Asset:
    """Reread installed bytes and mint one exact verified execution-plan proof."""

    raw = _read_exact_bytes(
        SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME,
        SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
        SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
        "SQLite migration 0002 package asset",
    )
    sql = _checked_utf8_lf(raw, "SQLite migration 0002 package asset")
    statements = _split_fixed_statements(sql)
    preview_manifest_identity = _load_preview_manifest_identity()
    asset = _SQLiteCursorMigration0002Asset(_CONSTRUCTION_TOKEN)
    record = _SQLiteCursorMigration0002AssetRecord(
        asset_name=SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME,
        asset_sha256=SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
        asset_utf8_bytes=SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
        fixed_statement_count=SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
        preview_manifest_sha256=SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
        preview_manifest_identity=preview_manifest_identity,
        schema_sql_sha256=SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
        statements=statements,
    )
    _register_asset(asset, record)
    return asset


def _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(
    asset: _SQLiteCursorMigration0002Asset,
) -> _SQLiteCursorMigration0002AssetSnapshot:
    """Resolve an exact registered proof without rereading or executing SQL."""

    if type(asset) is not _SQLiteCursorMigration0002Asset:
        _fail("SQLite migration 0002 asset proof is invalid")
    current = _ASSETS.get(id(asset))
    if current is None or current[0]() is not asset:
        _fail("SQLite migration 0002 asset proof is invalid")
    record = current[1]
    if not _has_registered_preview_manifest_identity(record.preview_manifest_identity):
        _fail("SQLite migration 0002 preview manifest proof is invalid")
    return _SQLiteCursorMigration0002AssetSnapshot(
        asset_name=record.asset_name,
        asset_sha256=record.asset_sha256,
        asset_utf8_bytes=record.asset_utf8_bytes,
        fixed_statement_count=record.fixed_statement_count,
        preview_manifest_sha256=record.preview_manifest_sha256,
        preview_manifest_identity=record.preview_manifest_identity,
        schema_sql_sha256=record.schema_sql_sha256,
        statements=record.statements,
    )
