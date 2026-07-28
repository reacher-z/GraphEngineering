import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  BASELINE_ENTRY_KINDS,
  type OperationBaselineEntryKind,
  type OperationBaselineSourceEnvelope,
  encodeOperationBaselineSourceEnvelope,
} from "./operation-baseline.js";
import { sqliteRow, sqliteSafeInteger, sqliteText } from "./sqlite-codec.js";
import { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export type SQLiteV1BaselineCounts = Readonly<Record<OperationBaselineEntryKind, number>>;

export interface SQLiteV1BaselineSourceSummary {
  readonly sourceEnvelope: OperationBaselineSourceEnvelope;
  readonly countsByKind: SQLiteV1BaselineCounts;
  readonly expectedEntryCount: number;
  readonly maximumObservedAtMs: number;
}

function fail(message: string): never {
  throw new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

function safeBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > MAX_SAFE_BIGINT) {
    return fail(`SQLite v1 baseline ${label} is outside bounds`);
  }
  return value;
}

function capturedAt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite v1 baseline capture time is outside bounds",
    );
  }
  return value as number;
}

const COUNT_SQL = `SELECT
  (SELECT count(*) FROM ge_cycle_schema),
  (SELECT count(*) FROM ge_cycle_migrations),
  (SELECT count(*) FROM ge_cycle_streams),
  (SELECT count(*) FROM ge_cycle_records),
  (SELECT count(*) FROM ge_cycle_checkpoints),
  (SELECT count(*) FROM ge_cycle_checkpoint_revisions),
  (SELECT count(*) FROM ge_cycle_leases),
  (SELECT count(*) FROM ge_cycle_used_lease_ids),
  (SELECT count(*) FROM ge_cycle_legal_holds),
  (SELECT count(*) FROM ge_cycle_migration_lock),
  (SELECT count(*) FROM ge_cycle_used_migration_lock_ids),
  (SELECT count(*) FROM ge_cycle_operations)`;

const MAXIMUM_OBSERVED_SQL = `SELECT max(observed_at_ms) FROM (
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
)`;

/** Capture bounded source identity/count evidence inside a caller-owned transaction. */
export function captureSQLiteV1BaselineSourceSummary(
  connection: SQLiteConnection,
  capturedAtMs: number,
): SQLiteV1BaselineSourceSummary {
  if (!connection.isTransaction) return fail("SQLite v1 baseline capture requires an active transaction");
  const captured = capturedAt(capturedAtMs);
  const applicationId = sqliteSafeInteger(
    sqliteRow(connection.prepare("PRAGMA application_id", OPERATION).get(), 1, OPERATION, "application ID")[0],
    1195724359,
    1195724359,
    OPERATION,
    "application ID",
  );
  const source = sqliteRow(connection.prepare(`
    SELECT schema_row.current_version, schema_row.schema_identity_sha256,
           schema_row.provider_descriptor_hash, migration.migration_id,
           migration.sql_sha256
      FROM ge_cycle_schema AS schema_row
      JOIN ge_cycle_migrations AS migration
        ON migration.version = schema_row.current_version
     WHERE schema_row.singleton = 1
  `, OPERATION).get(), 5, OPERATION, "v1 source identity");
  const sourceUserVersion = sqliteSafeInteger(source[0], 1, 1, OPERATION, "source version");
  const sourceEnvelope: OperationBaselineSourceEnvelope = {
    capturedAtMs: captured,
    sourceApplicationId: applicationId as 1195724359,
    sourceDescriptorHash: sqliteText(source[2], OPERATION, "source descriptor hash"),
    sourceMigrationLineageId: sqliteText(source[3], OPERATION, "source migration ID"),
    sourceMigrationLineageSha256: sqliteText(source[4], OPERATION, "source migration hash"),
    sourceSchemaIdentitySha256: sqliteText(source[1], OPERATION, "source schema identity"),
    sourceUserVersion: sourceUserVersion as 1,
  };
  encodeOperationBaselineSourceEnvelope(sourceEnvelope);

  const rawCounts = sqliteRow(
    connection.prepare(COUNT_SQL, OPERATION).get(),
    BASELINE_ENTRY_KINDS.length,
    OPERATION,
    "baseline source counts",
  );
  const bigintCounts = rawCounts.map((value, index) => safeBigInt(value, `${BASELINE_ENTRY_KINDS[index]} count`));
  const total = bigintCounts.reduce((sum, value) => sum + value, 0n);
  if (total > MAX_SAFE_BIGINT) return fail("SQLite v1 baseline total count is outside bounds");
  const countsByKind = Object.freeze(Object.fromEntries(
    BASELINE_ENTRY_KINDS.map((kind, index) => [kind, Number(bigintCounts[index])]),
  )) as SQLiteV1BaselineCounts;

  const maximumObservedAtMs = sqliteSafeInteger(
    sqliteRow(connection.prepare(MAXIMUM_OBSERVED_SQL, OPERATION).get(), 1, OPERATION, "provider clock high-water")[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "provider clock high-water",
  );
  const lockHighWater = sqliteSafeInteger(
    sqliteRow(connection.prepare("SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1", OPERATION).get(), 1, OPERATION, "migration lock high-water")[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "migration lock high-water",
  );
  if (lockHighWater < maximumObservedAtMs) return fail("SQLite v1 provider clock high-water predates source state");
  if (captured < lockHighWater) return fail("SQLite v1 baseline capture predates provider clock high-water");
  return Object.freeze({ sourceEnvelope: Object.freeze(sourceEnvelope), countsByKind, expectedEntryCount: Number(total), maximumObservedAtMs });
}
