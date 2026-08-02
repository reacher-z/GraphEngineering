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
