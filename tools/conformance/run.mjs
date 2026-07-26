#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixtureRoot = join(root, "spec", "conformance");
const coreUrl = pathToFileURL(join(root, "packages", "core", "dist", "index.js"));

let core;
try {
  core = await import(coreUrl.href);
} catch (error) {
  throw new Error("TypeScript core is not built; run `corepack pnpm --filter @graph-engineering/core build`", {
    cause: error,
  });
}

const python = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_report.py"],
  { cwd: root, encoding: "utf8" },
);
if (python.status !== 0) {
  throw new Error(`Python conformance report failed:\n${python.stderr || python.stdout}`);
}

const pythonReport = JSON.parse(python.stdout);
const expected = JSON.parse(await readFile(join(fixtureRoot, "expected.json"), "utf8"));
let checked = 0;

for (const [name, expectation] of Object.entries(expected.compilation)) {
  const graph = JSON.parse(await readFile(join(fixtureRoot, name), "utf8"));
  const result = core.compileGraph(graph);
  const tsReport = {
    valid: result.valid,
    canonicalSha256: result.graphHash,
    diagnosticCodes: result.diagnostics.map(({ code }) => code),
    topologicalLayers: result.topologicalLayers,
  };

  assert.equal(tsReport.valid, expectation.valid, `${name}: TypeScript validity differs from expected`);
  assert.equal(pythonReport[name].valid, expectation.valid, `${name}: Python validity differs from expected`);
  assert.deepEqual(
    tsReport.diagnosticCodes,
    expectation.diagnosticCodes ?? [],
    `${name}: TypeScript diagnostics differ from expected`,
  );
  assert.deepEqual(
    pythonReport[name].diagnosticCodes,
    expectation.diagnosticCodes ?? [],
    `${name}: Python diagnostics differ from expected`,
  );
  assert.equal(
    tsReport.canonicalSha256,
    pythonReport[name].canonicalSha256,
    `${name}: canonical hashes differ between runtimes`,
  );
  if (expectation.topologicalLayers !== undefined) {
    assert.deepEqual(tsReport.topologicalLayers, expectation.topologicalLayers, `${name}: TS layers differ`);
    assert.deepEqual(
      pythonReport[name].topologicalLayers,
      expectation.topologicalLayers,
      `${name}: Python layers differ`,
    );
  }
  checked += 1;
}

process.stdout.write(`Cross-language conformance passed for ${checked} graph fixtures.\n`);

const runtimeCase = JSON.parse(
  await readFile(join(fixtureRoot, "runtime-ready-queue.case.json"), "utf8"),
);
const pythonRuntime = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_runtime_report.py"],
  { cwd: root, encoding: "utf8" },
);
if (pythonRuntime.status !== 0) {
  throw new Error(`Python runtime conformance failed:\n${pythonRuntime.stderr || pythonRuntime.stdout}`);
}

const runtime = await import(
  pathToFileURL(join(root, "packages", "runtime", "dist", "index.js")).href
);
const {
  decodeDurableJson,
  resumeDurableGraphRun,
  runGraph,
  startDurableGraphRun,
} = runtime;
const tsCompletion = [];
const tsInputs = {};
const nodeExecutors = {};
for (const [nodeId, returned] of Object.entries(runtimeCase.mock.returns)) {
  nodeExecutors[nodeId] = async ({ input }) => {
    tsInputs[nodeId] = input;
    await new Promise((resolve) => setTimeout(resolve, runtimeCase.mock.delaysMs[nodeId]));
    tsCompletion.push(nodeId);
    return returned;
  };
}
const tsRuntimeResult = await runGraph(runtimeCase.graph, runtimeCase.mock.graphInput, { nodeExecutors });
const tsRuntime = {
  status: tsRuntimeResult.status,
  maxObservedConcurrency: tsRuntimeResult.maxObservedConcurrency,
  completionOrder: tsCompletion,
  inputs: tsInputs,
  outputs: tsRuntimeResult.output,
};
const pyRuntime = JSON.parse(pythonRuntime.stdout);

for (const report of [tsRuntime, pyRuntime]) {
  assert.equal(report.status, runtimeCase.expect.status);
  assert.equal(report.maxObservedConcurrency, runtimeCase.expect.maxObservedConcurrency);
  assert.deepEqual(report.inputs, runtimeCase.expect.inputs);
  assert.deepEqual(report.outputs, runtimeCase.expect.outputs);
  for (const [before, after] of runtimeCase.expect.mustCompleteBefore) {
    assert.ok(
      report.completionOrder.indexOf(before) < report.completionOrder.indexOf(after),
      `${before} must complete before ${after}: ${report.completionOrder.join(" -> ")}`,
    );
  }
}

process.stdout.write("Cross-language runtime ready-queue conformance passed.\n");

function normalizeRuntimeResult(result, executed) {
  return {
    status: result.status,
    nodeStatuses: Object.fromEntries(result.nodes.map((node) => [node.nodeId, node.status])),
    failureCodes: result.failures.map((failure) => failure.code),
    attempts: Object.fromEntries(result.nodes.map((node) => [node.nodeId, node.attempts])),
    outputs: result.output ?? {},
    executed: [...executed].sort(),
  };
}

const invalidOutputCase = JSON.parse(
  await readFile(join(fixtureRoot, "runtime-invalid-output.case.json"), "utf8"),
);
const invalidExecuted = [];
const invalidResult = await runGraph(
  invalidOutputCase.graph,
  invalidOutputCase.mock.graphInput,
  {
    nodeExecutors: {
      bad: async () => {
        invalidExecuted.push("bad");
        return { value: 1n };
      },
      good: async () => {
        invalidExecuted.push("good");
        return invalidOutputCase.mock.returns.good;
      },
      "bad-child": async () => {
        invalidExecuted.push("bad-child");
        return invalidOutputCase.mock.returns["bad-child"];
      },
    },
  },
);
const tsInvalidOutput = normalizeRuntimeResult(invalidResult, invalidExecuted);

const cancellationCase = JSON.parse(
  await readFile(join(fixtureRoot, "runtime-cancellation.case.json"), "utf8"),
);
const cancellationExecuted = [];
const cancellationController = new AbortController();
let markSlowStarted;
const slowStarted = new Promise((resolve) => {
  markSlowStarted = resolve;
});
const cancellationTask = runGraph(
  cancellationCase.graph,
  cancellationCase.mock.graphInput,
  {
    signal: cancellationController.signal,
    nodeExecutors: {
      fast: async () => {
        cancellationExecuted.push("fast");
        return cancellationCase.mock.returns.fast;
      },
      slow: async ({ signal }) => {
        cancellationExecuted.push("slow");
        markSlowStarted();
        return await new Promise((resolve, reject) => {
          const cancel = () => reject(signal.reason ?? new Error("cancelled"));
          if (signal.aborted) cancel();
          else signal.addEventListener("abort", cancel, { once: true });
        });
      },
      "after-slow": async () => {
        cancellationExecuted.push("after-slow");
        return cancellationCase.mock.returns["after-slow"];
      },
    },
  },
);
await slowStarted;
cancellationController.abort(new Error("conformance cancellation"));
const tsCancellation = normalizeRuntimeResult(await cancellationTask, cancellationExecuted);

const pythonRuntimeExtended = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_runtime_extended_report.py"],
  { cwd: root, encoding: "utf8" },
);
if (pythonRuntimeExtended.status !== 0) {
  throw new Error(
    `Python extended runtime conformance failed:\n${pythonRuntimeExtended.stderr || pythonRuntimeExtended.stdout}`,
  );
}
const pyRuntimeExtended = JSON.parse(pythonRuntimeExtended.stdout);
assert.deepEqual(tsInvalidOutput, pyRuntimeExtended.invalidOutput, "invalid-output reports differ");
assert.deepEqual(tsCancellation, pyRuntimeExtended.cancellation, "cancellation reports differ");

for (const [report, runtimeCase] of [
  [tsInvalidOutput, invalidOutputCase],
  [tsCancellation, cancellationCase],
]) {
  assert.equal(report.status, runtimeCase.expect.status);
  assert.deepEqual(report.nodeStatuses, runtimeCase.expect.nodeStatuses);
  assert.deepEqual(report.failureCodes, runtimeCase.expect.failureCodes);
  assert.deepEqual(report.outputs, runtimeCase.expect.outputs);
  if (runtimeCase.expect.attempts !== undefined) {
    assert.deepEqual(report.attempts, runtimeCase.expect.attempts);
  }
  for (const nodeId of runtimeCase.expect.mustNotExecute) {
    assert.equal(report.executed.includes(nodeId), false, `${nodeId} must not execute`);
  }
}

process.stdout.write("Cross-language invalid-output and cancellation conformance passed.\n");

const barrierFixture = JSON.parse(
  await readFile(join(fixtureRoot, "settled-barrier.case.json"), "utf8"),
);
const primitives = await import(
  pathToFileURL(join(root, "packages", "primitives", "dist", "index.js")).href
);
const pythonPrimitives = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_primitives_report.py"],
  { cwd: root, encoding: "utf8" },
);
if (pythonPrimitives.status !== 0) {
  throw new Error(
    `Python primitives conformance failed:\n${pythonPrimitives.stderr || pythonPrimitives.stdout}`,
  );
}
const pyPrimitiveReport = JSON.parse(pythonPrimitives.stdout);
for (const testCase of barrierFixture.cases) {
  const tsResult = primitives.evaluateSettledBarrier(testCase.items, testCase.policy);
  assert.deepEqual(tsResult, testCase.expect, `${testCase.name}: TypeScript barrier differs from fixture`);
  assert.deepEqual(
    pyPrimitiveReport[testCase.name],
    testCase.expect,
    `${testCase.name}: Python barrier differs from fixture`,
  );
  assert.deepEqual(
    tsResult,
    pyPrimitiveReport[testCase.name],
    `${testCase.name}: barrier implementations differ`,
  );
}

process.stdout.write(
  `Cross-language settled-barrier conformance passed for ${barrierFixture.cases.length} cases.\n`,
);

const routeFixture = JSON.parse(
  await readFile(join(fixtureRoot, "route-selection.case.json"), "utf8"),
);
const pythonRouter = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_router_report.py"],
  { cwd: root, encoding: "utf8" },
);
if (pythonRouter.status !== 0) {
  throw new Error(
    `Python route-selection conformance failed:\n${pythonRouter.stderr || pythonRouter.stdout}`,
  );
}
const pyRouteReport = JSON.parse(pythonRouter.stdout);
for (const testCase of routeFixture.cases) {
  const tsResult = primitives.evaluateRouteSelection(testCase.request, testCase.policy);
  assert.deepEqual(tsResult, testCase.expect, `${testCase.name}: TypeScript route differs from fixture`);
  assert.deepEqual(
    pyRouteReport[testCase.name],
    testCase.expect,
    `${testCase.name}: Python route differs from fixture`,
  );
  assert.deepEqual(
    tsResult,
    pyRouteReport[testCase.name],
    `${testCase.name}: route implementations differ`,
  );
}

process.stdout.write(
  `Cross-language route-selection conformance passed for ${routeFixture.cases.length} cases.\n`,
);

const pythonPersistence = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_persistence_report.py"],
  { cwd: root, encoding: "utf8" },
);
if (pythonPersistence.status !== 0) {
  throw new Error(
    `Python persistence conformance failed:\n${pythonPersistence.stderr || pythonPersistence.stdout}`,
  );
}

const persistence = await import(
  pathToFileURL(join(root, "packages", "persistence", "dist", "index.js")).href
);
const firstEvent = JSON.parse(
  await readFile(join(fixtureRoot, "run-created.event.json"), "utf8"),
);
const secondEvent = {
  ...firstEvent,
  eventId: "evt-0002",
  type: "NodeSucceeded",
  sequence: 1,
  nodeId: "research",
  data: { outputHash: "sha256:verified" },
};

async function collectEvents(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

async function exerciseEventStore(store) {
  const versions = [await store.append(firstEvent.runId, -1, [firstEvent])];
  versions.push(await store.append(firstEvent.runId, 0, []));
  versions.push(await store.append(firstEvent.runId, 0, [secondEvent]));
  const fromOne = await collectEvents(store.read(firstEvent.runId, 1));
  let conflictCode = null;
  try {
    await store.append(firstEvent.runId, 0, [secondEvent]);
  } catch (error) {
    conflictCode = error instanceof persistence.PersistenceError ? error.code : null;
  }
  return {
    versions,
    fromSequenceOne: fromOne.map(({ eventId, type, sequence }) => ({ eventId, type, sequence })),
    conflictCode,
  };
}

const memoryReport = await exerciseEventStore(new persistence.MemoryEventStore());
const persistenceDirectory = await mkdtemp(join(tmpdir(), "graph-engineering-ts-persistence-"));
let tsPersistence;
try {
  const jsonl = new persistence.JsonlEventStore({ directory: persistenceDirectory });
  const jsonlReport = await exerciseEventStore(jsonl);
  const restartedEvents = await collectEvents(
    new persistence.JsonlEventStore({ directory: persistenceDirectory }).read(firstEvent.runId),
  );
  jsonlReport.restartEventIds = restartedEvents.map(({ eventId }) => eventId);

  const checkpointFixture = JSON.parse(
    await readFile(join(fixtureRoot, "checkpoint-basic.json"), "utf8"),
  );
  const {
    apiVersion: _checkpointApiVersion,
    contentHash: fixtureHash,
    ...checkpointInput
  } = checkpointFixture;
  const checkpoints = new persistence.FileCheckpointStore({ directory: persistenceDirectory });
  const saved = await checkpoints.save(checkpointInput);
  const loaded = await new persistence.FileCheckpointStore({
    directory: persistenceDirectory,
  }).load(checkpointInput.runId, checkpointInput.checkpointId);
  const summaries = await checkpoints.list(checkpointInput.runId);

  let unsafeIdentifierCode = null;
  try {
    await collectEvents(new persistence.MemoryEventStore().read("../escape"));
  } catch (error) {
    unsafeIdentifierCode = error instanceof persistence.PersistenceError ? error.code : null;
  }

  tsPersistence = {
    eventStores: { memory: memoryReport, jsonl: jsonlReport },
    checkpoint: {
      contentHash: saved.contentHash,
      matchesFixture: fixtureHash === saved.contentHash &&
        isDeepStrictEqual(saved, checkpointFixture),
      restartLoadMatches: isDeepStrictEqual(loaded, saved),
      summaries,
    },
    unsafeIdentifierCode,
  };
} finally {
  await rm(persistenceDirectory, { recursive: true, force: true });
}

const pyPersistence = JSON.parse(pythonPersistence.stdout);
assert.deepEqual(tsPersistence, pyPersistence, "TypeScript/Python persistence reports differ");
assert.deepEqual(memoryReport.versions, [0, 0, 1]);
assert.equal(memoryReport.conflictCode, "VERSION_CONFLICT");
assert.equal(tsPersistence.checkpoint.matchesFixture, true);
assert.equal(tsPersistence.checkpoint.restartLoadMatches, true);
assert.equal(tsPersistence.unsafeIdentifierCode, "UNSAFE_IDENTIFIER");

process.stdout.write("Cross-language event/checkpoint persistence conformance passed.\n");

const durableCase = JSON.parse(
  await readFile(join(fixtureRoot, "durable-resume.case.json"), "utf8"),
);
const pythonDurable = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_durable_report.py"],
  { cwd: root, encoding: "utf8" },
);
if (pythonDurable.status !== 0) {
  throw new Error(
    `Python durable-recovery conformance failed:\n${pythonDurable.stderr || pythonDurable.stdout}`,
  );
}
const pyDurableWithHistory = JSON.parse(pythonDurable.stdout);
const { preCrashEvents, ...pyDurable } = pyDurableWithHistory;
const durableStore = new persistence.MemoryEventStore();
await durableStore.append(durableCase.runId, -1, preCrashEvents);
const beforeDurableResume = await collectEvents(durableStore.read(durableCase.runId));
const durableCalls = [];
const durableActivityKeys = [];
let durableMergeInput;
const durableResult = await resumeDurableGraphRun(durableCase.graph, {
  runId: durableCase.runId,
  implementationId: durableCase.implementationId,
  eventStore: durableStore,
  now: () => new Date("2026-07-26T12:00:00.000Z"),
  nodeExecutors: {
    left: () => {
      throw new Error("resume reran the committed left node");
    },
    right: ({ node, attempt, activityKey }) => {
      durableCalls.push({ nodeId: node.id, attempt });
      durableActivityKeys.push(activityKey);
      return durableCase.resumeReturns.right;
    },
    merge: ({ node, attempt, input }) => {
      durableCalls.push({ nodeId: node.id, attempt });
      durableMergeInput = input;
      return durableCase.resumeReturns.merge;
    },
  },
});
const afterDurableResume = await collectEvents(durableStore.read(durableCase.runId));
const runResumed = afterDurableResume.find(({ type }) => type === "RunResumed");
assert.ok(runResumed, "durable history must contain RunResumed");
const rightSchedules = afterDurableResume.filter(
  ({ type, nodeId }) => type === "NodeScheduled" && nodeId === "right",
);
let terminalExecutorCalls = 0;
const terminalVersion = afterDurableResume.length;
const terminalResult = await resumeDurableGraphRun(durableCase.graph, {
  runId: durableCase.runId,
  implementationId: durableCase.implementationId,
  eventStore: durableStore,
  now: () => new Date("2026-07-26T12:00:00.000Z"),
  executors: Object.fromEntries(
    durableCase.graph.nodes.map(({ kind }) => [kind, () => {
      terminalExecutorCalls += 1;
      throw new Error("terminal resume invoked an executor");
    }]),
  ),
});
const finalDurableHistory = await collectEvents(durableStore.read(durableCase.runId));
const tsDurable = {
  status: durableResult.status,
  output: durableResult.output ?? {},
  nodeStatuses: Object.fromEntries(
    durableResult.nodes.map(({ nodeId, status }) => [nodeId, status]),
  ),
  attempts: Object.fromEntries(
    durableResult.nodes.map(({ nodeId, attempts }) => [nodeId, attempts]),
  ),
  totalAttempts: durableResult.totalAttempts,
  executorCalls: durableCalls,
  mergeInput: durableMergeInput,
  reusedNodeIds: runResumed.data.reusedNodeIds,
  interruptedNodeIds: runResumed.data.interruptedNodeIds,
  preCrashEventTypes: beforeDurableResume.map(({ type }) => type),
  resumeEventTypes: afterDurableResume.slice(beforeDurableResume.length).map(({ type }) => type),
  activityKeyStable: rightSchedules.length === 2 &&
    rightSchedules[0].data.activityKey === rightSchedules[1].data.activityKey &&
    isDeepStrictEqual(durableActivityKeys, [rightSchedules[0].data.activityKey]),
  terminalResume: {
    newEvents: finalDurableHistory.length - terminalVersion,
    executorCalls: terminalExecutorCalls,
    sameResult: isDeepStrictEqual(terminalResult, durableResult),
  },
};

assert.deepEqual(tsDurable, pyDurable, "TypeScript/Python durable recovery reports differ");
assert.equal(tsDurable.status, durableCase.expect.status);
assert.deepEqual(tsDurable.output, durableCase.expect.output);
assert.deepEqual(tsDurable.executorCalls, durableCase.expect.executorCalls);
assert.deepEqual(tsDurable.mergeInput, durableCase.expect.mergeInput);
assert.deepEqual(tsDurable.reusedNodeIds, durableCase.expect.reusedNodeIds);
assert.deepEqual(tsDurable.interruptedNodeIds, durableCase.expect.interruptedNodeIds);
assert.equal(tsDurable.totalAttempts, durableCase.expect.totalAttempts);
assert.deepEqual(tsDurable.terminalResume, {
  ...durableCase.expect.terminalResume,
  sameResult: true,
});
assert.equal(tsDurable.activityKeyStable, true);

process.stdout.write("Cross-language event-sourced durable recovery conformance passed.\n");

function normalizeDurableInteropResult(result) {
  return {
    status: result.status,
    nodeStatuses: Object.fromEntries(result.nodes.map(({ nodeId, status }) => [nodeId, status])),
    failureCodes: result.failures.map(({ code }) => code),
    attempts: Object.fromEntries(result.nodes.map(({ nodeId, attempts }) => [nodeId, attempts])),
    outputs: result.output ?? {},
    totalAttempts: result.totalAttempts,
  };
}

function durableSettledSemantics(events) {
  const settled = events.find(({ type }) => type === "NodeSettledWithoutAttempt");
  if (settled === undefined) return null;
  const result = decodeDurableJson(settled.data.result);
  assert.ok(result !== null && typeof result === "object" && !Array.isArray(result));
  assert.ok(
    result.failure !== null && typeof result.failure === "object" && !Array.isArray(result.failure),
  );
  return {
    nodeId: result.nodeId,
    status: result.status,
    attempts: result.attempts,
    hasInput: Object.hasOwn(result, "input"),
    input: result.input,
    failureCode: result.failure.code,
  };
}

const durableInteropNode = {
  id: "root",
  kind: "agent",
  inputSchema: {},
  outputSchema: {},
  config: {},
  sideEffects: "none",
};
const durableInteropBaseGraph = {
  apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
  kind: "Graph",
  metadata: { name: "durable-terminal-interop", version: "1" },
  inputSchema: {},
  outputSchema: {},
  entrypoints: ["root"],
  outputs: { result: { node: "root" } },
  nodes: [durableInteropNode],
  edges: [],
};
const durableInteropCases = [
  {
    name: "missingExecutor",
    mode: "missingExecutor",
    graph: durableInteropBaseGraph,
    graphInput: { realNull: null },
    implementationId: "interop@1",
    tsRunId: "ts-to-python-missing-executor",
    pythonRunId: "python-to-ts-missing-executor",
    fixedTime: "2026-07-26T12:00:00.000Z",
    expectedEventTypes: [
      "RunCreated", "RunStarted", "NodeSettledWithoutAttempt", "RunFailed",
    ],
    expectedSettled: {
      nodeId: "root",
      status: "failed",
      attempts: 0,
      hasInput: true,
      input: { realNull: null },
      failureCode: "EXECUTOR_NOT_FOUND",
    },
  },
  {
    name: "outputBinding",
    mode: "outputBinding",
    graph: {
      ...durableInteropBaseGraph,
      metadata: { name: "durable-output-binding-interop", version: "1" },
      outputs: { result: { node: "root", port: "missing" } },
    },
    graphInput: { seed: 1 },
    implementationId: "interop@1",
    tsRunId: "ts-to-python-output-binding",
    pythonRunId: "python-to-ts-output-binding",
    fixedTime: "2026-07-26T12:00:00.000Z",
    expectedEventTypes: [
      "RunCreated", "RunStarted", "NodeScheduled", "NodeStarted", "NodeSucceeded", "RunFailed",
    ],
    expectedSettled: null,
  },
];

const tsProducedInterop = {};
for (const testCase of durableInteropCases) {
  const store = new persistence.MemoryEventStore();
  const options = {
    runId: testCase.tsRunId,
    implementationId: testCase.implementationId,
    eventStore: store,
    now: () => new Date(testCase.fixedTime),
    ...(testCase.mode === "outputBinding"
      ? { nodeExecutors: { root: () => ({ actual: true }) } }
      : {}),
  };
  const result = await startDurableGraphRun(testCase.graph, testCase.graphInput, options);
  const events = await collectEvents(store.read(testCase.tsRunId));
  tsProducedInterop[testCase.name] = {
    result: normalizeDurableInteropResult(result),
    eventTypes: events.map(({ type }) => type),
    settled: durableSettledSemantics(events),
    events,
  };
}

const pythonDurableInterop = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_durable_interop.py"],
  {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({
      cases: durableInteropCases.map((testCase) => ({
        ...testCase,
        tsEvents: tsProducedInterop[testCase.name].events,
      })),
    }),
  },
);
if (pythonDurableInterop.status !== 0) {
  throw new Error(
    `Python durable terminal interop failed:\n${pythonDurableInterop.stderr || pythonDurableInterop.stdout}`,
  );
}
const pyDurableInterop = JSON.parse(pythonDurableInterop.stdout);

for (const testCase of durableInteropCases) {
  const tsProduced = tsProducedInterop[testCase.name];
  const pythonReport = pyDurableInterop[testCase.name];
  assert.deepEqual(tsProduced.eventTypes, testCase.expectedEventTypes);
  assert.deepEqual(tsProduced.settled, testCase.expectedSettled);
  assert.deepEqual(
    pythonReport.pythonConsumedTs.result,
    tsProduced.result,
    `${testCase.name}: Python did not reconstruct the TypeScript terminal result`,
  );
  assert.deepEqual(pythonReport.pythonConsumedTs.eventTypes, tsProduced.eventTypes);
  assert.deepEqual(pythonReport.pythonConsumedTs.settled, tsProduced.settled);
  assert.deepEqual(pythonReport.pythonConsumedTs.terminalResume, {
    newEvents: 0,
    executorCalls: 0,
  });

  const pythonProduced = pythonReport.pythonProduced;
  assert.deepEqual(pythonProduced.eventTypes, testCase.expectedEventTypes);
  assert.deepEqual(pythonProduced.settled, testCase.expectedSettled);
  const store = new persistence.MemoryEventStore();
  await store.append(testCase.pythonRunId, -1, pythonProduced.events);
  const before = pythonProduced.events.length;
  let executorCalls = 0;
  const resumed = await resumeDurableGraphRun(testCase.graph, {
    runId: testCase.pythonRunId,
    implementationId: testCase.implementationId,
    eventStore: store,
    now: () => new Date(testCase.fixedTime),
    nodeExecutors: {
      root: () => {
        executorCalls += 1;
        throw new Error("terminal cross-language resume invoked an executor");
      },
    },
  });
  const after = await collectEvents(store.read(testCase.pythonRunId));
  assert.deepEqual(
    normalizeDurableInteropResult(resumed),
    pythonProduced.result,
    `${testCase.name}: TypeScript did not reconstruct the Python terminal result`,
  );
  assert.equal(after.length - before, 0);
  assert.equal(executorCalls, 0);
}

process.stdout.write(
  `Cross-language terminal durable-history interop passed for ${durableInteropCases.length} cases in both directions.\n`,
);
