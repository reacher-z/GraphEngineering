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

const diamond = await loadJson("diamond.graph.json");
assert.equal(diamond.apiVersion, "graphengineering.reacher-z.github.io/v1alpha1");
assert.equal(diamond.kind, "Graph");
assert.equal(new Set(diamond.nodes.map(({ id }) => id)).size, diamond.nodes.length);
assert.equal(new Set(diamond.edges.map(({ id }) => id)).size, diamond.edges.length);

process.stdout.write(
  `Validated ${fixtureNames.length} JSON fixtures, ${Object.keys(expected.canonicalization).length} graph hash, and ${Object.keys(expected.checkpoints ?? {}).length} checkpoint hash.\n`,
);
