import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Durable operational surface for the CLI.
 *
 * Everything in this module is a strictly read-only projection of a durable
 * JSONL event journal. It opens journal files for reading only, never creates
 * or renames a path, and never appends a record. Commands whose durable
 * behaviour does not exist in this runtime fail closed here rather than
 * emitting a plausible answer; see {@link UNSUPPORTED_OPERATIONS}.
 *
 * Redaction boundary (spec/redaction-semantics.md 1.2): `cli-json` and
 * `cli-diagnostic` are capture sinks. This module never reads, projects, or
 * prints `event.data`, node inputs/outputs, run results, or resolved
 * filesystem paths. Only the closed envelope-metadata allowlist below leaves
 * the process.
 */

/** Event envelope contract this reader understands. */
export const JOURNAL_API_VERSION =
  "graphengineering.reacher-z.github.io/events/v1alpha1" as const;

/** Hard ceiling on a journal file this CLI will read into memory. */
export const MAX_JOURNAL_BYTES = 67_108_864;

/** Default and maximum window for `graph logs`. */
export const DEFAULT_LOG_LIMIT = 200;
export const MAX_LOG_LIMIT = 10_000;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Same safe-identifier grammar the persistence layer enforces for run ids. */
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Closed v1alpha1 event-type vocabulary, in contract declaration order. */
export const JOURNAL_EVENT_TYPES = [
  "RunCreated",
  "RunStarted",
  "RunPaused",
  "RunResumed",
  "GraphPatched",
  "NodeScheduled",
  "NodeStarted",
  "NodeAttemptFailed",
  "NodeSettledWithoutAttempt",
  "NodeRetried",
  "NodeSucceeded",
  "EdgeEmitted",
  "BarrierSatisfied",
  "RouteSelected",
  "VerificationRecorded",
  "BudgetUpdated",
  "ArtifactCreated",
  "HumanInputRequested",
  "HumanInputReceived",
  "RunCancelled",
  "RunFailed",
  "RunSucceeded",
] as const;

const EVENT_TYPE_SET = new Set<string>(JOURNAL_EVENT_TYPES);

const ENVELOPE_KEYS = new Set([
  "apiVersion",
  "eventId",
  "type",
  "timestamp",
  "runId",
  "graphRevision",
  "sequence",
  "traceId",
  "spanId",
  "parentSpanId",
  "nodeId",
  "edgeId",
  "attempt",
  "payloadHash",
  "artifactRef",
  "redacted",
  "data",
]);

const REQUIRED_KEYS = [
  "apiVersion",
  "eventId",
  "type",
  "timestamp",
  "runId",
  "graphRevision",
  "sequence",
  "data",
] as const;

const OPTIONAL_STRING_KEYS = [
  "traceId",
  "spanId",
  "parentSpanId",
  "nodeId",
  "edgeId",
  "payloadHash",
  "artifactRef",
] as const;

/** The projection this CLI is allowed to emit for one journal record. */
export interface JournalEntry {
  readonly sequence: number;
  readonly type: string;
  readonly timestamp: string;
  readonly graphRevision: number;
  readonly nodeId: string | null;
  readonly edgeId: string | null;
  readonly attempt: number | null;
  readonly redacted: boolean;
}

export type RunStatus =
  | "created"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

export type OperationFailureCode =
  | "GECLI_RUN_ID_INVALID"
  | "GECLI_STORE_UNREADABLE"
  | "GECLI_HISTORY_UNREADABLE"
  | "GECLI_HISTORY_TOO_LARGE"
  | "GECLI_RUN_NOT_FOUND"
  | "GECLI_HISTORY_MALFORMED"
  | "GECLI_UNSUPPORTED_CAPABILITY";

/** A read failure carrying only run identity and a record ordinal. */
export class OperationError extends Error {
  readonly code: OperationFailureCode;
  readonly runId: string;
  readonly record: number | null;

  constructor(
    code: OperationFailureCode,
    message: string,
    runId: string,
    record: number | null = null,
  ) {
    super(message);
    this.name = "OperationError";
    this.code = code;
    this.runId = runId;
    this.record = record;
  }
}

/**
 * Fail-closed operational commands.
 *
 * Each entry names the durable capability the command would need. None of them
 * exist in this runtime, so the command refuses before it reads or writes
 * anything. A stub that returned a plausible envelope would be a false claim.
 */
export const UNSUPPORTED_OPERATIONS = {
  cancel: {
    capability: "durable.run-cancellation",
    message:
      "graph cancel requires out-of-band durable run cancellation: the v1alpha1 " +
      "journal has no cancellation-request record, and a terminal RunCancelled " +
      "record may only be written by the scheduler that owns the run",
  },
  resume: {
    capability: "durable.run-resume",
    message:
      "graph resume requires a durable run lease and a node executor registry: " +
      "the CLI never executes graph nodes, and resuming without executors would " +
      "durably fail every remaining node",
  },
  replay: {
    capability: "durable.run-replay",
    message:
      "graph replay requires durable replay, which this runtime does not implement",
  },
  fork: {
    capability: "durable.run-fork",
    message:
      "graph fork requires durable run forking, which this runtime does not implement",
  },
  retry: {
    capability: "durable.node-retry",
    message:
      "graph retry requires durable node-level retry scheduling, which this " +
      "runtime does not implement",
  },
} as const;

export type UnsupportedOperationName = keyof typeof UNSUPPORTED_OPERATIONS;

/** Constant honesty marker attached to every operational data envelope. */
function redactionBlock(): Record<string, unknown> {
  return {
    sink: "cli-json",
    eventDataEmitted: false,
    payloadsEmitted: false,
    pathsEmitted: false,
  };
}

/**
 * Order two identifiers by Unicode code point.
 *
 * This mirrors `compareUnicodeCodePoints` in `@graph-engineering/core` and
 * Python's default string ordering. It is restated here so this module depends
 * on nothing but Node built-ins, which keeps a read-only diagnostic path from
 * failing when a package dependency is missing.
 */
function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) as number);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) as number);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

export function isSafeRunId(value: string): boolean {
  return SAFE_RUN_ID.test(value) && value !== "." && value !== "..";
}

export function runIdHash(runId: string): string {
  return createHash("sha256").update(runId, "utf8").digest("hex");
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedInteger(value: unknown, minimum: number): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (!Number.isInteger(value)) return false;
  return value >= minimum && value <= MAX_SAFE;
}

function malformed(runId: string, message: string, record: number | null): OperationError {
  return new OperationError("GECLI_HISTORY_MALFORMED", message, runId, record);
}

function decodeRecord(line: string, index: number, runId: string): JournalEntry {
  const record = index + 1;
  if (line.length === 0) {
    throw malformed(runId, "durable history record is blank", record);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw malformed(runId, "durable history record is not JSON", record);
  }
  if (!isRecordObject(parsed)) {
    throw malformed(runId, "durable history record is not a JSON object", record);
  }
  for (const key of Object.keys(parsed)) {
    if (!ENVELOPE_KEYS.has(key)) {
      throw malformed(runId, "durable history record has an unknown property", record);
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (!Object.hasOwn(parsed, key)) {
      throw malformed(runId, "durable history record is missing a required property", record);
    }
  }
  if (parsed.apiVersion !== JOURNAL_API_VERSION) {
    throw malformed(runId, "durable history record has an unsupported event apiVersion", record);
  }
  if (typeof parsed.type !== "string" || !EVENT_TYPE_SET.has(parsed.type)) {
    throw malformed(runId, "durable history record has an unknown event type", record);
  }
  if (typeof parsed.eventId !== "string" || parsed.eventId.length === 0) {
    throw malformed(runId, "durable history record has an invalid eventId", record);
  }
  if (typeof parsed.timestamp !== "string" || !RFC3339.test(parsed.timestamp)) {
    throw malformed(runId, "durable history record has an invalid timestamp", record);
  }
  if (typeof parsed.runId !== "string" || parsed.runId.length === 0) {
    throw malformed(runId, "durable history record has an invalid runId", record);
  }
  if (parsed.runId !== runId) {
    throw malformed(runId, "durable history record does not belong to this run", record);
  }
  if (!isBoundedInteger(parsed.graphRevision, 1)) {
    throw malformed(runId, "durable history record has an invalid graphRevision", record);
  }
  if (!isBoundedInteger(parsed.sequence, 0)) {
    throw malformed(runId, "durable history record has an invalid sequence", record);
  }
  if (parsed.sequence !== index) {
    throw malformed(runId, "durable history record is out of sequence", record);
  }
  for (const key of OPTIONAL_STRING_KEYS) {
    const value = parsed[key];
    if (value !== undefined && typeof value !== "string") {
      throw malformed(runId, `durable history record has an invalid ${key}`, record);
    }
  }
  if (parsed.attempt !== undefined && !isBoundedInteger(parsed.attempt, 1)) {
    throw malformed(runId, "durable history record has an invalid attempt", record);
  }
  if (parsed.redacted !== undefined && typeof parsed.redacted !== "boolean") {
    throw malformed(runId, "durable history record has an invalid redacted flag", record);
  }
  if (!isRecordObject(parsed.data)) {
    throw malformed(runId, "durable history record has a non-object data member", record);
  }
  // `data` is deliberately dropped here and never reaches any sink.
  return {
    sequence: index,
    type: parsed.type,
    timestamp: parsed.timestamp,
    graphRevision: parsed.graphRevision as number,
    nodeId: typeof parsed.nodeId === "string" ? parsed.nodeId : null,
    edgeId: typeof parsed.edgeId === "string" ? parsed.edgeId : null,
    attempt: parsed.attempt === undefined ? null : (parsed.attempt as number),
    redacted: parsed.redacted === true,
  };
}

/**
 * Read one durable history without mutating it.
 *
 * The journal file is opened `"r"` only. No directory is created, no lock file
 * is taken, and no record is appended, so every caller of this function is a
 * provable zero-append reader.
 */
export async function readJournal(
  storeDirectory: string,
  runId: string,
): Promise<readonly JournalEntry[]> {
  if (!isSafeRunId(runId)) {
    throw new OperationError(
      "GECLI_RUN_ID_INVALID",
      "run identifier is not a safe durable identifier",
      runId,
    );
  }
  let storeStat: Awaited<ReturnType<typeof stat>>;
  try {
    storeStat = await stat(storeDirectory);
  } catch {
    throw new OperationError(
      "GECLI_STORE_UNREADABLE",
      "durable store directory is not readable",
      runId,
    );
  }
  if (!storeStat.isDirectory()) {
    throw new OperationError(
      "GECLI_STORE_UNREADABLE",
      "durable store directory is not readable",
      runId,
    );
  }

  const path = join(storeDirectory, "events", `${runIdHash(runId)}.jsonl`);
  let bytes: Buffer;
  try {
    const handle = await open(path, "r");
    try {
      const metadata = await handle.stat();
      if (metadata.isFile() && metadata.size > MAX_JOURNAL_BYTES) {
        throw new OperationError(
          "GECLI_HISTORY_TOO_LARGE",
          "durable history exceeds the readable byte limit",
          runId,
        );
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const buffer = Buffer.allocUnsafe(Math.min(65_536, MAX_JOURNAL_BYTES + 1 - total));
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
        if (bytesRead === 0) break;
        chunks.push(buffer.subarray(0, bytesRead));
        total += bytesRead;
        if (total > MAX_JOURNAL_BYTES) {
          throw new OperationError(
            "GECLI_HISTORY_TOO_LARGE",
            "durable history exceeds the readable byte limit",
            runId,
          );
        }
      }
      bytes = Buffer.concat(chunks, total);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof OperationError) throw error;
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      throw new OperationError("GECLI_RUN_NOT_FOUND", "durable run history does not exist", runId);
    }
    throw new OperationError("GECLI_HISTORY_UNREADABLE", "durable history is not readable", runId);
  }

  if (bytes.byteLength === 0) {
    throw malformed(runId, "durable history is empty", null);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw malformed(runId, "durable history is not valid UTF-8", null);
  }
  if (!text.endsWith("\n")) {
    throw malformed(runId, "durable history has a truncated final record", null);
  }
  const lines = text.slice(0, -1).split("\n");
  return lines.map((line, index) => decodeRecord(line, index, runId));
}

function lastOf(entries: readonly JournalEntry[]): JournalEntry {
  const value = entries[entries.length - 1];
  if (value === undefined) throw new Error("journal projection requires at least one record");
  return value;
}

/** Derive the run lifecycle status from event types only; nothing is inferred. */
export function projectStatus(entries: readonly JournalEntry[]): RunStatus {
  let status: RunStatus = "created";
  for (const entry of entries) {
    if (entry.type === "RunStarted" || entry.type === "RunResumed") status = "running";
    else if (entry.type === "RunPaused") status = "paused";
    else if (entry.type === "RunSucceeded") status = "succeeded";
    else if (entry.type === "RunFailed") status = "failed";
    else if (entry.type === "RunCancelled") status = "cancelled";
  }
  return status;
}

export function isTerminalStatus(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function countType(entries: readonly JournalEntry[], type: string): number {
  return entries.filter((entry) => entry.type === type).length;
}

export function statusData(runId: string, entries: readonly JournalEntry[]): Record<string, unknown> {
  const status = projectStatus(entries);
  const first = entries[0];
  const last = lastOf(entries);
  const observedNodes = new Set<string>();
  for (const entry of entries) {
    if (entry.nodeId !== null) observedNodes.add(entry.nodeId);
  }
  return {
    runId,
    runIdHash: runIdHash(runId),
    journalApiVersion: JOURNAL_API_VERSION,
    status,
    terminal: isTerminalStatus(status),
    eventCount: entries.length,
    lastSequence: last.sequence,
    graphRevision: last.graphRevision,
    firstEventTimestamp: first === undefined ? null : first.timestamp,
    lastEventTimestamp: last.timestamp,
    resumeCount: countType(entries, "RunResumed"),
    pauseCount: countType(entries, "RunPaused"),
    observedNodeCount: observedNodes.size,
    redaction: redactionBlock(),
  };
}

interface NodeObservation {
  eventCount: number;
  firstSequence: number;
  lastSequence: number;
  observedMaxAttempt: number;
  scheduled: boolean;
  started: boolean;
  succeeded: boolean;
  attemptFailures: number;
  retries: number;
  settledWithoutAttempt: boolean;
}

interface EdgeObservation {
  eventCount: number;
  firstSequence: number;
  lastSequence: number;
}

export function inspectData(
  runId: string,
  entries: readonly JournalEntry[],
): Record<string, unknown> {
  const status = projectStatus(entries);
  const last = lastOf(entries);

  const typeCounts = new Map<string, number>();
  const nodes = new Map<string, NodeObservation>();
  const edges = new Map<string, EdgeObservation>();
  for (const entry of entries) {
    typeCounts.set(entry.type, (typeCounts.get(entry.type) ?? 0) + 1);
    if (entry.nodeId !== null) {
      const observation = nodes.get(entry.nodeId) ?? {
        eventCount: 0,
        firstSequence: entry.sequence,
        lastSequence: entry.sequence,
        observedMaxAttempt: 0,
        scheduled: false,
        started: false,
        succeeded: false,
        attemptFailures: 0,
        retries: 0,
        settledWithoutAttempt: false,
      };
      observation.eventCount += 1;
      observation.lastSequence = entry.sequence;
      if (entry.attempt !== null && entry.attempt > observation.observedMaxAttempt) {
        observation.observedMaxAttempt = entry.attempt;
      }
      if (entry.type === "NodeScheduled") observation.scheduled = true;
      if (entry.type === "NodeStarted") observation.started = true;
      if (entry.type === "NodeSucceeded") observation.succeeded = true;
      if (entry.type === "NodeAttemptFailed") observation.attemptFailures += 1;
      if (entry.type === "NodeRetried") observation.retries += 1;
      if (entry.type === "NodeSettledWithoutAttempt") observation.settledWithoutAttempt = true;
      nodes.set(entry.nodeId, observation);
    }
    if (entry.edgeId !== null) {
      const observation = edges.get(entry.edgeId) ?? {
        eventCount: 0,
        firstSequence: entry.sequence,
        lastSequence: entry.sequence,
      };
      observation.eventCount += 1;
      observation.lastSequence = entry.sequence;
      edges.set(entry.edgeId, observation);
    }
  }

  const eventTypeCounts: Record<string, number> = {};
  for (const type of JOURNAL_EVENT_TYPES) {
    const count = typeCounts.get(type);
    if (count !== undefined) eventTypeCounts[type] = count;
  }

  const nodeIds = [...nodes.keys()].sort(compareCodePoints);
  const edgeIds = [...edges.keys()].sort(compareCodePoints);

  return {
    runId,
    runIdHash: runIdHash(runId),
    journalApiVersion: JOURNAL_API_VERSION,
    status,
    terminal: isTerminalStatus(status),
    eventCount: entries.length,
    lastSequence: last.sequence,
    graphRevision: last.graphRevision,
    eventTypeCounts,
    observedNodes: nodeIds.map((nodeId) => {
      const observation = nodes.get(nodeId) as NodeObservation;
      return {
        nodeId,
        eventCount: observation.eventCount,
        firstSequence: observation.firstSequence,
        lastSequence: observation.lastSequence,
        observedMaxAttempt: observation.observedMaxAttempt,
        scheduled: observation.scheduled,
        started: observation.started,
        succeeded: observation.succeeded,
        attemptFailures: observation.attemptFailures,
        retries: observation.retries,
        settledWithoutAttempt: observation.settledWithoutAttempt,
      };
    }),
    observedEdges: edgeIds.map((edgeId) => {
      const observation = edges.get(edgeId) as EdgeObservation;
      return {
        edgeId,
        eventCount: observation.eventCount,
        firstSequence: observation.firstSequence,
        lastSequence: observation.lastSequence,
      };
    }),
    redaction: redactionBlock(),
  };
}

export function logsData(
  runId: string,
  entries: readonly JournalEntry[],
  fromSequence: number,
  limit: number,
): Record<string, unknown> {
  const window = entries.filter((entry) => entry.sequence >= fromSequence).slice(0, limit);
  const remaining = entries.filter((entry) => entry.sequence >= fromSequence).length - window.length;
  const nextEntry = window[window.length - 1];
  return {
    runId,
    runIdHash: runIdHash(runId),
    journalApiVersion: JOURNAL_API_VERSION,
    eventCount: entries.length,
    fromSequence,
    limit,
    returned: window.length,
    truncated: remaining > 0,
    nextSequence: remaining > 0 && nextEntry !== undefined ? nextEntry.sequence + 1 : null,
    events: window.map((entry) => ({
      sequence: entry.sequence,
      type: entry.type,
      timestamp: entry.timestamp,
      nodeId: entry.nodeId,
      edgeId: entry.edgeId,
      attempt: entry.attempt,
      redacted: entry.redacted,
    })),
    redaction: redactionBlock(),
  };
}
