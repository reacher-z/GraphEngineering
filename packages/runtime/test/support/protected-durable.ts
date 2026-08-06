import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_CAPTURE_POLICY,
  DeterministicTestKeyProvider,
  FileProtectedPayloadStore,
  MemoryProtectedEventStore,
  MemoryProtectedPayloadStore,
  ProtectedJsonlEventStore,
  VersionConflictError,
  type AuthorityScope,
  type CaptureSinkClass,
  type GraphEventV1Alpha2,
  type PreparedSinkWrite,
} from "@graph-engineering/persistence";

import { decodeDurableJson } from "../../src/durable-json.js";
import {
  ProtectedDurableRun,
  type DurableEventDraft,
  type DurablePayloadProtection,
  type GuardedDurableJournal,
  type RecoveredEvent,
} from "../../src/durable-protection.js";

export const TEST_SCOPE: AuthorityScope = Object.freeze({
  tenantScopeId: "tenant-durable-test",
  authorityProviderId: "provider-durable-test",
  authoritySubjectId: "subject-durable-test",
});

/**
 * Section 5.1: the policy must name the key reference actually in use, or its
 * hash attests to a key that is protecting nothing. The shipped default profile
 * carries a placeholder reference, so a test provider needs its own.
 */
export const TEST_CAPTURE_POLICY = Object.freeze({
  ...DEFAULT_CAPTURE_POLICY,
  keyRef: new DeterministicTestKeyProvider().keyRef,
});

/** A fully configured in-memory protected write path for durable tests. */
export function memoryProtection(
  overrides: Partial<DurablePayloadProtection> = {},
): DurablePayloadProtection {
  return {
    journal: new MemoryProtectedEventStore(),
    payloadStore: new MemoryProtectedPayloadStore(),
    keys: new DeterministicTestKeyProvider(),
    scope: TEST_SCOPE,
    policy: TEST_CAPTURE_POLICY,
    ...overrides,
  };
}

export interface FileProtectionHarness {
  readonly directory: string;
  readonly protection: DurablePayloadProtection;
  dispose(): Promise<void>;
}

/** A file-backed protected write path, used where real bytes must be scanned. */
export async function fileProtection(): Promise<FileProtectionHarness> {
  const directory = await mkdtemp(join(tmpdir(), "ge-durable-"));
  return {
    directory,
    protection: {
      journal: new ProtectedJsonlEventStore({ directory }),
      payloadStore: new FileProtectedPayloadStore({ directory }),
      keys: new DeterministicTestKeyProvider(),
      scope: TEST_SCOPE,
      policy: TEST_CAPTURE_POLICY,
    },
    dispose: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** The persisted stream with every protected reference resolved. */
export async function recoveredHistory(
  protection: DurablePayloadProtection,
  runId: string,
): Promise<RecoveredEvent[]> {
  return [...(await new ProtectedDurableRun(protection, runId).read())];
}

/** The raw persisted `events/v1alpha2` records, references and all. */
export async function persistedHistory(
  protection: DurablePayloadProtection,
  runId: string,
): Promise<GraphEventV1Alpha2[]> {
  const events: GraphEventV1Alpha2[] = [];
  for await (const event of protection.journal.read(runId)) events.push(event);
  return events;
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Turn one recovered event back into the draft that would produce it.
 *
 * This is the forger's tool: it is the only way to get a chosen history into a
 * guarded journal, and it deliberately cannot bypass the guard. Values are
 * re-protected, so every derived MAC and ciphertext is recomputed from whatever
 * value the forger supplies; only genuinely caller-asserted metadata (an
 * adjacent `inputMac` on `NodeStarted`, an `activityKey`, a `status`) can be
 * made to disagree with the protected truth.
 */
export function draftFromRecovered(
  runId: string,
  event: RecoveredEvent,
): DurableEventDraft {
  const data = record(event.data);
  const graphRevision = event.graphRevision;
  const nodeId = event.nodeId as string;
  const identity = {
    ...(event.nodeId === undefined ? {} : { nodeId: event.nodeId }),
    ...(event.edgeId === undefined ? {} : { edgeId: event.edgeId }),
    ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
  };
  switch (event.type) {
    case "RunCreated":
      return {
        type: "RunCreated",
        data: {
          contractVersion: data.contractVersion,
          graphHash: data.graphHash,
          implementationHash: data.implementationHash,
          capturePolicyHash: data.capturePolicyHash,
          protectedStoreContract: data.protectedStoreContract,
          keyRefHash: data.keyRefHash,
          maxTotalAttempts: data.maxTotalAttempts,
        },
        payloads: [{
          field: "inputRef",
          semanticContext: { kind: "graph-input", runId, graphRevision },
          value: decodeDurableJson(data.input),
        }],
      };
    case "NodeScheduled":
      return {
        type: "NodeScheduled",
        ...identity,
        data: { activityKey: data.activityKey, sideEffects: data.sideEffects },
        payloads: [{
          field: "inputRef",
          semanticContext: { kind: "node-input", runId, graphRevision, nodeId },
          value: decodeDurableJson(data.input),
        }],
      };
    case "NodeSucceeded":
      return {
        type: "NodeSucceeded",
        ...identity,
        data: { inputMac: data.inputMac },
        payloads: [{
          field: "outputRef",
          semanticContext: { kind: "node-output", runId, graphRevision, nodeId },
          value: decodeDurableJson(data.output),
        }],
      };
    case "NodeSettledWithoutAttempt":
      return {
        type: "NodeSettledWithoutAttempt",
        ...identity,
        data: {
          status: data.status,
          attempts: data.attempts,
          failureCode: data.failureCode,
        },
        payloads: [{
          field: "resultRef",
          semanticContext: { kind: "node-result", runId, graphRevision, nodeId },
          value: decodeDurableJson(data.result),
        }],
      };
    case "BarrierSatisfied":
      return {
        type: "BarrierSatisfied",
        ...identity,
        data: {
          policyHash: data.policyHash,
          decisionId: data.decisionId,
          satisfied: data.satisfied,
          resolution: data.resolution,
        },
        payloads: [{
          field: "decisionRef",
          semanticContext: { kind: "node-result", runId, graphRevision, nodeId },
          value: decodeDurableJson(data.decision),
        }],
      };
    case "RunSucceeded":
    case "RunFailed":
    case "RunCancelled":
      return {
        type: event.type,
        data: { status: data.status },
        payloads: [{
          field: "resultRef",
          semanticContext: { kind: "run-result", runId, graphRevision },
          value: decodeDurableJson(data.result),
        }],
      };
    case "NodeAttemptFailed": {
      // The recovered `failure` is the protected evidence document, a strict
      // superset of the closed `$defs.attemptFailure` projection. Rebuild the
      // projection by selecting exactly the five members the schema allows.
      const failure = record(data.failure);
      const closed: Record<string, unknown> = {
        phase: failure.phase,
        code: failure.code,
        messageTemplate: failure.messageTemplate,
        retryable: failure.retryable,
        causeCode: failure.causeCode,
      };
      // Only a history that actually captured evidence gets it back: the
      // recovered `failure` carries a `message` exactly when it was protected.
      // Re-attaching one unconditionally would forge a `protected-ref` record
      // out of a `metadata-only` one.
      const hadEvidence = failure.message !== undefined;
      return {
        type: "NodeAttemptFailed",
        ...identity,
        data: { terminal: data.terminal, failure: closed },
        ...(hadEvidence
          ? {
              payloads: [{
                field: "evidenceRef" as const,
                semanticContext: {
                  kind: "diagnostic-evidence" as const,
                  runId,
                  graphRevision,
                  nodeId,
                  attempt: event.attempt as number,
                  code: String(failure.code),
                },
                value: failure,
              }],
            }
          : {}),
      };
    }
    default:
      return { type: event.type as DurableEventDraft["type"], ...identity, data };
  }
}

/**
 * Commit a chosen history into a fresh guarded journal. Every payload is
 * re-protected on the way in, so the result is a real v1alpha2 stream.
 */
export async function forgeHistory(
  runId: string,
  events: readonly RecoveredEvent[],
  protection: DurablePayloadProtection = memoryProtection(),
): Promise<DurablePayloadProtection> {
  const run = new ProtectedDurableRun(protection, runId);
  let index = 0;
  await run.append(
    -1,
    events.map((event) => draftFromRecovered(runId, event)),
    (sequence) => events[sequence]?.eventId ?? `forged:${sequence}`,
    () => events[index++]?.timestamp ?? "2026-07-26T12:00:00.000Z",
  );
  return protection;
}

async function committedSince(
  journal: GuardedDurableJournal,
  runId: string,
  fromSequence: number,
): Promise<GraphEventV1Alpha2[]> {
  const events: GraphEventV1Alpha2[] = [];
  for await (const event of journal.read(runId, fromSequence)) events.push(event);
  return events;
}

/**
 * Append a chosen suffix to an existing guarded stream. Payloads are
 * re-protected, so the suffix is a real v1alpha2 record.
 */
export async function appendForged(
  protection: DurablePayloadProtection,
  runId: string,
  expectedVersion: number,
  events: readonly RecoveredEvent[],
): Promise<void> {
  const run = new ProtectedDurableRun(protection, runId);
  let index = 0;
  await run.append(
    expectedVersion,
    events.map((event) => draftFromRecovered(runId, event)),
    (sequence) => events[sequence - expectedVersion - 1]?.eventId ?? `forged-${sequence}`,
    () => events[index++]?.timestamp ?? "2026-07-26T12:00:00.000Z",
  );
}

/**
 * A guarded journal that commits a batch and then loses the process. It sees
 * only the closed metadata of what it already committed — never a prepared
 * write's contents and never a payload.
 */
class CommitThenThrowJournal implements GuardedDurableJournal {
  readonly delegate: GuardedDurableJournal;
  readonly shouldThrow: (events: readonly GraphEventV1Alpha2[]) => boolean;
  threw = false;

  constructor(
    delegate: GuardedDurableJournal,
    shouldThrow: (events: readonly GraphEventV1Alpha2[]) => boolean,
  ) {
    this.delegate = delegate;
    this.shouldThrow = shouldThrow;
  }

  get sink(): CaptureSinkClass {
    return this.delegate.sink;
  }

  get binding(): object {
    return this.delegate.binding;
  }

  async append(
    runId: string,
    expectedVersion: number,
    writes: readonly PreparedSinkWrite[],
  ): Promise<number> {
    const version = await this.delegate.append(runId, expectedVersion, writes);
    const batch = await committedSince(this.delegate, runId, expectedVersion + 1);
    if (!this.threw && this.shouldThrow(batch)) {
      this.threw = true;
      throw new Error("simulated process loss after durable commit");
    }
    return version;
  }

  read(runId: string, fromSequence = 0): AsyncIterable<GraphEventV1Alpha2> {
    return this.delegate.read(runId, fromSequence);
  }
}

/** The same protection, behind a journal that loses the process after a commit. */
export function commitThenThrow(
  base: DurablePayloadProtection,
  shouldThrow: (events: readonly GraphEventV1Alpha2[]) => boolean,
): DurablePayloadProtection {
  return { ...base, journal: new CommitThenThrowJournal(base.journal, shouldThrow) };
}

/** A guarded journal whose compare-and-swap always loses. */
class ConflictJournal implements GuardedDurableJournal {
  readonly delegate: GuardedDurableJournal;

  constructor(delegate: GuardedDurableJournal) {
    this.delegate = delegate;
  }

  get sink(): CaptureSinkClass {
    return this.delegate.sink;
  }

  get binding(): object {
    return this.delegate.binding;
  }

  async append(runId: string, expectedVersion: number): Promise<number> {
    const committed = await committedSince(this.delegate, runId, 0);
    throw new VersionConflictError(runId, expectedVersion, committed.length);
  }

  read(runId: string, fromSequence = 0): AsyncIterable<GraphEventV1Alpha2> {
    return this.delegate.read(runId, fromSequence);
  }
}

/** The same protection, behind a journal that always loses its CAS. */
export function conflictProtection(
  base: DurablePayloadProtection,
): DurablePayloadProtection {
  return { ...base, journal: new ConflictJournal(base.journal) };
}

/**
 * A guarded journal that holds the batch following a committed `NodeStarted`,
 * which is exactly the success batch. It decides from committed metadata alone.
 */
class BlockingSuccessJournal implements GuardedDurableJournal {
  readonly delegate: GuardedDurableJournal;
  readonly entered: Promise<void>;
  #enter!: () => void;
  #release!: () => void;
  readonly #gate: Promise<void>;
  #blocked = false;

  constructor(delegate: GuardedDurableJournal) {
    this.delegate = delegate;
    this.entered = new Promise((resolve) => { this.#enter = resolve; });
    this.#gate = new Promise((resolve) => { this.#release = resolve; });
  }

  release(): void {
    this.#release();
  }

  get sink(): CaptureSinkClass {
    return this.delegate.sink;
  }

  get binding(): object {
    return this.delegate.binding;
  }

  async append(
    runId: string,
    expectedVersion: number,
    writes: readonly PreparedSinkWrite[],
  ): Promise<number> {
    if (!this.#blocked) {
      const committed = await committedSince(this.delegate, runId, 0);
      if (committed.at(-1)?.type === "NodeStarted") {
        this.#blocked = true;
        this.#enter();
        await this.#gate;
      }
    }
    return this.delegate.append(runId, expectedVersion, writes);
  }

  read(runId: string, fromSequence = 0): AsyncIterable<GraphEventV1Alpha2> {
    return this.delegate.read(runId, fromSequence);
  }
}

export interface BlockingSuccessProtection extends DurablePayloadProtection {
  readonly entered: Promise<void>;
  release(): void;
}

/** Protection whose journal pauses immediately before the success batch commits. */
export function blockingSuccess(
  base: DurablePayloadProtection = memoryProtection(),
): BlockingSuccessProtection {
  const journal = new BlockingSuccessJournal(base.journal);
  return {
    ...base,
    journal,
    entered: journal.entered,
    release: () => { journal.release(); },
  };
}

/** Section 5.4 semantic value MAC under one protection configuration. */
export function valueMacFor(
  protection: DurablePayloadProtection,
  runId: string,
  semanticContext: Parameters<ProtectedDurableRun["valueMac"]>[0],
  value: unknown,
): string {
  return new ProtectedDurableRun(protection, runId).valueMac(semanticContext, value);
}

/** Section 8.2 activity key under one protection configuration. */
export function activityKeyFor(
  protection: DurablePayloadProtection,
  runId: string,
  nodeId: string,
  inputMac: string,
): string {
  return new ProtectedDurableRun(protection, runId).activityKey(nodeId, inputMac);
}
