-- Graph Engineering immediately previous SQLite CycleStore alpha fixture (version 0).
-- This is a deterministic test fixture, not a production bootstrap schema.

PRAGMA foreign_keys = ON;
PRAGMA application_id = 1195724359;
PRAGMA user_version = 0;

BEGIN EXCLUSIVE;

CREATE TABLE ge_cycle_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  current_version INTEGER NOT NULL CHECK (current_version = 0),
  min_reader_version INTEGER NOT NULL CHECK (min_reader_version = 0),
  max_reader_version INTEGER NOT NULL CHECK (max_reader_version = 0),
  min_writer_version INTEGER NOT NULL CHECK (min_writer_version = 0),
  max_writer_version INTEGER NOT NULL CHECK (max_writer_version = 0),
  provider_descriptor_hash TEXT NOT NULL
    CHECK (length(provider_descriptor_hash) = 64 AND provider_descriptor_hash NOT GLOB '*[^0-9a-f]*'),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms BETWEEN created_at_ms AND 9007199254740991)
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
  checkpoint_scope TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  bound_sequence INTEGER NOT NULL CHECK (bound_sequence BETWEEN 0 AND 9007199254740991),
  bound_record_hash TEXT NOT NULL
    CHECK (length(bound_record_hash) = 64 AND bound_record_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  value_hash TEXT NOT NULL
    CHECK (length(value_hash) = 64 AND value_hash NOT GLOB '*[^0-9a-f]*'),
  value_bytes INTEGER NOT NULL CHECK (value_bytes BETWEEN 1 AND 16777216),
  value_blob BLOB NOT NULL CHECK (length(value_blob) = value_bytes),
  checkpoint_blob BLOB NOT NULL CHECK (length(checkpoint_blob) BETWEEN value_bytes AND 17825792),
  summary_blob BLOB NOT NULL CHECK (length(summary_blob) BETWEEN 2 AND 1048576),
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

INSERT INTO ge_cycle_schema VALUES (
  1, 0, 0, 0, 0, 0,
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  1785110400000, 1785110400000
);

INSERT INTO ge_cycle_streams VALUES
  ('tenant-alpha', 'shared-stream', -1, NULL, 1785110400000, 1785110400000),
  ('tenant-beta', 'shared-stream', -1, NULL, 1785110400000, 1785110400000);

INSERT INTO ge_cycle_records VALUES
  (
    'tenant-alpha', 'shared-stream', 0, 'record-0', NULL,
    '8de861b49e284c82baa4cd8efc7fc424b43bda3b71ffc70636d7b5e29e04ab6d', 56,
    X'7b226b696e64223a2263726561746564222c227061796c6f6164223a7b22636f756e74223a312c226c6162656c223a22616c706861227d7d',
    'ee165eea3b071de6fe4e42b915287f65a628d89362285e486e7ec02d8b1128f7',
    X'7b2270726576696f75735265636f726448617368223a6e756c6c2c227265636f726448617368223a2265653136356565613362303731646536666534653432623931353238376636356136323864383933363232383565343836653765633032643862313132386637222c227265636f72644964223a227265636f72642d30222c2273657175656e6365223a302c2276616c7565223a7b226b696e64223a2263726561746564222c227061796c6f6164223a7b22636f756e74223a312c226c6162656c223a22616c706861227d7d2c2276616c75654279746573223a35362c2276616c756548617368223a2238646538363162343965323834633832626161346364386566633766633432346234336264613362373166666337303633366437623565323965303461623664227d',
    1785110400000
  ),
  (
    'tenant-alpha', 'shared-stream', 1, 'record-1',
    'ee165eea3b071de6fe4e42b915287f65a628d89362285e486e7ec02d8b1128f7',
    'e5f5c3c181d2d85c75ae9421eb4c0a313736466173f2cbe1a4fa53c679e45912', 41,
    X'7b226b696e64223a22616476616e636564222c227061796c6f6164223a7b22636f756e74223a327d7d',
    '048ea18fe2375813d839da0d56c1cf13d5f2295b5723bef02926fa2c8438c855',
    X'7b2270726576696f75735265636f726448617368223a2265653136356565613362303731646536666534653432623931353238376636356136323864383933363232383565343836653765633032643862313132386637222c227265636f726448617368223a2230343865613138666532333735383133643833396461306435366331636631336435663232393562353732336265663032393236666132633834333863383535222c227265636f72644964223a227265636f72642d31222c2273657175656e6365223a312c2276616c7565223a7b226b696e64223a22616476616e636564222c227061796c6f6164223a7b22636f756e74223a327d7d2c2276616c75654279746573223a34312c2276616c756548617368223a2265356635633363313831643264383563373561653934323165623463306133313337333634363631373366326362653161346661353363363739653435393132227d',
    1785110401000
  ),
  (
    'tenant-beta', 'shared-stream', 0, 'record-0', NULL,
    '8de861b49e284c82baa4cd8efc7fc424b43bda3b71ffc70636d7b5e29e04ab6d', 56,
    X'7b226b696e64223a2263726561746564222c227061796c6f6164223a7b22636f756e74223a312c226c6162656c223a22616c706861227d7d',
    'ee165eea3b071de6fe4e42b915287f65a628d89362285e486e7ec02d8b1128f7',
    X'7b2270726576696f75735265636f726448617368223a6e756c6c2c227265636f726448617368223a2265653136356565613362303731646536666534653432623931353238376636356136323864383933363232383565343836653765633032643862313132386637222c227265636f72644964223a227265636f72642d30222c2273657175656e6365223a302c2276616c7565223a7b226b696e64223a2263726561746564222c227061796c6f6164223a7b22636f756e74223a312c226c6162656c223a22616c706861227d7d2c2276616c75654279746573223a35362c2276616c756548617368223a2238646538363162343965323834633832626161346364386566633766633432346234336264613362373166666337303633366437623565323965303461623664227d',
    1785110400000
  );

UPDATE ge_cycle_streams
SET tail_sequence = 1,
    tail_record_hash = '048ea18fe2375813d839da0d56c1cf13d5f2295b5723bef02926fa2c8438c855',
    updated_at_ms = 1785110401000
WHERE tenant_id = 'tenant-alpha' AND stream_id = 'shared-stream';

UPDATE ge_cycle_streams
SET tail_sequence = 0,
    tail_record_hash = 'ee165eea3b071de6fe4e42b915287f65a628d89362285e486e7ec02d8b1128f7'
WHERE tenant_id = 'tenant-beta' AND stream_id = 'shared-stream';

INSERT INTO ge_cycle_operations VALUES
  (
    'tenant-alpha', 'append-operation-1', 'append',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    X'7b22617070656e6465645265636f726473223a322c227461696c223a7b22657869737473223a747275652c227265636f726448617368223a2230343865613138666532333735383133643833396461306435366331636631336435663232393562353732336265663032393236666132633834333863383535222c2273657175656e6365223a317d7d',
    'bba3368c42cea2b7093228b98dd3d44d5a72c078fcced8ebc86d096b56ef8e43',
    1785110401000
  ),
  (
    'tenant-beta', 'release-operation-1', 'release-lease',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    X'7b226c61737446656e63696e67546f6b656e223a312c226c6173744c6561736545706f6368223a312c226c65617365223a6e756c6c2c22737461747573223a2272656c6561736564227d',
    '7d84e46c9d96e96f6f85c2d9a8fc3080e46ada67091cc08a39c35e71471409f4',
    1785110403000
  );

INSERT INTO ge_cycle_checkpoints VALUES (
  'tenant-alpha', 'controller', 'checkpoint-1', 'shared-stream', 1,
  '048ea18fe2375813d839da0d56c1cf13d5f2295b5723bef02926fa2c8438c855',
  '2026-07-27T00:00:02Z',
  'b82e5270697cd8b2b02b336e4fe53e24fc03891fdd756074917e48648c89e34d', 85,
  X'7b22636f6e74726f6c6c6572223a7b22647279526f756e6473223a302c22726f756e64223a327d2c227374617465223a7b226163636570746564223a5b227265636f72642d30222c227265636f72642d31225d7d7d',
  X'7b22626f756e645265636f726448617368223a2230343865613138666532333735383133643833396461306435366331636631336435663232393562353732336265663032393236666132633834333863383535222c22626f756e6453657175656e6365223a312c22636865636b706f696e744964223a22636865636b706f696e742d31222c22636865636b706f696e7453636f7065223a22636f6e74726f6c6c6572222c22637265617465644174223a22323032362d30372d32375430303a30303a30325a222c2273747265616d4964223a227368617265642d73747265616d222c2276616c7565223a7b22636f6e74726f6c6c6572223a7b22647279526f756e6473223a302c22726f756e64223a327d2c227374617465223a7b226163636570746564223a5b227265636f72642d30222c227265636f72642d31225d7d7d2c2276616c75654279746573223a38352c2276616c756548617368223a2262383265353237303639376364386232623032623333366534666535336532346663303338393166646437353630373439313765343836343863383965333464227d',
  X'7b22626f756e645265636f726448617368223a2230343865613138666532333735383133643833396461306435366331636631336435663232393562353732336265663032393236666132633834333863383535222c22626f756e6453657175656e6365223a312c22636865636b706f696e744964223a22636865636b706f696e742d31222c22636865636b706f696e7453636f7065223a22636f6e74726f6c6c6572222c22637265617465644174223a22323032362d30372d32375430303a30303a30325a222c2273747265616d4964223a227368617265642d73747265616d222c2276616c75654279746573223a38352c2276616c756548617368223a2262383265353237303639376364386232623032623333366534666535336532346663303338393166646437353630373439313765343836343863383965333464227d',
  1785110402000
);

INSERT INTO ge_cycle_leases VALUES
  (
    'tenant-alpha', 'shared-stream', 'lease-alpha-2', 'worker-alpha', 2, 2,
    1785110403000, 1785110463000, 2, 2, 1785110403000
  ),
  (
    'tenant-beta', 'shared-stream', NULL, NULL, NULL, NULL,
    NULL, NULL, 1, 1, 1785110403000
  );

INSERT INTO ge_cycle_used_lease_ids VALUES
  ('tenant-alpha', 'shared-stream', 'lease-alpha-1', 1, 1, 1785110401000),
  ('tenant-alpha', 'shared-stream', 'lease-alpha-2', 2, 2, 1785110403000),
  ('tenant-beta', 'shared-stream', 'lease-beta-1', 1, 1, 1785110402000);

INSERT INTO ge_cycle_legal_holds VALUES
  ('tenant-alpha', 'shared-stream', 'hold-1', 1785110404000);

INSERT INTO ge_cycle_migration_lock VALUES (
  1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 2, 2, 1785110404000
);

INSERT INTO ge_cycle_used_migration_lock_ids VALUES
  ('migration-alpha-1', 1, 1, 1785110401000),
  ('migration-alpha-2', 2, 2, 1785110403000);

COMMIT;
