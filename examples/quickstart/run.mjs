#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runGraph } from "../../packages/runtime/dist/index.js";

const graph = JSON.parse(
  await readFile(new URL("./research-diamond.graph.json", import.meta.url), "utf8"),
);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const result = await runGraph(graph, { topic: "durable agent graphs" }, {
  nodeExecutors: {
    scope: ({ input }) => input,
    "research-docs": async ({ input }) => {
      await delay(20);
      return {
        source: "docs",
        finding: `Document the contract for ${input.scope.topic}`,
      };
    },
    "research-code": async ({ input }) => {
      await delay(10);
      return {
        source: "code",
        finding: `Test the runtime for ${input.scope.topic}`,
      };
    },
    synthesize: ({ input }) => input,
  },
});

assert.equal(result.status, "succeeded");
assert.equal(result.maxObservedConcurrency, 2);

process.stdout.write(`${JSON.stringify({
  status: result.status,
  maxObservedConcurrency: result.maxObservedConcurrency,
  report: result.output.report,
}, null, 2)}\n`);
