import { compileGraph, type GraphSpec } from "@graph-engineering/core";
import { describe, expect, it, vi } from "vitest";
import {
  createCycleInlinePayload,
  CycleActivityFailure,
  CycleControllerError,
  forkCycleController,
  MemoryCycleControllerEventStore,
  replayCycleController,
  resumeCycleController,
  startCycleController,
  validateCycleControllerRequest,
  type CycleActivityBinding,
  type CycleControllerActivities,
  type CycleControllerEvent,
  type CycleControllerEventStore,
  type CycleControllerCheckpoint,
  type CycleControllerCheckpointStore,
  type CycleControllerRequest,
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
    const item = request("until-dry", { maxIterations: 2 });
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
    expect(result).toMatchObject({ exitReason: "CANCELLED", status: "cancelled" });
    expect(evaluator).not.toHaveBeenCalled();
    expect(events(store, item).map(({ type }) => type)).not.toContain("DiscoveryCommitted");
    await expect(replayCycleController(store, item.eventStreamId)).resolves.toMatchObject({
      terminalResult: { exitReason: "CANCELLED" },
    });
  });

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

  it("persists inherited non-idempotent in-doubt status in a fork before any child dispatch", async () => {
    const parentBase = request("until-dry", { maxIterations: 2 });
    const parentMutable = JSON.parse(JSON.stringify(parentBase)) as CycleControllerRequest;
    (parentMutable.activities.finder as { sideEffects: string }).sideEffects = "non-idempotent";
    const parentRequest = validateCycleControllerRequest(parentMutable);
    const parentStore = new CommitThenThrowCycleStore("ActivityStarted", "finder");
    const parentFinder = vi.fn(() => ({ output: [] }));
    await expect(startCycleController(parentRequest, graph(), {
      eventStore: parentStore, lease: lease("fork-parent-lease", 1), now: fixedNow(),
      activities: { finder: parentFinder, candidateEvaluator: () => ({ output: [] }) },
    })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_FAILED" });
    expect(parentFinder).not.toHaveBeenCalled();
    const parentFold = await replayCycleController(parentStore, parentRequest.eventStreamId);
    expect(parentFold.openRound?.openActivity?.sideEffects).toBe("non-idempotent");

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
    expect(childFold.inDoubtActivities[0]?.sideEffects).toBe("non-idempotent");
  });

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
