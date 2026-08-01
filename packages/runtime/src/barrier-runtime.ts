import {
  barrierDecisionId,
  decisionPolicyHash,
  evaluateIntegratedBarrier,
  validateBarrierPolicy,
  validateBarrierVote,
  BARRIER_VERDICT_DISPOSITION,
  type BarrierArrival,
  type BarrierArrivalDisposition,
  type BarrierDecisionCore,
  type EdgeSpec,
  type GraphSpec,
  type IntegratedBarrierPolicySnapshot,
} from "@graph-engineering/core";

import type {
  DecisionContext,
  JsonValue,
  MonotonicClock,
  NodeRunResult,
} from "./types.js";

/**
 * Scheduler-side integrated barrier: arming, disposition collection, the
 * deterministic deadline, and the frozen `BarrierSatisfied` document.
 *
 * The published pure evaluator `evaluateSettledBarrier` is untouched. This is a
 * strict superset defined at the scheduler boundary; it does not alter, weaken
 * or reinterpret that primitive.
 */

/** A clock frozen at zero. It never advances, so no deadline ever elapses. */
export const FROZEN_CLOCK: MonotonicClock = Object.freeze({ nowMs: () => 0 });

export interface ScriptedClock extends MonotonicClock {
  /** Number of ticks the driver has already delivered. */
  readonly deliveredTicks: number;
}

/**
 * A monotonic clock driven by a scripted tick list. `nowMs` starts at the first
 * entry and advances to the next entry each time the driver delivers a tick.
 * Once the list is exhausted the driver reports that it will never advance
 * again, so the scheduler stops waiting on it instead of deadlocking.
 *
 * The driver delivers a tick on the macrotask queue, which is what makes the
 * tick a *quiescence* point rather than a race: every settlement a deterministic
 * executor can still produce is a microtask, so it is always observed first.
 * The delivery carries no duration — the decision depends only on the scripted
 * values — and the scheduler itself schedules no timer for a deadline.
 */
export function createScriptedClock(ticks: readonly number[]): ScriptedClock {
  const script = [...ticks];
  for (const [index, value] of script.entries()) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`scripted tick ${index} must be a non-negative safe integer`);
    }
    if (index > 0 && value < (script[index - 1] as number)) {
      throw new TypeError(`scripted tick ${index} moves a monotonic clock backwards`);
    }
  }
  let cursor = 0;
  return {
    nowMs: () => script[cursor] ?? 0,
    nextTick: () => {
      if (cursor + 1 >= script.length) return undefined;
      return new Promise<void>((resolve) => {
        setImmediate(() => {
          if (cursor + 1 < script.length) cursor += 1;
          resolve();
        });
      });
    },
    get deliveredTicks() {
      return cursor;
    },
  };
}

/**
 * A `BarrierSatisfied` document: the policy decision, the two clock
 * observations the scheduler made, and the two domain-separated hashes.
 */
export interface BarrierDecisionDocument extends BarrierDecisionCore {
  readonly policyHash: string;
  readonly decisionId: string;
  readonly armedAtMs: number;
  readonly decidedAtMs: number;
}

/** A barrier node the runtime owns, with its incoming edges in declaration order. */
export interface BarrierBinding {
  readonly nodeId: string;
  readonly policy: IntegratedBarrierPolicySnapshot;
  readonly policyHash: string;
  readonly incoming: readonly EdgeSpec[];
}

/**
 * Every `barrier` node whose config claims and validates as an exact policy,
 * keyed by node ID, with incoming edges in **graph declaration order**. That
 * order is normative and appears verbatim in the decision document, so it is
 * deliberately not the scheduler's edge-ID ordering.
 */
export function bindIntegratedBarriers(graph: GraphSpec): ReadonlyMap<string, BarrierBinding> {
  const policies = new Map<string, IntegratedBarrierPolicySnapshot>();
  for (const node of graph.nodes) {
    if (node.kind !== "barrier") continue;
    const validated = validateBarrierPolicy(node.config);
    if (validated.valid) policies.set(node.id, validated.policy);
  }
  const incoming = new Map<string, EdgeSpec[]>();
  for (const nodeId of policies.keys()) incoming.set(nodeId, []);
  for (const edge of graph.edges) incoming.get(edge.to.node)?.push(edge);

  const bindings = new Map<string, BarrierBinding>();
  for (const [nodeId, policy] of policies) {
    bindings.set(nodeId, Object.freeze({
      nodeId,
      policy,
      policyHash: decisionPolicyHash("barrier", policy),
      incoming: Object.freeze(incoming.get(nodeId) as EdgeSpec[]),
    }));
  }
  return bindings;
}

/**
 * Upstream failure codes that mean the source settled without ever attempting,
 * or was cancelled before settling. Every one of them is a `missing` arrival
 * rather than a `failed` one.
 */
const MISSING_UPSTREAM_CODES: ReadonlySet<string> = new Set([
  "ROUTE_NOT_SELECTED",
  "UPSTREAM_FAILED",
  "UPSTREAM_UNKNOWN",
  "NODE_CANCELLED",
]);

export type ArrivalResolution =
  | { readonly kind: "arrival"; readonly arrival: BarrierArrival }
  | { readonly kind: "malformed-vote"; readonly sourceNodeId: string };

export interface ArrivalInputs {
  readonly edge: EdgeSpec;
  /** The settled upstream result, or `undefined` when the source is unsettled. */
  readonly result: NodeRunResult | undefined;
  /** False when the incoming edge's condition pruned this route. */
  readonly edgeActive: boolean;
  /** The value this edge would bind, for quorum ballot extraction only. */
  readonly boundValue: () => JsonValue | undefined;
}

/**
 * Classify one incoming edge into exactly one disposition entry.
 *
 * `all`, `minimum` and `percentage` barriers deliberately do not inspect
 * upstream values: a source that executed successfully contributes `succeeded`
 * regardless of what its output says. Only `quorum` reads the ballot.
 */
export function resolveArrival(
  policy: IntegratedBarrierPolicySnapshot,
  inputs: ArrivalInputs,
): ArrivalResolution {
  const sourceNodeId = inputs.edge.from.node;
  const missing = (disposition: BarrierArrivalDisposition): ArrivalResolution =>
    ({ kind: "arrival", arrival: { sourceNodeId, disposition } });

  if (!inputs.edgeActive) return missing("missing");
  if (inputs.result === undefined) return missing("timed_out");
  if (inputs.result.status !== "succeeded") {
    const code = inputs.result.failure?.code;
    return missing(
      inputs.result.status === "failed" && (code === undefined || !MISSING_UPSTREAM_CODES.has(code))
        ? "failed"
        : "missing",
    );
  }
  if (policy.kind !== "quorum") return missing("succeeded");

  const validated = validateBarrierVote(inputs.boundValue());
  if (!validated.valid) return { kind: "malformed-vote", sourceNodeId };
  return {
    kind: "arrival",
    arrival: {
      sourceNodeId,
      disposition: BARRIER_VERDICT_DISPOSITION[validated.vote.verdict],
      vote: validated.vote,
    },
  };
}

/**
 * Assemble the durable document. `decisionId` is recomputed here from the
 * document without `decisionId`, never copied, so a forged or transplanted
 * decision cannot survive.
 */
export function commitBarrierDecision(
  binding: BarrierBinding,
  context: DecisionContext,
  arrivals: readonly BarrierArrival[],
  armedAtMs: number,
  decidedAtMs: number,
): BarrierDecisionDocument {
  if (decidedAtMs < armedAtMs) {
    throw new TypeError(`barrier '${binding.nodeId}' decided before it armed`);
  }
  const core = evaluateIntegratedBarrier(binding.policy, binding.nodeId, arrivals);
  const withoutIdentity = {
    ...core,
    policyHash: binding.policyHash,
    armedAtMs,
    decidedAtMs,
  };
  return Object.freeze({
    ...withoutIdentity,
    decisionId: barrierDecisionId(
      { ...context, nodeId: binding.nodeId },
      withoutIdentity as unknown as Readonly<Record<string, unknown>>,
    ),
  });
}

/** Terminal node status each resolution settles the barrier node with. */
export const BARRIER_RESOLUTION_STATUS = Object.freeze({
  satisfied: "succeeded",
  failed: "failed",
  unknown: "unknown",
  awaiting_human: "awaiting_human",
} as const);
