#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(ROOT, "sqlite-cursor-pre-rebind-v1.case.json");
const SCHEMA_PATH = join(ROOT, "sqlite-cursor-pre-rebind-v1.schema.json");

export const RULE_ORDER = Object.freeze([
  "BLR_CURSOR_AUTHORIZATION", "BLR_CURSOR_SCOPE", "BLR_CURSOR_BLOB_CANONICAL",
  "BLR_CURSOR_POSITION", "BLR_CURSOR_EXPIRY_CONSUMPTION",
  "BLR_CURSOR_CATALOG_BINDING", "BLR_CURSOR_SEAL_COUNT", "BLR_CURSOR_SHAPE",
  "BLR_CURSOR_EVENT_BINDING", "BLR_CURSOR_CHECKPOINT_BINDING",
]);
const ROW_RULES = RULE_ORDER.filter((_, index) => index !== 6);
const PRISTINE_NAMES = Object.freeze([
  "empty", "event-empty-tail", "event-nonempty-tail", "checkpoint-historical-put",
  "event-checkpoint-cross-order", "same-token-two-tenants", "page-size-one",
  "page-size-256", "consumed-clock-valid", "expired-locally-valid",
  "later-event-append-allowed", "later-current-checkpoint-mutation-allowed",
]);
const HOSTILE_NAMES = Object.freeze([
  "authorization-malformed", "scope-null-group", "blob-invalid-utf8",
  "position-beyond-snapshot", "provider-clock-regression", "descriptor-substitution",
  "source-stage-count-delta", "storage-class-shape", "event-missing-retained-tail",
  "checkpoint-missing-put", "request-extra-key", "blob-bom", "blob-duplicate-key",
  "blob-noncanonical-order", "blob-over-bound", "page-zero", "page-257",
  "clock-consumed-before-created", "schema-substitution", "event-snapshot-mismatch",
  "checkpoint-sequence-order", "checkpoint-created-order", "checkpoint-id-order",
  "all-rules-nonlexical-input", "equal-count-insert-delete",
  "source-table-ddl-replacement", "source-index-ddl-replacement",
]);
const LIFECYCLE_NAMES = Object.freeze([
  "source-prepare-failure", "source-first-fetch-failure", "source-middle-fetch-failure",
  "source-final-fetch-failure", "source-close-failure", "decode-before-insert-failure",
  "insert-zero-change", "insert-two-changes", "post-source-pre-barrier-mutation",
  "marker-malformed-arity", "marker-malformed-type", "marker-malformed-value",
  "post-diagnostic-mutation", "rule-transition-mutation", "transaction-end",
  "rollback-rebegin", "active-dispose", "closed-connection", "cancel-at-begin",
  "cancel-at-source", "cancel-at-seal", "cancel-at-rule", "cancel-before-complete",
  "cleanup-only-failure", "primary-plus-cleanup", "receipt-clone", "projection-clone",
  "transfer-clone", "second-run", "abandonment", "before-legacy-complete",
]);

export class CursorPreRebindContractError extends Error {
  constructor(code, message) { super(message); this.name = "CursorPreRebindContractError"; this.code = code; }
}
function fail(code, message) { throw new CursorPreRebindContractError(code, message); }
export function normalizeSql(sql) { return sql.trim().replace(/[\t\n\v\f\r ]+/gu, " "); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}
function fixtureDigest(value) {
  const copy = structuredClone(value);
  copy.parityGates.fixtureCanonicalSha256 = "0".repeat(64);
  return sha256(JSON.stringify(canonicalize(copy)));
}

export function parseStrictJson(text) {
  let index = 0;
  const whitespace = () => { while (/[\t\n\r ]/u.test(text[index] ?? "")) index += 1; };
  const string = () => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === "\\") { index += 2; continue; }
      if (text[index++] === '"') return JSON.parse(text.slice(start, index));
    }
    throw new SyntaxError("unterminated JSON string");
  };
  const value = () => {
    whitespace();
    if (text[index] === '{') {
      index += 1; whitespace(); const keys = new Set();
      if (text[index] === '}') { index += 1; return; }
      while (true) {
        whitespace(); if (text[index] !== '"') throw new SyntaxError("JSON object key expected");
        const key = string();
        if (keys.has(key)) throw new CursorPreRebindContractError("GE_CURSOR_B2_DUPLICATE_KEY", `duplicate JSON key ${key}`);
        keys.add(key); whitespace(); if (text[index++] !== ':') throw new SyntaxError("JSON colon expected");
        value(); whitespace(); const token = text[index++];
        if (token === '}') return; if (token !== ',') throw new SyntaxError("JSON object delimiter expected");
      }
    }
    if (text[index] === '[') {
      index += 1; whitespace(); if (text[index] === ']') { index += 1; return; }
      while (true) { value(); whitespace(); const token = text[index++]; if (token === ']') return; if (token !== ',') throw new SyntaxError("JSON array delimiter expected"); }
    }
    if (text[index] === '"') { string(); return; }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(index));
    if (!match) throw new SyntaxError("JSON value expected"); index += match[0].length;
  };
  value(); whitespace(); if (index !== text.length) throw new SyntaxError("trailing JSON data");
  return JSON.parse(text);
}

function u64(value) { const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(value)); return bytes; }
function semanticRoot(rows, literals, domains) {
  const rowDomain = Buffer.from(domains.rowDomain, "utf8");
  const sealDomain = Buffer.from(domains.sealDomain, "utf8");
  let state = createHash("sha256").update(sealDomain).update(Buffer.of(0)).digest();
  const sealRows = [...rows].sort((left, right) => {
    const a = literals[left]; const b = literals[right];
    return Buffer.compare(Buffer.from(a.token_hash), Buffer.from(b.token_hash))
      || Buffer.compare(Buffer.from(a.tenant_id), Buffer.from(b.tenant_id));
  });
  for (const [index, key] of sealRows.entries()) {
    const row = literals[key];
    const request = Buffer.from(row.request_scope_blob_utf8, "utf8");
    const snapshot = Buffer.from(row.snapshot_blob_utf8, "utf8");
    const carrier = {
      authorizationHash: row.authorization_hash, checkpointScope: row.checkpoint_scope,
      consumedAtMs: row.consumed_at_ms, createdAtMs: row.created_at_ms,
      expiresAtMs: row.expires_at_ms, kind: row.kind, nextPosition: row.next_position,
      pageSize: row.page_size, principalHash: row.principal_hash,
      requestScopeBlobSha256: sha256(request), requestScopeByteLength: request.length,
      snapshotBlobSha256: sha256(snapshot), snapshotByteLength: snapshot.length,
      snapshotTailRecordHash: row.snapshot_tail_record_hash,
      snapshotTailSequence: row.snapshot_tail_sequence, streamId: row.stream_id,
      tenantId: row.tenant_id, tokenHash: row.token_hash,
    };
    const bytes = Buffer.from(JSON.stringify(canonicalize(carrier)), "utf8");
    const digest = createHash("sha256").update(rowDomain).update(u64(bytes.length)).update(bytes).digest();
    state = createHash("sha256").update(sealDomain).update(Buffer.of(1)).update(state)
      .update(u64(index + 1)).update(digest).digest();
  }
  return createHash("sha256").update(sealDomain).update(Buffer.of(2)).update(u64(sealRows.length)).update(state).digest("hex");
}
function exactNames(entries, expected, code) {
  const actual = entries.map((entry) => entry.name);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code, "case identity/order drifted");
  if (new Set(actual).size !== actual.length) fail(code, "duplicate case identity");
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors));
const validateShape = ajv.compile(schema);

export function loadCursorPreRebindFixture() {
  return parseStrictJson(readFileSync(FIXTURE_PATH, "utf8"));
}

export function validateCursorPreRebindFixture(value) {
  if (!validateShape(value)) fail("GE_CURSOR_B2_SCHEMA", JSON.stringify(validateShape.errors));
  if (JSON.stringify(value.ruleOrder) !== JSON.stringify(RULE_ORDER)) {
    fail("GE_CURSOR_B2_RULE_ORDER", "rules 1-10 drifted");
  }
  const sqlPairs = [value.sqlContract.source, value.sqlContract.insert,
    value.sqlContract.seal, value.sqlContract.countMarker, value.sqlContract.eventLookup,
    value.sqlContract.checkpointLookup];
  for (const pair of [...sqlPairs, ...value.sqlContract.rowMarkers]) {
    const sql = pair.sql ?? `SELECT 1 AS violation_marker FROM temp.ge_blr_cursor_seal WHERE ${pair.flag} = 0 ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?`;
    if (sha256(normalizeSql(sql)) !== pair.sha256) fail("GE_CURSOR_B2_SQL_HASH", `${pair.flag ?? "fixed"} SQL drifted`);
  }
  if (JSON.stringify(value.sqlContract.rowMarkers.map((entry) => entry.ruleId))
      !== JSON.stringify(ROW_RULES)) fail("GE_CURSOR_B2_MARKER_ORDER", "row marker order drifted");
  if ((value.sqlContract.insert.sql.match(/\?/gu) ?? []).length !== 30) {
    fail("GE_CURSOR_B2_INSERT_ARITY", "TEMP insert must have thirty bindings");
  }
  if (!value.sqlContract.source.sql.includes("ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY")
      || !value.sqlContract.seal.sql.includes("ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY")) {
    fail("GE_CURSOR_B2_SQL_ORDER", "source/seal order drifted");
  }
  exactNames(value.pristineObligations.scenarios, PRISTINE_NAMES, "GE_CURSOR_B2_PRISTINE_ORDER");
  exactNames(value.hostileObligations.scenarios, HOSTILE_NAMES, "GE_CURSOR_B2_HOSTILE_ORDER");
  exactNames(value.lifecycleObligations.scenarios, LIFECYCLE_NAMES, "GE_CURSOR_B2_LIFECYCLE_ORDER");
  if (value.pristineObligations.scenarios.some((entry) => entry.vector.some((count) => count !== 0))) {
    fail("GE_CURSOR_B2_PRISTINE_VECTOR", "pristine vectors must be zero");
  }
  for (let index = 0; index < 10; index += 1) {
    const isolated = value.hostileObligations.scenarios[index];
    if (isolated.outcome !== "diagnosed"
      || isolated.vector.some((count, position) => count !== (position === index ? 1 : 0))) {
      fail("GE_CURSOR_B2_RULE_MATRIX", `isolated rule ${index + 1} drifted`);
    }
  }
  const aggregate = value.hostileObligations.scenarios.find((entry) => entry.name === "all-rules-nonlexical-input");
  if (aggregate.vector.some((count) => count === 0)) fail("GE_CURSOR_B2_RULE_MATRIX", "aggregate must cover all rules");
  const equalCount = value.hostileObligations.scenarios.find((entry) => entry.name === "equal-count-insert-delete");
  if (equalCount.outcome !== "stale-authority" || equalCount.vector.some(Boolean)) {
    fail("GE_CURSOR_B2_EQUAL_COUNT", "equal-count substitution must be stale authority");
  }
  if (value.outcomeContract.diagnosedContainsReceipt || value.outcomeContract.diagnosedContainsRoot
      || !value.outcomeContract.cleanReturnsExactInputReceipt) {
    fail("GE_CURSOR_B2_OUTCOME", "receipt/root outcome boundary drifted");
  }
  const vectorNames = ["empty", "event-empty", "event-nonempty", "checkpoint", "cross-order"];
  if (JSON.stringify(value.semanticVectors.map((entry) => entry.name)) !== JSON.stringify(vectorNames)) {
    fail("GE_CURSOR_B2_SEMANTIC_ORDER", "semantic vector order drifted");
  }
  for (const vector of value.semanticVectors) {
    for (const key of vector.sourceRows) {
      const row = value.literalRows[key];
      for (const blob of [row.request_scope_blob_utf8, row.snapshot_blob_utf8]) {
        const decoded = parseStrictJson(blob);
        if (JSON.stringify(canonicalize(decoded)) !== blob) fail("GE_CURSOR_B2_SEMANTIC_BLOB", `${vector.name} blob is not canonical`);
      }
    }
    if (semanticRoot(vector.sourceRows, value.literalRows, value.carrierContract)
        !== vector.expected.immutableRootSha256) fail("GE_CURSOR_B2_SEMANTIC_ROOT", `${vector.name} root drifted`);
    if (vector.expected.cursorCount !== vector.sourceRows.length || vector.expected.vector.some(Boolean)) {
      fail("GE_CURSOR_B2_SEMANTIC_VECTOR", `${vector.name} count/vector drifted`);
    }
    for (const key of vector.sourceRows) {
      const row = value.literalRows[key];
      const request = parseStrictJson(row.request_scope_blob_utf8);
      const snapshot = parseStrictJson(row.snapshot_blob_utf8);
      if (row.created_at_ms > vector.clocks.providerHighWaterAtMs
          || (row.consumed_at_ms !== null && row.consumed_at_ms > vector.clocks.providerHighWaterAtMs)
          || row.expires_at_ms <= row.created_at_ms
          || vector.clocks.capturedAtMs < vector.clocks.providerHighWaterAtMs
          || vector.clocks.providerHighWaterAtMs < vector.clocks.maximumNonCursorObservedAtMs) {
        fail("GE_CURSOR_B2_SEMANTIC_CLOCK", `${vector.name} clock contract drifted`);
      }
      if (request.pageSize !== row.page_size || request.contractVersion !== "cycle-store-provider/v1alpha1") {
        fail("GE_CURSOR_B2_SEMANTIC_SCOPE", `${vector.name} request scope drifted`);
      }
      if (row.kind === "event") {
        const expected = { exists: row.snapshot_tail_sequence !== -1,
          recordHash: row.snapshot_tail_record_hash, sequence: row.snapshot_tail_sequence };
        if (row.stream_id === null || row.checkpoint_scope !== null || request.streamId !== row.stream_id
            || JSON.stringify(snapshot) !== JSON.stringify(expected)
            || (row.snapshot_tail_sequence === -1 ? row.next_position !== 0
              : row.next_position > row.snapshot_tail_sequence)) {
          fail("GE_CURSOR_B2_SEMANTIC_EVENT", `${vector.name} event binding drifted`);
        }
        if (row.snapshot_tail_sequence !== -1 && !vector.eventHistory.some((history) =>
          history.tenant_id === row.tenant_id && history.stream_id === row.stream_id
          && history.sequence === row.snapshot_tail_sequence
          && history.record_hash === row.snapshot_tail_record_hash)) {
          fail("GE_CURSOR_B2_SEMANTIC_EVENT", `${vector.name} retained event history is absent`);
        }
      } else {
        if (row.stream_id !== null || row.checkpoint_scope === null
            || request.checkpointScope !== row.checkpoint_scope || !Array.isArray(snapshot)
            || row.next_position > snapshot.length) {
          fail("GE_CURSOR_B2_SEMANTIC_CHECKPOINT", `${vector.name} checkpoint binding drifted`);
        }
        for (const summary of snapshot) {
          const bytes = JSON.stringify(canonicalize(summary));
          if (!vector.checkpointPutHistory.some((history) => history.tenant_id === row.tenant_id
            && history.checkpoint_scope === row.checkpoint_scope
            && history.checkpoint_id === summary.checkpointId && history.summary_blob_utf8 === bytes)) {
            fail("GE_CURSOR_B2_SEMANTIC_CHECKPOINT", `${vector.name} historical put is absent`);
          }
        }
      }
    }
  }
  const oldRoots = new Set(Object.values(value.carrierContract.a1AlgorithmVectors));
  for (const vector of value.semanticVectors.slice(1)) {
    if (oldRoots.has(vector.expected.immutableRootSha256)) fail("GE_CURSOR_B2_A1_ONLY_ROOT", "A1-only root reused as B2 semantic root");
  }
  const digest = fixtureDigest(value);
  if (digest !== value.parityGates.fixtureCanonicalSha256) {
    fail("GE_CURSOR_B2_FIXTURE_HASH", "canonical fixture SHA-256 drifted");
  }
  return Object.freeze({
    ok: true, status: value.status, ruleCount: value.ruleOrder.length,
    semanticVectorCount: value.semanticVectors.length,
    pristineObligationCount: value.pristineObligations.scenarios.length,
    hostileObligationCount: value.hostileObligations.scenarios.length,
    lifecycleObligationCount: value.lifecycleObligations.scenarios.length, sqlContractCount: 15,
    fixtureCanonicalSha256: digest, implementationClaim: false, protocolClaim: false,
  });
}

export function validateCanonicalCursorPreRebindFixture() {
  return validateCursorPreRebindFixture(loadCursorPreRebindFixture());
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(validateCanonicalCursorPreRebindFixture(), null, 2)}\n`);
}
