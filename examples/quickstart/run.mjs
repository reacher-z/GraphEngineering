#!/usr/bin/env node

/**
 * The Graph Engineering quickstart, TypeScript lane.
 *
 * Three things happen here, in order:
 *
 *   1. A research diamond runs on the native DAG scheduler. The two research
 *      nodes are model-shaped: each one dispatches through the deterministic
 *      mock adapter, which enforces the same capability, bounds and usage rules
 *      every other adapter kind must satisfy.
 *   2. The same graph runs durably. Payload protection is configured
 *      explicitly, and a durable run without it fails closed.
 *   3. The run is resumed. A terminal run replays from the journal and calls
 *      no executor at all.
 *
 * No network access, no credential, no API key. Every value below is a function
 * of the graph, the descriptor and the scripts in this file.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapterExecutor, createMockAdapter } from "../../packages/adapters/dist/index.js";
import {
  DEFAULT_CAPTURE_POLICY,
  FileProtectedPayloadStore,
  HostKeyProvider,
  ProtectedJsonlEventStore,
} from "../../packages/persistence/dist/index.js";
import {
  resumeDurableGraphRun,
  runGraph,
  startDurableGraphRun,
} from "../../packages/runtime/dist/index.js";

const here = (name) => new URL(name, import.meta.url);
const graph = JSON.parse(await readFile(here("./research-diamond.graph.json"), "utf8"));
const descriptor = JSON.parse(await readFile(here("./mock-adapter.descriptor.json"), "utf8"));

const TOPIC = "durable agent graphs";

// ---------------------------------------------------------------------------
// 1. Two model-shaped nodes on the deterministic mock adapter
// ---------------------------------------------------------------------------

/** One scripted lane. The mock returns exactly what the script declares. */
function researchLane(lane, finding) {
  const adapter = createMockAdapter({
    descriptor: { ...descriptor, adapterId: `quickstart-mock-${lane}` },
    script: [{ text: finding, structuredOutput: { source: lane, finding } }],
  });
  const executor = createAdapterExecutor({
    adapter,
    // The preflight view of a request carries no prompt text on purpose: a
    // refusal can never quote a payload.
    request: (input) => ({
      requestId: `research-${lane}`,
      sideEffectClass: "none",
      requiredCapabilities: ["structured-output", "usage-reporting"],
      requestBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
      attachments: [],
      toolDefinitions: [],
      streaming: false,
      structuredOutput: true,
      cancellable: false,
      idempotencyKey: null,
      circuitState: "closed",
      target: null,
      mcpCall: null,
      processCall: null,
    }),
  });
  return { adapter, executor };
}

const docs = researchLane("docs", `Document the contract for ${TOPIC}`);
const code = researchLane("code", `Test the runtime for ${TOPIC}`);

let dispatches = 0;
const count = (executor) => (context) => {
  dispatches += 1;
  return executor(context);
};

const nodeExecutors = {
  scope: ({ input }) => input,
  "research-docs": count(docs.executor),
  "research-code": count(code.executor),
  synthesize: ({ input }) => input,
};

const result = await runGraph(graph, { topic: TOPIC }, { nodeExecutors });
assert.equal(result.status, "succeeded");
assert.equal(result.maxObservedConcurrency, 2, "the two research lanes must overlap");
assert.equal(dispatches, 2);

// The adapter declares three capabilities and nothing else. Asking for one it
// does not declare is refused before dispatch, so a refused call performs zero
// provider requests and zero usage.
const refusal = await docs.adapter.call({
  requestId: "streaming-probe",
  sideEffectClass: "none",
  requiredCapabilities: [],
  requestBytes: 16,
  attachments: [],
  toolDefinitions: [],
  streaming: true,
  structuredOutput: false,
  cancellable: false,
  idempotencyKey: null,
  circuitState: "closed",
  target: null,
  mcpCall: null,
  processCall: null,
});
assert.equal(refusal.ok, false);
assert.equal(refusal.error.code, "GE_ADAPTER_CAPABILITY_UNSUPPORTED");
assert.equal(refusal.error.boundary, "pre-dispatch");
assert.equal(refusal.error.usage, null);

// ---------------------------------------------------------------------------
// 2. The same graph, durably, with payload protection configured
// ---------------------------------------------------------------------------

const directory = await mkdtemp(join(tmpdir(), "ge-quickstart-"));
const runId = "quickstart-research-001";

// Key material is operator-owned. This quickstart mints it per process from the
// platform CSPRNG; a deployment holds it in a KMS. It is never written beside
// the ciphertext, so losing it means losing the journal — that is the point.
const keyRef = "quickstart/ephemeral-key/v1";
const keys = new HostKeyProvider({
  keyRef,
  protectionKey: randomBytes(32),
  runIdentityKey: randomBytes(32),
});

const protection = {
  journal: new ProtectedJsonlEventStore({ directory }),
  payloadStore: new FileProtectedPayloadStore({ directory }),
  keys,
  // Opaque tenant/authority identity. Never a personal identifier.
  scope: {
    tenantScopeId: "quickstart-tenant",
    authorityProviderId: "quickstart-provider",
    authoritySubjectId: "quickstart-subject",
  },
  // The policy must name the key reference actually in use.
  policy: { ...DEFAULT_CAPTURE_POLICY, keyRef },
};

const durableOptions = {
  runId,
  implementationId: "quickstart-handlers@1",
  protection,
  nodeExecutors,
};

// A durable run with no protected store and no key provider fails closed before
// the first event, the first temporary file and the first executor call.
let failedClosed = null;
try {
  await startDurableGraphRun(graph, { topic: TOPIC }, { ...durableOptions, protection: undefined });
} catch (error) {
  failedClosed = error.code;
}
assert.equal(failedClosed, "PAYLOAD_PROTECTION_REQUIRED");
assert.equal(dispatches, 2, "the failed-closed run must not have invoked an executor");

const durable = await startDurableGraphRun(graph, { topic: TOPIC }, durableOptions);
assert.equal(durable.status, "succeeded");
assert.equal(dispatches, 4);

// Every authoritative application value reaches the journal only as a validated
// protected reference. The topic never appears in the bytes on disk.
let journalBytes = 0;
for (const name of await readdir(directory, { recursive: true, withFileTypes: true })) {
  if (!name.isFile()) continue;
  const bytes = await readFile(join(name.parentPath ?? directory, name.name));
  journalBytes += bytes.byteLength;
  assert.ok(!bytes.includes(Buffer.from(TOPIC, "utf8")), `plaintext topic leaked into ${name.name}`);
}

// ---------------------------------------------------------------------------
// 3. Resume: a terminal run replays without calling an executor
// ---------------------------------------------------------------------------

const resumed = await resumeDurableGraphRun(graph, durableOptions);
assert.equal(resumed.status, "succeeded");
assert.equal(dispatches, 4, "resuming a terminal run must call no executor");
assert.deepEqual(resumed.output, durable.output);

await rm(directory, { recursive: true, force: true });

process.stdout.write(`${JSON.stringify(
  {
    "1-parallel-run": {
      status: result.status,
      maxObservedConcurrency: result.maxObservedConcurrency,
      adapterDispatches: 2,
      report: result.output.report,
    },
    "2-adapter-boundary": {
      refusedCapability: "streaming",
      code: refusal.error.code,
      boundary: refusal.error.boundary,
      usage: refusal.error.usage,
    },
    "3-durable-protected": {
      unprotectedStart: failedClosed,
      status: durable.status,
      protectedJournalBytesOnDisk: journalBytes,
      plaintextTopicOnDisk: false,
    },
    "4-resume": {
      status: resumed.status,
      totalAdapterDispatches: dispatches,
      executorCallsDuringResume: 0,
    },
  },
  null,
  2,
)}\n`);
