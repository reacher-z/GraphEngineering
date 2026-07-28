-- Graph Engineering SQLite CycleStore migration: schema version 1 to 2.
-- Immutable UTF-8/LF repository artifact. Execute only from trusted package bytes.
-- The caller owns BEGIN EXCLUSIVE/COMMIT, baseline construction, and final metadata publication.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE ge_cycle_schema RENAME TO ge_cycle_schema_v1;

CREATE TABLE ge_cycle_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  current_version INTEGER NOT NULL CHECK (current_version = 2),
  min_reader_version INTEGER NOT NULL CHECK (min_reader_version = 2),
  max_reader_version INTEGER NOT NULL CHECK (max_reader_version = 2),
  min_writer_version INTEGER NOT NULL CHECK (min_writer_version = 2),
  max_writer_version INTEGER NOT NULL CHECK (max_writer_version = 2),
  schema_identity_sha256 TEXT NOT NULL
    CHECK (length(schema_identity_sha256) = 64 AND schema_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  latest_migration_sha256 TEXT NOT NULL
    CHECK (length(latest_migration_sha256) = 64 AND latest_migration_sha256 NOT GLOB '*[^0-9a-f]*'),
  latest_migration_applied_at_ms INTEGER NOT NULL
    CHECK (latest_migration_applied_at_ms BETWEEN 0 AND 9007199254740991),
  provider_descriptor_hash TEXT NOT NULL
    CHECK (length(provider_descriptor_hash) = 64 AND provider_descriptor_hash NOT GLOB '*[^0-9a-f]*'),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms BETWEEN created_at_ms AND 9007199254740991)
) STRICT;

INSERT INTO ge_cycle_schema (
  singleton, current_version, min_reader_version, max_reader_version,
  min_writer_version, max_writer_version, schema_identity_sha256,
  latest_migration_sha256, latest_migration_applied_at_ms,
  provider_descriptor_hash, created_at_ms, updated_at_ms
)
SELECT singleton, 2, 2, 2, 2, 2, schema_identity_sha256,
       latest_migration_sha256, latest_migration_applied_at_ms,
       provider_descriptor_hash, created_at_ms, updated_at_ms
  FROM ge_cycle_schema_v1;

DROP TABLE ge_cycle_schema_v1;

DROP INDEX ge_cycle_operations_commit_idx;
ALTER TABLE ge_cycle_operations RENAME TO ge_cycle_operations_v1;

CREATE TABLE ge_cycle_operations (
  tenant_id TEXT NOT NULL
    CHECK (
      length(tenant_id) BETWEEN 1 AND 128
      AND substr(tenant_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND tenant_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND tenant_id NOT IN ('.', '..')
    ),
  operation_id TEXT NOT NULL
    CHECK (
      length(operation_id) BETWEEN 1 AND 128
      AND substr(operation_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND operation_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND operation_id NOT IN ('.', '..')
    ),
  operation_name TEXT NOT NULL
    CHECK (
      operation_name IN (
        'append',
        'save-checkpoint',
        'delete-checkpoint',
        'acquire-lease',
        'renew-lease',
        'release-lease',
        'set-legal-hold',
        'acquire-migration-lock',
        'release-migration-lock'
      )
    ),
  request_hash TEXT NOT NULL
    CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  ledger_format_version INTEGER NOT NULL CHECK (ledger_format_version IN (1, 2)),
  request_blob BLOB CHECK (
    request_blob IS NULL
    OR (typeof(request_blob) = 'blob' AND length(request_blob) BETWEEN 2 AND 17825792)
  ),
  result_blob BLOB NOT NULL CHECK (length(result_blob) BETWEEN 2 AND 16777216),
  result_hash TEXT NOT NULL
    CHECK (length(result_hash) = 64 AND result_hash NOT GLOB '*[^0-9a-f]*'),
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms BETWEEN 0 AND 9007199254740991),
  commit_sequence INTEGER CHECK (commit_sequence BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (tenant_id, operation_id),
  CHECK (
    (ledger_format_version = 1 AND request_blob IS NULL AND commit_sequence IS NULL)
    OR
    (ledger_format_version = 2 AND request_blob IS NOT NULL AND commit_sequence IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE INDEX ge_cycle_operations_commit_idx
  ON ge_cycle_operations (tenant_id, committed_at_ms, operation_id);

CREATE UNIQUE INDEX ge_cycle_operations_sequence_uq
  ON ge_cycle_operations (commit_sequence)
  WHERE ledger_format_version = 2;

CREATE INDEX ge_cycle_operations_replay_idx
  ON ge_cycle_operations (ledger_format_version, commit_sequence)
  WHERE ledger_format_version = 2;

CREATE TABLE ge_cycle_operation_baselines (
  baseline_id TEXT PRIMARY KEY
    CHECK (
      length(baseline_id) BETWEEN 1 AND 128
      AND substr(baseline_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND baseline_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND baseline_id NOT IN ('.', '..')
    ),
  baseline_format_version INTEGER NOT NULL UNIQUE CHECK (baseline_format_version = 1),
  source_application_id INTEGER NOT NULL CHECK (source_application_id = 1195724359),
  source_user_version INTEGER NOT NULL CHECK (source_user_version = 1),
  source_schema_identity_sha256 TEXT NOT NULL
    CHECK (length(source_schema_identity_sha256) = 64 AND source_schema_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_migration_lineage_id TEXT NOT NULL
    CHECK (
      length(source_migration_lineage_id) BETWEEN 1 AND 128
      AND substr(source_migration_lineage_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND source_migration_lineage_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND source_migration_lineage_id NOT IN ('.', '..')
    ),
  source_migration_lineage_sha256 TEXT NOT NULL
    CHECK (length(source_migration_lineage_sha256) = 64 AND source_migration_lineage_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_descriptor_hash TEXT NOT NULL
    CHECK (length(source_descriptor_hash) = 64 AND source_descriptor_hash NOT GLOB '*[^0-9a-f]*'),
  captured_at_ms INTEGER NOT NULL CHECK (captured_at_ms BETWEEN 0 AND 9007199254740991),
  legacy_operation_count INTEGER NOT NULL CHECK (legacy_operation_count BETWEEN 0 AND 9007199254740991),
  entry_count INTEGER NOT NULL CHECK (entry_count BETWEEN 0 AND 9007199254740991),
  first_entry_hash TEXT NOT NULL
    CHECK (length(first_entry_hash) = 64 AND first_entry_hash NOT GLOB '*[^0-9a-f]*'),
  final_entry_hash TEXT NOT NULL
    CHECK (length(final_entry_hash) = 64 AND final_entry_hash NOT GLOB '*[^0-9a-f]*'),
  canonical_projection_sha256 TEXT NOT NULL
    CHECK (length(canonical_projection_sha256) = 64 AND canonical_projection_sha256 NOT GLOB '*[^0-9a-f]*'),
  creation_runtime TEXT NOT NULL
    CHECK (
      length(creation_runtime) BETWEEN 1 AND 64
      AND substr(creation_runtime, 1, 1) GLOB '[A-Za-z0-9]'
      AND creation_runtime NOT GLOB '*[^A-Za-z0-9._/+:-]*'
    ),
  creation_runtime_version TEXT NOT NULL
    CHECK (
      length(creation_runtime_version) BETWEEN 1 AND 64
      AND substr(creation_runtime_version, 1, 1) GLOB '[A-Za-z0-9]'
      AND creation_runtime_version NOT GLOB '*[^A-Za-z0-9._/+:-]*'
    ),
  policy_blob BLOB NOT NULL
    CHECK (typeof(policy_blob) = 'blob' AND length(policy_blob) BETWEEN 2 AND 1048576)
) STRICT, WITHOUT ROWID;

CREATE TABLE ge_cycle_operation_baseline_entries (
  baseline_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 9007199254740991),
  entry_kind TEXT NOT NULL
    CHECK (
      entry_kind IN (
        'schema-envelope',
        'migration-lineage',
        'stream-head',
        'record-identity',
        'checkpoint-current',
        'checkpoint-revision',
        'lease-current',
        'used-lease-identity',
        'legal-hold',
        'migration-lock-current',
        'used-migration-lock-identity',
        'legacy-operation'
      )
    ),
  entry_key_blob BLOB NOT NULL CHECK (typeof(entry_key_blob) = 'blob' AND length(entry_key_blob) BETWEEN 2 AND 4096),
  entry_state_blob BLOB NOT NULL
    CHECK (typeof(entry_state_blob) = 'blob' AND length(entry_state_blob) BETWEEN 2 AND 2097152),
  previous_entry_hash TEXT NOT NULL
    CHECK (length(previous_entry_hash) = 64 AND previous_entry_hash NOT GLOB '*[^0-9a-f]*'),
  entry_hash TEXT NOT NULL
    CHECK (length(entry_hash) = 64 AND entry_hash NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (baseline_id, ordinal),
  FOREIGN KEY (baseline_id)
    REFERENCES ge_cycle_operation_baselines (baseline_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX ge_cycle_operation_baseline_entries_key_uq
  ON ge_cycle_operation_baseline_entries (baseline_id, entry_kind, entry_key_blob);

CREATE UNIQUE INDEX ge_cycle_operation_baseline_entries_hash_uq
  ON ge_cycle_operation_baseline_entries (baseline_id, entry_hash);

CREATE TABLE ge_cycle_operation_sequence (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  baseline_id TEXT NOT NULL UNIQUE,
  last_commit_sequence INTEGER NOT NULL CHECK (last_commit_sequence BETWEEN 0 AND 9007199254740991),
  baseline_captured_at_ms INTEGER NOT NULL CHECK (baseline_captured_at_ms BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL
    CHECK (updated_at_ms BETWEEN baseline_captured_at_ms AND 9007199254740991),
  FOREIGN KEY (baseline_id)
    REFERENCES ge_cycle_operation_baselines (baseline_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

INSERT INTO ge_cycle_operations (
  tenant_id, operation_id, operation_name, request_hash,
  ledger_format_version, request_blob, result_blob, result_hash,
  committed_at_ms, commit_sequence
)
SELECT tenant_id, operation_id, operation_name, request_hash,
       1, NULL, result_blob, result_hash, committed_at_ms, NULL
  FROM ge_cycle_operations_v1;

DROP TABLE ge_cycle_operations_v1;

PRAGMA application_id = 1195724359;
PRAGMA user_version = 2;
