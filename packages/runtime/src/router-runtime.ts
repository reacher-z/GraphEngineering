import {
  canonicalSerialize,
  compareUnicodeCodePoints,
  type EdgeSpec,
  type GraphSpec,
  type NodeSpec,
} from "@graph-engineering/core";
import {
  evaluateRouteSelection,
  type RouteSelectionPolicy,
  type RouteSelectionRequest,
} from "@graph-engineering/primitives";
import type { JsonValue, NodeExecutor, NodeRunResult } from "./types.js";

const CONDITION_API_VERSION =
  "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1";
const ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESULT_KEYS = [
  "confidenceBasisPoints",
  "escalated",
  "reasonCode",
  "requestedRoutes",
  "routed",
  "selectedRoutes",
  "unknownRoutes",
  "usedDefault",
] as const;

export class InvalidRouteSelectionError extends TypeError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "InvalidRouteSelectionError";
  }
}

export interface GraphConditionCapabilityIssue {
  readonly nodeId: string;
  readonly messages: readonly string[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function routeArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" ||
    !ROUTE_ID.test(item) || item === "." || item === "..") ||
    new Set(value).size !== value.length) {
    throw new InvalidRouteSelectionError(`${name} must be a unique safe route ID array`);
  }
  return value as readonly string[];
}

/** Return a stable pre-dispatch error for conditions this runtime cannot execute. */
export function edgeConditionError(
  edge: EdgeSpec,
  source: NodeSpec,
): string | undefined {
  if (edge.condition === undefined) return undefined;
  const keys = Object.keys(edge.condition).sort(compareUnicodeCodePoints);
  if (
    keys.length !== 3 ||
    keys[0] !== "apiVersion" ||
    keys[1] !== "kind" ||
    keys[2] !== "routeKey" ||
    edge.condition.apiVersion !== CONDITION_API_VERSION ||
    edge.condition.kind !== "RouteEquals" ||
    typeof edge.condition.routeKey !== "string" ||
    !ROUTE_ID.test(edge.condition.routeKey) ||
    edge.condition.routeKey === "." ||
    edge.condition.routeKey === ".."
  ) {
    return `Edge '${edge.id}' has an unsupported or malformed condition`;
  }
  if (source.kind !== "router") {
    return `Edge '${edge.id}' uses RouteEquals but source '${source.id}' is not a router`;
  }
  return undefined;
}

/**
 * Inspect the complete compiled graph before dispatch and group every
 * condition this scheduler cannot execute by source node. The compiler owns
 * the cross-feature registry, while this runtime currently owns RouteEquals
 * only; registered foreign conditions therefore remain compiler-valid but
 * must fail closed before any node can run.
 */
export function graphConditionCapabilityIssues(
  graph: GraphSpec,
): readonly GraphConditionCapabilityIssue[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const grouped = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const source = nodes.get(edge.from.node);
    if (source === undefined) continue;
    const issue = edgeConditionError(edge, source);
    if (issue === undefined) continue;
    const messages = grouped.get(source.id);
    if (messages === undefined) grouped.set(source.id, [issue]);
    else messages.push(issue);
  }
  return graph.nodes.flatMap((node) => {
    const messages = grouped.get(node.id);
    return messages === undefined ? [] : [{
      nodeId: node.id,
      messages: Object.freeze([...messages]),
    }];
  });
}

/** Recompute the decision from its request evidence and policy, rejecting forged results. */
export function assertExactRouteSelection(
  node: NodeSpec,
  authoritativeInput: JsonValue,
  output: JsonValue,
): void {
  if (!record(output) ||
    Object.keys(output).sort(compareUnicodeCodePoints).join("\0") !== RESULT_KEYS.join("\0")) {
    throw new InvalidRouteSelectionError("router output must have the exact route-selection fields");
  }
  routeArray(output.requestedRoutes, "requestedRoutes");
  routeArray(output.selectedRoutes, "selectedRoutes");
  routeArray(output.unknownRoutes, "unknownRoutes");
  if (typeof output.routed !== "boolean" || typeof output.usedDefault !== "boolean" ||
    typeof output.escalated !== "boolean" || typeof output.reasonCode !== "string" ||
    !(output.confidenceBasisPoints === null ||
      Number.isSafeInteger(output.confidenceBasisPoints) &&
      (output.confidenceBasisPoints as number) >= 0 &&
      (output.confidenceBasisPoints as number) <= 10_000)) {
    throw new InvalidRouteSelectionError("router output has invalid route-selection field types");
  }

  let expected: unknown;
  try {
    expected = evaluateRouteSelection(
      authoritativeInput as unknown as RouteSelectionRequest,
      node.config as RouteSelectionPolicy,
    );
  } catch (cause) {
    throw new InvalidRouteSelectionError("router output cannot be recomputed from its policy", { cause });
  }
  if (canonicalSerialize(expected) !== canonicalSerialize(output)) {
    throw new InvalidRouteSelectionError("router output does not match the recomputed policy decision");
  }
}

export const routeSelectionExecutor: NodeExecutor = ({ input, node }) => {
  try {
    return evaluateRouteSelection(
      input as unknown as RouteSelectionRequest,
      node.config as RouteSelectionPolicy,
    ) as unknown as JsonValue;
  } catch (cause) {
    throw new InvalidRouteSelectionError("router input or policy is invalid", { cause });
  }
};

export function edgeIsActive(edge: EdgeSpec, source: NodeRunResult): boolean {
  if (source.status === "skipped" && source.failure?.code === "ROUTE_NOT_SELECTED") return false;
  if (edge.condition === undefined || source.status !== "succeeded") return true;
  const routeKey = edge.condition.routeKey as string;
  return (source.output as { readonly selectedRoutes: readonly string[] }).selectedRoutes
    .includes(routeKey);
}
