#!/usr/bin/env node
//
// Independent validator for spec/conformance/approval.case.json.
//
// Every literal in the corpus is recomputed here from the rules stated in
// spec/approval-semantics.md alone. Nothing is imported from a language runtime
// and nothing is copied from another conformance fixture, so a single typo
// anywhere in the corpus must make this module throw.
//
// The oracle is also falsifiable by construction. Each of the 34 presentation
// guards is a named entry in GUARDS; `--neutralize=<id>` makes one guard always
// return no code, and `--sweep` neutralizes each in turn and requires the
// shipped corpus to fail every time. A guard that survives its own deletion is
// a guard the corpus does not test, and the default CLI run reports it as a
// hard failure.
//
// Usage:
//   node spec/conformance/approval.validate.mjs                # validate + sweep
//   node spec/conformance/approval.validate.mjs --no-sweep
//   node spec/conformance/approval.validate.mjs --neutralize=expiry

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = dirname(here);
const CASE_PATH = join(here, "approval.case.json");
const AUTHORITY_SCHEMA_PATH = join(specRoot, "approval-authority.schema.json");
const REQUEST_SCHEMA_PATH = join(specRoot, "approval-request.schema.json");
const GRANT_SCHEMA_PATH = join(specRoot, "approval-grant.schema.json");
const BARRIER_DECISION_SCHEMA_PATH = join(specRoot, "barrier-decision.schema.json");

// ---------------------------------------------------------------------------
// Contract constants, transcribed from spec/approval-semantics.md. They are
// deliberately NOT read out of the corpus: the corpus must agree with them, not
// define them.
// ---------------------------------------------------------------------------

const CONTRACT = "graphengineering.reacher-z.github.io/approval/v1alpha1";

const DOMAIN_AUTHORITY = "graphengineering.approval-authority.v1alpha1";
const DOMAIN_SUBJECT_DOCUMENT = "graphengineering.approval-subject-document.v1alpha1";
const DOMAIN_REQUEST_DOCUMENT = "graphengineering.approval-request-document.v1alpha1";
const DOMAIN_REQUEST = "graphengineering.approval-request.v1alpha1";
const DOMAIN_GRANT = "graphengineering.approval-grant.v1alpha1";

const OUTCOMES = ["granted", "refused", "unknown"];
const DECISIONS = ["approve", "reject", "revoke", "expire", "supersede"];
const CONFERRING = new Set(["approve", "supersede"]);
const REFUSING = new Set(["reject", "revoke", "expire"]);
const FIRST_DECISIONS = new Set(["approve", "reject", "expire"]);
const NEEDS_PRIOR = new Set(["revoke", "supersede"]);

const OPERATION_KINDS = [
  "capability-use", "external-effect", "fork-rebind", "graph-patch",
  "resume-barrier", "resume-in-doubt-node",
];
const SCOPE_OPERATIONS = [
  "artifact-write", "budget-override", "filesystem-read", "filesystem-write",
  "graph-patch", "model-invoke", "network-request", "process-execute",
  "secret-read", "tool-invoke",
];
const SCOPE_SET_MEMBERS = [
  "operations", "filesystemWriteRoots", "networkHosts", "processExecutables",
  "secretNames",
];
const SCOPE_CEILING_MEMBERS = ["maxAttempts", "maxDurationMs", "maxCostMinorUnits"];
const SCOPE_MEMBERS = [...SCOPE_SET_MEMBERS, ...SCOPE_CEILING_MEMBERS];
const SIDE_EFFECTS = ["none", "idempotent", "non-idempotent", "unspecified"];
const OBSERVED_STATES = ["verified-not-applied", "verified-applied", "unverified"];
const CONFIRMATION_ACTIONS = ["new-attempt", "adopt-applied"];
const SEPARATION = ["none", "requester-must-differ"];
const ON_UNANSWERED = ["refuse", "unknown"];
const FORK_TRANSFER = ["never", "bound-reapproval"];

const ERROR_CODES = [
  "GE_APPROVAL_MALFORMED",
  "GE_APPROVAL_REQUEST_TTL_EXCEEDED",
  "GE_APPROVAL_REQUEST_IDENTITY_MISMATCH",
  "GE_APPROVAL_GRANT_IDENTITY_MISMATCH",
  "GE_APPROVAL_REQUEST_BINDING_MISMATCH",
  "GE_APPROVAL_FORK_TRANSFER_DENIED",
  "GE_APPROVAL_FORK_REBIND_REQUIRED",
  "GE_APPROVAL_SUBJECT_MISMATCH",
  "GE_APPROVAL_OPERATION_KIND_MISMATCH",
  "GE_APPROVAL_NONCE_REUSE",
  "GE_APPROVAL_AUTHORITY_DRIFT",
  "GE_APPROVAL_PRINCIPAL_NOT_PERMITTED",
  "GE_APPROVAL_SEPARATION_VIOLATION",
  "GE_APPROVAL_SCOPE_EXCEEDS_AUTHORITY",
  "GE_APPROVAL_SCOPE_EXPANSION",
  "GE_APPROVAL_REFUSAL_GRANTS_SCOPE",
  "GE_APPROVAL_STALE_REVISION",
  "GE_APPROVAL_STALE_FENCE",
  "GE_APPROVAL_EXPIRED",
  "GE_APPROVAL_TERMINAL_STATE",
  "GE_APPROVAL_DUPLICATE_GRANT",
  "GE_APPROVAL_NO_PRIOR_GRANT",
  "GE_APPROVAL_SUPERSEDE_TARGET_INVALID",
  "GE_APPROVAL_ALREADY_CONSUMED",
  "GE_APPROVAL_CONFIRMATION_REQUIRED",
  "GE_APPROVAL_CONFIRMATION_FORBIDDEN",
  "GE_APPROVAL_CONFIRMATION_MISMATCH",
  "GE_APPROVAL_UNVERIFIED_REATTEMPT",
  "GE_APPROVAL_UNVERIFIED_ADOPTION",
  "GE_APPROVAL_UNBINDABLE_DESCENDANT",
];

const EMPTY_SCOPE = {
  operations: [],
  filesystemWriteRoots: [],
  networkHosts: [],
  processExecutables: [],
  secretNames: [],
  maxAttempts: 0,
  maxDurationMs: 0,
  maxCostMinorUnits: 0,
};

// ---------------------------------------------------------------------------
// Canonical serialization, framing, and the five hash constructions.
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareUnicodeCodePoints(a, b) {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const delta = left[index].codePointAt(0) - right[index].codePointAt(0);
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

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

/** frame(s) = uint32be(byteLength(utf8(s))) || utf8(s) */
function frame(text) {
  const bytes = Buffer.from(text, "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([header, bytes]);
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function framedDigest(parts) {
  return sha256Hex(Buffer.concat(parts.map(frame)));
}

/** The construction this contract forbids, kept only to prove it is forbidden. */
function naiveConcatenatedDigest(parts) {
  return sha256Hex(Buffer.concat(parts.map((part) => Buffer.from(part, "utf8"))));
}

function decimal(value) {
  assert.ok(Number.isInteger(value), "decimal() takes an integer");
  assert.ok(value >= 0, "decimal() takes a non-negative integer");
  return String(value);
}

function subjectIdText(subject) {
  return subject.kind === "attempt" ? decimal(subject.attempt) : subject.decisionId;
}

function computeAuthorityHash(authority) {
  return framedDigest([DOMAIN_AUTHORITY, canonicalSerialize(authority)]);
}

function computeDocumentHash(document) {
  return framedDigest([DOMAIN_SUBJECT_DOCUMENT, canonicalSerialize(document)]);
}

function computeRequestHash(request) {
  return framedDigest([DOMAIN_REQUEST_DOCUMENT, canonicalSerialize(request)]);
}

function requestIdParts(request) {
  return [
    DOMAIN_REQUEST,
    request.runId,
    decimal(request.graphRevision),
    request.nodeId,
    request.operationKind,
    request.subject.kind,
    subjectIdText(request.subject),
    request.subject.documentHash,
    request.sideEffects,
    canonicalSerialize(request.requestedScope),
    request.authorityId,
    request.authorityHash,
    request.requesterPrincipal,
    decimal(request.leaseFence),
    request.nonce,
    decimal(request.requestedAtMs),
    decimal(request.expiresAtMs),
  ];
}

function grantIdParts(grant) {
  return [
    DOMAIN_GRANT,
    grant.runId,
    decimal(grant.graphRevision),
    grant.nodeId,
    grant.requestId,
    grant.requestHash,
    grant.operationKind,
    grant.subject.kind,
    subjectIdText(grant.subject),
    grant.subject.documentHash,
    grant.decision,
    grant.approverPrincipal,
    canonicalSerialize(grant.grantedScope),
    grant.authorityId,
    grant.authorityHash,
    decimal(grant.leaseFence),
    decimal(grant.decidedAtMs),
    grant.supersedesGrantId ?? "",
    grant.confirmation ? canonicalSerialize(grant.confirmation) : "",
  ];
}

const computeRequestId = (request) => framedDigest(requestIdParts(request));
const computeGrantId = (grant) => framedDigest(grantIdParts(grant));

// ---------------------------------------------------------------------------
// Scope algebra. Section 6: exact string membership and no numeric increase.
// ---------------------------------------------------------------------------

function scopeIsCanonicallyOrdered(scope) {
  if (!isPlainObject(scope)) return false;
  for (const member of SCOPE_SET_MEMBERS) {
    const list = scope[member];
    if (!Array.isArray(list)) return false;
    for (let index = 1; index < list.length; index += 1) {
      if (compareUnicodeCodePoints(list[index - 1], list[index]) >= 0) return false;
    }
  }
  return true;
}

function scopeIsNoWiderThan(subject, ceiling) {
  for (const member of SCOPE_SET_MEMBERS) {
    const allowed = new Set(ceiling[member]);
    for (const token of subject[member]) {
      // Exact string equality only. No prefix, suffix, glob, case folding, or
      // path normalization participates.
      if (!allowed.has(token)) return false;
    }
  }
  for (const member of SCOPE_CEILING_MEMBERS) {
    if (subject[member] > ceiling[member]) return false;
  }
  return true;
}

const isEmptyScope = (scope) => canonicalSerialize(scope) === canonicalSerialize(EMPTY_SCOPE);

// ---------------------------------------------------------------------------
// Ledger fold. Section 10.1.
// ---------------------------------------------------------------------------

function foldLedger(records) {
  let effective = null;
  let terminal = false;
  for (const record of records) {
    if (CONFERRING.has(record.decision)) {
      effective = record;
    } else {
      terminal = true;
      effective = null;
    }
  }
  return { effective, terminal, count: records.length };
}

// ---------------------------------------------------------------------------
// The 34 guards, in the normative order of section 10. The first guard that
// returns a code decides the outcome.
// ---------------------------------------------------------------------------

const GUARDS = [
  {
    id: "shape-request",
    run: (c) => (
      c.validateRequest(c.request) && scopeIsCanonicallyOrdered(c.request.requestedScope)
        ? null
        : "GE_APPROVAL_MALFORMED"
    ),
  },
  {
    id: "shape-grant",
    run: (c) => (
      c.validateGrant(c.grant) && scopeIsCanonicallyOrdered(c.grant.grantedScope)
        ? null
        : "GE_APPROVAL_MALFORMED"
    ),
  },
  {
    id: "request-ttl",
    run: (c) => (
      c.request.expiresAtMs - c.request.requestedAtMs > c.authority.requestTtlMs
        ? "GE_APPROVAL_REQUEST_TTL_EXCEEDED"
        : null
    ),
  },
  {
    id: "request-identity",
    run: (c) => (
      computeRequestId(c.request) === c.request.requestId
        ? null
        : "GE_APPROVAL_REQUEST_IDENTITY_MISMATCH"
    ),
  },
  {
    id: "grant-identity",
    run: (c) => (
      computeGrantId(c.grant) === c.grant.grantId
        ? null
        : "GE_APPROVAL_GRANT_IDENTITY_MISMATCH"
    ),
  },
  {
    id: "idempotent-replay",
    // The one guard that short-circuits with a success. Identity equality is
    // byte equality here, because grantId covers every non-constant member and
    // `grant-identity` already refused a carried identity that does not
    // recompute.
    run: (c) => {
      const committed = c.ledger.records.find((record) => record.grantId === c.grant.grantId);
      if (committed === undefined) return null;
      return {
        replay: true,
        outcome: CONFERRING.has(committed.decision) ? "granted" : "refused",
      };
    },
  },
  {
    id: "request-binding",
    run: (c) => (
      c.grant.requestId === c.request.requestId
      && c.grant.requestHash === computeRequestHash(c.request)
        ? null
        : "GE_APPROVAL_REQUEST_BINDING_MISMATCH"
    ),
  },
  {
    id: "fork-transfer-denied",
    run: (c) => (
      c.isTransplant && c.authority.forkTransfer === "never"
        ? "GE_APPROVAL_FORK_TRANSFER_DENIED"
        : null
    ),
  },
  {
    id: "fork-rebind-required",
    run: (c) => (
      c.isTransplant && c.authority.forkTransfer === "bound-reapproval"
        ? "GE_APPROVAL_FORK_REBIND_REQUIRED"
        : null
    ),
  },
  {
    id: "subject-binding",
    run: (c) => (
      c.grant.runId === c.request.runId
      && c.grant.graphRevision === c.request.graphRevision
      && c.grant.nodeId === c.request.nodeId
      && canonicalSerialize(c.grant.subject) === canonicalSerialize(c.request.subject)
      && c.request.runId === c.run.runId
        ? null
        : "GE_APPROVAL_SUBJECT_MISMATCH"
    ),
  },
  {
    id: "operation-kind-echo",
    run: (c) => (
      c.grant.operationKind === c.request.operationKind
        ? null
        : "GE_APPROVAL_OPERATION_KIND_MISMATCH"
    ),
  },
  {
    id: "nonce-reuse",
    run: (c) => (
      c.run.noncesBoundToOtherRequests.includes(c.request.nonce)
        ? "GE_APPROVAL_NONCE_REUSE"
        : null
    ),
  },
  {
    id: "authority-drift",
    run: (c) => (
      c.request.authorityId === c.authority.authorityId
      && c.request.authorityHash === computeAuthorityHash(c.authority)
      && c.grant.authorityId === c.request.authorityId
      && c.grant.authorityHash === c.request.authorityHash
        ? null
        : "GE_APPROVAL_AUTHORITY_DRIFT"
    ),
  },
  {
    id: "authority-operation-kind",
    run: (c) => (
      c.authority.operationKinds.includes(c.request.operationKind)
        ? null
        : "GE_APPROVAL_OPERATION_KIND_MISMATCH"
    ),
  },
  {
    id: "principal",
    run: (c) => (
      c.authority.principals.includes(c.grant.approverPrincipal)
        ? null
        : "GE_APPROVAL_PRINCIPAL_NOT_PERMITTED"
    ),
  },
  {
    id: "separation",
    run: (c) => (
      c.authority.separation === "requester-must-differ"
      && c.grant.approverPrincipal === c.request.requesterPrincipal
        ? "GE_APPROVAL_SEPARATION_VIOLATION"
        : null
    ),
  },
  {
    id: "authority-ceiling",
    run: (c) => (
      scopeIsNoWiderThan(c.request.requestedScope, c.authority.maxScope)
        ? null
        : "GE_APPROVAL_SCOPE_EXCEEDS_AUTHORITY"
    ),
  },
  {
    id: "scope-non-expansion",
    run: (c) => (
      scopeIsNoWiderThan(c.grant.grantedScope, c.request.requestedScope)
        ? null
        : "GE_APPROVAL_SCOPE_EXPANSION"
    ),
  },
  {
    id: "refusal-empty-scope",
    run: (c) => (
      REFUSING.has(c.grant.decision) && !isEmptyScope(c.grant.grantedScope)
        ? "GE_APPROVAL_REFUSAL_GRANTS_SCOPE"
        : null
    ),
  },
  {
    id: "stale-revision",
    run: (c) => (
      c.grant.graphRevision === c.run.graphRevision ? null : "GE_APPROVAL_STALE_REVISION"
    ),
  },
  {
    id: "stale-fence",
    run: (c) => (c.grant.leaseFence < c.run.leaseFence ? "GE_APPROVAL_STALE_FENCE" : null),
  },
  {
    id: "expiry",
    run: (c) => (c.grant.decidedAtMs > c.request.expiresAtMs ? "GE_APPROVAL_EXPIRED" : null),
  },
  {
    id: "ledger-terminal",
    run: (c) => (c.fold.terminal ? "GE_APPROVAL_TERMINAL_STATE" : null),
  },
  {
    id: "ledger-no-prior",
    run: (c) => (
      NEEDS_PRIOR.has(c.grant.decision) && c.fold.count === 0
        ? "GE_APPROVAL_NO_PRIOR_GRANT"
        : null
    ),
  },
  {
    id: "ledger-supersede-target",
    run: (c) => {
      if (!NEEDS_PRIOR.has(c.grant.decision)) return null;
      if (c.fold.effective === null) return "GE_APPROVAL_SUPERSEDE_TARGET_INVALID";
      return c.grant.supersedesGrantId === c.fold.effective.grantId
        ? null
        : "GE_APPROVAL_SUPERSEDE_TARGET_INVALID";
    },
  },
  {
    id: "ledger-consumed",
    run: (c) => (
      c.grant.decision === "revoke" && c.ledger.consumed === true
        ? "GE_APPROVAL_ALREADY_CONSUMED"
        : null
    ),
  },
  {
    id: "ledger-duplicate",
    run: (c) => (
      FIRST_DECISIONS.has(c.grant.decision) && c.fold.effective !== null
        ? "GE_APPROVAL_DUPLICATE_GRANT"
        : null
    ),
  },
  {
    id: "supersede-monotone",
    run: (c) => {
      if (c.grant.decision !== "supersede" || c.fold.effective === null) return null;
      return scopeIsNoWiderThan(c.grant.grantedScope, c.fold.effective.grantedScope)
        ? null
        : "GE_APPROVAL_SCOPE_EXPANSION";
    },
  },
  {
    id: "confirmation-required",
    run: (c) => (
      CONFERRING.has(c.grant.decision)
      && c.request.sideEffects !== "none"
      && c.grant.confirmation === undefined
        ? "GE_APPROVAL_CONFIRMATION_REQUIRED"
        : null
    ),
  },
  {
    id: "confirmation-forbidden",
    run: (c) => (
      c.grant.confirmation !== undefined
      && (c.request.sideEffects === "none" || !CONFERRING.has(c.grant.decision))
        ? "GE_APPROVAL_CONFIRMATION_FORBIDDEN"
        : null
    ),
  },
  {
    id: "confirmation-match",
    run: (c) => (
      c.grant.confirmation !== undefined
      && c.grant.confirmation.sideEffects !== c.request.sideEffects
        ? "GE_APPROVAL_CONFIRMATION_MISMATCH"
        : null
    ),
  },
  {
    id: "confirmation-reattempt",
    run: (c) => (
      c.grant.confirmation !== undefined
      && c.grant.confirmation.action === "new-attempt"
      && c.grant.confirmation.observedExternalState !== "verified-not-applied"
        ? "GE_APPROVAL_UNVERIFIED_REATTEMPT"
        : null
    ),
  },
  {
    id: "confirmation-adoption",
    run: (c) => (
      c.grant.confirmation !== undefined
      && c.grant.confirmation.action === "adopt-applied"
      && c.grant.confirmation.observedExternalState !== "verified-applied"
        ? "GE_APPROVAL_UNVERIFIED_ADOPTION"
        : null
    ),
  },
  {
    id: "descendant-bindability",
    run: (c) => {
      if (!CONFERRING.has(c.grant.decision)) return null;
      const leavesOutputUnbound = c.grant.operationKind === "resume-barrier"
        || (c.grant.confirmation !== undefined && c.grant.confirmation.action === "adopt-applied");
      if (!leavesOutputUnbound) return null;
      return c.descendants.some((item) => item.requiresBarrierOutput === true)
        ? "GE_APPROVAL_UNBINDABLE_DESCENDANT"
        : null;
    },
  },
];

const GUARD_IDS = GUARDS.map((guard) => guard.id);

function evaluatePresentation(context, neutralized) {
  for (const guard of GUARDS) {
    if (neutralized.has(guard.id)) continue;
    const verdict = guard.run(context);
    if (verdict === null || verdict === undefined) continue;
    if (typeof verdict === "object" && verdict.replay === true) {
      return { outcome: verdict.outcome, code: null, guard: guard.id, writes: 0, replay: true };
    }
    return { outcome: "refused", code: verdict, guard: guard.id, writes: 0, replay: false };
  }
  return {
    outcome: CONFERRING.has(context.grant.decision) ? "granted" : "refused",
    code: null,
    guard: null,
    writes: 1,
    replay: false,
  };
}

function resolveUnanswered(authority, request, nowMs, approverReachable) {
  if (approverReachable === false) return { outcome: "unknown", writes: 0 };
  if (nowMs <= request.expiresAtMs) return { outcome: "unknown", writes: 0 };
  return {
    outcome: authority.onUnanswered === "unknown" ? "unknown" : "refused",
    writes: 0,
  };
}

// ---------------------------------------------------------------------------
// Fixture validation.
// ---------------------------------------------------------------------------

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

let cachedInputs = null;

async function loadInputs() {
  if (cachedInputs !== null) return cachedInputs;
  const [fixture, authoritySchema, requestSchema, grantSchema, barrierDecisionSchema] =
    await Promise.all([
      readJson(CASE_PATH),
      readJson(AUTHORITY_SCHEMA_PATH),
      readJson(REQUEST_SCHEMA_PATH),
      readJson(GRANT_SCHEMA_PATH),
      readJson(BARRIER_DECISION_SCHEMA_PATH),
    ]);

  const engine = new Ajv2020({ allErrors: true, strict: true });
  engine.addSchema(authoritySchema);
  engine.addSchema(requestSchema);
  engine.addSchema(grantSchema);
  engine.addSchema(barrierDecisionSchema);

  cachedInputs = {
    fixture,
    validateAuthority: engine.compile(authoritySchema),
    validateRequest: engine.compile(requestSchema),
    validateGrant: engine.compile(grantSchema),
    validateBarrierDecision: engine.compile(barrierDecisionSchema),
    validateRequestedEnvelope: engine.compile(
      requestSchema.$defs.humanInputRequestedData,
    ),
    validateReceivedEnvelope: engine.compile(
      grantSchema.$defs.humanInputReceivedData,
    ),
  };
  return cachedInputs;
}

function assertSameMembers(actual, expected, what) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${what} must be exactly the closed set declared in approval-semantics.md`,
  );
}

export async function validateApprovalFixture(options = {}) {
  const neutralized = new Set(options.neutralize ?? []);
  for (const id of neutralized) {
    assert.ok(GUARD_IDS.includes(id), `unknown guard id ${id}`);
  }

  const inputs = await loadInputs();
  const { fixture } = inputs;

  // -- status and non-claims -------------------------------------------------
  assert.equal(fixture.contract, CONTRACT, "corpus contract identifier drifted");
  assert.equal(fixture.semantics, "approval-semantics.md");
  assert.equal(fixture.implementationClaim, false, "implementationClaim must be literally false");
  assert.ok(isPlainObject(fixture.claims), "claims block is required");
  for (const [name, value] of Object.entries(fixture.claims)) {
    assert.equal(value, false, `claim ${name} must be literally false`);
  }
  for (const required of [
    "implementationClaim", "typescriptRuntimeClaim", "pythonRuntimeClaim",
    "approvalIssuerClaim", "approverSurfaceClaim", "ledgerFoldClaim",
    "dischargeClaim", "approverAuthenticationClaim", "eventSchemaIntegrationClaim",
  ]) {
    assert.ok(required in fixture.claims, `claims must disclose ${required}`);
  }
  assert.deepEqual(
    fixture.provenance.expectationsImportedFromOtherFixtures,
    [],
    "no expectation may be imported from another fixture",
  );

  // -- closed vocabularies ---------------------------------------------------
  const v = fixture.vocabularies;
  assert.deepEqual(v.outcomes, OUTCOMES);
  assert.deepEqual(v.decisions, DECISIONS);
  assert.deepEqual(v.conferringDecisions, [...CONFERRING]);
  assert.deepEqual(v.refusingDecisions, [...REFUSING]);
  assert.deepEqual(v.operationKinds, OPERATION_KINDS);
  assert.deepEqual(v.scopeOperations, SCOPE_OPERATIONS);
  assert.deepEqual(v.scopeMembers, SCOPE_MEMBERS);
  assert.deepEqual(v.sideEffects, SIDE_EFFECTS);
  assert.deepEqual(v.observedExternalState, OBSERVED_STATES);
  assert.deepEqual(v.confirmationActions, CONFIRMATION_ACTIONS);
  assert.deepEqual(v.separation, SEPARATION);
  assert.deepEqual(v.onUnanswered, ON_UNANSWERED);
  assert.deepEqual(v.forkTransfer, FORK_TRANSFER);
  assert.deepEqual(v.errorCodes, ERROR_CODES);
  assert.deepEqual(v.guardOrder, GUARD_IDS, "corpus guard order must match the oracle order");
  assert.equal(new Set(v.errorCodes).size, ERROR_CODES.length, "error codes must be unique");
  assert.equal(new Set(v.guardOrder).size, GUARD_IDS.length, "guard ids must be unique");

  assert.equal(new Set(ERROR_CODES).size, 30, "the error-code set is closed at 30 members");

  // -- hash contract ---------------------------------------------------------
  const h = fixture.hashContract;
  assert.equal(h.frame, "frame(s) = uint32be(byteLength(utf8(s))) || utf8(s)");
  assert.match(h.canonicalSerializer, /ascending Unicode code-point order/u);
  assert.equal(h.decimal, "shortest base ten, no sign, no leading zero, no exponent");
  assert.equal(h.absentOptional, "framed as the empty string");
  assert.deepEqual(h.domains, {
    authority: DOMAIN_AUTHORITY,
    subjectDocument: DOMAIN_SUBJECT_DOCUMENT,
    requestDocument: DOMAIN_REQUEST_DOCUMENT,
    request: DOMAIN_REQUEST,
    grant: DOMAIN_GRANT,
  });
  assert.equal(new Set(Object.values(h.domains)).size, 5, "the five domains must be distinct");
  assert.deepEqual(h.requestIdExcludes, ["apiVersion", "kind", "requestId", "reason"]);
  assert.deepEqual(h.grantIdExcludes, ["apiVersion", "kind", "grantId"]);
  assert.equal(h.requestIdParts.length, requestIdParts(fixture.identityCases.base.request).length);
  assert.equal(h.grantIdParts.length, grantIdParts(fixture.identityCases.grantBase.grant).length);

  // -- authorities -----------------------------------------------------------
  const authorities = {};
  for (const [key, entry] of Object.entries(fixture.authorities)) {
    assert.ok(
      inputs.validateAuthority(entry.document),
      `authority ${key} must satisfy approval-authority.schema.json: ${JSON.stringify(inputs.validateAuthority.errors)}`,
    );
    assert.equal(
      entry.authorityHash,
      computeAuthorityHash(entry.document),
      `authority ${key} hash drifted`,
    );
    assert.ok(scopeIsCanonicallyOrdered(entry.document.maxScope), `authority ${key} maxScope must be ordered`);
    authorities[key] = entry.document;
  }
  assert.ok(Object.keys(authorities).length >= 2, "at least two authorities are needed for enum coverage");

  let authorityRecomputed = 0;
  for (const item of fixture.authorityCases) {
    const ok = inputs.validateAuthority(item.document);
    assert.equal(ok, item.valid, `authorityCases[${item.id}] schema verdict drifted`);
    if (item.valid) {
      assert.equal(item.authorityHash, computeAuthorityHash(item.document), `authorityCases[${item.id}] hash drifted`);
      authorityRecomputed += 1;
    } else {
      assert.equal(item.authorityHash, null, `an invalid authority must carry no hash (${item.id})`);
    }
  }
  assert.ok(
    fixture.authorityCases.some((item) => item.valid === false && item.document.principals?.[0]?.startsWith("system:")),
    "authorityCases must prove a system principal cannot be an approver",
  );
  assert.ok(
    fixture.authorityCases.some((item) => item.valid === false && item.document.onUnanswered === "approve"),
    "authorityCases must prove onUnanswered has no approve member",
  );
  assert.ok(
    fixture.authorityCases.some((item) => item.valid === false && item.document.nonIdempotentResume !== "require-confirmation"),
    "authorityCases must prove the confirmation requirement cannot be configured away",
  );

  // -- subject documents -----------------------------------------------------
  let documentRecomputed = 0;
  for (const [key, entry] of Object.entries(fixture.subjectDocuments)) {
    assert.equal(entry.documentHash, computeDocumentHash(entry.value), `subjectDocuments.${key} hash drifted`);
    documentRecomputed += 1;
  }
  const barrierDecision = fixture.subjectDocuments.barrierDecision.value;
  assert.ok(
    inputs.validateBarrierDecision(barrierDecision),
    `the embedded BarrierDecision must satisfy barrier-decision.schema.json: ${JSON.stringify(inputs.validateBarrierDecision.errors)}`,
  );
  assert.equal(barrierDecision.resolution, "awaiting_human", "the discharge subject must be a human-resolved barrier");
  assert.equal(barrierDecision.satisfied, false, "a human-resolved barrier is never satisfied");

  // -- requests --------------------------------------------------------------
  let requestRecomputed = 0;
  const requestsByKey = {};
  for (const [key, entry] of Object.entries(fixture.requests)) {
    assert.ok(
      inputs.validateRequest(entry.document),
      `requests.${key} must satisfy approval-request.schema.json: ${JSON.stringify(inputs.validateRequest.errors)}`,
    );
    assert.equal(entry.requestId, computeRequestId(entry.document), `requests.${key} requestId drifted`);
    assert.equal(entry.requestId, entry.document.requestId, `requests.${key} carried requestId drifted`);
    assert.equal(entry.requestHash, computeRequestHash(entry.document), `requests.${key} requestHash drifted`);
    requestsByKey[key] = entry.document;
    requestRecomputed += 2;
  }

  // -- scope algebra ---------------------------------------------------------
  const scopeMembersWidened = new Set();
  for (const item of fixture.scopeCases) {
    assert.equal(
      scopeIsNoWiderThan(item.subject, item.ceiling),
      item.subset,
      `scopeCases[${item.id}] subset verdict drifted`,
    );
    if (item.id.startsWith("scope-widen-")) scopeMembersWidened.add(item.id.slice("scope-widen-".length));
  }
  assertSameMembers(scopeMembersWidened, SCOPE_MEMBERS, "scopeCases widening coverage");
  assert.ok(
    fixture.scopeCases.some((item) => item.id === "scope-prefix-is-not-membership" && item.subset === false),
    "scopeCases must prove a path under an authorized root is not authorized",
  );
  assert.ok(
    fixture.scopeCases.some((item) => item.id === "scope-host-suffix-is-not-membership" && item.subset === false),
    "scopeCases must prove a subdomain of an authorized host is not authorized",
  );
  assert.ok(
    fixture.scopeCases.some((item) => item.id === "scope-case-difference-is-not-membership" && item.subset === false),
    "scopeCases must prove comparison is case sensitive",
  );
  assert.ok(isEmptyScope(fixture.scopes.empty), "fixture.scopes.empty must be the empty scope");
  for (const member of SCOPE_CEILING_MEMBERS) {
    assert.equal(fixture.scopes.empty[member], 0, `the empty scope must zero ${member}`);
  }

  // -- identity matrix -------------------------------------------------------
  const base = fixture.identityCases.base;
  assert.equal(base.requestId, computeRequestId(base.request), "identity base requestId drifted");
  assert.equal(base.requestHash, computeRequestHash(base.request), "identity base requestHash drifted");
  const seenIds = new Map([[base.requestId, "base"]]);
  const perturbedMembers = new Set();
  for (const item of fixture.identityCases.perturbations) {
    assert.ok(
      inputs.validateRequest(item.request),
      `identity perturbation ${item.member} must remain a well formed request`,
    );
    assert.equal(item.requestId, computeRequestId(item.request), `identity perturbation ${item.member} requestId drifted`);
    assert.equal(item.requestHash, computeRequestHash(item.request), `identity perturbation ${item.member} requestHash drifted`);
    assert.ok(
      !seenIds.has(item.requestId),
      `perturbing ${item.member} must change the request identity (collides with ${seenIds.get(item.requestId)})`,
    );
    seenIds.set(item.requestId, item.member);
    perturbedMembers.add(item.member);
    requestRecomputed += 2;
  }
  assert.equal(
    perturbedMembers.size,
    requestIdParts(base.request).length - 1,
    "every framed request part except the domain must have a perturbation vector",
  );

  const reasonOnly = fixture.identityCases.reasonOnly;
  assert.equal(reasonOnly.requestId, computeRequestId(reasonOnly.request));
  assert.equal(reasonOnly.requestHash, computeRequestHash(reasonOnly.request));
  assert.notEqual(reasonOnly.request.reason, base.request.reason, "the reason-only vector must change the reason");
  assert.equal(
    reasonOnly.requestId,
    base.requestId,
    "reason is outside the requestId framing, so rewording must not change the identity",
  );
  assert.notEqual(
    reasonOnly.requestHash,
    base.requestHash,
    "reason is inside requestHash, so rewording must change the document hash",
  );
  assert.equal(reasonOnly.requestIdEqualsBase, true);
  assert.equal(reasonOnly.requestHashEqualsBase, false);

  const grantBase = fixture.identityCases.grantBase;
  assert.equal(grantBase.grantId, computeGrantId(grantBase.grant), "identity grantBase grantId drifted");

  // -- framing: the naive-concatenation collision ----------------------------
  assert.ok(fixture.framingCases.length >= 1, "at least one framing case is required");
  for (const item of fixture.framingCases) {
    assert.ok(inputs.validateRequest(item.requestA), `${item.id} requestA must be well formed`);
    assert.ok(inputs.validateRequest(item.requestB), `${item.id} requestB must be well formed`);
    assert.notEqual(
      canonicalSerialize(item.requestA),
      canonicalSerialize(item.requestB),
      `${item.id} must use two genuinely different requests`,
    );
    const partsA = requestIdParts(item.requestA);
    const partsB = requestIdParts(item.requestB);
    const naiveA = naiveConcatenatedDigest(partsA);
    const naiveB = naiveConcatenatedDigest(partsB);
    const framedA = framedDigest(partsA);
    const framedB = framedDigest(partsB);
    // The structural property is asserted before the frozen literals, so a
    // probe that breaks the property fails on the property rather than on a
    // stale digest.
    assert.equal(
      naiveA,
      naiveB,
      `${item.id} proves nothing unless the two part lists actually collide without length prefixes`,
    );
    assert.notEqual(
      framedA,
      framedB,
      `${item.id} framing failed to separate two documents that collide under naive concatenation`,
    );
    assert.equal(item.naiveCollides, true, `${item.id} must be a naive-concatenation collision`);
    assert.equal(item.framedCollides, false, `${item.id} must not collide under framing`);
    assert.equal(item.naiveDigestA, naiveA, `${item.id} naiveDigestA drifted`);
    assert.equal(item.naiveDigestB, naiveB, `${item.id} naiveDigestB drifted`);
    assert.equal(item.framedDigestA, framedA, `${item.id} framedDigestA drifted`);
    assert.equal(item.framedDigestB, framedB, `${item.id} framedDigestB drifted`);
    assert.equal(framedA, item.requestA.requestId, `${item.id} requestA identity drifted`);
    assert.equal(framedB, item.requestB.requestId, `${item.id} requestB identity drifted`);
  }

  // -- presentations ---------------------------------------------------------
  const codeCoverage = new Set();
  const guardCoverage = new Set();
  const outcomeCoverage = new Set();
  const decisionCoverage = new Set();
  const operationKindCoverage = new Set();
  const sideEffectCoverage = new Set();
  const observedCoverage = new Set();
  const separationCoverage = new Set();
  const forkTransferCoverage = new Set();
  const scopeOperationCoverage = new Set();
  let grantRecomputed = 0;
  let grantedCount = 0;
  let refusedCount = 0;
  let replayCount = 0;

  const caseIds = new Set();
  for (const item of fixture.presentationCases) {
    assert.ok(!caseIds.has(item.id), `duplicate presentation case id ${item.id}`);
    caseIds.add(item.id);
    const authority = authorities[item.authority];
    assert.ok(authority !== undefined, `${item.id} names an unknown authority ${item.authority}`);

    const run = item.run;
    const context = {
      authority,
      request: item.request,
      grant: item.grant,
      run,
      ledger: item.ledger,
      descendants: item.descendants,
      fold: foldLedger(item.ledger.records),
      isTransplant: run.forkedFromRunId !== null
        && item.grant.runId === run.forkedFromRunId
        && item.grant.runId !== run.runId,
      validateRequest: inputs.validateRequest,
      validateGrant: inputs.validateGrant,
    };

    const actual = evaluatePresentation(context, neutralized);
    const expected = item.expect;
    assert.equal(actual.outcome, expected.outcome, `${item.id} outcome drifted`);
    assert.equal(actual.code, expected.code, `${item.id} error code drifted`);
    assert.equal(actual.guard, expected.guard, `${item.id} deciding guard drifted`);
    assert.equal(actual.writes, expected.writes, `${item.id} durable write count drifted`);
    assert.equal(actual.replay, expected.replay === true, `${item.id} replay classification drifted`);
    assert.notEqual(actual.outcome, "unknown", `${item.id} a presented grant is never unknown`);

    if (expected.code !== null) {
      assert.ok(ERROR_CODES.includes(expected.code), `${item.id} uses an undeclared code`);
      assert.equal(expected.outcome, "refused", `${item.id} an error can only be a refusal`);
      assert.equal(expected.writes, 0, `${item.id} a failing presentation must write nothing`);
      codeCoverage.add(expected.code);
    }
    if (expected.guard !== null) guardCoverage.add(expected.guard);
    outcomeCoverage.add(expected.outcome);
    if (expected.outcome === "granted") grantedCount += 1;
    if (expected.outcome === "refused") refusedCount += 1;
    if (expected.replay === true) replayCount += 1;

    // A grant only counts toward vocabulary coverage when it is honoured, so a
    // negative vector can never satisfy the coverage obligation for a member.
    if (expected.code === null && expected.replay !== true) {
      decisionCoverage.add(item.grant.decision);
      operationKindCoverage.add(item.grant.operationKind);
      sideEffectCoverage.add(item.request.sideEffects);
      if (item.grant.confirmation !== undefined) {
        observedCoverage.add(item.grant.confirmation.observedExternalState);
      }
      separationCoverage.add(authority.separation);
      if (context.isTransplant) forkTransferCoverage.add(authority.forkTransfer);
      assert.equal(
        actual.outcome,
        CONFERRING.has(item.grant.decision) ? "granted" : "refused",
        `${item.id} outcome must follow from the decision`,
      );
    }
    if (expected.code === "GE_APPROVAL_FORK_TRANSFER_DENIED" || expected.code === "GE_APPROVAL_FORK_REBIND_REQUIRED") {
      forkTransferCoverage.add(authority.forkTransfer);
    }
    if (expected.code === "GE_APPROVAL_SEPARATION_VIOLATION") separationCoverage.add(authority.separation);
    if (expected.code === "GE_APPROVAL_UNVERIFIED_REATTEMPT" || expected.code === "GE_APPROVAL_UNVERIFIED_ADOPTION") {
      observedCoverage.add(item.grant.confirmation.observedExternalState);
    }
    for (const scope of [item.request.requestedScope, item.grant.grantedScope]) {
      if (Array.isArray(scope?.operations)) for (const op of scope.operations) scopeOperationCoverage.add(op);
    }
    for (const scope of [authority.maxScope]) {
      for (const op of scope.operations) scopeOperationCoverage.add(op);
    }

    // Identity literals are recomputed for every well formed document in the
    // corpus, including the negatives, except where the vector exists precisely
    // to carry a wrong identity.
    if (expected.guard !== "request-identity" && inputs.validateRequest(item.request)) {
      assert.equal(item.request.requestId, computeRequestId(item.request), `${item.id} request identity drifted`);
      requestRecomputed += 1;
    }
    if (expected.guard !== "grant-identity" && expected.guard !== "shape-grant"
        && inputs.validateGrant(item.grant)) {
      assert.equal(item.grant.grantId, computeGrantId(item.grant), `${item.id} grant identity drifted`);
      grantRecomputed += 1;
    }
  }

  // -- waiting: silence is never a grant -------------------------------------
  const onUnansweredCoverage = new Set();
  for (const item of fixture.waitingCases) {
    const authority = authorities[item.authority];
    assert.ok(authority !== undefined, `${item.id} names an unknown authority`);
    const request = requestsByKey[item.request];
    assert.ok(request !== undefined, `${item.id} names an unknown request`);
    const actual = resolveUnanswered(authority, request, item.nowMs, item.approverReachable);
    assert.equal(actual.outcome, item.expect.outcome, `${item.id} unanswered outcome drifted`);
    assert.equal(actual.writes, item.expect.writes, `${item.id} unanswered write count drifted`);
    assert.notEqual(actual.outcome, "granted", `${item.id} silence can never be a grant`);
    assert.equal(item.expect.writes, 0, `${item.id} an unanswered request writes nothing`);
    outcomeCoverage.add(item.expect.outcome);
    if (item.approverReachable !== false && item.nowMs > request.expiresAtMs) {
      onUnansweredCoverage.add(authority.onUnanswered);
    }
  }
  assertSameMembers(onUnansweredCoverage, ON_UNANSWERED, "onUnanswered coverage");
  assert.ok(
    fixture.waitingCases.some((item) => item.approverReachable === false),
    "waitingCases must include an unreachable approver",
  );

  // -- discharge -------------------------------------------------------------
  const dischargeIds = new Set();
  for (const item of fixture.dischargeCases) {
    dischargeIds.add(item.id);
    assert.ok(
      inputs.validateBarrierDecision(item.barrierDecision),
      `${item.id} must carry a valid BarrierDecision`,
    );
    assert.equal(item.expect.decisionUnchanged, true, `${item.id} a discharge never rewrites the decision`);
    assert.equal(item.expect.nodeTerminal, "awaiting_human", `${item.id} the node terminal never changes`);
    assert.equal(item.expect.satisfied, false, `${item.id} a discharged barrier is still unsatisfied`);
    assert.equal(item.expect.bindsOutput, false, `${item.id} a discharged barrier still binds no output`);
    assert.equal(
      item.expect.contributesAwaitingHumanRank,
      item.expect.discharged === false,
      `${item.id} only an undischarged node holds the awaiting_human rank`,
    );
    assert.equal(
      item.barrierDecision.resolution,
      "awaiting_human",
      `${item.id} decision resolution must remain awaiting_human`,
    );
    assert.equal(
      item.expect.discharged,
      item.grantId !== null,
      `${item.id} discharge requires a committed conferring grant`,
    );
  }
  assert.ok(
    fixture.dischargeCases.some((item) => item.expect.discharged === true),
    "dischargeCases must include a discharged barrier",
  );
  assert.ok(
    fixture.dischargeCases.some((item) => item.expect.discharged === false && item.refusedGrantId != null),
    "dischargeCases must prove a refusal does not discharge",
  );

  // -- event payload envelopes -----------------------------------------------
  for (const item of fixture.envelopeCases) {
    const validate = item.eventType === "HumanInputRequested"
      ? inputs.validateRequestedEnvelope
      : inputs.validateReceivedEnvelope;
    assert.equal(validate(item.data), item.valid, `${item.id} envelope schema verdict drifted`);
    if (item.eventType === "HumanInputRequested" && item.valid) {
      const bound = computeDocumentHash(item.data.document) === item.data.request.subject.documentHash;
      assert.equal(bound, item.documentHashBinds, `${item.id} document binding verdict drifted`);
    }
  }
  assert.ok(
    fixture.envelopeCases.some((item) => (
      item.eventType === "HumanInputRequested" && item.valid && item.documentHashBinds === false
    )),
    "envelopeCases must prove a schema-valid envelope can still carry an unbound document",
  );
  assert.ok(
    fixture.envelopeCases.some((item) => (
      item.eventType === "HumanInputRequested" && item.valid && item.documentHashBinds === true
      && item.data.document.resolution === "awaiting_human"
    )),
    "envelopeCases must carry the BarrierDecision document the barrier contract requires",
  );

  // -- hard coverage assertions ---------------------------------------------
  assertSameMembers(codeCoverage, ERROR_CODES, "error-code coverage");
  assertSameMembers(guardCoverage, GUARD_IDS, "guard coverage");
  assertSameMembers(outcomeCoverage, OUTCOMES, "outcome coverage");
  assertSameMembers(decisionCoverage, DECISIONS, "decision coverage");
  assertSameMembers(operationKindCoverage, OPERATION_KINDS, "operation-kind coverage");
  assertSameMembers(sideEffectCoverage, SIDE_EFFECTS, "sideEffects coverage");
  assertSameMembers(observedCoverage, OBSERVED_STATES, "observedExternalState coverage");
  assertSameMembers(separationCoverage, SEPARATION, "separation coverage");
  assertSameMembers(forkTransferCoverage, FORK_TRANSFER, "forkTransfer coverage");
  assertSameMembers(scopeOperationCoverage, SCOPE_OPERATIONS, "scope operation coverage");
  assert.ok(replayCount >= 2, "the corpus must exercise more than one replay shape");
  assert.ok(grantedCount >= 1 && refusedCount >= 1, "both presented outcomes must occur");

  return {
    contract: fixture.contract,
    claims: { ...fixture.claims },
    neutralized: [...neutralized],
    authorities: Object.keys(fixture.authorities).length,
    authorityCases: fixture.authorityCases.length,
    subjectDocuments: Object.keys(fixture.subjectDocuments).length,
    requests: Object.keys(fixture.requests).length,
    scopeCases: fixture.scopeCases.length,
    identityPerturbations: fixture.identityCases.perturbations.length,
    framingCases: fixture.framingCases.length,
    presentationCases: fixture.presentationCases.length,
    presentationGranted: grantedCount,
    presentationRefused: refusedCount,
    presentationReplays: replayCount,
    waitingCases: fixture.waitingCases.length,
    dischargeCases: fixture.dischargeCases.length,
    envelopeCases: fixture.envelopeCases.length,
    guards: GUARD_IDS.length,
    errorCodesExercised: codeCoverage.size,
    guardsExercised: guardCoverage.size,
    recomputedLiterals:
      authorityRecomputed + documentRecomputed + requestRecomputed + grantRecomputed
      + fixture.framingCases.length * 4,
  };
}

export async function sweepGuardNeutralization() {
  const survivors = [];
  for (const id of GUARD_IDS) {
    let failed = false;
    try {
      await validateApprovalFixture({ neutralize: [id] });
    } catch {
      failed = true;
    }
    if (!failed) survivors.push(id);
  }
  return { guards: GUARD_IDS.length, held: GUARD_IDS.length - survivors.length, survivors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const neutralize = args
    .filter((arg) => arg.startsWith("--neutralize="))
    .map((arg) => arg.slice("--neutralize=".length));
  const summary = await validateApprovalFixture({ neutralize });

  let sweep = null;
  if (neutralize.length === 0 && !args.includes("--no-sweep")) {
    sweep = await sweepGuardNeutralization();
  }
  process.stdout.write(`${JSON.stringify({ ...summary, sweep }, null, 2)}\n`);
  if (sweep !== null && sweep.survivors.length > 0) {
    process.stderr.write(
      `Guard neutralization survivors (deleting each leaves the corpus green):\n${
        sweep.survivors.map((id) => `- ${id}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  }
}
