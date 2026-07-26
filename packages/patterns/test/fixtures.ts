import assert from "node:assert/strict";
import type { GraphMetadata, NodeKind, NodeSpec } from "@graph-engineering/core";
import { PatternInputError, type PatternErrorCode } from "../src/index.js";

export function metadata(name = "pattern-test"): GraphMetadata {
  return { name, version: "1.0.0" };
}

export function node(id: string, kind: NodeKind = "transform", config: unknown = {}): NodeSpec {
  return {
    id,
    kind,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    config,
    sideEffects: "none",
  };
}

export function expectPatternError(
  action: () => unknown,
  code: PatternErrorCode,
  path?: string,
): PatternInputError {
  let captured: PatternInputError | undefined;
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PatternInputError);
    assert.equal(error.code, code);
    if (path !== undefined) assert.equal(error.path, path);
    captured = error;
    return true;
  });
  return captured as PatternInputError;
}
