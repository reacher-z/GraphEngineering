import {
  claimsIntegratedBarrierPolicy,
  compareUnicodeCodePoints,
  type GraphSpec,
} from "@graph-engineering/core";

export const RUNTIME_CAPABILITY_CONTRACT = "runtime-capability/v1alpha1" as const;

/**
 * Capability name for a `barrier` node whose config claims
 * `IntegratedBarrierPolicy` by `apiVersion`. `integrated-barrier-semantics.md`
 * requires such a graph to be refused before dispatch: no runtime implements
 * barrier satisfaction, deadlines, quorum, resolutions or durable decisions
 * yet, and the scheduler would otherwise run the node as an ordinary
 * deterministic transform and silently pass an unsatisfied barrier.
 *
 * The gate keys on the ownership claim, not on the shape, so a pre-contract
 * barrier config keeps the published `node-config:barrier` path.
 */
export const INTEGRATED_BARRIER_CAPABILITY = "integrated-barrier-policy" as const;

const TYPED_PORTS_POLICY = "graphengineering.reacher-z.github.io/typed-ports";
const SUPPORTED_NODE_KINDS = new Set([
  "agent",
  "model",
  "tool",
  "transform",
  "router",
  "barrier",
]);
const SUPPORTED_POLICIES = new Set([
  "maxConcurrency",
  "maxDepth",
  "maxFanOut",
  "maxTotalAttempts",
  TYPED_PORTS_POLICY,
]);
const KNOWN_UNSUPPORTED_POLICIES = [
  ["maxDynamicNodes", "dynamic-graph-patch"],
  ["maxDurationMs", "graph-deadline"],
  ["maxCostUsd", "cost-budget"],
] as const;

export interface RuntimeCapabilityIssue {
  readonly ownerNodeId: string;
  readonly capability: string;
  readonly path: string;
}

export interface RuntimeCapabilityOptions {
  /**
   * Set by an entry point that actually implements arming, satisfaction
   * arithmetic, deadlines, resolutions, late arrival, cancellation and the
   * durable decision document. The ordinary scheduler does; the durable
   * scheduler does not journal `BarrierSatisfied` yet, so it keeps refusing.
   */
  readonly integratedBarrier?: boolean;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function supportedBarrierConfig(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const config = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(config);
  return keys.length === 0 ||
    (keys.length === 1 && keys[0] === "condition" && config.condition === "all");
}

function issue(
  ownerNodeId: string,
  capability: string,
  path: string,
): RuntimeCapabilityIssue {
  return Object.freeze({ ownerNodeId, capability, path });
}

/**
 * Describe every compiler-valid capability that the current graph scheduler
 * cannot truthfully execute. The order is part of the private v1alpha1
 * runtime-capability contract and is shared by ordinary and durable entry
 * points before any executor or journal/store operation.
 */
export function graphRuntimeCapabilityIssues(
  graph: GraphSpec,
  options: RuntimeCapabilityOptions = {},
): readonly RuntimeCapabilityIssue[] {
  const graphOwner = graph.entrypoints[0] as string;
  const issues: RuntimeCapabilityIssue[] = [];

  if (graph.stateSchema !== undefined) {
    issues.push(issue(graphOwner, "graph-state", "#/stateSchema"));
  }
  for (const [index, node] of graph.nodes.entries()) {
    const base = `#/nodes/${index}`;
    if (!SUPPORTED_NODE_KINDS.has(node.kind)) {
      issues.push(issue(node.id, `node-kind:${node.kind}`, `${base}/kind`));
    }
    if (node.kind === "barrier") {
      // A claimed integrated barrier policy is refused under its own capability
      // name so the failure states the real reason. Every other unsupported
      // barrier config keeps the published `node-config:barrier` name.
      if (claimsIntegratedBarrierPolicy(node.config)) {
        if (options.integratedBarrier !== true) {
          issues.push(issue(node.id, INTEGRATED_BARRIER_CAPABILITY, `${base}/config`));
        }
      } else if (!supportedBarrierConfig(node.config)) {
        issues.push(issue(node.id, "node-config:barrier", `${base}/config`));
      }
    }
    if (node.cache !== undefined) {
      issues.push(issue(node.id, "node-cache", `${base}/cache`));
    }
    if (node.resources !== undefined) {
      issues.push(issue(node.id, "resource-admission", `${base}/resources`));
    }
    if (node.isolation !== undefined) {
      issues.push(issue(node.id, "isolation-provider", `${base}/isolation`));
    }
    if (node.retry?.jitter === true) {
      issues.push(issue(node.id, "retry-jitter", `${base}/retry/jitter`));
    }
  }

  for (const [index, edge] of graph.edges.entries()) {
    const base = `#/edges/${index}`;
    if (edge.map !== undefined) {
      issues.push(issue(edge.from.node, "edge-map", `${base}/map`));
    }
    const mode = edge.mode ?? "value";
    if (mode !== "value") {
      issues.push(issue(edge.from.node, `edge-mode:${mode}`, `${base}/mode`));
    }
  }

  if (graph.policies !== undefined) {
    for (const [key, capability] of KNOWN_UNSUPPORTED_POLICIES) {
      if (hasOwn(graph.policies, key)) {
        issues.push(issue(graphOwner, capability, `#/policies/${key}`));
      }
    }
    const unknownKeys = Object.keys(graph.policies)
      .filter((key) => !SUPPORTED_POLICIES.has(key) &&
        !KNOWN_UNSUPPORTED_POLICIES.some(([known]) => known === key))
      .sort(compareUnicodeCodePoints);
    for (const key of unknownKeys) {
      issues.push(issue(
        graphOwner,
        `policy:${key}`,
        `#/policies/${pointerSegment(key)}`,
      ));
    }
  }

  return Object.freeze(issues);
}

export function runtimeCapabilityMessage(issue: RuntimeCapabilityIssue): string {
  return `Runtime capability '${issue.capability}' at '${issue.path}' `
    + `is not implemented by ${RUNTIME_CAPABILITY_CONTRACT}`;
}
