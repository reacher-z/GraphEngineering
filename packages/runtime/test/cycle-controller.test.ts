import {
  canonicalHash,
  canonicalSerialize,
  compileGraph,
  type GraphSpec,
} from "@graph-engineering/core";
import { describe, expect, it, vi } from "vitest";
import {
  buildCycleActivityInterruptionMatrix,
  buildCycleDurableFaultMatrix,
  buildCycleOperationInterruptionMatrix,
  CYCLE_OPERATION_INTERRUPTION_BOUNDARIES,
  CYCLE_PUBLIC_OPERATIONS,
  CYCLE_CONTROLLER_EVENT_TYPES,
  CYCLE_DURABLE_FAULT_STAGES,
  CYCLE_FAULT_KINDS,
  CYCLE_LINEAGE_MANIFEST_DOMAIN,
  cycleDurableFaultBoundary,
  createCycleControllerCheckpoint,
  createCycleInlinePayload,
  CycleActivityFailure,
  CycleControllerError,
  exportCycleControllerLineageManifest,
  foldCycleControllerEvents,
  forkCycleController,
  hashWithDomain,
  MemoryCycleControllerCheckpointStore,
  MemoryCycleControllerEventStore,
  pauseCycleController,
  replayCycleController,
  replayCycleControllerLineageManifest,
  renewCycleControllerLease,
  resolveCycleInDoubtActivity,
  resumeCycleController,
  sha256Utf8,
  startCycleController,
  validateCycleControllerRequest,
  validateCycleControllerCheckpoint,
  type CycleActivityBinding,
  type CycleControllerActivities,
  type CycleControllerEvent,
  type CycleControllerEventStore,
  type CycleControllerCheckpoint,
  type CycleControllerCheckpointStore,
  type CycleControllerRequest,
  type CycleInDoubtResolutionCommand,
  type CycleLease,
  type CycleMode,
} from "../src/index.js";
import { cycleFixture } from "./cycle-fixtures.js";

const START = Date.parse("2026-07-26T00:00:00Z");

function graph(): GraphSpec {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "cycle-controller-test", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["root"],
    outputs: { result: { node: "root" } },
    nodes: [{
      id: "root", kind: "transform", inputSchema: {}, outputSchema: {}, config: {}, sideEffects: "none",
    }],
    edges: [],
  };
}

function binding(phase: string, sideEffects: CycleActivityBinding["sideEffects"] = "none"): CycleActivityBinding {
  return {
    activityId: phase,
    implementationHash: phase === "condition" ? "4".repeat(64) : "5".repeat(64),
    sideEffects,
    maxAttemptsPerRound: 1,
    maxCostUsdPerAttempt: 0,
    timeoutMs: 100,
  };
}

let sequence = 0;
function request(
  mode: CycleMode = "until-dry",
  overrides: Partial<CycleControllerRequest["policy"]> = {},
): CycleControllerRequest {
  sequence += 1;
  const initial = graph();
  const compiled = compileGraph(initial);
  if (!compiled.valid || compiled.graphHash === null) throw new TypeError("test graph did not compile");
  const template = JSON.parse(JSON.stringify(cycleFixture.validRequests[0]!.document)) as CycleControllerRequest;
  const policy: Record<string, unknown> = {
    ...template.policy,
    mode,
    maxIterations: 5,
    maxDurationMs: 1000,
    maxCostUsd: 10,
    maxTotalAttempts: 30,
    maxDiscoveries: 20,
    maxDynamicNodes: 0,
    ...overrides,
  };
  if (mode === "until-dry") policy.consecutiveDryRounds = overrides.consecutiveDryRounds ?? 2;
  else delete policy.consecutiveDryRounds;
  const controllerRunId = `cycle-native-${sequence}`;
  return validateCycleControllerRequest({
    ...template,
    controllerRunId,
    controllerId: `controller-${sequence}`,
    eventStreamId: `${controllerRunId}.events`,
    checkpointScope: `${controllerRunId}.checkpoints`,
    policy,
    objective: createCycleInlinePayload(`objective-${sequence}`),
    initialGraph: {
      graphRevision: 1,
      graphHash: compiled.graphHash,
      revisionHash: "1".repeat(64),
    },
    activities: {
      finder: binding("finder"),
      candidateEvaluator: binding("candidate-evaluator"),
      condition: mode === "while" ? binding("condition") : null,
      optimizerEvaluator: mode === "evaluator-optimizer" ? binding("optimizer-evaluator") : null,
      patchPlanner: null,
    },
    patches: { enabled: false, limits: null },
  });
}

function lease(id = "lease-1", epoch = 1, acquiredAt = START): CycleLease {
  return {
    leaseId: id,
    holderId: `holder-${epoch}`,
    leaseEpoch: epoch,
    fencingToken: epoch,
    acquiredAt: new Date(acquiredAt).toISOString(),
    expiresAt: new Date(acquiredAt + 60_000).toISOString(),
  };
}

function fixedNow(milliseconds = START): () => Date {
  return () => new Date(milliseconds);
}

function events(store: MemoryCycleControllerEventStore, item: CycleControllerRequest): readonly CycleControllerEvent[] {
  return store.snapshot(item.eventStreamId);
}

class CommitThenThrowCycleStore implements CycleControllerEventStore {
  readonly delegate = new MemoryCycleControllerEventStore();
  readonly target: CycleControllerEvent["type"];
  readonly targetPhase: string | undefined;
  threw = false;

  constructor(target: CycleControllerEvent["type"], targetPhase?: string) {
    this.target = target;
    this.targetPhase = targetPhase;
  }

  async append(streamId: string, expectedSequence: number, values: readonly CycleControllerEvent[]): Promise<number> {
    const version = await this.delegate.append(streamId, expectedSequence, values);
    if (!this.threw && values.some(({ type, data }) => (
      type === this.target && (this.targetPhase === undefined || data.phase === this.targetPhase)
    ))) {
      this.threw = true;
      throw new Error(`simulated process loss after ${this.target}`);
    }
    return version;
  }

  read(streamId: string, fromSequence = 0): AsyncIterable<CycleControllerEvent> {
    return this.delegate.read(streamId, fromSequence);
  }
}

class FailCheckpointWrite implements CycleControllerCheckpointStore {
  writes = 0;

  async write(): Promise<void> {
    this.writes += 1;
    throw new Error("checkpoint cache unavailable");
  }

  async read(): Promise<CycleControllerCheckpoint | null> {
    return null;
  }
}

class CountingCycleStore implements CycleControllerEventStore {
  readonly delegate = new MemoryCycleControllerEventStore();
  appends = 0;

  async append(streamId: string, expectedSequence: number, values: readonly CycleControllerEvent[]): Promise<number> {
    this.appends += 1;
    return this.delegate.append(streamId, expectedSequence, values);
  }

  read(streamId: string, fromSequence = 0): AsyncIterable<CycleControllerEvent> {
    return this.delegate.read(streamId, fromSequence);
  }
}

describe("native bounded cycle controller", () => {
  it("derives all 855 durable fault obligations from the closed event vocabulary", () => {
    const matrix = buildCycleDurableFaultMatrix();
    expect(CYCLE_CONTROLLER_EVENT_TYPES).toHaveLength(17);
    expect(CYCLE_DURABLE_FAULT_STAGES).toHaveLength(11);
    expect(CYCLE_FAULT_KINDS).toHaveLength(5);
    expect(matrix).toHaveLength(855);
    expect(new Set(matrix.map((entry) => (
      `${entry.eventType}\0${entry.stage}\0${entry.faultKind}`
    ))).size).toBe(matrix.length);
    for (const eventType of CYCLE_CONTROLLER_EVENT_TYPES) {
      expect(matrix.filter((entry) => entry.eventType === eventType)).toHaveLength(
        eventType === "ControllerTerminated" ? 55 : 50,
      );
    }
    expect(matrix.filter(({ stage }) => stage === "terminal-result-delivery")).toEqual(
      CYCLE_FAULT_KINDS.map((faultKind) => expect.objectContaining({
        eventType: "ControllerTerminated",
        faultKind,
        boundary: "terminal:ControllerTerminated:during-delivery",
        durability: "terminal-event-committed",
      })),
    );
    expect(() => cycleDurableFaultBoundary(
      "Unknown" as never,
      "before-event-construction",
    )).toThrow("unknown cycle-controller event type");
    expect(() => cycleDurableFaultBoundary(
      "ControllerCreated",
      "unknown" as never,
    )).toThrow("unknown durable fault stage");
  });

  it("derives the closed 35-row PatchAccepted visibility campaign", () => {
    const stages = new Set([
      "before-event-construction",
      "after-event-construction",
      "after-prospective-fold",
      "before-store-commit",
      "after-store-commit",
      "after-store-return",
      "after-state-update",
    ]);
    const matrix = buildCycleDurableFaultMatrix().filter(({ eventType, stage }) => (
      eventType === "PatchAccepted" && stages.has(stage)
    ));

    expect(matrix).toHaveLength(35);
    expect(matrix.filter(({ durability }) => durability === "event-not-committed")).toHaveLength(20);
    expect(matrix.filter(({ durability }) => durability === "event-committed")).toHaveLength(15);
    expect(new Set(matrix.map(({ faultKind }) => faultKind))).toEqual(new Set(CYCLE_FAULT_KINDS));
    expect(Buffer.byteLength(canonicalSerialize(matrix), "utf8")).toBe(6249);
    expect(canonicalHash(matrix)).toBe(
      "160ed0853f3da4783f39440b7d3ade46b56a1d83f47248be2cb97a37dc46dfd2",
    );
  });

  it("derives the closed 15-row PatchAccepted checkpoint campaign", () => {
    const stages = new Set([
      "before-checkpoint-construction",
      "after-checkpoint-construction",
      "after-checkpoint-save",
    ]);
    const matrix = buildCycleDurableFaultMatrix().filter(({ eventType, stage }) => (
      eventType === "PatchAccepted" && stages.has(stage)
    ));

    expect(matrix).toHaveLength(15);
    expect(matrix.filter(({ durability }) => durability === "event-committed")).toHaveLength(10);
    expect(matrix.filter(
      ({ durability }) => durability === "event-and-checkpoint-committed",
    )).toHaveLength(5);
    expect(new Set(matrix.map(({ faultKind }) => faultKind))).toEqual(new Set(CYCLE_FAULT_KINDS));
    expect(Buffer.byteLength(canonicalSerialize(matrix), "utf8")).toBe(2893);
    expect(canonicalHash(matrix)).toBe(
      "c6a79bb3c8ce003f9c5968b39486e4bd1edcb5ff4cc7d87ae26ba810fd355381",
    );
  });

  it("derives all 68 activity interruption obligations without duplicate identities", () => {
    const matrix = buildCycleActivityInterruptionMatrix();
    expect(matrix).toHaveLength(68);
    expect(new Set(matrix.map(({ id }) => id)).size).toBe(68);
    expect(matrix.filter(({ interruption }) => interruption === "attempt-timeout")).toHaveLength(15);
    expect(matrix.filter(({ trigger }) => trigger === "before-claim")).toHaveLength(5);
    expect(matrix.filter(({ sideEffects }) => sideEffects === null)).toHaveLength(7);
    expect(matrix.filter(({ phase }) => phase === "finder")).toHaveLength(14);
    expect(matrix.at(0)).toEqual({
      id: "before-first-round",
      interruption: "caller-cancellation",
      trigger: "before-first-round",
      phase: null,
      sideEffects: null,
    });
    expect(matrix.at(-1)?.id).toBe("finder:repeated-cancellation:none");
  });

  it("derives all 25 public-operation interruption obligations in canonical order", () => {
    const matrix = buildCycleOperationInterruptionMatrix();

    expect(CYCLE_PUBLIC_OPERATIONS).toEqual(["pause", "resume", "replay", "fork"]);
    expect(matrix).toHaveLength(25);
    expect(matrix.map(({ boundary }) => boundary)).toEqual(
      CYCLE_OPERATION_INTERRUPTION_BOUNDARIES,
    );
    expect(new Set(matrix.map(({ id }) => id).values()).size).toBe(25);
    expect(matrix.filter(({ durability }) => durability === "read-only")).toHaveLength(4);
    expect(matrix.filter(({ durability }) => durability === "operation-not-committed")).toHaveLength(14);
    expect(matrix.filter(({ outcome }) => outcome === "operation-cancelled")).toHaveLength(18);
    expect(matrix.filter(({ outcome }) => outcome === "controller-cancelled")).toHaveLength(3);
    expect(matrix.filter(({ outcome }) => outcome === "committed-result")).toHaveLength(4);
    expect(matrix.at(0)).toEqual({
      id: "operation:pause:before-read",
      operation: "pause",
      boundary: "operation:pause:before-read",
      durability: "operation-not-committed",
      outcome: "operation-cancelled",
    });
    expect(matrix.at(-1)).toEqual({
      id: "operation:fork:before-return",
      operation: "fork",
      boundary: "operation:fork:before-return",
      durability: "operation-committed",
      outcome: "committed-result",
    });
  });

  it.each([
    ["event:DiscoveryCommitted:before-construction", false],
    ["event:DiscoveryCommitted:after-construction", false],
    ["event:DiscoveryCommitted:after-fold-before-cas", false],
    ["store:event:DiscoveryCommitted:before-commit", false],
    ["store:event:DiscoveryCommitted:after-commit-before-return", true],
    ["event:DiscoveryCommitted:after-store-before-state", true],
    ["event:DiscoveryCommitted:after-state-before-dispatch", true],
  ] as const)("recovers the canonical durable boundary %s without duplicate success", async (
    boundary,
    committed,
  ) => {
    const item = request("until-dry", { maxIterations: 1 });
    let fired = false;
    const faultHook = (seen: string): void => {
      if (!fired && seen === boundary) {
        fired = true;
        throw new Error(`injected ${boundary}`);
      }
    };
    const store = boundary.startsWith("store:")
      ? new MemoryCycleControllerEventStore({ faultHook })
      : new MemoryCycleControllerEventStore();
    const finder = vi.fn(() => ({ output: [{ key: "boundary", value: true }] }));
    const evaluator = vi.fn(({ input }: { input: unknown }) => ({
      output: (input as { candidates: { key: string }[] }).candidates.map(({ key }) => ({
        key, verdict: "accept" as const,
      })),
    }));
    await expect(startCycleController(item, graph(), {
      eventStore: store,
      lease: lease(),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: evaluator },
      ...(boundary.startsWith("store:") ? {} : { faultHook }),
    })).rejects.toBeDefined();
    expect(fired).toBe(true);
    const interrupted = store.snapshot(item.eventStreamId);
    expect(interrupted.at(-1)?.type === "DiscoveryCommitted").toBe(committed);
    expect(interrupted.map(({ type }) => type).filter(
      (type) => type === "DiscoveryCommitted",
    )).toHaveLength(committed ? 1 : 0);

    const result = await resumeCycleController(item, graph(), {
      eventStore: store,
      expectedSequence: interrupted.at(-1)!.sequence,
      leaseReason: "takeover",
      lease: lease("boundary-lease-2", 2),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: evaluator },
    });
    expect(result.exitReason).toBe("MAX_ITERATIONS");
    expect(finder).toHaveBeenCalledTimes(committed ? 1 : 2);
    expect(evaluator).toHaveBeenCalledTimes(1);
    const terminal = store.snapshot(item.eventStreamId);
    expect(terminal.filter(({ type }) => type === "DiscoveryCommitted")).toHaveLength(1);
    expect((await replayCycleController(store, item.eventStreamId)).terminalResult).toEqual(result);
  });

  it.each([
    ["checkpoint:ControllerTerminated:before-construction", false],
    ["checkpoint:ControllerTerminated:after-construction-before-save", false],
    ["checkpoint:ControllerTerminated:after-save-before-ack", true],
  ] as const)("retains terminal truth across checkpoint boundary %s", async (
    boundary,
    checkpointCommitted,
  ) => {
    const item = request("until-dry", { maxIterations: 1 });
    const store = new MemoryCycleControllerEventStore();
    const checkpoints = new MemoryCycleControllerCheckpointStore();
    let fired = false;
    const faultHook = (seen: string): void => {
      if (!fired && seen === boundary) {
        fired = true;
        throw new Error(`injected ${boundary}`);
      }
    };
    const finder = vi.fn(() => ({ output: [] }));
    await expect(startCycleController(item, graph(), {
      eventStore: store,
      checkpointStore: checkpoints,
      lease: lease(),
      now: fixedNow(),
      faultHook,
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toBeDefined();
    const interrupted = store.snapshot(item.eventStreamId);
    expect(interrupted.at(-1)?.type).toBe("ControllerTerminated");
    expect(await checkpoints.read(
      item.checkpointScope,
      `${item.controllerRunId}-latest`,
    ) !== null).toBe(checkpointCommitted);
    const writes = interrupted.length;
    const result = await resumeCycleController(item, graph(), {
      eventStore: store,
      checkpointStore: checkpoints,
      expectedSequence: interrupted.at(-1)!.sequence,
      lease: lease("checkpoint-lease-2", 2),
      now: () => { throw new Error("terminal resume read the clock"); },
      activities: {
        finder: () => { throw new Error("terminal resume dispatched"); },
        candidateEvaluator: () => { throw new Error("terminal resume dispatched"); },
      },
    });
    expect(result.exitReason).toBe("MAX_ITERATIONS");
    expect(store.snapshot(item.eventStreamId)).toHaveLength(writes);
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it("retains the terminal event when result delivery loses the process", async () => {
    const item = request("until-dry", { maxIterations: 1 });
    const store = new MemoryCycleControllerEventStore();
    const finder = vi.fn(() => ({ output: [] }));
    await expect(startCycleController(item, graph(), {
      eventStore: store,
      lease: lease(),
      now: fixedNow(),
      faultHook: (boundary) => {
        if (boundary === "terminal:ControllerTerminated:during-delivery") {
          throw new Error("delivery process loss");
        }
      },
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toThrow("delivery process loss");
    const interrupted = store.snapshot(item.eventStreamId);
    expect(interrupted.at(-1)?.type).toBe("ControllerTerminated");
    const result = await resumeCycleController(item, graph(), {
      eventStore: store,
      expectedSequence: interrupted.at(-1)!.sequence,
      lease: lease("delivery-lease-2", 2),
      activities: {
        finder: () => { throw new Error("terminal resume dispatched"); },
        candidateEvaluator: () => { throw new Error("terminal resume dispatched"); },
      },
    });
    expect(result.exitReason).toBe("MAX_ITERATIONS");
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it("renews then voluntarily releases one fenced lease with zero administration dispatch", async () => {
    const item = request("until-dry", { maxIterations: 1 });
    const store = new MemoryCycleControllerEventStore();
    const checkpoints = new MemoryCycleControllerCheckpointStore();
    const failedCheckpoints = new FailCheckpointWrite();
    const initialLease = lease("lease-admin-1", 1);
    let interrupted = false;
    await expect(startCycleController(item, graph(), {
      eventStore: store,
      lease: initialLease,
      now: fixedNow(),
      faultHook: (boundary) => {
        if (!interrupted && boundary === "event:RoundReserved:after-state-before-dispatch") {
          interrupted = true;
          throw new Error("hold the controller before finder dispatch");
        }
      },
      activities: {
        finder: () => { throw new Error("administration dispatched finder"); },
        candidateEvaluator: () => { throw new Error("administration dispatched evaluator"); },
      },
    })).rejects.toThrow("hold the controller before finder dispatch");
    const openTail = events(store, item).at(-1)!.sequence;
    expect(events(store, item).at(-1)?.type).toBe("RoundReserved");

    const extendedLease = {
      ...initialLease,
      expiresAt: new Date(START + 120_000).toISOString(),
    };
    const administrationNow = vi.fn(fixedNow());
    const renewed = await renewCycleControllerLease(item, {
      eventStore: store,
      checkpointStore: failedCheckpoints,
      expectedSequence: openTail,
      lease: extendedLease,
      now: administrationNow,
    });
    expect(renewed.event).toMatchObject({
      type: "LeaseRenewed",
      lease: extendedLease,
      data: {
        previousExpiresAt: initialLease.expiresAt,
        newExpiresAt: extendedLease.expiresAt,
      },
    });
    expect(renewed.fold.activeLease).toEqual(extendedLease);
    expect(renewed.checkpointWarning).toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    expect(failedCheckpoints.writes).toBe(1);

    const afterRenew = events(store, item).length;
    await expect(renewCycleControllerLease(item, {
      eventStore: store,
      expectedSequence: renewed.event.sequence,
      lease: { ...extendedLease, holderId: "different-holder" },
      now: administrationNow,
    })).rejects.toMatchObject({ code: "GE_CYCLE_LEASE_CONFLICT" });
    await expect(renewCycleControllerLease(item, {
      eventStore: store,
      expectedSequence: renewed.event.sequence,
      lease: extendedLease,
      now: administrationNow,
    })).rejects.toMatchObject({ code: "GE_CYCLE_STALE_LEASE" });
    expect(events(store, item)).toHaveLength(afterRenew);
    expect(administrationNow).toHaveBeenCalledTimes(1);

    await expect(pauseCycleController(item, {
      eventStore: store,
      expectedSequence: openTail,
      reason: "handoff",
      now: administrationNow,
    })).rejects.toMatchObject({ code: "GE_CYCLE_VERSION_CONFLICT" });
    const paused = await pauseCycleController(item, {
      eventStore: store,
      checkpointStore: checkpoints,
      expectedSequence: renewed.event.sequence,
      reason: "handoff",
      now: administrationNow,
    });
    expect(paused.event).toMatchObject({
      type: "LeaseReleased",
      lease: extendedLease,
      data: { reason: "handoff" },
    });
    expect(paused.releasedLeaseId).toBe(initialLease.leaseId);
    expect(paused.fold.activeLease).toBeNull();
    expect(paused.checkpointWarning).toBeNull();
    expect(administrationNow).toHaveBeenCalledTimes(2);
    const checkpoint = await checkpoints.read(
      item.checkpointScope,
      `${item.controllerRunId}-latest`,
    );
    expect(checkpoint?.lastSequence).toBe(paused.event.sequence);
    expect(checkpoint?.lease).toBeNull();

    const finder = vi.fn(() => ({ output: [] }));
    const result = await resumeCycleController(item, graph(), {
      eventStore: store,
      expectedSequence: paused.event.sequence,
      lease: lease("lease-admin-2", 2),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    });
    expect(result.exitReason).toBe("MAX_ITERATIONS");
    expect(finder).toHaveBeenCalledTimes(1);
    expect(events(store, item).filter(({ type }) => type === "LeaseRenewed")).toHaveLength(1);
    expect(events(store, item).filter(({ type }) => type === "LeaseReleased")).toHaveLength(1);
  });

  it("commits exactly one winner when lease administration races at CAS", async () => {
    const item = request("until-dry", { maxIterations: 1 });
    const store = new MemoryCycleControllerEventStore();
    const initialLease = lease("lease-race-1", 1);
    let interrupted = false;
    await expect(startCycleController(item, graph(), {
      eventStore: store,
      lease: initialLease,
      now: fixedNow(),
      faultHook: (boundary) => {
        if (!interrupted && boundary === "event:RoundReserved:after-state-before-dispatch") {
          interrupted = true;
          throw new Error("hold the controller before lease race");
        }
      },
      activities: {
        finder: () => { throw new Error("lease race dispatched finder"); },
        candidateEvaluator: () => { throw new Error("lease race dispatched evaluator"); },
      },
    })).rejects.toThrow("hold the controller before lease race");
    const before = events(store, item);
    const expectedSequence = before.at(-1)!.sequence;

    let arrivals = 0;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const raceAtCas = async (boundary: string): Promise<void> => {
      if (boundary !== "event:LeaseRenewed:before-cas"
          && boundary !== "event:LeaseReleased:before-cas") return;
      arrivals += 1;
      if (arrivals === 2) openGate();
      await gate;
    };
    const outcomes = await Promise.allSettled([
      renewCycleControllerLease(item, {
        eventStore: store,
        expectedSequence,
        lease: {
          ...initialLease,
          expiresAt: new Date(START + 120_000).toISOString(),
        },
        now: fixedNow(),
        faultHook: raceAtCas,
      }),
      pauseCycleController(item, {
        eventStore: store,
        expectedSequence,
        reason: "handoff",
        now: fixedNow(),
        faultHook: raceAtCas,
      }),
    ]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = outcomes.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "GE_CYCLE_VERSION_CONFLICT" },
    });
    const after = events(store, item);
    expect(after).toHaveLength(before.length + 1);
    expect(after.filter(({ type }) => (
      type === "LeaseRenewed" || type === "LeaseReleased"
    ))).toHaveLength(1);
  });

  it("converges until dry while retaining rejected findings in global seen", async () => {
    const item = request("until-dry", { maxIterations: 4, consecutiveDryRounds: 2 });
    const store = new MemoryCycleControllerEventStore();
    const finder = vi.fn(({ iteration }: { iteration: number }) => ({
      output: iteration === 1
        ? [{ key: "finding-a", value: { iteration } }, { key: "finding-a", value: { duplicate: true } }]
        : iteration === 2 ? [{ key: "finding-a", value: { rediscovered: true } }] : [],
    }));
    const evaluator = vi.fn(({ input }: { input: unknown }) => {
      const candidates = (input as { candidates: { key: string }[] }).candidates;
      return { output: candidates.map(({ key }) => ({ key, verdict: "reject" as const })) };
    });
    const result = await startCycleController(item, graph(), {
      eventStore: store,
      lease: lease(),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: evaluator },
    });
    expect(result).toMatchObject({
      status: "converged", exitReason: "DRY", iterations: 3,
      consecutiveDryRounds: 2, seenCount: 1, rejectedCount: 1,
    });
    expect(finder).toHaveBeenCalledTimes(3);
    expect(evaluator).toHaveBeenCalledTimes(3);
    expect((await replayCycleController(store, item.eventStreamId)).terminalResult).toEqual(result);
  });

  it("executes bounded while true then false without reevaluating committed outcomes", async () => {
    const item = request("while");
    const store = new MemoryCycleControllerEventStore();
    const conditions = [true, false];
    const condition = vi.fn(() => ({ output: conditions.shift() as boolean }));
    const activities: CycleControllerActivities = {
      finder: ({ iteration }) => ({ output: [{ key: `finding-${iteration}`, value: iteration }] }),
      candidateEvaluator: ({ input }) => ({
        output: (input as { candidates: { key: string }[] }).candidates.map(({ key }) => ({ key, verdict: "accept" })),
      }),
      condition,
    };
    const result = await startCycleController(item, graph(), {
      eventStore: store, lease: lease(), now: fixedNow(), activities,
    });
    expect(result).toMatchObject({ exitReason: "CONDITION_FALSE", status: "converged", iterations: 2 });
    expect(condition).toHaveBeenCalledTimes(2);
  });

  it("executes evaluator revise/accept and treats unknown as non-acceptance", async () => {
    const revise = request("evaluator-optimizer");
    const reviseStore = new MemoryCycleControllerEventStore();
    const verdicts = ["revise", "accept"] as const;
    let verdictIndex = 0;
    const optimizerEvaluator = vi.fn(() => ({ output: verdicts[verdictIndex++]! }));
    const shared = {
      finder: ({ iteration }: { iteration: number }) => ({ output: [{ key: `f-${iteration}`, value: iteration }] }),
      candidateEvaluator: ({ input }: { input: unknown }) => ({
        output: (input as { candidates: { key: string }[] }).candidates.map(({ key }) => ({ key, verdict: "accept" as const })),
      }),
    };
    const accepted = await startCycleController(revise, graph(), {
      eventStore: reviseStore, lease: lease(), now: fixedNow(),
      activities: { ...shared, optimizerEvaluator },
    });
    expect(accepted).toMatchObject({ exitReason: "EVALUATOR_ACCEPTED", iterations: 2 });

    const unknown = request("evaluator-optimizer");
    const unknownResult = await startCycleController(unknown, graph(), {
      eventStore: new MemoryCycleControllerEventStore(), lease: lease(), now: fixedNow(),
      activities: { ...shared, optimizerEvaluator: () => ({ output: "unknown" }) },
    });
    expect(unknownResult).toMatchObject({ exitReason: "UNKNOWN_VERDICT", status: "unknown", iterations: 1 });
  });

  it("stops before first dispatch when the exact worst-case round reservation cannot fit", async () => {
    const item = request("until-dry", { maxTotalAttempts: 1 });
    const store = new MemoryCycleControllerEventStore();
    const finder = vi.fn(() => ({ output: [] }));
    const evaluator = vi.fn(() => ({ output: [] }));
    const result = await startCycleController(item, graph(), {
      eventStore: store, lease: lease(), now: fixedNow(),
      activities: { finder, candidateEvaluator: evaluator },
    });
    expect(result).toMatchObject({ exitReason: "MAX_TOTAL_ATTEMPTS", iterations: 0, attemptsUsed: 0 });
    expect(finder).not.toHaveBeenCalled();
    expect(evaluator).not.toHaveBeenCalled();
    expect(events(store, item).map(({ type }) => type)).toEqual([
      "ControllerCreated", "LeaseAcquired", "ControllerTerminated",
    ]);
  });

  it("uses exact per-phase retry attempts rather than aggregate reservation remainder", async () => {
    const base = request("until-dry", { maxIterations: 1, maxTotalAttempts: 10 });
    const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
    (mutable.activities.finder as { maxAttemptsPerRound: number }).maxAttemptsPerRound = 3;
    const item = validateCycleControllerRequest(mutable);
    const store = new MemoryCycleControllerEventStore();
    const retrySignal = new AbortController();
    const added = vi.spyOn(retrySignal.signal, "addEventListener");
    const removed = vi.spyOn(retrySignal.signal, "removeEventListener");
    const attempts: number[] = [];
    const finder = vi.fn(({ attempt }: { attempt: number }) => {
      attempts.push(attempt);
      if (attempt < 3) {
        throw new CycleActivityFailure("GE_TRANSIENT", "retry me", { retryable: true });
      }
      return { output: [] };
    });
    const result = await startCycleController(item, graph(), {
      eventStore: store, lease: lease(), now: fixedNow(), signal: retrySignal.signal,
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    });
    expect(result).toMatchObject({ exitReason: "MAX_ITERATIONS", attemptsUsed: 4 });
    expect(attempts).toEqual([1, 2, 3]);
    expect(events(store, item).filter(({ type }) => type === "ActivityStarted").map(
      (event) => event.data.attempt,
    )).toEqual([1, 2, 3, 1]);
    expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
  });

  it("charges failed patch-planner retries before reserving the exact remaining decision budget", async () => {
    const base = request("until-dry", { maxIterations: 1, maxTotalAttempts: 10 });
    const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
    (mutable.policy as { maxDynamicNodes: number }).maxDynamicNodes = 2;
    const plannerBinding = binding("patch-planner", "idempotent") as {
      maxAttemptsPerRound: number;
    } & CycleActivityBinding;
    plannerBinding.maxAttemptsPerRound = 2;
    (mutable.activities as { patchPlanner: CycleActivityBinding | null }).patchPlanner = plannerBinding;
    (mutable.patches as { enabled: boolean; limits: unknown }).enabled = true;
    (mutable.patches as { enabled: boolean; limits: unknown }).limits = {
      maxNodes: 2, maxEdges: 1, maxOutputs: 2, maxDepth: 2, maxFanOut: 1,
    };
    const item = validateCycleControllerRequest(mutable);
    const store = new MemoryCycleControllerEventStore();
    const authority = {
      proposerActivityKey: "a".repeat(64), principalHash: "a".repeat(64),
      proposerGrantHash: "a".repeat(64), runGrantHash: "a".repeat(64),
      tenantGrantHash: "a".repeat(64), deploymentGrantHash: "a".repeat(64),
      effectiveGrantHash: "a".repeat(64), policyHash: "b".repeat(64), approvalHash: null,
    };
    const planner = vi.fn((activity: Parameters<CycleControllerActivities["finder"]>[0]) => {
      authority.proposerActivityKey = activity.activityKey;
      if (activity.attempt === 1) {
        throw new CycleActivityFailure("GE_PATCH_TRANSIENT", "retry", { retryable: true });
      }
      return { output: {
        apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1" as const,
        kind: "GraphPatch" as const,
        patchId: "retrying-patch",
        base: item.initialGraph,
        append: {
          nodes: [{
            id: "child", kind: "transform", inputSchema: {}, outputSchema: {}, config: {}, sideEffects: "none" as const,
          }],
          edges: [{ id: "root-child", from: { node: "root" }, to: { node: "child" }, mode: "value" as const }],
          outputs: { child: { node: "child" } },
        },
      } };
    });
    const result = await startCycleController(item, graph(), {
      eventStore: store, lease: lease("patch-retry", 1), now: fixedNow(),
      activities: {
        finder: () => ({ output: [] }),
        candidateEvaluator: () => ({ output: [] }),
        patchPlanner: planner,
        shouldPlanPatch: () => true,
      },
      patchContext: {
        authoritySnapshot: authority,
        policySnapshotHash: "b".repeat(64),
        runState: "active",
        effectiveCapabilities: [],
        succeededNodeIds: ["root"],
        supportedEdgeModes: ["value"],
      },
    });
    expect(result).toMatchObject({
      exitReason: "MAX_ITERATIONS", attemptsUsed: 4, dynamicNodes: 1, lastGraphRevision: 2,
    });
    expect(planner).toHaveBeenCalledTimes(2);
    const plannerStarts = events(store, item).filter((event) => (
      event.type === "ActivityStarted" && event.data.phase === "patch-planner"
    ));
    expect(plannerStarts.map(({ data }) => data.attempt)).toEqual([1, 2]);
    expect(new Set(plannerStarts.map(({ data }) => data.activityKey)).size).toBe(1);
    const decision = events(store, item).find(({ type }) => type === "PatchAccepted")!;
    expect(decision.data.budgetOutcome).toMatchObject({
      requested: { attempts: 1, dynamicNodes: 2 },
      committed: { attempts: 1, dynamicNodes: 1 },
      released: { attempts: 0, dynamicNodes: 1 },
    });
  });

  it("resumes after DiscoveryCommitted CAS ambiguity without rerunning committed finder work", async () => {
    const item = request("until-dry", { maxIterations: 1 });
    const store = new CommitThenThrowCycleStore("DiscoveryCommitted");
    const finder = vi.fn(() => ({ output: [{ key: "durable", value: true }] }));
    const evaluator = vi.fn(({ input }: { input: unknown }) => ({
      output: (input as { candidates: { key: string }[] }).candidates.map(({ key }) => ({ key, verdict: "accept" as const })),
    }));
    await expect(startCycleController(item, graph(), {
      eventStore: store, lease: lease(), now: fixedNow(), activities: { finder, candidateEvaluator: evaluator },
    })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    const tail = store.delegate.snapshot(item.eventStreamId).at(-1)!;
    expect(tail.type).toBe("DiscoveryCommitted");

    const result = await resumeCycleController(item, graph(), {
      eventStore: store,
      expectedSequence: tail.sequence,
      leaseReason: "takeover",
      lease: lease("lease-2", 2),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: evaluator },
    });
    expect(result.exitReason).toBe("MAX_ITERATIONS");
    expect(finder).toHaveBeenCalledTimes(1);
    expect(evaluator).toHaveBeenCalledTimes(1);
  });

  it("reuses an open patch-planner claim and restores accepted patch bytes without replanning", async () => {
    const runScenario = async (
      target: "ActivityStarted" | "PatchAccepted",
      targetPhase?: "patch-planner",
    ): Promise<void> => {
      const base = request("until-dry", { maxIterations: 1 });
      const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
      (mutable.policy as { maxDynamicNodes: number }).maxDynamicNodes = 2;
      (mutable.activities as { patchPlanner: CycleActivityBinding | null }).patchPlanner = binding(
        "patch-planner", "idempotent",
      );
      (mutable.patches as { enabled: boolean; limits: unknown }).enabled = true;
      (mutable.patches as { enabled: boolean; limits: unknown }).limits = {
        maxNodes: 2, maxEdges: 1, maxOutputs: 2, maxDepth: 2, maxFanOut: 1,
      };
      const item = validateCycleControllerRequest(mutable);
      const store = new CommitThenThrowCycleStore(target, targetPhase);
      const authority = {
        proposerActivityKey: "a".repeat(64), principalHash: "a".repeat(64),
        proposerGrantHash: "a".repeat(64), runGrantHash: "a".repeat(64),
        tenantGrantHash: "a".repeat(64), deploymentGrantHash: "a".repeat(64),
        effectiveGrantHash: "a".repeat(64), policyHash: "b".repeat(64), approvalHash: null,
      };
      const planner = vi.fn((activity: Parameters<CycleControllerActivities["finder"]>[0]) => {
        authority.proposerActivityKey = activity.activityKey;
        return { output: {
          apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1" as const,
          kind: "GraphPatch" as const,
          patchId: `resume-${target.toLowerCase()}`,
          base: item.initialGraph,
          append: {
            nodes: [{
              id: "child", kind: "transform", inputSchema: {}, outputSchema: {}, config: {}, sideEffects: "none" as const,
            }],
            edges: [{
              id: "root-child", from: { node: "root" }, to: { node: "child" }, mode: "value" as const,
            }],
            outputs: { child: { node: "child" } },
          },
        } };
      });
      const activities: CycleControllerActivities = {
        finder: () => ({ output: [] }),
        candidateEvaluator: () => ({ output: [] }),
        patchPlanner: planner,
        shouldPlanPatch: () => true,
      };
      const patchContext = {
        authoritySnapshot: authority,
        policySnapshotHash: "b".repeat(64),
        runState: "active" as const,
        effectiveCapabilities: [] as readonly string[],
        succeededNodeIds: ["root"] as readonly string[],
        supportedEdgeModes: ["value"] as const,
      };
      await expect(startCycleController(item, graph(), {
        eventStore: store, lease: lease(`${target}-lease-1`, 1), now: fixedNow(),
        activities, patchContext,
      })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
      const tail = store.delegate.snapshot(item.eventStreamId).at(-1)!;
      expect(tail.type).toBe(target);
      if (targetPhase !== undefined) expect(tail.data.phase).toBe(targetPhase);

      const result = await resumeCycleController(item, graph(), {
        eventStore: store,
        expectedSequence: tail.sequence,
        leaseReason: "takeover",
        lease: lease(`${target}-lease-2`, 2),
        now: fixedNow(),
        activities,
        patchContext,
      });
      expect(result).toMatchObject({ exitReason: "MAX_ITERATIONS", lastGraphRevision: 2 });
      expect(planner).toHaveBeenCalledTimes(1);
      expect(store.delegate.snapshot(item.eventStreamId).filter((event) => (
        event.type === "ActivityStarted" && event.data.phase === "patch-planner"
      ))).toHaveLength(1);
      expect(store.delegate.snapshot(item.eventStreamId).filter(
        ({ type }) => type === "PatchAccepted",
      )).toHaveLength(1);
    };

    await runScenario("ActivityStarted", "patch-planner");
    await runScenario("PatchAccepted");
  });

  it("recovers when checkpoint write fails after the event is already durable", async () => {
    const item = request("until-dry", { maxIterations: 1 });
    const store = new MemoryCycleControllerEventStore();
    const checkpoints = new FailCheckpointWrite();
    const finder = vi.fn(() => ({ output: [] }));
    await expect(startCycleController(item, graph(), {
      eventStore: store,
      checkpointStore: checkpoints,
      checkpointEveryEvents: 5,
      lease: lease(),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    const tail = events(store, item).at(-1)!;
    expect(tail.type).toBe("DiscoveryCommitted");
    expect(checkpoints.writes).toBe(1);

    const result = await resumeCycleController(item, graph(), {
      eventStore: store,
      expectedSequence: tail.sequence,
      leaseReason: "takeover",
      lease: lease("lease-2", 2),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    });
    expect(result.exitReason).toBe("MAX_ITERATIONS");
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it("resumes a durably settled non-retryable failure by terminating without redispatch", async () => {
    const item = request("until-dry", { maxIterations: 2 });
    const store = new CommitThenThrowCycleStore("BudgetReservationSettled");
    const finder = vi.fn(() => {
      throw new CycleActivityFailure("GE_PERMANENT", "do not retry", { retryable: false });
    });
    await expect(startCycleController(item, graph(), {
      eventStore: store, lease: lease(), now: fixedNow(),
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    const tail = store.delegate.snapshot(item.eventStreamId).at(-1)!;
    expect(tail.type).toBe("BudgetReservationSettled");

    const result = await resumeCycleController(item, graph(), {
      eventStore: store,
      expectedSequence: tail.sequence,
      leaseReason: "takeover",
      lease: lease("failure-lease-2", 2),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    });
    expect(result).toMatchObject({ exitReason: "FAILED", status: "failed" });
    expect(finder).toHaveBeenCalledTimes(1);
    expect(store.delegate.snapshot(item.eventStreamId).filter(
      ({ type }) => type === "ActivityStarted",
    )).toHaveLength(1);
    expect((await replayCycleController(store, item.eventStreamId)).terminalObservation?.failureCode).toBe(
      "GE_PERMANENT",
    );
  });

  it("reuses an open idempotent activity claim and blocks non-idempotent in-doubt resume", async () => {
    const safe = request("until-dry", { maxIterations: 1 });
    const safeStore = new CommitThenThrowCycleStore("ActivityStarted");
    const safeFinder = vi.fn(() => ({ output: [] }));
    await expect(startCycleController(safe, graph(), {
      eventStore: safeStore, lease: lease(), now: fixedNow(),
      activities: { finder: safeFinder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    expect(safeFinder).not.toHaveBeenCalled();
    const safeTail = safeStore.delegate.snapshot(safe.eventStreamId).at(-1)!;
    await resumeCycleController(safe, graph(), {
      eventStore: safeStore,
      expectedSequence: safeTail.sequence,
      leaseReason: "takeover",
      lease: lease("safe-lease-2", 2),
      now: fixedNow(),
      activities: { finder: safeFinder, candidateEvaluator: () => ({ output: [] }) },
    });
    expect(safeFinder).toHaveBeenCalledTimes(1);
    expect(safeFinder.mock.calls[0]![0]).toMatchObject({ attempt: 1 });

    const unsafeBase = request("until-dry", { maxIterations: 1 });
    const unsafeMutable = JSON.parse(JSON.stringify(unsafeBase)) as CycleControllerRequest;
    (unsafeMutable.activities.finder as { sideEffects: string }).sideEffects = "non-idempotent";
    const unsafe = validateCycleControllerRequest(unsafeMutable);
    const unsafeStore = new CommitThenThrowCycleStore("ActivityStarted");
    const unsafeFinder = vi.fn(() => ({ output: [] }));
    await expect(startCycleController(unsafe, graph(), {
      eventStore: unsafeStore, lease: lease(), now: fixedNow(),
      activities: { finder: unsafeFinder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    const unsafeTail = unsafeStore.delegate.snapshot(unsafe.eventStreamId).at(-1)!;
    await expect(resumeCycleController(unsafe, graph(), {
      eventStore: unsafeStore,
      expectedSequence: unsafeTail.sequence,
      leaseReason: "takeover",
      lease: lease("unsafe-lease-2", 2),
      now: fixedNow(),
      activities: { finder: unsafeFinder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "IN_DOUBT_SIDE_EFFECT" });
    expect(unsafeFinder).not.toHaveBeenCalled();
  });

  it("coalesces ambiguous idempotent retries and clears the singleton on success", async () => {
    for (const exhausted of [false, true]) {
      const base = request("until-dry", { maxIterations: 1, maxTotalAttempts: 10 });
      const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
      const finderBinding = mutable.activities.finder as {
        sideEffects: string;
        maxAttemptsPerRound: number;
      };
      finderBinding.sideEffects = "idempotent";
      finderBinding.maxAttemptsPerRound = 2;
      const item = validateCycleControllerRequest(mutable);
      const store = new MemoryCycleControllerEventStore();
      let calls = 0;
      const finder = vi.fn(() => {
        calls += 1;
        if (calls === 1 || exhausted) {
          throw new CycleActivityFailure(
            "GE_ACTIVITY_FAILED",
            "ambiguous idempotent provider result",
            { retryable: calls < 2, inDoubt: true },
          );
        }
        return { output: [] };
      });

      const result = await startCycleController(item, graph(), {
        eventStore: store,
        lease: lease(`idempotent-singleton-${String(exhausted)}`, 1),
        now: fixedNow(),
        activities: { finder, candidateEvaluator: () => ({ output: [] }) },
      });
      const fold = await replayCycleController(store, item.eventStreamId);
      const starts = events(store, item).filter(
        ({ type, data }) => type === "ActivityStarted" && data.phase === "finder",
      );
      const failures = events(store, item).filter(({ type }) => type === "ActivityFailed");

      expect(finder).toHaveBeenCalledTimes(2);
      expect(starts.map(({ data }) => data.attempt)).toEqual([1, 2]);
      expect(starts[0]?.data.activityKey).toBe(starts[1]?.data.activityKey);
      if (exhausted) {
        expect(result).toMatchObject({ exitReason: "MAX_ITERATIONS", status: "bounded" });
        expect(failures).toHaveLength(2);
        expect(fold.terminalObservation).toMatchObject({ failed: true, failureCode: "GE_ACTIVITY_FAILED" });
        expect(fold.inDoubtActivities).toHaveLength(1);
        expect(fold.inDoubtActivities[0]).toMatchObject({ attempt: 2, sideEffects: "idempotent" });
      } else {
        expect(result).toMatchObject({ exitReason: "MAX_ITERATIONS", status: "bounded" });
        expect(failures).toHaveLength(1);
        expect(fold.inDoubtActivities).toEqual([]);
      }
    }
  });

  it("resolves one terminal in-doubt singleton under an authority-bound fence", async () => {
    const base = request("until-dry", { maxIterations: 1, maxTotalAttempts: 10 });
    const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
    const finderBinding = mutable.activities.finder as {
      sideEffects: string;
      maxAttemptsPerRound: number;
    };
    finderBinding.sideEffects = "idempotent";
    finderBinding.maxAttemptsPerRound = 2;
    const item = validateCycleControllerRequest(mutable);
    const store = new MemoryCycleControllerEventStore();
    const checkpointStore = new MemoryCycleControllerCheckpointStore();
    let calls = 0;
    const terminal = await startCycleController(item, graph(), {
      eventStore: store,
      lease: lease("resolution-source-lease", 1),
      now: fixedNow(),
      activities: {
        finder: () => {
          calls += 1;
          throw new CycleActivityFailure(
            "GE_ACTIVITY_FAILED",
            "ambiguous idempotent provider result",
            { retryable: calls < 2, inDoubt: true },
          );
        },
        candidateEvaluator: () => ({ output: [] }),
      },
    });
    const before = await replayCycleController(store, item.eventStreamId);
    expect(before.inDoubtActivities).toHaveLength(1);
    const activityKey = before.inDoubtActivities[0]!.activityKey;
    const resolutionLease: CycleLease = {
      leaseId: "resolution-lease-2",
      holderId: "operator-1",
      leaseEpoch: 2,
      fencingToken: 2,
      acquiredAt: new Date(START).toISOString(),
      expiresAt: new Date(START + 60_000).toISOString(),
    };
    const command: CycleInDoubtResolutionCommand = {
      apiVersion: "graphengineering.reacher-z.github.io/cycle-in-doubt-resolutions/v1alpha1",
      kind: "CycleInDoubtResolution",
      resolutionId: "resolution-1",
      controllerRunId: item.controllerRunId,
      controllerHash: before.controllerHash,
      requestHash: before.requestHash,
      eventStreamId: item.eventStreamId,
      expectedSequence: before.lastSequence,
      expectedHistoryPrefixHash: before.historyPrefixHash,
      activityKey,
      disposition: "confirmed-not-applied",
      evidenceHash: "5".repeat(64),
      authoritySnapshot: {
        principalHash: "6".repeat(64),
        grantHash: "7".repeat(64),
        policyHash: "8".repeat(64),
        leaseHolderHash: sha256Utf8(resolutionLease.holderId),
      },
    };
    const originalLength = events(store, item).length;

    await expect(resolveCycleInDoubtActivity(item, {
      ...command,
      activityKey: "9".repeat(64),
    }, {
      eventStore: store, lease: resolutionLease, now: fixedNow(),
    })).rejects.toMatchObject({ code: "GE_CYCLE_RESOLUTION_TARGET_MISMATCH" });
    await expect(resolveCycleInDoubtActivity(item, {
      ...command,
      expectedSequence: command.expectedSequence - 1,
    }, {
      eventStore: store, lease: resolutionLease, now: fixedNow(),
    })).rejects.toMatchObject({ code: "GE_CYCLE_RESOLUTION_STALE" });
    await expect(resolveCycleInDoubtActivity(item, command, {
      eventStore: store,
      lease: { ...resolutionLease, leaseEpoch: 1, fencingToken: 1 },
      now: fixedNow(),
    })).rejects.toMatchObject({ code: "GE_CYCLE_STALE_LEASE" });
    await expect(resolveCycleInDoubtActivity(item, command, {
      eventStore: store,
      lease: { ...resolutionLease, holderId: "different-operator" },
      now: fixedNow(),
    })).rejects.toMatchObject({ code: "GE_CYCLE_RESOLUTION_AUTHORITY_MISMATCH" });
    expect(events(store, item)).toHaveLength(originalLength);

    const resolved = await resolveCycleInDoubtActivity(item, command, {
      eventStore: store,
      checkpointStore,
      lease: resolutionLease,
      now: fixedNow(),
    });
    expect(resolved).toMatchObject({ duplicate: false });
    expect(resolved.commandHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(resolved.event.type).toBe("InDoubtActivityResolved");
    expect(resolved.fold.inDoubtActivities).toEqual([]);
    expect(resolved.fold.terminalResult).toEqual(terminal);
    expect(resolved.fold.durationMs).toBe(before.durationMs);
    expect(resolved.fold.activeLease).toBeNull();
    expect(resolved.fold.maxLeaseEpoch).toBe(2);
    expect(resolved.fold.maxFencingToken).toBe(2);
    expect(events(store, item)).toHaveLength(originalLength + 1);
    const checkpoint = await checkpointStore.read(
      item.checkpointScope,
      `${item.controllerRunId}-latest`,
    );
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.lastSequence).toBe(resolved.event.sequence);
    expect(checkpoint?.historyPrefixHash).toBe(resolved.event.recordHash);
    expect(checkpoint?.lease).toBeNull();
    expect(checkpoint?.state.inDoubtActivities).toEqual([]);
    expect(checkpoint?.state.terminalResult).toEqual(terminal);

    const duplicate = await resolveCycleInDoubtActivity(item, command, {
      eventStore: store,
      lease: lease("ignored-duplicate-lease", 1),
      now: () => {
        throw new Error("duplicate replay must not sample the clock");
      },
    });
    expect(duplicate).toMatchObject({ duplicate: true, commandHash: resolved.commandHash });
    expect(duplicate.event.recordHash).toBe(resolved.event.recordHash);
    expect(events(store, item)).toHaveLength(originalLength + 1);
    await expect(resolveCycleInDoubtActivity(item, {
      ...command,
      disposition: "confirmed-applied",
    }, {
      eventStore: store, lease: lease("unused-conflict-lease", 3), now: fixedNow(),
    })).rejects.toMatchObject({ code: "GE_CYCLE_RESOLUTION_CONFLICT" });

    const resumedFinder = vi.fn(() => ({ output: [] }));
    await expect(resumeCycleController(item, graph(), {
      eventStore: store,
      expectedSequence: resolved.event.sequence,
      lease: lease("terminal-read-lease", 3),
      now: fixedNow(),
      activities: { finder: resumedFinder, candidateEvaluator: () => ({ output: [] }) },
    })).resolves.toEqual(terminal);
    expect(resumedFinder).not.toHaveBeenCalled();
  });

  it("rejects terminal resolution against an interrupted nonterminal claim", async () => {
    const base = request("until-dry", { maxIterations: 1 });
    const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
    (mutable.activities.finder as { sideEffects: string }).sideEffects = "non-idempotent";
    const item = validateCycleControllerRequest(mutable);
    const store = new CommitThenThrowCycleStore("ActivityStarted", "finder");
    await expect(startCycleController(item, graph(), {
      eventStore: store,
      lease: lease("open-resolution-source", 1),
      now: fixedNow(),
      activities: {
        finder: () => ({
          output: suffix === "sibling"
            ? [{ key: "sibling-only", value: { source: "sibling" } }]
            : [],
        }),
        candidateEvaluator: () => ({
          output: suffix === "sibling"
            ? [{ key: "sibling-only", verdict: "accept" as const }]
            : [],
        }),
      },
    })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    const fold = await replayCycleController(store, item.eventStreamId);
    const activityKey = fold.openRound?.openActivity?.activityKey;
    expect(activityKey).toMatch(/^[0-9a-f]{64}$/u);
    const resolutionLease: CycleLease = {
      leaseId: "nonterminal-resolution-lease",
      holderId: "operator-1",
      leaseEpoch: 2,
      fencingToken: 2,
      acquiredAt: new Date(START).toISOString(),
      expiresAt: new Date(START + 60_000).toISOString(),
    };
    const command: CycleInDoubtResolutionCommand = {
      apiVersion: "graphengineering.reacher-z.github.io/cycle-in-doubt-resolutions/v1alpha1",
      kind: "CycleInDoubtResolution",
      resolutionId: "resolution-nonterminal",
      controllerRunId: item.controllerRunId,
      controllerHash: fold.controllerHash,
      requestHash: fold.requestHash,
      eventStreamId: item.eventStreamId,
      expectedSequence: fold.lastSequence,
      expectedHistoryPrefixHash: fold.historyPrefixHash,
      activityKey: activityKey as string,
      disposition: "confirmed-not-applied",
      evidenceHash: "5".repeat(64),
      authoritySnapshot: {
        principalHash: "6".repeat(64),
        grantHash: "7".repeat(64),
        policyHash: "8".repeat(64),
        leaseHolderHash: sha256Utf8(resolutionLease.holderId),
      },
    };
    const length = store.delegate.snapshot(item.eventStreamId).length;
    await expect(resolveCycleInDoubtActivity(item, command, {
      eventStore: store, lease: resolutionLease, now: fixedNow(),
    })).rejects.toMatchObject({ code: "GE_CYCLE_RESOLUTION_NOT_TERMINAL" });
    expect(store.delegate.snapshot(item.eventStreamId)).toHaveLength(length);
  });

  it("charges an unproven external claim when an already-cancelled resume terminates", async () => {
    const base = request("until-dry", {
      maxIterations: 1,
      maxTotalAttempts: 4,
      maxCostUsd: 2,
    });
    const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
    const finderBinding = mutable.activities.finder as {
      sideEffects: string;
      maxCostUsdPerAttempt: number;
    };
    finderBinding.sideEffects = "idempotent";
    finderBinding.maxCostUsdPerAttempt = 1;
    const item = validateCycleControllerRequest(mutable);
    const store = new CommitThenThrowCycleStore("ActivityStarted");
    const finder = vi.fn(() => ({ output: [] }));

    await expect(startCycleController(item, graph(), {
      eventStore: store,
      lease: lease("cancel-open-lease-1", 1),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    expect(finder).not.toHaveBeenCalled();

    const abort = new AbortController();
    abort.abort(new Error("cancel before recovery dispatch"));
    const tail = store.delegate.snapshot(item.eventStreamId).at(-1)!;
    const result = await resumeCycleController(item, graph(), {
      eventStore: store,
      expectedSequence: tail.sequence,
      leaseReason: "takeover",
      lease: lease("cancel-open-lease-2", 2),
      now: fixedNow(),
      signal: abort.signal,
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    });

    expect(result).toMatchObject({
      exitReason: "CANCELLED",
      attemptsUsed: 1,
      costUsd: 1,
    });
    expect(finder).not.toHaveBeenCalled();
    const settlement = store.delegate.snapshot(item.eventStreamId).find(
      ({ type }) => type === "BudgetReservationSettled",
    );
    expect(settlement?.data).toMatchObject({
      phase: "finder",
      committed: { attempts: 1, costUsd: 1, dynamicNodes: 0 },
    });
    expect((await replayCycleController(store, item.eventStreamId)).terminalResult).toEqual(result);
  });

  it("cancels a handler that swallows abort without committing its late result", async () => {
    const base = request("until-dry", { maxIterations: 2 });
    const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
    (mutable.activities.finder as { maxCostUsdPerAttempt: number }).maxCostUsdPerAttempt = 0.25;
    const item = validateCycleControllerRequest(mutable);
    const store = new MemoryCycleControllerEventStore();
    const abort = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const finder = vi.fn(() => {
      entered();
      return new Promise<{ output: readonly [] }>(() => undefined);
    });
    const evaluator = vi.fn(() => ({ output: [] }));
    const running = startCycleController(item, graph(), {
      eventStore: store, lease: lease(), now: fixedNow(), signal: abort.signal,
      activities: { finder, candidateEvaluator: evaluator },
    });
    await started;
    abort.abort(new Error("stop"));
    const result = await running;
    expect(result).toMatchObject({
      exitReason: "CANCELLED", status: "cancelled", attemptsUsed: 1, costUsd: 0.25,
    });
    expect(evaluator).not.toHaveBeenCalled();
    expect(events(store, item).map(({ type }) => type)).not.toContain("DiscoveryCommitted");
    expect(events(store, item).map(({ type }) => type)).not.toContain("ActivityFailed");
    const fold = await replayCycleController(store, item.eventStreamId);
    expect(fold).toMatchObject({ terminalResult: { exitReason: "CANCELLED" } });
    expect(fold.inDoubtActivities).toEqual([]);
  });

  it.each([
    ["none", 2, 0.5, 0],
    ["idempotent", 2, 0.5, 1],
    ["non-idempotent", 1, 0.25, 1],
  ] as const)(
    "charges and retries timed-out %s activity claims exactly",
    async (sideEffects, expectedAttempts, expectedCost, expectedInDoubt) => {
      const base = request("until-dry", { maxIterations: 2 });
      const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
      const finderBinding = mutable.activities.finder as {
        sideEffects: CycleActivityBinding["sideEffects"];
        maxAttemptsPerRound: number;
        maxCostUsdPerAttempt: number;
        timeoutMs: number;
      };
      finderBinding.sideEffects = sideEffects;
      finderBinding.maxAttemptsPerRound = 2;
      finderBinding.maxCostUsdPerAttempt = 0.25;
      finderBinding.timeoutMs = 1;
      const item = validateCycleControllerRequest(mutable);
      const store = new MemoryCycleControllerEventStore();
      const finder = vi.fn(() => new Promise<{ output: readonly [] }>(() => undefined));

      const result = await startCycleController(item, graph(), {
        eventStore: store,
        lease: lease(`lease-timeout-${sideEffects}`, 1),
        now: fixedNow(),
        activities: { finder, candidateEvaluator: () => ({ output: [] }) },
      });
      const failures = events(store, item).filter(({ type }) => type === "ActivityFailed");
      const fold = await replayCycleController(store, item.eventStreamId);

      expect(result).toMatchObject({
        exitReason: "FAILED",
        status: "failed",
        attemptsUsed: expectedAttempts,
        costUsd: expectedCost,
      });
      expect(finder).toHaveBeenCalledTimes(expectedAttempts);
      expect(failures).toHaveLength(expectedAttempts);
      expect(failures.every(({ data }) => (
        data.failure.code === "GE_CYCLE_ACTIVITY_TIMEOUT"
        && data.usage.costUsd === 0.25
      ))).toBe(true);
      expect(fold.inDoubtActivities).toHaveLength(expectedInDoubt);
      expect(fold.terminalObservation?.failureCode).toBe("GE_CYCLE_ACTIVITY_TIMEOUT");
      expect(fold.terminalResult).toEqual(result);
    },
  );

  it("rejects stale lease reacquisition before CAS and terminal resume dispatches nothing", async () => {
    const item = request("until-dry", { maxIterations: 1 });
    const crashed = new CommitThenThrowCycleStore("RoundReserved");
    const finder = vi.fn(() => ({ output: [] }));
    await expect(startCycleController(item, graph(), {
      eventStore: crashed, lease: lease(), now: fixedNow(),
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    const before = crashed.delegate.snapshot(item.eventStreamId);
    await expect(resumeCycleController(item, graph(), {
      eventStore: crashed,
      expectedSequence: before.at(-1)!.sequence,
      leaseReason: "resume",
      lease: lease("lease-2", 2),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toBeInstanceOf(CycleControllerError);
    expect(crashed.delegate.snapshot(item.eventStreamId)).toEqual(before);

    const takeover = await resumeCycleController(item, graph(), {
      eventStore: crashed,
      expectedSequence: before.at(-1)!.sequence,
      leaseReason: "takeover",
      lease: lease("lease-3", 3),
      now: fixedNow(),
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    });
    const terminalCalls = finder.mock.calls.length;
    const replayed = await resumeCycleController(item, graph(), {
      eventStore: crashed,
      expectedSequence: crashed.delegate.snapshot(item.eventStreamId).at(-1)!.sequence,
      lease: lease("lease-4", 4),
      now: () => { throw new Error("terminal resume must not read clock"); },
      activities: {
        finder: () => { throw new Error("terminal resume must not dispatch"); },
        candidateEvaluator: () => { throw new Error("terminal resume must not dispatch"); },
      },
    });
    expect(replayed).toEqual(takeover);
    expect(finder).toHaveBeenCalledTimes(terminalCalls);
  });

  it("preflights every locally built event so a duplicate event ID never reaches CAS", async () => {
    const item = request("until-dry", { maxIterations: 1 });
    const store = new CountingCycleStore();
    const finder = vi.fn(() => ({ output: [] }));
    await expect(startCycleController(item, graph(), {
      eventStore: store,
      lease: lease(),
      now: fixedNow(),
      createEventId: () => "same-event-id",
      activities: { finder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "GE_CYCLE_INVALID_HISTORY" });
    expect(store.appends).toBe(1);
    expect(store.delegate.snapshot(item.eventStreamId).map(({ type }) => type)).toEqual(["ControllerCreated"]);
    expect(finder).not.toHaveBeenCalled();
  });

  it("normalizes malicious failure usage and derives non-idempotent in-doubt status", async () => {
    for (const [index, badCost] of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1].entries()) {
      const base = request("until-dry", { maxIterations: 2, maxTotalAttempts: 10 });
      const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
      (mutable.activities.finder as { sideEffects: string; maxAttemptsPerRound: number }).sideEffects = "non-idempotent";
      (mutable.activities.finder as { sideEffects: string; maxAttemptsPerRound: number }).maxAttemptsPerRound = 2;
      const item = validateCycleControllerRequest(mutable);
      const store = new MemoryCycleControllerEventStore();
      const finder = vi.fn(() => {
        throw new CycleActivityFailure("GE_ATTACKER_CODE", "forged envelope", {
          retryable: true, inDoubt: false, costUsd: badCost,
        });
      });
      const result = await startCycleController(item, graph(), {
        eventStore: store, lease: lease(`lease-malicious-${index}`, 1), now: fixedNow(),
        activities: { finder, candidateEvaluator: () => ({ output: [] }) },
      });
      expect(result.exitReason).toBe("FAILED");
      expect(finder).toHaveBeenCalledTimes(1);
      const failure = events(store, item).find(({ type }) => type === "ActivityFailed")!;
      expect(failure.data).toMatchObject({
        failure: { code: "GE_CYCLE_INVALID_ACTIVITY_OUTPUT", retryable: false, inDoubt: true },
        usage: { attempts: 1, costUsd: 0 },
      });
      expect((await replayCycleController(store, item.eventStreamId)).terminalResult).toEqual(result);
    }
  });

  it("retains the reserved cost ceiling for malformed in-doubt external failures", async () => {
    for (const [index, sideEffects] of ["idempotent", "non-idempotent"].entries()) {
      const base = request("until-dry", {
        maxIterations: 2,
        maxTotalAttempts: 10,
        maxCostUsd: 4,
      });
      const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
      const finderBinding = mutable.activities.finder as {
        sideEffects: string;
        maxAttemptsPerRound: number;
        maxCostUsdPerAttempt: number;
      };
      finderBinding.sideEffects = sideEffects;
      finderBinding.maxAttemptsPerRound = 1;
      finderBinding.maxCostUsdPerAttempt = 1;
      const item = validateCycleControllerRequest(mutable);
      const store = new MemoryCycleControllerEventStore();
      const finder = vi.fn(() => {
        throw new CycleActivityFailure("GE_ATTACKER_CODE", "forged cost", {
          retryable: true,
          inDoubt: false,
          costUsd: Number.POSITIVE_INFINITY,
        });
      });

      const result = await startCycleController(item, graph(), {
        eventStore: store,
        lease: lease(`lease-in-doubt-cost-${index}`, 1),
        now: fixedNow(),
        activities: { finder, candidateEvaluator: () => ({ output: [] }) },
      });

      expect(result).toMatchObject({
        exitReason: "FAILED",
        attemptsUsed: 1,
        costUsd: 1,
      });
      expect(finder).toHaveBeenCalledTimes(1);
      const failure = events(store, item).find(({ type }) => type === "ActivityFailed")!;
      expect(failure.data).toMatchObject({
        failure: {
          code: "GE_CYCLE_INVALID_ACTIVITY_OUTPUT",
          retryable: false,
          inDoubt: true,
        },
        usage: { attempts: 1, costUsd: 1 },
      });
      const settlement = events(store, item).find(({ type }) => type === "BudgetReservationSettled");
      expect(settlement?.data).toMatchObject({
        phase: "finder",
        committed: { attempts: 1, costUsd: 1, dynamicNodes: 0 },
      });
      expect((await replayCycleController(store, item.eventStreamId)).terminalResult).toEqual(result);
    }
  });

  it("settles finder, evaluator, mode, and patch semantic-output failures into valid terminal histories", async () => {
    const scenarios: {
      readonly item: CycleControllerRequest;
      readonly activities: CycleControllerActivities;
      readonly patchContext?: NonNullable<Parameters<typeof startCycleController>[2]["patchContext"]>;
    }[] = [];
    scenarios.push({
      item: request("until-dry", { maxIterations: 2 }),
      activities: {
        finder: () => ({ output: [{ key: "bad", value: null, injected: true }] as never }),
        candidateEvaluator: () => ({ output: [] }),
      },
    });
    scenarios.push({
      item: request("until-dry", { maxIterations: 2 }),
      activities: {
        finder: () => ({ output: [{ key: "fresh", value: true }] }),
        candidateEvaluator: () => ({ output: [] }),
      },
    });
    scenarios.push({
      item: request("while", { maxIterations: 2 }),
      activities: {
        finder: () => ({ output: [] }),
        candidateEvaluator: () => ({ output: [] }),
        condition: () => ({ output: "not-boolean" as never }),
      },
    });
    const patchBase = request("until-dry", { maxIterations: 2 });
    const patchMutable = JSON.parse(JSON.stringify(patchBase)) as CycleControllerRequest;
    (patchMutable.policy as { maxDynamicNodes: number }).maxDynamicNodes = 2;
    (patchMutable.activities as { patchPlanner: CycleActivityBinding | null }).patchPlanner = binding("patch-planner", "idempotent");
    (patchMutable.patches as { enabled: boolean; limits: unknown }).enabled = true;
    (patchMutable.patches as { enabled: boolean; limits: unknown }).limits = {
      maxNodes: 10, maxEdges: 20, maxOutputs: 10, maxDepth: 10, maxFanOut: 10,
    };
    const patchItem = validateCycleControllerRequest(patchMutable);
    scenarios.push({
      item: patchItem,
      activities: {
        finder: () => ({ output: [] }),
        candidateEvaluator: () => ({ output: [] }),
        patchPlanner: () => ({ output: { malicious: true } as never }),
        shouldPlanPatch: () => true,
      },
      patchContext: {
        authoritySnapshot: {
          proposerActivityKey: "a".repeat(64), principalHash: "a".repeat(64),
          proposerGrantHash: "a".repeat(64), runGrantHash: "a".repeat(64),
          tenantGrantHash: "a".repeat(64), deploymentGrantHash: "a".repeat(64),
          effectiveGrantHash: "a".repeat(64), policyHash: "b".repeat(64), approvalHash: null,
        },
        policySnapshotHash: "b".repeat(64),
        runState: "active",
        effectiveCapabilities: [],
        succeededNodeIds: ["root"],
        supportedEdgeModes: ["value"],
      },
    });

    for (const [index, scenario] of scenarios.entries()) {
      const store = new MemoryCycleControllerEventStore();
      const result = await startCycleController(scenario.item, graph(), {
        eventStore: store,
        lease: lease(`lease-output-${index}`, 1),
        now: fixedNow(),
        activities: scenario.activities,
        ...(scenario.patchContext === undefined ? {} : { patchContext: scenario.patchContext }),
      });
      expect(result).toMatchObject({ exitReason: "FAILED", status: "failed" });
      expect(events(store, scenario.item).some(({ type }) => type === "ActivityFailed")).toBe(true);
      expect((await replayCycleController(store, scenario.item.eventStreamId)).terminalResult).toEqual(result);
    }
  });

  it("settles deterministic routing and post-planner authority/context failures without extra dispatch", async () => {
    const patchRequest = (): CycleControllerRequest => {
      const base = request("until-dry", { maxIterations: 2 });
      const mutable = JSON.parse(JSON.stringify(base)) as CycleControllerRequest;
      (mutable.policy as { maxDynamicNodes: number }).maxDynamicNodes = 1;
      (mutable.activities as { patchPlanner: CycleActivityBinding | null }).patchPlanner = binding(
        "patch-planner", "idempotent",
      );
      (mutable.patches as { enabled: boolean; limits: unknown }).enabled = true;
      (mutable.patches as { enabled: boolean; limits: unknown }).limits = {
        maxNodes: 2, maxEdges: 1, maxOutputs: 2, maxDepth: 2, maxFanOut: 1,
      };
      return validateCycleControllerRequest(mutable);
    };
    const proposal = (item: CycleControllerRequest) => ({
      apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1" as const,
      kind: "GraphPatch" as const,
      patchId: `patch-${item.controllerRunId}`,
      base: item.initialGraph,
      append: {
        nodes: [{
          id: "child", kind: "transform", inputSchema: {}, outputSchema: {}, config: {}, sideEffects: "none" as const,
        }],
        edges: [{ id: "root-child", from: { node: "root" }, to: { node: "child" }, mode: "value" as const }],
        outputs: { child: { node: "child" } },
      },
    });

    const routed = patchRequest();
    const routedStore = new MemoryCycleControllerEventStore();
    const routedPlanner = vi.fn(() => ({ output: proposal(routed) }));
    const routedResult = await startCycleController(routed, graph(), {
      eventStore: routedStore, lease: lease("route-failure", 1), now: fixedNow(),
      activities: {
        finder: () => ({ output: [] }),
        candidateEvaluator: () => ({ output: [] }),
        patchPlanner: routedPlanner,
        shouldPlanPatch: () => { throw new Error("router failed"); },
      },
    });
    const routedFold = await replayCycleController(routedStore, routed.eventStreamId);
    expect(routedResult).toMatchObject({ exitReason: "FAILED", status: "failed" });
    expect(routedPlanner).not.toHaveBeenCalled();
    expect(routedFold.terminalObservation?.failureCode).toBe("GE_CYCLE_ACTIVITY_FAILED");
    expect(routedFold.liveReservations).toEqual([]);
    expect(events(routedStore, routed).filter(({ type }) => type === "ActivityStarted")).toHaveLength(2);

    for (const invalidPolicyHash of [false, true]) {
      const item = patchRequest();
      const store = new MemoryCycleControllerEventStore();
      const authority = {
        proposerActivityKey: "a".repeat(64), principalHash: "a".repeat(64),
        proposerGrantHash: "a".repeat(64), runGrantHash: "a".repeat(64),
        tenantGrantHash: "a".repeat(64), deploymentGrantHash: "a".repeat(64),
        effectiveGrantHash: "a".repeat(64), policyHash: "b".repeat(64), approvalHash: null,
      };
      const planner = vi.fn((activity: Parameters<CycleControllerActivities["finder"]>[0]) => {
        if (invalidPolicyHash) authority.proposerActivityKey = activity.activityKey;
        return { output: proposal(item) };
      });
      const result = await startCycleController(item, graph(), {
        eventStore: store, lease: lease(`post-planner-${String(invalidPolicyHash)}`, 1), now: fixedNow(),
        activities: {
          finder: () => ({ output: [] }),
          candidateEvaluator: () => ({ output: [] }),
          patchPlanner: planner,
          shouldPlanPatch: () => true,
        },
        patchContext: {
          authoritySnapshot: authority,
          policySnapshotHash: invalidPolicyHash ? "invalid" : "b".repeat(64),
          runState: "active",
          effectiveCapabilities: [],
          succeededNodeIds: ["root"],
          supportedEdgeModes: ["value"],
        },
      });
      const fold = await replayCycleController(store, item.eventStreamId);
      expect(result).toMatchObject({ exitReason: "FAILED", status: "failed" });
      expect(planner).toHaveBeenCalledTimes(1);
      expect(fold.liveReservations).toEqual([]);
      expect(events(store, item).filter(({ type }) => type === "ActivityStarted")).toHaveLength(3);
      expect(events(store, item).filter(({ type }) => type === "ActivityFailed")).toHaveLength(1);
      expect(events(store, item).some(({ type }) => type === "PatchAccepted" || type === "PatchRejected")).toBe(false);
      expect(fold.terminalObservation?.failureCode).toBe(
        invalidPolicyHash ? "GE_PATCH_INVALID" : "GE_PATCH_AUTHORITY_EXPANSION",
      );
    }
  });

  it("forks from one immutable parent prefix without mutating parent history", async () => {
    const parentRequest = request("until-dry", { maxIterations: 1 });
    const parentStore = new MemoryCycleControllerEventStore();
    let parentClockCalls = 0;
    await startCycleController(parentRequest, graph(), {
      eventStore: parentStore, lease: lease("parent-lease", 1),
      now: () => new Date(parentClockCalls++ === 0 ? START : START + 25),
      activities: { finder: () => ({ output: [] }), candidateEvaluator: () => ({ output: [] }) },
    });
    const parentFold = await replayCycleController(parentStore, parentRequest.eventStreamId);
    const parentBytes = JSON.stringify(parentStore.snapshot(parentRequest.eventStreamId));

    const childBase = request("until-dry", { maxIterations: 3, consecutiveDryRounds: 2 });
    const child = validateCycleControllerRequest({
      ...JSON.parse(JSON.stringify(childBase)),
      initialGraph: parentFold.currentRevision,
      lineage: {
        origin: "fork",
        parentControllerRunId: parentRequest.controllerRunId,
        parentSequence: parentFold.lastSequence,
        parentHistoryHash: parentFold.historyPrefixHash,
      },
    });
    const childStore = new MemoryCycleControllerEventStore();
    const result = await forkCycleController(
      parentStore, parentRequest.eventStreamId, child, graph(), {
        eventStore: childStore, lease: lease("child-lease", 1), now: fixedNow(),
        activities: { finder: () => ({ output: [] }), candidateEvaluator: () => ({ output: [] }) },
      },
    );
    expect(result).toMatchObject({
      exitReason: "DRY", iterations: 2, consecutiveDryRounds: 2, durationMs: 25,
    });
    expect(JSON.stringify(parentStore.snapshot(parentRequest.eventStreamId))).toBe(parentBytes);
    expect((await replayCycleController(childStore, child.eventStreamId, undefined, { parent: parentFold })).request.lineage).toEqual(
      child.lineage,
    );

    const forgedParent = {
      ...parentFold,
      attemptsUsed: 0,
      costUsd: 0,
      dynamicNodes: 0,
    };
    await expect(replayCycleController(
      childStore,
      child.eventStreamId,
      0,
      { parent: forgedParent },
    )).rejects.toMatchObject({ code: "GE_CYCLE_INVALID_HISTORY" });
  });

  it.each(["idempotent", "non-idempotent"] as const)(
    "persists inherited %s in-doubt status in a fork before any child dispatch",
    async (sideEffects) => {
      const parentBase = request("until-dry", { maxIterations: 2 });
      const parentMutable = JSON.parse(JSON.stringify(parentBase)) as CycleControllerRequest;
      (parentMutable.activities.finder as { sideEffects: string }).sideEffects = sideEffects;
      const parentRequest = validateCycleControllerRequest(parentMutable);
      const parentStore = new CommitThenThrowCycleStore("ActivityStarted", "finder");
      const parentFinder = vi.fn(() => ({ output: [] }));
      await expect(startCycleController(parentRequest, graph(), {
        eventStore: parentStore, lease: lease("fork-parent-lease", 1), now: fixedNow(),
        activities: { finder: parentFinder, candidateEvaluator: () => ({ output: [] }) },
      })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
      expect(parentFinder).not.toHaveBeenCalled();
      const parentFold = await replayCycleController(parentStore, parentRequest.eventStreamId);
      expect(parentFold.openRound?.openActivity?.sideEffects).toBe(sideEffects);

      const childBase = request("until-dry", { maxIterations: 3 });
      const child = validateCycleControllerRequest({
        ...JSON.parse(JSON.stringify(childBase)),
        initialGraph: parentFold.currentRevision,
        lineage: {
          origin: "fork",
          parentControllerRunId: parentRequest.controllerRunId,
          parentSequence: parentFold.lastSequence,
          parentHistoryHash: parentFold.historyPrefixHash,
        },
      });
      const childStore = new MemoryCycleControllerEventStore();
      const childFinder = vi.fn(() => ({ output: [] }));
      await expect(forkCycleController(
        parentStore, parentRequest.eventStreamId, child, graph(), {
          eventStore: childStore, lease: lease("fork-child-lease", 1), now: fixedNow(),
          activities: { finder: childFinder, candidateEvaluator: () => ({ output: [] }) },
        },
      )).rejects.toMatchObject({ code: "IN_DOUBT_SIDE_EFFECT" });
      expect(childFinder).not.toHaveBeenCalled();
      expect(childStore.snapshot(child.eventStreamId).map(({ type }) => type)).toEqual(["ControllerCreated"]);
      const childFold = await replayCycleController(
        childStore, child.eventStreamId, undefined, { parent: parentFold },
      );
      expect(childFold.inDoubtActivities).toHaveLength(1);
      expect(childFold.inDoubtActivities[0]?.sideEffects).toBe(sideEffects);
    },
  );

  it("fails before mutation when the trusted clock rolls back or event ID creation fails", async () => {
    const rollback = request("until-dry", { maxIterations: 1 });
    const rollbackStore = new MemoryCycleControllerEventStore();
    let clockCalls = 0;
    await expect(startCycleController(rollback, graph(), {
      eventStore: rollbackStore,
      lease: lease(),
      now: () => new Date(clockCalls++ === 0 ? START : START - 1),
      activities: { finder: () => ({ output: [] }), candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "GE_CYCLE_INVALID_HISTORY" });
    expect(events(rollbackStore, rollback).map(({ type }) => type)).toEqual(["ControllerCreated"]);

    const badId = request("until-dry", { maxIterations: 1 });
    const badIdStore = new MemoryCycleControllerEventStore();
    await expect(startCycleController(badId, graph(), {
      eventStore: badIdStore,
      lease: lease(),
      now: fixedNow(),
      createEventId: () => { throw new Error("entropy unavailable"); },
      activities: { finder: () => ({ output: [] }), candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    expect(events(badIdStore, badId)).toEqual([]);
  });

  it("enforces inclusive duration, cost, attempt, discovery, and dynamic-node hard stops", async () => {
    const duration = request("until-dry", { maxIterations: 2, maxDurationMs: 10 });
    let durationClockCalls = 0;
    const durationFinder = vi.fn(() => ({ output: [] }));
    const durationResult = await startCycleController(duration, graph(), {
      eventStore: new MemoryCycleControllerEventStore(), lease: lease(),
      now: () => new Date(durationClockCalls++ === 0 ? START : START + 10),
      activities: { finder: durationFinder, candidateEvaluator: () => ({ output: [] }) },
    });
    expect(durationResult).toMatchObject({ exitReason: "MAX_DURATION", iterations: 0 });
    expect(durationFinder).not.toHaveBeenCalled();

    const costBase = request("until-dry", { maxIterations: 2, maxCostUsd: 2 });
    const costMutable = JSON.parse(JSON.stringify(costBase)) as CycleControllerRequest;
    (costMutable.activities.finder as { maxCostUsdPerAttempt: number }).maxCostUsdPerAttempt = 1;
    (costMutable.activities.candidateEvaluator as { maxCostUsdPerAttempt: number }).maxCostUsdPerAttempt = 1;
    const costAtLimit = validateCycleControllerRequest(costMutable);
    const costResult = await startCycleController(costAtLimit, graph(), {
      eventStore: new MemoryCycleControllerEventStore(), lease: lease(), now: fixedNow(),
      activities: {
        finder: () => ({ output: [], costUsd: 1 }),
        candidateEvaluator: () => ({ output: [], costUsd: 1 }),
      },
    });
    expect(costResult).toMatchObject({ exitReason: "MAX_COST", costUsd: 2 });

    const costOverMutable = JSON.parse(JSON.stringify(costAtLimit)) as CycleControllerRequest;
    (costOverMutable.policy as { maxCostUsd: number }).maxCostUsd = 1.5;
    const costOver = validateCycleControllerRequest(costOverMutable);
    const costOverFinder = vi.fn(() => ({ output: [], costUsd: 1 }));
    const costOverResult = await startCycleController(costOver, graph(), {
      eventStore: new MemoryCycleControllerEventStore(), lease: lease(), now: fixedNow(),
      activities: { finder: costOverFinder, candidateEvaluator: () => ({ output: [], costUsd: 1 }) },
    });
    expect(costOverResult).toMatchObject({ exitReason: "MAX_COST", attemptsUsed: 0 });
    expect(costOverFinder).not.toHaveBeenCalled();

    const attempts = request("until-dry", { maxIterations: 2, maxTotalAttempts: 2 });
    const attemptResult = await startCycleController(attempts, graph(), {
      eventStore: new MemoryCycleControllerEventStore(), lease: lease(), now: fixedNow(),
      activities: { finder: () => ({ output: [] }), candidateEvaluator: () => ({ output: [] }) },
    });
    expect(attemptResult).toMatchObject({ exitReason: "MAX_TOTAL_ATTEMPTS", attemptsUsed: 2 });

    const discovery = request("until-dry", { maxIterations: 2, maxDiscoveries: 1 });
    const discoveryResult = await startCycleController(discovery, graph(), {
      eventStore: new MemoryCycleControllerEventStore(), lease: lease(), now: fixedNow(),
      activities: {
        finder: () => ({ output: [{ key: "only", value: true }] }),
        candidateEvaluator: () => ({ output: [{ key: "only", verdict: "unknown" }] }),
      },
    });
    expect(discoveryResult).toMatchObject({ exitReason: "MAX_DISCOVERIES", seenCount: 1 });

    const simultaneous = request("while", { maxIterations: 2, maxDiscoveries: 1 });
    const simultaneousResult = await startCycleController(simultaneous, graph(), {
      eventStore: new MemoryCycleControllerEventStore(), lease: lease(), now: fixedNow(),
      activities: {
        finder: () => ({ output: [{ key: "limit-and-converge", value: true }] }),
        candidateEvaluator: () => ({ output: [{ key: "limit-and-converge", verdict: "accept" }] }),
        condition: () => ({ output: false }),
      },
    });
    expect(simultaneousResult).toMatchObject({
      exitReason: "MAX_DISCOVERIES", seenCount: 1,
    });

    const dynamicBase = request("until-dry", { maxIterations: 2 });
    const dynamicMutable = JSON.parse(JSON.stringify(dynamicBase)) as CycleControllerRequest;
    (dynamicMutable.policy as { maxDynamicNodes: number }).maxDynamicNodes = 1;
    (dynamicMutable.activities as { patchPlanner: CycleActivityBinding | null }).patchPlanner = binding("patch-planner", "idempotent");
    (dynamicMutable.patches as { enabled: boolean; limits: unknown }).enabled = true;
    (dynamicMutable.patches as { enabled: boolean; limits: unknown }).limits = {
      maxNodes: 2, maxEdges: 1, maxOutputs: 2, maxDepth: 2, maxFanOut: 1,
    };
    const dynamic = validateCycleControllerRequest(dynamicMutable);
    const dynamicAuthority = {
      proposerActivityKey: "a".repeat(64), principalHash: "a".repeat(64),
      proposerGrantHash: "a".repeat(64), runGrantHash: "a".repeat(64),
      tenantGrantHash: "a".repeat(64), deploymentGrantHash: "a".repeat(64),
      effectiveGrantHash: "a".repeat(64), policyHash: "b".repeat(64), approvalHash: null,
    };
    const dynamicResult = await startCycleController(dynamic, graph(), {
      eventStore: new MemoryCycleControllerEventStore(), lease: lease(), now: fixedNow(),
      activities: {
        finder: () => ({ output: [] }),
        candidateEvaluator: () => ({ output: [] }),
        patchPlanner: (activity) => {
          dynamicAuthority.proposerActivityKey = activity.activityKey;
          return { output: {
            apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1",
            kind: "GraphPatch",
            patchId: "dynamic-bound",
            base: dynamic.initialGraph,
            append: {
              nodes: [{ id: "child", kind: "transform", inputSchema: {}, outputSchema: {}, config: {}, sideEffects: "none" }],
              edges: [{ id: "root-child", from: { node: "root" }, to: { node: "child" }, mode: "value" }],
              outputs: { child: { node: "child" } },
            },
          } };
        },
        shouldPlanPatch: () => true,
      },
      patchContext: {
        authoritySnapshot: dynamicAuthority,
        policySnapshotHash: "b".repeat(64), runState: "active", effectiveCapabilities: [],
        succeededNodeIds: ["root"], supportedEdgeModes: ["value"],
      },
    });
    expect(dynamicResult).toMatchObject({ exitReason: "MAX_DYNAMIC_NODES", dynamicNodes: 1 });
  });
});

describe("cycle-controller lineage manifests", () => {
  async function forkFrom(
    store: MemoryCycleControllerEventStore,
    parentRequest: CycleControllerRequest,
    parentSequence: number,
    parentHistoryHash: string,
    suffix: string,
    dryRounds: number,
  ): Promise<CycleControllerRequest> {
    const parentFold = await replayCycleController(
      store,
      parentRequest.eventStreamId,
      parentSequence,
      parentRequest.lineage.origin === "start"
        ? {}
        : { parent: (await replayCycleControllerLineageManifest(
          await exportCycleControllerLineageManifest(store, parentRequest.eventStreamId),
        )).folds.at(-2) },
    );
    const base = request("until-dry", {
      maxIterations: Math.max(parentFold.nextIteration + 2, 4),
      consecutiveDryRounds: dryRounds,
    });
    const child = validateCycleControllerRequest({
      ...JSON.parse(JSON.stringify(base)),
      controllerRunId: `${base.controllerRunId}-${suffix}`,
      controllerId: `${base.controllerId}-${suffix}`,
      eventStreamId: `${base.eventStreamId}-${suffix}`,
      checkpointScope: `${base.checkpointScope}-${suffix}`,
      initialGraph: parentFold.currentRevision,
      lineage: {
        origin: "fork",
        parentControllerRunId: parentRequest.controllerRunId,
        parentSequence,
        parentHistoryHash,
      },
    });
    const discoveryKey = suffix === "sibling" ? "sibling-only" : "root-seen";
    await forkCycleController(store, parentRequest.eventStreamId, child, graph(), {
      eventStore: store,
      lease: lease(`lease-${suffix}`, 1),
      now: fixedNow(),
      activities: {
        finder: () => ({ output: [{ key: discoveryKey, value: { source: suffix } }] }),
        candidateEvaluator: () => ({ output: [{ key: discoveryKey, verdict: "accept" }] }),
      },
    });
    return child;
  }

  async function lineageTree() {
    const store = new MemoryCycleControllerEventStore();
    const root = request("until-dry", { maxIterations: 1, consecutiveDryRounds: 2 });
    await startCycleController(root, graph(), {
      eventStore: store,
      lease: lease("lineage-root", 1),
      now: fixedNow(),
      activities: {
        finder: () => ({ output: [] }),
        candidateEvaluator: () => ({ output: [] }),
      },
    });
    const rootFold = await replayCycleController(store, root.eventStreamId);
    const forkA = await forkFrom(
      store,
      root,
      rootFold.lastSequence,
      rootFold.historyPrefixHash,
      "fork-a",
      3,
    );
    const manifestA = await exportCycleControllerLineageManifest(store, forkA.eventStreamId);
    const foldA = replayCycleControllerLineageManifest(manifestA).target;
    const forkB = await forkFrom(
      store,
      forkA,
      foldA.lastSequence,
      foldA.historyPrefixHash,
      "fork-b",
      4,
    );
    const sibling = await forkFrom(
      store,
      root,
      rootFold.lastSequence,
      rootFold.historyPrefixHash,
      "sibling",
      3,
    );
    const early = await forkFrom(
      store,
      root,
      0,
      store.snapshot(root.eventStreamId)[0]!.recordHash,
      "early-prefix",
      2,
    );
    return { store, root, forkA, forkB, sibling, early };
  }

  function cloneManifest(value: unknown): Record<string, any> {
    return JSON.parse(JSON.stringify(value)) as Record<string, any>;
  }

  function reseal(value: Record<string, any>): void {
    const body = { ...value };
    delete body.manifestHash;
    value.manifestHash = hashWithDomain(CYCLE_LINEAGE_MANIFEST_DOMAIN, body);
  }

  it("exports and replays a root-to-grandchild tree with isolated siblings and prefixes", async () => {
    const { store, root, forkB, sibling, early } = await lineageTree();
    const before = canonicalSerialize({
      root: store.snapshot(root.eventStreamId),
      forkB: store.snapshot(forkB.eventStreamId),
      sibling: store.snapshot(sibling.eventStreamId),
      early: store.snapshot(early.eventStreamId),
    });
    const manifest = await exportCycleControllerLineageManifest(store, forkB.eventStreamId);
    const siblingManifest = await exportCycleControllerLineageManifest(store, sibling.eventStreamId);
    const earlyManifest = await exportCycleControllerLineageManifest(store, early.eventStreamId);
    const replay = replayCycleControllerLineageManifest(manifest, { requireTerminal: true });

    expect(manifest.streams).toHaveLength(3);
    expect(replay.folds.map(({ request: item }) => item.controllerRunId)).toEqual([
      root.controllerRunId,
      manifest.streams[1]!.controllerRunId,
      forkB.controllerRunId,
    ]);
    expect(replay.target.request.eventStreamId).toBe(forkB.eventStreamId);
    const forkAEvents = store.snapshot(manifest.streams[1]!.eventStreamId);
    const checkpoint = createCycleControllerCheckpoint(
      forkAEvents,
      "lineage-fork-a",
      "2026-07-26T00:00:02Z",
      { parent: replay.folds[0]! },
    );
    const restoredForkA = validateCycleControllerCheckpoint(
      checkpoint,
      forkAEvents,
      { parent: replay.folds[0]! },
    );
    const checkpointChild = foldCycleControllerEvents(
      store.snapshot(forkB.eventStreamId),
      { parent: restoredForkA },
    );
    expect(canonicalSerialize(checkpointChild)).toBe(canonicalSerialize(replay.target));
    expect(manifest.eventCount).toBe(
      manifest.streams.reduce((total, stream) => total + stream.events.length, 0),
    );
    expect(canonicalSerialize(siblingManifest.streams[0])).toBe(
      canonicalSerialize(manifest.streams[0]),
    );
    expect(siblingManifest.target.controllerRunId).not.toBe(manifest.target.controllerRunId);
    const siblingReplay = replayCycleControllerLineageManifest(siblingManifest);
    expect(siblingReplay.target.seenKeys).toContain("sibling-only");
    expect(replay.target.seenKeys).not.toContain("sibling-only");
    expect(replay.target.seenKeys).toContain("root-seen");
    expect(siblingReplay.target.decidedPatches).not.toBe(replay.target.decidedPatches);
    expect(earlyManifest.streams).toHaveLength(2);
    expect(earlyManifest.streams[0]!.throughSequence).toBe(0);
    expect(earlyManifest.streams[0]!.events).toHaveLength(1);
    expect(canonicalSerialize({
      root: store.snapshot(root.eventStreamId),
      forkB: store.snapshot(forkB.eventStreamId),
      sibling: store.snapshot(sibling.eventStreamId),
      early: store.snapshot(early.eventStreamId),
    })).toBe(before);
  }, 20_000);

  it("rejects rehashed missing, duplicate, cyclic, truncated, and substituted ancestry", async () => {
    const { store, forkB } = await lineageTree();
    const manifest = await exportCycleControllerLineageManifest(store, forkB.eventStreamId);
    const attacks: Array<(value: Record<string, any>) => void> = [
      (value) => { value.streams[0].events[0].timestamp = "2026-07-26T00:00:01Z"; },
      (value) => {
        const removed = value.streams.shift();
        value.eventCount -= removed.events.length;
      },
      (value) => {
        const duplicate = JSON.parse(JSON.stringify(value.streams[0]));
        value.streams.splice(1, 0, duplicate);
        value.eventCount += duplicate.events.length;
      },
      (value) => { value.streams[1].controllerRunId = value.streams[0].controllerRunId; },
      (value) => { value.streams[1].parent.requestHash = "f".repeat(64); },
      (value) => {
        value.streams[0].events.pop();
        value.eventCount -= 1;
      },
      (value) => { value.target.controllerHash = "e".repeat(64); },
    ];
    for (const attack of attacks) {
      const hostile = cloneManifest(manifest);
      attack(hostile);
      reseal(hostile);
      expect(() => replayCycleControllerLineageManifest(hostile)).toThrowError(
        expect.objectContaining({ code: "GE_CYCLE_INVALID_HISTORY" }),
      );
    }
    const unhashed = cloneManifest(manifest);
    unhashed.eventCount += 1;
    expect(() => replayCycleControllerLineageManifest(unhashed)).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_INVALID_HISTORY" }),
    );
  }, 20_000);

  it("refuses export when an exact retained ancestor is unavailable", async () => {
    const { store, forkB } = await lineageTree();
    const isolated = new MemoryCycleControllerEventStore();
    const childEvents = store.snapshot(forkB.eventStreamId);
    await isolated.append(forkB.eventStreamId, -1, childEvents);
    await expect(
      exportCycleControllerLineageManifest(isolated, forkB.eventStreamId),
    ).rejects.toMatchObject({ code: "GE_CYCLE_INVALID_HISTORY" });
  }, 20_000);
});
