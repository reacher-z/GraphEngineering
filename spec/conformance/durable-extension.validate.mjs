// Offline contract oracle for durable-extension/v1alpha1 (D9-DURABLE-EXT-SPEC-031).
//
// This module is a specification oracle, not a runtime. It recomputes every
// literal the corpus stores — canonical bytes, domain-separated hashes, frame
// chains, activity keys, fold projections, lineage identities and descriptor
// identities — so a single wrong byte in the corpus fails the campaign.
//
// Falsifiability is a first-class feature rather than a claim. Every rejection
// is raised through `fail(ruleId, code, message)` and every ruleId can be
// neutralized from the environment, so the "delete the rule and require the
// corpus to fail" criterion is mechanically reproducible:
//
//   node spec/conformance/durable-extension.validate.mjs            # campaign
//   GE_DX_MEASURE=1 node spec/conformance/durable-extension.validate.mjs
//   GE_DX_NEUTRALIZE=DX-L-021 node spec/conformance/durable-extension.validate.mjs
//
// The measurement mode neutralizes each rule in turn and reports how many the
// shipped corpus holds. See durable-extension-semantics.md section 14.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const conformanceRoot = dirname(fileURLToPath(import.meta.url));
const specRoot = dirname(conformanceRoot);
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const SCHEMA_FILES = Object.freeze([
  "lease.schema.json",
  "replay-plan.schema.json",
  "fork-lineage.schema.json",
  "artifact-store-descriptor.schema.json",
  "checkpoint-acceleration.schema.json",
]);

const CONTRACT_VERSION = "durable-extension/v1alpha1";
const API_VERSION = "graphengineering.reacher-z.github.io/durable-extension/v1alpha1";

// Contract ceilings. Mirrored in durable-extension-semantics.md section 12.
const MAX_LEASE_TTL_MS = 86400000;
const MAX_INLINE_PAYLOAD_BYTES = 1048576;
const MAX_PAGE_SIZE = 256;
const MAX_KEY_LENGTH = 128;

// The complete rejection inventory this oracle implements. The campaign asserts
// that this list and the corpus vector set are equal in both directions, so a
// rule without an isolating vector fails the run rather than passing silently.
const RULE_IDS = Object.freeze([
  ...range("DX-H", 29),
  ...range("DX-L", 31),
  ...range("DX-N", 7),
  ...range("DX-R", 12),
  ...range("DX-F", 23),
  ...range("DX-C", 17),
  ...range("DX-A", 15),
]);

function range(prefix, count) {
  const out = [];
  for (let index = 1; index <= count; index += 1) out.push(`${prefix}-${String(index).padStart(3, "0")}`);
  return out;
}

// ------------------------------------------------------------------ canonical
function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const common = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < common; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort(compareCodePoints)) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

const canonicalJson = (value) => JSON.stringify(canonicalize(value));
const canonicalBytes = (value) => Buffer.byteLength(canonicalJson(value), "utf8");
const domainHash = (domain, value) =>
  createHash("sha256").update(domain, "utf8").update(canonicalJson(value), "utf8").digest("hex");
const clone = (value) => structuredClone(value);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);

function pointerSegments(pointer) {
  if (pointer === "") return [];
  assert.ok(pointer.startsWith("/"), `JSON Pointer must be empty or start with '/': ${pointer}`);
  return pointer.slice(1).split("/").map((segment) => {
    if (/~(?![01])/u.test(segment)) throw new Error(`invalid JSON Pointer escape: ${pointer}`);
    return segment.replaceAll("~1", "/").replaceAll("~0", "~");
  });
}

function applyMutations(document, mutations) {
  for (const mutation of mutations ?? []) {
    const segments = pointerSegments(mutation.pointer);
    assert.ok(segments.length > 0, `root mutation is not supported: ${mutation.pointer}`);
    const leaf = segments.pop();
    let parent = document;
    for (const segment of segments) {
      assert.ok(parent !== null && typeof parent === "object", `mutation parent missing: ${mutation.pointer}`);
      parent = parent[segment];
    }
    assert.ok(parent !== null && typeof parent === "object", `mutation parent missing: ${mutation.pointer}`);
    if (mutation.delete === true) delete parent[leaf];
    else parent[leaf] = clone(mutation.value);
  }
  return document;
}

// ------------------------------------------------------------------- failures
class DxError extends Error {
  constructor(ruleId, code, message) {
    super(message);
    this.name = "DxError";
    this.ruleId = ruleId;
    this.code = code;
  }
}

// ---------------------------------------------------------------- the campaign
const fixture = JSON.parse(await readFile(join(conformanceRoot, "durable-extension.case.json"), "utf8"));
const schemaSources = new Map();
for (const file of SCHEMA_FILES) {
  schemaSources.set(file, JSON.parse(await readFile(join(specRoot, file), "utf8")));
}

export function validateDurableExtensionFixture(options = {}) {
  const neutralized = new Set(options.neutralized ?? []);
  const firedRules = new Set();
  const D = fixture.domains;

  function fail(ruleId, code, message) {
    assert.ok(RULE_IDS.includes(ruleId), `undeclared rule id ${ruleId}`);
    if (neutralized.has(ruleId)) return;
    firedRules.add(ruleId);
    throw new DxError(ruleId, code, message);
  }

  // ---------------------------------------------------------------- schemas
  const ajv = new Ajv2020({ strict: true, allErrors: false, allowUnionTypes: true });
  const validators = new Map();
  for (const schema of schemaSources.values()) ajv.addSchema(schema, schema.$id);
  for (const [file, schema] of schemaSources) validators.set(file, ajv.getSchema(schema.$id));
  const frameValidator = ajv.getSchema(
    `${schemaSources.get("checkpoint-acceleration.schema.json").$id}#/$defs/authorityFrame`,
  );
  const projectionValidator = ajv.getSchema(
    `${schemaSources.get("checkpoint-acceleration.schema.json").$id}#/$defs/projection`,
  );
  assert.ok(frameValidator && projectionValidator, "authorityFrame and projection definitions must compile");

  function schemaValidate(reference, document) {
    const validator = reference.includes("#")
      ? ajv.getSchema(`${schemaSources.get(reference.split("#")[0]).$id}#${reference.split("#")[1]}`)
      : validators.get(reference);
    assert.ok(validator, `unknown schema reference ${reference}`);
    return { ok: validator(document) === true, errors: validator.errors };
  }

  // -------------------------------------------------- independent recomputes
  const identity = {
    graph: domainHash(D.value, fixture.sources.graph),
    plan: domainHash(D.value, fixture.sources.plan),
    parentInput: domainHash(D.value, fixture.sources.parentInput),
    childInput: domainHash(D.value, fixture.sources.childInput),
    implementation: domainHash(D.value, fixture.sources.implementationId),
    policy: domainHash(D.value, fixture.sources.policy),
    authority: domainHash(D.value, fixture.sources.authority),
  };
  assert.deepEqual(fixture.identityHashes, identity, "stored identity hashes are not reproducible");
  assert.equal(
    fixture.routePolicyHash,
    domainHash(D.value, fixture.routePolicySource),
    "stored route policy hash is not reproducible",
  );

  const policyBody = { ...fixture.leasePolicy };
  delete policyBody.policyHash;
  assert.equal(
    fixture.leasePolicy.policyHash,
    domainHash(D.leasePolicy, policyBody),
    "stored lease policy hash is not reproducible",
  );

  const storeById = new Map(fixture.stores.map((store) => [store.providerId, store]));
  const artifactById = new Map(fixture.artifacts.map((artifact) => [artifact.artifactId, artifact]));

  function recomputeLeaseHash(leaseDocument) {
    const body = { ...leaseDocument };
    delete body.leaseHash;
    return domainHash(D.lease, body);
  }
  function recomputeStoreHash(descriptor) {
    const body = { ...descriptor };
    delete body.descriptorHash;
    return domainHash(D.artifactStore, body);
  }
  function recomputeFrameHash(frame) {
    const body = { ...frame };
    delete body.frameHash;
    delete body.historyHash;
    return domainHash(D.frame, body);
  }
  function recomputeActivityKey(runId, nodeId, inputHash, graphRevision) {
    return domainHash(D.activity, ["activity/v1alpha1", runId, graphRevision, nodeId, inputHash]);
  }
  function recomputeLineageHash(lineage) {
    const body = { ...lineage };
    delete body.lineageHash;
    return domainHash(D.forkLineage, body);
  }
  function rootLineageHashOf(runId) {
    return domainHash(D.forkLineage, { root: runId });
  }
  function recomputeCheckpointParts(document) {
    const body = { ...document };
    delete body.byteCount;
    delete body.contentHash;
    const byteCount = canonicalBytes(body);
    const withoutContent = { ...document };
    delete withoutContent.contentHash;
    return { byteCount, contentHash: domainHash(D.checkpoint, withoutContent) };
  }
  function recomputeReplayPlanHash(plan) {
    const body = { ...plan };
    delete body.planHash;
    return domainHash(D.replayPlan, body);
  }

  // ------------------------------------------------------------ frame sealing
  function sealFrames(frames, mode) {
    if (mode === false || mode === undefined) return frames;
    let previousFrameHash = null;
    let previousHistoryHash = null;
    frames.forEach((frame, index) => {
      if (mode === "full") {
        frame.sequence = index;
        frame.payloadHash = domainHash(D.payload, frame.payload);
        frame.payloadBytes = canonicalBytes(frame.payload);
        frame.decisionHash = domainHash(D.decision, [frame.runId, frame.sequence, frame.type, frame.payloadHash]);
      }
      frame.previousFrameHash = previousFrameHash;
      frame.frameHash = recomputeFrameHash(frame);
      frame.historyHash = domainHash(D.history, [previousHistoryHash, frame.frameHash]);
      previousFrameHash = frame.frameHash;
      previousHistoryHash = frame.historyHash;
    });
    return frames;
  }

  function stepToFrame(step, runId, streamId, sequence) {
    const payload = step.payload ?? {};
    return {
      apiVersion: API_VERSION,
      kind: "AuthorityFrame",
      runId,
      eventStreamId: streamId,
      sequence,
      eventId: step.eventId ?? `${runId}-x${String(sequence).padStart(3, "0")}`,
      type: step.type,
      provenance: step.provenance ?? "new",
      parentSequence: step.parentSequence ?? null,
      nodeId: step.nodeId ?? null,
      attempt: step.attempt ?? null,
      fence: step.fence,
      holderId: step.holderId ?? null,
      payload,
      payloadBytes: canonicalBytes(payload),
      payloadHash: domainHash(D.payload, payload),
      artifactRef: step.artifactRef ?? null,
      decisionHash: "0".repeat(64),
      previousFrameHash: null,
      frameHash: "0".repeat(64),
      historyHash: "0".repeat(64),
    };
  }

  // -------------------------------------------------------------------- fold
  const EDGES = fixture.sources.graph.edges;
  const inboundEdges = new Map();
  for (const [, consumer, edgeId] of EDGES) {
    if (!inboundEdges.has(consumer)) inboundEdges.set(consumer, []);
    inboundEdges.get(consumer).push(edgeId);
  }
  const LIFECYCLE_REQUIRES_START = new Set([
    "NodeScheduled", "NodeStarted", "NodeSucceeded", "NodeAttemptFailed", "NodeRetried",
    "NodeSettledWithoutAttempt", "EdgeEmitted", "ArtifactCreated", "RouteSelected",
    "BudgetUpdated", "CheckpointRecorded", "ResumeConfirmed",
  ]);
  const TERMINALS = new Set(["RunSucceeded", "RunFailed", "RunCancelled"]);
  const LEASE_FRAMES = new Set([
    "LeaseAcquired", "LeaseRenewed", "LeaseTakenOver", "LeaseReleased", "LeaseLost",
  ]);
  const LEASE_PAYLOAD_KEYS = Object.freeze({
    LeaseAcquired: ["mode", "requestedTtlMs", "providerNowMs", "observedClockMs", "lease"],
    LeaseRenewed: ["mode", "requestedTtlMs", "providerNowMs", "observedClockMs", "lease"],
    LeaseTakenOver: ["mode", "requestedTtlMs", "expectedFence", "providerNowMs", "observedClockMs", "lease"],
    LeaseReleased: ["mode", "leaseId", "fence", "epoch", "providerNowMs", "observedClockMs"],
    LeaseLost: ["leaseId", "fence", "epoch", "reason"],
  });

  function foldHistory(frames, options = {}) {
    const policy = fixture.leasePolicy;
    const observedLeaseStates = options.observedLeaseStates ?? new Set();
    const runId = frames.length > 0 ? frames[0].runId : null;
    const streamId = frames.length > 0 ? frames[0].eventStreamId : null;
    let store = null;
    let graphRevision = 1;
    let maxTotalAttempts = 1;
    let started = false;
    let terminal = null;
    let recordedUnits = 0;
    const eventIds = new Set();
    const succeeded = [];
    const outputHashes = {};
    const perNode = {};
    const settled = [];
    const edges = [];
    const artifactFacts = [];
    const routes = [];
    const approvals = [];
    const seen = [];
    const scheduledNodes = new Set();
    const failedNodes = new Set();
    const settledAttempts = new Set();
    const reservations = new Map();
    const activityKeys = new Map();
    const open = new Map();
    const confirmations = new Map();
    const usedLeaseIds = new Set();
    const lostOwners = new Set();
    let locks = options.seedLocks ? clone(options.seedLocks) : {
      activeLeaseId: null, activeOwnerId: null, activeFence: null, activeEpoch: null,
      lastFence: 0, lastEpoch: 0, state: "none", retiredLeaseIds: [],
    };
    let previousFrameHash = null;
    let previousHistoryHash = null;
    let ownershipBegun = false;

    frames.forEach((frame, index) => {
      // -- structural integrity ---------------------------------------------
      if (frame.apiVersion !== API_VERSION || frame.kind !== "AuthorityFrame") {
        fail("DX-H-001", "GE_DX_INVALID_ARGUMENT", `frame ${index} is not a durable-extension authority frame`);
      }
      if (frame.sequence !== index) {
        fail("DX-H-002", "GE_DX_HISTORY_CORRUPT", `frame ${index} sequence is not contiguous from zero`);
      }
      if (frame.previousFrameHash !== previousFrameHash) {
        fail("DX-H-003", "GE_DX_HISTORY_CORRUPT", `frame ${index} breaks the previousFrameHash chain`);
      }
      if (frame.frameHash !== recomputeFrameHash(frame)) {
        fail("DX-H-004", "GE_DX_HISTORY_CORRUPT", `frame ${index} frameHash is not reproducible`);
      }
      if (frame.historyHash !== domainHash(D.history, [previousHistoryHash, frame.frameHash])) {
        fail("DX-H-005", "GE_DX_HISTORY_CORRUPT", `frame ${index} historyHash is not reproducible`);
      }
      if (frame.payloadHash !== domainHash(D.payload, frame.payload)) {
        fail("DX-H-006", "GE_DX_HISTORY_CORRUPT", `frame ${index} payloadHash is not reproducible`);
      }
      if (frame.payloadBytes !== canonicalBytes(frame.payload)) {
        fail("DX-H-007", "GE_DX_HISTORY_CORRUPT", `frame ${index} payloadBytes is not reproducible`);
      }
      if (frame.decisionHash !== domainHash(D.decision, [frame.runId, frame.sequence, frame.type, frame.payloadHash])) {
        fail("DX-H-008", "GE_DX_HISTORY_CORRUPT", `frame ${index} decisionHash is not reproducible`);
      }
      previousFrameHash = frame.frameHash;
      previousHistoryHash = frame.historyHash;

      if (frame.runId !== runId) {
        fail("DX-H-009", "GE_DX_HISTORY_INVALID", `frame ${index} belongs to a different run`);
      }
      if (frame.eventStreamId !== streamId) {
        fail("DX-H-029", "GE_DX_HISTORY_INVALID", `frame ${index} belongs to a different event stream`);
      }
      if (eventIds.has(frame.eventId)) {
        fail("DX-H-010", "GE_DX_HISTORY_INVALID", `frame ${index} reuses event id ${frame.eventId}`);
      }
      eventIds.add(frame.eventId);
      seen.push(frame.eventId);

      if (frame.provenance === "inherited" && frame.parentSequence === null) {
        fail("DX-H-027", "GE_DX_INVALID_ARGUMENT", `frame ${index} is inherited without a parent sequence`);
      }
      if (frame.provenance === "new" && frame.parentSequence !== null) {
        fail("DX-H-028", "GE_DX_INVALID_ARGUMENT", `frame ${index} is new work but names a parent sequence`);
      }

      if (index === 0 && frame.type !== "RunCreated") {
        fail("DX-H-011", "GE_DX_HISTORY_INVALID", "sequence zero must be RunCreated");
      }
      if (index !== 0 && frame.type === "RunCreated") {
        fail("DX-H-012", "GE_DX_HISTORY_INVALID", `frame ${index} repeats RunCreated`);
      }
      if (terminal !== null) {
        fail("DX-H-013", "GE_DX_HISTORY_INVALID", `frame ${index} follows terminal ${terminal}`);
      }
      if (!started && LIFECYCLE_REQUIRES_START.has(frame.type)) {
        fail("DX-H-014", "GE_DX_HISTORY_INVALID", `frame ${index} precedes RunStarted`);
      }

      // -- authority ---------------------------------------------------------
      const isAcquisition = frame.type === "LeaseAcquired" || frame.type === "LeaseTakenOver";
      if (!ownershipBegun) {
        if (!isAcquisition && (frame.fence !== 0 || frame.holderId !== null)) {
          fail("DX-L-029", "GE_DX_STALE_FENCE", `frame ${index} claims a fence before ownership begins`);
        }
      } else {
        if (frame.holderId !== null && lostOwners.has(frame.holderId)) {
          fail("DX-L-023", "GE_DX_DUAL_RESUME_LOSER", `frame ${index} was committed by a lost holder`);
        }
        if (!isAcquisition) {
          const activeFence = locks.activeFence ?? locks.lastFence;
          if (frame.fence < activeFence) {
            fail("DX-L-021", "GE_DX_STALE_FENCE", `frame ${index} commits below the active fence`);
          }
          if (locks.activeOwnerId !== null && frame.holderId !== locks.activeOwnerId) {
            fail("DX-L-022", "GE_DX_STALE_FENCE", `frame ${index} was committed by a non-owning holder`);
          }
        }
      }

      // -- payload bound -----------------------------------------------------
      if (store !== null && frame.artifactRef === null
          && frame.payloadBytes > store.limits.maxInlinePayloadBytes) {
        fail("DX-H-023", "GE_DX_INVALID_ARGUMENT", `frame ${index} carries an oversized inline payload without artifact indirection`);
      }

      const payload = frame.payload;
      if (LEASE_FRAMES.has(frame.type)) {
        const expectedKeys = [...LEASE_PAYLOAD_KEYS[frame.type]].sort(compareCodePoints);
        const actualKeys = Object.keys(payload).sort(compareCodePoints);
        if (!same(actualKeys, expectedKeys)) {
          fail("DX-L-027", "GE_DX_INVALID_ARGUMENT", `frame ${index} lease payload is not the closed key set`);
        }
      }

      switch (frame.type) {
        case "RunCreated": {
          graphRevision = payload.graphRevision;
          maxTotalAttempts = payload.maxTotalAttempts;
          store = storeById.get(payload.storeProviderId) ?? null;
          assert.ok(store, `run declares an unknown store provider ${payload.storeProviderId}`);
          break;
        }
        case "RunStarted": started = true; break;
        case "RunResumed": break;
        case "LeaseAcquired":
        case "LeaseTakenOver": {
          const candidate = payload.lease;
          if (candidate.leaseHash !== recomputeLeaseHash(candidate)) {
            fail("DX-L-017", "GE_DX_IDENTITY_MISMATCH", `frame ${index} lease hash is not reproducible`);
          }
          if (candidate.policyHash !== policy.policyHash) {
            fail("DX-L-018", "GE_DX_IDENTITY_MISMATCH", `frame ${index} lease is bound to a foreign policy`);
          }
          if (candidate.renewalLimit > store.lockManager.maxRenewals) {
            fail("DX-L-019", "GE_DX_PROVIDER_UNSUPPORTED", `frame ${index} renewal limit exceeds the lock manager bound`);
          }
          if (candidate.expiresAtMs <= candidate.acquiredAtMs) {
            fail("DX-L-015", "GE_DX_INVALID_ARGUMENT", `frame ${index} lease expires at or before acquisition`);
          }
          if (candidate.acquiredAtMs !== payload.providerNowMs) {
            fail("DX-L-030", "GE_DX_INVALID_ARGUMENT", `frame ${index} lease acquisition is not provider stamped`);
          }
          if (payload.requestedTtlMs !== candidate.expiresAtMs - payload.providerNowMs) {
            fail("DX-L-031", "GE_DX_INVALID_ARGUMENT", `frame ${index} requested ttl does not match the granted window`);
          }
          if (candidate.expiresAtMs - payload.providerNowMs > policy.maxTtlMs) {
            fail("DX-L-016", "GE_DX_QUOTA_EXCEEDED", `frame ${index} lease window exceeds the policy ceiling`);
          }
          if (Math.abs(payload.observedClockMs - payload.providerNowMs) > policy.maxClockSkewMs) {
            fail("DX-L-026", "GE_DX_LEASE_CONFLICT", `frame ${index} holder clock skew exceeds the policy bound`);
          }
          if (candidate.state !== "active") {
            fail("DX-L-028", "GE_DX_LEASE_CONFLICT", `frame ${index} grants a lease that is not active`);
          }
          const activeExpired = locks.activeLeaseId !== null
            && locks.activeExpiresAtMs !== undefined
            && locks.activeExpiresAtMs <= payload.providerNowMs;
          if (locks.activeLeaseId !== null && candidate.fence === locks.activeFence) {
            fail("DX-L-025", "GE_DX_DUAL_RESUME_LOSER", `frame ${index} is the losing side of a dual resume`);
          }
          if (locks.lastFence === MAX_SAFE || locks.lastEpoch === MAX_SAFE) {
            fail("DX-L-020", "GE_DX_QUOTA_EXCEEDED", `frame ${index} exhausts the fence space`);
          }
          if (locks.lastFence === 0) {
            if (candidate.fence !== 1 || candidate.epoch !== 1) {
              fail("DX-L-001", "GE_DX_LEASE_CONFLICT", `frame ${index} first acquisition must start at fence and epoch one`);
            }
          }
          if (candidate.fence !== locks.lastFence + 1) {
            fail("DX-L-002", "GE_DX_STALE_FENCE", `frame ${index} does not strictly increment the fence`);
          }
          if (candidate.epoch !== locks.lastEpoch + 1) {
            fail("DX-L-003", "GE_DX_LEASE_CONFLICT", `frame ${index} does not strictly increment the epoch`);
          }
          if (frame.type === "LeaseTakenOver") {
            if (locks.activeLeaseId === null || !activeExpired) {
              fail("DX-L-005", "GE_DX_LEASE_CONFLICT", `frame ${index} takes over a lease that has not expired`);
            }
            if (payload.expectedFence !== locks.lastFence) {
              fail("DX-L-006", "GE_DX_STALE_FENCE", `frame ${index} takeover names a stale prior fence`);
            }
            observedLeaseStates.add("expired");
            observedLeaseStates.add("taken-over");
          } else if (locks.activeLeaseId !== null) {
            fail("DX-L-004", "GE_DX_LEASE_CONFLICT", `frame ${index} acquires while an owner is active`);
          }
          if (usedLeaseIds.has(candidate.leaseId)) {
            fail("DX-L-007", "GE_DX_LEASE_CONFLICT", `frame ${index} reuses lease id ${candidate.leaseId}`);
          }
          usedLeaseIds.add(candidate.leaseId);
          const retired = locks.activeLeaseId === null
            ? locks.retiredLeaseIds
            : [...locks.retiredLeaseIds, locks.activeLeaseId];
          locks = {
            activeLeaseId: candidate.leaseId,
            activeOwnerId: candidate.ownerId,
            activeFence: candidate.fence,
            activeEpoch: candidate.epoch,
            lastFence: candidate.fence,
            lastEpoch: candidate.epoch,
            state: "active",
            retiredLeaseIds: retired,
            activeExpiresAtMs: candidate.expiresAtMs,
            activeAcquiredAtMs: candidate.acquiredAtMs,
            activeRenewalCount: candidate.renewalCount,
            activeRenewalLimit: candidate.renewalLimit,
          };
          observedLeaseStates.add("active");
          ownershipBegun = true;
          break;
        }
        case "LeaseRenewed": {
          const candidate = payload.lease;
          if (candidate.leaseHash !== recomputeLeaseHash(candidate)) {
            fail("DX-L-017", "GE_DX_IDENTITY_MISMATCH", `frame ${index} lease hash is not reproducible`);
          }
          if (candidate.policyHash !== policy.policyHash) {
            fail("DX-L-018", "GE_DX_IDENTITY_MISMATCH", `frame ${index} lease is bound to a foreign policy`);
          }
          if (locks.activeLeaseId === null
              || candidate.leaseId !== locks.activeLeaseId
              || candidate.ownerId !== locks.activeOwnerId
              || candidate.fence !== locks.activeFence
              || candidate.epoch !== locks.activeEpoch
              || candidate.acquiredAtMs !== locks.activeAcquiredAtMs) {
            fail("DX-L-008", "GE_DX_STALE_FENCE", `frame ${index} renewal identity is stale`);
          }
          if (locks.activeExpiresAtMs <= payload.providerNowMs) {
            observedLeaseStates.add("expired");
            fail("DX-L-012", "GE_DX_LEASE_EXPIRED", `frame ${index} renews an expired lease`);
          }
          if (candidate.expiresAtMs <= locks.activeExpiresAtMs) {
            fail("DX-L-009", "GE_DX_INVALID_ARGUMENT", `frame ${index} renewal does not strictly extend expiry`);
          }
          if (payload.requestedTtlMs !== candidate.expiresAtMs - payload.providerNowMs) {
            fail("DX-L-031", "GE_DX_INVALID_ARGUMENT", `frame ${index} requested ttl does not match the granted window`);
          }
          if (candidate.expiresAtMs - payload.providerNowMs > policy.maxTtlMs) {
            fail("DX-L-016", "GE_DX_QUOTA_EXCEEDED", `frame ${index} lease window exceeds the policy ceiling`);
          }
          if (Math.abs(payload.observedClockMs - payload.providerNowMs) > policy.maxClockSkewMs) {
            fail("DX-L-026", "GE_DX_LEASE_CONFLICT", `frame ${index} holder clock skew exceeds the policy bound`);
          }
          if (candidate.renewalCount !== locks.activeRenewalCount + 1) {
            fail("DX-L-010", "GE_DX_LEASE_CONFLICT", `frame ${index} renewal count does not advance by one`);
          }
          if (candidate.renewalCount > candidate.renewalLimit) {
            fail("DX-L-011", "GE_DX_RENEWAL_LIMIT_EXCEEDED", `frame ${index} exceeds the renewal limit`);
          }
          locks = {
            ...locks,
            activeExpiresAtMs: candidate.expiresAtMs,
            activeRenewalCount: candidate.renewalCount,
            activeRenewalLimit: candidate.renewalLimit,
          };
          break;
        }
        case "LeaseReleased": {
          if (locks.activeLeaseId === null || payload.leaseId !== locks.activeLeaseId) {
            fail("DX-L-013", "GE_DX_STALE_FENCE", `frame ${index} releases a lease that is not active`);
          }
          if (payload.fence !== locks.activeFence || payload.epoch !== locks.activeEpoch) {
            fail("DX-L-014", "GE_DX_STALE_FENCE", `frame ${index} release would lower the fence`);
          }
          if (locks.activeExpiresAtMs <= payload.providerNowMs) {
            observedLeaseStates.add("expired");
            fail("DX-L-012", "GE_DX_LEASE_EXPIRED", `frame ${index} releases an expired lease`);
          }
          locks = {
            ...locks,
            activeLeaseId: null, activeOwnerId: null, activeFence: null, activeEpoch: null,
            state: "released",
            retiredLeaseIds: [...locks.retiredLeaseIds, payload.leaseId],
          };
          delete locks.activeExpiresAtMs;
          delete locks.activeAcquiredAtMs;
          observedLeaseStates.add("released");
          break;
        }
        case "LeaseLost": {
          if (payload.leaseId === locks.activeLeaseId || !locks.retiredLeaseIds.includes(payload.leaseId)) {
            fail("DX-L-024", "GE_DX_LEASE_CONFLICT", `frame ${index} declares a live lease lost`);
          }
          lostOwners.add(leaseOwnerOf(frames, payload.leaseId));
          observedLeaseStates.add("lost");
          break;
        }
        case "NodeScheduled": {
          scheduledNodes.add(frame.nodeId);
          if (frame.provenance === "new") {
            for (const edgeId of inboundEdges.get(frame.nodeId) ?? []) {
              if (!edges.includes(edgeId)) {
                fail("DX-H-021", "GE_DX_HISTORY_INVALID", `frame ${index} schedules ${frame.nodeId} before edge ${edgeId} committed`);
              }
            }
            if (payload.activityKey !== recomputeActivityKey(frame.runId, frame.nodeId, payload.inputHash, graphRevision)) {
              fail("DX-H-025", "GE_DX_HISTORY_INVALID", `frame ${index} activity key is not reproducible`);
            }
            reservations.set(frame.nodeId, { attempt: frame.attempt, activityKey: payload.activityKey });
            if (!activityKeys.has(frame.nodeId)) activityKeys.set(frame.nodeId, payload.activityKey);
          }
          break;
        }
        case "NodeStarted": {
          if (frame.provenance === "new") {
            if (payload.activityKey !== recomputeActivityKey(frame.runId, frame.nodeId, payload.inputHash, graphRevision)) {
              fail("DX-H-025", "GE_DX_HISTORY_INVALID", `frame ${index} activity key is not reproducible`);
            }
            if (succeeded.includes(frame.nodeId)) {
              fail("DX-H-015", "GE_DX_HISTORY_INVALID", `frame ${index} reruns committed successful node ${frame.nodeId}`);
            }
            if (open.has(frame.nodeId)) {
              const interrupted = open.get(frame.nodeId);
              if (frame.attempt !== interrupted.attempt + 1) {
                fail("DX-H-016", "GE_DX_HISTORY_INVALID", `frame ${index} does not claim the next attempt`);
              }
              const confirmation = confirmations.get(frame.nodeId);
              if (confirmation === undefined) {
                if (interrupted.sideEffects === "non-idempotent") {
                  fail("DX-N-001", "GE_DX_RESUME_CONFIRMATION_REQUIRED", `frame ${index} resumes a non-idempotent attempt without confirmation`);
                }
                if (interrupted.sideEffects === "undeclared") {
                  fail("DX-N-004", "GE_DX_RESUME_CONFIRMATION_REQUIRED", `frame ${index} resumes an undeclared attempt without confirmation`);
                }
              } else {
                if (confirmation.attempt !== interrupted.attempt) {
                  fail("DX-N-003", "GE_DX_RESUME_CONFIRMATION_REQUIRED", `frame ${index} confirmation names a different attempt`);
                }
                if (confirmation.activityKey !== interrupted.activityKey) {
                  fail("DX-N-002", "GE_DX_RESUME_CONFIRMATION_REQUIRED", `frame ${index} confirmation names a different activity`);
                }
                if (confirmation.disposition === "abandon") {
                  fail("DX-N-007", "GE_DX_HISTORY_INVALID", `frame ${index} restarts an abandoned attempt`);
                }
              }
              settledAttempts.add(`${frame.nodeId}:${interrupted.attempt}`);
              confirmations.delete(frame.nodeId);
            } else {
              const reservation = reservations.get(frame.nodeId);
              if (reservation === undefined) {
                fail("DX-H-017", "GE_DX_HISTORY_INVALID", `frame ${index} starts ${frame.nodeId} without a reservation`);
              }
              if (reservation !== undefined && frame.attempt !== reservation.attempt) {
                fail("DX-H-016", "GE_DX_HISTORY_INVALID", `frame ${index} does not claim the reserved attempt`);
              }
              reservations.delete(frame.nodeId);
            }
            if (payload.activityKey !== activityKeys.get(frame.nodeId)) {
              fail("DX-N-005", "GE_DX_HISTORY_INVALID", `frame ${index} changes the stable activity key across attempts`);
            }
            perNode[frame.nodeId] = (perNode[frame.nodeId] ?? 0) + 1;
            const total = Object.values(perNode).reduce((left, right) => left + right, 0);
            if (total > maxTotalAttempts) {
              fail("DX-H-022", "GE_DX_QUOTA_EXCEEDED", `frame ${index} exceeds the global attempt budget`);
            }
            open.set(frame.nodeId, {
              nodeId: frame.nodeId,
              attempt: frame.attempt,
              activityKey: payload.activityKey,
              sideEffects: declaredSideEffects.get(frame.nodeId) ?? "undeclared",
            });
          }
          break;
        }
        case "NodeSucceeded": {
          if (frame.provenance === "new") {
            if (settledAttempts.has(`${frame.nodeId}:${frame.attempt}`)) {
              fail("DX-H-019", "GE_DX_HISTORY_INVALID", `frame ${index} records a second outcome for one attempt`);
            }
            if (!open.has(frame.nodeId)) {
              fail("DX-H-018", "GE_DX_HISTORY_INVALID", `frame ${index} records an outcome with no open attempt`);
            }
            settledAttempts.add(`${frame.nodeId}:${frame.attempt}`);
            open.delete(frame.nodeId);
          }
          if (!succeeded.includes(frame.nodeId)) succeeded.push(frame.nodeId);
          outputHashes[frame.nodeId] = payload.outputHash;
          break;
        }
        case "NodeAttemptFailed": {
          if (frame.provenance === "new") {
            if (settledAttempts.has(`${frame.nodeId}:${frame.attempt}`)) {
              fail("DX-H-019", "GE_DX_HISTORY_INVALID", `frame ${index} records a second outcome for one attempt`);
            }
            if (!open.has(frame.nodeId)) {
              fail("DX-H-018", "GE_DX_HISTORY_INVALID", `frame ${index} records an outcome with no open attempt`);
            }
            settledAttempts.add(`${frame.nodeId}:${frame.attempt}`);
            open.delete(frame.nodeId);
            if (payload.terminal === true) failedNodes.add(frame.nodeId);
          }
          break;
        }
        case "NodeRetried": {
          if (!settledAttempts.has(`${frame.nodeId}:${frame.attempt - 1}`)) {
            fail("DX-H-026", "GE_DX_HISTORY_INVALID", `frame ${index} reserves an attempt without a settled predecessor`);
          }
          if (payload.activityKey !== activityKeys.get(frame.nodeId)) {
            fail("DX-N-005", "GE_DX_HISTORY_INVALID", `frame ${index} changes the stable activity key across attempts`);
          }
          reservations.set(frame.nodeId, { attempt: frame.attempt, activityKey: payload.activityKey });
          break;
        }
        case "NodeSettledWithoutAttempt": settled.push(frame.nodeId); scheduledNodes.add(frame.nodeId); break;
        case "EdgeEmitted": {
          if (frame.provenance === "new" && !succeeded.includes(payload.producerNodeId)) {
            fail("DX-H-020", "GE_DX_HISTORY_INVALID", `frame ${index} releases edge ${payload.edgeId} before its producer committed`);
          }
          edges.push(payload.edgeId);
          break;
        }
        case "ArtifactCreated":
          artifactFacts.push({
            artifactId: payload.artifactId, digest: payload.digest,
            byteCount: payload.byteCount, storeProviderId: payload.storeProviderId,
          });
          break;
        case "RouteSelected":
          routes.push({ nodeId: frame.nodeId, modelId: payload.modelId, routePolicyHash: payload.routePolicyHash });
          break;
        case "BudgetUpdated": recordedUnits += payload.recordedUnits; break;
        case "CheckpointRecorded": break;
        case "ForkCreated": break;
        case "ResumeConfirmed": {
          if (!open.has(payload.nodeId)) {
            fail("DX-N-006", "GE_DX_HISTORY_INVALID", `frame ${index} confirms a node with no open attempt`);
          }
          confirmations.set(payload.nodeId, {
            attempt: payload.attempt, activityKey: payload.activityKey, disposition: payload.disposition,
          });
          approvals.push({
            nodeId: payload.nodeId, attempt: payload.attempt, activityKey: payload.activityKey,
            disposition: payload.disposition, confirmedBy: payload.confirmedBy,
          });
          break;
        }
        default: {
          if (TERMINALS.has(frame.type)) {
            if (open.size > 0) {
              fail("DX-H-024", "GE_DX_HISTORY_INVALID", `frame ${index} terminates with ${open.size} open attempt(s)`);
            }
            for (const nodeId of scheduledNodes) {
              if (!succeeded.includes(nodeId) && !failedNodes.has(nodeId) && !settled.includes(nodeId)) {
                fail("DX-H-024", "GE_DX_HISTORY_INVALID", `frame ${index} terminates while ${nodeId} is unsettled`);
              }
            }
            terminal = frame.type;
          }
          break;
        }
      }
      if (frame.type === "NodeScheduled") declaredSideEffects.set(frame.nodeId, payload.sideEffects);
    });

    const total = Object.values(perNode).reduce((left, right) => left + right, 0);
    const publicLocks = {
      activeLeaseId: locks.activeLeaseId, activeOwnerId: locks.activeOwnerId,
      activeFence: locks.activeFence, activeEpoch: locks.activeEpoch,
      lastFence: locks.lastFence, lastEpoch: locks.lastEpoch,
      state: locks.state, retiredLeaseIds: locks.retiredLeaseIds,
    };
    return {
      projection: {
        reducerState: { succeededNodeIds: [...succeeded].sort(compareCodePoints), outputHashes: canonicalize(outputHashes) },
        controllerState: {
          terminal,
          openAttempts: [...open.values()].sort((left, right) => compareCodePoints(left.nodeId, right.nodeId)),
          settledWithoutAttempt: [...settled].sort(compareCodePoints),
          emittedEdgeIds: [...edges].sort(compareCodePoints),
        },
        attempts: { perNode: canonicalize(perNode), total },
        budgets: { maxTotalAttempts, consumedAttempts: total, recordedUnits },
        approvals,
        locks: publicLocks,
        artifacts: artifactFacts,
        routes,
        seen,
        lineage: options.lineage,
      },
      openAttempts: [...open.values()],
      store,
      graphRevision,
    };
  }

  // Per-fold private state the switch above reads. Declared here so the closure
  // is explicit; reset by foldRun before every fold.
  let declaredSideEffects = new Map();

  function leaseOwnerOf(frames, leaseId) {
    for (const frame of frames) {
      if ((frame.type === "LeaseAcquired" || frame.type === "LeaseTakenOver")
        && frame.payload.lease.leaseId === leaseId) return frame.payload.lease.ownerId;
    }
    return null;
  }

  function foldRun(frames, lineage, options = {}) {
    declaredSideEffects = new Map();
    return foldHistory(frames, { ...options, lineage });
  }

  return runCampaign();

  // ================================================================ campaign
  function runCampaign() {
    // -- corpus status ------------------------------------------------------
    assert.equal(fixture.apiVersion, API_VERSION, "corpus apiVersion drifted");
    assert.equal(fixture.contractVersion, CONTRACT_VERSION, "corpus contractVersion drifted");
    assert.equal(
      fixture.contractStatus,
      "contract-only-native-implementation-required",
      "the corpus must disclose that no runtime implements this contract",
    );
    assert.equal(fixture.implementationClaim, false, "the corpus must not claim an implementation");

    // -- schema compilation and positive documents --------------------------
    for (const [file, schema] of schemaSources) {
      assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", `${file} must be Draft 2020-12`);
      assert.ok(String(schema.$id).endsWith(`/v1alpha1/${file}`), `${file} $id does not follow the repository convention`);
    }
    for (const store of fixture.stores) {
      const result = schemaValidate("artifact-store-descriptor.schema.json", store);
      assert.ok(result.ok, `store descriptor ${store.providerId} failed schema validation: ${JSON.stringify(result.errors)}`);
    }
    const runs = fixture.runs;
    for (const runKey of Object.keys(runs)) {
      for (const frame of runs[runKey].frames) {
        assert.ok(frameValidator(frame) === true, `${runKey} frame ${frame.sequence} failed schema validation: ${JSON.stringify(frameValidator.errors)}`);
      }
    }
    for (const key of Object.keys(fixture.checkpoints)) {
      const result = schemaValidate("checkpoint-acceleration.schema.json", fixture.checkpoints[key]);
      assert.ok(result.ok, `checkpoint ${key} failed schema validation: ${JSON.stringify(result.errors)}`);
    }
    for (const key of Object.keys(fixture.replayPlans)) {
      const result = schemaValidate("replay-plan.schema.json", fixture.replayPlans[key]);
      assert.ok(result.ok, `replay plan ${key} failed schema validation: ${JSON.stringify(result.errors)}`);
    }
    const forkResult = schemaValidate("fork-lineage.schema.json", fixture.forkLineage);
    assert.ok(forkResult.ok, `fork lineage failed schema validation: ${JSON.stringify(forkResult.errors)}`);

    // -- literals are recomputed, never echoed ------------------------------
    for (const store of fixture.stores) {
      assert.equal(store.descriptorHash, recomputeStoreHash(store), `descriptor hash for ${store.providerId} is not reproducible`);
    }
    for (const artifact of fixture.artifacts) {
      assert.equal(
        artifact.digest,
        createHash("sha256").update(artifact.content, "utf8").digest("hex"),
        `artifact ${artifact.artifactId} digest is not reproducible`,
      );
      assert.equal(artifact.byteCount, Buffer.byteLength(artifact.content, "utf8"), `artifact ${artifact.artifactId} byte count is not reproducible`);
    }
    for (const runKey of Object.keys(runs)) {
      const frames = runs[runKey].frames;
      let previousFrameHash = null;
      let previousHistoryHash = null;
      frames.forEach((frame, index) => {
        assert.equal(frame.sequence, index, `${runKey} frame ${index} sequence drifted`);
        assert.equal(frame.previousFrameHash, previousFrameHash, `${runKey} frame ${index} chain drifted`);
        assert.equal(frame.payloadHash, domainHash(D.payload, frame.payload), `${runKey} frame ${index} payload hash drifted`);
        assert.equal(frame.payloadBytes, canonicalBytes(frame.payload), `${runKey} frame ${index} payload byte count drifted`);
        assert.equal(
          frame.decisionHash,
          domainHash(D.decision, [frame.runId, index, frame.type, frame.payloadHash]),
          `${runKey} frame ${index} decision hash drifted`,
        );
        assert.equal(frame.frameHash, recomputeFrameHash(frame), `${runKey} frame ${index} frame hash drifted`);
        assert.equal(
          frame.historyHash,
          domainHash(D.history, [previousHistoryHash, frame.frameHash]),
          `${runKey} frame ${index} history hash drifted`,
        );
        previousFrameHash = frame.frameHash;
        previousHistoryHash = frame.historyHash;
      });
    }

    // -- authoritative folds -------------------------------------------------
    const observedLeaseStates = new Set();
    const parentFold = foldRun(clone(runs.parent.frames), runs.parent.lineage, { observedLeaseStates });
    const childFold = foldRun(clone(runs.child.frames), runs.child.lineage);
    const cancelledFold = foldRun(clone(runs.cancelled.frames), runs.cancelled.lineage);
    assert.equal(parentFold.projection.controllerState.terminal, "RunSucceeded", "parent run must terminate as succeeded");
    assert.equal(childFold.projection.controllerState.terminal, "RunFailed", "child run must terminate as failed");
    assert.equal(cancelledFold.projection.controllerState.terminal, "RunCancelled", "cancelled run must terminate as cancelled");
    assert.ok(projectionValidator(parentFold.projection) === true, `parent projection failed schema validation: ${JSON.stringify(projectionValidator.errors)}`);

    // -- checkpoint acceleration --------------------------------------------
    const checkpointTargets = {
      parent: { run: runs.parent, fold: parentFold },
      child: { run: runs.child, fold: childFold },
      cancelled: { run: runs.cancelled, fold: cancelledFold },
    };
    for (const key of Object.keys(fixture.checkpoints)) {
      evaluateCheckpoint(fixture.checkpoints[key], checkpointTargets[key].run);
    }

    // acceleration equality: folding the suffix from a valid checkpoint must
    // reproduce the full fold exactly.
    evaluateAcceleration(fixture.checkpoints.parent, runs.parent, parentFold.projection);

    // -- provider neutrality -------------------------------------------------
    const neutralityResults = new Map();
    for (const backend of fixture.positives.backends) {
      const store = fixture.stores.find((candidate) => candidate.backend === backend);
      assert.ok(store, `no descriptor declares backend ${backend}`);
      evaluateStore(store, []);
      neutralityResults.set(backend, canonicalJson(foldRun(clone(runs.parent.frames), runs.parent.lineage).projection));
    }
    evaluateNeutrality(neutralityResults);

    // -- artifacts -----------------------------------------------------------
    for (const artifact of fixture.artifacts) {
      evaluateArtifact(artifact, storeById.get(artifact.storeProviderId));
    }
    for (const fact of parentFold.projection.artifacts) {
      resolveArtifact(fact.artifactId);
    }

    // -- replay --------------------------------------------------------------
    const replayFolds = {
      parentResult: runs.parent, parentState: runs.parent, parentTrace: runs.parent,
      childResult: runs.child, cancelledResult: runs.cancelled,
    };
    const exercisedModes = new Set();
    for (const key of Object.keys(fixture.replayPlans)) {
      const plan = fixture.replayPlans[key];
      evaluateReplay(plan, replayFolds[key], null);
      exercisedModes.add(plan.mode);
    }
    assert.deepEqual(
      [...exercisedModes].sort(compareCodePoints),
      [...fixture.positives.replayModes].sort(compareCodePoints),
      "the replay corpus does not exercise every declared mode",
    );

    // -- fork ----------------------------------------------------------------
    evaluateFork(fixture.forkLineage, runs.parent.frames, runs.child.frames, fixture.artifacts);

    // -- positives -----------------------------------------------------------
    const exercisedCrashStates = new Set();
    for (const observation of fixture.positives.crashObservations) {
      exercisedCrashStates.add(observation.crashState);
      const outcome = crashOutcome(observation);
      assert.equal(outcome, observation.expectOutcome, `crash observation ${observation.crashState} outcome drifted`);
    }
    const declaredCrashStates = schemaSources.get("checkpoint-acceleration.schema.json").properties.crashState.enum;
    assert.deepEqual(
      [...exercisedCrashStates].sort(compareCodePoints),
      [...declaredCrashStates].sort(compareCodePoints),
      "the corpus does not exercise every declared crash state",
    );

    const exercisedSideEffects = new Set();
    for (const resumeCase of fixture.positives.sideEffectResumes) {
      exercisedSideEffects.add(resumeCase.sideEffects);
      assert.equal(resumeOutcome(resumeCase), resumeCase.expectOutcome, `resume case ${resumeCase.sideEffects} outcome drifted`);
    }
    assert.deepEqual(
      [...exercisedSideEffects].sort(compareCodePoints),
      ["idempotent", "non-idempotent", "none", "undeclared"],
      "the corpus does not exercise every side-effect declaration",
    );

    assert.deepEqual(
      [...observedLeaseStates].sort(compareCodePoints),
      [...fixture.positives.leaseStates].sort(compareCodePoints),
      "the corpus does not derive every declared lease state",
    );
    const leaseStateEnum = schemaSources.get("lease.schema.json").properties.state.enum;
    assert.deepEqual(
      [...fixture.positives.leaseStates].sort(compareCodePoints),
      [...leaseStateEnum].sort(compareCodePoints),
      "the declared lease states do not cover the schema enum",
    );

    const durabilityEnum = schemaSources.get("artifact-store-descriptor.schema.json").properties.durabilityClass.enum;
    assert.deepEqual(
      [...new Set(fixture.stores.map((store) => store.durabilityClass))].sort(compareCodePoints),
      [...durabilityEnum].sort(compareCodePoints),
      "the corpus does not exercise every durability class",
    );
    const backendEnum = schemaSources.get("artifact-store-descriptor.schema.json").properties.backend.enum;
    assert.deepEqual(
      [...new Set(fixture.stores.map((store) => store.backend))].sort(compareCodePoints),
      [...backendEnum].sort(compareCodePoints),
      "the corpus does not exercise every storage backend",
    );

    const artifactDispositionEnum = schemaSources.get("fork-lineage.schema.json").properties.artifactDisposition.enum;
    assert.deepEqual(
      fixture.positives.artifactDispositions.map((entry) => entry.artifactDisposition).sort(compareCodePoints),
      [...artifactDispositionEnum].sort(compareCodePoints),
      "the corpus does not exercise every artifact disposition",
    );
    for (const entry of fixture.positives.artifactDispositions) {
      assert.equal(entry.inheritsArtifactFact, entry.artifactDisposition !== "drop", `artifact disposition ${entry.artifactDisposition} inheritance drifted`);
      assert.equal(entry.requiresDigestVerification, entry.artifactDisposition !== "drop", `artifact disposition ${entry.artifactDisposition} verification drifted`);
    }
    const authorityDispositionEnum = schemaSources.get("fork-lineage.schema.json").properties.authorityDisposition.enum;
    assert.deepEqual(
      fixture.positives.authorityDispositions.map((entry) => entry.authorityDisposition).sort(compareCodePoints),
      [...authorityDispositionEnum].sort(compareCodePoints),
      "the corpus does not exercise every authority disposition",
    );
    for (const entry of fixture.positives.authorityDispositions) {
      assert.equal(entry.approvalMayTransfer, entry.authorityDisposition === "inherit-bound", `authority disposition ${entry.authorityDisposition} transfer rule drifted`);
    }

    // every declared frame type must appear in the corpus histories
    const observedTypes = new Set();
    for (const runKey of Object.keys(runs)) for (const frame of runs[runKey].frames) observedTypes.add(frame.type);
    assert.deepEqual(
      [...observedTypes].sort(compareCodePoints),
      [...fixture.frameTypes].sort(compareCodePoints),
      "the corpus histories do not exercise every declared frame type",
    );
    const frameTypeEnum = schemaSources.get("checkpoint-acceleration.schema.json").$defs.frameType.enum;
    assert.deepEqual(
      [...fixture.frameTypes].sort(compareCodePoints),
      [...frameTypeEnum].sort(compareCodePoints),
      "the corpus frame vocabulary does not match the schema enum",
    );
    for (const type of fixture.shippedFrameTypes) {
      assert.ok(fixture.frameTypes.includes(type), `${type} is declared shipped but absent from the frame vocabulary`);
    }

    // -- negative campaign ---------------------------------------------------
    const declaredNegatives = fixture.semanticNegativeCases;
    assert.equal(declaredNegatives.length, REQUIRED_SEMANTIC_NEGATIVES, `the corpus declares ${declaredNegatives.length} semantic negatives; the contract requires ${REQUIRED_SEMANTIC_NEGATIVES}`);
    assert.equal(new Set(declaredNegatives.map((item) => item.id)).size, REQUIRED_SEMANTIC_NEGATIVES, "semantic negative ids are not unique");

    const executedRules = new Set();
    const executedIds = new Set();
    const executedCodes = new Set();
    const executedChannels = new Set();
    const executedIdentityFields = new Set();
    for (const testCase of declaredNegatives) {
      let code = null;
      let ruleId = null;
      try {
        runNegative(testCase);
      } catch (error) {
        if (!(error instanceof DxError)) throw error;
        code = error.code;
        ruleId = error.ruleId;
      }
      executedIds.add(testCase.id);
      // Both assertions run unconditionally, including under neutralization.
      // The verdict assertion is what makes rule deletion observable, and the
      // ruleId assertion is what makes a rule shadowed by a neighbour that
      // reports the same code observable as well.
      assert.equal(code, testCase.expectCode, `${testCase.id} verdict drifted`);
      assert.equal(ruleId, testCase.ruleId, `${testCase.id} was refused by ${ruleId} rather than ${testCase.ruleId}`);
      executedRules.add(testCase.ruleId);
      executedCodes.add(testCase.expectCode);
      if (testCase.channel !== undefined) executedChannels.add(testCase.channel);
      if (testCase.identityField !== undefined) executedIdentityFields.add(testCase.identityField);
    }
    assert.equal(executedIds.size, REQUIRED_SEMANTIC_NEGATIVES, "a declared semantic negative did not execute");

    // coverage is a hard failure, never a silent pass
    assert.deepEqual(
      [...executedRules].sort(compareCodePoints),
      [...RULE_IDS].sort(compareCodePoints),
      "the corpus does not isolate every rule the oracle implements",
    );
    assert.deepEqual(
      [...executedCodes].sort(compareCodePoints),
      [...fixture.errorCodes].sort(compareCodePoints),
      "the corpus does not exercise every declared error code",
    );
    assert.deepEqual(
      [...executedChannels].sort(compareCodePoints),
      [...fixture.effectChannels].sort(compareCodePoints),
      "the corpus does not isolate every replay effect channel",
    );
    const identityFieldEnum = schemaSources.get("fork-lineage.schema.json").$defs.identityField.enum;
    assert.deepEqual(
      [...executedIdentityFields].sort(compareCodePoints),
      [...identityFieldEnum].sort(compareCodePoints),
      "the corpus does not isolate every bound identity field",
    );

    // -- schema negatives ----------------------------------------------------
    const schemaNegatives = fixture.schemaNegativeCases;
    assert.equal(schemaNegatives.length, REQUIRED_SCHEMA_NEGATIVES, `the corpus declares ${schemaNegatives.length} schema negatives; the contract requires ${REQUIRED_SCHEMA_NEGATIVES}`);
    const executedSchemaIds = new Set();
    for (const testCase of schemaNegatives) {
      const result = schemaValidate(testCase.schema, testCase.document);
      assert.equal(result.ok, false, `${testCase.id} was accepted by ${testCase.schema}`);
      executedSchemaIds.add(testCase.id);
    }
    assert.equal(executedSchemaIds.size, REQUIRED_SCHEMA_NEGATIVES, "a declared schema negative did not execute");

    return Object.freeze({
      contractStatus: fixture.contractStatus,
      implementationClaim: fixture.implementationClaim,
      schemas: SCHEMA_FILES.length,
      rules: RULE_IDS.length,
      runs: Object.keys(runs).length,
      frames: Object.values(runs).reduce((total, run) => total + run.frames.length, 0),
      checkpoints: Object.keys(fixture.checkpoints).length,
      replayPlans: Object.keys(fixture.replayPlans).length,
      semanticNegatives: declaredNegatives.length,
      schemaNegatives: schemaNegatives.length,
      firedRules: [...firedRules].sort(compareCodePoints),
    });
  }

  // ============================================================== evaluators
  function evaluateCheckpoint(document, run) {
    const parts = recomputeCheckpointParts(document);
    if (document.contentHash !== parts.contentHash) {
      fail("DX-C-002", "GE_DX_CHECKPOINT_REJECTED", "checkpoint content hash is not reproducible");
    }
    if (document.byteCount !== parts.byteCount) {
      fail("DX-C-003", "GE_DX_CHECKPOINT_REJECTED", "checkpoint byte count is not reproducible");
    }
    if (document.authority !== false) {
      fail("DX-C-001", "GE_DX_CHECKPOINT_NOT_AUTHORITATIVE", "a checkpoint may never assert authority");
    }
    const projectionKeys = Object.keys(document.projection).sort(compareCodePoints);
    const requiredKeys = [...schemaSources.get("checkpoint-acceleration.schema.json").$defs.projection.required].sort(compareCodePoints);
    if (!same(projectionKeys, requiredKeys)) {
      fail("DX-C-012", "GE_DX_INVALID_ARGUMENT", "checkpoint projection key set is not the ten declared compartments");
    }
    if (document.runId !== run.runId) {
      fail("DX-C-007", "GE_DX_CHECKPOINT_REJECTED", "checkpoint belongs to a foreign run");
    }
    if (document.eventStreamId !== run.eventStreamId) {
      fail("DX-C-008", "GE_DX_CHECKPOINT_REJECTED", "checkpoint belongs to a foreign event stream");
    }
    const created = run.frames[0].payload;
    if (document.graphHash !== created.graphHash || document.planHash !== created.planHash) {
      fail("DX-C-009", "GE_DX_CHECKPOINT_REJECTED", "checkpoint binds a foreign graph or plan");
    }
    if (document.graphRevision !== created.graphRevision) {
      fail("DX-C-016", "GE_DX_CHECKPOINT_REJECTED", "checkpoint binds a foreign graph revision");
    }
    if (document.throughSequence > run.frames.length - 1) {
      fail("DX-C-006", "GE_DX_CHECKPOINT_REJECTED", "checkpoint leads the authoritative tail");
    }
    if (document.crashState !== "committed" && document.crashState !== "after-rename") {
      fail("DX-C-015", "GE_DX_CHECKPOINT_REJECTED", "a torn checkpoint observation may not be accepted");
    }
    const prefix = run.frames.slice(0, document.throughSequence + 1);
    const fold = foldRun(clone(prefix), run.lineage);
    if (document.writeFence < (fold.projection.locks.activeFence ?? fold.projection.locks.lastFence)) {
      fail("DX-C-010", "GE_DX_STALE_FENCE", "checkpoint was saved below the active fence");
    }
    if (fold.projection.locks.activeOwnerId !== null && document.holderId !== fold.projection.locks.activeOwnerId) {
      fail("DX-C-011", "GE_DX_STALE_FENCE", "checkpoint was saved by a non-owning holder");
    }
    if (document.historyHash !== prefix[prefix.length - 1].historyHash) {
      fail("DX-C-004", "GE_DX_CHECKPOINT_REJECTED", "checkpoint history hash does not match the authoritative prefix");
    }
    if (!same(document.projection, fold.projection)) {
      fail("DX-C-005", "GE_DX_CHECKPOINT_REJECTED", "checkpoint projection does not reconstruct the authoritative prefix");
    }
  }

  // Resume from a valid checkpoint by accumulating only the suffix onto the
  // checkpoint's own projection. This is a genuine acceleration: the prefix is
  // never re-read. It deliberately does not re-run the guards of sections 3-6,
  // because the ten projection compartments do not carry the attempt machine's
  // private state (reservations, settled attempts, declared side effects). A
  // checkpoint accelerates the projection; it never accelerates validation.
  function accumulateProjection(base, frames) {
    const state = clone(base);
    let openAttempts = clone(base.controllerState.openAttempts);
    const declared = new Map();
    for (const entry of openAttempts) declared.set(entry.nodeId, entry.sideEffects);
    const perNode = { ...base.attempts.perNode };
    for (const frame of frames) {
      const payload = frame.payload;
      state.seen.push(frame.eventId);
      switch (frame.type) {
        case "LeaseAcquired":
        case "LeaseTakenOver":
          state.locks = {
            activeLeaseId: payload.lease.leaseId,
            activeOwnerId: payload.lease.ownerId,
            activeFence: payload.lease.fence,
            activeEpoch: payload.lease.epoch,
            lastFence: payload.lease.fence,
            lastEpoch: payload.lease.epoch,
            state: "active",
            retiredLeaseIds: state.locks.activeLeaseId === null
              ? state.locks.retiredLeaseIds
              : [...state.locks.retiredLeaseIds, state.locks.activeLeaseId],
          };
          break;
        case "LeaseRenewed":
          state.locks = { ...state.locks, activeFence: payload.lease.fence, activeEpoch: payload.lease.epoch };
          break;
        case "LeaseReleased":
          state.locks = {
            ...state.locks,
            activeLeaseId: null, activeOwnerId: null, activeFence: null, activeEpoch: null,
            state: "released",
            retiredLeaseIds: [...state.locks.retiredLeaseIds, payload.leaseId],
          };
          break;
        case "LeaseLost": break;
        case "NodeScheduled": declared.set(frame.nodeId, payload.sideEffects); break;
        case "NodeStarted":
          perNode[frame.nodeId] = (perNode[frame.nodeId] ?? 0) + 1;
          openAttempts = openAttempts.filter((entry) => entry.nodeId !== frame.nodeId);
          openAttempts.push({
            nodeId: frame.nodeId, attempt: frame.attempt, activityKey: payload.activityKey,
            sideEffects: declared.get(frame.nodeId) ?? "undeclared",
          });
          break;
        case "NodeSucceeded":
          openAttempts = openAttempts.filter((entry) => entry.nodeId !== frame.nodeId);
          if (!state.reducerState.succeededNodeIds.includes(frame.nodeId)) {
            state.reducerState.succeededNodeIds.push(frame.nodeId);
          }
          state.reducerState.outputHashes[frame.nodeId] = payload.outputHash;
          break;
        case "NodeAttemptFailed":
          openAttempts = openAttempts.filter((entry) => entry.nodeId !== frame.nodeId);
          break;
        case "NodeSettledWithoutAttempt": state.controllerState.settledWithoutAttempt.push(frame.nodeId); break;
        case "EdgeEmitted": state.controllerState.emittedEdgeIds.push(payload.edgeId); break;
        case "ArtifactCreated":
          state.artifacts.push({
            artifactId: payload.artifactId, digest: payload.digest,
            byteCount: payload.byteCount, storeProviderId: payload.storeProviderId,
          });
          break;
        case "RouteSelected":
          state.routes.push({ nodeId: frame.nodeId, modelId: payload.modelId, routePolicyHash: payload.routePolicyHash });
          break;
        case "BudgetUpdated": state.budgets.recordedUnits += payload.recordedUnits; break;
        case "ResumeConfirmed":
          state.approvals.push({
            nodeId: payload.nodeId, attempt: payload.attempt, activityKey: payload.activityKey,
            disposition: payload.disposition, confirmedBy: payload.confirmedBy,
          });
          break;
        case "RunSucceeded": case "RunFailed": case "RunCancelled":
          state.controllerState.terminal = frame.type;
          break;
        default: break;
      }
    }
    const total = Object.values(perNode).reduce((left, right) => left + right, 0);
    state.reducerState.succeededNodeIds.sort(compareCodePoints);
    state.reducerState.outputHashes = canonicalize(state.reducerState.outputHashes);
    state.controllerState.settledWithoutAttempt.sort(compareCodePoints);
    state.controllerState.emittedEdgeIds.sort(compareCodePoints);
    state.controllerState.openAttempts = openAttempts.sort((left, right) => compareCodePoints(left.nodeId, right.nodeId));
    state.attempts = { perNode: canonicalize(perNode), total };
    state.budgets = { ...state.budgets, consumedAttempts: total };
    return state;
  }

  function evaluateAcceleration(document, run, authoritative) {
    const suffix = run.frames.slice(document.throughSequence + 1);
    assert.ok(suffix.length > 0, "the acceleration case must have a non-empty suffix");
    const accelerated = accumulateProjection(document.projection, suffix);
    if (!same(accelerated, authoritative)) {
      fail("DX-C-017", "GE_DX_CHECKPOINT_REJECTED", "accelerated resume does not reproduce the authoritative fold");
    }
    return accelerated;
  }

  function evaluateCompaction(original, compacted) {
    if (compacted.length !== original.length) {
      fail("DX-C-013", "GE_DX_CHECKPOINT_NOT_AUTHORITATIVE", "compaction deleted an authoritative event");
    }
    for (let index = 0; index < original.length; index += 1) {
      if (compacted[index].frameHash !== original[index].frameHash) {
        fail("DX-C-014", "GE_DX_CHECKPOINT_NOT_AUTHORITATIVE", `compaction mutated authoritative frame ${index}`);
      }
    }
  }

  function evaluateStore(descriptor, requiredCapabilities) {
    if (descriptor.descriptorHash !== recomputeStoreHash(descriptor)) {
      fail("DX-A-001", "GE_DX_IDENTITY_MISMATCH", "store descriptor hash is not reproducible");
    }
    if (descriptor.addressing === "content-addressed" && descriptor.capabilities.contentAddressed !== true) {
      fail("DX-A-002", "GE_DX_INVALID_ARGUMENT", "content addressing is declared without the capability");
    }
    if (descriptor.limits.maxInlinePayloadBytes > MAX_INLINE_PAYLOAD_BYTES
        || descriptor.limits.maxPageSize > MAX_PAGE_SIZE
        || descriptor.limits.maxKeyLength > MAX_KEY_LENGTH) {
      fail("DX-A-014", "GE_DX_QUOTA_EXCEEDED", "store descriptor declares a limit above the contract ceiling");
    }
    const lock = descriptor.lockManager;
    if (lock.distributedFencing === true) {
      if (descriptor.durabilityClass !== "multi-host-durable") {
        fail("DX-A-003", "GE_DX_PROVIDER_UNSUPPORTED", "distributed fencing requires a multi-host durable class");
      }
      if (lock.clockSource !== "provider") {
        fail("DX-A-004", "GE_DX_PROVIDER_UNSUPPORTED", "distributed fencing requires a provider clock");
      }
      if (lock.fenceCheckedInWriteTransaction !== true) {
        fail("DX-A-005", "GE_DX_PROVIDER_UNSUPPORTED", "distributed fencing requires the fence predicate inside the write transaction");
      }
    }
    if (["memory", "jsonl", "local-file"].includes(descriptor.backend)
        && !["process-local", "local-file"].includes(descriptor.durabilityClass)) {
      fail("DX-A-015", "GE_DX_PROVIDER_UNSUPPORTED", `backend ${descriptor.backend} cannot claim ${descriptor.durabilityClass}`);
    }
    if (lock.maxLeaseTtlMs < fixture.leasePolicy.maxTtlMs || lock.maxLeaseTtlMs > MAX_LEASE_TTL_MS) {
      fail("DX-A-012", "GE_DX_PROVIDER_UNSUPPORTED", "the lock manager cannot honour the bound lease policy");
    }
    for (const capability of requiredCapabilities ?? []) {
      if (descriptor.capabilities[capability] !== true) {
        fail("DX-A-011", "GE_DX_PROVIDER_UNSUPPORTED", `the run requires undeclared capability ${capability}`);
      }
    }
  }

  function evaluateArtifact(record, descriptor) {
    if (record.digest !== createHash("sha256").update(record.content, "utf8").digest("hex")) {
      fail("DX-A-006", "GE_DX_ARTIFACT_INTEGRITY", `artifact ${record.artifactId} digest does not match its bytes`);
    }
    if (record.byteCount !== Buffer.byteLength(record.content, "utf8")) {
      fail("DX-A-007", "GE_DX_ARTIFACT_INTEGRITY", `artifact ${record.artifactId} byte count does not match its bytes`);
    }
    if (descriptor.addressing === "content-addressed" && record.artifactId !== `sha256-${record.digest.slice(0, 32)}`) {
      fail("DX-A-009", "GE_DX_ARTIFACT_INTEGRITY", `artifact ${record.artifactId} identity is not derived from its digest`);
    }
    if (record.byteCount > descriptor.limits.maxObjectBytes) {
      fail("DX-A-008", "GE_DX_QUOTA_EXCEEDED", `artifact ${record.artifactId} exceeds the declared object ceiling`);
    }
  }

  function resolveArtifact(artifactId) {
    if (!artifactById.has(artifactId)) {
      fail("DX-A-010", "GE_DX_ARTIFACT_UNAVAILABLE", `artifact ${artifactId} is not resolvable`);
    }
    return artifactById.get(artifactId);
  }

  function evaluateNeutrality(results) {
    const distinct = new Set(results.values());
    if (distinct.size !== 1) {
      fail("DX-A-013", "GE_DX_PROVIDER_UNSUPPORTED", "declared backends do not fold one history to one projection");
    }
  }

  function evaluateReplay(plan, run, override) {
    if (plan.contractVersion !== CONTRACT_VERSION) {
      fail("DX-R-001", "GE_DX_REPLAY_UNSUPPORTED", "replay plan names an unsupported contract version");
    }
    if (plan.planHash !== recomputeReplayPlanHash(plan)) {
      fail("DX-R-009", "GE_DX_IDENTITY_MISMATCH", "replay plan hash is not reproducible");
    }
    const frames = override?.frames ?? run.frames;
    if (plan.runId !== frames[0].runId || plan.eventStreamId !== frames[0].eventStreamId) {
      fail("DX-R-011", "GE_DX_IDENTITY_MISMATCH", "replay plan is bound to a foreign stream");
    }
    for (const channel of fixture.effectChannels) {
      if (plan.effectBudget[channel] !== 0) {
        fail("DX-R-006", "GE_DX_INVALID_ARGUMENT", `replay effect budget for ${channel} is not zero`);
      }
    }
    for (const channel of fixture.effectChannels) {
      if (plan.observedEffects[channel] !== 0) {
        fail("DX-R-005", "GE_DX_REPLAY_SIDE_EFFECT", `replay observed ${plan.observedEffects[channel]} ${channel}`);
      }
    }
    const tail = frames.length - 1;
    const through = plan.throughSequence === null ? tail : plan.throughSequence;
    if (through > tail) {
      fail("DX-R-002", "GE_DX_REPLAY_UNSUPPORTED", "replay names a sequence beyond the authoritative tail");
    }
    const created = frames[0].payload;
    for (const field of ["graphHash", "planHash", "inputHash", "implementationHash", "policyHash", "authorityHash"]) {
      if (plan.expected[field] !== created[field]) {
        fail("DX-R-003", "GE_DX_IDENTITY_MISMATCH", `replay expected ${field} does not match the bound run`);
      }
    }
    let fold;
    try {
      fold = foldRun(clone(frames.slice(0, through + 1)), run.lineage);
    } catch (error) {
      if (error instanceof DxError && error.code === "GE_DX_HISTORY_CORRUPT") {
        // Replay must surface corruption as its own refusal. Without this site
        // the corrupt-prefix vector would be answered by the fold's integrity
        // rule, and "replay never continues best-effort" would be untested.
        fail("DX-R-010", "GE_DX_HISTORY_CORRUPT", "replay refuses a corrupt history rather than folding a truncated prefix");
      }
      throw error;
    }
    if (plan.expected.historyHash !== frames[through].historyHash) {
      fail("DX-R-004", "GE_DX_IDENTITY_MISMATCH", "replay expected history hash does not match the authoritative prefix");
    }
    const foldedUnknown = fold.openAttempts
      .map((entry) => ({
        nodeId: entry.nodeId, attempt: entry.attempt,
        activityKey: entry.activityKey, sideEffects: entry.sideEffects,
      }))
      .sort((left, right) => compareCodePoints(left.nodeId, right.nodeId));
    const claimedUnknown = plan.unknownFacts
      .map((entry) => ({
        nodeId: entry.nodeId, attempt: entry.attempt,
        activityKey: entry.activityKey, sideEffects: entry.sideEffects,
      }))
      .sort((left, right) => compareCodePoints(left.nodeId, right.nodeId));
    if (!same(claimedUnknown, foldedUnknown)) {
      fail("DX-R-008", "GE_DX_HISTORY_INVALID", "replay does not preserve the in-doubt facts of its prefix");
    }
    const claimed = override?.projection ?? fold.projection;
    for (const unknown of plan.unknownFacts) {
      if (claimed.reducerState.succeededNodeIds.includes(unknown.nodeId)) {
        fail("DX-R-012", "GE_DX_HISTORY_INVALID", `replay resolved in-doubt node ${unknown.nodeId}`);
      }
    }
    if (!same(claimed, fold.projection)) {
      fail("DX-R-007", "GE_DX_HISTORY_INVALID", "replay projection does not reconstruct the authoritative prefix");
    }
    return fold;
  }

  function evaluateFork(lineage, parentFrames, childFrames, artifacts) {
    if (lineage.lineageHash !== recomputeLineageHash(lineage)) {
      fail("DX-F-018", "GE_DX_IDENTITY_MISMATCH", "fork lineage hash is not reproducible");
    }
    if (lineage.childRunId === lineage.parentRunId) {
      fail("DX-F-001", "GE_DX_FORK_IDENTITY_REUSE", "a fork may not reuse the parent run identity");
    }
    if (lineage.parentThroughSequence > parentFrames.length - 1) {
      fail("DX-F-006", "GE_DX_FORK_LINEAGE_INVALID", "fork names a parent sequence beyond the parent tail");
    }
    if (lineage.parentHistoryHash !== parentFrames[lineage.parentThroughSequence].historyHash) {
      fail("DX-F-005", "GE_DX_IDENTITY_MISMATCH", "fork parent history hash does not match the parent prefix");
    }
    const parentPrefixFold = foldRun(clone(parentFrames.slice(0, lineage.parentThroughSequence + 1)), fixture.runs.parent.lineage);
    if (lineage.generation !== parentPrefixFold.projection.lineage.generation + 1) {
      fail("DX-F-015", "GE_DX_FORK_LINEAGE_INVALID", "fork generation does not advance by one");
    }
    if (lineage.ancestorLineageHashes.length !== lineage.generation - 1) {
      fail("DX-F-017", "GE_DX_FORK_LINEAGE_INVALID", "ancestor chain length does not match the generation");
    }
    const parentAncestors = parentPrefixFold.projection.lineage.ancestorLineageHashes;
    const expectedAncestors = [
      ...parentAncestors,
      parentAncestors.length === 0 ? rootLineageHashOf(lineage.parentRunId) : parentAncestors[parentAncestors.length - 1],
    ];
    if (!same(lineage.ancestorLineageHashes, expectedAncestors)) {
      fail("DX-F-016", "GE_DX_FORK_LINEAGE_INVALID", "ancestor chain does not extend the parent lineage");
    }
    const changed = [];
    for (const field of schemaSources.get("fork-lineage.schema.json").$defs.identityField.enum) {
      if (lineage.parentIdentity[field] !== lineage.childIdentity[field]) changed.push(field);
    }
    if (!same([...lineage.changedIdentityFields].sort(compareCodePoints), changed.sort(compareCodePoints))) {
      fail("DX-F-007", "GE_DX_FORK_LINEAGE_INVALID", "declared identity changes do not match the recomputed difference");
    }
    const childCreated = childFrames[0].payload;
    for (const field of schemaSources.get("fork-lineage.schema.json").$defs.identityField.enum) {
      if (childCreated[field] !== lineage.childIdentity[field]) {
        fail("DX-F-008", "GE_DX_FORK_IDENTITY_REUSE", `the child run declares a ${field} the lineage does not bind`);
      }
    }
    for (const frame of childFrames) {
      if (frame.eventStreamId === lineage.parentEventStreamId) {
        fail("DX-F-019", "GE_DX_FORK_LINEAGE_INVALID", "a child frame targets the parent event stream");
      }
    }
    const forkFrames = childFrames.filter((frame) => frame.type === "ForkCreated");
    if (forkFrames.length !== 1 || forkFrames[0].payload.lineageHash !== lineage.lineageHash) {
      fail("DX-F-022", "GE_DX_FORK_LINEAGE_INVALID", "the child stream does not record exactly this lineage");
    }
    const enumeratedChildSequences = new Set();
    for (const fact of lineage.inheritedFacts) {
      if (fact.parentSequence > lineage.parentThroughSequence) {
        fail("DX-F-011", "GE_DX_FORK_LINEAGE_INVALID", "an inherited fact reaches past the bound parent prefix");
      }
      const parentFrame = parentFrames[fact.parentSequence];
      if (fact.type !== parentFrame.type) {
        fail("DX-F-023", "GE_DX_FORK_LINEAGE_INVALID", "an inherited fact misnames the parent frame type");
      }
      if (fact.parentFrameHash !== parentFrame.frameHash) {
        fail("DX-F-004", "GE_DX_FORK_LINEAGE_INVALID", "an inherited fact does not match the parent frame");
      }
      if (fact.parentDecisionHash !== parentFrame.decisionHash) {
        fail("DX-F-004", "GE_DX_FORK_LINEAGE_INVALID", "an inherited fact does not match the parent decision");
      }
      if (parentPrefixFold.openAttempts.some((entry) => entry.nodeId === parentFrame.nodeId
          && parentFrame.type === "NodeStarted")) {
        fail("DX-F-012", "GE_DX_FORK_LINEAGE_INVALID", "an in-doubt parent attempt may not be inherited");
      }
      if (fact.childDecisionHash === fact.parentDecisionHash) {
        fail("DX-F-002", "GE_DX_FORK_IDENTITY_REUSE", "the child adopted a parent decision verbatim");
      }
      const childFrame = childFrames[fact.childSequence];
      if (childFrame === undefined || childFrame.provenance !== "inherited") {
        fail("DX-F-010", "GE_DX_FORK_LINEAGE_INVALID", "an enumerated inherited fact has no inherited child frame");
      }
      if (childFrame !== undefined
        && fact.childDecisionHash !== domainHash(D.decision, [lineage.childRunId, fact.childSequence, fact.type, childFrame.payloadHash])) {
        fail("DX-F-003", "GE_DX_FORK_LINEAGE_INVALID", "an inherited fact child decision hash is not reproducible");
      }
      if (fact.type === "ArtifactCreated") {
        if (lineage.artifactDisposition === "drop") {
          fail("DX-F-020", "GE_DX_FORK_LINEAGE_INVALID", "a dropped artifact disposition may not inherit artifact facts");
        }
        const record = artifacts.find((candidate) => candidate.artifactId === parentFrame.payload.artifactId);
        if (record === undefined
          || record.digest !== createHash("sha256").update(record.content, "utf8").digest("hex")
          || record.digest !== parentFrame.payload.digest) {
          fail("DX-F-021", "GE_DX_ARTIFACT_INTEGRITY", "an inherited artifact failed digest verification");
        }
      }
      if (fact.type === "ResumeConfirmed") {
        if (lineage.authorityDisposition !== "inherit-bound") {
          fail("DX-F-013", "GE_DX_FORK_LINEAGE_INVALID", "an approval may not transfer under this authority disposition");
        }
        const expectedKey = recomputeActivityKey(
          lineage.childRunId, childFrame.payload.nodeId, forkSinkInputHash(parentFrames), lineage.parentGraphRevision,
        );
        if (childFrame.payload.activityKey !== expectedKey) {
          fail("DX-F-014", "GE_DX_FORK_LINEAGE_INVALID", "an inherited approval is not rebound to the child identity");
        }
      }
      enumeratedChildSequences.add(fact.childSequence);
    }
    for (const frame of childFrames) {
      if (frame.provenance === "inherited" && !enumeratedChildSequences.has(frame.sequence)) {
        fail("DX-F-009", "GE_DX_FORK_LINEAGE_INVALID", `child frame ${frame.sequence} reuses a parent fact without enumerating it`);
      }
    }
  }

  function forkSinkInputHash(parentFrames) {
    const frame = parentFrames.find((candidate) => candidate.type === "ResumeConfirmed");
    const scheduled = parentFrames.find(
      (candidate) => candidate.type === "NodeScheduled" && candidate.nodeId === frame.payload.nodeId,
    );
    return scheduled.payload.inputHash;
  }

  function crashOutcome(observation) {
    if (!observation.present) return "fallback-full-fold";
    if (observation.torn) return "rejected";
    if (observation.writeFence < fixture.checkpoints.parent.writeFence) return "stale-fence";
    return "accepted";
  }

  function resumeOutcome(resumeCase) {
    if (resumeCase.sideEffects === "none") return "retry-permitted";
    if (resumeCase.sideEffects === "idempotent") return "retry-permitted-same-activity-key";
    if (resumeCase.confirmed === true) return "retry-permitted-after-confirmation";
    return "refused";
  }

  // ============================================================= neg drivers
  function materializeHistory(spec) {
    const run = fixture.runs[spec.run];
    let frames = clone(run.frames);
    if (spec.frameIndex !== undefined) {
      const frame = frames[spec.frameIndex];
      applyMutations(frame, spec.mutations);
      applyMutations(frame, spec.alsoMutations);
      if (spec.leaseMutations !== undefined) {
        applyMutations(frame.payload.lease, spec.leaseMutations);
        frame.payload.lease.leaseHash = recomputeLeaseHash(frame.payload.lease);
      }
    }
    if (spec.prefixLength !== undefined) frames = frames.slice(0, spec.prefixLength);
    const drops = [...(spec.dropIndexes ?? []), ...(spec.alsoDropIndexes ?? [])].sort((left, right) => right - left);
    for (const index of drops) frames.splice(index, 1);
    for (const step of spec.appendSteps ?? []) {
      frames.push(stepToFrame(step, run.runId, run.eventStreamId, frames.length));
    }
    return { run, frames: sealFrames(frames, spec.reseal) };
  }

  function runNegative(spec) {
    switch (spec.target) {
      case "history": {
        const { run, frames } = materializeHistory(spec);
        foldRun(frames, run.lineage, spec.seedLocks ? { seedLocks: spec.seedLocks } : {});
        return;
      }
      case "replay": {
        const planKey = spec.plan;
        const runKey = planKey.startsWith("parent") ? "parent" : planKey.startsWith("child") ? "child" : "cancelled";
        const run = fixture.runs[runKey];
        const plan = clone(fixture.replayPlans[planKey]);
        let frames = clone(run.frames);
        if (spec.historyMutation !== undefined) {
          applyMutations(frames[spec.historyMutation.frameIndex], [spec.historyMutation]);
        }
        applyMutations(plan, spec.mutations);
        if (spec.reseal === "plan") plan.planHash = recomputeReplayPlanHash(plan);
        let override = null;
        if (spec.claimProjectionMutations !== undefined || spec.resolveUnknown === true) {
          const through = plan.throughSequence === null ? frames.length - 1 : plan.throughSequence;
          const claimed = foldRun(clone(frames.slice(0, through + 1)), run.lineage).projection;
          applyMutations(claimed, spec.claimProjectionMutations);
          if (spec.resolveUnknown === true) {
            for (const unknown of plan.unknownFacts) {
              if (!claimed.reducerState.succeededNodeIds.includes(unknown.nodeId)) {
                claimed.reducerState.succeededNodeIds.push(unknown.nodeId);
              }
            }
            claimed.reducerState.succeededNodeIds.sort(compareCodePoints);
          }
          override = { projection: claimed, frames };
        } else {
          override = { frames };
        }
        evaluateReplay(plan, run, override);
        return;
      }
      case "fork": {
        const lineage = clone(fixture.forkLineage);
        const parentFrames = clone(fixture.runs.parent.frames);
        let childFrames = clone(fixture.runs.child.frames);
        let artifacts = clone(fixture.artifacts);
        if (spec.adoptParentDecision !== undefined) {
          const fact = lineage.inheritedFacts[spec.adoptParentDecision];
          fact.childDecisionHash = fact.parentDecisionHash;
        }
        if (spec.childFrameMutation !== undefined) {
          applyMutations(childFrames[spec.childFrameMutation.frameIndex], [spec.childFrameMutation]);
        }
        if (spec.dropForkCreated === true) {
          childFrames = childFrames.filter((frame) => frame.type !== "ForkCreated");
        }
        if (spec.corruptInheritedArtifact === true) {
          const record = artifacts.find((candidate) => candidate.artifactId === lineage.inheritedFacts[3].parentFrameHash)
            ?? artifacts[0];
          record.content = `${record.content} tampered`;
        }
        if (spec.inheritInDoubt === true) {
          lineage.parentThroughSequence = 23;
          lineage.parentHistoryHash = parentFrames[23].historyHash;
          const parentFrame = parentFrames[23];
          const target = childFrames[7];
          target.type = "NodeStarted";
          target.nodeId = parentFrame.nodeId;
          target.attempt = parentFrame.attempt;
          target.artifactRef = null;
          target.payload = clone(parentFrame.payload);
          target.payloadHash = domainHash(D.payload, target.payload);
          target.payloadBytes = canonicalBytes(target.payload);
          lineage.inheritedFacts[3] = {
            parentSequence: 23,
            childSequence: 7,
            type: "NodeStarted",
            parentFrameHash: parentFrame.frameHash,
            parentDecisionHash: parentFrame.decisionHash,
            childDecisionHash: domainHash(D.decision, [lineage.childRunId, 7, "NodeStarted", target.payloadHash]),
            integrityVerified: true,
          };
          lineage.artifactDisposition = "drop";
        }
        if (spec.inheritApproval !== undefined) {
          lineage.parentThroughSequence = 26;
          lineage.parentHistoryHash = parentFrames[26].historyHash;
          const parentFrame = parentFrames[26];
          const childSequence = childFrames.length;
          const rebound = spec.inheritApproval === "inherit-bound-rebound";
          const payload = clone(parentFrame.payload);
          if (rebound) {
            payload.activityKey = recomputeActivityKey(
              lineage.childRunId, payload.nodeId, forkSinkInputHash(parentFrames), lineage.parentGraphRevision,
            );
          }
          const frame = stepToFrame(
            { type: "ResumeConfirmed", fence: 1, holderId: "worker-d", nodeId: payload.nodeId, attempt: payload.attempt, provenance: "inherited", parentSequence: 26, payload },
            lineage.childRunId, lineage.childEventStreamId, childSequence,
          );
          frame.decisionHash = domainHash(D.decision, [lineage.childRunId, childSequence, "ResumeConfirmed", frame.payloadHash]);
          childFrames.push(frame);
          lineage.inheritedFacts.push({
            parentSequence: 26,
            childSequence,
            type: "ResumeConfirmed",
            parentFrameHash: parentFrame.frameHash,
            parentDecisionHash: parentFrame.decisionHash,
            childDecisionHash: frame.decisionHash,
            integrityVerified: true,
          });
          if (spec.inheritApproval !== "as-declared") lineage.authorityDisposition = "inherit-bound";
        }
        applyMutations(lineage, spec.mutations);
        if (spec.reseal === "lineage" || spec.adoptParentDecision !== undefined
          || spec.inheritInDoubt === true || spec.inheritApproval !== undefined) {
          lineage.lineageHash = recomputeLineageHash(lineage);
          const forkFrame = childFrames.find((frame) => frame.type === "ForkCreated");
          if (forkFrame !== undefined) {
            forkFrame.payload.lineageHash = lineage.lineageHash;
            forkFrame.payloadHash = domainHash(D.payload, forkFrame.payload);
            forkFrame.payloadBytes = canonicalBytes(forkFrame.payload);
            forkFrame.decisionHash = domainHash(D.decision, [forkFrame.runId, forkFrame.sequence, forkFrame.type, forkFrame.payloadHash]);
          }
        }
        evaluateFork(lineage, parentFrames, childFrames, artifacts);
        return;
      }
      case "checkpoint": {
        const document = clone(fixture.checkpoints[spec.checkpoint]);
        applyMutations(document, spec.mutations);
        if (spec.dropProjectionKey !== undefined) delete document.projection[spec.dropProjectionKey];
        if (spec.reseal === "content") {
          const parts = recomputeCheckpointParts(document);
          document.byteCount = parts.byteCount;
          document.contentHash = recomputeCheckpointParts(document).contentHash;
        } else if (spec.reseal === "hash-only") {
          document.contentHash = recomputeCheckpointParts(document).contentHash;
        }
        evaluateCheckpoint(document, fixture.runs[spec.checkpoint]);
        return;
      }
      case "acceleration": {
        const document = clone(fixture.checkpoints.parent);
        applyMutations(document.projection, spec.perturbProjection);
        const authoritative = foldRun(clone(fixture.runs.parent.frames), fixture.runs.parent.lineage).projection;
        evaluateAcceleration(document, fixture.runs.parent, authoritative);
        return;
      }
      case "compaction": {
        const original = clone(fixture.runs.parent.frames);
        const compacted = clone(original);
        if (spec.dropFrameIndex !== undefined) compacted.splice(spec.dropFrameIndex, 1);
        if (spec.rewriteFrameIndex !== undefined) compacted[spec.rewriteFrameIndex].frameHash = "9".repeat(64);
        evaluateCompaction(original, compacted);
        return;
      }
      case "store": {
        const descriptor = clone(storeById.get(spec.store));
        applyMutations(descriptor, spec.mutations);
        if (spec.reseal === "store") descriptor.descriptorHash = recomputeStoreHash(descriptor);
        evaluateStore(descriptor, spec.requireCapability === undefined ? [] : [spec.requireCapability]);
        return;
      }
      case "artifact": {
        if (spec.missingReference !== undefined) {
          resolveArtifact(spec.missingReference);
          return;
        }
        const record = clone(fixture.artifacts[spec.artifactIndex]);
        applyMutations(record, spec.mutations);
        const descriptor = clone(storeById.get(record.storeProviderId));
        if (spec.maxObjectBytes !== undefined) descriptor.limits.maxObjectBytes = spec.maxObjectBytes;
        evaluateArtifact(record, descriptor);
        return;
      }
      case "neutrality": {
        const results = new Map();
        for (const backend of fixture.positives.backends) {
          const projection = foldRun(clone(fixture.runs.parent.frames), fixture.runs.parent.lineage).projection;
          if (backend === spec.backend) applyMutations(projection, spec.perturbProjection);
          results.set(backend, canonicalJson(projection));
        }
        evaluateNeutrality(results);
        return;
      }
      default:
        throw new Error(`unknown negative target ${spec.target}`);
    }
  }
}

const REQUIRED_SEMANTIC_NEGATIVES = 148;
const REQUIRED_SCHEMA_NEGATIVES = 24;

export const durableExtensionCampaign = Object.freeze({
  contractVersion: CONTRACT_VERSION,
  rules: RULE_IDS.length,
  ruleIds: RULE_IDS,
  requiredSemanticNegatives: REQUIRED_SEMANTIC_NEGATIVES,
  requiredSchemaNegatives: REQUIRED_SCHEMA_NEGATIVES,
});

function measure() {
  const held = [];
  const survivors = [];
  for (const ruleId of RULE_IDS) {
    let failed = false;
    try {
      validateDurableExtensionFixture({ neutralized: [ruleId] });
    } catch {
      failed = true;
    }
    if (failed) held.push(ruleId);
    else survivors.push(ruleId);
  }
  return { held, survivors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const neutralized = (process.env.GE_DX_NEUTRALIZE ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const summary = validateDurableExtensionFixture({ neutralized });
  process.stdout.write(
    `Validated ${summary.schemas} durable-extension schemas, ${summary.runs} hash-chained runs ` +
    `(${summary.frames} authority frames), ${summary.checkpoints} checkpoints, ${summary.replayPlans} replay plans, ` +
    `1 fork lineage, ${summary.rules} rejection rules, ${summary.semanticNegatives} semantic negatives and ` +
    `${summary.schemaNegatives} schema negatives. contractStatus=${summary.contractStatus} ` +
    `implementationClaim=${summary.implementationClaim}\n`,
  );
  if (process.env.GE_DX_MEASURE === "1") {
    const { held, survivors } = measure();
    process.stdout.write(`Guard neutralization: ${held.length} of ${RULE_IDS.length} rules held.\n`);
    if (survivors.length > 0) process.stdout.write(`Survivors: ${survivors.join(", ")}\n`);
  }
}
