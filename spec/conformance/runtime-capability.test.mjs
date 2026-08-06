import assert from "node:assert/strict";
import test from "node:test";

import {
  validateRuntimeCapabilityFixture,
  validateRuntimeCapabilityGraphSemantics,
} from "./runtime-capability.validate.mjs";

test("runtime capability corpus is closed and internally consistent", async () => {
  const fixture = await validateRuntimeCapabilityFixture();
  assert.equal(fixture.contract, "runtime-capability/v1alpha1");
  assert.equal(fixture.cases.length, 8);
  assert.equal(fixture.cases.filter((item) => item.expect.supported).length, 1);
  assert.equal(
    fixture.cases.reduce((total, item) => total + item.expect.failures.length, 0),
    23,
  );
});

test("runtime capability semantic validation rejects compiler-invalid policy depth", async () => {
  const fixture = await validateRuntimeCapabilityFixture();
  const graph = structuredClone(fixture.cases[0].graph);
  graph.policies.maxDepth = 1;
  assert.throws(
    () => validateRuntimeCapabilityGraphSemantics(graph, "hostile-depth-regression"),
    /hostile-depth-regression exceeds policies\.maxDepth/,
  );
});
