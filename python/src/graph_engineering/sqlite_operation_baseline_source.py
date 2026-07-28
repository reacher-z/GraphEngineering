"""Bounded source identity/count capture for a caller-owned SQLite v1 transaction."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import cast

from .canonical import canonical_bytes
from .models import MAX_SAFE_INTEGER, JsonObject, JsonValue
from .portable_json import portable_json_snapshot
from .sqlite_cycle_store import (
    _REQUIRED_MIGRATION_POSTCONDITIONS,
    SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
    _load_migration_assets,
)
from .sqlite_operation_baseline import (
    BASELINE_ENTRY_KINDS,
    BaselineEntryInput,
    BaselineEntryKind,
    capture_baseline_entry,
    validate_baseline_source_envelope,
)


@dataclass(slots=True)
class _IdentityIterationState:
    started: bool = False


@dataclass(frozen=True, slots=True)
class SQLiteV1BaselineSourceSummary:
    """Frozen source summary plus the first bounded family iterator.

    The connection remains caller-owned.  Iteration neither begins nor ends a
    transaction and is deliberately one-shot so migration code cannot hash the
    same captured source twice by accident.
    """

    _source_envelope_bytes: bytes = field(repr=False)
    counts_by_kind: Mapping[BaselineEntryKind, int]
    expected_entry_count: int
    maximum_observed_at_ms: int
    _connection: sqlite3.Connection = field(repr=False)
    _latest_migration_applied_at_ms: int = field(repr=False)
    _identity_iteration_state: _IdentityIterationState = field(
        default_factory=_IdentityIterationState,
        init=False,
        repr=False,
        compare=False,
    )

    @property
    def source_envelope(self) -> JsonObject:
        """Return a detached copy of the captured immutable source identity."""

        return cast(JsonObject, json.loads(self._source_envelope_bytes))

    def iter_identity_entries(self) -> Iterator[BaselineEntryInput]:
        """Yield schema, migration-lineage, and migration-lock entries once."""

        if self._identity_iteration_state.started:
            raise ValueError("SQLite v1 baseline identity iterator is already consumed")
        if not self._connection.in_transaction:
            raise ValueError("SQLite v1 baseline capture requires an active transaction")
        identity_counts = {
            "schema-envelope": 1,
            "migration-lineage": 1,
            "migration-lock-current": 1,
        }
        if (
            self.expected_entry_count != 3
            or any(self.counts_by_kind[kind] != identity_counts.get(kind, 0)
                   for kind in BASELINE_ENTRY_KINDS)
        ):
            raise ValueError(
                "SQLite v1 baseline identity iterator is an incomplete foundation "
                "for a nonempty source"
            )
        self._identity_iteration_state.started = True
        return self._iterate_identity_entries()

    def _iterate_identity_entries(self) -> Iterator[BaselineEntryInput]:
        if not self._connection.in_transaction:
            raise ValueError("SQLite v1 baseline capture requires an active transaction")
        families: tuple[
            tuple[BaselineEntryKind, str, Callable[[object], BaselineEntryInput]], ...
        ] = (
            ("schema-envelope", _SCHEMA_ENTRY_SQL, _schema_entry),
            ("migration-lineage", _MIGRATION_ENTRY_SQL, _migration_entry),
            ("migration-lock-current", _MIGRATION_LOCK_ENTRY_SQL, _migration_lock_entry),
        )
        envelope = self.source_envelope
        for kind, sql, capture in families:
            if not self._connection.in_transaction:
                raise ValueError("SQLite v1 baseline capture requires an active transaction")
            cursor = self._connection.execute(sql)
            emitted = 0
            try:
                while True:
                    if not self._connection.in_transaction:
                        raise ValueError(
                            "SQLite v1 baseline capture requires an active transaction"
                        )
                    rows = cursor.fetchmany(256)
                    if not rows:
                        break
                    for row in rows:
                        emitted += 1
                        try:
                            entry = capture(row)
                            self._reconcile_identity_entry(entry, envelope)
                            yield entry
                        except Exception as error:
                            raise ValueError(
                                f"SQLite v1 baseline {kind} source row is invalid"
                            ) from error
            finally:
                cursor.close()
            if emitted != self.counts_by_kind[kind]:
                raise ValueError(f"SQLite v1 baseline {kind} count changed during capture")

    def _reconcile_identity_entry(
        self,
        entry: BaselineEntryInput,
        envelope: JsonObject,
    ) -> None:
        state = entry.state
        if entry.entry_kind == "schema-envelope":
            if (
                state["schemaIdentitySha256"] != envelope["sourceSchemaIdentitySha256"]
                or state["providerDescriptorHash"] != envelope["sourceDescriptorHash"]
                or state["latestMigrationSha256"]
                != envelope["sourceMigrationLineageSha256"]
                or state["latestMigrationAppliedAtMs"]
                != self._latest_migration_applied_at_ms
            ):
                raise ValueError("captured schema envelope identity drifted")
        elif (
            entry.entry_kind == "migration-lineage"
            and (
                state["migrationId"] != envelope["sourceMigrationLineageId"]
                or state["sqlSha256"] != envelope["sourceMigrationLineageSha256"]
                or state["schemaIdentitySha256"]
                != envelope["sourceSchemaIdentitySha256"]
                or state["appliedAtMs"] != self._latest_migration_applied_at_ms
            )
        ):
            raise ValueError("captured migration lineage identity drifted")


_TABLES: tuple[tuple[BaselineEntryKind, str], ...] = (
    ("schema-envelope", "ge_cycle_schema"),
    ("migration-lineage", "ge_cycle_migrations"),
    ("stream-head", "ge_cycle_streams"),
    ("record-identity", "ge_cycle_records"),
    ("checkpoint-current", "ge_cycle_checkpoints"),
    ("checkpoint-revision", "ge_cycle_checkpoint_revisions"),
    ("lease-current", "ge_cycle_leases"),
    ("used-lease-identity", "ge_cycle_used_lease_ids"),
    ("legal-hold", "ge_cycle_legal_holds"),
    ("migration-lock-current", "ge_cycle_migration_lock"),
    ("used-migration-lock-identity", "ge_cycle_used_migration_lock_ids"),
    ("legacy-operation", "ge_cycle_operations"),
)

_SOURCE_ASSETS = _load_migration_assets()

_MAXIMUM_OBSERVED_SQL = """SELECT max(observed_at_ms) FROM (
 SELECT created_at_ms AS observed_at_ms FROM ge_cycle_schema
 UNION ALL SELECT updated_at_ms FROM ge_cycle_schema
 UNION ALL SELECT latest_migration_applied_at_ms FROM ge_cycle_schema
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
 UNION ALL SELECT consumed_at_ms FROM ge_cycle_cursors WHERE consumed_at_ms IS NOT NULL
 UNION ALL SELECT first_used_at_ms FROM ge_cycle_used_migration_lock_ids
 UNION ALL SELECT updated_at_ms FROM ge_cycle_migration_lock
)"""

_SCHEMA_ENTRY_SQL = """SELECT current_version, min_reader_version,
 max_reader_version, min_writer_version, max_writer_version,
 schema_identity_sha256, latest_migration_sha256,
 latest_migration_applied_at_ms, provider_descriptor_hash, created_at_ms,
 updated_at_ms
 FROM ge_cycle_schema WHERE singleton = 1"""

_MIGRATION_ENTRY_SQL = """SELECT version, previous_version, migration_id,
 sql_sha256, schema_identity_sha256, applied_at_ms, reversibility,
 postconditions_blob
 FROM ge_cycle_migrations ORDER BY CAST(version AS TEXT) COLLATE BINARY"""

_MIGRATION_LOCK_ENTRY_SQL = """SELECT singleton, active_lock_id, active_owner_id,
 active_source_version, active_target_version, active_lock_epoch,
 active_fencing_token, active_acquired_at_ms, active_expires_at_ms,
 last_lock_epoch, last_fencing_token, updated_at_ms
 FROM ge_cycle_migration_lock WHERE singleton = 1"""


def _strict_object(pairs: list[tuple[str, JsonValue]]) -> JsonObject:
    result: JsonObject = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _reject_constant(token: str) -> None:
    raise ValueError(f"invalid JSON constant: {token}")


def _canonical_object_blob(value: object) -> JsonObject:
    if type(value) is not bytes or not 2 <= len(value) <= 1_048_576:
        raise ValueError("canonical object BLOB is outside bounds")
    decoded = json.loads(
        value.decode("utf-8"),
        object_pairs_hook=_strict_object,
        parse_constant=_reject_constant,
    )
    captured = portable_json_snapshot(decoded)
    if type(captured) is not dict or canonical_bytes(captured) != value:
        raise ValueError("canonical object BLOB identity drifted")
    return captured


def _schema_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 11 or values[0] != 1:
        raise ValueError("schema singleton shape drifted")
    return capture_baseline_entry(
        "schema-envelope",
        {"scope": "cycle-store"},
        {
            "createdAtMs": values[9],
            "currentVersion": values[0],
            "latestMigrationAppliedAtMs": values[7],
            "latestMigrationSha256": values[6],
            "maxReaderVersion": values[2],
            "maxWriterVersion": values[4],
            "minReaderVersion": values[1],
            "minWriterVersion": values[3],
            "providerDescriptorHash": values[8],
            "schemaIdentitySha256": values[5],
            "updatedAtMs": values[10],
        },
    )


def _migration_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 8:
        raise ValueError("migration lineage shape drifted")
    postconditions = _canonical_object_blob(values[7])
    if postconditions != {
        "requiredPostconditions": list(_REQUIRED_MIGRATION_POSTCONDITIONS)
    }:
        raise ValueError("migration postconditions drifted")
    return capture_baseline_entry(
        "migration-lineage",
        {"version": values[0]},
        {
            "appliedAtMs": values[5],
            "migrationId": values[2],
            "postconditions": postconditions,
            "previousVersion": values[1],
            "reversibility": values[6],
            "schemaIdentitySha256": values[4],
            "sqlSha256": values[3],
            "version": values[0],
        },
    )


def _migration_lock_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 12:
        raise ValueError("migration lock shape drifted")
    return capture_baseline_entry(
        "migration-lock-current",
        {"singleton": values[0]},
        {
            "activeAcquiredAtMs": values[7],
            "activeExpiresAtMs": values[8],
            "activeFencingToken": values[6],
            "activeLockEpoch": values[5],
            "activeLockId": values[1],
            "activeOwnerId": values[2],
            "activeSourceVersion": values[3],
            "activeTargetVersion": values[4],
            "lastFencingToken": values[10],
            "lastLockEpoch": values[9],
            "singleton": values[0],
            "updatedAtMs": values[11],
        },
    )


def _integer(value: object, label: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum or value > MAX_SAFE_INTEGER:
        raise ValueError(f"SQLite v1 baseline {label} is outside bounds")
    return value


def capture_sqlite_v1_baseline_source_summary(
    connection: sqlite3.Connection,
    *,
    captured_at_ms: int,
) -> SQLiteV1BaselineSourceSummary:
    """Capture source identity and exact family counts without ending the transaction."""

    if not connection.in_transaction:
        raise ValueError("SQLite v1 baseline capture requires an active transaction")
    captured = _integer(captured_at_ms, "capture time")
    application_row = connection.execute("PRAGMA application_id").fetchone()
    if application_row is None or _integer(application_row[0], "application ID") != 1_195_724_359:
        raise ValueError("SQLite v1 baseline application identity is invalid")
    user_version_row = connection.execute("PRAGMA user_version").fetchone()
    if (
        user_version_row is None
        or _integer(user_version_row[0], "user version", 1) != 1
    ):
        raise ValueError("SQLite v1 baseline user version is invalid")
    source = connection.execute(
        """SELECT s.current_version, s.schema_identity_sha256,
                  s.provider_descriptor_hash, m.migration_id, m.sql_sha256,
                  s.latest_migration_applied_at_ms,
                  s.latest_migration_sha256, m.schema_identity_sha256
             FROM ge_cycle_schema AS s
             JOIN ge_cycle_migrations AS m ON m.version = s.current_version
            WHERE s.singleton = 1"""
    ).fetchone()
    if source is None or len(source) != 8 or _integer(source[0], "source version", 1) != 1:
        raise ValueError("SQLite v1 baseline source identity is invalid")
    if not all(type(value) is str for value in (*source[1:5], source[6], source[7])):
        raise ValueError("SQLite v1 baseline source identity is invalid")
    lineage_pair = (source[3], source[4])
    if (
        source[1] != SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256
        or source[2] != SQLITE_CYCLE_STORE_DESCRIPTOR_HASH
        or source[6] != source[4]
        or source[7] != source[1]
        or lineage_pair
        not in {
            ("fresh-v1-baseline", _SOURCE_ASSETS.schema_sql_hash),
            ("alpha-v0-to-v1", _SOURCE_ASSETS.migration_sql_hash),
        }
    ):
        raise ValueError("SQLite v1 baseline frozen source identity is invalid")
    latest_migration_applied_at_ms = _integer(
        source[5], "latest migration applied time"
    )
    envelope = validate_baseline_source_envelope(
        {
            "capturedAtMs": captured,
            "sourceApplicationId": 1_195_724_359,
            "sourceDescriptorHash": source[2],
            "sourceMigrationLineageId": source[3],
            "sourceMigrationLineageSha256": source[4],
            "sourceSchemaIdentitySha256": source[1],
            "sourceUserVersion": 1,
        }
    )
    counts: dict[BaselineEntryKind, int] = {}
    total = 0
    for kind, table in _TABLES:
        row = connection.execute(f"SELECT count(*) FROM {table}").fetchone()
        if row is None:
            raise ValueError("SQLite v1 baseline source count is missing")
        count = _integer(row[0], f"{kind} count")
        total += count
        if total > MAX_SAFE_INTEGER:
            raise ValueError("SQLite v1 baseline total count is outside bounds")
        counts[kind] = count
    if tuple(counts) != BASELINE_ENTRY_KINDS:
        raise AssertionError("baseline source family order drifted")

    maximum_row = connection.execute(_MAXIMUM_OBSERVED_SQL).fetchone()
    lock_row = connection.execute(
        "SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1"
    ).fetchone()
    if maximum_row is None or lock_row is None:
        raise ValueError("SQLite v1 baseline provider clock is missing")
    maximum = _integer(maximum_row[0], "maximum observed time")
    lock_high_water = _integer(lock_row[0], "provider clock high-water")
    if lock_high_water < maximum:
        raise ValueError("SQLite v1 provider clock high-water predates source state")
    if captured < lock_high_water:
        raise ValueError("SQLite v1 baseline capture predates provider clock high-water")
    return SQLiteV1BaselineSourceSummary(
        canonical_bytes(envelope),
        MappingProxyType(counts),
        total,
        maximum,
        connection,
        latest_migration_applied_at_ms,
    )
