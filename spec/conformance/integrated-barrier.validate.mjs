#!/usr/bin/env node
//
// Independent validator for spec/conformance/integrated-barrier.case.json.
//
// Every literal in the corpus is recomputed here from the rules stated in
// spec/integrated-barrier-semantics.md alone. Nothing is imported from a
// language runtime and nothing is copied from another conformance fixture, so
// a single typo anywhere in the corpus must make this module throw.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = dirname(here);
const CASE_PATH = join(here, "integrated-barrier.case.json");
const POLICY_SCHEMA_PATH = join(specRoot, "integrated-barrier-policy.schema.json");
const VOTE_SCHEMA_PATH = join(specRoot, "barrier-vote.schema.json");
const BARRIER_DECISION_SCHEMA_PATH = join(specRoot, "barrier-decision.schema.json");
const ROUTE_DECISION_SCHEMA_PATH = join(specRoot, "route-decision.schema.json");
const GRAPH_SCHEMA_PATH = join(specRoot, "graph.schema.json");

// ---------------------------------------------------------------------------
// Contract constants, transcribed from spec/integrated-barrier-semantics.md.
// They are deliberately NOT read out of the corpus: the corpus must agree with
// them, not define them.
// ---------------------------------------------------------------------------

const CONTRACT = "graphengineering.reacher-z.github.io/integrated-barrier/v1alpha1";
const POLICY_DOMAIN = "graphengineering.policy.v1alpha1";
const BARRIER_DECISION_DOMAIN = "graphengineering.barrier-decision.v1alpha1";
const ROUTE_DECISION_DOMAIN = "graphengineering.route-decision.v1alpha1";
const POLICY_KIND_TAGS = ["barrier", "router"];
const MAX_SAFE = 9007199254740991;

const GE1421 = "GE1421_INVALID_BARRIER_POLICY";
const GE1422 = "GE1422_BARRIER_POLICY_KIND_MISMATCH";
const GE1423 = "GE1423_BARRIER_NO_INPUTS";
const GE1424 = "GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS";
const BARRIER_DIAGNOSTIC_CODES = [GE1421, GE1422, GE1423, GE1424];
const BARRIER_DIAGNOSTIC_CODE_SET = new Set(BARRIER_DIAGNOSTIC_CODES);
const ROUTER_PASS_CODES = new Set([
  "GE1401_INVALID_ROUTER_POLICY",
  "GE1402_UNSUPPORTED_EDGE_CONDITION",
  "GE1403_CONDITION_SOURCE_NOT_ROUTER",
  "GE1404_ROUTE_NOT_ALLOWED",
  "GE1405_DUPLICATE_ROUTE_CASE",
  "GE1406_DUPLICATE_ROUTE_TARGET",
  "GE1407_INCOMPLETE_ROUTE_COVERAGE",
]);
const DIAGNOSTIC_FIELDS_IN_ORDER = ["code", "path", "nodeIds", "edgeId"];

const KINDS = ["all", "minimum", "percentage", "quorum"];
const ON_UNSATISFIED = ["fail", "unknown", "human"];
const LATE_ARRIVAL = ["ignore", "reject"];
// The upstream-produced carrier has exactly four verdicts. The decision census
// has a fifth, 'not-cast', which an upstream can never produce: it records a
// disposition entry that produced no ballot at all.
const VERDICTS = ["accept", "reject", "abstain", "unknown"];
const VOTE_RECORD_VERDICTS = ["accept", "reject", "abstain", "unknown", "not-cast"];
const NOT_CAST = "not-cast";
const NON_VOTING_DISPOSITIONS = ["missing", "timed_out"];
const DISPOSITIONS = ["succeeded", "failed", "missing", "timed_out", "abstained", "unknown"];

// A node identifier is a Graph IR node ID; a route key is a SafeRouteId.
const NODE_ID_PATTERN = "^[A-Za-z][A-Za-z0-9_.-]{0,127}$";
const SAFE_ROUTE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$";
const RESERVED_ROUTE_KEYS = [".", ".."];
const REASON_CODES = [
  "NO_ITEMS",
  "ALL_SUCCEEDED",
  "ALL_NOT_SUCCEEDED",
  "MINIMUM_MET",
  "MINIMUM_NOT_MET",
  "MINIMUM_EXCEEDS_TOTAL",
  "PERCENTAGE_MET",
  "PERCENTAGE_NOT_MET",
  "QUORUM_MET",
  "QUORUM_NOT_MET",
  "QUORUM_EXCEEDS_PARTICIPANTS",
];
const ROUTE_REASON_CODES = [
  "REQUESTED_ROUTES_SELECTED",
  "DEFAULT_SELECTED_NO_REQUEST",
  "DEFAULT_SELECTED_UNKNOWN_ROUTE",
  "ESCALATION_SELECTED_LOW_CONFIDENCE",
  "NO_REQUESTED_ROUTE",
  "UNKNOWN_ROUTE",
  "MULTIPLE_ROUTES_FOR_SINGLE",
  "MULTICAST_LIMIT_EXCEEDED",
];
const RESOLUTION_BY_ON_UNSATISFIED = Object.freeze({
  fail: "failed",
  unknown: "unknown",
  human: "awaiting_human",
});
const VERDICT_TO_DISPOSITION = Object.freeze({
  accept: "succeeded",
  reject: "failed",
  abstain: "abstained",
  unknown: "unknown",
});
const DISPOSITION_TO_COUNT = Object.freeze({
  succeeded: "succeeded",
  failed: "failed",
  missing: "missing",
  timed_out: "timedOut",
  abstained: "abstained",
  unknown: "unknown",
});
const DISPOSITION_TO_ID_LIST = Object.freeze({
  succeeded: "acceptedIds",
  failed: "failedIds",
  missing: "missingIds",
  timed_out: "timedOutIds",
  abstained: "abstainedIds",
  unknown: "unknownIds",
});
const COUNT_FIELDS = ["succeeded", "failed", "missing", "timedOut", "abstained", "unknown"];
const ID_LIST_FIELDS = ["acceptedIds", "failedIds", "missingIds", "timedOutIds", "abstainedIds", "unknownIds"];

// "unknown keys first in Unicode code-point order, then required-or-present
// fields in contract order". The contract order is the declaration order of the
// IntegratedBarrierPolicy block in the semantics document.
const BARRIER_API_VERSION = "graphengineering.reacher-z.github.io/barrier/v1alpha1";
const POLICY_FIELD_ORDER = [
  "apiVersion",
  "kind",
  "minimum",
  "basisPoints",
  "quorum",
  "deadline",
  "onUnsatisfied",
  "lateArrival",
];
const POLICY_FIELD_SET = new Set(POLICY_FIELD_ORDER);
const QUORUM_FIELD_ORDER = ["accepts", "countAbstainAsParticipant"];
const DEADLINE_FIELD_ORDER = ["afterMs"];
const CARDINALITY_FIELD_ORDER = ["minimum", "basisPoints", "quorum"];
const CARDINALITY_FIELD_REQUIRED_BY_KIND = Object.freeze({
  minimum: "minimum",
  percentage: "basisPoints",
  quorum: "quorum",
});

const CLAIM_FLAGS = [
  "implementationClaim",
  "typescriptRuntimeClaim",
  "pythonRuntimeClaim",
  "capabilityGateClaim",
];

const REPLAY_REJECTION_CODES = [
  "DECISION_POLICY_DRIFT",
  "DECISION_IDENTITY_MISMATCH",
  "DUPLICATE_DECISION",
];

// ---------------------------------------------------------------------------
// Canonical serialization, framing, digests.
// ---------------------------------------------------------------------------

function compareUnicodeCodePoints(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Canonical Graph IR serialization: no whitespace, keys by ascending code point. */
function canonicalSerialize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), "canonical numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  assert.ok(isPlainObject(value), "canonical values must be portable JSON");
  return `{${Object.keys(value)
    .sort(compareUnicodeCodePoints)
    .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`)
    .join(",")}}`;
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

/** frame(s) = uint32be(byteLength(utf8(s))) || utf8(s) */
function frame(text) {
  const bytes = Buffer.from(text, "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([header, bytes]);
}

function framedDigest(parts) {
  return sha256Hex(Buffer.concat(parts.map(frame)));
}

function naiveConcatenation(parts) {
  return Buffer.concat(parts.map((part) => Buffer.from(part, "utf8")));
}

function computePolicyHash(kindTag, policy) {
  assert.ok(POLICY_KIND_TAGS.includes(kindTag), `unknown policy kind tag ${String(kindTag)}`);
  return framedDigest([POLICY_DOMAIN, kindTag, canonicalSerialize(policy)]);
}

function decisionIdentityParts(domain, runId, graphRevision, nodeId, document) {
  assert.ok(Number.isSafeInteger(graphRevision) && graphRevision >= 0, "graphRevision must be a safe non-negative integer");
  const { decisionId: _omitted, ...withoutDecisionId } = document;
  return [domain, runId, String(graphRevision), nodeId, canonicalSerialize(withoutDecisionId)];
}

function computeDecisionId(domain, runId, graphRevision, nodeId, document) {
  return framedDigest(decisionIdentityParts(domain, runId, graphRevision, nodeId, document));
}

function computeGraphHash(graph) {
  return sha256Hex(Buffer.from(canonicalSerialize(graph), "utf8"));
}

function computeEvidenceHash(evidence) {
  return sha256Hex(Buffer.from(canonicalSerialize(evidence), "utf8"));
}

// ---------------------------------------------------------------------------
// Reference policy validation: the deterministic first invalid descendant.
// ---------------------------------------------------------------------------

function pointerToken(key) {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isPortableInteger(value, minimum, maximum) {
  return typeof value === "number"
    && Number.isInteger(value)
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function nestedShapeError(value, base, fieldOrder, check) {
  if (!isPlainObject(value)) return base;
  const known = new Set(fieldOrder);
  const unknown = Object.keys(value)
    .filter((key) => !known.has(key))
    .sort(compareUnicodeCodePoints);
  if (unknown.length > 0) return `${base}/${pointerToken(unknown[0])}`;
  for (const field of fieldOrder) {
    if (!Object.hasOwn(value, field) || !check(field, value[field])) return `${base}/${field}`;
  }
  return null;
}

/**
 * GE1421: relative path of the first invalid descendant, "" for a non-object
 * config, or null when the config is an exact IntegratedBarrierPolicy shape.
 */
function policyShapeError(config) {
  if (!isPlainObject(config)) return "";
  const unknown = Object.keys(config)
    .filter((key) => !POLICY_FIELD_SET.has(key))
    .sort(compareUnicodeCodePoints);
  if (unknown.length > 0) return `/${pointerToken(unknown[0])}`;
  for (const field of POLICY_FIELD_ORDER) {
    const present = Object.hasOwn(config, field);
    const value = config[field];
    switch (field) {
      case "apiVersion":
        // Unreachable for a claimed policy: an absent or wrong apiVersion means
        // the config was never claimed, so no diagnostic is produced at all.
        if (!present || value !== BARRIER_API_VERSION) return "/apiVersion";
        break;
      case "kind":
        if (!present || !KINDS.includes(value)) return "/kind";
        break;
      case "onUnsatisfied":
        if (!present || !ON_UNSATISFIED.includes(value)) return "/onUnsatisfied";
        break;
      case "lateArrival":
        if (!present || !LATE_ARRIVAL.includes(value)) return "/lateArrival";
        break;
      case "minimum":
        if (present && !isPortableInteger(value, 1, MAX_SAFE)) return "/minimum";
        break;
      case "basisPoints":
        if (present && !isPortableInteger(value, 1, 10000)) return "/basisPoints";
        break;
      case "quorum": {
        if (!present) break;
        const nested = nestedShapeError(value, "/quorum", QUORUM_FIELD_ORDER, (name, item) => (
          name === "accepts"
            ? isPortableInteger(item, 1, MAX_SAFE)
            : typeof item === "boolean"
        ));
        if (nested !== null) return nested;
        break;
      }
      case "deadline": {
        if (!present) break;
        const nested = nestedShapeError(value, "/deadline", DEADLINE_FIELD_ORDER, (_name, item) => (
          isPortableInteger(item, 1, MAX_SAFE)
        ));
        if (nested !== null) return nested;
        break;
      }
      default:
        assert.fail(`unhandled policy field ${field}`);
    }
  }
  return null;
}

/** GE1422: offending member path, or null when the cardinality is exact. */
function policyCardinalityError(config) {
  for (const field of CARDINALITY_FIELD_ORDER) {
    const requiredByKind = CARDINALITY_FIELD_REQUIRED_BY_KIND[config.kind] === field;
    const present = Object.hasOwn(config, field);
    if (requiredByKind !== present) return `/${field}`;
  }
  return null;
}

/** GE1424: threshold member path, or null. */
function policyThresholdError(config, incomingEdgeCount) {
  if (config.kind === "minimum" && config.minimum > incomingEdgeCount) return "/minimum";
  if (config.kind === "quorum" && config.quorum.accepts > incomingEdgeCount) return "/quorum/accepts";
  return null;
}

/**
 * Ownership. A barrier config is a claimed policy if and only if it is a
 * portable object carrying exactly the barrier apiVersion. Everything else is
 * not interpreted by this pass at all, which is what keeps pre-contract
 * configs such as {"condition": "all"} and {} compiling.
 */
function isClaimedPolicy(config) {
  return isPlainObject(config) && config.apiVersion === BARRIER_API_VERSION;
}

function referencePolicyDiagnostic(config) {
  if (!isClaimedPolicy(config)) return null;
  const shape = policyShapeError(config);
  if (shape !== null) return { code: GE1421, relativePath: shape };
  const cardinality = policyCardinalityError(config);
  if (cardinality !== null) return { code: GE1422, relativePath: cardinality };
  return null;
}

// ---------------------------------------------------------------------------
// Reference barrier pass over a whole Graph IR document.
// ---------------------------------------------------------------------------

function referenceBarrierDiagnostics(graph) {
  const incoming = new Map();
  for (const edge of graph.edges) {
    incoming.set(edge.to.node, (incoming.get(edge.to.node) ?? 0) + 1);
  }
  const byCategory = { [GE1421]: [], [GE1422]: [], [GE1423]: [], [GE1424]: [] };
  graph.nodes.forEach((node, index) => {
    if (node.kind !== "barrier") return;
    // Unclaimed barrier configs are not interpreted by this pass at all.
    if (!isClaimedPolicy(node.config)) return;
    const base = `#/nodes/${index}`;
    const edgeCount = incoming.get(node.id) ?? 0;
    const policyDiagnostic = referencePolicyDiagnostic(node.config);
    if (policyDiagnostic !== null) {
      byCategory[policyDiagnostic.code].push({
        code: policyDiagnostic.code,
        path: `${base}/config${policyDiagnostic.relativePath}`,
        nodeIds: [node.id],
      });
    }
    if (edgeCount === 0) {
      byCategory[GE1423].push({ code: GE1423, path: base, nodeIds: [node.id] });
    }
    // GE1421 suppresses GE1424 locally; GE1424 is only meaningful once the
    // threshold member exists and is exact.
    if (policyDiagnostic === null) {
      const threshold = policyThresholdError(node.config, edgeCount);
      if (threshold !== null) {
        byCategory[GE1424].push({
          code: GE1424,
          path: `${base}/config${threshold}`,
          nodeIds: [node.id],
        });
      }
    }
  });
  return BARRIER_DIAGNOSTIC_CODES.flatMap((code) => byCategory[code]);
}

// ---------------------------------------------------------------------------
// Reference satisfaction arithmetic.
// ---------------------------------------------------------------------------

function referenceDecision(policy, dispositions, barrierNodeId) {
  const counts = { succeeded: 0, failed: 0, missing: 0, timedOut: 0, abstained: 0, unknown: 0 };
  const lists = { acceptedIds: [], failedIds: [], missingIds: [], timedOutIds: [], abstainedIds: [], unknownIds: [] };
  for (const entry of dispositions) {
    counts[DISPOSITION_TO_COUNT[entry.disposition]] += 1;
    lists[DISPOSITION_TO_ID_LIST[entry.disposition]].push(entry.sourceNodeId);
  }
  const total = dispositions.length;
  let satisfied;
  let reasonCode;
  if (total === 0) {
    satisfied = false;
    reasonCode = "NO_ITEMS";
  } else if (policy.kind === "all") {
    satisfied = counts.succeeded === total;
    reasonCode = satisfied ? "ALL_SUCCEEDED" : "ALL_NOT_SUCCEEDED";
  } else if (policy.kind === "minimum") {
    if (policy.minimum > total) {
      satisfied = false;
      reasonCode = "MINIMUM_EXCEEDS_TOTAL";
    } else {
      satisfied = counts.succeeded >= policy.minimum;
      reasonCode = satisfied ? "MINIMUM_MET" : "MINIMUM_NOT_MET";
    }
  } else if (policy.kind === "percentage") {
    const left = counts.succeeded * 10000;
    const right = total * policy.basisPoints;
    assert.ok(Number.isSafeInteger(left) && Number.isSafeInteger(right), "percentage products must stay exact");
    satisfied = left >= right;
    reasonCode = satisfied ? "PERCENTAGE_MET" : "PERCENTAGE_NOT_MET";
  } else {
    const participants = total - (policy.quorum.countAbstainAsParticipant ? 0 : counts.abstained);
    if (policy.quorum.accepts > participants) {
      satisfied = false;
      reasonCode = "QUORUM_EXCEEDS_PARTICIPANTS";
    } else {
      satisfied = counts.succeeded >= policy.quorum.accepts;
      reasonCode = satisfied ? "QUORUM_MET" : "QUORUM_NOT_MET";
    }
  }
  const decision = {
    barrierNodeId,
    deadlineElapsed: counts.timedOut > 0,
    satisfied,
    reasonCode,
    resolution: satisfied ? "satisfied" : RESOLUTION_BY_ON_UNSATISFIED[policy.onUnsatisfied],
    total,
    ...counts,
    ...lists,
  };
  if (policy.kind === "quorum") {
    decision.votes = dispositions.map((entry) => {
      // votes is a complete one-record-per-entry census, not a list of received
      // ballots, so a non-voting arrival is recorded as not-cast.
      if (!Object.hasOwn(entry, "vote")) {
        return { sourceNodeId: entry.sourceNodeId, verdict: NOT_CAST };
      }
      const record = { sourceNodeId: entry.sourceNodeId, verdict: entry.vote.verdict };
      if (Object.hasOwn(entry.vote, "confidenceBasisPoints")) {
        record.confidenceBasisPoints = entry.vote.confidenceBasisPoints;
      }
      if (Object.hasOwn(entry.vote, "evidence")) {
        record.evidenceHash = computeEvidenceHash(entry.vote.evidence);
      }
      return record;
    });
  }
  return decision;
}

// ---------------------------------------------------------------------------
// Reference zero-rejudge replay fold.
// ---------------------------------------------------------------------------

function referenceReplayOutcome(testCase) {
  const seen = new Set();
  const adoptedNodeIds = [];
  for (const event of testCase.history) {
    const { nodeId } = event;
    if (seen.has(nodeId)) {
      return { outcome: "rejected", code: "DUPLICATE_DECISION", nodeId, adoptedNodeIds: [] };
    }
    seen.add(nodeId);
    const isRoute = event.type === "RouteSelected";
    const kindTag = isRoute ? "router" : "barrier";
    const domain = isRoute ? ROUTE_DECISION_DOMAIN : BARRIER_DECISION_DOMAIN;
    const currentPolicy = testCase.currentPolicies[nodeId];
    assert.ok(currentPolicy !== undefined, `${testCase.name} has no compiled policy for ${nodeId}`);
    const currentPolicyHash = computePolicyHash(kindTag, currentPolicy);
    if (currentPolicyHash !== event.data.policyHash) {
      return {
        outcome: "rejected",
        code: "DECISION_POLICY_DRIFT",
        nodeId,
        recordedPolicyHash: event.data.policyHash,
        currentPolicyHash,
        adoptedNodeIds: [],
      };
    }
    const recomputedDecisionId = computeDecisionId(
      domain,
      testCase.runId,
      testCase.graphRevision,
      nodeId,
      event.data,
    );
    if (recomputedDecisionId !== event.data.decisionId) {
      return {
        outcome: "rejected",
        code: "DECISION_IDENTITY_MISMATCH",
        nodeId,
        recordedDecisionId: event.data.decisionId,
        recomputedDecisionId,
        adoptedNodeIds: [],
      };
    }
    adoptedNodeIds.push(nodeId);
  }
  return { outcome: "adopted", adoptedNodeIds };
}

// ---------------------------------------------------------------------------
// Structural helpers.
// ---------------------------------------------------------------------------

/** Documentation fields may cite other spec files; expectation fields may not. */
function isProseKey(key) {
  return key === "note" || key === "notes" || key === "description" || key.endsWith("Note");
}

function collectStrings(value, sink) {
  if (typeof value === "string") {
    sink.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, sink);
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      sink.push(key);
      if (isProseKey(key)) continue;
      collectStrings(value[key], sink);
    }
  }
}

function assertDiagnosticProjection(diagnostic, label) {
  const keys = Object.keys(diagnostic);
  const expectedOrder = DIAGNOSTIC_FIELDS_IN_ORDER.filter((field) => keys.includes(field));
  assert.deepEqual(keys, expectedOrder, `${label} diagnostic field order drifted`);
  for (const field of keys) {
    assert.notEqual(diagnostic[field], null, `${label} materialized an absent diagnostic field as null`);
  }
  assert.ok(Array.isArray(diagnostic.nodeIds) && diagnostic.nodeIds.length > 0, `${label} names no node`);
}

/** Minimal conforming graph whose single barrier carries the supplied config. */
function ownershipProbeGraph(config) {
  const node = (id) => ({ id, kind: "transform", inputSchema: {}, outputSchema: {}, config: {} });
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "ownership-probe", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["seed"],
    outputs: { result: { node: "sink" } },
    nodes: [
      node("seed"),
      { id: "gate", kind: "barrier", inputSchema: {}, outputSchema: {}, config },
      node("sink"),
    ],
    edges: [
      { id: "seed-gate", from: { node: "seed" }, to: { node: "gate" } },
      { id: "gate-sink", from: { node: "gate" }, to: { node: "sink" } },
    ],
  };
}

function compileSchema(engine, schema, label) {
  assert.equal(
    engine.validateSchema(schema),
    true,
    `${label} is not a valid Draft 2020-12 schema: ${JSON.stringify(engine.errors)}`,
  );
  return engine.compile(schema);
}

// ---------------------------------------------------------------------------
// The fixture validator.
// ---------------------------------------------------------------------------

export async function validateIntegratedBarrierFixture() {
  const rawText = await readFile(CASE_PATH, "utf8");
  const fixture = JSON.parse(rawText);
  const [policySchema, voteSchema, barrierDecisionSchema, routeDecisionSchema, graphSchema] =
    await Promise.all(
      [
        POLICY_SCHEMA_PATH,
        VOTE_SCHEMA_PATH,
        BARRIER_DECISION_SCHEMA_PATH,
        ROUTE_DECISION_SCHEMA_PATH,
        GRAPH_SCHEMA_PATH,
      ].map(async (path) => JSON.parse(await readFile(path, "utf8"))),
    );

  const engine = new Ajv2020({ allErrors: true, strict: true });
  const validatePolicy = compileSchema(engine, policySchema, "integrated barrier policy schema");
  const validateVote = compileSchema(engine, voteSchema, "barrier vote schema");
  const validateBarrierDecision = compileSchema(engine, barrierDecisionSchema, "barrier decision schema");
  const validateRouteDecision = compileSchema(engine, routeDecisionSchema, "route decision schema");
  const validateGraph = compileSchema(engine, graphSchema, "graph schema");

  // --- corpus header ------------------------------------------------------
  assert.equal(fixture.contract, CONTRACT, "corpus contract identity drifted");
  assert.equal(fixture.implementationClaim, false, "this corpus must not claim an implementation");

  // Machine-readable honesty flags. Nothing implements this contract yet, so
  // every flag must be literally false. Flipping one is a reviewed edit.
  const claims = fixture.claims;
  assert.deepEqual(
    Object.keys(claims).sort(compareUnicodeCodePoints),
    CLAIM_FLAGS.slice().sort(compareUnicodeCodePoints),
    "the claim flag set drifted",
  );
  for (const flag of CLAIM_FLAGS) {
    assert.equal(claims[flag], false, `${flag} must be literally false until a lane implements it`);
    assert.equal(typeof claims[flag], "boolean", `${flag} must be a boolean`);
  }
  assert.deepEqual(
    fixture.diagnosticProjection.fieldsInOrder,
    DIAGNOSTIC_FIELDS_IN_ORDER,
    "diagnostic projection order drifted",
  );
  assert.equal(fixture.diagnosticProjection.absentFieldBehavior, "omit");
  assert.deepEqual(fixture.diagnosticCodes, BARRIER_DIAGNOSTIC_CODES, "barrier diagnostic code set drifted");
  assert.deepEqual(
    fixture.firstInvalidDescendantRule.policyFieldOrder,
    POLICY_FIELD_ORDER,
    "frozen policy contract order drifted",
  );
  assert.equal(
    fixture.firstInvalidDescendantRule.policyFieldOrder[0],
    "apiVersion",
    "the ownership discriminator must lead the normative contract order",
  );
  assert.equal(fixture.ownership.discriminator, "apiVersion");
  assert.equal(fixture.ownership.claimedApiVersion, BARRIER_API_VERSION, "claimed apiVersion drifted");
  assert.equal(fixture.ownership.nonObjectConfigsCannotClaim, true);
  assert.deepEqual(fixture.ownership.unreachableDiagnosticPaths, ["", "/apiVersion"]);
  assert.equal(
    policySchema.properties.apiVersion.const,
    BARRIER_API_VERSION,
    "integrated-barrier-policy.schema.json ownership discriminator drifted",
  );
  assert.ok(
    policySchema.required.includes("apiVersion"),
    "the ownership discriminator must be required by the frozen policy schema",
  );
  // The policy and the vote carrier deliberately share an apiVersion; they are
  // separated by kind, so a vote pasted into a barrier config is still claimed.
  assert.equal(
    voteSchema.properties.apiVersion.const,
    BARRIER_API_VERSION,
    "the vote carrier no longer shares the barrier apiVersion",
  );
  assert.equal(fixture.ownership.sharedWithVoteCarrier, true);
  assert.deepEqual(fixture.firstInvalidDescendantRule.quorumFieldOrder, QUORUM_FIELD_ORDER);
  assert.deepEqual(fixture.firstInvalidDescendantRule.deadlineFieldOrder, DEADLINE_FIELD_ORDER);
  assert.deepEqual(fixture.firstInvalidDescendantRule.cardinalityFieldOrder, CARDINALITY_FIELD_ORDER);
  assert.deepEqual(fixture.vocabulary.kinds, KINDS);
  assert.deepEqual(fixture.vocabulary.dispositions, DISPOSITIONS);
  assert.deepEqual(fixture.vocabulary.verdicts, VERDICTS);
  assert.deepEqual(fixture.vocabulary.voteRecordVerdicts, VOTE_RECORD_VERDICTS);
  assert.deepEqual(fixture.vocabulary.decisionOnlyVerdicts, [NOT_CAST]);
  assert.deepEqual(fixture.vocabulary.nonVotingDispositions, NON_VOTING_DISPOSITIONS);
  assert.deepEqual(fixture.vocabulary.verdictToDisposition, VERDICT_TO_DISPOSITION);
  assert.equal(
    Object.hasOwn(VERDICT_TO_DISPOSITION, NOT_CAST),
    false,
    "not-cast must never map to a disposition; it is produced by the census, not by a ballot",
  );
  assert.deepEqual(
    fixture.voteCensus.castVerdictsComeFromTheUpstreamCarrier,
    VERDICTS,
    "the cast verdict set drifted from the upstream vote carrier",
  );
  assert.equal(fixture.voteCensus.decisionOnlyVerdict, NOT_CAST);
  assert.deepEqual(fixture.voteCensus.notCastAppliesExactlyTo, NON_VOTING_DISPOSITIONS);
  assert.equal(fixture.voteCensus.upstreamMayNeverCastNotCast, true);
  assert.deepEqual(fixture.vocabulary.reasonCodes, REASON_CODES, "the eleven-member reason code set drifted");
  assert.deepEqual(fixture.vocabulary.routeReasonCodes, ROUTE_REASON_CODES, "RouteSelectionReasonCode set drifted");
  assert.deepEqual(fixture.vocabulary.routeDecisionNullableMembers, ["confidenceBasisPoints"]);
  assert.deepEqual(fixture.vocabulary.onUnsatisfied, ON_UNSATISFIED);
  assert.deepEqual(fixture.vocabulary.lateArrival, LATE_ARRIVAL);
  assert.deepEqual(fixture.vocabulary.resolutionByOnUnsatisfied, RESOLUTION_BY_ON_UNSATISFIED);
  assert.deepEqual(fixture.vocabulary.dispositionToCountField, DISPOSITION_TO_COUNT);
  assert.deepEqual(fixture.vocabulary.dispositionToIdList, DISPOSITION_TO_ID_LIST);
  assert.deepEqual(fixture.vocabulary.replayRejectionCodes, REPLAY_REJECTION_CODES);

  // The RouteDecision enum must equal the published RouteSelectionReasonCode.
  assert.deepEqual(
    routeDecisionSchema.properties.reasonCode.enum,
    ROUTE_REASON_CODES,
    "route-decision.schema.json reasonCode no longer mirrors RouteSelectionReasonCode",
  );
  assert.deepEqual(
    routeDecisionSchema.properties.confidenceBasisPoints.type,
    ["integer", "null"],
    "route-decision.schema.json confidenceBasisPoints must admit explicit null",
  );
  assert.deepEqual(
    barrierDecisionSchema.properties.reasonCode.enum,
    REASON_CODES,
    "barrier-decision.schema.json reason codes drifted from the semantics document",
  );

  // The census verdict set has five members; the upstream carrier has four and
  // must never admit not-cast.
  assert.deepEqual(
    barrierDecisionSchema.properties.votes.items.properties.verdict.enum,
    VOTE_RECORD_VERDICTS,
    "BarrierVoteRecord verdict set drifted",
  );
  assert.deepEqual(
    voteSchema.properties.verdict.enum,
    VERDICTS,
    "BarrierVote carrier verdict set drifted",
  );
  assert.equal(
    voteSchema.properties.verdict.enum.includes(NOT_CAST),
    false,
    "the upstream vote carrier must never admit not-cast",
  );
  assert.equal(
    validateVote({
      apiVersion: "graphengineering.reacher-z.github.io/barrier/v1alpha1",
      kind: "BarrierVote",
      verdict: NOT_CAST,
    }),
    false,
    "an upstream must not be able to cast not-cast",
  );

  // Identifier patterns: node IDs are Graph IR node IDs, route keys are wider.
  assert.equal(
    barrierDecisionSchema.$defs.safeId.pattern,
    NODE_ID_PATTERN,
    "barrier-decision.schema.json node ID pattern drifted from the Graph IR node ID",
  );
  assert.equal(
    routeDecisionSchema.$defs.safeId.pattern,
    NODE_ID_PATTERN,
    "route-decision.schema.json node ID pattern drifted from the Graph IR node ID",
  );
  assert.equal(
    graphSchema.$defs.node.properties.id.pattern,
    NODE_ID_PATTERN,
    "graph.schema.json node ID pattern drifted, so the decision schemas are no longer bound to it",
  );
  assert.equal(
    routeDecisionSchema.$defs.safeRouteId.pattern,
    SAFE_ROUTE_ID_PATTERN,
    "route-decision.schema.json SafeRouteId pattern drifted",
  );
  assert.deepEqual(
    routeDecisionSchema.$defs.safeRouteId.not.enum,
    RESERVED_ROUTE_KEYS,
    "route-decision.schema.json must still exclude '.' and '..' as route keys",
  );
  assert.equal(
    routeDecisionSchema.$defs.routeList.items.$ref,
    "#/$defs/safeRouteId",
    "route lists must use SafeRouteId, not the node ID pattern",
  );
  assert.notEqual(
    NODE_ID_PATTERN,
    SAFE_ROUTE_ID_PATTERN,
    "the node ID and route key patterns must stay distinct",
  );
  assert.deepEqual(fixture.identifierContract.nodeIdPattern, NODE_ID_PATTERN);
  assert.deepEqual(fixture.identifierContract.safeRouteIdPattern, SAFE_ROUTE_ID_PATTERN);
  assert.deepEqual(fixture.identifierContract.reservedRouteKeys, RESERVED_ROUTE_KEYS);

  // --- hashContract -------------------------------------------------------
  const hashContract = fixture.hashContract;
  assert.equal(hashContract.policyHashDomain, POLICY_DOMAIN, "policy hash domain drifted");
  assert.equal(hashContract.barrierDecisionDomain, BARRIER_DECISION_DOMAIN, "barrier decision domain drifted");
  assert.equal(hashContract.routeDecisionDomain, ROUTE_DECISION_DOMAIN, "route decision domain drifted");
  assert.deepEqual(hashContract.policyKindTags, POLICY_KIND_TAGS);
  assert.equal(
    hashContract.framing,
    "frame(s) = uint32be(byteLength(utf8(s))) || utf8(s)",
    "framing rule drifted",
  );
  assert.deepEqual(hashContract.policyHashFrames, [
    "policyHashDomain",
    "policyKindTag",
    "canonicalSerialize(policy)",
  ]);
  assert.deepEqual(hashContract.decisionIdFrames, [
    "decisionDomain",
    "runId",
    "decimal(graphRevision)",
    "nodeId",
    "canonicalSerialize(document without decisionId)",
  ]);
  assert.equal(hashContract.digest, "SHA-256, rendered lowercase hexadecimal");
  assert.equal(hashContract.graphHash, "sha256(utf8(canonicalSerialize(graph)))");
  assert.equal(hashContract.evidenceHash, "sha256(utf8(canonicalSerialize(evidence)))");
  assert.match(hashContract.canonicalSerializer, /ascending Unicode code-point order/u);

  const separation = hashContract.domainSeparation;
  assert.equal(
    separation.canonicalPolicy,
    canonicalSerialize(separation.policy),
    "domain separation canonical policy bytes drifted",
  );
  assert.equal(
    separation.barrierPolicyHash,
    computePolicyHash("barrier", separation.policy),
    "domain separation barrier policy hash drifted",
  );
  assert.equal(
    separation.routerPolicyHash,
    computePolicyHash("router", separation.policy),
    "domain separation router policy hash drifted",
  );
  assert.notEqual(
    separation.barrierPolicyHash,
    separation.routerPolicyHash,
    "barrier and router policy hashes must not collide on identical policy bytes",
  );

  // --- no imported expectations ------------------------------------------
  assert.deepEqual(
    fixture.provenance.expectationsImportedFromOtherFixtures,
    [],
    "this corpus must declare zero imported expectations",
  );
  const corpusStrings = [];
  collectStrings(fixture, corpusStrings);
  for (const text of corpusStrings) {
    assert.equal(
      /\.case\.json/u.test(text),
      false,
      `corpus references another conformance case file: ${text}`,
    );
    assert.equal(
      text.includes("spec/conformance/"),
      false,
      `corpus references the conformance directory: ${text}`,
    );
  }
  const validatorSource = await readFile(fileURLToPath(import.meta.url), "utf8");
  const referencedCaseFiles = new Set(validatorSource.match(/[a-z0-9-]+\.case\.json/gu) ?? []);
  assert.deepEqual(
    [...referencedCaseFiles],
    ["integrated-barrier.case.json"],
    "this validator must read no other conformance corpus",
  );

  // --- ownershipCases -----------------------------------------------------
  // This is the assertion the revision exists for: no unclaimed barrier config
  // may produce any GE142x diagnostic.
  const ownershipCases = fixture.ownershipCases;
  assert.ok(ownershipCases.length >= 8, `ownershipCases must hold at least 8 cases, saw ${ownershipCases.length}`);
  assert.equal(
    new Set(ownershipCases.map(({ name }) => name)).size,
    ownershipCases.length,
    "ownershipCases names are not unique",
  );
  let unclaimedOwnershipCases = 0;
  let claimedOwnershipCases = 0;
  for (const testCase of ownershipCases) {
    const label = `ownershipCases/${testCase.name}`;
    const claimed = isClaimedPolicy(testCase.config);
    assert.equal(claimed, testCase.expect.claimed, `${label} ownership claim drifted`);
    const diagnostic = referencePolicyDiagnostic(testCase.config);
    if (!claimed) {
      unclaimedOwnershipCases += 1;
      assert.deepEqual(
        testCase.expect.diagnostics,
        [],
        `${label} is unclaimed, so the barrier pass must emit nothing for it`,
      );
      assert.equal(diagnostic, null, `${label} unclaimed config produced a diagnostic`);
      // Prove it end to end: the same config inside a real graph emits nothing.
      const probe = ownershipProbeGraph(testCase.config);
      assert.deepEqual(
        referenceBarrierDiagnostics(probe),
        [],
        `${label} produced a barrier diagnostic when compiled inside a graph`,
      );
      assert.equal(
        validateGraph(probe),
        true,
        `${label} probe graph does not conform: ${JSON.stringify(validateGraph.errors)}`,
      );
    } else {
      claimedOwnershipCases += 1;
      const expected = testCase.expect.diagnostics;
      assert.deepEqual(
        diagnostic === null ? [] : [{ code: diagnostic.code, relativePath: diagnostic.relativePath }],
        expected,
        `${label} claimed-policy diagnostic drifted`,
      );
    }
    assert.equal(
      validatePolicy(testCase.config),
      testCase.expect.claimed && testCase.expect.diagnostics.length === 0,
      `${label} frozen schema acceptance disagrees with the claimed/clean expectation`,
    );
  }
  assert.ok(unclaimedOwnershipCases >= 6, "ownershipCases must exercise several unclaimed shapes");
  assert.ok(claimedOwnershipCases >= 3, "ownershipCases must exercise claimed carriers too");
  for (const legacy of [{ condition: "all" }, {}]) {
    assert.ok(
      ownershipCases.some((item) => (
        canonicalSerialize(item.config) === canonicalSerialize(legacy)
        && item.expect.claimed === false
        && item.expect.diagnostics.length === 0
      )),
      `ownershipCases must prove the pre-contract config ${canonicalSerialize(legacy)} is untouched`,
    );
  }
  assert.ok(
    ownershipCases.some((item) => (
      item.config !== null
      && typeof item.config === "object"
      && !Array.isArray(item.config)
      && item.config.apiVersion === BARRIER_API_VERSION
      && item.config.kind === "BarrierVote"
      && item.expect.claimed === true
      && item.expect.diagnostics.length === 1
    )),
    "ownershipCases must freeze the shared-apiVersion consequence for a BarrierVote-shaped config",
  );

  // --- policyCases --------------------------------------------------------
  const policyCases = fixture.policyCases;
  assert.ok(policyCases.length >= 34, `policyCases must hold at least 34 cases, saw ${policyCases.length}`);
  assert.equal(
    new Set(policyCases.map(({ name }) => name)).size,
    policyCases.length,
    "policyCases names are not unique",
  );
  const policyCodeCoverage = new Set();
  let validPolicyCases = 0;
  let unclaimedPolicyCases = 0;
  for (const testCase of policyCases) {
    const label = `policyCases/${testCase.name}`;
    const claimed = isClaimedPolicy(testCase.config);
    assert.equal(claimed, testCase.expect.claimed, `${label} ownership claim drifted`);
    const expected = referencePolicyDiagnostic(testCase.config);
    if (!claimed) {
      // Not a claimed policy: never valid, and never a diagnostic either.
      assert.equal(testCase.expect.valid, false, `${label} an unclaimed config cannot be a valid policy`);
      assert.equal(expected, null, `${label} unclaimed config produced a diagnostic`);
      assert.equal(Object.hasOwn(testCase.expect, "code"), false, `${label} unclaimed case carries a code`);
      assert.equal(Object.hasOwn(testCase.expect, "relativePath"), false, `${label} unclaimed case carries a path`);
      assert.equal(Object.hasOwn(testCase.expect, "policy"), false, `${label} unclaimed case carries a policy`);
      assert.equal(
        validatePolicy(testCase.config),
        false,
        `${label} unclaimed config must not conform to the frozen policy schema`,
      );
      unclaimedPolicyCases += 1;
      continue;
    }
    if (testCase.expect.valid) {
      validPolicyCases += 1;
      assert.equal(expected, null, `${label} is expected valid but the reference rule rejects it`);
      assert.deepEqual(
        testCase.expect.policy,
        testCase.config,
        `${label} normalized policy snapshot drifted from the portable config`,
      );
      assert.equal(
        validatePolicy(testCase.config),
        true,
        `${label} is expected valid but the frozen schema rejects it: ${JSON.stringify(validatePolicy.errors)}`,
      );
      assert.equal(Object.hasOwn(testCase.expect, "relativePath"), false, `${label} valid case carries a path`);
      assert.equal(Object.hasOwn(testCase.expect, "code"), false, `${label} valid case carries a code`);
    } else {
      assert.notEqual(expected, null, `${label} is expected invalid but the reference rule accepts it`);
      assert.equal(testCase.expect.code, expected.code, `${label} diagnostic code drifted`);
      assert.equal(
        testCase.expect.relativePath,
        expected.relativePath,
        `${label} first invalid descendant path drifted`,
      );
      assert.equal(
        validatePolicy(testCase.config),
        false,
        `${label} is expected invalid but the frozen schema accepts it`,
      );
      assert.equal(Object.hasOwn(testCase.expect, "policy"), false, `${label} invalid case carries a policy`);
      policyCodeCoverage.add(expected.code);
    }
    if (Object.hasOwn(testCase, "integerSourceLiteral")) {
      assert.ok(
        rawText.includes(testCase.integerSourceLiteral),
        `${label} JSON source literal ${testCase.integerSourceLiteral} is not present in the corpus text`,
      );
    }
  }
  assert.ok(validPolicyCases >= 4, "policyCases must accept every policy kind");
  assert.deepEqual(
    [...policyCodeCoverage].sort(),
    [GE1421, GE1422],
    "policyCases must exercise both GE1421 and GE1422",
  );
  for (const kind of KINDS) {
    assert.ok(
      policyCases.some((item) => item.expect.valid && item.config.kind === kind),
      `policyCases must accept at least one valid ${kind} policy`,
    );
  }
  for (const member of ON_UNSATISFIED) {
    assert.ok(
      policyCases.some((item) => item.expect.valid && item.config.onUnsatisfied === member),
      `policyCases must accept a policy whose onUnsatisfied is ${member}`,
    );
  }
  for (const member of LATE_ARRIVAL) {
    assert.ok(
      policyCases.some((item) => item.expect.valid && item.config.lateArrival === member),
      `policyCases must accept a policy whose lateArrival is ${member}`,
    );
  }
  // Revision 2 makes both of these unreachable: a claimed policy is by
  // definition a portable object carrying the exact apiVersion.
  for (const unreachable of ["", "/apiVersion"]) {
    assert.equal(
      policyCases.some((item) => item.expect.claimed && item.expect.relativePath === unreachable),
      false,
      `no claimed policy can report a diagnostic at '${unreachable}'`,
    );
  }
  assert.ok(
    unclaimedPolicyCases >= 8,
    `policyCases must exercise the unclaimed branch, saw ${unclaimedPolicyCases}`,
  );
  for (const shape of [null, 1, "all", true, []]) {
    assert.ok(
      policyCases.some((item) => (
        canonicalSerialize(item.config) === canonicalSerialize(shape) && item.expect.claimed === false
      )),
      `policyCases must prove ${canonicalSerialize(shape)} cannot carry an ownership claim`,
    );
  }
  assert.ok(
    policyCases.some((item) => (
      item.expect.claimed === false
      && isPlainObject(item.config)
      && !Object.hasOwn(item.config, "apiVersion")
      && Object.hasOwn(item.config, "kind")
    )),
    "policyCases must include a missing-apiVersion witness",
  );

  // --- compilerCases ------------------------------------------------------
  const compilerCases = fixture.compilerCases;
  assert.ok(compilerCases.length >= 10, `compilerCases must hold at least 10 graphs, saw ${compilerCases.length}`);
  assert.equal(
    new Set(compilerCases.map(({ name }) => name)).size,
    compilerCases.length,
    "compilerCases names are not unique",
  );
  const diagnosticCodeCoverage = new Set();
  for (const testCase of compilerCases) {
    const label = `compilerCases/${testCase.name}`;
    assert.equal(
      validateGraph(testCase.graph),
      true,
      `${label} graph does not conform to graph.schema.json: ${JSON.stringify(validateGraph.errors)}`,
    );
    assert.equal(
      testCase.graphHash,
      computeGraphHash(testCase.graph),
      `${label} literal graph hash drifted from the canonical serialization`,
    );
    assert.match(testCase.graphHash, /^[0-9a-f]{64}$/u, `${label} graph hash is not lowercase hex SHA-256`);
    assert.equal(
      testCase.expectValid,
      testCase.expectDiagnostics.length === 0,
      `${label} validity flag disagrees with its diagnostics`,
    );
    for (const diagnostic of testCase.expectDiagnostics) {
      assertDiagnosticProjection(diagnostic, label);
      diagnosticCodeCoverage.add(diagnostic.code);
      for (const nodeId of diagnostic.nodeIds) {
        assert.ok(
          testCase.graph.nodes.some((node) => node.id === nodeId),
          `${label} names an absent node ${nodeId}`,
        );
      }
    }
    const observedBarrier = testCase.expectDiagnostics.filter((item) => (
      BARRIER_DIAGNOSTIC_CODE_SET.has(item.code)
    ));
    assert.deepEqual(
      observedBarrier,
      referenceBarrierDiagnostics(testCase.graph),
      `${label} barrier diagnostics or their emission order drifted`,
    );
    const foreign = testCase.expectDiagnostics
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !BARRIER_DIAGNOSTIC_CODE_SET.has(item.code));
    for (const { item } of foreign) {
      assert.ok(
        ROUTER_PASS_CODES.has(item.code),
        `${label} carries a diagnostic ${item.code} outside the router and barrier passes`,
      );
    }
    const firstBarrierIndex = testCase.expectDiagnostics.findIndex((item) => (
      BARRIER_DIAGNOSTIC_CODE_SET.has(item.code)
    ));
    if (firstBarrierIndex >= 0) {
      for (const { index } of foreign) {
        assert.ok(
          index < firstBarrierIndex,
          `${label} emits a router-pass diagnostic after the barrier pass`,
        );
      }
    }
  }
  for (const code of BARRIER_DIAGNOSTIC_CODES) {
    assert.ok(diagnosticCodeCoverage.has(code), `compilerCases never exercise ${code}`);
  }
  assert.ok(
    compilerCases.some((item) => item.expectDiagnostics.length === 0),
    "compilerCases must include a fully valid multi-barrier graph",
  );
  assert.ok(
    compilerCases.some((item) => (
      item.expectDiagnostics.filter((entry) => entry.code === GE1421).length >= 2
    )),
    "compilerCases must prove node declaration order within a category",
  );
  assert.ok(
    compilerCases.some((item) => (
      item.expectDiagnostics.some((entry) => ROUTER_PASS_CODES.has(entry.code))
      && item.expectDiagnostics.some((entry) => BARRIER_DIAGNOSTIC_CODE_SET.has(entry.code))
    )),
    "compilerCases must prove the router pass emits before the barrier pass",
  );
  assert.ok(
    compilerCases.some((item) => {
      const codes = item.expectDiagnostics.map((entry) => entry.code);
      return codes.includes(GE1421) && codes.includes(GE1423)
        && item.expectDiagnostics.filter((entry) => entry.code === GE1421)[0].nodeIds[0]
          === item.expectDiagnostics.filter((entry) => entry.code === GE1423)[0].nodeIds[0];
    }),
    "compilerCases must prove GE1421 does not suppress GE1423 on the same node",
  );

  // The semantics document is ambiguous for one configuration: the ownership
  // section says an unclaimed config produces no diagnostic from this pass,
  // while the GE1423 table row is unqualified. The corpus must therefore
  // contain no unclaimed barrier with zero incoming edges, so that it freezes
  // no guess about the open question.
  for (const testCase of compilerCases) {
    const incoming = new Map();
    for (const edge of testCase.graph.edges) {
      incoming.set(edge.to.node, (incoming.get(edge.to.node) ?? 0) + 1);
    }
    for (const node of testCase.graph.nodes) {
      if (node.kind !== "barrier" || isClaimedPolicy(node.config)) continue;
      assert.notEqual(
        incoming.get(node.id) ?? 0,
        0,
        `compilerCases/${testCase.name} places an unclaimed barrier with zero incoming edges, which the contract does not yet resolve`,
      );
    }
  }
  assert.ok(
    compilerCases.some((testCase) => testCase.graph.nodes.some((node) => (
      node.kind === "barrier" && !isClaimedPolicy(node.config)
    )) && testCase.graph.nodes.some((node) => (
      node.kind === "barrier" && isClaimedPolicy(node.config)
    ))),
    "compilerCases must contain a graph mixing a legacy barrier with a claimed policy barrier",
  );
  for (const testCase of compilerCases) {
    for (const diagnostic of testCase.expectDiagnostics) {
      if (!BARRIER_DIAGNOSTIC_CODE_SET.has(diagnostic.code)) continue;
      const node = testCase.graph.nodes.find((item) => item.id === diagnostic.nodeIds[0]);
      assert.ok(
        isClaimedPolicy(node.config),
        `compilerCases/${testCase.name} emits ${diagnostic.code} for the unclaimed barrier ${node.id}`,
      );
    }
  }

  // GE1422 suppresses GE1424 on the same node. The witness must be a barrier
  // whose threshold member genuinely exceeds its incoming-edge count, so that
  // GE1424 would fire if the chain were not honoured.
  assert.ok(
    compilerCases.some((testCase) => {
      const incoming = new Map();
      for (const edge of testCase.graph.edges) {
        incoming.set(edge.to.node, (incoming.get(edge.to.node) ?? 0) + 1);
      }
      return testCase.graph.nodes.some((node) => {
        if (node.kind !== "barrier" || !isPlainObject(node.config)) return false;
        const diagnostic = referencePolicyDiagnostic(node.config);
        if (diagnostic === null || diagnostic.code !== GE1422) return false;
        const edgeCount = incoming.get(node.id) ?? 0;
        // The threshold member is present and exact but out of range.
        const overThreshold =
          (isPortableInteger(node.config.minimum, 1, MAX_SAFE) && node.config.minimum > edgeCount)
          || (isPlainObject(node.config.quorum)
            && isPortableInteger(node.config.quorum.accepts, 1, MAX_SAFE)
            && node.config.quorum.accepts > edgeCount);
        if (!overThreshold) return false;
        const emitted = testCase.expectDiagnostics.filter((item) => item.nodeIds[0] === node.id);
        return emitted.some((item) => item.code === GE1422)
          && !emitted.some((item) => item.code === GE1424);
      });
    }),
    "compilerCases must prove GE1422 suppresses GE1424 on the same node",
  );

  // --- identifierCases ----------------------------------------------------
  const identifierCases = fixture.identifierCases;
  assert.ok(identifierCases.length >= 8, `identifierCases must hold at least 8 cases, saw ${identifierCases.length}`);
  assert.equal(
    new Set(identifierCases.map(({ name }) => name)).size,
    identifierCases.length,
    "identifierCases names are not unique",
  );
  for (const [kind, document] of Object.entries(fixture.identifierBaseDocuments)) {
    const validateDocument = kind === "RouteDecision" ? validateRouteDecision : validateBarrierDecision;
    assert.equal(
      validateDocument(document),
      true,
      `identifier base document ${kind} does not conform: ${JSON.stringify(validateDocument.errors)}`,
    );
  }
  let leadingDigitNodeIdRejections = 0;
  let leadingDigitRouteKeyAcceptances = 0;
  let reservedRouteKeyRejections = 0;
  for (const testCase of identifierCases) {
    const label = `identifierCases/${testCase.name}`;
    const base = fixture.identifierBaseDocuments[testCase.documentKind];
    assert.ok(base !== undefined, `${label} names an unknown document kind`);
    const document = structuredClone(base);
    const tokens = testCase.path.slice(1).split("/").map((token) => (
      token.replaceAll("~1", "/").replaceAll("~0", "~")
    ));
    let parent = document;
    for (const token of tokens.slice(0, -1)) {
      assert.ok(parent !== null && typeof parent === "object", `${label} path parent is not a container`);
      parent = parent[token];
    }
    const leaf = tokens.at(-1);
    assert.ok(
      Object.hasOwn(parent, Array.isArray(parent) ? Number(leaf) : leaf),
      `${label} path ${testCase.path} does not exist in the base document`,
    );
    parent[leaf] = testCase.value;
    const validateDocument = testCase.documentKind === "RouteDecision"
      ? validateRouteDecision
      : validateBarrierDecision;
    const accepted = validateDocument(document);
    assert.equal(
      accepted,
      testCase.expect.valid,
      `${label} identifier acceptance drifted (${testCase.expect.reason})`,
    );
    // Cross-check the outcome against the two patterns directly, so the corpus
    // cannot encode a schema/pattern disagreement.
    const isRouteKey = fixture.identifierContract.routeKeyMembers.some((member) => (
      member.startsWith(`${testCase.documentKind}.`)
      && testCase.path.startsWith(`/${member.split(".")[1].replace("[]", "")}`)
    ));
    const pattern = new RegExp(isRouteKey ? SAFE_ROUTE_ID_PATTERN : NODE_ID_PATTERN, "u");
    const patternAccepts = pattern.test(testCase.value)
      && !(isRouteKey && RESERVED_ROUTE_KEYS.includes(testCase.value));
    assert.equal(
      patternAccepts,
      testCase.expect.valid,
      `${label} disagrees with the ${isRouteKey ? "SafeRouteId" : "node ID"} pattern`,
    );
    if (!isRouteKey && !testCase.expect.valid && /^[0-9]/u.test(testCase.value)) {
      leadingDigitNodeIdRejections += 1;
    }
    if (isRouteKey && testCase.expect.valid && /^[0-9]/u.test(testCase.value)) {
      leadingDigitRouteKeyAcceptances += 1;
    }
    if (isRouteKey && RESERVED_ROUTE_KEYS.includes(testCase.value)) {
      assert.equal(testCase.expect.valid, false, `${label} must reject a reserved route key`);
      reservedRouteKeyRejections += 1;
    }
  }
  assert.ok(
    leadingDigitNodeIdRejections >= 2,
    "identifierCases must reject a leading-digit node ID in more than one member",
  );
  assert.ok(
    leadingDigitRouteKeyAcceptances >= 2,
    "identifierCases must accept a leading-digit route key",
  );
  assert.equal(
    reservedRouteKeyRejections,
    RESERVED_ROUTE_KEYS.length,
    "identifierCases must reject every reserved route key",
  );
  assert.ok(
    identifierCases.some((item) => item.expect.valid && !/^[0-9]/u.test(item.value)),
    "identifierCases must include an accepting control",
  );

  // No node identifier used anywhere in the corpus may begin with a digit.
  const nodeIdPattern = new RegExp(NODE_ID_PATTERN, "u");
  for (const testCase of fixture.evaluationCases) {
    for (const id of [testCase.barrierNodeId, ...testCase.dispositions.map((e) => e.sourceNodeId)]) {
      assert.match(id, nodeIdPattern, `evaluationCases/${testCase.name} uses a non-Graph-IR node ID ${id}`);
    }
  }
  for (const testCase of fixture.identityCases) {
    assert.match(testCase.nodeId, nodeIdPattern, `identityCases/${testCase.name} uses a non-Graph-IR node ID`);
  }
  for (const testCase of fixture.replayCases) {
    for (const event of testCase.history) {
      assert.match(event.nodeId, nodeIdPattern, `replayCases/${testCase.name} uses a non-Graph-IR node ID`);
    }
  }
  for (const testCase of fixture.compilerCases) {
    for (const node of testCase.graph.nodes) {
      assert.match(node.id, nodeIdPattern, `compilerCases/${testCase.name} uses a non-Graph-IR node ID`);
    }
  }

  // --- evaluationCases ----------------------------------------------------
  const evaluationCases = fixture.evaluationCases;
  assert.ok(
    evaluationCases.length >= 30,
    `evaluationCases must hold at least 30 cases, saw ${evaluationCases.length}`,
  );
  assert.equal(
    new Set(evaluationCases.map(({ name }) => name)).size,
    evaluationCases.length,
    "evaluationCases names are not unique",
  );
  const reasonCodeCoverage = new Set();
  const resolutionCoverage = new Set();
  const onUnsatisfiedCoverage = new Set();
  const lateArrivalCoverage = new Set();
  const dispositionCoverage = new Set();
  const voteRecordVerdictCoverage = new Set();
  for (const testCase of evaluationCases) {
    const label = `evaluationCases/${testCase.name}`;
    assert.equal(
      validatePolicy(testCase.policy),
      true,
      `${label} policy does not conform: ${JSON.stringify(validatePolicy.errors)}`,
    );
    onUnsatisfiedCoverage.add(testCase.policy.onUnsatisfied);
    lateArrivalCoverage.add(testCase.policy.lateArrival);

    const sourceIds = testCase.dispositions.map((entry) => entry.sourceNodeId);
    assert.equal(new Set(sourceIds).size, sourceIds.length, `${label} repeats a source node ID`);
    for (const entry of testCase.dispositions) {
      assert.ok(DISPOSITIONS.includes(entry.disposition), `${label} uses an unknown disposition`);
      dispositionCoverage.add(entry.disposition);
      if (testCase.policy.kind === "quorum") {
        // A quorum entry carries a ballot if and only if it is a voting
        // disposition. missing and timed_out entries never produce one.
        const nonVoting = NON_VOTING_DISPOSITIONS.includes(entry.disposition);
        assert.equal(
          Object.hasOwn(entry, "vote"),
          !nonVoting,
          `${label} entry ${entry.sourceNodeId} carries a ballot if and only if it is a voting disposition`,
        );
        if (nonVoting) continue;
        assert.equal(
          validateVote(entry.vote),
          true,
          `${label} vote does not conform: ${JSON.stringify(validateVote.errors)}`,
        );
        assert.equal(
          VERDICT_TO_DISPOSITION[entry.vote.verdict],
          entry.disposition,
          `${label} vote verdict and disposition disagree for ${entry.sourceNodeId}`,
        );
      } else {
        assert.equal(Object.hasOwn(entry, "vote"), false, `${label} non-quorum barrier inspects a vote`);
        assert.ok(
          entry.disposition !== "abstained" && entry.disposition !== "unknown",
          `${label} synthesizes a quorum-only disposition on a ${testCase.policy.kind} barrier`,
        );
      }
    }

    const expected = referenceDecision(testCase.policy, testCase.dispositions, testCase.barrierNodeId);
    assert.deepEqual(
      testCase.expect,
      expected,
      `${label} recomputed decision projection drifted from the stored expectation`,
    );
    reasonCodeCoverage.add(testCase.expect.reasonCode);
    resolutionCoverage.add(testCase.expect.resolution);

    // Count sum and ID list partition.
    const countSum = COUNT_FIELDS.reduce((total, field) => total + testCase.expect[field], 0);
    assert.equal(countSum, testCase.expect.total, `${label} count fields do not sum to total`);
    const partition = ID_LIST_FIELDS.flatMap((field) => testCase.expect[field]);
    assert.equal(partition.length, testCase.expect.total, `${label} ID lists do not cover every entry`);
    assert.equal(
      new Set(partition).size,
      partition.length,
      `${label} ID lists overlap, so they are not a partition`,
    );
    assert.deepEqual(
      [...partition].sort(compareUnicodeCodePoints),
      [...sourceIds].sort(compareUnicodeCodePoints),
      `${label} ID lists do not partition the disposition entries`,
    );
    for (const field of ID_LIST_FIELDS) {
      const list = testCase.expect[field];
      const inOrder = sourceIds.filter((id) => list.includes(id));
      assert.deepEqual(list, inOrder, `${label} ${field} is not in incoming-edge declaration order`);
    }
    assert.equal(
      Object.hasOwn(testCase.expect, "votes"),
      testCase.policy.kind === "quorum",
      `${label} votes must be present if and only if the policy kind is quorum`,
    );
    if (testCase.policy.kind === "quorum") {
      assert.equal(
        testCase.expect.votes.length,
        testCase.expect.total,
        `${label} must carry exactly one vote record per disposition entry`,
      );
      assert.deepEqual(
        testCase.expect.votes.map((record) => record.sourceNodeId),
        sourceIds,
        `${label} vote records are not in incoming-edge declaration order`,
      );
      const dispositionBySource = new Map(
        testCase.dispositions.map((entry) => [entry.sourceNodeId, entry.disposition]),
      );
      for (const record of testCase.expect.votes) {
        assert.ok(
          VOTE_RECORD_VERDICTS.includes(record.verdict),
          `${label} census record uses a verdict outside the five-member set`,
        );
        const disposition = dispositionBySource.get(record.sourceNodeId);
        const nonVoting = NON_VOTING_DISPOSITIONS.includes(disposition);
        // not-cast holds exactly for the non-voting dispositions, in both
        // directions: a missing or timed_out entry can never carry a cast
        // verdict, and a cast entry can never be recorded as not-cast.
        assert.equal(
          record.verdict === NOT_CAST,
          nonVoting,
          `${label} census record for ${record.sourceNodeId} (${disposition}) must be not-cast if and only if the entry cast no ballot`,
        );
        if (record.verdict === NOT_CAST) {
          assert.deepEqual(
            Object.keys(record),
            ["sourceNodeId", "verdict"],
            `${label} not-cast record for ${record.sourceNodeId} invents a ballot nobody cast`,
          );
          voteRecordVerdictCoverage.add(NOT_CAST);
        } else {
          assert.ok(
            VERDICTS.includes(record.verdict),
            `${label} cast record for ${record.sourceNodeId} is not one of the four carrier verdicts`,
          );
          assert.equal(
            VERDICT_TO_DISPOSITION[record.verdict],
            disposition,
            `${label} census verdict and disposition disagree for ${record.sourceNodeId}`,
          );
          voteRecordVerdictCoverage.add(record.verdict);
        }
        if (Object.hasOwn(record, "evidenceHash")) {
          assert.match(record.evidenceHash, /^[0-9a-f]{64}$/u, `${label} evidence hash is malformed`);
        }
      }
    }
    assert.equal(
      testCase.expect.deadlineElapsed,
      testCase.expect.timedOut > 0,
      `${label} deadlineElapsed disagrees with the timed-out disposition count`,
    );
    assert.equal(
      testCase.expect.resolution === "satisfied",
      testCase.expect.satisfied,
      `${label} resolution and satisfied disagree`,
    );
    if (!testCase.expect.satisfied) {
      assert.equal(
        testCase.expect.resolution,
        RESOLUTION_BY_ON_UNSATISFIED[testCase.policy.onUnsatisfied],
        `${label} unsatisfied resolution is not the declared onUnsatisfied member`,
      );
    }

    // Schema conformance of the projection, completed with placeholder identity.
    const schemaDocument = {
      ...testCase.expect,
      policyHash: "0".repeat(64),
      decisionId: "0".repeat(64),
      armedAtMs: 0,
      decidedAtMs: 0,
    };
    assert.equal(
      validateBarrierDecision(schemaDocument),
      true,
      `${label} decision projection does not conform: ${JSON.stringify(validateBarrierDecision.errors)}`,
    );
  }

  for (const code of REASON_CODES) {
    assert.ok(reasonCodeCoverage.has(code), `evaluationCases never exercise reason code ${code}`);
  }
  assert.equal(reasonCodeCoverage.size, REASON_CODES.length, "evaluationCases exercise a reason code outside the closed set");
  for (const member of ON_UNSATISFIED) {
    assert.ok(onUnsatisfiedCoverage.has(member), `evaluationCases never exercise onUnsatisfied '${member}'`);
  }
  for (const member of LATE_ARRIVAL) {
    assert.ok(lateArrivalCoverage.has(member), `evaluationCases never exercise lateArrival '${member}'`);
  }
  for (const resolution of ["satisfied", "failed", "unknown", "awaiting_human"]) {
    assert.ok(resolutionCoverage.has(resolution), `evaluationCases never produce resolution '${resolution}'`);
  }
  for (const disposition of DISPOSITIONS) {
    assert.ok(dispositionCoverage.has(disposition), `evaluationCases never exercise disposition '${disposition}'`);
  }
  for (const verdict of VOTE_RECORD_VERDICTS) {
    assert.ok(
      voteRecordVerdictCoverage.has(verdict),
      `evaluationCases never exercise census verdict '${verdict}'`,
    );
  }
  for (const disposition of NON_VOTING_DISPOSITIONS) {
    assert.ok(
      evaluationCases.some((item) => (
        item.policy.kind === "quorum"
        && item.dispositions.some((entry) => entry.disposition === disposition)
      )),
      `evaluationCases must include a quorum barrier with a '${disposition}' entry`,
    );
  }

  // countAbstainAsParticipant must flip a verdict on identical inputs.
  const abstainPairs = new Map();
  for (const testCase of evaluationCases) {
    if (testCase.policy.kind !== "quorum") continue;
    const key = canonicalSerialize({
      accepts: testCase.policy.quorum.accepts,
      dispositions: testCase.dispositions.map((entry) => [entry.sourceNodeId, entry.disposition]),
    });
    const bucket = abstainPairs.get(key) ?? [];
    bucket.push(testCase);
    abstainPairs.set(key, bucket);
  }
  const flipped = [...abstainPairs.values()].some((bucket) => (
    bucket.length === 2
    && bucket[0].policy.quorum.countAbstainAsParticipant !== bucket[1].policy.quorum.countAbstainAsParticipant
    && bucket[0].expect.reasonCode !== bucket[1].expect.reasonCode
  ));
  assert.ok(
    flipped,
    "evaluationCases must contain one countAbstainAsParticipant pair with identical inputs and different verdicts",
  );
  assert.ok(
    evaluationCases.some((item) => (
      item.policy.kind === "quorum"
      && item.expect.unknown > 0
      && !item.expect.acceptedIds.some((id) => item.expect.unknownIds.includes(id))
    )),
    "evaluationCases must prove unknown votes never count as accepts",
  );

  // --- identityCases ------------------------------------------------------
  const identityCases = fixture.identityCases;
  assert.ok(identityCases.length >= 8, `identityCases must hold at least 8 cases, saw ${identityCases.length}`);
  assert.equal(
    new Set(identityCases.map(({ name }) => name)).size,
    identityCases.length,
    "identityCases names are not unique",
  );
  let routeIdentityCount = 0;
  let nonAsciiKeyCases = 0;
  let nullMemberCases = 0;
  const collisionGroups = new Map();
  for (const testCase of identityCases) {
    const label = `identityCases/${testCase.name}`;
    const isRoute = testCase.documentKind === "RouteDecision";
    if (isRoute) routeIdentityCount += 1;
    assert.equal(
      testCase.decisionDomain,
      isRoute ? ROUTE_DECISION_DOMAIN : BARRIER_DECISION_DOMAIN,
      `${label} decision domain drifted`,
    );
    assert.equal(testCase.policyKindTag, isRoute ? "router" : "barrier", `${label} policy kind tag drifted`);
    assert.equal(
      testCase.document[isRoute ? "routerNodeId" : "barrierNodeId"],
      testCase.nodeId,
      `${label} document node ID does not match the framed node ID`,
    );

    const expectedPolicyHash = computePolicyHash(testCase.policyKindTag, testCase.policy);
    assert.equal(
      testCase.expect.policyHash,
      expectedPolicyHash,
      `${label} literal policyHash drifted from the framed digest`,
    );
    assert.equal(
      testCase.document.policyHash,
      expectedPolicyHash,
      `${label} document policyHash drifted from the framed digest`,
    );
    const expectedDecisionId = computeDecisionId(
      testCase.decisionDomain,
      testCase.runId,
      testCase.graphRevision,
      testCase.nodeId,
      testCase.document,
    );
    assert.equal(
      testCase.expect.decisionId,
      expectedDecisionId,
      `${label} literal decisionId drifted from the framed digest`,
    );
    assert.equal(
      testCase.document.decisionId,
      expectedDecisionId,
      `${label} document decisionId drifted from the framed digest`,
    );
    assert.equal(
      testCase.expect.canonicalPolicyUtf8Bytes,
      Buffer.byteLength(canonicalSerialize(testCase.policy), "utf8"),
      `${label} canonical policy byte count drifted`,
    );
    const { decisionId: _drop, ...withoutDecisionId } = testCase.document;
    assert.equal(
      testCase.expect.canonicalDocumentWithoutDecisionIdUtf8Bytes,
      Buffer.byteLength(canonicalSerialize(withoutDecisionId), "utf8"),
      `${label} canonical document byte count drifted`,
    );

    const validateDocument = isRoute ? validateRouteDecision : validateBarrierDecision;
    assert.equal(
      validateDocument(testCase.document),
      true,
      `${label} document does not conform: ${JSON.stringify(validateDocument.errors)}`,
    );
    if (isRoute) {
      assert.ok(
        ROUTE_REASON_CODES.includes(testCase.document.reasonCode),
        `${label} uses a reason code outside the published RouteSelectionReasonCode set`,
      );
      if (testCase.document.confidenceBasisPoints === null) nullMemberCases += 1;
    }
    if (Object.hasOwn(testCase, "nullMemberWitness")) {
      assert.equal(
        testCase.document[testCase.nullMemberWitness],
        null,
        `${label} claims a null member witness that is not null`,
      );
      assert.ok(
        canonicalSerialize(withoutDecisionId).includes(`"${testCase.nullMemberWitness}":null`),
        `${label} explicit null member is not carried into the hashed canonical bytes`,
      );
    }

    if (Object.hasOwn(testCase, "evidenceInputs")) {
      for (const input of testCase.evidenceInputs) {
        const computed = computeEvidenceHash(input.evidence);
        assert.equal(computed, input.evidenceHash, `${label} evidence hash drifted`);
        const record = testCase.document.votes.find((item) => item.sourceNodeId === input.sourceNodeId);
        assert.ok(record, `${label} has no vote record for ${input.sourceNodeId}`);
        assert.equal(record.evidenceHash, computed, `${label} vote evidence hash drifted`);
        const keys = Object.keys(input.evidence);
        if (keys.some((key) => Array.from(key).some((character) => character.codePointAt(0) > 127))) {
          nonAsciiKeyCases += 1;
        }
      }
      if (Object.hasOwn(testCase, "canonicalEvidenceKeyOrder")) {
        const evidence = testCase.evidenceInputs[0].evidence;
        assert.deepEqual(
          Object.keys(evidence).sort(compareUnicodeCodePoints),
          testCase.canonicalEvidenceKeyOrder,
          `${label} canonical evidence key order drifted from ascending Unicode code-point order`,
        );
        // Code-point order must differ from naive UTF-16 code-unit order here.
        assert.notDeepEqual(
          [...Object.keys(evidence)].sort(),
          testCase.canonicalEvidenceKeyOrder,
          `${label} does not actually distinguish code-point order from UTF-16 code-unit order`,
        );
      }
    }

    if (Object.hasOwn(testCase, "naiveConcatenationGroup")) {
      const bucket = collisionGroups.get(testCase.naiveConcatenationGroup) ?? [];
      bucket.push(testCase);
      collisionGroups.set(testCase.naiveConcatenationGroup, bucket);
    }
  }
  assert.ok(routeIdentityCount >= 2, "identityCases must include at least two RouteDecision identities");
  assert.ok(nonAsciiKeyCases >= 1, "identityCases must include a canonical serialization with a non-ASCII key");
  assert.ok(nullMemberCases >= 1, "identityCases must frame an explicit null RouteDecision member");
  assert.ok(collisionGroups.size >= 1, "identityCases must include a naive-concatenation collision witness");
  for (const [group, bucket] of collisionGroups) {
    assert.equal(bucket.length, 2, `collision group ${group} must hold exactly two witnesses`);
    const [left, right] = bucket;
    const leftParts = decisionIdentityParts(
      left.decisionDomain, left.runId, left.graphRevision, left.nodeId, left.document,
    );
    const rightParts = decisionIdentityParts(
      right.decisionDomain, right.runId, right.graphRevision, right.nodeId, right.document,
    );
    assert.notDeepEqual(leftParts, rightParts, `collision group ${group} witnesses are identical`);
    assert.equal(
      naiveConcatenation(leftParts).toString("hex"),
      naiveConcatenation(rightParts).toString("hex"),
      `collision group ${group} does not actually collide under naive concatenation`,
    );
    assert.notEqual(
      left.expect.decisionId,
      right.expect.decisionId,
      `collision group ${group} collides even with length framing`,
    );
    assert.equal(
      sha256Hex(naiveConcatenation(leftParts)),
      sha256Hex(naiveConcatenation(rightParts)),
      `collision group ${group} must show that an unframed digest would collide`,
    );
  }
  const runIdBound = identityCases.filter((item) => (
    item.documentKind === "BarrierDecision"
    && canonicalSerialize({ ...item.document, decisionId: null })
      === canonicalSerialize({ ...identityCases[0].document, decisionId: null })
  ));
  assert.ok(
    runIdBound.length >= 2
      && new Set(runIdBound.map((item) => item.expect.decisionId)).size === runIdBound.length,
    "identityCases must prove that the decision identity binds the run ID",
  );

  // --- replayCases --------------------------------------------------------
  const replayCases = fixture.replayCases;
  assert.ok(replayCases.length >= 6, `replayCases must hold at least 6 cases, saw ${replayCases.length}`);
  assert.equal(
    new Set(replayCases.map(({ name }) => name)).size,
    replayCases.length,
    "replayCases names are not unique",
  );
  const replayCodeCoverage = new Set();
  const informationalReplayFields = new Set(["forkedFromRunId", "parentDecisionId", "childDecisionId"]);
  for (const testCase of replayCases) {
    const label = `replayCases/${testCase.name}`;
    assert.equal(testCase.expect.expectedExecutorCalls, 0, `${label} must assert zero executor calls`);
    assert.equal(testCase.expect.appendedDecisionEvents, 0, `${label} must append no decision event`);
    for (const event of testCase.history) {
      assert.ok(
        event.type === "BarrierSatisfied" || event.type === "RouteSelected",
        `${label} seeds an unknown durable decision event ${event.type}`,
      );
      const validateDocument = event.type === "RouteSelected" ? validateRouteDecision : validateBarrierDecision;
      assert.equal(
        validateDocument(event.data),
        true,
        `${label} seeded decision does not conform: ${JSON.stringify(validateDocument.errors)}`,
      );
    }
    const observed = referenceReplayOutcome(testCase);
    const expectation = Object.fromEntries(
      Object.entries(testCase.expect).filter(([key]) => (
        !informationalReplayFields.has(key)
        && key !== "expectedExecutorCalls"
        && key !== "appendedDecisionEvents"
      )),
    );
    assert.deepEqual(expectation, observed, `${label} replay outcome drifted from the recomputed fold`);
    if (observed.outcome === "rejected") replayCodeCoverage.add(observed.code);
    if (Object.hasOwn(testCase.expect, "forkedFromRunId")) {
      const event = testCase.history[0];
      const parent = computeDecisionId(
        BARRIER_DECISION_DOMAIN,
        testCase.expect.forkedFromRunId,
        testCase.graphRevision,
        event.nodeId,
        event.data,
      );
      assert.equal(testCase.expect.parentDecisionId, parent, `${label} parent decision identity drifted`);
      assert.equal(
        testCase.expect.childDecisionId,
        event.data.decisionId,
        `${label} child decision identity drifted`,
      );
      assert.notEqual(
        testCase.expect.parentDecisionId,
        testCase.expect.childDecisionId,
        `${label} fork must not reuse the parent decision identity`,
      );
    }
  }
  for (const code of REPLAY_REJECTION_CODES) {
    assert.ok(replayCodeCoverage.has(code), `replayCases never exercise ${code}`);
  }
  assert.ok(
    replayCases.some((item) => (
      item.expect.outcome === "adopted" && item.history.some((event) => event.type === "RouteSelected")
    )),
    "replayCases must adopt a committed RouteSelected decision",
  );
  assert.ok(
    replayCases.some((item) => (
      item.expect.outcome === "adopted" && item.history.some((event) => event.type === "BarrierSatisfied")
    )),
    "replayCases must adopt a committed BarrierSatisfied decision",
  );

  return {
    contract: fixture.contract,
    claims: { ...claims },
    ownershipCases: ownershipCases.length,
    unclaimedOwnershipCases,
    policyCases: policyCases.length,
    validPolicyCases,
    unclaimedPolicyCases,
    invalidPolicyCases: policyCases.length - validPolicyCases - unclaimedPolicyCases,
    compilerCases: compilerCases.length,
    compilerDiagnostics: compilerCases.reduce((total, item) => total + item.expectDiagnostics.length, 0),
    evaluationCases: evaluationCases.length,
    identityCases: identityCases.length,
    routeIdentityCases: routeIdentityCount,
    identifierCases: identifierCases.length,
    replayCases: replayCases.length,
    voteRecordVerdictsExercised: voteRecordVerdictCoverage.size,
    reasonCodesExercised: reasonCodeCoverage.size,
    diagnosticCodesExercised: diagnosticCodeCoverage.size,
    resolutionsExercised: resolutionCoverage.size,
    dispositionsExercised: dispositionCoverage.size,
    replayRejectionCodesExercised: replayCodeCoverage.size,
    recomputedLiterals:
      compilerCases.length
      + identityCases.length * 2
      + replayCases.reduce((total, item) => total + item.history.length * 2, 0),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await validateIntegratedBarrierFixture();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
