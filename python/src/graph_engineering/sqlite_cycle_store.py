"""Durable same-host SQLite implementation of the CycleStore provider contract.

One persistent SQLite connection is created, configured, used, and closed on a
dedicated owner thread. Mutations begin with ``BEGIN IMMEDIATE`` and contain
the idempotency decision, semantic mutation, result ledger, and commit without
an intervening await. The provider is durable for a local filesystem; SQLite
file locks are deliberately not advertised as distributed fencing.
"""

from __future__ import annotations

import asyncio
import errno
import hashlib
import inspect
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib.resources import files
from pathlib import Path
from typing import Any, Literal, Never, TypeAlias, cast

from .canonical import canonical_bytes, canonical_sha256
from .cycle_store_provider import (
    CYCLE_STORE_CURSOR_TTL_MS,
    CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
    MAX_CYCLE_STORE_CURSOR_COUNT,
    CycleStoreAuthorizationContext,
    CycleStoreAuthorizationHook,
    CycleStoreCheckpoint,
    CycleStoreCheckpointPage,
    CycleStoreCheckpointSummary,
    CycleStoreClockHook,
    CycleStoreEventPage,
    CycleStoreGovernanceInspection,
    CycleStoreLease,
    CycleStoreLeaseBinding,
    CycleStoreLeaseInspection,
    CycleStoreMigrationLock,
    CycleStoreMutationContext,
    CycleStoreProviderDescriptor,
    CycleStoreProviderError,
    CycleStoreProviderErrorCode,
    CycleStoreProviderFaultHook,
    CycleStoreProviderOperation,
    CycleStoreRecord,
    CycleStoreSchemaInspection,
    CycleStoreTail,
    create_reference_cycle_store_provider_descriptor,
    cycle_store_adapter_codec,
)
from .models import MAX_SAFE_INTEGER, JsonObject, JsonValue
from .portable_json import portable_json_snapshot

SQLITE_CYCLE_STORE_PROVIDER_ID = "sqlite-local"
SQLITE_CYCLE_STORE_DESCRIPTOR_HASH = (
    "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe"
)
SQLITE_CYCLE_STORE_APPLICATION_ID = 1_195_724_359
SQLITE_CYCLE_STORE_SCHEMA_VERSION = 1
SQLITE_MIGRATION_MANIFEST_SHA256 = (
    "5f052a21215a39de101d56447fa4b25d20b6053bc558e3960562932e958d7af6"
)
SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256 = (
    "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4"
)
SQLITE_CYCLE_STORE_CATALOG_SHA256 = (
    "8fab5049e2c9de5d114abc0c682934f1bc6fb5abd2e4c2e3ae55ef329c3e7264"
)
SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_DOMAIN = (
    "graph-engineering/sqlite-cycle-store-schema/v1\0"
)
SQLITE_CYCLE_STORE_DEFAULT_BUSY_TIMEOUT_MS = 250
SQLITE_CYCLE_STORE_DEFAULT_BUSY_RETRY_ATTEMPTS = 3
SQLITE_CYCLE_STORE_DEFAULT_BUSY_RETRY_ELAPSED_MS = 1_500
SQLITE_CYCLE_STORE_DEFAULT_WAL_AUTOCHECKPOINT = 1_000
SQLITE_CYCLE_STORE_CURSOR_CLEANUP_LIMIT = 64
SQLITE_BACKUP_MANIFEST_API_VERSION = (
    "graphengineering.reacher-z.github.io/sqlite-cycle-store-backup-manifests/v1alpha1"
)
SQLITE_BACKUP_MANIFEST_DOMAIN = (
    "graph-engineering/sqlite-cycle-store-backup-manifest/v1\0"
)

_MIGRATION_PACKAGE = "graph_engineering._sqlite_migrations"
_SEMANTIC_AUDIT_DOMAIN = "graph-engineering/sqlite-semantic-audit/v1\0"
_ZERO_HASH = "0" * 64
_REQUIRED_MIGRATION_POSTCONDITIONS = (
    "application-id-matches",
    "user-version-is-1",
    "schema-singleton-is-manifest-bound",
    "migration-ledger-row-is-manifest-bound",
    "all-canonical-tables-are-strict",
    "logical-schema-identity-matches-fresh-v1",
    "foreign-key-check-is-empty",
    "integrity-check-is-ok",
    "alpha-row-counts-are-preserved",
    "stream-heads-match-record-tails",
    "canonical-blobs-and-hashes-are-preserved",
    "checkpoint-revisions-are-seeded",
    "lease-and-migration-fences-are-monotonic",
    "no-v0-or-placeholder-state-remains",
)

_TransactionAction: TypeAlias = Callable[[sqlite3.Connection, int], JsonValue]
_ConnectionAction: TypeAlias = Callable[[sqlite3.Connection], JsonValue]


@dataclass(frozen=True, slots=True)
class _MigrationAssets:
    manifest: JsonObject
    schema_sql: str
    schema_sql_bytes: bytes
    schema_identity: JsonObject
    schema_identity_bytes: bytes
    migration_sql: str
    migration_sql_bytes: bytes
    schema_sql_hash: str
    schema_identity_document_hash: str
    schema_identity_hash: str
    migration_sql_hash: str


def _raise_provider(
    code: CycleStoreProviderErrorCode,
    operation: CycleStoreProviderOperation,
    message: str,
    details: JsonObject | None = None,
) -> Never:
    raise CycleStoreProviderError(code, operation, message, details)


def _strict_json_object(pairs: list[tuple[str, JsonValue]]) -> JsonObject:
    result: JsonObject = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _reject_json_constant(token: str) -> Never:
    raise ValueError(f"invalid JSON constant: {token}")


def _decode_canonical_json_bytes(
    value: bytes,
    operation: CycleStoreProviderOperation,
    label: str,
    maximum_bytes: int,
) -> JsonValue:
    try:
        if type(value) is not bytes or not value or len(value) > maximum_bytes:
            raise ValueError("canonical value is outside bounds")
        decoded = json.loads(
            value.decode("utf-8"),
            object_pairs_hook=_strict_json_object,
            parse_constant=_reject_json_constant,
        )
        captured = portable_json_snapshot(decoded)
        if canonical_bytes(captured) != value:
            raise ValueError("canonical bytes drifted")
        return captured
    except Exception:
        _raise_provider("GE_CYCLE_STORE_CORRUPTION", operation, f"{label} bytes are corrupt")


def _load_json_asset(name: str) -> tuple[JsonObject, bytes]:
    raw = files(_MIGRATION_PACKAGE).joinpath(name).read_bytes()
    if raw.startswith(b"\xef\xbb\xbf") or not raw.endswith(b"\n") or b"\r" in raw:
        raise ValueError("migration JSON asset encoding is invalid")
    decoded = json.loads(
        raw.decode("utf-8"),
        object_pairs_hook=_strict_json_object,
        parse_constant=_reject_json_constant,
    )
    captured = portable_json_snapshot(decoded)
    if type(captured) is not dict:
        raise ValueError("migration JSON asset must contain an object")
    return captured, raw


def _load_text_asset(name: str) -> tuple[str, bytes]:
    raw = files(_MIGRATION_PACKAGE).joinpath(name).read_bytes()
    if raw.startswith(b"\xef\xbb\xbf") or not raw.endswith(b"\n") or b"\r" in raw:
        raise ValueError("migration SQL asset encoding is invalid")
    return raw.decode("utf-8"), raw


def _asset_hash(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _migration_postconditions_blob() -> bytes:
    return canonical_bytes(
        {"requiredPostconditions": list(_REQUIRED_MIGRATION_POSTCONDITIONS)}
    )


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1_048_576):
            digest.update(chunk)
    return digest.hexdigest()


def _load_migration_assets() -> _MigrationAssets:
    manifest, manifest_bytes = _load_json_asset("manifest.json")
    if _asset_hash(manifest_bytes) != SQLITE_MIGRATION_MANIFEST_SHA256:
        raise ValueError("migration manifest trust anchor drifted")
    schema_document = cast(JsonObject, manifest.get("schema"))
    migrations = manifest.get("migrations")
    if (
        set(manifest)
        != {
            "$schema",
            "formatVersion",
            "engine",
            "applicationId",
            "latestVersion",
            "hashAlgorithm",
            "byteEncoding",
            "schema",
            "migrations",
            "fixtures",
            "requiredArtifactCopies",
            "sqlPolicy",
        }
        or manifest.get("$schema") != "./manifest.schema.json"
        or manifest.get("formatVersion") != 1
        or manifest.get("engine") != "sqlite"
        or manifest.get("applicationId") != SQLITE_CYCLE_STORE_APPLICATION_ID
        or manifest.get("latestVersion") != SQLITE_CYCLE_STORE_SCHEMA_VERSION
        or manifest.get("hashAlgorithm") != "sha256"
        or manifest.get("byteEncoding") != "utf-8-lf"
        or type(schema_document) is not dict
        or type(migrations) is not list
        or len(migrations) != 1
        or type(migrations[0]) is not dict
    ):
        raise ValueError("migration manifest identity is invalid")
    migration_document = migrations[0]
    schema_sql, schema_sql_bytes = _load_text_asset(cast(str, schema_document["sqlPath"]))
    identity, identity_bytes = _load_json_asset(cast(str, schema_document["identityPath"]))
    migration_sql, migration_sql_bytes = _load_text_asset(
        cast(str, migration_document["sqlPath"])
    )
    schema_sql_hash = _asset_hash(schema_sql_bytes)
    identity_document_hash = _asset_hash(identity_bytes)
    migration_sql_hash = _asset_hash(migration_sql_bytes)
    schema_identity_hash = hashlib.sha256(
        SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_DOMAIN.encode("utf-8") + canonical_bytes(identity)
    ).hexdigest()
    if (
        set(schema_document)
        != {
            "version",
            "bootstrapId",
            "sqlPath",
            "sqlSha256",
            "identityPath",
            "identityDocumentSha256",
            "schemaIdentitySha256",
            "reversibility",
        }
        or set(migration_document)
        != {
            "id",
            "fromVersion",
            "toVersion",
            "sqlPath",
            "sqlSha256",
            "targetSchemaIdentitySha256",
            "reversibility",
            "transactionMode",
            "finalization",
            "requiredPostconditions",
        }
        or schema_document.get("version") != 1
        or schema_document.get("bootstrapId") != "fresh-v1-baseline"
        or schema_document.get("sqlPath") != "schema-v1.sql"
        or schema_document.get("identityPath") != "schema-v1.identity.json"
        or schema_document.get("reversibility")
        != "rebuild-from-verified-backup-only"
        or schema_document.get("sqlSha256") != schema_sql_hash
        or schema_document.get("identityDocumentSha256") != identity_document_hash
        or schema_document.get("schemaIdentitySha256") != schema_identity_hash
        or schema_identity_hash != SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256
        or migration_document.get("id") != "alpha-v0-to-v1"
        or migration_document.get("fromVersion") != 0
        or migration_document.get("toVersion") != 1
        or migration_document.get("sqlPath") != "0001-alpha-v0-to-v1.sql"
        or migration_document.get("sqlSha256") != migration_sql_hash
        or migration_document.get("targetSchemaIdentitySha256") != schema_identity_hash
        or migration_document.get("reversibility")
        != "rebuild-from-verified-backup-only"
        or migration_document.get("transactionMode") != "caller-begin-exclusive"
        or migration_document.get("finalization")
        != "manifest-bound-prepared-statements-before-commit"
        or migration_document.get("requiredPostconditions")
        != list(_REQUIRED_MIGRATION_POSTCONDITIONS)
        or manifest.get("requiredArtifactCopies")
        != [
            "npm:@graph-engineering/sqlite/migrations",
            "python:graph_engineering/_sqlite_migrations",
        ]
        or manifest.get("sqlPolicy")
        != {
            "transactionOwner": "adapter",
            "migrationTransaction": "begin-exclusive",
            "callerControlledSql": False,
            "extensions": False,
            "attach": False,
            "writableSchema": False,
            "downgrade": "rebuild-from-verified-backup-only",
        }
    ):
        raise ValueError("migration asset hash is invalid")
    fixtures = manifest.get("fixtures")
    if type(fixtures) is not list or len(fixtures) != 1 or type(fixtures[0]) is not dict:
        raise ValueError("migration fixture inventory is invalid")
    fixture = fixtures[0]
    for path_key, hash_key in (
        ("sqlPath", "sqlSha256"),
        ("expectationPath", "expectationSha256"),
    ):
        fixture_bytes = (
            files(_MIGRATION_PACKAGE)
            .joinpath(cast(str, fixture[path_key]))
            .read_bytes()
        )
        if _asset_hash(fixture_bytes) != fixture[hash_key]:
            raise ValueError("migration fixture hash is invalid")
    return _MigrationAssets(
        manifest=manifest,
        schema_sql=schema_sql,
        schema_sql_bytes=schema_sql_bytes,
        schema_identity=identity,
        schema_identity_bytes=identity_bytes,
        migration_sql=migration_sql,
        migration_sql_bytes=migration_sql_bytes,
        schema_sql_hash=schema_sql_hash,
        schema_identity_document_hash=identity_document_hash,
        schema_identity_hash=schema_identity_hash,
        migration_sql_hash=migration_sql_hash,
    )


def _execute_trusted_sql(conn: sqlite3.Connection, sql: str) -> None:
    statement = ""
    for line in sql.splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            if statement.strip():
                conn.execute(statement)
            statement = ""
    if statement.strip():
        raise ValueError("trusted SQL asset ends with an incomplete statement")


def _sqlite_base_code(error: sqlite3.Error) -> int | None:
    code = getattr(error, "sqlite_errorcode", None)
    return (code & 0xFF) if type(code) is int else None


def _is_busy_error(error: sqlite3.Error) -> bool:
    return _sqlite_base_code(error) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED)


def _translate_sqlite_error(
    error: sqlite3.Error,
    operation: CycleStoreProviderOperation,
    *,
    attempts: int | None = None,
) -> CycleStoreProviderError:
    base = _sqlite_base_code(error)
    details = cast(JsonObject, {})
    if base is not None:
        details["sqliteClass"] = base
    if attempts is not None:
        details["attemptCount"] = attempts
    if base in (
        sqlite3.SQLITE_BUSY,
        sqlite3.SQLITE_LOCKED,
        sqlite3.SQLITE_NOMEM,
        sqlite3.SQLITE_INTERRUPT,
        sqlite3.SQLITE_IOERR,
        sqlite3.SQLITE_CANTOPEN,
    ):
        return CycleStoreProviderError(
            "GE_CYCLE_STORE_UNAVAILABLE",
            operation,
            "SQLite provider is temporarily unavailable",
            details,
        )
    if base in (sqlite3.SQLITE_FULL, sqlite3.SQLITE_TOOBIG):
        return CycleStoreProviderError(
            "GE_CYCLE_STORE_QUOTA_EXCEEDED",
            operation,
            "SQLite provider storage quota is exhausted",
            details,
        )
    if base in (sqlite3.SQLITE_CORRUPT, sqlite3.SQLITE_NOTADB):
        return CycleStoreProviderError(
            "GE_CYCLE_STORE_CORRUPTION",
            operation,
            "SQLite provider storage is corrupt or unreadable",
            details,
        )
    if base in (sqlite3.SQLITE_READONLY, sqlite3.SQLITE_PERM, sqlite3.SQLITE_AUTH):
        return CycleStoreProviderError(
            "GE_CYCLE_STORE_PERMISSION_DENIED",
            operation,
            "SQLite provider storage is not writable",
            details,
        )
    if base == sqlite3.SQLITE_CONSTRAINT:
        return CycleStoreProviderError(
            "GE_CYCLE_STORE_CORRUPTION",
            operation,
            "SQLite relational invariant is corrupt",
            details,
        )
    return CycleStoreProviderError(
        "GE_CYCLE_STORE_INTERNAL",
        operation,
        "SQLite provider operation failed",
        details,
    )


def _tail_from_row(row: tuple[object, ...] | None) -> CycleStoreTail:
    if row is None:
        return cast(JsonObject, {"exists": False, "sequence": -1, "recordHash": None})
    sequence, record_hash = row
    if type(sequence) is not int or sequence < -1 or sequence > MAX_SAFE_INTEGER:
        raise ValueError("stream sequence is corrupt")
    if sequence == -1:
        if record_hash is not None:
            raise ValueError("empty stream tail is corrupt")
        return cast(JsonObject, {"exists": False, "sequence": -1, "recordHash": None})
    if type(record_hash) is not str:
        raise ValueError("stream record hash is corrupt")
    return cast(
        JsonObject,
        {"exists": True, "sequence": sequence, "recordHash": record_hash},
    )


def _iso_time(milliseconds: int) -> str:
    return (
        datetime.fromtimestamp(milliseconds / 1_000, tz=UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _parse_timestamp(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1_000)


def _add_duration(
    now_ms: int,
    duration_ms: int,
    operation: CycleStoreProviderOperation,
) -> int:
    if now_ms > MAX_SAFE_INTEGER - duration_ms:
        _raise_provider(
            "GE_CYCLE_STORE_QUOTA_EXCEEDED",
            operation,
            "provider timestamp range is exhausted",
        )
    return now_ms + duration_ms


def _allow_all(
    _context: CycleStoreAuthorizationContext,
    _operation: CycleStoreProviderOperation,
) -> bool:
    return True


class SQLiteCycleStoreProvider:
    """Durable CycleStore provider for one writable local SQLite database file."""

    def __init__(
        self,
        path: str | os.PathLike[str],
        *,
        now: CycleStoreClockHook | None = None,
        initial_time: str | None = None,
        authorize: CycleStoreAuthorizationHook | None = None,
        fault_hook: CycleStoreProviderFaultHook | None = None,
        busy_timeout_ms: int = SQLITE_CYCLE_STORE_DEFAULT_BUSY_TIMEOUT_MS,
        busy_retry_attempts: int = SQLITE_CYCLE_STORE_DEFAULT_BUSY_RETRY_ATTEMPTS,
        busy_retry_elapsed_ms: int = SQLITE_CYCLE_STORE_DEFAULT_BUSY_RETRY_ELAPSED_MS,
        wal_autocheckpoint: int = SQLITE_CYCLE_STORE_DEFAULT_WAL_AUTOCHECKPOINT,
        _observe_initial_clock: bool = True,
    ) -> None:
        operation: CycleStoreProviderOperation = "describe"
        try:
            raw_path = os.fspath(path)
        except TypeError:
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "SQLite database path is invalid",
            )
        if (
            type(raw_path) is not str
            or not raw_path
            or "\0" in raw_path
            or raw_path == ":memory:"
            or raw_path.startswith("file:")
        ):
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "SQLite database path must name a file",
            )
        database_path = Path(raw_path).expanduser().resolve(strict=False)
        if database_path.exists() and not database_path.is_file():
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "SQLite database path must name a file",
            )
        if not database_path.parent.exists() or not database_path.parent.is_dir():
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "SQLite database parent directory does not exist",
            )
        for value, minimum, maximum, label in (
            (busy_timeout_ms, 0, 5_000, "busy_timeout_ms"),
            (busy_retry_attempts, 1, 8, "busy_retry_attempts"),
            (busy_retry_elapsed_ms, 0, 30_000, "busy_retry_elapsed_ms"),
            (wal_autocheckpoint, 1, 1_000_000, "wal_autocheckpoint"),
        ):
            if type(value) is not int or value < minimum or value > maximum:
                _raise_provider(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    f"{label} is outside bounds",
                )
        if busy_timeout_ms * busy_retry_attempts > busy_retry_elapsed_ms:
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "SQLite busy retry policy exceeds its elapsed-time bound",
            )
        if type(_observe_initial_clock) is not bool:
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "SQLite initial clock observation policy is invalid",
            )
        if now is not None and initial_time is not None:
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "now and initial_time are mutually exclusive",
            )
        manual_now_ms: int | None = None
        if initial_time is not None:
            try:
                parsed = datetime.fromisoformat(initial_time.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError("timestamp lacks a timezone")
                manual_now_ms = int(parsed.timestamp() * 1_000)
            except Exception:
                _raise_provider(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "initial_time is invalid",
                )
        try:
            assets = _load_migration_assets()
        except Exception:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "packaged SQLite migration assets are corrupt",
            )
        reference = create_reference_cycle_store_provider_descriptor()
        profile = cast(
            JsonObject,
            {
                "providerId": SQLITE_CYCLE_STORE_PROVIDER_ID,
                "schemaVersion": reference["schemaVersion"],
                "compatibility": reference["compatibility"],
                "limits": reference["limits"],
                "capabilities": {
                    **cast(JsonObject, reference["capabilities"]),
                    "durability": "durable",
                    "distributedFencing": False,
                    "legalHold": "enforced",
                    "backupRestore": "enforced",
                },
                "protection": {
                    **cast(JsonObject, reference["protection"]),
                    "encryptionAtRest": "external",
                },
                "governance": reference["governance"],
            },
        )
        self._descriptor = cycle_store_adapter_codec.create_descriptor(profile)
        if self._descriptor["descriptorHash"] != SQLITE_CYCLE_STORE_DESCRIPTOR_HASH:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite provider descriptor identity is corrupt",
            )
        self._path = database_path
        self._assets = assets
        self._authorize_hook = authorize or _allow_all
        self._fault_hook = fault_hook
        self._external_now = now
        self._manual_now_ms = manual_now_ms
        self._last_observed_now_ms = 0
        self._busy_timeout_ms = busy_timeout_ms
        self._busy_retry_attempts = busy_retry_attempts
        self._busy_retry_elapsed_ms = busy_retry_elapsed_ms
        self._wal_autocheckpoint = wal_autocheckpoint
        self._observe_initial_clock = _observe_initial_clock
        self._operation_lock = asyncio.Lock()
        self._state_lock = threading.Lock()
        self._closed = False
        self._connection: sqlite3.Connection | None = None
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="graph-engineering-sqlite",
        )
        try:
            self._executor.submit(self._initialize_owner).result()
        except Exception:
            with suppress(Exception):
                self._executor.submit(self._close_owner).result()
            with self._state_lock:
                self._closed = True
            self._executor.shutdown(wait=True, cancel_futures=True)
            raise

    @property
    def path(self) -> Path:
        """Return the resolved local database path."""

        return self._path

    def _ensure_open(self, operation: CycleStoreProviderOperation) -> None:
        with self._state_lock:
            if self._closed:
                _raise_provider(
                    "GE_CYCLE_STORE_UNAVAILABLE",
                    operation,
                    "SQLite provider is closed",
                )

    def _create_connection(
        self,
        operation: CycleStoreProviderOperation,
    ) -> sqlite3.Connection:
        self._ensure_open(operation)
        conn: sqlite3.Connection | None = None
        try:
            conn = sqlite3.connect(
                self._path,
                timeout=self._busy_timeout_ms / 1_000,
                isolation_level=None,
            )
            conn.enable_load_extension(False)
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute(f"PRAGMA busy_timeout = {self._busy_timeout_ms:d}")
            journal = conn.execute("PRAGMA journal_mode = WAL").fetchone()
            conn.execute("PRAGMA synchronous = FULL")
            conn.execute("PRAGMA trusted_schema = OFF")
            conn.execute("PRAGMA writable_schema = OFF")
            conn.execute(f"PRAGMA wal_autocheckpoint = {self._wal_autocheckpoint:d}")
            checks = {
                "foreign_keys": conn.execute("PRAGMA foreign_keys").fetchone(),
                "busy_timeout": conn.execute("PRAGMA busy_timeout").fetchone(),
                "synchronous": conn.execute("PRAGMA synchronous").fetchone(),
                "trusted_schema": conn.execute("PRAGMA trusted_schema").fetchone(),
                "writable_schema": conn.execute("PRAGMA writable_schema").fetchone(),
                "wal_autocheckpoint": conn.execute("PRAGMA wal_autocheckpoint").fetchone(),
            }
            if (
                journal is None
                or str(journal[0]).lower() != "wal"
                or checks["foreign_keys"] != (1,)
                or checks["busy_timeout"] != (self._busy_timeout_ms,)
                or checks["synchronous"] != (2,)
                or checks["trusted_schema"] != (0,)
                or checks["writable_schema"] != (0,)
                or checks["wal_autocheckpoint"] != (self._wal_autocheckpoint,)
            ):
                _raise_provider(
                    "GE_CYCLE_STORE_UNAVAILABLE",
                    operation,
                    "SQLite connection safety settings were not retained",
                )
            return conn
        except CycleStoreProviderError:
            if conn is not None:
                conn.close()
            raise
        except sqlite3.Error as error:
            if conn is not None:
                conn.close()
            raise _translate_sqlite_error(error, operation) from None
        except Exception:
            if conn is not None:
                conn.close()
            _raise_provider(
                "GE_CYCLE_STORE_INTERNAL",
                operation,
                "SQLite provider connection setup failed",
            )

    def _owner_connection(
        self,
        operation: CycleStoreProviderOperation,
    ) -> sqlite3.Connection:
        conn = self._connection
        if conn is None:
            _raise_provider(
                "GE_CYCLE_STORE_UNAVAILABLE",
                operation,
                "SQLite provider connection is unavailable",
            )
        return conn

    def _initialize_owner(self) -> None:
        operation: CycleStoreProviderOperation = "inspect-schema"
        conn = self._create_connection(operation)
        self._connection = conn
        try:
            self._initialize()
        except Exception:
            conn.close()
            self._connection = None
            raise

    def _close_owner(self) -> None:
        conn = self._connection
        if conn is not None:
            if conn.in_transaction:
                with suppress(sqlite3.Error):
                    conn.execute("ROLLBACK")
            conn.close()
            self._connection = None

    def _run_connection(
        self,
        operation: CycleStoreProviderOperation,
        action: _ConnectionAction,
    ) -> JsonValue:
        started = time.monotonic()
        attempts = 0
        while True:
            attempts += 1
            conn = self._owner_connection(operation)
            try:
                return portable_json_snapshot(action(conn))
            except CycleStoreProviderError:
                raise
            except sqlite3.Error as error:
                elapsed_ms = int((time.monotonic() - started) * 1_000)
                if (
                    _is_busy_error(error)
                    and attempts < self._busy_retry_attempts
                    and elapsed_ms < self._busy_retry_elapsed_ms
                ):
                    continue
                raise _translate_sqlite_error(error, operation, attempts=attempts) from None
            except Exception:
                _raise_provider(
                    "GE_CYCLE_STORE_INTERNAL",
                    operation,
                    "SQLite provider operation failed",
                )

    def _initialize(self) -> None:
        operation: CycleStoreProviderOperation = "inspect-schema"

        def initialize(conn: sqlite3.Connection) -> JsonValue:
            application_id = cast(int, conn.execute("PRAGMA application_id").fetchone()[0])
            user_version = cast(int, conn.execute("PRAGMA user_version").fetchone()[0])
            table_names = {
                cast(str, row[0])
                for row in conn.execute(
                    """
                    SELECT name FROM sqlite_master
                    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                    """
                ).fetchall()
            }
            if not table_names:
                if (
                    application_id not in (0, SQLITE_CYCLE_STORE_APPLICATION_ID)
                    or user_version != 0
                ):
                    _raise_provider(
                        "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
                        operation,
                        "SQLite database identity is unsupported",
                    )
                self._bootstrap(conn)
            elif application_id != SQLITE_CYCLE_STORE_APPLICATION_ID:
                _raise_provider(
                    "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
                    operation,
                    "SQLite database application identity is unsupported",
                )
            elif user_version == 0:
                self._migrate_v0(conn)
            elif user_version == SQLITE_CYCLE_STORE_SCHEMA_VERSION:
                self._validate_schema(conn, operation, full_integrity=True)
            else:
                _raise_provider(
                    "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
                    operation,
                    "SQLite database schema version is unsupported",
                )
            if self._observe_initial_clock:
                observed = False
                try:
                    conn.execute("BEGIN IMMEDIATE")
                    self._now_ms(conn, operation)
                    conn.execute("COMMIT")
                    observed = True
                finally:
                    if not observed and conn.in_transaction:
                        conn.execute("ROLLBACK")
            return None

        self._run_connection(operation, initialize)

    def _bootstrap(self, conn: sqlite3.Connection) -> None:
        operation: CycleStoreProviderOperation = "inspect-schema"
        committed = False
        try:
            conn.execute("BEGIN EXCLUSIVE")
            _execute_trusted_sql(conn, self._assets.schema_sql)
            now_ms = self._raw_now_ms(conn, operation)
            schema = cast(JsonObject, self._assets.manifest["schema"])
            postconditions = _migration_postconditions_blob()
            conn.execute(
                """
                INSERT INTO ge_cycle_schema (
                  singleton, current_version, min_reader_version, max_reader_version,
                  min_writer_version, max_writer_version, schema_identity_sha256,
                  latest_migration_sha256, latest_migration_applied_at_ms,
                  provider_descriptor_hash, created_at_ms, updated_at_ms
                ) VALUES (1, 1, 1, 1, 1, 1, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self._assets.schema_identity_hash,
                    self._assets.schema_sql_hash,
                    now_ms,
                    self._descriptor["descriptorHash"],
                    now_ms,
                    now_ms,
                ),
            )
            conn.execute(
                """
                INSERT INTO ge_cycle_migrations (
                  version, previous_version, migration_id, sql_sha256,
                  schema_identity_sha256, applied_at_ms, reversibility,
                  postconditions_blob
                ) VALUES (1, 0, ?, ?, ?, ?, ?, ?)
                """,
                (
                    schema["bootstrapId"],
                    self._assets.schema_sql_hash,
                    self._assets.schema_identity_hash,
                    now_ms,
                    schema["reversibility"],
                    postconditions,
                ),
            )
            conn.execute(
                """
                INSERT INTO ge_cycle_migration_lock (
                  singleton, active_lock_id, active_owner_id, active_source_version,
                  active_target_version, active_lock_epoch, active_fencing_token,
                  active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
                  last_fencing_token, updated_at_ms
                ) VALUES (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)
                """,
                (now_ms,),
            )
            self._validate_schema(conn, operation, full_integrity=True)
            conn.execute("COMMIT")
            committed = True
        finally:
            if not committed and conn.in_transaction:
                conn.execute("ROLLBACK")

    def _migrate_v0(self, conn: sqlite3.Connection) -> None:
        operation: CycleStoreProviderOperation = "inspect-schema"
        required_v0 = {
            "ge_cycle_schema",
            "ge_cycle_streams",
            "ge_cycle_records",
            "ge_cycle_operations",
            "ge_cycle_checkpoints",
            "ge_cycle_leases",
            "ge_cycle_used_lease_ids",
            "ge_cycle_legal_holds",
            "ge_cycle_migration_lock",
            "ge_cycle_used_migration_lock_ids",
        }
        tables = {
            cast(str, row[0])
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        }
        if tables != required_v0:
            _raise_provider(
                "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
                operation,
                "SQLite alpha schema inventory is unsupported",
            )
        if conn.execute("PRAGMA foreign_key_check").fetchone() is not None or conn.execute(
            "PRAGMA integrity_check"
        ).fetchone() != ("ok",):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite alpha schema failed preflight",
            )
        committed = False
        try:
            conn.execute("BEGIN EXCLUSIVE")
            active = conn.execute(
                """
                SELECT active_lock_id, active_owner_id, active_source_version,
                       active_target_version, active_lock_epoch, active_fencing_token,
                       active_acquired_at_ms, active_expires_at_ms, updated_at_ms
                FROM ge_cycle_migration_lock WHERE singleton = 1
                """
            ).fetchone()
            schema_time = conn.execute(
                "SELECT updated_at_ms FROM ge_cycle_schema WHERE singleton = 1"
            ).fetchone()
            now_ms = self._raw_now_ms(conn, operation)
            if active is None or len(active) != 9 or any(
                value is not None for value in active[:8]
            ):
                _raise_provider(
                    "GE_CYCLE_STORE_MIGRATION_LOCKED",
                    operation,
                    "SQLite alpha migration is locked",
                )
            if (
                type(active[8]) is not int
                or schema_time is None
                or type(schema_time[0]) is not int
            ):
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite alpha provider clock is corrupt",
                )
            if now_ms < active[8] or now_ms < schema_time[0]:
                _raise_provider(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "provider clock moved backwards during migration",
                )
            if cast(int, conn.execute("PRAGMA user_version").fetchone()[0]) != 0:
                _raise_provider(
                    "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
                    operation,
                    "SQLite alpha schema changed during migration",
                )
            _execute_trusted_sql(conn, self._assets.migration_sql)
            migration = cast(
                JsonObject,
                cast(list[JsonValue], self._assets.manifest["migrations"])[0],
            )
            postconditions = _migration_postconditions_blob()
            changed = conn.execute(
                """
                UPDATE ge_cycle_schema
                SET schema_identity_sha256 = ?, latest_migration_sha256 = ?,
                    latest_migration_applied_at_ms = ?, provider_descriptor_hash = ?,
                    updated_at_ms = ?
                WHERE singleton = 1 AND current_version = 1
                  AND schema_identity_sha256 = ? AND latest_migration_sha256 = ?
                """,
                (
                    self._assets.schema_identity_hash,
                    self._assets.migration_sql_hash,
                    now_ms,
                    self._descriptor["descriptorHash"],
                    now_ms,
                    _ZERO_HASH,
                    _ZERO_HASH,
                ),
            ).rowcount
            if changed != 1:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite alpha migration metadata is corrupt",
                )
            conn.execute(
                """
                INSERT INTO ge_cycle_migrations (
                  version, previous_version, migration_id, sql_sha256,
                  schema_identity_sha256, applied_at_ms, reversibility,
                  postconditions_blob
                ) VALUES (1, 0, ?, ?, ?, ?, ?, ?)
                """,
                (
                    migration["id"],
                    self._assets.migration_sql_hash,
                    self._assets.schema_identity_hash,
                    now_ms,
                    migration["reversibility"],
                    postconditions,
                ),
            )
            lock_changed = conn.execute(
                """
                UPDATE ge_cycle_migration_lock SET updated_at_ms = ?
                WHERE singleton = 1 AND updated_at_ms <= ?
                """,
                (now_ms, now_ms),
            ).rowcount
            if lock_changed != 1:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite alpha provider clock finalization failed",
                )
            self._validate_schema(conn, operation, full_integrity=True)
            conn.execute("COMMIT")
            committed = True
        finally:
            if not committed and conn.in_transaction:
                conn.execute("ROLLBACK")

    def _validate_schema(
        self,
        conn: sqlite3.Connection,
        operation: CycleStoreProviderOperation,
        *,
        full_integrity: bool,
    ) -> None:
        if (
            conn.execute("PRAGMA application_id").fetchone()
            != (SQLITE_CYCLE_STORE_APPLICATION_ID,)
            or conn.execute("PRAGMA user_version").fetchone()
            != (SQLITE_CYCLE_STORE_SCHEMA_VERSION,)
        ):
            _raise_provider(
                "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
                operation,
                "SQLite database schema identity is unsupported",
            )
        identity = self._assets.schema_identity
        required_tables = cast(JsonObject, identity["requiredTables"])
        tables = {
            cast(str, row[0]): cast(str, row[1])
            for row in conn.execute(
                """
                SELECT name, sql FROM sqlite_master
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                """
            ).fetchall()
        }
        if set(tables) != set(required_tables):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite schema table inventory is corrupt",
            )
        for table_name, expected_columns_value in required_tables.items():
            if "STRICT" not in tables[table_name].upper():
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite schema strict-table inventory is corrupt",
                )
            escaped = table_name.replace('"', '""')
            columns = [
                cast(str, row[1])
                for row in conn.execute(f'PRAGMA table_info("{escaped}")').fetchall()
            ]
            if columns != expected_columns_value:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite schema column inventory is corrupt",
                )
        indexes = {
            cast(str, row[0])
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL"
            ).fetchall()
        }
        if not set(cast(list[str], identity["requiredIndexes"])).issubset(indexes):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite schema index inventory is corrupt",
            )
        if self._catalog_hash(conn, operation) != SQLITE_CYCLE_STORE_CATALOG_SHA256:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite schema catalog identity is corrupt",
            )
        schema_row = conn.execute(
            """
            SELECT current_version, min_reader_version, max_reader_version,
                   min_writer_version, max_writer_version, schema_identity_sha256,
                   latest_migration_sha256, provider_descriptor_hash,
                   latest_migration_applied_at_ms, created_at_ms, updated_at_ms
            FROM ge_cycle_schema WHERE singleton = 1
            """
        ).fetchone()
        if (
            schema_row is None
            or len(schema_row) != 11
            or schema_row[:5] != (1, 1, 1, 1, 1)
            or not all(type(value) is int for value in schema_row[8:11])
            or schema_row[5] != self._assets.schema_identity_hash
            or schema_row[7] != self._descriptor["descriptorHash"]
            or schema_row[8] != schema_row[10]
            or schema_row[9] > schema_row[10]
            or schema_row[6] not in (
                self._assets.schema_sql_hash,
                self._assets.migration_sql_hash,
            )
        ):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite schema manifest binding is corrupt",
            )
        migration_row = conn.execute(
            """
            SELECT previous_version, migration_id, sql_sha256,
                   schema_identity_sha256, applied_at_ms, reversibility,
                   postconditions_blob
            FROM ge_cycle_migrations WHERE version = 1
            """
        ).fetchone()
        allowed_migrations = {
            (
                0,
                "fresh-v1-baseline",
                self._assets.schema_sql_hash,
                self._assets.schema_identity_hash,
            ),
            (
                0,
                "alpha-v0-to-v1",
                self._assets.migration_sql_hash,
                self._assets.schema_identity_hash,
            ),
        }
        if (
            migration_row is None
            or len(migration_row) != 7
            or tuple(migration_row[:4]) not in allowed_migrations
            or migration_row[4] != schema_row[8]
            or migration_row[5] != "rebuild-from-verified-backup-only"
            or migration_row[6] != _migration_postconditions_blob()
            or schema_row[6] != migration_row[2]
        ):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite migration ledger binding is corrupt",
            )
        if conn.execute("SELECT COUNT(*) FROM ge_cycle_migrations").fetchone() != (1,):
            _raise_provider(
                "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
                operation,
                "SQLite migration lineage is unsupported",
            )
        if conn.execute("SELECT COUNT(*) FROM ge_cycle_migration_lock").fetchone() != (1,):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite migration lock singleton is corrupt",
            )
        clock_row = conn.execute(
            """
            SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1
            """
        ).fetchone()
        maximum_observed_row = conn.execute(
            """
            SELECT max(observed_at_ms) FROM (
              SELECT created_at_ms AS observed_at_ms FROM ge_cycle_schema
              UNION ALL SELECT updated_at_ms FROM ge_cycle_schema
              UNION ALL SELECT applied_at_ms FROM ge_cycle_migrations
              UNION ALL SELECT created_at_ms FROM ge_cycle_streams
              UNION ALL SELECT updated_at_ms FROM ge_cycle_streams
              UNION ALL SELECT committed_at_ms FROM ge_cycle_records
              UNION ALL SELECT committed_at_ms FROM ge_cycle_operations
              UNION ALL SELECT committed_at_ms FROM ge_cycle_checkpoints
              UNION ALL SELECT recorded_at_ms FROM ge_cycle_checkpoint_revisions
              UNION ALL SELECT updated_at_ms FROM ge_cycle_leases
              UNION ALL SELECT first_used_at_ms FROM ge_cycle_used_lease_ids
              UNION ALL SELECT placed_at_ms FROM ge_cycle_legal_holds
              UNION ALL SELECT created_at_ms FROM ge_cycle_cursors
              UNION ALL SELECT consumed_at_ms FROM ge_cycle_cursors
                WHERE consumed_at_ms IS NOT NULL
              UNION ALL SELECT first_used_at_ms
                FROM ge_cycle_used_migration_lock_ids
              UNION ALL SELECT updated_at_ms FROM ge_cycle_migration_lock
            )
            """
        ).fetchone()
        if (
            clock_row is None
            or len(clock_row) != 1
            or type(clock_row[0]) is not int
            or clock_row[0] < schema_row[8]
            or clock_row[0] > MAX_SAFE_INTEGER
            or maximum_observed_row is None
            or type(maximum_observed_row[0]) is not int
            or maximum_observed_row[0] < 0
            or maximum_observed_row[0] > MAX_SAFE_INTEGER
            or clock_row[0] < maximum_observed_row[0]
        ):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite provider clock high-water is corrupt",
            )
        if conn.execute("PRAGMA foreign_key_check").fetchone() is not None:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite foreign-key state is corrupt",
            )
        check_name = "integrity_check" if full_integrity else "quick_check"
        if conn.execute(f"PRAGMA {check_name}").fetchone() != ("ok",):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite structural state is corrupt",
            )

    def _catalog_hash(
        self,
        conn: sqlite3.Connection,
        operation: CycleStoreProviderOperation,
    ) -> str:
        catalog: list[JsonObject] = []
        for row in conn.execute(
            """
            SELECT type, name, tbl_name, sql
            FROM sqlite_schema
            WHERE name GLOB 'ge_cycle_*'
              AND type IN ('table', 'index')
              AND sql IS NOT NULL
            ORDER BY type, name
            """
        ).fetchall():
            if len(row) != 4 or not all(type(value) is str for value in row):
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite schema catalog row is corrupt",
                )
            catalog.append(
                cast(
                    JsonObject,
                    {
                        "type": row[0],
                        "name": row[1],
                        "tableName": row[2],
                        "sql": re.sub(r"\s+", " ", row[3]).strip(),
                    },
                )
            )
        return canonical_sha256(catalog)

    def _raw_now_ms(
        self,
        conn: sqlite3.Connection,
        operation: CycleStoreProviderOperation,
    ) -> int:
        try:
            if not conn.in_transaction:
                _raise_provider(
                    "GE_CYCLE_STORE_INTERNAL",
                    operation,
                    "SQLite provider clock must be read inside a transaction",
                )
            if self._manual_now_ms is not None:
                milliseconds = self._manual_now_ms
            elif self._external_now is not None:
                value = self._external_now()
                if type(value) is not datetime or value.tzinfo is None:
                    raise ValueError("clock value is invalid")
                milliseconds = int(value.timestamp() * 1_000)
            else:
                row = conn.execute(
                    """
                    SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000
                         + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)
                    """
                ).fetchone()
                if row is None or type(row[0]) is not int:
                    raise ValueError("SQLite clock is invalid")
                milliseconds = row[0]
            if milliseconds < 0 or milliseconds > MAX_SAFE_INTEGER:
                raise ValueError("clock is outside bounds")
            return milliseconds
        except CycleStoreProviderError:
            raise
        except Exception:
            _raise_provider(
                "GE_CYCLE_STORE_UNAVAILABLE",
                operation,
                "SQLite provider clock is invalid",
            )

    def _now_ms(
        self,
        conn: sqlite3.Connection,
        operation: CycleStoreProviderOperation,
    ) -> int:
        milliseconds = self._raw_now_ms(conn, operation)
        row = conn.execute(
            """
            SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1
            """
        ).fetchone()
        if (
            row is None
            or type(row[0]) is not int
            or row[0] < 0
            or row[0] > MAX_SAFE_INTEGER
        ):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite provider clock watermark is corrupt",
            )
        high_water = max(row[0], self._last_observed_now_ms)
        if milliseconds < high_water:
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "provider clock moved backwards",
            )
        self._last_observed_now_ms = milliseconds
        if milliseconds > row[0]:
            changed = conn.execute(
                """
                UPDATE ge_cycle_migration_lock SET updated_at_ms = ?
                WHERE singleton = 1 AND updated_at_ms = ?
                """,
                (milliseconds, row[0]),
            ).rowcount
            if changed != 1:
                _raise_provider(
                    "GE_CYCLE_STORE_CONFLICT",
                    operation,
                    "provider clock high-water lost CAS",
                )
        return milliseconds

    async def _authorize(
        self,
        context: CycleStoreAuthorizationContext,
        operation: CycleStoreProviderOperation,
    ) -> None:
        try:
            outcome = self._authorize_hook(context, operation)
            allowed = await outcome if inspect.isawaitable(outcome) else outcome
        except Exception:
            _raise_provider(
                "GE_CYCLE_STORE_INTERNAL",
                operation,
                "provider authorization hook failed",
            )
        if type(allowed) is not bool:
            _raise_provider(
                "GE_CYCLE_STORE_INTERNAL",
                operation,
                "authorization hook returned invalid data",
            )
        if not allowed:
            _raise_provider(
                "GE_CYCLE_STORE_PERMISSION_DENIED",
                operation,
                "provider operation is not authorized",
            )

    def _run_fault_sync(
        self,
        boundary: str,
        operation: CycleStoreProviderOperation,
    ) -> None:
        if self._fault_hook is None:
            return
        try:
            outcome = self._fault_hook(boundary)
            if inspect.isawaitable(outcome):
                if inspect.iscoroutine(outcome):
                    outcome.close()
                else:
                    with suppress(Exception):
                        cancel = getattr(outcome, "cancel", None)
                        if callable(cancel):
                            cancel()
                _raise_provider(
                    "GE_CYCLE_STORE_UNAVAILABLE",
                    operation,
                    "provider fault hook cannot be asynchronous",
                    cast(JsonObject, {"boundary": boundary}),
                )
        except CycleStoreProviderError:
            raise
        except Exception:
            raise CycleStoreProviderError(
                "GE_CYCLE_STORE_UNAVAILABLE",
                operation,
                "provider acknowledgement is unavailable",
                cast(JsonObject, {"boundary": boundary}),
            ) from None

    def _assert_online_writer_compatible(
        self,
        conn: sqlite3.Connection,
        operation: CycleStoreProviderOperation,
        now_ms: int,
    ) -> None:
        row = conn.execute(
            """
            SELECT active_fencing_token, active_expires_at_ms
            FROM ge_cycle_migration_lock WHERE singleton = 1
            """
        ).fetchone()
        if row is None:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "migration lock singleton is corrupt",
            )
        if row[0] is not None and cast(int, row[1]) > now_ms:
            _raise_provider(
                "GE_CYCLE_STORE_MIGRATION_LOCKED",
                operation,
                "online mutation is blocked by an active incompatible migration",
                cast(JsonObject, {"migrationFencingToken": row[0]}),
            )

    def _ledger_replay(
        self,
        conn: sqlite3.Connection,
        operation: CycleStoreProviderOperation,
        context: CycleStoreMutationContext,
        request_hash: str,
    ) -> tuple[bool, JsonValue]:
        row = conn.execute(
            """
            SELECT operation_name, request_hash, result_blob, result_hash
            FROM ge_cycle_operations WHERE tenant_id = ? AND operation_id = ?
            """,
            (context["tenantId"], context["operationId"]),
        ).fetchone()
        if row is None:
            return False, None
        if row[0] != operation or row[1] != request_hash:
            _raise_provider(
                "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT",
                operation,
                "operationId was reused with a different canonical request",
            )
        result_bytes = row[2]
        if type(result_bytes) is not bytes or type(row[3]) is not str or hashlib.sha256(
            result_bytes
        ).hexdigest() != row[3]:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "idempotency result hash is corrupt",
            )
        return True, cycle_store_adapter_codec.decode_ledger_result(operation, result_bytes)

    def _mutate_sync(
        self,
        operation: CycleStoreProviderOperation,
        context: CycleStoreMutationContext,
        canonical_request: JsonObject,
        action: _TransactionAction,
    ) -> JsonValue:
        request_hash = cycle_store_adapter_codec.operation_request_hash(
            operation,
            canonical_request,
        )
        started = time.monotonic()
        attempts = 0
        while True:
            attempts += 1
            conn = self._owner_connection(operation)
            committed = False
            try:
                conn.execute("BEGIN IMMEDIATE")
                self._run_fault_sync(
                    f"provider:{operation}:transaction-reserved",
                    operation,
                )
                replay_found, replay = self._ledger_replay(
                    conn,
                    operation,
                    context,
                    request_hash,
                )
                if operation != "append":
                    self._run_fault_sync(
                        f"provider:{operation}:decision-state-read",
                        operation,
                    )
                if replay_found:
                    conn.execute("COMMIT")
                    committed = True
                    return replay
                now_ms = self._now_ms(conn, operation)
                if operation not in ("acquire-migration-lock", "release-migration-lock"):
                    self._assert_online_writer_compatible(conn, operation, now_ms)
                result = action(conn, now_ms)
                result_bytes = cycle_store_adapter_codec.encode_ledger_result(operation, result)
                result_hash = hashlib.sha256(result_bytes).hexdigest()
                conn.execute(
                    """
                    INSERT INTO ge_cycle_operations (
                      tenant_id, operation_id, operation_name, request_hash,
                      result_blob, result_hash, committed_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        context["tenantId"],
                        context["operationId"],
                        operation,
                        request_hash,
                        result_bytes,
                        result_hash,
                        now_ms,
                    ),
                )
                self._run_fault_sync(
                    f"provider:{operation}:ledger-staged",
                    operation,
                )
                self._run_fault_sync(f"provider:{operation}:before-commit", operation)
                conn.execute("COMMIT")
                committed = True
                self._run_fault_sync(
                    f"provider:{operation}:commit-returned",
                    operation,
                )
                self._run_fault_sync(
                    f"provider:{operation}:after-commit-before-return",
                    operation,
                )
                return cycle_store_adapter_codec.decode_ledger_result(operation, result_bytes)
            except CycleStoreProviderError:
                raise
            except sqlite3.Error as error:
                elapsed_ms = int((time.monotonic() - started) * 1_000)
                if (
                    _is_busy_error(error)
                    and attempts < self._busy_retry_attempts
                    and elapsed_ms < self._busy_retry_elapsed_ms
                ):
                    continue
                raise _translate_sqlite_error(error, operation, attempts=attempts) from None
            except Exception:
                _raise_provider(
                    "GE_CYCLE_STORE_INTERNAL",
                    operation,
                    "SQLite provider operation failed",
                )
            finally:
                if not committed and conn.in_transaction:
                    with suppress(sqlite3.Error):
                        conn.execute("ROLLBACK")

    async def _read(
        self,
        operation: CycleStoreProviderOperation,
        context: CycleStoreAuthorizationContext,
        action: _ConnectionAction,
    ) -> JsonValue:
        await self._authorize(context, operation)
        async with self._operation_lock:
            self._ensure_open(operation)
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(
                self._executor,
                self._run_connection,
                operation,
                action,
            )

    async def _mutate(
        self,
        operation: CycleStoreProviderOperation,
        context: CycleStoreMutationContext,
        canonical_request: JsonObject,
        action: _TransactionAction,
    ) -> JsonValue:
        await self._authorize(context, operation)
        loop = asyncio.get_running_loop()
        async with self._operation_lock:
            self._ensure_open(operation)
            return await loop.run_in_executor(
                self._executor,
                self._mutate_sync,
                operation,
                context,
                canonical_request,
                action,
            )

    async def describe(self) -> CycleStoreProviderDescriptor:
        self._ensure_open("describe")
        return cast(JsonObject, portable_json_snapshot(self._descriptor))

    async def close(self) -> None:
        """Idempotently close the connection on its dedicated owning worker."""

        async with self._operation_lock:
            with self._state_lock:
                if self._closed:
                    return
                self._closed = True
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(self._executor, self._close_owner)
            self._executor.shutdown(wait=True, cancel_futures=True)

    async def __aenter__(self) -> SQLiteCycleStoreProvider:
        self._ensure_open("describe")
        return self

    async def __aexit__(
        self,
        _exc_type: object,
        _exc: object,
        _traceback: object,
    ) -> None:
        await self.close()

    def _stream_tail(
        self,
        conn: sqlite3.Connection,
        tenant_id: str,
        stream_id: str,
        operation: CycleStoreProviderOperation,
    ) -> CycleStoreTail:
        row = conn.execute(
            """
            SELECT tail_sequence, tail_record_hash FROM ge_cycle_streams
            WHERE tenant_id = ? AND stream_id = ?
            """,
            (tenant_id, stream_id),
        ).fetchone()
        try:
            return _tail_from_row(row)
        except Exception:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "stream tail is corrupt",
            )

    def _migration_lock(self, row: tuple[object, ...] | None) -> CycleStoreMigrationLock | None:
        if row is None or row[0] is None:
            return None
        try:
            (
                lock_id,
                owner_id,
                source_version,
                target_version,
                lock_epoch,
                fencing_token,
                acquired_at_ms,
                expires_at_ms,
            ) = row
            if not all(
                type(value) is int
                for value in (
                    source_version,
                    target_version,
                    lock_epoch,
                    fencing_token,
                    acquired_at_ms,
                    expires_at_ms,
                )
            ) or type(lock_id) is not str or type(owner_id) is not str:
                raise ValueError("migration lock row has invalid types")
            return cast(
                JsonObject,
                {
                    "lockId": lock_id,
                    "ownerId": owner_id,
                    "sourceSchemaVersion": source_version,
                    "targetSchemaVersion": target_version,
                    "lockEpoch": lock_epoch,
                    "fencingToken": fencing_token,
                    "acquiredAt": _iso_time(cast(int, acquired_at_ms)),
                    "expiresAt": _iso_time(cast(int, expires_at_ms)),
                },
            )
        except Exception:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                "inspect-migration-lock",
                "migration lock row is corrupt",
            )

    def _lease_from_row(
        self,
        row: tuple[object, ...],
        operation: CycleStoreProviderOperation,
    ) -> CycleStoreLease | None:
        if row[0] is None:
            return None
        try:
            lease_id, holder_id, lease_epoch, fencing_token, acquired_ms, expires_ms = row[:6]
            if (
                type(lease_id) is not str
                or type(holder_id) is not str
                or not all(
                    type(value) is int
                    for value in (lease_epoch, fencing_token, acquired_ms, expires_ms)
                )
            ):
                raise ValueError("lease row has invalid types")
            return cast(
                JsonObject,
                {
                    "leaseId": lease_id,
                    "holderId": holder_id,
                    "leaseEpoch": lease_epoch,
                    "fencingToken": fencing_token,
                    "acquiredAt": _iso_time(cast(int, acquired_ms)),
                    "expiresAt": _iso_time(cast(int, expires_ms)),
                },
            )
        except Exception:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "lease row is corrupt",
            )

    def _lease_row(
        self,
        conn: sqlite3.Connection,
        tenant_id: str,
        stream_id: str,
    ) -> tuple[object, ...] | None:
        row = conn.execute(
            """
            SELECT active_lease_id, active_holder_id, active_lease_epoch,
                   active_fencing_token, active_acquired_at_ms, active_expires_at_ms,
                   last_lease_epoch, last_fencing_token
            FROM ge_cycle_leases WHERE tenant_id = ? AND stream_id = ?
            """,
            (tenant_id, stream_id),
        ).fetchone()
        return None if row is None else tuple(row)

    def _assert_write_lease(
        self,
        conn: sqlite3.Connection,
        tenant_id: str,
        stream_id: str,
        binding: CycleStoreLeaseBinding | None,
        operation: CycleStoreProviderOperation,
        now_ms: int,
    ) -> None:
        row = self._lease_row(conn, tenant_id, stream_id)
        last_fencing_token = 0 if row is None else row[7]
        if type(last_fencing_token) is not int:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "lease fence is corrupt",
            )
        if last_fencing_token == 0:
            if binding is not None:
                _raise_provider(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "stream has no fenced owner",
                )
            return
        active = None if row is None else self._lease_from_row(row, operation)
        if (
            active is None
            or _parse_timestamp(cast(str, active["expiresAt"])) <= now_ms
            or binding is None
            or binding["leaseId"] != active["leaseId"]
            or binding["holderId"] != active["holderId"]
            or binding["fencingToken"] != active["fencingToken"]
        ):
            _raise_provider(
                "GE_CYCLE_STORE_STALE_FENCE",
                operation,
                "write lease is stale or inactive",
                cast(JsonObject, {"lastFencingToken": last_fencing_token}),
            )

    def _record_from_row(
        self,
        row: tuple[object, ...],
        operation: CycleStoreProviderOperation,
    ) -> CycleStoreRecord:
        try:
            (
                sequence,
                record_id,
                previous_hash,
                value_hash,
                value_bytes,
                value_blob,
                record_hash,
                record_blob,
            ) = row
            if type(record_blob) is not bytes or type(value_blob) is not bytes:
                raise ValueError("record BLOB has invalid type")
            record = cycle_store_adapter_codec.parse_stored_record(record_blob, operation)
            if (
                record["sequence"] != sequence
                or record["recordId"] != record_id
                or record["previousRecordHash"] != previous_hash
                or record["valueHash"] != value_hash
                or record["valueBytes"] != value_bytes
                or record["recordHash"] != record_hash
                or canonical_bytes(record["value"]) != value_blob
            ):
                raise ValueError("record columns drifted")
            return record
        except CycleStoreProviderError:
            raise
        except Exception:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "record storage identity is corrupt",
            )

    async def inspect_schema(self, context_value: object) -> CycleStoreSchemaInspection:
        operation: CycleStoreProviderOperation = "inspect-schema"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            context_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])

        def inspect_schema(conn: sqlite3.Connection) -> JsonValue:
            self._validate_schema(conn, operation, full_integrity=False)
            compatibility = cast(JsonObject, self._descriptor["compatibility"])
            row = conn.execute(
                """
                SELECT active_lock_id, active_owner_id, active_source_version,
                       active_target_version, active_lock_epoch, active_fencing_token,
                       active_acquired_at_ms, active_expires_at_ms
                FROM ge_cycle_migration_lock WHERE singleton = 1
                """
            ).fetchone()
            return cast(
                JsonObject,
                {
                    "descriptorHash": self._descriptor["descriptorHash"],
                    "schemaVersion": self._descriptor["schemaVersion"],
                    "minReaderVersion": compatibility["minReaderVersion"],
                    "maxReaderVersion": compatibility["maxReaderVersion"],
                    "minWriterVersion": compatibility["minWriterVersion"],
                    "maxWriterVersion": compatibility["maxWriterVersion"],
                    "migrationLock": self._migration_lock(row),
                },
            )

        return cast(JsonObject, await self._read(operation, context, inspect_schema))

    async def read_tail(self, request_value: object) -> CycleStoreTail:
        operation: CycleStoreProviderOperation = "read-tail"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        return cast(
            JsonObject,
            await self._read(
                operation,
                context,
                lambda conn: self._stream_tail(conn, tenant_id, stream_id, operation),
            ),
        )

    async def append(self, request_value: object) -> JsonObject:
        operation: CycleStoreProviderOperation = "append"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        expected_tail = cast(JsonObject, request["expectedTail"])
        binding = cast(CycleStoreLeaseBinding | None, request["lease"])
        records = cast(list[CycleStoreRecord], request["records"])

        def append_records(conn: sqlite3.Connection, now_ms: int) -> JsonValue:
            actual_tail = self._stream_tail(conn, tenant_id, stream_id, operation)
            if actual_tail != expected_tail:
                _raise_provider(
                    "GE_CYCLE_STORE_CONFLICT",
                    operation,
                    "append lost expected-tail CAS",
                    cast(
                        JsonObject,
                        {
                            "expectedSequence": expected_tail["sequence"],
                            "actualSequence": actual_tail["sequence"],
                        },
                    ),
                )
            self._assert_write_lease(
                conn,
                tenant_id,
                stream_id,
                binding,
                operation,
                now_ms,
            )
            self._run_fault_sync(
                "provider:append:decision-state-read",
                operation,
            )
            next_sequence = cast(int, actual_tail["sequence"]) + 1
            previous_hash = actual_tail["recordHash"]
            batch_ids: set[str] = set()
            for record in records:
                record_id = cast(str, record["recordId"])
                if (
                    record["sequence"] != next_sequence
                    or record["previousRecordHash"] != previous_hash
                ):
                    _raise_provider(
                        "GE_CYCLE_STORE_CONFLICT",
                        operation,
                        "append record chain is not contiguous",
                    )
                if record_id in batch_ids or conn.execute(
                    "SELECT 1 FROM ge_cycle_records WHERE tenant_id = ? AND record_id = ?",
                    (tenant_id, record_id),
                ).fetchone() is not None:
                    _raise_provider(
                        "GE_CYCLE_STORE_CONFLICT",
                        operation,
                        "recordId is already committed",
                        cast(JsonObject, {"recordId": record_id}),
                    )
                batch_ids.add(record_id)
                previous_hash = record["recordHash"]
                next_sequence += 1
            if not actual_tail["exists"]:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO ge_cycle_streams (
                      tenant_id, stream_id, tail_sequence, tail_record_hash,
                      created_at_ms, updated_at_ms
                    ) VALUES (?, ?, -1, NULL, ?, ?)
                    """,
                    (tenant_id, stream_id, now_ms, now_ms),
                )
            for record in records:
                conn.execute(
                    """
                    INSERT INTO ge_cycle_records (
                      tenant_id, stream_id, sequence, record_id, previous_record_hash,
                      value_hash, value_bytes, value_blob, record_hash, record_blob,
                      committed_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        tenant_id,
                        stream_id,
                        record["sequence"],
                        record["recordId"],
                        record["previousRecordHash"],
                        record["valueHash"],
                        record["valueBytes"],
                        canonical_bytes(record["value"]),
                        record["recordHash"],
                        canonical_bytes(record),
                        now_ms,
                    ),
                )
            last = records[-1]
            changed = conn.execute(
                """
                UPDATE ge_cycle_streams
                SET tail_sequence = ?, tail_record_hash = ?, updated_at_ms = ?
                WHERE tenant_id = ? AND stream_id = ?
                  AND tail_sequence = ? AND tail_record_hash IS ?
                """,
                (
                    last["sequence"],
                    last["recordHash"],
                    now_ms,
                    tenant_id,
                    stream_id,
                    actual_tail["sequence"],
                    actual_tail["recordHash"],
                ),
            ).rowcount
            if changed != 1:
                _raise_provider(
                    "GE_CYCLE_STORE_CONFLICT",
                    operation,
                    "append lost expected-tail CAS",
                )
            self._run_fault_sync(
                "provider:append:records-staged",
                operation,
            )
            return cast(
                JsonObject,
                {
                    "tail": {
                        "exists": True,
                        "sequence": last["sequence"],
                        "recordHash": last["recordHash"],
                    },
                    "appendedRecords": len(records),
                },
            )

        return cast(JsonObject, await self._mutate(operation, context, request, append_records))

    def _cleanup_cursors(self, conn: sqlite3.Connection, now_ms: int) -> None:
        conn.execute(
            """
            DELETE FROM ge_cycle_cursors
            WHERE (tenant_id, token_hash) IN (
              SELECT tenant_id, token_hash FROM ge_cycle_cursors
              WHERE expires_at_ms <= ?
              ORDER BY expires_at_ms, tenant_id, token_hash
              LIMIT ?
            )
            """,
            (now_ms, SQLITE_CYCLE_STORE_CURSOR_CLEANUP_LIMIT),
        )

    def _new_cursor_token(self) -> tuple[str, str]:
        token = f"cursor-{secrets.token_hex(32)}"
        return token, canonical_sha256(token)

    def _store_cursor(
        self,
        conn: sqlite3.Connection,
        *,
        context: CycleStoreAuthorizationContext,
        kind: Literal["event", "checkpoint"],
        stream_id: str | None,
        checkpoint_scope: str | None,
        request_scope_blob: bytes,
        page_size: int,
        next_position: int,
        snapshot_tail: CycleStoreTail | None,
        snapshot_blob: bytes,
        now_ms: int,
        operation: CycleStoreProviderOperation,
    ) -> str:
        count_row = conn.execute("SELECT COUNT(*) FROM ge_cycle_cursors").fetchone()
        if count_row is None or type(count_row[0]) is not int or count_row[0] < 0:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "cursor inventory is corrupt",
            )
        if count_row[0] >= MAX_CYCLE_STORE_CURSOR_COUNT:
            _raise_provider(
                "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                operation,
                "cursor quota exceeded",
            )
        if (
            len(request_scope_blob) > 1_048_576
            or len(snapshot_blob) > 16_777_216
        ):
            _raise_provider(
                "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                operation,
                "cursor snapshot exceeds byte limit",
            )
        if now_ms > MAX_SAFE_INTEGER - CYCLE_STORE_CURSOR_TTL_MS:
            _raise_provider(
                "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                operation,
                "provider timestamp range is exhausted",
            )
        expires_at_ms = now_ms + CYCLE_STORE_CURSOR_TTL_MS
        for _ in range(4):
            token, token_hash = self._new_cursor_token()
            try:
                conn.execute(
                    """
                    INSERT INTO ge_cycle_cursors (
                      tenant_id, token_hash, kind, principal_hash, authorization_hash,
                      stream_id, checkpoint_scope, request_scope_blob, page_size,
                      next_position, snapshot_tail_sequence, snapshot_tail_record_hash,
                      descriptor_hash, schema_identity_sha256, snapshot_blob,
                      created_at_ms, expires_at_ms, consumed_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        context["tenantId"],
                        token_hash,
                        kind,
                        context["principalHash"],
                        context["authorizationHash"],
                        stream_id,
                        checkpoint_scope,
                        request_scope_blob,
                        page_size,
                        next_position,
                        None if snapshot_tail is None else snapshot_tail["sequence"],
                        None if snapshot_tail is None else snapshot_tail["recordHash"],
                        self._descriptor["descriptorHash"],
                        self._assets.schema_identity_hash,
                        snapshot_blob,
                        now_ms,
                        expires_at_ms,
                    ),
                )
                return token
            except sqlite3.IntegrityError:
                continue
        _raise_provider(
            "GE_CYCLE_STORE_INTERNAL",
            operation,
            "cursor identity allocation failed",
        )

    async def read_event_page(self, request_value: object) -> CycleStoreEventPage:
        operation: CycleStoreProviderOperation = "read-event-page"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        page_size = cast(int, request["pageSize"])
        cursor = cast(str | None, request["cursor"])
        from_sequence = cast(int | None, request["fromSequence"])
        request_scope_blob = canonical_bytes(
            {
                "contractVersion": CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
                "streamId": stream_id,
                "pageSize": page_size,
            }
        )

        def read_page(conn: sqlite3.Connection) -> JsonValue:
            committed = False
            try:
                conn.execute("BEGIN IMMEDIATE")
                now_ms = self._now_ms(conn, operation)
                self._cleanup_cursors(conn, now_ms)
                if cursor is None:
                    snapshot_tail = self._stream_tail(conn, tenant_id, stream_id, operation)
                    next_position = cast(int, from_sequence)
                else:
                    token_hash = canonical_sha256(cursor)
                    row = conn.execute(
                        """
                        SELECT kind, principal_hash, authorization_hash, stream_id,
                               checkpoint_scope, request_scope_blob, page_size,
                               next_position, snapshot_tail_sequence,
                               snapshot_tail_record_hash, descriptor_hash,
                               schema_identity_sha256, snapshot_blob, expires_at_ms,
                               consumed_at_ms
                        FROM ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ?
                        """,
                        (tenant_id, token_hash),
                    ).fetchone()
                    if (
                        row is None
                        or row[0] != "event"
                        or row[1] != context["principalHash"]
                        or row[2] != context["authorizationHash"]
                        or row[3] != stream_id
                        or row[4] is not None
                        or row[5] != request_scope_blob
                        or row[6] != page_size
                        or type(row[7]) is not int
                        or row[7] < 0
                        or row[7] > MAX_SAFE_INTEGER
                        or row[10] != self._descriptor["descriptorHash"]
                        or row[11] != self._assets.schema_identity_hash
                        or type(row[12]) is not bytes
                        or type(row[13]) is not int
                        or row[13] <= now_ms
                        or row[14] is not None
                    ):
                        _raise_provider(
                            "GE_CYCLE_STORE_INVALID_CURSOR",
                            operation,
                            "event cursor is invalid or expired",
                        )
                    if conn.execute(
                        """
                        DELETE FROM ge_cycle_cursors
                        WHERE tenant_id = ? AND token_hash = ? AND consumed_at_ms IS NULL
                        """,
                        (tenant_id, token_hash),
                    ).rowcount != 1:
                        _raise_provider(
                            "GE_CYCLE_STORE_INVALID_CURSOR",
                            operation,
                            "event cursor is invalid or expired",
                        )
                    try:
                        snapshot_tail = _tail_from_row((row[8], row[9]))
                    except ValueError:
                        _raise_provider(
                            "GE_CYCLE_STORE_CORRUPTION",
                            operation,
                            "event cursor tail is corrupt",
                        )
                    if row[12] != canonical_bytes(snapshot_tail):
                        _raise_provider(
                            "GE_CYCLE_STORE_CORRUPTION",
                            operation,
                            "event cursor snapshot drifted",
                        )
                    next_position = row[7]
                    snapshot_sequence = cast(int, snapshot_tail["sequence"])
                    if snapshot_tail["exists"] and next_position > snapshot_sequence:
                        _raise_provider(
                            "GE_CYCLE_STORE_CORRUPTION",
                            operation,
                            "event cursor position is corrupt",
                        )
                snapshot_last_sequence = (
                    cast(int, snapshot_tail["sequence"])
                    if snapshot_tail["exists"]
                    else -1
                )
                rows = conn.execute(
                    """
                    SELECT sequence, record_id, previous_record_hash, value_hash,
                           value_bytes, value_blob, record_hash, record_blob
                    FROM ge_cycle_records
                    WHERE tenant_id = ? AND stream_id = ?
                      AND sequence >= ? AND sequence <= ?
                    ORDER BY sequence ASC LIMIT ?
                    """,
                    (
                        tenant_id,
                        stream_id,
                        next_position,
                        snapshot_last_sequence,
                        page_size,
                    ),
                ).fetchall()
                expected_previous_hash: str | None = None
                if 0 < next_position <= snapshot_last_sequence:
                    predecessor = conn.execute(
                        """
                        SELECT record_hash FROM ge_cycle_records
                        WHERE tenant_id = ? AND stream_id = ? AND sequence = ?
                        """,
                        (tenant_id, stream_id, next_position - 1),
                    ).fetchone()
                    if (
                        predecessor is None
                        or type(predecessor[0]) is not str
                        or len(predecessor[0]) != 64
                    ):
                        _raise_provider(
                            "GE_CYCLE_STORE_CORRUPTION",
                            operation,
                            "event predecessor is corrupt",
                        )
                    expected_previous_hash = predecessor[0]
                records: list[CycleStoreRecord] = []
                expected_sequence = next_position
                for index, row in enumerate(rows):
                    record = self._record_from_row(row, operation)
                    if (
                        record["sequence"] != expected_sequence
                        or record["previousRecordHash"] != expected_previous_hash
                    ):
                        _raise_provider(
                            "GE_CYCLE_STORE_CORRUPTION",
                            operation,
                            "stored event page is not contiguous",
                        )
                    records.append(record)
                    expected_previous_hash = cast(str, record["recordHash"])
                    if index + 1 < len(rows):
                        if expected_sequence == MAX_SAFE_INTEGER:
                            _raise_provider(
                                "GE_CYCLE_STORE_CORRUPTION",
                                operation,
                                "stored event sequence overflowed",
                            )
                        expected_sequence += 1
                if not records and next_position <= snapshot_last_sequence:
                    _raise_provider(
                        "GE_CYCLE_STORE_CORRUPTION",
                        operation,
                        "stored event snapshot has a missing record",
                    )
                last_record = records[-1] if records else None
                if (
                    last_record is not None
                    and last_record["sequence"] == snapshot_last_sequence
                    and last_record["recordHash"] != snapshot_tail["recordHash"]
                ):
                    _raise_provider(
                        "GE_CYCLE_STORE_CORRUPTION",
                        operation,
                        "stored event snapshot tail drifted",
                    )
                has_remaining = (
                    last_record is not None
                    and cast(int, last_record["sequence"]) < snapshot_last_sequence
                )
                next_cursor: str | None = None
                if has_remaining and last_record is not None:
                    next_cursor = self._store_cursor(
                        conn,
                        context=context,
                        kind="event",
                        stream_id=stream_id,
                        checkpoint_scope=None,
                        request_scope_blob=request_scope_blob,
                        page_size=page_size,
                        next_position=cast(int, last_record["sequence"]) + 1,
                        snapshot_tail=snapshot_tail,
                        snapshot_blob=canonical_bytes(snapshot_tail),
                        now_ms=now_ms,
                        operation=operation,
                    )
                result = cast(
                    JsonObject,
                    {
                        "exists": snapshot_tail["exists"],
                        "snapshotTail": snapshot_tail,
                        "records": records,
                        "nextCursor": next_cursor,
                    },
                )
                conn.execute("COMMIT")
                committed = True
                return result
            finally:
                if not committed and conn.in_transaction:
                    conn.execute("ROLLBACK")

        return cast(JsonObject, await self._read(operation, context, read_page))

    @staticmethod
    def _checkpoint_summary(checkpoint: CycleStoreCheckpoint) -> CycleStoreCheckpointSummary:
        return cast(
            JsonObject,
            {key: value for key, value in checkpoint.items() if key != "value"},
        )

    def _checkpoint_from_row(
        self,
        row: tuple[object, ...],
        operation: CycleStoreProviderOperation,
    ) -> CycleStoreCheckpoint:
        try:
            (
                stream_id,
                bound_sequence,
                bound_hash,
                created_at,
                value_hash,
                value_bytes,
                value_blob,
                checkpoint_blob,
                summary_blob,
            ) = row
            if (
                type(value_blob) is not bytes
                or type(checkpoint_blob) is not bytes
                or type(summary_blob) is not bytes
            ):
                raise ValueError("checkpoint BLOB has invalid type")
            checkpoint = cycle_store_adapter_codec.parse_stored_checkpoint(
                checkpoint_blob,
                operation,
            )
            summary = cycle_store_adapter_codec.decode_ledger_result(
                "save-checkpoint",
                summary_blob,
            )
            if (
                checkpoint["streamId"] != stream_id
                or checkpoint["boundSequence"] != bound_sequence
                or checkpoint["boundRecordHash"] != bound_hash
                or checkpoint["createdAt"] != created_at
                or checkpoint["valueHash"] != value_hash
                or checkpoint["valueBytes"] != value_bytes
                or canonical_bytes(checkpoint["value"]) != value_blob
                or summary != self._checkpoint_summary(checkpoint)
            ):
                raise ValueError("checkpoint columns drifted")
            return checkpoint
        except CycleStoreProviderError:
            raise
        except Exception:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "checkpoint storage identity is corrupt",
            )

    async def save_checkpoint(self, request_value: object) -> CycleStoreCheckpointSummary:
        operation: CycleStoreProviderOperation = "save-checkpoint"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        checkpoint = cast(JsonObject, request["checkpoint"])
        binding = cast(CycleStoreLeaseBinding | None, request["lease"])
        stream_id = cast(str, checkpoint["streamId"])
        scope = cast(str, checkpoint["checkpointScope"])
        checkpoint_id = cast(str, checkpoint["checkpointId"])
        summary = self._checkpoint_summary(checkpoint)
        summary_blob = cycle_store_adapter_codec.encode_ledger_result(
            operation,
            summary,
        )

        def save(conn: sqlite3.Connection, now_ms: int) -> JsonValue:
            tail = self._stream_tail(conn, tenant_id, stream_id, operation)
            if (
                not tail["exists"]
                or tail["sequence"] != checkpoint["boundSequence"]
                or tail["recordHash"] != checkpoint["boundRecordHash"]
            ):
                _raise_provider(
                    "GE_CYCLE_STORE_CONFLICT",
                    operation,
                    "checkpoint is not bound to the current event tail",
                    cast(
                        JsonObject,
                        {
                            "actualSequence": tail["sequence"],
                            "expectedSequence": checkpoint["boundSequence"],
                        },
                    ),
                )
            self._assert_write_lease(
                conn,
                tenant_id,
                stream_id,
                binding,
                operation,
                now_ms,
            )
            existing_row = conn.execute(
                """
                SELECT stream_id, bound_sequence, bound_record_hash, created_at,
                       value_hash, value_bytes, value_blob, checkpoint_blob, summary_blob
                FROM ge_cycle_checkpoints
                WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
                """,
                (tenant_id, scope, checkpoint_id),
            ).fetchone()
            if existing_row is not None:
                existing = self._checkpoint_from_row(existing_row, operation)
                if existing != checkpoint:
                    _raise_provider(
                        "GE_CYCLE_STORE_CONFLICT",
                        operation,
                        "checkpointId is immutable until deleted",
                    )
                return self._checkpoint_summary(existing)
            revision_row = conn.execute(
                """
                SELECT COALESCE(MAX(revision), 0) FROM ge_cycle_checkpoint_revisions
                WHERE tenant_id = ? AND checkpoint_scope = ?
                """,
                (tenant_id, scope),
            ).fetchone()
            revision = cast(int, revision_row[0]) + 1
            if revision > MAX_SAFE_INTEGER:
                _raise_provider(
                    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                    operation,
                    "checkpoint revision exhausted",
                )
            conn.execute(
                """
                INSERT INTO ge_cycle_checkpoints (
                  tenant_id, checkpoint_scope, checkpoint_id, stream_id,
                  bound_sequence, bound_record_hash, created_at, value_hash,
                  value_bytes, value_blob, checkpoint_blob, summary_blob,
                  checkpoint_revision, committed_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tenant_id,
                    scope,
                    checkpoint_id,
                    stream_id,
                    checkpoint["boundSequence"],
                    checkpoint["boundRecordHash"],
                    checkpoint["createdAt"],
                    checkpoint["valueHash"],
                    checkpoint["valueBytes"],
                    canonical_bytes(checkpoint["value"]),
                    canonical_bytes(checkpoint),
                    summary_blob,
                    revision,
                    now_ms,
                ),
            )
            conn.execute(
                """
                INSERT INTO ge_cycle_checkpoint_revisions (
                  tenant_id, checkpoint_scope, revision, checkpoint_id, action,
                  summary_blob, bound_sequence, bound_record_hash,
                  checkpoint_created_at, value_hash, value_bytes, recorded_at_ms
                ) VALUES (?, ?, ?, ?, 'put', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tenant_id,
                    scope,
                    revision,
                    checkpoint_id,
                    summary_blob,
                    checkpoint["boundSequence"],
                    checkpoint["boundRecordHash"],
                    checkpoint["createdAt"],
                    checkpoint["valueHash"],
                    checkpoint["valueBytes"],
                    now_ms,
                ),
            )
            return summary

        return cast(JsonObject, await self._mutate(operation, context, request, save))

    async def load_checkpoint(self, request_value: object) -> CycleStoreCheckpoint | None:
        operation: CycleStoreProviderOperation = "load-checkpoint"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        scope = cast(str, request["checkpointScope"])
        checkpoint_id = cast(str, request["checkpointId"])

        def load(conn: sqlite3.Connection) -> JsonValue:
            row = conn.execute(
                """
                SELECT stream_id, bound_sequence, bound_record_hash, created_at,
                       value_hash, value_bytes, value_blob, checkpoint_blob, summary_blob
                FROM ge_cycle_checkpoints
                WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
                """,
                (tenant_id, scope, checkpoint_id),
            ).fetchone()
            return None if row is None else self._checkpoint_from_row(row, operation)

        return cast(CycleStoreCheckpoint | None, await self._read(operation, context, load))

    def _decode_checkpoint_snapshot(
        self,
        value: bytes,
        operation: CycleStoreProviderOperation,
    ) -> list[CycleStoreCheckpointSummary]:
        decoded = _decode_canonical_json_bytes(
            value,
            operation,
            "checkpoint cursor snapshot",
            16_777_216,
        )
        if type(decoded) is not list:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "checkpoint cursor snapshot is corrupt",
            )
        summaries: list[CycleStoreCheckpointSummary] = []
        for item in decoded:
            try:
                encoded = cycle_store_adapter_codec.encode_ledger_result(
                    "save-checkpoint",
                    item,
                )
                summary = cycle_store_adapter_codec.decode_ledger_result(
                    "save-checkpoint",
                    encoded,
                )
            except CycleStoreProviderError:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "checkpoint cursor snapshot is corrupt",
                )
            summaries.append(cast(JsonObject, summary))
        return summaries

    async def list_checkpoints(self, request_value: object) -> CycleStoreCheckpointPage:
        operation: CycleStoreProviderOperation = "list-checkpoints"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        scope = cast(str, request["checkpointScope"])
        page_size = cast(int, request["pageSize"])
        cursor = cast(str | None, request["cursor"])
        request_scope_blob = canonical_bytes(
            {
                "contractVersion": CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
                "checkpointScope": scope,
                "pageSize": page_size,
            }
        )

        def list_page(conn: sqlite3.Connection) -> JsonValue:
            committed = False
            try:
                conn.execute("BEGIN IMMEDIATE")
                now_ms = self._now_ms(conn, operation)
                self._cleanup_cursors(conn, now_ms)
                if cursor is None:
                    rows = conn.execute(
                        """
                        SELECT summary_blob FROM ge_cycle_checkpoints
                        WHERE tenant_id = ? AND checkpoint_scope = ?
                        ORDER BY bound_sequence DESC, created_at DESC, checkpoint_id ASC
                        """,
                        (tenant_id, scope),
                    ).fetchall()
                    snapshot: list[CycleStoreCheckpointSummary] = []
                    for row in rows:
                        if type(row[0]) is not bytes:
                            _raise_provider(
                                "GE_CYCLE_STORE_CORRUPTION",
                                operation,
                                "checkpoint summary storage is corrupt",
                            )
                        snapshot.append(
                            cast(
                                JsonObject,
                                cycle_store_adapter_codec.decode_ledger_result(
                                    "save-checkpoint",
                                    row[0],
                                ),
                            )
                        )
                    next_index = 0
                    snapshot_blob = canonical_bytes(snapshot)
                    if len(snapshot_blob) > 16_777_216:
                        _raise_provider(
                            "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                            operation,
                            "checkpoint snapshot exceeds provider limit",
                        )
                else:
                    token_hash = canonical_sha256(cursor)
                    row = conn.execute(
                        """
                        SELECT kind, principal_hash, authorization_hash, stream_id,
                               checkpoint_scope, request_scope_blob, page_size,
                               next_position, snapshot_tail_sequence,
                               snapshot_tail_record_hash, descriptor_hash,
                               schema_identity_sha256, snapshot_blob, expires_at_ms,
                               consumed_at_ms
                        FROM ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ?
                        """,
                        (tenant_id, token_hash),
                    ).fetchone()
                    if (
                        row is None
                        or row[0] != "checkpoint"
                        or row[1] != context["principalHash"]
                        or row[2] != context["authorizationHash"]
                        or row[3] is not None
                        or row[4] != scope
                        or row[5] != request_scope_blob
                        or row[6] != page_size
                        or type(row[7]) is not int
                        or row[7] < 0
                        or row[7] > MAX_SAFE_INTEGER
                        or row[8] is not None
                        or row[9] is not None
                        or row[10] != self._descriptor["descriptorHash"]
                        or row[11] != self._assets.schema_identity_hash
                        or type(row[12]) is not bytes
                        or type(row[13]) is not int
                        or row[13] <= now_ms
                        or row[14] is not None
                    ):
                        _raise_provider(
                            "GE_CYCLE_STORE_INVALID_CURSOR",
                            operation,
                            "checkpoint cursor is invalid or expired",
                        )
                    if conn.execute(
                        """
                        DELETE FROM ge_cycle_cursors
                        WHERE tenant_id = ? AND token_hash = ? AND consumed_at_ms IS NULL
                        """,
                        (tenant_id, token_hash),
                    ).rowcount != 1:
                        _raise_provider(
                            "GE_CYCLE_STORE_INVALID_CURSOR",
                            operation,
                            "checkpoint cursor is invalid or expired",
                        )
                    snapshot_blob = row[12]
                    snapshot = self._decode_checkpoint_snapshot(snapshot_blob, operation)
                    next_index = row[7]
                    if next_index > len(snapshot):
                        _raise_provider(
                            "GE_CYCLE_STORE_CORRUPTION",
                            operation,
                            "checkpoint cursor position is corrupt",
                        )
                end = min(next_index + page_size, len(snapshot))
                checkpoints = cast(
                    list[CycleStoreCheckpointSummary],
                    portable_json_snapshot(snapshot[next_index:end]),
                )
                next_cursor = (
                    self._store_cursor(
                        conn,
                        context=context,
                        kind="checkpoint",
                        stream_id=None,
                        checkpoint_scope=scope,
                        request_scope_blob=request_scope_blob,
                        page_size=page_size,
                        next_position=end,
                        snapshot_tail=None,
                        snapshot_blob=snapshot_blob,
                        now_ms=now_ms,
                        operation=operation,
                    )
                    if end < len(snapshot)
                    else None
                )
                result = cast(
                    JsonObject,
                    {"checkpoints": checkpoints, "nextCursor": next_cursor},
                )
                conn.execute("COMMIT")
                committed = True
                return result
            finally:
                if not committed and conn.in_transaction:
                    conn.execute("ROLLBACK")

        return cast(JsonObject, await self._read(operation, context, list_page))

    async def delete_checkpoint(self, request_value: object) -> JsonObject:
        operation: CycleStoreProviderOperation = "delete-checkpoint"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        scope = cast(str, request["checkpointScope"])
        checkpoint_id = cast(str, request["checkpointId"])
        expected_hash = cast(str | None, request["expectedValueHash"])

        def delete(conn: sqlite3.Connection, now_ms: int) -> JsonValue:
            row = conn.execute(
                """
                SELECT stream_id, value_hash FROM ge_cycle_checkpoints
                WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
                """,
                (tenant_id, scope, checkpoint_id),
            ).fetchone()
            if row is None:
                return cast(JsonObject, {"deleted": False})
            if type(row[0]) is not str or type(row[1]) is not str:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "checkpoint deletion binding is corrupt",
                )
            stream_id = row[0]
            if expected_hash is None or row[1] != expected_hash:
                _raise_provider(
                    "GE_CYCLE_STORE_CONFLICT",
                    operation,
                    "checkpoint content hash differs from expected value",
                )
            hold_row = conn.execute(
                """
                SELECT COUNT(*) FROM ge_cycle_legal_holds
                WHERE tenant_id = ? AND stream_id = ?
                """,
                (tenant_id, stream_id),
            ).fetchone()
            if hold_row is None or type(hold_row[0]) is not int or hold_row[0] < 0:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "legal hold inventory is corrupt",
                )
            if hold_row[0] > 0:
                _raise_provider(
                    "GE_CYCLE_STORE_LEGAL_HOLD",
                    operation,
                    "checkpoint deletion is blocked by legal hold",
                )
            revision_row = conn.execute(
                """
                SELECT COALESCE(MAX(revision), 0) FROM ge_cycle_checkpoint_revisions
                WHERE tenant_id = ? AND checkpoint_scope = ?
                """,
                (tenant_id, scope),
            ).fetchone()
            revision = cast(int, revision_row[0]) + 1
            if revision > MAX_SAFE_INTEGER:
                _raise_provider(
                    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                    operation,
                    "checkpoint revision exhausted",
                )
            deleted = conn.execute(
                """
                DELETE FROM ge_cycle_checkpoints
                WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
                """,
                (tenant_id, scope, checkpoint_id),
            ).rowcount
            if deleted != 1:
                _raise_provider(
                    "GE_CYCLE_STORE_CONFLICT",
                    operation,
                    "checkpoint deletion lost CAS",
                )
            conn.execute(
                """
                INSERT INTO ge_cycle_checkpoint_revisions (
                  tenant_id, checkpoint_scope, revision, checkpoint_id, action,
                  summary_blob, bound_sequence, bound_record_hash,
                  checkpoint_created_at, value_hash, value_bytes, recorded_at_ms
                ) VALUES (?, ?, ?, ?, 'delete', NULL, NULL, NULL, NULL, NULL, NULL, ?)
                """,
                (tenant_id, scope, revision, checkpoint_id, now_ms),
            )
            return cast(JsonObject, {"deleted": True})

        return cast(JsonObject, await self._mutate(operation, context, request, delete))

    def _lease_inspection_from_row(
        self,
        row: tuple[object, ...] | None,
        operation: CycleStoreProviderOperation,
        now_ms: int,
    ) -> CycleStoreLeaseInspection:
        if row is None:
            return cast(
                JsonObject,
                {
                    "status": "none",
                    "lease": None,
                    "lastLeaseEpoch": 0,
                    "lastFencingToken": 0,
                },
            )
        if type(row[6]) is not int or type(row[7]) is not int:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "lease counters are corrupt",
            )
        lease = self._lease_from_row(row, operation)
        if lease is None:
            status = "none" if row[7] == 0 else "released"
        else:
            status = (
                "expired"
                if _parse_timestamp(cast(str, lease["expiresAt"])) <= now_ms
                else "active"
            )
        return cast(
            JsonObject,
            {
                "status": status,
                "lease": lease,
                "lastLeaseEpoch": row[6],
                "lastFencingToken": row[7],
            },
        )

    async def acquire_lease(self, request_value: object) -> CycleStoreLease:
        operation: CycleStoreProviderOperation = "acquire-lease"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        lease_id = cast(str, request["leaseId"])
        holder_id = cast(str, request["holderId"])
        ttl_ms = cast(int, request["ttlMs"])
        mode = cast(Literal["acquire", "takeover"], request["mode"])
        expected_fence = cast(int, request["expectedFencingToken"])

        def acquire(conn: sqlite3.Connection, now_ms: int) -> JsonValue:
            stream = conn.execute(
                """
                SELECT tail_sequence FROM ge_cycle_streams
                WHERE tenant_id = ? AND stream_id = ?
                """,
                (tenant_id, stream_id),
            ).fetchone()
            if stream is None or cast(int, stream[0]) < 0:
                _raise_provider(
                    "GE_CYCLE_STORE_NOT_FOUND",
                    operation,
                    "lease stream does not exist",
                )
            row = self._lease_row(conn, tenant_id, stream_id)
            last_epoch = 0 if row is None else row[6]
            last_fence = 0 if row is None else row[7]
            if type(last_epoch) is not int or type(last_fence) is not int:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "lease counters are corrupt",
                )
            if expected_fence != last_fence:
                _raise_provider(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "expected lease fence is stale",
                    cast(JsonObject, {"lastFencingToken": last_fence}),
                )
            active = None if row is None else self._lease_from_row(row, operation)
            active_expired = active is not None and _parse_timestamp(
                cast(str, active["expiresAt"])
            ) <= now_ms
            if mode == "takeover":
                if active is None or not active_expired:
                    _raise_provider(
                        "GE_CYCLE_STORE_LEASE_CONFLICT",
                        operation,
                        "lease takeover requires an expired active lease",
                    )
            elif active is not None:
                _raise_provider(
                    "GE_CYCLE_STORE_LEASE_CONFLICT",
                    operation,
                    (
                        "expired lease requires takeover mode"
                        if active_expired
                        else "stream already has an active lease"
                    ),
                )
            if conn.execute(
                """
                SELECT 1 FROM ge_cycle_used_lease_ids
                WHERE tenant_id = ? AND stream_id = ? AND lease_id = ?
                """,
                (tenant_id, stream_id, lease_id),
            ).fetchone() is not None:
                _raise_provider(
                    "GE_CYCLE_STORE_LEASE_CONFLICT",
                    operation,
                    "leaseId cannot be reused",
                )
            if last_epoch == MAX_SAFE_INTEGER or last_fence == MAX_SAFE_INTEGER:
                _raise_provider(
                    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                    operation,
                    "lease fence exhausted",
                )
            next_epoch = last_epoch + 1
            next_fence = last_fence + 1
            expires_ms = _add_duration(now_ms, ttl_ms, operation)
            conn.execute(
                """
                INSERT INTO ge_cycle_leases (
                  tenant_id, stream_id, active_lease_id, active_holder_id,
                  active_lease_epoch, active_fencing_token, active_acquired_at_ms,
                  active_expires_at_ms, last_lease_epoch, last_fencing_token,
                  updated_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (tenant_id, stream_id) DO UPDATE SET
                  active_lease_id = excluded.active_lease_id,
                  active_holder_id = excluded.active_holder_id,
                  active_lease_epoch = excluded.active_lease_epoch,
                  active_fencing_token = excluded.active_fencing_token,
                  active_acquired_at_ms = excluded.active_acquired_at_ms,
                  active_expires_at_ms = excluded.active_expires_at_ms,
                  last_lease_epoch = excluded.last_lease_epoch,
                  last_fencing_token = excluded.last_fencing_token,
                  updated_at_ms = excluded.updated_at_ms
                """,
                (
                    tenant_id,
                    stream_id,
                    lease_id,
                    holder_id,
                    next_epoch,
                    next_fence,
                    now_ms,
                    expires_ms,
                    next_epoch,
                    next_fence,
                    now_ms,
                ),
            )
            conn.execute(
                """
                INSERT INTO ge_cycle_used_lease_ids (
                  tenant_id, stream_id, lease_id, lease_epoch,
                  fencing_token, first_used_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (tenant_id, stream_id, lease_id, next_epoch, next_fence, now_ms),
            )
            return cast(
                JsonObject,
                {
                    "leaseId": lease_id,
                    "holderId": holder_id,
                    "leaseEpoch": next_epoch,
                    "fencingToken": next_fence,
                    "acquiredAt": _iso_time(now_ms),
                    "expiresAt": _iso_time(expires_ms),
                },
            )

        return cast(JsonObject, await self._mutate(operation, context, request, acquire))

    async def renew_lease(self, request_value: object) -> CycleStoreLease:
        operation: CycleStoreProviderOperation = "renew-lease"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        binding = cast(JsonObject, request["lease"])
        ttl_ms = cast(int, request["ttlMs"])

        def renew(conn: sqlite3.Connection, now_ms: int) -> JsonValue:
            row = self._lease_row(conn, tenant_id, stream_id)
            active = None if row is None else self._lease_from_row(row, operation)
            last_fence = 0 if row is None else row[7]
            if (
                active is None
                or _parse_timestamp(cast(str, active["expiresAt"])) <= now_ms
                or active["leaseId"] != binding["leaseId"]
                or active["holderId"] != binding["holderId"]
                or active["fencingToken"] != binding["fencingToken"]
            ):
                _raise_provider(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "lease renewal identity is stale",
                    cast(JsonObject, {"lastFencingToken": last_fence}),
                )
            new_expiry = _add_duration(now_ms, ttl_ms, operation)
            if new_expiry <= _parse_timestamp(cast(str, active["expiresAt"])):
                _raise_provider(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "lease renewal must strictly extend expiry",
                )
            if conn.execute(
                """
                UPDATE ge_cycle_leases SET active_expires_at_ms = ?, updated_at_ms = ?
                WHERE tenant_id = ? AND stream_id = ? AND active_lease_id = ?
                  AND active_holder_id = ? AND active_fencing_token = ?
                """,
                (
                    new_expiry,
                    now_ms,
                    tenant_id,
                    stream_id,
                    binding["leaseId"],
                    binding["holderId"],
                    binding["fencingToken"],
                ),
            ).rowcount != 1:
                _raise_provider(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "lease renewal identity is stale",
                )
            return cast(JsonObject, {**active, "expiresAt": _iso_time(new_expiry)})

        return cast(JsonObject, await self._mutate(operation, context, request, renew))

    async def release_lease(self, request_value: object) -> CycleStoreLeaseInspection:
        operation: CycleStoreProviderOperation = "release-lease"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        binding = cast(JsonObject, request["lease"])

        def release(conn: sqlite3.Connection, now_ms: int) -> JsonValue:
            row = self._lease_row(conn, tenant_id, stream_id)
            active = None if row is None else self._lease_from_row(row, operation)
            last_epoch = 0 if row is None else row[6]
            last_fence = 0 if row is None else row[7]
            if (
                active is None
                or _parse_timestamp(cast(str, active["expiresAt"])) <= now_ms
                or active["leaseId"] != binding["leaseId"]
                or active["holderId"] != binding["holderId"]
                or active["fencingToken"] != binding["fencingToken"]
            ):
                _raise_provider(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "lease release identity is stale",
                    cast(JsonObject, {"lastFencingToken": last_fence}),
                )
            conn.execute(
                """
                UPDATE ge_cycle_leases SET
                  active_lease_id = NULL, active_holder_id = NULL,
                  active_lease_epoch = NULL, active_fencing_token = NULL,
                  active_acquired_at_ms = NULL, active_expires_at_ms = NULL,
                  updated_at_ms = ?
                WHERE tenant_id = ? AND stream_id = ?
                """,
                (now_ms, tenant_id, stream_id),
            )
            return cast(
                JsonObject,
                {
                    "status": "released",
                    "lease": None,
                    "lastLeaseEpoch": last_epoch,
                    "lastFencingToken": last_fence,
                },
            )

        return cast(JsonObject, await self._mutate(operation, context, request, release))

    async def inspect_lease(self, request_value: object) -> CycleStoreLeaseInspection:
        operation: CycleStoreProviderOperation = "inspect-lease"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])

        def inspect_lease(conn: sqlite3.Connection) -> JsonValue:
            committed = False
            try:
                conn.execute("BEGIN IMMEDIATE")
                now_ms = self._now_ms(conn, operation)
                inspection = self._lease_inspection_from_row(
                    self._lease_row(conn, tenant_id, stream_id),
                    operation,
                    now_ms,
                )
                conn.execute("COMMIT")
                committed = True
                return inspection
            finally:
                if not committed and conn.in_transaction:
                    conn.execute("ROLLBACK")

        return cast(JsonObject, await self._read(operation, context, inspect_lease))

    def _governance_inspection(
        self,
        conn: sqlite3.Connection,
        tenant_id: str,
        stream_id: str,
    ) -> CycleStoreGovernanceInspection:
        holds = [
            cast(str, row[0])
            for row in conn.execute(
                """
                SELECT hold_id FROM ge_cycle_legal_holds
                WHERE tenant_id = ? AND stream_id = ? ORDER BY hold_id ASC
                """,
                (tenant_id, stream_id),
            ).fetchall()
        ]
        return cast(
            JsonObject,
            {
                "legalHoldIds": holds,
                "retentionMode": "retain-authoritative-history",
                "archiveMode": "lossless-before-delete",
                "compactionMode": "logical-history-preserving",
            },
        )

    async def set_legal_hold(self, request_value: object) -> CycleStoreGovernanceInspection:
        operation: CycleStoreProviderOperation = "set-legal-hold"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])
        hold_id = cast(str, request["holdId"])
        action_name = cast(Literal["place", "release"], request["action"])

        def set_hold(conn: sqlite3.Connection, now_ms: int) -> JsonValue:
            if conn.execute(
                """
                SELECT 1 FROM ge_cycle_streams WHERE tenant_id = ? AND stream_id = ?
                """,
                (tenant_id, stream_id),
            ).fetchone() is None:
                _raise_provider(
                    "GE_CYCLE_STORE_NOT_FOUND",
                    operation,
                    "legal hold stream does not exist",
                )
            if action_name == "place":
                conn.execute(
                    """
                    INSERT OR IGNORE INTO ge_cycle_legal_holds (
                      tenant_id, stream_id, hold_id, placed_at_ms
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (tenant_id, stream_id, hold_id, now_ms),
                )
            else:
                conn.execute(
                    """
                    DELETE FROM ge_cycle_legal_holds
                    WHERE tenant_id = ? AND stream_id = ? AND hold_id = ?
                    """,
                    (tenant_id, stream_id, hold_id),
                )
            return self._governance_inspection(conn, tenant_id, stream_id)

        return cast(JsonObject, await self._mutate(operation, context, request, set_hold))

    async def inspect_governance(
        self,
        request_value: object,
    ) -> CycleStoreGovernanceInspection:
        operation: CycleStoreProviderOperation = "inspect-governance"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        tenant_id = cast(str, context["tenantId"])
        stream_id = cast(str, request["streamId"])

        def inspect_governance(conn: sqlite3.Connection) -> JsonValue:
            if conn.execute(
                """
                SELECT 1 FROM ge_cycle_streams WHERE tenant_id = ? AND stream_id = ?
                """,
                (tenant_id, stream_id),
            ).fetchone() is None:
                _raise_provider(
                    "GE_CYCLE_STORE_NOT_FOUND",
                    operation,
                    "governance stream does not exist",
                )
            return self._governance_inspection(conn, tenant_id, stream_id)

        return cast(JsonObject, await self._read(operation, context, inspect_governance))

    def _migration_lock_row(self, conn: sqlite3.Connection) -> tuple[object, ...] | None:
        row = conn.execute(
            """
            SELECT active_lock_id, active_owner_id, active_source_version,
                   active_target_version, active_lock_epoch, active_fencing_token,
                   active_acquired_at_ms, active_expires_at_ms,
                   last_lock_epoch, last_fencing_token
            FROM ge_cycle_migration_lock WHERE singleton = 1
            """
        ).fetchone()
        return None if row is None else tuple(row)

    async def acquire_migration_lock(self, request_value: object) -> CycleStoreMigrationLock:
        operation: CycleStoreProviderOperation = "acquire-migration-lock"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        lock_id = cast(str, request["lockId"])
        owner_id = cast(str, request["ownerId"])
        source_version = cast(int, request["sourceSchemaVersion"])
        target_version = cast(int, request["targetSchemaVersion"])
        ttl_ms = cast(int, request["ttlMs"])
        mode = cast(Literal["acquire", "takeover"], request["mode"])
        expected_fence = cast(int, request["expectedFencingToken"])

        def acquire(conn: sqlite3.Connection, now_ms: int) -> JsonValue:
            row = self._migration_lock_row(conn)
            if row is None or type(row[8]) is not int or type(row[9]) is not int:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "migration lock counters are corrupt",
                )
            last_epoch = row[8]
            last_fence = row[9]
            if expected_fence != last_fence:
                _raise_provider(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "migration fence is stale",
                    cast(JsonObject, {"lastFencingToken": last_fence}),
                )
            active = self._migration_lock(row[:8])
            active_expired = active is not None and _parse_timestamp(
                cast(str, active["expiresAt"])
            ) <= now_ms
            if mode == "takeover":
                if active is None or not active_expired:
                    _raise_provider(
                        "GE_CYCLE_STORE_MIGRATION_LOCKED",
                        operation,
                        "migration takeover requires an expired lock",
                    )
            elif active is not None:
                _raise_provider(
                    "GE_CYCLE_STORE_MIGRATION_LOCKED",
                    operation,
                    (
                        "expired migration lock requires takeover"
                        if active_expired
                        else "migration lock is active"
                    ),
                )
            if conn.execute(
                "SELECT 1 FROM ge_cycle_used_migration_lock_ids WHERE lock_id = ?",
                (lock_id,),
            ).fetchone() is not None:
                _raise_provider(
                    "GE_CYCLE_STORE_MIGRATION_LOCKED",
                    operation,
                    "migration lockId cannot be reused",
                )
            if last_epoch == MAX_SAFE_INTEGER or last_fence == MAX_SAFE_INTEGER:
                _raise_provider(
                    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                    operation,
                    "migration fence exhausted",
                )
            next_epoch = last_epoch + 1
            next_fence = last_fence + 1
            expires_ms = _add_duration(now_ms, ttl_ms, operation)
            conn.execute(
                """
                UPDATE ge_cycle_migration_lock SET
                  active_lock_id = ?, active_owner_id = ?, active_source_version = ?,
                  active_target_version = ?, active_lock_epoch = ?,
                  active_fencing_token = ?, active_acquired_at_ms = ?,
                  active_expires_at_ms = ?, last_lock_epoch = ?,
                  last_fencing_token = ?, updated_at_ms = ?
                WHERE singleton = 1
                """,
                (
                    lock_id,
                    owner_id,
                    source_version,
                    target_version,
                    next_epoch,
                    next_fence,
                    now_ms,
                    expires_ms,
                    next_epoch,
                    next_fence,
                    now_ms,
                ),
            )
            conn.execute(
                """
                INSERT INTO ge_cycle_used_migration_lock_ids (
                  lock_id, lock_epoch, fencing_token, first_used_at_ms
                ) VALUES (?, ?, ?, ?)
                """,
                (lock_id, next_epoch, next_fence, now_ms),
            )
            return cast(
                JsonObject,
                {
                    "lockId": lock_id,
                    "ownerId": owner_id,
                    "sourceSchemaVersion": source_version,
                    "targetSchemaVersion": target_version,
                    "lockEpoch": next_epoch,
                    "fencingToken": next_fence,
                    "acquiredAt": _iso_time(now_ms),
                    "expiresAt": _iso_time(expires_ms),
                },
            )

        return cast(JsonObject, await self._mutate(operation, context, request, acquire))

    async def inspect_migration_lock(self, context_value: object) -> CycleStoreMigrationLock | None:
        operation: CycleStoreProviderOperation = "inspect-migration-lock"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            context_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])

        def inspect_lock(conn: sqlite3.Connection) -> JsonValue:
            row = self._migration_lock_row(conn)
            if row is None:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "migration lock singleton is corrupt",
                )
            return self._migration_lock(row[:8])

        return cast(
            CycleStoreMigrationLock | None,
            await self._read(operation, context, inspect_lock),
        )

    async def release_migration_lock(
        self,
        request_value: object,
    ) -> None:
        operation: CycleStoreProviderOperation = "release-migration-lock"
        request = cycle_store_adapter_codec.capture_request(
            operation,
            request_value,
            self._descriptor,
        )
        context = cast(JsonObject, request["context"])
        lock_id = cast(str, request["lockId"])
        owner_id = cast(str, request["ownerId"])
        fencing_token = cast(int, request["fencingToken"])

        def release(conn: sqlite3.Connection, now_ms: int) -> JsonValue:
            row = self._migration_lock_row(conn)
            active = None if row is None else self._migration_lock(row[:8])
            last_fence = 0 if row is None else row[9]
            if (
                active is None
                or active["lockId"] != lock_id
                or active["ownerId"] != owner_id
                or active["fencingToken"] != fencing_token
            ):
                _raise_provider(
                    "GE_CYCLE_STORE_STALE_FENCE",
                    operation,
                    "migration release identity is stale",
                    cast(JsonObject, {"lastFencingToken": last_fence}),
                )
            conn.execute(
                """
                UPDATE ge_cycle_migration_lock SET
                  active_lock_id = NULL, active_owner_id = NULL,
                  active_source_version = NULL, active_target_version = NULL,
                  active_lock_epoch = NULL, active_fencing_token = NULL,
                  active_acquired_at_ms = NULL, active_expires_at_ms = NULL,
                  updated_at_ms = ? WHERE singleton = 1
                """,
                (now_ms,),
            )
            return None

        result = await self._mutate(operation, context, request, release)
        if result is not None:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "migration release ledger result is corrupt",
            )

    def _semantic_audit(
        self,
        conn: sqlite3.Connection,
        operation: CycleStoreProviderOperation,
    ) -> JsonObject:
        self._validate_schema(conn, operation, full_integrity=True)
        digest = hashlib.sha256(_SEMANTIC_AUDIT_DOMAIN.encode("utf-8"))

        def fail(label: str) -> Never:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite CycleStore integrity audit failed",
                cast(JsonObject, {"check": label}),
            )

        def integer(value: object, minimum: int, maximum: int, label: str) -> int:
            if type(value) is not int or value < minimum or value > maximum:
                fail(label)
            return value

        def text_value(value: object, label: str) -> str:
            if type(value) is not str:
                fail(label)
            return value

        def nullable_text(value: object, label: str) -> str | None:
            if value is not None and type(value) is not str:
                fail(label)
            return value

        def blob(value: object, label: str) -> bytes:
            if type(value) is not bytes:
                fail(label)
            return value

        def hash_value(value: object, label: str) -> str:
            captured = text_value(value, label)
            if len(captured) != 64 or any(
                character not in "0123456789abcdef" for character in captured
            ):
                fail(label)
            return captured

        def update(label: str, value: JsonValue) -> None:
            digest.update(label.encode("utf-8"))
            digest.update(b"\0")
            digest.update(canonical_bytes(value))
            digest.update(b"\0")

        def count(table: str) -> int:
            row = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()
            if row is None or len(row) != 1:
                fail(f"{table} count")
            return integer(row[0], 0, MAX_SAFE_INTEGER, f"{table} count")

        migration_row = conn.execute(
            """
            SELECT migration_id, sql_sha256 FROM ge_cycle_migrations WHERE version = 1
            """
        ).fetchone()
        if migration_row is None or len(migration_row) != 2:
            fail("migration lineage")
        lineage_id = text_value(migration_row[0], "migration id")
        lineage_hash = hash_value(migration_row[1], "migration hash")
        if lineage_id not in ("fresh-v1-baseline", "alpha-v0-to-v1"):
            fail("migration id")
        update(
            "schema",
            cast(
                JsonObject,
                {
                    "applicationId": SQLITE_CYCLE_STORE_APPLICATION_ID,
                    "schemaVersion": SQLITE_CYCLE_STORE_SCHEMA_VERSION,
                    "schemaIdentitySha256": self._assets.schema_identity_hash,
                    "descriptorHash": self._descriptor["descriptorHash"],
                    "catalogSha256": SQLITE_CYCLE_STORE_CATALOG_SHA256,
                    "lineageId": lineage_id,
                    "lineageSha256": lineage_hash,
                },
            ),
        )

        heads: dict[tuple[str, str], tuple[int, str, int]] = {}
        record_rows = conn.execute(
            """
            SELECT tenant_id, stream_id, sequence, record_id, previous_record_hash,
                   value_hash, value_bytes, value_blob, record_hash, record_blob
            FROM ge_cycle_records ORDER BY tenant_id, stream_id, sequence
            """
        ).fetchall()
        for row in record_rows:
            if len(row) != 10:
                fail("record row")
            tenant_id = text_value(row[0], "record tenant")
            stream_id = text_value(row[1], "record stream")
            sequence = integer(row[2], 0, MAX_SAFE_INTEGER, "record sequence")
            record = self._record_from_row(tuple(row[2:]), operation)
            key = (tenant_id, stream_id)
            previous = heads.get(key)
            if previous is None:
                expected_sequence = 0
                expected_hash = None
                previous_count = 0
            else:
                if previous[0] == MAX_SAFE_INTEGER:
                    fail("record sequence overflow")
                expected_sequence = previous[0] + 1
                expected_hash = previous[1]
                previous_count = previous[2]
            if (
                sequence != expected_sequence
                or record["sequence"] != sequence
                or record["previousRecordHash"] != expected_hash
            ):
                fail("record canonical chain")
            record_hash = hash_value(record["recordHash"], "record hash")
            heads[key] = (sequence, record_hash, previous_count + 1)
            update(
                "record",
                cast(
                    JsonObject,
                    {"tenantId": tenant_id, "streamId": stream_id, "record": record},
                ),
            )

        stream_rows = conn.execute(
            """
            SELECT tenant_id, stream_id, tail_sequence, tail_record_hash
            FROM ge_cycle_streams ORDER BY tenant_id, stream_id
            """
        ).fetchall()
        for row in stream_rows:
            if len(row) != 4:
                fail("stream row")
            tenant_id = text_value(row[0], "stream tenant")
            stream_id = text_value(row[1], "stream id")
            sequence = integer(row[2], -1, MAX_SAFE_INTEGER, "stream tail sequence")
            stream_record_hash = nullable_text(row[3], "stream tail hash")
            head = heads.get((tenant_id, stream_id))
            if head is None:
                if sequence != -1 or stream_record_hash is not None:
                    fail("stream head binding")
            elif sequence != head[0] or stream_record_hash != head[1]:
                fail("stream head binding")
            update(
                "stream",
                cast(
                    JsonObject,
                    {
                        "tenantId": tenant_id,
                        "streamId": stream_id,
                        "sequence": sequence,
                        "recordHash": stream_record_hash,
                    },
                ),
            )
        if len(stream_rows) != len(heads):
            fail("stream record cardinality")

        mutation_operations = {
            "append",
            "save-checkpoint",
            "delete-checkpoint",
            "acquire-lease",
            "renew-lease",
            "release-lease",
            "set-legal-hold",
            "acquire-migration-lock",
            "release-migration-lock",
        }
        operation_rows = conn.execute(
            """
            SELECT tenant_id, operation_id, operation_name, request_hash,
                   result_blob, result_hash
            FROM ge_cycle_operations ORDER BY tenant_id, operation_id
            """
        ).fetchall()
        for row in operation_rows:
            if len(row) != 6:
                fail("operation row")
            tenant_id = text_value(row[0], "operation tenant")
            operation_id = text_value(row[1], "operation id")
            operation_name = text_value(row[2], "operation name")
            if operation_name not in mutation_operations:
                fail("ledger operation")
            request_hash = hash_value(row[3], "operation request hash")
            result_blob = blob(row[4], "operation result blob")
            result_hash = hash_value(row[5], "operation result hash")
            try:
                result = cycle_store_adapter_codec.decode_ledger_result(
                    cast(CycleStoreProviderOperation, operation_name),
                    result_blob,
                )
                encoded = cycle_store_adapter_codec.encode_ledger_result(
                    cast(CycleStoreProviderOperation, operation_name),
                    result,
                )
            except Exception:
                fail("operation ledger result")
            if encoded != result_blob or canonical_sha256(result) != result_hash:
                fail("operation ledger result")
            result_object = cast(JsonObject, result)
            if operation_name == "append":
                tail = cast(JsonObject, result_object["tail"])
                appended_records = cast(int, result_object["appendedRecords"])
                append_tail_sequence = cast(int, tail["sequence"])
                append_tail_hash = cast(str | None, tail["recordHash"])
                if (
                    tail.get("exists") is not True
                    or append_tail_hash is None
                    or appended_records < 1
                    or appended_records > append_tail_sequence + 1
                ):
                    fail("append ledger result binding")
                located = conn.execute(
                    """
                    SELECT stream_id FROM ge_cycle_records
                    WHERE tenant_id = ? AND sequence = ? AND record_hash = ?
                    """,
                    (tenant_id, append_tail_sequence, append_tail_hash),
                ).fetchone()
                if located is None or len(located) != 1:
                    fail("append ledger tail binding")
                located_stream = text_value(located[0], "append ledger stream")
                first_sequence = append_tail_sequence - appended_records + 1
                retained_count = conn.execute(
                    """
                    SELECT count(*) FROM ge_cycle_records
                    WHERE tenant_id = ? AND stream_id = ?
                      AND sequence BETWEEN ? AND ?
                    """,
                    (
                        tenant_id,
                        located_stream,
                        first_sequence,
                        append_tail_sequence,
                    ),
                ).fetchone()
                if (
                    retained_count is None
                    or integer(
                        retained_count[0],
                        0,
                        MAX_SAFE_INTEGER,
                        "append ledger retained record count",
                    )
                    != appended_records
                ):
                    fail("append ledger record binding")
            elif operation_name == "save-checkpoint":
                retained_revision = conn.execute(
                    """
                    SELECT 1 FROM ge_cycle_checkpoint_revisions
                    WHERE tenant_id = ? AND checkpoint_scope = ?
                      AND checkpoint_id = ? AND action = 'put'
                      AND summary_blob = ? LIMIT 1
                    """,
                    (
                        tenant_id,
                        result_object["checkpointScope"],
                        result_object["checkpointId"],
                        result_blob,
                    ),
                ).fetchone()
                if retained_revision is None:
                    fail("checkpoint ledger revision binding")
            elif operation_name in ("acquire-lease", "renew-lease"):
                try:
                    acquired_at_ms = _parse_timestamp(
                        cast(str, result_object["acquiredAt"])
                    )
                except Exception:
                    fail("lease ledger time binding")
                if acquired_at_ms < 0 or acquired_at_ms > MAX_SAFE_INTEGER:
                    fail("lease ledger time binding")
                retained_identity = conn.execute(
                    """
                    SELECT 1 FROM ge_cycle_used_lease_ids
                    WHERE tenant_id = ? AND lease_id = ? AND lease_epoch = ?
                      AND fencing_token = ? AND first_used_at_ms = ? LIMIT 1
                    """,
                    (
                        tenant_id,
                        result_object["leaseId"],
                        result_object["leaseEpoch"],
                        result_object["fencingToken"],
                        acquired_at_ms,
                    ),
                ).fetchone()
                if retained_identity is None:
                    fail("lease ledger identity binding")
            elif operation_name == "acquire-migration-lock":
                try:
                    acquired_at_ms = _parse_timestamp(
                        cast(str, result_object["acquiredAt"])
                    )
                except Exception:
                    fail("migration ledger time binding")
                if acquired_at_ms < 0 or acquired_at_ms > MAX_SAFE_INTEGER:
                    fail("migration ledger time binding")
                retained_identity = conn.execute(
                    """
                    SELECT 1 FROM ge_cycle_used_migration_lock_ids
                    WHERE lock_id = ? AND lock_epoch = ? AND fencing_token = ?
                      AND first_used_at_ms = ?
                    """,
                    (
                        result_object["lockId"],
                        result_object["lockEpoch"],
                        result_object["fencingToken"],
                        acquired_at_ms,
                    ),
                ).fetchone()
                if retained_identity is None:
                    fail("migration ledger identity binding")
            update(
                "operation",
                cast(
                    JsonObject,
                    {
                        "tenantId": tenant_id,
                        "operationId": operation_id,
                        "operation": operation_name,
                        "requestHash": request_hash,
                        "resultHash": result_hash,
                    },
                ),
            )

        checkpoint_rows = conn.execute(
            """
            SELECT tenant_id, checkpoint_scope, checkpoint_id, stream_id,
                   bound_sequence, bound_record_hash, created_at, value_hash,
                   value_bytes, value_blob, checkpoint_blob, summary_blob,
                   checkpoint_revision, committed_at_ms
            FROM ge_cycle_checkpoints
            ORDER BY tenant_id, checkpoint_scope, checkpoint_id
            """
        ).fetchall()
        for row in checkpoint_rows:
            if len(row) != 14:
                fail("checkpoint row")
            tenant_id = text_value(row[0], "checkpoint tenant")
            scope = text_value(row[1], "checkpoint scope")
            checkpoint_id = text_value(row[2], "checkpoint id")
            checkpoint = self._checkpoint_from_row(tuple(row[3:12]), operation)
            if (
                checkpoint["checkpointScope"] != scope
                or checkpoint["checkpointId"] != checkpoint_id
            ):
                fail("checkpoint canonical binding")
            checkpoint_revision = integer(
                row[12],
                1,
                MAX_SAFE_INTEGER,
                "checkpoint current revision",
            )
            committed_at_ms = integer(
                row[13],
                0,
                MAX_SAFE_INTEGER,
                "checkpoint commit time",
            )
            retained_revision = conn.execute(
                """
                SELECT revision, action, summary_blob, bound_sequence,
                       bound_record_hash, checkpoint_created_at, value_hash,
                       value_bytes, recorded_at_ms
                FROM ge_cycle_checkpoint_revisions
                WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
                ORDER BY revision DESC LIMIT 1
                """,
                (tenant_id, scope, checkpoint_id),
            ).fetchone()
            if (
                retained_revision is None
                or len(retained_revision) != 9
                or retained_revision
                != (
                    checkpoint_revision,
                    "put",
                    row[11],
                    row[4],
                    row[5],
                    row[6],
                    row[7],
                    row[8],
                    committed_at_ms,
                )
            ):
                fail("checkpoint current revision binding")
            update(
                "checkpoint",
                cast(
                    JsonObject,
                    {
                        "tenantId": tenant_id,
                        "checkpoint": checkpoint,
                        "checkpointRevision": checkpoint_revision,
                        "committedAtMs": committed_at_ms,
                    },
                ),
            )

        revision_rows = conn.execute(
            """
            SELECT tenant_id, checkpoint_scope, revision, checkpoint_id, action,
                   summary_blob, bound_sequence, bound_record_hash,
                   checkpoint_created_at, value_hash, value_bytes
            FROM ge_cycle_checkpoint_revisions
            ORDER BY tenant_id, checkpoint_scope, revision
            """
        ).fetchall()
        prior_key: tuple[str, str] | None = None
        prior_revision = 0
        for row in revision_rows:
            if len(row) != 11:
                fail("checkpoint revision row")
            tenant_id = text_value(row[0], "revision tenant")
            scope = text_value(row[1], "revision scope")
            revision = integer(row[2], 1, MAX_SAFE_INTEGER, "checkpoint revision")
            checkpoint_id = text_value(row[3], "revision checkpoint id")
            action = text_value(row[4], "revision action")
            key = (tenant_id, scope)
            expected_revision = prior_revision + 1 if key == prior_key else 1
            if revision != expected_revision:
                fail("checkpoint revision sequence")
            prior_key = key
            prior_revision = revision
            if action == "put":
                summary_blob = blob(row[5], "revision summary")
                try:
                    summary = cast(
                        JsonObject,
                        cycle_store_adapter_codec.decode_ledger_result(
                            "save-checkpoint",
                            summary_blob,
                        ),
                    )
                except Exception:
                    fail("checkpoint revision binding")
                if (
                    summary["checkpointScope"] != scope
                    or summary["checkpointId"] != checkpoint_id
                    or summary["boundSequence"]
                    != integer(row[6], 0, MAX_SAFE_INTEGER, "revision sequence")
                    or summary["boundRecordHash"]
                    != hash_value(row[7], "revision record hash")
                    or summary["createdAt"] != text_value(row[8], "revision created time")
                    or summary["valueHash"] != hash_value(row[9], "revision value hash")
                    or summary["valueBytes"]
                    != integer(row[10], 1, 16_777_216, "revision value bytes")
                ):
                    fail("checkpoint revision binding")
                update(
                    "checkpoint-revision",
                    cast(
                        JsonObject,
                        {
                            "tenantId": tenant_id,
                            "revision": revision,
                            "action": action,
                            "summary": summary,
                        },
                    ),
                )
            elif action == "delete":
                if any(value is not None for value in row[5:]):
                    fail("checkpoint deletion revision")
                update(
                    "checkpoint-revision",
                    cast(
                        JsonObject,
                        {
                            "tenantId": tenant_id,
                            "scope": scope,
                            "revision": revision,
                            "checkpointId": checkpoint_id,
                            "action": action,
                        },
                    ),
                )
            else:
                fail("checkpoint revision action")

        bad_lease_row = conn.execute(
            """
            SELECT count(*) FROM ge_cycle_leases
            WHERE last_lease_epoch <> last_fencing_token
               OR (active_lease_id IS NULL) <> (active_holder_id IS NULL)
               OR (active_lease_id IS NULL) <> (active_lease_epoch IS NULL)
               OR (active_lease_id IS NULL) <> (active_fencing_token IS NULL)
               OR (active_lease_id IS NULL) <> (active_acquired_at_ms IS NULL)
               OR (active_lease_id IS NULL) <> (active_expires_at_ms IS NULL)
               OR (active_lease_id IS NOT NULL AND (
                    active_lease_epoch <> last_lease_epoch
                 OR active_fencing_token <> last_fencing_token
                 OR active_expires_at_ms <= active_acquired_at_ms))
            """
        ).fetchone()
        bad_used_lease_row = conn.execute(
            """
            SELECT count(*)
            FROM ge_cycle_used_lease_ids used
            JOIN ge_cycle_leases lease
              ON lease.tenant_id = used.tenant_id
             AND lease.stream_id = used.stream_id
            WHERE used.lease_epoch <> used.fencing_token
               OR used.fencing_token > lease.last_fencing_token
            """
        ).fetchone()
        incomplete_lease_history_row = conn.execute(
            """
            SELECT count(*)
            FROM ge_cycle_leases lease
            WHERE (SELECT count(*) FROM ge_cycle_used_lease_ids used
                    WHERE used.tenant_id = lease.tenant_id
                      AND used.stream_id = lease.stream_id) <> lease.last_lease_epoch
               OR coalesce((SELECT min(used.lease_epoch)
                            FROM ge_cycle_used_lease_ids used
                            WHERE used.tenant_id = lease.tenant_id
                              AND used.stream_id = lease.stream_id), 0)
                  <> CASE WHEN lease.last_lease_epoch = 0 THEN 0 ELSE 1 END
               OR coalesce((SELECT max(used.lease_epoch)
                            FROM ge_cycle_used_lease_ids used
                            WHERE used.tenant_id = lease.tenant_id
                              AND used.stream_id = lease.stream_id), 0)
                  <> lease.last_lease_epoch
               OR (SELECT count(DISTINCT used.lease_epoch)
                   FROM ge_cycle_used_lease_ids used
                   WHERE used.tenant_id = lease.tenant_id
                     AND used.stream_id = lease.stream_id) <> lease.last_lease_epoch
               OR (lease.active_lease_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM ge_cycle_used_lease_ids used
                    WHERE used.tenant_id = lease.tenant_id
                      AND used.stream_id = lease.stream_id
                      AND used.lease_id = lease.active_lease_id
                      AND used.lease_epoch = lease.active_lease_epoch
                      AND used.fencing_token = lease.active_fencing_token
                  ))
            """
        ).fetchone()
        if (
            bad_lease_row is None
            or bad_used_lease_row is None
            or incomplete_lease_history_row is None
        ):
            fail("lease counts")
        if (
            integer(bad_lease_row[0], 0, MAX_SAFE_INTEGER, "invalid lease count") != 0
            or integer(
                bad_used_lease_row[0],
                0,
                MAX_SAFE_INTEGER,
                "invalid used lease count",
            )
            != 0
            or integer(
                incomplete_lease_history_row[0],
                0,
                MAX_SAFE_INTEGER,
                "incomplete lease identity history",
            )
            != 0
        ):
            fail("lease or migration fence")

        migration = conn.execute(
            """
            SELECT active_lock_id, active_owner_id, active_source_version,
                   active_target_version, active_lock_epoch, active_fencing_token,
                   active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
                   last_fencing_token, ge_cycle_migration_lock.updated_at_ms,
                   ge_cycle_schema.updated_at_ms
            FROM ge_cycle_migration_lock CROSS JOIN ge_cycle_schema
            WHERE ge_cycle_migration_lock.singleton = 1
              AND ge_cycle_schema.singleton = 1
            """
        ).fetchone()
        if migration is None or len(migration) != 12:
            fail("migration lock singleton")
        active_nulls = sum(value is None for value in migration[:8])
        last_epoch = integer(migration[8], 0, MAX_SAFE_INTEGER, "last migration epoch")
        last_fence = integer(migration[9], 0, MAX_SAFE_INTEGER, "last migration fence")
        clock_high_water = integer(
            migration[10],
            0,
            MAX_SAFE_INTEGER,
            "migration clock high-water",
        )
        schema_applied_at = integer(
            migration[11],
            0,
            MAX_SAFE_INTEGER,
            "schema application time",
        )
        maximum_observed_row = conn.execute(
            """
            SELECT max(observed_at_ms) FROM (
              SELECT created_at_ms AS observed_at_ms FROM ge_cycle_schema
              UNION ALL SELECT updated_at_ms FROM ge_cycle_schema
              UNION ALL SELECT applied_at_ms FROM ge_cycle_migrations
              UNION ALL SELECT created_at_ms FROM ge_cycle_streams
              UNION ALL SELECT updated_at_ms FROM ge_cycle_streams
              UNION ALL SELECT committed_at_ms FROM ge_cycle_records
              UNION ALL SELECT committed_at_ms FROM ge_cycle_operations
              UNION ALL SELECT committed_at_ms FROM ge_cycle_checkpoints
              UNION ALL SELECT recorded_at_ms FROM ge_cycle_checkpoint_revisions
              UNION ALL SELECT updated_at_ms FROM ge_cycle_leases
              UNION ALL SELECT first_used_at_ms FROM ge_cycle_used_lease_ids
              UNION ALL SELECT placed_at_ms FROM ge_cycle_legal_holds
              UNION ALL SELECT created_at_ms FROM ge_cycle_cursors
              UNION ALL SELECT consumed_at_ms FROM ge_cycle_cursors
                WHERE consumed_at_ms IS NOT NULL
              UNION ALL SELECT first_used_at_ms
                FROM ge_cycle_used_migration_lock_ids
              UNION ALL SELECT updated_at_ms FROM ge_cycle_migration_lock
            )
            """
        ).fetchone()
        if maximum_observed_row is None:
            fail("maximum observed provider time")
        maximum_observed_time = integer(
            maximum_observed_row[0],
            0,
            MAX_SAFE_INTEGER,
            "maximum observed provider time",
        )
        if (
            last_epoch != last_fence
            or clock_high_water < schema_applied_at
            or clock_high_water < maximum_observed_time
            or active_nulls not in (0, 8)
        ):
            fail("lease or migration fence")
        if active_nulls == 0:
            text_value(migration[0], "migration lock id")
            text_value(migration[1], "migration owner id")
            source = integer(migration[2], 1, MAX_SAFE_INTEGER, "migration source")
            target = integer(migration[3], 2, MAX_SAFE_INTEGER, "migration target")
            epoch = integer(migration[4], 1, MAX_SAFE_INTEGER, "migration epoch")
            fence = integer(migration[5], 1, MAX_SAFE_INTEGER, "migration fence")
            acquired = integer(migration[6], 0, MAX_SAFE_INTEGER, "migration acquired time")
            expires = integer(migration[7], 0, MAX_SAFE_INTEGER, "migration expiry time")
            if (
                target <= source
                or epoch != last_epoch
                or fence != last_fence
                or expires <= acquired
            ):
                fail("active migration fence")
        bad_used_migration = conn.execute(
            """
            SELECT count(*) FROM ge_cycle_used_migration_lock_ids
            WHERE lock_epoch <> fencing_token
               OR fencing_token > (
                 SELECT last_fencing_token
                 FROM ge_cycle_migration_lock WHERE singleton = 1
               )
            """
        ).fetchone()
        incomplete_migration_history = conn.execute(
            """
            SELECT count(*)
            FROM ge_cycle_migration_lock migration_lock
            WHERE (SELECT count(*) FROM ge_cycle_used_migration_lock_ids)
                    <> migration_lock.last_lock_epoch
               OR coalesce((SELECT min(lock_epoch)
                            FROM ge_cycle_used_migration_lock_ids), 0)
                    <> CASE WHEN migration_lock.last_lock_epoch = 0 THEN 0 ELSE 1 END
               OR coalesce((SELECT max(lock_epoch)
                            FROM ge_cycle_used_migration_lock_ids), 0)
                    <> migration_lock.last_lock_epoch
               OR (SELECT count(DISTINCT lock_epoch)
                   FROM ge_cycle_used_migration_lock_ids)
                    <> migration_lock.last_lock_epoch
               OR (migration_lock.active_lock_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM ge_cycle_used_migration_lock_ids used
                    WHERE used.lock_id = migration_lock.active_lock_id
                      AND used.lock_epoch = migration_lock.active_lock_epoch
                      AND used.fencing_token = migration_lock.active_fencing_token
                  ))
            """
        ).fetchone()
        if (
            bad_used_migration is None
            or incomplete_migration_history is None
            or integer(
                bad_used_migration[0],
                0,
                MAX_SAFE_INTEGER,
                "invalid migration identity count",
            )
            != 0
            or integer(
                incomplete_migration_history[0],
                0,
                MAX_SAFE_INTEGER,
                "incomplete migration identity history",
            )
            != 0
        ):
            fail("used migration identities")

        def normalized_row(row: tuple[object, ...], label: str) -> list[JsonValue]:
            normalized: list[JsonValue] = []
            for value in row:
                if type(value) is int:
                    normalized.append(integer(value, 0, MAX_SAFE_INTEGER, f"{label} integer"))
                elif type(value) is bytes:
                    normalized.append(value.hex())
                elif value is None or type(value) is str:
                    normalized.append(value)
                else:
                    fail(f"{label} field")
            return normalized

        lease_rows = conn.execute(
            """
            SELECT tenant_id, stream_id, last_lease_epoch, last_fencing_token,
                   active_lease_id, active_holder_id, active_lease_epoch,
                   active_fencing_token, active_acquired_at_ms, active_expires_at_ms
            FROM ge_cycle_leases ORDER BY tenant_id, stream_id
            """
        ).fetchall()
        for row in lease_rows:
            update("lease", normalized_row(tuple(row), "lease"))
        update("migration-lock", normalized_row(tuple(migration), "migration lock"))

        cursor_rows = conn.execute(
            """
            SELECT tenant_id, token_hash, kind, stream_id, checkpoint_scope,
                   request_scope_blob, page_size, next_position,
                   snapshot_tail_sequence, snapshot_tail_record_hash,
                   descriptor_hash, schema_identity_sha256, snapshot_blob,
                   created_at_ms, expires_at_ms, consumed_at_ms
            FROM ge_cycle_cursors ORDER BY tenant_id, token_hash
            """
        ).fetchall()
        for row in cursor_rows:
            if len(row) != 16:
                fail("cursor row")
            tenant_id = text_value(row[0], "cursor tenant")
            token_hash = hash_value(row[1], "cursor token hash")
            kind = text_value(row[2], "cursor kind")
            cursor_stream_id = nullable_text(row[3], "cursor stream")
            cursor_scope = nullable_text(row[4], "cursor scope")
            request_scope_blob = blob(row[5], "cursor request scope")
            request_scope = _decode_canonical_json_bytes(
                request_scope_blob,
                operation,
                "cursor request scope",
                1_048_576,
            )
            page_size = integer(row[6], 1, 256, "cursor page size")
            next_position = integer(row[7], 0, MAX_SAFE_INTEGER, "cursor position")
            tail_sequence = (
                None
                if row[8] is None
                else integer(row[8], -1, MAX_SAFE_INTEGER, "cursor tail sequence")
            )
            tail_hash = nullable_text(row[9], "cursor tail hash")
            descriptor_hash = hash_value(row[10], "cursor descriptor")
            schema_identity = hash_value(row[11], "cursor schema identity")
            snapshot_blob = blob(row[12], "cursor snapshot")
            snapshot = _decode_canonical_json_bytes(
                snapshot_blob,
                operation,
                "cursor snapshot",
                16_777_216,
            )
            created_at = integer(row[13], 0, MAX_SAFE_INTEGER, "cursor creation time")
            expires_at = integer(row[14], 0, MAX_SAFE_INTEGER, "cursor expiry time")
            consumed_at = (
                None
                if row[15] is None
                else integer(row[15], 0, MAX_SAFE_INTEGER, "cursor consumption time")
            )
            if (
                descriptor_hash != self._descriptor["descriptorHash"]
                or schema_identity != self._assets.schema_identity_hash
                or expires_at <= created_at
                or (consumed_at is not None and consumed_at < created_at)
            ):
                fail("cursor identity binding")
            if kind == "event":
                expected_scope = cast(
                    JsonObject,
                    {
                        "contractVersion": CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
                        "streamId": cursor_stream_id,
                        "pageSize": page_size,
                    },
                )
                expected_snapshot = cast(
                    JsonObject,
                    {
                        "exists": tail_sequence != -1,
                        "sequence": tail_sequence,
                        "recordHash": tail_hash,
                    },
                )
                if (
                    cursor_stream_id is None
                    or cursor_scope is not None
                    or tail_sequence is None
                    or request_scope != expected_scope
                    or snapshot != expected_snapshot
                    or (tail_sequence == -1) != (tail_hash is None)
                    or tail_sequence < 0
                    or tail_hash is None
                    or (tail_sequence >= 0 and next_position > tail_sequence)
                ):
                    fail("event cursor binding")
                retained_tail = conn.execute(
                    """
                    SELECT 1 FROM ge_cycle_records
                    WHERE tenant_id = ? AND stream_id = ?
                      AND sequence = ? AND record_hash = ?
                    """,
                    (tenant_id, cursor_stream_id, tail_sequence, tail_hash),
                ).fetchone()
                if retained_tail is None:
                    fail("event cursor retained tail binding")
            elif kind == "checkpoint":
                expected_scope = cast(
                    JsonObject,
                    {
                        "contractVersion": CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
                        "checkpointScope": cursor_scope,
                        "pageSize": page_size,
                    },
                )
                if (
                    cursor_stream_id is not None
                    or cursor_scope is None
                    or tail_sequence is not None
                    or tail_hash is not None
                    or request_scope != expected_scope
                    or type(snapshot) is not list
                    or next_position > len(snapshot)
                ):
                    fail("checkpoint cursor binding")
                summaries = self._decode_checkpoint_snapshot(snapshot_blob, operation)
                for summary in summaries:
                    encoded = cycle_store_adapter_codec.encode_ledger_result(
                        "save-checkpoint",
                        summary,
                    )
                    if (
                        summary["checkpointScope"] != cursor_scope
                        or conn.execute(
                            """
                            SELECT 1 FROM ge_cycle_checkpoint_revisions
                            WHERE tenant_id = ? AND checkpoint_scope = ?
                              AND checkpoint_id = ? AND action = 'put'
                              AND summary_blob = ? LIMIT 1
                            """,
                            (
                                tenant_id,
                                cursor_scope,
                                summary["checkpointId"],
                                encoded,
                            ),
                        ).fetchone()
                        is None
                    ):
                        fail("checkpoint cursor revision binding")
                for index in range(1, len(summaries)):
                    prior = summaries[index - 1]
                    current = summaries[index]
                    prior_sequence = cast(int, prior["boundSequence"])
                    current_sequence = cast(int, current["boundSequence"])
                    prior_created_at = cast(str, prior["createdAt"])
                    current_created_at = cast(str, current["createdAt"])
                    prior_id = cast(str, prior["checkpointId"])
                    current_id = cast(str, current["checkpointId"])
                    ordered = (
                        prior_sequence > current_sequence
                        or (
                            prior_sequence == current_sequence
                            and prior_created_at > current_created_at
                        )
                        or (
                            prior_sequence == current_sequence
                            and prior_created_at == current_created_at
                            and prior_id < current_id
                        )
                    )
                    if not ordered:
                        fail("checkpoint cursor snapshot order")
            else:
                fail("cursor kind")
            update(
                "cursor",
                cast(
                    JsonObject,
                    {
                        "tenantId": tenant_id,
                        "tokenHash": token_hash,
                        "kind": kind,
                        "requestScope": request_scope,
                        "nextPosition": next_position,
                        "snapshot": snapshot,
                        "createdAt": created_at,
                        "expiresAt": expires_at,
                        "consumedAt": consumed_at,
                    },
                ),
            )

        for label, sql in (
            (
                "legal-hold",
                """
                SELECT tenant_id, stream_id, hold_id, placed_at_ms
                FROM ge_cycle_legal_holds ORDER BY tenant_id, stream_id, hold_id
                """,
            ),
            (
                "used-lease",
                """
                SELECT tenant_id, stream_id, lease_id, lease_epoch,
                       fencing_token, first_used_at_ms
                FROM ge_cycle_used_lease_ids
                ORDER BY tenant_id, stream_id, lease_id
                """,
            ),
            (
                "used-migration",
                """
                SELECT lock_id, lock_epoch, fencing_token, first_used_at_ms
                FROM ge_cycle_used_migration_lock_ids ORDER BY lock_id
                """,
            ),
        ):
            for row in conn.execute(sql).fetchall():
                update(label, normalized_row(tuple(row), label))

        open_cursor_row = conn.execute(
            "SELECT COUNT(*) FROM ge_cycle_cursors WHERE consumed_at_ms IS NULL"
        ).fetchone()
        if open_cursor_row is None:
            fail("open cursor count")
        open_cursor_count = integer(
            open_cursor_row[0],
            0,
            MAX_SAFE_INTEGER,
            "open cursor count",
        )
        counters = cast(
            JsonObject,
            {
                "streams": len(stream_rows),
                "records": len(record_rows),
                "operations": len(operation_rows),
                "checkpoints": len(checkpoint_rows),
                "checkpointRevisions": len(revision_rows),
                "leases": len(lease_rows),
                "usedLeaseIds": count("ge_cycle_used_lease_ids"),
                "legalHolds": count("ge_cycle_legal_holds"),
                "cursors": len(cursor_rows),
                "openCursors": open_cursor_count,
                "usedMigrationLockIds": count("ge_cycle_used_migration_lock_ids"),
            },
        )
        update("counters", counters)
        sqlite_version_row = conn.execute("SELECT sqlite_version()").fetchone()
        if sqlite_version_row is None:
            fail("SQLite version")
        sqlite_version = text_value(sqlite_version_row[0], "SQLite version")
        return cast(
            JsonObject,
            {
                "level": "semantic",
                "quickCheck": "ok",
                "integrityCheck": "ok",
                "foreignKeyViolations": 0,
                "applicationId": SQLITE_CYCLE_STORE_APPLICATION_ID,
                "schemaVersion": SQLITE_CYCLE_STORE_SCHEMA_VERSION,
                "schemaIdentitySha256": self._assets.schema_identity_hash,
                "descriptorHash": self._descriptor["descriptorHash"],
                "lineageId": lineage_id,
                "lineageSha256": lineage_hash,
                "catalogSha256": SQLITE_CYCLE_STORE_CATALOG_SHA256,
                "counters": counters,
                "semanticSha256": digest.hexdigest(),
                "sqliteVersion": sqlite_version,
            },
        )

    def _validate_audit_connection_settings(
        self,
        conn: sqlite3.Connection,
        operation: CycleStoreProviderOperation,
    ) -> None:
        for name, expected in (
            ("foreign_keys", 1),
            ("trusted_schema", 0),
            ("synchronous", 2),
            ("busy_timeout", 250),
            ("writable_schema", 0),
            ("query_only", 1),
        ):
            row = conn.execute(f"PRAGMA {name}").fetchone()
            if row != (expected,):
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite audit connection settings are unsafe",
                    cast(JsonObject, {"setting": name}),
                )
        journal = conn.execute("PRAGMA journal_mode").fetchone()
        if (
            journal is None
            or len(journal) != 1
            or str(journal[0]).lower() not in ("wal", "delete")
        ):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite audit connection settings are unsafe",
                cast(JsonObject, {"setting": "journal_mode"}),
            )

    async def audit_integrity(
        self,
        mode: Literal["quick", "structural", "semantic"] = "quick",
    ) -> JsonObject:
        """Run one bounded manifest-aware integrity audit."""

        operation: CycleStoreProviderOperation = "inspect-schema"
        if mode not in ("quick", "structural", "semantic"):
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "integrity audit mode is invalid",
            )

        def audit(conn: sqlite3.Connection) -> JsonValue:
            committed = False
            try:
                conn.execute("PRAGMA busy_timeout = 250")
                conn.execute("PRAGMA query_only = ON")
                self._validate_audit_connection_settings(conn, operation)
                conn.execute("BEGIN")
                if mode == "semantic":
                    report = self._semantic_audit(conn, operation)
                else:
                    self._validate_schema(
                        conn,
                        operation,
                        full_integrity=mode == "structural",
                    )
                    table_names = (
                        "ge_cycle_streams",
                        "ge_cycle_records",
                        "ge_cycle_operations",
                        "ge_cycle_checkpoints",
                        "ge_cycle_checkpoint_revisions",
                        "ge_cycle_leases",
                        "ge_cycle_used_lease_ids",
                        "ge_cycle_legal_holds",
                        "ge_cycle_cursors",
                        "ge_cycle_used_migration_lock_ids",
                    )
                    counts: dict[str, int] = {}
                    for table_name in table_names:
                        row = conn.execute(
                            f'SELECT COUNT(*) FROM "{table_name}"'
                        ).fetchone()
                        if (
                            row is None
                            or type(row[0]) is not int
                            or row[0] < 0
                            or row[0] > MAX_SAFE_INTEGER
                        ):
                            _raise_provider(
                                "GE_CYCLE_STORE_CORRUPTION",
                                operation,
                                "SQLite integrity counter is corrupt",
                            )
                        counts[table_name] = row[0]
                    open_row = conn.execute(
                        """
                        SELECT COUNT(*) FROM ge_cycle_cursors
                        WHERE consumed_at_ms IS NULL
                        """
                    ).fetchone()
                    lineage_row = conn.execute(
                        """
                        SELECT migration_id, sql_sha256
                        FROM ge_cycle_migrations WHERE version = 1
                        """
                    ).fetchone()
                    version_row = conn.execute("SELECT sqlite_version()").fetchone()
                    if (
                        open_row is None
                        or type(open_row[0]) is not int
                        or open_row[0] < 0
                        or open_row[0] > MAX_SAFE_INTEGER
                        or lineage_row is None
                        or type(lineage_row[0]) is not str
                        or type(lineage_row[1]) is not str
                        or version_row is None
                        or type(version_row[0]) is not str
                    ):
                        _raise_provider(
                            "GE_CYCLE_STORE_CORRUPTION",
                            operation,
                            "SQLite integrity identity is corrupt",
                        )
                    counters = cast(
                        JsonObject,
                        {
                            "streams": counts["ge_cycle_streams"],
                            "records": counts["ge_cycle_records"],
                            "operations": counts["ge_cycle_operations"],
                            "checkpoints": counts["ge_cycle_checkpoints"],
                            "checkpointRevisions": counts[
                                "ge_cycle_checkpoint_revisions"
                            ],
                            "leases": counts["ge_cycle_leases"],
                            "usedLeaseIds": counts["ge_cycle_used_lease_ids"],
                            "legalHolds": counts["ge_cycle_legal_holds"],
                            "cursors": counts["ge_cycle_cursors"],
                            "openCursors": open_row[0],
                            "usedMigrationLockIds": counts[
                                "ge_cycle_used_migration_lock_ids"
                            ],
                        },
                    )
                    report = cast(
                        JsonObject,
                        {
                            "level": mode,
                            "quickCheck": "ok",
                            "integrityCheck": (
                                "not-run" if mode == "quick" else "ok"
                            ),
                            "foreignKeyViolations": 0,
                            "applicationId": SQLITE_CYCLE_STORE_APPLICATION_ID,
                            "schemaVersion": SQLITE_CYCLE_STORE_SCHEMA_VERSION,
                            "schemaIdentitySha256": self._assets.schema_identity_hash,
                            "descriptorHash": self._descriptor["descriptorHash"],
                            "lineageId": lineage_row[0],
                            "lineageSha256": lineage_row[1],
                            "catalogSha256": SQLITE_CYCLE_STORE_CATALOG_SHA256,
                            "counters": counters,
                            "semanticSha256": None,
                            "sqliteVersion": version_row[0],
                        },
                    )
                conn.execute("COMMIT")
                committed = True
                return report
            finally:
                if not committed and conn.in_transaction:
                    conn.execute("ROLLBACK")
                conn.execute("PRAGMA query_only = OFF")
                conn.execute(f"PRAGMA busy_timeout = {self._busy_timeout_ms:d}")

        async with self._operation_lock:
            self._ensure_open(operation)
            loop = asyncio.get_running_loop()
            return cast(
                JsonObject,
                await loop.run_in_executor(
                    self._executor,
                    self._run_connection,
                    operation,
                    audit,
                ),
            )

    async def checkpoint_wal(
        self,
        mode: Literal["PASSIVE", "FULL", "RESTART", "TRUNCATE"] = "PASSIVE",
    ) -> JsonObject:
        """Run a bounded WAL checkpoint and reject a returned busy status."""

        operation: CycleStoreProviderOperation = "inspect-schema"
        if mode not in ("PASSIVE", "FULL", "RESTART", "TRUNCATE"):
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "WAL checkpoint mode is invalid",
            )

        def checkpoint(conn: sqlite3.Connection) -> JsonValue:
            row = conn.execute(f"PRAGMA wal_checkpoint({mode})").fetchone()
            if (
                row is None
                or len(row) != 3
                or not all(type(value) is int for value in row)
            ):
                _raise_provider(
                    "GE_CYCLE_STORE_INTERNAL",
                    operation,
                    "WAL checkpoint returned invalid status",
                )
            if row[0] != 0:
                _raise_provider(
                    "GE_CYCLE_STORE_UNAVAILABLE",
                    operation,
                    "WAL checkpoint is busy",
                    cast(JsonObject, {"busy": row[0]}),
                )
            return cast(
                JsonObject,
                {"busy": row[0], "logFrames": row[1], "checkpointedFrames": row[2]},
            )

        async with self._operation_lock:
            self._ensure_open(operation)
            loop = asyncio.get_running_loop()
            return cast(
                JsonObject,
                await loop.run_in_executor(
                    self._executor,
                    self._run_connection,
                    operation,
                    checkpoint,
                ),
            )

    def _backup_sync(
        self,
        destination: Path,
        expected_source: tuple[int, str, str, JsonObject] | None = None,
    ) -> JsonObject:
        operation: CycleStoreProviderOperation = "inspect-schema"
        source_path = self._path.resolve(strict=True)
        manifest_path = Path(f"{destination}.manifest.json")
        try:
            destination_aliases_source = (
                destination.resolve(strict=False) == source_path
                or (destination.exists() and os.path.samefile(destination, source_path))
            )
        except OSError:
            _raise_provider(
                "GE_CYCLE_STORE_PERMISSION_DENIED",
                operation,
                "SQLite backup destination identity is unavailable",
            )
        if destination_aliases_source:
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "SQLite backup destination aliases its source",
            )
        if destination.exists() or manifest_path.exists():
            _raise_provider(
                "GE_CYCLE_STORE_CONFLICT",
                operation,
                "SQLite backup destination already exists",
            )
        if not destination.parent.exists() or not destination.parent.is_dir():
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "backup destination parent directory does not exist",
            )
        nonce = secrets.token_hex(16)
        temporary = destination.parent / f".{destination.name}.verified-{nonce}.db"
        temporary_manifest = destination.parent / (
            f".{destination.name}.verified-{nonce}.manifest.tmp"
        )
        source = self._owner_connection(operation)
        target: sqlite3.Connection | None = None
        database_published = False
        manifest_published = False
        complete = False
        progress_calls = 0
        total_pages = 0

        def unlink_if_owned(path: Path, owned: Path) -> None:
            try:
                if path.exists() and os.path.samefile(path, owned):
                    path.unlink()
            except OSError:
                return

        try:
            if source.in_transaction:
                _raise_provider(
                    "GE_CYCLE_STORE_INTERNAL",
                    operation,
                    "SQLite backup source transaction is active",
                )
            file_descriptor = os.open(
                temporary,
                os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                0o600,
            )
            os.close(file_descriptor)
            target = sqlite3.connect(temporary, isolation_level=None)
            target.execute("PRAGMA foreign_keys = ON")
            target.execute("PRAGMA trusted_schema = OFF")
            started = time.monotonic()

            def progress(_status: int, _remaining: int, total: int) -> None:
                nonlocal progress_calls, total_pages
                progress_calls += 1
                total_pages = max(total_pages, total)
                if progress_calls > 100_000:
                    raise TimeoutError("backup progress-call bound exceeded")
                if time.monotonic() - started > 60:
                    raise TimeoutError("backup elapsed-time bound exceeded")

            source.backup(target, pages=256, progress=progress, sleep=0.01)
            target.close()
            target = None
            verify = sqlite3.connect(temporary, isolation_level=None)
            try:
                verify.execute("PRAGMA foreign_keys = ON")
                verify.execute("PRAGMA trusted_schema = OFF")
                checkpoint = verify.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                if checkpoint is None or checkpoint[0] != 0:
                    _raise_provider(
                        "GE_CYCLE_STORE_UNAVAILABLE",
                        operation,
                        "backup WAL checkpoint is busy",
                    )
                integrity = self._semantic_audit(verify, operation)
                page_row = verify.execute("PRAGMA page_count").fetchone()
                if page_row is None or type(page_row[0]) is not int or page_row[0] < 1:
                    _raise_provider(
                        "GE_CYCLE_STORE_CORRUPTION",
                        operation,
                        "SQLite backup page count is corrupt",
                    )
                total_pages = max(total_pages, page_row[0])
            finally:
                verify.close()
            with temporary.open("rb") as handle:
                os.fsync(handle.fileno())
            file_size = temporary.stat().st_size
            if file_size < 1 or file_size > MAX_SAFE_INTEGER:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite backup file size is corrupt",
                )
            file_hash = _file_sha256(temporary)
            semantic_hash = integrity["semanticSha256"]
            counters = integrity["counters"]
            if type(semantic_hash) is not str or type(counters) is not dict:
                _raise_provider(
                    "GE_CYCLE_STORE_INTERNAL",
                    operation,
                    "SQLite backup semantic audit is incomplete",
                )
            manifest_body = cast(
                JsonObject,
                {
                    "apiVersion": SQLITE_BACKUP_MANIFEST_API_VERSION,
                    "kind": "SQLiteCycleStoreBackupManifest",
                    "formatVersion": 1,
                    "hashAlgorithm": "sha256",
                    "file": {"bytes": file_size, "sha256": file_hash},
                    "provider": {
                        "applicationId": SQLITE_CYCLE_STORE_APPLICATION_ID,
                        "schemaVersion": SQLITE_CYCLE_STORE_SCHEMA_VERSION,
                        "schemaIdentitySha256": integrity["schemaIdentitySha256"],
                        "descriptorHash": integrity["descriptorHash"],
                        "catalogSha256": integrity["catalogSha256"],
                        "lineageId": integrity["lineageId"],
                        "lineageSha256": integrity["lineageSha256"],
                    },
                    "semantic": {"sha256": semantic_hash, "counters": counters},
                },
            )
            manifest_hash = hashlib.sha256(
                SQLITE_BACKUP_MANIFEST_DOMAIN.encode("utf-8")
                + canonical_bytes(manifest_body)
            ).hexdigest()
            manifest = cast(
                JsonObject,
                {**manifest_body, "manifestSha256": manifest_hash},
            )
            manifest_bytes = canonical_bytes(manifest)
            if len(manifest_bytes) > 65_536:
                _raise_provider(
                    "GE_CYCLE_STORE_INTERNAL",
                    operation,
                    "SQLite backup manifest exceeds its fixed bound",
                )
            with temporary_manifest.open("xb") as manifest_handle:
                manifest_handle.write(manifest_bytes)
                manifest_handle.flush()
                os.fsync(manifest_handle.fileno())
            if expected_source is not None:
                (
                    expected_size,
                    expected_hash,
                    expected_semantic_hash,
                    expected_counters,
                ) = expected_source
                if (
                    source_path.stat().st_size != expected_size
                    or _file_sha256(source_path) != expected_hash
                ):
                    _raise_provider(
                        "GE_CYCLE_STORE_CORRUPTION",
                        operation,
                        "SQLite restore source changed during verification",
                    )
                if (
                    integrity["semanticSha256"] != expected_semantic_hash
                    or integrity["counters"] != expected_counters
                ):
                    _raise_provider(
                        "GE_CYCLE_STORE_CORRUPTION",
                        operation,
                        "SQLite restored semantic identity drifted",
                    )
            os.link(temporary, destination)
            database_published = True
            os.link(temporary_manifest, manifest_path)
            manifest_published = True
            directory_fd = os.open(destination.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            complete = True
            return cast(
                JsonObject,
                {
                    "path": str(destination),
                    "manifestPath": str(manifest_path),
                    "bytes": file_size,
                    "sha256": file_hash,
                    "manifestSha256": manifest_hash,
                    "pages": total_pages,
                    "progressCalls": progress_calls,
                    "integrity": integrity,
                },
            )
        except CycleStoreProviderError:
            raise
        except sqlite3.Error as error:
            raise _translate_sqlite_error(error, operation) from None
        except FileExistsError:
            _raise_provider(
                "GE_CYCLE_STORE_CONFLICT",
                operation,
                "SQLite backup destination already exists",
            )
        except OSError as error:
            if error.errno in (errno.ENOSPC, errno.EDQUOT, errno.EFBIG):
                _raise_provider(
                    "GE_CYCLE_STORE_QUOTA_EXCEEDED",
                    operation,
                    "SQLite backup storage quota was exceeded",
                )
            if error.errno in (errno.EACCES, errno.EPERM, errno.EROFS):
                _raise_provider(
                    "GE_CYCLE_STORE_PERMISSION_DENIED",
                    operation,
                    "SQLite backup filesystem access was denied",
                )
            _raise_provider(
                "GE_CYCLE_STORE_UNAVAILABLE",
                operation,
                "SQLite online backup failed",
            )
        except TimeoutError:
            _raise_provider(
                "GE_CYCLE_STORE_UNAVAILABLE",
                operation,
                "SQLite online backup failed",
            )
        finally:
            if target is not None:
                target.close()
            if not complete:
                if manifest_published:
                    unlink_if_owned(manifest_path, temporary_manifest)
                if database_published:
                    unlink_if_owned(destination, temporary)
            for temporary_path in (
                temporary,
                temporary_manifest,
                Path(f"{temporary}-wal"),
                Path(f"{temporary}-shm"),
            ):
                with suppress(FileNotFoundError):
                    temporary_path.unlink()

    async def backup(self, destination: str | os.PathLike[str]) -> JsonObject:
        """Publish a verified online backup to one new local path."""

        operation: CycleStoreProviderOperation = "inspect-schema"
        try:
            raw = os.fspath(destination)
        except TypeError:
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "backup destination is invalid",
            )
        if type(raw) is not str or not raw or "\0" in raw:
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "backup destination is invalid",
            )
        path = Path(raw).expanduser().resolve(strict=False)
        async with self._operation_lock:
            self._ensure_open(operation)
            loop = asyncio.get_running_loop()
            return cast(
                JsonObject,
                await loop.run_in_executor(self._executor, self._backup_sync, path),
            )

    @classmethod
    async def restore_backup(
        cls,
        backup_path: str | os.PathLike[str],
        destination: str | os.PathLike[str],
        manifest: object | None = None,
        **provider_options: Any,
    ) -> SQLiteCycleStoreProvider:
        """Verify a manifest-bound backup and restore it only to a new path."""

        operation: CycleStoreProviderOperation = "inspect-schema"
        try:
            raw_source = os.fspath(backup_path)
            raw_destination = os.fspath(destination)
            if (
                type(raw_source) is not str
                or not raw_source
                or "\0" in raw_source
                or type(raw_destination) is not str
                or not raw_destination
                or "\0" in raw_destination
            ):
                raise ValueError("restore path is invalid")
            source_input = Path(raw_source).expanduser()
            if source_input.is_symlink() or not source_input.is_file():
                raise ValueError("restore source is not a regular file")
            source_path = source_input.resolve(strict=True)
            destination_path = Path(os.fspath(destination)).expanduser().resolve(strict=False)
        except Exception:
            _raise_provider(
                "GE_CYCLE_STORE_INVALID_ARGUMENT",
                operation,
                "backup restore input is invalid",
            )

        def read_manifest(path: Path) -> JsonObject:
            try:
                if path.is_symlink() or not path.is_file():
                    raise ValueError("manifest is not a regular file")
                size = path.stat().st_size
                if size < 2 or size > 65_536:
                    raise ValueError("manifest size is invalid")
                with path.open("rb") as handle:
                    raw = handle.read(65_537)
                if len(raw) != size:
                    raise ValueError("manifest changed during read")
                decoded = _decode_canonical_json_bytes(
                    raw,
                    operation,
                    "backup manifest",
                    65_536,
                )
                if type(decoded) is not dict:
                    raise ValueError("manifest is not an object")
                return decoded
            except CycleStoreProviderError:
                raise
            except Exception:
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite backup manifest file is invalid",
                )

        if manifest is None:
            captured = read_manifest(Path(f"{source_path}.manifest.json"))
        else:
            try:
                provided = portable_json_snapshot(manifest)
            except Exception:
                _raise_provider(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "backup manifest input is invalid",
                )
            if type(provided) is dict and type(provided.get("manifestPath")) is str:
                manifest_input = Path(cast(str, provided["manifestPath"])).expanduser()
                captured = read_manifest(manifest_input.resolve(strict=True))
            elif type(provided) is dict:
                captured = provided
            else:
                _raise_provider(
                    "GE_CYCLE_STORE_INVALID_ARGUMENT",
                    operation,
                    "backup manifest input is invalid",
                )

        expected_manifest_keys = {
            "apiVersion",
            "kind",
            "formatVersion",
            "hashAlgorithm",
            "file",
            "provider",
            "semantic",
            "manifestSha256",
        }
        if type(captured) is not dict or set(captured) != expected_manifest_keys:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite backup manifest is corrupt",
            )
        file_document = captured["file"]
        provider_document = captured["provider"]
        semantic_document = captured["semantic"]
        if (
            type(file_document) is not dict
            or set(file_document) != {"bytes", "sha256"}
            or type(provider_document) is not dict
            or set(provider_document)
            != {
                "applicationId",
                "schemaVersion",
                "schemaIdentitySha256",
                "descriptorHash",
                "catalogSha256",
                "lineageId",
                "lineageSha256",
            }
            or type(semantic_document) is not dict
            or set(semantic_document) != {"sha256", "counters"}
        ):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite backup manifest is corrupt",
            )

        def valid_hash(value: object) -> bool:
            return (
                type(value) is str
                and len(value) == 64
                and all(character in "0123456789abcdef" for character in value)
            )

        counter_document = semantic_document["counters"]
        counter_keys = {
            "streams",
            "records",
            "operations",
            "checkpoints",
            "checkpointRevisions",
            "leases",
            "usedLeaseIds",
            "legalHolds",
            "cursors",
            "openCursors",
            "usedMigrationLockIds",
        }

        def valid_counters(value: object) -> bool:
            if type(value) is not dict or set(value) != counter_keys:
                return False
            if any(
                type(counter) is not int
                or counter < 0
                or counter > MAX_SAFE_INTEGER
                for counter in value.values()
            ):
                return False
            open_cursors = value["openCursors"]
            cursors = value["cursors"]
            return (
                type(open_cursors) is int
                and type(cursors) is int
                and open_cursors <= cursors
            )

        if (
            captured["apiVersion"] != SQLITE_BACKUP_MANIFEST_API_VERSION
            or captured["kind"] != "SQLiteCycleStoreBackupManifest"
            or captured["formatVersion"] != 1
            or captured["hashAlgorithm"] != "sha256"
            or type(file_document["bytes"]) is not int
            or file_document["bytes"] < 1
            or file_document["bytes"] > MAX_SAFE_INTEGER
            or not valid_hash(file_document["sha256"])
            or provider_document["applicationId"]
            != SQLITE_CYCLE_STORE_APPLICATION_ID
            or provider_document["schemaVersion"]
            != SQLITE_CYCLE_STORE_SCHEMA_VERSION
            or provider_document["schemaIdentitySha256"]
            != SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256
            or provider_document["descriptorHash"]
            != SQLITE_CYCLE_STORE_DESCRIPTOR_HASH
            or provider_document["catalogSha256"]
            != SQLITE_CYCLE_STORE_CATALOG_SHA256
            or provider_document["lineageId"]
            not in ("fresh-v1-baseline", "alpha-v0-to-v1")
            or not valid_hash(provider_document["lineageSha256"])
            or not valid_hash(semantic_document["sha256"])
            or not valid_counters(counter_document)
            or not valid_hash(captured["manifestSha256"])
        ):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite backup manifest is corrupt",
            )
        manifest_body = cast(
            JsonObject,
            {key: value for key, value in captured.items() if key != "manifestSha256"},
        )
        calculated_manifest_hash = hashlib.sha256(
            SQLITE_BACKUP_MANIFEST_DOMAIN.encode("utf-8")
            + canonical_bytes(manifest_body)
        ).hexdigest()
        if captured["manifestSha256"] != calculated_manifest_hash:
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite backup manifest identity is corrupt",
            )
        try:
            source_size = source_path.stat().st_size
            source_hash = _file_sha256(source_path)
        except OSError:
            _raise_provider(
                "GE_CYCLE_STORE_PERMISSION_DENIED",
                operation,
                "SQLite restore source is unavailable",
            )
        if (
            file_document["bytes"] != source_size
            or file_document["sha256"] != source_hash
        ):
            _raise_provider(
                "GE_CYCLE_STORE_CORRUPTION",
                operation,
                "SQLite backup content identity is corrupt",
            )

        restore_provider_options = {
            **provider_options,
            "_observe_initial_clock": False,
        }
        source = cls(source_path, **restore_provider_options)
        try:
            integrity = await source.audit_integrity("semantic")
            if (
                integrity["semanticSha256"] != semantic_document["sha256"]
                or integrity["counters"] != counter_document
                or integrity["lineageId"] != provider_document["lineageId"]
                or integrity["lineageSha256"] != provider_document["lineageSha256"]
                or integrity["descriptorHash"] != provider_document["descriptorHash"]
                or integrity["schemaIdentitySha256"]
                != provider_document["schemaIdentitySha256"]
                or integrity["catalogSha256"] != provider_document["catalogSha256"]
            ):
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite backup semantic identity drifted",
                )
            async with source._operation_lock:
                source._ensure_open(operation)
                loop = asyncio.get_running_loop()
                restored_report = cast(
                    JsonObject,
                    await loop.run_in_executor(
                        source._executor,
                        source._backup_sync,
                        destination_path,
                        (
                            source_size,
                            source_hash,
                            cast(str, semantic_document["sha256"]),
                            cast(JsonObject, counter_document),
                        ),
                    ),
                )
            restored_integrity = restored_report["integrity"]
            if (
                type(restored_integrity) is not dict
                or restored_integrity["semanticSha256"] != semantic_document["sha256"]
                or restored_integrity["counters"] != counter_document
            ):
                _raise_provider(
                    "GE_CYCLE_STORE_CORRUPTION",
                    operation,
                    "SQLite restored semantic identity drifted",
                )
        finally:
            await source.close()
        return cls(destination_path, **restore_provider_options)
