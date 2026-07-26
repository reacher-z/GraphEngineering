import assert from "node:assert/strict";
import test from "node:test";
import { MAX_GRAPH_BYTES, MAX_GRAPH_NODES } from "../src/constants.js";
import { compileGraphBounded } from "../src/limits.js";

test("rejects graph payloads above the byte limit before compilation", async () => {
  const result = await compileGraphBounded({ description: "x".repeat(MAX_GRAPH_BYTES) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issue.code, "MCP_INPUT_TOO_LARGE");
});

test("returns a structured issue for a non-JSON undefined input", async () => {
  const result = await compileGraphBounded(undefined);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issue.code, "MCP_INTERNAL_ERROR");
});

test("rejects excessive graph node counts", async () => {
  const result = await compileGraphBounded({
    nodes: Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, index) => index),
    edges: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issue.code, "MCP_GRAPH_TOO_LARGE");
});

test("honors cancellation before starting a compiler worker", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await compileGraphBounded({}, controller.signal);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issue.code, "MCP_REQUEST_CANCELLED");
});

test("terminates a compiler worker at the configured deadline", async () => {
  const result = await compileGraphBounded({}, undefined, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issue.code, "MCP_TOOL_TIMEOUT");
});
