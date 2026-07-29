import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
  MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
  MIN_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
  SQLITE_CURSOR_COUNT_MARKER_SQL,
  SQLITE_CURSOR_EVENT_LOOKUP_SQL,
  SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
  SQLITE_CURSOR_PRE_REBIND_RULE_ORDER,
  SQLITE_CURSOR_ROW_RULES,
  SQLITE_CURSOR_SOURCE_QUERY,
  SQLITE_CURSOR_STAGE_INSERT_SQL,
  SQLITE_CURSOR_STAGE_SEAL_SQL,
} from "../src/cursor-pre-rebind-contract.js";
import { SQLiteCursorSealAccumulator } from "../src/operation-baseline-cursor-invariants.js";
import { inspectSQLiteCursorRow } from "../src/operation-baseline-cursor-inspection.js";
import {
  acceptsSQLiteCursorQueryPlan,
  sqliteCursorInventoryMarkerBindings,
} from "../src/operation-baseline-cursor-campaign.js";

interface Fixture {
  readonly resourceLimits: {
    readonly diagnosticDefault: number;
    readonly diagnosticMinimum: number;
    readonly diagnosticMaximum: number;
  };
  readonly ruleOrder: readonly string[];
  readonly sqlContract: {
    readonly source: { readonly sql: string; readonly sha256: string };
    readonly insert: { readonly sql: string; readonly sha256: string };
    readonly seal: { readonly sql: string; readonly sha256: string };
    readonly countMarker: { readonly sql: string; readonly sha256: string };
    readonly eventLookup: { readonly sql: string; readonly sha256: string };
    readonly checkpointLookup: { readonly sql: string; readonly sha256: string };
    readonly rowMarkers: readonly { readonly ruleId: string; readonly flag: string; readonly sha256: string }[];
  };
  readonly literalRows: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly semanticVectors: readonly {
    readonly name: string;
    readonly sourceRows: readonly string[];
    readonly eventHistory: readonly Readonly<Record<string, unknown>>[];
    readonly checkpointPutHistory: readonly Readonly<Record<string, unknown>>[];
    readonly clocks: { readonly providerHighWaterAtMs: number };
    readonly identities: { readonly descriptorHash: string; readonly schemaIdentitySha256: string };
    readonly expected: { readonly cursorCount: number; readonly immutableRootSha256: string; readonly vector: readonly number[] };
  }[];
}

const fixture = JSON.parse(readFileSync(
  new URL("../../../spec/conformance/sqlite-cursor-pre-rebind-v1.case.json", import.meta.url),
  "utf8",
)) as Fixture;
const normalize = (sql: string): string => sql.trim().replace(/[\t\n\v\f\r ]+/gu, " ");
const digest = (sql: string): string => createHash("sha256").update(normalize(sql)).digest("hex");
const physical = (row: Readonly<Record<string, unknown>>): unknown[] => [
  row["tenant_id"], row["token_hash"], row["kind"], row["principal_hash"],
  row["authorization_hash"], row["stream_id"], row["checkpoint_scope"],
  Buffer.from(String(row["request_scope_blob_utf8"])), BigInt(row["page_size"] as number),
  BigInt(row["next_position"] as number), row["snapshot_tail_sequence"] === null
    ? null : BigInt(row["snapshot_tail_sequence"] as number),
  row["snapshot_tail_record_hash"], row["descriptor_hash"],
  row["schema_identity_sha256"], Buffer.from(String(row["snapshot_blob_utf8"])),
  BigInt(row["created_at_ms"] as number), BigInt(row["expires_at_ms"] as number),
  row["consumed_at_ms"] === null ? null : BigInt(row["consumed_at_ms"] as number),
];

describe("SQLite cursor pre-rebind generated contract", () => {
  it("keeps the B2 reachable production path free of prohibited collection APIs", () => {
    for (const name of [
      "operation-baseline-cursor-campaign.ts",
      "operation-baseline-cursor-stage-ownership.ts",
      "operation-baseline-cooperation.ts",
      "operation-baseline-stage.ts",
    ]) {
      const source = readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
      for (const prohibited of [".all()", "Array.from", ".sort("]) {
        expect(source, `${name}:${prohibited}`).not.toContain(prohibited);
      }
    }
  });

  it("binds rule order, limits, SQL and normalized hashes to the fixture", () => {
    expect([
      MIN_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
      DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
      MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
    ]).toEqual([
      fixture.resourceLimits.diagnosticMinimum,
      fixture.resourceLimits.diagnosticDefault,
      fixture.resourceLimits.diagnosticMaximum,
    ]);
    expect(SQLITE_CURSOR_PRE_REBIND_RULE_ORDER).toEqual(fixture.ruleOrder);
    const pairs = [
      [SQLITE_CURSOR_SOURCE_QUERY, fixture.sqlContract.source],
      [SQLITE_CURSOR_STAGE_INSERT_SQL, fixture.sqlContract.insert],
      [SQLITE_CURSOR_STAGE_SEAL_SQL, fixture.sqlContract.seal],
      [SQLITE_CURSOR_COUNT_MARKER_SQL, fixture.sqlContract.countMarker],
      [SQLITE_CURSOR_EVENT_LOOKUP_SQL, fixture.sqlContract.eventLookup],
      [SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL, fixture.sqlContract.checkpointLookup],
    ] as const;
    for (const [sql, expected] of pairs) {
      expect(normalize(sql)).toBe(expected.sql);
      expect(digest(sql)).toBe(expected.sha256);
    }
    expect(SQLITE_CURSOR_ROW_RULES.map(({ ruleId, flag }) => ({ ruleId, flag })))
      .toEqual(fixture.sqlContract.rowMarkers.map(({ ruleId, flag }) => ({ ruleId, flag })));
    expect(SQLITE_CURSOR_ROW_RULES.map(({ sql }) => digest(sql)))
      .toEqual(fixture.sqlContract.rowMarkers.map(({ sha256 }) => sha256));
  });

  it.each(fixture.semanticVectors.map((vector) => {
    const caseId = ({
      empty: "empty",
      "event-empty": "event-empty-tail",
      "event-nonempty": "event-nonempty-tail",
      checkpoint: "checkpoint-historical-put",
      "cross-order": "event-checkpoint-cross-order",
    } as const)[vector.name];
    return [`recomputes literal semantic vector ${vector.name} [b2:${caseId}]`, vector] as const;
  }))("%s", (_title, vector) => {
      const inspected = vector.sourceRows.map((name) => inspectSQLiteCursorRow(
        physical(fixture.literalRows[name]!),
        {
          sourceOrdinal: vector.sourceRows.indexOf(name) + 1,
          sourceDescriptorHash: vector.identities.descriptorHash,
          sourceSchemaIdentitySha256: vector.identities.schemaIdentitySha256,
          providerHighWaterAtMs: vector.clocks.providerHighWaterAtMs,
          eventTailExists: (tenantId, streamId, sequence, recordHash) =>
            vector.eventHistory.some((row) => row["tenant_id"] === tenantId
              && row["stream_id"] === streamId && row["sequence"] === sequence
              && row["record_hash"] === recordHash),
          checkpointPutExists: (tenantId, scope, checkpointId, summaryBlob) =>
            vector.checkpointPutHistory.some((row) => row["tenant_id"] === tenantId
              && row["checkpoint_scope"] === scope && row["checkpoint_id"] === checkpointId
              && row["action"] === "put"
              && row["summary_blob_utf8"] === summaryBlob.toString("utf8")),
        },
      ));
      expect(inspected.map((item) => item.stageValues.slice(20, 29)))
        .toEqual(inspected.map(() => Array(9).fill(1)));
      const ordered = inspected.map((item) => item.sealRow!).sort((left, right) =>
        Buffer.compare(Buffer.from(left.carrier.tokenHash), Buffer.from(right.carrier.tokenHash))
          || Buffer.compare(Buffer.from(left.carrier.tenantId), Buffer.from(right.carrier.tenantId)));
      const accumulator = new SQLiteCursorSealAccumulator(
        vector.expected.cursorCount,
        vector.identities.descriptorHash,
        vector.identities.schemaIdentitySha256,
      );
      for (const row of ordered) accumulator.append(row);
      expect(accumulator.finish().immutableRootSha256).toBe(vector.expected.immutableRootSha256);
      expect(vector.expected.vector).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("keeps captured/source and source/TEMP Rule7 comparisons independent", () => {
    expect(sqliteCursorInventoryMarkerBindings(5, 4, 4, 16))
      .toEqual([5, 4, 4, 4, 17]);
  });

  it("accepts only the closed portable EQP shapes and exact statement targets", () => {
    const accepted = [
      ["source", SQLITE_CURSOR_SOURCE_QUERY, ["SCAN main.ge_cycle_cursors"]],
      ["event-lookup", SQLITE_CURSOR_EVENT_LOOKUP_SQL, [
        "SEARCH main.ge_cycle_records USING COVERING INDEX ge_cycle_records_stream_sequence_hash_uq (tenant_id=? AND stream_id=? AND sequence=? AND record_hash=?)",
      ]],
      ["checkpoint-lookup", SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL, [
        "SEARCH main.ge_cycle_checkpoint_revisions USING INDEX ge_cycle_checkpoint_revisions_lookup_idx (tenant_id=? AND checkpoint_scope=? AND checkpoint_id=?)",
      ]],
      ["stage-insert", SQLITE_CURSOR_STAGE_INSERT_SQL, []],
      ["count-marker", SQLITE_CURSOR_COUNT_MARKER_SQL, ["SCAN CONSTANT ROW"]],
      ["row-marker", SQLITE_CURSOR_ROW_RULES[0]!.sql, ["SCAN temp.ge_blr_cursor_seal"]],
      ["stage-seal", SQLITE_CURSOR_STAGE_SEAL_SQL, ["SCAN temp.ge_blr_cursor_seal"]],
    ] as const;
    for (const [kind, sql, details] of accepted) {
      expect(acceptsSQLiteCursorQueryPlan(kind, sql, details)).toBe(true);
    }

    expect(acceptsSQLiteCursorQueryPlan("source", SQLITE_CURSOR_SOURCE_QUERY,
      ["SCAN main.ge_cycle_cursors", "SEARCH main.ge_cycle_schema USING PRIMARY KEY"]))
      .toBe(false);
    expect(acceptsSQLiteCursorQueryPlan("source", SQLITE_CURSOR_SOURCE_QUERY,
      ["SCAN main.ge_cycle_records"])).toBe(false);
    expect(acceptsSQLiteCursorQueryPlan("source", SQLITE_CURSOR_SOURCE_QUERY,
      ["SCAN main.ge_cycle_cursors", "USE TEMP B-TREE FOR ORDER BY"])).toBe(false);
    expect(acceptsSQLiteCursorQueryPlan("event-lookup", SQLITE_CURSOR_EVENT_LOOKUP_SQL,
      ["SEARCH main.ge_cycle_records USING INDEX ge_cycle_records_stream_sequence_hash_uq (tenant_id=?)"]))
      .toBe(false);
    expect(acceptsSQLiteCursorQueryPlan("event-lookup", SQLITE_CURSOR_EVENT_LOOKUP_SQL,
      ["SEARCH main.ge_cycle_records USING COVERING INDEX ge_cycle_records_range_idx (tenant_id=? AND stream_id=? AND sequence=?)"]))
      .toBe(false);
    expect(acceptsSQLiteCursorQueryPlan("checkpoint-lookup",
      SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
      ["SCAN main.ge_cycle_checkpoint_revisions USING INDEX ge_cycle_checkpoint_revisions_lookup_idx"]))
      .toBe(false);
    expect(acceptsSQLiteCursorQueryPlan("row-marker", SQLITE_CURSOR_ROW_RULES[0]!.sql,
      ["SCAN temp.some_other_table"])).toBe(false);
    expect(acceptsSQLiteCursorQueryPlan("stage-insert", SQLITE_CURSOR_STAGE_INSERT_SQL,
      ["SCAN CONSTANT ROW"])).toBe(false);
    expect(acceptsSQLiteCursorQueryPlan("stage-insert",
      SQLITE_CURSOR_STAGE_INSERT_SQL.replace("temp.ge_blr_cursor_seal", "main.ge_cycle_cursors"),
      [])).toBe(false);
  });

  it.each([128, 1_024])("streams %i literal carriers without retaining a fleet", (count) => {
    const base = fixture.literalRows["eventEmpty"]!;
    const accumulator = new SQLiteCursorSealAccumulator(
      count, String(base["descriptor_hash"]), String(base["schema_identity_sha256"]),
    );
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      const row = physical(base);
      row[1] = ordinal.toString(16).padStart(64, "0");
      const inspected = inspectSQLiteCursorRow(row, {
        sourceOrdinal: ordinal,
        sourceDescriptorHash: String(base["descriptor_hash"]),
        sourceSchemaIdentitySha256: String(base["schema_identity_sha256"]),
        providerHighWaterAtMs: 1_700_000_100_000,
        eventTailExists: () => true,
        checkpointPutExists: () => true,
      });
      expect(inspected.stageValues.slice(20)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      accumulator.append(inspected.sealRow!);
    }
    expect(accumulator.finish().cursorCount).toBe(count);
  });
});
