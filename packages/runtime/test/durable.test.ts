import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalHash, type GraphSpec, type NodeSpec } from "@graph-engineering/core";
import {
  MemoryEventStore,
  VersionConflictError,
  type EventStore,
  type GraphEvent,
} from "@graph-engineering/persistence";
import { describe, expect, it, vi } from "vitest";
import {
  decodeDurableJson,
  DurableRunError,
  durableJsonHash,
  encodeDurableJson,
  resumeDurableGraphRun,
  startDurableGraphRun,
  type DurableNodeExecutionContext,
} from "../src/index.js";
import {
  projectedRuntimeCapabilityFailures,
  runtimeCapabilityCorpus,
} from "./runtime-capability-fixtures.js";

const FIXED_TIME = "2026-07-26T12:00:00.000Z";
const fixedNow = (): Date => new Date(FIXED_TIME);

function node(id: string, overrides: Partial<NodeSpec> = {}): NodeSpec {
  return {
    id,
    kind: "agent",
    inputSchema: {},
    outputSchema: {},
    config: {},
    sideEffects: "none",
    ...overrides,
  };
}

function graph(overrides: Partial<GraphSpec> = {}): GraphSpec {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "durable-test", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["root"],
    outputs: { result: { node: "root" } },
    nodes: [node("root")],
    edges: [],
    ...overrides,
  };
}

function registeredLoopConditionGraph(): GraphSpec {
  const corpus = JSON.parse(readFileSync(
    fileURLToPath(new URL("../../../spec/conformance/integrated-router.case.json", import.meta.url)),
    "utf8",
  )) as { compilerCases: Array<{ name: string; graph: GraphSpec }> };
  const fixture = corpus.compilerCases.find(
    (item) => item.name === "registered-loop-condition-families-remain-compiler-valid",
  );
  if (fixture === undefined) throw new Error("registered loop condition fixture is missing");
  return fixture.graph;
}

async function history(store: EventStore, runId: string): Promise<GraphEvent[]> {
  const result: GraphEvent[] = [];
  for await (const event of store.read(runId)) result.push(event);
  return result;
}

function resign(event: GraphEvent, data: Readonly<Record<string, unknown>>): GraphEvent {
  return { ...event, data, payloadHash: canonicalHash(data) };
}

function forgedEvent(fields: {
  runId: string;
  sequence: number;
  type: GraphEvent["type"];
  data: Readonly<Record<string, unknown>>;
  nodeId?: string;
  edgeId?: string;
  attempt?: number;
}): GraphEvent {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/events/v1alpha1",
    eventId: `forged:${fields.sequence}`,
    type: fields.type,
    timestamp: FIXED_TIME,
    runId: fields.runId,
    graphRevision: 1,
    sequence: fields.sequence,
    payloadHash: canonicalHash(fields.data),
    redacted: true,
    data: fields.data,
    ...(fields.nodeId === undefined ? {} : { nodeId: fields.nodeId }),
    ...(fields.edgeId === undefined ? {} : { edgeId: fields.edgeId }),
    ...(fields.attempt === undefined ? {} : { attempt: fields.attempt }),
  };
}

async function copyHistory(runId: string, events: readonly GraphEvent[]): Promise<MemoryEventStore> {
  const store = new MemoryEventStore();
  await store.append(runId, -1, events);
  return store;
}

class CommitThenThrowStore implements EventStore {
  readonly delegate: MemoryEventStore;
  readonly shouldThrow: (events: readonly GraphEvent[]) => boolean;
  threw = false;

  constructor(
    delegate: MemoryEventStore,
    shouldThrow: (events: readonly GraphEvent[]) => boolean,
  ) {
    this.delegate = delegate;
    this.shouldThrow = shouldThrow;
  }

  async append(
    runId: string,
    expectedVersion: number,
    events: readonly GraphEvent[],
  ): Promise<number> {
    const version = await this.delegate.append(runId, expectedVersion, events);
    if (!this.threw && this.shouldThrow(events)) {
      this.threw = true;
      throw new Error("simulated process loss after durable commit");
    }
    return version;
  }

  read(runId: string, fromSequence = 0): AsyncIterable<GraphEvent> {
    return this.delegate.read(runId, fromSequence);
  }
}

class ConflictStore implements EventStore {
  readonly delegate: MemoryEventStore;

  constructor(delegate: MemoryEventStore) {
    this.delegate = delegate;
  }

  async append(runId: string, expectedVersion: number): Promise<number> {
    const actual = (await history(this.delegate, runId)).length - 1;
    throw new VersionConflictError(runId, expectedVersion, actual + 1);
  }

  read(runId: string, fromSequence = 0): AsyncIterable<GraphEvent> {
    return this.delegate.read(runId, fromSequence);
  }
}

class BlockingSuccessStore implements EventStore {
  readonly delegate = new MemoryEventStore();
  readonly entered: Promise<void>;
  #enter!: () => void;
  #release!: () => void;
  #gate: Promise<void>;
  #blocked = false;

  constructor() {
    this.entered = new Promise((resolve) => { this.#enter = resolve; });
    this.#gate = new Promise((resolve) => { this.#release = resolve; });
  }

  release(): void {
    this.#release();
  }

  async append(
    runId: string,
    expectedVersion: number,
    events: readonly GraphEvent[],
  ): Promise<number> {
    if (!this.#blocked && events.some((event) => event.type === "NodeSucceeded")) {
      this.#blocked = true;
      this.#enter();
      await this.#gate;
    }
    return this.delegate.append(runId, expectedVersion, events);
  }

  read(runId: string, fromSequence = 0): AsyncIterable<GraphEvent> {
    return this.delegate.read(runId, fromSequence);
  }
}

describe("durable graph scheduler", () => {
  it("consumes the runtime-capability corpus for durable start and resume before persistence", async () => {
    const corpus = runtimeCapabilityCorpus();

    for (const testCase of corpus.cases) {
      for (const entrypoint of ["start", "resume"] as const) {
        const executor = vi.fn(({ input }) => input);
        const nodeExecutors = Object.fromEntries(
          testCase.graph.nodes
            .filter((current) => current.kind !== "barrier")
            .map((current) => [current.id, executor]),
        );

        if (testCase.expect.supported) {
          const store = new MemoryEventStore();
          const options = {
            runId: `capability-${entrypoint}`,
            implementationId: "v1",
            eventStore: store,
            nodeExecutors,
          };
          if (entrypoint === "resume") {
            const seeded = await startDurableGraphRun(testCase.graph, {}, options);
            expect(seeded.status, `${testCase.name}:resume-seed`).toBe("succeeded");
            executor.mockClear();
          }
          const result = entrypoint === "start"
            ? await startDurableGraphRun(testCase.graph, {}, options)
            : await resumeDurableGraphRun(testCase.graph, options);
          expect(
            result.status,
            `${testCase.name}:${entrypoint}: ${JSON.stringify(result)}`,
          ).toBe("succeeded");
          expect(result.failures, `${testCase.name}:${entrypoint}`).toEqual([]);
          expect(executor, `${testCase.name}:${entrypoint}`).toHaveBeenCalledTimes(
            entrypoint === "start" ? 1 : 0,
          );
          continue;
        }

        const read = vi.fn((): AsyncIterable<GraphEvent> => {
          throw new Error("event store read must not run during capability preflight");
        });
        const append = vi.fn(async (): Promise<number> => {
          throw new Error("event store append must not run during capability preflight");
        });
        const store: EventStore = { read, append };
        const options = {
          runId: `capability-${entrypoint}`,
          implementationId: "v1",
          eventStore: store,
          nodeExecutors,
        };
        const result = entrypoint === "start"
          ? await startDurableGraphRun(testCase.graph, {}, options)
          : await resumeDurableGraphRun(testCase.graph, options);

        expect(result, `${testCase.name}:${entrypoint}`).toMatchObject({
          status: corpus.failureProjection.status,
          nodes: [],
          failures: projectedRuntimeCapabilityFailures(testCase),
          maxObservedConcurrency: 0,
          totalAttempts: corpus.failureProjection.totalAttempts,
        });
        expect(result.graphHash).toEqual(expect.any(String));
        expect(read).toHaveBeenCalledTimes(corpus.failureProjection.durableReadCalls);
        expect(append).toHaveBeenCalledTimes(corpus.failureProjection.durableAppendCalls);
        expect(executor).toHaveBeenCalledTimes(corpus.failureProjection.executorCalls);
      }
    }
  });

  it("reports runtime issues before foreign conditions without durable reads or appends", async () => {
    const combined: GraphSpec = {
      ...registeredLoopConditionGraph(),
      stateSchema: {},
    };
    const read = vi.fn((): AsyncIterable<GraphEvent> => {
      throw new Error("event store read must not run during capability preflight");
    });
    const append = vi.fn(async (): Promise<number> => {
      throw new Error("event store append must not run during capability preflight");
    });
    const executor = vi.fn(() => "never");
    const options = {
      runId: "combined-capabilities",
      implementationId: "v1",
      eventStore: { read, append } satisfies EventStore,
      nodeExecutors: { source: executor },
    };

    const started = await startDurableGraphRun(combined, {}, options);
    const resumed = await resumeDurableGraphRun(combined, options);

    for (const result of [started, resumed]) {
      expect(result).toMatchObject({
        status: "failed",
        nodes: [],
        totalAttempts: 0,
        failures: [
          {
            code: "UNSUPPORTED_RUNTIME_CAPABILITY",
            nodeId: "source",
            message: "Runtime capability 'graph-state' at '#/stateSchema' is not implemented by runtime-capability/v1alpha1",
            attempt: 0,
          },
          {
            code: "UNSUPPORTED_EDGE_CONDITION",
            nodeId: "source",
            attempt: 0,
          },
        ],
      });
    }
    expect(started).toEqual(resumed);
    expect(read).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects unsupported barrier configuration before durable start or resume persistence", async () => {
    const unsupported = graph({
      nodes: [node("root", { kind: "barrier", config: { condition: "any" } })],
    });
    const read = vi.fn((): AsyncIterable<GraphEvent> => {
      throw new Error("unexpected durable read");
    });
    const append = vi.fn(async (): Promise<number> => {
      throw new Error("unexpected durable append");
    });
    const executor = vi.fn(() => "never");
    const options = {
      runId: "unsupported-barrier-config",
      implementationId: "v1",
      eventStore: { read, append } satisfies EventStore,
      nodeExecutors: { root: executor },
    };

    for (const result of [
      await startDurableGraphRun(unsupported, {}, options),
      await resumeDurableGraphRun(unsupported, options),
    ]) {
      expect(result).toMatchObject({
        status: "failed",
        nodes: [],
        totalAttempts: 0,
        failures: [{
          code: "UNSUPPORTED_RUNTIME_CAPABILITY",
          nodeId: "root",
          message: "Runtime capability 'node-config:barrier' at '#/nodes/0/config' is not implemented by runtime-capability/v1alpha1",
          attempt: 0,
        }],
      });
    }
    expect(read).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it("commits every claim before execution and terminal resume is deeply identical", async () => {
    const store = new MemoryEventStore();
    let identity: readonly string[] | undefined;
    const result = await startDurableGraphRun(graph(), { seed: 1.5 }, {
      runId: "start-basic",
      implementationId: "handlers@1",
      eventStore: store,
      now: fixedNow,
      nodeExecutors: {
        root: async (context) => {
          const events = await history(store, "start-basic");
          expect(events.at(-1)?.type).toBe("NodeStarted");
          identity = [context.runId, context.attemptId, context.idempotencyKey];
          return { decimal: 0.1 };
        },
      },
    });

    const events = await history(store, "start-basic");
    expect(events.map((event) => event.type)).toEqual([
      "RunCreated", "RunStarted", "NodeScheduled", "NodeStarted", "NodeSucceeded", "RunSucceeded",
    ]);
    expect(identity).toEqual([
      "start-basic",
      "start-basic/root/1",
      events[2]?.data.activityKey,
    ]);
    const mustNotRun = vi.fn(() => { throw new Error("terminal resume executed work"); });
    const resumed = await resumeDurableGraphRun(graph(), {
      runId: "start-basic",
      implementationId: "handlers@1",
      eventStore: store,
      now: fixedNow,
      nodeExecutors: { root: mustNotRun },
    });
    assert.deepStrictEqual(resumed, result);
    expect(mustNotRun).not.toHaveBeenCalled();
    expect((await history(store, "start-basic")).length).toBe(events.length);
  });

  it("rejects a self-consistent forged router success before appending RunResumed", async () => {
    const routed = graph({
      entrypoints: ["route"],
      outputs: { decision: { node: "route" } },
      nodes: [
        node("route", {
          kind: "router",
          config: { kind: "single", allowedRoutes: ["quick", "audit"] },
        }),
        node("audit"),
        node("quick"),
      ],
      edges: [
        {
          id: "route-audit",
          from: { node: "route" },
          to: { node: "audit" },
          condition: {
            apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
            kind: "RouteEquals",
            routeKey: "audit",
          },
        },
        {
          id: "route-quick",
          from: { node: "route" },
          to: { node: "quick" },
          condition: {
            apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
            kind: "RouteEquals",
            routeKey: "quick",
          },
        },
      ],
    });
    const source = new MemoryEventStore();
    const crash = new CommitThenThrowStore(
      source,
      (batch) => batch.some((event) => event.type === "NodeSucceeded" && event.nodeId === "route"),
    );
    await expect(startDurableGraphRun(routed, { requestedRoutes: ["quick"] }, {
      runId: "forged-router-success",
      implementationId: "v1",
      eventStore: crash,
      now: fixedNow,
    })).rejects.toMatchObject({ code: "DURABILITY_STORE_FAILED" });

    const events = await history(source, "forged-router-success");
    const successIndex = events.findIndex((event) => event.type === "NodeSucceeded");
    const success = events[successIndex] as GraphEvent;
    const output = JSON.parse(JSON.stringify(decodeDurableJson(success.data.output))) as Record<string, unknown>;
    output.requestedRoutes = ["audit"];
    output.selectedRoutes = ["audit"];
    const outputHash = durableJsonHash(output);
    const changed = [...events];
    changed[successIndex] = resign(success, {
      ...success.data,
      output: encodeDurableJson(output),
      outputHash,
    });
    const emittedIndex = events.findIndex((event) => event.type === "EdgeEmitted");
    changed[emittedIndex] = resign(events[emittedIndex] as GraphEvent, { outputHash });
    const forged = await copyHistory("forged-router-success", changed);
    const before = (await history(forged, "forged-router-success")).length;

    await expect(resumeDurableGraphRun(routed, {
      runId: "forged-router-success",
      implementationId: "v1",
      eventStore: forged,
      now: fixedNow,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });
    expect((await history(forged, "forged-router-success")).length).toBe(before);
  });

  it("replays selected and inactive router branches without rejudging the decision", async () => {
    const condition = (routeKey: string) => ({
      apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
      kind: "RouteEquals",
      routeKey,
    });
    const routed = graph({
      entrypoints: ["route"],
      outputs: { decision: { node: "route" } },
      nodes: [
        node("route", {
          kind: "router",
          config: { kind: "single", allowedRoutes: ["quick", "audit"] },
        }),
        node("quick"),
        node("audit"),
      ],
      edges: [
        { id: "route-quick", from: { node: "route" }, to: { node: "quick" }, condition: condition("quick") },
        { id: "route-audit", from: { node: "route" }, to: { node: "audit" }, condition: condition("audit") },
      ],
    });
    const store = new MemoryEventStore();
    const quick = vi.fn(() => "must-not-run");
    const audit = vi.fn(() => ({ reviewed: true }));
    const first = await startDurableGraphRun(routed, { requestedRoutes: ["audit"] }, {
      runId: "durable-route-replay",
      implementationId: "v1",
      eventStore: store,
      now: fixedNow,
      nodeExecutors: { quick, audit },
    });

    expect(first.status).toBe("succeeded");
    expect(first.nodes.find((item) => item.nodeId === "quick")?.failure?.code)
      .toBe("ROUTE_NOT_SELECTED");
    expect(first.failures).toEqual([]);
    expect(quick).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledOnce();

    const mustNotRun = vi.fn(() => { throw new Error("terminal route replay executed work"); });
    const resumed = await resumeDurableGraphRun(routed, {
      runId: "durable-route-replay",
      implementationId: "v1",
      eventStore: store,
      now: fixedNow,
      nodeExecutors: { route: mustNotRun, quick: mustNotRun, audit: mustNotRun },
    });
    assert.deepStrictEqual(resumed, first);
    expect(mustNotRun).not.toHaveBeenCalled();
  });

  it("replays an inactive named output as a control skip with no graph failure", async () => {
    const routed = graph({
      entrypoints: ["route"],
      outputs: { result: { node: "branch" } },
      nodes: [
        node("route", {
          kind: "router",
          config: { kind: "single", allowedRoutes: ["known"] },
        }),
        node("branch"),
      ],
      edges: [{
        id: "route-branch",
        from: { node: "route" },
        to: { node: "branch" },
        condition: {
          apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
          kind: "RouteEquals",
          routeKey: "known",
        },
      }],
    });
    const store = new MemoryEventStore();
    const branch = vi.fn();
    const first = await startDurableGraphRun(routed, { requestedRoutes: ["unknown"] }, {
      runId: "inactive-route-output",
      implementationId: "v1",
      eventStore: store,
      now: fixedNow,
      nodeExecutors: { branch },
    });
    expect(first).toMatchObject({ status: "failed", failures: [] });
    expect(first.output).toBeUndefined();
    expect(first.nodes[1]?.failure?.code).toBe("ROUTE_NOT_SELECTED");
    expect(branch).not.toHaveBeenCalled();

    const resumed = await resumeDurableGraphRun(routed, {
      runId: "inactive-route-output",
      implementationId: "v1",
      eventStore: store,
      now: fixedNow,
      nodeExecutors: { branch },
    });
    assert.deepStrictEqual(resumed, first);
    expect(branch).not.toHaveBeenCalled();
  });

  it("rejects an unsupported condition before durable persistence or execution", async () => {
    const unsupported = graph({
      entrypoints: ["route"],
      outputs: { decision: { node: "route" } },
      nodes: [
        node("route", {
          kind: "router",
          config: { kind: "single", allowedRoutes: ["quick"] },
        }),
        node("child"),
      ],
      edges: [{
        id: "unsupported",
        from: { node: "route" },
        to: { node: "child" },
        condition: { kind: "RouteEquals", routeKey: "quick" },
      }],
    });
    const source = new MemoryEventStore();
    const crash = new CommitThenThrowStore(
      source,
      (batch) => batch.some((event) =>
        event.type === "NodeSettledWithoutAttempt" && event.nodeId === "route"),
    );
    const route = vi.fn();
    const child = vi.fn();
    const result = await startDurableGraphRun(unsupported, {}, {
      runId: "unsupported-settlement-crash",
      implementationId: "v1",
      eventStore: crash,
      now: fixedNow,
      nodeExecutors: { route, child },
    });
    expect(result).toMatchObject({
      status: "failed",
      totalAttempts: 0,
      nodes: [],
      failures: [{ code: "GE1402_UNSUPPORTED_EDGE_CONDITION", phase: "compile" }],
    });
    expect(route).not.toHaveBeenCalled();
    expect(child).not.toHaveBeenCalled();
    expect(await history(source, "unsupported-settlement-crash")).toEqual([]);
  });

  it("preflights compiler-registered foreign conditions before durable start or resume", async () => {
    const read = vi.fn((): AsyncIterable<GraphEvent> => {
      throw new Error("condition preflight must not read durable history");
    });
    const append = vi.fn(async (): Promise<number> => {
      throw new Error("condition preflight must not append durable history");
    });
    const store: EventStore = { read, append };
    const sourceExecutor = vi.fn(() => ({ done: true }));
    const options = {
      runId: "registered-loop-preflight",
      implementationId: "v1",
      eventStore: store,
      now: fixedNow,
      nodeExecutors: { source: sourceExecutor },
    };

    const started = await startDurableGraphRun(registeredLoopConditionGraph(), {}, options);
    expect(started).toMatchObject({
      status: "failed",
      totalAttempts: 0,
      nodes: [],
      failures: [{
        phase: "execute",
        code: "UNSUPPORTED_EDGE_CONDITION",
        nodeId: "source",
        attempt: 0,
      }],
    });
    expect(read).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(sourceExecutor).not.toHaveBeenCalled();

    const resumed = await resumeDurableGraphRun(registeredLoopConditionGraph(), options);
    expect(resumed).toEqual(started);
    expect(read).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(sourceExecutor).not.toHaveBeenCalled();
  });

  it("rejects resigned terminal history that attempted an unsupported-condition source", async () => {
    const supported = graph({
      entrypoints: ["route"],
      outputs: { decision: { node: "route" } },
      nodes: [
        node("route", {
          kind: "router",
          config: { kind: "single", allowedRoutes: ["quick"] },
        }),
        node("child"),
      ],
      edges: [{
        id: "conditional",
        from: { node: "route" },
        to: { node: "child" },
        condition: {
          apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
          kind: "RouteEquals",
          routeKey: "quick",
        },
      }],
    });
    const unsupported = JSON.parse(JSON.stringify(supported)) as GraphSpec;
    unsupported.edges[0]!.condition = { kind: "RouteEquals", routeKey: "quick" };
    const source = new MemoryEventStore();
    await startDurableGraphRun(supported, { requestedRoutes: ["quick"] }, {
      runId: "attempted-unsupported-condition",
      implementationId: "v1",
      eventStore: source,
      now: fixedNow,
      nodeExecutors: { child: () => ({ done: true }) },
    });
    const events = await history(source, "attempted-unsupported-condition");
    const created = events[0] as GraphEvent;
    const resigned = [...events];
    resigned[0] = resign(created, {
      ...created.data,
      graphHash: canonicalHash(unsupported),
    });
    const forged = await copyHistory("attempted-unsupported-condition", resigned);
    const before = (await history(forged, "attempted-unsupported-condition")).length;

    const result = await resumeDurableGraphRun(unsupported, {
      runId: "attempted-unsupported-condition",
      implementationId: "v1",
      eventStore: forged,
      now: fixedNow,
    });
    expect(result).toMatchObject({
      status: "failed",
      totalAttempts: 0,
      nodes: [],
      failures: [{ code: "GE1402_UNSUPPORTED_EDGE_CONDITION", phase: "compile" }],
    });
    expect(await history(forged, "attempted-unsupported-condition")).toHaveLength(before);
  });

  it("rejects resigned history that attempted a now-inactive routed branch", async () => {
    const active = graph({
      entrypoints: ["route"],
      outputs: { decision: { node: "route" } },
      nodes: [
        node("route", {
          kind: "router",
          config: { kind: "single", allowedRoutes: ["quick"] },
        }),
        node("child"),
      ],
      edges: [{
        id: "conditional",
        from: { node: "route" },
        to: { node: "child" },
        condition: {
          apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
          kind: "RouteEquals",
          routeKey: "quick",
        },
      }],
    });
    const inactiveDocument = JSON.parse(JSON.stringify(active)) as {
      edges: Array<{ condition: Record<string, unknown> }>;
    };
    inactiveDocument.edges[0]!.condition.routeKey = "audit";
    const inactive = inactiveDocument as unknown as GraphSpec;
    const source = new MemoryEventStore();
    await startDurableGraphRun(active, { requestedRoutes: ["quick"] }, {
      runId: "attempted-inactive-branch",
      implementationId: "v1",
      eventStore: source,
      now: fixedNow,
      nodeExecutors: { child: () => ({ done: true }) },
    });
    const events = await history(source, "attempted-inactive-branch");
    const created = events[0] as GraphEvent;
    const resigned = [...events];
    resigned[0] = resign(created, {
      ...created.data,
      graphHash: canonicalHash(inactive),
    });
    const forged = await copyHistory("attempted-inactive-branch", resigned);
    const before = (await history(forged, "attempted-inactive-branch")).length;

    const result = await resumeDurableGraphRun(inactive, {
      runId: "attempted-inactive-branch",
      implementationId: "v1",
      eventStore: forged,
      now: fixedNow,
    });
    expect(result).toMatchObject({
      status: "failed",
      totalAttempts: 0,
      nodes: [],
      failures: [{ code: "GE1404_ROUTE_NOT_ALLOWED", phase: "compile" }],
    });
    expect(await history(forged, "attempted-inactive-branch")).toHaveLength(before);
  });

  it("passes the shared resume fixture and reuses committed work", async () => {
    const fixturePath = fileURLToPath(
      new URL("../../../spec/conformance/durable-resume.case.json", import.meta.url),
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      runId: string;
      implementationId: string;
      graph: GraphSpec;
      graphInput: unknown;
      resumeReturns: Record<string, unknown>;
      expect: {
        executorCalls: Array<{ nodeId: string; attempt: number }>;
        mergeInput: unknown;
        output: unknown;
        totalAttempts: number;
      };
    };
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeStarted" && event.nodeId === "right"),
    );
    await expect(startDurableGraphRun(fixture.graph, fixture.graphInput, {
      runId: fixture.runId,
      implementationId: fixture.implementationId,
      eventStore: crashStore,
      concurrency: 1,
      now: fixedNow,
      nodeExecutors: {
        left: () => ({ left: true }),
        right: () => { throw new Error("right executor must not run before simulated loss"); },
        merge: () => ({ merged: false }),
      },
    })).rejects.toMatchObject({ code: "DURABILITY_STORE_FAILED" });

    const preResume = await history(delegate, fixture.runId);
    expect(preResume.map((event) => event.type)).toEqual([
      "RunCreated", "RunStarted", "NodeScheduled", "NodeStarted", "NodeSucceeded", "EdgeEmitted",
      "NodeScheduled", "NodeStarted",
    ]);
    const calls: Array<{ nodeId: string; attempt: number }> = [];
    let mergeInput: unknown;
    const left = vi.fn(() => { throw new Error("committed node executed again"); });
    const resumed = await resumeDurableGraphRun(fixture.graph, {
      runId: fixture.runId,
      implementationId: fixture.implementationId,
      eventStore: crashStore,
      now: fixedNow,
      nodeExecutors: {
        left,
        right: (context) => {
          calls.push({ nodeId: context.node.id, attempt: context.attempt });
          return fixture.resumeReturns.right;
        },
        merge: (context) => {
          calls.push({ nodeId: context.node.id, attempt: context.attempt });
          mergeInput = context.input;
          return fixture.resumeReturns.merge;
        },
      },
    });
    expect(left).not.toHaveBeenCalled();
    expect(calls).toEqual(fixture.expect.executorCalls);
    expect(mergeInput).toEqual(fixture.expect.mergeInput);
    expect(resumed.output).toEqual(fixture.expect.output);
    expect(resumed.totalAttempts).toBe(fixture.expect.totalAttempts);
    const after = await history(delegate, fixture.runId);
    expect(after.slice(preResume.length, preResume.length + 3).map((event) => event.type)).toEqual([
      "RunResumed", "NodeAttemptFailed", "NodeRetried",
    ]);
    expect((after.find((event) => event.type === "RunResumed")?.data)).toEqual({
      reusedNodeIds: ["left"], interruptedNodeIds: ["right"],
    });
    const terminal = await resumeDurableGraphRun(fixture.graph, {
      runId: fixture.runId,
      implementationId: fixture.implementationId,
      eventStore: crashStore,
      nodeExecutors: {
        left: left,
        right: left,
        merge: left,
      },
    });
    assert.deepStrictEqual(terminal, resumed);
    expect((await history(delegate, fixture.runId)).length).toBe(after.length);
  });

  it("commits success before a dependent is released", async () => {
    const store = new BlockingSuccessStore();
    const dependent = vi.fn(() => "done");
    const chain = graph({
      entrypoints: ["root"],
      outputs: { result: { node: "dependent" } },
      nodes: [node("root"), node("dependent")],
      edges: [{ id: "root-dependent", from: { node: "root" }, to: { node: "dependent" } }],
    });
    const running = startDurableGraphRun(chain, { value: 1 }, {
      runId: "commit-before-release",
      implementationId: "v1",
      eventStore: store,
      nodeExecutors: { root: () => "root", dependent },
    });
    await store.entered;
    expect(dependent).not.toHaveBeenCalled();
    expect((await history(store, "commit-before-release")).some(
      (event) => event.type === "NodeSucceeded",
    )).toBe(false);
    store.release();
    await expect(running).resolves.toMatchObject({ status: "succeeded" });
    expect(dependent).toHaveBeenCalledOnce();
  });

  it("fails closed for an interrupted undeclared side effect and remains sticky", async () => {
    const unsafe = graph({
      nodes: [{
        id: "root", kind: "agent", inputSchema: {}, outputSchema: {}, config: {},
        retry: { maxAttempts: 2 },
      }],
    });
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeStarted"),
    );
    await expect(startDurableGraphRun(unsafe, {}, {
      runId: "unsafe",
      implementationId: "v1",
      eventStore: crashStore,
      nodeExecutors: { root: () => "never" },
    })).rejects.toMatchObject({ code: "DURABILITY_STORE_FAILED" });
    const executor = vi.fn(() => "must-not-run");
    await expect(resumeDurableGraphRun(unsafe, {
      runId: "unsafe",
      implementationId: "v1",
      eventStore: crashStore,
      nodeExecutors: { root: executor },
    })).rejects.toMatchObject({ code: "IN_DOUBT_SIDE_EFFECT" });
    expect(executor).not.toHaveBeenCalled();
    const count = (await history(delegate, "unsafe")).length;
    await expect(resumeDurableGraphRun(unsafe, {
      runId: "unsafe",
      implementationId: "v1",
      eventStore: crashStore,
      nodeExecutors: { root: executor },
    })).rejects.toMatchObject({ code: "IN_DOUBT_SIDE_EFFECT" });
    expect((await history(delegate, "unsafe")).length).toBe(count);
    expect(executor).not.toHaveBeenCalled();
  });

  it("losing the resume CAS invokes no executor", async () => {
    const retrying = graph({ nodes: [node("root", { retry: { maxAttempts: 2 } })] });
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeStarted"),
    );
    await expect(startDurableGraphRun(retrying, {}, {
      runId: "cas",
      implementationId: "v1",
      eventStore: crashStore,
      nodeExecutors: { root: () => "never" },
    })).rejects.toBeInstanceOf(DurableRunError);
    const executor = vi.fn(() => "bad");
    await expect(resumeDurableGraphRun(retrying, {
      runId: "cas",
      implementationId: "v1",
      eventStore: new ConflictStore(delegate),
      nodeExecutors: { root: executor },
    })).rejects.toMatchObject({ code: "RESUME_CONFLICT" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("validates zero-attempt outcomes independently of current executor maps", async () => {
    const store = new MemoryEventStore();
    const missing = graph();
    const failed = await startDurableGraphRun(missing, {}, {
      runId: "missing-handler",
      implementationId: "missing@1",
      eventStore: store,
    });
    expect(failed.failures[0]).toMatchObject({ code: "EXECUTOR_NOT_FOUND" });
    expect((await history(store, "missing-handler")).map((event) => event.type)).toEqual([
      "RunCreated", "RunStarted", "NodeSettledWithoutAttempt", "RunFailed",
    ]);
    const withHandler = await resumeDurableGraphRun(missing, {
      runId: "missing-handler",
      implementationId: "missing@1",
      eventStore: store,
      nodeExecutors: { root: () => "would-change-the-outcome" },
    });
    const withoutHandler = await resumeDurableGraphRun(missing, {
      runId: "missing-handler",
      implementationId: "missing@1",
      eventStore: store,
    });
    assert.deepStrictEqual(withHandler, failed);
    assert.deepStrictEqual(withoutHandler, failed);
  });

  it("snapshots the executor registry and gives handlers an immutable canonical graph", async () => {
    const store = new MemoryEventStore();
    const original = vi.fn((context: DurableNodeExecutionContext) => {
      expect(Object.isFrozen(context.graph)).toBe(true);
      expect(Object.isFrozen(context.graph.nodes)).toBe(true);
      expect(Object.isFrozen(context.graph.nodes[0])).toBe(true);
      expect(() => {
        (context.graph.nodes as NodeSpec[])[0]!.id = "mutated";
      }).toThrow(TypeError);
      return "original";
    });
    const replacement = vi.fn(() => "replacement");
    const registry: Record<string, typeof original> = { root: original };
    const running = startDurableGraphRun(graph(), {}, {
      runId: "immutable-inputs",
      implementationId: "v1",
      eventStore: store,
      nodeExecutors: registry,
    });
    registry.root = replacement;
    const result = await running;
    expect(result.output).toEqual({ result: "original" });
    expect(original).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it("rejects implementation, graph, input, and payload identity changes", async () => {
    const source = new MemoryEventStore();
    await startDurableGraphRun(graph(), { seed: 1 }, {
      runId: "identity",
      implementationId: "v1",
      eventStore: source,
      now: fixedNow,
      nodeExecutors: { root: () => "ok" },
    });
    await expect(resumeDurableGraphRun(graph(), {
      runId: "identity", implementationId: "v2", eventStore: source,
    })).rejects.toMatchObject({ code: "IMPLEMENTATION_MISMATCH" });
    await expect(resumeDurableGraphRun(graph({
      nodes: [node("root", { config: { changed: true } })],
    }), {
      runId: "identity", implementationId: "v1", eventStore: source,
    })).rejects.toMatchObject({ code: "GRAPH_HASH_MISMATCH" });

    const events = await history(source, "identity");
    const createdData = { ...events[0]!.data, inputHash: "0".repeat(64) };
    const changedInput = await copyHistory("identity", [
      resign(events[0]!, createdData), ...events.slice(1),
    ]);
    await expect(resumeDurableGraphRun(graph(), {
      runId: "identity", implementationId: "v1", eventStore: changedInput,
    })).rejects.toMatchObject({ code: "INPUT_HASH_MISMATCH" });

    const badPayload = await copyHistory("identity", [
      ...events.slice(0, 2),
      { ...events[2]!, payloadHash: "f".repeat(64) },
      ...events.slice(3),
    ]);
    await expect(resumeDurableGraphRun(graph(), {
      runId: "identity", implementationId: "v1", eventStore: badPayload,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });
  });

  it("rejects resigned terminal and self-consistent scheduled-input forgeries", async () => {
    const source = new MemoryEventStore();
    await startDurableGraphRun(graph(), { seed: 1 }, {
      runId: "forgery",
      implementationId: "v1",
      eventStore: source,
      now: fixedNow,
      nodeExecutors: { root: () => "real" },
    });
    const events = await history(source, "forgery");
    const terminalIndex = events.length - 1;
    const terminalResult = JSON.parse(JSON.stringify(
      decodeDurableJson(events[terminalIndex]!.data.result),
    )) as Record<string, unknown>;
    terminalResult.output = { result: "forged" };
    const forgedTerminal = await copyHistory("forgery", [
      ...events.slice(0, terminalIndex),
      resign(events[terminalIndex]!, { result: encodeDurableJson(terminalResult) }),
    ]);
    await expect(resumeDurableGraphRun(graph(), {
      runId: "forgery", implementationId: "v1", eventStore: forgedTerminal,
      nodeExecutors: { root: () => "real" },
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });

    const scheduledIndex = events.findIndex((event) => event.type === "NodeScheduled");
    const startedIndex = events.findIndex((event) => event.type === "NodeStarted");
    const succeededIndex = events.findIndex((event) => event.type === "NodeSucceeded");
    const forgedInput = { seed: 999 };
    const inputHash = durableJsonHash(forgedInput);
    const activityKey = durableJsonHash([
      "activity/v1alpha1", "forgery", 1, "root", inputHash,
    ]);
    const changed = [...events];
    changed[scheduledIndex] = resign(events[scheduledIndex]!, {
      input: encodeDurableJson(forgedInput), inputHash, activityKey, sideEffects: "none",
    });
    changed[startedIndex] = resign(events[startedIndex]!, { inputHash, activityKey });
    changed[succeededIndex] = resign(events[succeededIndex]!, {
      ...events[succeededIndex]!.data, inputHash,
    });
    const forgedInputStore = await copyHistory("forgery", changed);
    await expect(resumeDurableGraphRun(graph(), {
      runId: "forgery", implementationId: "v1", eventStore: forgedInputStore,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });
  });

  it("accounts for a pending retry when another node reaches the global budget", async () => {
    const limited = graph({
      entrypoints: ["a", "b"],
      outputs: { a: { node: "a" }, b: { node: "b" } },
      nodes: [node("a", { retry: { maxAttempts: 2 } }), node("b")],
      policies: { maxConcurrency: 1, maxTotalAttempts: 2 },
    });
    let aAttempts = 0;
    const b = vi.fn(() => "must-not-run");
    const store = new MemoryEventStore();
    const result = await startDurableGraphRun(limited, {}, {
      runId: "reserved-budget",
      implementationId: "v1",
      eventStore: store,
      concurrency: 1,
      now: fixedNow,
      nodeExecutors: {
        a: () => {
          aAttempts += 1;
          if (aAttempts === 1) throw new Error("retry me");
          return "a-ok";
        },
        b,
      },
    });
    expect(result.status).toBe("failed");
    expect(result.totalAttempts).toBe(2);
    expect(aAttempts).toBe(2);
    expect(b).not.toHaveBeenCalled();
    expect((await history(store, "reserved-budget")).some(
      (event) => event.type === "NodeSettledWithoutAttempt" && event.nodeId === "b",
    )).toBe(true);
    const terminal = await resumeDurableGraphRun(limited, {
      runId: "reserved-budget", implementationId: "v1", eventStore: store,
      nodeExecutors: { a: () => "unused", b: () => "unused" },
    });
    assert.deepStrictEqual(terminal, result);
  });

  it("reserves the last retry slot across multiple interrupted nodes and validates retry flags", async () => {
    const twoRoots = graph({
      entrypoints: ["a", "b"],
      outputs: { a: { node: "a" }, b: { node: "b" } },
      nodes: [
        node("a", { retry: { maxAttempts: 2 } }),
        node("b", { retry: { maxAttempts: 2 } }),
      ],
      policies: { maxConcurrency: 2, maxTotalAttempts: 3 },
    });
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeStarted" && event.nodeId === "b"),
    );
    const waitForAbort = ({ signal }: DurableNodeExecutionContext): Promise<never> =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    await expect(startDurableGraphRun(twoRoots, {}, {
      runId: "last-token",
      implementationId: "v1",
      eventStore: crashStore,
      concurrency: 2,
      now: fixedNow,
      nodeExecutors: { a: waitForAbort, b: () => "never" },
    })).rejects.toMatchObject({ code: "DURABILITY_STORE_FAILED" });
    const before = await history(delegate, "last-token");
    expect(before.filter((event) => event.type === "NodeStarted")).toHaveLength(2);

    const calls: Array<[string, number]> = [];
    const result = await resumeDurableGraphRun(twoRoots, {
      runId: "last-token",
      implementationId: "v1",
      eventStore: crashStore,
      now: fixedNow,
      nodeExecutors: {
        a: (context) => {
          calls.push([context.node.id, context.attempt]);
          return "a-ok";
        },
        b: (context) => {
          calls.push([context.node.id, context.attempt]);
          return "b-must-not-run";
        },
      },
    });
    expect(calls).toEqual([["a", 2]]);
    expect(result.totalAttempts).toBe(3);
    expect(result.nodes.find((item) => item.nodeId === "b")?.failure).toMatchObject({
      code: "NODE_EXECUTION_INTERRUPTED", retryable: false,
    });
    const events = await history(delegate, "last-token");
    const interrupted = events.filter((event) =>
      event.type === "NodeAttemptFailed" &&
      (event.data.failure as { code?: string }).code === "NODE_EXECUTION_INTERRUPTED");
    expect(interrupted.map((event) => [
      event.nodeId,
      event.data.terminal,
      (event.data.failure as { retryable: boolean }).retryable,
    ])).toEqual([
      ["a", false, true],
      ["b", true, false],
    ]);

    const aIndex = events.indexOf(interrupted[0]!);
    const forgedEarlyTerminal = [...events.slice(0, aIndex + 1)];
    const aFailure = interrupted[0]!.data.failure as Record<string, unknown>;
    forgedEarlyTerminal[aIndex] = resign(interrupted[0]!, {
      terminal: true,
      failure: { ...aFailure, retryable: false },
    });
    const earlyStore = await copyHistory("last-token", forgedEarlyTerminal);
    await expect(resumeDurableGraphRun(twoRoots, {
      runId: "last-token", implementationId: "v1", eventStore: earlyStore,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });

    const bIndex = events.indexOf(interrupted[1]!);
    const forgedExtraRetry = [...events.slice(0, bIndex + 1)];
    const bFailure = interrupted[1]!.data.failure as Record<string, unknown>;
    forgedExtraRetry[bIndex] = resign(interrupted[1]!, {
      terminal: false,
      failure: { ...bFailure, retryable: true },
    });
    const extraStore = await copyHistory("last-token", forgedExtraRetry);
    await expect(resumeDurableGraphRun(twoRoots, {
      runId: "last-token", implementationId: "v1", eventStore: extraStore,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });

    const retriedIndex = events.findIndex((event) =>
      event.type === "NodeRetried" && event.nodeId === "a");
    const invalidDate = [...events];
    invalidDate[retriedIndex] = resign(events[retriedIndex]!, {
      ...events[retriedIndex]!.data,
      availableAt: "2026-02-31T12:00:00.000Z",
    });
    const invalidDateStore = await copyHistory("last-token", invalidDate);
    await expect(resumeDurableGraphRun(twoRoots, {
      runId: "last-token", implementationId: "v1", eventStore: invalidDateStore,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });

    const yearZero = [...events];
    yearZero[retriedIndex] = resign(events[retriedIndex]!, {
      ...events[retriedIndex]!.data,
      availableAt: "0000-01-01T00:00:00.000Z",
    });
    const yearZeroStore = await copyHistory("last-token", yearZero);
    await expect(resumeDurableGraphRun(twoRoots, {
      runId: "last-token", implementationId: "v1", eventStore: yearZeroStore,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });
  });

  it("rejects non-attempt codes in NodeAttemptFailed", async () => {
    const retrying = graph({ nodes: [node("root", { retry: { maxAttempts: 2 } })] });
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeStarted"),
    );
    await expect(startDurableGraphRun(retrying, {}, {
      runId: "bad-attempt-code",
      implementationId: "v1",
      eventStore: crashStore,
      nodeExecutors: { root: () => "never" },
    })).rejects.toBeInstanceOf(DurableRunError);
    const events = await history(delegate, "bad-attempt-code");
    const suffix = forgedEvent({
      runId: "bad-attempt-code",
      sequence: events.length,
      type: "NodeAttemptFailed",
      nodeId: "root",
      attempt: 1,
      data: {
        terminal: true,
        failure: {
          phase: "execute",
          code: "EXECUTOR_NOT_FOUND",
          message: "forged",
          nodeId: "root",
          attempt: 1,
          retryable: false,
        },
      },
    });
    await delegate.append("bad-attempt-code", events.length - 1, [suffix]);
    await expect(resumeDurableGraphRun(retrying, {
      runId: "bad-attempt-code", implementationId: "v1", eventStore: delegate,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });
  });

  it("rejects a dependant settlement before every upstream outcome exists", async () => {
    const chain = graph({
      outputs: { result: { node: "dependent" } },
      nodes: [node("root", { retry: { maxAttempts: 2 } }), node("dependent")],
      edges: [{ id: "root-dependent", from: { node: "root" }, to: { node: "dependent" } }],
    });
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeStarted" && event.nodeId === "root"),
    );
    await expect(startDurableGraphRun(chain, {}, {
      runId: "premature-dependent",
      implementationId: "v1",
      eventStore: crashStore,
      nodeExecutors: { root: () => "never", dependent: () => "never" },
    })).rejects.toBeInstanceOf(DurableRunError);
    const events = await history(delegate, "premature-dependent");
    const result = {
      nodeId: "dependent",
      sequence: 1,
      status: "skipped",
      attempts: 0,
      failure: {
        phase: "execute",
        code: "UPSTREAM_FAILED",
        message: "Node 'dependent' did not start because upstream nodes failed: root",
        nodeId: "dependent",
        attempt: 0,
        retryable: false,
        upstreamNodeIds: ["root"],
      },
    };
    await delegate.append("premature-dependent", events.length - 1, [forgedEvent({
      runId: "premature-dependent",
      sequence: events.length,
      type: "NodeSettledWithoutAttempt",
      nodeId: "dependent",
      data: { result: encodeDurableJson(result) },
    })]);
    await expect(resumeDurableGraphRun(chain, {
      runId: "premature-dependent", implementationId: "v1", eventStore: delegate,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });
  });

  it("does not resolve inherited executor properties for durable nodes", async () => {
    const inheritedName = graph({
      entrypoints: ["toString"],
      outputs: { result: { node: "toString" } },
      nodes: [node("toString")],
    });
    const result = await startDurableGraphRun(inheritedName, {}, {
      runId: "own-executors",
      implementationId: "v1",
      eventStore: new MemoryEventStore(),
      nodeExecutors: {},
      executors: {},
    });
    expect(result.status).toBe("failed");
    expect(result.failures[0]).toMatchObject({ code: "EXECUTOR_NOT_FOUND", nodeId: "toString" });
  });

  it("preserves a persisted retry reservation after NodeScheduled and avoids duplicate scheduling", async () => {
    const retrying = graph({
      nodes: [node("root", { retry: { maxAttempts: 2 } })],
      policies: { maxTotalAttempts: 2 },
    });
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeRetried"),
    );
    await expect(startDurableGraphRun(retrying, { seed: 1 }, {
      runId: "pre-scheduled-retry",
      implementationId: "v1",
      eventStore: crashStore,
      now: fixedNow,
      nodeExecutors: { root: () => { throw new Error("retry"); } },
    })).rejects.toMatchObject({ code: "DURABILITY_STORE_FAILED" });
    const events = await history(delegate, "pre-scheduled-retry");
    const firstSchedule = events.find((event) => event.type === "NodeScheduled")!;
    await delegate.append("pre-scheduled-retry", events.length - 1, [forgedEvent({
      runId: "pre-scheduled-retry",
      sequence: events.length,
      type: "NodeScheduled",
      nodeId: "root",
      attempt: 2,
      data: firstSchedule.data,
    })]);
    const calls: number[] = [];
    const result = await resumeDurableGraphRun(retrying, {
      runId: "pre-scheduled-retry",
      implementationId: "v1",
      eventStore: crashStore,
      now: fixedNow,
      nodeExecutors: {
        root: (context) => {
          calls.push(context.attempt);
          return "ok";
        },
      },
    });
    expect(calls).toEqual([2]);
    expect(result.totalAttempts).toBe(2);
    const complete = await history(delegate, "pre-scheduled-retry");
    expect(complete.filter((event) =>
      event.type === "NodeScheduled" && event.nodeId === "root")).toHaveLength(2);
    expect(complete.filter((event) =>
      event.type === "NodeStarted" && event.nodeId === "root")).toHaveLength(2);
  });

  it("records a pre-cancelled pending retry with its historical attempt offset", async () => {
    const retrying = graph({
      nodes: [node("root", { retry: { maxAttempts: 2 } })],
      policies: { maxTotalAttempts: 2 },
    });
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeRetried"),
    );
    await expect(startDurableGraphRun(retrying, {}, {
      runId: "cancel-pending-retry",
      implementationId: "v1",
      eventStore: crashStore,
      now: fixedNow,
      nodeExecutors: { root: () => { throw new Error("retry"); } },
    })).rejects.toBeInstanceOf(DurableRunError);
    const controller = new AbortController();
    controller.abort(new Error("cancel before resume"));
    const executor = vi.fn(() => "must-not-run");
    const result = await resumeDurableGraphRun(retrying, {
      runId: "cancel-pending-retry",
      implementationId: "v1",
      eventStore: crashStore,
      signal: controller.signal,
      now: fixedNow,
      nodeExecutors: { root: executor },
    });
    expect(executor).not.toHaveBeenCalled();
    expect(result.status).toBe("cancelled");
    expect(result.nodes[0]).toMatchObject({
      nodeId: "root",
      status: "skipped",
      attempts: 1,
      failure: { code: "NODE_CANCELLED", attempt: 1 },
    });
    const events = await history(delegate, "cancel-pending-retry");
    const settled = events.find((event) => event.type === "NodeSettledWithoutAttempt")!;
    expect(decodeDurableJson(settled.data.result)).toMatchObject({
      nodeId: "root", attempts: 1, failure: { attempt: 1 },
    });
    const terminal = await resumeDurableGraphRun(retrying, {
      runId: "cancel-pending-retry",
      implementationId: "v1",
      eventStore: crashStore,
    });
    assert.deepStrictEqual(terminal, result);
  });

  it("accepts foreign human text while keeping NodeSettled semantics strict", async () => {
    const source = new MemoryEventStore();
    await startDurableGraphRun(graph(), {}, {
      runId: "foreign-settled-text",
      implementationId: "v1",
      eventStore: source,
      now: fixedNow,
    });
    const events = await history(source, "foreign-settled-text");
    const settledIndex = events.findIndex((event) => event.type === "NodeSettledWithoutAttempt");
    const terminalIndex = events.length - 1;
    const settledResult = JSON.parse(JSON.stringify(
      decodeDurableJson(events[settledIndex]!.data.result),
    )) as { failure: Record<string, unknown> };
    settledResult.failure.message = "python-style: executor missing";
    settledResult.failure.causeName = "ForeignRuntime";
    const terminalResult = JSON.parse(JSON.stringify(
      decodeDurableJson(events[terminalIndex]!.data.result),
    )) as {
      nodes: Array<{ failure: Record<string, unknown> }>;
      failures: Array<Record<string, unknown>>;
    };
    terminalResult.nodes[0]!.failure = { ...settledResult.failure };
    terminalResult.failures[0] = { ...settledResult.failure };
    const foreign = [...events];
    foreign[settledIndex] = resign(events[settledIndex]!, {
      result: encodeDurableJson(settledResult),
    });
    foreign[terminalIndex] = resign(events[terminalIndex]!, {
      result: encodeDurableJson(terminalResult),
    });
    const store = await copyHistory("foreign-settled-text", foreign);
    await expect(resumeDurableGraphRun(graph(), {
      runId: "foreign-settled-text", implementationId: "v1", eventStore: store,
    })).resolves.toMatchObject({ status: "failed" });
  });

  it("accepts a foreign cancelled-attempt message but preserves cancellation structure", async () => {
    const source = new MemoryEventStore();
    const controller = new AbortController();
    await startDurableGraphRun(graph(), {}, {
      runId: "foreign-cancel-text",
      implementationId: "v1",
      eventStore: source,
      now: fixedNow,
      signal: controller.signal,
      nodeExecutors: {
        root: () => {
          controller.abort(new Error("stop"));
          return "ignored";
        },
      },
    });
    const events = await history(source, "foreign-cancel-text");
    const failedIndex = events.findIndex((event) => event.type === "NodeAttemptFailed");
    const terminalIndex = events.length - 1;
    const failure = events[failedIndex]!.data.failure as Record<string, unknown>;
    const foreignFailure = { ...failure, message: "node 'root' was cancelled" };
    const terminalResult = JSON.parse(JSON.stringify(
      decodeDurableJson(events[terminalIndex]!.data.result),
    )) as {
      nodes: Array<{ failure: Record<string, unknown> }>;
      failures: Array<Record<string, unknown>>;
    };
    terminalResult.nodes[0]!.failure = { ...foreignFailure };
    terminalResult.failures[0] = { ...foreignFailure };
    const foreign = [...events];
    foreign[failedIndex] = resign(events[failedIndex]!, {
      terminal: true, failure: foreignFailure,
    });
    foreign[terminalIndex] = resign(events[terminalIndex]!, {
      result: encodeDurableJson(terminalResult),
    });
    const store = await copyHistory("foreign-cancel-text", foreign);
    await expect(resumeDurableGraphRun(graph(), {
      runId: "foreign-cancel-text", implementationId: "v1", eventStore: store,
      nodeExecutors: { root: () => "unused" },
    })).resolves.toMatchObject({ status: "cancelled" });
  });

  it("compares output-binding failures without runtime-specific human text", async () => {
    const outputGraph = graph({ outputs: { result: { node: "root", port: "missing" } } });
    const source = new MemoryEventStore();
    await startDurableGraphRun(outputGraph, {}, {
      runId: "foreign-output-text",
      implementationId: "v1",
      eventStore: source,
      now: fixedNow,
      nodeExecutors: { root: () => ({ actual: true }) },
    });
    const events = await history(source, "foreign-output-text");
    const terminalIndex = events.length - 1;
    const terminalResult = JSON.parse(JSON.stringify(
      decodeDurableJson(events[terminalIndex]!.data.result),
    )) as { failures: Array<Record<string, unknown>> };
    terminalResult.failures[0]!.message = "foreign runtime output binding wording";
    const foreign = [...events];
    foreign[terminalIndex] = resign(events[terminalIndex]!, {
      result: encodeDurableJson(terminalResult),
    });
    const store = await copyHistory("foreign-output-text", foreign);
    await expect(resumeDurableGraphRun(outputGraph, {
      runId: "foreign-output-text", implementationId: "v1", eventStore: store,
      nodeExecutors: { root: () => "unused" },
    })).resolves.toMatchObject({
      status: "failed",
      failures: [expect.objectContaining({ code: "OUTPUT_BINDING_FAILED" })],
    });
  });

  it("durably transports __proto__ as an own edge and graph-output key", async () => {
    const outputs = JSON.parse('{"__proto__":{"node":"consumer"}}') as GraphSpec["outputs"];
    const document = graph({
      outputs,
      nodes: [node("root"), node("consumer")],
      edges: [{
        id: "root-consumer",
        from: { node: "root" },
        to: { node: "consumer", port: "__proto__" },
      }],
    });
    const store = new MemoryEventStore();
    let boundInput: Record<string, unknown> | undefined;
    const result = await startDurableGraphRun(document, {}, {
      runId: "durable-proto-key",
      implementationId: "v1",
      eventStore: store,
      nodeExecutors: {
        root: () => ({ safe: true }),
        consumer: ({ input }) => {
          boundInput = input as Record<string, unknown>;
          return { received: Object.hasOwn(input as object, "__proto__") };
        },
      },
    });
    expect(result.status).toBe("succeeded");
    expect(Object.hasOwn(boundInput as object, "__proto__")).toBe(true);
    expect(boundInput?.__proto__).toEqual({ safe: true });
    expect(Object.getPrototypeOf(boundInput)).toBe(Object.prototype);
    expect(Object.hasOwn(result.output as object, "__proto__")).toBe(true);
    expect(result.output?.__proto__).toEqual({ received: true });
    const terminal = await resumeDurableGraphRun(document, {
      runId: "durable-proto-key",
      implementationId: "v1",
      eventStore: store,
    });
    assert.deepStrictEqual(terminal, result);
  });

  it("rejects duplicate or invalid writer event IDs before committing their batch", async () => {
    for (const [runId, factory] of [
      ["duplicate-initial-ids", () => "duplicate"],
      ["invalid-initial-id", () => ""],
      ["throwing-id-factory", () => { throw new Error("factory failed"); }],
    ] as const) {
      const store = new MemoryEventStore();
      const executor = vi.fn(() => "never");
      await expect(startDurableGraphRun(graph(), {}, {
        runId,
        implementationId: "v1",
        eventStore: store,
        createEventId: factory,
        nodeExecutors: { root: executor },
      })).rejects.toMatchObject({ code: "DURABILITY_STORE_FAILED" });
      expect(await history(store, runId)).toEqual([]);
      expect(executor).not.toHaveBeenCalled();
    }
  });

  it("maps throwing and invalid writer clocks to a latched durability failure", async () => {
    for (const [runId, now] of [
      ["throwing-clock", () => { throw new Error("clock failed"); }],
      ["invalid-clock", () => new Date(Number.NaN)],
    ] as const) {
      const store = new MemoryEventStore();
      const executor = vi.fn(() => "never");
      await expect(startDurableGraphRun(graph(), {}, {
        runId,
        implementationId: "v1",
        eventStore: store,
        now,
        nodeExecutors: { root: executor },
      })).rejects.toMatchObject({ code: "DURABILITY_STORE_FAILED" });
      expect(await history(store, runId)).toEqual([]);
      expect(executor).not.toHaveBeenCalled();
    }
  });

  it("rejects a resume event ID that collides with committed history", async () => {
    const retrying = graph({ nodes: [node("root", { retry: { maxAttempts: 2 } })] });
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeStarted"),
    );
    await expect(startDurableGraphRun(retrying, {}, {
      runId: "resume-id-collision",
      implementationId: "v1",
      eventStore: crashStore,
      nodeExecutors: { root: () => "never" },
    })).rejects.toBeInstanceOf(DurableRunError);
    const before = await history(delegate, "resume-id-collision");
    const executor = vi.fn(() => "never");
    await expect(resumeDurableGraphRun(retrying, {
      runId: "resume-id-collision",
      implementationId: "v1",
      eventStore: crashStore,
      createEventId: () => before[0]!.eventId,
      nodeExecutors: { root: executor },
    })).rejects.toMatchObject({ code: "DURABILITY_STORE_FAILED" });
    expect(await history(delegate, "resume-id-collision")).toEqual(before);
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects a second NodeStarted after success, terminal failure, or NodeRetried", async () => {
    const successSource = new MemoryEventStore();
    await startDurableGraphRun(graph(), {}, {
      runId: "duplicate-start-success",
      implementationId: "v1",
      eventStore: successSource,
      nodeExecutors: { root: () => "ok" },
    });
    const successEvents = await history(successSource, "duplicate-start-success");
    const successIndex = successEvents.findIndex((event) => event.type === "NodeSucceeded");
    const originalStart = successEvents.find((event) => event.type === "NodeStarted")!;
    const successPrefix = successEvents.slice(0, successIndex + 1);
    const forgedSuccess = await copyHistory("duplicate-start-success", [
      ...successPrefix,
      forgedEvent({
        runId: "duplicate-start-success",
        sequence: successPrefix.length,
        type: "NodeStarted",
        nodeId: "root",
        attempt: 1,
        data: originalStart.data,
      }),
    ]);
    await expect(resumeDurableGraphRun(graph(), {
      runId: "duplicate-start-success", implementationId: "v1", eventStore: forgedSuccess,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });

    const failureSource = new MemoryEventStore();
    await startDurableGraphRun(graph(), {}, {
      runId: "duplicate-start-failure",
      implementationId: "v1",
      eventStore: failureSource,
      nodeExecutors: { root: () => { throw new Error("failed"); } },
    });
    const failureEvents = await history(failureSource, "duplicate-start-failure");
    const failedIndex = failureEvents.findIndex((event) => event.type === "NodeAttemptFailed");
    const failurePrefix = failureEvents.slice(0, failedIndex + 1);
    const failedStart = failureEvents.find((event) => event.type === "NodeStarted")!;
    const forgedFailure = await copyHistory("duplicate-start-failure", [
      ...failurePrefix,
      forgedEvent({
        runId: "duplicate-start-failure",
        sequence: failurePrefix.length,
        type: "NodeStarted",
        nodeId: "root",
        attempt: 1,
        data: failedStart.data,
      }),
    ]);
    await expect(resumeDurableGraphRun(graph(), {
      runId: "duplicate-start-failure", implementationId: "v1", eventStore: forgedFailure,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });

    const retrying = graph({ nodes: [node("root", { retry: { maxAttempts: 2 } })] });
    const retryDelegate = new MemoryEventStore();
    const retryCrash = new CommitThenThrowStore(
      retryDelegate,
      (batch) => batch.some((event) => event.type === "NodeRetried"),
    );
    await expect(startDurableGraphRun(retrying, {}, {
      runId: "duplicate-start-retry",
      implementationId: "v1",
      eventStore: retryCrash,
      nodeExecutors: { root: () => { throw new Error("retry"); } },
    })).rejects.toBeInstanceOf(DurableRunError);
    const retryEvents = await history(retryDelegate, "duplicate-start-retry");
    const retryStart = retryEvents.find((event) => event.type === "NodeStarted")!;
    await retryDelegate.append("duplicate-start-retry", retryEvents.length - 1, [forgedEvent({
      runId: "duplicate-start-retry",
      sequence: retryEvents.length,
      type: "NodeStarted",
      nodeId: "root",
      attempt: 1,
      data: retryStart.data,
    })]);
    await expect(resumeDurableGraphRun(retrying, {
      runId: "duplicate-start-retry", implementationId: "v1", eventStore: retryDelegate,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });
  });

  it("rejects history whose open attempts exceed the graph concurrency policy", async () => {
    const limited = graph({
      entrypoints: ["a", "b"],
      outputs: { a: { node: "a" }, b: { node: "b" } },
      nodes: [node("a", { retry: { maxAttempts: 2 } }), node("b")],
      policies: { maxConcurrency: 1, maxTotalAttempts: 2 },
    });
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeStarted" && event.nodeId === "a"),
    );
    await expect(startDurableGraphRun(limited, {}, {
      runId: "forged-concurrency",
      implementationId: "v1",
      eventStore: crashStore,
      concurrency: 1,
      nodeExecutors: { a: () => "never", b: () => "never" },
    })).rejects.toBeInstanceOf(DurableRunError);
    const events = await history(delegate, "forged-concurrency");
    const inputHash = durableJsonHash({});
    const activityKey = durableJsonHash([
      "activity/v1alpha1", "forged-concurrency", 1, "b", inputHash,
    ]);
    await delegate.append("forged-concurrency", events.length - 1, [
      forgedEvent({
        runId: "forged-concurrency",
        sequence: events.length,
        type: "NodeScheduled",
        nodeId: "b",
        attempt: 1,
        data: {
          input: encodeDurableJson({}), inputHash, activityKey, sideEffects: "none",
        },
      }),
      forgedEvent({
        runId: "forged-concurrency",
        sequence: events.length + 1,
        type: "NodeStarted",
        nodeId: "b",
        attempt: 1,
        data: { inputHash, activityKey },
      }),
    ]);
    await expect(resumeDurableGraphRun(limited, {
      runId: "forged-concurrency", implementationId: "v1", eventStore: delegate,
    })).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });
  });

  it("consumes the shared strict RFC 3339 corpus for retry availability", async () => {
    const corpusPath = fileURLToPath(
      new URL("../../../spec/conformance/strict-rfc3339.case.json", import.meta.url),
    );
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as {
      valid: string[];
      invalid: string[];
    };
    const retrying = graph({ nodes: [node("root", { retry: { maxAttempts: 2 } })] });
    const delegate = new MemoryEventStore();
    const crashStore = new CommitThenThrowStore(
      delegate,
      (batch) => batch.some((event) => event.type === "NodeRetried"),
    );
    await expect(startDurableGraphRun(retrying, {}, {
      runId: "date-corpus",
      implementationId: "v1",
      eventStore: crashStore,
      now: fixedNow,
      nodeExecutors: { root: () => { throw new Error("retry"); } },
    })).rejects.toBeInstanceOf(DurableRunError);
    const base = await history(delegate, "date-corpus");
    const retriedIndex = base.findIndex((event) => event.type === "NodeRetried");
    for (const availableAt of corpus.valid) {
      const events = [...base];
      events[retriedIndex] = resign(base[retriedIndex]!, {
        ...base[retriedIndex]!.data, availableAt,
      });
      const store = await copyHistory("date-corpus", events);
      await expect(resumeDurableGraphRun(retrying, {
        runId: "date-corpus",
        implementationId: "v1",
        eventStore: new ConflictStore(store),
      }), availableAt).rejects.toMatchObject({ code: "RESUME_CONFLICT" });
    }
    for (const availableAt of corpus.invalid) {
      const events = [...base];
      events[retriedIndex] = resign(base[retriedIndex]!, {
        ...base[retriedIndex]!.data, availableAt,
      });
      const store = await copyHistory("date-corpus", events);
      await expect(resumeDurableGraphRun(retrying, {
        runId: "date-corpus",
        implementationId: "v1",
        eventStore: store,
      }), availableAt).rejects.toMatchObject({ code: "INVALID_RUN_HISTORY" });
    }
  });

  it("latches an unrepresentable retry date and resumes after the clock is corrected", async () => {
    const retrying = graph({
      nodes: [node("root", {
        retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
      })],
    });
    const store = new MemoryEventStore();
    let attempts = 0;
    await expect(startDurableGraphRun(retrying, {}, {
      runId: "clock-boundary",
      implementationId: "v1",
      eventStore: store,
      now: () => new Date("9999-12-31T23:59:59.999Z"),
      nodeExecutors: {
        root: () => {
          attempts += 1;
          throw new Error("retry beyond year 9999");
        },
      },
    })).rejects.toMatchObject({ code: "DURABILITY_STORE_FAILED" });
    expect((await history(store, "clock-boundary")).at(-1)?.type).toBe("NodeStarted");
    const result = await resumeDurableGraphRun(retrying, {
      runId: "clock-boundary",
      implementationId: "v1",
      eventStore: store,
      now: fixedNow,
      nodeExecutors: {
        root: (context) => {
          attempts += 1;
          expect(context.attempt).toBe(2);
          return "recovered";
        },
      },
    });
    expect(result.status).toBe("succeeded");
    expect(attempts).toBe(2);
  });

  it("accepts the timer ceiling and rejects the shared oversized fixture before persistence", async () => {
    const maximum = 2_147_483_647;
    const atLimit = graph({
      nodes: [node("root", {
        timeoutMs: maximum,
        retry: { maxAttempts: 2, initialDelayMs: maximum, maxDelayMs: maximum },
      })],
    });
    const accepted = await startDurableGraphRun(atLimit, {}, {
      runId: "timer-limit",
      implementationId: "v1",
      eventStore: new MemoryEventStore(),
      nodeExecutors: { root: () => "immediate" },
    });
    expect(accepted.status).toBe("succeeded");

    const fixturePath = fileURLToPath(
      new URL("../../../spec/conformance/invalid-oversized-timers.graph.json", import.meta.url),
    );
    const oversized = JSON.parse(readFileSync(fixturePath, "utf8")) as GraphSpec;
    const store = new MemoryEventStore();
    const executor = vi.fn(() => "never");
    const rejected = await startDurableGraphRun(oversized, {}, {
      runId: "timer-oversized",
      implementationId: "v1",
      eventStore: store,
      nodeExecutors: { root: executor },
    });
    expect(rejected).toMatchObject({
      status: "failed",
      graphHash: null,
      failures: [expect.objectContaining({ code: "GE1007_INVALID_GRAPH" })],
    });
    expect(await history(store, "timer-oversized")).toEqual([]);
    expect(executor).not.toHaveBeenCalled();
  });
});
