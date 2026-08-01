/**
 * Dispatch preflight, rules `P-001` through `P-029`.
 *
 * Preflight refuses, before any external effect, every request the descriptor
 * does not authorize. adapter-semantics 4.1: capability refusal is a preflight
 * fact, so a refused call performs zero provider requests, zero usage and zero
 * ledger writes, and a caller cannot reach an undeclared capability by any
 * request shape.
 */

import { escalatesSideEffect } from "./contract.js";
import {
  validateDescriptor,
  validateDescriptorAgainstBudgetPolicy,
} from "./descriptor.js";
import { fail } from "./errors.js";
import { compareUnicodeCodePoints } from "./ordering.js";
import type {
  AdapterCapability,
  AdapterDescriptor,
  AdapterRequest,
  PreflightOutcome,
  ProviderMetricDeclaration,
} from "./types.js";

/** U+0000. Written by construction so no source file carries a raw NUL byte. */
const NUL = String.fromCharCode(0);

/**
 * The exact message adapter-semantics 4.1 pins. Missing capabilities are
 * reported in Unicode code-point order and the first is named.
 */
export function capabilityFailureMessage(
  capability: string,
  requestId: string,
  adapterId: string,
): string {
  return `Adapter capability '${capability}' required by request '${requestId}' is not declared by adapter '${adapterId}'`;
}

interface ImpliedCapability {
  readonly rule: string;
  readonly active: boolean;
  readonly capability: AdapterCapability;
}

/**
 * Requiring a capability is both explicit (`requiredCapabilities`) and implied
 * by the request shape. `P-001` through `P-006` and `P-029` are distinct so
 * that deleting any one of them is observable.
 */
export function preflight(
  descriptor: AdapterDescriptor,
  request: AdapterRequest,
  policyMetrics: readonly ProviderMetricDeclaration[],
): PreflightOutcome {
  // An invalid descriptor is refused before any request rule runs, so a broken
  // adapter can never reach a provider by supplying a benign request.
  validateDescriptor(descriptor);
  validateDescriptorAgainstBudgetPolicy(descriptor, policyMetrics);

  const declared = new Set<string>(descriptor.capabilities);
  const missing = request.requiredCapabilities
    .filter((capability) => !declared.has(capability))
    .sort(compareUnicodeCodePoints);
  const first = missing[0];
  if (first !== undefined) {
    fail("GE_ADAPTER_CAPABILITY_UNSUPPORTED", "P-001",
      capabilityFailureMessage(first, request.requestId, descriptor.adapterId));
  }

  const implied: readonly ImpliedCapability[] = [
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

  if (escalatesSideEffect(request.sideEffectClass, descriptor.sideEffectClass)) {
    fail("GE_ADAPTER_POLICY_DENIED", "P-007",
      "a request cannot escalate beyond the side-effect class the adapter is authorized for",
      "capability-approval");
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
    if (
      attachment.bytes > descriptor.bounds.maxAttachmentBytes ||
      attachmentBytes > descriptor.bounds.maxAttachmentBytes
    ) {
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
    fail("GE_ADAPTER_POLICY_DENIED", "P-013", "the adapter circuit is open", "circuit-open");
  }

  if (request.target !== null) {
    const network = descriptor.network;
    const target = request.target;
    if (network === null || !network.allowedSchemes.includes(target.scheme as "http" | "https")) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-014", `scheme '${target.scheme}' is not allowlisted`,
        "egress-not-allowlisted");
    }
    if (!network.allowedHosts.includes(target.host)) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-015", `host '${target.host}' is not allowlisted`,
        "egress-not-allowlisted");
    }
    if (!network.allowedPorts.includes(target.port)) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-016", `port ${target.port} is not allowlisted`,
        "egress-not-allowlisted");
    }
    if (target.redirected === true && network.allowRedirects !== true) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-018", "this adapter does not follow redirects",
        "egress-not-allowlisted");
    }
    if (target.redirected === true && target.reauthorized !== true) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-017",
        "a redirect target must be re-authorized against the allowlist",
        "redirect-not-reauthorized");
    }
    if (target.redirected === true && target.scheme === "http") {
      // `D-020` already refuses a descriptor that allowlists plaintext to a
      // routable host. What remains reachable at dispatch time is a redirect
      // that downgrades an https request onto an allowlisted plaintext origin.
      fail("GE_ADAPTER_POLICY_DENIED", "P-019",
        "a redirect may not downgrade the transport to plaintext", "tls-policy");
    }
  }

  if (request.mcpCall !== null) {
    const mcp = descriptor.mcp;
    const call = request.mcpCall;
    if (mcp === null || !mcp.allowedTools.includes(call.tool)) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-020", `MCP tool '${call.tool}' is not allowlisted`,
        "mcp-tool-not-allowlisted");
    }
    if (call.mutating === true && mcp.mode !== "mutating") {
      fail("GE_ADAPTER_POLICY_DENIED", "P-021", "a read-only MCP adapter refuses a mutating call",
        "mcp-mutation-not-approved");
    }
    if (call.mutating === true && call.approvalToken === null) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-022", "a mutating MCP call requires an approval token",
        "mcp-mutation-not-approved");
    }
  }

  if (request.processCall !== null) {
    const profile = descriptor.process;
    const call = request.processCall;
    if (profile === null || call.argumentVector[0] !== profile.executablePath) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-023",
        "the call does not name the adapter's explicit executable identity",
        "executable-not-authorized");
    }
    for (let index = 0; index < profile.argumentVector.length; index += 1) {
      if (call.argumentVector[index] !== profile.argumentVector[index]) {
        fail("GE_ADAPTER_POLICY_DENIED", "P-024",
          "the declared argument vector must be an exact prefix of the call",
          "executable-not-authorized");
      }
    }
    for (const name of call.environment) {
      if (!profile.environmentAllowlist.includes(name)) {
        fail("GE_ADAPTER_POLICY_DENIED", "P-025",
          `environment variable '${name}' is not allowlisted`, "environment-not-allowlisted");
      }
    }
    if (profile.stdinPolicy === "closed" && call.stdinBytes > 0) {
      fail("GE_ADAPTER_POLICY_DENIED", "P-026", "this adapter runs with stdin closed",
        "stdin-policy");
    }
    for (const argument of call.argumentVector) {
      if (argument.includes(NUL)) {
        fail("GE_ADAPTER_POLICY_DENIED", "P-027", "an argument contains a NUL byte",
          "executable-not-authorized");
      }
    }
  }

  if (request.sideEffectClass === "idempotent" && request.idempotencyKey === null) {
    fail("GE_ADAPTER_POLICY_DENIED", "P-028",
      "an idempotent request must carry a stable idempotency key", "idempotency-key-missing");
  }

  return Object.freeze({
    admitted: true,
    adapterId: descriptor.adapterId,
    requestId: request.requestId,
    sideEffectClass: request.sideEffectClass,
    idempotencyKey: request.idempotencyKey,
  });
}
