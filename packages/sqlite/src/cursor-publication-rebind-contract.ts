/*
 * Fixed, package-private SQL contract for the cursor publication rebind.
 * These literals are anchored by sqlite-cursor-publication-rebind-v2.
 */

export const SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC =
  "UPDATE main.ge_cycle_cursors SET descriptor_hash = ?, schema_identity_sha256 = ? WHERE descriptor_hash = ? AND schema_identity_sha256 = ?" as const;

export const SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC =
  "6fc61b515e758a1e84745af28783f4e9dcee5e76f80f314aa25a08980d2fef91" as const;

export const SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC = Object.freeze([
  "targetDescriptorHash",
  "targetSchemaIdentitySha256",
  "sourceDescriptorHash",
  "sourceSchemaIdentitySha256",
] as const);

export const SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC =
  "SELECT changes() AS affected_rows" as const;

export const SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC =
  "a6ab435eb54879f942436129997f231de19504b11028b55b014fddc2bb42e112" as const;

export const SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_INTRINSIC =
  "SELECT tenant_id, token_hash FROM main.ge_cycle_cursors ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY" as const;
export const SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_SHA256_INTRINSIC =
  "09d1ce669070093fbbf0dfd8ce7e2a7bbfde96d051b3ce9341be85495479ec32" as const;

export const SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_INTRINSIC =
  "SELECT tenant_id, token_hash FROM temp.ge_blr_cursor_seal ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY" as const;
export const SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_SHA256_INTRINSIC =
  "1694ab6fe938203b0d8f6cb72cf82238e89234c21086ff5d224c7de4db7b1266" as const;

export const SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_INTRINSIC =
  "SELECT tenant_id, token_hash, kind, principal_hash, authorization_hash, stream_id, checkpoint_scope, request_scope_blob, page_size, next_position, snapshot_tail_sequence, snapshot_tail_record_hash, descriptor_hash, schema_identity_sha256, snapshot_blob, created_at_ms, expires_at_ms, consumed_at_ms FROM main.ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ? LIMIT 1" as const;
export const SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_SHA256_INTRINSIC =
  "bd056ee55f2bd27eee3277ed7bfee8ae7b7db935edc3cf0937fc8167e2eac342" as const;

/** Exact four-value execution input. SQL and positional order remain module-owned. */
export interface SQLiteCursorPublicationRebindParameters {
  readonly targetDescriptorHash: string;
  readonly targetSchemaIdentitySha256: string;
  readonly sourceDescriptorHash: string;
  readonly sourceSchemaIdentitySha256: string;
}

export type SQLiteCursorPublicationRebindParameterTuple = readonly [
  targetDescriptorHash: string,
  targetSchemaIdentitySha256: string,
  sourceDescriptorHash: string,
  sourceSchemaIdentitySha256: string,
];
