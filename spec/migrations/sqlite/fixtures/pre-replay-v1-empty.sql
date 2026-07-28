-- Graph Engineering SQLite CycleStore schema version 1.
-- Immutable UTF-8/LF repository artifact. Execute only from trusted package bytes.
-- The caller owns BEGIN EXCLUSIVE/COMMIT and inserts the manifest-bound metadata rows.

PRAGMA application_id = 1195724359;
PRAGMA user_version = 1;

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

CREATE TABLE ge_cycle_streams (
  tenant_id TEXT NOT NULL
    CHECK (
      length(tenant_id) BETWEEN 1 AND 128
      AND substr(tenant_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND tenant_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND tenant_id NOT IN ('.', '..')
    ),
  stream_id TEXT NOT NULL
    CHECK (
      length(stream_id) BETWEEN 1 AND 128
      AND substr(stream_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND stream_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND stream_id NOT IN ('.', '..')
    ),
  tail_sequence INTEGER NOT NULL CHECK (tail_sequence BETWEEN -1 AND 9007199254740991),
  tail_record_hash TEXT
    CHECK (
      tail_record_hash IS NULL
      OR (length(tail_record_hash) = 64 AND tail_record_hash NOT GLOB '*[^0-9a-f]*')
    ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms BETWEEN created_at_ms AND 9007199254740991),
  PRIMARY KEY (tenant_id, stream_id),
  CHECK (
    (tail_sequence = -1 AND tail_record_hash IS NULL)
    OR (tail_sequence >= 0 AND tail_record_hash IS NOT NULL)
  ),
  FOREIGN KEY (tenant_id, stream_id, tail_sequence, tail_record_hash)
    REFERENCES ge_cycle_records (tenant_id, stream_id, sequence, record_hash)
    DEFERRABLE INITIALLY DEFERRED
) STRICT, WITHOUT ROWID;

CREATE TABLE ge_cycle_records (
  tenant_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 0 AND 9007199254740991),
  record_id TEXT NOT NULL
    CHECK (
      length(record_id) BETWEEN 1 AND 128
      AND substr(record_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND record_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND record_id NOT IN ('.', '..')
    ),
  previous_record_hash TEXT
    CHECK (
      previous_record_hash IS NULL
      OR (length(previous_record_hash) = 64 AND previous_record_hash NOT GLOB '*[^0-9a-f]*')
    ),
  value_hash TEXT NOT NULL
    CHECK (length(value_hash) = 64 AND value_hash NOT GLOB '*[^0-9a-f]*'),
  value_bytes INTEGER NOT NULL CHECK (value_bytes BETWEEN 1 AND 1048576),
  value_blob BLOB NOT NULL CHECK (length(value_blob) = value_bytes),
  record_hash TEXT NOT NULL
    CHECK (length(record_hash) = 64 AND record_hash NOT GLOB '*[^0-9a-f]*'),
  record_blob BLOB NOT NULL CHECK (length(record_blob) BETWEEN value_bytes AND 2097152),
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (tenant_id, stream_id, sequence),
  FOREIGN KEY (tenant_id, stream_id)
    REFERENCES ge_cycle_streams (tenant_id, stream_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, stream_id, previous_record_hash)
    REFERENCES ge_cycle_records (tenant_id, stream_id, record_hash)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK ((sequence = 0 AND previous_record_hash IS NULL) OR (sequence > 0 AND previous_record_hash IS NOT NULL))
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX ge_cycle_records_tenant_record_id_uq
  ON ge_cycle_records (tenant_id, record_id);
CREATE UNIQUE INDEX ge_cycle_records_tenant_hash_uq
  ON ge_cycle_records (tenant_id, record_hash);
CREATE UNIQUE INDEX ge_cycle_records_stream_hash_uq
  ON ge_cycle_records (tenant_id, stream_id, record_hash);
CREATE UNIQUE INDEX ge_cycle_records_stream_sequence_hash_uq
  ON ge_cycle_records (tenant_id, stream_id, sequence, record_hash);
CREATE INDEX ge_cycle_records_range_idx
  ON ge_cycle_records (tenant_id, stream_id, sequence);

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
  result_blob BLOB NOT NULL CHECK (length(result_blob) BETWEEN 2 AND 16777216),
  result_hash TEXT NOT NULL
    CHECK (length(result_hash) = 64 AND result_hash NOT GLOB '*[^0-9a-f]*'),
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (tenant_id, operation_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX ge_cycle_operations_commit_idx
  ON ge_cycle_operations (tenant_id, committed_at_ms, operation_id);

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

CREATE INDEX ge_cycle_checkpoints_order_idx
  ON ge_cycle_checkpoints (
    tenant_id,
    checkpoint_scope,
    bound_sequence DESC,
    created_at DESC,
    checkpoint_id ASC
  );

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

CREATE INDEX ge_cycle_checkpoint_revisions_lookup_idx
  ON ge_cycle_checkpoint_revisions (tenant_id, checkpoint_scope, checkpoint_id, revision DESC);

CREATE TABLE ge_cycle_leases (
  tenant_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  active_lease_id TEXT,
  active_holder_id TEXT,
  active_lease_epoch INTEGER,
  active_fencing_token INTEGER,
  active_acquired_at_ms INTEGER,
  active_expires_at_ms INTEGER,
  last_lease_epoch INTEGER NOT NULL CHECK (last_lease_epoch BETWEEN 0 AND 9007199254740991),
  last_fencing_token INTEGER NOT NULL CHECK (last_fencing_token BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (tenant_id, stream_id),
  FOREIGN KEY (tenant_id, stream_id)
    REFERENCES ge_cycle_streams (tenant_id, stream_id) ON DELETE RESTRICT,
  CHECK (last_lease_epoch = last_fencing_token),
  CHECK (
    (
      active_lease_id IS NULL
      AND active_holder_id IS NULL
      AND active_lease_epoch IS NULL
      AND active_fencing_token IS NULL
      AND active_acquired_at_ms IS NULL
      AND active_expires_at_ms IS NULL
    )
    OR (
      active_lease_id IS NOT NULL
      AND active_holder_id IS NOT NULL
      AND active_lease_epoch BETWEEN 1 AND 9007199254740991
      AND active_fencing_token BETWEEN 1 AND 9007199254740991
      AND active_acquired_at_ms BETWEEN 0 AND 9007199254740991
      AND active_expires_at_ms > active_acquired_at_ms
      AND active_lease_epoch = last_lease_epoch
      AND active_fencing_token = last_fencing_token
    )
  )
) STRICT, WITHOUT ROWID;

CREATE INDEX ge_cycle_leases_expiry_idx
  ON ge_cycle_leases (active_expires_at_ms, tenant_id, stream_id)
  WHERE active_lease_id IS NOT NULL;

CREATE TABLE ge_cycle_used_lease_ids (
  tenant_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
  fencing_token INTEGER NOT NULL CHECK (fencing_token BETWEEN 1 AND 9007199254740991),
  first_used_at_ms INTEGER NOT NULL CHECK (first_used_at_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (tenant_id, stream_id, lease_id),
  FOREIGN KEY (tenant_id, stream_id)
    REFERENCES ge_cycle_leases (tenant_id, stream_id) ON DELETE RESTRICT,
  CHECK (lease_epoch = fencing_token)
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX ge_cycle_used_lease_ids_fence_uq
  ON ge_cycle_used_lease_ids (tenant_id, stream_id, fencing_token);

CREATE TABLE ge_cycle_legal_holds (
  tenant_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  hold_id TEXT NOT NULL,
  placed_at_ms INTEGER NOT NULL CHECK (placed_at_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (tenant_id, stream_id, hold_id),
  FOREIGN KEY (tenant_id, stream_id)
    REFERENCES ge_cycle_streams (tenant_id, stream_id) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE INDEX ge_cycle_holds_lookup_idx
  ON ge_cycle_legal_holds (tenant_id, stream_id, placed_at_ms, hold_id);

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

CREATE TABLE ge_cycle_migration_lock (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active_lock_id TEXT,
  active_owner_id TEXT,
  active_source_version INTEGER,
  active_target_version INTEGER,
  active_lock_epoch INTEGER,
  active_fencing_token INTEGER,
  active_acquired_at_ms INTEGER,
  active_expires_at_ms INTEGER,
  last_lock_epoch INTEGER NOT NULL CHECK (last_lock_epoch BETWEEN 0 AND 9007199254740991),
  last_fencing_token INTEGER NOT NULL CHECK (last_fencing_token BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK (last_lock_epoch = last_fencing_token),
  CHECK (
    (
      active_lock_id IS NULL
      AND active_owner_id IS NULL
      AND active_source_version IS NULL
      AND active_target_version IS NULL
      AND active_lock_epoch IS NULL
      AND active_fencing_token IS NULL
      AND active_acquired_at_ms IS NULL
      AND active_expires_at_ms IS NULL
    )
    OR (
      active_lock_id IS NOT NULL
      AND active_owner_id IS NOT NULL
      AND active_source_version BETWEEN 1 AND 9007199254740991
      AND active_target_version BETWEEN 2 AND 9007199254740991
      AND active_target_version > active_source_version
      AND active_lock_epoch BETWEEN 1 AND 9007199254740991
      AND active_fencing_token BETWEEN 1 AND 9007199254740991
      AND active_acquired_at_ms BETWEEN 0 AND 9007199254740991
      AND active_expires_at_ms > active_acquired_at_ms
      AND active_lock_epoch = last_lock_epoch
      AND active_fencing_token = last_fencing_token
    )
  )
) STRICT;

CREATE TABLE ge_cycle_used_migration_lock_ids (
  lock_id TEXT PRIMARY KEY
    CHECK (
      length(lock_id) BETWEEN 1 AND 128
      AND substr(lock_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND lock_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND lock_id NOT IN ('.', '..')
    ),
  lock_epoch INTEGER NOT NULL CHECK (lock_epoch BETWEEN 1 AND 9007199254740991),
  fencing_token INTEGER NOT NULL CHECK (fencing_token BETWEEN 1 AND 9007199254740991),
  first_used_at_ms INTEGER NOT NULL CHECK (first_used_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK (lock_epoch = fencing_token)
) STRICT;

CREATE UNIQUE INDEX ge_cycle_used_migration_lock_ids_fence_uq
  ON ge_cycle_used_migration_lock_ids (fencing_token);

-- Frozen empty-but-fully-published version-1 source for the v1-to-v2 edge.
INSERT INTO ge_cycle_schema (
  singleton, current_version, min_reader_version, max_reader_version,
  min_writer_version, max_writer_version, schema_identity_sha256,
  latest_migration_sha256, latest_migration_applied_at_ms,
  provider_descriptor_hash, created_at_ms, updated_at_ms
) VALUES (
  1, 1, 1, 1, 1, 1,
  'f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4',
  'ddf524d8d0fcdde2a862c168c90698538b9197fa24216f0f249b6ea789c48e1c',
  1785110400000,
  '4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe',
  1785110400000,
  1785110400000
);

INSERT INTO ge_cycle_migrations (
  version, previous_version, migration_id, sql_sha256,
  schema_identity_sha256, applied_at_ms, reversibility, postconditions_blob
) VALUES (
  1, 0, 'fresh-v1-baseline',
  'ddf524d8d0fcdde2a862c168c90698538b9197fa24216f0f249b6ea789c48e1c',
  'f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4',
  1785110400000,
  'rebuild-from-verified-backup-only',
  CAST('{"requiredPostconditions":["application-id-matches","user-version-is-1","schema-singleton-is-manifest-bound","migration-ledger-row-is-manifest-bound","all-canonical-tables-are-strict","logical-schema-identity-matches-fresh-v1","foreign-key-check-is-empty","integrity-check-is-ok","alpha-row-counts-are-preserved","stream-heads-match-record-tails","canonical-blobs-and-hashes-are-preserved","checkpoint-revisions-are-seeded","lease-and-migration-fences-are-monotonic","no-v0-or-placeholder-state-remains"]}' AS BLOB)
);

INSERT INTO ge_cycle_migration_lock (
  singleton, active_lock_id, active_owner_id, active_source_version,
  active_target_version, active_lock_epoch, active_fencing_token,
  active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
  last_fencing_token, updated_at_ms
) VALUES (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 1785110400000);
