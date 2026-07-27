import assert from "node:assert/strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pointerTokens(path) {
  assert.equal(typeof path, "string");
  assert.match(path, /^\//u);
  return path.slice(1).split("/").map((token) => (
    token.replaceAll("~1", "/").replaceAll("~0", "~")
  ));
}

function parentAt(document, path) {
  const tokens = pointerTokens(path);
  assert.ok(tokens.length > 0);
  let parent = document;
  for (const token of tokens.slice(0, -1)) {
    assert.notEqual(parent, null);
    assert.equal(typeof parent, "object");
    parent = parent[token];
  }
  return { parent, token: tokens.at(-1) };
}

function nestedObject(key, depth) {
  assert.equal(typeof key, "string");
  assert.ok(key.length > 0);
  assert.ok(Number.isSafeInteger(depth) && depth > 0);
  let value = "leaf";
  for (let index = 0; index < depth; index += 1) value = { [key]: value };
  return value;
}

export function materializeGraphPatchHostileShape(seedDocument, mutation) {
  if (mutation.op === "replace-root") return clone(mutation.value);

  const document = clone(seedDocument);
  const { parent, token } = parentAt(document, mutation.path);
  assert.notEqual(parent, null);
  assert.equal(typeof parent, "object");
  if (mutation.op === "remove") {
    assert.ok(Object.hasOwn(parent, token));
    delete parent[token];
  } else if (mutation.op === "add" || mutation.op === "replace") {
    parent[token] = clone(mutation.value);
  } else if (mutation.op === "repeat-string") {
    assert.equal(typeof mutation.character, "string");
    assert.equal([...mutation.character].length, 1);
    assert.ok(Number.isSafeInteger(mutation.length) && mutation.length >= 0);
    parent[token] = mutation.character.repeat(mutation.length);
  } else if (mutation.op === "nest-object") {
    parent[token] = nestedObject(mutation.key, mutation.depth);
  } else {
    assert.fail(`unsupported hostile GraphPatch mutation ${String(mutation.op)}`);
  }
  return document;
}

function categoryCounts(cases) {
  const counts = {};
  for (const attack of cases) counts[attack.category] = (counts[attack.category] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

function authority() {
  return {
    proposerActivityKey: "1".repeat(64),
    principalHash: "2".repeat(64),
    proposerGrantHash: "3".repeat(64),
    runGrantHash: "4".repeat(64),
    tenantGrantHash: "5".repeat(64),
    deploymentGrantHash: "6".repeat(64),
    effectiveGrantHash: "7".repeat(64),
    policyHash: "8".repeat(64),
    approvalHash: null,
  };
}

function context() {
  return {
    authoritySnapshot: authority(),
    policySnapshotHash: "8".repeat(64),
    reservationId: "hostile-shape-reservation",
    reserved: { attempts: 1, costUsd: 0, dynamicNodes: 10 },
    activityUsage: { attempts: 1, costUsd: 0 },
    durationMs: 0,
    deadlineMsRemaining: 100,
    effectiveCapabilities: [],
    succeededNodeIds: ["merge"],
    supportedEdgeModes: ["value"],
  };
}

function errorCode(error) {
  if (error !== null && typeof error === "object" && typeof error.code === "string") {
    return error.code;
  }
  throw error;
}

export async function exerciseGraphPatchHostileShapeCampaign({
  runtime,
  core,
  graph,
  fixture,
}) {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.id, "graph-patch-hostile-shape-v1alpha1");
  assert.equal(fixture.cases.length, fixture.expect.caseCount);
  assert.equal(new Set(fixture.cases.map(({ id }) => id)).size, fixture.cases.length);
  assert.deepEqual(categoryCounts(fixture.cases), fixture.expect.categoryCounts);
  assert.equal(
    fixture.cases.filter(({ layer }) => layer === "schema").length,
    fixture.expect.schemaCaseCount,
  );
  assert.equal(
    fixture.cases.filter(({ layer }) => layer === "runtime-capture").length,
    fixture.expect.runtimeCaptureCaseCount,
  );
  const corpusCanonical = core.canonicalSerialize(fixture.cases);
  assert.equal(Buffer.byteLength(corpusCanonical, "utf8"), fixture.expect.casesCanonicalUtf8Bytes);
  assert.equal(core.canonicalHash(fixture.cases), fixture.expect.casesSha256);

  const compilation = core.compileGraph(graph);
  assert.equal(compilation.valid, true);
  assert.equal(compilation.graphHash, fixture.seedDocument.base.graphHash);
  const seed = runtime.validateGraphPatchShape(fixture.seedDocument);
  const seedCanonical = core.canonicalSerialize(seed);
  const seedPatchHash = core.canonicalHash(seed);
  const coordinate = {
    graphRevision: 1,
    graphHash: compilation.graphHash,
    revisionHash: "1".repeat(64),
  };
  const options = {
    limits: {
      maxNodes: 100,
      maxEdges: 200,
      maxOutputs: 100,
      maxDepth: 20,
      maxFanOut: 20,
    },
    maxDynamicNodes: 10,
  };

  const outcomes = [];
  for (const [index, attack] of fixture.cases.entries()) {
    const document = materializeGraphPatchHostileShape(seed, attack.mutation);
    const inputCanonical = core.canonicalSerialize(document);
    const applier = new runtime.NativeGraphPatchApplier(graph, coordinate, options);
    const beforeCoordinate = core.canonicalSerialize(applier.coordinate);
    let observedCode = null;
    try {
      applier.prepare(document, context());
    } catch (error) {
      observedCode = errorCode(error);
    }
    assert.equal(observedCode, attack.expectCode, `${attack.id}: unexpected TypeScript error`);
    assert.equal(core.canonicalSerialize(document), inputCanonical, `${attack.id}: caller input mutated`);
    assert.equal(core.canonicalSerialize(applier.coordinate), beforeCoordinate);
    assert.equal(applier.dynamicNodes, 0);
    assert.equal(applier.decided("hostile-seed"), undefined);
    outcomes.push({
      index,
      id: attack.id,
      category: attack.category,
      layer: attack.layer,
      inputCanonicalUtf8Bytes: Buffer.byteLength(inputCanonical, "utf8"),
      inputSha256: core.canonicalHash(document),
      errorCode: observedCode,
      coordinateUnchanged: true,
      dynamicNodes: 0,
      decisionRecorded: false,
      callerUnchanged: true,
    });
  }

  return {
    campaignId: fixture.id,
    attackCount: outcomes.length,
    categoryCounts: categoryCounts(fixture.cases),
    corpusCanonicalUtf8Bytes: Buffer.byteLength(corpusCanonical, "utf8"),
    corpusSha256: core.canonicalHash(fixture.cases),
    seedCanonicalUtf8Bytes: Buffer.byteLength(seedCanonical, "utf8"),
    seedPatchHash,
    requiredAssertions: fixture.requiredAssertions,
    outcomes,
  };
}
