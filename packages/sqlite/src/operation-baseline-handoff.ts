import { Buffer } from "node:buffer";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  SQLITE_BASELINE_ABORT_ORDERED_HANDOFF,
  SQLITE_BASELINE_BEGIN_ORDERED_HANDOFF,
  SQLITE_BASELINE_COMPLETE_ORDERED_HANDOFF,
  SQLITE_BASELINE_FENCE_ORDERED_HANDOFF,
  SQLITE_BASELINE_ORDERED_HANDOFF_SOURCE,
  SQLITE_BASELINE_REGISTER_ORDERED_HANDOFF_CLEANUP,
  type SQLiteBaselineOrderedHandoffSource,
  type SQLiteBaselineOrderedHandoffStage,
} from "./operation-baseline-cooperation.js";
import {
  BASELINE_ENTRY_KINDS,
  MAX_BASELINE_KEY_BYTES,
  MAX_BASELINE_STATE_BYTES,
  OperationBaselineAccumulator,
  createOperationBaselineId,
  decodeOperationBaselineCanonicalBytes,
  validateOperationBaselineEntryBytes,
  type OperationBaselineEntryKind,
  type OperationBaselineProjectionIdentity,
} from "./operation-baseline.js";
import type { SQLiteV1BaselineSourceSummary } from "./operation-baseline-source.js";
import type { SQLiteBaselineTempStage } from "./operation-baseline-stage.js";
import { sqliteBlob, sqliteRow, sqliteSafeInteger, sqliteText } from "./sqlite-codec.js";
import type { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;
const KIND_RANK = new Map(
  BASELINE_ENTRY_KINDS.map((entryKind, rank) => [entryKind, rank] as const),
);

function corruption(message: string): CycleStoreProviderError {
  return new CycleStoreProviderError(
    "GE_CYCLE_STORE_CORRUPTION",
    OPERATION,
    message,
  );
}

/** Package-private, one-shot ordered reader over a verified TEMP stage. */
export class SQLiteV1BaselineOrderedTempReader {
  readonly #connection: SQLiteConnection;
  readonly #source: SQLiteV1BaselineSourceSummary & SQLiteBaselineOrderedHandoffSource;
  readonly #stage: SQLiteBaselineTempStage & SQLiteBaselineOrderedHandoffStage;
  readonly #binding: ReturnType<SQLiteBaselineOrderedHandoffSource[
    typeof SQLITE_BASELINE_ORDERED_HANDOFF_SOURCE
  ]>;
  readonly #session: object;
  #state: "open" | "complete" | "poisoned" = "open";

  constructor(
    connection: SQLiteConnection,
    summary: SQLiteV1BaselineSourceSummary,
    stage: SQLiteBaselineTempStage,
  ) {
    this.#connection = connection;
    this.#source = summary as SQLiteV1BaselineSourceSummary &
      SQLiteBaselineOrderedHandoffSource;
    this.#stage = stage as SQLiteBaselineTempStage & SQLiteBaselineOrderedHandoffStage;
    this.#binding = this.#source[SQLITE_BASELINE_ORDERED_HANDOFF_SOURCE](
      connection,
      this.#stage,
    );
    stage.assertCommonCounts(this.#binding.countsByKind);
    stage.assertRelationKeyCoverage();
    this.#session = this.#stage[SQLITE_BASELINE_BEGIN_ORDERED_HANDOFF](
      connection,
      this.#binding.expectedEntryCount,
      this.#binding.totalChanges,
      this.#binding.transactionEpoch,
    );
  }

  get state(): "open" | "complete" | "poisoned" {
    if (this.#state === "open" && this.#stage.state !== "open") {
      this.#state = "poisoned";
    }
    return this.#state;
  }

  read(): OperationBaselineProjectionIdentity {
    if (this.#state !== "open") {
      return this.#stage[SQLITE_BASELINE_ABORT_ORDERED_HANDOFF](
        this.#session,
        "SQLite baseline ordered handoff is one-shot",
      );
    }
    const accumulator = new OperationBaselineAccumulator(
      createOperationBaselineId(this.#binding.sourceEnvelope),
      this.#binding.expectedEntryCount,
    );
    const counts = Object.fromEntries(
      BASELINE_ENTRY_KINDS.map((entryKind) => [entryKind, 0]),
    ) as Record<OperationBaselineEntryKind, number>;
    let iterator: Iterator<unknown> | undefined;
    let iteratorFinalized = false;
    const finalizeIterator = (): void => {
      if (iteratorFinalized) return;
      iteratorFinalized = true;
      iterator?.return?.();
    };
    let previousRank = -1;
    let previousKey: Buffer | undefined;
    let primaryFailure: unknown;
    try {
      this.#stage[SQLITE_BASELINE_FENCE_ORDERED_HANDOFF](this.#session);
      iterator = this.#connection.prepare(
        `SELECT kind_rank, entry_kind, key_blob, state_blob
           FROM temp.ge_blr_stage
          ORDER BY kind_rank ASC, key_blob ASC`,
        OPERATION,
      ).iterate()[Symbol.iterator]();
      this.#stage[SQLITE_BASELINE_REGISTER_ORDERED_HANDOFF_CLEANUP](
        this.#session,
        finalizeIterator,
      );
      while (true) {
        this.#stage[SQLITE_BASELINE_FENCE_ORDERED_HANDOFF](this.#session);
        const next = iterator.next();
        this.#stage[SQLITE_BASELINE_FENCE_ORDERED_HANDOFF](this.#session);
        if (next.done) break;
        if (accumulator.entryCount >= this.#binding.expectedEntryCount) {
          throw corruption("SQLite baseline ordered handoff contains an extra row");
        }
        const row = sqliteRow(next.value, 4, OPERATION, "ordered TEMP handoff row");
        const rank = sqliteSafeInteger(
          row[0], 0, BASELINE_ENTRY_KINDS.length - 1, OPERATION, "ordered TEMP kind rank",
        );
        const entryKind = sqliteText(
          row[1], OPERATION, "ordered TEMP entry kind",
        ) as OperationBaselineEntryKind;
        const expectedRank = KIND_RANK.get(entryKind);
        const keyBytes = sqliteBlob(row[2], OPERATION, "ordered TEMP key bytes");
        const stateBytes = sqliteBlob(row[3], OPERATION, "ordered TEMP state bytes");
        if (expectedRank === undefined || rank !== expectedRank
            || rank < previousRank
            || (rank === previousRank
              && previousKey !== undefined
              && Buffer.compare(keyBytes, previousKey) <= 0)) {
          throw corruption("SQLite baseline ordered handoff row order is invalid");
        }
        try {
          validateOperationBaselineEntryBytes(entryKind, keyBytes, stateBytes);
          const canonical = accumulator.append({
            entryKind,
            key: decodeOperationBaselineCanonicalBytes(keyBytes, MAX_BASELINE_KEY_BYTES),
            state: decodeOperationBaselineCanonicalBytes(stateBytes, MAX_BASELINE_STATE_BYTES),
          });
          if (!canonical.keyBytes.equals(keyBytes) || !canonical.stateBytes.equals(stateBytes)) {
            throw corruption("SQLite baseline ordered handoff canonical bytes drifted");
          }
        } catch (error) {
          if (error instanceof CycleStoreProviderError) throw error;
          throw corruption("SQLite baseline ordered handoff row is noncanonical");
        }
        counts[entryKind] += 1;
        previousRank = rank;
        previousKey = Buffer.from(keyBytes);
        this.#stage[SQLITE_BASELINE_FENCE_ORDERED_HANDOFF](this.#session);
      }
      finalizeIterator();
      iterator = undefined;
      this.#stage[SQLITE_BASELINE_REGISTER_ORDERED_HANDOFF_CLEANUP](
        this.#session,
        undefined,
      );
      if (accumulator.entryCount !== this.#binding.expectedEntryCount
          || BASELINE_ENTRY_KINDS.some(
            (entryKind) => counts[entryKind] !== this.#binding.countsByKind[entryKind],
          )) {
        throw corruption("SQLite baseline ordered handoff counts are invalid");
      }
      this.#stage.assertCommonCounts(this.#binding.countsByKind);
      this.#stage.assertRelationKeyCoverage();
      this.#stage[SQLITE_BASELINE_FENCE_ORDERED_HANDOFF](this.#session);
      const identity = accumulator.finish();
      this.#stage[SQLITE_BASELINE_FENCE_ORDERED_HANDOFF](this.#session);
      this.#stage[SQLITE_BASELINE_COMPLETE_ORDERED_HANDOFF](
        this.#session,
        accumulator.entryCount,
      );
      this.#state = "complete";
      return identity;
    } catch (error) {
      primaryFailure = error instanceof CycleStoreProviderError
        ? error
        : corruption("SQLite baseline ordered handoff failed");
      this.#state = "poisoned";
      throw primaryFailure;
    } finally {
      if (this.#state !== "complete") {
        try {
          finalizeIterator();
        } catch {
          // Preserve the authoritative read failure.
        }
        try {
          this.#stage[SQLITE_BASELINE_ABORT_ORDERED_HANDOFF](
            this.#session,
            "SQLite baseline ordered handoff failed",
          );
        } catch (cleanupError) {
          if (primaryFailure === undefined) throw cleanupError;
        }
      }
    }
  }

  /** Early abandonment is terminal and synchronously finalizes an active row iterator. */
  dispose(): void {
    if (this.#state === "complete" || this.#state === "poisoned") return;
    this.#state = "poisoned";
    this.#stage[SQLITE_BASELINE_ABORT_ORDERED_HANDOFF](
      this.#session,
      "SQLite baseline ordered handoff was abandoned",
    );
  }
}

export function readSQLiteV1BaselineOrderedTempProjection(
  connection: SQLiteConnection,
  summary: SQLiteV1BaselineSourceSummary,
  stage: SQLiteBaselineTempStage,
): OperationBaselineProjectionIdentity {
  return new SQLiteV1BaselineOrderedTempReader(connection, summary, stage).read();
}
