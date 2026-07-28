-- Graph Engineering SQLite CycleStore migration: alpha version 0 to version 1.
-- Immutable UTF-8/LF repository artifact. Execute only from trusted package bytes.
-- Precondition: caller holds BEGIN EXCLUSIVE, foreign_keys=ON, application_id matches,
-- user_version=0, no live migration owner exists, and the v0 semantic audit passed.
-- Postcondition: caller MUST bind the manifest hashes and append ge_cycle_migrations
-- in this same transaction before COMMIT. All-zero hashes below are fail-closed sentinels.

ALTER TABLE ge_cycle_schema RENAME TO ge_cycle_schema_v0;

CREATE TABLE ge_cycle_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  current_version INTEGER NOT NULL CHECK (current_version = 1),
  min_reader_version INTEGER NOT NULL CHECK (min_reader_version = 1),
  max_reader_version INTEGER NOT NULL CHECK (max_reader_version = 1),
  min_writer_version INTEGER NOT NULL CHECK (min_writer_version = 1),
  max_writer_version INTEGER NOT NULL CHECK (max_writer_version = 1),
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
  singleton,
  current_version,
  min_reader_version,
  max_reader_version,
  min_writer_version,
  max_writer_version,
  schema_identity_sha256,
  latest_migration_sha256,
  latest_migration_applied_at_ms,
  provider_descriptor_hash,
  created_at_ms,
  updated_at_ms
)
SELECT
  singleton,
  1,
  1,
  1,
  1,
  1,
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000000',
  updated_at_ms,
  provider_descriptor_hash,
  created_at_ms,
  updated_at_ms
FROM ge_cycle_schema_v0;

DROP TABLE ge_cycle_schema_v0;

CREATE TABLE ge_cycle_migrations (
  version INTEGER PRIMARY KEY CHECK (version BETWEEN 1 AND 9007199254740991),
  previous_version INTEGER NOT NULL CHECK (previous_version BETWEEN 0 AND 9007199254740991),
  migration_id TEXT NOT NULL UNIQUE
    CHECK (
      length(migration_id) BETWEEN 1 AND 128
      AND substr(migration_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND migration_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND migration_id NOT IN ('.', '..')
    ),
  sql_sha256 TEXT NOT NULL UNIQUE
    CHECK (length(sql_sha256) = 64 AND sql_sha256 NOT GLOB '*[^0-9a-f]*'),
  schema_identity_sha256 TEXT NOT NULL
    CHECK (length(schema_identity_sha256) = 64 AND schema_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms BETWEEN 0 AND 9007199254740991),
  reversibility TEXT NOT NULL CHECK (reversibility = 'rebuild-from-verified-backup-only'),
  postconditions_blob BLOB NOT NULL CHECK (length(postconditions_blob) BETWEEN 2 AND 1048576),
  CHECK (version = previous_version + 1)
) STRICT;

ALTER TABLE ge_cycle_checkpoints RENAME TO ge_cycle_checkpoints_v0;
DROP INDEX ge_cycle_checkpoints_order_idx;

CREATE TABLE ge_cycle_checkpoints (
  tenant_id TEXT NOT NULL,
  checkpoint_scope TEXT NOT NULL
    CHECK (
      length(checkpoint_scope) BETWEEN 1 AND 128
      AND substr(checkpoint_scope, 1, 1) GLOB '[A-Za-z0-9]'
      AND checkpoint_scope NOT GLOB '*[^A-Za-z0-9._-]*'
      AND checkpoint_scope NOT IN ('.', '..')
    ),
  checkpoint_id TEXT NOT NULL
    CHECK (
      length(checkpoint_id) BETWEEN 1 AND 128
      AND substr(checkpoint_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND checkpoint_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND checkpoint_id NOT IN ('.', '..')
    ),
  stream_id TEXT NOT NULL,
  bound_sequence INTEGER NOT NULL CHECK (bound_sequence BETWEEN 0 AND 9007199254740991),
  bound_record_hash TEXT NOT NULL
    CHECK (length(bound_record_hash) = 64 AND bound_record_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL
    CHECK (
      length(created_at) BETWEEN 20 AND 17825792
      AND substr(created_at, 1, 4) NOT GLOB '*[^0-9]*'
      AND substr(created_at, 5, 1) = '-'
      AND substr(created_at, 6, 2) NOT GLOB '*[^0-9]*'
      AND substr(created_at, 6, 2) BETWEEN '01' AND '12'
      AND substr(created_at, 8, 1) = '-'
      AND substr(created_at, 9, 2) NOT GLOB '*[^0-9]*'
      AND substr(created_at, 9, 2) BETWEEN '01' AND '31'
      AND substr(created_at, 11, 1) = 'T'
      AND substr(created_at, 12, 2) NOT GLOB '*[^0-9]*'
      AND substr(created_at, 12, 2) BETWEEN '00' AND '23'
      AND substr(created_at, 14, 1) = ':'
      AND substr(created_at, 15, 2) NOT GLOB '*[^0-9]*'
      AND substr(created_at, 15, 2) BETWEEN '00' AND '59'
      AND substr(created_at, 17, 1) = ':'
      AND substr(created_at, 18, 2) NOT GLOB '*[^0-9]*'
      AND substr(created_at, 18, 2) BETWEEN '00' AND '59'
      AND (
        (
          substr(created_at, -1, 1) = 'Z'
          AND (
            length(created_at) = 20
            OR (
              length(created_at) >= 22
              AND substr(created_at, 20, 1) = '.'
              AND substr(created_at, 21, length(created_at) - 21) NOT GLOB '*[^0-9]*'
            )
          )
        )
        OR (
          substr(created_at, -6, 1) IN ('+', '-')
          AND substr(created_at, -5, 2) NOT GLOB '*[^0-9]*'
          AND substr(created_at, -5, 2) BETWEEN '00' AND '23'
          AND substr(created_at, -3, 1) = ':'
          AND substr(created_at, -2, 2) NOT GLOB '*[^0-9]*'
          AND substr(created_at, -2, 2) BETWEEN '00' AND '59'
          AND (
            length(created_at) = 25
            OR (
              length(created_at) >= 27
              AND substr(created_at, 20, 1) = '.'
              AND substr(created_at, 21, length(created_at) - 26) NOT GLOB '*[^0-9]*'
            )
          )
        )
      )
    ),
  value_hash TEXT NOT NULL
    CHECK (length(value_hash) = 64 AND value_hash NOT GLOB '*[^0-9a-f]*'),
  value_bytes INTEGER NOT NULL CHECK (value_bytes BETWEEN 1 AND 16777216),
  value_blob BLOB NOT NULL CHECK (length(value_blob) = value_bytes),
  checkpoint_blob BLOB NOT NULL CHECK (length(checkpoint_blob) BETWEEN value_bytes AND 17825792),
  summary_blob BLOB NOT NULL CHECK (length(summary_blob) BETWEEN 2 AND 1048576),
  checkpoint_revision INTEGER NOT NULL CHECK (checkpoint_revision BETWEEN 1 AND 9007199254740991),
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (tenant_id, checkpoint_scope, checkpoint_id),
  FOREIGN KEY (tenant_id, stream_id)
    REFERENCES ge_cycle_streams (tenant_id, stream_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, stream_id, bound_sequence, bound_record_hash)
    REFERENCES ge_cycle_records (tenant_id, stream_id, sequence, record_hash) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

INSERT INTO ge_cycle_checkpoints (
  tenant_id,
  checkpoint_scope,
  checkpoint_id,
  stream_id,
  bound_sequence,
  bound_record_hash,
  created_at,
  value_hash,
  value_bytes,
  value_blob,
  checkpoint_blob,
  summary_blob,
  checkpoint_revision,
  committed_at_ms
)
SELECT
  tenant_id,
  checkpoint_scope,
  checkpoint_id,
  stream_id,
  bound_sequence,
  bound_record_hash,
  created_at,
  value_hash,
  value_bytes,
  value_blob,
  checkpoint_blob,
  summary_blob,
  ROW_NUMBER() OVER (
    PARTITION BY tenant_id, checkpoint_scope
    ORDER BY created_at ASC, checkpoint_id ASC
  ),
  committed_at_ms
FROM ge_cycle_checkpoints_v0;

CREATE INDEX ge_cycle_checkpoints_order_idx
  ON ge_cycle_checkpoints (
    tenant_id,
    checkpoint_scope,
    bound_sequence DESC,
    created_at DESC,
    checkpoint_id ASC
  );

DROP TABLE ge_cycle_checkpoints_v0;

CREATE TABLE ge_cycle_checkpoint_revisions (
  tenant_id TEXT NOT NULL,
  checkpoint_scope TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  checkpoint_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('put', 'delete')),
  summary_blob BLOB,
  bound_sequence INTEGER,
  bound_record_hash TEXT,
  checkpoint_created_at TEXT,
  value_hash TEXT,
  value_bytes INTEGER,
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (tenant_id, checkpoint_scope, revision),
  CHECK (
    (
      action = 'put'
      AND summary_blob IS NOT NULL
      AND length(summary_blob) BETWEEN 2 AND 1048576
      AND bound_sequence BETWEEN 0 AND 9007199254740991
      AND length(bound_record_hash) = 64
      AND bound_record_hash NOT GLOB '*[^0-9a-f]*'
      AND length(checkpoint_created_at) BETWEEN 20 AND 17825792
      AND substr(checkpoint_created_at, 1, 4) NOT GLOB '*[^0-9]*'
      AND substr(checkpoint_created_at, 5, 1) = '-'
      AND substr(checkpoint_created_at, 6, 2) NOT GLOB '*[^0-9]*'
      AND substr(checkpoint_created_at, 6, 2) BETWEEN '01' AND '12'
      AND substr(checkpoint_created_at, 8, 1) = '-'
      AND substr(checkpoint_created_at, 9, 2) NOT GLOB '*[^0-9]*'
      AND substr(checkpoint_created_at, 9, 2) BETWEEN '01' AND '31'
      AND substr(checkpoint_created_at, 11, 1) = 'T'
      AND substr(checkpoint_created_at, 12, 2) NOT GLOB '*[^0-9]*'
      AND substr(checkpoint_created_at, 12, 2) BETWEEN '00' AND '23'
      AND substr(checkpoint_created_at, 14, 1) = ':'
      AND substr(checkpoint_created_at, 15, 2) NOT GLOB '*[^0-9]*'
      AND substr(checkpoint_created_at, 15, 2) BETWEEN '00' AND '59'
      AND substr(checkpoint_created_at, 17, 1) = ':'
      AND substr(checkpoint_created_at, 18, 2) NOT GLOB '*[^0-9]*'
      AND substr(checkpoint_created_at, 18, 2) BETWEEN '00' AND '59'
      AND (
        (
          substr(checkpoint_created_at, -1, 1) = 'Z'
          AND (
            length(checkpoint_created_at) = 20
            OR (
              length(checkpoint_created_at) >= 22
              AND substr(checkpoint_created_at, 20, 1) = '.'
              AND substr(
                checkpoint_created_at,
                21,
                length(checkpoint_created_at) - 21
              ) NOT GLOB '*[^0-9]*'
            )
          )
        )
        OR (
          substr(checkpoint_created_at, -6, 1) IN ('+', '-')
          AND substr(checkpoint_created_at, -5, 2) NOT GLOB '*[^0-9]*'
          AND substr(checkpoint_created_at, -5, 2) BETWEEN '00' AND '23'
          AND substr(checkpoint_created_at, -3, 1) = ':'
          AND substr(checkpoint_created_at, -2, 2) NOT GLOB '*[^0-9]*'
          AND substr(checkpoint_created_at, -2, 2) BETWEEN '00' AND '59'
          AND (
            length(checkpoint_created_at) = 25
            OR (
              length(checkpoint_created_at) >= 27
              AND substr(checkpoint_created_at, 20, 1) = '.'
              AND substr(
                checkpoint_created_at,
                21,
                length(checkpoint_created_at) - 26
              ) NOT GLOB '*[^0-9]*'
            )
          )
        )
      )
      AND length(value_hash) = 64
      AND value_hash NOT GLOB '*[^0-9a-f]*'
      AND value_bytes BETWEEN 1 AND 16777216
    )
    OR (
      action = 'delete'
      AND summary_blob IS NULL
      AND bound_sequence IS NULL
      AND bound_record_hash IS NULL
      AND checkpoint_created_at IS NULL
      AND value_hash IS NULL
      AND value_bytes IS NULL
    )
  )
) STRICT, WITHOUT ROWID;

INSERT INTO ge_cycle_checkpoint_revisions (
  tenant_id,
  checkpoint_scope,
  revision,
  checkpoint_id,
  action,
  summary_blob,
  bound_sequence,
  bound_record_hash,
  checkpoint_created_at,
  value_hash,
  value_bytes,
  recorded_at_ms
)
SELECT
  tenant_id,
  checkpoint_scope,
  checkpoint_revision,
  checkpoint_id,
  'put',
  summary_blob,
  bound_sequence,
  bound_record_hash,
  created_at,
  value_hash,
  value_bytes,
  committed_at_ms
FROM ge_cycle_checkpoints;

CREATE INDEX ge_cycle_checkpoint_revisions_lookup_idx
  ON ge_cycle_checkpoint_revisions (tenant_id, checkpoint_scope, checkpoint_id, revision DESC);

CREATE TABLE ge_cycle_cursors (
  tenant_id TEXT NOT NULL,
  token_hash TEXT NOT NULL
    CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  kind TEXT NOT NULL CHECK (kind IN ('event', 'checkpoint')),
  principal_hash TEXT NOT NULL
    CHECK (length(principal_hash) = 64 AND principal_hash NOT GLOB '*[^0-9a-f]*'),
  authorization_hash TEXT NOT NULL
    CHECK (length(authorization_hash) = 64 AND authorization_hash NOT GLOB '*[^0-9a-f]*'),
  stream_id TEXT,
  checkpoint_scope TEXT,
  request_scope_blob BLOB NOT NULL CHECK (length(request_scope_blob) BETWEEN 2 AND 1048576),
  page_size INTEGER NOT NULL CHECK (page_size BETWEEN 1 AND 256),
  next_position INTEGER NOT NULL CHECK (next_position BETWEEN 0 AND 9007199254740991),
  snapshot_tail_sequence INTEGER
    CHECK (snapshot_tail_sequence IS NULL OR snapshot_tail_sequence BETWEEN -1 AND 9007199254740991),
  snapshot_tail_record_hash TEXT
    CHECK (
      snapshot_tail_record_hash IS NULL
      OR (length(snapshot_tail_record_hash) = 64 AND snapshot_tail_record_hash NOT GLOB '*[^0-9a-f]*')
    ),
  descriptor_hash TEXT NOT NULL
    CHECK (length(descriptor_hash) = 64 AND descriptor_hash NOT GLOB '*[^0-9a-f]*'),
  schema_identity_sha256 TEXT NOT NULL
    CHECK (length(schema_identity_sha256) = 64 AND schema_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  snapshot_blob BLOB NOT NULL CHECK (length(snapshot_blob) BETWEEN 2 AND 16777216),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms AND expires_at_ms <= 9007199254740991),
  consumed_at_ms INTEGER CHECK (consumed_at_ms IS NULL OR consumed_at_ms BETWEEN created_at_ms AND 9007199254740991),
  PRIMARY KEY (tenant_id, token_hash),
  CHECK (
    (
      kind = 'event'
      AND stream_id IS NOT NULL
      AND checkpoint_scope IS NULL
      AND snapshot_tail_sequence IS NOT NULL
      AND (
        (snapshot_tail_sequence = -1 AND snapshot_tail_record_hash IS NULL)
        OR (snapshot_tail_sequence >= 0 AND snapshot_tail_record_hash IS NOT NULL)
      )
    )
    OR (
      kind = 'checkpoint'
      AND stream_id IS NULL
      AND checkpoint_scope IS NOT NULL
      AND snapshot_tail_sequence IS NULL
      AND snapshot_tail_record_hash IS NULL
    )
  )
) STRICT, WITHOUT ROWID;

CREATE INDEX ge_cycle_cursors_open_idx
  ON ge_cycle_cursors (tenant_id, token_hash, expires_at_ms)
  WHERE consumed_at_ms IS NULL;
CREATE INDEX ge_cycle_cursors_expiry_idx
  ON ge_cycle_cursors (expires_at_ms, tenant_id, token_hash);

PRAGMA application_id = 1195724359;
PRAGMA user_version = 1;
