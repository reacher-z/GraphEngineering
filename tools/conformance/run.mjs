#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
const pyDurable = JSON.parse(pythonDurable.stdout);

// spec/redaction-semantics.md Section 4.2: a durable run without a configured
// protected payload store and key provider fails closed with
// PAYLOAD_PROTECTION_REQUIRED, so this campaign runs the guarded
// `events/v1alpha2` path on both lanes. Each lane configures its own equivalent
// protection — a guarded in-memory journal, an in-memory protected payload
// store, and the clearly named deterministic test key provider.
//
// A protected reference is bound to its exact event AAD and its ciphertext
// lives in the writing lane's payload store, so the pre-hard-cut handoff (ship
// Python's committed events over stdout and replay the bytes into a TypeScript
// store) is no longer possible: the two lanes' deterministic test key providers
// derive different run identity keys, so TypeScript cannot authenticate a
// Python-written reference. Each lane therefore produces the same crash history
// itself, and the comparison moved to (a) the closed metadata envelope of every
// committed record, including the full `data` member-name set, and (b) the
// recovered projection — every protected reference resolved back to its
// application value — which is what the transferred inline `data` used to carry.
const DURABLE_SCOPE = Object.freeze({
  tenantScopeId: "tenant-durable-conformance",
  authorityProviderId: "provider-durable-conformance",
  authoritySubjectId: "subject-durable-conformance",
});

/**
 * `data` members that cannot be compared byte-for-byte across the two lanes.
 *
 * This set used to hold every key-derived member on the stated grounds that the
 * two lanes ship different deterministic test providers. That is no longer true:
 * both lanes derive protection keys, identity keys and nonces from one shared
 * rule, so `activityKey`, `capturePolicyHash`, `keyRefHash` and every `*Mac` are
 * byte-identical and are compared directly.
 *
 * What remains is the opaque reference object itself. Its `ref` is a fresh
 * `uuid4` minted per protect call, which is deliberately not a function of
 * anything — the point of the reference is that it carries no filename, path,
 * tenant or key identity. What it protects is compared through the recovered
 * projection, which authenticates it under its exact event AAD first.
 */
const DURABLE_OPAQUE_REFERENCE_MEMBERS = new Set([
  "evidenceRef", "inputRef", "outputRef", "resultRef",
]);

/**
 * `capturePolicyHash` is excluded for one specific, named reason, and the thing
 * it stands for is compared directly instead (see `durableCapturePolicyModes`).
 *
 * The two lanes ship the same nineteen control modes and the same diagnostic
 * limit, but different `transformImplementationHash`, `ruleRegistryVersion` and
 * `ruleRegistryHash` — a redaction-policy divergence that is not this lane's to
 * settle. Excluding the hash without comparing the modes would hide that; this
 * comparison makes the modes a gate and leaves exactly the three known fields
 * outstanding.
 */
const DURABLE_POLICY_HASH_MEMBERS = new Set(["capturePolicyHash"]);

/** The semantic content of a capture policy: every control mode it declares. */
function durableCapturePolicyModes(policy) {
  const derived = new Set([
    "apiVersion", "keyRef", "redactionTransform", "redactionRules",
    "transformImplementationHash", "ruleRegistryVersion", "ruleRegistryHash",
  ]);
  return Object.fromEntries(
    Object.keys(policy).sort().filter((name) => !derived.has(name))
      .map((name) => [name, policy[name]]),
  );
}

/** `[referenceMember, hydratedMember, taggedEncoding]` per protected event type. */
const DURABLE_PROTECTED_FIELDS = {
  RunCreated: ["inputRef", "input", true],
  NodeScheduled: ["inputRef", "input", true],
  NodeSucceeded: ["outputRef", "output", true],
  NodeSettledWithoutAttempt: ["resultRef", "result", true],
  RunSucceeded: ["resultRef", "result", true],
  RunFailed: ["resultRef", "result", true],
  RunCancelled: ["resultRef", "result", true],
  NodeAttemptFailed: ["evidenceRef", "failure", false],
};

/**
 * The closed, key-independent metadata of one committed `events/v1alpha2`
 * record. `eventId` and `payloadHash` are deliberately absent: the two lanes
 * mint different default event identifiers (`runId.sequence` here,
 * `runId:sequence` on the Python lane) and `payloadHash` hashes a `data` member
 * that now holds an opaque per-call reference.
 */
function durableEnvelope(event) {
  return {
    apiVersion: event.apiVersion,
    sequence: event.sequence,
    type: event.type,
    nodeId: event.nodeId ?? null,
    edgeId: event.edgeId ?? null,
    attempt: event.attempt ?? null,
    timestamp: event.timestamp,
    redacted: event.redacted,
    payloadDisposition: event.payloadDisposition,
    dataKeys: Object.keys(event.data).sort(),
    closedData: Object.fromEntries(
      Object.keys(event.data)
        .sort()
        .filter((name) =>
          !DURABLE_OPAQUE_REFERENCE_MEMBERS.has(name) && !DURABLE_POLICY_HASH_MEMBERS.has(name))
        .map((name) => [name, event.data[name]]),
    ),
  };
}

/** Every protected reference in `rawEvents`, resolved back to its value. */
function durableRecoveredValues(rawEvents, recovered) {
  const bySequence = new Map(recovered.map((event) => [event.sequence, event]));
  const values = [];
  for (const raw of rawEvents) {
    const spec = DURABLE_PROTECTED_FIELDS[raw.type];
    if (spec === undefined) continue;
    const [field, target, tagged] = spec;
    if (raw.data[field] === undefined) continue;
    const projection = bySequence.get(raw.sequence);
    assert.ok(projection, `recovered projection is missing sequence ${raw.sequence}`);
    const hydrated = projection.data[target];
    values.push({
      sequence: raw.sequence,
      type: raw.type,
      nodeId: raw.nodeId ?? null,
      field,
      value: tagged ? decodeDurableJson(hydrated) : hydrated,
    });
  }
  return values;
}

/**
 * A guarded journal that commits a batch and then loses the process. It sees
 * only the closed metadata of what it already committed — never a prepared
 * write's contents and never a payload — so it cannot be a bypass seam.
 */
class DurableCommitThenThrowJournal {
  constructor(delegate, shouldThrow) {
    this.delegate = delegate;
    this.shouldThrow = shouldThrow;
    this.threw = false;
  }

  get sink() {
    return this.delegate.sink;
  }

  get binding() {
    return this.delegate.binding;
  }

  async append(runId, expectedVersion, writes) {
    const version = await this.delegate.append(runId, expectedVersion, writes);
    const batch = await collectEvents(this.delegate.read(runId, expectedVersion + 1));
    if (!this.threw && this.shouldThrow(batch)) {
      this.threw = true;
      throw new Error("simulated process loss after durable commit");
    }
    return version;
  }

  read(runId, fromSequence = 0) {
    return this.delegate.read(runId, fromSequence);
  }
}

const durableKeys = new persistence.DeterministicTestKeyProvider();
// Section 5.1: the policy must name the key reference actually in use, or its
// hash attests to a key that is protecting nothing.
const durableCapturePolicy = Object.freeze({
  ...persistence.DEFAULT_CAPTURE_POLICY,
  keyRef: durableKeys.keyRef,
});
const durableProtection = {
  journal: new persistence.MemoryProtectedEventStore(),
  payloadStore: new persistence.MemoryProtectedPayloadStore(),
  keys: durableKeys,
  scope: DURABLE_SCOPE,
  policy: durableCapturePolicy,
};
// The process is lost immediately after the batch that commits `left`'s success
// and its outgoing edge, with `right`'s attempt still open. That is exactly the
// point at which the Python lane's executor raises out of attempt handling.
const durableCrashProtection = {
  ...durableProtection,
  journal: new DurableCommitThenThrowJournal(
    durableProtection.journal,
    (batch) => batch.some(({ type }) => type === "EdgeEmitted"),
  ),
};
await assert.rejects(
  startDurableGraphRun(durableCase.graph, durableCase.graphInput, {
    runId: durableCase.runId,
    implementationId: durableCase.implementationId,
    protection: durableCrashProtection,
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    nodeExecutors: {
      left: () => durableCase.preCrash.succeeded.output,
      // The attempt is still open when the process is lost.
      right: () => new Promise(() => {}),
      merge: () => {
        throw new Error("merge must not run before the simulated process loss");
      },
    },
  }),
  ({ code }) => code === "DURABILITY_STORE_FAILED",
  "the pre-crash execution unexpectedly completed",
);
const durableRun = new runtime.ProtectedDurableRun(durableProtection, durableCase.runId);
const beforeDurableResume = await collectEvents(
  durableProtection.journal.read(durableCase.runId),
);
const beforeDurableRecovered = [...(await durableRun.read())];
const durableCalls = [];
const durableActivityKeys = [];
let durableMergeInput;
const durableResult = await resumeDurableGraphRun(durableCase.graph, {
  runId: durableCase.runId,
  implementationId: durableCase.implementationId,
  protection: durableProtection,
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
const afterDurableResume = await collectEvents(
  durableProtection.journal.read(durableCase.runId),
);
const afterDurableRecovered = [...(await durableRun.read())];
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
  protection: durableProtection,
  now: () => new Date("2026-07-26T12:00:00.000Z"),
  executors: Object.fromEntries(
    durableCase.graph.nodes.map(({ kind }) => [kind, () => {
      terminalExecutorCalls += 1;
      throw new Error("terminal resume invoked an executor");
    }]),
  ),
});
const finalDurableHistory = await collectEvents(
  durableProtection.journal.read(durableCase.runId),
);
const durableResumeEvents = afterDurableResume.slice(beforeDurableResume.length);
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
  preCrashEnvelope: beforeDurableResume.map(durableEnvelope),
  preCrashValues: durableRecoveredValues(beforeDurableResume, beforeDurableRecovered),
  resumeEventTypes: durableResumeEvents.map(({ type }) => type),
  resumeEnvelope: durableResumeEvents.map(durableEnvelope),
  resumeValues: durableRecoveredValues(durableResumeEvents, afterDurableRecovered),
  activityKeyStable: rightSchedules.length === 2 &&
    rightSchedules[0].data.activityKey === rightSchedules[1].data.activityKey &&
    isDeepStrictEqual(durableActivityKeys, [rightSchedules[0].data.activityKey]),
  terminalResume: {
    newEvents: finalDurableHistory.length - terminalVersion,
    executorCalls: terminalExecutorCalls,
    sameResult: isDeepStrictEqual(terminalResult, durableResult),
  },
  capturePolicyModes: durableCapturePolicyModes(durableCapturePolicy),
  capturePolicyNamesTheProviderKey: durableCapturePolicy.keyRef === durableKeys.keyRef,
};

assert.deepEqual(tsDurable, pyDurable, "TypeScript/Python durable recovery reports differ");
// Section 4.2 evidence: every committed record is a guarded v1alpha2 record and
// no authoritative value survives inline in `data`.
for (const event of finalDurableHistory) {
  assert.equal(
    event.apiVersion,
    "graphengineering.reacher-z.github.io/events/v1alpha2",
    `durable event ${event.sequence} is not a guarded v1alpha2 record`,
  );
  for (const inline of ["input", "output", "result"]) {
    assert.equal(
      Object.hasOwn(event.data, inline),
      false,
      `durable event ${event.sequence} leaked an inline '${inline}' member`,
    );
  }
  const spec = DURABLE_PROTECTED_FIELDS[event.type];
  if (spec !== undefined && event.data[spec[0]] !== undefined) {
    assert.equal(
      event.payloadDisposition,
      "protected-ref",
      `durable event ${event.sequence} carries a reference without a protected-ref disposition`,
    );
  }
}
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

/**
 * OPEN: cross-language terminal durable-history interop (`D9-DURABLE-INTEROP`).
 *
 * This harness is the only one that moves a committed history *across* the
 * language boundary and resumes it, rather than running each lane natively and
 * comparing projections. Under `events/v1alpha2` that needs two things neither
 * lane ships:
 *
 *   1. a transport for the protected blobs, not just the events; and
 *   2. a way to admit an externally committed, already-guarded history into a
 *      guarded store.
 *
 * There is deliberately no such door today: `MemoryProtectedEventStore` accepts
 * only a `PreparedSinkWrite`, and Python's `GuardedMemoryEventStore(legacy_...)`
 * is a *rejection* path (`LEGACY_HISTORY_UNSAFE`), not an adoption path. Adding
 * one is the single API that would let bytes into a guarded store without a
 * guard, so it is an owner decision rather than a harness fix.
 *
 * The cases below are kept executable so that adding the capability re-enables
 * them by flipping one constant. Until then this prints on every run: it is a
 * declared gap, not a silent skip.
 */
const DURABLE_INTEROP_ADOPTION_AVAILABLE = false;

if (DURABLE_INTEROP_ADOPTION_AVAILABLE) {
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
} else {
  process.stdout.write(
    `OPEN: cross-language terminal durable-history interop is not executed for ` +
    `${durableInteropCases.length} cases. A guarded store has no way to adopt a ` +
    `foreign committed v1alpha2 history plus its protected blobs, so neither ` +
    `direction of this harness can be built. Nothing else in this run covers ` +
    `one lane consuming the other lane's durable history.\n`,
  );
}

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

// ---------------------------------------------------------------------------
// Integrated barrier cross-language join.
//
// Master plan 31.35.12 rejected the integrated-router tranche at HIGH 3 for a
// cross-language divergence — TypeScript grouped diagnostics by router while
// Python retained global edge order — that both single-language suites passed
// over. This block exists so the same defect class cannot survive in the
// barrier tranche.
//
// Neither side may read the other's expectations. The TypeScript half below is
// computed only from `@graph-engineering/core`; the Python half is computed by
// tools/conformance/python_integrated_barrier_report.py from the native
// `graph_engineering` package. The single shared input is the corpus JSON, and
// the corpus `expect` blocks are used only after the two native results have
// already been proved equal to each other.
const barrierCorpus = JSON.parse(
  await readFile(join(fixtureRoot, "integrated-barrier.case.json"), "utf8"),
);

const BARRIER_DIAGNOSTIC_CODES = [
  "GE1421_INVALID_BARRIER_POLICY",
  "GE1422_BARRIER_POLICY_KIND_MISMATCH",
  "GE1423_BARRIER_NO_INPUTS",
  "GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS",
];
const BARRIER_CODE_RANK = new Map(BARRIER_DIAGNOSTIC_CODES.map((code, rank) => [code, rank]));
const BARRIER_ROUTER_PASS_CODES = new Set([
  "GE1401_INVALID_ROUTER_POLICY",
  "GE1402_UNSUPPORTED_EDGE_CONDITION",
  "GE1403_CONDITION_SOURCE_NOT_ROUTER",
  "GE1404_ROUTE_NOT_ALLOWED",
  "GE1405_DUPLICATE_ROUTE_CASE",
  "GE1406_DUPLICATE_ROUTE_TARGET",
  "GE1407_INCOMPLETE_ROUTE_COVERAGE",
]);
const BARRIER_OPTIONAL_POLICY_FIELDS = ["minimum", "basisPoints", "quorum", "deadline"];
const BARRIER_POLICY_FIELDS = [
  "claimed",
  "valid",
  "claimsPredicate",
  "code",
  "relativePath",
  "policy",
  "policyFields",
  "policyOptionalPresent",
  "policyOptionalAbsent",
];
const BARRIER_COMPILER_FIELDS = ["valid", "graphHash", "diagnostics", "diagnosticFields"];
// The ownership probe rule, stated identically in both report halves: replace
// the config of the two-input barrier at node index 3 of this corpus graph, so
// GE1423 can never confound the ownership discriminant.
const BARRIER_PROBE_CASE = "ge1421-unknown-policy-field-reports-the-first-invalid-descendant";
const BARRIER_PROBE_NODE_INDEX = 3;

/**
 * Render a value for a divergence message with object keys sorted, so the two
 * halves are compared by the reader on content rather than on the key order
 * their respective JSON transports happened to use. Array order is preserved
 * because array order is exactly what this join is defending.
 */
function barrierStringify(value) {
  if (Array.isArray(value)) return `[${value.map(barrierStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${barrierStringify(value[key])}`)
      .join(",")}}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function barrierDivergence(section, caseName, field, tsValue, pyValue) {
  return new Error(
    `Integrated barrier cross-language divergence in ${section} case '${caseName}',`
      + ` field '${field}': TypeScript ${barrierStringify(tsValue)}`
      + ` vs Python ${barrierStringify(pyValue)}`,
  );
}

function assertBarrierAgreement(section, caseName, field, tsValue, pyValue) {
  if (!isDeepStrictEqual(tsValue, pyValue)) {
    throw barrierDivergence(section, caseName, field, tsValue, pyValue);
  }
}

/** The omit-if-absent projection rule: no absent field may become a JSON null. */
function assertBarrierNoMaterializedNull(value, label) {
  if (value === null) {
    throw new Error(
      `Integrated barrier projection defect: ${label} materializes an absent field as JSON null`,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertBarrierNoMaterializedNull(entry, `${label}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertBarrierNoMaterializedNull(entry, `${label}.${key}`);
    }
  }
}

function assertBarrierEntryAgreement(section, caseName, fields, tsEntry, pyEntry) {
  for (const field of fields) {
    const tsHas = Object.hasOwn(tsEntry, field);
    const pyHas = Object.hasOwn(pyEntry, field);
    if (tsHas !== pyHas) {
      throw barrierDivergence(
        section,
        caseName,
        field,
        tsHas ? tsEntry[field] : "<field absent>",
        pyHas ? pyEntry[field] : "<field absent>",
      );
    }
    if (tsHas) assertBarrierAgreement(section, caseName, field, tsEntry[field], pyEntry[field]);
  }
  assertBarrierAgreement(
    section,
    caseName,
    "reportedFieldSet",
    Object.keys(tsEntry).sort(),
    Object.keys(pyEntry).sort(),
  );
}

/**
 * Enumerate a corpus section and prove both halves reported every declared
 * case exactly once. A silently skipped case is the failure mode this whole
 * join exists to prevent, so absence is an error rather than a no-op.
 */
function barrierSectionNames(section, pyOrder, pyReport) {
  const cases = barrierCorpus[section];
  assert.ok(Array.isArray(cases) && cases.length > 0, `${section}: corpus declares no cases`);
  const declared = cases.map((item) => item.name);
  assert.equal(
    new Set(declared).size,
    declared.length,
    `${section}: corpus declares a duplicate case name`,
  );
  assertBarrierAgreement(section, "<section>", "declaredCaseOrder", declared, pyOrder);
  for (const name of declared) {
    if (!Object.hasOwn(pyReport, name)) {
      throw new Error(`${section}: Python skipped corpus case '${name}'`);
    }
  }
  for (const name of Object.keys(pyReport)) {
    if (!declared.includes(name)) {
      throw new Error(`${section}: Python reported case '${name}' the corpus does not declare`);
    }
  }
  assert.equal(
    Object.keys(pyReport).length,
    declared.length,
    `${section}: Python reported ${Object.keys(pyReport).length} cases for ${declared.length} declared`,
  );
  return cases;
}

function typescriptBarrierPolicyReport(config) {
  const validation = core.validateBarrierPolicy(config);
  const entry = {
    claimed: validation.claimed,
    valid: validation.valid,
    claimsPredicate: core.claimsIntegratedBarrierPolicy(config),
  };
  if (validation.valid) {
    const policy = { ...validation.policy };
    entry.policy = policy;
    entry.policyFields = Object.keys(policy);
    entry.policyOptionalPresent = BARRIER_OPTIONAL_POLICY_FIELDS
      .filter((field) => Object.hasOwn(policy, field));
    entry.policyOptionalAbsent = BARRIER_OPTIONAL_POLICY_FIELDS
      .filter((field) => !Object.hasOwn(policy, field));
  } else if (validation.claimed) {
    entry.code = validation.code;
    entry.relativePath = validation.relativePath;
  }
  return entry;
}

function projectBarrierDiagnostic(item) {
  const projected = { code: item.code };
  if (item.path !== undefined) projected.path = item.path;
  if (item.nodeIds !== undefined) projected.nodeIds = [...item.nodeIds];
  if (item.edgeId !== undefined) projected.edgeId = item.edgeId;
  return projected;
}

function typescriptBarrierCompilerReport(graph) {
  const result = core.compileGraph(graph);
  const diagnostics = result.diagnostics.map(projectBarrierDiagnostic);
  return {
    valid: result.valid,
    graphHash: result.graphHash,
    diagnostics,
    diagnosticFields: diagnostics.map((projection) => Object.keys(projection)),
  };
}

function barrierProbeGraph(base, config) {
  const document = JSON.parse(JSON.stringify(base));
  document.nodes[BARRIER_PROBE_NODE_INDEX].config = config;
  return document;
}

/** (category rank, node declaration index, code, node id) for barrier diagnostics. */
function barrierOrderWitness(diagnostics) {
  return diagnostics
    .filter((item) => BARRIER_CODE_RANK.has(item.code))
    .map((item) => {
      const match = /^#\/nodes\/(\d+)(?:\/|$)/.exec(item.path ?? "");
      if (match === null) {
        throw new Error(`barrier diagnostic ${item.code} has no node-anchored path`);
      }
      return [
        BARRIER_CODE_RANK.get(item.code),
        Number.parseInt(match[1], 10),
        item.code,
        (item.nodeIds ?? [])[0] ?? null,
      ];
    });
}

function assertBarrierEmissionOrder(language, caseName, witness) {
  for (let index = 1; index < witness.length; index += 1) {
    const [previousRank, previousNode, previousCode] = witness[index - 1];
    const [rank, node, code] = witness[index];
    if (rank < previousRank) {
      throw new Error(
        `${language} emitted ${code} after ${previousCode} in compiler case '${caseName}':`
          + " barrier categories must emit in GE1421, GE1422, GE1423, GE1424 order",
      );
    }
    if (rank === previousRank && node <= previousNode) {
      throw new Error(
        `${language} emitted ${code} at node index ${node} after node index ${previousNode}`
          + ` in compiler case '${caseName}': within a category, node declaration order is required`,
      );
    }
  }
}

function barrierCodesByNode(diagnostics) {
  const byNode = {};
  for (const item of diagnostics) {
    if (!BARRIER_CODE_RANK.has(item.code)) continue;
    for (const nodeId of item.nodeIds ?? []) {
      (byNode[nodeId] ??= []).push(item.code);
    }
  }
  return byNode;
}

function assertBarrierSuppressionChain(language, caseName, byNode) {
  for (const [nodeId, codes] of Object.entries(byNode)) {
    const present = new Set(codes);
    if (present.has("GE1421_INVALID_BARRIER_POLICY")) {
      for (const suppressed of [
        "GE1422_BARRIER_POLICY_KIND_MISMATCH",
        "GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS",
      ]) {
        if (present.has(suppressed)) {
          throw new Error(
            `${language} emitted ${suppressed} beside GE1421 on node '${nodeId}'`
              + ` in compiler case '${caseName}': GE1421 suppresses it on the same node`,
          );
        }
      }
    }
    if (present.has("GE1422_BARRIER_POLICY_KIND_MISMATCH")
        && present.has("GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS")) {
      throw new Error(
        `${language} emitted GE1424 beside GE1422 on node '${nodeId}'`
          + ` in compiler case '${caseName}': GE1422 suppresses it on the same node`,
      );
    }
  }
}

function assertBarrierRouterBeforeBarrier(language, caseName, diagnostics) {
  const routerIndexes = [];
  const barrierIndexes = [];
  diagnostics.forEach((item, index) => {
    if (BARRIER_ROUTER_PASS_CODES.has(item.code)) routerIndexes.push(index);
    if (BARRIER_CODE_RANK.has(item.code)) barrierIndexes.push(index);
  });
  if (routerIndexes.length === 0 || barrierIndexes.length === 0) return false;
  const lastRouter = Math.max(...routerIndexes);
  const firstBarrier = Math.min(...barrierIndexes);
  if (lastRouter > firstBarrier) {
    throw new Error(
      `${language} emitted a barrier diagnostic at index ${firstBarrier} before the router`
        + ` diagnostic at index ${lastRouter} in compiler case '${caseName}':`
        + " the integrated router pass must emit before the barrier pass",
    );
  }
  return true;
}

const pythonBarrier = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_integrated_barrier_report.py"],
  { cwd: root, encoding: "utf8" },
);
if (pythonBarrier.status !== 0) {
  throw new Error(
    `Python integrated barrier conformance failed:\n${pythonBarrier.stderr || pythonBarrier.stdout}`,
  );
}
const pyBarrierReport = JSON.parse(pythonBarrier.stdout);

assert.equal(
  pyBarrierReport.contract,
  barrierCorpus.contract,
  "integrated barrier: the two halves read different corpus contracts",
);
assertBarrierAgreement(
  "corpus",
  "<contract>",
  "diagnosticCodes",
  barrierCorpus.diagnosticCodes,
  pyBarrierReport.diagnosticCodes,
);
assertBarrierAgreement(
  "corpus",
  "<contract>",
  "diagnosticCodes",
  BARRIER_DIAGNOSTIC_CODES,
  barrierCorpus.diagnosticCodes,
);
assertBarrierAgreement(
  "corpus",
  "<contract>",
  "ownershipProbe",
  { case: BARRIER_PROBE_CASE, nodeIndex: BARRIER_PROBE_NODE_INDEX },
  pyBarrierReport.ownershipProbe,
);

// The four claim flags are literally false on both sides. Each process read
// them from the corpus itself, so this is a two-reader assertion rather than a
// restatement of one read.
const barrierClaimNames = [
  "implementationClaim",
  "typescriptRuntimeClaim",
  "pythonRuntimeClaim",
  "capabilityGateClaim",
];
assertBarrierAgreement(
  "claims",
  "<claims>",
  "flagNames",
  [...barrierClaimNames].sort(),
  Object.keys(pyBarrierReport.claims).sort(),
);
assertBarrierAgreement(
  "claims",
  "<claims>",
  "flagNames",
  [...barrierClaimNames].sort(),
  Object.keys(barrierCorpus.claims).sort(),
);
for (const flag of barrierClaimNames) {
  assert.strictEqual(
    barrierCorpus.claims[flag],
    false,
    `integrated barrier claim '${flag}' is not literally false in the Node-side read`,
  );
  assert.strictEqual(
    pyBarrierReport.claims[flag],
    false,
    `integrated barrier claim '${flag}' is not literally false in the Python-side read`,
  );
}
assert.strictEqual(
  barrierCorpus.implementationClaim,
  false,
  "integrated barrier implementationClaim is not literally false",
);

const barrierPolicyCases = barrierSectionNames(
  "policyCases",
  pyBarrierReport.policyCaseOrder,
  pyBarrierReport.policyCases,
);
for (const testCase of barrierPolicyCases) {
  const tsEntry = typescriptBarrierPolicyReport(testCase.config);
  const pyEntry = pyBarrierReport.policyCases[testCase.name];
  assertBarrierEntryAgreement("policyCases", testCase.name, BARRIER_POLICY_FIELDS, tsEntry, pyEntry);
  assertBarrierNoMaterializedNull(tsEntry, `policyCases '${testCase.name}' TypeScript`);
  assertBarrierNoMaterializedNull(pyEntry, `policyCases '${testCase.name}' Python`);

  // Only after the two native halves agree is the corpus expectation consulted.
  const expectation = testCase.expect;
  for (const [language, entry] of [["TypeScript", tsEntry], ["Python", pyEntry]]) {
    assert.equal(entry.claimed, expectation.claimed, `${testCase.name}: ${language} claimed`);
    assert.equal(entry.valid, expectation.valid, `${testCase.name}: ${language} valid`);
    assert.equal(
      entry.claimsPredicate,
      expectation.claimed,
      `${testCase.name}: ${language} ownership discriminator`,
    );
    if (expectation.valid) {
      assert.deepEqual(entry.policy, expectation.policy, `${testCase.name}: ${language} policy`);
    } else if (expectation.claimed) {
      assert.equal(entry.code, expectation.code, `${testCase.name}: ${language} diagnostic code`);
      assert.equal(
        entry.relativePath,
        expectation.relativePath,
        `${testCase.name}: ${language} relative path`,
      );
    } else {
      assert.ok(!Object.hasOwn(entry, "code"), `${testCase.name}: ${language} unclaimed code`);
      assert.ok(
        !Object.hasOwn(entry, "relativePath"),
        `${testCase.name}: ${language} unclaimed relative path`,
      );
    }
  }
}
const barrierValidPolicyCases = barrierPolicyCases.filter((item) => item.expect.valid === true);
assert.ok(barrierValidPolicyCases.length > 0, "policyCases: no valid policy snapshot compared");

const barrierProbeBase = barrierCorpus.compilerCases
  .find((item) => item.name === BARRIER_PROBE_CASE);
assert.ok(barrierProbeBase !== undefined, `corpus is missing probe case '${BARRIER_PROBE_CASE}'`);

const barrierOwnershipCases = barrierSectionNames(
  "ownershipCases",
  pyBarrierReport.ownershipCaseOrder,
  pyBarrierReport.ownershipCases,
);
for (const testCase of barrierOwnershipCases) {
  const validation = core.validateBarrierPolicy(testCase.config);
  const tsEntry = {
    claimed: validation.claimed,
    claimsPredicate: core.claimsIntegratedBarrierPolicy(testCase.config),
    diagnostics: validation.valid || !validation.claimed
      ? []
      : [{ code: validation.code, relativePath: validation.relativePath }],
    probe: typescriptBarrierCompilerReport(
      barrierProbeGraph(barrierProbeBase.graph, testCase.config),
    ),
  };
  const pyEntry = pyBarrierReport.ownershipCases[testCase.name];
  assertBarrierEntryAgreement(
    "ownershipCases",
    testCase.name,
    ["claimed", "claimsPredicate", "diagnostics"],
    tsEntry,
    pyEntry,
  );
  assertBarrierEntryAgreement(
    "ownershipCases probe",
    testCase.name,
    BARRIER_COMPILER_FIELDS,
    tsEntry.probe,
    pyEntry.probe,
  );
  assertBarrierNoMaterializedNull(tsEntry, `ownershipCases '${testCase.name}' TypeScript`);
  assertBarrierNoMaterializedNull(pyEntry, `ownershipCases '${testCase.name}' Python`);

  const expectation = testCase.expect;
  const probeDiagnostics = expectation.diagnostics.map((item) => ({
    code: item.code,
    path: `#/nodes/${BARRIER_PROBE_NODE_INDEX}/config${item.relativePath}`,
    nodeIds: [barrierProbeBase.graph.nodes[BARRIER_PROBE_NODE_INDEX].id],
  }));
  for (const [language, entry] of [["TypeScript", tsEntry], ["Python", pyEntry]]) {
    assert.equal(entry.claimed, expectation.claimed, `${testCase.name}: ${language} claimed`);
    assert.equal(
      entry.claimsPredicate,
      expectation.claimed,
      `${testCase.name}: ${language} ownership discriminator`,
    );
    assert.deepEqual(
      entry.diagnostics,
      expectation.diagnostics,
      `${testCase.name}: ${language} ownership diagnostics`,
    );
    assert.deepEqual(
      entry.probe.diagnostics,
      probeDiagnostics,
      `${testCase.name}: ${language} ownership diagnostics through the real compiler`,
    );
  }
}

const barrierCompilerCases = barrierSectionNames(
  "compilerCases",
  pyBarrierReport.compilerCaseOrder,
  pyBarrierReport.compilerCases,
);
let barrierOrderedDiagnostics = 0;
let barrierMultiDiagnosticCases = 0;
let barrierRouterOrderWitnesses = 0;
let barrierSuppressionWitnesses = 0;
const barrierCategoriesSeen = new Set();
for (const testCase of barrierCompilerCases) {
  const tsEntry = typescriptBarrierCompilerReport(testCase.graph);
  const pyEntry = pyBarrierReport.compilerCases[testCase.name];

  // The HIGH-3 axis: the complete ordered diagnostic list, never a set.
  assertBarrierEntryAgreement(
    "compilerCases",
    testCase.name,
    BARRIER_COMPILER_FIELDS,
    tsEntry,
    pyEntry,
  );
  assertBarrierNoMaterializedNull(tsEntry, `compilerCases '${testCase.name}' TypeScript`);
  assertBarrierNoMaterializedNull(pyEntry, `compilerCases '${testCase.name}' Python`);

  const tsWitness = barrierOrderWitness(tsEntry.diagnostics);
  const pyWitness = barrierOrderWitness(pyEntry.diagnostics);
  assertBarrierAgreement("compilerCases", testCase.name, "emissionOrder", tsWitness, pyWitness);
  assertBarrierEmissionOrder("TypeScript", testCase.name, tsWitness);
  assertBarrierEmissionOrder("Python", testCase.name, pyWitness);
  if (tsEntry.diagnostics.length > 1) barrierMultiDiagnosticCases += 1;
  barrierOrderedDiagnostics += tsEntry.diagnostics.length;
  for (const [, , code] of tsWitness) barrierCategoriesSeen.add(code);

  const tsByNode = barrierCodesByNode(tsEntry.diagnostics);
  const pyByNode = barrierCodesByNode(pyEntry.diagnostics);
  assertBarrierAgreement("compilerCases", testCase.name, "codesByNode", tsByNode, pyByNode);
  assertBarrierSuppressionChain("TypeScript", testCase.name, tsByNode);
  assertBarrierSuppressionChain("Python", testCase.name, pyByNode);

  if (assertBarrierRouterBeforeBarrier("TypeScript", testCase.name, tsEntry.diagnostics)) {
    barrierRouterOrderWitnesses += 1;
  }
  assertBarrierRouterBeforeBarrier("Python", testCase.name, pyEntry.diagnostics);

  for (const [language, entry] of [["TypeScript", tsEntry], ["Python", pyEntry]]) {
    assert.equal(
      entry.graphHash,
      testCase.graphHash,
      `${testCase.name}: ${language} literal graph hash`,
    );
    assert.deepEqual(
      entry.diagnostics,
      testCase.expectDiagnostics,
      `${testCase.name}: ${language} ordered diagnostic projection`,
    );
    assert.equal(entry.valid, testCase.expectValid, `${testCase.name}: ${language} validity`);
  }
}

// The suppression chain is asserted on every compiler case above; these three
// named cases are the positive witnesses that the chain is exercised at all,
// including the one link that must NOT suppress.
for (const [name, expectedCodes] of [
  [
    "ge1421-suppresses-ge1422-and-ge1424-on-the-same-node-only",
    ["GE1421_INVALID_BARRIER_POLICY", "GE1422_BARRIER_POLICY_KIND_MISMATCH"],
  ],
  ["ge1422-suppresses-ge1424-on-the-same-node", ["GE1422_BARRIER_POLICY_KIND_MISMATCH"]],
  [
    "ge1421-does-not-suppress-ge1423-on-the-same-node",
    ["GE1421_INVALID_BARRIER_POLICY", "GE1423_BARRIER_NO_INPUTS"],
  ],
]) {
  const testCase = barrierCompilerCases.find((item) => item.name === name);
  assert.ok(testCase !== undefined, `compilerCases: corpus is missing suppression witness '${name}'`);
  const tsCodes = typescriptBarrierCompilerReport(testCase.graph).diagnostics.map((i) => i.code);
  const pyCodes = pyBarrierReport.compilerCases[name].diagnostics.map((item) => item.code);
  assertBarrierAgreement("suppression chain", name, "codes", tsCodes, pyCodes);
  assert.deepEqual(tsCodes, expectedCodes, `${name}: TypeScript suppression chain`);
  assert.deepEqual(pyCodes, expectedCodes, `${name}: Python suppression chain`);
  barrierSuppressionWitnesses += 1;
}
assert.equal(barrierSuppressionWitnesses, 3, "the suppression chain is not fully witnessed");
assert.ok(
  barrierRouterOrderWitnesses > 0,
  "no compiler case witnesses the router pass emitting before the barrier pass",
);
assert.ok(
  barrierMultiDiagnosticCases > 0,
  "no compiler case emits more than one diagnostic, so emission order is unwitnessed",
);
assertBarrierAgreement(
  "compilerCases",
  "<categories>",
  "categoriesExercised",
  BARRIER_DIAGNOSTIC_CODES,
  [...barrierCategoriesSeen].sort(),
);

// ---------------------------------------------------------------------------
// Integrated barrier tranche 2: evaluation, identity, replay, identifiers.
//
// Tranche 1 above joins the compile-time surface. Tranche 2 joins the surface
// both runtimes now execute, where the failure mode is worse than a diagnostic
// ordering defect: if the two languages disagree on satisfaction arithmetic or
// on a decision identity, a decision one runtime commits is one the other
// rejects on replay, and a resumed run diverges silently.
//
// The same discipline applies as above. The TypeScript half is computed only
// from `@graph-engineering/core` and `@graph-engineering/runtime`; the Python
// half arrives in the same report process that already served tranche 1 and is
// computed only from `graph_engineering`. Every hash on both sides is
// recomputed from the framing rule in `hashContract`; neither half reads a
// literal out of the other's output, and neither reads the corpus `expect`
// block until the two native halves have already been proved equal.
const BARRIER_DECISION_COUNT_FIELDS = [
  "total",
  "succeeded",
  "failed",
  "missing",
  "timedOut",
  "abstained",
  "unknown",
];
const BARRIER_DECISION_ID_LIST_FIELDS = [
  "acceptedIds",
  "failedIds",
  "missingIds",
  "timedOutIds",
  "abstainedIds",
  "unknownIds",
];
// The evaluation surface owns neither hash; a decision document member it
// materialized would mean it invented an identity it cannot compute.
const BARRIER_DECISION_IDENTITY_FIELDS = ["policyHash", "decisionId"];
const BARRIER_EVALUATION_FIELDS = [
  "document",
  "documentFields",
  "barrierNodeId",
  "deadlineElapsed",
  "satisfied",
  "reasonCode",
  "resolution",
  "counts",
  "idLists",
  "votesPresent",
  "countSum",
  "votes",
  "voteFields",
];
const BARRIER_IDENTITY_FIELDS = [
  "documentKind",
  "policyKindTag",
  "decisionDomain",
  "policyHash",
  "decisionId",
  "recordedPolicyHash",
  "recordedDecisionId",
  "canonicalPolicyUtf8Bytes",
  "canonicalDocumentWithoutDecisionIdUtf8Bytes",
  "documentFieldsWithoutDecisionId",
  "evidenceHashes",
  "canonicalEvidenceKeyOrder",
];
const BARRIER_REPLAY_FIELDS = [
  "outcome",
  "adoptedNodeIds",
  "appendedDecisionEvents",
  "executorCalls",
  "executedNodeIds",
  "currentPolicyHashes",
  "recomputedDecisionIds",
  "recordedPolicyHashes",
  "recordedDecisionIds",
  "code",
  "nodeId",
  "recordedPolicyHash",
  "currentPolicyHash",
  "recordedDecisionId",
  "recomputedDecisionId",
];
const BARRIER_IDENTIFIER_FIELDS = [
  "documentKind",
  "path",
  "value",
  "controlValid",
  "valid",
  "mutatedDocument",
];
const BARRIER_REPLAY_SOURCE_NODES = ["a", "b", "c"];

// The five domain-separation constants, read from the TypeScript package rather
// than from the corpus, so the join compares two native reads.
const barrierIdentityDomains = {
  policyHashDomain: core.POLICY_HASH_DOMAIN,
  barrierDecisionDomain: core.BARRIER_DECISION_DOMAIN,
  routeDecisionDomain: core.ROUTE_DECISION_DOMAIN,
  barrierPolicyKindTag: "barrier",
  routerPolicyKindTag: "router",
};
assertBarrierAgreement(
  "identityDomains",
  "<hashContract>",
  "domainSeparation",
  barrierIdentityDomains,
  pyBarrierReport.identityDomains,
);
assert.equal(
  barrierIdentityDomains.policyHashDomain,
  barrierCorpus.hashContract.policyHashDomain,
  "identityDomains: policy hash domain differs from the corpus contract",
);
assert.equal(
  barrierIdentityDomains.barrierDecisionDomain,
  barrierCorpus.hashContract.barrierDecisionDomain,
  "identityDomains: barrier decision domain differs from the corpus contract",
);
assert.equal(
  barrierIdentityDomains.routeDecisionDomain,
  barrierCorpus.hashContract.routeDecisionDomain,
  "identityDomains: route decision domain differs from the corpus contract",
);
assert.deepEqual(
  [barrierIdentityDomains.barrierPolicyKindTag, barrierIdentityDomains.routerPolicyKindTag],
  barrierCorpus.hashContract.policyKindTags,
  "identityDomains: policy kind tags differ from the corpus contract",
);

/** Deep-copy a frozen native result into a plain JSON document, key order kept. */
function barrierPlainDocument(value) {
  return JSON.parse(JSON.stringify(value));
}

function typescriptBarrierEvaluationReport(testCase) {
  const validation = core.validateBarrierPolicy(testCase.policy);
  assert.ok(validation.valid, `${testCase.name}: corpus policy is not a valid barrier policy`);
  const arrivals = testCase.dispositions.map((entry) => {
    if (!Object.hasOwn(entry, "vote")) {
      return { sourceNodeId: entry.sourceNodeId, disposition: entry.disposition };
    }
    const ballot = core.validateBarrierVote(entry.vote);
    assert.ok(
      ballot.valid,
      `${testCase.name}: corpus ballot for '${entry.sourceNodeId}' is malformed`,
    );
    return {
      sourceNodeId: entry.sourceNodeId,
      disposition: entry.disposition,
      vote: ballot.vote,
    };
  });
  const document = barrierPlainDocument(core.evaluateIntegratedBarrier(
    validation.policy,
    testCase.barrierNodeId,
    arrivals,
  ));
  for (const field of BARRIER_DECISION_IDENTITY_FIELDS) {
    assert.ok(
      !Object.hasOwn(document, field),
      `${testCase.name}: the evaluation surface materialized '${field}'`,
    );
  }
  const entry = {
    document,
    // Emitted separately because the Python transport sorts object keys; this
    // is how the two halves are proved to agree on member order too.
    documentFields: Object.keys(document),
    barrierNodeId: document.barrierNodeId,
    deadlineElapsed: document.deadlineElapsed,
    satisfied: document.satisfied,
    reasonCode: document.reasonCode,
    resolution: document.resolution,
    counts: Object.fromEntries(BARRIER_DECISION_COUNT_FIELDS.map((f) => [f, document[f]])),
    idLists: Object.fromEntries(BARRIER_DECISION_ID_LIST_FIELDS.map((f) => [f, document[f]])),
    votesPresent: Object.hasOwn(document, "votes"),
    // The six dispositions partition the arrivals, so they sum to `total`.
    countSum: BARRIER_DECISION_COUNT_FIELDS.slice(1).reduce((sum, f) => sum + document[f], 0),
  };
  if (entry.votesPresent) {
    entry.votes = document.votes;
    entry.voteFields = document.votes.map((record) => Object.keys(record));
  }
  return entry;
}

function typescriptBarrierIdentityReport(testCase) {
  const kind = testCase.documentKind;
  const document = testCase.document;
  const { decisionId: _recordedDecisionId, ...withoutIdentity } = document;
  const context = {
    runId: testCase.runId,
    graphRevision: testCase.graphRevision,
    nodeId: testCase.nodeId,
  };
  let policyKindTag;
  let decisionDomain;
  let decisionId;
  if (kind === "BarrierDecision") {
    policyKindTag = barrierIdentityDomains.barrierPolicyKindTag;
    decisionDomain = barrierIdentityDomains.barrierDecisionDomain;
    decisionId = core.barrierDecisionId(context, document);
  } else if (kind === "RouteDecision") {
    policyKindTag = barrierIdentityDomains.routerPolicyKindTag;
    decisionDomain = barrierIdentityDomains.routeDecisionDomain;
    decisionId = core.routeDecisionId(context, document);
  } else {
    throw new Error(`${testCase.name}: unknown decision document kind '${kind}'`);
  }
  const entry = {
    documentKind: kind,
    policyKindTag,
    decisionDomain,
    policyHash: core.decisionPolicyHash(policyKindTag, testCase.policy),
    decisionId,
    // Echoed so the join can prove each half recomputed the document it was
    // actually handed, rather than a document of its own construction.
    recordedPolicyHash: document.policyHash,
    recordedDecisionId: document.decisionId,
    canonicalPolicyUtf8Bytes: Buffer.byteLength(core.canonicalSerialize(testCase.policy), "utf8"),
    canonicalDocumentWithoutDecisionIdUtf8Bytes: Buffer.byteLength(
      core.canonicalSerialize(withoutIdentity),
      "utf8",
    ),
    documentFieldsWithoutDecisionId: Object.keys(withoutIdentity),
  };
  if (Object.hasOwn(testCase, "evidenceInputs")) {
    entry.evidenceHashes = testCase.evidenceInputs.map((item) => ({
      sourceNodeId: item.sourceNodeId,
      evidenceHash: core.canonicalHash(item.evidence),
    }));
  }
  if (Object.hasOwn(testCase, "canonicalEvidenceKeyOrder")) {
    entry.canonicalEvidenceKeyOrder = Object.keys(
      JSON.parse(core.canonicalSerialize(testCase.evidenceInputs[0].evidence)),
    );
  }
  return entry;
}

function barrierReplayNode(id, overrides = {}) {
  return { id, kind: "transform", inputSchema: {}, outputSchema: {}, config: {}, ...overrides };
}

/**
 * A graph carrying exactly the replay case's currently compiled policies, so
 * `runGraph` exercises the real scheduler rather than the fold in isolation.
 * Three upstreams keep every corpus threshold within the incoming-edge count,
 * so GE1424 never fires and the graph always compiles.
 */
function barrierReplayGraph(testCase) {
  const entries = Object.entries(testCase.currentPolicies);
  const barriers = entries.filter(
    ([, config]) => config.apiVersion === core.INTEGRATED_BARRIER_API_VERSION,
  );
  const routers = entries.filter(
    ([, config]) => config.apiVersion !== core.INTEGRATED_BARRIER_API_VERSION,
  );
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "integrated-barrier-replay", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["root"],
    outputs: { result: { node: "root" } },
    nodes: [
      barrierReplayNode("root"),
      ...BARRIER_REPLAY_SOURCE_NODES.map((id) => barrierReplayNode(id)),
      ...routers.map(([id, config]) => barrierReplayNode(id, { kind: "router", config })),
      ...routers.flatMap(([id, config]) =>
        config.allowedRoutes.map((route) => barrierReplayNode(`${id}-${route}`))),
      ...barriers.map(([id, config]) => barrierReplayNode(id, { kind: "barrier", config })),
    ],
    edges: [
      ...BARRIER_REPLAY_SOURCE_NODES.map((id) => ({
        id: `root-${id}`,
        from: { node: "root" },
        to: { node: id, port: id },
      })),
      ...routers.map(([id]) => ({ id: `root-${id}`, from: { node: "root" }, to: { node: id } })),
      // GE1407 requires every allowed route to carry a case.
      ...routers.flatMap(([id, config]) =>
        config.allowedRoutes.map((route) => ({
          id: `${id}-${route}`,
          from: { node: id },
          to: { node: `${id}-${route}` },
          condition: {
            apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
            kind: "RouteEquals",
            routeKey: route,
          },
        }))),
      ...barriers.flatMap(([id]) => BARRIER_REPLAY_SOURCE_NODES.map((source) => ({
        id: `${source}-${id}`,
        from: { node: source },
        to: { node: id, port: source },
      }))),
    ],
  };
}

/**
 * The TypeScript replay half.
 *
 * `entry` is the comparable projection: it is produced by the same rule the
 * Python report states, so the two halves can be compared member for member.
 * `scheduler` is a TypeScript-only strengthening — the authentic executor call
 * count and appended-event count observed by driving the real `runGraph` with
 * a spy executor on every policy-carrying node. Python has no scheduler surface
 * that accepts committed decisions, so only TypeScript can measure that; both
 * must still be zero.
 */
async function typescriptBarrierReplayReport(testCase) {
  const currentPolicies = new Map(Object.entries(testCase.currentPolicies));
  const context = { runId: testCase.runId, graphRevision: testCase.graphRevision };
  const adoption = runtime.adoptCommittedDecisions(testCase.history, currentPolicies, context);
  const adoptedNodeIds = adoption.outcome === "adopted"
    ? adoption.decisions.map((item) => item.nodeId)
    : [];

  // The executor-ledger rule, stated identically in the Python half: a
  // rejection is a non-retryable run failure, so no node runs at all; on
  // adoption, a node whose decision was adopted MUST NOT be re-evaluated, and
  // only a policy-carrying node without an adopted decision reaches an executor.
  const executedNodeIds = [];
  if (adoption.outcome === "adopted") {
    const adopted = new Set(adoptedNodeIds);
    for (const nodeId of currentPolicies.keys()) {
      if (!adopted.has(nodeId)) executedNodeIds.push(nodeId);
    }
  }

  const spiedNodeIds = [];
  const nodeExecutors = { a: () => "ok", b: () => "ok", c: () => "ok" };
  for (const nodeId of currentPolicies.keys()) {
    nodeExecutors[nodeId] = () => {
      spiedNodeIds.push(nodeId);
      return "must-not-run";
    };
  }
  const scheduled = await runtime.runGraph(barrierReplayGraph(testCase), {}, {
    decision: context,
    committedDecisions: testCase.history,
    nodeExecutors,
  });
  const appendedDecisionEvents = (scheduled.decisionEvents ?? []).length;

  const identityOf = (event) => (event.type === "BarrierSatisfied"
    ? core.barrierDecisionId({ ...context, nodeId: event.nodeId }, event.data)
    : core.routeDecisionId({ ...context, nodeId: event.nodeId }, event.data));
  const policyHashOf = (event) => core.decisionPolicyHash(
    event.type === "BarrierSatisfied"
      ? barrierIdentityDomains.barrierPolicyKindTag
      : barrierIdentityDomains.routerPolicyKindTag,
    currentPolicies.get(event.nodeId),
  );

  const entry = {
    outcome: adoption.outcome,
    adoptedNodeIds,
    appendedDecisionEvents,
    executorCalls: executedNodeIds.length,
    executedNodeIds,
    // Recomputed natively for every event in the history whatever the outcome:
    // this is what makes a forked child run recompute its own identity instead
    // of inheriting its parent's.
    currentPolicyHashes: Object.fromEntries(testCase.history
      .filter((event) => currentPolicies.has(event.nodeId))
      .map((event) => [event.nodeId, policyHashOf(event)])),
    recomputedDecisionIds: Object.fromEntries(testCase.history
      .map((event) => [event.nodeId, identityOf(event)])),
    recordedPolicyHashes: Object.fromEntries(testCase.history
      .map((event) => [event.nodeId, event.data.policyHash])),
    recordedDecisionIds: Object.fromEntries(testCase.history
      .map((event) => [event.nodeId, event.data.decisionId])),
  };
  if (adoption.outcome === "rejected") {
    const { rejection } = adoption;
    entry.code = rejection.code;
    entry.nodeId = rejection.nodeId;
    // Absent members are omitted rather than materialized as JSON null.
    for (const field of [
      "recordedPolicyHash",
      "currentPolicyHash",
      "recordedDecisionId",
      "recomputedDecisionId",
    ]) {
      if (Object.hasOwn(rejection, field)) entry[field] = rejection[field];
    }
  }
  return { entry, scheduler: { status: scheduled.status, spiedNodeIds } };
}

/** Replace exactly one JSON-pointer slot in a deep copy of a base document. */
function barrierApplyPointer(document, pointer, value) {
  assert.ok(pointer.startsWith("/"), `identifier path '${pointer}' is not a JSON pointer`);
  const tokens = pointer.slice(1).split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
  const mutated = JSON.parse(JSON.stringify(document));
  let cursor = mutated;
  for (const token of tokens.slice(0, -1)) {
    cursor = Array.isArray(cursor) ? cursor[Number.parseInt(token, 10)] : cursor[token];
  }
  const last = tokens[tokens.length - 1];
  if (Array.isArray(cursor)) cursor[Number.parseInt(last, 10)] = value;
  else cursor[last] = value;
  return mutated;
}

function typescriptBarrierIdentifierReport(testCase, baseDocuments) {
  const kind = testCase.documentKind;
  const base = baseDocuments[kind];
  const mutated = barrierApplyPointer(base, testCase.path, testCase.value);
  return {
    documentKind: kind,
    path: testCase.path,
    value: testCase.value,
    // The unmutated base must be accepted, or the case proves nothing.
    controlValid: core.decisionDocumentIdentifierIssues(kind, base).length === 0,
    valid: core.decisionDocumentIdentifierIssues(kind, mutated).length === 0,
    mutatedDocument: mutated,
  };
}

const barrierEvaluationCases = barrierSectionNames(
  "evaluationCases",
  pyBarrierReport.evaluationCaseOrder,
  pyBarrierReport.evaluationCases,
);
const barrierReasonCodesSeen = new Set();
const barrierResolutionsSeen = new Set();
let barrierCensusCases = 0;
let barrierCensusRecords = 0;
for (const testCase of barrierEvaluationCases) {
  const tsEntry = typescriptBarrierEvaluationReport(testCase);
  const pyEntry = pyBarrierReport.evaluationCases[testCase.name];
  assertBarrierEntryAgreement(
    "evaluationCases",
    testCase.name,
    BARRIER_EVALUATION_FIELDS,
    tsEntry,
    pyEntry,
  );
  assertBarrierNoMaterializedNull(tsEntry, `evaluationCases '${testCase.name}' TypeScript`);
  assertBarrierNoMaterializedNull(pyEntry, `evaluationCases '${testCase.name}' Python`);

  // Only after the two native halves agree is the corpus expectation consulted.
  for (const [language, entry] of [["TypeScript", tsEntry], ["Python", pyEntry]]) {
    assert.deepEqual(
      entry.document,
      testCase.expect,
      `${testCase.name}: ${language} decision document`,
    );
    assert.equal(
      entry.countSum,
      entry.counts.total,
      `${testCase.name}: ${language} counts do not partition the arrivals`,
    );
    assert.equal(
      entry.votesPresent,
      testCase.policy.kind === "quorum",
      `${testCase.name}: ${language} census presence is not keyed on the quorum kind`,
    );
    for (const field of BARRIER_DECISION_ID_LIST_FIELDS) {
      assert.deepEqual(
        entry.idLists[field],
        testCase.expect[field],
        `${testCase.name}: ${language} ${field} in declaration order`,
      );
    }
    assert.equal(
      entry.deadlineElapsed,
      entry.idLists.timedOutIds.length > 0,
      `${testCase.name}: ${language} deadlineElapsed is not exactly the timed_out presence`,
    );
  }
  barrierReasonCodesSeen.add(tsEntry.reasonCode);
  barrierResolutionsSeen.add(tsEntry.resolution);
  if (tsEntry.votesPresent) {
    barrierCensusCases += 1;
    barrierCensusRecords += tsEntry.votes.length;
  }
}
assertBarrierAgreement(
  "evaluationCases",
  "<coverage>",
  "reasonCodesExercised",
  [...barrierCorpus.vocabulary.reasonCodes].sort(),
  [...barrierReasonCodesSeen].sort(),
);
assertBarrierAgreement(
  "evaluationCases",
  "<coverage>",
  "resolutionsExercised",
  [...barrierCorpus.vocabulary.resolutions].sort(),
  [...barrierResolutionsSeen].sort(),
);
assert.ok(barrierCensusCases > 0, "evaluationCases: no quorum census was compared");

const barrierIdentityCases = barrierSectionNames(
  "identityCases",
  pyBarrierReport.identityCaseOrder,
  pyBarrierReport.identityCases,
);
let barrierIdentityBarrierDocuments = 0;
let barrierIdentityRouteDocuments = 0;
for (const testCase of barrierIdentityCases) {
  const tsEntry = typescriptBarrierIdentityReport(testCase);
  const pyEntry = pyBarrierReport.identityCases[testCase.name];
  assertBarrierEntryAgreement(
    "identityCases",
    testCase.name,
    BARRIER_IDENTITY_FIELDS,
    tsEntry,
    pyEntry,
  );
  assertBarrierNoMaterializedNull(
    { ...tsEntry, mutatedDocument: undefined },
    `identityCases '${testCase.name}' TypeScript`,
  );

  for (const [language, entry] of [["TypeScript", tsEntry], ["Python", pyEntry]]) {
    assert.equal(
      entry.policyKindTag,
      testCase.policyKindTag,
      `${testCase.name}: ${language} policy kind tag`,
    );
    assert.equal(
      entry.decisionDomain,
      testCase.decisionDomain,
      `${testCase.name}: ${language} decision domain`,
    );
    assert.equal(
      entry.policyHash,
      testCase.expect.policyHash,
      `${testCase.name}: ${language} recomputed policyHash`,
    );
    assert.equal(
      entry.decisionId,
      testCase.expect.decisionId,
      `${testCase.name}: ${language} recomputed decisionId`,
    );
    // The document literal in the corpus must itself recompute, or the corpus
    // carries a decision neither runtime could have committed.
    assert.equal(
      entry.recordedPolicyHash,
      entry.policyHash,
      `${testCase.name}: ${language} recorded policyHash does not recompute`,
    );
    assert.equal(
      entry.recordedDecisionId,
      entry.decisionId,
      `${testCase.name}: ${language} recorded decisionId does not recompute`,
    );
    assert.equal(
      entry.canonicalPolicyUtf8Bytes,
      testCase.expect.canonicalPolicyUtf8Bytes,
      `${testCase.name}: ${language} canonical policy byte length`,
    );
    assert.equal(
      entry.canonicalDocumentWithoutDecisionIdUtf8Bytes,
      testCase.expect.canonicalDocumentWithoutDecisionIdUtf8Bytes,
      `${testCase.name}: ${language} canonical document byte length`,
    );
    if (Object.hasOwn(testCase, "evidenceInputs")) {
      assert.deepEqual(
        entry.evidenceHashes,
        testCase.evidenceInputs.map((item) => ({
          sourceNodeId: item.sourceNodeId,
          evidenceHash: item.evidenceHash,
        })),
        `${testCase.name}: ${language} recomputed evidence hashes`,
      );
    }
    if (Object.hasOwn(testCase, "canonicalEvidenceKeyOrder")) {
      assert.deepEqual(
        entry.canonicalEvidenceKeyOrder,
        testCase.canonicalEvidenceKeyOrder,
        `${testCase.name}: ${language} canonical evidence key order`,
      );
    }
  }
  if (tsEntry.documentKind === "BarrierDecision") barrierIdentityBarrierDocuments += 1;
  else barrierIdentityRouteDocuments += 1;
}
assert.ok(
  barrierIdentityBarrierDocuments > 0 && barrierIdentityRouteDocuments > 0,
  "identityCases: both decision families must be witnessed",
);
// Framing is what makes concatenation injective: two cases whose run ID and
// graph revision concatenate to the same bytes must still hash differently.
const barrierFramingGroups = new Map();
for (const testCase of barrierIdentityCases) {
  if (!Object.hasOwn(testCase, "naiveConcatenationGroup")) continue;
  const group = barrierFramingGroups.get(testCase.naiveConcatenationGroup) ?? [];
  group.push(testCase);
  barrierFramingGroups.set(testCase.naiveConcatenationGroup, group);
}
let barrierFramingWitnesses = 0;
for (const [group, members] of barrierFramingGroups) {
  assert.equal(members.length, 2, `identityCases: framing group '${group}' is not a pair`);
  const [left, right] = members;
  assert.equal(
    `${left.runId}${left.graphRevision}`,
    `${right.runId}${right.graphRevision}`,
    `identityCases: framing group '${group}' does not collide under naive concatenation`,
  );
  for (const [language, report] of [
    ["TypeScript", (item) => typescriptBarrierIdentityReport(item).decisionId],
    ["Python", (item) => pyBarrierReport.identityCases[item.name].decisionId],
  ]) {
    assert.notEqual(
      report(left),
      report(right),
      `identityCases: ${language} framing group '${group}' collides`,
    );
  }
  barrierFramingWitnesses += 1;
}
assert.ok(barrierFramingWitnesses > 0, "identityCases: framing is unwitnessed");

const barrierReplayCases = barrierSectionNames(
  "replayCases",
  pyBarrierReport.replayCaseOrder,
  pyBarrierReport.replayCases,
);
const barrierReplayCodesSeen = new Set();
let barrierReplayAdoptions = 0;
for (const testCase of barrierReplayCases) {
  const { entry: tsEntry, scheduler } = await typescriptBarrierReplayReport(testCase);
  const pyEntry = pyBarrierReport.replayCases[testCase.name];
  assertBarrierEntryAgreement(
    "replayCases",
    testCase.name,
    BARRIER_REPLAY_FIELDS,
    tsEntry,
    pyEntry,
  );
  assertBarrierNoMaterializedNull(tsEntry, `replayCases '${testCase.name}' TypeScript`);
  assertBarrierNoMaterializedNull(pyEntry, `replayCases '${testCase.name}' Python`);

  // The authentic scheduler observation, which only TypeScript can make.
  assert.deepEqual(
    scheduler.spiedNodeIds,
    [],
    `${testCase.name}: the real scheduler called an executor for a node with a committed decision`,
  );
  assert.equal(
    scheduler.status,
    testCase.expect.outcome === "adopted" ? "succeeded" : "failed",
    `${testCase.name}: the real scheduler run status`,
  );

  const expectation = testCase.expect;
  assert.strictEqual(
    expectation.expectedExecutorCalls,
    0,
    `${testCase.name}: a replay case must declare zero executor calls`,
  );
  for (const [language, entry] of [["TypeScript", tsEntry], ["Python", pyEntry]]) {
    assert.equal(entry.outcome, expectation.outcome, `${testCase.name}: ${language} outcome`);
    assert.deepEqual(
      entry.adoptedNodeIds,
      expectation.adoptedNodeIds,
      `${testCase.name}: ${language} adopted node ids`,
    );
    assert.strictEqual(
      entry.appendedDecisionEvents,
      expectation.appendedDecisionEvents,
      `${testCase.name}: ${language} appended decision events`,
    );
    assert.strictEqual(
      entry.executorCalls,
      expectation.expectedExecutorCalls,
      `${testCase.name}: ${language} executor calls`,
    );
    if (expectation.outcome === "rejected") {
      assert.equal(entry.code, expectation.code, `${testCase.name}: ${language} rejection code`);
      assert.equal(entry.nodeId, expectation.nodeId, `${testCase.name}: ${language} rejected node`);
      for (const field of [
        "recordedPolicyHash",
        "currentPolicyHash",
        "recordedDecisionId",
        "recomputedDecisionId",
      ]) {
        if (!Object.hasOwn(expectation, field)) continue;
        assert.equal(
          entry[field],
          expectation[field],
          `${testCase.name}: ${language} ${field}`,
        );
      }
    }
    if (Object.hasOwn(expectation, "childDecisionId")) {
      assert.equal(
        entry.recomputedDecisionIds[expectation.adoptedNodeIds[0]],
        expectation.childDecisionId,
        `${testCase.name}: ${language} forked child identity`,
      );
      assert.equal(
        entry.recordedDecisionIds[expectation.adoptedNodeIds[0]],
        expectation.childDecisionId,
        `${testCase.name}: ${language} forked child recorded identity`,
      );
      assert.notEqual(
        expectation.childDecisionId,
        expectation.parentDecisionId,
        `${testCase.name}: ${language} fork reused the parent identity`,
      );
    }
  }
  if (expectation.outcome === "adopted") barrierReplayAdoptions += 1;
  else barrierReplayCodesSeen.add(expectation.code);
}
assertBarrierAgreement(
  "replayCases",
  "<coverage>",
  "rejectionCodesExercised",
  [...barrierCorpus.vocabulary.replayRejectionCodes].sort(),
  [...barrierReplayCodesSeen].sort(),
);
assert.ok(barrierReplayAdoptions > 0, "replayCases: no zero-rejudge adoption was compared");

const barrierIdentifierCases = barrierSectionNames(
  "identifierCases",
  pyBarrierReport.identifierCaseOrder,
  pyBarrierReport.identifierCases,
);
let barrierIdentifierAccepted = 0;
let barrierIdentifierRejected = 0;
for (const testCase of barrierIdentifierCases) {
  const tsEntry = typescriptBarrierIdentifierReport(
    testCase,
    barrierCorpus.identifierBaseDocuments,
  );
  const pyEntry = pyBarrierReport.identifierCases[testCase.name];
  assertBarrierEntryAgreement(
    "identifierCases",
    testCase.name,
    BARRIER_IDENTIFIER_FIELDS,
    tsEntry,
    pyEntry,
  );
  // `mutatedDocument` is exempt from the no-null rule: the corpus RouteDecision
  // declares `confidenceBasisPoints: null` as its nullable-member witness.

  for (const [language, entry] of [["TypeScript", tsEntry], ["Python", pyEntry]]) {
    assert.strictEqual(
      entry.controlValid,
      true,
      `${testCase.name}: ${language} rejects the unmutated base document`,
    );
    assert.strictEqual(
      entry.valid,
      testCase.expect.valid,
      `${testCase.name}: ${language} identifier acceptance`,
    );
  }
  // TypeScript reports the offending pointer; it must be exactly the mutated one.
  const tsIssues = core.decisionDocumentIdentifierIssues(
    testCase.documentKind,
    barrierApplyPointer(
      barrierCorpus.identifierBaseDocuments[testCase.documentKind],
      testCase.path,
      testCase.value,
    ),
  );
  assert.deepEqual(
    [...tsIssues],
    testCase.expect.valid ? [] : [testCase.path],
    `${testCase.name}: TypeScript identifier issue pointer`,
  );
  if (testCase.expect.valid) barrierIdentifierAccepted += 1;
  else barrierIdentifierRejected += 1;
}
assert.ok(
  barrierIdentifierAccepted > 0 && barrierIdentifierRejected > 0,
  "identifierCases: both acceptance and rejection must be witnessed",
);

process.stdout.write(
  `Cross-language integrated-barrier conformance passed for ${barrierPolicyCases.length} policy cases (${barrierValidPolicyCases.length} normalized policy snapshots), ${barrierOwnershipCases.length} ownership cases through both the native validator and the real compiler pass, and ${barrierCompilerCases.length} compiler cases through compileGraph/try_compile_graph carrying ${barrierCompilerCases.length} literal graph hashes and ${barrierOrderedDiagnostics} ordered diagnostics (${barrierMultiDiagnosticCases} multi-diagnostic order witnesses, ${barrierRouterOrderWitnesses} router-before-barrier witness, ${barrierSuppressionWitnesses} suppression-chain witnesses, all 4 categories); tranche 2 joined ${barrierEvaluationCases.length} evaluation cases through evaluateIntegratedBarrier/evaluate_integrated_barrier (all ${barrierCorpus.vocabulary.reasonCodes.length} reason codes, all ${barrierCorpus.vocabulary.resolutions.length} resolutions, ${barrierCensusCases} quorum censuses carrying ${barrierCensusRecords} vote records), ${barrierIdentityCases.length} identity cases with policyHash and decisionId recomputed natively on both sides (${barrierIdentityBarrierDocuments} barrier, ${barrierIdentityRouteDocuments} route, ${barrierFramingWitnesses} naive-concatenation framing witness), ${barrierReplayCases.length} replay cases (${barrierReplayAdoptions} zero-rejudge adoptions, all ${barrierCorpus.vocabulary.replayRejectionCodes.length} rejection codes, 0 executor calls on both sides and 0 through the real scheduler), and ${barrierIdentifierCases.length} identifier cases (${barrierIdentifierAccepted} accepted, ${barrierIdentifierRejected} rejected); claims ${JSON.stringify(barrierCorpus.claims)}.\n`,
);

// ---------------------------------------------------------------------------
// Durable CLI operations cross-language join.
//
// The operational surface is the one place where a divergence is invisible to
// both single-language suites: each CLI can be internally consistent while
// emitting a different envelope, a different error code, or a different exit
// status for the same durable history. This block removes that possibility by
// driving both native CLIs over one shared corpus and comparing stdout bytes,
// stderr bytes, and exit codes member for member.
//
// Neither side may read the other's expectations. The TypeScript half below is
// computed only from packages/cli; the Python half is computed by
// tools/conformance/python_cli_operations_report.py from the native
// `graph_engineering` package. The single shared input is
// tools/conformance/cli-operations.case.json, which carries authentic journals
// in both durable layouts — legacy `events/` v1alpha1 histories and protected
// `events-v1alpha2/` histories the real durable scheduler wrote — plus
// adversarial malformed ones and no expectation blocks at all. Each journal
// states the directory it belongs in; a case may name several, which is how the
// corpus states a store carrying both layouts for one run identity.
//
// It also carries the append-free evidence: every read command runs against a
// fingerprinted journal, and both halves must report that the bytes, size, and
// modification time did not move.
const cliOperationsCorpus = JSON.parse(
  await readFile(join(root, "tools", "conformance", "cli-operations.case.json"), "utf8"),
);

let cliOperationsModule;
let cliEntrypointModule;
try {
  cliEntrypointModule = await import(
    pathToFileURL(join(root, "packages", "cli", "dist", "src", "cli.js")).href
  );
  cliOperationsModule = await import(
    pathToFileURL(join(root, "packages", "cli", "dist", "src", "operations.js")).href
  );
} catch (error) {
  throw new Error(
    "TypeScript CLI is not built; run `corepack pnpm --filter @graph-engineering/cli build`",
    { cause: error },
  );
}

// Payload markers that only ever appear inside `event.data`. The CLI is a
// capture sink, so none of them may reach stdout or stderr. Restated here
// independently of the Python half, which asserts the same list on its own
// output.
const CLI_OPERATIONS_FORBIDDEN_MARKERS = [
  "implementationHash",
  "contractVersion",
  "inputHash",
  "maxTotalAttempts",
  "payloadHash",
  "activityKey",
  "outputHash",
  "reusedNodeIds",
  "availableAt",
];

// The exact, ordered member list each operational envelope is allowed to carry.
// A payload leak would have to add a member here to escape, so this is a
// positive redaction assertion rather than a substring search.
const CLI_OPERATIONS_DATA_KEYS = {
  status: [
    "runId", "runIdHash", "journalApiVersion", "status", "terminal", "eventCount",
    "lastSequence", "graphRevision", "firstEventTimestamp", "lastEventTimestamp",
    "resumeCount", "pauseCount", "observedNodeCount", "redaction",
  ],
  inspect: [
    "runId", "runIdHash", "journalApiVersion", "status", "terminal", "eventCount",
    "lastSequence", "graphRevision", "eventTypeCounts", "observedNodes", "observedEdges",
    "redaction",
  ],
  logs: [
    "runId", "runIdHash", "journalApiVersion", "eventCount", "fromSequence", "limit",
    "returned", "truncated", "nextSequence", "events", "redaction",
  ],
};
const CLI_OPERATIONS_EVENT_KEYS = [
  "sequence", "type", "timestamp", "nodeId", "edgeId", "attempt", "redacted",
];
const CLI_OPERATIONS_NODE_KEYS = [
  "nodeId", "eventCount", "firstSequence", "lastSequence", "observedMaxAttempt",
  "scheduled", "started", "succeeded", "attemptFailures", "retries", "settledWithoutAttempt",
];
const CLI_OPERATIONS_EDGE_KEYS = ["edgeId", "eventCount", "firstSequence", "lastSequence"];

function cliOperationsJournalPath(store, journal) {
  const digest = createHash("sha256").update(journal.runId, "utf8").digest("hex");
  return join(store, journal.directory, `${digest}.jsonl`);
}

/**
 * Materialize every journal one case declares and return their paths.
 *
 * A case names one journal or several. Several is how the corpus states a store
 * that carries both durable layouts for one run identity: the corpus says which
 * directory each journal lives in, and this writes it there.
 */
async function cliOperationsMaterialize(store, journals) {
  await mkdir(store, { recursive: true });
  const paths = [];
  for (const journal of journals) {
    if (journal === null || journal === undefined || journal.content === null) continue;
    const path = cliOperationsJournalPath(store, journal);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(journal.content, "utf8"));
    paths.push(path);
  }
  return paths;
}

async function cliOperationsFingerprint(path) {
  if (path === null) return null;
  try {
    const bytes = await readFile(path);
    const state = await stat(path, { bigint: true });
    return [
      createHash("sha256").update(bytes).digest("hex"),
      String(state.size),
      String(state.mtimeNs),
    ].join(":");
  } catch {
    return null;
  }
}

async function cliOperationsEntries(store) {
  const found = [];
  async function walk(directory, prefix) {
    let names;
    try {
      names = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      found.push(relative);
      if (entry.isDirectory()) await walk(join(directory, entry.name), relative);
    }
  }
  await walk(store, "");
  return found.sort();
}

/**
 * Run the built TypeScript CLI in process and capture its two streams.
 *
 * `run` writes through `process.stdout`/`process.stderr`, so those two writers
 * are swapped for the duration of the call and always restored.
 */
async function cliOperationsInvoke(argv) {
  const out = [];
  const err = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  const capture = (sink) => (chunk, encoding, callback) => {
    sink.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    if (typeof encoding === "function") encoding();
    else if (typeof callback === "function") callback();
    return true;
  };
  process.stdout.write = capture(out);
  process.stderr.write = capture(err);
  let exitCode;
  try {
    exitCode = await cliEntrypointModule.run([...argv]);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  return { exitCode, stdout: out.join(""), stderr: err.join("") };
}

function cliOperationsDivergence(caseName, field, tsValue, pyValue) {
  return new Error(
    `Durable CLI operations divergence in case '${caseName}', field '${field}':`
      + ` TypeScript ${JSON.stringify(tsValue)} vs Python ${JSON.stringify(pyValue)}`,
  );
}

function assertCliOperationsAgreement(caseName, field, tsValue, pyValue) {
  if (!isDeepStrictEqual(tsValue, pyValue)) {
    throw cliOperationsDivergence(caseName, field, tsValue, pyValue);
  }
}

const pythonCliOperations = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_cli_operations_report.py"],
  { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);
if (pythonCliOperations.status !== 0) {
  throw new Error(
    "Python durable CLI operations conformance failed:\n"
      + (pythonCliOperations.stderr || pythonCliOperations.stdout),
  );
}
const pyCliOperations = JSON.parse(pythonCliOperations.stdout);

assert.equal(
  pyCliOperations.contract,
  cliOperationsCorpus.contract,
  "durable CLI operations: the two halves read different corpus contracts",
);
assert.equal(
  cliOperationsCorpus.contract,
  cliEntrypointModule.MACHINE_SCHEMA_VERSION,
  "durable CLI operations: the corpus contract is not the CLI machine schema version",
);

// Two implementations, not two corpus reads: each half reported the constants
// its own package defines.
assertCliOperationsAgreement(
  "<contract>",
  "exitCodes",
  cliEntrypointModule.EXIT_CODES,
  pyCliOperations.nativeExitCodes,
);
assertCliOperationsAgreement(
  "<contract>",
  "exitCodes",
  cliOperationsCorpus.exitCodes,
  pyCliOperations.nativeExitCodes,
);
assertCliOperationsAgreement(
  "<contract>",
  "journalApiVersion",
  cliOperationsModule.JOURNAL_API_VERSION,
  pyCliOperations.nativeJournalApiVersion,
);
assertCliOperationsAgreement(
  "<contract>",
  "journalApiVersionV1Alpha2",
  cliOperationsModule.JOURNAL_API_VERSION_V1ALPHA2,
  pyCliOperations.nativeJournalApiVersionV1Alpha2,
);
assertCliOperationsAgreement(
  "<contract>",
  "journalEventTypes",
  [...cliOperationsModule.JOURNAL_EVENT_TYPES],
  pyCliOperations.nativeJournalEventTypes,
);
assertCliOperationsAgreement(
  "<contract>",
  "journalEventTypesV1Alpha2",
  [...cliOperationsModule.JOURNAL_EVENT_TYPES_V1ALPHA2],
  pyCliOperations.nativeJournalEventTypesV1Alpha2,
);
// Both halves probe the same two layouts in the same order. The protected
// layout is first: a store that carries both must project the journal this
// runtime still writes.
assertCliOperationsAgreement(
  "<contract>",
  "journalSources",
  cliOperationsModule.JOURNAL_SOURCES.map((source) => [source.directory, source.apiVersion]),
  pyCliOperations.nativeJournalSources,
);
assert.equal(
  cliOperationsCorpus.journalApiVersion,
  cliOperationsModule.JOURNAL_API_VERSION,
  "durable CLI operations: the corpus legacy contract is not the one the CLI reads",
);
assert.equal(
  cliOperationsCorpus.journalApiVersionV1Alpha2,
  cliOperationsModule.JOURNAL_API_VERSION_V1ALPHA2,
  "durable CLI operations: the corpus protected contract is not the one the CLI reads",
);
// Every journal the corpus carries states the layout it belongs in, and the
// only two layouts are the two the readers probe.
const cliOperationsDirectories = new Set(
  Object.values(cliOperationsCorpus.journals)
    .map((journal) => journal.directory)
    .filter((directory) => directory !== null),
);
assert.deepEqual(
  [...cliOperationsDirectories].sort(),
  cliOperationsModule.JOURNAL_SOURCES.map((source) => source.directory).sort(),
  "durable CLI operations: the corpus does not cover both durable journal layouts",
);
assertCliOperationsAgreement(
  "<contract>",
  "limits",
  {
    defaultLogLimit: cliOperationsModule.DEFAULT_LOG_LIMIT,
    maxLogLimit: cliOperationsModule.MAX_LOG_LIMIT,
    maxJournalBytes: cliOperationsModule.MAX_JOURNAL_BYTES,
  },
  pyCliOperations.nativeLimits,
);

const cliUnsupportedNames = Object.keys(cliOperationsModule.UNSUPPORTED_OPERATIONS).sort();
assertCliOperationsAgreement(
  "<contract>",
  "unsupportedCommands",
  cliUnsupportedNames,
  Object.keys(pyCliOperations.nativeUnsupported).sort(),
);
assertCliOperationsAgreement(
  "<contract>",
  "unsupportedCommands",
  cliUnsupportedNames,
  Object.keys(cliOperationsCorpus.unsupportedCapabilities).sort(),
);
for (const command of cliUnsupportedNames) {
  const tsDescriptor = cliOperationsModule.UNSUPPORTED_OPERATIONS[command];
  const pyDescriptor = pyCliOperations.nativeUnsupported[command];
  assertCliOperationsAgreement(command, "capability", tsDescriptor.capability, pyDescriptor.capability);
  assertCliOperationsAgreement(command, "message", tsDescriptor.message, pyDescriptor.message);
  assert.equal(
    tsDescriptor.capability,
    cliOperationsCorpus.unsupportedCapabilities[command],
    `durable CLI operations: '${command}' capability disagrees with the corpus`,
  );
}

// The five claim flags are literally false on both sides. Each process read
// them from the corpus itself, so this is a two-reader assertion rather than a
// restatement of one read.
const cliOperationsClaimNames = [
  "durableCancellationClaim",
  "durableResumeClaim",
  "durableReplayClaim",
  "durableForkClaim",
  "durableNodeRetryClaim",
];
assertCliOperationsAgreement(
  "<claims>",
  "flagNames",
  [...cliOperationsClaimNames].sort(),
  Object.keys(pyCliOperations.claims).sort(),
);
assertCliOperationsAgreement(
  "<claims>",
  "flagNames",
  [...cliOperationsClaimNames].sort(),
  Object.keys(cliOperationsCorpus.claims).sort(),
);
for (const flag of cliOperationsClaimNames) {
  assert.strictEqual(
    cliOperationsCorpus.claims[flag],
    false,
    `durable CLI operations claim '${flag}' is not literally false in the Node-side read`,
  );
  assert.strictEqual(
    pyCliOperations.claims[flag],
    false,
    `durable CLI operations claim '${flag}' is not literally false in the Python-side read`,
  );
}

const cliOperationsCaseNames = cliOperationsCorpus.cases.map((item) => String(item.name));
assert.equal(
  new Set(cliOperationsCaseNames).size,
  cliOperationsCaseNames.length,
  "durable CLI operations: the corpus declares a duplicate case name",
);
assertCliOperationsAgreement(
  "<corpus>",
  "caseOrder",
  cliOperationsCaseNames,
  pyCliOperations.caseOrder,
);

const cliOperationsWorkspace = await mkdtemp(join(tmpdir(), "graph-cli-operations-node-"));
let cliOperationsReadCases = 0;
let cliOperationsAppendProofs = 0;
let cliOperationsUnsupportedCases = 0;
const cliOperationsExitCodesSeen = new Set();
const cliOperationsVersionsSeen = new Set();
try {
  for (const [index, testCase] of cliOperationsCorpus.cases.entries()) {
    const name = String(testCase.name);
    const store = join(cliOperationsWorkspace, `case-${String(index).padStart(4, "0")}`);
    const journalNames = testCase.journal === null
      ? []
      : [testCase.journal].flat();
    const journalDirectories = journalNames.map(
      (journalName) => cliOperationsCorpus.journals[journalName].directory,
    );
    const paths = await cliOperationsMaterialize(
      store,
      journalNames.map((journalName) => cliOperationsCorpus.journals[journalName]),
    );
    const before = await Promise.all(paths.map(cliOperationsFingerprint));
    const argv = testCase.argv.map((item) =>
      String(item).split(cliOperationsCorpus.storeToken).join(store));
    const result = await cliOperationsInvoke(argv);
    const after = await Promise.all(paths.map(cliOperationsFingerprint));
    const tsEntry = {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      // Every journal the case materialized, not only the one the command was
      // expected to read: a command that appended to the layout it did not
      // choose would fail here too.
      journalUnchanged: paths.length === 0 ? null : isDeepStrictEqual(before, after),
      storeEntries: await cliOperationsEntries(store),
    };
    const pyEntry = pyCliOperations.cases[name];
    assert.ok(pyEntry !== undefined, `durable CLI operations: Python skipped case '${name}'`);

    for (const field of ["exitCode", "stdout", "stderr", "journalUnchanged", "storeEntries"]) {
      assertCliOperationsAgreement(name, field, tsEntry[field], pyEntry[field]);
    }
    cliOperationsExitCodesSeen.add(result.exitCode);

    // Machine mode is exactly one JSON document on stdout and nothing on stderr.
    if (argv.includes("--json")) {
      assert.equal(tsEntry.stderr, "", `${name}: machine mode wrote stderr`);
      assert.ok(tsEntry.stdout.endsWith("\n"), `${name}: machine output is not newline terminated`);
      assert.equal(
        tsEntry.stdout.trimEnd().split("\n").length,
        1,
        `${name}: machine mode did not emit exactly one JSON line`,
      );
      const envelope = JSON.parse(tsEntry.stdout);
      assert.equal(envelope.schemaVersion, cliEntrypointModule.MACHINE_SCHEMA_VERSION);
      assert.equal(envelope.exitCode, tsEntry.exitCode, `${name}: envelope exit code disagrees`);
      assert.equal(envelope.ok, tsEntry.exitCode === 0, `${name}: envelope ok disagrees`);
      const allowed = CLI_OPERATIONS_DATA_KEYS[envelope.command];
      if (allowed !== undefined && envelope.data !== null) {
        assert.deepEqual(Object.keys(envelope.data), allowed, `${name}: envelope members drifted`);
        // Which contract the projection reports is decided by the layout the
        // corpus put the journal in, and by the documented resolution order
        // when a store carries both.
        const expectedApiVersion = journalDirectories.includes("events-v1alpha2")
          ? cliOperationsModule.JOURNAL_API_VERSION_V1ALPHA2
          : cliOperationsModule.JOURNAL_API_VERSION;
        assert.equal(
          envelope.data.journalApiVersion,
          expectedApiVersion,
          `${name}: the projection named the wrong journal contract`,
        );
        cliOperationsVersionsSeen.add(envelope.data.journalApiVersion);
        assert.deepEqual(
          Object.keys(envelope.data.redaction),
          ["sink", "eventDataEmitted", "payloadsEmitted", "pathsEmitted"],
          `${name}: redaction marker drifted`,
        );
        assert.deepEqual(
          envelope.data.redaction,
          {
            sink: "cli-json",
            eventDataEmitted: false,
            payloadsEmitted: false,
            pathsEmitted: false,
          },
          `${name}: redaction marker is not the frozen constant`,
        );
        for (const event of envelope.data.events ?? []) {
          assert.deepEqual(Object.keys(event), CLI_OPERATIONS_EVENT_KEYS, `${name}: event members drifted`);
        }
        for (const node of envelope.data.observedNodes ?? []) {
          assert.deepEqual(Object.keys(node), CLI_OPERATIONS_NODE_KEYS, `${name}: node members drifted`);
        }
        for (const edge of envelope.data.observedEdges ?? []) {
          assert.deepEqual(Object.keys(edge), CLI_OPERATIONS_EDGE_KEYS, `${name}: edge members drifted`);
        }
      }
    }

    // Redaction: the CLI is a capture sink, so neither the resolved store path
    // nor any `event.data` marker may appear on either stream.
    const emitted = tsEntry.stdout + tsEntry.stderr;
    assert.ok(!emitted.includes(store), `${name}: TypeScript CLI emitted a filesystem path`);
    assert.strictEqual(
      pyEntry.storePathLeaked,
      false,
      `${name}: Python CLI emitted a filesystem path`,
    );
    for (const marker of CLI_OPERATIONS_FORBIDDEN_MARKERS) {
      assert.ok(
        !emitted.includes(marker),
        `${name}: TypeScript CLI emitted the payload marker ${JSON.stringify(marker)}`,
      );
    }
    assert.deepEqual(
      pyEntry.payloadMarkersLeaked,
      [],
      `${name}: Python CLI emitted a payload marker`,
    );

    const command = argv[0];
    if (["status", "inspect", "logs"].includes(command)) {
      cliOperationsReadCases += 1;
      if (paths.length > 0) {
        assert.strictEqual(
          tsEntry.journalUnchanged,
          true,
          `${name}: the TypeScript read command mutated the durable history`,
        );
        assert.strictEqual(
          pyEntry.journalUnchanged,
          true,
          `${name}: the Python read command mutated the durable history`,
        );
        cliOperationsAppendProofs += 1;
      }
    }
    if (cliUnsupportedNames.includes(command)) {
      cliOperationsUnsupportedCases += 1;
      if (argv.includes("--json")) {
        const envelope = JSON.parse(tsEntry.stdout);
        // A fail-closed command must never look like a result.
        if (envelope.error !== null && envelope.error.code === "GECLI_UNSUPPORTED_CAPABILITY") {
          assert.equal(envelope.data, null, `${name}: a refused command returned data`);
          assert.equal(
            envelope.exitCode,
            cliOperationsCorpus.exitCodes.unsupported,
            `${name}: a refused command did not exit with the unsupported status`,
          );
          assert.equal(
            envelope.error.capability,
            cliOperationsCorpus.unsupportedCapabilities[command],
            `${name}: a refused command named the wrong capability`,
          );
        }
      }
      // The refusal must not have touched the store in either implementation.
      assert.deepEqual(
        tsEntry.storeEntries,
        pyEntry.storeEntries,
        `${name}: a refused command left different store state`,
      );
    }
  }
} finally {
  await rm(cliOperationsWorkspace, { recursive: true, force: true });
}

assert.ok(cliOperationsReadCases > 0, "durable CLI operations: no read command was compared");
assert.ok(
  cliOperationsAppendProofs > 0,
  "durable CLI operations: no read command was proved append-free",
);
assert.ok(
  cliOperationsUnsupportedCases >= cliUnsupportedNames.length,
  "durable CLI operations: not every fail-closed command was exercised",
);
for (const status of [0, 2, 4, 5, 6]) {
  assert.ok(
    cliOperationsExitCodesSeen.has(status),
    `durable CLI operations: exit code ${status} is unwitnessed by the corpus`,
  );
}
// Both durable layouts are projected by the corpus, not merely readable in
// principle.
assert.deepEqual(
  [...cliOperationsVersionsSeen].sort(),
  cliOperationsModule.JOURNAL_SOURCES.map((source) => source.apiVersion).sort(),
  "durable CLI operations: a journal contract is unwitnessed by the corpus",
);

const cliOperationsJournalsIn = (directory) => Object.values(cliOperationsCorpus.journals)
  .filter((journal) => journal.directory === directory).length;
const cliOperationsV1Alpha2Journals = cliOperationsJournalsIn("events-v1alpha2");
const cliOperationsLegacyJournals = cliOperationsJournalsIn("events");
process.stdout.write(
  `Cross-language durable CLI operations conformance passed for ${cliOperationsCorpus.cases.length} cases over ${Object.keys(cliOperationsCorpus.journals).length} shared journals (${cliOperationsV1Alpha2Journals} protected events/v1alpha2, ${cliOperationsLegacyJournals} legacy events/v1alpha1, ${Object.keys(cliOperationsCorpus.journals).length - cliOperationsV1Alpha2Journals - cliOperationsLegacyJournals} absent) (${cliOperationsReadCases} read invocations, ${cliOperationsAppendProofs} append-free proofs, ${cliOperationsUnsupportedCases} fail-closed refusals, exit codes ${[...cliOperationsExitCodesSeen].sort((left, right) => left - right).join("/")}, journal contracts ${[...cliOperationsVersionsSeen].map((version) => version.split("/").slice(-2).join("/")).sort().join("+")}); claims ${JSON.stringify(cliOperationsCorpus.claims)}.\n`,
);

// ---------------------------------------------------------------------------
// D9 redaction cross-language join (D9-REDACTION-CONFORMANCE-089).
//
// Master plan 31.35.12 rejected the integrated-router tranche at HIGH 3 for a
// cross-language divergence that both single-language suites passed over. For
// redaction the stakes are higher than diagnostic ordering: if the two lanes
// disagree about which pointer is rejected, which disposition is truthful, or
// which sink is authorized, one of them is writing bytes the other would
// refuse.
//
// Neither side may read the other's expectations. The TypeScript half below is
// computed only from `@graph-engineering/persistence`; the Python half is
// computed by tools/conformance/python_redaction_report.py from the native
// `graph_engineering` package. The single shared input is the corpus JSON plus
// the shared vectors restated identically in both halves, and the corpus
// `expected`/`valid` blocks are consulted only after the two native results
// have already been proved equal to each other.
//
// Section order is load bearing: the wire join composes the disposition truth
// table, the receipt validator, and the two inventories, so those are joined
// first and the wire documents last.

const redactionCorpus = JSON.parse(
  await readFile(join(fixtureRoot, "redaction.case.json"), "utf8"),
);

// --- shared vectors -------------------------------------------------------
// Restated here exactly as the Python report states them. They are inputs, not
// expectations: no expected output is written down on either side, and the join
// asserts the two statements equal before either is used.
const REDACTION_CARTESIAN_POLICY_ENABLED = true;
const REDACTION_RECEIPT_IDENTITY_KEY_HEX = `${"0".repeat(62)}d9`;
const REDACTION_RECEIPT_POLICY_HASH = "1a".repeat(32);
const REDACTION_RECEIPT_TRANSFORM_IMPLEMENTATION_HASH = "2b".repeat(32);
const REDACTION_RECEIPT_RULE_REGISTRY_HASH = "3c".repeat(32);
const REDACTION_RECEIPT_AUTHORITY_BINDING_HASH = "4d".repeat(32);
const REDACTION_RECEIPT_TENANT_SCOPE_HASH = "5e".repeat(32);
const REDACTION_RECEIPT_RULE_REGISTRY_VERSION = 1;
const REDACTION_RECEIPT_RULE_ID = "d9-join-observational-v1";
const REDACTION_RECEIPT_RULE_RESOLUTION_ID = "d9-join-resolution-1";
const REDACTION_RECEIPT_SOURCE_CLASS = "log-field";
const REDACTION_RECEIPT_SINK = "runtime-log";
const REDACTION_RECEIPT_DECISION_ID = "d9-join-decision-1";
const REDACTION_RECEIPT_RUN_ID = "d9-join-run";
const REDACTION_RECEIPT_GRAPH_REVISION = 1;
const REDACTION_RECEIPT_OCCURRENCE_KIND = "sink-write";
const REDACTION_RECEIPT_OCCURRENCE_ID = "d9-join-occurrence-1";
const REDACTION_RECEIPT_OCCURRENCE_SEQUENCE = 3;
const REDACTION_RECEIPT_OCCURRED_AT = "2026-07-31T00:00:00Z";
const REDACTION_RECEIPT_FIELD_PATH = "/fields/message";
const REDACTION_RECEIPT_REPLACEMENT_MODE = "constant-token";
const REDACTION_RECEIPT_PATHS = ["/detail/token", "/message", "/nested/0/secret"];
const REDACTION_RECEIPT_SOURCE_SNAPSHOT = {
  detail: { token: "synthetic-sensitive-value-a", keep: 1 },
  message: "synthetic-sensitive-value-b",
  nested: [{ secret: "synthetic-sensitive-value-c" }, { secret: "kept" }],
  public: ["a", "b"],
};
const REDACTION_CANARY_ID = "d9-redaction-conformance-canary-1";
const REDACTION_CANARY_VALUE = "GE-CANARY-D9-REDACTION-089-7B3F1A6C2E9D4058";
const REDACTION_CANARY_RUN_ID = "d9-canary-run";
const REDACTION_CANARY_GRAPH_REVISION = 1;
const REDACTION_CANARY_EVENT_ID = "evt-0";
const REDACTION_CANARY_TIMESTAMP = "2026-07-31T00:00:00Z";
const REDACTION_CANARY_GRAPH_HASH = "aa".repeat(32);
const REDACTION_CANARY_IMPLEMENTATION_HASH = "bb".repeat(32);
const REDACTION_CANARY_MAX_TOTAL_ATTEMPTS = 8;
const REDACTION_CANARY_PAYLOAD = {
  credentials: { apiKey: REDACTION_CANARY_VALUE },
  history: [{ note: REDACTION_CANARY_VALUE }, { note: "ordinary application data" }],
  question: REDACTION_CANARY_VALUE,
};
const REDACTION_CANARY_TRANSFORM_HASH = "11".repeat(32);
const REDACTION_CANARY_REGISTRY_HASH = "22".repeat(32);
const REDACTION_REQUIRED_SECTIONS = ["pointerCases", "wireCases", "flowCases"];
// Unit and record separators; the Python report joins the Cartesian sweep the
// same way, so the two digests are over byte-identical material.
const REDACTION_UNIT_SEPARATOR = "\u001f";
const REDACTION_RECORD_SEPARATOR = "\u001e";

/**
 * Render a value for a divergence message with object keys sorted, so the two
 * halves are compared by the reader on content rather than on the key order
 * their respective JSON transports happened to use. Array order is preserved
 * because array order is part of what this join defends.
 */
function redactionStringify(value) {
  if (Array.isArray(value)) return `[${value.map(redactionStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${redactionStringify(value[key])}`)
      .join(",")}}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function redactionDivergence(section, caseName, field, tsValue, pyValue) {
  return new Error(
    `Redaction cross-language divergence in ${section} case '${caseName}',`
      + ` field '${field}': TypeScript ${redactionStringify(tsValue)}`
      + ` vs Python ${redactionStringify(pyValue)}`,
  );
}

function assertRedactionAgreement(section, caseName, field, tsValue, pyValue) {
  if (!isDeepStrictEqual(tsValue, pyValue)) {
    throw redactionDivergence(section, caseName, field, tsValue, pyValue);
  }
}

/** Compare one projected entry field by field, including the reported key set. */
function assertRedactionEntryAgreement(section, caseName, fields, tsEntry, pyEntry) {
  for (const field of fields) {
    const tsHas = Object.hasOwn(tsEntry, field);
    const pyHas = Object.hasOwn(pyEntry, field);
    if (tsHas !== pyHas) {
      throw redactionDivergence(
        section,
        caseName,
        field,
        tsHas ? tsEntry[field] : "<field absent>",
        pyHas ? pyEntry[field] : "<field absent>",
      );
    }
    if (tsHas) assertRedactionAgreement(section, caseName, field, tsEntry[field], pyEntry[field]);
  }
  assertRedactionAgreement(
    section,
    caseName,
    "reportedFieldSet",
    Object.keys(tsEntry).sort(),
    Object.keys(pyEntry).sort(),
  );
}

/**
 * Enumerate a corpus section and prove both halves reported every declared case
 * exactly once. A silently skipped case is the failure mode this whole join
 * exists to prevent, so absence is an error rather than a no-op.
 */
function redactionSectionCases(section, pyOrder, pyReport) {
  const cases = redactionCorpus[section];
  assert.ok(Array.isArray(cases) && cases.length > 0, `${section}: corpus declares no cases`);
  const declared = cases.map((item) => item.id);
  assert.equal(new Set(declared).size, declared.length, `${section}: corpus declares a duplicate id`);
  assertRedactionAgreement(section, "<section>", "declaredCaseOrder", declared, pyOrder);
  for (const id of declared) {
    if (!Object.hasOwn(pyReport, id)) {
      throw new Error(`${section}: Python skipped corpus case '${id}'`);
    }
  }
  for (const id of Object.keys(pyReport)) {
    if (!declared.includes(id)) {
      throw new Error(`${section}: Python reported case '${id}' the corpus does not declare`);
    }
  }
  assert.equal(
    Object.keys(pyReport).length,
    declared.length,
    `${section}: Python reported ${Object.keys(pyReport).length} cases for ${declared.length} declared`,
  );
  return cases;
}

const pythonRedaction = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_redaction_report.py"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonRedaction.status !== 0) {
  throw new Error(
    `Python redaction conformance failed:\n${pythonRedaction.stderr || pythonRedaction.stdout}`,
  );
}
const pyRedaction = JSON.parse(pythonRedaction.stdout);

// --- 1. contract header and the honest-claim flag --------------------------
assert.equal(
  pyRedaction.apiVersion,
  redactionCorpus.apiVersion,
  "redaction: the two halves read different corpus apiVersions",
);
assert.equal(
  pyRedaction.contractStatus,
  redactionCorpus.contractStatus,
  "redaction: the two halves read different corpus contract statuses",
);
// Each process read the flag from the corpus itself, so this is a two-reader
// assertion rather than a restatement of one read. This lane never flips it.
assert.strictEqual(
  redactionCorpus.implementationClaim,
  false,
  "redaction implementationClaim is not literally false in the Node-side read",
);
assert.strictEqual(
  pyRedaction.implementationClaim,
  false,
  "redaction implementationClaim is not literally false in the Python-side read",
);
assertRedactionAgreement(
  "corpus",
  "<contract>",
  "requiredSections",
  REDACTION_REQUIRED_SECTIONS,
  pyRedaction.requiredSections,
);

// --- 2. shared vectors ------------------------------------------------------
// Proving the two halves ran the same experiment. Without this, every later
// comparison could be two implementations agreeing about different inputs.
const redactionSharedVectors = {
  cartesianPolicyEnabled: REDACTION_CARTESIAN_POLICY_ENABLED,
  receiptIdentityKeyHex: REDACTION_RECEIPT_IDENTITY_KEY_HEX,
  receiptPolicyHash: REDACTION_RECEIPT_POLICY_HASH,
  receiptTransformImplementationHash: REDACTION_RECEIPT_TRANSFORM_IMPLEMENTATION_HASH,
  receiptRuleRegistryHash: REDACTION_RECEIPT_RULE_REGISTRY_HASH,
  receiptAuthorityBindingHash: REDACTION_RECEIPT_AUTHORITY_BINDING_HASH,
  receiptTenantScopeHash: REDACTION_RECEIPT_TENANT_SCOPE_HASH,
  receiptRuleRegistryVersion: REDACTION_RECEIPT_RULE_REGISTRY_VERSION,
  receiptRuleId: REDACTION_RECEIPT_RULE_ID,
  receiptRuleResolutionId: REDACTION_RECEIPT_RULE_RESOLUTION_ID,
  receiptSourceClass: REDACTION_RECEIPT_SOURCE_CLASS,
  receiptSink: REDACTION_RECEIPT_SINK,
  receiptDecisionId: REDACTION_RECEIPT_DECISION_ID,
  receiptRunId: REDACTION_RECEIPT_RUN_ID,
  receiptGraphRevision: REDACTION_RECEIPT_GRAPH_REVISION,
  receiptOccurrenceKind: REDACTION_RECEIPT_OCCURRENCE_KIND,
  receiptOccurrenceId: REDACTION_RECEIPT_OCCURRENCE_ID,
  receiptOccurrenceSequence: REDACTION_RECEIPT_OCCURRENCE_SEQUENCE,
  receiptOccurredAt: REDACTION_RECEIPT_OCCURRED_AT,
  receiptFieldPath: REDACTION_RECEIPT_FIELD_PATH,
  receiptReplacementMode: REDACTION_RECEIPT_REPLACEMENT_MODE,
  receiptPaths: REDACTION_RECEIPT_PATHS,
  receiptSourceSnapshot: REDACTION_RECEIPT_SOURCE_SNAPSHOT,
  canaryId: REDACTION_CANARY_ID,
  canaryValue: REDACTION_CANARY_VALUE,
  canaryRunId: REDACTION_CANARY_RUN_ID,
  canaryGraphRevision: REDACTION_CANARY_GRAPH_REVISION,
  canaryEventId: REDACTION_CANARY_EVENT_ID,
  canaryTimestamp: REDACTION_CANARY_TIMESTAMP,
  canaryGraphHash: REDACTION_CANARY_GRAPH_HASH,
  canaryImplementationHash: REDACTION_CANARY_IMPLEMENTATION_HASH,
  canaryMaxTotalAttempts: REDACTION_CANARY_MAX_TOTAL_ATTEMPTS,
  canaryPayload: REDACTION_CANARY_PAYLOAD,
};
for (const key of Object.keys(redactionSharedVectors).sort()) {
  assertRedactionAgreement(
    "sharedVectors",
    key,
    "vector",
    redactionSharedVectors[key],
    pyRedaction.sharedVectors[key],
  );
}
assertRedactionAgreement(
  "sharedVectors",
  "<all>",
  "vectorNames",
  Object.keys(redactionSharedVectors).sort(),
  Object.keys(pyRedaction.sharedVectors).sort(),
);

// --- 3. closed vocabularies and the two inventories ------------------------
const tsRedactionNative = {
  algorithm: "source-sink-intersection/v1alpha1",
  sourceInventory: [...persistence.CAPTURE_SOURCE_CLASSES],
  sinkInventory: [...persistence.CAPTURE_SINK_CLASSES],
  sourceRuleCount: persistence.CAPTURE_SOURCE_CLASSES.length,
  sinkRuleCount: persistence.CAPTURE_SINK_CLASSES.length,
  // The two inventories below are compared as ordered sets because the corpus
  // declares them ordered. The policy-control vocabulary is a set with no
  // contract order, so it is compared sorted.
  policyControls: [...persistence.POLICY_CONTROLS].sort(),
  failureCodes: [...persistence.REDACTION_FAILURE_CODES],
  payloadDispositions: [...persistence.PAYLOAD_DISPOSITIONS],
  neverRedactableSourceClasses: [...persistence.NEVER_REDACTABLE_SOURCE_CLASSES].sort(),
  neverRedactableSinks: [...persistence.NEVER_REDACTABLE_SINKS].sort(),
  redactionToken: persistence.REDACTION_TOKEN,
  dispositionTruthTable: Object.fromEntries(
    Object.entries(persistence.DISPOSITION_TRUTH_TABLE).map(([disposition, row]) => [
      disposition,
      { redacted: row.redacted, receiptRequired: row.receipt },
    ]),
  ),
  limits: { ...persistence.SECTION_11_LIMITS },
  sourceRows: persistence.SOURCE_CLASSIFICATION_ROWS.map((row) => ({
    sourceClass: row.sourceClass,
    policyControl: row.policyControl,
    defaultAction: row.defaultAction,
    mayBeMetadata: row.mayBeMetadata,
    mayFeedScheduler: row.mayFeedScheduler,
    identifierTreatment: row.identifierTreatment,
  })),
  sinkRows: persistence.SINK_POLICY_ROWS.map((row) => ({
    sink: row.sink,
    family: row.family,
    policyControls: [...row.policyControls],
    acceptsProtected: row.acceptsProtected,
    acceptsMetadata: row.acceptsMetadata,
    defaultEnabled: row.defaultEnabled,
  })),
};
for (const field of Object.keys(tsRedactionNative).sort()) {
  assertRedactionAgreement("native", field, field, tsRedactionNative[field], pyRedaction.native[field]);
}
assertRedactionAgreement(
  "native",
  "<all>",
  "reportedFieldSet",
  Object.keys(tsRedactionNative).sort(),
  Object.keys(pyRedaction.native).sort(),
);

// Only now is the corpus consulted: the two natives already agree.
assert.deepEqual(
  tsRedactionNative.sourceInventory,
  redactionCorpus.sourceInventory,
  "sourceInventory: the agreed native inventory differs from the corpus, as an ordered set",
);
assert.deepEqual(
  tsRedactionNative.sinkInventory,
  redactionCorpus.sinkInventory,
  "sinkInventory: the agreed native inventory differs from the corpus, as an ordered set",
);
assert.equal(tsRedactionNative.sourceInventory.length, 57, "the source inventory is not 57 members");
assert.equal(tsRedactionNative.sinkInventory.length, 54, "the sink inventory is not 54 members");
assert.equal(
  tsRedactionNative.sourceRows.length,
  redactionCorpus.sensitiveFieldCases.length,
  "there is not exactly one native classification row per corpus source",
);
assert.deepEqual(
  tsRedactionNative.sourceRows.map((row) => row.sourceClass),
  redactionCorpus.sensitiveFieldCases.map((row) => row.sourceClass),
  "the native source rows are not in corpus order",
);
assert.deepEqual(
  tsRedactionNative.sinkRows.map((row) => row.sink),
  redactionCorpus.sinkPolicyCases.map((row) => row.sink),
  "the native sink rows are not in corpus order",
);
assert.equal(
  tsRedactionNative.failureCodes.length,
  12,
  "the closed failure-code vocabulary is not twelve members",
);
assert.deepEqual(
  tsRedactionNative.payloadDispositions,
  ["metadata-only", "protected-ref", "redacted", "inline-unredacted"],
  "the payload-disposition vocabulary is not the Section 3.2 four",
);
// Section 3.2: `redacted` is true for exactly one disposition, and exactly that
// disposition requires a receipt.
for (const [disposition, row] of Object.entries(tsRedactionNative.dispositionTruthTable)) {
  assert.equal(
    row.redacted,
    disposition === "redacted",
    `disposition truth table: '${disposition}' has the wrong redacted flag`,
  );
  assert.equal(
    row.receiptRequired,
    disposition === "redacted",
    `disposition truth table: '${disposition}' has the wrong receipt requirement`,
  );
}
for (const [field, value] of Object.entries(redactionCorpus.resourceLimits)) {
  assert.equal(
    tsRedactionNative.limits[field],
    value,
    `resourceLimits.${field}: the agreed native bound differs from the corpus`,
  );
}
assert.equal(
  tsRedactionNative.algorithm,
  redactionCorpus.flowPolicy.algorithm,
  "flowPolicy.algorithm differs from the agreed native algorithm",
);

// --- 4. the complete 3,078-pair Cartesian domain ---------------------------
// The control for each pair is the sink row's first declared control; the
// Python report states the same rule.
const redactionCartesianOutcomes = [];
const redactionCartesianHistogram = {};
let redactionCartesianPairs = 0;
for (const sourceClass of tsRedactionNative.sourceInventory) {
  for (const sink of tsRedactionNative.sinkInventory) {
    const row = persistence.sinkRow(sink);
    assert.ok(row !== undefined, `cartesian sweep: no native policy row for sink '${sink}'`);
    const decision = persistence.evaluateFlow({
      sourceClass,
      sink,
      policyControl: row.policyControls[0],
      policyEnabled: REDACTION_CARTESIAN_POLICY_ENABLED,
    });
    redactionCartesianOutcomes.push(
      `${sourceClass}${REDACTION_UNIT_SEPARATOR}${sink}${REDACTION_UNIT_SEPARATOR}${decision.outcome}`,
    );
    redactionCartesianHistogram[decision.outcome] =
      (redactionCartesianHistogram[decision.outcome] ?? 0) + 1;
    redactionCartesianPairs += 1;
  }
}
const tsRedactionCartesian = {
  pairCount: redactionCartesianPairs,
  nativeCartesianProductCount:
    tsRedactionNative.sourceRuleCount * tsRedactionNative.sinkRuleCount,
  outcomeHistogram: redactionCartesianHistogram,
  outcomeDigest: createHash("sha256")
    .update(redactionCartesianOutcomes.join(REDACTION_RECORD_SEPARATOR), "utf8")
    .digest("hex"),
};
assertRedactionEntryAgreement(
  "cartesian",
  "<sweep>",
  ["pairCount", "nativeCartesianProductCount", "outcomeHistogram", "outcomeDigest"],
  tsRedactionCartesian,
  pyRedaction.cartesian,
);
assert.equal(
  tsRedactionCartesian.pairCount,
  redactionCorpus.flowPolicy.cartesianProductCount,
  "the agreed Cartesian pair count differs from the corpus",
);
assert.equal(tsRedactionCartesian.pairCount, 3078, "the Cartesian domain is not 3,078 pairs");
assert.equal(
  redactionCartesianHistogram.failed ?? 0,
  0,
  "a Cartesian pair produced no closed outcome, so a row is missing from an inventory",
);
assert.equal(
  redactionCorpus.flowPolicy.sourceRuleCount,
  tsRedactionNative.sourceRuleCount,
  "flowPolicy.sourceRuleCount differs from the agreed native inventory",
);
assert.equal(
  redactionCorpus.flowPolicy.sinkRuleCount,
  tsRedactionNative.sinkRuleCount,
  "flowPolicy.sinkRuleCount differs from the agreed native inventory",
);

// --- 5. the 21 pointer cases ----------------------------------------------
const redactionPointerCases = redactionSectionCases(
  "pointerCases",
  pyRedaction.pointerCaseOrder,
  pyRedaction.pointerCases,
);
let redactionPointerAccepted = 0;
let redactionPointerRejected = 0;
const redactionPointerCodesSeen = new Set();
for (const testCase of redactionPointerCases) {
  const result = persistence.redactionTransform(
    testCase.input,
    testCase.paths,
    testCase.replacementMode,
  );
  const tsEntry = result.valid
    ? {
        valid: true,
        output: JSON.parse(JSON.stringify(result.output)),
        canonicalPaths: [...result.canonicalPaths],
        count: result.canonicalPaths.length,
      }
    : { valid: false, code: result.code };
  const pyEntry = pyRedaction.pointerCases[testCase.id];
  assertRedactionEntryAgreement(
    "pointerCases",
    testCase.id,
    ["valid", "output", "canonicalPaths", "count", "code"],
    tsEntry,
    pyEntry,
  );

  const expectation = testCase.expected;
  for (const [language, entry] of [["TypeScript", tsEntry], ["Python", pyEntry]]) {
    assert.equal(entry.valid, expectation.valid, `${testCase.id}: ${language} pointer validity`);
    if (expectation.valid) {
      assert.deepEqual(entry.output, expectation.output, `${testCase.id}: ${language} transform`);
      assert.deepEqual(
        entry.canonicalPaths,
        expectation.canonicalPaths,
        `${testCase.id}: ${language} canonical paths`,
      );
      assert.equal(
        entry.count,
        expectation.canonicalPaths.length,
        `${testCase.id}: ${language} canonical path count`,
      );
    } else {
      assert.equal(entry.code, expectation.code, `${testCase.id}: ${language} rejection code`);
      assert.ok(
        tsRedactionNative.failureCodes.includes(entry.code),
        `${testCase.id}: ${language} rejected with a code outside the closed vocabulary`,
      );
    }
  }
  if (tsEntry.valid) redactionPointerAccepted += 1;
  else {
    redactionPointerRejected += 1;
    redactionPointerCodesSeen.add(tsEntry.code);
  }
}
assert.ok(redactionPointerAccepted > 0, "pointerCases: no accepted transform was compared");
assert.ok(redactionPointerRejected > 0, "pointerCases: no rejection code was compared");

// --- 6. the 39 flow cases --------------------------------------------------
const redactionFlowCases = redactionSectionCases(
  "flowCases",
  pyRedaction.flowCaseOrder,
  pyRedaction.flowCases,
);
const redactionFlowOutcomesSeen = new Set();
let redactionFlowAuthorized = 0;
let redactionFlowDenied = 0;
for (const testCase of redactionFlowCases) {
  const decision = persistence.evaluateFlow({
    sourceClass: testCase.sourceClass,
    sink: testCase.sink,
    policyControl: testCase.policyControl,
    policyEnabled: testCase.policyEnabled,
  });
  const tsEntry = {
    outcome: decision.outcome,
    writeAuthorized: decision.writeAuthorized,
    code: decision.code ?? null,
  };
  const pyEntry = pyRedaction.flowCases[testCase.id];
  assertRedactionEntryAgreement(
    "flowCases",
    testCase.id,
    ["outcome", "writeAuthorized", "code"],
    tsEntry,
    pyEntry,
  );

  // The corpus states which rows it considers known; the agreed native
  // inventories must classify them the same way, or the two halves agreed about
  // a request the corpus did not describe.
  assert.equal(
    tsRedactionNative.sourceInventory.includes(testCase.sourceClass),
    testCase.knownSource,
    `${testCase.id}: the agreed source inventory disagrees with knownSource`,
  );
  assert.equal(
    tsRedactionNative.sinkInventory.includes(testCase.sink),
    testCase.knownSink,
    `${testCase.id}: the agreed sink inventory disagrees with knownSink`,
  );
  assert.equal(
    tsRedactionNative.policyControls.includes(testCase.policyControl),
    testCase.knownControl,
    `${testCase.id}: the agreed policy-control vocabulary disagrees with knownControl`,
  );

  const expectation = testCase.expected;
  for (const [language, entry] of [["TypeScript", tsEntry], ["Python", pyEntry]]) {
    assert.equal(entry.outcome, expectation.outcome, `${testCase.id}: ${language} flow outcome`);
    assert.equal(
      entry.writeAuthorized,
      expectation.writeAuthorized,
      `${testCase.id}: ${language} writeAuthorized`,
    );
    assert.equal(
      entry.code,
      expectation.code ?? null,
      `${testCase.id}: ${language} flow failure code`,
    );
    // Section 7: only these three representations authorize a write.
    assert.equal(
      entry.writeAuthorized,
      ["protected-ref", "metadata-only", "redacted"].includes(entry.outcome),
      `${testCase.id}: ${language} writeAuthorized contradicts its own outcome`,
    );
  }
  redactionFlowOutcomesSeen.add(tsEntry.outcome);
  if (tsEntry.writeAuthorized) redactionFlowAuthorized += 1;
  else redactionFlowDenied += 1;
}
assert.ok(redactionFlowAuthorized > 0, "flowCases: no authorized write was compared");
assert.ok(redactionFlowDenied > 0, "flowCases: no denied write was compared");
for (const outcome of ["protected-ref", "metadata-only", "suppressed", "failed"]) {
  assert.ok(
    redactionFlowOutcomesSeen.has(outcome),
    `flowCases: the outcome '${outcome}' is unwitnessed by the corpus`,
  );
}

// --- 7. the bound redaction receipt ----------------------------------------
const redactionReceiptRule = {
  apiVersion: persistence.REDACTION_RULE_API_VERSION,
  ruleId: REDACTION_RECEIPT_RULE_ID,
  registryVersion: REDACTION_RECEIPT_RULE_REGISTRY_VERSION,
  sink: REDACTION_RECEIPT_SINK,
  paths: REDACTION_RECEIPT_PATHS,
  replacementMode: REDACTION_RECEIPT_REPLACEMENT_MODE,
};
const redactionReceiptRequest = {
  identityKey: Buffer.from(REDACTION_RECEIPT_IDENTITY_KEY_HEX, "hex"),
  policy: {
    ...persistence.DEFAULT_CAPTURE_POLICY,
    transformImplementationHash: REDACTION_RECEIPT_TRANSFORM_IMPLEMENTATION_HASH,
    ruleRegistryHash: REDACTION_RECEIPT_RULE_REGISTRY_HASH,
    ruleRegistryVersion: REDACTION_RECEIPT_RULE_REGISTRY_VERSION,
  },
  policyHash: REDACTION_RECEIPT_POLICY_HASH,
  rule: redactionReceiptRule,
  sourceClass: REDACTION_RECEIPT_SOURCE_CLASS,
  sink: REDACTION_RECEIPT_SINK,
  occurrence: {
    decisionId: REDACTION_RECEIPT_DECISION_ID,
    runId: REDACTION_RECEIPT_RUN_ID,
    graphRevision: REDACTION_RECEIPT_GRAPH_REVISION,
    occurrenceKind: REDACTION_RECEIPT_OCCURRENCE_KIND,
    occurrenceId: REDACTION_RECEIPT_OCCURRENCE_ID,
    occurrenceSequence: REDACTION_RECEIPT_OCCURRENCE_SEQUENCE,
    occurredAt: REDACTION_RECEIPT_OCCURRED_AT,
    fieldPath: REDACTION_RECEIPT_FIELD_PATH,
    ruleResolutionId: REDACTION_RECEIPT_RULE_RESOLUTION_ID,
  },
  scope: {
    tenantScopeId: "tenant-opaque-1",
    authorityProviderId: "provider-opaque-1",
    authoritySubjectId: "subject-opaque-1",
  },
  authorityBindingHash: REDACTION_RECEIPT_AUTHORITY_BINDING_HASH,
  tenantScopeHash: REDACTION_RECEIPT_TENANT_SCOPE_HASH,
  sourceSnapshot: REDACTION_RECEIPT_SOURCE_SNAPSHOT,
};
const redactionBuilt = persistence.buildRedactionReceipt(redactionReceiptRequest);
assert.ok(redactionBuilt.valid, "the shared receipt vector must build on the TypeScript side");
const redactionTamperedResult = JSON.parse(JSON.stringify(redactionBuilt.result));
redactionTamperedResult.public = ["a", "b", "c"];
const redactionTamperedVerification = persistence.verifyRedactionReceipt({
  ...redactionReceiptRequest,
  claimed: redactionBuilt.receipt,
  persistedResult: redactionTamperedResult,
});
const redactionReceiptDocument = JSON.parse(JSON.stringify(redactionBuilt.receipt));
const tsRedactionReceipt = {
  document: redactionReceiptDocument,
  documentFields: Object.keys(redactionReceiptDocument).sort(),
  transformed: JSON.parse(JSON.stringify(redactionBuilt.result)),
  countEqualsPathsLength: redactionBuilt.receipt.count === redactionBuilt.receipt.paths.length,
  strictlyIncreasing: redactionBuilt.receipt.paths.every(
    (path, index) =>
      index === 0 ||
      persistence.compareUnicodeCodePoints(redactionBuilt.receipt.paths[index - 1], path) < 0,
  ),
  structuralVerdict: persistence.validateRedactionReceiptDocument(redactionReceiptDocument).valid,
  verified: persistence.verifyRedactionReceipt({
    ...redactionReceiptRequest,
    claimed: redactionBuilt.receipt,
    persistedResult: redactionBuilt.result,
  }).valid,
  tamperedVerified: redactionTamperedVerification.valid,
  tamperedCode: redactionTamperedVerification.valid
    ? null
    : redactionTamperedVerification.failure.code,
};
assertRedactionEntryAgreement(
  "receipt",
  "<shared vector>",
  [
    "document",
    "documentFields",
    "transformed",
    "countEqualsPathsLength",
    "strictlyIncreasing",
    "structuralVerdict",
    "verified",
    "tamperedVerified",
    "tamperedCode",
  ],
  tsRedactionReceipt,
  pyRedaction.receipt,
);
assert.equal(tsRedactionReceipt.countEqualsPathsLength, true, "receipt: count != paths.length");
assert.equal(
  tsRedactionReceipt.strictlyIncreasing,
  true,
  "receipt: paths are not in strictly increasing code-point order",
);
assert.equal(tsRedactionReceipt.structuralVerdict, true, "receipt: the built receipt is not valid");
assert.equal(tsRedactionReceipt.verified, true, "receipt: the deterministic replay did not verify");
assert.equal(
  tsRedactionReceipt.tamperedVerified,
  false,
  "receipt: a result the receipt does not bind still verified",
);
// The keyed digests are the receipt's MAC content. Both halves computed them
// natively over the same identity key and the same adjacent domain-tagged
// tuples, so equality here is a cross-language MAC equality, not a copied hash.
for (const field of ["sourceHash", "resultHash", "ruleSetHash"]) {
  assert.match(
    tsRedactionReceipt.document[field],
    /^[0-9a-f]{64}$/,
    `receipt.${field} is not a lowercase SHA-256 hex digest`,
  );
  assert.equal(
    tsRedactionReceipt.document[field],
    pyRedaction.receipt.document[field],
    `receipt.${field}: the two lanes computed different keyed digests`,
  );
}
assert.notEqual(
  tsRedactionReceipt.document.sourceHash,
  tsRedactionReceipt.document.resultHash,
  "receipt: the source and result digests are not domain separated",
);

// Every receipt the corpus carries as input, recomputed on both sides.
const tsRedactionCorpusReceipts = {};
for (const wireCase of redactionCorpus.wireCases) {
  const document = wireCase.document;
  if (typeof document !== "object" || document === null || Array.isArray(document)) continue;
  const candidates = [];
  if (wireCase.schema === "redaction-receipt.schema.json") candidates.push([wireCase.id, document]);
  const embedded = document.redactionReceipt;
  if (typeof embedded === "object" && embedded !== null && !Array.isArray(embedded)) {
    candidates.push([`${wireCase.id}#redactionReceipt`, embedded]);
  }
  for (const [label, receipt] of candidates) {
    const paths = receipt.paths;
    tsRedactionCorpusReceipts[label] = {
      count: receipt.count ?? null,
      pathsLength: Array.isArray(paths) ? paths.length : null,
      countEqualsPathsLength: Array.isArray(paths) ? receipt.count === paths.length : false,
      strictlyIncreasing: Array.isArray(paths)
        ? paths.every(
            (path, index) =>
              index === 0 || persistence.compareUnicodeCodePoints(paths[index - 1], path) < 0,
          )
        : null,
      structuralVerdict: persistence.validateRedactionReceiptDocument(receipt).valid,
    };
  }
}
assertRedactionAgreement(
  "corpusReceiptFacts",
  "<labels>",
  "labels",
  Object.keys(tsRedactionCorpusReceipts).sort(),
  Object.keys(pyRedaction.corpusReceiptFacts).sort(),
);
for (const label of Object.keys(tsRedactionCorpusReceipts).sort()) {
  assertRedactionEntryAgreement(
    "corpusReceiptFacts",
    label,
    ["count", "pathsLength", "countEqualsPathsLength", "strictlyIncreasing", "structuralVerdict"],
    tsRedactionCorpusReceipts[label],
    pyRedaction.corpusReceiptFacts[label],
  );
}
const redactionCorpusReceiptCount = Object.keys(tsRedactionCorpusReceipts).length;
assert.ok(
  redactionCorpusReceiptCount > 0,
  "corpusReceiptFacts: the corpus carries no receipt to recompute",
);

// --- 8. the shared seeded-canary vector ------------------------------------
// Both lanes write the same payload with the same canary through their own
// guarded durable path, then each scans its own output bytes.
async function redactionWalkFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await redactionWalkFiles(path)));
      continue;
    }
    found.push(path);
  }
  return found.sort();
}

function redactionSuffix(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

async function redactionScanTree(directory) {
  const files = await redactionWalkFiles(directory);
  const detections = [];
  let bytesScanned = 0;
  for (const path of files) {
    const info = await stat(path);
    if (!info.isFile()) continue;
    const bytes = await readFile(path);
    bytesScanned += bytes.byteLength;
    for (const detection of persistence.scanBytesForCanaries(bytes, [
      { canaryId: REDACTION_CANARY_ID, value: REDACTION_CANARY_VALUE },
    ])) {
      detections.push({
        canaryId: detection.canaryId,
        form: detection.form,
        file: path.slice(directory.length + 1),
      });
    }
  }
  detections.sort((left, right) =>
    left.file === right.file
      ? left.form.localeCompare(right.form)
      : left.file.localeCompare(right.file),
  );
  return {
    filesScanned: files.length,
    bytesScanned,
    detections,
    suffixes: [...new Set(files.map(redactionSuffix))].sort(),
  };
}

/** Every `<name>Mac` beside a `<name>Ref` must equal that ref's `valueMac`. */
function redactionAdjacentMacEqualities(document) {
  const equalities = [];
  const stack = [document];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (typeof current !== "object" || current === null) continue;
    for (const [key, value] of Object.entries(current)) {
      stack.push(value);
      if (!key.endsWith("Ref")) continue;
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const macField = `${key.slice(0, -3)}Mac`;
      if (!Object.hasOwn(current, macField)) continue;
      equalities.push({ refField: key, macField, equal: current[macField] === value.valueMac });
    }
  }
  equalities.sort((left, right) =>
    left.refField === right.refField
      ? left.macField.localeCompare(right.macField)
      : left.refField.localeCompare(right.refField),
  );
  return equalities;
}

const redactionCanaryGuardedDirectory = await mkdtemp(join(tmpdir(), "ge-d9-canary-guarded-"));
const redactionCanaryControlDirectory = await mkdtemp(join(tmpdir(), "ge-d9-canary-control-"));
let tsRedactionCanary;
try {
  const keys = new persistence.DeterministicTestKeyProvider();
  const blobStore = new persistence.FileProtectedPayloadStore({
    directory: join(redactionCanaryGuardedDirectory, "protected"),
  });
  const journal = new persistence.ProtectedJsonlEventStore({
    directory: redactionCanaryGuardedDirectory,
  });
  const guard = new persistence.SinkGuard({
    policy: {
      ...persistence.DEFAULT_CAPTURE_POLICY,
      transformImplementationHash: REDACTION_CANARY_TRANSFORM_HASH,
      ruleRegistryHash: REDACTION_CANARY_REGISTRY_HASH,
      ruleRegistryVersion: 1,
      keyRef: keys.keyRef,
    },
    keys,
    store: blobStore,
    scope: {
      tenantScopeId: "tenant-opaque-1",
      authorityProviderId: "provider-opaque-1",
      authoritySubjectId: "subject-opaque-1",
    },
  });
  const prepared = await persistence.prepareProtectedEvent(guard, journal, {
    decisionId: `decision-${REDACTION_CANARY_RUN_ID}-0`,
    eventId: REDACTION_CANARY_EVENT_ID,
    type: "RunCreated",
    timestamp: REDACTION_CANARY_TIMESTAMP,
    runId: REDACTION_CANARY_RUN_ID,
    graphRevision: REDACTION_CANARY_GRAPH_REVISION,
    sequence: 0,
    sourceClass: "graph-input",
    data: {
      contractVersion: "scheduler-recovery/v1alpha2",
      graphHash: REDACTION_CANARY_GRAPH_HASH,
      implementationHash: REDACTION_CANARY_IMPLEMENTATION_HASH,
      capturePolicyHash: guard.capturePolicyHash,
      protectedStoreContract: "protected-payload-store/v1alpha1",
      keyRefHash: persistence.keyRefHash(keys.keyRef),
      maxTotalAttempts: REDACTION_CANARY_MAX_TOTAL_ATTEMPTS,
    },
    payloads: [
      {
        field: "inputRef",
        macField: "inputMac",
        semanticContext: {
          kind: "graph-input",
          runId: REDACTION_CANARY_RUN_ID,
          graphRevision: REDACTION_CANARY_GRAPH_REVISION,
        },
        value: REDACTION_CANARY_PAYLOAD,
      },
    ],
  });
  assert.equal(
    prepared.kind,
    "prepared",
    "the shared canary payload must pass the TypeScript guard as a prepared write",
  );
  await journal.append(REDACTION_CANARY_RUN_ID, -1, [prepared.prepared]);

  // Read the record back from the bytes that actually reached the sink.
  const journalFiles = (await redactionWalkFiles(redactionCanaryGuardedDirectory)).filter((path) =>
    path.endsWith(".jsonl"),
  );
  assert.equal(journalFiles.length, 1, "the guarded write must produce exactly one journal file");
  const journalLines = (await readFile(journalFiles[0], "utf8")).split("\n").filter((line) => line);
  assert.equal(journalLines.length, 1, "the guarded write must produce exactly one journal record");
  const record = JSON.parse(journalLines[0]);
  const guardedScan = await redactionScanTree(redactionCanaryGuardedDirectory);

  // The positive control: the same payload through the ungated legacy v1alpha1
  // writer this task exists to displace. It writes Tagged Durable JSON verbatim.
  const legacy = new persistence.JsonlEventStore({ directory: redactionCanaryControlDirectory });
  await legacy.append("d9-canary-positive-control", -1, [
    {
      apiVersion: persistence.GRAPH_EVENT_API_VERSION,
      eventId: "evt-0",
      type: "RunCreated",
      timestamp: REDACTION_CANARY_TIMESTAMP,
      runId: "d9-canary-positive-control",
      graphRevision: 1,
      sequence: 0,
      redacted: false,
      data: { input: REDACTION_CANARY_PAYLOAD },
    },
  ]);
  const controlScan = await redactionScanTree(redactionCanaryControlDirectory);

  tsRedactionCanary = {
    canaryId: REDACTION_CANARY_ID,
    canaryValue: REDACTION_CANARY_VALUE,
    record: {
      recordCount: journalLines.length,
      payloadDisposition: record.payloadDisposition ?? null,
      redacted: record.redacted ?? null,
      adjacentMacEqualities: redactionAdjacentMacEqualities(record),
      inlinePayloadFields: Object.keys(record.data ?? {})
        .filter((key) => ["input", "output", "result", "state"].includes(key))
        .sort(),
    },
    guarded: guardedScan,
    positiveControl: controlScan,
    needles: persistence
      .canaryNeedles(REDACTION_CANARY_VALUE)
      .map(({ needle }) => Buffer.from(needle).toString("hex"))
      .sort(),
    needleCount: persistence.canaryNeedles(REDACTION_CANARY_VALUE).length,
  };
} finally {
  await rm(redactionCanaryGuardedDirectory, { recursive: true, force: true });
  await rm(redactionCanaryControlDirectory, { recursive: true, force: true });
}

// The needle sets are compared before the detection counts. Two scanners that
// both report zero because they both look for nothing would otherwise agree.
assertRedactionAgreement(
  "canary",
  "<needles>",
  "needles",
  tsRedactionCanary.needles,
  pyRedaction.canary.needles,
);
assertRedactionAgreement(
  "canary",
  "<needles>",
  "needleCount",
  tsRedactionCanary.needleCount,
  pyRedaction.canary.needleCount,
);
assert.ok(tsRedactionCanary.needleCount >= 8, "canary: fewer than eight encoded forms are checked");
assertRedactionEntryAgreement(
  "canary",
  "<record>",
  ["recordCount", "payloadDisposition", "redacted", "adjacentMacEqualities", "inlinePayloadFields"],
  tsRedactionCanary.record,
  pyRedaction.canary.record,
);
assertRedactionAgreement(
  "canary",
  "<vector>",
  "canaryId",
  tsRedactionCanary.canaryId,
  pyRedaction.canary.canaryId,
);
assertRedactionAgreement(
  "canary",
  "<vector>",
  "canaryValue",
  tsRedactionCanary.canaryValue,
  pyRedaction.canary.canaryValue,
);
for (const [language, canary] of [
  ["TypeScript", tsRedactionCanary],
  ["Python", pyRedaction.canary],
]) {
  // The scan must have had something to look at.
  assert.ok(
    canary.guarded.filesScanned >= 2,
    `canary: the ${language} guarded path produced ${canary.guarded.filesScanned} files to scan`,
  );
  assert.ok(canary.guarded.bytesScanned > 0, `canary: the ${language} guarded scan read no bytes`);
  assert.ok(
    canary.guarded.suffixes.includes(".jsonl"),
    `canary: the ${language} guarded path wrote no journal file`,
  );
  assert.ok(
    canary.guarded.suffixes.includes(".blob"),
    `canary: the ${language} guarded path wrote no protected blob`,
  );
  assert.ok(
    !canary.guarded.suffixes.includes(".tmp"),
    `canary: the ${language} guarded path left a temporary file behind`,
  );
  assert.deepEqual(
    canary.guarded.detections,
    [],
    `canary: the seeded value reached a sink on the ${language} guarded path`,
  );
  // The positive control proves the scanner can in fact see a leak.
  assert.ok(
    canary.positiveControl.detections.length > 0,
    `canary: the ${language} positive control was not detected, so the scan proves nothing`,
  );
  assert.ok(
    canary.positiveControl.detections.every((item) => item.canaryId === REDACTION_CANARY_ID),
    `canary: the ${language} positive control detected some other canary`,
  );
  // Section 3.2, on the record the guarded path actually persisted.
  assert.equal(
    canary.record.payloadDisposition,
    "protected-ref",
    `canary: the ${language} guarded record does not claim protected-ref`,
  );
  assert.equal(
    canary.record.redacted,
    false,
    `canary: the ${language} guarded record claims redaction it did not perform`,
  );
  assert.deepEqual(
    canary.record.inlinePayloadFields,
    [],
    `canary: the ${language} guarded record carries an inline application payload field`,
  );
  assert.ok(
    canary.record.adjacentMacEqualities.length > 0,
    `canary: the ${language} guarded record carries no adjacent MAC to check`,
  );
  for (const equality of canary.record.adjacentMacEqualities) {
    assert.equal(
      equality.equal,
      true,
      `canary: the ${language} record's ${equality.macField} does not equal ${equality.refField}.valueMac`,
    );
  }
}

// --- 9. the 34 wire cases --------------------------------------------------
const REDACTION_WIRE_FIELDS = ["decided", "schema", "verdict", "code", "dispositionFacts"];

/**
 * Decide one wire document with the native TypeScript validators. A schema this
 * lane carries no validator for returns `undefined`, which the join reports as
 * an undecided case rather than quietly dropping it.
 */
function typescriptRedactionWireVerdict(schema, document) {
  switch (schema) {
    case "capture-source.schema.json":
      return { valid: persistence.isCaptureSourceClass(document) };
    case "capture-sink.schema.json":
      return { valid: persistence.isCaptureSinkClass(document) };
    case "capture-policy.schema.json":
      return { valid: persistence.validateCapturePolicy(document).valid };
    case "payload-disposition.schema.json":
      return { valid: persistence.validatePayloadDispositionDocument(document).valid };
    case "protected-value.schema.json":
      return { valid: persistence.validateProtectedValueRefDocument(document).valid };
    case "protected-blob.schema.json":
      return { valid: persistence.validateProtectedBlobDocument(document).valid };
    case "protected-aad.schema.json":
      return { valid: persistence.validateProtectedAadDocument(document).valid };
    case "protected-store-envelope.schema.json":
      return { valid: persistence.validateProtectedStoreEnvelopeDocument(document).valid };
    case "redaction-rule.schema.json":
      return { valid: persistence.validateRedactionRuleDocument(document).valid };
    case "redaction-receipt.schema.json":
      return { valid: persistence.validateRedactionReceiptDocument(document).valid };
    case "sink-guard-decision.schema.json":
      return { valid: persistence.validateSinkGuardDecisionDocument(document).valid };
    case "event-v1alpha2.schema.json":
      return { valid: persistence.validateGraphEventV1Alpha2(document).valid };
    case "checkpoint-v1alpha2.schema.json":
      return { valid: persistence.validateCheckpointV1Alpha2Document(document).valid };
    default:
      return undefined;
  }
}

/** The Section 3.2 facts a document states about itself, read natively. */
function typescriptRedactionDispositionFacts(document) {
  if (typeof document !== "object" || document === null || Array.isArray(document)) return null;
  if (!Object.hasOwn(document, "payloadDisposition") || !Object.hasOwn(document, "redacted")) {
    return null;
  }
  const disposition = document.payloadDisposition;
  const row = persistence.DISPOSITION_TRUTH_TABLE[disposition];
  const facts = {
    disposition,
    documentRedacted: document.redacted,
    inTruthTable: row !== undefined,
  };
  if (row !== undefined) {
    facts.tableRedacted = row.redacted;
    facts.receiptRequired = row.receipt;
  }
  facts.truthTableVerdict = persistence.checkDispositionFacts({
    payloadDisposition: disposition,
    redacted: document.redacted,
    ...(Object.hasOwn(document, "redactionReceipt")
      ? { redactionReceipt: document.redactionReceipt }
      : {}),
  }).valid;
  return facts;
}

const redactionWireCases = redactionSectionCases(
  "wireCases",
  pyRedaction.wireCaseOrder,
  pyRedaction.wireCases,
);
const redactionWireSchemas = new Set();
let redactionWireValid = 0;
let redactionWireInvalid = 0;
for (const testCase of redactionWireCases) {
  const verdict = typescriptRedactionWireVerdict(testCase.schema, testCase.document);
  const tsEntry = {
    decided: verdict !== undefined,
    schema: testCase.schema,
    dispositionFacts: typescriptRedactionDispositionFacts(testCase.document),
  };
  const pyEntry = pyRedaction.wireCases[testCase.id];

  // Decidability is compared before anything else: a case one lane decides and
  // the other does not is exactly the hole this join exists to find.
  if (tsEntry.decided !== pyEntry.decided) {
    throw redactionDivergence(
      "wireCases",
      testCase.id,
      "decided",
      tsEntry.decided
        ? `decided by a native validator for schema '${testCase.schema}'`
        : `<no native validator for schema '${testCase.schema}'>`,
      pyEntry.decided
        ? `decided by a native validator for schema '${testCase.schema}'`
        : `<no native validator for schema '${testCase.schema}'>`,
    );
  }
  if (verdict !== undefined) {
    tsEntry.verdict = verdict.valid;
    // The TypeScript validators return a reason, not a code. The closed code
    // vocabulary is joined separately, and the Python code is checked against
    // the corpus below.
    tsEntry.code = pyEntry.code ?? null;
  }
  assertRedactionEntryAgreement("wireCases", testCase.id, REDACTION_WIRE_FIELDS, tsEntry, pyEntry);

  for (const [language, entry] of [["TypeScript", tsEntry], ["Python", pyEntry]]) {
    assert.equal(entry.verdict, testCase.valid, `${testCase.id}: ${language} schema verdict`);
    if (entry.dispositionFacts !== null) {
      assert.equal(
        entry.dispositionFacts.inTruthTable,
        true,
        `${testCase.id}: ${language} names a disposition outside the truth table`,
      );
      assert.equal(
        entry.dispositionFacts.disposition,
        testCase.document.payloadDisposition,
        `${testCase.id}: ${language} read a different disposition than the document states`,
      );
      assert.equal(
        entry.dispositionFacts.documentRedacted,
        testCase.document.redacted,
        `${testCase.id}: ${language} read a different redacted flag than the document states`,
      );
      // Section 3.2: a document whose flag contradicts its disposition can never
      // be a valid record, whatever else the schema says.
      if (entry.dispositionFacts.documentRedacted !== entry.dispositionFacts.tableRedacted) {
        assert.equal(
          entry.verdict,
          false,
          `${testCase.id}: ${language} accepted a record whose redacted flag contradicts its disposition`,
        );
      }
    }
  }
  if (pyEntry.code !== null && pyEntry.code !== undefined) {
    assert.equal(
      pyEntry.code,
      testCase.expectedCode,
      `${testCase.id}: the rejection code differs from the corpus`,
    );
    assert.ok(
      tsRedactionNative.failureCodes.includes(pyEntry.code),
      `${testCase.id}: rejected with a code outside the closed vocabulary`,
    );
  }
  redactionWireSchemas.add(testCase.schema);
  if (testCase.valid) redactionWireValid += 1;
  else redactionWireInvalid += 1;
}
const redactionDispositionWireCases = redactionWireCases.filter(
  (item) => pyRedaction.wireCases[item.id].dispositionFacts !== null,
);
assert.ok(
  redactionDispositionWireCases.length > 0,
  "wireCases: no case states a disposition, so the truth table is unwitnessed",
);
assert.ok(redactionWireValid > 0, "wireCases: no accepted document was compared");
assert.ok(redactionWireInvalid > 0, "wireCases: no rejected document was compared");

process.stdout.write(
  `Cross-language redaction conformance passed for ${redactionPointerCases.length} pointer cases (${redactionPointerAccepted} transforms, ${redactionPointerRejected} rejections over ${redactionPointerCodesSeen.size} code), ${redactionWireCases.length} wire cases over ${redactionWireSchemas.size} schemas (${redactionWireValid} valid, ${redactionWireInvalid} rejected, ${redactionDispositionWireCases.length} disposition/redacted pairs), ${redactionFlowCases.length} flow cases (${redactionFlowAuthorized} authorized, ${redactionFlowDenied} denied) over the complete ${tsRedactionCartesian.pairCount}-pair Cartesian domain of ${tsRedactionNative.sourceRuleCount} sources x ${tsRedactionNative.sinkRuleCount} sinks (outcome digest ${tsRedactionCartesian.outcomeDigest.slice(0, 16)}), ${redactionCorpusReceiptCount + 1} receipts bound by count/order/MAC, the ${tsRedactionNative.failureCodes.length}-code vocabulary and the ${tsRedactionNative.payloadDispositions.length}-row disposition truth table, and one seeded canary scanned over ${tsRedactionCanary.guarded.filesScanned}/${pyRedaction.canary.guarded.filesScanned} files and ${tsRedactionCanary.guarded.bytesScanned}/${pyRedaction.canary.guarded.bytesScanned} bytes with 0 detections against ${tsRedactionCanary.positiveControl.detections.length}/${pyRedaction.canary.positiveControl.detections.length} positive-control detections; implementationClaim ${JSON.stringify(redactionCorpus.implementationClaim)}.\n`,
);

// ---------------------------------------------------------------------------
// D13 adapter cross-language join (D13-ADAPTERS-049).
//
// Both languages implemented `adapter-contract/v1alpha1` natively and
// independently, and each was measured against `spec/conformance/adapter.case.json`
// alone. Until this block ran they had never been compared to each other. That
// is the exact shape of defect this session has already found four times: two
// green single-language suites, one silent fork. For adapters the fork is
// operational — a graph runs against the TypeScript mock and behaves one way,
// runs against the Python mock and behaves another, and the corpus is satisfied
// both times.
//
// Neither half may read the other's expected values. The TypeScript half below
// is computed only from `@graph-engineering/adapters`; the Python half is
// computed by tools/conformance/python_adapter_report.py from the native
// `graph_engineering.adapters` package. Both halves are driven through their
// package's public export surface — `validateDescriptor`, `preflight`,
// `normalizeStream`, `validateUsage`, `validateToolCalls`,
// `validateErrorEnvelope`, `retryDecision`, `circuitFold` — and through the
// real public adapter object (`createMockAdapter(...).call(...)`), never
// through a private rule function.
//
// The two natives are compared to each other first, member for member,
// including the rule identifier produced for every single case. A rule
// shadowed by a neighbour that reports the same portable code is invisible to
// a code-only comparison: fourteen codes cannot distinguish 131 rules, which is
// why `D4` had to disclose that failure mode and `isolation` solved it with
// reason tags. Only after the natives agree is either compared to the corpus.
//
// No network, no subprocess beyond the one `uv` invocation that produces the
// Python half, and no wall clock: every clock reading in this join is an
// injected integer.
const adapterDist = await import(
  pathToFileURL(join(root, "packages", "adapters", "dist", "index.js")).href
);
const adapterCorpus = JSON.parse(
  await readFile(join(fixtureRoot, "adapter.case.json"), "utf8"),
);

// --- shared vectors -------------------------------------------------------
// Restated here exactly as the Python report states them. They are inputs, not
// expectations: no expected output is written down on either side, and the
// join asserts the two statements equal before either is used.
//
// `mock-full` is the only shipped descriptor that declares `fault-injection`,
// `provider-request-id` and `retry-after-hint` together, so it is the only one
// that can inject every code and still carry a provider identity and a hint.
const ADAPTER_PROBE_DESCRIPTOR = "mock-full";
const ADAPTER_PROBE_RETRY_AFTER_MS = 250;
const ADAPTER_PROBE_CLOCK_MS = [0, 10, 20];
const ADAPTER_CASE_SECTIONS = [
  "descriptorCases",
  "preflightCases",
  "streamCases",
  "usageCases",
  "toolCases",
  "errorCases",
  "retryCases",
  "circuitCases",
];
// The closed vocabularies this contract freezes. Stated as sizes only; the
// members themselves are read from each native package and compared to each
// other and then to the corpus inventories.
const ADAPTER_VOCABULARY_SIZES = {
  adapterCapabilities: 16,
  adapterErrorCodes: 14,
  adapterKinds: 8,
  denialReasons: 11,
  finishReasons: 5,
  reportableResources: 9,
};
// The recomputed taxonomy shape and the in-doubt matrix size.
const ADAPTER_RETRYABLE_CODES = 4;
const ADAPTER_PRE_DISPATCH_CODES = 5;
const ADAPTER_CYCLE_MATRIX_ROWS = 9;

/**
 * Render a value for a divergence message with object keys sorted, so the two
 * halves are compared by the reader on content rather than on the key order
 * their respective JSON transports happened to use. Array order is preserved
 * because array order is part of what this join defends.
 */
function adapterStringify(value) {
  if (Array.isArray(value)) return `[${value.map(adapterStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${adapterStringify(value[key])}`)
      .join(",")}}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function adapterDivergence(section, caseName, field, tsValue, pyValue) {
  return new Error(
    `Adapter cross-language divergence in ${section} case '${caseName}',`
      + ` field '${field}': TypeScript ${adapterStringify(tsValue)}`
      + ` vs Python ${adapterStringify(pyValue)}`,
  );
}

function assertAdapterAgreement(section, caseName, field, tsValue, pyValue) {
  if (!isDeepStrictEqual(tsValue, pyValue)) {
    throw adapterDivergence(section, caseName, field, tsValue, pyValue);
  }
}

/** Compare one projected entry field by field, including the reported key set. */
function assertAdapterEntryAgreement(section, caseName, fields, tsEntry, pyEntry) {
  for (const field of fields) {
    const tsHas = Object.hasOwn(tsEntry, field);
    const pyHas = Object.hasOwn(pyEntry, field);
    if (tsHas !== pyHas) {
      throw adapterDivergence(
        section,
        caseName,
        field,
        tsHas ? tsEntry[field] : "<field absent>",
        pyHas ? pyEntry[field] : "<field absent>",
      );
    }
    if (tsHas) assertAdapterAgreement(section, caseName, field, tsEntry[field], pyEntry[field]);
  }
  assertAdapterAgreement(
    section,
    caseName,
    "reportedFieldSet",
    Object.keys(tsEntry).sort(),
    Object.keys(pyEntry).sort(),
  );
}

// --- the TypeScript half, computed only from @graph-engineering/adapters ----

const adapterClone = (value) => structuredClone(value);

function adapterPointerSegments(pointer) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`JSON Pointer must be empty or start with '/': ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/**
 * The corpus mutation language. This is corpus input handling, not an
 * expectation: a mutation says what to feed the engine, never what the engine
 * should answer.
 */
function adapterApplyMutations(document, mutations) {
  for (const mutation of mutations ?? []) {
    const segments = adapterPointerSegments(mutation.path);
    const leaf = segments.pop();
    if (leaf === undefined) throw new Error(`root mutation is not supported: ${mutation.path}`);
    let parent = document;
    for (const segment of segments) {
      if (parent === null || typeof parent !== "object") {
        throw new Error(`mutation parent does not exist: ${mutation.path}`);
      }
      parent = parent[segment];
    }
    if (parent === null || typeof parent !== "object") {
      throw new Error(`mutation parent does not exist: ${mutation.path}`);
    }
    if (mutation.op === "remove") {
      if (Array.isArray(parent)) parent.splice(Number(leaf), 1);
      else delete parent[leaf];
      continue;
    }
    const value = adapterClone(mutation.value);
    if (mutation.op === "add") {
      if (Array.isArray(parent)) parent.splice(Number(leaf), 0, value);
      else parent[leaf] = value;
      continue;
    }
    if (mutation.op !== "replace") throw new Error(`unknown mutation op: ${mutation.op}`);
    parent[leaf] = value;
  }
  return document;
}

function adapterDescriptorDocument(adapterId) {
  const found = adapterCorpus.descriptors.find((item) => item.adapterId === adapterId);
  if (found === undefined) throw new Error(`unknown corpus descriptor '${adapterId}'`);
  return adapterClone(found);
}
const adapterDescriptorFor = (adapterId, mutations) =>
  adapterApplyMutations(adapterDescriptorDocument(adapterId), mutations);
const adapterRequestFrom = (mutations) =>
  adapterApplyMutations(adapterClone(adapterCorpus.requestTemplate), mutations);
const ADAPTER_POLICY_METRICS = adapterCorpus.budgetPolicyAllowedProviderMetrics;
const ADAPTER_FORBIDDEN_MARKERS = adapterCorpus.forbiddenMarkers;

/** Every rule identifier the TypeScript half produced, and every code. */
const adapterExercised = new Set();
const adapterObservedCodes = new Set();
const adapterObservedDenials = new Set();

/**
 * Run one public-surface call and project what it decided. A rejection is the
 * `AdapterContractError` the surface throws; nothing else is caught, so a
 * corpus defect can never be laundered into a contract verdict.
 */
function adapterObserve(run) {
  try {
    const projection = run();
    return {
      accepted: true,
      code: null,
      denialReason: null,
      message: null,
      projection,
      rule: null,
    };
  } catch (error) {
    if (!adapterDist.isAdapterContractError(error)) throw error;
    adapterExercised.add(error.rule);
    adapterObservedCodes.add(error.code);
    if (error.denialReason !== null) adapterObservedDenials.add(error.denialReason);
    return {
      accepted: false,
      code: error.code,
      denialReason: error.denialReason,
      message: error.message,
      projection: null,
      rule: error.rule,
    };
  }
}

// TypeScript spells an absent optional `undefined` and Python spells it
// `null`. Normalizing here is a transport concern only: every projection below
// names its fields explicitly, so an absent member can never be confused with a
// member that is present and null.
const adapterNz = (value) => (value === undefined ? null : value);
const adapterProjQuantity = (item) => ({
  resource: item.resource,
  unit: item.unit,
  aggregation: item.aggregation,
  amount: item.amount,
});
const adapterProjProviderQuantity = (item) => ({
  metricId: item.metricId,
  unitId: item.unitId,
  aggregation: item.aggregation,
  amount: item.amount,
});
const adapterProjUsage = (usage) =>
  usage === null || usage === undefined
    ? null
    : {
        apiVersion: usage.apiVersion,
        kind: usage.kind,
        contractVersion: usage.contractVersion,
        adapterId: usage.adapterId,
        adapterKind: usage.adapterKind,
        requestId: usage.requestId,
        providerRequestId: adapterNz(usage.providerRequestId),
        trust: usage.trust,
        budgetCostState: usage.budgetCostState,
        finishReason: adapterNz(usage.finishReason),
        quantities: usage.quantities.map(adapterProjQuantity),
        providerSpecific: usage.providerSpecific.map(adapterProjProviderQuantity),
      };
const adapterProjStream = (value) =>
  value === null || value === undefined
    ? null
    : {
        frames: value.frames,
        textBytes: value.textBytes,
        toolCalls: value.toolCalls,
        usageFrames: value.usageFrames,
        finishReason: adapterNz(value.finishReason),
      };
const adapterProjFrame = (frame) => {
  const document = { sequence: frame.sequence, kind: frame.kind, bytes: frame.bytes };
  if (frame.toolCallId !== undefined && frame.toolCallId !== null) {
    document.toolCallId = frame.toolCallId;
  }
  if (frame.finishReason !== undefined && frame.finishReason !== null) {
    document.finishReason = frame.finishReason;
  }
  return document;
};
const adapterProjEnvelope = (error) => ({
  apiVersion: error.apiVersion,
  kind: error.kind,
  contractVersion: error.contractVersion,
  adapterId: error.adapterId,
  adapterKind: error.adapterKind,
  requestId: error.requestId,
  attempt: error.attempt,
  code: error.code,
  boundary: error.boundary,
  retryable: error.retryable,
  effectDisposition: error.effectDisposition,
  usageDisposition: error.usageDisposition,
  sideEffectClass: error.sideEffectClass,
  denialReason: adapterNz(error.denialReason),
  providerRequestId: adapterNz(error.providerRequestId),
  retryAfterMs: adapterNz(error.retryAfterMs),
  message: error.message,
  detail: {
    providerSafeFields: error.detail.providerSafeFields.map((field) => ({
      name: field.name,
      value: field.value,
    })),
  },
  usage: adapterProjUsage(error.usage),
});
const adapterProjOutcome = (outcome) =>
  outcome.ok
    ? {
        ok: true,
        requestId: outcome.value.requestId,
        providerRequestId: adapterNz(outcome.value.providerRequestId),
        finishReason: outcome.value.finishReason,
        text: outcome.value.text,
        toolCalls: outcome.value.toolCalls.map((call) => call.id),
        usage: adapterProjUsage(outcome.value.usage),
        normalizedStream: adapterProjStream(outcome.value.normalizedStream),
      }
    : { ok: false, error: adapterProjEnvelope(outcome.error) };

const tsAdapterSections = {};

tsAdapterSections.descriptorCases = {};
for (const testCase of adapterCorpus.descriptorCases) {
  const candidate = adapterDescriptorFor(testCase.base, testCase.mutations);
  tsAdapterSections.descriptorCases[testCase.id] = adapterObserve(() => {
    adapterDist.validateDescriptor(candidate);
    adapterDist.validateDescriptorAgainstBudgetPolicy(candidate, ADAPTER_POLICY_METRICS);
    return { valid: true };
  });
}

tsAdapterSections.preflightCases = {};
for (const testCase of adapterCorpus.preflightCases) {
  const descriptor = adapterDescriptorFor(testCase.descriptor, testCase.descriptorMutations);
  const request = adapterRequestFrom(testCase.requestMutations);
  tsAdapterSections.preflightCases[testCase.id] = adapterObserve(() => {
    const outcome = adapterDist.preflight(descriptor, request, ADAPTER_POLICY_METRICS);
    return {
      admitted: outcome.admitted,
      adapterId: outcome.adapterId,
      requestId: outcome.requestId,
      sideEffectClass: outcome.sideEffectClass,
      idempotencyKey: adapterNz(outcome.idempotencyKey),
    };
  });
}

tsAdapterSections.streamCases = {};
for (const testCase of adapterCorpus.streamCases) {
  const descriptor = adapterDescriptorFor(testCase.descriptor, testCase.descriptorMutations);
  const frames = adapterApplyMutations(
    adapterClone(adapterCorpus.streamTemplate),
    testCase.mutations,
  );
  tsAdapterSections.streamCases[testCase.id] = adapterObserve(() =>
    adapterProjStream(adapterDist.normalizeStream(descriptor, frames)),
  );
}

tsAdapterSections.usageCases = {};
for (const testCase of adapterCorpus.usageCases) {
  const descriptor = adapterDescriptorFor(testCase.descriptor, testCase.descriptorMutations);
  const usage = adapterApplyMutations(
    adapterClone(adapterCorpus.usageTemplate),
    testCase.mutations,
  );
  tsAdapterSections.usageCases[testCase.id] = adapterObserve(() => {
    const summary = adapterDist.validateUsage(descriptor, usage);
    return {
      resources: summary.resources,
      providerCalls: adapterNz(summary.providerCalls),
      budgetCostState: summary.budgetCostState,
    };
  });
}

tsAdapterSections.toolCases = {};
for (const testCase of adapterCorpus.toolCases) {
  const descriptor = adapterDescriptorFor(testCase.descriptor, testCase.descriptorMutations);
  const request = adapterRequestFrom(testCase.requestMutations);
  const response = adapterApplyMutations(
    adapterClone(adapterCorpus.toolResponseTemplate),
    testCase.mutations,
  );
  tsAdapterSections.toolCases[testCase.id] = adapterObserve(() => {
    const summary = adapterDist.validateToolCalls(descriptor, request, response);
    return { toolCalls: summary.toolCalls, responseToolCalls: response.toolCalls.length };
  });
}

tsAdapterSections.errorCases = {};
for (const testCase of adapterCorpus.errorCases) {
  const descriptor = adapterDescriptorFor(testCase.descriptor, testCase.descriptorMutations);
  const envelope = adapterApplyMutations(
    adapterClone(adapterCorpus.errorTemplate),
    testCase.mutations,
  );
  const entry = adapterObserve(() => {
    const summary = adapterDist.validateErrorEnvelope(
      descriptor,
      envelope,
      ADAPTER_FORBIDDEN_MARKERS,
    );
    return {
      code: summary.code,
      ledgerAction: summary.ledgerAction,
      requiresInDoubtRecord: summary.requiresInDoubtRecord,
    };
  });
  // An accepted envelope still witnesses its own code: the closed taxonomy is
  // covered by acceptances as well as by rejections.
  entry.envelopeCode = envelope.code;
  if (entry.accepted) adapterObservedCodes.add(envelope.code);
  tsAdapterSections.errorCases[testCase.id] = entry;
}

tsAdapterSections.retryCases = {};
for (const testCase of adapterCorpus.retryCases) {
  const descriptor = adapterDescriptorFor(testCase.descriptor, testCase.descriptorMutations);
  const decision = adapterDist.retryDecision(
    descriptor,
    testCase.code,
    testCase.sideEffectClass,
    testCase.attempt,
    testCase.retryAfterMs,
  );
  adapterExercised.add(decision.rule);
  tsAdapterSections.retryCases[testCase.id] = {
    decision: {
      mayRetry: decision.mayRetry,
      backoffMs: adapterNz(decision.backoffMs),
      rule: decision.rule,
    },
    rule: decision.rule,
    computedBackoffMs: adapterDist.computedBackoffMs(descriptor.retryPolicy, testCase.attempt),
    retryableByCode: adapterDist.taxonomyFacts(testCase.code).retryable,
  };
}

tsAdapterSections.circuitCases = {};
for (const testCase of adapterCorpus.circuitCases) {
  const descriptor = adapterDescriptorFor(testCase.descriptor);
  const projection = adapterDist.circuitFold(descriptor, testCase.script);
  for (const rule of testCase.rules) adapterExercised.add(String(rule));
  tsAdapterSections.circuitCases[testCase.id] = {
    projection: {
      state: projection.state,
      consecutiveFailures: projection.consecutiveFailures,
      openedAtMs: adapterNz(projection.openedAtMs),
      admitted: projection.admitted,
      refused: projection.refused,
    },
    rules: testCase.rules.map(String),
    steps: testCase.script.length,
  };
}

const tsAdapterVocabularies = {
  adapterCapabilities: [...adapterDist.ADAPTER_CAPABILITIES],
  adapterErrorCodes: [...adapterDist.ADAPTER_ERROR_CODES],
  adapterKinds: [...adapterDist.ADAPTER_KINDS],
  denialReasons: [...adapterDist.DENIAL_REASONS],
  finishReasons: [...adapterDist.FINISH_REASONS],
  modelAdapterKinds: [...adapterDist.MODEL_ADAPTER_KINDS],
  reportableResources: [...adapterDist.REPORTABLE_RESOURCES],
  resourceUnits: Object.fromEntries(
    Object.keys(adapterDist.RESOURCE_UNITS)
      .sort()
      .map((key) => [key, adapterDist.RESOURCE_UNITS[key]]),
  ),
  sideEffectOrder: [...adapterDist.SIDE_EFFECT_ORDER],
  streamFrameKinds: [...adapterDist.STREAM_FRAME_KINDS],
  usageUnitResources: [...adapterDist.USAGE_UNIT_RESOURCES],
  capabilityImplications: adapterDist.CAPABILITY_IMPLICATIONS.map((row) => ({
    rule: row.rule,
    capability: row.capability,
    requires: row.requires,
  })),
  mockOnlyCapabilities: adapterDist.MOCK_ONLY_CAPABILITIES.map((row) => ({
    rule: row.rule,
    capability: row.capability,
  })),
  capabilityGatedResources: adapterDist.CAPABILITY_GATED_RESOURCES.map((row) => ({
    rule: row.rule,
    resource: row.resource,
    capability: row.capability,
  })),
  sortedByCodePoint: {
    adapterCapabilities: adapterDist.isSortedByCodePoint(adapterDist.ADAPTER_CAPABILITIES),
    adapterErrorCodes: adapterDist.isSortedByCodePoint(adapterDist.ADAPTER_ERROR_CODES),
    adapterKinds: adapterDist.isSortedByCodePoint(adapterDist.ADAPTER_KINDS),
    denialReasons: adapterDist.isSortedByCodePoint(adapterDist.DENIAL_REASONS),
    finishReasons: adapterDist.isSortedByCodePoint(adapterDist.FINISH_REASONS),
    reportableResources: adapterDist.isSortedByCodePoint(adapterDist.REPORTABLE_RESOURCES),
  },
  counts: {
    adapterCapabilities: adapterDist.ADAPTER_CAPABILITIES.length,
    adapterErrorCodes: adapterDist.ADAPTER_ERROR_CODES.length,
    adapterKinds: adapterDist.ADAPTER_KINDS.length,
    denialReasons: adapterDist.DENIAL_REASONS.length,
    finishReasons: adapterDist.FINISH_REASONS.length,
    reportableResources: adapterDist.REPORTABLE_RESOURCES.length,
  },
};

// The taxonomy is recomputed from the code alone: retryability, boundary and
// effect disposition are properties of the code, and usage disposition and
// ledger action are derived. Nothing here reads `corpus.errorTaxonomy`.
const tsAdapterTaxonomyRows = [];
let tsAdapterRetryable = 0;
let tsAdapterPreDispatch = 0;
for (const code of adapterDist.ADAPTER_ERROR_CODES) {
  const facts = adapterDist.taxonomyFacts(code);
  const table = adapterDist.TAXONOMY_FACTS[code];
  assert.deepEqual(
    { boundary: facts.boundary, retryable: facts.retryable, effect: facts.effectDisposition },
    { boundary: table.boundary, retryable: table.retryable, effect: table.effectDisposition },
    `${code}: the TypeScript accessor disagrees with the TypeScript table`,
  );
  const usageDisposition = adapterDist.deriveUsageDisposition(facts.effectDisposition);
  tsAdapterTaxonomyRows.push({
    code,
    boundary: facts.boundary,
    retryable: facts.retryable,
    effectDisposition: facts.effectDisposition,
    usageDisposition,
    ledgerAction: adapterDist.deriveLedgerAction(usageDisposition),
  });
  if (facts.retryable) tsAdapterRetryable += 1;
  if (facts.boundary === "pre-dispatch") tsAdapterPreDispatch += 1;
}

const tsAdapterCycleMatrix = [];
for (const disposition of ["applied", "in-doubt", "not-applied"]) {
  for (const sideEffectClass of adapterDist.SIDE_EFFECT_ORDER) {
    tsAdapterCycleMatrix.push({
      effectDisposition: disposition,
      recordsInDoubtIdentity: adapterDist.requiresInDoubtRecord(disposition, sideEffectClass),
      retryPermittedBySideEffect: adapterDist.sideEffectPermitsRetry(disposition, sideEffectClass),
      sideEffectClass,
    });
  }
}

const tsAdapterCostStates = [
  ...new Set(adapterCorpus.budgetComposition.costStateBindings.map((row) => String(row.trust))),
]
  .sort()
  .map((trust) => ({ trust, budgetCostState: adapterDist.deriveBudgetCostState(trust) }));

const tsAdapterDescriptorInventory = {};
for (const document of adapterCorpus.descriptors) {
  const descriptor = adapterDescriptorFor(document.adapterId);
  tsAdapterDescriptorInventory[document.adapterId] = {
    adapterKind: descriptor.adapterKind,
    capabilities: [...descriptor.capabilities],
    evidenceClass: descriptor.evidenceClass,
    sideEffectClass: descriptor.sideEffectClass,
    valid: adapterDist.validateDescriptor(descriptor),
    budgetPolicyValid: adapterDist.validateDescriptorAgainstBudgetPolicy(
      descriptor,
      ADAPTER_POLICY_METRICS,
    ),
    // Each language proves the descriptor survived its own reader. Python's is
    // a real parser; TypeScript's is structural, so this member is a floor on
    // both sides rather than a claim that the two readers are equally strict.
    roundTrips:
      JSON.stringify(descriptor) === JSON.stringify(adapterDescriptorDocument(document.adapterId)),
  };
}

// --- the real public adapter object ---------------------------------------
// Everything above decides; this dispatches. A validator-only join cannot ask
// whether a code is injectable at all, and injectability is exactly where the
// two mocks were already suspected of diverging.
const tsAdapterMockDispatch = {};
for (const code of adapterDist.ADAPTER_ERROR_CODES) {
  const facts = adapterDist.taxonomyFacts(code);
  const adapter = adapterDist.createMockAdapter({
    descriptor: adapterDescriptorFor(ADAPTER_PROBE_DESCRIPTOR),
    script: [
      {
        fail: code,
        ...(facts.retryable ? { retryAfterMs: ADAPTER_PROBE_RETRY_AFTER_MS } : {}),
        // A denial reason is meaningful on exactly one code. The mock must be
        // able to carry it, or GE_ADAPTER_POLICY_DENIED is not injectable at
        // all and every consumer of the mock is untested against it.
        ...(code === "GE_ADAPTER_POLICY_DENIED"
          ? { denialReason: adapterDist.DENIAL_REASONS[0] }
          : {}),
      },
    ],
    budgetPolicyAllowedProviderMetrics: ADAPTER_POLICY_METRICS,
    forbiddenMarkers: ADAPTER_FORBIDDEN_MARKERS,
  });
  const entry = adapterProjOutcome(await adapter.call(adapterRequestFrom()));
  entry.injectableAsRequested = entry.ok === false && entry.error.code === code;
  tsAdapterMockDispatch[code] = entry;
}

const tsAdapterPolicyDeniedEntry = tsAdapterMockDispatch.GE_ADAPTER_POLICY_DENIED;
const tsAdapterPolicyDenied = {
  requestedCode: "GE_ADAPTER_POLICY_DENIED",
  requestedDenialReason: adapterDist.DENIAL_REASONS[0],
  observedCode: tsAdapterPolicyDeniedEntry.error?.code ?? null,
  observedDenialReason: tsAdapterPolicyDeniedEntry.error?.denialReason ?? null,
  observedMessage: tsAdapterPolicyDeniedEntry.error?.message ?? null,
  injectable: tsAdapterPolicyDeniedEntry.error?.code === "GE_ADAPTER_POLICY_DENIED",
  // Whether the public scripted-outcome type declares the denial-reason member
  // that makes the code injectable. Observed rather than asserted, and observed
  // the only way a language with erased types can observe it: the scripted
  // reason survived into the envelope, which is impossible unless the member
  // exists and is passed through. The two halves spell the member differently
  // (`denialReason` / `denial_reason`), so the join compares the fact and not
  // the identifier.
  declaresDenialReasonMember:
    tsAdapterPolicyDeniedEntry.error?.denialReason === adapterDist.DENIAL_REASONS[0],
};

const tsAdapterPlainAdapter = adapterDist.createMockAdapter({
  descriptor: adapterDescriptorFor(ADAPTER_PROBE_DESCRIPTOR),
  budgetPolicyAllowedProviderMetrics: ADAPTER_POLICY_METRICS,
  forbiddenMarkers: ADAPTER_FORBIDDEN_MARKERS,
});
const tsAdapterStreamAdapter = adapterDist.createMockAdapter({
  descriptor: adapterDescriptorFor(ADAPTER_PROBE_DESCRIPTOR),
  budgetPolicyAllowedProviderMetrics: ADAPTER_POLICY_METRICS,
  forbiddenMarkers: ADAPTER_FORBIDDEN_MARKERS,
});
const tsAdapterStreamHandle = tsAdapterStreamAdapter.stream(
  adapterRequestFrom([{ op: "replace", path: "/streaming", value: true }]),
);
const tsAdapterStreamFrames = [];
for await (const frame of tsAdapterStreamHandle.frames) {
  tsAdapterStreamFrames.push(adapterProjFrame(frame));
}
const tsAdapterMockSuccess = {
  call: adapterProjOutcome(await tsAdapterPlainAdapter.call(adapterRequestFrom())),
  stream: {
    outcome: adapterProjOutcome(await tsAdapterStreamHandle.completion),
    frames: tsAdapterStreamFrames,
  },
};

const tsAdapterMockCircuit = {
  clockReadings: [...ADAPTER_PROBE_CLOCK_MS],
  projection: (() => {
    const projection = adapterDist.circuitFold(
      adapterDescriptorFor(ADAPTER_PROBE_DESCRIPTOR),
      ADAPTER_PROBE_CLOCK_MS.map((nowMs) => ({
        event: "failure",
        nowMs,
        code: "GE_ADAPTER_TIMEOUT",
      })),
    );
    return {
      state: projection.state,
      consecutiveFailures: projection.consecutiveFailures,
      openedAtMs: adapterNz(projection.openedAtMs),
      admitted: projection.admitted,
      refused: projection.refused,
    };
  })(),
};

const adapterRegistered = [
  ...new Set(adapterCorpus.ruleRegister.map((row) => String(row.rule))),
].sort();
const tsAdapterExercised = [...adapterExercised].sort();
const tsAdapterRegister = {
  registeredCount: adapterRegistered.length,
  exercised: tsAdapterExercised,
  exercisedCount: tsAdapterExercised.length,
  missing: adapterRegistered.filter((rule) => !adapterExercised.has(rule)),
  stray: tsAdapterExercised.filter((rule) => !adapterRegistered.includes(rule)),
};

const tsAdapter = {
  apiVersion: adapterCorpus.apiVersion,
  kind: adapterCorpus.kind,
  contractVersion: adapterCorpus.contractVersion,
  contractStatus: adapterCorpus.contractStatus,
  implementationClaim: adapterCorpus.implementationClaim,
  evidenceClass: adapterCorpus.evidenceClass,
  environmentAssertions: adapterCorpus.environmentAssertions,
  declaredCounts: adapterCorpus.declaredCounts,
  observedCounts: {
    circuitCases: adapterCorpus.circuitCases.length,
    descriptorCases: adapterCorpus.descriptorCases.length,
    descriptors: adapterCorpus.descriptors.length,
    errorCases: adapterCorpus.errorCases.length,
    preflightCases: adapterCorpus.preflightCases.length,
    retryCases: adapterCorpus.retryCases.length,
    rules: adapterCorpus.ruleRegister.length,
    schemaNegativeCases: adapterCorpus.schemaNegativeCases.length,
    streamCases: adapterCorpus.streamCases.length,
    toolCases: adapterCorpus.toolCases.length,
    usageCases: adapterCorpus.usageCases.length,
  },
  caseSections: ADAPTER_CASE_SECTIONS,
  caseOrder: Object.fromEntries(
    ADAPTER_CASE_SECTIONS.map((section) => [
      section,
      adapterCorpus[section].map((item) => String(item.id)),
    ]),
  ),
  probeVectors: {
    descriptor: ADAPTER_PROBE_DESCRIPTOR,
    retryAfterMs: ADAPTER_PROBE_RETRY_AFTER_MS,
    clockReadings: [...ADAPTER_PROBE_CLOCK_MS],
    denialReason: adapterDist.DENIAL_REASONS[0],
  },
  vocabularies: tsAdapterVocabularies,
  taxonomy: {
    rows: tsAdapterTaxonomyRows,
    retryableCount: tsAdapterRetryable,
    preDispatchCount: tsAdapterPreDispatch,
  },
  cycleMatrix: tsAdapterCycleMatrix,
  costStateBindings: tsAdapterCostStates,
  descriptorInventory: tsAdapterDescriptorInventory,
  sections: tsAdapterSections,
  mockDispatch: tsAdapterMockDispatch,
  mockPolicyDenied: tsAdapterPolicyDenied,
  mockSuccess: tsAdapterMockSuccess,
  mockCircuit: tsAdapterMockCircuit,
  ruleRegister: tsAdapterRegister,
  codesObserved: [...adapterObservedCodes].sort(),
  denialReasonsObserved: [...adapterObservedDenials].sort(),
};

// --- the Python half -------------------------------------------------------

const pythonAdapter = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/python_adapter_report.py"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (pythonAdapter.status !== 0) {
  throw new Error(
    `Python adapter conformance failed:\n${pythonAdapter.stderr || pythonAdapter.stdout}`,
  );
}
const pyAdapter = JSON.parse(pythonAdapter.stdout);

// --- 1. the two halves agree on what they read and on the vectors ----------
for (const field of [
  "apiVersion",
  "kind",
  "contractVersion",
  "contractStatus",
  "evidenceClass",
]) {
  assertAdapterAgreement("corpus", "<header>", field, tsAdapter[field], pyAdapter[field]);
}
// Each process read the flag from the corpus itself, so this is a two-reader
// assertion rather than a restatement of one read. This lane never flips it.
assert.strictEqual(
  adapterCorpus.implementationClaim,
  false,
  "adapter implementationClaim is not literally false in the Node-side read",
);
assert.strictEqual(
  pyAdapter.implementationClaim,
  false,
  "adapter implementationClaim is not literally false in the Python-side read",
);
assertAdapterAgreement(
  "corpus",
  "<header>",
  "environmentAssertions",
  tsAdapter.environmentAssertions,
  pyAdapter.environmentAssertions,
);
// injectedClockOnly and networkAccess are the two the join itself depends on.
assert.strictEqual(
  adapterCorpus.environmentAssertions.injectedClockOnly,
  true,
  "adapter corpus does not assert injected-clock-only evidence",
);
assert.strictEqual(
  adapterCorpus.environmentAssertions.networkAccess,
  false,
  "adapter corpus does not assert the absence of network access",
);
assertAdapterAgreement(
  "corpus",
  "<vectors>",
  "probeVectors",
  tsAdapter.probeVectors,
  pyAdapter.probeVectors,
);
assertAdapterAgreement(
  "corpus",
  "<vectors>",
  "caseSections",
  tsAdapter.caseSections,
  pyAdapter.caseSections,
);

// --- 2. the closed vocabularies -------------------------------------------
// Compared native to native first, then to the corpus inventories, then to the
// sizes this contract freezes. A vocabulary that drifted on one side only is a
// silent authorization difference.
assertAdapterEntryAgreement(
  "vocabularies",
  "<all>",
  Object.keys(tsAdapterVocabularies).sort(),
  tsAdapter.vocabularies,
  pyAdapter.vocabularies,
);
for (const [name, size] of Object.entries(ADAPTER_VOCABULARY_SIZES)) {
  assert.equal(
    tsAdapter.vocabularies.counts[name],
    size,
    `${name}: the TypeScript vocabulary has ${tsAdapter.vocabularies.counts[name]} members, not ${size}`,
  );
  assert.equal(
    pyAdapter.vocabularies.counts[name],
    size,
    `${name}: the Python vocabulary has ${pyAdapter.vocabularies.counts[name]} members, not ${size}`,
  );
  assert.equal(
    tsAdapter.vocabularies.sortedByCodePoint[name],
    true,
    `${name}: the TypeScript vocabulary is not in Unicode code-point order`,
  );
  assert.equal(
    pyAdapter.vocabularies.sortedByCodePoint[name],
    true,
    `${name}: the Python vocabulary is not in Unicode code-point order`,
  );
}
for (const [name, inventory] of [
  ["adapterCapabilities", adapterCorpus.capabilityInventory],
  ["adapterErrorCodes", adapterCorpus.errorTaxonomy.map((row) => row.code)],
  ["adapterKinds", adapterCorpus.adapterKindInventory],
  ["denialReasons", adapterCorpus.denialReasonInventory],
  ["finishReasons", adapterCorpus.finishReasonInventory],
  ["reportableResources", adapterCorpus.reportableResourceInventory],
]) {
  assert.deepEqual(
    tsAdapter.vocabularies[name],
    inventory,
    `${name}: the TypeScript vocabulary differs from the corpus inventory`,
  );
  assert.deepEqual(
    pyAdapter.vocabularies[name],
    inventory,
    `${name}: the Python vocabulary differs from the corpus inventory`,
  );
}
assert.deepEqual(
  tsAdapter.vocabularies.sideEffectOrder,
  adapterCorpus.cycleComposition.sideEffectClasses,
  "sideEffectOrder: the TypeScript order differs from the corpus",
);
assert.deepEqual(
  pyAdapter.vocabularies.sideEffectOrder,
  adapterCorpus.cycleComposition.sideEffectClasses,
  "sideEffectOrder: the Python order differs from the corpus",
);
// adapter-semantics 7.1: money is never adapter-reportable, and the meter
// bindings are fixed by the budget contract rather than by the adapter.
for (const row of adapterCorpus.budgetComposition.resourceBindings) {
  assert.equal(
    tsAdapter.vocabularies.resourceUnits[row.resource],
    row.unit,
    `${row.resource}: the TypeScript unit differs from the budget binding`,
  );
  assert.equal(
    pyAdapter.vocabularies.resourceUnits[row.resource],
    row.unit,
    `${row.resource}: the Python unit differs from the budget binding`,
  );
  assert.equal(row.aggregation, "sum", `${row.resource}: aggregation is not sum`);
}
for (const forbidden of adapterCorpus.budgetComposition.forbiddenResources) {
  assert.ok(
    !tsAdapter.vocabularies.reportableResources.includes(forbidden),
    `${forbidden}: TypeScript reports a meter the budget contract forbids`,
  );
  assert.ok(
    !pyAdapter.vocabularies.reportableResources.includes(forbidden),
    `${forbidden}: Python reports a meter the budget contract forbids`,
  );
}
assertAdapterAgreement(
  "budgetComposition",
  "<costStates>",
  "costStateBindings",
  tsAdapter.costStateBindings,
  pyAdapter.costStateBindings,
);
for (const binding of adapterCorpus.budgetComposition.costStateBindings) {
  const derived = tsAdapter.costStateBindings.find((row) => row.trust === binding.trust);
  assert.equal(
    derived?.budgetCostState,
    binding.budgetCostState,
    `${binding.trust}: the derived cost state differs from the corpus binding`,
  );
}

// --- 3. the recomputed failure taxonomy -----------------------------------
assertAdapterAgreement(
  "errorTaxonomy",
  "<rows>",
  "taxonomy",
  tsAdapter.taxonomy,
  pyAdapter.taxonomy,
);
for (const language of ["TypeScript", "Python"]) {
  const taxonomy = language === "TypeScript" ? tsAdapter.taxonomy : pyAdapter.taxonomy;
  assert.equal(
    taxonomy.retryableCount,
    ADAPTER_RETRYABLE_CODES,
    `${language}: ${taxonomy.retryableCount} retryable codes, not ${ADAPTER_RETRYABLE_CODES}`,
  );
  assert.equal(
    taxonomy.preDispatchCount,
    ADAPTER_PRE_DISPATCH_CODES,
    `${language}: ${taxonomy.preDispatchCount} pre-dispatch codes, not ${ADAPTER_PRE_DISPATCH_CODES}`,
  );
  for (const row of taxonomy.rows) {
    if (row.boundary !== "pre-dispatch") continue;
    // A refusal that never reached the provider can never be retryable and can
    // never have applied an external effect.
    assert.equal(row.retryable, false, `${language} ${row.code}: pre-dispatch yet retryable`);
    assert.equal(
      row.effectDisposition,
      "not-applied",
      `${language} ${row.code}: pre-dispatch yet claims an external effect`,
    );
  }
}
for (const row of adapterCorpus.errorTaxonomy) {
  const tsRow = tsAdapter.taxonomy.rows.find((item) => item.code === row.code);
  const pyRow = pyAdapter.taxonomy.rows.find((item) => item.code === row.code);
  for (const field of [
    "boundary",
    "retryable",
    "effectDisposition",
    "usageDisposition",
    "ledgerAction",
  ]) {
    assert.equal(
      tsRow[field],
      row[field],
      `${row.code}: the TypeScript ${field} differs from the corpus taxonomy`,
    );
    assert.equal(
      pyRow[field],
      row[field],
      `${row.code}: the Python ${field} differs from the corpus taxonomy`,
    );
  }
}

// --- 4. the 3x3 in-doubt composition matrix -------------------------------
assertAdapterAgreement(
  "cycleComposition",
  "<matrix>",
  "cycleMatrix",
  tsAdapter.cycleMatrix,
  pyAdapter.cycleMatrix,
);
assert.equal(
  tsAdapter.cycleMatrix.length,
  ADAPTER_CYCLE_MATRIX_ROWS,
  `cycleComposition: ${tsAdapter.cycleMatrix.length} rows, not ${ADAPTER_CYCLE_MATRIX_ROWS}`,
);
assert.deepEqual(
  adapterCorpus.cycleComposition.matrix,
  tsAdapter.cycleMatrix,
  "cycleComposition: the corpus matrix differs from the recomputed matrix",
);
// cycle-semantics 13.4: exactly the two in-doubt external classes retain an
// identity. `none` creates no in-doubt evidence at all.
assert.equal(
  tsAdapter.cycleMatrix.filter((row) => row.recordsInDoubtIdentity).length,
  2,
  "cycleComposition: the number of in-doubt identity rows is not 2",
);

// --- 5. the twelve shipped descriptors ------------------------------------
assertAdapterAgreement(
  "descriptors",
  "<inventory>",
  "descriptorInventory",
  tsAdapter.descriptorInventory,
  pyAdapter.descriptorInventory,
);
const adapterKindsSeen = new Set();
const adapterCapabilitiesSeen = new Set();
for (const document of adapterCorpus.descriptors) {
  const entry = tsAdapter.descriptorInventory[document.adapterId];
  assert.equal(entry.valid, true, `${document.adapterId}: a shipped descriptor is invalid`);
  assert.equal(
    entry.budgetPolicyValid,
    true,
    `${document.adapterId}: a shipped descriptor violates the budget policy`,
  );
  assert.equal(
    entry.evidenceClass,
    "deterministic-mock",
    `${document.adapterId}: a shipped descriptor is not deterministic-mock evidence`,
  );
  adapterKindsSeen.add(entry.adapterKind);
  for (const capability of entry.capabilities) adapterCapabilitiesSeen.add(capability);
}
for (const kind of tsAdapter.vocabularies.adapterKinds) {
  assert.ok(adapterKindsSeen.has(kind), `adapterKinds: no shipped descriptor covers '${kind}'`);
}
for (const capability of tsAdapter.vocabularies.adapterCapabilities) {
  assert.ok(
    adapterCapabilitiesSeen.has(capability),
    `capabilities: no shipped descriptor declares '${capability}'`,
  );
}

// --- 6. every declared case, member for member ----------------------------
// The rule identifier is compared for every case, not just the outcome. Two
// neighbouring rules that report the same portable code are indistinguishable
// without it, and a rule shadowed by its neighbour is exactly the defect the
// register exists to make visible.
const ADAPTER_SECTION_FIELDS = {
  descriptorCases: ["accepted", "code", "rule", "message", "denialReason", "projection"],
  preflightCases: ["accepted", "code", "rule", "message", "denialReason", "projection"],
  streamCases: ["accepted", "code", "rule", "message", "denialReason", "projection"],
  usageCases: ["accepted", "code", "rule", "message", "denialReason", "projection"],
  toolCases: ["accepted", "code", "rule", "message", "denialReason", "projection"],
  errorCases: [
    "accepted",
    "code",
    "rule",
    "message",
    "denialReason",
    "projection",
    "envelopeCode",
  ],
  retryCases: ["decision", "rule", "computedBackoffMs", "retryableByCode"],
  circuitCases: ["projection", "rules", "steps"],
};

const adapterSectionCounts = {};
for (const section of ADAPTER_CASE_SECTIONS) {
  const cases = adapterCorpus[section];
  assert.ok(Array.isArray(cases) && cases.length > 0, `${section}: the corpus declares no cases`);
  const declared = cases.map((item) => String(item.id));
  assert.equal(
    new Set(declared).size,
    declared.length,
    `${section}: the corpus declares a duplicate case id`,
  );
  assertAdapterAgreement(section, "<section>", "declaredCaseOrder", declared, pyAdapter.caseOrder[section]);

  // A skipped case is the failure mode this join exists to prevent: a suite
  // that passes because it excluded the cases it could not decide is not
  // evidence. Absence on either side is an error, never a no-op.
  for (const id of declared) {
    if (!Object.hasOwn(tsAdapterSections[section], id)) {
      throw new Error(`${section}: TypeScript skipped corpus case '${id}'`);
    }
    if (!Object.hasOwn(pyAdapter.sections[section], id)) {
      throw new Error(`${section}: Python skipped corpus case '${id}'`);
    }
  }
  for (const id of Object.keys(tsAdapterSections[section])) {
    if (!declared.includes(id)) {
      throw new Error(`${section}: TypeScript reported case '${id}' the corpus does not declare`);
    }
  }
  for (const id of Object.keys(pyAdapter.sections[section])) {
    if (!declared.includes(id)) {
      throw new Error(`${section}: Python reported case '${id}' the corpus does not declare`);
    }
  }
  assert.equal(
    Object.keys(tsAdapterSections[section]).length,
    declared.length,
    `${section}: TypeScript reported ${Object.keys(tsAdapterSections[section]).length} cases for ${declared.length} declared`,
  );
  assert.equal(
    Object.keys(pyAdapter.sections[section]).length,
    declared.length,
    `${section}: Python reported ${Object.keys(pyAdapter.sections[section]).length} cases for ${declared.length} declared`,
  );

  for (const testCase of cases) {
    const id = String(testCase.id);
    const tsEntry = tsAdapterSections[section][id];
    const pyEntry = pyAdapter.sections[section][id];
    assertAdapterEntryAgreement(section, id, ADAPTER_SECTION_FIELDS[section], tsEntry, pyEntry);

    // Only now is either half compared to the corpus.
    if (section === "retryCases") {
      assert.deepEqual(
        tsEntry.decision,
        testCase.expected,
        `${id}: the TypeScript retry decision differs from the corpus`,
      );
      assert.deepEqual(
        pyEntry.decision,
        testCase.expected,
        `${id}: the Python retry decision differs from the corpus`,
      );
      assert.ok(
        adapterRegistered.includes(tsEntry.rule),
        `${id}: the retry rule '${tsEntry.rule}' is outside the register`,
      );
      continue;
    }
    if (section === "circuitCases") {
      assert.deepEqual(
        tsEntry.projection,
        testCase.expected,
        `${id}: the TypeScript circuit projection differs from the corpus`,
      );
      assert.deepEqual(
        pyEntry.projection,
        testCase.expected,
        `${id}: the Python circuit projection differs from the corpus`,
      );
      for (const rule of tsEntry.rules) {
        assert.ok(
          adapterRegistered.includes(rule),
          `${id}: the circuit rule '${rule}' is outside the register`,
        );
      }
      continue;
    }

    assert.equal(
      tsEntry.code,
      testCase.expectedCode ?? null,
      `${id}: the TypeScript code differs from the corpus`,
    );
    assert.equal(
      pyEntry.code,
      testCase.expectedCode ?? null,
      `${id}: the Python code differs from the corpus`,
    );
    assert.equal(
      tsEntry.rule,
      testCase.expectedRule ?? null,
      `${id}: the TypeScript rule differs from the corpus`,
    );
    assert.equal(
      pyEntry.rule,
      testCase.expectedRule ?? null,
      `${id}: the Python rule differs from the corpus`,
    );
    if (tsEntry.rule !== null) {
      assert.ok(
        adapterRegistered.includes(tsEntry.rule),
        `${id}: rule '${tsEntry.rule}' is outside the register`,
      );
    }
    if (testCase.expectedMessage !== undefined) {
      assert.equal(
        tsEntry.message,
        testCase.expectedMessage,
        `${id}: the TypeScript message differs from the corpus`,
      );
      assert.equal(
        pyEntry.message,
        testCase.expectedMessage,
        `${id}: the Python message differs from the corpus`,
      );
    }
    if (testCase.expectedDenialReason !== undefined) {
      assert.equal(
        testCase.expectedCode,
        "GE_ADAPTER_POLICY_DENIED",
        `${id}: a denial reason accompanies GE_ADAPTER_POLICY_DENIED and nothing else`,
      );
      assert.equal(
        tsEntry.denialReason,
        testCase.expectedDenialReason,
        `${id}: the TypeScript denial reason differs from the corpus`,
      );
      assert.equal(
        pyEntry.denialReason,
        testCase.expectedDenialReason,
        `${id}: the Python denial reason differs from the corpus`,
      );
      const row = adapterCorpus.ruleRegister.find((item) => item.rule === testCase.expectedRule);
      assert.equal(
        row?.denialReason ?? null,
        testCase.expectedDenialReason,
        `${id}: the register disagrees with the case on the denial reason`,
      );
    } else if (section === "preflightCases") {
      assert.equal(
        tsEntry.denialReason,
        null,
        `${id}: TypeScript produced a denial reason the corpus does not declare`,
      );
      assert.equal(
        pyEntry.denialReason,
        null,
        `${id}: Python produced a denial reason the corpus does not declare`,
      );
    }
    if (testCase.expectedNormalized !== undefined) {
      assert.deepEqual(
        tsEntry.projection,
        testCase.expectedNormalized,
        `${id}: the TypeScript normalized stream differs from the corpus`,
      );
      assert.deepEqual(
        pyEntry.projection,
        testCase.expectedNormalized,
        `${id}: the Python normalized stream differs from the corpus`,
      );
    }
    if (testCase.expectedSummary !== undefined) {
      assert.deepEqual(
        tsEntry.projection,
        testCase.expectedSummary,
        `${id}: the TypeScript summary differs from the corpus`,
      );
      assert.deepEqual(
        pyEntry.projection,
        testCase.expectedSummary,
        `${id}: the Python summary differs from the corpus`,
      );
    }
  }
  adapterSectionCounts[section] = declared.length;
}

// --- 7. the register: all 131 exercised, none unregistered ----------------
assertAdapterAgreement(
  "ruleRegister",
  "<register>",
  "ruleRegister",
  tsAdapter.ruleRegister,
  pyAdapter.ruleRegister,
);
for (const [language, register] of [
  ["TypeScript", tsAdapter.ruleRegister],
  ["Python", pyAdapter.ruleRegister],
]) {
  assert.deepEqual(
    register.missing,
    [],
    `${language} left ${register.missing.length} registered rule(s) unexercised: ${register.missing.join(", ")}`,
  );
  assert.deepEqual(
    register.stray,
    [],
    `${language} produced rule(s) outside the register: ${register.stray.join(", ")}`,
  );
  assert.equal(
    register.exercisedCount,
    adapterCorpus.declaredCounts.rules,
    `${language} exercised ${register.exercisedCount} rules, not ${adapterCorpus.declaredCounts.rules}`,
  );
}
assert.equal(
  adapterRegistered.length,
  adapterCorpus.declaredCounts.rules,
  "ruleRegister: the register size differs from the declared rule count",
);
// A decision rule carries no portable code and no denial reason; a rejection
// rule carries a code from the closed taxonomy.
for (const row of adapterCorpus.ruleRegister) {
  if (row.kind === "decision") {
    assert.equal(row.code, null, `${row.rule}: a decision rule carries a portable code`);
    assert.equal(row.denialReason, null, `${row.rule}: a decision rule carries a denial reason`);
  } else {
    assert.ok(
      tsAdapter.vocabularies.adapterErrorCodes.includes(row.code),
      `${row.rule}: the register names a code outside the closed taxonomy`,
    );
  }
}
assertAdapterAgreement(
  "coverage",
  "<codes>",
  "codesObserved",
  tsAdapter.codesObserved,
  pyAdapter.codesObserved,
);
assert.deepEqual(
  tsAdapter.codesObserved,
  [...tsAdapter.vocabularies.adapterErrorCodes].sort(),
  "coverage: the rule engine did not produce every code in the closed taxonomy",
);
assertAdapterAgreement(
  "coverage",
  "<denials>",
  "denialReasonsObserved",
  tsAdapter.denialReasonsObserved,
  pyAdapter.denialReasonsObserved,
);
assert.deepEqual(
  tsAdapter.denialReasonsObserved,
  [...tsAdapter.vocabularies.denialReasons].sort(),
  "coverage: the rule engine did not produce every denial reason in the closed set",
);
// Every finish reason and every meter is exercised by the corpus itself; the
// two halves must have read the same coverage out of it.
const adapterFinishReasons = new Set();
for (const testCase of adapterCorpus.streamCases) {
  const reason = testCase.expectedNormalized?.finishReason;
  if (reason !== undefined && reason !== null) adapterFinishReasons.add(reason);
  if (testCase.finishReasonExercised !== undefined) {
    adapterFinishReasons.add(testCase.finishReasonExercised);
  }
}
for (const reason of tsAdapter.vocabularies.finishReasons) {
  assert.ok(adapterFinishReasons.has(reason), `coverage: finish reason '${reason}' is unexercised`);
}
const adapterMeters = new Set();
for (const testCase of adapterCorpus.usageCases) {
  for (const resource of testCase.resourcesExercised ?? []) adapterMeters.add(resource);
}
for (const resource of tsAdapter.vocabularies.reportableResources) {
  assert.ok(adapterMeters.has(resource), `coverage: meter '${resource}' is unexercised`);
}

// --- 8. section counts, native to native and then to the corpus -----------
assertAdapterAgreement(
  "declaredCounts",
  "<counts>",
  "observedCounts",
  tsAdapter.observedCounts,
  pyAdapter.observedCounts,
);
assert.deepEqual(
  tsAdapter.observedCounts,
  adapterCorpus.declaredCounts,
  "declaredCounts: the consumed section counts differ from the corpus declaration",
);

// --- 9. the real public adapter object ------------------------------------
// The success path first: an unscripted call and a streamed call must produce
// byte-identical responses, usage and frame plans in both languages.
assertAdapterAgreement(
  "mockSuccess",
  "<call>",
  "mockSuccess",
  tsAdapter.mockSuccess,
  pyAdapter.mockSuccess,
);
assert.equal(
  tsAdapter.mockSuccess.call.ok,
  true,
  "mockSuccess: an unscripted mock call did not succeed",
);
assert.ok(
  tsAdapter.mockSuccess.stream.frames.length > 0,
  "mockSuccess: a streamed mock call produced no frames",
);
assertAdapterAgreement(
  "mockCircuit",
  "<projection>",
  "mockCircuit",
  tsAdapter.mockCircuit,
  pyAdapter.mockCircuit,
);

// --- 10. the cross-language equality backstop -----------------------------
//
// There is no disclosed divergence register here any more, and there must not
// be one: the two halves are equal member for member, and this block proves it
// rather than pinning a fork.
//
// The register this replaces recorded fourteen paths from a single defect. The
// TypeScript `MockOutcome` (packages/adapters/src/mock-adapter.ts) had no
// `denialReason` member, so `#injectedFailure` called `normalizedAdapterError`
// without one, `validateErrorEnvelope` rejected the result under `E-005`, and
// the `catch` in `call()` converted that rejection into a
// `GE_ADAPTER_MALFORMED_RESPONSE` envelope: the code the caller asked to inject
// was not the code the caller observed. The member now exists and is passed
// through, so `GE_ADAPTER_POLICY_DENIED` is genuinely injectable in both
// languages and every one of those fourteen paths agrees.

/**
 * Walk both reports and yield every leaf path at which they differ. This is the
 * backstop for the named assertions above: a divergence in a member no explicit
 * assertion happens to cover still lands here.
 */
function adapterDeepDivergences(tsValue, pyValue, path = "") {
  const found = [];
  const tsObject = tsValue !== null && typeof tsValue === "object";
  const pyObject = pyValue !== null && typeof pyValue === "object";
  if (Array.isArray(tsValue) && Array.isArray(pyValue)) {
    if (tsValue.length !== pyValue.length) {
      found.push({ path: `${path}/length`, typescript: tsValue.length, python: pyValue.length });
      return found;
    }
    for (const [index, item] of tsValue.entries()) {
      found.push(...adapterDeepDivergences(item, pyValue[index], `${path}/${index}`));
    }
    return found;
  }
  if (tsObject && pyObject && !Array.isArray(tsValue) && !Array.isArray(pyValue)) {
    for (const key of [...new Set([...Object.keys(tsValue), ...Object.keys(pyValue)])].sort()) {
      const tsHas = Object.hasOwn(tsValue, key);
      const pyHas = Object.hasOwn(pyValue, key);
      if (!tsHas || !pyHas) {
        found.push({
          path: `${path}/${key}`,
          typescript: tsHas ? tsValue[key] : "<member absent>",
          python: pyHas ? pyValue[key] : "<member absent>",
        });
        continue;
      }
      found.push(...adapterDeepDivergences(tsValue[key], pyValue[key], `${path}/${key}`));
    }
    return found;
  }
  if (!isDeepStrictEqual(tsValue, pyValue)) {
    found.push({ path, typescript: tsValue, python: pyValue });
  }
  return found;
}

// Compare the whole report, member for member, except the two members the
// corpus does not require the two halves to state identically (`caseSections`
// and `probeVectors` are already joined above and are restatements, not
// results).
const adapterObservedDivergences = adapterDeepDivergences(tsAdapter, pyAdapter);
for (const divergence of adapterObservedDivergences) {
  throw new Error(
    `Adapter cross-language divergence at '${divergence.path}':`
      + ` TypeScript ${adapterStringify(divergence.typescript)}`
      + ` vs Python ${adapterStringify(divergence.python)}.`
      + " The two adapter implementations must agree member for member;"
      + " there is no disclosed divergence register to absorb this.",
  );
}
assert.equal(
  adapterObservedDivergences.length,
  0,
  `adapter join: ${adapterObservedDivergences.length} cross-language divergences observed, 0 permitted`,
);
// Every code in the closed taxonomy is injectable through both real mock
// adapters. `GE_ADAPTER_POLICY_DENIED` is injectable only when the script
// carries a denial reason, which both `MockOutcome` types now declare.
const adapterInjectableBoth = tsAdapter.vocabularies.adapterErrorCodes.filter(
  (code) =>
    tsAdapter.mockDispatch[code].injectableAsRequested
    && pyAdapter.mockDispatch[code].injectableAsRequested,
);
assert.deepEqual(
  tsAdapter.vocabularies.adapterErrorCodes.filter(
    (code) => !adapterInjectableBoth.includes(code),
  ),
  [],
  "mockDispatch: a code in the closed taxonomy is not injectable through both mocks",
);
assert.equal(
  tsAdapter.mockPolicyDenied.declaresDenialReasonMember,
  true,
  "mockPolicyDenied: the TypeScript scripted outcome does not declare a denial-reason member",
);
assert.equal(
  pyAdapter.mockPolicyDenied.declaresDenialReasonMember,
  true,
  "mockPolicyDenied: the Python scripted outcome does not declare a denial-reason member",
);
for (const half of [tsAdapter, pyAdapter]) {
  assert.equal(half.mockPolicyDenied.observedCode, "GE_ADAPTER_POLICY_DENIED");
  assert.equal(
    half.mockPolicyDenied.observedDenialReason,
    half.probeVectors.denialReason,
    "mockPolicyDenied: the injected denial reason is not the one the probe scripted",
  );
}
for (const code of adapterInjectableBoth) {
  assert.equal(
    pyAdapter.mockDispatch[code].error.code,
    code,
    `mockDispatch: Python did not produce ${code} as scripted`,
  );
  assert.equal(
    tsAdapter.mockDispatch[code].error.code,
    code,
    `mockDispatch: TypeScript did not produce ${code} as scripted`,
  );
}

// --- 11. the corpus honesty flags this lane never upgrades ----------------
assert.equal(
  adapterCorpus.integrationNotes.length,
  3,
  "integrationNotes: the corpus does not name three agent-harness integrations",
);
for (const note of adapterCorpus.integrationNotes) {
  assert.equal(note.officialV1Adapter, false, `${note.integration}: claims an official adapter`);
  assert.equal(note.privateApiClaim, false, `${note.integration}: claims a private API`);
  assert.ok(
    !tsAdapter.vocabularies.adapterKinds.includes(note.integration),
    `${note.integration}: an integration note is not an adapter kind`,
  );
}
assert.ok(
  Array.isArray(adapterCorpus.nonClaims) && adapterCorpus.nonClaims.length > 0,
  "nonClaims: the corpus states no non-claims",
);

const adapterTotalCases = Object.values(adapterSectionCounts).reduce((sum, n) => sum + n, 0);
process.stdout.write(
  `Cross-language adapter conformance passed for ${adapterTotalCases} declared cases`
    + ` (${adapterSectionCounts.descriptorCases} descriptor, ${adapterSectionCounts.preflightCases} preflight,`
    + ` ${adapterSectionCounts.streamCases} stream, ${adapterSectionCounts.usageCases} usage,`
    + ` ${adapterSectionCounts.toolCases} tool, ${adapterSectionCounts.errorCases} error,`
    + ` ${adapterSectionCounts.retryCases} retry, ${adapterSectionCounts.circuitCases} circuit)`
    + ` compared code, rule identifier and projection member for member,`
    + ` ${tsAdapter.ruleRegister.exercisedCount}/${pyAdapter.ruleRegister.exercisedCount} of`
    + ` ${adapterRegistered.length} registered rules exercised with 0 unregistered on either side,`
    + ` the ${tsAdapter.vocabularies.counts.adapterErrorCodes}-code /`
    + ` ${tsAdapter.vocabularies.counts.denialReasons}-denial-reason /`
    + ` ${tsAdapter.vocabularies.counts.finishReasons}-finish-reason /`
    + ` ${tsAdapter.vocabularies.counts.reportableResources}-meter /`
    + ` ${tsAdapter.vocabularies.counts.adapterKinds}-kind /`
    + ` ${tsAdapter.vocabularies.counts.adapterCapabilities}-capability closed vocabularies,`
    + ` the recomputed taxonomy (${tsAdapter.taxonomy.retryableCount} retryable,`
    + ` ${tsAdapter.taxonomy.preDispatchCount} pre-dispatch) and the`
    + ` ${tsAdapter.cycleMatrix.length}-row in-doubt matrix,`
    + ` and ${adapterInjectableBoth.length}/${tsAdapter.vocabularies.counts.adapterErrorCodes} codes`
    + ` injectable through both real mock adapters;`
    + ` 0 disclosed divergences and ${adapterObservedDivergences.length} observed`
    + ` across every joined member, including the GE_ADAPTER_POLICY_DENIED envelope`
    + ` both MockOutcome types now carry a denial reason for;`
    + ` implementationClaim ${JSON.stringify(adapterCorpus.implementationClaim)}.\n`,
);
