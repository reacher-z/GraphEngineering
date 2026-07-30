import { compareUnicodeCodePoints } from "./canonical.js";
import type { CompilerDiagnostic } from "./compiler.js";
import type { GraphSpec } from "./types.js";

const MAX_SAFE_COUNT = 9_007_199_254_740_991;
const MAX_BASIS_POINTS = 10_000;

/**
 * Ownership discriminator. A barrier config is a *claimed policy* if and only
 * if it is a portable object carrying exactly this `apiVersion`. Ownership is a
 * versioned claim the author states, never a shape the compiler guesses, which
 * mirrors the accepted `(apiVersion, kind)` conditional-edge registry.
 */
export const INTEGRATED_BARRIER_API_VERSION =
  "graphengineering.reacher-z.github.io/barrier/v1alpha1" as const;

/**
 * Contract order is the declaration-block order of the IntegratedBarrierPolicy
 * block in `spec/integrated-barrier-semantics.md`. It deliberately differs from
 * the `properties` order of `integrated-barrier-policy.schema.json`, which
 * lists the resolution members before the per-kind threshold members. The
 * normative text wins and the schema property order carries no diagnostic
 * meaning.
 */
const POLICY_KEYS = new Set([
  "apiVersion",
  "kind",
  "minimum",
  "basisPoints",
  "quorum",
  "deadline",
  "onUnsatisfied",
  "lateArrival",
]);
const QUORUM_KEYS = new Set(["accepts", "countAbstainAsParticipant"]);
const DEADLINE_KEYS = new Set(["afterMs"]);

const KINDS = new Set(["all", "minimum", "percentage", "quorum"]);
const ON_UNSATISFIED = new Set(["fail", "unknown", "human"]);
const LATE_ARRIVAL = new Set(["ignore", "reject"]);

/** Threshold member each kind owns. Every other threshold member is forbidden. */
const THRESHOLD_BY_KIND: Readonly<Record<string, string | undefined>> = Object.freeze({
  all: undefined,
  minimum: "minimum",
  percentage: "basisPoints",
  quorum: "quorum",
});

/** Cardinality members visited in contract order by the GE1422 pass. */
const CARDINALITY_KEYS = ["minimum", "basisPoints", "quorum"] as const;

export type IntegratedBarrierKind = "all" | "minimum" | "percentage" | "quorum";
export type BarrierUnsatisfiedResolution = "fail" | "unknown" | "human";
export type BarrierLateArrivalPolicy = "ignore" | "reject";

export interface IntegratedBarrierQuorumSnapshot {
  readonly accepts: number;
  readonly countAbstainAsParticipant: boolean;
}

export interface IntegratedBarrierDeadlineSnapshot {
  readonly afterMs: number;
}

export interface IntegratedBarrierPolicySnapshot {
  readonly apiVersion: typeof INTEGRATED_BARRIER_API_VERSION;
  readonly kind: IntegratedBarrierKind;
  readonly minimum?: number;
  readonly basisPoints?: number;
  readonly quorum?: IntegratedBarrierQuorumSnapshot;
  readonly deadline?: IntegratedBarrierDeadlineSnapshot;
  readonly onUnsatisfied: BarrierUnsatisfiedResolution;
  readonly lateArrival: BarrierLateArrivalPolicy;
}

/**
 * A barrier config that does not claim this contract. It carries no diagnostic
 * and is never interpreted as a policy: pre-contract configs such as
 * `{"condition": "all"}`, `{}`, and every portable null, scalar or array config
 * land here and keep whatever behavior they already had.
 */
export interface UnclaimedBarrierConfig {
  readonly valid: false;
  readonly claimed: false;
}

/** A claimed policy that is not an exact policy object. */
export interface InvalidBarrierPolicyShape {
  readonly valid: false;
  readonly claimed: true;
  readonly code: "GE1421_INVALID_BARRIER_POLICY";
  readonly relativePath: string;
}

/** A shape-exact claimed policy whose threshold members disagree with its kind. */
export interface InvalidBarrierPolicyCardinality {
  readonly valid: false;
  readonly claimed: true;
  readonly code: "GE1422_BARRIER_POLICY_KIND_MISMATCH";
  readonly relativePath: string;
}

export interface ValidBarrierPolicy {
  readonly valid: true;
  readonly claimed: true;
  readonly policy: IntegratedBarrierPolicySnapshot;
}

export type BarrierPolicyValidation =
  | UnclaimedBarrierConfig
  | InvalidBarrierPolicyShape
  | InvalidBarrierPolicyCardinality
  | ValidBarrierPolicy;

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstUnknown(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): string | undefined {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort(compareUnicodeCodePoints)[0];
}

function boundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value)
    && (value as number) >= minimum
    && (value as number) <= maximum;
}

const UNCLAIMED: UnclaimedBarrierConfig = Object.freeze({ valid: false, claimed: false });

function shape(relativePath: string): InvalidBarrierPolicyShape {
  return { valid: false, claimed: true, code: "GE1421_INVALID_BARRIER_POLICY", relativePath };
}

function cardinality(relativePath: string): InvalidBarrierPolicyCardinality {
  return {
    valid: false,
    claimed: true,
    code: "GE1422_BARRIER_POLICY_KIND_MISMATCH",
    relativePath,
  };
}

/**
 * A barrier config claims this contract if and only if it is a portable object
 * carrying exactly the contract `apiVersion`. A portable null, scalar, or array
 * config cannot carry one, so it never claims.
 */
export function claimsIntegratedBarrierPolicy(value: unknown): boolean {
  return record(value) && value.apiVersion === INTEGRATED_BARRIER_API_VERSION;
}

/**
 * Shape pass. Unknown keys report first in ascending Unicode code-point order,
 * then required-or-present members report in contract order. A kind-owned
 * threshold member is never *required* here: its absence is a cardinality fact
 * owned by the GE1422 pass, so a config that is missing both a required
 * resolution member and its kind threshold reports the shape error.
 */
function shapeError(
  value: Readonly<Record<string, unknown>>,
): InvalidBarrierPolicyShape | undefined {
  const unknown = firstUnknown(value, POLICY_KEYS);
  if (unknown !== undefined) return shape(`/${unknown}`);

  if (typeof value.kind !== "string" || !KINDS.has(value.kind)) return shape("/kind");

  if (Object.hasOwn(value, "minimum")
      && !boundedInteger(value.minimum, 1, MAX_SAFE_COUNT)) {
    return shape("/minimum");
  }
  if (Object.hasOwn(value, "basisPoints")
      && !boundedInteger(value.basisPoints, 1, MAX_BASIS_POINTS)) {
    return shape("/basisPoints");
  }
  if (Object.hasOwn(value, "quorum")) {
    if (!record(value.quorum)) return shape("/quorum");
    const quorumUnknown = firstUnknown(value.quorum, QUORUM_KEYS);
    if (quorumUnknown !== undefined) return shape(`/quorum/${quorumUnknown}`);
    if (!boundedInteger(value.quorum.accepts, 1, MAX_SAFE_COUNT)) {
      return shape("/quorum/accepts");
    }
    if (typeof value.quorum.countAbstainAsParticipant !== "boolean") {
      return shape("/quorum/countAbstainAsParticipant");
    }
  }
  if (Object.hasOwn(value, "deadline")) {
    if (!record(value.deadline)) return shape("/deadline");
    const deadlineUnknown = firstUnknown(value.deadline, DEADLINE_KEYS);
    if (deadlineUnknown !== undefined) return shape(`/deadline/${deadlineUnknown}`);
    if (!boundedInteger(value.deadline.afterMs, 1, MAX_SAFE_COUNT)) {
      return shape("/deadline/afterMs");
    }
  }
  if (typeof value.onUnsatisfied !== "string" || !ON_UNSATISFIED.has(value.onUnsatisfied)) {
    return shape("/onUnsatisfied");
  }
  if (typeof value.lateArrival !== "string" || !LATE_ARRIVAL.has(value.lateArrival)) {
    return shape("/lateArrival");
  }
  return undefined;
}

/**
 * Validate a `barrier` node config as a direct exact IntegratedBarrierPolicy.
 *
 * A config that does not claim the contract returns the unclaimed member and
 * produces no diagnostic. A claimed config is fully validated: every defect
 * inside the carrier — an unknown member such as a `kynd` typo, a missing
 * `kind`, a wrong type, a kind/threshold cardinality error — is GE1421 or
 * GE1422 and never a silent pass.
 */
export function validateBarrierPolicy(value: unknown): BarrierPolicyValidation {
  if (!claimsIntegratedBarrierPolicy(value)) return UNCLAIMED;
  const claimed = value as Readonly<Record<string, unknown>>;

  const invalidShape = shapeError(claimed);
  if (invalidShape !== undefined) return invalidShape;

  const kind = claimed.kind as IntegratedBarrierKind;
  const owned = THRESHOLD_BY_KIND[kind];
  for (const key of CARDINALITY_KEYS) {
    if ((owned === key) !== Object.hasOwn(claimed, key)) return cardinality(`/${key}`);
  }

  return {
    valid: true,
    claimed: true,
    policy: Object.freeze({
      apiVersion: INTEGRATED_BARRIER_API_VERSION,
      kind,
      ...(Object.hasOwn(claimed, "minimum") ? { minimum: claimed.minimum as number } : {}),
      ...(Object.hasOwn(claimed, "basisPoints")
        ? { basisPoints: claimed.basisPoints as number }
        : {}),
      ...(Object.hasOwn(claimed, "quorum")
        ? {
          quorum: Object.freeze({
            accepts: (claimed.quorum as IntegratedBarrierQuorumSnapshot).accepts,
            countAbstainAsParticipant:
              (claimed.quorum as IntegratedBarrierQuorumSnapshot).countAbstainAsParticipant,
          }),
        }
        : {}),
      ...(Object.hasOwn(claimed, "deadline")
        ? {
          deadline: Object.freeze({
            afterMs: (claimed.deadline as IntegratedBarrierDeadlineSnapshot).afterMs,
          }),
        }
        : {}),
      onUnsatisfied: claimed.onUnsatisfied as BarrierUnsatisfiedResolution,
      lateArrival: claimed.lateArrival as BarrierLateArrivalPolicy,
    }),
  };
}

function diagnostic(
  code:
    | "GE1421_INVALID_BARRIER_POLICY"
    | "GE1422_BARRIER_POLICY_KIND_MISMATCH"
    | "GE1423_BARRIER_NO_INPUTS"
    | "GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS",
  message: string,
  path: string,
  nodeId: string,
): CompilerDiagnostic {
  return Object.freeze({
    code,
    severity: "error",
    message,
    path,
    nodeIds: Object.freeze([nodeId]),
  });
}

/**
 * Validate every claimed barrier policy and its incoming-edge cardinality on a
 * captured graph.
 *
 * A `barrier` node whose config does not claim the contract is skipped
 * entirely: this pass emits no diagnostic for it, not even GE1423, because it
 * does not interpret the config as a policy at all. That is what keeps
 * pre-contract configs such as `{"condition": "all"}` and `{}` compiling.
 *
 * For claimed policies, diagnostics are emitted by category in GE1421, GE1422,
 * GE1423, GE1424 order and within each category in node declaration order.
 * Suppression is local and forms a chain: GE1421 suppresses GE1422 and GE1424
 * on the same node, GE1422 suppresses GE1424 on the same node, and neither
 * suppresses GE1423, because the incoming-edge count is a property of the graph
 * rather than of the policy.
 */
export function validateIntegratedBarrierSnapshot(
  graph: GraphSpec,
): readonly CompilerDiagnostic[] {
  const incomingCount = new Map<string, number>();
  for (const edge of graph.edges) {
    incomingCount.set(edge.to.node, (incomingCount.get(edge.to.node) ?? 0) + 1);
  }

  const shapeDiagnostics: CompilerDiagnostic[] = [];
  const kindDiagnostics: CompilerDiagnostic[] = [];
  const inputDiagnostics: CompilerDiagnostic[] = [];
  const thresholdDiagnostics: CompilerDiagnostic[] = [];

  for (const [index, node] of graph.nodes.entries()) {
    if (node.kind !== "barrier") continue;
    const validated = validateBarrierPolicy(node.config);
    if (!validated.claimed) continue;

    const inputs = incomingCount.get(node.id) ?? 0;
    if (inputs === 0) {
      inputDiagnostics.push(diagnostic(
        "GE1423_BARRIER_NO_INPUTS",
        `Barrier '${node.id}' has no incoming edges`,
        `#/nodes/${index}`,
        node.id,
      ));
    }

    if (!validated.valid) {
      const base = `#/nodes/${index}/config${validated.relativePath}`;
      if (validated.code === "GE1421_INVALID_BARRIER_POLICY") {
        shapeDiagnostics.push(diagnostic(
          validated.code,
          `Barrier '${node.id}' config is not an exact integrated barrier policy`,
          base,
          node.id,
        ));
      } else {
        kindDiagnostics.push(diagnostic(
          validated.code,
          `Barrier '${node.id}' policy kind '${(node.config as { kind?: unknown }).kind as string}'`
            + ` disagrees with its threshold members`,
          base,
          node.id,
        ));
      }
      continue;
    }

    const { policy } = validated;
    if (policy.kind === "minimum" && (policy.minimum as number) > inputs) {
      thresholdDiagnostics.push(diagnostic(
        "GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS",
        `Barrier '${node.id}' minimum ${policy.minimum as number} exceeds its ${inputs} incoming edges`,
        `#/nodes/${index}/config/minimum`,
        node.id,
      ));
    } else if (policy.kind === "quorum"
        && (policy.quorum as IntegratedBarrierQuorumSnapshot).accepts > inputs) {
      thresholdDiagnostics.push(diagnostic(
        "GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS",
        `Barrier '${node.id}' quorum accepts `
          + `${(policy.quorum as IntegratedBarrierQuorumSnapshot).accepts}`
          + ` exceeds its ${inputs} incoming edges`,
        `#/nodes/${index}/config/quorum/accepts`,
        node.id,
      ));
    }
  }

  return Object.freeze([
    ...shapeDiagnostics,
    ...kindDiagnostics,
    ...inputDiagnostics,
    ...thresholdDiagnostics,
  ]);
}
