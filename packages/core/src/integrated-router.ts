import { compareUnicodeCodePoints } from "./canonical.js";
import type { CompilerDiagnostic } from "./compiler.js";
import type { EdgeSpec, GraphSpec } from "./types.js";

export const ROUTER_CONDITION_API_VERSION =
  "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1" as const;

const ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LOOP_CONDITIONS = new Set([
  "LoopContinue",
  "LoopDryVerdict",
  "LoopVerdictAtBound",
]);
const POLICY_KEYS = new Set([
  "kind",
  "allowedRoutes",
  "defaultRoute",
  "confidence",
  "maxMulticast",
]);
const CONFIDENCE_KEYS = new Set(["minimumBasisPoints", "escalationRoute"]);
const ROUTE_CONDITION_KEYS = new Set(["apiVersion", "kind", "routeKey"]);

export interface RouteSelectionPolicySnapshot {
  readonly kind: "single" | "multi";
  readonly allowedRoutes: readonly string[];
  readonly defaultRoute?: string;
  readonly confidence?: Readonly<{
    minimumBasisPoints: number;
    escalationRoute: string;
  }>;
  readonly maxMulticast?: number;
}

export interface InvalidRouterValue {
  readonly valid: false;
  readonly relativePath: string;
}

export interface ValidRouterPolicy {
  readonly valid: true;
  readonly policy: RouteSelectionPolicySnapshot;
}

export type ValidRegisteredCondition =
  | { readonly valid: true; readonly owner: "loop-pattern" }
  | { readonly valid: true; readonly owner: "integrated-router"; readonly routeKey: string };

export type PolicyValidation = InvalidRouterValue | ValidRouterPolicy;

export type ConditionValidation = InvalidRouterValue | ValidRegisteredCondition;

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function routeId(value: unknown): value is string {
  return typeof value === "string"
    && ROUTE_ID.test(value)
    && value !== "."
    && value !== "..";
}

function firstUnknown(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): string | undefined {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort(compareUnicodeCodePoints)[0];
}

export function validateRouteSelectionPolicy(value: unknown): PolicyValidation {
  if (!record(value)) return { valid: false, relativePath: "" };
  const unknown = firstUnknown(value, POLICY_KEYS);
  if (unknown !== undefined) return { valid: false, relativePath: `/${unknown}` };

  if (value.kind !== "single" && value.kind !== "multi") {
    return { valid: false, relativePath: "/kind" };
  }
  if (!Array.isArray(value.allowedRoutes) || value.allowedRoutes.length === 0) {
    return { valid: false, relativePath: "/allowedRoutes" };
  }
  const allowedRoutes: string[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of value.allowedRoutes.entries()) {
    if (!routeId(candidate) || seen.has(candidate)) {
      return { valid: false, relativePath: `/allowedRoutes/${index}` };
    }
    seen.add(candidate);
    allowedRoutes.push(candidate);
  }

  if (Object.hasOwn(value, "defaultRoute")
      && (!routeId(value.defaultRoute) || !seen.has(value.defaultRoute))) {
    return { valid: false, relativePath: "/defaultRoute" };
  }

  let confidence: RouteSelectionPolicySnapshot["confidence"];
  if (Object.hasOwn(value, "confidence")) {
    if (!record(value.confidence)) {
      return { valid: false, relativePath: "/confidence" };
    }
    const confidenceUnknown = firstUnknown(value.confidence, CONFIDENCE_KEYS);
    if (confidenceUnknown !== undefined) {
      return { valid: false, relativePath: `/confidence/${confidenceUnknown}` };
    }
    if (!Number.isSafeInteger(value.confidence.minimumBasisPoints)
        || (value.confidence.minimumBasisPoints as number) < 1
        || (value.confidence.minimumBasisPoints as number) > 10_000) {
      return { valid: false, relativePath: "/confidence/minimumBasisPoints" };
    }
    if (!routeId(value.confidence.escalationRoute)
        || !seen.has(value.confidence.escalationRoute)) {
      return { valid: false, relativePath: "/confidence/escalationRoute" };
    }
    confidence = Object.freeze({
      minimumBasisPoints: value.confidence.minimumBasisPoints as number,
      escalationRoute: value.confidence.escalationRoute,
    });
  }

  let maxMulticast: number | undefined;
  if (value.kind === "single") {
    if (Object.hasOwn(value, "maxMulticast")) {
      return { valid: false, relativePath: "/maxMulticast" };
    }
  } else {
    if (!Number.isSafeInteger(value.maxMulticast)
        || (value.maxMulticast as number) < 1
        || (value.maxMulticast as number) > allowedRoutes.length) {
      return { valid: false, relativePath: "/maxMulticast" };
    }
    maxMulticast = value.maxMulticast as number;
  }

  return {
    valid: true,
    policy: Object.freeze({
      kind: value.kind,
      allowedRoutes: Object.freeze(allowedRoutes),
      ...(Object.hasOwn(value, "defaultRoute")
        ? { defaultRoute: value.defaultRoute as string }
        : {}),
      ...(confidence === undefined ? {} : { confidence }),
      ...(maxMulticast === undefined ? {} : { maxMulticast }),
    }),
  };
}

export function validateRegisteredEdgeCondition(value: unknown): ConditionValidation {
  if (!record(value)) return { valid: false, relativePath: "" };
  if (!Object.hasOwn(value, "apiVersion") || typeof value.apiVersion !== "string") {
    return { valid: false, relativePath: "/apiVersion" };
  }
  if (!Object.hasOwn(value, "kind") || typeof value.kind !== "string") {
    return { valid: false, relativePath: "/kind" };
  }
  if (value.apiVersion !== ROUTER_CONDITION_API_VERSION) {
    return { valid: false, relativePath: "/apiVersion" };
  }
  if (LOOP_CONDITIONS.has(value.kind)) {
    return { valid: true, owner: "loop-pattern" };
  }
  if (value.kind !== "RouteEquals") {
    return { valid: false, relativePath: "/kind" };
  }
  const unknown = firstUnknown(value, ROUTE_CONDITION_KEYS);
  if (unknown !== undefined) return { valid: false, relativePath: `/${unknown}` };
  if (!routeId(value.routeKey)) {
    return { valid: false, relativePath: "/routeKey" };
  }
  return { valid: true, owner: "integrated-router", routeKey: value.routeKey };
}

function diagnostic(
  code:
    | "GE1401_INVALID_ROUTER_POLICY"
    | "GE1402_UNSUPPORTED_EDGE_CONDITION"
    | "GE1403_CONDITION_SOURCE_NOT_ROUTER"
    | "GE1404_ROUTE_NOT_ALLOWED"
    | "GE1405_DUPLICATE_ROUTE_CASE"
    | "GE1406_DUPLICATE_ROUTE_TARGET"
    | "GE1407_INCOMPLETE_ROUTE_COVERAGE",
  message: string,
  path: string,
  fields: Pick<CompilerDiagnostic, "nodeIds" | "edgeId">,
): CompilerDiagnostic {
  return Object.freeze({
    code,
    severity: "error",
    message,
    path,
    nodeIds: Object.freeze([...(fields.nodeIds ?? [])]),
    ...(fields.edgeId === undefined ? {} : { edgeId: fields.edgeId }),
  });
}

interface RouteCandidate {
  readonly edge: EdgeSpec;
  readonly edgeIndex: number;
  readonly routerId: string;
  readonly routeKey: string;
}

/** Validate integrated router policy and RouteEquals topology on a captured graph. */
export function validateIntegratedRouterSnapshot(
  graph: GraphSpec,
): readonly CompilerDiagnostic[] {
  const policies = new Map<string, RouteSelectionPolicySnapshot>();
  const invalidRouters = new Set<string>();
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeIndex = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const policyDiagnostics: CompilerDiagnostic[] = [];
  for (const [index, node] of graph.nodes.entries()) {
    if (node.kind !== "router") continue;
    const validated = validateRouteSelectionPolicy(node.config);
    if (!validated.valid) {
      invalidRouters.add(node.id);
      policyDiagnostics.push(diagnostic(
        "GE1401_INVALID_ROUTER_POLICY",
        `Router '${node.id}' has an invalid route-selection policy`,
        `#/nodes/${index}/config${validated.relativePath}`,
        { nodeIds: [node.id] },
      ));
    } else {
      policies.set(node.id, validated.policy);
    }
  }

  const unsupportedDiagnostics: CompilerDiagnostic[] = [];
  const sourceDiagnostics: CompilerDiagnostic[] = [];
  const candidates: RouteCandidate[] = [];
  const suppressCoverage = new Set<string>();
  for (const [index, edge] of graph.edges.entries()) {
    if (edge.condition === undefined) continue;
    const validated = validateRegisteredEdgeCondition(edge.condition);
    if (!validated.valid) {
      unsupportedDiagnostics.push(diagnostic(
        "GE1402_UNSUPPORTED_EDGE_CONDITION",
        `Edge '${edge.id}' has an unsupported or malformed condition`,
        `#/edges/${index}/condition${validated.relativePath}`,
        { edgeId: edge.id, nodeIds: [edge.from.node] },
      ));
      if (policies.has(edge.from.node)) suppressCoverage.add(edge.from.node);
      continue;
    }
    if (validated.owner === "loop-pattern") continue;
    const source = nodesById.get(edge.from.node);
    if (source?.kind !== "router") {
      sourceDiagnostics.push(diagnostic(
        "GE1403_CONDITION_SOURCE_NOT_ROUTER",
        `Edge '${edge.id}' uses RouteEquals but source '${edge.from.node}' is not a router`,
        `#/edges/${index}/condition`,
        { edgeId: edge.id, nodeIds: [edge.from.node] },
      ));
      continue;
    }
    if (invalidRouters.has(source.id)) continue;
    candidates.push({
      edge,
      edgeIndex: index,
      routerId: source.id,
      routeKey: validated.routeKey,
    });
  }

  const notAllowedDiagnostics: CompilerDiagnostic[] = [];
  const duplicateCaseDiagnostics: CompilerDiagnostic[] = [];
  const duplicateTargetDiagnostics: CompilerDiagnostic[] = [];
  const allowedRoutes = new Map(
    [...policies].map(([routerId, policy]) => [routerId, new Set(policy.allowedRoutes)]),
  );
  const seenRoutes = new Map([...policies].map(([routerId]) => [routerId, new Set<string>()]));
  const seenTargets = new Map([...policies].map(([routerId]) => [routerId, new Set<string>()]));
  const acceptedRoutes = new Map([...policies].map(([routerId]) => [routerId, new Set<string>()]));
  for (const candidate of candidates) {
    const { edge, edgeIndex, routerId, routeKey } = candidate;
    const allowed = allowedRoutes.get(routerId)!;
    const routerSeenRoutes = seenRoutes.get(routerId)!;
    const routerSeenTargets = seenTargets.get(routerId)!;
    const accepted = acceptedRoutes.get(routerId)!;
    if (!allowed.has(routeKey)) {
      suppressCoverage.add(routerId);
      notAllowedDiagnostics.push(diagnostic(
        "GE1404_ROUTE_NOT_ALLOWED",
        `Edge '${edge.id}' route '${routeKey}' is not allowed by router '${routerId}'`,
        `#/edges/${edgeIndex}/condition/routeKey`,
        { edgeId: edge.id, nodeIds: [routerId] },
      ));
      continue;
    }
    if (routerSeenRoutes.has(routeKey)) {
      suppressCoverage.add(routerId);
      duplicateCaseDiagnostics.push(diagnostic(
        "GE1405_DUPLICATE_ROUTE_CASE",
        `Edge '${edge.id}' repeats route '${routeKey}' for router '${routerId}'`,
        `#/edges/${edgeIndex}/condition/routeKey`,
        { edgeId: edge.id, nodeIds: [routerId] },
      ));
      continue;
    }
    routerSeenRoutes.add(routeKey);
    accepted.add(routeKey);
    if (routerSeenTargets.has(edge.to.node)) {
      suppressCoverage.add(routerId);
      duplicateTargetDiagnostics.push(diagnostic(
        "GE1406_DUPLICATE_ROUTE_TARGET",
        `Edge '${edge.id}' repeats target '${edge.to.node}' for router '${routerId}'`,
        `#/edges/${edgeIndex}/to/node`,
        { edgeId: edge.id, nodeIds: [routerId, edge.to.node] },
      ));
    } else {
      routerSeenTargets.add(edge.to.node);
    }
  }

  const coverageDiagnostics: CompilerDiagnostic[] = [];
  for (const node of graph.nodes) {
    const policy = policies.get(node.id);
    if (policy === undefined || suppressCoverage.has(node.id)) continue;
    const accepted = acceptedRoutes.get(node.id) ?? new Set<string>();
    const missing = policy.allowedRoutes.filter((route) => !accepted.has(route));
    if (missing.length === 0) continue;
    coverageDiagnostics.push(diagnostic(
      "GE1407_INCOMPLETE_ROUTE_COVERAGE",
      `Router '${node.id}' is missing route cases: ${missing.join(", ")}`,
      `#/nodes/${nodeIndex.get(node.id) ?? 0}/config/allowedRoutes`,
      { nodeIds: [node.id] },
    ));
  }

  return Object.freeze([
    ...policyDiagnostics,
    ...unsupportedDiagnostics,
    ...sourceDiagnostics,
    ...notAllowedDiagnostics,
    ...duplicateCaseDiagnostics,
    ...duplicateTargetDiagnostics,
    ...coverageDiagnostics,
  ]);
}
