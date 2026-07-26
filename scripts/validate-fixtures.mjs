import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(repositoryRoot, "spec", "conformance");

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareUnicodeCodePoints)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function hash(value) {
  const serialized = JSON.stringify(canonicalize(value));
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

function floatFromBits(bits) {
  const bytes = Buffer.from(bits, "hex");
  assert.equal(bytes.length, 8, `expected one binary64 value, received ${bits}`);
  return bytes.readDoubleBE(0);
}

function floatBits(value) {
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeDoubleBE(value, 0);
  return bytes.toString("hex");
}

function encodeDurableJson(value) {
  if (value === null) return ["n"];
  if (typeof value === "boolean") return ["b", value];
  if (typeof value === "string") return ["s", value];
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), "Durable JSON source numbers must be finite");
    if (Number.isInteger(value)) {
      assert.ok(Number.isSafeInteger(value), "Durable JSON source integers must be safe");
      return ["i", Object.is(value, -0) ? 0 : value];
    }
    return ["f", floatBits(value)];
  }
  if (Array.isArray(value)) return ["a", value.map(encodeDurableJson)];
  assert.equal(typeof value, "object");
  return [
    "o",
    Object.keys(value)
      .sort(compareUnicodeCodePoints)
      .map((key) => [key, encodeDurableJson(value[key])]),
  ];
}

async function loadJson(name) {
  return JSON.parse(await readFile(join(fixtureRoot, name), "utf8"));
}

const expected = await loadJson("expected.json");
const fixtureNames = (await readdir(fixtureRoot)).filter((name) => name.endsWith(".json"));

for (const name of fixtureNames) {
  await loadJson(name);
}

for (const [name, expectation] of Object.entries(expected.canonicalization)) {
  assert.equal(hash(await loadJson(name)), expectation.sha256, `${name} canonical hash drifted`);
}

for (const [name, expectation] of Object.entries(expected.checkpoints ?? {})) {
  const checkpoint = await loadJson(name);
  const { contentHash, ...body } = checkpoint;
  assert.equal(contentHash, expectation.contentHash, `${name} expected checkpoint hash drifted`);
  assert.equal(hash(body), expectation.contentHash, `${name} checkpoint body hash drifted`);
}

const durableJson = await loadJson("durable-json.case.json");
for (const testCase of durableJson.validCases) {
  const source = testCase.source.kind === "float64Bits"
    ? floatFromBits(testCase.source.bits)
    : testCase.source.value;
  const encoding = encodeDurableJson(source);
  const canonicalJson = JSON.stringify(encoding);
  assert.deepEqual(encoding, testCase.expect.encoding, `${testCase.name} Durable JSON encoding drifted`);
  assert.equal(
    canonicalJson,
    testCase.expect.canonicalJson,
    `${testCase.name} Durable JSON canonical text drifted`,
  );
  assert.equal(
    createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
    testCase.expect.sha256,
    `${testCase.name} Durable JSON hash drifted`,
  );
}

const diamond = await loadJson("diamond.graph.json");
assert.equal(diamond.apiVersion, "graphengineering.reacher-z.github.io/v1alpha1");
assert.equal(diamond.kind, "Graph");
assert.equal(new Set(diamond.nodes.map(({ id }) => id)).size, diamond.nodes.length);
assert.equal(new Set(diamond.edges.map(({ id }) => id)).size, diamond.edges.length);

process.stdout.write(
  `Validated ${fixtureNames.length} JSON fixtures, ${Object.keys(expected.canonicalization).length} graph hash, ${Object.keys(expected.checkpoints ?? {}).length} checkpoint hash, and ${durableJson.validCases.length} Durable JSON vectors.\n`,
);
