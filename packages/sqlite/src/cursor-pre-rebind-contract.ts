/*
 * GENERATED from spec/conformance/sqlite-cursor-pre-rebind-v1.case.json.
 * Keep this module package-private and bind every literal in tests.
 */

import { SQLITE_CURSOR_MAIN_SOURCE_QUERY } from "./operation-baseline-cursor-ownership.js";

export const DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT = 16;
export const MIN_SQLITE_CURSOR_DIAGNOSTIC_LIMIT = 1;
export const MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT = 64;

export const SQLITE_CURSOR_STAGE_INSERT_SQL = `INSERT INTO temp.ge_blr_cursor_seal (token_hash, tenant_id, kind, principal_hash, authorization_hash, stream_id, checkpoint_scope, request_scope_byte_length, request_scope_blob_sha256, page_size, next_position, snapshot_tail_sequence, snapshot_tail_record_hash, snapshot_byte_length, snapshot_blob_sha256, created_at_ms, expires_at_ms, consumed_at_ms, descriptor_hash, schema_identity_sha256, authorization_ok, scope_ok, blobs_canonical_ok, position_ok, clock_ok, catalog_ok, shape_ok, event_binding_ok, checkpoint_binding_ok, seal_eligible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export const SQLITE_CURSOR_STAGE_SEAL_SQL = `SELECT tenant_id, token_hash, kind, principal_hash, authorization_hash, stream_id, checkpoint_scope, request_scope_byte_length, request_scope_blob_sha256, page_size, next_position, snapshot_tail_sequence, snapshot_tail_record_hash, snapshot_byte_length, snapshot_blob_sha256, created_at_ms, expires_at_ms, consumed_at_ms, descriptor_hash, schema_identity_sha256 FROM temp.ge_blr_cursor_seal WHERE seal_eligible = 1 ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY`;

export const SQLITE_CURSOR_COUNT_MARKER_SQL =
  "SELECT 1 AS violation_marker WHERE ? <> ? OR ? <> ? LIMIT ?";
export const SQLITE_CURSOR_EVENT_LOOKUP_SQL =
  "SELECT 1 AS binding_marker FROM main.ge_cycle_records INDEXED BY ge_cycle_records_stream_sequence_hash_uq WHERE tenant_id = ? AND stream_id = ? AND sequence = ? AND record_hash = ? LIMIT 1";
export const SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL =
  "SELECT 1 AS binding_marker FROM main.ge_cycle_checkpoint_revisions INDEXED BY ge_cycle_checkpoint_revisions_lookup_idx WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ? AND action = 'put' AND summary_blob = ? LIMIT 1";

const FLAGS = [
  ["BLR_CURSOR_AUTHORIZATION", "authorization_ok"],
  ["BLR_CURSOR_SCOPE", "scope_ok"],
  ["BLR_CURSOR_BLOB_CANONICAL", "blobs_canonical_ok"],
  ["BLR_CURSOR_POSITION", "position_ok"],
  ["BLR_CURSOR_EXPIRY_CONSUMPTION", "clock_ok"],
  ["BLR_CURSOR_CATALOG_BINDING", "catalog_ok"],
  ["BLR_CURSOR_SHAPE", "shape_ok"],
  ["BLR_CURSOR_EVENT_BINDING", "event_binding_ok"],
  ["BLR_CURSOR_CHECKPOINT_BINDING", "checkpoint_binding_ok"],
] as const;

export type SQLiteCursorRowRuleId = (typeof FLAGS)[number][0];
export type SQLiteCursorPreRebindRuleId = SQLiteCursorRowRuleId | "BLR_CURSOR_SEAL_COUNT";

export const SQLITE_CURSOR_ROW_RULES = Object.freeze(FLAGS.map(([ruleId, flag]) =>
  Object.freeze({
    ruleId,
    flag,
    sql: `SELECT 1 AS violation_marker FROM temp.ge_blr_cursor_seal WHERE ${flag} = 0 ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?`,
  })));

export const SQLITE_CURSOR_PRE_REBIND_RULE_ORDER = Object.freeze([
  ...SQLITE_CURSOR_ROW_RULES.slice(0, 6).map((rule) => rule.ruleId),
  "BLR_CURSOR_SEAL_COUNT",
  ...SQLITE_CURSOR_ROW_RULES.slice(6).map((rule) => rule.ruleId),
] as readonly SQLiteCursorPreRebindRuleId[]);

export const SQLITE_CURSOR_SOURCE_QUERY = SQLITE_CURSOR_MAIN_SOURCE_QUERY;
