import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

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

async function listFixtureFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareUnicodeCodePoints(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const relativeName = prefix.length === 0 ? entry.name : join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFixtureFiles(join(directory, entry.name), relativeName));
      continue;
    }
    assert.ok(entry.isFile(), `fixture entry must be a regular file: ${relativeName}`);
    files.push(relativeName);
  }
  return files;
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
const allFixtureNames = await listFixtureFiles(fixtureRoot);
const fixtureNameSet = new Set(allFixtureNames);
const fixtureNames = allFixtureNames.filter((name) => name.endsWith(".json"));
const caseNames = fixtureNames.filter((name) => name.endsWith(".case.json"));
const yamlNames = allFixtureNames.filter((name) => /\.ya?ml$/u.test(name));

for (const name of fixtureNames) {
  await loadJson(name);
}

function fixtureReference(manifestName, reference) {
  assert.equal(isAbsolute(reference), false, `${manifestName} contains an absolute fixture reference`);
  assert.equal(reference.includes("\\"), false, `${manifestName} fixture references must use '/'`);
  let candidate = reference.startsWith("spec/conformance/")
    ? reference.slice("spec/conformance/".length)
    : reference;
  candidate = normalize(candidate);
  assert.ok(
    candidate !== ".." && !candidate.startsWith("../") && !candidate.startsWith("..\\"),
    `${manifestName} fixture reference escapes the conformance root: ${reference}`,
  );
  const manifestRelative = normalize(join(dirname(manifestName), candidate));
  const matches = [...new Set([candidate, manifestRelative])]
    .filter((name) => fixtureNameSet.has(name));
  assert.equal(
    matches.length,
    1,
    `${manifestName} must reference exactly one existing fixture for ${reference}`,
  );
  return matches[0];
}

function collectYamlReferences(value, manifestName, references) {
  if (typeof value === "string") {
    if (/\.ya?ml$/u.test(value)) references.add(fixtureReference(manifestName, value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectYamlReferences(item, manifestName, references);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectYamlReferences(item, manifestName, references);
    }
  }
}

const referencedYamlNames = new Set();
for (const name of caseNames) {
  collectYamlReferences(await loadJson(name), name, referencedYamlNames);
}
assert.deepEqual(
  [...referencedYamlNames].sort(compareUnicodeCodePoints),
  [...yamlNames].sort(compareUnicodeCodePoints),
  "every YAML conformance fixture must be referenced by the case corpus",
);

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

const compiledIdentitySchema = JSON.parse(
  await readFile(join(repositoryRoot, "spec", "compiled-identity.schema.json"), "utf8"),
);
const identityValidatorEngine = new Ajv2020({ allErrors: true, strict: true });
assert.equal(
  identityValidatorEngine.validateSchema(compiledIdentitySchema),
  true,
  `compiled identity schema is not a valid Draft 2020-12 schema: ${JSON.stringify(identityValidatorEngine.errors)}`,
);
const validateCompiledIdentity = identityValidatorEngine.compile(compiledIdentitySchema);
const identityGoldenSet = await loadJson("authoring/component-identity.expected.json");
const compiledIdentities = Object.entries(identityGoldenSet.identities);
for (const [name, identity] of compiledIdentities) {
  assert.equal(
    validateCompiledIdentity(identity),
    true,
    `${name} compiled identity does not conform: ${JSON.stringify(validateCompiledIdentity.errors)}`,
  );
}

const graphSchema = JSON.parse(
  await readFile(join(repositoryRoot, "spec", "graph.schema.json"), "utf8"),
);
const graphPatchSchema = JSON.parse(
  await readFile(join(repositoryRoot, "spec", "graph-patch.schema.json"), "utf8"),
);
const graphPatchValidatorEngine = new Ajv2020({ allErrors: true, strict: true });
assert.equal(
  graphPatchValidatorEngine.validateSchema(graphPatchSchema),
  true,
  `graph patch schema is not a valid Draft 2020-12 schema: ${JSON.stringify(graphPatchValidatorEngine.errors)}`,
);
graphPatchValidatorEngine.addSchema(graphSchema);
const validateGraphPatch = graphPatchValidatorEngine.compile(graphPatchSchema);
const graphPatchCases = await loadJson("graph-patch.case.json");
for (const testCase of graphPatchCases.validCases) {
  assert.equal(
    validateGraphPatch(testCase.document),
    true,
    `${testCase.name} valid graph patch does not conform: ${JSON.stringify(validateGraphPatch.errors)}`,
  );
}
for (const testCase of graphPatchCases.invalidCases) {
  assert.equal(
    validateGraphPatch(testCase.document),
    false,
    `${testCase.name} invalid graph patch unexpectedly conforms`,
  );
}
const graphPatchSemanticFields = new Set([
  "name", "baseGraph", "mutation", "operation", "expectCode", "expectOutcome",
  "expectSchedulerMutations", "expectAccepted", "expectRejectedCode", "expectRealApply",
  "expectDryRunMutations", "expectCompilerCalls",
]);
for (const testCase of graphPatchCases.semanticCases) {
  assert.ok(typeof testCase.name === "string" && testCase.name.length > 0, "GraphPatch semantic case has no name");
  assert.equal(
    Number(Object.hasOwn(testCase, "mutation")) + Number(Object.hasOwn(testCase, "operation")),
    1,
    `${testCase.name} must define exactly one semantic operation`,
  );
  assert.ok(
    Object.keys(testCase).every((field) => graphPatchSemanticFields.has(field)),
    `${testCase.name} has an unknown semantic-case field`,
  );
  const expectationFields = Object.keys(testCase).filter((field) => field.startsWith("expect"));
  assert.ok(expectationFields.length > 0, `${testCase.name} has no closed expected outcome`);
  for (const field of ["expectCode", "expectRejectedCode"]) {
    if (testCase[field] !== undefined) {
      assert.match(testCase[field], /^GE_PATCH_[A-Z0-9_]{3,64}$/, `${testCase.name} has an invalid stable patch code`);
    }
  }
}

function hostilePointerTokens(path) {
  assert.match(path, /^\//u, "hostile GraphPatch mutation path must be an absolute JSON pointer");
  return path.slice(1).split("/").map((token) => (
    token.replaceAll("~1", "/").replaceAll("~0", "~")
  ));
}

function hostileParentAt(document, path) {
  const tokens = hostilePointerTokens(path);
  assert.ok(tokens.length > 0);
  let parent = document;
  for (const token of tokens.slice(0, -1)) {
    assert.ok(parent !== null && typeof parent === "object");
    parent = parent[token];
  }
  return { parent, token: tokens.at(-1) };
}

function hostileNestedObject(key, depth) {
  assert.equal(typeof key, "string");
  assert.ok(key.length > 0 && Number.isSafeInteger(depth) && depth > 0);
  let value = "leaf";
  for (let index = 0; index < depth; index += 1) value = { [key]: value };
  return value;
}

function materializeHostileGraphPatch(seedDocument, mutation) {
  const operationFields = {
    "replace-root": new Set(["op", "value"]),
    remove: new Set(["op", "path"]),
    add: new Set(["op", "path", "value"]),
    replace: new Set(["op", "path", "value"]),
    "repeat-string": new Set(["op", "path", "character", "length"]),
    "nest-object": new Set(["op", "path", "key", "depth"]),
  };
  assert.ok(Object.hasOwn(operationFields, mutation.op), `unknown hostile mutation ${String(mutation.op)}`);
  assert.ok(
    Object.keys(mutation).every((field) => operationFields[mutation.op].has(field))
      && Object.keys(mutation).length === operationFields[mutation.op].size,
    `hostile mutation ${mutation.op} is not closed`,
  );
  if (mutation.op === "replace-root") return structuredClone(mutation.value);
  const document = structuredClone(seedDocument);
  const { parent, token } = hostileParentAt(document, mutation.path);
  assert.ok(parent !== null && typeof parent === "object");
  if (mutation.op === "remove") {
    assert.ok(Object.hasOwn(parent, token), `${mutation.path} does not exist for removal`);
    delete parent[token];
  } else if (mutation.op === "add" || mutation.op === "replace") {
    parent[token] = structuredClone(mutation.value);
  } else if (mutation.op === "repeat-string") {
    assert.equal(typeof mutation.character, "string");
    assert.equal([...mutation.character].length, 1);
    assert.ok(Number.isSafeInteger(mutation.length) && mutation.length >= 0);
    parent[token] = mutation.character.repeat(mutation.length);
  } else if (mutation.op === "nest-object") {
    parent[token] = hostileNestedObject(mutation.key, mutation.depth);
  }
  return document;
}

function portableDepth(value, depth = 0) {
  if (value === null || typeof value !== "object") return depth;
  return Math.max(depth, ...Object.values(value).map((child) => portableDepth(child, depth + 1)));
}

const graphPatchHostileShape = await loadJson("graph-patch-hostile-shape.case.json");
assert.equal(graphPatchHostileShape.schemaVersion, 1);
assert.equal(graphPatchHostileShape.id, "graph-patch-hostile-shape-v1alpha1");
assert.equal(graphPatchHostileShape.patchSchema, "spec/graph-patch.schema.json");
assert.equal(
  fixtureReference("graph-patch-hostile-shape.case.json", graphPatchHostileShape.baseGraph),
  "diamond.graph.json",
);
assert.equal(
  validateGraphPatch(graphPatchHostileShape.seedDocument),
  true,
  `hostile GraphPatch seed does not conform: ${JSON.stringify(validateGraphPatch.errors)}`,
);
assert.equal(
  graphPatchHostileShape.seedDocument.base.graphHash,
  expected.canonicalization[graphPatchHostileShape.baseGraph].sha256,
  "hostile GraphPatch seed is detached from the selected base graph",
);
const hostileShapeCases = graphPatchHostileShape.cases;
const hostileShapeExpect = graphPatchHostileShape.expect;
assert.equal(hostileShapeCases.length, hostileShapeExpect.caseCount);
assert.equal(new Set(hostileShapeCases.map(({ id }) => id)).size, hostileShapeCases.length);
const hostileShapeCategories = new Map();
const hostileShapeLayers = new Map();
const allowedHostileFields = new Set(["id", "category", "layer", "mutation", "expectCode"]);
for (const attack of hostileShapeCases) {
  assert.ok(Object.keys(attack).every((field) => allowedHostileFields.has(field)));
  assert.match(attack.id, /^[a-z][a-z0-9-]{2,63}$/u);
  assert.ok(Object.hasOwn(hostileShapeExpect.categoryCounts, attack.category));
  assert.ok(attack.layer === "schema" || attack.layer === "runtime-capture");
  assert.equal(attack.expectCode, "GE_PATCH_INVALID");
  hostileShapeCategories.set(
    attack.category,
    (hostileShapeCategories.get(attack.category) ?? 0) + 1,
  );
  hostileShapeLayers.set(attack.layer, (hostileShapeLayers.get(attack.layer) ?? 0) + 1);
  const document = materializeHostileGraphPatch(
    graphPatchHostileShape.seedDocument,
    attack.mutation,
  );
  const schemaAccepted = validateGraphPatch(document);
  if (attack.layer === "schema") {
    assert.equal(schemaAccepted, false, `${attack.id} unexpectedly passes the independent schema`);
  } else {
    assert.equal(
      schemaAccepted,
      true,
      `${attack.id} must isolate a runtime capture bound after schema acceptance`,
    );
    const canonicalBytes = Buffer.byteLength(JSON.stringify(canonicalize(document)), "utf8");
    assert.ok(
      canonicalBytes > 4_194_304 || portableDepth(document) > 100,
      `${attack.id} does not exceed a retained runtime capture bound`,
    );
  }
}
assert.deepEqual(
  Object.fromEntries([...hostileShapeCategories].sort(([left], [right]) => compareUnicodeCodePoints(left, right))),
  hostileShapeExpect.categoryCounts,
);
assert.equal(hostileShapeLayers.get("schema"), hostileShapeExpect.schemaCaseCount);
assert.equal(
  hostileShapeLayers.get("runtime-capture"),
  hostileShapeExpect.runtimeCaptureCaseCount,
);
const hostileShapeCanonical = JSON.stringify(canonicalize(hostileShapeCases));
assert.equal(
  Buffer.byteLength(hostileShapeCanonical, "utf8"),
  hostileShapeExpect.casesCanonicalUtf8Bytes,
);
assert.equal(hash(hostileShapeCases), hostileShapeExpect.casesSha256);
const expectedHostileAssertions = new Set([
  "seed-patch-is-valid-and-bound-to-the-base-graph",
  "corpus-is-a-closed-ordered-set-with-unique-identities",
  "schema-attacks-fail-the-independent-json-schema-validator",
  "runtime-capture-attacks-pass-shape-schema-but-exceed-runtime-bounds",
  "both-native-runtimes-reconstruct-identical-attack-bytes",
  "every-attack-fails-with-the-exact-public-error-code",
  "validation-occurs-before-compiler-decision-recorder-or-graph-mutation",
  "caller-owned-attack-documents-remain-detached",
  "corpus-canonical-byte-count-and-digest-are-frozen",
]);
assert.equal(graphPatchHostileShape.requiredAssertions.length, expectedHostileAssertions.size);
assert.deepEqual(new Set(graphPatchHostileShape.requiredAssertions), expectedHostileAssertions);

function semanticNode(id, overrides = {}) {
  return {
    id,
    kind: "validator",
    inputSchema: {},
    outputSchema: {},
    config: {},
    sideEffects: "none",
    ...overrides,
  };
}

function semanticPatch(coordinate, patchId, nodeId) {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1",
    kind: "GraphPatch",
    patchId,
    base: structuredClone(coordinate),
    append: {
      nodes: [semanticNode(nodeId)],
      edges: [{
        id: `${patchId}-edge`,
        from: { node: "merge" },
        to: { node: nodeId },
        mode: "value",
      }],
      outputs: { [`${nodeId}Result`]: { node: nodeId } },
    },
  };
}

function materializeSemanticGraphPatch(coordinate, attack) {
  const nodeId = `${attack.id}-node`;
  const proposal = semanticPatch(coordinate, `semantic-${attack.id}`, nodeId);
  switch (attack.scenario) {
    case "stale-base":
      proposal.base.graphRevision += 1;
      break;
    case "duplicate-existing-node":
      proposal.append.nodes[0].id = "split";
      proposal.append.edges[0].to.node = "split";
      proposal.append.outputs = { duplicateNode: { node: "split" } };
      break;
    case "duplicate-new-node":
      proposal.append.nodes.push(structuredClone(proposal.append.nodes[0]));
      break;
    case "duplicate-existing-edge":
      proposal.append.edges[0].id = "left-merge";
      break;
    case "duplicate-new-edge":
      proposal.append.edges.push(structuredClone(proposal.append.edges[0]));
      break;
    case "duplicate-existing-output":
      proposal.append.outputs = { result: { node: nodeId } };
      break;
    case "incoming-existing-target":
      proposal.append.edges[0].to.node = "left";
      break;
    case "unsupported-stream-edge":
      proposal.append.edges[0].mode = "stream";
      break;
    case "config-capability-expansion":
      proposal.append.nodes[0].config = { capabilities: ["network"] };
      break;
    case "resource-capability-expansion":
      proposal.append.nodes[0].resources = { capabilities: ["network"] };
      break;
    case "candidate-cycle": {
      const left = `${attack.id}-left`;
      const right = `${attack.id}-right`;
      proposal.append.nodes = [semanticNode(left), semanticNode(right)];
      proposal.append.edges = [
        { id: `${attack.id}-entry`, from: { node: "merge" }, to: { node: left }, mode: "value" },
        { id: `${attack.id}-forward`, from: { node: left }, to: { node: right }, mode: "value" },
        { id: `${attack.id}-cycle`, from: { node: right }, to: { node: left }, mode: "value" },
      ];
      proposal.append.outputs = { cycleResult: { node: right } };
      break;
    }
    case "source-not-succeeded":
    case "zero-dynamic-reservation":
    case "runtime-dynamic-limit":
    case "maximum-node-limit":
    case "maximum-edge-limit":
    case "maximum-output-limit":
    case "maximum-depth-limit":
    case "maximum-fanout-limit":
    case "exact-rejected-retry":
    case "changed-decided-id":
    case "historical-accepted-retry":
    case "dry-run-id-reuse":
    case "same-base-one-winner":
      break;
    default:
      assert.fail(`unknown hostile semantic scenario ${String(attack.scenario)}`);
  }
  return proposal;
}

const graphPatchHostileSemantic = await loadJson("graph-patch-hostile-semantic.case.json");
assert.equal(graphPatchHostileSemantic.schemaVersion, 1);
assert.equal(graphPatchHostileSemantic.id, "graph-patch-hostile-semantic-v1alpha1");
assert.equal(
  fixtureReference("graph-patch-hostile-semantic.case.json", graphPatchHostileSemantic.baseGraph),
  "diamond.graph.json",
);
const hostileSemanticCases = graphPatchHostileSemantic.cases;
const hostileSemanticExpect = graphPatchHostileSemantic.expect;
assert.equal(hostileSemanticCases.length, hostileSemanticExpect.caseCount);
assert.equal(new Set(hostileSemanticCases.map(({ id }) => id)).size, hostileSemanticCases.length);
assert.equal(
  new Set(hostileSemanticCases.map(({ scenario }) => scenario)).size,
  hostileSemanticCases.length,
);
const expectedSemanticScenarios = new Set([
  "stale-base",
  "duplicate-existing-node",
  "duplicate-new-node",
  "duplicate-existing-edge",
  "duplicate-new-edge",
  "duplicate-existing-output",
  "incoming-existing-target",
  "source-not-succeeded",
  "unsupported-stream-edge",
  "config-capability-expansion",
  "resource-capability-expansion",
  "zero-dynamic-reservation",
  "runtime-dynamic-limit",
  "maximum-node-limit",
  "maximum-edge-limit",
  "maximum-output-limit",
  "maximum-depth-limit",
  "maximum-fanout-limit",
  "candidate-cycle",
  "exact-rejected-retry",
  "changed-decided-id",
  "historical-accepted-retry",
  "dry-run-id-reuse",
  "same-base-one-winner",
]);
assert.deepEqual(new Set(hostileSemanticCases.map(({ scenario }) => scenario)), expectedSemanticScenarios);
const semanticCategories = new Map();
const semanticCoordinate = {
  graphRevision: 1,
  graphHash: expected.canonicalization[graphPatchHostileSemantic.baseGraph].sha256,
  revisionHash: "1".repeat(64),
};
for (const attack of hostileSemanticCases) {
  assert.match(attack.id, /^[a-z][a-z0-9-]{2,63}$/u);
  assert.equal(attack.id, attack.scenario, `${attack.id} semantic identity must equal its scenario`);
  assert.ok(Object.hasOwn(hostileSemanticExpect.categoryCounts, attack.category));
  const isDecision = attack.expectOutcome === "rejected";
  const allowedFields = new Set(["id", "category", "scenario", "expectOutcome", "expectCode"]);
  assert.ok(Object.keys(attack).every((field) => allowedFields.has(field)));
  assert.equal(Object.hasOwn(attack, "expectCode"), isDecision || attack.scenario === "changed-decided-id");
  if (Object.hasOwn(attack, "expectCode")) assert.match(attack.expectCode, /^GE_PATCH_[A-Z0-9_]{3,64}$/u);
  semanticCategories.set(attack.category, (semanticCategories.get(attack.category) ?? 0) + 1);
  const document = materializeSemanticGraphPatch(semanticCoordinate, attack);
  assert.equal(
    validateGraphPatch(document),
    true,
    `${attack.id} must pass the independent GraphPatch schema: ${JSON.stringify(validateGraphPatch.errors)}`,
  );
}
assert.deepEqual(
  Object.fromEntries([...semanticCategories].sort(([left], [right]) => compareUnicodeCodePoints(left, right))),
  hostileSemanticExpect.categoryCounts,
);
assert.equal(
  hostileSemanticCases.filter(({ expectOutcome }) => expectOutcome === "rejected").length,
  hostileSemanticExpect.decisionCaseCount,
);
assert.equal(
  hostileSemanticCases.filter(({ expectOutcome }) => expectOutcome !== "rejected").length,
  hostileSemanticExpect.behaviorCaseCount,
);
const hostileSemanticCanonical = JSON.stringify(canonicalize(hostileSemanticCases));
assert.equal(
  Buffer.byteLength(hostileSemanticCanonical, "utf8"),
  hostileSemanticExpect.casesCanonicalUtf8Bytes,
);
assert.equal(hash(hostileSemanticCases), hostileSemanticExpect.casesSha256);
const expectedSemanticAssertions = new Set([
  "every-generated-patch-passes-the-closed-shape-contract",
  "semantic-rejections-return-the-exact-public-error-code",
  "semantic-rejections-leave-the-graph-coordinate-unchanged",
  "dry-run-rejections-record-no-decision-and-consume-no-id",
  "rejected-exact-retry-reuses-the-complete-recorded-decision",
  "changed-bytes-under-a-decided-id-fail-without-a-second-record",
  "accepted-historical-retry-precedes-current-base-rejection",
  "dry-run-does-not-reserve-a-patch-id-or-cache-authority",
  "same-base-applications-produce-one-accepted-revision-and-one-stale-rejection",
  "both-native-runtimes-match-patch-hashes-budget-outcomes-and-state-projections",
  "fixture-and-native-scenario-vocabularies-are-closed-and-hashed",
]);
assert.equal(graphPatchHostileSemantic.requiredAssertions.length, expectedSemanticAssertions.size);
assert.deepEqual(new Set(graphPatchHostileSemantic.requiredAssertions), expectedSemanticAssertions);

const graphPatchHostileRestore = await loadJson("graph-patch-hostile-restore.case.json");
assert.equal(graphPatchHostileRestore.schemaVersion, 1);
assert.equal(graphPatchHostileRestore.id, "graph-patch-hostile-restore-v1alpha1");
assert.equal(
  fixtureReference("graph-patch-hostile-restore.case.json", graphPatchHostileRestore.baseGraph),
  "diamond.graph.json",
);
const hostileRestoreCases = graphPatchHostileRestore.cases;
const hostileRestoreExpect = graphPatchHostileRestore.expect;
assert.equal(hostileRestoreCases.length, hostileRestoreExpect.caseCount);
assert.equal(new Set(hostileRestoreCases.map(({ id }) => id)).size, hostileRestoreCases.length);
assert.equal(
  new Set(hostileRestoreCases.map(({ scenario }) => scenario)).size,
  hostileRestoreCases.length,
);
const expectedRestoreScenarios = new Set([
  "accepted-extra-field",
  "accepted-patch-id-drift",
  "accepted-patch-hash-drift",
  "accepted-payload-noncanonical",
  "accepted-payload-length-drift",
  "accepted-requested-base-drift",
  "accepted-planner-key-mismatch",
  "accepted-authority-hash-invalid",
  "accepted-policy-hash-invalid",
  "accepted-budget-negative",
  "accepted-budget-unreconciled",
  "accepted-dynamic-count-drift",
  "accepted-diagnostics-present",
  "accepted-revision-skip",
  "accepted-previous-hash-drift",
  "accepted-revision-patch-hash-drift",
  "accepted-revision-hash-drift",
  "accepted-graph-hash-drift",
  "accepted-over-dynamic-limit",
  "accepted-over-node-limit",
  "rejected-extra-field",
  "rejected-diagnostics-empty",
  "rejected-error-code-unknown",
  "rejected-dynamic-commit-nonzero",
  "rejected-outcome-mismatch",
  "rejected-planner-key-mismatch",
  "rejected-budget-unreconciled",
  "accepted-restore",
  "rejected-restore",
  "stale-rejection-after-accepted",
  "sequential-accepted-history",
  "exact-accepted-duplicate",
  "historical-accepted-duplicate",
  "conflicting-duplicate",
]);
assert.deepEqual(
  new Set(hostileRestoreCases.map(({ scenario }) => scenario)),
  expectedRestoreScenarios,
);
const restoreBehaviors = new Set([
  "accepted-restore",
  "rejected-restore",
  "stale-rejection-after-accepted",
  "sequential-accepted-history",
  "exact-accepted-duplicate",
  "historical-accepted-duplicate",
  "conflicting-duplicate",
]);
const restoreCategories = new Map();
for (const item of hostileRestoreCases) {
  assert.match(item.id, /^[a-z][a-z0-9-]{2,63}$/u);
  assert.equal(item.id, item.scenario, `${item.id} restore identity must equal its scenario`);
  assert.ok(Object.hasOwn(hostileRestoreExpect.categoryCounts, item.category));
  assert.ok(item.seed === "accepted" || item.seed === "rejected" || item.seed === "mixed");
  assert.ok(
    item.expectOutcome === "restore-rejected"
      || item.expectOutcome === "restored"
      || item.expectOutcome === "duplicate-reused",
  );
  const allowedFields = new Set([
    "id", "category", "seed", "scenario", "expectOutcome", "expectCode",
  ]);
  assert.ok(Object.keys(item).every((field) => allowedFields.has(field)));
  assert.equal(Object.hasOwn(item, "expectCode"), item.expectOutcome === "restore-rejected");
  if (restoreBehaviors.has(item.scenario)) {
    assert.ok(
      item.expectCode === undefined || item.expectCode === "GE_PATCH_IDEMPOTENCY_CONFLICT",
    );
  } else {
    assert.equal(item.expectCode, "GE_CYCLE_INVALID_HISTORY");
  }
  restoreCategories.set(item.category, (restoreCategories.get(item.category) ?? 0) + 1);
}
assert.deepEqual(
  Object.fromEntries([...restoreCategories].sort(([left], [right]) => compareUnicodeCodePoints(left, right))),
  hostileRestoreExpect.categoryCounts,
);
assert.equal(
  hostileRestoreCases.filter(({ scenario }) => !restoreBehaviors.has(scenario)).length,
  hostileRestoreExpect.attackCaseCount,
);
assert.equal(
  hostileRestoreCases.filter(({ scenario }) => restoreBehaviors.has(scenario)).length,
  hostileRestoreExpect.behaviorCaseCount,
);
const hostileRestoreCanonical = JSON.stringify(canonicalize(hostileRestoreCases));
assert.equal(
  Buffer.byteLength(hostileRestoreCanonical, "utf8"),
  hostileRestoreExpect.casesCanonicalUtf8Bytes,
);
assert.equal(hash(hostileRestoreCases), hostileRestoreExpect.casesSha256);
const expectedRestoreAssertions = new Set([
  "accepted-and-rejected-seed-carriers-are-byte-identical-across-native-runtimes",
  "every-hostile-carrier-has-an-exact-input-byte-count-and-digest",
  "closed-decision-shapes-reject-unknown-fields-before-state-mutation",
  "patch-payload-id-hash-length-and-canonical-bytes-remain-bound",
  "planner-authority-policy-and-requested-base-evidence-remain-bound",
  "requested-committed-and-released-budgets-reconcile-exactly",
  "accepted-decisions-bind-empty-diagnostics-node-count-and-revision-chain",
  "rejected-decisions-bind-nonempty-diagnostics-zero-dynamic-commit-and-known-code",
  "restore-enforces-graph-and-dynamic-node-limits-before-exposure",
  "stale-rejections-restore-after-the-accepted-winner-without-requiring-a-current-old-base",
  "exact-historical-decisions-reuse-without-second-mutation-or-counting",
  "conflicting-duplicate-decisions-fail-without-overwriting-the-first-record",
  "both-native-runtimes-match-error-codes-coordinate-decision-count-and-dynamic-state",
  "fixture-validator-and-native-scenario-vocabularies-are-closed-and-hashed",
]);
assert.equal(graphPatchHostileRestore.requiredAssertions.length, expectedRestoreAssertions.size);
assert.deepEqual(new Set(graphPatchHostileRestore.requiredAssertions), expectedRestoreAssertions);

// D7 bounded-cycle contracts are versioned separately from the immutable-DAG
// scheduler. This validator freezes their schemas, canonical hashes, event
// chain, checkpoint projection, and hostile contract vectors without claiming
// that either native runtime executes the protocol yet.
const d7SchemaNames = [
  "graph-revision.schema.json",
  "cycle-controller-policy.schema.json",
  "cycle-controller-result.schema.json",
  "cycle-controller.schema.json",
  "cycle-controller-event.schema.json",
  "cycle-controller-checkpoint.schema.json",
  "cycle-controller-lineage-manifest.schema.json",
];
const d7Schemas = await Promise.all(
  d7SchemaNames.map(async (name) => JSON.parse(
    await readFile(join(repositoryRoot, "spec", name), "utf8"),
  )),
);
const d7SchemaEngine = new Ajv2020({ allErrors: true, strict: true });
for (const schema of d7Schemas) {
  assert.equal(
    d7SchemaEngine.validateSchema(schema),
    true,
    `${schema.$id} is not a valid Draft 2020-12 schema: ${JSON.stringify(d7SchemaEngine.errors)}`,
  );
  d7SchemaEngine.addSchema(schema);
}
const [
  validateGraphRevision,
  validateCyclePolicy,
  validateCycleResult,
  validateCycleRequest,
  validateCycleEvent,
  validateCycleCheckpoint,
  validateCycleLineageManifest,
] = d7Schemas.map((schema) => {
  const validator = d7SchemaEngine.getSchema(schema.$id);
  assert.ok(validator, `missing compiled D7 schema ${schema.$id}`);
  return validator;
});

function cloneJson(value) {
  return structuredClone(value);
}

function pointerSegments(pointer) {
  assert.equal(typeof pointer, "string", "JSON Pointer must be a string");
  assert.ok(pointer.startsWith("/"), `mutation pointer must start with '/': ${pointer}`);
  return pointer.slice(1).split("/").map((segment) => (
    segment.replaceAll("~1", "/").replaceAll("~0", "~")
  ));
}

function valueAtPointer(document, pointer) {
  let current = document;
  for (const segment of pointerSegments(pointer)) {
    assert.ok(current !== null && typeof current === "object", `pointer parent is not a container: ${pointer}`);
    assert.ok(Object.hasOwn(current, segment), `pointer does not exist: ${pointer}`);
    current = current[segment];
  }
  return current;
}

function applyJsonMutation(document, mutation) {
  const segments = pointerSegments(mutation.path);
  const leaf = segments.pop();
  let parent = document;
  for (const segment of segments) {
    assert.ok(parent !== null && typeof parent === "object", `mutation parent is not a container: ${mutation.path}`);
    assert.ok(Object.hasOwn(parent, segment), `mutation parent does not exist: ${mutation.path}`);
    parent = parent[segment];
  }
  assert.notEqual(leaf, undefined);
  if (mutation.op === "remove") {
    assert.ok(Object.hasOwn(parent, leaf), `remove target does not exist: ${mutation.path}`);
    if (Array.isArray(parent)) parent.splice(Number(leaf), 1);
    else delete parent[leaf];
    return;
  }
  const mutationValue = Object.hasOwn(mutation, "valueFrom")
    ? cloneJson(valueAtPointer(document, mutation.valueFrom))
    : cloneJson(mutation.value);
  if (mutation.op === "add") {
    if (Array.isArray(parent)) {
      const index = Number(leaf);
      assert.ok(Number.isSafeInteger(index) && index >= 0 && index <= parent.length);
      parent.splice(index, 0, mutationValue);
    } else {
      assert.equal(Object.hasOwn(parent, leaf), false, `add target already exists: ${mutation.path}`);
      parent[leaf] = mutationValue;
    }
    return;
  }
  assert.equal(mutation.op, "replace", `unsupported JSON mutation op: ${mutation.op}`);
  assert.ok(Object.hasOwn(parent, leaf), `replace target does not exist: ${mutation.path}`);
  parent[leaf] = mutationValue;
}

function hashWithDomain(domain, value) {
  return createHash("sha256")
    .update(domain, "utf8")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function inlinePayloadFrom(value) {
  const canonicalJson = JSON.stringify(canonicalize(value));
  return {
    disposition: "inline-unredacted",
    redacted: false,
    encoding: "canonical-json/v1alpha1",
    canonicalJson,
    utf8ByteLength: Buffer.byteLength(canonicalJson, "utf8"),
    sha256: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
  };
}

function assertPortableJsonValue(value, label, limits = {}) {
  const maxDepth = limits.maxDepth ?? 100;
  const maxValues = limits.maxValues ?? 100000;
  let values = 0;
  const visit = (current, depth) => {
    values += 1;
    assert.ok(values <= maxValues, `${label} exceeds ${maxValues} portable JSON values`);
    assert.ok(depth <= maxDepth, `${label} exceeds portable JSON depth ${maxDepth}`);
    if (typeof current === "number" && Number.isInteger(current)) {
      assert.ok(Number.isSafeInteger(current), `${label} contains an unsafe integer`);
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (current !== null && typeof current === "object") {
      for (const key of Object.keys(current).sort(compareUnicodeCodePoints)) {
        visit(current[key], depth + 1);
      }
    }
  };
  visit(value, 0);
}

function assertInlinePayload(payload, label, limits = {}) {
  assert.equal(payload.disposition, "inline-unredacted", `${label} disposition drifted`);
  assert.equal(payload.redacted, false, `${label} must truthfully report unredacted bytes`);
  const parsed = JSON.parse(payload.canonicalJson);
  assertPortableJsonValue(parsed, label, limits);
  assert.equal(
    JSON.stringify(canonicalize(parsed)),
    payload.canonicalJson,
    `${label} is not canonical JSON`,
  );
  assert.equal(
    Buffer.byteLength(payload.canonicalJson, "utf8"),
    payload.utf8ByteLength,
    `${label} UTF-8 length drifted`,
  );
  assert.equal(
    createHash("sha256").update(payload.canonicalJson, "utf8").digest("hex"),
    payload.sha256,
    `${label} SHA-256 drifted`,
  );
  assert.ok(
    payload.utf8ByteLength <= (limits.maxBytes ?? 16777216),
    `${label} exceeds its UTF-8 byte ceiling`,
  );
  return parsed;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function timestampMillis(value, label) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  assert.ok(match, `${label} is not a strict timestamp`);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  assert.ok(day >= 1 && day <= daysInMonth, `${label} is not a real calendar date`);
  const millis = Date.parse(value);
  assert.ok(Number.isFinite(millis), `${label} cannot be represented as an instant`);
  return millis;
}

function cycleControllerIdentity(request) {
  return {
    policy: request.policy,
    objectiveHash: request.objective.sha256,
    keyStrategyId: request.keyStrategyId,
    rubricIdentity: request.rubricIdentity,
    authorityCeilingHash: request.authorityCeilingHash,
    pricingPolicyHash: request.pricingPolicyHash,
    initialGraphRevision: request.initialGraph.graphRevision,
    initialGraphHash: request.initialGraph.graphHash,
    initialRevisionHash: request.initialGraph.revisionHash,
  };
}

function assertResultCounters(result, label) {
  assert.equal(
    result.seenCount,
    result.acceptedCount + result.rejectedCount + result.unknownCount + result.unevaluatedCount,
    `${label} category counters do not reconcile`,
  );
}

const cycleControllerCases = await loadJson("cycle-controller.case.json");
assert.equal(cycleControllerCases.schemaVersion, 1);
const cycleFaultMatrixCases = await loadJson("cycle-controller-fault-matrix.case.json");
assert.equal(cycleFaultMatrixCases.schemaVersion, 1);
const cycleInterruptionCases = await loadJson("cycle-controller-activity-interruption.case.json");
assert.equal(cycleInterruptionCases.schemaVersion, 1);
const cycleOperationInterruptionCases = await loadJson(
  "cycle-controller-operation-interruption.case.json",
);
assert.equal(cycleOperationInterruptionCases.schemaVersion, 1);
const cyclePatchVisibilityCases = await loadJson(
  "cycle-controller-patch-visibility-fault.case.json",
);
assert.equal(cyclePatchVisibilityCases.schemaVersion, 1);
const cyclePatchCheckpointCases = await loadJson(
  "cycle-controller-patch-checkpoint-fault.case.json",
);
assert.equal(cyclePatchCheckpointCases.schemaVersion, 1);
const cycleLineageCases = await loadJson("cycle-controller-lineage.case.json");
assert.equal(cycleLineageCases.schemaVersion, 1);
assert.deepEqual(
  Object.keys(cycleLineageCases).sort(compareUnicodeCodePoints),
  [
    "cases",
    "expect",
    "hashDomains",
    "id",
    "manifestSchema",
    "requestFixture",
    "requiredAssertions",
    "schemaVersion",
  ],
  "D7 H06 lineage fixture is not closed",
);
assert.equal(cycleLineageCases.id, "cycle-controller-lineage-v1alpha1");
assert.equal(cycleLineageCases.requestFixture, "cycle-controller.case.json");
assert.equal(
  cycleLineageCases.manifestSchema,
  "spec/cycle-controller-lineage-manifest.schema.json",
);
assert.deepEqual(cycleLineageCases.hashDomains, {
  manifest: "graph-engineering/cycle-lineage-manifest/v1alpha1\0",
  event: "graph-engineering/cycle-event/v1alpha1\0",
});
const expectedLineageScenarios = new Set([
  "grandchild-replay",
  "sibling-isolation",
  "distinct-parent-prefix",
  "deterministic-revalidation",
  "extra-field",
  "api-version",
  "limit-substitution",
  "manifest-hash-drift",
  "missing-root",
  "duplicate-root",
  "cycle-run-id",
  "reordered-streams",
  "parent-binding",
  "parent-event-byte",
  "truncated-prefix",
  "target-binding",
  "event-count",
  "record-prefix-disagreement",
  "stream-binding",
  "stream-overflow",
]);
assert.deepEqual(
  new Set(cycleLineageCases.cases.map(({ scenario }) => scenario)),
  expectedLineageScenarios,
  "D7 H06 lineage scenario vocabulary drifted",
);
assert.equal(
  new Set(cycleLineageCases.cases.map(({ id }) => id)).size,
  cycleLineageCases.cases.length,
  "D7 H06 lineage case IDs are duplicated",
);
const lineageCategoryCounts = new Map();
for (const item of cycleLineageCases.cases) {
  assert.match(item.id, /^[a-z][a-z0-9-]{2,63}$/u);
  assert.ok(Object.hasOwn(cycleLineageCases.expect.categoryCounts, item.category));
  assert.ok(item.expectOutcome === "replayed" || item.expectOutcome === "rejected");
  assert.deepEqual(
    Object.keys(item).sort(compareUnicodeCodePoints),
    (item.expectOutcome === "rejected"
      ? ["category", "expectCode", "expectOutcome", "id", "scenario"]
      : ["category", "expectOutcome", "id", "scenario"]),
    `${item.id} lineage case is not closed`,
  );
  assert.equal(Object.hasOwn(item, "expectCode"), item.expectOutcome === "rejected");
  if (item.expectOutcome === "rejected") {
    assert.equal(item.expectCode, "GE_CYCLE_INVALID_HISTORY");
  }
  lineageCategoryCounts.set(
    item.category,
    (lineageCategoryCounts.get(item.category) ?? 0) + 1,
  );
}
assert.equal(cycleLineageCases.cases.length, cycleLineageCases.expect.caseCount);
assert.equal(
  cycleLineageCases.cases.filter(({ expectOutcome }) => expectOutcome === "rejected").length,
  cycleLineageCases.expect.attackCaseCount,
);
assert.equal(
  cycleLineageCases.cases.filter(({ expectOutcome }) => expectOutcome === "replayed").length,
  cycleLineageCases.expect.behaviorCaseCount,
);
assert.deepEqual(
  Object.fromEntries([...lineageCategoryCounts].sort(([left], [right]) => (
    compareUnicodeCodePoints(left, right)
  ))),
  cycleLineageCases.expect.categoryCounts,
);
const lineageCasesCanonical = JSON.stringify(canonicalize(cycleLineageCases.cases));
assert.equal(
  Buffer.byteLength(lineageCasesCanonical, "utf8"),
  cycleLineageCases.expect.casesCanonicalUtf8Bytes,
);
assert.equal(hash(cycleLineageCases.cases), cycleLineageCases.expect.casesSha256);
assert.equal(
  new Set(cycleLineageCases.requiredAssertions).size,
  cycleLineageCases.requiredAssertions.length,
  "D7 H06 required assertions are duplicated",
);
assert.equal(
  cycleFaultMatrixCases.eventSchema,
  "spec/cycle-controller-event.schema.json",
  "D7 fault matrix must name the authoritative event schema",
);
assert.deepEqual(
  cycleFaultMatrixCases.eventTypes,
  d7Schemas[4].properties.type.enum,
  "D7 fault matrix event vocabulary differs from the event schema enum",
);
assert.equal(
  new Set(cycleFaultMatrixCases.eventTypes).size,
  cycleFaultMatrixCases.expect.eventTypeCount,
  "D7 fault matrix event vocabulary is duplicated or incomplete",
);
assert.equal(
  new Set(cycleFaultMatrixCases.stages.map(({ name }) => name)).size,
  cycleFaultMatrixCases.expect.stageCount,
  "D7 fault stage names are duplicated or incomplete",
);
assert.equal(
  new Set(cycleFaultMatrixCases.faultKinds).size,
  cycleFaultMatrixCases.expect.faultKindCount,
  "D7 fault kinds are duplicated or incomplete",
);
const cycleFaultMatrix = [];
for (const stage of cycleFaultMatrixCases.stages) {
  assert.deepEqual(
    Object.keys(stage).sort(compareUnicodeCodePoints),
    ["appliesTo", "boundaryTemplate", "durability", "name"],
    `${stage.name} durable stage is not closed`,
  );
  assert.ok(
    stage.appliesTo === "all-events" || cycleFaultMatrixCases.eventTypes.includes(stage.appliesTo),
    `${stage.name} names an unknown event applicability`,
  );
  const exampleEvent = stage.appliesTo === "all-events"
    ? cycleFaultMatrixCases.eventTypes[0]
    : stage.appliesTo;
  const exampleBoundary = stage.boundaryTemplate.replaceAll("{eventType}", exampleEvent);
  assert.equal(
    exampleBoundary.includes("{eventType}"),
    false,
    `${stage.name} left an unresolved boundary token`,
  );
}
for (const eventType of cycleFaultMatrixCases.eventTypes) {
  for (const stage of cycleFaultMatrixCases.stages) {
    if (stage.appliesTo !== "all-events" && stage.appliesTo !== eventType) continue;
    const boundary = stage.boundaryTemplate.replaceAll("{eventType}", eventType);
    for (const faultKind of cycleFaultMatrixCases.faultKinds) {
      cycleFaultMatrix.push({
        eventType,
        stage: stage.name,
        faultKind,
        boundary,
        durability: stage.durability,
      });
    }
  }
}
assert.equal(
  cycleFaultMatrix.length,
  cycleFaultMatrixCases.expect.matrixEntryCount,
  "D7 fault matrix entry count drifted",
);
assert.equal(
  new Set(cycleFaultMatrix.map(({ eventType, stage, faultKind }) => (
    `${eventType}\0${stage}\0${faultKind}`
  ))).size,
  cycleFaultMatrix.length,
  "D7 fault matrix has duplicate obligations",
);
assert.equal(
  new Set(cycleFaultMatrix.map(({ boundary }) => boundary)).size,
  cycleFaultMatrixCases.expect.boundaryCount,
  "D7 fault matrix boundary count drifted",
);
for (const [durability, count] of Object.entries(cycleFaultMatrixCases.expect.durabilityCounts)) {
  assert.equal(
    cycleFaultMatrix.filter((entry) => entry.durability === durability).length,
    count,
    `D7 fault matrix ${durability} count drifted`,
  );
}
const cycleFaultMatrixCanonical = JSON.stringify(canonicalize(cycleFaultMatrix));
assert.equal(
  Buffer.byteLength(cycleFaultMatrixCanonical, "utf8"),
  cycleFaultMatrixCases.expect.matrixCanonicalUtf8Bytes,
  "D7 fault matrix canonical byte count drifted",
);
assert.equal(
  hash(cycleFaultMatrix),
  cycleFaultMatrixCases.expect.matrixSha256,
  "D7 fault matrix canonical hash drifted",
);
for (const campaign of cycleFaultMatrixCases.retainedCampaigns) {
  assert.deepEqual(
    Object.keys(campaign).sort(compareUnicodeCodePoints),
    [
      "eventTypes",
      "expectedObligationCount",
      "faultKinds",
      "id",
      "requiredAssertions",
      "seedBoundary",
      "stages",
    ],
    `${campaign.id} retained fault campaign is not closed`,
  );
  assert.match(campaign.id, /^[a-z0-9][a-z0-9-]{0,127}$/u);
  assert.equal(
    new Set(campaign.eventTypes).size,
    campaign.eventTypes.length,
    `${campaign.id} repeats an event type`,
  );
  assert.equal(
    new Set(campaign.stages).size,
    campaign.stages.length,
    `${campaign.id} repeats a durable stage`,
  );
  assert.equal(
    new Set(campaign.faultKinds).size,
    campaign.faultKinds.length,
    `${campaign.id} repeats a fault kind`,
  );
  assert.ok(
    campaign.eventTypes.every((value) => cycleFaultMatrixCases.eventTypes.includes(value)),
    `${campaign.id} names an unknown event type`,
  );
  assert.ok(
    campaign.stages.every((value) => cycleFaultMatrixCases.stages.some(({ name }) => name === value)),
    `${campaign.id} names an unknown durable stage`,
  );
  assert.ok(
    campaign.faultKinds.every((value) => cycleFaultMatrixCases.faultKinds.includes(value)),
    `${campaign.id} names an unknown fault kind`,
  );
  const obligations = cycleFaultMatrix.filter((entry) => (
    campaign.eventTypes.includes(entry.eventType)
      && campaign.stages.includes(entry.stage)
      && campaign.faultKinds.includes(entry.faultKind)
  ));
  assert.equal(
    obligations.length,
    campaign.expectedObligationCount,
    `${campaign.id} obligation count drifted`,
  );
  assert.equal(
    new Set(campaign.requiredAssertions).size,
    campaign.requiredAssertions.length,
    `${campaign.id} repeats a required assertion`,
  );
  assert.ok(
    cycleFaultMatrix.some(({ boundary }) => boundary === campaign.seedBoundary),
    `${campaign.id} seed boundary is not canonical`,
  );
}
assert.deepEqual(
  Object.keys(cyclePatchVisibilityCases).sort(compareUnicodeCodePoints),
  [
    "eventType",
    "expect",
    "faultKinds",
    "id",
    "linearization",
    "requiredAssertions",
    "schemaVersion",
    "seedBoundary",
    "sourceFaultMatrix",
    "stages",
  ],
  "D7 H03C patch-visibility fixture is not closed",
);
assert.equal(
  cyclePatchVisibilityCases.id,
  "cycle-controller-patch-visibility-fault-v1alpha1",
);
assert.equal(
  cyclePatchVisibilityCases.sourceFaultMatrix,
  "spec/conformance/cycle-controller-fault-matrix.case.json",
);
assert.equal(cyclePatchVisibilityCases.eventType, "PatchAccepted");
assert.equal(
  new Set(cyclePatchVisibilityCases.stages).size,
  cyclePatchVisibilityCases.expect.stageCount,
  "D7 H03C patch-visibility stages are duplicated or incomplete",
);
assert.equal(
  new Set(cyclePatchVisibilityCases.faultKinds).size,
  cyclePatchVisibilityCases.expect.faultKindCount,
  "D7 H03C patch-visibility fault kinds are duplicated or incomplete",
);
assert.ok(
  cyclePatchVisibilityCases.stages.every((value) => (
    cycleFaultMatrixCases.stages.some(({ name }) => name === value)
  )),
  "D7 H03C patch-visibility fixture names an unknown durable stage",
);
assert.ok(
  cyclePatchVisibilityCases.faultKinds.every((value) => (
    cycleFaultMatrixCases.faultKinds.includes(value)
  )),
  "D7 H03C patch-visibility fixture names an unknown fault kind",
);
assert.ok(
  cycleFaultMatrix.some(({ boundary }) => boundary === cyclePatchVisibilityCases.seedBoundary),
  "D7 H03C patch-visibility seed boundary is not canonical",
);
assert.deepEqual(
  Object.keys(cyclePatchVisibilityCases.linearization).sort(compareUnicodeCodePoints),
  [
    "acceptedDynamicNodes",
    "acceptedGraphRevision",
    "authoritativeFact",
    "committedPlannerCalls",
    "committedStages",
    "initialGraphRevision",
    "preCommitPlannerCalls",
    "preCommitStages",
  ],
  "D7 H03C patch-visibility linearization contract is not closed",
);
assert.equal(
  cyclePatchVisibilityCases.linearization.authoritativeFact,
  cyclePatchVisibilityCases.eventType,
);
assert.deepEqual(
  [
    ...cyclePatchVisibilityCases.linearization.preCommitStages,
    ...cyclePatchVisibilityCases.linearization.committedStages,
  ],
  cyclePatchVisibilityCases.stages,
  "D7 H03C pre/post-commit stages do not exactly partition the campaign",
);
assert.equal(cyclePatchVisibilityCases.linearization.initialGraphRevision, 1);
assert.equal(cyclePatchVisibilityCases.linearization.acceptedGraphRevision, 2);
assert.equal(cyclePatchVisibilityCases.linearization.acceptedDynamicNodes, 1);
assert.equal(cyclePatchVisibilityCases.linearization.preCommitPlannerCalls, 2);
assert.equal(cyclePatchVisibilityCases.linearization.committedPlannerCalls, 1);
const cyclePatchVisibilityMatrix = cycleFaultMatrix.filter((entry) => (
  entry.eventType === cyclePatchVisibilityCases.eventType
    && cyclePatchVisibilityCases.stages.includes(entry.stage)
    && cyclePatchVisibilityCases.faultKinds.includes(entry.faultKind)
));
assert.equal(
  cyclePatchVisibilityMatrix.length,
  cyclePatchVisibilityCases.expect.matrixEntryCount,
  "D7 H03C patch-visibility matrix count drifted",
);
assert.equal(
  new Set(cyclePatchVisibilityMatrix.map(({ eventType, stage, faultKind }) => (
    `${eventType}\0${stage}\0${faultKind}`
  ))).size,
  cyclePatchVisibilityMatrix.length,
  "D7 H03C patch-visibility obligations are duplicated",
);
for (const [stage, count] of Object.entries(cyclePatchVisibilityCases.expect.stageCounts)) {
  assert.equal(
    cyclePatchVisibilityMatrix.filter((entry) => entry.stage === stage).length,
    count,
    `D7 H03C ${stage} count drifted`,
  );
}
for (const [faultKind, count] of Object.entries(
  cyclePatchVisibilityCases.expect.faultKindCounts,
)) {
  assert.equal(
    cyclePatchVisibilityMatrix.filter((entry) => entry.faultKind === faultKind).length,
    count,
    `D7 H03C ${faultKind} count drifted`,
  );
}
for (const [durability, count] of Object.entries(
  cyclePatchVisibilityCases.expect.durabilityCounts,
)) {
  assert.equal(
    cyclePatchVisibilityMatrix.filter((entry) => entry.durability === durability).length,
    count,
    `D7 H03C ${durability} count drifted`,
  );
}
const cyclePatchVisibilityCanonical = JSON.stringify(canonicalize(cyclePatchVisibilityMatrix));
assert.equal(
  Buffer.byteLength(cyclePatchVisibilityCanonical, "utf8"),
  cyclePatchVisibilityCases.expect.matrixCanonicalUtf8Bytes,
  "D7 H03C patch-visibility canonical byte count drifted",
);
assert.equal(
  hash(cyclePatchVisibilityMatrix),
  cyclePatchVisibilityCases.expect.matrixSha256,
  "D7 H03C patch-visibility canonical hash drifted",
);
assert.equal(
  new Set(cyclePatchVisibilityCases.requiredAssertions).size,
  cyclePatchVisibilityCases.requiredAssertions.length,
  "D7 H03C patch-visibility required assertions are duplicated",
);
assert.deepEqual(
  Object.keys(cyclePatchCheckpointCases).sort(compareUnicodeCodePoints),
  [
    "eventType",
    "expect",
    "faultKinds",
    "id",
    "linearization",
    "requiredAssertions",
    "schemaVersion",
    "seedBoundary",
    "sourceFaultMatrix",
    "stages",
  ],
  "D7 H03D patch-checkpoint fixture is not closed",
);
assert.equal(
  cyclePatchCheckpointCases.id,
  "cycle-controller-patch-checkpoint-fault-v1alpha1",
);
assert.equal(
  cyclePatchCheckpointCases.sourceFaultMatrix,
  "spec/conformance/cycle-controller-fault-matrix.case.json",
);
assert.equal(cyclePatchCheckpointCases.eventType, "PatchAccepted");
assert.deepEqual(cyclePatchCheckpointCases.stages, [
  "before-checkpoint-construction",
  "after-checkpoint-construction",
  "after-checkpoint-save",
]);
assert.equal(
  new Set(cyclePatchCheckpointCases.stages).size,
  cyclePatchCheckpointCases.expect.stageCount,
  "D7 H03D patch-checkpoint stages are duplicated or incomplete",
);
assert.equal(
  new Set(cyclePatchCheckpointCases.faultKinds).size,
  cyclePatchCheckpointCases.expect.faultKindCount,
  "D7 H03D patch-checkpoint fault kinds are duplicated or incomplete",
);
assert.deepEqual(
  cyclePatchCheckpointCases.faultKinds,
  cycleFaultMatrixCases.faultKinds,
  "D7 H03D patch-checkpoint campaign must cross every retained fault kind",
);
assert.ok(
  cyclePatchCheckpointCases.stages.every((value) => (
    cycleFaultMatrixCases.stages.some(({ name }) => name === value)
  )),
  "D7 H03D patch-checkpoint fixture names an unknown durable stage",
);
assert.ok(
  cycleFaultMatrix.some(({ boundary }) => boundary === cyclePatchCheckpointCases.seedBoundary),
  "D7 H03D patch-checkpoint seed boundary is not canonical",
);
assert.deepEqual(
  Object.keys(cyclePatchCheckpointCases.linearization).sort(compareUnicodeCodePoints),
  [
    "acceptedDynamicNodes",
    "acceptedGraphRevision",
    "authoritativeFact",
    "authoritativeSource",
    "checkpointEveryEvents",
    "checkpointIdSuffix",
    "checkpointLagEvents",
    "committedCheckpointStages",
    "committedPlannerCalls",
    "initialGraphRevision",
    "stalePrefixStages",
  ],
  "D7 H03D patch-checkpoint linearization contract is not closed",
);
assert.equal(
  cyclePatchCheckpointCases.linearization.authoritativeFact,
  cyclePatchCheckpointCases.eventType,
);
assert.equal(cyclePatchCheckpointCases.linearization.authoritativeSource, "event-stream");
assert.equal(cyclePatchCheckpointCases.linearization.checkpointEveryEvents, 1);
assert.equal(cyclePatchCheckpointCases.linearization.checkpointIdSuffix, "-latest");
assert.equal(cyclePatchCheckpointCases.linearization.initialGraphRevision, 1);
assert.equal(cyclePatchCheckpointCases.linearization.acceptedGraphRevision, 2);
assert.equal(cyclePatchCheckpointCases.linearization.acceptedDynamicNodes, 1);
assert.equal(cyclePatchCheckpointCases.linearization.committedPlannerCalls, 1);
assert.deepEqual(
  [
    ...cyclePatchCheckpointCases.linearization.stalePrefixStages,
    ...cyclePatchCheckpointCases.linearization.committedCheckpointStages,
  ],
  cyclePatchCheckpointCases.stages,
  "D7 H03D stale/exact checkpoint stages do not partition the campaign",
);
assert.deepEqual(
  Object.keys(cyclePatchCheckpointCases.linearization.checkpointLagEvents),
  cyclePatchCheckpointCases.stages,
  "D7 H03D checkpoint-lag map does not preserve the closed stage order",
);
for (const stage of cyclePatchCheckpointCases.linearization.stalePrefixStages) {
  assert.equal(
    cyclePatchCheckpointCases.linearization.checkpointLagEvents[stage],
    1,
    `D7 H03D ${stage} must retain the immediately prior prefix checkpoint`,
  );
}
for (const stage of cyclePatchCheckpointCases.linearization.committedCheckpointStages) {
  assert.equal(
    cyclePatchCheckpointCases.linearization.checkpointLagEvents[stage],
    0,
    `D7 H03D ${stage} must retain the exact PatchAccepted checkpoint`,
  );
}
const cyclePatchCheckpointMatrix = cycleFaultMatrix.filter((entry) => (
  entry.eventType === cyclePatchCheckpointCases.eventType
    && cyclePatchCheckpointCases.stages.includes(entry.stage)
    && cyclePatchCheckpointCases.faultKinds.includes(entry.faultKind)
));
assert.equal(
  cyclePatchCheckpointMatrix.length,
  cyclePatchCheckpointCases.expect.matrixEntryCount,
  "D7 H03D patch-checkpoint matrix count drifted",
);
assert.equal(
  new Set(cyclePatchCheckpointMatrix.map(({ eventType, stage, faultKind }) => (
    `${eventType}\0${stage}\0${faultKind}`
  ))).size,
  cyclePatchCheckpointMatrix.length,
  "D7 H03D patch-checkpoint obligations are duplicated",
);
for (const [stage, count] of Object.entries(cyclePatchCheckpointCases.expect.stageCounts)) {
  assert.equal(
    cyclePatchCheckpointMatrix.filter((entry) => entry.stage === stage).length,
    count,
    `D7 H03D ${stage} count drifted`,
  );
}
for (const [faultKind, count] of Object.entries(
  cyclePatchCheckpointCases.expect.faultKindCounts,
)) {
  assert.equal(
    cyclePatchCheckpointMatrix.filter((entry) => entry.faultKind === faultKind).length,
    count,
    `D7 H03D ${faultKind} count drifted`,
  );
}
for (const [durability, count] of Object.entries(
  cyclePatchCheckpointCases.expect.durabilityCounts,
)) {
  assert.equal(
    cyclePatchCheckpointMatrix.filter((entry) => entry.durability === durability).length,
    count,
    `D7 H03D ${durability} count drifted`,
  );
}
const cyclePatchCheckpointCanonical = JSON.stringify(canonicalize(cyclePatchCheckpointMatrix));
assert.equal(
  Buffer.byteLength(cyclePatchCheckpointCanonical, "utf8"),
  cyclePatchCheckpointCases.expect.matrixCanonicalUtf8Bytes,
  "D7 H03D patch-checkpoint canonical byte count drifted",
);
assert.equal(
  hash(cyclePatchCheckpointMatrix),
  cyclePatchCheckpointCases.expect.matrixSha256,
  "D7 H03D patch-checkpoint canonical hash drifted",
);
assert.equal(
  new Set(cyclePatchCheckpointCases.requiredAssertions).size,
  cyclePatchCheckpointCases.requiredAssertions.length,
  "D7 H03D patch-checkpoint required assertions are duplicated",
);
assert.deepEqual(
  Object.keys(cycleInterruptionCases).sort(compareUnicodeCodePoints),
  [
    "activityPhases",
    "expect",
    "id",
    "requiredAssertions",
    "schemaVersion",
    "sideEffectClasses",
    "timeoutPolicy",
    "triggerFamilies",
  ],
  "D7 H03 activity interruption fixture is not closed",
);
assert.equal(
  cycleInterruptionCases.id,
  "cycle-controller-activity-interruption-v1alpha1",
);
assert.deepEqual(cycleInterruptionCases.activityPhases, [
  "finder",
  "candidate-evaluator",
  "condition",
  "optimizer-evaluator",
  "patch-planner",
]);
assert.deepEqual(cycleInterruptionCases.sideEffectClasses, [
  "none",
  "idempotent",
  "non-idempotent",
]);
const interruptionFamilies = new Map();
for (const family of cycleInterruptionCases.triggerFamilies) {
  assert.deepEqual(
    Object.keys(family).sort(compareUnicodeCodePoints),
    ["appliesTo", "expandSideEffects", "interruption", "name"],
    `${family.name} interruption family is not closed`,
  );
  assert.equal(interruptionFamilies.has(family.name), false, `${family.name} is repeated`);
  assert.ok(
    family.interruption === "caller-cancellation" || family.interruption === "attempt-timeout",
    `${family.name} has an unknown interruption kind`,
  );
  interruptionFamilies.set(family.name, family);
}
assert.deepEqual([...interruptionFamilies.keys()], [
  "before-first-round",
  "before-claim",
  "during-handler",
  "after-handler-before-outcome",
  "after-outcome-before-next-dispatch",
  "attempt-timeout",
  "after-round-commit",
  "repeated-cancellation",
]);
const cycleInterruptionMatrix = [{
  id: "before-first-round",
  interruption: "caller-cancellation",
  trigger: "before-first-round",
  phase: null,
  sideEffects: null,
}];
for (const phase of cycleInterruptionCases.activityPhases) {
  cycleInterruptionMatrix.push({
    id: `${phase}:before-claim`,
    interruption: "caller-cancellation",
    trigger: "before-claim",
    phase,
    sideEffects: null,
  });
}
for (const trigger of [
  "during-handler",
  "after-handler-before-outcome",
  "after-outcome-before-next-dispatch",
  "attempt-timeout",
]) {
  const family = interruptionFamilies.get(trigger);
  assert.equal(family.expandSideEffects, true, `${trigger} must cross side-effect classes`);
  assert.equal(family.appliesTo, "all-activity-phases", `${trigger} must cross all phases`);
  for (const phase of cycleInterruptionCases.activityPhases) {
    for (const sideEffects of cycleInterruptionCases.sideEffectClasses) {
      cycleInterruptionMatrix.push({
        id: `${phase}:${trigger}:${sideEffects}`,
        interruption: family.interruption,
        trigger,
        phase,
        sideEffects,
      });
    }
  }
}
cycleInterruptionMatrix.push({
  id: "after-round-commit",
  interruption: "caller-cancellation",
  trigger: "after-round-commit",
  phase: null,
  sideEffects: null,
});
cycleInterruptionMatrix.push({
  id: "finder:repeated-cancellation:none",
  interruption: "caller-cancellation",
  trigger: "repeated-cancellation",
  phase: "finder",
  sideEffects: "none",
});
assert.equal(
  cycleInterruptionMatrix.length,
  cycleInterruptionCases.expect.matrixEntryCount,
  "D7 H03 interruption count drifted",
);
assert.equal(
  new Set(cycleInterruptionMatrix.map(({ id }) => id)).size,
  cycleInterruptionMatrix.length,
  "D7 H03 interruption IDs are not unique",
);
for (const [kind, count] of Object.entries(cycleInterruptionCases.expect.interruptionCounts)) {
  assert.equal(
    cycleInterruptionMatrix.filter(({ interruption }) => interruption === kind).length,
    count,
    `D7 H03 ${kind} count drifted`,
  );
}
for (const [trigger, count] of Object.entries(cycleInterruptionCases.expect.triggerCounts)) {
  assert.equal(
    cycleInterruptionMatrix.filter((entry) => entry.trigger === trigger).length,
    count,
    `D7 H03 ${trigger} count drifted`,
  );
}
for (const [phase, count] of Object.entries(cycleInterruptionCases.expect.phaseCounts)) {
  assert.equal(
    cycleInterruptionMatrix.filter((entry) => (entry.phase ?? "controller") === phase).length,
    count,
    `D7 H03 ${phase} phase count drifted`,
  );
}
for (const [sideEffects, count] of Object.entries(cycleInterruptionCases.expect.sideEffectCounts)) {
  assert.equal(
    cycleInterruptionMatrix.filter((entry) => (
      entry.sideEffects ?? "not-applicable"
    ) === sideEffects).length,
    count,
    `D7 H03 ${sideEffects} side-effect count drifted`,
  );
}
const cycleInterruptionCanonical = JSON.stringify(canonicalize(cycleInterruptionMatrix));
assert.equal(
  Buffer.byteLength(cycleInterruptionCanonical, "utf8"),
  cycleInterruptionCases.expect.matrixCanonicalUtf8Bytes,
  "D7 H03 interruption canonical byte count drifted",
);
assert.equal(
  hash(cycleInterruptionMatrix),
  cycleInterruptionCases.expect.matrixSha256,
  "D7 H03 interruption canonical hash drifted",
);
assert.deepEqual(
  Object.keys(cycleInterruptionCases.timeoutPolicy).sort(compareUnicodeCodePoints),
  [
    "maxAttemptsPerRound",
    "maxCostUsdPerAttempt",
    "nonRetryableSideEffects",
    "retryableSideEffects",
    "stableFailureCode",
  ],
  "D7 H03 timeout policy is not closed",
);
assert.equal(cycleInterruptionCases.timeoutPolicy.stableFailureCode, "GE_CYCLE_ACTIVITY_TIMEOUT");
assert.equal(cycleInterruptionCases.timeoutPolicy.maxAttemptsPerRound, 2);
assert.equal(cycleInterruptionCases.timeoutPolicy.maxCostUsdPerAttempt, 0.25);
assert.deepEqual(cycleInterruptionCases.timeoutPolicy.retryableSideEffects, [
  "none",
  "idempotent",
]);
assert.deepEqual(cycleInterruptionCases.timeoutPolicy.nonRetryableSideEffects, [
  "non-idempotent",
]);
assert.deepEqual(cycleInterruptionCases.requiredAssertions, [
  "caller-cancellation-precedes-simultaneous-handler-success",
  "no-handler-starts-after-observed-pre-claim-cancellation",
  "late-handler-result-never-commits",
  "cancelled-claim-settles-exactly-once",
  "timeout-charges-request-bound-ceiling",
  "timeout-retries-only-when-policy-and-side-effects-permit",
  "none-side-effects-never-create-in-doubt-evidence",
  "external-side-effects-retain-single-in-doubt-claim",
  "committed-outcome-survives-later-cancellation",
  "accepted-patch-revision-remains-visible-after-decision-commit",
  "cancellation-does-not-invent-a-dry-round",
  "round-commit-dry-counter-survives-later-cancellation",
  "repeated-cancellation-is-idempotent",
  "replay-performs-zero-handler-dispatch",
  "terminal-resume-performs-zero-write-and-zero-handler-dispatch",
  "typescript-python-canonical-reports-match",
]);
assert.deepEqual(
  Object.keys(cycleOperationInterruptionCases).sort(compareUnicodeCodePoints),
  [
    "boundaries",
    "expect",
    "id",
    "linearization",
    "operations",
    "requiredAssertions",
    "schemaVersion",
  ],
  "D7 H03B operation interruption fixture is not closed",
);
assert.equal(
  cycleOperationInterruptionCases.id,
  "cycle-controller-operation-interruption-v1alpha1",
);
assert.deepEqual(cycleOperationInterruptionCases.operations, [
  "pause",
  "resume",
  "replay",
  "fork",
]);
assert.deepEqual(
  Object.keys(cycleOperationInterruptionCases.boundaries).sort(compareUnicodeCodePoints),
  [...cycleOperationInterruptionCases.operations].sort(compareUnicodeCodePoints),
  "D7 H03B operation boundary groups drifted",
);
assert.deepEqual(
  Object.keys(cycleOperationInterruptionCases.linearization).sort(compareUnicodeCodePoints),
  [
    "controllerCancellationBoundaries",
    "preCommitBoundaries",
    "readOnlyOperation",
    "stableErrorCode",
  ],
  "D7 H03B linearization contract is not closed",
);
assert.equal(
  cycleOperationInterruptionCases.linearization.stableErrorCode,
  "GE_CYCLE_OPERATION_CANCELLED",
);
assert.equal(cycleOperationInterruptionCases.linearization.readOnlyOperation, "replay");
const operationPreCommit = new Set(
  cycleOperationInterruptionCases.linearization.preCommitBoundaries,
);
const operationControllerCancelled = new Set(
  cycleOperationInterruptionCases.linearization.controllerCancellationBoundaries,
);
const cycleOperationInterruptionMatrix = [];
for (const operation of cycleOperationInterruptionCases.operations) {
  const stages = cycleOperationInterruptionCases.boundaries[operation];
  assert.ok(Array.isArray(stages) && stages.length > 0, `${operation} has no H03B boundaries`);
  for (const stage of stages) {
    const boundary = `operation:${operation}:${stage}`;
    const readOnly = operation === cycleOperationInterruptionCases.linearization.readOnlyOperation;
    cycleOperationInterruptionMatrix.push({
      id: boundary,
      operation,
      boundary,
      durability: readOnly
        ? "read-only"
        : operationPreCommit.has(boundary)
          ? "operation-not-committed"
          : "operation-committed",
      outcome: readOnly || operationPreCommit.has(boundary)
        ? "operation-cancelled"
        : operationControllerCancelled.has(boundary)
          ? "controller-cancelled"
          : "committed-result",
    });
  }
}
assert.equal(
  cycleOperationInterruptionMatrix.length,
  cycleOperationInterruptionCases.expect.matrixEntryCount,
  "D7 H03B operation matrix count drifted",
);
assert.equal(
  new Set(cycleOperationInterruptionMatrix.map(({ id }) => id)).size,
  cycleOperationInterruptionMatrix.length,
  "D7 H03B operation boundary IDs are not unique",
);
const operationBoundarySet = new Set(
  cycleOperationInterruptionMatrix.map(({ boundary }) => boundary),
);
for (const boundary of [...operationPreCommit, ...operationControllerCancelled]) {
  assert.ok(operationBoundarySet.has(boundary), `${boundary} is not an H03B boundary`);
}
for (const [operation, count] of Object.entries(
  cycleOperationInterruptionCases.expect.operationCounts,
)) {
  assert.equal(
    cycleOperationInterruptionMatrix.filter((entry) => entry.operation === operation).length,
    count,
    `D7 H03B ${operation} count drifted`,
  );
}
for (const [durability, count] of Object.entries(
  cycleOperationInterruptionCases.expect.durabilityCounts,
)) {
  assert.equal(
    cycleOperationInterruptionMatrix.filter((entry) => entry.durability === durability).length,
    count,
    `D7 H03B ${durability} count drifted`,
  );
}
for (const [outcome, count] of Object.entries(
  cycleOperationInterruptionCases.expect.outcomeCounts,
)) {
  assert.equal(
    cycleOperationInterruptionMatrix.filter((entry) => entry.outcome === outcome).length,
    count,
    `D7 H03B ${outcome} count drifted`,
  );
}
const cycleOperationInterruptionCanonical = JSON.stringify(
  canonicalize(cycleOperationInterruptionMatrix),
);
assert.equal(
  Buffer.byteLength(cycleOperationInterruptionCanonical, "utf8"),
  cycleOperationInterruptionCases.expect.matrixCanonicalUtf8Bytes,
  "D7 H03B operation matrix canonical byte count drifted",
);
assert.equal(
  hash(cycleOperationInterruptionMatrix),
  cycleOperationInterruptionCases.expect.matrixSha256,
  "D7 H03B operation matrix canonical hash drifted",
);
assert.equal(
  new Set(cycleOperationInterruptionCases.requiredAssertions).size,
  cycleOperationInterruptionCases.requiredAssertions.length,
  "D7 H03B required assertions are duplicated",
);
const validPoliciesByName = new Map();
for (const testCase of cycleControllerCases.validPolicies) {
  assert.equal(
    validateCyclePolicy(testCase.document),
    true,
    `${testCase.name} valid cycle policy does not conform: ${JSON.stringify(validateCyclePolicy.errors)}`,
  );
  validPoliciesByName.set(testCase.name, testCase.document);
}
for (const testCase of cycleControllerCases.invalidPolicyCases) {
  const base = cloneJson(validPoliciesByName.get(testCase.base ?? "until-dry-all-effective-bounds"));
  applyJsonMutation(base, testCase.mutation);
  assert.equal(validateCyclePolicy(base), false, `${testCase.name} invalid cycle policy unexpectedly conforms`);
}

const validRequestsByName = new Map();
for (const testCase of cycleControllerCases.validRequests) {
  const request = testCase.document;
  assert.equal(
    validateCycleRequest(request),
    true,
    `${testCase.name} valid cycle request does not conform: ${JSON.stringify(validateCycleRequest.errors)}`,
  );
  assertInlinePayload(request.objective, `${testCase.name} objective`);
  assert.equal(request.objective.sha256, testCase.expectObjectiveHash);
  const identity = cycleControllerIdentity(request);
  assert.equal(
    hashWithDomain(cycleControllerCases.hashDomains.controller, identity),
    testCase.expectControllerHash,
    `${testCase.name} controller hash drifted`,
  );
  assert.equal(
    hashWithDomain(cycleControllerCases.hashDomains.request, request),
    testCase.expectRequestHash,
    `${testCase.name} request hash drifted`,
  );
  validRequestsByName.set(testCase.name, request);
}
const baseCycleRequest = cycleControllerCases.validRequests[0].document;
for (const testCase of cycleControllerCases.invalidRequestCases) {
  const document = cloneJson(baseCycleRequest);
  applyJsonMutation(document, testCase.mutation);
  assert.equal(validateCycleRequest(document), false, `${testCase.name} invalid cycle request unexpectedly conforms`);
}

const validResultsByName = new Map();
for (const testCase of cycleControllerCases.validResults) {
  assert.equal(
    validateCycleResult(testCase.document),
    true,
    `${testCase.name} valid cycle result does not conform: ${JSON.stringify(validateCycleResult.errors)}`,
  );
  assertResultCounters(testCase.document, testCase.name);
  validResultsByName.set(testCase.name, testCase.document);
}
for (const testCase of cycleControllerCases.invalidResultCases) {
  const document = cloneJson(cycleControllerCases.validResults[0].document);
  const mutations = testCase.mutations ?? [testCase.mutation ?? testCase.semanticMutation];
  for (const mutation of mutations) applyJsonMutation(document, mutation);
  if (testCase.mutation || testCase.mutations) {
    assert.equal(validateCycleResult(document), false, `${testCase.name} invalid cycle result unexpectedly conforms`);
  } else {
    assert.equal(validateCycleResult(document), true, `${testCase.name} semantic negative must remain schema-valid`);
    assert.throws(() => assertResultCounters(document, testCase.name), { name: "AssertionError" });
  }
}

const validRevisionsByName = new Map();
for (const testCase of cycleControllerCases.validRevisions) {
  assert.equal(
    validateGraphRevision(testCase.document),
    true,
    `${testCase.name} valid graph revision does not conform: ${JSON.stringify(validateGraphRevision.errors)}`,
  );
  assert.equal(
    hashWithDomain(cycleControllerCases.hashDomains.revision, testCase.document.body),
    testCase.document.revisionHash,
    `${testCase.name} revision hash drifted`,
  );
  validRevisionsByName.set(testCase.name, testCase.document);
}
for (const testCase of cycleControllerCases.invalidRevisionCases) {
  const document = cloneJson(cycleControllerCases.validRevisions[0].document);
  const mutation = testCase.mutation ?? testCase.semanticMutation;
  applyJsonMutation(document, mutation);
  if (testCase.mutation) {
    assert.equal(validateGraphRevision(document), false, `${testCase.name} invalid revision unexpectedly conforms`);
  } else {
    assert.equal(validateGraphRevision(document), true, `${testCase.name} semantic negative must remain schema-valid`);
    assert.notEqual(
      hashWithDomain(cycleControllerCases.hashDomains.revision, document.body),
      document.revisionHash,
      `${testCase.name} did not perturb the revision hash`,
    );
  }
}

for (const testCase of graphPatchCases.revisionHashCases ?? []) {
  const record = { body: testCase.body, revisionHash: testCase.expectRevisionHash };
  assert.equal(
    validateGraphRevision(record),
    true,
    `${testCase.name} GraphPatch revision record does not conform: ${JSON.stringify(validateGraphRevision.errors)}`,
  );
  assert.equal(
    hashWithDomain(testCase.domain, testCase.body),
    testCase.expectRevisionHash,
    `${testCase.name} GraphPatch revision hash drifted`,
  );
}

const cycleDurableCases = await loadJson("cycle-controller-durable.case.json");
assert.equal(cycleDurableCases.schemaVersion, 1);

for (const testCase of cycleDurableCases.untilDryFoldCases) {
  const seen = new Set();
  let dryRounds = 0;
  let exitReason = null;
  for (const round of testCase.rounds) {
    assert.equal(exitReason, null, `${testCase.name} contains work after convergence`);
    const detachedSeen = new Set(seen);
    const freshKeys = [];
    const duplicateKeys = [];
    for (const key of round.candidateKeys) {
      if (detachedSeen.has(key)) duplicateKeys.push(key);
      else {
        detachedSeen.add(key);
        freshKeys.push(key);
      }
    }
    assert.ok(detachedSeen.size <= testCase.maxDiscoveries, `${testCase.name} exceeds discovery credit`);
    assert.deepEqual(freshKeys, round.expectFreshKeys, `${testCase.name} fresh-key fold drifted`);
    assert.deepEqual(duplicateKeys, round.expectDuplicateKeys, `${testCase.name} duplicate-key fold drifted`);
    for (const key of freshKeys) seen.add(key);
    dryRounds = freshKeys.length === 0 ? dryRounds + 1 : 0;
    assert.equal(dryRounds, round.expectConsecutiveDryRounds, `${testCase.name} dry counter drifted`);
    if (dryRounds >= testCase.consecutiveDryRounds) exitReason = "DRY";
  }
  assert.deepEqual([...seen], testCase.expectSeenKeys, `${testCase.name} global seen order drifted`);
  assert.equal(exitReason, testCase.expectExitReason, `${testCase.name} convergence reason drifted`);
}

for (const testCase of cycleDurableCases.hardStopFoldCases) {
  const fold = testCase.fold;
  const policy = cycleDurableCases.hardStopPolicy;
  const observation = {
    cancelled: fold.cancelled,
    maxDuration: fold.durationMs >= policy.maxDurationMs,
    maxCost: fold.costUsd > 0 && fold.costUsd >= policy.maxCostUsd,
    maxTotalAttempts: fold.attemptsUsed > 0 && fold.attemptsUsed >= policy.maxTotalAttempts,
    maxDynamicNodes: fold.dynamicNodes > 0 && fold.dynamicNodes >= policy.maxDynamicNodes,
    maxDiscoveries: fold.convergenceReason === null && fold.seenCount >= policy.maxDiscoveries,
    maxIterations: fold.iterations >= policy.maxIterations,
    patchRejected: fold.patchRejected,
    failed: fold.failed,
    unknownVerdict: fold.unknownVerdict,
  };
  const precedence = [
    ["cancelled", "CANCELLED"], ["maxDuration", "MAX_DURATION"], ["maxCost", "MAX_COST"],
    ["maxTotalAttempts", "MAX_TOTAL_ATTEMPTS"], ["maxDynamicNodes", "MAX_DYNAMIC_NODES"],
    ["maxDiscoveries", "MAX_DISCOVERIES"], ["maxIterations", "MAX_ITERATIONS"],
    ["patchRejected", "PATCH_REJECTED"], ["failed", "FAILED"], ["unknownVerdict", "UNKNOWN_VERDICT"],
  ];
  const exitReason = precedence.find(([field]) => observation[field])?.[1] ?? fold.convergenceReason;
  assert.equal(exitReason, testCase.expectExitReason, `${testCase.name} hard-stop fold drifted`);
}

const expectedD7Tests = [
  "until-dry convergence",
  "hard iteration/time/cost/node limits",
  "malicious patch rejection",
  "replayed exit reason",
];
assert.deepEqual(Object.keys(cycleDurableCases.expectedTestCoverage), expectedD7Tests, "D7 expected-test coverage keys drifted");
const d7CaseNames = new Set([
  ...cycleDurableCases.untilDryFoldCases.map(({ name }) => name),
  ...cycleDurableCases.hardStopFoldCases.map(({ name }) => name),
  ...graphPatchCases.invalidCases.map(({ name }) => name),
  ...graphPatchCases.semanticCases.map(({ name }) => name),
  ...cycleDurableCases.invalidEventHistoryCases.map(({ name }) => name),
  ...cycleDurableCases.invalidCheckpointSemanticCases.map(({ name }) => name),
  ...cycleDurableCases.recoveryBoundaries.map(({ name }) => name),
]);
for (const [requirement, caseNames] of Object.entries(cycleDurableCases.expectedTestCoverage)) {
  assert.ok(caseNames.length > 0, `${requirement} has no D7 contract cases`);
  for (const name of caseNames) assert.ok(d7CaseNames.has(name), `${requirement} references missing D7 case ${name}`);
}

const durableRecipe = cycleDurableCases.validHistory;
const durableRequest = validRequestsByName.get(durableRecipe.requestFixture);
const durableResult = validResultsByName.get(durableRecipe.resultFixture);
const durablePatch = graphPatchCases.validCases.find(({ name }) => name === durableRecipe.patchFixture)?.document;
const durableRevision = validRevisionsByName.get(durableRecipe.revisionFixture);
assert.ok(durableRequest && durableResult && durablePatch && durableRevision, "D7 durable recipe references an unknown fixture");
const durablePatchPayload = inlinePayloadFrom(durablePatch);
let durableEvents = [];

function materializeDurableValue(value, context = {}) {
  if (Array.isArray(value)) return value.map((item) => materializeDurableValue(item, context));
  if (value !== null && typeof value === "object") {
    if (Object.keys(value).length === 1 && Object.hasOwn(value, "$fixture")) {
      switch (value.$fixture) {
        case "request": return cloneJson(durableRequest);
        case "policy": return cloneJson(durableRequest.policy);
        case "patch-payload": return cloneJson(durablePatchPayload);
        case "revision": return cloneJson(durableRevision);
        case "lease": return cloneJson(durableRecipe.lease);
        case "round-record": return cloneJson(durableEvents[14].data.record);
        case "terminal-record-hash": return durableEvents.at(-1).recordHash;
        case "result": {
          const result = cloneJson(durableResult);
          result.historyPrefixHash = context.previousEventHash ?? durableEvents[14].recordHash;
          return result;
        }
        default: assert.fail(`unknown D7 durable fixture marker: ${value.$fixture}`);
      }
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, materializeDurableValue(item, context)]),
    );
  }
  return value;
}

let previousEventHash = null;
let materializedDurationMs = 0;
const materializedStartedAtMs = timestampMillis("2026-07-26T00:00:00Z", "D7 fixture start");
for (const [sequence, eventRecipe] of durableRecipe.events.entries()) {
  const data = materializeDurableValue(eventRecipe.data, { previousEventHash });
  const observedDuration = data.durationMs
    ?? data.decidedAtDurationMs
    ?? data.record?.durationMs
    ?? data.result?.durationMs
    ?? materializedDurationMs;
  materializedDurationMs = Math.max(materializedDurationMs, observedDuration);
  const timestamp = materializedDurationMs === 0
    ? "2026-07-26T00:00:00Z"
    : new Date(materializedStartedAtMs + materializedDurationMs).toISOString();
  const event = {
    apiVersion: "graphengineering.reacher-z.github.io/cycle-controller-events/v1alpha1",
    contractVersion: "cycle-controller-recovery/v1alpha1",
    eventId: `cycle-run-1-${sequence}`,
    type: eventRecipe.type,
    timestamp,
    controllerRunId: durableRequest.controllerRunId,
    hostRunId: durableRequest.hostRun.runId,
    controllerHash: cycleControllerCases.validRequests[0].expectControllerHash,
    requestHash: cycleControllerCases.validRequests[0].expectRequestHash,
    graphRevision: eventRecipe.graphRevision,
    sequence,
    expectedPreviousSequence: sequence - 1,
    previousEventHash,
    lease: sequence === 0 ? null : cloneJson(durableRecipe.lease),
    payloadDisposition: "inline-unredacted",
    redacted: false,
    payloadHash: hash(data),
    data,
  };
  event.recordHash = hashWithDomain(cycleDurableCases.hashDomains.eventRecord, event);
  durableEvents.push(event);
  previousEventHash = event.recordHash;
}

assert.deepEqual(
  durableEvents.map(({ recordHash }) => recordHash),
  durableRecipe.expectEventRecordHashes,
  "D7 durable event-chain golden hashes drifted",
);
assert.equal(previousEventHash, durableRecipe.expectTerminalRecordHash, "D7 terminal record hash drifted");
for (const event of durableEvents) {
  assert.equal(
    validateCycleEvent(event),
    true,
    `${event.sequence}:${event.type} valid cycle event does not conform: ${JSON.stringify(validateCycleEvent.errors)}`,
  );
}
const lineageBinding = {
  controllerRunId: durableRequest.controllerRunId,
  controllerId: durableRequest.controllerId,
  hostRunId: durableRequest.hostRun.runId,
  eventStreamId: durableRequest.eventStreamId,
  throughSequence: durableEvents.length - 1,
  recordHash: durableEvents.at(-1).recordHash,
  historyPrefixHash: durableEvents.at(-1).recordHash,
  requestHash: cycleControllerCases.validRequests[0].expectRequestHash,
  controllerHash: cycleControllerCases.validRequests[0].expectControllerHash,
};
const lineageSchemaSample = {
  apiVersion: "graphengineering.reacher-z.github.io/cycle-controller-lineage-manifests/v1alpha1",
  kind: "CycleControllerLineageManifest",
  contractVersion: "cycle-controller-lineage/v1alpha1",
  payloadDisposition: "inline-unredacted",
  redacted: false,
  limits: { maxDepth: 32, maxStreams: 33, maxEvents: 1024, maxBytes: 16777216 },
  target: lineageBinding,
  streams: [{ ...lineageBinding, parent: null, events: durableEvents }],
  eventCount: durableEvents.length,
  manifestHash: "0".repeat(64),
};
assert.equal(
  validateCycleLineageManifest(lineageSchemaSample),
  true,
  `D7 H06 lineage sample does not conform: ${JSON.stringify(validateCycleLineageManifest.errors)}`,
);
const hostileLineageSchemaSample = cloneJson(lineageSchemaSample);
hostileLineageSchemaSample.streams[0].unexpected = true;
assert.equal(
  validateCycleLineageManifest(hostileLineageSchemaSample),
  false,
  "D7 H06 lineage schema accepted an open stream entry",
);
for (const testCase of cycleDurableCases.validStandaloneEventSchemaCases) {
  const event = cloneJson(durableEvents[testCase.baseEvent]);
  for (const mutation of testCase.mutations) applyJsonMutation(event, mutation);
  event.payloadHash = hash(event.data);
  const { recordHash: _ignored, ...recordBody } = event;
  event.recordHash = hashWithDomain(cycleDurableCases.hashDomains.eventRecord, recordBody);
  assert.equal(
    validateCycleEvent(event),
    true,
    `${testCase.name} valid standalone cycle event does not conform: ${JSON.stringify(validateCycleEvent.errors)}`,
  );
}

class CycleHistoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CycleHistoryError";
    this.code = code;
  }
}

function invalidHistory(code, message) {
  throw new CycleHistoryError(code, message);
}

function assertExactJson(left, right, code, message) {
  if (JSON.stringify(canonicalize(left)) !== JSON.stringify(canonicalize(right))) {
    invalidHistory(code, message);
  }
}

function validateCycleHistory(events, options = {}) {
  if (events.length === 0) invalidHistory("GE_CYCLE_INVALID_HISTORY", "empty history");
  const requireTerminal = options.requireTerminal ?? true;
  const budgetFields = ["attempts", "costUsd", "dynamicNodes"];
  const policy = durableRequest.policy;
  const expectedControllerHash = cycleControllerCases.validRequests[0].expectControllerHash;
  const expectedRequestHash = cycleControllerCases.validRequests[0].expectRequestHash;
  let activeLease = null;
  let lastLeaseId = null;
  let maxLeaseEpoch = 0;
  let maxFencingToken = 0;
  let currentRevision = cloneJson(durableRequest.initialGraph);
  let nextIteration = 1;
  let round = null;
  let openActivity = null;
  let openActivitySettled = false;
  let unresolvedFailure = null;
  let unresolvedFailureActivity = null;
  let attemptsUsed = 0;
  let dynamicNodes = 0;
  let costUsd = 0;
  let durationMs = 0;
  let consecutiveDryRounds = 0;
  let lastTimestamp = -Infinity;
  let startedAt = null;
  let deadlineAt = null;
  let terminal = false;
  let terminalResult = null;
  let terminalObservation = null;
  let terminalInDoubtActivities = [];
  let lastCommittedRecord = null;
  const seen = new Set();
  const accepted = new Set();
  const rejected = new Set();
  const unknown = new Set();
  const eventIds = new Set();
  const decidedPatchIds = new Set();
  const decidedPatches = [];
  const committedRounds = [];

  const fail = (message, code = "GE_CYCLE_INVALID_HISTORY") => invalidHistory(code, message);
  const addCost = (left, right, label) => {
    const total = left + right;
    if (!Number.isFinite(total) || total < 0) fail(`${label} is not a finite nonnegative binary64 value`, "GE_CYCLE_COUNTER_MISMATCH");
    return total;
  };
  const bindingForPhase = (phase) => {
    const property = {
      finder: "finder",
      "candidate-evaluator": "candidateEvaluator",
      condition: "condition",
      "optimizer-evaluator": "optimizerEvaluator",
      "patch-planner": "patchPlanner",
    }[phase];
    return property === undefined ? null : durableRequest.activities[property];
  };
  const planEntryForPhase = (plan, phase) => {
    if (phase === "finder") return plan.finder;
    if (phase === "candidate-evaluator") return plan.candidateEvaluator;
    if (phase === "condition" || phase === "optimizer-evaluator") return plan.modeActivity;
    if (phase === "patch-planner") return plan.patchPlanner;
    return null;
  };
  const validatePlanEntry = (entry, expectedPhase) => {
    const binding = bindingForPhase(expectedPhase);
    if (entry === null || binding === null) fail(`round plan omits or invents ${expectedPhase}`);
    if (entry.phase !== expectedPhase || entry.activityId !== binding.activityId) {
      fail(`round plan ${expectedPhase} binding drifted`);
    }
    if (entry.maxAttempts > binding.maxAttemptsPerRound) fail(`round plan widens ${expectedPhase} attempts`);
    let maximumCost = 0;
    for (let attempt = 0; attempt < entry.maxAttempts; attempt += 1) {
      maximumCost = addCost(maximumCost, binding.maxCostUsdPerAttempt, `${expectedPhase} planned cost`);
    }
    if (entry.maxCostUsd !== maximumCost) fail(`round plan ${expectedPhase} cost is not its closed worst case`);
    return entry;
  };
  const validateRoundPlan = (plan, maximum) => {
    const entries = [
      validatePlanEntry(plan.finder, "finder"),
      validatePlanEntry(plan.candidateEvaluator, "candidate-evaluator"),
    ];
    const expectedModePhase = policy.mode === "while"
      ? "condition"
      : policy.mode === "evaluator-optimizer" ? "optimizer-evaluator" : null;
    if (expectedModePhase === null) {
      if (plan.modeActivity !== null) fail("until-dry round plan contains a mode activity");
    } else {
      entries.push(validatePlanEntry(plan.modeActivity, expectedModePhase));
    }
    if (plan.patchPlanner !== null) {
      if (!durableRequest.patches.enabled) fail("round plan enables a patch planner while patches are disabled");
      entries.push(validatePlanEntry(plan.patchPlanner, "patch-planner"));
    } else if (plan.maxDynamicNodes !== 0) {
      fail("patch-free round plan reserves dynamic nodes");
    }
    if (plan.maxDynamicNodes > policy.maxDynamicNodes - dynamicNodes) {
      fail("round plan widens remaining dynamic-node credit", "GE_CYCLE_COUNTER_MISMATCH");
    }
    const expectedMaximum = entries.reduce(
      (total, entry) => ({
        attempts: total.attempts + entry.maxAttempts,
        costUsd: addCost(total.costUsd, entry.maxCostUsd, "round planned cost"),
        dynamicNodes: total.dynamicNodes,
      }),
      { attempts: 0, costUsd: 0, dynamicNodes: plan.maxDynamicNodes },
    );
    assertExactJson(maximum, expectedMaximum, "GE_CYCLE_COUNTER_MISMATCH", "round maximum does not equal its closed plan");
    if (
      attemptsUsed + maximum.attempts > policy.maxTotalAttempts
      || addCost(costUsd, maximum.costUsd, "reserved controller cost") > policy.maxCostUsd
      || dynamicNodes + maximum.dynamicNodes > policy.maxDynamicNodes
    ) fail("round reservation exceeds remaining controller budget", "GE_CYCLE_COUNTER_MISMATCH");
  };
  const remainingBudget = () => Object.fromEntries(budgetFields.map((field) => [
    field,
    round.maximum[field] - round.committed[field] - round.released[field],
  ]));
  const assertBudgetTotals = (totals, label) => {
    assertExactJson(totals, {
      attemptsCommitted: attemptsUsed,
      costUsdCommitted: costUsd,
      dynamicNodesCommitted: dynamicNodes,
      liveReservations: remainingBudget(),
    }, "GE_CYCLE_COUNTER_MISMATCH", `${label} totals drifted`);
  };
  const observeDuration = (value, label) => {
    if (value < durationMs) fail(`${label} duration regressed`, "GE_CYCLE_COUNTER_MISMATCH");
    durationMs = value;
  };
  const validateUsage = (usage, phase, label) => {
    const binding = bindingForPhase(phase);
    if (usage.attempts !== 1 || usage.costUsd > binding.maxCostUsdPerAttempt) {
      fail(`${label} usage exceeds its claimed activity attempt`, "GE_CYCLE_COUNTER_MISMATCH");
    }
    return { attempts: usage.attempts, costUsd: usage.costUsd, dynamicNodes: 0 };
  };
  const closeActivity = (usage, phase, label) => {
    round.pendingSettlement = validateUsage(usage, phase, label);
    round.pendingSettlementPhase = phase;
    openActivity = null;
    openActivitySettled = false;
  };
  const patchBudgetSummary = (data, patchDocument, acceptedOutcome) => {
    const budget = data.budgetOutcome;
    const binding = bindingForPhase("patch-planner");
    if (budget.reservationId !== round.reservationId) fail("patch budget names another reservation");
    for (const field of budgetFields) {
      if (budget.requested[field] !== budget.committed[field] + budget.released[field]) {
        fail("patch budget summary does not reconcile", "GE_CYCLE_COUNTER_MISMATCH");
      }
      if (budget.requested[field] > remainingBudget()[field]) {
        fail("patch budget summary exceeds its live reservation", "GE_CYCLE_COUNTER_MISMATCH");
      }
    }
    if (
      budget.requested.attempts !== 1
      || budget.committed.attempts !== 1
      || budget.requested.costUsd !== binding.maxCostUsdPerAttempt
      || budget.committed.costUsd > binding.maxCostUsdPerAttempt
      || budget.requested.dynamicNodes !== round.plan.maxDynamicNodes
      || budget.committed.dynamicNodes !== (acceptedOutcome ? patchDocument.append.nodes.length : 0)
    ) fail("patch budget outcome is not the reserved planner decision", "GE_CYCLE_COUNTER_MISMATCH");
    round.pendingSettlement = cloneJson(budget.committed);
    round.pendingSettlementPhase = "patch-planner";
  };
  const phaseAllowed = (phase) => (
    (phase === "finder" && round.discovered === null)
    || (phase === "candidate-evaluator" && round.discovered !== null && round.evaluation === null)
    || (phase === "condition" && policy.mode === "while" && round.evaluation !== null && round.modeOutcome === null)
    || (phase === "optimizer-evaluator" && policy.mode === "evaluator-optimizer" && round.evaluation !== null && round.modeOutcome === null)
    || (phase === "patch-planner" && round.modeOutcome !== null && round.patchDecision === null)
  );
  const phaseMaximum = (phase) => {
    const planned = planEntryForPhase(round.plan, phase);
    if (planned === null) fail(`phase ${phase} has no round-plan credit`);
    return {
      attempts: planned.maxAttempts,
      costUsd: planned.maxCostUsd,
      dynamicNodes: phase === "patch-planner" ? round.plan.maxDynamicNodes : 0,
    };
  };
  const phaseCompleted = (phase) => (
    (phase === "finder" && round.discovered !== null)
    || (phase === "candidate-evaluator" && round.evaluation !== null)
    || (phase === "condition" && policy.mode === "while" && round.modeOutcome !== null)
    || (phase === "optimizer-evaluator" && policy.mode === "evaluator-optimizer" && round.modeOutcome !== null)
    || (phase === "patch-planner" && round.patchDecision !== null)
  );
  const currentOpenRoundProjection = () => {
    if (round === null) return null;
    let phase = "reserved";
    if (unresolvedFailure !== null) phase = "failed";
    else if (openActivity !== null) phase = "running";
    else if (round.patchDecision !== null) phase = "patch-decided";
    else if (round.modeOutcome !== null) phase = "mode-decided";
    else if (round.evaluation !== null) phase = "evaluated";
    else if (round.discovered !== null) phase = "discovered";
    const activity = openActivity === null ? null : {
      iteration: openActivity.iteration,
      reservationId: openActivity.reservationId,
      phase: openActivity.phase,
      activityId: openActivity.activityId,
      activityKey: openActivity.activityKey,
      attempt: openActivity.attempt,
      sideEffects: openActivity.sideEffects,
      inputHash: openActivity.inputHash,
    };
    return {
      iteration: round.iteration,
      phase,
      plan: cloneJson(round.plan),
      planHash: round.planHash,
      reservationId: round.reservationId,
      openActivity: activity,
      discovery: round.discovered === null ? null : {
        candidateBatchHash: round.discovered.candidateBatchHash,
        candidateCount: round.discovered.candidateCount,
        freshKeys: cloneJson(round.discovered.freshKeys),
        duplicateKeys: cloneJson(round.discovered.duplicateKeys),
        seenAdditions: cloneJson(round.discovered.seenAdditions),
      },
      evaluation: round.evaluation === null ? null : {
        acceptedKeys: cloneJson(round.evaluation.acceptedKeys),
        rejectedKeys: cloneJson(round.evaluation.rejectedKeys),
        unknownKeys: cloneJson(round.evaluation.unknownKeys),
      },
      modeOutcome: cloneJson(round.modeOutcome),
      patchDecision: cloneJson(round.patchDecision),
    };
  };

  for (const [index, event] of events.entries()) {
    if (!validateCycleEvent(event)) fail(`event ${index} schema failure: ${JSON.stringify(validateCycleEvent.errors)}`);
    assertPortableJsonValue(event, `event ${index}`);
    if (terminal) fail("event follows terminal result");
    const eventTime = timestampMillis(event.timestamp, `event ${index} timestamp`);
    if (eventTime < lastTimestamp) fail("event timestamps regress");
    lastTimestamp = eventTime;
    if (event.sequence !== index || event.expectedPreviousSequence !== index - 1) fail("non-contiguous event CAS sequence");
    const expectedPreviousHash = index === 0 ? null : events[index - 1].recordHash;
    if (event.previousEventHash !== expectedPreviousHash) fail("event hash chain is discontinuous");
    if (hash(event.data) !== event.payloadHash) fail("payload hash mismatch");
    const { recordHash, ...recordBody } = event;
    if (hashWithDomain(cycleDurableCases.hashDomains.eventRecord, recordBody) !== recordHash) fail("record hash mismatch");
    if (eventIds.has(event.eventId)) fail("duplicate event ID");
    eventIds.add(event.eventId);
    if (
      event.controllerRunId !== durableRequest.controllerRunId
      || event.hostRunId !== durableRequest.hostRun.runId
      || event.controllerHash !== expectedControllerHash
      || event.requestHash !== expectedRequestHash
    ) fail("controller identity drift");
    if (index === 0) {
      if (event.type !== "ControllerCreated" || event.lease !== null) fail("history does not begin with unleased ControllerCreated");
    } else if (event.lease === null) {
      fail("mutation event has no lease identity");
    }
    if (index > 0 && event.type !== "LeaseAcquired" && event.type !== "LeaseRenewed") {
      if (activeLease === null) fail("event appended without an active lease");
      assertExactJson(event.lease, activeLease, "GE_CYCLE_INVALID_HISTORY", "event uses stale lease identity");
      if (eventTime >= timestampMillis(activeLease.expiresAt, `event ${index} lease expiry`)) fail("event uses an expired lease");
    }

    switch (event.type) {
      case "ControllerCreated": {
        if (index !== 0) fail("duplicate ControllerCreated");
        assertExactJson(event.data.request, durableRequest, "GE_CYCLE_INVALID_HISTORY", "request bytes drifted");
        assertExactJson(event.data.identity, cycleControllerIdentity(durableRequest), "GE_CYCLE_INVALID_HISTORY", "controller identity body drifted");
        assertInlinePayload(event.data.request.objective, "controller objective", { maxBytes: 4194304 });
        if (
          event.data.requestHash !== hashWithDomain(cycleControllerCases.hashDomains.request, event.data.request)
          || event.data.controllerHash !== hashWithDomain(cycleControllerCases.hashDomains.controller, event.data.identity)
          || event.data.requestHash !== event.requestHash
          || event.data.controllerHash !== event.controllerHash
        ) fail("controller creation hash mismatch");
        startedAt = timestampMillis(event.data.startedAt, "controller start");
        deadlineAt = timestampMillis(event.data.deadlineAt, "controller deadline");
        if (deadlineAt - startedAt !== policy.maxDurationMs || eventTime !== startedAt) fail("controller deadline is not the exact policy duration");
        if (event.graphRevision !== currentRevision.graphRevision) fail("ControllerCreated revision drifted");
        break;
      }
      case "LeaseAcquired": {
        const priorLease = activeLease;
        if (
          priorLease !== null
          && event.data.reason !== "takeover"
          && eventTime < timestampMillis(priorLease.expiresAt, "prior lease expiry")
        ) fail("lease acquired while another unexpired lease is active");
        if (event.lease.leaseEpoch <= maxLeaseEpoch || event.lease.fencingToken <= maxFencingToken) {
          fail("lease epoch or fencing token did not advance");
        }
        const acquiredAt = timestampMillis(event.lease.acquiredAt, "lease acquisition");
        const expiresAt = timestampMillis(event.lease.expiresAt, "lease expiry");
        if (acquiredAt > eventTime || expiresAt <= eventTime) fail("lease acquisition interval is invalid");
        if (maxLeaseEpoch === 0 && (event.data.reason !== "start" || event.data.previousLeaseId !== null)) {
          fail("first lease is not the start lease");
        }
        if (
          maxLeaseEpoch > 0
          && (
            event.data.reason === "start"
            || event.data.previousLeaseId !== lastLeaseId
            || event.lease.leaseId === lastLeaseId
          )
        ) fail("reacquired lease does not bind the prior lease identity");
        activeLease = cloneJson(event.lease);
        lastLeaseId = activeLease.leaseId;
        maxLeaseEpoch = activeLease.leaseEpoch;
        maxFencingToken = activeLease.fencingToken;
        break;
      }
      case "LeaseRenewed": {
        if (activeLease === null || event.lease.leaseId !== activeLease.leaseId) fail("renewal does not identify active lease");
        if (
          eventTime >= timestampMillis(activeLease.expiresAt, "active lease expiry")
          || timestampMillis(event.lease.expiresAt, "renewed lease expiry") <= eventTime
          || event.lease.leaseEpoch !== activeLease.leaseEpoch
          || event.lease.fencingToken !== activeLease.fencingToken
          || event.lease.holderId !== activeLease.holderId
          || event.lease.acquiredAt !== activeLease.acquiredAt
          || event.data.previousExpiresAt !== activeLease.expiresAt
          || event.data.newExpiresAt !== event.lease.expiresAt
          || timestampMillis(event.data.newExpiresAt, "renewed lease expiry") <= timestampMillis(event.data.previousExpiresAt, "prior lease expiry")
        ) fail("renewal changed or failed to extend lease fencing identity");
        activeLease = cloneJson(event.lease);
        break;
      }
      case "LeaseReleased": {
        if (activeLease === null || event.lease.leaseId !== activeLease.leaseId) fail("release does not identify active lease");
        activeLease = null;
        break;
      }
      case "RoundReserved": {
        if (round !== null || event.data.iteration !== nextIteration) fail("round reservation is not contiguous");
        if (event.data.iteration > policy.maxIterations) fail("round reservation exceeds maxIterations");
        if (seen.size >= policy.maxDiscoveries) fail("round reserved without discovery credit");
        if (eventTime >= deadlineAt) fail("round reserved at or after the deadline");
        assertExactJson(event.data.currentRevision, currentRevision, "GE_CYCLE_INVALID_HISTORY", "round uses wrong revision");
        if (timestampMillis(event.data.deadlineAt, "round deadline") !== deadlineAt) fail("round deadline drifted");
        if (hashWithDomain(cycleDurableCases.hashDomains.roundPlan, event.data.plan) !== event.data.planHash) fail("round plan hash drifted");
        validateRoundPlan(event.data.plan, event.data.maximum);
        round = {
          iteration: event.data.iteration,
          plan: cloneJson(event.data.plan),
          planHash: event.data.planHash,
          reservationId: event.data.reservationId,
          maximum: cloneJson(event.data.maximum),
          committed: { attempts: 0, costUsd: 0, dynamicNodes: 0 },
          released: { attempts: 0, costUsd: 0, dynamicNodes: 0 },
          committedByPhase: new Map(),
          releasedPhases: new Set(),
          closingReleaseReason: null,
          attemptsByPhase: new Map(),
          keysByPhase: new Map(),
          pendingSettlement: null,
          pendingSettlementPhase: null,
          discovered: null,
          evaluation: null,
          modeOutcome: null,
          patchDecision: null,
        };
        nextIteration += 1;
        break;
      }
      case "ActivityStarted": {
        if (round === null || openActivity !== null || round.pendingSettlement !== null || event.data.iteration !== round.iteration) {
          fail("activity starts outside one ready open round");
        }
        if (round.closingReleaseReason !== null) fail("activity starts after a closing budget release");
        if (unresolvedFailure !== null) {
          if (!unresolvedFailure.retryable) fail("non-retryable activity failure was retried");
          if (unresolvedFailure.inDoubt && unresolvedFailureActivity?.sideEffects === "non-idempotent") {
            fail("in-doubt non-idempotent activity failure was retried");
          }
        }
        if (event.data.reservationId !== round.reservationId || !phaseAllowed(event.data.phase)) fail("activity phase is not ready");
        if (eventTime >= deadlineAt || durationMs >= policy.maxDurationMs) fail("activity dispatched at or after the deadline");
        const binding = bindingForPhase(event.data.phase);
        const planned = planEntryForPhase(round.plan, event.data.phase);
        if (
          binding === null || planned === null
          || event.data.activityId !== binding.activityId
          || event.data.sideEffects !== binding.sideEffects
          || planned.activityId !== binding.activityId
        ) fail("activity start is not bound by the request and round plan");
        const remaining = remainingBudget();
        if (
          remaining.attempts < 1
          || remaining.costUsd < binding.maxCostUsdPerAttempt
          || (event.data.phase === "patch-planner" && remaining.dynamicNodes < round.plan.maxDynamicNodes)
        ) fail("activity lacks its reserved worst-case dispatch credit", "GE_CYCLE_COUNTER_MISMATCH");
        const priorAttempts = round.attemptsByPhase.get(event.data.phase) ?? 0;
        if (event.data.attempt !== priorAttempts + 1 || event.data.attempt > planned.maxAttempts) fail("activity attempt is not contiguous or exceeds the plan");
        const expectedActivityKey = hashWithDomain(cycleDurableCases.hashDomains.activity, {
          controllerRunId: event.controllerRunId,
          controllerHash: event.controllerHash,
          iteration: event.data.iteration,
          phase: event.data.phase,
          activityId: event.data.activityId,
          inputHash: event.data.inputHash,
        });
        if (event.data.activityKey !== expectedActivityKey) fail("activity key preimage drifted");
        const priorKey = round.keysByPhase.get(event.data.phase);
        if (priorKey !== undefined && priorKey !== event.data.activityKey) fail("activity retry changed its stable key");
        round.attemptsByPhase.set(event.data.phase, event.data.attempt);
        round.keysByPhase.set(event.data.phase, event.data.activityKey);
        openActivity = cloneJson(event.data);
        openActivitySettled = false;
        unresolvedFailure = null;
        unresolvedFailureActivity = null;
        break;
      }
      case "ActivityFailed": {
        if (
          round === null || openActivity === null
          || event.data.iteration !== round.iteration
          || event.data.activityKey !== openActivity.activityKey
          || event.data.attempt !== openActivity.attempt
          || event.data.failure.phase !== openActivity.phase
        ) fail("failed activity has no matching start");
        unresolvedFailureActivity = cloneJson(openActivity);
        closeActivity(event.data.usage, openActivity.phase, `event ${index} failure`);
        unresolvedFailure = cloneJson(event.data.failure);
        break;
      }
      case "DiscoveryCommitted": {
        if (
          round === null || event.data.iteration !== round.iteration
          || openActivity?.phase !== "finder" || event.data.activityKey !== openActivity.activityKey
        ) {
          fail("discovery has no matching finder claim");
        }
        const candidates = assertInlinePayload(event.data.candidateBatch, `event ${index} candidate batch`, {
          maxBytes: policy.maxCandidateBatchBytes,
        });
        if (event.data.candidateBatch.sha256 !== event.data.candidateBatchHash) fail("candidate batch hash mismatch");
        if (!Array.isArray(candidates) || candidates.length !== event.data.candidateCount || candidates.length > policy.maxCandidatesPerRound) {
          fail("candidate count exceeds or disagrees with the batch");
        }
        const detachedSeen = new Set(seen);
        const freshKeys = [];
        const duplicateKeys = [];
        for (const candidate of candidates) {
          if (
            candidate === null || typeof candidate !== "object" || Array.isArray(candidate)
            || !Object.hasOwn(candidate, "key") || !Object.hasOwn(candidate, "value")
            || Object.keys(candidate).length !== 2 || typeof candidate.key !== "string"
            || candidate.key.length === 0 || hasLoneSurrogate(candidate.key)
            || Buffer.byteLength(candidate.key, "utf8") > 512
            || Buffer.byteLength(JSON.stringify(canonicalize(candidate)), "utf8") > policy.maxCandidateBytes
          ) fail("candidate violates its closed portable boundary");
          if (detachedSeen.has(candidate.key)) duplicateKeys.push(candidate.key);
          else {
            detachedSeen.add(candidate.key);
            freshKeys.push(candidate.key);
          }
        }
        if (seen.size + freshKeys.length > policy.maxDiscoveries) fail("candidate batch exceeds remaining discovery credit");
        assertExactJson(event.data.freshKeys, freshKeys, "GE_CYCLE_INVALID_HISTORY", "fresh-key order mismatch");
        assertExactJson(event.data.duplicateKeys, duplicateKeys, "GE_CYCLE_INVALID_HISTORY", "duplicate-key order mismatch");
        assertExactJson(event.data.seenAdditions, freshKeys, "GE_CYCLE_INVALID_HISTORY", "atomic seen additions mismatch");
        for (const key of freshKeys) seen.add(key);
        observeDuration(event.data.durationMs, "discovery");
        round.discovered = cloneJson(event.data);
        closeActivity(event.data.usage, "finder", `event ${index} discovery`);
        unresolvedFailure = null;
        unresolvedFailureActivity = null;
        break;
      }
      case "CandidateEvaluationCommitted": {
        if (
          round === null || round.discovered === null
          || event.data.iteration !== round.iteration
          || openActivity?.phase !== "candidate-evaluator"
          || event.data.activityKey !== openActivity.activityKey
        ) fail("evaluation has no committed discovery and claim");
        const verdictKeys = event.data.verdicts.map(({ key }) => key);
        assertExactJson(verdictKeys, round.discovered.freshKeys, "GE_CYCLE_INVALID_HISTORY", "verdict keys do not cover fresh keys exactly");
        const byVerdict = { accept: [], reject: [], unknown: [] };
        for (const verdict of event.data.verdicts) byVerdict[verdict.verdict].push(verdict.key);
        assertExactJson(event.data.acceptedKeys, byVerdict.accept, "GE_CYCLE_INVALID_HISTORY", "accepted keys mismatch");
        assertExactJson(event.data.rejectedKeys, byVerdict.reject, "GE_CYCLE_INVALID_HISTORY", "rejected keys mismatch");
        assertExactJson(event.data.unknownKeys, byVerdict.unknown, "GE_CYCLE_INVALID_HISTORY", "unknown keys mismatch");
        for (const key of byVerdict.accept) accepted.add(key);
        for (const key of byVerdict.reject) rejected.add(key);
        for (const key of byVerdict.unknown) unknown.add(key);
        observeDuration(event.data.durationMs, "candidate evaluation");
        round.evaluation = cloneJson(event.data);
        closeActivity(event.data.usage, "candidate-evaluator", `event ${index} evaluation`);
        unresolvedFailure = null;
        unresolvedFailureActivity = null;
        break;
      }
      case "ModeOutcomeCommitted": {
        if (
          round === null || event.data.iteration !== round.iteration
          || round.evaluation === null || round.modeOutcome !== null || round.pendingSettlement !== null
        ) {
          fail("mode outcome is out of phase");
        }
        if (event.data.outcome.mode !== policy.mode) fail("mode outcome changed controller mode");
        if (policy.mode === "until-dry") {
          if (openActivity !== null || event.data.activityKey !== null || event.data.usage.attempts !== 0 || event.data.usage.costUsd !== 0) {
            fail("deterministic until-dry outcome claimed activity usage");
          }
        } else {
          const expectedPhase = policy.mode === "while" ? "condition" : "optimizer-evaluator";
          if (openActivity?.phase !== expectedPhase || event.data.activityKey !== openActivity.activityKey) fail("mode outcome has no matching activity");
          closeActivity(event.data.usage, expectedPhase, `event ${index} mode outcome`);
        }
        observeDuration(event.data.durationMs, "mode outcome");
        round.modeOutcome = cloneJson(event.data.outcome);
        unresolvedFailure = null;
        unresolvedFailureActivity = null;
        break;
      }
      case "BudgetReservationSettled": {
        if (
          round === null || event.data.iteration !== round.iteration
          || event.data.reservationId !== round.reservationId
        ) fail("budget settlement has no live reservation");
        let expectedSettlement = round.pendingSettlement;
        if (expectedSettlement === null && openActivity !== null && !openActivitySettled) {
          const binding = bindingForPhase(openActivity.phase);
          expectedSettlement = { attempts: 1, costUsd: binding.maxCostUsdPerAttempt, dynamicNodes: 0 };
          openActivitySettled = true;
        }
        const settlementPhase = round.pendingSettlementPhase ?? openActivity?.phase;
        if (expectedSettlement === null || event.data.phase !== settlementPhase) {
          fail("budget settlement is not tied to one activity outcome");
        }
        assertExactJson(event.data.committed, expectedSettlement, "GE_CYCLE_COUNTER_MISMATCH", "budget settlement differs from activity usage");
        for (const field of budgetFields) {
          round.committed[field] += event.data.committed[field];
          if (round.committed[field] + round.released[field] > round.maximum[field]) fail("reservation over-settled", "GE_CYCLE_COUNTER_MISMATCH");
        }
        const phaseCommitted = round.committedByPhase.get(settlementPhase)
          ?? { attempts: 0, costUsd: 0, dynamicNodes: 0 };
        const maximum = phaseMaximum(settlementPhase);
        for (const field of budgetFields) {
          phaseCommitted[field] = field === "costUsd"
            ? addCost(phaseCommitted[field], event.data.committed[field], `${settlementPhase} committed cost`)
            : phaseCommitted[field] + event.data.committed[field];
          if (phaseCommitted[field] > maximum[field]) {
            fail("phase settlement exceeds its closed plan", "GE_CYCLE_COUNTER_MISMATCH");
          }
        }
        round.committedByPhase.set(settlementPhase, phaseCommitted);
        attemptsUsed += event.data.committed.attempts;
        costUsd = addCost(costUsd, event.data.committed.costUsd, "committed controller cost");
        dynamicNodes += event.data.committed.dynamicNodes;
        if (attemptsUsed > policy.maxTotalAttempts || costUsd > policy.maxCostUsd || dynamicNodes > policy.maxDynamicNodes) {
          fail("committed usage exceeds controller policy", "GE_CYCLE_COUNTER_MISMATCH");
        }
        round.pendingSettlement = null;
        round.pendingSettlementPhase = null;
        assertBudgetTotals(event.data.totals, "budget settlement");
        break;
      }
      case "BudgetReservationReleased": {
        if (
          round === null || event.data.iteration !== round.iteration
          || event.data.reservationId !== round.reservationId || round.pendingSettlement !== null
        ) {
          fail("budget release has no settled live reservation");
        }
        if (openActivity !== null && !openActivitySettled) fail("budget release discards an in-doubt attempt claim");
        if (budgetFields.every((field) => event.data.released[field] === 0)) fail("budget release is a no-op");
        const beforeRelease = remainingBudget();
        if (event.data.reason === "phase-complete") {
          const phase = event.data.phase;
          if (
            round.closingReleaseReason !== null || round.releasedPhases.has(phase)
            || !phaseCompleted(phase) || openActivity !== null
          ) fail("phase-complete release has no newly completed phase");
          const committed = round.committedByPhase.get(phase) ?? { attempts: 0, costUsd: 0, dynamicNodes: 0 };
          const maximum = phaseMaximum(phase);
          const expectedRelease = Object.fromEntries(
            budgetFields.map((field) => [field, maximum[field] - committed[field]]),
          );
          assertExactJson(
            event.data.released,
            expectedRelease,
            "GE_CYCLE_COUNTER_MISMATCH",
            "phase-complete release is not the exact unused phase credit",
          );
          round.releasedPhases.add(phase);
        } else {
          assertExactJson(
            event.data.released,
            beforeRelease,
            "GE_CYCLE_COUNTER_MISMATCH",
            "closing release does not release the exact remainder",
          );
          if (round.closingReleaseReason !== null) fail("round has more than one closing release");
          if (event.data.reason === "round-complete") {
            if (
              unresolvedFailure !== null || openActivity !== null || round.modeOutcome === null
              || (round.plan.patchPlanner !== null && round.patchDecision === null)
            ) fail("round-complete release occurs before the round path is complete");
          } else if (event.data.reason === "failed") {
            if (unresolvedFailure === null) fail("failed release has no failed activity fact");
          } else if (event.data.reason === "patch-rejected") {
            if (round.patchDecision?.outcome !== "rejected") fail("patch-rejected release has no rejected patch fact");
          } else if (event.data.reason === "bound-reached") {
            const boundReached = (
              eventTime >= deadlineAt || durationMs >= policy.maxDurationMs
              || (costUsd > 0 && costUsd >= policy.maxCostUsd)
              || attemptsUsed >= policy.maxTotalAttempts
              || (dynamicNodes > 0 && dynamicNodes >= policy.maxDynamicNodes)
              || seen.size >= policy.maxDiscoveries
            );
            if (!boundReached) fail("bound-reached release has no folded hard-bound fact");
          }
          round.closingReleaseReason = event.data.reason;
        }
        for (const field of budgetFields) {
          round.released[field] += event.data.released[field];
          const remaining = round.maximum[field] - round.committed[field] - round.released[field];
          if (remaining < 0 || remaining !== event.data.remaining[field]) fail("reservation release remainder mismatch", "GE_CYCLE_COUNTER_MISMATCH");
        }
        assertBudgetTotals(event.data.totals, "budget release");
        break;
      }
      case "PatchAccepted":
      case "PatchRejected": {
        const acceptedOutcome = event.type === "PatchAccepted";
        if (
          round === null || event.data.iteration !== round.iteration
          || openActivity?.phase !== "patch-planner"
          || event.data.plannerActivityKey !== openActivity.activityKey
          || event.data.authoritySnapshot.proposerActivityKey !== openActivity.activityKey
          || round.patchDecision !== null || round.pendingSettlement !== null
        ) fail("patch decision is out of phase or detached from its authority claim");
        const patchDocument = assertInlinePayload(event.data.patch, `event ${index} patch bytes`, { maxBytes: 4194304 });
        if (
          event.data.patchHash !== event.data.patch.sha256
          || !validateGraphPatch(patchDocument)
          || patchDocument.patchId !== event.data.patchId
          || decidedPatchIds.has(event.data.patchId)
        ) fail("stored patch bytes are invalid, mismatched, or reuse a decided ID");
        assertExactJson(event.data.requestedBase, currentRevision, "GE_CYCLE_INVALID_HISTORY", "patch uses stale requested base");
        assertExactJson(patchDocument.base, currentRevision, "GE_CYCLE_INVALID_HISTORY", "stored patch bytes use another base");
        if (patchDocument.append.nodes.length > round.plan.maxDynamicNodes) fail("patch exceeds its per-round structural reservation", "GE_CYCLE_COUNTER_MISMATCH");
        patchBudgetSummary(event.data, patchDocument, acceptedOutcome);
        observeDuration(event.data.decidedAtDurationMs, "patch decision");
        if (acceptedOutcome) {
          const revision = event.data.resultingRevision;
          if (
            revision.body.graphRevision !== currentRevision.graphRevision + 1
            || revision.body.previousRevisionHash !== currentRevision.revisionHash
            || revision.body.patchHash !== event.data.patchHash
            || hashWithDomain(cycleControllerCases.hashDomains.revision, revision.body) !== revision.revisionHash
            || event.graphRevision !== revision.body.graphRevision
          ) fail("accepted patch revision chain is invalid");
          currentRevision = {
            graphRevision: revision.body.graphRevision,
            graphHash: revision.body.graphHash,
            revisionHash: revision.revisionHash,
          };
          round.patchDecision = {
            patchId: event.data.patchId,
            patchHash: event.data.patchHash,
            outcome: "accepted",
            requestedBase: cloneJson(event.data.requestedBase),
            resultingRevision: cloneJson(currentRevision),
          };
        } else {
          if (event.graphRevision !== currentRevision.graphRevision) fail("rejected patch changed graph revision");
          round.patchDecision = {
            patchId: event.data.patchId,
            patchHash: event.data.patchHash,
            outcome: "rejected",
            requestedBase: cloneJson(event.data.requestedBase),
            errorCode: event.data.errorCode,
          };
        }
        decidedPatchIds.add(event.data.patchId);
        decidedPatches.push({
          patchId: event.data.patchId,
          patchHash: event.data.patchHash,
          outcome: acceptedOutcome ? "accepted" : "rejected",
          decisionSequence: event.sequence,
        });
        openActivity = null;
        openActivitySettled = false;
        unresolvedFailure = null;
        unresolvedFailureActivity = null;
        break;
      }
      case "RoundCommitted": {
        if (
          round === null || openActivity !== null || round.pendingSettlement !== null
          || unresolvedFailure !== null || round.discovered === null
          || round.evaluation === null || round.modeOutcome === null
        ) fail("round commits before all required phases");
        if (round.closingReleaseReason !== null && round.closingReleaseReason !== "round-complete") {
          fail("round commits after a terminal-path budget release");
        }
        for (const field of budgetFields) {
          if (round.committed[field] + round.released[field] !== round.maximum[field]) {
            fail("round commits with a live reservation", "GE_CYCLE_COUNTER_MISMATCH");
          }
        }
        const record = event.data.record;
        const expectedDryRounds = policy.mode === "until-dry"
          ? (round.discovered.freshKeys.length === 0 ? consecutiveDryRounds + 1 : 0)
          : 0;
        if (
          record.iteration !== round.iteration
          || record.candidateBatchHash !== round.discovered.candidateBatchHash
          || record.candidateCount !== round.discovered.candidateCount
          || record.consecutiveDryRounds !== expectedDryRounds
          || record.attemptsUsed !== attemptsUsed || record.costUsd !== costUsd
          || record.dynamicNodes !== dynamicNodes || record.durationMs !== durationMs
        ) fail("round cumulative counters drifted", "GE_CYCLE_COUNTER_MISMATCH");
        assertExactJson(record.freshKeys, round.discovered.freshKeys, "GE_CYCLE_INVALID_HISTORY", "round fresh keys drifted");
        assertExactJson(record.duplicateKeys, round.discovered.duplicateKeys, "GE_CYCLE_INVALID_HISTORY", "round duplicate keys drifted");
        assertExactJson(record.acceptedKeys, round.evaluation.acceptedKeys, "GE_CYCLE_INVALID_HISTORY", "round accepted keys drifted");
        assertExactJson(record.rejectedKeys, round.evaluation.rejectedKeys, "GE_CYCLE_INVALID_HISTORY", "round rejected keys drifted");
        assertExactJson(record.unknownKeys, round.evaluation.unknownKeys, "GE_CYCLE_INVALID_HISTORY", "round unknown keys drifted");
        assertExactJson(record.modeOutcome, round.modeOutcome, "GE_CYCLE_INVALID_HISTORY", "round mode outcome drifted");
        assertExactJson(record.patchDecision, round.patchDecision, "GE_CYCLE_INVALID_HISTORY", "round patch decision drifted");
        assertExactJson(record.currentRevision, currentRevision, "GE_CYCLE_INVALID_HISTORY", "round revision drifted");
        consecutiveDryRounds = expectedDryRounds;
        lastCommittedRecord = cloneJson(record);
        committedRounds.push(cloneJson(record));
        round = null;
        break;
      }
      case "ControllerTerminated": {
        if (round !== null && round.pendingSettlement !== null) fail("controller terminated with unsettled activity usage");
        if (round !== null) {
          for (const field of budgetFields) {
            if (round.committed[field] + round.released[field] !== round.maximum[field]) {
              fail("controller terminated with a live reservation", "GE_CYCLE_COUNTER_MISMATCH");
            }
          }
        }
        if (openActivity !== null && !openActivitySettled) fail("controller terminated with an uncharged in-doubt activity");
        const result = event.data.result;
        observeDuration(result.durationMs, "terminal result");
        assertResultCounters(result, "terminal result");
        const unevaluated = [...seen].filter((key) => !accepted.has(key) && !rejected.has(key) && !unknown.has(key));
        let convergenceReason = null;
        let unknownVerdict = false;
        if (lastCommittedRecord !== null) {
          if (policy.mode === "until-dry" && consecutiveDryRounds >= policy.consecutiveDryRounds) convergenceReason = "DRY";
          if (policy.mode === "while" && lastCommittedRecord.modeOutcome.condition === false) convergenceReason = "CONDITION_FALSE";
          if (policy.mode === "evaluator-optimizer") {
            if (lastCommittedRecord.modeOutcome.verdict === "accept") convergenceReason = "EVALUATOR_ACCEPTED";
            if (lastCommittedRecord.modeOutcome.verdict === "unknown") unknownVerdict = true;
          }
        }
        const patchRejected = round?.patchDecision?.outcome === "rejected";
        const computedObservation = {
          cancelled: event.data.observation.cancelled,
          maxDuration: durationMs >= policy.maxDurationMs,
          maxCost: costUsd > 0 && costUsd >= policy.maxCostUsd,
          maxTotalAttempts: attemptsUsed > 0 && attemptsUsed >= policy.maxTotalAttempts,
          maxDynamicNodes: dynamicNodes > 0 && dynamicNodes >= policy.maxDynamicNodes,
          maxDiscoveries: convergenceReason === null && seen.size >= policy.maxDiscoveries,
          maxIterations: nextIteration - 1 >= policy.maxIterations,
          patchRejected,
          failed: event.data.observation.failed,
          failureCode: event.data.observation.failureCode,
          unknownVerdict,
          convergenceReason,
        };
        if (unresolvedFailure !== null) {
          computedObservation.failed = true;
          computedObservation.failureCode = unresolvedFailure.code;
        }
        if (computedObservation.failed !== (computedObservation.failureCode !== null)) fail("failure observation code/flag mismatch");
        assertExactJson(event.data.observation, computedObservation, "GE_CYCLE_INVALID_HISTORY", "terminal observation does not match folded facts");
        if (round?.closingReleaseReason === "cancelled" && !computedObservation.cancelled) fail("cancelled release is not closed by cancellation");
        if (round?.closingReleaseReason === "failed" && !computedObservation.failed) fail("failed release is not closed by failure");
        if (round?.closingReleaseReason === "patch-rejected" && !computedObservation.patchRejected) fail("patch-rejected release is not closed by rejection");
        if (
          round?.closingReleaseReason === "bound-reached"
          && ![
            "maxDuration", "maxCost", "maxTotalAttempts", "maxDynamicNodes", "maxDiscoveries", "maxIterations",
          ].some((field) => computedObservation[field])
        ) fail("bound-reached release is not closed by a hard bound");
        const precedence = [
          ["cancelled", "CANCELLED"], ["maxDuration", "MAX_DURATION"], ["maxCost", "MAX_COST"],
          ["maxTotalAttempts", "MAX_TOTAL_ATTEMPTS"], ["maxDynamicNodes", "MAX_DYNAMIC_NODES"],
          ["maxDiscoveries", "MAX_DISCOVERIES"], ["maxIterations", "MAX_ITERATIONS"],
          ["patchRejected", "PATCH_REJECTED"], ["failed", "FAILED"], ["unknownVerdict", "UNKNOWN_VERDICT"],
        ];
        const selected = precedence.find(([field]) => computedObservation[field])?.[1] ?? convergenceReason;
        if (selected === null || result.exitReason !== selected) fail("terminal exit reason violates folded precedence");
        if (
          result.controllerRunId !== event.controllerRunId || result.controllerHash !== event.controllerHash
          || result.requestHash !== event.requestHash || result.mode !== policy.mode
          || result.terminalSequence !== event.sequence || result.historyPrefixHash !== event.previousEventHash
          || result.iterations !== nextIteration - 1 || result.consecutiveDryRounds !== consecutiveDryRounds
          || result.seenCount !== seen.size || result.acceptedCount !== accepted.size
          || result.rejectedCount !== rejected.size || result.unknownCount !== unknown.size
          || result.unevaluatedCount !== unevaluated.length || result.attemptsUsed !== attemptsUsed
          || result.costUsd !== costUsd || result.dynamicNodes !== dynamicNodes || result.durationMs !== durationMs
          || result.lastGraphRevision !== currentRevision.graphRevision
          || result.lastGraphHash !== currentRevision.graphHash
          || result.lastRevisionHash !== currentRevision.revisionHash
        ) fail("terminal projection does not match fold", "GE_CYCLE_COUNTER_MISMATCH");
        terminalInDoubtActivities = openActivity === null ? [] : [{
          iteration: openActivity.iteration,
          reservationId: openActivity.reservationId,
          phase: openActivity.phase,
          activityId: openActivity.activityId,
          activityKey: openActivity.activityKey,
          attempt: openActivity.attempt,
          sideEffects: openActivity.sideEffects,
          inputHash: openActivity.inputHash,
        }];
        terminal = true;
        terminalResult = cloneJson(result);
        terminalObservation = cloneJson(event.data.observation);
        activeLease = null;
        round = null;
        openActivity = null;
        break;
      }
      default: break;
    }
    if (event.graphRevision !== currentRevision.graphRevision) fail("event graph revision does not equal folded current revision");
  }
  if (requireTerminal && !terminal) fail("history is not terminal");
  const unevaluatedKeys = [...seen].filter((key) => !accepted.has(key) && !rejected.has(key) && !unknown.has(key));
  const liveReservations = round === null ? [] : [{
    reservationId: round.reservationId,
    iteration: round.iteration,
    maximum: cloneJson(round.maximum),
    committed: cloneJson(round.committed),
    released: cloneJson(round.released),
    remaining: remainingBudget(),
  }];
  return {
    controllerHash: expectedControllerHash,
    requestHash: expectedRequestHash,
    graphRevision: currentRevision.graphRevision,
    lease: cloneJson(activeLease),
    state: {
      contractVersion: "cycle-controller-recovery/v1alpha1",
      request: cloneJson(durableRequest),
      requestHash: expectedRequestHash,
      controllerHash: expectedControllerHash,
      startedAt: events[0].data.startedAt,
      deadlineAt: events[0].data.deadlineAt,
      currentRevision: cloneJson(currentRevision),
      status: terminal ? "terminal" : "active",
      nextIteration,
      seenKeys: [...seen],
      acceptedKeys: [...accepted],
      rejectedKeys: [...rejected],
      unknownKeys: [...unknown],
      unevaluatedKeys,
      consecutiveDryRounds,
      attemptsUsed,
      costUsd,
      dynamicNodes,
      durationMs,
      liveReservations,
      inDoubtActivities: terminal ? terminalInDoubtActivities : [],
      decidedPatches,
      committedRounds,
      openRound: terminal ? null : currentOpenRoundProjection(),
      terminalObservation: terminal ? terminalObservation : null,
      terminalResult: terminal ? terminalResult : null,
    },
  };
}

validateCycleHistory(durableEvents);

function rehashCycleEvents(events, startIndex) {
  for (let index = startIndex; index < events.length; index += 1) {
    events[index].previousEventHash = index === 0 ? null : events[index - 1].recordHash;
    events[index].payloadHash = hash(events[index].data);
    const { recordHash: _ignored, ...recordBody } = events[index];
    events[index].recordHash = hashWithDomain(cycleDurableCases.hashDomains.eventRecord, recordBody);
  }
}

for (const testCase of cycleDurableCases.invalidEventSchemaCases) {
  const event = cloneJson(durableEvents[testCase.event]);
  applyJsonMutation(event, testCase.mutation);
  assert.equal(validateCycleEvent(event), false, `${testCase.name} invalid cycle event unexpectedly conforms`);
}

for (const testCase of cycleDurableCases.invalidEventHistoryCases) {
  const events = cloneJson(durableEvents);
  const mutation = testCase.mutation;
  if (mutation.op === "insert-release-and-rehash") {
    const before = mutation.beforeEvent;
    const inserted = cloneJson(events[13]);
    inserted.eventId = `cycle-run-1-hostile-release-${before}`;
    inserted.type = "BudgetReservationReleased";
    inserted.timestamp = events[before - 1].timestamp;
    inserted.graphRevision = events[before - 1].graphRevision;
    inserted.data = cloneJson(mutation.data);
    events.splice(before, 0, inserted);
    for (let index = before; index < events.length; index += 1) {
      events[index].sequence = index;
      events[index].expectedPreviousSequence = index - 1;
      events[index].previousEventHash = events[index - 1].recordHash;
      events[index].payloadHash = hash(events[index].data);
      const { recordHash: _ignored, ...recordBody } = events[index];
      events[index].recordHash = hashWithDomain(cycleDurableCases.hashDomains.eventRecord, recordBody);
    }
  } else if (mutation.op === "swap-and-rehash") {
    const left = cloneJson(events[mutation.left]);
    const right = cloneJson(events[mutation.right]);
    for (const field of ["type", "graphRevision", "data"]) {
      events[mutation.left][field] = right[field];
      events[mutation.right][field] = left[field];
    }
    rehashCycleEvents(events, Math.min(mutation.left, mutation.right));
  } else if (mutation.op === "copy-and-rehash") {
    const value = cloneJson(valueAtPointer(events[mutation.fromEvent], mutation.fromPath));
    applyJsonMutation(events[mutation.event], { op: "replace", path: mutation.path, value });
    rehashCycleEvents(events, mutation.event);
  } else {
    const rehash = mutation.op === "replace-and-rehash";
    applyJsonMutation(events[mutation.event], {
      op: mutation.op === "replace-and-rehash" ? "replace" : mutation.op,
      path: mutation.path,
      value: mutation.value,
    });
    if (rehash) rehashCycleEvents(events, mutation.event);
  }
  assert.throws(
    () => validateCycleHistory(events),
    (error) => (
      error instanceof CycleHistoryError
      && error.code === testCase.expectCode
      && (testCase.expectMessage === undefined || error.message.includes(testCase.expectMessage))
    ),
    `${testCase.name} hostile history was not rejected with ${testCase.expectCode}`,
  );
}

const durableCheckpoint = materializeDurableValue(cycleDurableCases.checkpoint.body);
durableCheckpoint.contentHash = hash(durableCheckpoint);
assert.equal(
  durableCheckpoint.contentHash,
  cycleDurableCases.checkpoint.expectContentHash,
  "D7 checkpoint golden content hash drifted",
);
assert.equal(
  validateCycleCheckpoint(durableCheckpoint),
  true,
  `valid D7 checkpoint does not conform: ${JSON.stringify(validateCycleCheckpoint.errors)}`,
);

function validateCycleCheckpointSemantics(checkpoint, events) {
  assertPortableJsonValue(checkpoint, "cycle checkpoint");
  const { contentHash, ...body } = checkpoint;
  if (hash(body) !== contentHash) invalidHistory("GE_CYCLE_INVALID_HISTORY", "checkpoint content hash mismatch");
  if (checkpoint.lastSequence >= events.length) invalidHistory("GE_CYCLE_INVALID_HISTORY", "checkpoint leads event tail");
  timestampMillis(checkpoint.createdAt, "checkpoint creation timestamp");
  if (checkpoint.historyPrefixHash !== events[checkpoint.lastSequence].recordHash) {
    invalidHistory("GE_CYCLE_INVALID_HISTORY", "checkpoint prefix hash mismatch");
  }
  const folded = validateCycleHistory(events.slice(0, checkpoint.lastSequence + 1), { requireTerminal: false });
  if (
    checkpoint.controllerRunId !== durableRequest.controllerRunId
    || checkpoint.hostRunId !== durableRequest.hostRun.runId
    || checkpoint.eventStreamId !== durableRequest.eventStreamId
    || checkpoint.controllerHash !== folded.controllerHash
    || checkpoint.requestHash !== folded.requestHash
    || checkpoint.graphRevision !== folded.graphRevision
    || checkpoint.payloadDisposition !== "inline-unredacted"
    || checkpoint.redacted !== false
  ) invalidHistory("GE_CYCLE_INVALID_HISTORY", "checkpoint envelope identity drifted");
  assertExactJson(checkpoint.lease, folded.lease, "GE_CYCLE_INVALID_HISTORY", "checkpoint lease projection drifted");
  const state = checkpoint.state;
  const expectedState = folded.state;
  for (const field of ["attemptsUsed", "costUsd", "dynamicNodes", "durationMs", "consecutiveDryRounds"]) {
    if (state[field] !== expectedState[field]) {
      invalidHistory("GE_CYCLE_COUNTER_MISMATCH", `checkpoint ${field} drifted`);
    }
  }
  for (const field of ["seenKeys", "acceptedKeys", "rejectedKeys", "unknownKeys", "unevaluatedKeys"]) {
    if (state[field].length !== expectedState[field].length) {
      invalidHistory("GE_CYCLE_COUNTER_MISMATCH", `checkpoint ${field} count drifted`);
    }
  }
  assertExactJson(state, expectedState, "GE_CYCLE_INVALID_HISTORY", "checkpoint is not the exact event-prefix fold");
}

validateCycleCheckpointSemantics(durableCheckpoint, durableEvents);

function appendMaterializedCycleEvent(events, type, graphRevision, data, timestamp, lease = durableRecipe.lease) {
  const sequence = events.length;
  const previous = events.at(-1);
  const event = {
    apiVersion: "graphengineering.reacher-z.github.io/cycle-controller-events/v1alpha1",
    contractVersion: "cycle-controller-recovery/v1alpha1",
    eventId: `cycle-run-1-interrupted-${sequence}`,
    type,
    timestamp,
    controllerRunId: durableRequest.controllerRunId,
    hostRunId: durableRequest.hostRun.runId,
    controllerHash: cycleControllerCases.validRequests[0].expectControllerHash,
    requestHash: cycleControllerCases.validRequests[0].expectRequestHash,
    graphRevision,
    sequence,
    expectedPreviousSequence: sequence - 1,
    previousEventHash: previous.recordHash,
    lease: cloneJson(lease),
    payloadDisposition: "inline-unredacted",
    redacted: false,
    payloadHash: hash(data),
    data,
  };
  event.recordHash = hashWithDomain(cycleDurableCases.hashDomains.eventRecord, event);
  events.push(event);
}

const leaseTransitionHistories = new Map();
for (const testCase of cycleDurableCases.leaseTransitionCases) {
  const events = cloneJson(durableEvents.slice(0, testCase.prefixThroughEvent + 1));
  for (const eventRecipe of testCase.events) {
    const materialized = materializeDurableValue(eventRecipe);
    appendMaterializedCycleEvent(
      events,
      materialized.type,
      1,
      materialized.data,
      materialized.timestamp,
      materialized.lease,
    );
  }
  const folded = validateCycleHistory(events, { requireTerminal: false });
  assert.equal(folded.lease.leaseId, testCase.expectLeaseId, `${testCase.name} final lease drifted`);
  assert.equal(events.at(-1).recordHash, testCase.expectTailHash, `${testCase.name} tail hash drifted`);
  leaseTransitionHistories.set(testCase.name, events);
}
for (const testCase of cycleDurableCases.invalidLeaseTransitionCases) {
  const events = cloneJson(leaseTransitionHistories.get(testCase.base));
  applyJsonMutation(events[testCase.mutation.event], testCase.mutation);
  rehashCycleEvents(events, testCase.mutation.event);
  assert.throws(
    () => validateCycleHistory(events, { requireTerminal: false }),
    (error) => error instanceof CycleHistoryError && error.code === testCase.expectCode,
    `${testCase.name} invalid lease history was accepted`,
  );
}

for (const testCase of cycleDurableCases.validInterruptedHistoryCases ?? []) {
  const events = cloneJson(durableEvents.slice(0, testCase.prefixThroughEvent + 1));
  const timestamp = testCase.timestamp ?? "2026-07-26T00:00:00.020Z";
  if (testCase.failure !== undefined) {
    appendMaterializedCycleEvent(events, "ActivityFailed", 1, cloneJson(testCase.failure), timestamp);
  }
  appendMaterializedCycleEvent(events, "BudgetReservationSettled", 1, {
    iteration: 1,
    reservationId: "round-1",
    ...cloneJson(testCase.settlement),
  }, timestamp);
  if (testCase.expectRetryBlocked !== undefined) {
    const retryEvents = cloneJson(events);
    const retry = cloneJson(durableEvents[testCase.prefixThroughEvent].data);
    retry.attempt += 1;
    appendMaterializedCycleEvent(retryEvents, "ActivityStarted", 1, retry, timestamp);
    assert.throws(
      () => validateCycleHistory(retryEvents, { requireTerminal: false }),
      (error) => error instanceof CycleHistoryError && error.message.includes(testCase.expectRetryBlocked),
      `${testCase.name} did not block its forbidden retry`,
    );
  }
  appendMaterializedCycleEvent(events, "BudgetReservationReleased", 1, {
    iteration: 1,
    reservationId: "round-1",
    ...cloneJson(testCase.release),
  }, timestamp);
  const result = cloneJson(durableResult);
  Object.assign(result, testCase.result ?? {
    status: "cancelled", exitReason: "CANCELLED", attemptsUsed: 3, dynamicNodes: 0,
    durationMs: 20, lastGraphRevision: 1,
    lastGraphHash: durableRequest.initialGraph.graphHash, lastRevisionHash: durableRequest.initialGraph.revisionHash,
  }, {
    terminalSequence: events.length,
    historyPrefixHash: events.at(-1).recordHash,
  });
  appendMaterializedCycleEvent(events, "ControllerTerminated", 1, {
    observation: cloneJson(testCase.observation),
    result,
  }, timestamp);
  const folded = validateCycleHistory(events);
  assert.equal(events.at(-1).recordHash, testCase.expect.terminalRecordHash, `${testCase.name} terminal hash drifted`);
  const expectedInDoubtCount = testCase.expect.inDoubtActivityCount
    ?? (testCase.expect.inDoubtActivityKey === undefined ? 0 : 1);
  assert.equal(folded.state.inDoubtActivities.length, expectedInDoubtCount, `${testCase.name} in-doubt count drifted`);
  if (testCase.expect.inDoubtActivityKey !== undefined) {
    assert.equal(
      folded.state.inDoubtActivities[0].activityKey,
      testCase.expect.inDoubtActivityKey,
      `${testCase.name} in-doubt activity identity drifted`,
    );
  }
  const checkpoint = {
    apiVersion: "graphengineering.reacher-z.github.io/cycle-controller-checkpoints/v1alpha1",
    kind: "CycleControllerCheckpoint",
    controllerRunId: durableRequest.controllerRunId,
    hostRunId: durableRequest.hostRun.runId,
    eventStreamId: durableRequest.eventStreamId,
    checkpointId: "cycle-run-1-interrupted-terminal",
    lastSequence: events.length - 1,
    historyPrefixHash: events.at(-1).recordHash,
    controllerHash: folded.controllerHash,
    requestHash: folded.requestHash,
    graphRevision: folded.graphRevision,
    createdAt: "2026-07-26T00:00:00.021Z",
    lease: folded.lease,
    payloadDisposition: "inline-unredacted",
    redacted: false,
    state: folded.state,
  };
  checkpoint.contentHash = hash(checkpoint);
  assert.equal(checkpoint.contentHash, testCase.expect.checkpointContentHash, `${testCase.name} checkpoint hash drifted`);
  assert.equal(validateCycleCheckpoint(checkpoint), true, `${testCase.name} checkpoint schema failed`);
  validateCycleCheckpointSemantics(checkpoint, events);
}

for (const testCase of cycleDurableCases.invalidCheckpointSchemaCases) {
  const checkpoint = cloneJson(durableCheckpoint);
  applyJsonMutation(checkpoint, testCase.mutation);
  assert.equal(validateCycleCheckpoint(checkpoint), false, `${testCase.name} invalid checkpoint unexpectedly conforms`);
}
for (const testCase of cycleDurableCases.invalidCheckpointSemanticCases) {
  const checkpoint = cloneJson(durableCheckpoint);
  const mutation = testCase.mutation;
  const rehash = mutation.op === "replace-and-rehash";
  applyJsonMutation(checkpoint, {
    op: mutation.op === "replace-and-rehash" ? "replace" : mutation.op,
    path: mutation.path,
    value: mutation.value,
  });
  if (rehash) {
    const { contentHash: _ignored, ...body } = checkpoint;
    checkpoint.contentHash = hash(body);
  }
  assert.throws(
    () => validateCycleCheckpointSemantics(checkpoint, durableEvents),
    (error) => error instanceof CycleHistoryError && error.code === testCase.expectCode,
    `${testCase.name} hostile checkpoint was not rejected with ${testCase.expectCode}`,
  );
}

for (const recoveryCase of cycleDurableCases.recoveryBoundaries) {
  if (Object.hasOwn(recoveryCase, "sideEffects")) {
    const outcome = recoveryCase.sideEffects === "non-idempotent"
      ? "IN_DOUBT_SIDE_EFFECT"
      : "retry-same-activity-key";
    assert.equal(outcome, recoveryCase.expect, `${recoveryCase.name} recovery boundary drifted`);
  } else {
    assert.ok(Number.isSafeInteger(recoveryCase.prefixThroughEvent));
    if (recoveryCase.expectExternalCalls === 0) {
      const prefix = durableEvents.slice(0, recoveryCase.prefixThroughEvent + 1);
      const originalFold = validateCycleHistory(prefix);
      const replayFold = validateCycleHistory(cloneJson(prefix));
      assertExactJson(
        replayFold.state.terminalObservation,
        originalFold.state.terminalObservation,
        "GE_CYCLE_INVALID_HISTORY",
        `${recoveryCase.name} changed its replayed exit observation`,
      );
      assertExactJson(
        replayFold.state.terminalResult,
        originalFold.state.terminalResult,
        "GE_CYCLE_INVALID_HISTORY",
        `${recoveryCase.name} changed its replayed terminal result`,
      );
    }
  }
}
for (const forkCase of cycleDurableCases.forkCases) {
  if (Object.hasOwn(forkCase, "parentHistoryHashFromEvent")) {
    assert.equal(
      durableEvents[forkCase.parentSequence].recordHash,
      durableEvents[forkCase.parentHistoryHashFromEvent].recordHash,
      `${forkCase.name} fork prefix binding drifted`,
    );
  } else {
    assert.equal(forkCase.expect, "IN_DOUBT_SIDE_EFFECT");
  }
}

for (const projectionCase of cycleDurableCases.inDoubtProjectionCases) {
  let pending = null;
  let observedCode = null;
  try {
    for (const transition of projectionCase.transitions) {
      assert.ok(Number.isSafeInteger(transition.attempt) && transition.attempt > 0);
      assert.ok(typeof transition.activityKey === "string" && transition.activityKey.length > 0);
      if (transition.outcome === "success") {
        if (pending?.activityKey === transition.activityKey) pending = null;
        continue;
      }
      assert.equal(transition.outcome, "failure");
      assert.equal(typeof transition.inDoubt, "boolean");
      if (!transition.inDoubt) continue;
      assert.notEqual(projectionCase.sideEffects, "none");
      if (pending !== null && pending.activityKey !== transition.activityKey) {
        const error = new Error("a second unresolved external key is invalid history");
        error.code = "GE_CYCLE_INVALID_HISTORY";
        throw error;
      }
      pending = {
        activityKey: transition.activityKey,
        attempt: transition.attempt,
      };
    }
  } catch (error) {
    observedCode = error?.code ?? null;
  }
  if (Object.hasOwn(projectionCase, "expectCode")) {
    assert.equal(observedCode, projectionCase.expectCode, `${projectionCase.name} code drifted`);
  } else {
    assert.equal(observedCode, null, `${projectionCase.name} unexpectedly rejected`);
    assert.equal(pending === null ? 0 : 1, projectionCase.expectCount, `${projectionCase.name} count drifted`);
    assert.equal(pending?.attempt ?? null, projectionCase.expectAttempt, `${projectionCase.name} attempt drifted`);
  }
}

class CycleResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CycleResolutionError";
    this.code = code;
  }
}

function rejectCycleResolution(code, message) {
  throw new CycleResolutionError(code, message);
}

const resolutionProtocol = cycleDurableCases.inDoubtResolutionProtocol;
const resolutionBase = resolutionProtocol.base;
const resolutionIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const resolutionHash = /^[0-9a-f]{64}$/u;
const resolutionCommandKeys = [
  "apiVersion", "kind", "resolutionId", "controllerRunId", "controllerHash",
  "requestHash", "eventStreamId", "expectedSequence", "expectedHistoryPrefixHash",
  "activityKey", "disposition", "evidenceHash", "authoritySnapshot",
].sort(compareUnicodeCodePoints);
const resolutionAuthorityKeys = [
  "principalHash", "grantHash", "policyHash", "leaseHolderHash",
].sort(compareUnicodeCodePoints);
const resolutionLeaseKeys = [
  "leaseId", "holderId", "leaseEpoch", "fencingToken", "acquiredAt", "expiresAt",
].sort(compareUnicodeCodePoints);

function validateResolutionCommandShape(command) {
  if (command === null || typeof command !== "object" || Array.isArray(command)) {
    rejectCycleResolution("GE_CYCLE_RESOLUTION_INVALID", "resolution command is not an object");
  }
  if (!Object.keys(command).sort(compareUnicodeCodePoints)
    .every((key, index) => key === resolutionCommandKeys[index])
      || Object.keys(command).length !== resolutionCommandKeys.length) {
    rejectCycleResolution("GE_CYCLE_RESOLUTION_INVALID", "resolution command is not closed");
  }
  if (
    command.apiVersion !== "graphengineering.reacher-z.github.io/cycle-in-doubt-resolutions/v1alpha1"
    || command.kind !== "CycleInDoubtResolution"
    || !resolutionIdentifier.test(command.resolutionId)
    || !resolutionIdentifier.test(command.controllerRunId)
    || !resolutionIdentifier.test(command.eventStreamId)
    || [command.resolutionId, command.controllerRunId, command.eventStreamId].includes(".")
    || [command.resolutionId, command.controllerRunId, command.eventStreamId].includes("..")
    || !Number.isSafeInteger(command.expectedSequence)
    || command.expectedSequence < 0
    || ![command.controllerHash, command.requestHash, command.expectedHistoryPrefixHash,
      command.activityKey, command.evidenceHash].every((value) => resolutionHash.test(value))
    || !["confirmed-applied", "confirmed-not-applied"].includes(command.disposition)
  ) rejectCycleResolution("GE_CYCLE_RESOLUTION_INVALID", "resolution command fields are invalid");
  const authority = command.authoritySnapshot;
  if (authority === null || typeof authority !== "object" || Array.isArray(authority)
      || Object.keys(authority).length !== resolutionAuthorityKeys.length
      || !Object.keys(authority).sort(compareUnicodeCodePoints)
        .every((key, index) => key === resolutionAuthorityKeys[index])
      || !resolutionAuthorityKeys.every((key) => resolutionHash.test(authority[key]))) {
    rejectCycleResolution("GE_CYCLE_RESOLUTION_INVALID", "resolution authority is invalid");
  }
}

function validateResolutionLeaseShape(lease) {
  if (lease === null || typeof lease !== "object" || Array.isArray(lease)
      || Object.keys(lease).length !== resolutionLeaseKeys.length
      || !Object.keys(lease).sort(compareUnicodeCodePoints)
        .every((key, index) => key === resolutionLeaseKeys[index])
      || !resolutionIdentifier.test(lease.leaseId)
      || !resolutionIdentifier.test(lease.holderId)
      || !Number.isSafeInteger(lease.leaseEpoch) || lease.leaseEpoch < 1
      || !Number.isSafeInteger(lease.fencingToken) || lease.fencingToken < 1) {
    rejectCycleResolution("GE_CYCLE_STALE_LEASE", "resolution lease is invalid");
  }
  const acquiredAt = Date.parse(lease.acquiredAt);
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(acquiredAt) || !Number.isFinite(expiresAt) || expiresAt <= acquiredAt) {
    rejectCycleResolution("GE_CYCLE_STALE_LEASE", "resolution lease interval is invalid");
  }
  return { acquiredAt, expiresAt };
}

assert.equal(
  hashWithDomain(resolutionProtocol.hashDomain, resolutionBase.command),
  resolutionBase.expectedCommandHash,
  "D7 terminal in-doubt resolution command hash drifted",
);

for (const testCase of resolutionProtocol.cases) {
  const candidate = cloneJson(resolutionBase);
  if (testCase.override !== undefined) Object.assign(candidate, cloneJson(testCase.override));
  if (testCase.mutation !== undefined) applyJsonMutation(candidate, testCase.mutation);
  let observedCode = null;
  let observed = null;
  try {
    validateResolutionCommandShape(candidate.command);
    const commandHash = hashWithDomain(resolutionProtocol.hashDomain, candidate.command);
    const existingHash = testCase.existing === "same-command"
      ? commandHash
      : testCase.existing === "base-command"
        ? resolutionBase.expectedCommandHash
        : null;
    if (existingHash !== null) {
      if (existingHash !== commandHash) {
        rejectCycleResolution(
          "GE_CYCLE_RESOLUTION_CONFLICT",
          "resolution ID was reused with different command bytes",
        );
      }
      observed = { accepted: true, duplicate: true, writes: 0, remainingInDoubt: 0 };
    } else {
      if (
        candidate.command.controllerRunId !== candidate.controllerRunId
        || candidate.command.controllerHash !== candidate.controllerHash
        || candidate.command.requestHash !== candidate.requestHash
        || candidate.command.eventStreamId !== candidate.eventStreamId
      ) rejectCycleResolution("GE_CYCLE_RESOLUTION_INVALID", "resolution identity drifted");
      if (!candidate.terminal) {
        rejectCycleResolution(
          "GE_CYCLE_RESOLUTION_NOT_TERMINAL",
          "resolution requires a terminal controller",
        );
      }
      if (candidate.pendingActivityKey === null
          || candidate.command.activityKey !== candidate.pendingActivityKey) {
        rejectCycleResolution(
          "GE_CYCLE_RESOLUTION_TARGET_MISMATCH",
          "resolution target is not the unresolved singleton",
        );
      }
      if (candidate.command.expectedSequence !== candidate.currentSequence
          || candidate.command.expectedHistoryPrefixHash !== candidate.currentHistoryPrefixHash) {
        rejectCycleResolution("GE_CYCLE_RESOLUTION_STALE", "resolution prefix is stale");
      }
      const interval = validateResolutionLeaseShape(candidate.lease);
      const eventTimestamp = Date.parse(candidate.eventTimestamp);
      if (candidate.lease.leaseEpoch <= candidate.maxLeaseEpoch
          || candidate.lease.fencingToken <= candidate.maxFencingToken
          || candidate.lease.leaseId === candidate.lastLeaseId
          || eventTimestamp < interval.acquiredAt || eventTimestamp >= interval.expiresAt) {
        rejectCycleResolution("GE_CYCLE_STALE_LEASE", "resolution fence is stale");
      }
      const leaseHolderHash = createHash("sha256")
        .update(candidate.lease.holderId, "utf8")
        .digest("hex");
      if (leaseHolderHash !== candidate.command.authoritySnapshot.leaseHolderHash) {
        rejectCycleResolution(
          "GE_CYCLE_RESOLUTION_AUTHORITY_MISMATCH",
          "resolution lease holder differs from the authority snapshot",
        );
      }
      observed = { accepted: true, duplicate: false, writes: 1, remainingInDoubt: 0 };
    }
  } catch (error) {
    observedCode = error?.code ?? null;
  }
  if (Object.hasOwn(testCase, "expectCode")) {
    assert.equal(observedCode, testCase.expectCode, `${testCase.name} code drifted`);
  } else {
    assert.equal(observedCode, null, `${testCase.name} unexpectedly rejected`);
    assert.deepEqual(observed, testCase.expect, `${testCase.name} projection drifted`);
  }
}

const diamond = await loadJson("diamond.graph.json");
assert.equal(diamond.apiVersion, "graphengineering.reacher-z.github.io/v1alpha1");
assert.equal(diamond.kind, "Graph");
assert.equal(new Set(diamond.nodes.map(({ id }) => id)).size, diamond.nodes.length);
assert.equal(new Set(diamond.edges.map(({ id }) => id)).size, diamond.edges.length);

process.stdout.write(
  `Validated ${fixtureNames.length} JSON fixtures (${caseNames.length} case manifests), ${yamlNames.length} referenced YAML fixtures, ${Object.keys(expected.canonicalization).length} graph hash, ${Object.keys(expected.checkpoints ?? {}).length} checkpoint hash, ${durableJson.validCases.length} Durable JSON vectors, ${compiledIdentities.length} compiled identities, ${graphPatchCases.validCases.length + graphPatchCases.invalidCases.length} graph patch schema cases plus ${graphPatchCases.semanticCases.length} closed semantic vectors, ${hostileShapeCases.length} hostile GraphPatch shape attacks, ${hostileSemanticCases.length} schema-valid hostile GraphPatch semantic/behavior cases, ${hostileRestoreCases.length} hostile GraphPatch replay/restore cases, and 7 D7 controller/revision/event/checkpoint/lineage schemas with ${durableEvents.length} chained event goldens, ${cycleLineageCases.cases.length} lineage replay/corruption cases, ${cycleFaultMatrix.length} retained durable fault obligations, ${cycleInterruptionMatrix.length} activity interruption obligations, ${cycleOperationInterruptionMatrix.length} public-operation interruption obligations, ${cyclePatchVisibilityMatrix.length} patch-visibility fault obligations, ${cyclePatchCheckpointMatrix.length} patch-checkpoint fault obligations, ${cycleDurableCases.leaseTransitionCases.length} valid and ${cycleDurableCases.invalidLeaseTransitionCases.length} hostile lease transitions, ${cycleDurableCases.validInterruptedHistoryCases?.length ?? 0} interrupted terminal/checkpoint folds, ${cycleDurableCases.inDoubtProjectionCases.length} in-doubt singleton cases, ${resolutionProtocol.cases.length} terminal in-doubt resolution cases, ${cycleDurableCases.untilDryFoldCases.length} global-seen convergence fold, ${cycleDurableCases.hardStopFoldCases.length} hard-stop folds, ${cycleDurableCases.invalidEventHistoryCases.length} hostile histories, ${cycleDurableCases.invalidCheckpointSemanticCases.length} hostile checkpoint folds, plus ${cycleDurableCases.validStandaloneEventSchemaCases.length} standalone phase-event shapes; all ${expectedD7Tests.length} D7-CYCLE-SPEC-024 expected-test groups are mapped against meta-valid schemas.\n`,
);
