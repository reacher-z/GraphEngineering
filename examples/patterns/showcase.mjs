#!/usr/bin/env node

import assert from "node:assert/strict";
import { compileGraph } from "../../packages/core/dist/index.js";
import {
  PatternInputError,
  diamond,
  loopUntilDry,
  routedBranches,
  verifiedFanout,
} from "../../packages/patterns/dist/src/index.js";
import { runGraph } from "../../packages/runtime/dist/index.js";

const PATTERN_LABEL = "graphengineering.reacher-z.github.io/pattern";
const CAPABILITY_LABEL = "graphengineering.reacher-z.github.io/runtime-capability";
const DAG_CAPABILITY = "dag/v1alpha1";
const ROUTING_CAPABILITY = "edge-condition-routing/v1alpha1";
const LOOP_CAPABILITY = "edge-condition-routing-and-early-stop/v1alpha1";

function node(id, kind = "transform", config = {}) {
  return {
    id,
    kind,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    config,
    sideEffects: "none",
  };
}

function diamondWorker(key) {
  if (key === "code") {
    return { key, node: node("diamond-code", "agent", { source: "code" }) };
  }
  assert.equal(key, "docs");
  return { key, node: node("diamond-docs", "agent", { source: "docs" }) };
}

function diamondOptions(order) {
  return {
    metadata: { name: "showcase-diamond", version: "1.0.0" },
    split: node("diamond-split"),
    workers: order.map(diamondWorker),
    merge: node("diamond-merge", "barrier"),
    policies: {
      maxConcurrency: 2,
      maxFanOut: 2,
      maxDepth: 3,
      maxTotalAttempts: 8,
    },
  };
}

function verifier(key) {
  if (key === "correctness") {
    return {
      key,
      node: node("verify-correctness", "validator", { lens: "correctness" }),
    };
  }
  if (key === "reproducibility") {
    return {
      key,
      node: node("verify-reproducibility", "validator", { lens: "reproducibility" }),
    };
  }
  assert.equal(key, "security");
  return { key, node: node("verify-security", "validator", { lens: "security" }) };
}

function verifiedOptions(order) {
  return {
    metadata: { name: "showcase-verified-fanout", version: "1.0.0" },
    work: node("verify-work", "agent"),
    verifiers: order.map(verifier),
    adjudicate: node("verify-adjudicate", "barrier"),
    policies: {
      maxConcurrency: 3,
      maxFanOut: 3,
      maxDepth: 3,
      maxTotalAttempts: 10,
    },
  };
}

function routeBranch(key) {
  if (key === "general") {
    return { key, node: node("route-general", "agent", { route: "general" }) };
  }
  assert.equal(key, "security");
  return { key, node: node("route-security", "agent", { route: "security" }) };
}

function routedOptions(order) {
  return {
    metadata: { name: "showcase-routed-branches", version: "1.0.0" },
    classify: node("route-classify", "router"),
    branches: order.map(routeBranch),
    merge: node("route-merge", "barrier"),
    policies: { maxConcurrency: 2, maxFanOut: 2, maxDepth: 3 },
  };
}

function loopOptions() {
  return {
    metadata: { name: "showcase-loop-until-dry", version: "1.0.0" },
    maxRounds: 2,
    rounds: [
      {
        key: "round1",
        find: node("loop-find-1", "agent", { round: 1 }),
        checkDry: node("loop-check-1", "validator", { round: 1 }),
      },
      {
        key: "round2",
        find: node("loop-find-2", "agent", { round: 2 }),
        checkDry: node("loop-check-2", "validator", { round: 2 }),
      },
    ],
    finalize: node("loop-finalize", "barrier"),
  };
}

function compileSummary(name, graph) {
  // Constructors compile internally; this second canonical compile is an
  // explicit showcase assertion at the public package boundary.
  const compilation = compileGraph(graph);
  assert.equal(compilation.valid, true, `${name} must compile through core`);
  assert.deepEqual(compilation.diagnostics, []);
  assert.equal(typeof compilation.graphHash, "string");
  const pattern = graph.metadata.labels?.[PATTERN_LABEL];
  const capability = graph.metadata.labels?.[CAPABILITY_LABEL];
  assert.equal(typeof pattern, "string");
  assert.equal(typeof capability, "string");
  return {
    name,
    graphHash: compilation.graphHash,
    layers: compilation.topologicalLayers,
    capability,
    pattern,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  };
}

function compiledHash(name, graph) {
  const compilation = compileGraph(graph);
  assert.equal(compilation.valid, true, `${name} permutation must compile`);
  assert.equal(typeof compilation.graphHash, "string");
  return compilation.graphHash;
}

function assertKeyedPermutation(name, left, right) {
  const leftHash = compiledHash(`${name}:left`, left);
  const rightHash = compiledHash(`${name}:right`, right);
  assert.deepEqual(left, right, `${name} must normalize keyed input order`);
  assert.equal(leftHash, rightHash, `${name} keyed permutations must hash identically`);
  return { equal: true, graphHash: leftHash };
}

function assertDeepFrozen(value, seen = new Set()) {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ("value" in descriptor) assertDeepFrozen(descriptor.value, seen);
  }
}

function controlledOverlap(expectedIds) {
  const expected = [...expectedIds].sort();
  assert.equal(new Set(expected).size, expected.length);
  const arrived = [];
  let releaseGate;
  let gateReleased = false;
  let releasedBeforeAllArrived = false;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const release = () => {
    if (gateReleased) return;
    gateReleased = true;
    releaseGate();
  };

  return {
    async arrive(nodeId) {
      assert.ok(expected.includes(nodeId), `unexpected overlap participant ${nodeId}`);
      assert.equal(arrived.includes(nodeId), false, `${nodeId} arrived more than once`);
      arrived.push(nodeId);
      if (arrived.length === expected.length) {
        release();
      } else if (arrived.length === 1) {
        // A microtask fallback prevents a scheduler regression from hanging the
        // showcase forever. Correctly concurrent siblings are already queued
        // and reach this gate first; a serial scheduler releases one worker and
        // then fails the explicit overlap assertion below.
        queueMicrotask(() => {
          if (arrived.length < expected.length) {
            releasedBeforeAllArrived = true;
            release();
          }
        });
      }
      await gate;
    },
    assertComplete() {
      assert.deepEqual([...arrived].sort(), expected);
      assert.equal(releasedBeforeAllArrived, false, "handlers did not overlap");
    },
  };
}

const diamondGraph = diamond(diamondOptions(["docs", "code"]));
const verifiedGraph = verifiedFanout(
  verifiedOptions(["security", "correctness", "reproducibility"]),
);
const routedGraph = routedBranches(routedOptions(["security", "general"]));
const loopGraph = loopUntilDry(loopOptions());

const patternSummaries = [
  compileSummary("diamond", diamondGraph),
  compileSummary("verifiedFanout", verifiedGraph),
  compileSummary("routedBranches", routedGraph),
  compileSummary("loopUntilDry", loopGraph),
];
const summaryByName = Object.fromEntries(patternSummaries.map((item) => [item.name, item]));

assert.equal(summaryByName.diamond.capability, DAG_CAPABILITY);
assert.equal(summaryByName.verifiedFanout.capability, DAG_CAPABILITY);
assert.equal(summaryByName.routedBranches.capability, ROUTING_CAPABILITY);
assert.equal(summaryByName.loopUntilDry.capability, LOOP_CAPABILITY);

const routeConditions = routedGraph.edges
  .filter((edge) => edge.condition !== undefined)
  .map((edge) => edge.condition.kind);
assert.deepEqual(routeConditions, ["RouteEquals", "RouteEquals"]);

const loopConditions = loopGraph.edges
  .filter((edge) => edge.condition !== undefined)
  .map((edge) => edge.condition.kind);
assert.deepEqual(loopConditions, ["LoopDryVerdict", "LoopContinue", "LoopVerdictAtBound"]);

const permutationDeterminism = {
  diamond: assertKeyedPermutation(
    "diamond",
    diamondGraph,
    diamond(diamondOptions(["code", "docs"])),
  ),
  verifiedFanout: assertKeyedPermutation(
    "verifiedFanout",
    verifiedGraph,
    verifiedFanout(verifiedOptions(["reproducibility", "correctness", "security"])),
  ),
  routedBranches: assertKeyedPermutation(
    "routedBranches",
    routedGraph,
    routedBranches(routedOptions(["general", "security"])),
  ),
};

let getterInvocations = 0;
const getterInput = {};
Object.defineProperty(getterInput, "metadata", {
  enumerable: true,
  get() {
    getterInvocations += 1;
    return { name: "must-not-run", version: "1.0.0" };
  },
});
assert.throws(
  () => diamond(getterInput),
  (error) => {
    assert.ok(error instanceof PatternInputError);
    assert.equal(error.code, "GE_PATTERN_INVALID_INPUT");
    assert.equal(error.path, "#/metadata");
    return true;
  },
);
assert.equal(getterInvocations, 0);

for (const graph of [diamondGraph, verifiedGraph, routedGraph, loopGraph]) {
  assertDeepFrozen(graph);
}
let mutationRejected = false;
assert.throws(
  () => {
    diamondGraph.nodes[0].id = "mutated";
  },
  (error) => {
    mutationRejected = error instanceof TypeError;
    return mutationRejected;
  },
);
assert.equal(diamondGraph.nodes[0].id, "diamond-split");

const executablePatterns = new Set(["diamond", "verifiedFanout"]);
const runtimeExecuted = [];
async function executeDag(name, graph, input, options) {
  assert.ok(executablePatterns.has(name));
  assert.equal(graph.metadata.labels?.[CAPABILITY_LABEL], DAG_CAPABILITY);
  runtimeExecuted.push(name);
  return runGraph(graph, input, options);
}

const diamondOverlap = controlledOverlap(["diamond-code", "diamond-docs"]);
const diamondExpectedOutput = {
  result: {
    topic: "durable graph contracts",
    findings: [
      { source: "code", finding: "Test durable graph contracts" },
      { source: "docs", finding: "Document durable graph contracts" },
    ],
  },
};
const diamondRun = await executeDag(
  "diamond",
  diamondGraph,
  { topic: "durable graph contracts" },
  {
    concurrency: 2,
    nodeExecutors: {
      "diamond-split": ({ input }) => {
        assert.deepEqual(input, { topic: "durable graph contracts" });
        return { topic: input.topic };
      },
      "diamond-code": async ({ input }) => {
        assert.deepEqual(input, {
          "diamond-split": { topic: "durable graph contracts" },
        });
        await diamondOverlap.arrive("diamond-code");
        return { source: "code", finding: "Test durable graph contracts" };
      },
      "diamond-docs": async ({ input }) => {
        assert.deepEqual(input, {
          "diamond-split": { topic: "durable graph contracts" },
        });
        await diamondOverlap.arrive("diamond-docs");
        return { source: "docs", finding: "Document durable graph contracts" };
      },
      "diamond-merge": ({ input }) => {
        assert.deepEqual(input, {
          code: { source: "code", finding: "Test durable graph contracts" },
          docs: { source: "docs", finding: "Document durable graph contracts" },
        });
        return {
          topic: "durable graph contracts",
          findings: [input.code, input.docs],
        };
      },
    },
  },
);
diamondOverlap.assertComplete();
assert.equal(diamondRun.status, "succeeded");
assert.equal(diamondRun.graphHash, summaryByName.diamond.graphHash);
assert.equal(diamondRun.maxObservedConcurrency, 2);
assert.deepEqual(diamondRun.output, diamondExpectedOutput);

const verifierOverlap = controlledOverlap([
  "verify-correctness",
  "verify-reproducibility",
  "verify-security",
]);
const claim = "contracts make edges explicit";
const verdicts = {
  correctness: { lens: "correctness", accepted: true },
  reproducibility: { lens: "reproducibility", accepted: true },
  security: { lens: "security", accepted: false },
};
const verifiedExpectedOutput = {
  result: {
    accepted: true,
    acceptedCount: 2,
    lenses: ["correctness", "reproducibility", "security"],
  },
};
const verifiedRun = await executeDag(
  "verifiedFanout",
  verifiedGraph,
  { claim },
  {
    concurrency: 3,
    nodeExecutors: {
      "verify-work": ({ input }) => {
        assert.deepEqual(input, { claim });
        return { claim: input.claim };
      },
      "verify-correctness": async ({ input }) => {
        assert.deepEqual(input, { "verify-work": { claim } });
        await verifierOverlap.arrive("verify-correctness");
        return verdicts.correctness;
      },
      "verify-reproducibility": async ({ input }) => {
        assert.deepEqual(input, { "verify-work": { claim } });
        await verifierOverlap.arrive("verify-reproducibility");
        return verdicts.reproducibility;
      },
      "verify-security": async ({ input }) => {
        assert.deepEqual(input, { "verify-work": { claim } });
        await verifierOverlap.arrive("verify-security");
        return verdicts.security;
      },
      "verify-adjudicate": ({ input }) => {
        assert.deepEqual(input, verdicts);
        const ordered = [input.correctness, input.reproducibility, input.security];
        const acceptedCount = ordered.filter((item) => item.accepted).length;
        return {
          accepted: acceptedCount >= 2,
          acceptedCount,
          lenses: ordered.map((item) => item.lens),
        };
      },
    },
  },
);
verifierOverlap.assertComplete();
assert.equal(verifiedRun.status, "succeeded");
assert.equal(verifiedRun.graphHash, summaryByName.verifiedFanout.graphHash);
assert.equal(verifiedRun.maxObservedConcurrency, 3);
assert.deepEqual(verifiedRun.output, verifiedExpectedOutput);

// Deliberately do not pass routedGraph or loopGraph to runGraph. The current
// scheduler ignores edge conditions; running them would execute every branch
// and every round, which would falsely suggest routing or early-stop support.
assert.deepEqual(runtimeExecuted, ["diamond", "verifiedFanout"]);
assert.equal(runtimeExecuted.includes("routedBranches"), false);
assert.equal(runtimeExecuted.includes("loopUntilDry"), false);

const report = {
  schemaVersion: "graph-engineering.pattern-showcase/v1alpha1",
  patterns: patternSummaries,
  executions: {
    diamond: {
      status: diamondRun.status,
      maxObservedConcurrency: diamondRun.maxObservedConcurrency,
      totalAttempts: diamondRun.totalAttempts,
      output: diamondRun.output,
    },
    verifiedFanout: {
      status: verifiedRun.status,
      maxObservedConcurrency: verifiedRun.maxObservedConcurrency,
      totalAttempts: verifiedRun.totalAttempts,
      output: verifiedRun.output,
    },
  },
  assertions: {
    permutationDeterminism,
    getterInvocations,
    recursivelyFrozen: true,
    mutationRejected,
    runtimeExecuted,
    declarativeOnly: {
      routedBranches: {
        capability: summaryByName.routedBranches.capability,
        executed: false,
      },
      loopUntilDry: {
        capability: summaryByName.loopUntilDry.capability,
        executed: false,
      },
    },
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
