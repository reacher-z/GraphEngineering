// Adapter capability and conformance oracle for `adapter-contract/v1alpha1`.
//
// This module is a contract oracle, not an adapter. It implements every rule
// named in `spec/adapter-semantics.md` and executes the deterministic corpus in
// `adapter.case.json`. Nothing here dispatches to a provider, opens a socket,
// reads a credential or samples a clock.
//
// Three independent statements of the same facts are compared on every run:
//
//   1. the rule engine below, which recomputes derivations rather than reading
//      them;
//   2. `adapter.case.json`, the executable corpus; and
//   3. the normative tables inside `adapter-semantics.md`, parsed from source.
//
// A contract that describes a rule it never applies is the failure mode this
// triple check exists to catch.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const conformanceRoot = dirname(fileURLToPath(import.meta.url));
const specRoot = dirname(conformanceRoot);
const CASE_PATH = join(conformanceRoot, "adapter.case.json");
const SEMANTICS_PATH = join(specRoot, "adapter-semantics.md");
const BUDGET_SEMANTICS_PATH = join(specRoot, "budget-semantics.md");
const CYCLE_CONTROLLER_PATH = join(specRoot, "cycle-controller.schema.json");
const BUDGET_VECTOR_PATH = join(specRoot, "budget-vector.schema.json");

const SCHEMA_NAMES = Object.freeze([
  "adapter-capability.schema.json",
  "adapter-error.schema.json",
  "adapter-usage.schema.json",
  "adapter-descriptor.schema.json",
]);

const SAFE_INTEGER_MAX = 9007199254740991;

// Hosts a deterministic corpus is permitted to name. RFC 2606 / RFC 6761
// reserved names can never resolve to a routable address, so a corpus that
// only uses them cannot make a network call even if an implementation tried.
const NON_ROUTABLE_SUFFIXES = Object.freeze([".invalid", ".test"]);
const NON_ROUTABLE_EXACT = Object.freeze(["localhost"]);

// ---------------------------------------------------------------------------
// Failure carrier
// ---------------------------------------------------------------------------

class AdapterError extends Error {
  constructor(code, rule, message) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    this.rule = rule;
  }
}

function fail(code, rule, message) {
  throw new AdapterError(code, rule, message);
}

// ---------------------------------------------------------------------------
// Portable helpers
// ---------------------------------------------------------------------------

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const common = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < common; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function isSortedByCodePoint(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (compareUnicodeCodePoints(values[index - 1], values[index]) >= 0) return false;
  }
  return true;
}

function clone(value) {
  return structuredClone(value);
}

function pointerSegments(pointer) {
  if (pointer === "") return [];
  assert.ok(pointer.startsWith("/"), `JSON Pointer must be empty or start with '/': ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function mutationTarget(document, pointer) {
  const segments = pointerSegments(pointer);
  assert.ok(segments.length > 0, `root mutation is not supported: ${pointer}`);
  const leaf = segments.pop();
  let parent = document;
  for (const segment of segments) {
    assert.ok(
      parent !== null && typeof parent === "object" && Object.hasOwn(parent, segment),
      `mutation parent does not exist: ${pointer}`,
    );
    parent = parent[segment];
  }
  return { parent, leaf };
}

function applyMutations(document, mutations) {
  for (const mutation of mutations) {
    const { parent, leaf } = mutationTarget(document, mutation.path);
    if (mutation.op === "remove") {
      assert.ok(Object.hasOwn(parent, leaf), `remove target does not exist: ${mutation.path}`);
      if (Array.isArray(parent)) parent.splice(Number(leaf), 1);
      else delete parent[leaf];
      continue;
    }
    const value = clone(mutation.value);
    if (mutation.op === "add") {
      if (Array.isArray(parent)) {
        const index = Number(leaf);
        assert.ok(Number.isSafeInteger(index) && index >= 0 && index <= parent.length,
          `add index out of range: ${mutation.path}`);
        parent.splice(index, 0, value);
      } else {
        parent[leaf] = value;
      }
      continue;
    }
    assert.equal(mutation.op, "replace", `unknown mutation op: ${mutation.op}`);
    assert.ok(Object.hasOwn(parent, leaf), `replace target does not exist: ${mutation.path}`);
    parent[leaf] = value;
  }
  return document;
}

function isNonRoutableHost(host) {
  if (NON_ROUTABLE_EXACT.includes(host)) return true;
  return NON_ROUTABLE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

// ---------------------------------------------------------------------------
// Frozen taxonomy. The oracle states the irreducible facts once; the corpus and
// the semantics document each state them independently and all three must agree.
// ---------------------------------------------------------------------------

const TAXONOMY_FACTS = Object.freeze({
  GE_ADAPTER_AUTHENTICATION: { boundary: "dispatch", retryable: false, effectDisposition: "not-applied" },
  GE_ADAPTER_BOUNDS_EXCEEDED: { boundary: "pre-dispatch", retryable: false, effectDisposition: "not-applied" },
  GE_ADAPTER_CANCELLED: { boundary: "dispatch", retryable: false, effectDisposition: "in-doubt" },
  GE_ADAPTER_CAPABILITY_UNSUPPORTED: { boundary: "pre-dispatch", retryable: false, effectDisposition: "not-applied" },
  GE_ADAPTER_CONTENT_FILTERED: { boundary: "dispatch", retryable: false, effectDisposition: "applied" },
  GE_ADAPTER_DESCRIPTOR_INVALID: { boundary: "pre-dispatch", retryable: false, effectDisposition: "not-applied" },
  GE_ADAPTER_INVALID_REQUEST: { boundary: "dispatch", retryable: false, effectDisposition: "not-applied" },
  GE_ADAPTER_MALFORMED_RESPONSE: { boundary: "dispatch", retryable: true, effectDisposition: "applied" },
  GE_ADAPTER_POLICY_DENIED: { boundary: "pre-dispatch", retryable: false, effectDisposition: "not-applied" },
  GE_ADAPTER_QUOTA_EXCEEDED: { boundary: "dispatch", retryable: false, effectDisposition: "not-applied" },
  GE_ADAPTER_RATE_LIMITED: { boundary: "dispatch", retryable: true, effectDisposition: "not-applied" },
  GE_ADAPTER_TIMEOUT: { boundary: "dispatch", retryable: true, effectDisposition: "in-doubt" },
  GE_ADAPTER_TOOL_VALIDATION_FAILED: { boundary: "pre-dispatch", retryable: false, effectDisposition: "not-applied" },
  GE_ADAPTER_TRANSPORT_FAILURE: { boundary: "dispatch", retryable: true, effectDisposition: "in-doubt" },
});

// Derivations. These are computed, never read from any document.
function deriveUsageDisposition(effectDisposition) {
  return effectDisposition === "not-applied" ? "none" : "conservative";
}

function deriveLedgerAction(usageDisposition) {
  return usageDisposition === "none" ? "release-reservation" : "commit-conservative";
}

function deriveBudgetCostState(trust) {
  if (trust === "provider-reported") return "provider-reported";
  if (trust === "adapter-conservative") return "estimated";
  if (trust === "unknown") return "unknown";
  throw new Error(`unknown usage trust '${trust}'`);
}

// The one composition rule with cycle-semantics 13.4: an in-doubt external
// effect produces a durable in-doubt identity only for an external side-effect
// class. `none` never creates in-doubt evidence.
function requiresInDoubtRecord(effectDisposition, sideEffectClass) {
  return effectDisposition === "in-doubt" && sideEffectClass !== "none";
}

// cycle-semantics 13.4: `none` and `idempotent` may retry under the same stable
// key; `non-idempotent` stops after its first ambiguous outcome. "Ambiguous"
// is exactly `effectDisposition !== "not-applied"`.
function sideEffectPermitsRetry(effectDisposition, sideEffectClass) {
  if (sideEffectClass !== "non-idempotent") return true;
  return effectDisposition === "not-applied";
}

const RESOURCE_UNITS = Object.freeze({
  "audio-units": "usage-unit",
  "cached-input-units": "usage-unit",
  "image-units": "usage-unit",
  "input-units": "usage-unit",
  "output-units": "usage-unit",
  "provider-calls": "count",
  "reasoning-units": "usage-unit",
  "tool-calls": "count",
  "transport-bytes": "byte",
});

const CAPABILITY_IMPLICATIONS = Object.freeze([
  { rule: "D-009", capability: "cached-input-usage-reporting", requires: "usage-reporting" },
  { rule: "D-010", capability: "reasoning-usage-reporting", requires: "usage-reporting" },
  { rule: "D-011", capability: "parallel-tool-calls", requires: "tool-calling" },
  { rule: "D-012", capability: "retry-after-hint", requires: "rate-limit-reporting" },
]);

const MOCK_ONLY_CAPABILITIES = Object.freeze([
  { rule: "D-013", capability: "deterministic-replay" },
  { rule: "D-014", capability: "fault-injection" },
]);

const MODEL_ADAPTER_KINDS = Object.freeze([
  "anthropic",
  "google-gemini",
  "openai",
  "openai-compatible",
]);

const SIDE_EFFECT_ORDER = Object.freeze(["none", "idempotent", "non-idempotent"]);

// ---------------------------------------------------------------------------
// Rule: descriptor validation (D-###)
// ---------------------------------------------------------------------------

function validateDescriptor(descriptor) {
  const capabilities = descriptor.capabilities;
  const declared = new Set(capabilities);

  if (!isSortedByCodePoint(capabilities)) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-001",
      `adapter '${descriptor.adapterId}' capabilities are not in Unicode code-point order`);
  }

  if (descriptor.evidenceClass === "deterministic-mock" && descriptor.network !== null) {
    for (const host of descriptor.network.allowedHosts) {
      if (!isNonRoutableHost(host)) {
        fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-002",
          `deterministic-mock adapter '${descriptor.adapterId}' allows routable host '${host}'`);
      }
    }
  }

  const kind = descriptor.adapterKind;
  if (kind === "mock" &&
    (descriptor.network !== null || descriptor.process !== null || descriptor.mcp !== null)) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-003",
      "a mock adapter declares no network, process or MCP profile");
  }
  if (kind === "http" &&
    (descriptor.network === null || descriptor.process !== null || descriptor.mcp !== null)) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-004",
      "an http adapter declares exactly one network profile and no process or MCP profile");
  }
  if (kind === "shell" &&
    (descriptor.process === null || descriptor.network !== null || descriptor.mcp !== null)) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-005",
      "a shell adapter declares exactly one process profile and no network or MCP profile");
  }
  if (kind === "mcp" &&
    (descriptor.mcp === null || descriptor.network !== null || descriptor.process !== null)) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-006",
      "an mcp adapter declares exactly one MCP profile and no network or process profile");
  }
  if (MODEL_ADAPTER_KINDS.includes(kind) &&
    (descriptor.network === null || descriptor.process !== null || descriptor.mcp !== null)) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-007",
      `model adapter kind '${kind}' declares exactly one network profile`);
  }

  if (descriptor.sideEffectClass === "idempotent" && !declared.has("idempotency-key")) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-008",
      "an idempotent adapter must be able to pass a stable idempotency key");
  }

  for (const implication of CAPABILITY_IMPLICATIONS) {
    if (declared.has(implication.capability) && !declared.has(implication.requires)) {
      fail("GE_ADAPTER_DESCRIPTOR_INVALID", implication.rule,
        `capability '${implication.capability}' requires '${implication.requires}'`);
    }
  }

  for (const entry of MOCK_ONLY_CAPABILITIES) {
    if (declared.has(entry.capability) && descriptor.evidenceClass !== "deterministic-mock") {
      fail("GE_ADAPTER_DESCRIPTOR_INVALID", entry.rule,
        `capability '${entry.capability}' is available only to a deterministic-mock adapter`);
    }
  }

  if (descriptor.retryPolicy.maxBackoffMs < descriptor.retryPolicy.initialBackoffMs) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-015",
      "maxBackoffMs must not be below initialBackoffMs");
  }

  if (descriptor.capture.enabled !== (descriptor.capture.retention !== "none")) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-016",
      "capture.enabled and a non-none retention disposition must agree");
  }

  if (descriptor.network !== null) {
    const network = descriptor.network;
    if (network.rebindingDefense !== true) {
      fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-017",
        "a network adapter must declare DNS and IP rebinding defense");
    }
    if (network.credentialIsolation !== true) {
      fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-018",
        "a network adapter must isolate headers and credentials per host");
    }
    if (network.allowRedirects === true && network.redirectReauthorization !== true) {
      fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-019",
        "redirects are permitted only with redirect re-authorization");
    }
    if (network.allowedSchemes.includes("http")) {
      for (const host of network.allowedHosts) {
        if (!isNonRoutableHost(host)) {
          fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-020",
            `plaintext http is permitted only for non-routable hosts, not '${host}'`);
        }
      }
    }
    if (!isSortedByCodePoint(network.allowedSchemes) ||
      !isSortedByCodePoint(network.allowedHosts)) {
      fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-021",
        "network schemes and hosts must be in Unicode code-point order");
    }
    for (let index = 1; index < network.allowedPorts.length; index += 1) {
      if (network.allowedPorts[index - 1] >= network.allowedPorts[index]) {
        fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-021",
          "network ports must be strictly ascending");
      }
    }
  }

  if (descriptor.process !== null) {
    const process = descriptor.process;
    if (process.argumentVector[0] !== process.executablePath) {
      fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-022",
        "argumentVector[0] must be the explicit executable identity");
    }
    if (!isSortedByCodePoint(process.environmentAllowlist)) {
      fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-023",
        "environmentAllowlist must be in Unicode code-point order");
    }
  }

  if (descriptor.mcp !== null) {
    const mcp = descriptor.mcp;
    if (mcp.mode === "mutating") {
      if (mcp.approvalRequired !== true) {
        fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-024",
          "a mutating MCP adapter must require approval");
      }
      if (mcp.idempotencyRequired !== true) {
        fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-025",
          "a mutating MCP adapter must require an idempotency gate");
      }
      if (mcp.allowedTools.length === 0) {
        fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-026",
          "a mutating MCP adapter must name the exact tools it may mutate through");
      }
    }
    if (mcp.mode === "read-only" && descriptor.sideEffectClass === "non-idempotent") {
      fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-027",
        "a read-only MCP adapter cannot declare non-idempotent side effects");
    }
  }

  const metricKeys = descriptor.allowedProviderMetrics.map(
    (metric) => `${metric.metricId}\u0000${metric.unitId}`,
  );
  if (!isSortedByCodePoint(metricKeys)) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-028",
      "allowedProviderMetrics must be unique and ordered by metricId + U+0000 + unitId");
  }

  if (declared.has("streaming") && descriptor.bounds.maxStreamFrames < 2) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-030",
      "a streaming adapter must admit at least a start and a finish frame");
  }
  if (!declared.has("tool-calling") &&
    (descriptor.bounds.maxToolDefinitions !== 0 || descriptor.bounds.maxToolCallsPerResponse !== 0)) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-031",
      "an adapter without tool-calling must bound tool definitions and tool calls at zero");
  }
  if (!declared.has("attachments") && descriptor.bounds.maxAttachments !== 0) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-032",
      "an adapter without attachments must bound attachments at zero");
  }
  if (descriptor.bounds.maxStreamFrameBytes > descriptor.bounds.maxResponseBytes) {
    fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-033",
      "a single stream frame cannot exceed the whole response bound");
  }
  return true;
}

// D-029 needs the active budget policy allowlist, which is corpus state rather
// than descriptor state, so it is a separate entry point.
function validateDescriptorAgainstBudgetPolicy(descriptor, policyMetrics) {
  const allowed = new Set(
    policyMetrics.map((metric) => `${metric.metricId}\u0000${metric.unitId}\u0000${metric.aggregation}`),
  );
  for (const metric of descriptor.allowedProviderMetrics) {
    const key = `${metric.metricId}\u0000${metric.unitId}\u0000${metric.aggregation}`;
    if (!allowed.has(key)) {
      fail("GE_ADAPTER_DESCRIPTOR_INVALID", "D-029",
        `provider metric '${metric.metricId}' is not in the active budget policy allowlist`);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Rule: dispatch preflight (P-###)
// ---------------------------------------------------------------------------

function capabilityFailureMessage(capability, requestId, adapterId) {
  return `Adapter capability '${capability}' required by request '${requestId}' is not declared by adapter '${adapterId}'`;
}

function preflight(descriptor, request, policyMetrics) {
  // P-030: an invalid descriptor is refused before any request rule runs, so a
  // broken adapter can never reach a provider by supplying a benign request.
  validateDescriptor(descriptor);
  validateDescriptorAgainstBudgetPolicy(descriptor, policyMetrics);

  const declared = new Set(descriptor.capabilities);
  const missing = request.requiredCapabilities
    .filter((capability) => !declared.has(capability))
    .sort(compareUnicodeCodePoints);
  if (missing.length > 0) {
    fail("GE_ADAPTER_CAPABILITY_UNSUPPORTED", "P-001",
      capabilityFailureMessage(missing[0], request.requestId, descriptor.adapterId));
  }

  const implied = [
    { rule: "P-002", active: request.streaming === true, capability: "streaming" },
    { rule: "P-003", active: request.structuredOutput === true, capability: "structured-output" },
    { rule: "P-004", active: request.toolDefinitions.length > 0, capability: "tool-calling" },
    { rule: "P-005", active: request.attachments.length > 0, capability: "attachments" },
    { rule: "P-006", active: request.cancellable === true, capability: "cancellation" },
    { rule: "P-029", active: request.idempotencyKey !== null, capability: "idempotency-key" },
  ];
  for (const entry of implied) {
    if (entry.active && !declared.has(entry.capability)) {
      fail("GE_ADAPTER_CAPABILITY_UNSUPPORTED", entry.rule,
        capabilityFailureMessage(entry.capability, request.requestId, descriptor.adapterId));
    }
  }

  if (SIDE_EFFECT_ORDER.indexOf(request.sideEffectClass) >
    SIDE_EFFECT_ORDER.indexOf(descriptor.sideEffectClass)) {
    fail("GE_ADAPTER_POLICY_DENIED", "P-007",
      "a request cannot escalate beyond the side-effect class the adapter is authorized for",
    );
  }

  if (request.requestBytes > descriptor.bounds.maxRequestBytes) {
    fail("GE_ADAPTER_BOUNDS_EXCEEDED", "P-008", "request exceeds maxRequestBytes");
  }
  if (request.attachments.length > descriptor.bounds.maxAttachments) {
    fail("GE_ADAPTER_BOUNDS_EXCEEDED", "P-009", "request exceeds maxAttachments");
  }
  let attachmentBytes = 0;
  for (const attachment of request.attachments) {
    attachmentBytes += attachment.bytes;
    if (attachment.bytes > descriptor.bounds.maxAttachmentBytes ||
      attachmentBytes > descriptor.bounds.maxAttachmentBytes) {
      fail("GE_ADAPTER_BOUNDS_EXCEEDED", "P-010", "attachment payload exceeds maxAttachmentBytes");
    }
  }
  if (request.toolDefinitions.length > descriptor.bounds.maxToolDefinitions) {
    fail("GE_ADAPTER_BOUNDS_EXCEEDED", "P-011", "request exceeds maxToolDefinitions");
  }
  const definitionNames = request.toolDefinitions.map((definition) => definition.name);
  if (new Set(definitionNames).size !== definitionNames.length) {
    fail("GE_ADAPTER_TOOL_VALIDATION_FAILED", "P-012", "tool definition names must be unique");
  }

  if (request.circuitState === "open") {
    fail("GE_ADAPTER_POLICY_DENIED", "P-013", "the adapter circuit is open");
  }

  if (request.target !== null) {
    const network = descriptor.network;
    const target = request.target;
    if (network === null || !network.allowedSchemes.includes(target.scheme)) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-014", `scheme '${target.scheme}' is not allowlisted`);
    }
    if (!network.allowedHosts.includes(target.host)) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-015", `host '${target.host}' is not allowlisted`);
    }
    if (!network.allowedPorts.includes(target.port)) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-016", `port ${target.port} is not allowlisted`);
    }
    if (target.redirected === true && network.allowRedirects !== true) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-018", "this adapter does not follow redirects");
    }
    if (target.redirected === true && target.reauthorized !== true) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-017",
        "a redirect target must be re-authorized against the allowlist");
    }
    if (target.redirected === true && target.scheme === "http") {
      // D-020 already refuses a descriptor that allowlists plaintext to a
      // routable host. What remains reachable at dispatch time is a redirect
      // that downgrades an https request onto an allowlisted plaintext origin.
      fail("GE_ADAPTER_POLICY_DENIED", "P-019",
        "a redirect may not downgrade the transport to plaintext");
    }
  }

  if (request.mcpCall !== null) {
    const mcp = descriptor.mcp;
    const call = request.mcpCall;
    if (mcp === null || !mcp.allowedTools.includes(call.tool)) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-020", `MCP tool '${call.tool}' is not allowlisted`);
    }
    if (call.mutating === true && mcp.mode !== "mutating") {
      fail("GE_ADAPTER_POLICY_DENIED", "P-021",
        "a read-only MCP adapter refuses a mutating call");
    }
    if (call.mutating === true && call.approvalToken === null) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-022",
        "a mutating MCP call requires an approval token");
    }
  }

  if (request.processCall !== null) {
    const profile = descriptor.process;
    const call = request.processCall;
    if (profile === null || call.argumentVector[0] !== profile.executablePath) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-023",
        "the call does not name the adapter's explicit executable identity");
    }
    for (let index = 0; index < profile.argumentVector.length; index += 1) {
      if (call.argumentVector[index] !== profile.argumentVector[index]) {
        fail("GE_ADAPTER_POLICY_DENIED", "P-024",
          "the declared argument vector must be an exact prefix of the call");
      }
    }
    for (const name of call.environment) {
      if (!profile.environmentAllowlist.includes(name)) {
        fail("GE_ADAPTER_POLICY_DENIED", "P-025",
          `environment variable '${name}' is not allowlisted`);
      }
    }
    if (profile.stdinPolicy === "closed" && call.stdinBytes > 0) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-026", "this adapter runs with stdin closed");
    }
    for (const argument of call.argumentVector) {
      if (argument.includes("\u0000")) {
        fail("GE_ADAPTER_POLICY_DENIED", "P-027", "an argument contains a NUL byte");
      }
    }
  }

  if (request.sideEffectClass === "idempotent" && request.idempotencyKey === null) {
    fail("GE_ADAPTER_POLICY_DENIED", "P-028",
      "an idempotent request must carry a stable idempotency key");
  }

  return Object.freeze({
    admitted: true,
    adapterId: descriptor.adapterId,
    requestId: request.requestId,
    sideEffectClass: request.sideEffectClass,
    idempotencyKey: request.idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// Rule: streamed response normalization (S-###)
// ---------------------------------------------------------------------------

const STREAM_FRAME_KINDS = Object.freeze(["finish", "start", "text-delta", "tool-call", "usage"]);

function normalizeStream(descriptor, frames) {
  const declared = new Set(descriptor.capabilities);
  const bounds = descriptor.bounds;

  if (frames.length > bounds.maxStreamFrames) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-008", "stream exceeds maxStreamFrames");
  }
  if (frames.length === 0 || frames[0].kind !== "start") {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-001", "a stream must open with a start frame");
  }

  let startCount = 0;
  let usageCount = 0;
  let toolCallCount = 0;
  let textBytes = 0;
  let finished = false;
  let finishReason = null;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    assert.ok(STREAM_FRAME_KINDS.includes(frame.kind), `unknown stream frame kind '${frame.kind}'`);

    if (finished) {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-005", "a frame arrived after the finish frame");
    }
    if (index === 0 && frame.sequence !== 0) {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-003", "stream sequence must start at zero");
    }
    if (index > 0 && frame.sequence !== frames[index - 1].sequence + 1) {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-004",
        "stream sequence must increase by exactly one");
    }
    if (frame.bytes > bounds.maxStreamFrameBytes) {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-007", "stream frame exceeds maxStreamFrameBytes");
    }

    if (frame.kind === "start") {
      startCount += 1;
      if (startCount > 1) {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-002", "a stream carries exactly one start frame");
      }
    } else if (frame.kind === "text-delta") {
      textBytes += frame.bytes;
      if (textBytes > bounds.maxResponseBytes) {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-013", "streamed text exceeds maxResponseBytes");
      }
    } else if (frame.kind === "tool-call") {
      if (!declared.has("tool-calling")) {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-011",
          "a provider emitted a tool call to an adapter without tool-calling");
      }
      toolCallCount += 1;
      if (toolCallCount > 1 && !declared.has("parallel-tool-calls")) {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-016",
          "more than one tool call requires parallel-tool-calls");
      }
      if (toolCallCount > bounds.maxToolCallsPerResponse) {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-012",
          "stream exceeds maxToolCallsPerResponse");
      }
    } else if (frame.kind === "usage") {
      if (!declared.has("usage-reporting")) {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-010",
          "a provider reported usage to an adapter without usage-reporting");
      }
      usageCount += 1;
      if (usageCount > 1) {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-009", "a stream carries at most one usage frame");
      }
    } else {
      finished = true;
      finishReason = frame.finishReason;
      if (finishReason === "cancelled") {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-015",
          "cancellation is a caller fact and is never a provider finish reason");
      }
      if (finishReason === "tool-calls" && toolCallCount === 0) {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-014",
          "finishReason tool-calls requires at least one tool call");
      }
      if (finishReason === "content-filter" && !declared.has("content-filter-reporting")) {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "S-017",
          "finishReason content-filter requires content-filter-reporting");
      }
    }
  }

  if (!finished) {
    // A truncated stream is a transport fact, not a protocol fact: the provider
    // may have completed the work and lost the connection, so it is in-doubt.
    fail("GE_ADAPTER_TRANSPORT_FAILURE", "S-006",
      "the provider disconnected before the finish frame");
  }

  return Object.freeze({
    frames: frames.length,
    textBytes,
    toolCalls: toolCallCount,
    usageFrames: usageCount,
    finishReason,
  });
}

// ---------------------------------------------------------------------------
// Rule: usage envelope normalization (U-###)
// ---------------------------------------------------------------------------

const CAPABILITY_GATED_RESOURCES = Object.freeze([
  { rule: "U-009", resource: "cached-input-units", capability: "cached-input-usage-reporting" },
  { rule: "U-010", resource: "reasoning-units", capability: "reasoning-usage-reporting" },
  { rule: "U-011", resource: "image-units", capability: "attachments" },
  { rule: "U-011", resource: "audio-units", capability: "attachments" },
  { rule: "U-012", resource: "tool-calls", capability: "tool-calling" },
]);

const USAGE_UNIT_RESOURCES = Object.freeze([
  "audio-units",
  "cached-input-units",
  "image-units",
  "input-units",
  "output-units",
  "reasoning-units",
]);

function validateUsage(descriptor, usage) {
  const declared = new Set(descriptor.capabilities);
  const resources = usage.quantities.map((quantity) => quantity.resource);

  for (const resource of resources) {
    if (!Object.hasOwn(RESOURCE_UNITS, resource)) {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-005",
        `resource '${resource}' is not adapter-reportable; adapters report meters, never money`);
    }
  }
  if (new Set(resources).size !== resources.length) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-002", "usage resources must be unique");
  }
  if (!isSortedByCodePoint(resources)) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-001",
      "usage quantities must be in Unicode code-point order by resource");
  }
  for (const quantity of usage.quantities) {
    if (quantity.unit !== RESOURCE_UNITS[quantity.resource]) {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-003",
        `resource '${quantity.resource}' has a fixed unit '${RESOURCE_UNITS[quantity.resource]}'`);
    }
    if (quantity.aggregation !== "sum") {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-004",
        "an adapter reports only sum-aggregated resources");
    }
    if (!Number.isSafeInteger(quantity.amount) || quantity.amount < 1 ||
      quantity.amount > SAFE_INTEGER_MAX) {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-016",
        "usage amounts must be positive portable integers; zero is absence");
    }
  }

  if (usage.budgetCostState !== deriveBudgetCostState(usage.trust)) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-006",
      "budgetCostState must be the derivation of trust");
  }

  const byResource = new Map(usage.quantities.map((quantity) => [quantity.resource, quantity.amount]));
  if (!byResource.has("provider-calls")) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-007",
      "every dispatch-boundary usage envelope records at least one provider call");
  }

  if (usage.trust === "provider-reported" && !declared.has("usage-reporting")) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-008",
      "provider-reported trust requires the usage-reporting capability");
  }

  for (const gate of CAPABILITY_GATED_RESOURCES) {
    if (byResource.has(gate.resource) && !declared.has(gate.capability)) {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", gate.rule,
        `resource '${gate.resource}' requires capability '${gate.capability}'`);
    }
  }

  if (usage.providerRequestId !== null && !declared.has("provider-request-id")) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-013",
      "a provider request identity requires the provider-request-id capability");
  }

  const metricKeys = usage.providerSpecific.map(
    (metric) => `${metric.metricId}\u0000${metric.unitId}`,
  );
  if (!isSortedByCodePoint(metricKeys)) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-014",
      "provider metrics must be unique and ordered by metricId + U+0000 + unitId");
  }
  const allowedMetrics = new Set(
    descriptor.allowedProviderMetrics.map((metric) => `${metric.metricId}\u0000${metric.unitId}`),
  );
  for (const key of metricKeys) {
    if (!allowedMetrics.has(key)) {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-015",
        "a provider metric outside the descriptor allowlist is never silently bucketed");
    }
  }

  if (usage.finishReason === "content-filter" && !declared.has("content-filter-reporting")) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-017",
      "a content-filter finish reason requires content-filter-reporting");
  }

  if (!declared.has("usage-reporting")) {
    if (usage.trust !== "unknown") {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-018",
        "an adapter without usage-reporting must report unknown trust");
    }
    for (const resource of USAGE_UNIT_RESOURCES) {
      if (byResource.has(resource)) {
        fail("GE_ADAPTER_MALFORMED_RESPONSE", "U-018",
          "an adapter without usage-reporting cannot report a usage-unit meter");
      }
    }
  }

  return Object.freeze({
    resources: resources.length,
    providerCalls: byResource.get("provider-calls"),
    budgetCostState: usage.budgetCostState,
  });
}

// ---------------------------------------------------------------------------
// Rule: model-emitted tool call validation (T-###)
// ---------------------------------------------------------------------------

function validateToolCalls(descriptor, request, response) {
  const definitions = new Map(
    request.toolDefinitions.map((definition) => [definition.name, definition]),
  );
  const authorized = new Set(response.authorizedTools);

  if (response.toolCalls.length > descriptor.bounds.maxToolCallsPerResponse) {
    fail("GE_ADAPTER_TOOL_VALIDATION_FAILED", "T-003",
      "the response exceeds maxToolCallsPerResponse");
  }
  const ids = response.toolCalls.map((call) => call.id);
  if (new Set(ids).size !== ids.length) {
    fail("GE_ADAPTER_TOOL_VALIDATION_FAILED", "T-004", "tool call identifiers must be unique");
  }
  for (const call of response.toolCalls) {
    const definition = definitions.get(call.name);
    if (definition === undefined) {
      fail("GE_ADAPTER_TOOL_VALIDATION_FAILED", "T-001",
        `tool '${call.name}' was not declared to the provider`);
    }
    for (const required of definition.requiredArguments) {
      if (!Object.hasOwn(call.arguments, required)) {
        fail("GE_ADAPTER_TOOL_VALIDATION_FAILED", "T-002",
          `tool '${call.name}' is missing required argument '${required}'`);
      }
    }
    for (const name of Object.keys(call.arguments)) {
      if (!definition.allowedArguments.includes(name)) {
        fail("GE_ADAPTER_TOOL_VALIDATION_FAILED", "T-002",
          `tool '${call.name}' received an undeclared argument '${name}'`);
      }
    }
    if (!authorized.has(call.name)) {
      fail("GE_ADAPTER_TOOL_VALIDATION_FAILED", "T-005",
        "authority comes from policy; a model-selected tool never grants it");
    }
    if (descriptor.mcp !== null && !descriptor.mcp.allowedTools.includes(call.name)) {
      fail("GE_ADAPTER_TOOL_VALIDATION_FAILED", "T-006",
        "a tool description cannot widen the MCP server allowlist");
    }
  }
  return Object.freeze({ toolCalls: response.toolCalls.length });
}

// ---------------------------------------------------------------------------
// Rule: retry decision (R-###) and circuit breaker (C-###)
// ---------------------------------------------------------------------------

function computedBackoffMs(policy, attempt) {
  let numerator = BigInt(policy.initialBackoffMs);
  let denominator = 1n;
  for (let step = 1; step < attempt; step += 1) {
    numerator *= BigInt(policy.backoffMultiplierMilli);
    denominator *= 1000n;
  }
  const value = numerator / denominator;
  const ceiling = BigInt(policy.maxBackoffMs);
  return Number(value > ceiling ? ceiling : value);
}

function retryDecision(descriptor, code, sideEffectClass, attempt, retryAfterMs) {
  const facts = TAXONOMY_FACTS[code];
  assert.ok(facts !== undefined, `unknown adapter error code '${code}'`);
  assert.ok(SIDE_EFFECT_ORDER.includes(sideEffectClass),
    `unknown side-effect class '${sideEffectClass}'`);
  assert.ok(Number.isSafeInteger(attempt) && attempt >= 1, "attempt must be a positive integer");
  assert.ok(retryAfterMs === null || (Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0),
    "retryAfterMs must be null or a non-negative integer");
  const policy = descriptor.retryPolicy;

  if (!facts.retryable) {
    return Object.freeze({ mayRetry: false, backoffMs: null, rule: "R-005" });
  }
  if (attempt >= policy.maxAttempts) {
    return Object.freeze({ mayRetry: false, backoffMs: null, rule: "R-004" });
  }
  if (!sideEffectPermitsRetry(facts.effectDisposition, sideEffectClass)) {
    return Object.freeze({ mayRetry: false, backoffMs: null, rule: "R-006" });
  }
  const computed = computedBackoffMs(policy, attempt);
  if (retryAfterMs === null) {
    return Object.freeze({ mayRetry: true, backoffMs: computed, rule: "R-001" });
  }
  const effective = Math.max(computed, retryAfterMs);
  if (effective > policy.maxBackoffMs) {
    // Truncating a provider's own backoff request to the local ceiling would
    // re-dispatch inside the window the provider refused. Abandon instead.
    return Object.freeze({ mayRetry: false, backoffMs: null, rule: "R-003" });
  }
  return Object.freeze({ mayRetry: true, backoffMs: effective, rule: "R-002" });
}

const CIRCUIT_EVENTS = Object.freeze(["advance", "failure", "success"]);

function circuitFold(descriptor, script) {
  const policy = descriptor.circuitPolicy;
  for (const step of script) {
    assert.ok(CIRCUIT_EVENTS.includes(step.event),
      `unknown circuit script event '${step.event}'`);
    assert.ok(Number.isSafeInteger(step.nowMs) && step.nowMs >= 0,
      "circuit script time must be an injected non-negative integer");
    if (step.event === "failure") {
      assert.ok(TAXONOMY_FACTS[step.code] !== undefined,
        `unknown adapter error code '${step.code}' in a circuit script`);
    }
  }
  let state = "closed";
  let consecutiveFailures = 0;
  let openedAtMs = null;
  let admitted = 0;
  let refused = 0;

  for (const step of script) {
    if (step.event === "advance") {
      // The injected clock is the only source of time in this contract.
      if (state === "open" && openedAtMs !== null &&
        step.nowMs - openedAtMs >= policy.openDurationMs) {
        state = "half-open"; // C-003
      }
      continue;
    }
    if (state === "open") {
      refused += 1; // C-004: an open circuit admits nothing.
      continue;
    }
    admitted += 1;
    if (step.event === "success") {
      consecutiveFailures = 0; // C-002
      state = "closed"; // C-005
      openedAtMs = null;
      continue;
    }
    const facts = TAXONOMY_FACTS[step.code];
    assert.ok(facts !== undefined, `unknown adapter error code '${step.code}'`);
    if (facts.boundary === "pre-dispatch" || !facts.retryable) {
      continue; // C-007: only retryable dispatch failures move the breaker.
    }
    if (state === "half-open") {
      state = "open"; // C-006
      openedAtMs = step.nowMs;
      consecutiveFailures = policy.consecutiveFailureThreshold;
      continue;
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= policy.consecutiveFailureThreshold) {
      state = "open"; // C-001
      openedAtMs = step.nowMs;
    }
  }
  return Object.freeze({ state, consecutiveFailures, openedAtMs, admitted, refused });
}

// ---------------------------------------------------------------------------
// Rule: normalized error envelope consistency (E-###)
// ---------------------------------------------------------------------------

function validateErrorEnvelope(descriptor, error, forbiddenMarkers) {
  const facts = TAXONOMY_FACTS[error.code];
  assert.ok(facts !== undefined, `unknown adapter error code '${error.code}'`);
  const declared = new Set(descriptor.capabilities);

  if (error.retryable !== facts.retryable) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-001",
      "retryability is a property of the code and cannot be restated");
  }
  if (error.boundary !== facts.boundary) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-002", "boundary is a property of the code");
  }
  if (error.effectDisposition !== facts.effectDisposition) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-003",
      "external-effect disposition is a property of the code");
  }
  if (error.usageDisposition !== deriveUsageDisposition(facts.effectDisposition)) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-004",
      "usage disposition is derived from the effect disposition");
  }
  if ((error.denialReason !== null) !== (error.code === "GE_ADAPTER_POLICY_DENIED")) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-005",
      "a denial reason accompanies GE_ADAPTER_POLICY_DENIED and nothing else");
  }
  if (error.providerRequestId !== null && facts.boundary !== "dispatch") {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-006",
      "a pre-dispatch refusal never reached the provider");
  }
  if (error.providerRequestId !== null && !declared.has("provider-request-id")) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-007",
      "a provider request identity requires the provider-request-id capability");
  }
  if (error.retryAfterMs !== null && !facts.retryable) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-008",
      "a backoff hint on a non-retryable code is meaningless");
  }
  if (error.retryAfterMs !== null && !declared.has("retry-after-hint")) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-009",
      "a backoff hint requires the retry-after-hint capability");
  }
  if (error.usageDisposition === "none" && error.usage !== null) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-010",
      "a refusal that performed no external work reports no usage");
  }
  if (error.usage !== null &&
    (error.usage.adapterId !== error.adapterId ||
      error.usage.adapterKind !== error.adapterKind ||
      error.usage.requestId !== error.requestId)) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-011",
      "an attached usage envelope must bind the same adapter and request");
  }
  if (error.attempt > descriptor.retryPolicy.maxAttempts) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-012",
      "an attempt index cannot exceed the declared attempt ceiling");
  }
  if (SIDE_EFFECT_ORDER.indexOf(error.sideEffectClass) >
    SIDE_EFFECT_ORDER.indexOf(descriptor.sideEffectClass)) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-013",
      "an error cannot report a stronger side-effect class than the adapter declares");
  }
  const haystack = [
    error.message,
    ...error.detail.providerSafeFields.map((field) => `${field.name}=${field.value}`),
  ].join("\u0000");
  for (const marker of forbiddenMarkers) {
    if (haystack.includes(marker)) {
      fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-014",
        "an adapter error must not carry credentials, prompts or unredacted payloads");
    }
  }
  const names = error.detail.providerSafeFields.map((field) => field.name);
  if (new Set(names).size !== names.length || !isSortedByCodePoint(names)) {
    fail("GE_ADAPTER_MALFORMED_RESPONSE", "E-015",
      "provider-safe detail names must be unique and ordered");
  }

  return Object.freeze({
    code: error.code,
    ledgerAction: deriveLedgerAction(error.usageDisposition),
    requiresInDoubtRecord: requiresInDoubtRecord(error.effectDisposition, error.sideEffectClass),
  });
}

// ---------------------------------------------------------------------------
// Normative table extraction from the semantics documents
// ---------------------------------------------------------------------------

function markdownTableRows(source, headingRegex) {
  const match = headingRegex.exec(source);
  assert.ok(match !== null, `table anchor ${headingRegex} not found`);
  const body = source.slice(match.index + match[0].length);
  const lines = body.split("\n");
  const rows = [];
  let started = false;
  for (const line of lines) {
    if (line.startsWith("|")) {
      started = true;
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      rows.push(line.slice(1, line.lastIndexOf("|")).split("|").map((cell) => cell.trim()));
      continue;
    }
    if (started && line.trim() === "") break;
    if (started) break;
  }
  return rows;
}

function stripTicks(value) {
  return value.replace(/^`|`$/g, "");
}

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

export async function validateAdapterFixture() {
  const fixture = JSON.parse(await readFile(CASE_PATH, "utf8"));
  const semantics = await readFile(SEMANTICS_PATH, "utf8");
  const budgetSemantics = await readFile(BUDGET_SEMANTICS_PATH, "utf8");
  const cycleController = JSON.parse(await readFile(CYCLE_CONTROLLER_PATH, "utf8"));
  const budgetVector = JSON.parse(await readFile(BUDGET_VECTOR_PATH, "utf8"));

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const schemas = new Map();
  for (const name of SCHEMA_NAMES) {
    const schema = JSON.parse(await readFile(join(specRoot, name), "utf8"));
    assert.equal(
      ajv.validateSchema(schema),
      true,
      `${name} is not a valid Draft 2020-12 schema: ${JSON.stringify(ajv.errors)}`,
    );
    schemas.set(name, schema);
    ajv.addSchema(schema);
  }
  const compiled = new Map(SCHEMA_NAMES.map((name) => [name, ajv.compile(schemas.get(name))]));
  const validateDescriptorShape = compiled.get("adapter-descriptor.schema.json");
  const validateUsageShape = compiled.get("adapter-usage.schema.json");
  const validateErrorShape = compiled.get("adapter-error.schema.json");

  // --- honest-claim flags --------------------------------------------------
  assert.equal(fixture.apiVersion,
    "graphengineering.reacher-z.github.io/adapter-conformance/v1alpha1",
    "adapter corpus apiVersion drifted");
  assert.equal(fixture.contractStatus, "contract-only-native-implementation-required",
    "adapter corpus contractStatus drifted");
  assert.equal(fixture.implementationClaim, false,
    "adapter corpus implementationClaim must be literally false");
  assert.equal(typeof fixture.implementationClaim, "boolean",
    "implementationClaim must be a boolean literal, not a truthy string");
  assert.equal(fixture.evidenceClass, "deterministic-mock",
    "the candidate corpus is deterministic-mock evidence only");
  assert.deepEqual(fixture.environmentAssertions, {
    credentialRequired: false,
    injectedClockOnly: true,
    networkAccess: false,
    wallClockDependence: false,
  }, "environment assertions drifted");

  // --- enum inventories: corpus must equal schema, exactly and in order ----
  const capabilityEnum = schemas.get("adapter-capability.schema.json").enum;
  const errorSchema = schemas.get("adapter-error.schema.json");
  const codeEnum = errorSchema.$defs.errorCode.enum;
  const denialEnum = errorSchema.$defs.denialReason.enum;
  const sideEffectEnum = errorSchema.$defs.sideEffectClass.enum;
  const kindEnum = schemas.get("adapter-descriptor.schema.json").$defs.adapterKind.enum;
  const usageSchema = schemas.get("adapter-usage.schema.json");
  const resourceEnum = usageSchema.$defs.reportableResource.enum;
  const finishEnum = usageSchema.$defs.finishReason.enum;

  assert.deepEqual(fixture.capabilityInventory, capabilityEnum, "capabilityInventory drifted");
  assert.deepEqual(fixture.adapterKindInventory, kindEnum, "adapterKindInventory drifted");
  assert.deepEqual(fixture.denialReasonInventory, denialEnum, "denialReasonInventory drifted");
  assert.deepEqual(fixture.finishReasonInventory, finishEnum, "finishReasonInventory drifted");
  assert.deepEqual(fixture.reportableResourceInventory, resourceEnum,
    "reportableResourceInventory drifted");
  for (const [label, values] of [
    ["capability", capabilityEnum], ["adapter kind", kindEnum], ["denial reason", denialEnum],
    ["finish reason", finishEnum], ["reportable resource", resourceEnum], ["error code", codeEnum],
  ]) {
    assert.ok(isSortedByCodePoint(values), `${label} enum is not in Unicode code-point order`);
  }
  assert.equal(capabilityEnum.length, 16, "the capability enum is frozen at sixteen members");
  assert.equal(codeEnum.length, 14, "the error taxonomy is frozen at fourteen codes");
  assert.equal(kindEnum.length, 8, "the official v1 adapter set is frozen at eight kinds");

  // --- X-001: side-effect vocabulary is the cycle contract's, byte for byte -
  const cycleSideEffects =
    cycleController.$defs.activity.properties.sideEffects.enum;
  assert.deepEqual(sideEffectEnum, cycleSideEffects,
    "X-001 adapter side-effect classes must equal cycle-controller sideEffects exactly");
  assert.deepEqual(SIDE_EFFECT_ORDER, cycleSideEffects,
    "X-001 the oracle's escalation order must equal the cycle vocabulary");
  assert.deepEqual(fixture.cycleComposition.sideEffectClasses, cycleSideEffects,
    "X-001 corpus side-effect classes drifted from the cycle contract");

  // --- X-002..X-005: adapter meters against the frozen budget contract -----
  const budgetResourceEnum = budgetVector.$defs.quantity.properties.resource.enum;
  const budgetRows = markdownTableRows(budgetSemantics, /### 4\.1 Portable resources\n\n/);
  assert.equal(budgetRows.length, budgetResourceEnum.length + 1,
    "budget-semantics 4.1 row count differs from the budget-vector resource enum");
  const budgetTable = new Map();
  for (const row of budgetRows.slice(1)) {
    budgetTable.set(stripTicks(row[0]), { unit: stripTicks(row[1]), aggregation: stripTicks(row[2]) });
  }
  for (const resource of budgetResourceEnum) {
    assert.ok(budgetTable.has(resource),
      `X-003 budget resource '${resource}' has no row in budget-semantics 4.1`);
  }
  for (const resource of resourceEnum) {
    assert.ok(budgetResourceEnum.includes(resource),
      `X-002 adapter resource '${resource}' is not a budget-vector resource`);
    const row = budgetTable.get(resource);
    assert.equal(row.unit, RESOURCE_UNITS[resource],
      `X-003 unit for '${resource}' disagrees with budget-semantics 4.1`);
    assert.equal(row.aggregation, "sum",
      `X-004 adapter resource '${resource}' must be sum-aggregated in the budget contract`);
  }
  assert.ok(budgetResourceEnum.includes("money-nano-minor"),
    "X-005 the budget contract must still define money-nano-minor");
  assert.ok(!resourceEnum.includes("money-nano-minor"),
    "X-005 an adapter may never report money; money comes from the pricing snapshot");
  for (const [resource, row] of budgetTable) {
    if (row.aggregation === "maximum") {
      assert.ok(!resourceEnum.includes(resource),
        `X-004 maximum-aggregated resource '${resource}' is not adapter-reportable`);
    }
  }
  assert.equal(Object.keys(RESOURCE_UNITS).length, resourceEnum.length,
    "the oracle unit map and the reportable resource enum must have the same size");
  assert.deepEqual(fixture.budgetComposition.resourceBindings.map((row) => row.resource),
    resourceEnum, "budgetComposition resource bindings drifted");
  for (const row of fixture.budgetComposition.resourceBindings) {
    assert.equal(row.unit, RESOURCE_UNITS[row.resource],
      `budgetComposition unit for '${row.resource}' drifted`);
    assert.equal(row.aggregation, "sum",
      `budgetComposition aggregation for '${row.resource}' drifted`);
  }
  assert.deepEqual(fixture.budgetComposition.forbiddenResources,
    budgetResourceEnum.filter((resource) => !resourceEnum.includes(resource)),
    "budgetComposition forbiddenResources must be the exact complement");
  assert.equal(fixture.budgetComposition.forbiddenResources.length, 16,
    "sixteen budget resources are deliberately not adapter-reportable");

  // --- X-007: cost states are a subset of budget-semantics 7.5 ------------
  const costStateSection = budgetSemantics.slice(budgetSemantics.indexOf("### 7.5 Public cost states"));
  const publicCostStates = Array.from(
    costStateSection.slice(0, costStateSection.indexOf("These labels")).matchAll(/^- (.+)$/gm),
    (match) => match[1].replace(/\s+and$/, "").replace(/[;.]$/, "").trim(),
  );
  assert.equal(publicCostStates.length, 7,
    "budget-semantics 7.5 must still publish exactly seven public cost states");
  const costStateEnum = usageSchema.properties.budgetCostState.enum;
  for (const state of costStateEnum) {
    assert.ok(publicCostStates.includes(state),
      `X-007 adapter cost state '${state}' is not a budget-semantics 7.5 public cost state`);
  }
  for (const binding of fixture.budgetComposition.costStateBindings) {
    assert.equal(binding.budgetCostState, deriveBudgetCostState(binding.trust),
      `X-007 cost-state binding for trust '${binding.trust}' drifted`);
  }
  assert.deepEqual(fixture.budgetComposition.costStateBindings.map((row) => row.trust),
    usageSchema.properties.trust.enum, "cost-state bindings must cover every trust value");

  // --- taxonomy: oracle, corpus and semantics document must all agree -----
  assert.deepEqual(fixture.errorTaxonomy.map((row) => row.code), codeEnum,
    "errorTaxonomy must list every code once, in enum order");
  const taxonomyRows = markdownTableRows(semantics, /#### Closed adapter failure taxonomy\n\n/);
  assert.equal(taxonomyRows.length, codeEnum.length + 1,
    "the semantics taxonomy table must have exactly one row per code");
  const documented = new Map(taxonomyRows.slice(1).map((row) => [stripTicks(row[0]), {
    boundary: stripTicks(row[1]),
    retryable: stripTicks(row[2]) === "yes",
    effectDisposition: stripTicks(row[3]),
    usageDisposition: stripTicks(row[4]),
    ledgerAction: stripTicks(row[5]),
    summary: row[6],
  }]));
  let retryableCount = 0;
  for (const row of fixture.errorTaxonomy) {
    const facts = TAXONOMY_FACTS[row.code];
    assert.ok(facts !== undefined, `taxonomy row '${row.code}' is not a known code`);
    const expected = {
      boundary: facts.boundary,
      retryable: facts.retryable,
      effectDisposition: facts.effectDisposition,
      usageDisposition: deriveUsageDisposition(facts.effectDisposition),
      ledgerAction: deriveLedgerAction(deriveUsageDisposition(facts.effectDisposition)),
    };
    assert.deepEqual({
      boundary: row.boundary,
      retryable: row.retryable,
      effectDisposition: row.effectDisposition,
      usageDisposition: row.usageDisposition,
      ledgerAction: row.ledgerAction,
    }, expected, `corpus taxonomy row '${row.code}' disagrees with the recomputed derivation`);
    const doc = documented.get(row.code);
    assert.ok(doc !== undefined, `code '${row.code}' has no row in adapter-semantics.md`);
    assert.deepEqual({ ...doc, summary: undefined }, { ...expected, summary: undefined },
      `adapter-semantics.md row '${row.code}' disagrees with the recomputed derivation`);
    assert.equal(doc.summary, row.summary,
      `adapter-semantics.md meaning for '${row.code}' disagrees with the corpus`);
    assert.ok(row.summary.length > 0, `taxonomy row '${row.code}' has no meaning`);
    if (facts.boundary === "pre-dispatch") {
      assert.equal(facts.retryable, false,
        `pre-dispatch code '${row.code}' must never be retryable`);
      assert.equal(facts.effectDisposition, "not-applied",
        `pre-dispatch code '${row.code}' must provably perform no external effect`);
    }
    if (facts.retryable) retryableCount += 1;
  }
  assert.equal(retryableCount, 4, "exactly four codes are retryable");
  assert.equal(
    codeEnum.filter((code) => TAXONOMY_FACTS[code].boundary === "pre-dispatch").length, 5,
    "exactly five codes are pre-dispatch refusals");
  assert.equal(Object.keys(TAXONOMY_FACTS).length, codeEnum.length,
    "the oracle taxonomy and the schema enum must cover the same codes");

  // --- X-006: in-doubt composition with cycle-semantics --------------------
  const dispositionEnum = errorSchema.$defs.effectDisposition.enum;
  const expectedMatrix = [];
  for (const disposition of dispositionEnum) {
    for (const sideEffectClass of cycleSideEffects) {
      expectedMatrix.push({
        effectDisposition: disposition,
        recordsInDoubtIdentity: requiresInDoubtRecord(disposition, sideEffectClass),
        retryPermittedBySideEffect: sideEffectPermitsRetry(disposition, sideEffectClass),
        sideEffectClass,
      });
    }
  }
  assert.equal(expectedMatrix.length, 9, "the composition matrix is three by three");
  assert.deepEqual(fixture.cycleComposition.matrix, expectedMatrix,
    "X-006 the in-doubt composition matrix drifted from the recomputed cycle rule");
  assert.equal(
    expectedMatrix.filter((row) => row.recordsInDoubtIdentity).length, 2,
    "X-006 exactly the in-doubt x external rows record an in-doubt identity");

  // --- descriptors ---------------------------------------------------------
  const descriptors = new Map();
  for (const descriptor of fixture.descriptors) {
    assert.equal(validateDescriptorShape(descriptor), true,
      `descriptor '${descriptor.adapterId}' is schema-invalid: ${JSON.stringify(validateDescriptorShape.errors)}`);
    assert.ok(!descriptors.has(descriptor.adapterId),
      `duplicate adapterId '${descriptor.adapterId}'`);
    descriptors.set(descriptor.adapterId, descriptor);
    assert.equal(descriptor.evidenceClass, "deterministic-mock",
      `X-008 descriptor '${descriptor.adapterId}' is not deterministic-mock evidence`);
    validateDescriptor(descriptor);
    validateDescriptorAgainstBudgetPolicy(descriptor, fixture.budgetPolicyAllowedProviderMetrics);
  }
  const coveredKinds = new Set(fixture.descriptors.map((item) => item.adapterKind));
  for (const kind of kindEnum) {
    assert.ok(coveredKinds.has(kind), `adapter kind '${kind}' has no descriptor in the corpus`);
  }
  const declaredAnywhere = new Set(fixture.descriptors.flatMap((item) => item.capabilities));
  for (const capability of capabilityEnum) {
    assert.ok(declaredAnywhere.has(capability),
      `capability '${capability}' is declared by no descriptor`);
  }

  // --- X-009: no routable host anywhere in the corpus ---------------------
  const corpusText = JSON.stringify(fixture);
  for (const match of corpusText.matchAll(/"host":"([^"]+)"/g)) {
    assert.ok(isNonRoutableHost(match[1]),
      `X-009 corpus names routable host '${match[1]}'`);
  }
  for (const descriptor of fixture.descriptors) {
    for (const host of descriptor.network?.allowedHosts ?? []) {
      assert.ok(isNonRoutableHost(host), `X-009 descriptor allows routable host '${host}'`);
    }
  }
  assert.equal(/https?:\/\//.test(corpusText), false,
    "X-009 the corpus contains an absolute URL");
  // --- X-010: no credential-like material ---------------------------------
  for (const pattern of [/sk-[A-Za-z0-9]{8}/, /Bearer\s+[A-Za-z0-9]/, /api[_-]?key"\s*:\s*"[^"]+/i]) {
    assert.equal(pattern.test(corpusText), false,
      `X-010 the corpus appears to contain credential material matching ${pattern}`);
  }

  // --- rule register: oracle, corpus and document must name the same rules --
  const ruleRows = markdownTableRows(semantics, /#### Rule register\n\n/);
  const documentedRules = new Map(ruleRows.slice(1).map((row) => [stripTicks(row[0]), {
    kind: stripTicks(row[1]),
    code: stripTicks(row[2]) === "none" ? null : stripTicks(row[2]),
    denialReason: stripTicks(row[3]) === "none" ? null : stripTicks(row[3]),
    obligation: row[4],
  }]));
  assert.deepEqual(fixture.ruleRegister.map((row) => row.rule), [...documentedRules.keys()],
    "the corpus rule register and adapter-semantics.md rule register must agree, in order");
  for (const row of fixture.ruleRegister) {
    const doc = documentedRules.get(row.rule);
    assert.equal(doc.kind, row.kind,
      `rule '${row.rule}' has a different kind in adapter-semantics.md`);
    assert.equal(doc.code, row.code,
      `rule '${row.rule}' maps to a different code in adapter-semantics.md`);
    assert.equal(doc.denialReason, row.denialReason ?? null,
      `rule '${row.rule}' maps to a different denial reason in adapter-semantics.md`);
    assert.equal(doc.obligation, row.obligation,
      `rule '${row.rule}' states a different obligation in adapter-semantics.md`);
    assert.ok(row.obligation.length > 0, `rule '${row.rule}' states no obligation`);
    assert.ok(["decision", "rejection"].includes(row.kind),
      `rule '${row.rule}' has an unknown kind`);
    if (row.kind === "rejection") {
      assert.ok(codeEnum.includes(row.code), `rejection rule '${row.rule}' names an unknown code`);
      assert.ok(/^[DEPSTU]-\d{3}$/.test(row.rule),
        `rejection rule '${row.rule}' is not in a rejection family`);
    } else {
      assert.equal(row.code, null, `decision rule '${row.rule}' must report no portable code`);
      assert.equal(row.denialReason, null,
        `decision rule '${row.rule}' must report no denial reason`);
      assert.ok(/^[CR]-\d{3}$/.test(row.rule),
        `decision rule '${row.rule}' is not in a decision family`);
    }
    if (row.denialReason !== null && row.denialReason !== undefined) {
      assert.equal(row.code, "GE_ADAPTER_POLICY_DENIED",
        `rule '${row.rule}' names a denial reason without the denial code`);
      assert.ok(denialEnum.includes(row.denialReason),
        `rule '${row.rule}' names an unknown denial reason`);
    }
  }
  assert.ok(isSortedByCodePoint(fixture.ruleRegister.map((row) => row.rule)),
    "the rule register must be in Unicode code-point order");

  const exercised = new Set();
  const observedCodes = new Set();
  function recordOutcome(caseId, expectedCode, expectedRule, run) {
    let code = null;
    let rule = null;
    let message = null;
    try {
      run();
    } catch (error) {
      if (!(error instanceof AdapterError)) throw error;
      code = error.code;
      rule = error.rule;
      message = error.message;
    }
    assert.equal(code, expectedCode, `${caseId} code drifted (rule ${rule ?? "none"})`);
    assert.equal(rule, expectedRule, `${caseId} rule drifted`);
    if (rule !== null) {
      exercised.add(rule);
      observedCodes.add(code);
    }
    return message;
  }

  // --- descriptor cases ----------------------------------------------------
  for (const testCase of fixture.descriptorCases) {
    const base = descriptors.get(testCase.base);
    assert.ok(base !== undefined, `${testCase.id} names an unknown base descriptor`);
    const candidate = applyMutations(clone(base), testCase.mutations);
    recordOutcome(testCase.id, testCase.expectedCode, testCase.expectedRule, () => {
      validateDescriptor(candidate);
      validateDescriptorAgainstBudgetPolicy(candidate, fixture.budgetPolicyAllowedProviderMetrics);
    });
  }

  // --- preflight cases -----------------------------------------------------
  for (const testCase of fixture.preflightCases) {
    const base = descriptors.get(testCase.descriptor);
    assert.ok(base !== undefined, `${testCase.id} names an unknown descriptor`);
    const descriptor = applyMutations(clone(base), testCase.descriptorMutations ?? []);
    const request = applyMutations(clone(fixture.requestTemplate), testCase.requestMutations ?? []);
    const message = recordOutcome(testCase.id, testCase.expectedCode, testCase.expectedRule, () => {
      const outcome = preflight(descriptor, request, fixture.budgetPolicyAllowedProviderMetrics);
      assert.equal(outcome.admitted, true, `${testCase.id} was expected to be admitted`);
      assert.equal(outcome.requestId, request.requestId, `${testCase.id} request identity drifted`);
    });
    if (testCase.expectedMessage !== undefined) {
      assert.equal(message, testCase.expectedMessage, `${testCase.id} message drifted`);
    }
  }

  // --- stream cases --------------------------------------------------------
  for (const testCase of fixture.streamCases) {
    const descriptor = applyMutations(
      clone(descriptors.get(testCase.descriptor)), testCase.descriptorMutations ?? []);
    const frames = applyMutations(clone(fixture.streamTemplate), testCase.mutations ?? []);
    recordOutcome(testCase.id, testCase.expectedCode, testCase.expectedRule, () => {
      const normalized = normalizeStream(descriptor, frames);
      assert.deepEqual(normalized, testCase.expectedNormalized,
        `${testCase.id} normalized stream drifted`);
    });
  }

  // --- usage cases ---------------------------------------------------------
  for (const testCase of fixture.usageCases) {
    const descriptor = applyMutations(
      clone(descriptors.get(testCase.descriptor)), testCase.descriptorMutations ?? []);
    const usage = applyMutations(clone(fixture.usageTemplate), testCase.mutations ?? []);
    if (testCase.schemaValid !== false) {
      assert.equal(validateUsageShape(usage), true,
        `${testCase.id} usage is schema-invalid: ${JSON.stringify(validateUsageShape.errors)}`);
    } else {
      assert.equal(validateUsageShape(usage), false,
        `${testCase.id} declares schemaValid false but the document validates`);
    }
    recordOutcome(testCase.id, testCase.expectedCode, testCase.expectedRule, () => {
      const summary = validateUsage(descriptor, usage);
      if (testCase.expectedSummary !== undefined) {
        assert.deepEqual(summary, testCase.expectedSummary, `${testCase.id} usage summary drifted`);
      }
    });
  }

  // --- tool cases ----------------------------------------------------------
  for (const testCase of fixture.toolCases) {
    const descriptor = applyMutations(
      clone(descriptors.get(testCase.descriptor)), testCase.descriptorMutations ?? []);
    const request = applyMutations(clone(fixture.requestTemplate), testCase.requestMutations ?? []);
    const response = applyMutations(clone(fixture.toolResponseTemplate), testCase.mutations ?? []);
    recordOutcome(testCase.id, testCase.expectedCode, testCase.expectedRule, () => {
      const summary = validateToolCalls(descriptor, request, response);
      assert.equal(summary.toolCalls, response.toolCalls.length,
        `${testCase.id} tool call count drifted`);
    });
  }

  // --- error envelope cases ------------------------------------------------
  for (const testCase of fixture.errorCases) {
    const descriptor = applyMutations(
      clone(descriptors.get(testCase.descriptor)), testCase.descriptorMutations ?? []);
    const envelope = applyMutations(clone(fixture.errorTemplate), testCase.mutations ?? []);
    if (testCase.schemaValid !== false) {
      assert.equal(validateErrorShape(envelope), true,
        `${testCase.id} error is schema-invalid: ${JSON.stringify(validateErrorShape.errors)}`);
    }
    recordOutcome(testCase.id, testCase.expectedCode, testCase.expectedRule, () => {
      const summary = validateErrorEnvelope(descriptor, envelope, fixture.forbiddenMarkers);
      if (testCase.expectedSummary !== undefined) {
        assert.deepEqual(summary, testCase.expectedSummary, `${testCase.id} summary drifted`);
      }
    });
    if (testCase.expectedCode === null) observedCodes.add(envelope.code);
  }

  // --- retry cases (recomputed, never read) --------------------------------
  for (const testCase of fixture.retryCases) {
    const descriptor = applyMutations(
      clone(descriptors.get(testCase.descriptor)), testCase.descriptorMutations ?? []);
    const decision = retryDecision(descriptor, testCase.code, testCase.sideEffectClass,
      testCase.attempt, testCase.retryAfterMs);
    assert.deepEqual({
      mayRetry: decision.mayRetry,
      backoffMs: decision.backoffMs,
      rule: decision.rule,
    }, testCase.expected, `${testCase.id} retry decision drifted`);
    exercised.add(decision.rule);
  }

  // --- circuit cases -------------------------------------------------------
  for (const testCase of fixture.circuitCases) {
    const descriptor = descriptors.get(testCase.descriptor);
    const observed = circuitFold(descriptor, testCase.script);
    assert.deepEqual({
      state: observed.state,
      consecutiveFailures: observed.consecutiveFailures,
      openedAtMs: observed.openedAtMs,
      admitted: observed.admitted,
      refused: observed.refused,
    }, testCase.expected, `${testCase.id} circuit projection drifted`);
    for (const rule of testCase.rules) exercised.add(rule);
  }

  // --- schema negatives ----------------------------------------------------
  const templateFor = {
    "adapter-descriptor.schema.json": () => clone(descriptors.get(fixture.schemaNegativeBase)),
    "adapter-usage.schema.json": () => clone(fixture.usageTemplate),
    "adapter-error.schema.json": () => clone(fixture.errorTemplate),
  };
  for (const testCase of fixture.schemaNegativeCases) {
    const build = templateFor[testCase.schema];
    assert.ok(build !== undefined, `${testCase.id} names an unknown schema`);
    const validate = compiled.get(testCase.schema);
    const document = applyMutations(build(), testCase.mutations);
    assert.equal(validate(document), false, `${testCase.id} was accepted by ${testCase.schema}`);
  }

  // --- integration non-claims ---------------------------------------------
  assert.equal(fixture.integrationNotes.length, 3,
    "three agent-harness integrations are documented");
  for (const note of fixture.integrationNotes) {
    assert.equal(note.officialV1Adapter, false,
      `integration '${note.integration}' must not claim official v1 adapter status`);
    assert.equal(note.privateApiClaim, false,
      `integration '${note.integration}' must not claim a private API`);
    assert.ok(["mcp", "shell"].includes(note.mechanism),
      `integration '${note.integration}' must run through a documented public surface`);
    assert.ok(!kindEnum.includes(note.integration),
      `integration '${note.integration}' must not appear in the official adapter kind enum`);
  }

  // --- coverage: every enum member and every rule, as a hard failure -------
  const capabilityMentions = new Set();
  for (const section of ["preflightCases", "usageCases", "streamCases", "descriptorCases",
    "toolCases", "errorCases"]) {
    for (const testCase of fixture[section]) {
      for (const capability of testCase.capabilitiesExercised ?? []) {
        assert.ok(capabilityEnum.includes(capability),
          `${testCase.id} names unknown capability '${capability}'`);
        capabilityMentions.add(capability);
      }
    }
  }
  for (const capability of capabilityEnum) {
    assert.ok(capabilityMentions.has(capability),
      `capability '${capability}' is exercised by no corpus case`);
  }

  for (const code of codeEnum) {
    assert.ok(observedCodes.has(code),
      `error code '${code}' is produced by no corpus case`);
  }

  const denialsObserved = new Set(
    fixture.preflightCases.filter((item) => item.expectedDenialReason !== undefined)
      .map((item) => item.expectedDenialReason),
  );
  for (const reason of denialEnum) {
    assert.ok(denialsObserved.has(reason), `denial reason '${reason}' is exercised by no case`);
  }
  const denialRules = new Map(fixture.ruleRegister.map((row) => [row.rule, row.denialReason ?? null]));
  for (const testCase of fixture.preflightCases) {
    if (testCase.expectedDenialReason === undefined) continue;
    assert.equal(testCase.expectedCode, "GE_ADAPTER_POLICY_DENIED",
      `${testCase.id} declares a denial reason without the denial code`);
    assert.equal(denialRules.get(testCase.expectedRule), testCase.expectedDenialReason,
      `${testCase.id} denial reason disagrees with the rule register`);
  }

  const finishObserved = new Set(
    fixture.streamCases.map((item) => item.expectedNormalized?.finishReason)
      .filter((value) => value !== undefined && value !== null),
  );
  for (const testCase of fixture.streamCases) {
    if (testCase.finishReasonExercised !== undefined) finishObserved.add(testCase.finishReasonExercised);
  }
  for (const reason of finishEnum) {
    assert.ok(finishObserved.has(reason), `finish reason '${reason}' is exercised by no case`);
  }

  const resourcesObserved = new Set();
  for (const testCase of fixture.usageCases) {
    for (const resource of testCase.resourcesExercised ?? []) resourcesObserved.add(resource);
  }
  for (const resource of resourceEnum) {
    assert.ok(resourcesObserved.has(resource),
      `reportable resource '${resource}' is exercised by no usage case`);
  }

  const registered = new Set(fixture.ruleRegister.map((row) => row.rule));
  const missingRules = [...registered].filter((rule) => !exercised.has(rule)).sort();
  assert.deepEqual(missingRules, [],
    `these registered rules are exercised by no corpus vector: ${missingRules.join(", ")}`);
  const strayRules = [...exercised].filter((rule) => !registered.has(rule)).sort();
  assert.deepEqual(strayRules, [],
    `the oracle produced unregistered rules: ${strayRules.join(", ")}`);

  // --- globally unique case identifiers ------------------------------------
  const caseIds = ["descriptorCases", "preflightCases", "streamCases", "usageCases", "toolCases",
    "errorCases", "retryCases", "circuitCases", "schemaNegativeCases"]
    .flatMap((section) => fixture[section].map((item) => item.id));
  assert.equal(new Set(caseIds).size, caseIds.length,
    "adapter corpus case identifiers are not globally unique");
  for (const id of caseIds) {
    assert.ok(/^[a-z][a-z0-9-]{2,63}$/.test(id), `case identifier '${id}' is not canonical`);
  }

  // --- declared counts must equal observed counts -------------------------
  const observedCounts = {
    circuitCases: fixture.circuitCases.length,
    descriptorCases: fixture.descriptorCases.length,
    descriptors: fixture.descriptors.length,
    errorCases: fixture.errorCases.length,
    preflightCases: fixture.preflightCases.length,
    retryCases: fixture.retryCases.length,
    rules: fixture.ruleRegister.length,
    schemaNegativeCases: fixture.schemaNegativeCases.length,
    streamCases: fixture.streamCases.length,
    toolCases: fixture.toolCases.length,
    usageCases: fixture.usageCases.length,
  };
  assert.deepEqual(fixture.declaredCounts, observedCounts,
    "the corpus declaredCounts block disagrees with the sections actually shipped");
  for (const [section, count] of Object.entries(observedCounts)) {
    assert.ok(count > 0, `section '${section}' is empty; deleting a corpus section must fail`);
  }

  return Object.freeze({
    contractStatus: fixture.contractStatus,
    implementationClaim: fixture.implementationClaim,
    schemas: SCHEMA_NAMES.length,
    ...observedCounts,
    capabilities: capabilityEnum.length,
    codes: codeEnum.length,
    adapterKinds: kindEnum.length,
    denialReasons: denialEnum.length,
    rulesExercised: exercised.size,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await validateAdapterFixture();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
