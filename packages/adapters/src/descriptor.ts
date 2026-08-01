/**
 * Descriptor obligations, rules `D-001` through `D-033`.
 *
 * Shape validity never implies semantic validity: a descriptor that validates
 * against `adapter-descriptor.schema.json` and violates adapter-semantics 5 is
 * `GE_ADAPTER_DESCRIPTOR_INVALID`, and no request may be dispatched through it.
 */

import {
  CAPABILITY_IMPLICATIONS,
  MOCK_ONLY_CAPABILITIES,
  MODEL_ADAPTER_KINDS,
  isNonRoutableHost,
} from "./contract.js";
import { fail } from "./errors.js";
import { isSortedByCodePoint } from "./ordering.js";
import type { AdapterDescriptor, ProviderMetricDeclaration } from "./types.js";

const INVALID = "GE_ADAPTER_DESCRIPTOR_INVALID" as const;

function metricKey(metric: ProviderMetricDeclaration): string {
  return `${metric.metricId}\u0000${metric.unitId}`;
}

/** Throws `AdapterContractError` on the first violated rule. */
export function validateDescriptor(descriptor: AdapterDescriptor): true {
  const capabilities = descriptor.capabilities;
  const declared = new Set<string>(capabilities);

  if (!isSortedByCodePoint(capabilities)) {
    fail(INVALID, "D-001",
      `adapter '${descriptor.adapterId}' capabilities are not in Unicode code-point order`);
  }

  if (descriptor.evidenceClass === "deterministic-mock" && descriptor.network !== null) {
    for (const host of descriptor.network.allowedHosts) {
      if (!isNonRoutableHost(host)) {
        fail(INVALID, "D-002",
          `deterministic-mock adapter '${descriptor.adapterId}' allows routable host '${host}'`);
      }
    }
  }

  const kind = descriptor.adapterKind;
  if (
    kind === "mock" &&
    (descriptor.network !== null || descriptor.process !== null || descriptor.mcp !== null)
  ) {
    fail(INVALID, "D-003", "a mock adapter declares no network, process or MCP profile");
  }
  if (
    kind === "http" &&
    (descriptor.network === null || descriptor.process !== null || descriptor.mcp !== null)
  ) {
    fail(INVALID, "D-004",
      "an http adapter declares exactly one network profile and no process or MCP profile");
  }
  if (
    kind === "shell" &&
    (descriptor.process === null || descriptor.network !== null || descriptor.mcp !== null)
  ) {
    fail(INVALID, "D-005",
      "a shell adapter declares exactly one process profile and no network or MCP profile");
  }
  if (
    kind === "mcp" &&
    (descriptor.mcp === null || descriptor.network !== null || descriptor.process !== null)
  ) {
    fail(INVALID, "D-006",
      "an mcp adapter declares exactly one MCP profile and no network or process profile");
  }
  if (
    MODEL_ADAPTER_KINDS.includes(kind) &&
    (descriptor.network === null || descriptor.process !== null || descriptor.mcp !== null)
  ) {
    fail(INVALID, "D-007", `model adapter kind '${kind}' declares exactly one network profile`);
  }

  if (descriptor.sideEffectClass === "idempotent" && !declared.has("idempotency-key")) {
    fail(INVALID, "D-008", "an idempotent adapter must be able to pass a stable idempotency key");
  }

  for (const implication of CAPABILITY_IMPLICATIONS) {
    if (declared.has(implication.capability) && !declared.has(implication.requires)) {
      fail(INVALID, implication.rule,
        `capability '${implication.capability}' requires '${implication.requires}'`);
    }
  }

  for (const entry of MOCK_ONLY_CAPABILITIES) {
    if (declared.has(entry.capability) && descriptor.evidenceClass !== "deterministic-mock") {
      fail(INVALID, entry.rule,
        `capability '${entry.capability}' is available only to a deterministic-mock adapter`);
    }
  }

  if (descriptor.retryPolicy.maxBackoffMs < descriptor.retryPolicy.initialBackoffMs) {
    fail(INVALID, "D-015", "maxBackoffMs must not be below initialBackoffMs");
  }

  if (descriptor.capture.enabled !== (descriptor.capture.retention !== "none")) {
    fail(INVALID, "D-016", "capture.enabled and a non-none retention disposition must agree");
  }

  if (descriptor.network !== null) {
    const network = descriptor.network;
    if (network.rebindingDefense !== true) {
      fail(INVALID, "D-017", "a network adapter must declare DNS and IP rebinding defense");
    }
    if (network.credentialIsolation !== true) {
      fail(INVALID, "D-018", "a network adapter must isolate headers and credentials per host");
    }
    if (network.allowRedirects === true && network.redirectReauthorization !== true) {
      fail(INVALID, "D-019", "redirects are permitted only with redirect re-authorization");
    }
    if (network.allowedSchemes.includes("http")) {
      for (const host of network.allowedHosts) {
        if (!isNonRoutableHost(host)) {
          fail(INVALID, "D-020",
            `plaintext http is permitted only for non-routable hosts, not '${host}'`);
        }
      }
    }
    if (
      !isSortedByCodePoint(network.allowedSchemes) ||
      !isSortedByCodePoint(network.allowedHosts)
    ) {
      fail(INVALID, "D-021", "network schemes and hosts must be in Unicode code-point order");
    }
    for (let index = 1; index < network.allowedPorts.length; index += 1) {
      const previous = network.allowedPorts[index - 1] as number;
      const current = network.allowedPorts[index] as number;
      if (previous >= current) {
        fail(INVALID, "D-021", "network ports must be strictly ascending");
      }
    }
  }

  if (descriptor.process !== null) {
    const profile = descriptor.process;
    if (profile.argumentVector[0] !== profile.executablePath) {
      fail(INVALID, "D-022", "argumentVector[0] must be the explicit executable identity");
    }
    if (!isSortedByCodePoint(profile.environmentAllowlist)) {
      fail(INVALID, "D-023", "environmentAllowlist must be in Unicode code-point order");
    }
  }

  if (descriptor.mcp !== null) {
    const mcp = descriptor.mcp;
    if (mcp.mode === "mutating") {
      if (mcp.approvalRequired !== true) {
        fail(INVALID, "D-024", "a mutating MCP adapter must require approval");
      }
      if (mcp.idempotencyRequired !== true) {
        fail(INVALID, "D-025", "a mutating MCP adapter must require an idempotency gate");
      }
      if (mcp.allowedTools.length === 0) {
        fail(INVALID, "D-026",
          "a mutating MCP adapter must name the exact tools it may mutate through");
      }
    }
    if (mcp.mode === "read-only" && descriptor.sideEffectClass === "non-idempotent") {
      fail(INVALID, "D-027", "a read-only MCP adapter cannot declare non-idempotent side effects");
    }
  }

  if (!isSortedByCodePoint(descriptor.allowedProviderMetrics.map(metricKey))) {
    fail(INVALID, "D-028",
      "allowedProviderMetrics must be unique and ordered by metricId + U+0000 + unitId");
  }

  if (declared.has("streaming") && descriptor.bounds.maxStreamFrames < 2) {
    fail(INVALID, "D-030", "a streaming adapter must admit at least a start and a finish frame");
  }
  if (
    !declared.has("tool-calling") &&
    (descriptor.bounds.maxToolDefinitions !== 0 ||
      descriptor.bounds.maxToolCallsPerResponse !== 0)
  ) {
    fail(INVALID, "D-031",
      "an adapter without tool-calling must bound tool definitions and tool calls at zero");
  }
  if (!declared.has("attachments") && descriptor.bounds.maxAttachments !== 0) {
    fail(INVALID, "D-032", "an adapter without attachments must bound attachments at zero");
  }
  if (descriptor.bounds.maxStreamFrameBytes > descriptor.bounds.maxResponseBytes) {
    fail(INVALID, "D-033", "a single stream frame cannot exceed the whole response bound");
  }
  return true;
}

/**
 * `D-029`. The active budget policy allowlist is caller state rather than
 * descriptor state, so it is a separate entry point. An adapter narrows the
 * policy and can never widen it.
 */
export function validateDescriptorAgainstBudgetPolicy(
  descriptor: AdapterDescriptor,
  policyMetrics: readonly ProviderMetricDeclaration[],
): true {
  const allowed = new Set(
    policyMetrics.map((metric) => `${metricKey(metric)}\u0000${metric.aggregation}`),
  );
  for (const metric of descriptor.allowedProviderMetrics) {
    if (!allowed.has(`${metricKey(metric)}\u0000${metric.aggregation}`)) {
      fail(INVALID, "D-029",
        `provider metric '${metric.metricId}' is not in the active budget policy allowlist`);
    }
  }
  return true;
}
