import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const STARTED_AT = "2026-07-26T00:00:00Z";
const DEADLINE_AT = "2026-07-26T00:00:01Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Utf8(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function categoryCounts(cases) {
  const counts = {};
  for (const item of cases) counts[item.category] = (counts[item.category] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

function request(runtime, template, suffix, lineage) {
  return runtime.validateCycleControllerRequest({
    ...clone(template),
    controllerRunId: `lineage-${suffix}`,
    controllerId: `lineage-controller-${suffix}`,
    hostRun: {
      relationship: "standalone-child-controller",
      runId: "lineage-host",
    },
    eventStreamId: `lineage-${suffix}.events`,
    checkpointScope: `lineage-${suffix}.checkpoints`,
    lineage,
  });
}

function created(runtime, item, eventId) {
  const requestHash = runtime.cycleRequestHash(item);
  const controllerHash = runtime.cycleControllerHash(item);
  return runtime.createCycleControllerEvent({
    request: item,
    controllerHash,
    requestHash,
    type: "ControllerCreated",
    data: {
      request: item,
      requestHash,
      identity: runtime.cycleControllerIdentity(item),
      controllerHash,
      startedAt: STARTED_AT,
      deadlineAt: DEADLINE_AT,
    },
    graphRevision: item.initialGraph.graphRevision,
    sequence: 0,
    previousEventHash: null,
    lease: null,
    timestamp: STARTED_AT,
    eventId,
  });
}

function acquired(runtime, item, previous) {
  return runtime.createCycleControllerEvent({
    request: item,
    controllerHash: runtime.cycleControllerHash(item),
    requestHash: runtime.cycleRequestHash(item),
    type: "LeaseAcquired",
    data: { reason: "start", previousLeaseId: null },
    graphRevision: item.initialGraph.graphRevision,
    sequence: 1,
    previousEventHash: previous.recordHash,
    lease: {
      leaseId: "lineage-root-lease",
      holderId: "lineage-holder",
      leaseEpoch: 1,
      fencingToken: 1,
      acquiredAt: STARTED_AT,
      expiresAt: "2026-07-26T00:01:00Z",
    },
    timestamp: STARTED_AT,
    eventId: "lineage-root-1",
  });
}

async function seeds(runtime, fixture) {
  const template = fixture.requestDocument;
  const store = new runtime.MemoryCycleControllerEventStore();
  const root = request(runtime, template, "root", { origin: "start" });
  const rootCreated = created(runtime, root, "lineage-root-0");
  const rootLease = acquired(runtime, root, rootCreated);
  await store.append(root.eventStreamId, -1, [rootCreated, rootLease]);

  const child = request(runtime, template, "child", {
    origin: "fork",
    parentControllerRunId: root.controllerRunId,
    parentSequence: 1,
    parentHistoryHash: rootLease.recordHash,
  });
  const childCreated = created(runtime, child, "lineage-child-0");
  await store.append(child.eventStreamId, -1, [childCreated]);

  const grandchild = request(runtime, template, "grandchild", {
    origin: "fork",
    parentControllerRunId: child.controllerRunId,
    parentSequence: 0,
    parentHistoryHash: childCreated.recordHash,
  });
  await store.append(grandchild.eventStreamId, -1, [
    created(runtime, grandchild, "lineage-grandchild-0"),
  ]);

  const sibling = request(runtime, template, "sibling", {
    origin: "fork",
    parentControllerRunId: root.controllerRunId,
    parentSequence: 1,
    parentHistoryHash: rootLease.recordHash,
  });
  await store.append(sibling.eventStreamId, -1, [created(runtime, sibling, "lineage-sibling-0")]);

  const early = request(runtime, template, "early", {
    origin: "fork",
    parentControllerRunId: root.controllerRunId,
    parentSequence: 0,
    parentHistoryHash: rootCreated.recordHash,
  });
  await store.append(early.eventStreamId, -1, [created(runtime, early, "lineage-early-0")]);

  return {
    grandchild: await runtime.exportCycleControllerLineageManifest(store, grandchild.eventStreamId),
    sibling: await runtime.exportCycleControllerLineageManifest(store, sibling.eventStreamId),
    early: await runtime.exportCycleControllerLineageManifest(store, early.eventStreamId),
  };
}

function reseal(runtime, value) {
  const body = { ...value };
  delete body.manifestHash;
  value.manifestHash = runtime.hashWithDomain(runtime.CYCLE_LINEAGE_MANIFEST_DOMAIN, body);
}

function mutate(runtime, source, scenario) {
  const value = clone(source);
  let resealAfter = true;
  if (scenario === "extra-field") value.unexpected = true;
  else if (scenario === "api-version") value.apiVersion = "invalid";
  else if (scenario === "limit-substitution") value.limits.maxDepth -= 1;
  else if (scenario === "manifest-hash-drift") {
    value.eventCount += 1;
    resealAfter = false;
  } else if (scenario === "missing-root") {
    const removed = value.streams.shift();
    value.eventCount -= removed.events.length;
  } else if (scenario === "duplicate-root") {
    const duplicate = clone(value.streams[0]);
    value.streams.splice(1, 0, duplicate);
    value.eventCount += duplicate.events.length;
  } else if (scenario === "cycle-run-id") {
    value.streams[1].controllerRunId = value.streams[0].controllerRunId;
  } else if (scenario === "reordered-streams") {
    [value.streams[0], value.streams[1]] = [value.streams[1], value.streams[0]];
  } else if (scenario === "parent-binding") {
    value.streams[1].parent.requestHash = "f".repeat(64);
  } else if (scenario === "parent-event-byte") {
    value.streams[0].events[0].timestamp = "2026-07-26T00:00:01Z";
  } else if (scenario === "truncated-prefix") {
    value.streams[0].events.pop();
    value.eventCount -= 1;
  } else if (scenario === "target-binding") value.target.controllerHash = "e".repeat(64);
  else if (scenario === "event-count") value.eventCount += 1;
  else if (scenario === "record-prefix-disagreement") {
    value.streams[0].historyPrefixHash = "d".repeat(64);
  } else if (scenario === "stream-binding") {
    value.streams[1].eventStreamId = "substituted.events";
  } else if (scenario === "stream-overflow") {
    while (value.streams.length <= 33) {
      const duplicate = clone(value.streams.at(-1));
      value.streams.push(duplicate);
      value.eventCount += duplicate.events.length;
    }
  } else throw new TypeError(`unknown lineage attack scenario ${String(scenario)}`);
  if (resealAfter) reseal(runtime, value);
  return value;
}

function errorCode(error) {
  if (error !== null && typeof error === "object" && typeof error.code === "string") {
    return error.code;
  }
  throw error;
}

export async function exerciseCycleControllerLineageCampaign({ runtime, core, fixture }) {
  const manifests = await seeds(runtime, fixture);
  const caseResults = [];
  for (const item of fixture.cases) {
    if (item.expectOutcome === "replayed") {
      if (item.scenario === "grandchild-replay") {
        const replay = runtime.replayCycleControllerLineageManifest(manifests.grandchild);
        caseResults.push({
          id: item.id,
          outcome: "replayed",
          streamCount: replay.folds.length,
          targetRunId: replay.target.request.controllerRunId,
          targetSequence: replay.target.lastSequence,
        });
      } else if (item.scenario === "sibling-isolation") {
        assert.equal(
          JSON.stringify(manifests.grandchild.streams[0]),
          JSON.stringify(manifests.sibling.streams[0]),
        );
        assert.notEqual(manifests.grandchild.target.controllerRunId, manifests.sibling.target.controllerRunId);
        caseResults.push({ id: item.id, outcome: "replayed", sharedPrefix: true, isolatedTarget: true });
      } else if (item.scenario === "distinct-parent-prefix") {
        assert.equal(manifests.early.streams[0].throughSequence, 0);
        assert.equal(manifests.grandchild.streams[0].throughSequence, 1);
        caseResults.push({ id: item.id, outcome: "replayed", earlySequence: 0, fullSequence: 1 });
      } else if (item.scenario === "deterministic-revalidation") {
        const one = runtime.validateCycleControllerLineageManifest(manifests.grandchild);
        const two = runtime.validateCycleControllerLineageManifest(clone(one));
        assert.equal(JSON.stringify(one), JSON.stringify(two));
        caseResults.push({ id: item.id, outcome: "replayed", stable: true });
      } else throw new TypeError(`unknown lineage behavior scenario ${String(item.scenario)}`);
      continue;
    }
    let code = null;
    try {
      runtime.replayCycleControllerLineageManifest(mutate(runtime, manifests.grandchild, item.scenario));
    } catch (error) {
      code = errorCode(error);
    }
    assert.equal(code, item.expectCode, `${item.id}: unexpected lineage rejection code`);
    caseResults.push({ id: item.id, outcome: "rejected", code });
  }

  const canonical = core.canonicalSerialize(manifests.grandchild);
  const attacks = fixture.cases.filter(({ expectOutcome }) => expectOutcome === "rejected");
  const behaviors = fixture.cases.filter(({ expectOutcome }) => expectOutcome === "replayed");
  assert.equal(fixture.cases.length, fixture.expect.caseCount);
  assert.equal(attacks.length, fixture.expect.attackCaseCount);
  assert.equal(behaviors.length, fixture.expect.behaviorCaseCount);
  assert.deepEqual(categoryCounts(fixture.cases), fixture.expect.categoryCounts);
  return {
    campaign: fixture.id,
    caseCount: fixture.cases.length,
    attackCaseCount: attacks.length,
    behaviorCaseCount: behaviors.length,
    categoryCounts: categoryCounts(fixture.cases),
    manifestCanonical: canonical,
    manifestCanonicalUtf8Bytes: Buffer.byteLength(canonical, "utf8"),
    manifestSha256: sha256Utf8(canonical),
    manifestHash: manifests.grandchild.manifestHash,
    streamCount: manifests.grandchild.streams.length,
    eventCount: manifests.grandchild.eventCount,
    caseResults,
  };
}
