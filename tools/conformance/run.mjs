#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { exerciseCycleActivityInterruptionCampaign } from "./cycle_activity_interruption.mjs";
import { exerciseCycleOperationInterruptionCampaign } from "./cycle_operation_interruption.mjs";
import { exerciseCycleControllerLineageCampaign } from "./cycle_controller_lineage.mjs";
import { exerciseCyclePatchVisibilityFaultCampaign } from "./cycle_patch_visibility_fault.mjs";
import { exerciseCyclePatchCheckpointFaultCampaign } from "./cycle_patch_checkpoint_fault.mjs";
import { exerciseGraphPatchHostileShapeCampaign } from "./graph_patch_hostile_shape.mjs";
import { exerciseGraphPatchHostileSemanticCampaign } from "./graph_patch_hostile_semantic.mjs";
import { exerciseGraphPatchHostileRestoreCampaign } from "./graph_patch_hostile_restore.mjs";
import { exerciseCycleStoreProviderCampaign } from "./cycle_store_provider.mjs";

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

const canonicalNumberCase = JSON.parse(
  await readFile(join(fixtureRoot, "canonical-number.case.json"), "utf8"),
);
const fractionalYamlSource = await readFile(
  join(fixtureRoot, canonicalNumberCase.wholeGraph.yamlSource),
  "utf8",
);

function binary64FromHex(bits) {
  return Buffer.from(bits, "hex").readDoubleBE(0);
}

function splitmix64Samples(seed, count) {
  const mask = (1n << 64n) - 1n;
  let state = BigInt(`0x${seed}`);
  const samples = [];
  while (samples.length < count) {
    state = (state + 0x9e3779b97f4a7c15n) & mask;
    let value = state;
    value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & mask;
    value = (value ^ (value >> 31n)) & mask;
    if (((value >> 52n) & 0x7ffn) !== 0x7ffn) {
      samples.push(value.toString(16).padStart(16, "0"));
    }
  }
  return samples;
}

const randomNumberBits = splitmix64Samples(
  canonicalNumberCase.randomDifferential.seed,
  canonicalNumberCase.randomDifferential.finiteSamples,
);
const pythonCanonicalNumbers = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "python",
    "python",
    "-c",
    `
import json
import struct
import sys

from graph_engineering import (
    canonical_json,
    canonical_sha256,
    create_compiled_graph_identity,
    graph_builder,
    parse_graph_source,
    try_compile_graph,
)
from graph_engineering._json import _render_finite_float

payload = json.load(sys.stdin)


def binary64(bits):
    return struct.unpack(">d", bytes.fromhex(bits))[0]


def rejects(bits):
    try:
        canonical_json(binary64(bits))
    except (TypeError, ValueError):
        return True
    return False


document = payload["graph"]
yaml_document = parse_graph_source(payload["yamlSource"], format="yaml")
author = graph_builder(
    metadata=document["metadata"],
    input_schema=document["inputSchema"],
    output_schema=document["outputSchema"],
    **({"state_schema": document["stateSchema"]} if "stateSchema" in document else {}),
    **({"policies": document["policies"]} if "policies" in document else {}),
)
for node in document["nodes"]:
    author.add_node(node)
for edge in document["edges"]:
    author.add_edge(edge)
for entrypoint in document["entrypoints"]:
    author.add_entrypoint(entrypoint)
for name, endpoint in document["outputs"].items():
    author.add_output(name, endpoint)
built = author.build()
compiled = try_compile_graph(document)
yaml_compiled = try_compile_graph(yaml_document)

print(json.dumps({
    "formatter": [_render_finite_float(binary64(bits)) for bits in payload["formatterBits"]],
    "accepted": [canonical_json(binary64(bits)) for bits in payload["acceptedBits"]],
    "random": [_render_finite_float(binary64(bits)) for bits in payload["randomBits"]],
    "rejected": [rejects(bits) for bits in payload["rejectedBits"]],
    "graphCanonical": canonical_json(document),
    "graphHash": canonical_sha256(document),
    "graphIdentity": create_compiled_graph_identity(document).to_dict(),
    "yamlCanonical": canonical_json(yaml_document),
    "yamlHash": canonical_sha256(yaml_document),
    "yamlCompilerCanonical": yaml_compiled.canonical_graph,
    "yamlCompilerHash": yaml_compiled.graph_hash,
    "yamlIdentity": create_compiled_graph_identity(yaml_document).to_dict(),
    "compilerCanonical": compiled.canonical_graph,
    "compilerHash": compiled.graph_hash,
    "builderCanonical": built.canonical_graph,
    "builderHash": built.graph_hash,
    "builderIdentity": built.identity.to_dict(),
}, separators=(",", ":")))
`,
  ],
  {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({
      formatterBits: canonicalNumberCase.formatterVectors.map(({ bits }) => bits),
      acceptedBits: canonicalNumberCase.portableAccepted,
      rejectedBits: canonicalNumberCase.portableRejected.map(({ bits }) => bits),
      randomBits: randomNumberBits,
      graph: canonicalNumberCase.wholeGraph.document,
      yamlSource: fractionalYamlSource,
    }),
  },
);
if (pythonCanonicalNumbers.status !== 0) {
  throw new Error(
    `Python canonical-number report failed:\n${pythonCanonicalNumbers.stderr || pythonCanonicalNumbers.stdout}`,
  );
}
const pythonCanonicalNumberReport = JSON.parse(pythonCanonicalNumbers.stdout);

const formatterByBits = new Map(
  canonicalNumberCase.formatterVectors.map((sample) => [sample.bits, sample.canonical]),
);
for (const [index, sample] of canonicalNumberCase.formatterVectors.entries()) {
  assert.equal(
    JSON.stringify(binary64FromHex(sample.bits)),
    sample.canonical,
    `${sample.bits}: Node does not match the shared canonical token`,
  );
  assert.equal(
    pythonCanonicalNumberReport.formatter[index],
    sample.canonical,
    `${sample.bits}: Python does not match the shared canonical token`,
  );
}
for (const [index, bits] of canonicalNumberCase.portableAccepted.entries()) {
  const expected = formatterByBits.get(bits);
  assert.equal(
    core.canonicalSerialize(binary64FromHex(bits)),
    expected,
    `${bits}: TypeScript public canonical boundary differs`,
  );
  assert.equal(
    pythonCanonicalNumberReport.accepted[index],
    expected,
    `${bits}: Python public canonical boundary differs`,
  );
}
for (const [index, sample] of canonicalNumberCase.portableRejected.entries()) {
  assert.throws(
    () => core.canonicalSerialize(binary64FromHex(sample.bits)),
    `${sample.bits}: TypeScript canonicalization must reject nonportable values`,
  );
  assert.equal(
    pythonCanonicalNumberReport.rejected[index],
    true,
    `${sample.bits}: Python canonicalization must reject nonportable values`,
  );
}
for (const [index, bits] of randomNumberBits.entries()) {
  assert.equal(
    pythonCanonicalNumberReport.random[index],
    JSON.stringify(binary64FromHex(bits)),
    `${bits}: seeded Python/Node binary64 rendering differs`,
  );
}

const fractionalDocument = canonicalNumberCase.wholeGraph.document;
const tsFractionalYamlDocument = core.decodeGraphSource(fractionalYamlSource, {
  format: "yaml",
});
const tsFractionalCompilation = core.compileGraph(fractionalDocument);
const tsFractionalYamlCompilation = core.compileGraph(tsFractionalYamlDocument);
const tsFractionalBuilder = core.graphBuilder({
  metadata: fractionalDocument.metadata,
  inputSchema: fractionalDocument.inputSchema,
  outputSchema: fractionalDocument.outputSchema,
});
for (const node of fractionalDocument.nodes) tsFractionalBuilder.addNode(node);
for (const edge of fractionalDocument.edges) tsFractionalBuilder.addEdge(edge);
for (const entrypoint of fractionalDocument.entrypoints) {
  tsFractionalBuilder.addEntrypoint(entrypoint);
}
for (const [name, endpoint] of Object.entries(fractionalDocument.outputs)) {
  tsFractionalBuilder.addOutput(name, endpoint);
}
const tsFractionalBuilt = tsFractionalBuilder.build();
for (const canonical of [
  core.canonicalSerialize(fractionalDocument),
  core.canonicalSerialize(tsFractionalYamlDocument),
  tsFractionalCompilation.canonicalGraph,
  tsFractionalYamlCompilation.canonicalGraph,
  tsFractionalBuilt.canonicalGraph,
  pythonCanonicalNumberReport.graphCanonical,
  pythonCanonicalNumberReport.yamlCanonical,
  pythonCanonicalNumberReport.yamlCompilerCanonical,
  pythonCanonicalNumberReport.compilerCanonical,
  pythonCanonicalNumberReport.builderCanonical,
]) {
  assert.equal(canonical, canonicalNumberCase.wholeGraph.canonicalGraph);
}
for (const hash of [
  core.canonicalHash(fractionalDocument),
  core.canonicalHash(tsFractionalYamlDocument),
  tsFractionalCompilation.graphHash,
  tsFractionalYamlCompilation.graphHash,
  tsFractionalBuilt.graphHash,
  pythonCanonicalNumberReport.graphHash,
  pythonCanonicalNumberReport.yamlHash,
  pythonCanonicalNumberReport.yamlCompilerHash,
  pythonCanonicalNumberReport.compilerHash,
  pythonCanonicalNumberReport.builderHash,
]) {
  assert.equal(hash, canonicalNumberCase.wholeGraph.sha256);
}
assert.deepEqual(tsFractionalBuilt.identity, canonicalNumberCase.wholeGraph.identity);
assert.deepEqual(
  core.createCompiledGraphIdentity(fractionalDocument),
  canonicalNumberCase.wholeGraph.identity,
);
assert.deepEqual(
  core.createCompiledGraphIdentity(tsFractionalYamlDocument),
  canonicalNumberCase.wholeGraph.identity,
);
assert.deepEqual(
  pythonCanonicalNumberReport.graphIdentity,
  canonicalNumberCase.wholeGraph.identity,
);
assert.deepEqual(
  pythonCanonicalNumberReport.yamlIdentity,
  canonicalNumberCase.wholeGraph.identity,
);
assert.deepEqual(
  pythonCanonicalNumberReport.builderIdentity,
  canonicalNumberCase.wholeGraph.identity,
);

process.stdout.write(
  `Cross-language canonical-number conformance passed for ${canonicalNumberCase.formatterVectors.length} RFC formatter vectors, ${canonicalNumberCase.portableAccepted.length} portable values, ${canonicalNumberCase.portableRejected.length} public-boundary rejections, ${randomNumberBits.length} seeded finite bit patterns, and compiler/builder whole-graph identity.\n`,
);

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

class PipelineFixtureSource {
  constructor(document) {
    this.document = document;
    this.items = [...(document.items ?? [])];
    this.index = 0;
    this.pulls = 0;
    this.closes = 0;
    this.pullWaiters = [];
  }

  [Symbol.iterator]() {
    return this;
  }

  next() {
    if (this.document.kind === "throwing-array" && this.index >= this.items.length) {
      const failure = this.document.thenThrow;
      const error = new Error(failure.message);
      error.name = failure.causeName;
      throw error;
    }
    if (this.index >= this.items.length) return { done: true, value: undefined };
    const value = this.items[this.index];
    this.index += 1;
    this.pulls += 1;
    for (const waiter of this.pullWaiters.splice(0)) waiter();
    return { done: false, value };
  }

  async waitForPullCount(target) {
    while (this.pulls < target) {
      await new Promise((resolve) => this.pullWaiters.push(resolve));
    }
  }

  return() {
    this.closes += 1;
    return { done: true, value: undefined };
  }
}

function pipelineFixtureGate() {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function executePipelineFixtureAction(document, gates, trace, stageId, itemIndex) {
  switch (document.kind) {
    case "wait-for-gate":
      await gates[document.gate].promise;
      return await executePipelineFixtureAction(document.then, gates, trace, stageId, itemIndex);
    case "throw": {
      const error = new Error(document.message);
      error.name = document.causeName;
      throw error;
    }
    case "invalid-output":
      return Number.POSITIVE_INFINITY;
    case "return":
      trace.push(`stage:${stageId}:item:${itemIndex}:return`);
      return document.value;
    default:
      throw new Error(`unknown pipeline fixture action '${document.kind}'`);
  }
}

function compactPipelineItem(item) {
  const document = { ...item };
  if (document.failure !== undefined) {
    document.failure = { ...document.failure };
    delete document.failure.message;
  }
  return document;
}

function compactPipelineSummary(summary) {
  const document = { ...summary, runFailure: summary.runFailure ?? null };
  delete document.maxObservedInFlight;
  delete document.stageMaxObservedConcurrency;
  delete document.stageMaxObservedQueueDepth;
  if (document.runFailure !== null) {
    document.runFailure = { ...document.runFailure };
    delete document.runFailure.message;
  }
  return document;
}

async function exercisePipelineFixture(testCase) {
  const source = new PipelineFixtureSource(testCase.source);
  const gates = Object.fromEntries(
    (testCase.gates ?? []).map((name) => [name, pipelineFixtureGate()]),
  );
  const trace = [];
  const stages = testCase.stages.map((stage) => ({
    id: stage.id,
    concurrency: stage.concurrency ?? 1,
    onFailure: stage.onFailure ?? "dead-letter",
    ...(stage.retry === undefined ? {} : { retry: stage.retry }),
    handler: async (context) => {
      trace.push(`stage:${stage.id}:item:${context.itemIndex}:start`);
      for (const effect of stage.onStartByItem?.[String(context.itemIndex)] ?? []) {
        gates[effect.releaseGate].open();
      }
      const outcomes = stage.outcomesByItem?.[String(context.itemIndex)];
      if (outcomes === undefined || outcomes.length === 0) return context.input;
      const selected = outcomes[Math.min(context.attempt - 1, outcomes.length - 1)];
      return await executePipelineFixtureAction(
        selected,
        gates,
        trace,
        stage.id,
        context.itemIndex,
      );
    },
  }));
  const run = runtime.runPipeline(source, stages, testCase.options);
  const results = [];
  let pullCountWhilePaused;
  if (testCase.consumer !== undefined) {
    for (let index = 0; index < testCase.consumer.readResults; index += 1) {
      const delivered = await run.next();
      assert.equal(delivered.done, false, `${testCase.id}: pipeline ended before consumer read`);
      results.push(delivered.value);
    }
    assert.equal(
      testCase.consumer.thenPauseUntil,
      "pipeline-idle",
      `${testCase.id}: unsupported deterministic pause condition`,
    );
    assert.equal(stages.length, 0, `${testCase.id}: pause probe requires an identity pipeline`);
    const pauseTarget = Math.min(
      source.items.length,
      testCase.consumer.readResults + testCase.options.maxInFlight,
    );
    await source.waitForPullCount(pauseTarget);
    pullCountWhilePaused = source.pulls;
  }
  for await (const result of run) results.push(result);
  const summary = await run.completion;
  const report = {
    deliveryOrder: results.map(({ itemIndex }) => itemIndex),
    items: results.map(compactPipelineItem),
    summary: compactPipelineSummary(summary),
    sourcePullCount: source.pulls,
    sourceCloseCount: source.closes,
    observations: {
      maxObservedInFlight: summary.maxObservedInFlight,
      maxObservedQueueDepth: Math.max(
        0,
        ...Object.values(summary.stageMaxObservedQueueDepth),
      ),
      ...(pullCountWhilePaused === undefined
        ? {}
        : { sourcePullCountWhilePaused: pullCountWhilePaused }),
    },
  };
  if (testCase.expect.mustOccurBefore !== undefined) {
    report.requiredTraceRelations = testCase.expect.mustOccurBefore.map(
      ([before, after]) => trace.indexOf(before) >= 0 && trace.indexOf(before) < trace.indexOf(after),
    );
  }
  return JSON.parse(JSON.stringify(report));
}

function assertPipelineSubset(actual, expectedValue, label) {
  if (expectedValue === null || typeof expectedValue !== "object") {
    assert.deepEqual(actual, expectedValue, label);
    return;
  }
  if (Array.isArray(expectedValue)) {
    assert.ok(Array.isArray(actual), `${label}: actual value is not an array`);
    assert.equal(actual.length, expectedValue.length, `${label}: array length differs`);
    expectedValue.forEach((value, index) => {
      assertPipelineSubset(actual[index], value, `${label}[${index}]`);
    });
    return;
  }
  assert.ok(actual !== null && typeof actual === "object", `${label}: actual value is not an object`);
  for (const [key, value] of Object.entries(expectedValue)) {
    assert.ok(Object.hasOwn(actual, key), `${label}: missing key '${key}'`);
    assertPipelineSubset(actual[key], value, `${label}.${key}`);
  }
}

function pipelineSemanticProjection(report, testCase) {
  const projected = JSON.parse(JSON.stringify(report));
  delete projected.observations;
  const expectedItems = new Map(
    (testCase.expect.items ?? []).map((item) => [item.itemIndex, item]),
  );
  for (const item of projected.items) {
    const expectedItem = expectedItems.get(item.itemIndex);
    if (item.failure !== undefined && expectedItem?.failure?.causeName === undefined) {
      delete item.failure.causeName;
    }
  }
  if (
    projected.summary.runFailure !== null &&
    testCase.expect.summary?.runFailure?.causeName === undefined
  ) {
    delete projected.summary.runFailure.causeName;
  }
  return projected;
}

function assertPipelineExpectations(report, testCase, language) {
  const expectation = testCase.expect;
  const prefix = `${testCase.id}: ${language}`;
  if (expectation.deliveryOrder !== undefined) {
    assert.deepEqual(report.deliveryOrder, expectation.deliveryOrder, `${prefix} delivery order`);
  }
  if (expectation.items !== undefined) {
    assertPipelineSubset(report.items, expectation.items, `${prefix} items`);
  }
  if (expectation.summary !== undefined) {
    assertPipelineSubset(report.summary, expectation.summary, `${prefix} summary`);
  }
  if (expectation.sourcePullCount !== undefined) {
    assert.equal(report.sourcePullCount, expectation.sourcePullCount, `${prefix} source pulls`);
  }
  if (expectation.sourceCloseCount !== undefined) {
    assert.equal(report.sourceCloseCount, expectation.sourceCloseCount, `${prefix} source closes`);
  }
  if (expectation.outputByItem !== undefined) {
    const outputs = Object.fromEntries(report.items.map((item) => [item.itemIndex, item.output]));
    assert.deepEqual(outputs, expectation.outputByItem, `${prefix} outputs by item`);
  }
  if (expectation.deliveryItemSet !== undefined) {
    assert.deepEqual(
      [...report.deliveryOrder].sort((left, right) => left - right),
      [...expectation.deliveryItemSet].sort((left, right) => left - right),
      `${prefix} delivery item set`,
    );
  }
  for (const relation of report.requiredTraceRelations ?? []) {
    assert.equal(relation, true, `${prefix} required trace relation`);
  }
  if (expectation.maxObservedInFlightAtMost !== undefined) {
    assert.ok(
      report.observations.maxObservedInFlight <= expectation.maxObservedInFlightAtMost,
      `${prefix} exceeded maxObservedInFlight bound`,
    );
  }
  if (expectation.maxObservedQueueDepthAtMost !== undefined) {
    assert.ok(
      report.observations.maxObservedQueueDepth <= expectation.maxObservedQueueDepthAtMost,
      `${prefix} exceeded maxObservedQueueDepth bound`,
    );
  }
  if (expectation.sourcePullCountWhilePausedAtMost !== undefined) {
    assert.ok(
      report.observations.sourcePullCountWhilePaused <=
        expectation.sourcePullCountWhilePausedAtMost,
      `${prefix} source was not backpressured while consumer paused`,
    );
  }
}

const pipelineFixture = JSON.parse(
  await readFile(join(fixtureRoot, "pipeline.case.json"), "utf8"),
);
const pythonPipeline = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_pipeline_report.py"],
  { cwd: root, encoding: "utf8" },
);
if (pythonPipeline.status !== 0) {
  throw new Error(
    `Python bounded-pipeline conformance failed:\n${pythonPipeline.stderr || pythonPipeline.stdout}`,
  );
}
const pyPipelineReport = JSON.parse(pythonPipeline.stdout);
for (const testCase of pipelineFixture.cases) {
  const tsPipelineReport = await exercisePipelineFixture(testCase);
  const pythonCaseReport = pyPipelineReport[testCase.id];
  assert.ok(pythonCaseReport !== undefined, `${testCase.id}: Python report is missing`);
  assertPipelineExpectations(tsPipelineReport, testCase, "TypeScript");
  assertPipelineExpectations(pythonCaseReport, testCase, "Python");
  assert.deepEqual(
    pipelineSemanticProjection(tsPipelineReport, testCase),
    pipelineSemanticProjection(pythonCaseReport, testCase),
    `${testCase.id}: bounded-pipeline semantic reports differ`,
  );
}

process.stdout.write(
  `Cross-language bounded-pipeline conformance passed for ${pipelineFixture.cases.length} cases.\n`,
);

// D7 native-cycle conformance compares the complete canonical carrier, not a
// hand-picked semantic summary.  Activity inputs are included because their
// hashes define the stable activity keys and therefore every downstream event
// hash in the controller stream.
const pythonCycle = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_cycle_report.py"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonCycle.status !== 0) {
  throw new Error(
    `Python native-cycle conformance failed:\n${pythonCycle.stderr || pythonCycle.stdout}`,
  );
}
const pyCycleReport = JSON.parse(pythonCycle.stdout);
const cycleFaultFixture = JSON.parse(
  await readFile(join(fixtureRoot, "cycle-controller-fault-matrix.case.json"), "utf8"),
);
const tsCycleFaultMatrix = runtime.buildCycleDurableFaultMatrix();
const tsCycleFaultCanonical = core.canonicalSerialize(tsCycleFaultMatrix);
const tsCycleFaultReport = {
  eventTypes: [...runtime.CYCLE_CONTROLLER_EVENT_TYPES],
  stages: [...runtime.CYCLE_DURABLE_FAULT_STAGES],
  faultKinds: [...runtime.CYCLE_FAULT_KINDS],
  matrix: tsCycleFaultMatrix,
  matrixCanonical: tsCycleFaultCanonical,
  matrixCanonicalUtf8Bytes: Buffer.byteLength(tsCycleFaultCanonical, "utf8"),
  matrixSha256: core.canonicalHash(tsCycleFaultMatrix),
};
assert.equal(cycleFaultFixture.schemaVersion, 1, "D7 fault matrix fixture version drifted");
assert.deepEqual(
  tsCycleFaultReport.eventTypes,
  cycleFaultFixture.eventTypes,
  "D7 TypeScript event vocabulary differs from the retained fault fixture",
);
assert.deepEqual(
  tsCycleFaultReport.stages,
  cycleFaultFixture.stages.map(({ name }) => name),
  "D7 TypeScript durable stages differ from the retained fault fixture",
);
assert.deepEqual(
  tsCycleFaultReport.faultKinds,
  cycleFaultFixture.faultKinds,
  "D7 TypeScript fault kinds differ from the retained fault fixture",
);
assert.deepEqual(
  tsCycleFaultReport,
  pyCycleReport.faultMatrix,
  "D7 TypeScript/Python durable fault matrices differ",
);
assert.equal(
  tsCycleFaultReport.matrix.length,
  cycleFaultFixture.expect.matrixEntryCount,
  "D7 fault matrix entry count drifted",
);
assert.equal(
  new Set(tsCycleFaultReport.matrix.map(({ boundary }) => boundary)).size,
  cycleFaultFixture.expect.boundaryCount,
  "D7 fault boundary count drifted",
);
assert.equal(
  tsCycleFaultReport.matrixCanonicalUtf8Bytes,
  cycleFaultFixture.expect.matrixCanonicalUtf8Bytes,
  "D7 fault matrix canonical byte count drifted",
);
assert.equal(
  tsCycleFaultReport.matrixSha256,
  cycleFaultFixture.expect.matrixSha256,
  "D7 fault matrix canonical hash drifted",
);
for (const [durability, count] of Object.entries(cycleFaultFixture.expect.durabilityCounts)) {
  assert.equal(
    tsCycleFaultReport.matrix.filter((entry) => entry.durability === durability).length,
    count,
    `D7 fault matrix ${durability} count drifted`,
  );
}
const cycleContractFixture = JSON.parse(
  await readFile(join(fixtureRoot, "cycle-controller.case.json"), "utf8"),
);
const cycleGraph = JSON.parse(
  await readFile(join(fixtureRoot, "diamond.graph.json"), "utf8"),
);
const cycleCompilation = core.compileGraph(cycleGraph);
assert.equal(cycleCompilation.valid, true, "D7 cross-language graph must compile");
assert.notEqual(cycleCompilation.graphHash, null, "D7 cross-language graph needs an identity");
const graphPatchHostileShapeFixture = JSON.parse(
  await readFile(join(fixtureRoot, "graph-patch-hostile-shape.case.json"), "utf8"),
);
const pythonGraphPatchHostileShape = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "python",
    "python",
    "tools/conformance/python_graph_patch_hostile_shape_report.py",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonGraphPatchHostileShape.status !== 0) {
  throw new Error(
    `Python hostile GraphPatch shape campaign failed:\n${pythonGraphPatchHostileShape.stderr || pythonGraphPatchHostileShape.stdout}`,
  );
}
const pyGraphPatchHostileShape = JSON.parse(pythonGraphPatchHostileShape.stdout);
const tsGraphPatchHostileShape = await exerciseGraphPatchHostileShapeCampaign({
  runtime,
  core,
  graph: cycleGraph,
  fixture: graphPatchHostileShapeFixture,
});
assert.deepEqual(
  tsGraphPatchHostileShape,
  pyGraphPatchHostileShape,
  "D7 hostile GraphPatch shape campaign reports differ",
);
process.stdout.write(
  `Cross-language hostile GraphPatch shape conformance passed for ${tsGraphPatchHostileShape.attackCount} attacks across ${Object.keys(tsGraphPatchHostileShape.categoryCounts).length} categories.\n`,
);
const graphPatchHostileSemanticFixture = JSON.parse(
  await readFile(join(fixtureRoot, "graph-patch-hostile-semantic.case.json"), "utf8"),
);
const pythonGraphPatchHostileSemantic = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "python",
    "python",
    "tools/conformance/python_graph_patch_hostile_semantic_report.py",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonGraphPatchHostileSemantic.status !== 0) {
  throw new Error(
    `Python hostile GraphPatch semantic campaign failed:\n${pythonGraphPatchHostileSemantic.stderr || pythonGraphPatchHostileSemantic.stdout}`,
  );
}
const pyGraphPatchHostileSemantic = JSON.parse(pythonGraphPatchHostileSemantic.stdout);
const tsGraphPatchHostileSemantic = await exerciseGraphPatchHostileSemanticCampaign({
  runtime,
  core,
  graph: cycleGraph,
  fixture: graphPatchHostileSemanticFixture,
});
assert.deepEqual(
  tsGraphPatchHostileSemantic,
  pyGraphPatchHostileSemantic,
  "D7 hostile GraphPatch semantic campaign reports differ",
);
process.stdout.write(
  `Cross-language hostile GraphPatch semantic conformance passed for ${tsGraphPatchHostileSemantic.caseCount} cases (${tsGraphPatchHostileSemantic.decisionCaseCount} decisions and ${tsGraphPatchHostileSemantic.behaviorCaseCount} behaviors).\n`,
);
const graphPatchHostileRestoreFixture = JSON.parse(
  await readFile(join(fixtureRoot, "graph-patch-hostile-restore.case.json"), "utf8"),
);
const pythonGraphPatchHostileRestore = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "python",
    "python",
    "tools/conformance/python_graph_patch_hostile_restore_report.py",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonGraphPatchHostileRestore.status !== 0) {
  throw new Error(
    `Python hostile GraphPatch restore campaign failed:\n${pythonGraphPatchHostileRestore.stderr || pythonGraphPatchHostileRestore.stdout}`,
  );
}
const pyGraphPatchHostileRestore = JSON.parse(pythonGraphPatchHostileRestore.stdout);
const tsGraphPatchHostileRestore = await exerciseGraphPatchHostileRestoreCampaign({
  runtime,
  core,
  graph: cycleGraph,
  fixture: graphPatchHostileRestoreFixture,
});
assert.deepEqual(
  tsGraphPatchHostileRestore,
  pyGraphPatchHostileRestore,
  "D7 hostile GraphPatch restore campaign reports differ",
);
process.stdout.write(
  `Cross-language hostile GraphPatch restore conformance passed for ${tsGraphPatchHostileRestore.caseCount} cases (${tsGraphPatchHostileRestore.attackCaseCount} attacks and ${tsGraphPatchHostileRestore.behaviorCaseCount} behaviors).\n`,
);
const cycleLineageFixture = JSON.parse(
  await readFile(join(fixtureRoot, "cycle-controller-lineage.case.json"), "utf8"),
);
cycleLineageFixture.requestDocument = cycleContractFixture.validRequests[0].document;
const pythonCycleLineage = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "python",
    "python",
    "tools/conformance/python_cycle_lineage_report.py",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonCycleLineage.status !== 0) {
  throw new Error(
    `Python cycle lineage campaign failed:\n${pythonCycleLineage.stderr || pythonCycleLineage.stdout}`,
  );
}
const pyCycleLineage = JSON.parse(pythonCycleLineage.stdout);
const tsCycleLineage = await exerciseCycleControllerLineageCampaign({
  runtime,
  core,
  fixture: cycleLineageFixture,
});
assert.deepEqual(
  tsCycleLineage,
  pyCycleLineage,
  "D7 cycle-controller lineage campaign reports differ",
);
process.stdout.write(
  `Cross-language cycle-controller lineage conformance passed for ${tsCycleLineage.caseCount} cases (${tsCycleLineage.attackCaseCount} attacks and ${tsCycleLineage.behaviorCaseCount} behaviors).\n`,
);
const cycleStoreProviderFixture = JSON.parse(
  await readFile(join(fixtureRoot, "cycle-store-provider.case.json"), "utf8"),
);
const pythonCycleStoreProvider = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "python",
    "python",
    "tools/conformance/python_cycle_store_provider_report.py",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonCycleStoreProvider.status !== 0) {
  throw new Error(
    `Python CycleStore provider campaign failed:\n${pythonCycleStoreProvider.stderr || pythonCycleStoreProvider.stdout}`,
  );
}
const pyCycleStoreProvider = JSON.parse(pythonCycleStoreProvider.stdout);
const tsCycleStoreProvider = await exerciseCycleStoreProviderCampaign({
  runtime,
  core,
  fixture: cycleStoreProviderFixture,
});
assert.deepEqual(
  tsCycleStoreProvider,
  pyCycleStoreProvider,
  "D7 CycleStore provider campaign reports differ",
);
process.stdout.write(
  `Cross-language CycleStore provider conformance passed for ${tsCycleStoreProvider.caseCount} cases (${tsCycleStoreProvider.attackCaseCount} attacks and ${tsCycleStoreProvider.behaviorCaseCount} behaviors).\n`,
);
const cycleRequestValue = JSON.parse(JSON.stringify(
  cycleContractFixture.validRequests[0].document,
));
Object.assign(cycleRequestValue, {
  controllerRunId: "cycle-cross-language",
  controllerId: "cycle-cross-language-controller",
  hostRun: {
    relationship: "standalone-child-controller",
    runId: "cycle-cross-language-host",
  },
  eventStreamId: "cycle-cross-language.events",
  checkpointScope: "cycle-cross-language.checkpoints",
  initialGraph: {
    graphRevision: 1,
    graphHash: cycleCompilation.graphHash,
    revisionHash: "1".repeat(64),
  },
});
Object.assign(cycleRequestValue.policy, {
  mode: "until-dry",
  maxIterations: 4,
  maxDurationMs: 10_000,
  maxCostUsd: 10,
  maxTotalAttempts: 30,
  maxDiscoveries: 20,
  maxDynamicNodes: 10,
  maxCandidatesPerRound: 20,
  maxCandidateBytes: 4_096,
  maxCandidateBatchBytes: 16_384,
  consecutiveDryRounds: 2,
});
const cycleRequest = runtime.validateCycleControllerRequest(cycleRequestValue);
const cycleStartedAt = "2026-07-26T12:00:00.000Z";
const cycleCheckpointAt = "2026-07-26T12:00:01.000Z";
const cycleStore = new runtime.MemoryCycleControllerEventStore();
const cycleInputs = [];
const cycleFinder = (context) => {
  cycleInputs.push({ phase: context.phase, iteration: context.iteration, input: context.input });
  if (context.iteration === 1) {
    return { output: [
      { key: "finding-a", value: { source: "first" } },
      { key: "finding-a", value: { source: "duplicate" } },
    ] };
  }
  if (context.iteration === 2) {
    return { output: [{ key: "finding-a", value: { source: "rediscovered" } }] };
  }
  return { output: [] };
};
const cycleEvaluator = (context) => {
  cycleInputs.push({ phase: context.phase, iteration: context.iteration, input: context.input });
  return {
    output: context.input.candidates.map(({ key }) => ({ key, verdict: "reject" })),
  };
};
const tsCycleResult = await runtime.startCycleController(cycleRequest, cycleGraph, {
  eventStore: cycleStore,
  lease: {
    leaseId: "cycle-cross-language-lease",
    holderId: "cycle-cross-language-holder",
    leaseEpoch: 1,
    fencingToken: 1,
    acquiredAt: cycleStartedAt,
    expiresAt: "2026-07-26T12:01:00.000Z",
  },
  now: () => new Date(cycleStartedAt),
  activities: { finder: cycleFinder, candidateEvaluator: cycleEvaluator },
});
const tsCycleEvents = cycleStore.snapshot(cycleRequest.eventStreamId);
const tsCycleFold = runtime.foldCycleControllerEvents(tsCycleEvents, { requireTerminal: true });
const tsCycleCheckpoint = runtime.createCycleControllerCheckpoint(
  tsCycleEvents,
  "cycle-cross-language-terminal",
  cycleCheckpointAt,
);
const tsCycleReport = {
  requestCanonical: core.canonicalSerialize(cycleRequestValue),
  result: tsCycleResult,
  resultCanonical: core.canonicalSerialize(tsCycleResult),
  eventTypes: tsCycleEvents.map(({ type }) => type),
  eventCanonical: tsCycleEvents.map((event) => core.canonicalSerialize(event)),
  recordHashes: tsCycleEvents.map(({ recordHash }) => recordHash),
  activityKeys: tsCycleEvents
    .filter(({ type }) => type === "ActivityStarted")
    .map(({ data }) => data.activityKey),
  inputsCanonical: cycleInputs.map((item) => core.canonicalSerialize(item)),
  checkpoint: tsCycleCheckpoint,
  checkpointCanonical: core.canonicalSerialize(tsCycleCheckpoint),
  checkpointStateCanonical: core.canonicalSerialize(tsCycleCheckpoint.state),
};
assert.deepEqual(tsCycleReport.result, pyCycleReport.result, "D7 native result objects differ");
for (const field of [
  "requestCanonical",
  "resultCanonical",
  "eventTypes",
  "eventCanonical",
  "recordHashes",
  "activityKeys",
  "inputsCanonical",
  "checkpointCanonical",
  "checkpointStateCanonical",
]) {
  assert.deepEqual(tsCycleReport[field], pyCycleReport[field], `D7 ${field} differs`);
}
assert.deepEqual(tsCycleCheckpoint, pyCycleReport.checkpoint, "D7 checkpoint objects differ");
assert.equal(tsCycleFold.terminalResult?.historyPrefixHash, tsCycleResult.historyPrefixHash);

const patchRequestValue = JSON.parse(JSON.stringify(cycleRequestValue));
Object.assign(patchRequestValue, {
  controllerRunId: "cycle-cross-language-patch",
  controllerId: "cycle-cross-language-patch-controller",
  hostRun: {
    relationship: "standalone-child-controller",
    runId: "cycle-cross-language-patch-host",
  },
  eventStreamId: "cycle-cross-language-patch.events",
  checkpointScope: "cycle-cross-language-patch.checkpoints",
});
patchRequestValue.policy.maxIterations = 1;
const patchRequest = runtime.validateCycleControllerRequest(patchRequestValue);
const patchStore = new runtime.MemoryCycleControllerEventStore();
const patchInputs = [];
const patchAuthority = {
  proposerActivityKey: "0".repeat(64),
  principalHash: "2".repeat(64),
  proposerGrantHash: "3".repeat(64),
  runGrantHash: "4".repeat(64),
  tenantGrantHash: "5".repeat(64),
  deploymentGrantHash: "6".repeat(64),
  effectiveGrantHash: "7".repeat(64),
  policyHash: "8".repeat(64),
  approvalHash: null,
};
const patchFinder = (context) => {
  patchInputs.push({ phase: context.phase, iteration: context.iteration, input: context.input });
  return { output: [] };
};
const patchEvaluator = (context) => {
  patchInputs.push({ phase: context.phase, iteration: context.iteration, input: context.input });
  return { output: [] };
};
const patchPlanner = (context) => {
  patchInputs.push({ phase: context.phase, iteration: context.iteration, input: context.input });
  patchAuthority.proposerActivityKey = context.activityKey;
  return { output: {
    apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1",
    kind: "GraphPatch",
    patchId: "cycle-cross-language-review",
    base: context.input.currentRevision,
    append: {
      nodes: [{
        id: "review",
        kind: "validator",
        inputSchema: {},
        outputSchema: {},
        config: {},
        sideEffects: "none",
      }],
      edges: [{
        id: "merge-review",
        from: { node: "merge" },
        to: { node: "review" },
        mode: "value",
      }],
      outputs: { reviewResult: { node: "review" } },
    },
  } };
};
const tsPatchResult = await runtime.startCycleController(patchRequest, cycleGraph, {
  eventStore: patchStore,
  lease: {
    leaseId: "cycle-cross-language-patch-lease",
    holderId: "cycle-cross-language-holder",
    leaseEpoch: 1,
    fencingToken: 1,
    acquiredAt: cycleStartedAt,
    expiresAt: "2026-07-26T12:01:00.000Z",
  },
  now: () => new Date(cycleStartedAt),
  activities: {
    finder: patchFinder,
    candidateEvaluator: patchEvaluator,
    patchPlanner,
    shouldPlanPatch: () => true,
  },
  patchContext: {
    authoritySnapshot: patchAuthority,
    policySnapshotHash: "8".repeat(64),
    runState: "active",
    effectiveCapabilities: [],
    succeededNodeIds: ["merge"],
    supportedEdgeModes: ["value"],
  },
});
const tsPatchEvents = patchStore.snapshot(patchRequest.eventStreamId);
const tsPatchCheckpoint = runtime.createCycleControllerCheckpoint(
  tsPatchEvents,
  "cycle-cross-language-patch-terminal",
  cycleCheckpointAt,
);
const tsPatchReport = {
  result: tsPatchResult,
  resultCanonical: core.canonicalSerialize(tsPatchResult),
  eventTypes: tsPatchEvents.map(({ type }) => type),
  eventCanonical: tsPatchEvents.map((event) => core.canonicalSerialize(event)),
  recordHashes: tsPatchEvents.map(({ recordHash }) => recordHash),
  activityKeys: tsPatchEvents
    .filter(({ type }) => type === "ActivityStarted")
    .map(({ data }) => data.activityKey),
  inputsCanonical: patchInputs.map((item) => core.canonicalSerialize(item)),
  checkpoint: tsPatchCheckpoint,
  checkpointCanonical: core.canonicalSerialize(tsPatchCheckpoint),
  checkpointStateCanonical: core.canonicalSerialize(tsPatchCheckpoint.state),
  finalGraphHash: tsPatchResult.lastGraphHash,
};
for (const field of [
  "result",
  "resultCanonical",
  "eventTypes",
  "eventCanonical",
  "recordHashes",
  "activityKeys",
  "inputsCanonical",
  "checkpoint",
  "checkpointCanonical",
  "checkpointStateCanonical",
  "finalGraphHash",
]) {
  assert.deepEqual(
    tsPatchReport[field],
    pyCycleReport.acceptedPatch[field],
    `D7 accepted-patch ${field} differs`,
  );
}

class CycleCommitThenThrowStore {
  constructor(target) {
    this.target = target;
    this.delegate = new runtime.MemoryCycleControllerEventStore();
    this.threw = false;
  }

  async append(streamId, expectedSequence, values) {
    const version = await this.delegate.append(streamId, expectedSequence, values);
    if (!this.threw && values.some(({ type }) => type === this.target)) {
      this.threw = true;
      throw new Error(`simulated process loss after ${this.target}`);
    }
    return version;
  }

  read(streamId, fromSequence = 0) {
    return this.delegate.read(streamId, fromSequence);
  }
}

const resumeRequestValue = JSON.parse(JSON.stringify(cycleRequestValue));
Object.assign(resumeRequestValue, {
  controllerRunId: "cycle-cross-language-resume",
  controllerId: "cycle-cross-language-resume-controller",
  hostRun: {
    relationship: "standalone-child-controller",
    runId: "cycle-cross-language-resume-host",
  },
  eventStreamId: "cycle-cross-language-resume.events",
  checkpointScope: "cycle-cross-language-resume.checkpoints",
});
resumeRequestValue.policy.maxIterations = 1;
const resumeRequest = runtime.validateCycleControllerRequest(resumeRequestValue);
const resumeStore = new CycleCommitThenThrowStore("DiscoveryCommitted");
const resumeInputs = [];
let resumeFinderCalls = 0;
let resumeEvaluatorCalls = 0;
const resumeFinder = (context) => {
  resumeFinderCalls += 1;
  resumeInputs.push({ phase: context.phase, iteration: context.iteration, input: context.input });
  return { output: [{ key: "durable", value: { source: "finder" } }] };
};
const resumeEvaluator = (context) => {
  resumeEvaluatorCalls += 1;
  resumeInputs.push({ phase: context.phase, iteration: context.iteration, input: context.input });
  return {
    output: context.input.candidates.map(({ key }) => ({ key, verdict: "accept" })),
  };
};
await assert.rejects(
  runtime.startCycleController(resumeRequest, cycleGraph, {
    eventStore: resumeStore,
    lease: {
      leaseId: "cycle-cross-language-resume-lease-1",
      holderId: "cycle-cross-language-holder",
      leaseEpoch: 1,
      fencingToken: 1,
      acquiredAt: cycleStartedAt,
      expiresAt: "2026-07-26T12:01:00.000Z",
    },
    now: () => new Date(cycleStartedAt),
    activities: { finder: resumeFinder, candidateEvaluator: resumeEvaluator },
  }),
  (error) => error?.code === "GE_CYCLE_STORE_FAILED",
);
const tsResumeInterrupted = resumeStore.delegate.snapshot(resumeRequest.eventStreamId);
const tsResumeResult = await runtime.resumeCycleController(resumeRequest, cycleGraph, {
  eventStore: resumeStore,
  expectedSequence: tsResumeInterrupted.at(-1).sequence,
  leaseReason: "takeover",
  lease: {
    leaseId: "cycle-cross-language-resume-lease-2",
    holderId: "cycle-cross-language-resume-holder-2",
    leaseEpoch: 2,
    fencingToken: 2,
    acquiredAt: cycleStartedAt,
    expiresAt: "2026-07-26T12:01:00.000Z",
  },
  now: () => new Date(cycleStartedAt),
  activities: { finder: resumeFinder, candidateEvaluator: resumeEvaluator },
});
const tsResumeEvents = resumeStore.delegate.snapshot(resumeRequest.eventStreamId);
const tsResumeCheckpoint = runtime.createCycleControllerCheckpoint(
  tsResumeEvents,
  "cycle-cross-language-resume-terminal",
  cycleCheckpointAt,
);
const tsResumeReport = {
  result: tsResumeResult,
  resultCanonical: core.canonicalSerialize(tsResumeResult),
  eventTypes: tsResumeEvents.map(({ type }) => type),
  eventCanonical: tsResumeEvents.map((event) => core.canonicalSerialize(event)),
  recordHashes: tsResumeEvents.map(({ recordHash }) => recordHash),
  activityKeys: tsResumeEvents
    .filter(({ type }) => type === "ActivityStarted")
    .map(({ data }) => data.activityKey),
  inputsCanonical: resumeInputs.map((item) => core.canonicalSerialize(item)),
  checkpoint: tsResumeCheckpoint,
  checkpointCanonical: core.canonicalSerialize(tsResumeCheckpoint),
  checkpointStateCanonical: core.canonicalSerialize(tsResumeCheckpoint.state),
  preCrashEventTypes: tsResumeInterrupted.map(({ type }) => type),
  preCrashRecordHashes: tsResumeInterrupted.map(({ recordHash }) => recordHash),
  finderCalls: resumeFinderCalls,
  evaluatorCalls: resumeEvaluatorCalls,
};
for (const field of Object.keys(tsResumeReport)) {
  assert.deepEqual(
    tsResumeReport[field],
    pyCycleReport.resumed[field],
    `D7 crash/resume ${field} differs`,
  );
}

function cycleModeBinding(activityId, implementationDigit) {
  return {
    activityId,
    implementationHash: implementationDigit.repeat(64),
    sideEffects: "none",
    maxAttemptsPerRound: 1,
    maxCostUsdPerAttempt: 0,
    timeoutMs: 100,
  };
}

async function exerciseCycleMode(mode) {
  const suffix = mode === "while" ? "while" : "optimizer";
  const value = JSON.parse(JSON.stringify(cycleRequestValue));
  Object.assign(value, {
    controllerRunId: `cycle-cross-language-${suffix}`,
    controllerId: `cycle-cross-language-${suffix}-controller`,
    hostRun: {
      relationship: "standalone-child-controller",
      runId: `cycle-cross-language-${suffix}-host`,
    },
    eventStreamId: `cycle-cross-language-${suffix}.events`,
    checkpointScope: `cycle-cross-language-${suffix}.checkpoints`,
  });
  value.policy.mode = mode;
  delete value.policy.consecutiveDryRounds;
  if (mode === "while") {
    value.activities.condition = cycleModeBinding("condition", "5");
    value.activities.optimizerEvaluator = null;
  } else {
    value.activities.condition = null;
    value.activities.optimizerEvaluator = cycleModeBinding("optimizer-evaluator", "6");
  }
  const request = runtime.validateCycleControllerRequest(value);
  const store = new runtime.MemoryCycleControllerEventStore();
  const inputs = [];
  const remember = (context) => {
    inputs.push({ phase: context.phase, iteration: context.iteration, input: context.input });
  };
  const finder = (context) => {
    remember(context);
    return { output: [] };
  };
  const candidateEvaluator = (context) => {
    remember(context);
    return { output: [] };
  };
  const decide = (context) => {
    remember(context);
    return { output: mode === "while" ? false : "accept" };
  };
  const result = await runtime.startCycleController(request, cycleGraph, {
    eventStore: store,
    lease: {
      leaseId: `cycle-cross-language-${suffix}-lease`,
      holderId: "cycle-cross-language-holder",
      leaseEpoch: 1,
      fencingToken: 1,
      acquiredAt: cycleStartedAt,
      expiresAt: "2026-07-26T12:01:00.000Z",
    },
    now: () => new Date(cycleStartedAt),
    activities: {
      finder,
      candidateEvaluator,
      ...(mode === "while" ? { condition: decide } : { optimizerEvaluator: decide }),
    },
  });
  const events = store.snapshot(request.eventStreamId);
  const checkpoint = runtime.createCycleControllerCheckpoint(
    events,
    `cycle-cross-language-${suffix}-terminal`,
    cycleCheckpointAt,
  );
  return {
    result,
    resultCanonical: core.canonicalSerialize(result),
    eventTypes: events.map(({ type }) => type),
    eventCanonical: events.map((event) => core.canonicalSerialize(event)),
    recordHashes: events.map(({ recordHash }) => recordHash),
    activityKeys: events
      .filter(({ type }) => type === "ActivityStarted")
      .map(({ data }) => data.activityKey),
    inputsCanonical: inputs.map((item) => core.canonicalSerialize(item)),
    checkpoint,
    checkpointCanonical: core.canonicalSerialize(checkpoint),
    checkpointStateCanonical: core.canonicalSerialize(checkpoint.state),
  };
}

const tsModeReports = {
  while: await exerciseCycleMode("while"),
  evaluatorOptimizer: await exerciseCycleMode("evaluator-optimizer"),
};
for (const [mode, tsModeReport] of Object.entries(tsModeReports)) {
  for (const field of Object.keys(tsModeReport)) {
    assert.deepEqual(
      tsModeReport[field],
      pyCycleReport.modes[mode][field],
      `D7 ${mode} ${field} differs`,
    );
  }
}

async function exerciseCycleInDoubt(exhausted) {
  const suffix = exhausted ? "exhausted" : "recovered";
  const value = JSON.parse(JSON.stringify(cycleRequestValue));
  Object.assign(value, {
    controllerRunId: `cycle-cross-language-in-doubt-${suffix}`,
    controllerId: `cycle-cross-language-in-doubt-${suffix}-controller`,
    hostRun: {
      relationship: "standalone-child-controller",
      runId: `cycle-cross-language-in-doubt-${suffix}-host`,
    },
    eventStreamId: `cycle-cross-language-in-doubt-${suffix}.events`,
    checkpointScope: `cycle-cross-language-in-doubt-${suffix}.checkpoints`,
  });
  value.policy.maxIterations = 1;
  value.activities.finder.sideEffects = "idempotent";
  value.activities.finder.maxAttemptsPerRound = 2;
  const request = runtime.validateCycleControllerRequest(value);
  const store = new runtime.MemoryCycleControllerEventStore();
  const inputs = [];
  let finderCalls = 0;
  const remember = (context) => {
    inputs.push({ phase: context.phase, iteration: context.iteration, input: context.input });
  };
  const finder = (context) => {
    finderCalls += 1;
    remember(context);
    if (finderCalls === 1 || exhausted) {
      throw new runtime.CycleActivityFailure(
        "GE_ACTIVITY_FAILED",
        "ambiguous idempotent provider result",
        { retryable: finderCalls < 2, inDoubt: true },
      );
    }
    return { output: [] };
  };
  const candidateEvaluator = (context) => {
    remember(context);
    return { output: [] };
  };
  const result = await runtime.startCycleController(request, cycleGraph, {
    eventStore: store,
    lease: {
      leaseId: `cycle-cross-language-in-doubt-${suffix}-lease`,
      holderId: "cycle-cross-language-holder",
      leaseEpoch: 1,
      fencingToken: 1,
      acquiredAt: cycleStartedAt,
      expiresAt: "2026-07-26T12:01:00.000Z",
    },
    now: () => new Date(cycleStartedAt),
    activities: { finder, candidateEvaluator },
  });
  const events = store.snapshot(request.eventStreamId);
  const checkpoint = runtime.createCycleControllerCheckpoint(
    events,
    `cycle-cross-language-in-doubt-${suffix}-terminal`,
    cycleCheckpointAt,
  );
  const inDoubtActivities = checkpoint.state.inDoubtActivities;
  assert.equal(result.exitReason, "MAX_ITERATIONS");
  assert.equal(finderCalls, 2);
  if (exhausted) {
    assert.equal(inDoubtActivities.length, 1);
    assert.equal(inDoubtActivities[0].attempt, 2);
  } else {
    assert.deepEqual(inDoubtActivities, []);
  }
  return {
    result,
    resultCanonical: core.canonicalSerialize(result),
    eventTypes: events.map(({ type }) => type),
    eventCanonical: events.map((event) => core.canonicalSerialize(event)),
    recordHashes: events.map(({ recordHash }) => recordHash),
    activityKeys: events
      .filter(({ type }) => type === "ActivityStarted")
      .map(({ data }) => data.activityKey),
    inputsCanonical: inputs.map((item) => core.canonicalSerialize(item)),
    checkpoint,
    checkpointCanonical: core.canonicalSerialize(checkpoint),
    checkpointStateCanonical: core.canonicalSerialize(checkpoint.state),
    inDoubtActivities,
    finderCalls,
  };
}

const tsInDoubtReports = {
  recovered: await exerciseCycleInDoubt(false),
  exhausted: await exerciseCycleInDoubt(true),
};
for (const [outcome, tsInDoubtReport] of Object.entries(tsInDoubtReports)) {
  for (const field of Object.keys(tsInDoubtReport)) {
    assert.deepEqual(
      tsInDoubtReport[field],
      pyCycleReport.inDoubt[outcome][field],
      `D7 in-doubt ${outcome} ${field} differs`,
    );
  }
}

async function exerciseCycleInDoubtResolution() {
  const value = JSON.parse(JSON.stringify(cycleRequestValue));
  Object.assign(value, {
    controllerRunId: "cycle-cross-language-resolution",
    controllerId: "cycle-cross-language-resolution-controller",
    hostRun: {
      relationship: "standalone-child-controller",
      runId: "cycle-cross-language-resolution-host",
    },
    eventStreamId: "cycle-cross-language-resolution.events",
    checkpointScope: "cycle-cross-language-resolution.checkpoints",
  });
  value.policy.maxIterations = 1;
  value.activities.finder.sideEffects = "idempotent";
  value.activities.finder.maxAttemptsPerRound = 2;
  const request = runtime.validateCycleControllerRequest(value);
  const store = new runtime.MemoryCycleControllerEventStore();
  const checkpointStore = new runtime.MemoryCycleControllerCheckpointStore();
  const inputs = [];
  let finderCalls = 0;
  const finder = (context) => {
    finderCalls += 1;
    inputs.push({ phase: context.phase, iteration: context.iteration, input: context.input });
    throw new runtime.CycleActivityFailure(
      "GE_ACTIVITY_FAILED",
      "ambiguous idempotent provider result",
      { retryable: finderCalls < 2, inDoubt: true },
    );
  };
  const terminal = await runtime.startCycleController(request, cycleGraph, {
    eventStore: store,
    lease: {
      leaseId: "cycle-cross-language-resolution-lease-1",
      holderId: "cycle-cross-language-holder",
      leaseEpoch: 1,
      fencingToken: 1,
      acquiredAt: cycleStartedAt,
      expiresAt: "2026-07-26T12:01:00.000Z",
    },
    now: () => new Date(cycleStartedAt),
    activities: { finder, candidateEvaluator: () => ({ output: [] }) },
  });
  const terminalEvents = store.snapshot(request.eventStreamId);
  const before = runtime.foldCycleControllerEvents(terminalEvents, { requireTerminal: true });
  assert.equal(before.inDoubtActivities.length, 1);
  const operatorId = "cycle-cross-language-resolution-operator";
  const resolutionLease = {
    leaseId: "cycle-cross-language-resolution-lease-2",
    holderId: operatorId,
    leaseEpoch: 2,
    fencingToken: 2,
    acquiredAt: cycleStartedAt,
    expiresAt: "2026-07-26T12:01:00.000Z",
  };
  const command = {
    apiVersion: "graphengineering.reacher-z.github.io/cycle-in-doubt-resolutions/v1alpha1",
    kind: "CycleInDoubtResolution",
    resolutionId: "cycle-cross-language-resolution-1",
    controllerRunId: request.controllerRunId,
    controllerHash: before.controllerHash,
    requestHash: before.requestHash,
    eventStreamId: request.eventStreamId,
    expectedSequence: before.lastSequence,
    expectedHistoryPrefixHash: before.historyPrefixHash,
    activityKey: before.inDoubtActivities[0].activityKey,
    disposition: "confirmed-not-applied",
    evidenceHash: "d".repeat(64),
    authoritySnapshot: {
      principalHash: "a".repeat(64),
      grantHash: "b".repeat(64),
      policyHash: "c".repeat(64),
      leaseHolderHash: runtime.sha256Utf8(operatorId),
    },
  };
  const resolutionAt = cycleCheckpointAt;
  const rejectionCode = async (commandValue, leaseValue, timestamp = resolutionAt) => {
    const beforeLength = store.snapshot(request.eventStreamId).length;
    try {
      await runtime.resolveCycleInDoubtActivity(request, commandValue, {
        eventStore: store,
        lease: leaseValue,
        now: () => new Date(timestamp),
      });
    } catch (error) {
      assert.equal(store.snapshot(request.eventStreamId).length, beforeLength);
      if (error !== null && typeof error === "object" && "code" in error) return error.code;
      throw error;
    }
    throw new Error("hostile resolution unexpectedly succeeded");
  };
  const errors = {
    malformed: await rejectionCode({ ...command, unexpected: true }, resolutionLease),
    wrongTarget: await rejectionCode({ ...command, activityKey: "f".repeat(64) }, resolutionLease),
    staleTail: await rejectionCode(
      { ...command, expectedSequence: command.expectedSequence - 1 },
      resolutionLease,
    ),
    staleFence: await rejectionCode(
      command,
      { ...resolutionLease, leaseEpoch: 1, fencingToken: 1 },
    ),
    wrongHolder: await rejectionCode(
      command,
      { ...resolutionLease, holderId: "attacker" },
    ),
    regressedClock: await rejectionCode(
      command,
      resolutionLease,
      "2026-07-26T11:59:59.999Z",
    ),
    expiredLease: await rejectionCode(
      command,
      resolutionLease,
      "2026-07-26T12:01:00.000Z",
    ),
  };
  const resolved = await runtime.resolveCycleInDoubtActivity(request, command, {
    eventStore: store,
    checkpointStore,
    lease: resolutionLease,
    now: () => new Date(resolutionAt),
  });
  const events = store.snapshot(request.eventStreamId);
  const checkpoint = await checkpointStore.read(
    request.checkpointScope,
    `${request.controllerRunId}-latest`,
  );
  assert.notEqual(checkpoint, null);
  assert.deepEqual(resolved.fold.inDoubtActivities, []);
  assert.deepEqual(resolved.fold.terminalResult, terminal);

  const duplicateLength = events.length;
  let clockCalls = 0;
  const duplicate = await runtime.resolveCycleInDoubtActivity(request, command, {
    eventStore: store,
    lease: { malformed: true },
    now: () => {
      clockCalls += 1;
      throw new Error("duplicate resolution sampled the clock");
    },
  });
  const duplicateZeroWrite = store.snapshot(request.eventStreamId).length === duplicateLength;
  const conflict = await rejectionCode(
    { ...command, disposition: "confirmed-applied" },
    { malformed: true },
  );
  const absentTarget = await rejectionCode({
    ...command,
    resolutionId: "cycle-cross-language-resolution-2",
    expectedSequence: resolved.event.sequence,
    expectedHistoryPrefixHash: resolved.event.recordHash,
  }, resolutionLease);

  return {
    command,
    commandCanonical: core.canonicalSerialize(command),
    commandHash: resolved.commandHash,
    result: terminal,
    resultCanonical: core.canonicalSerialize(terminal),
    eventTypes: events.map(({ type }) => type),
    eventCanonical: events.map((event) => core.canonicalSerialize(event)),
    recordHashes: events.map(({ recordHash }) => recordHash),
    inputsCanonical: inputs.map((item) => core.canonicalSerialize(item)),
    resolutionEvent: resolved.event,
    resolutionEventCanonical: core.canonicalSerialize(resolved.event),
    stateCanonical: core.canonicalSerialize(checkpoint.state),
    preResolutionInDoubt: before.inDoubtActivities,
    postResolutionInDoubt: resolved.fold.inDoubtActivities,
    checkpoint,
    checkpointCanonical: core.canonicalSerialize(checkpoint),
    checkpointStateCanonical: core.canonicalSerialize(checkpoint.state),
    errors: { ...errors, conflict, absentTarget },
    duplicate: {
      duplicate: duplicate.duplicate,
      commandHash: duplicate.commandHash,
      eventRecordHash: duplicate.event.recordHash,
      zeroWrite: duplicateZeroWrite,
      clockCalls,
    },
  };
}

const tsResolutionReport = await exerciseCycleInDoubtResolution();
assert.deepEqual(
  tsResolutionReport,
  pyCycleReport.resolution,
  "D7 terminal in-doubt resolution reports differ",
);

const LEASE_CAMPAIGN_FAULT_SIGNALS = Object.freeze({
  "process-loss": "coordinator-process-lost",
  "store-error": "durable-store-error",
  timeout: "operation-deadline-exceeded",
  cancellation: "operation-cancelled",
  "commit-then-throw": "commit-acknowledgement-lost",
});

class LeaseCampaignFault extends Error {
  constructor(faultKind) {
    const signal = LEASE_CAMPAIGN_FAULT_SIGNALS[faultKind];
    assert.notEqual(signal, undefined, `unknown lease campaign fault kind ${faultKind}`);
    super(signal);
    this.name = "LeaseCampaignFault";
    this.faultKind = faultKind;
    this.signal = signal;
  }
}

function findLeaseCampaignFault(error) {
  let candidate = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (candidate instanceof LeaseCampaignFault) return candidate;
    if (!(candidate instanceof Error) || candidate.cause === undefined) return null;
    candidate = candidate.cause;
  }
  return null;
}

class LeaseCampaignSeedStop extends Error {}

async function exerciseCycleLeaseFaultCampaign() {
  const campaign = cycleFaultFixture.retainedCampaigns.find(
    ({ id }) => id === "lease-administration-v1alpha1",
  );
  assert.notEqual(campaign, undefined, "D7 lease administration campaign is absent");
  const obligations = tsCycleFaultMatrix.filter((entry) => (
    campaign.eventTypes.includes(entry.eventType)
      && campaign.stages.includes(entry.stage)
      && campaign.faultKinds.includes(entry.faultKind)
  ));
  assert.equal(obligations.length, campaign.expectedObligationCount);
  const outcomes = [];
  for (const [index, obligation] of obligations.entries()) {
    const suffix = String(index).padStart(3, "0");
    const value = JSON.parse(JSON.stringify(cycleRequestValue));
    Object.assign(value, {
      controllerRunId: `cycle-lease-fault-${suffix}`,
      controllerId: `cycle-lease-fault-${suffix}-controller`,
      hostRun: {
        relationship: "standalone-child-controller",
        runId: `cycle-lease-fault-${suffix}-host`,
      },
      eventStreamId: `cycle-lease-fault-${suffix}.events`,
      checkpointScope: `cycle-lease-fault-${suffix}.checkpoints`,
    });
    value.policy.maxIterations = 1;
    const request = runtime.validateCycleControllerRequest(value);
    const initialLease = {
      leaseId: `cycle-lease-fault-${suffix}-lease-1`,
      holderId: "cycle-lease-fault-holder",
      leaseEpoch: 1,
      fencingToken: 1,
      acquiredAt: cycleStartedAt,
      expiresAt: "2026-07-26T12:01:00.000Z",
    };
    const extendedLease = {
      ...initialLease,
      expiresAt: "2026-07-26T12:02:00.000Z",
    };
    let targetFired = false;
    const targetHook = (boundary) => {
      if (!targetFired && boundary === obligation.boundary) {
        targetFired = true;
        throw new LeaseCampaignFault(obligation.faultKind);
      }
    };
    const store = new runtime.MemoryCycleControllerEventStore({ faultHook: targetHook });
    const checkpointStore = new runtime.MemoryCycleControllerCheckpointStore();
    const seedHook = (boundary) => {
      targetHook(boundary);
      if (boundary === campaign.seedBoundary) throw new LeaseCampaignSeedStop();
    };
    try {
      await runtime.startCycleController(request, cycleGraph, {
        eventStore: store,
        lease: initialLease,
        now: () => new Date(cycleStartedAt),
        faultHook: seedHook,
        activities: {
          finder: () => { throw new Error("seed dispatched finder"); },
          candidateEvaluator: () => { throw new Error("seed dispatched evaluator"); },
        },
      });
      throw new Error("lease campaign seed did not stop at RoundReserved");
    } catch (error) {
      if (!(error instanceof LeaseCampaignSeedStop)) throw error;
    }
    const seedEvents = store.snapshot(request.eventStreamId);
    assert.equal(seedEvents.at(-1).type, "RoundReserved");
    const seedTail = seedEvents.at(-1).sequence;
    const administer = async (expectedSequence, inject) => {
      const common = {
        eventStore: store,
        checkpointStore,
        expectedSequence,
        now: () => new Date(cycleStartedAt),
        ...(inject ? { faultHook: targetHook } : {}),
      };
      if (obligation.eventType === "LeaseRenewed") {
        return runtime.renewCycleControllerLease(request, { ...common, lease: extendedLease });
      }
      return runtime.pauseCycleController(request, { ...common, reason: "handoff" });
    };
    let observedFaultSignal;
    try {
      await administer(seedTail, true);
      throw new Error(`${obligation.eventType}/${obligation.stage}/${obligation.faultKind} did not fire`);
    } catch (error) {
      const injected = findLeaseCampaignFault(error);
      if (injected === null || !targetFired) throw error;
      assert.equal(injected.faultKind, obligation.faultKind);
      observedFaultSignal = injected.signal;
    }
    assert.equal(targetFired, true);
    assert.equal(observedFaultSignal, LEASE_CAMPAIGN_FAULT_SIGNALS[obligation.faultKind]);
    const interrupted = store.snapshot(request.eventStreamId);
    const interruptedFold = runtime.foldCycleControllerEvents(interrupted);
    const targetAtFault = interrupted.filter(({ type }) => type === obligation.eventType).length;
    const expectedCommitted = obligation.durability !== "event-not-committed";
    assert.equal(targetAtFault, Number(expectedCommitted));
    const checkpointId = `${request.controllerRunId}-latest`;
    const checkpointAtFault = await checkpointStore.read(request.checkpointScope, checkpointId);
    const expectedCheckpoint = obligation.durability === "event-and-checkpoint-committed";
    assert.equal(checkpointAtFault !== null, expectedCheckpoint);

    if (!expectedCommitted) await administer(seedTail, false);
    const recoveredEvents = store.snapshot(request.eventStreamId);
    assert.equal(
      recoveredEvents.filter(({ type }) => type === obligation.eventType).length,
      1,
    );
    const staleVersionLength = recoveredEvents.length;
    let staleVersionCode;
    try {
      await administer(seedTail, false);
      throw new Error("stale lease administration version unexpectedly committed");
    } catch (error) {
      if (!(error instanceof runtime.CycleControllerError)) throw error;
      staleVersionCode = error.code;
    }
    const staleVersionZeroWrite = store.snapshot(request.eventStreamId).length === staleVersionLength;
    assert.equal(staleVersionCode, "GE_CYCLE_VERSION_CONFLICT");
    assert.equal(staleVersionZeroWrite, true);

    let staleFinderCalls = 0;
    const staleFenceLength = store.snapshot(request.eventStreamId).length;
    let staleFenceCode;
    const recoveredFold = runtime.foldCycleControllerEvents(recoveredEvents);
    try {
      await runtime.resumeCycleController(request, cycleGraph, {
        eventStore: store,
        expectedSequence: recoveredEvents.at(-1).sequence,
        leaseReason: recoveredFold.activeLease === null ? "resume" : "takeover",
        lease: { ...initialLease, leaseId: `cycle-lease-fault-${suffix}-stale` },
        now: () => new Date(cycleStartedAt),
        activities: {
          finder: () => {
            staleFinderCalls += 1;
            return { output: [] };
          },
          candidateEvaluator: () => ({ output: [] }),
        },
      });
      throw new Error("stale lease fence unexpectedly resumed");
    } catch (error) {
      if (!(error instanceof runtime.CycleControllerError)) throw error;
      staleFenceCode = error.code;
    }
    const staleFenceZeroWrite = staleFinderCalls === 0
      && store.snapshot(request.eventStreamId).length === staleFenceLength;
    assert.equal(staleFenceCode, "GE_CYCLE_STALE_LEASE");
    assert.equal(staleFenceZeroWrite, true);

    let finderCalls = 0;
    let evaluatorCalls = 0;
    const resumed = await runtime.resumeCycleController(request, cycleGraph, {
      eventStore: store,
      expectedSequence: recoveredEvents.at(-1).sequence,
      leaseReason: recoveredFold.activeLease === null ? "resume" : "takeover",
      lease: {
        leaseId: `cycle-lease-fault-${suffix}-lease-2`,
        holderId: "cycle-lease-fault-holder-2",
        leaseEpoch: 2,
        fencingToken: 2,
        acquiredAt: cycleStartedAt,
        expiresAt: "2026-07-26T12:03:00.000Z",
      },
      now: () => new Date(cycleStartedAt),
      activities: {
        finder: () => {
          finderCalls += 1;
          return { output: [] };
        },
        candidateEvaluator: () => {
          evaluatorCalls += 1;
          return { output: [] };
        },
      },
    });
    assert.equal(resumed.exitReason, "MAX_ITERATIONS");
    assert.equal(finderCalls, 1);
    const finalEvents = store.snapshot(request.eventStreamId);
    const finalFold = runtime.foldCycleControllerEvents(finalEvents, { requireTerminal: true });
    assert.equal(finalEvents.filter(({ type }) => type === obligation.eventType).length, 1);
    const replayed = await runtime.replayCycleController(store, request.eventStreamId);
    assert.deepEqual(replayed.terminalResult, resumed);
    const terminalResumeLength = finalEvents.length;
    let terminalClockCalls = 0;
    const terminal = await runtime.resumeCycleController(request, cycleGraph, {
      eventStore: store,
      expectedSequence: finalEvents.at(-1).sequence,
      lease: {
        leaseId: `cycle-lease-fault-${suffix}-lease-3`,
        holderId: "cycle-lease-fault-holder-3",
        leaseEpoch: 3,
        fencingToken: 3,
        acquiredAt: cycleStartedAt,
        expiresAt: "2026-07-26T12:04:00.000Z",
      },
      now: () => {
        terminalClockCalls += 1;
        throw new Error("terminal resume sampled clock");
      },
      activities: {
        finder: () => { throw new Error("terminal resume dispatched finder"); },
        candidateEvaluator: () => { throw new Error("terminal resume dispatched evaluator"); },
      },
    });
    assert.deepEqual(terminal, resumed);
    const terminalResumeZeroWrite = store.snapshot(request.eventStreamId).length === terminalResumeLength;
    assert.equal(terminalResumeZeroWrite, true);
    assert.equal(terminalClockCalls, 0);
    const targetEvent = finalEvents.find(({ type }) => type === obligation.eventType);
    assert.notEqual(targetEvent, undefined);
    const finalCheckpoint = runtime.createCycleControllerCheckpoint(
      finalEvents,
      `cycle-lease-fault-${suffix}-final`,
      cycleCheckpointAt,
    );
    outcomes.push({
      ...obligation,
      index,
      faultSignal: observedFaultSignal,
      eventCommittedAtFault: expectedCommitted,
      checkpointCommittedAtFault: expectedCheckpoint,
      interruptedTailHash: interruptedFold.historyPrefixHash,
      interruptedRecordHashes: interrupted.map(({ recordHash }) => recordHash),
      checkpointAtFaultCanonical: checkpointAtFault === null
        ? null
        : core.canonicalSerialize(checkpointAtFault),
      targetEventCanonical: core.canonicalSerialize(targetEvent),
      staleVersionCode,
      staleVersionZeroWrite,
      staleFenceCode,
      staleFenceZeroWrite,
      finderCalls,
      evaluatorCalls,
      resultCanonical: core.canonicalSerialize(resumed),
      finalEventTypes: finalEvents.map(({ type }) => type),
      finalRecordHashes: finalEvents.map(({ recordHash }) => recordHash),
      finalCheckpointCanonical: core.canonicalSerialize(finalCheckpoint),
      terminalResumeZeroWrite,
      terminalResumeClockCalls: terminalClockCalls,
    });
  }
  return {
    campaignId: campaign.id,
    requiredAssertions: campaign.requiredAssertions,
    obligationCount: outcomes.length,
    outcomes,
  };
}

const tsLeaseFaultCampaign = await exerciseCycleLeaseFaultCampaign();
assert.deepEqual(
  tsLeaseFaultCampaign,
  pyCycleReport.leaseFaultCampaign,
  "D7 lease administration fault-campaign reports differ",
);
const cycleInterruptionFixture = JSON.parse(
  await readFile(
    join(fixtureRoot, "cycle-controller-activity-interruption.case.json"),
    "utf8",
  ),
);
const pythonCycleInterruption = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "python",
    "python",
    "tools/conformance/python_cycle_interruption_report.py",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonCycleInterruption.status !== 0) {
  throw new Error(
    `Python cycle activity interruption campaign failed:\n${pythonCycleInterruption.stderr || pythonCycleInterruption.stdout}`,
  );
}
const pyCycleInterruption = JSON.parse(pythonCycleInterruption.stdout);
const tsCycleInterruption = await exerciseCycleActivityInterruptionCampaign({
  runtime,
  core,
  graph: cycleGraph,
  graphHash: cycleCompilation.graphHash,
  baseRequest: cycleRequestValue,
  fixture: cycleInterruptionFixture,
  startedAt: cycleStartedAt,
  checkpointAt: cycleCheckpointAt,
});
assert.deepEqual(
  tsCycleInterruption,
  pyCycleInterruption,
  "D7 activity cancellation/timeout campaign reports differ",
);
const cycleOperationInterruptionFixture = JSON.parse(
  await readFile(
    join(fixtureRoot, "cycle-controller-operation-interruption.case.json"),
    "utf8",
  ),
);
const pythonCycleOperationInterruption = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "python",
    "python",
    "tools/conformance/python_cycle_operation_interruption_report.py",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonCycleOperationInterruption.status !== 0) {
  throw new Error(
    `Python cycle operation interruption campaign failed:\n${pythonCycleOperationInterruption.stderr || pythonCycleOperationInterruption.stdout}`,
  );
}
const pyCycleOperationInterruption = JSON.parse(pythonCycleOperationInterruption.stdout);
const tsCycleOperationInterruption = await exerciseCycleOperationInterruptionCampaign({
  runtime,
  core,
  graph: cycleGraph,
  graphHash: cycleCompilation.graphHash,
  baseRequest: cycleRequestValue,
  fixture: cycleOperationInterruptionFixture,
  startedAt: "2026-07-27T12:00:00.000Z",
});
assert.deepEqual(
  tsCycleOperationInterruption,
  pyCycleOperationInterruption,
  "D7 pause/resume/replay/fork interruption campaign reports differ",
);
const cyclePatchVisibilityFixture = JSON.parse(
  await readFile(
    join(fixtureRoot, "cycle-controller-patch-visibility-fault.case.json"),
    "utf8",
  ),
);
const pythonCyclePatchVisibility = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "python",
    "python",
    "tools/conformance/python_cycle_patch_visibility_fault_report.py",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonCyclePatchVisibility.status !== 0) {
  throw new Error(
    `Python cycle PatchAccepted visibility fault campaign failed:\n${pythonCyclePatchVisibility.stderr || pythonCyclePatchVisibility.stdout}`,
  );
}
const pyCyclePatchVisibility = JSON.parse(pythonCyclePatchVisibility.stdout);
const tsCyclePatchVisibility = await exerciseCyclePatchVisibilityFaultCampaign({
  runtime,
  core,
  graph: cycleGraph,
  graphHash: cycleCompilation.graphHash,
  baseRequest: cycleRequestValue,
  fixture: cyclePatchVisibilityFixture,
  startedAt: cycleStartedAt,
  checkpointAt: cycleCheckpointAt,
});
assert.deepEqual(
  tsCyclePatchVisibility,
  pyCyclePatchVisibility,
  "D7 PatchAccepted visibility fault campaign reports differ",
);
const cyclePatchCheckpointFixture = JSON.parse(
  await readFile(
    join(fixtureRoot, "cycle-controller-patch-checkpoint-fault.case.json"),
    "utf8",
  ),
);
const pythonCyclePatchCheckpoint = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "python",
    "python",
    "tools/conformance/python_cycle_patch_checkpoint_fault_report.py",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonCyclePatchCheckpoint.status !== 0) {
  throw new Error(
    `Python cycle PatchAccepted checkpoint fault campaign failed:\n${pythonCyclePatchCheckpoint.stderr || pythonCyclePatchCheckpoint.stdout}`,
  );
}
const pyCyclePatchCheckpoint = JSON.parse(pythonCyclePatchCheckpoint.stdout);
const tsCyclePatchCheckpoint = await exerciseCyclePatchCheckpointFaultCampaign({
  runtime,
  core,
  graph: cycleGraph,
  graphHash: cycleCompilation.graphHash,
  baseRequest: cycleRequestValue,
  fixture: cyclePatchCheckpointFixture,
  startedAt: cycleStartedAt,
  checkpointAt: cycleCheckpointAt,
});
assert.deepEqual(
  tsCyclePatchCheckpoint,
  pyCyclePatchCheckpoint,
  "D7 PatchAccepted checkpoint fault campaign reports differ",
);
const tsModeEventCount = Object.values(tsModeReports)
  .reduce((total, report) => total + report.eventTypes.length, 0);
const tsModeInputCount = Object.values(tsModeReports)
  .reduce((total, report) => total + report.inputsCanonical.length, 0);
const tsInDoubtEventCount = Object.values(tsInDoubtReports)
  .reduce((total, report) => total + report.eventTypes.length, 0);
const tsInDoubtInputCount = Object.values(tsInDoubtReports)
  .reduce((total, report) => total + report.inputsCanonical.length, 0);
const tsResolutionEventCount = tsResolutionReport.eventTypes.length;
const tsResolutionInputCount = tsResolutionReport.inputsCanonical.length;
process.stdout.write(
  `Cross-language native-cycle conformance passed for ${tsCycleEvents.length + tsPatchEvents.length + tsResumeEvents.length + tsModeEventCount + tsInDoubtEventCount + tsResolutionEventCount} exact baseline events, ${cycleInputs.length + patchInputs.length + resumeInputs.length + tsModeInputCount + tsInDoubtInputCount + tsResolutionInputCount} activity inputs, ${tsCycleFaultReport.matrix.length} durable fault obligations over ${cycleFaultFixture.expect.boundaryCount} boundaries, ${tsLeaseFaultCampaign.obligationCount} executable lease-renew/release fault recoveries, ${tsCycleInterruption.obligationCount} exact activity cancellation/timeout recoveries, ${tsCycleOperationInterruption.obligationCount} exact pause/resume/replay/fork interruption recoveries, ${tsCyclePatchVisibility.obligationCount} exact PatchAccepted visibility fault recoveries, ${tsCyclePatchCheckpoint.obligationCount} exact PatchAccepted checkpoint fault recoveries, all three controller modes, two in-doubt recovery outcomes, one authority-bound terminal resolution, eight terminal results, one accepted GraphPatch/revision, one crash/takeover resume, and eight baseline checkpoints.\n`,
);

// Authoring conformance is intentionally expected-vs-TypeScript-vs-Python.
// Native equality alone is insufficient because both implementations can share
// the same bug.
const authoringRoot = join(fixtureRoot, "authoring");

async function loadAuthoringJson(name) {
  return JSON.parse(await readFile(join(authoringRoot, name), "utf8"));
}

function normalizeAuthoringDiagnostic(item) {
  const normalized = {
    code: item.code,
    path: item.path ?? null,
    nodeIds: [...(item.nodeIds ?? [])],
  };
  if (item.edgeId !== undefined) normalized.edgeId = item.edgeId;
  if (item.outputName !== undefined) normalized.outputName = item.outputName;
  return normalized;
}

function compileAuthoringDocument(document) {
  const result = core.compileGraph(document);
  const report = {
    valid: result.valid,
    diagnostics: result.diagnostics.map(normalizeAuthoringDiagnostic),
  };
  if (!result.valid || result.canonicalGraph === null || result.graphHash === null) {
    return report;
  }
  return {
    ...report,
    graph: JSON.parse(result.canonicalGraph),
    canonicalGraph: result.canonicalGraph,
    graphHash: result.graphHash,
    identity: core.createCompiledGraphIdentity(document),
    topologicalLayers: result.topologicalLayers,
  };
}

function buildAuthoringDocument(document) {
  const options = {
    metadata: document.metadata,
    inputSchema: document.inputSchema,
    outputSchema: document.outputSchema,
    ...(Object.hasOwn(document, "stateSchema") ? { stateSchema: document.stateSchema } : {}),
    ...(Object.hasOwn(document, "policies") ? { policies: document.policies } : {}),
  };
  const builder = core.graphBuilder(options);
  for (const node of document.nodes) builder.addNode(node);
  for (const edge of document.edges) builder.addEdge(edge);
  for (const entrypoint of document.entrypoints) builder.addEntrypoint(entrypoint);
  for (const [name, endpoint] of Object.entries(document.outputs)) {
    builder.addOutput(name, endpoint);
  }
  const built = builder.build();
  return {
    valid: true,
    diagnostics: [],
    graph: built.graph,
    canonicalGraph: built.canonicalGraph,
    graphHash: built.graphHash,
    identity: built.identity,
  };
}

function captureBuilderFailure(operation) {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof core.GraphBuilderError, "unexpected builder error type");
    return {
      code: error.code,
      path: error.path,
      diagnosticCodes: error.diagnostics.map(({ code }) => code),
    };
  }
  throw new Error("builder diagnostic operation unexpectedly succeeded");
}

function typescriptBuilderDiagnosticReport() {
  const node = {
    id: "a",
    kind: "transform",
    inputSchema: {},
    outputSchema: {},
    config: null,
  };
  const edge = { id: "edge", from: { node: "a" }, to: { node: "b" } };
  const makeBuilder = () => core.graphBuilder({
    metadata: { name: "builder-diagnostics", version: "1" },
    inputSchema: {},
    outputSchema: {},
  });
  const sealed = makeBuilder()
    .addNode(node)
    .addEntrypoint("a")
    .addOutput("result", { node: "a" });
  sealed.build();

  const operations = {
    "constructor-missing-metadata": () => core.graphBuilder({ inputSchema: {}, outputSchema: {} }),
    "constructor-missing-input-schema": () => core.graphBuilder({
      metadata: { name: "builder-diagnostics", version: "1" },
      outputSchema: {},
    }),
    "constructor-missing-output-schema": () => core.graphBuilder({
      metadata: { name: "builder-diagnostics", version: "1" },
      inputSchema: {},
    }),
    "duplicate-node": () => makeBuilder().addNode(node).addNode(node),
    "duplicate-edge": () => makeBuilder().addEdge(edge).addEdge(edge),
    "duplicate-entrypoint": () => makeBuilder().addEntrypoint("a").addEntrypoint("a"),
    "duplicate-output": () => makeBuilder()
      .addOutput("result", { node: "a" })
      .addOutput("result", { node: "a" }),
    "malformed-node": () => makeBuilder().addNode({ id: "a" }),
    "malformed-edge": () => makeBuilder().addEdge({
      id: "bad edge",
      from: { node: "a" },
      to: { node: "b" },
    }),
    "malformed-output": () => makeBuilder().addOutput("result", { node: "a", port: null }),
    "malformed-policies": () => makeBuilder().setPolicies({ maxDepth: 0 }),
    "missing-entrypoint": () => makeBuilder()
      .addNode(node)
      .addOutput("result", { node: "a" })
      .build(),
    "missing-output": () => makeBuilder().addNode(node).addEntrypoint("a").build(),
    "core-rejected": () => makeBuilder()
      .addNode(node)
      .addEntrypoint("missing")
      .addOutput("result", { node: "also-missing" })
      .build(),
    "sealed-add-node": () => sealed.addNode(node),
    "sealed-add-edge": () => sealed.addEdge(edge),
    "sealed-add-entrypoint": () => sealed.addEntrypoint("next"),
    "sealed-add-output": () => sealed.addOutput("next/value~", { node: "a" }),
    "sealed-set-policies": () => sealed.setPolicies({}),
    "sealed-enable-typed-ports": () => sealed.enableStrictTypedPorts(),
    "sealed-build": () => sealed.build(),
  };
  return Object.fromEntries(
    Object.entries(operations).map(([name, operation]) => [name, captureBuilderFailure(operation)]),
  );
}

async function decodeAuthoringFile(name, format) {
  return core.decodeGraphSource(await readFile(join(authoringRoot, name)), { format });
}

function authoringMutation(identity, mutation) {
  const candidate = JSON.parse(JSON.stringify(identity));
  const parts = mutation.path === "#"
    ? []
    : mutation.path.slice(2).split("/").map((part) =>
      part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let parent = candidate;
  for (const part of parts.slice(0, -1)) {
    parent = Array.isArray(parent) ? parent[Number(part)] : parent[part];
  }
  const final = parts.at(-1);
  if (mutation.operation === "replace") {
    if (Array.isArray(parent)) parent[Number(final)] = mutation.value;
    else parent[final] = mutation.value;
  } else if (mutation.operation === "swap") {
    const sequence = Array.isArray(parent) ? parent[Number(final)] : parent[final];
    const [left, right] = mutation.indices;
    [sequence[left], sequence[right]] = [sequence[right], sequence[left]];
  } else {
    throw new Error(`unsupported authoring mutation '${mutation.operation}'`);
  }
  return candidate;
}

function assertAuthoringSubset(actual, expectedValue, label) {
  if (expectedValue === null || typeof expectedValue !== "object") {
    assert.deepEqual(actual, expectedValue, label);
    return;
  }
  if (Array.isArray(expectedValue)) {
    assert.ok(Array.isArray(actual), `${label}: actual value is not an array`);
    assert.equal(actual.length, expectedValue.length, `${label}: array length differs`);
    expectedValue.forEach((value, index) => {
      assertAuthoringSubset(actual[index], value, `${label}[${index}]`);
    });
    return;
  }
  assert.ok(actual !== null && typeof actual === "object", `${label}: actual is not an object`);
  for (const [key, value] of Object.entries(expectedValue)) {
    assert.ok(Object.hasOwn(actual, key), `${label}: missing key '${key}'`);
    assertAuthoringSubset(actual[key], value, `${label}.${key}`);
  }
}

function assertSourceFailure(actual, testCase, language) {
  const expectedValue = testCase.expect;
  const label = `${testCase.name}: ${language}`;
  assert.equal(actual.code, expectedValue.code, `${label} source code`);
  assert.equal(actual.format, testCase.format, `${label} source format`);
  if (Object.hasOwn(expectedValue, "path")) {
    assert.equal(actual.path, expectedValue.path, `${label} source path`);
  }
  for (const field of ["line", "column"]) {
    if (actual[field] !== null) {
      assert.ok(Number.isInteger(actual[field]) && actual[field] >= 1, `${label} ${field}`);
    }
  }
}

const authoringCases = await loadAuthoringJson("authoring.case.json");
const identityGoldenSet = await loadAuthoringJson("component-identity.expected.json");
const identityGolden = identityGoldenSet.identities;
const pythonAuthoring = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_authoring_report.py"],
  { cwd: root, encoding: "utf8" },
);
if (pythonAuthoring.status !== 0) {
  throw new Error(
    `Python authoring conformance failed:\n${pythonAuthoring.stderr || pythonAuthoring.stdout}`,
  );
}
const pyAuthoringReport = JSON.parse(pythonAuthoring.stdout);
const tsBuilderDiagnostics = typescriptBuilderDiagnosticReport();

for (const testCase of authoringCases.builderDiagnosticCases) {
  const tsReport = tsBuilderDiagnostics[testCase.name];
  const pyReport = pyAuthoringReport.builderDiagnostics[testCase.name];
  assert.deepEqual(tsReport, testCase.expect, `${testCase.name}: TypeScript builder diagnostic`);
  assert.deepEqual(pyReport, testCase.expect, `${testCase.name}: Python builder diagnostic`);
}

for (const testCase of authoringCases.equivalenceCases) {
  const expectedGraph = await loadAuthoringJson(testCase.builderGraph);
  const expectedIdentity = identityGolden[testCase.identityKey];
  const expectedCanonical = core.canonicalSerialize(expectedGraph);
  const reports = {
    typescriptJson: compileAuthoringDocument(
      await decodeAuthoringFile(testCase.json, "json"),
    ),
    typescriptYaml: compileAuthoringDocument(
      await decodeAuthoringFile(testCase.yaml, "yaml"),
    ),
    typescriptBuilder: buildAuthoringDocument(expectedGraph),
    pythonJson: pyAuthoringReport.equivalence[testCase.name].json,
    pythonYaml: pyAuthoringReport.equivalence[testCase.name].yaml,
    pythonBuilder: pyAuthoringReport.equivalence[testCase.name].builder,
  };
  for (const [pathName, report] of Object.entries(reports)) {
    assert.equal(report.valid, true, `${testCase.name}: ${pathName} must be valid`);
    assert.deepEqual(report.graph, expectedGraph, `${testCase.name}: ${pathName} graph`);
    assert.equal(
      report.canonicalGraph,
      expectedCanonical,
      `${testCase.name}: ${pathName} canonical graph`,
    );
    assert.equal(
      report.graphHash,
      testCase.expect.graphHash,
      `${testCase.name}: ${pathName} graph hash`,
    );
    assert.deepEqual(
      report.identity,
      expectedIdentity,
      `${testCase.name}: ${pathName} compiled identity`,
    );
    if (report.topologicalLayers !== undefined) {
      assert.deepEqual(
        report.topologicalLayers,
        testCase.expect.topologicalLayers,
        `${testCase.name}: ${pathName} topological layers`,
      );
    }
  }
}

for (const testCase of authoringCases.validSourceCases) {
  const sourceName = testCase.yaml ?? testCase.json;
  const format = testCase.yaml === undefined ? "json" : "yaml";
  const decoded = await decodeAuthoringFile(sourceName, format);
  const reports = {
    typescriptSource: compileAuthoringDocument(decoded),
    typescriptBuilder: buildAuthoringDocument(decoded),
    pythonSource: pyAuthoringReport.validSource[testCase.name].source,
    pythonBuilder: pyAuthoringReport.validSource[testCase.name].builder,
  };
  const tsReport = reports.typescriptSource;
  for (const [pathName, report] of Object.entries(reports)) {
    assert.equal(report.valid, true, `${testCase.name}: ${pathName} must be valid`);
    assert.deepEqual(report.graph, tsReport.graph, `${testCase.name}: ${pathName} graph`);
    assert.equal(
      report.canonicalGraph,
      tsReport.canonicalGraph,
      `${testCase.name}: ${pathName} canonical graph`,
    );
    assert.equal(
      report.graphHash,
      testCase.expect.graphHash,
      `${testCase.name}: ${pathName} graph hash`,
    );
    assert.deepEqual(
      report.identity,
      tsReport.identity,
      `${testCase.name}: ${pathName} identity`,
    );
  }
  assert.equal(tsReport.graphHash, testCase.expect.graphHash, `${testCase.name}: graph hash`);
  assert.equal(
    tsReport.identity.revisionHash,
    testCase.expect.revisionHash,
    `${testCase.name}: revision hash`,
  );
  if (testCase.identityKey !== undefined) {
    assert.deepEqual(
      tsReport.identity,
      identityGolden[testCase.identityKey],
      `${testCase.name}: golden identity`,
    );
  }
  if (testCase.expect.nodeOrder !== undefined) {
    assert.deepEqual(
      tsReport.graph.nodes.map(({ id }) => id),
      testCase.expect.nodeOrder,
      `${testCase.name}: node declaration order`,
    );
  }
  if (testCase.expect.edgeOrder !== undefined) {
    assert.deepEqual(
      tsReport.graph.edges.map(({ id }) => id),
      testCase.expect.edgeOrder,
      `${testCase.name}: edge declaration order`,
    );
  }
  if (testCase.expect.topologicalLayers !== undefined) {
    assert.deepEqual(
      tsReport.topologicalLayers,
      testCase.expect.topologicalLayers,
      `${testCase.name}: topological layers`,
    );
  }
  if (testCase.expect.labels !== undefined) {
    assert.deepEqual(tsReport.graph.metadata.labels, testCase.expect.labels, `${testCase.name}: labels`);
  }
  if (testCase.expect.configScalars !== undefined) {
    assertAuthoringSubset(
      tsReport.graph.nodes[0].config,
      testCase.expect.configScalars,
      `${testCase.name}: scalar projection`,
    );
  }
  if (Object.hasOwn(testCase.expect, "nodeConfig")) {
    assert.deepEqual(tsReport.graph.nodes[0].config, testCase.expect.nodeConfig);
    assert.deepEqual(
      tsReport.graph.policies["future-policy"].optional,
      testCase.expect.policyExtensionValue,
    );
  }
  if (testCase.expect.outputNames !== undefined) {
    assert.deepEqual(Object.keys(tsReport.graph.outputs), testCase.expect.outputNames);
  }
}

for (const testCase of authoringCases.sourceBoundaryCases) {
  const options = { format: testCase.format, limits: testCase.limits };
  const tsValue = core.decodeGraphSource(testCase.source, options);
  const pyValue = pyAuthoringReport.sourceBoundary[testCase.name];
  assert.deepEqual({ value: tsValue }, testCase.expect, `${testCase.name}: TypeScript boundary`);
  assert.deepEqual(pyValue, testCase.expect, `${testCase.name}: Python boundary`);
  assert.deepEqual({ value: tsValue }, pyValue, `${testCase.name}: native boundary values differ`);
}

for (const testCase of authoringCases.compilerInvalidYamlCases) {
  const tsReport = compileAuthoringDocument(
    await decodeAuthoringFile(testCase.yaml, "yaml"),
  );
  const pyReport = pyAuthoringReport.compilerInvalid[testCase.name];
  const expectedCodes = testCase.expect.diagnosticCodes;
  assert.equal(tsReport.valid, false, `${testCase.name}: TypeScript must reject Graph IR`);
  assert.equal(pyReport.valid, false, `${testCase.name}: Python must reject Graph IR`);
  assert.deepEqual(tsReport.diagnostics.map(({ code }) => code), expectedCodes);
  assert.deepEqual(pyReport.diagnostics.map(({ code }) => code), expectedCodes);
}

for (const testCase of authoringCases.typedDiagnosticCases) {
  const document = await loadAuthoringJson(testCase.graph);
  const tsReport = compileAuthoringDocument(document);
  const pyReport = pyAuthoringReport.typedDiagnostics[testCase.name];
  assert.equal(tsReport.valid, false, `${testCase.name}: TypeScript typed graph must fail`);
  assert.equal(pyReport.valid, false, `${testCase.name}: Python typed graph must fail`);
  assert.deepEqual(tsReport.diagnostics, testCase.expect, `${testCase.name}: TypeScript diagnostics`);
  assert.deepEqual(pyReport.diagnostics, testCase.expect, `${testCase.name}: Python diagnostics`);
}

const sourceFailureCases = await loadAuthoringJson("yaml-invalid.case.json");
for (const testCase of sourceFailureCases.cases) {
  const source = testCase.sourceHex !== undefined
    ? Buffer.from(testCase.sourceHex, "hex")
    : testCase.sourceRepeat !== undefined
      ? `${testCase.sourceRepeat.prefix ?? ""}${testCase.sourceRepeat.value.repeat(testCase.sourceRepeat.count)}${testCase.sourceRepeat.suffix ?? ""}`
      : testCase.sourceSegments !== undefined
        ? testCase.sourceSegments.map((segment) => segment.value.repeat(segment.count)).join("")
        : testCase.source;
  let tsProjection;
  try {
    core.decodeGraphSource(source, { format: testCase.format, limits: testCase.limits });
    assert.fail(`${testCase.name}: TypeScript accepted invalid source`);
  } catch (error) {
    assert.ok(error instanceof core.GraphSourceError, `${testCase.name}: wrong TypeScript error`);
    tsProjection = error.toJSON();
  }
  const pyProjection = pyAuthoringReport.sourceFailures[testCase.name];
  assertSourceFailure(tsProjection, testCase, "TypeScript");
  assertSourceFailure(pyProjection, testCase, "Python");
  assert.equal(tsProjection.code, pyProjection.code, `${testCase.name}: native source codes differ`);
  if (Object.hasOwn(testCase.expect, "path")) {
    assert.equal(tsProjection.path, pyProjection.path, `${testCase.name}: native paths differ`);
  }
}

const graphByIdentity = {
  equivalent: await loadAuthoringJson("equivalent.graph.json"),
  "typed-ports": await loadAuthoringJson("typed-ports.graph.json"),
  "unicode-and-keys": await loadAuthoringJson("unicode-and-keys.graph.json"),
};
for (const [identityKey, identity] of Object.entries(identityGolden)) {
  const positive = core.verifyCompiledGraphIdentity(graphByIdentity[identityKey], identity);
  assert.equal(positive.valid, true, `${identityKey}: TypeScript rejected golden identity`);
}
for (const testCase of authoringCases.identityMutationCases) {
  const candidate = authoringMutation(
    identityGolden[testCase.identityKey],
    testCase.mutation,
  );
  const tsResult = core.verifyCompiledGraphIdentity(
    graphByIdentity[testCase.identityKey],
    candidate,
  );
  const pyResult = pyAuthoringReport.identityMutations[testCase.name];
  if (testCase.expect.valid === true) {
    assert.equal(tsResult.valid, true, `${testCase.name}: TypeScript should accept identity`);
    assert.equal(pyResult.valid, true, `${testCase.name}: Python should accept identity`);
    continue;
  }
  const tsDiagnostic = normalizeAuthoringDiagnostic(tsResult.diagnostics[0]);
  const pyDiagnostic = pyResult.diagnostics[0];
  assert.equal(tsResult.valid, false, `${testCase.name}: TypeScript identity must fail`);
  assert.equal(pyResult.valid, false, `${testCase.name}: Python identity must fail`);
  assert.equal(tsDiagnostic.code, testCase.expect.code, `${testCase.name}: TypeScript code`);
  assert.equal(pyDiagnostic.code, testCase.expect.code, `${testCase.name}: Python code`);
  assert.equal(tsDiagnostic.path, testCase.expect.path, `${testCase.name}: TypeScript path`);
  assert.equal(pyDiagnostic.path, testCase.expect.path, `${testCase.name}: Python path`);
}

process.stdout.write(
  `Cross-language authoring conformance passed for ${authoringCases.equivalenceCases.length} four-authoring-path equivalence cases (six native reports), ${authoringCases.validSourceCases.length} four-report valid-source cases, ${authoringCases.builderDiagnosticCases.length} builder diagnostics, ${sourceFailureCases.cases.length} source failures, ${authoringCases.typedDiagnosticCases.length} typed diagnostics, and ${authoringCases.identityMutationCases.length} identity mutations.\n`,
);
