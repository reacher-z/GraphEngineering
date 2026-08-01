import {
  barrierDecisionId,
  decisionPolicyHash,
  routeDecisionId,
  type PolicyKindTag,
} from "@graph-engineering/core";

import type { CommittedDecisionEvent, DecisionContext, JsonValue } from "./types.js";

/**
 * Zero-rejudge replay. A committed decision is authoritative forever: a node
 * that has one is never re-evaluated, its executor is never called, its
 * upstream values are never re-read, and no second decision event is appended.
 */

const POLICY_TAG: Readonly<Record<CommittedDecisionEvent["type"], PolicyKindTag>> = Object.freeze({
  BarrierSatisfied: "barrier",
  RouteSelected: "router",
});

/** The eight published route-selection members, plus the durable identity. */
const ROUTE_IDENTITY_MEMBERS = new Set(["routerNodeId", "policyHash", "decisionId"]);

export interface CommittedDecision {
  readonly type: CommittedDecisionEvent["type"];
  readonly nodeId: string;
  readonly document: Readonly<Record<string, unknown>>;
  readonly policyHash: string;
  readonly decisionId: string;
}

export type DecisionRejection =
  | {
    readonly code: "DECISION_POLICY_DRIFT";
    readonly nodeId: string;
    readonly recordedPolicyHash: string;
    readonly currentPolicyHash: string;
  }
  | {
    readonly code: "DECISION_IDENTITY_MISMATCH";
    readonly nodeId: string;
    readonly recordedDecisionId: string;
    readonly recomputedDecisionId: string;
  }
  | { readonly code: "DUPLICATE_DECISION"; readonly nodeId: string };

export type DecisionAdoption =
  | { readonly outcome: "adopted"; readonly decisions: readonly CommittedDecision[] }
  | { readonly outcome: "rejected"; readonly rejection: DecisionRejection };

function recomputeIdentity(
  event: CommittedDecisionEvent,
  context: DecisionContext,
): string {
  const identity = { ...context, nodeId: event.nodeId };
  return event.type === "BarrierSatisfied"
    ? barrierDecisionId(identity, event.data)
    : routeDecisionId(identity, event.data);
}

/**
 * Fold durable history into the committed decisions the scheduler must adopt.
 *
 * Every check is a refusal, never a silent re-judgement:
 *
 * - two committed events for one node in one run is `DUPLICATE_DECISION`;
 * - a recorded `policyHash` that disagrees with the currently compiled policy
 *   is `DECISION_POLICY_DRIFT`, naming both hashes;
 * - a `decisionId` that does not recompute from the adopted document and the
 *   current run, revision and node is `DECISION_IDENTITY_MISMATCH`.
 *
 * Because the identity binds `runId`, a parent decision adopted verbatim by a
 * forked child run is a mismatch rather than a silent reuse.
 */
export function adoptCommittedDecisions(
  history: readonly CommittedDecisionEvent[],
  currentPolicies: ReadonlyMap<string, unknown>,
  context: DecisionContext,
): DecisionAdoption {
  const seen = new Set<string>();
  for (const event of history) {
    if (seen.has(event.nodeId)) {
      return {
        outcome: "rejected",
        rejection: { code: "DUPLICATE_DECISION", nodeId: event.nodeId },
      };
    }
    seen.add(event.nodeId);
  }

  const decisions: CommittedDecision[] = [];
  for (const event of history) {
    const recordedPolicyHash = event.data.policyHash;
    const recordedDecisionId = event.data.decisionId;
    if (typeof recordedPolicyHash !== "string" || typeof recordedDecisionId !== "string") {
      return {
        outcome: "rejected",
        rejection: {
          code: "DECISION_IDENTITY_MISMATCH",
          nodeId: event.nodeId,
          recordedDecisionId: typeof recordedDecisionId === "string" ? recordedDecisionId : "",
          recomputedDecisionId: recomputeIdentity(event, context),
        },
      };
    }

    if (!currentPolicies.has(event.nodeId)) {
      return {
        outcome: "rejected",
        rejection: {
          code: "DECISION_POLICY_DRIFT",
          nodeId: event.nodeId,
          recordedPolicyHash,
          currentPolicyHash: "",
        },
      };
    }
    const currentPolicyHash = decisionPolicyHash(
      POLICY_TAG[event.type],
      currentPolicies.get(event.nodeId),
    );
    if (currentPolicyHash !== recordedPolicyHash) {
      return {
        outcome: "rejected",
        rejection: {
          code: "DECISION_POLICY_DRIFT",
          nodeId: event.nodeId,
          recordedPolicyHash,
          currentPolicyHash,
        },
      };
    }

    const recomputedDecisionId = recomputeIdentity(event, context);
    if (recomputedDecisionId !== recordedDecisionId) {
      return {
        outcome: "rejected",
        rejection: {
          code: "DECISION_IDENTITY_MISMATCH",
          nodeId: event.nodeId,
          recordedDecisionId,
          recomputedDecisionId,
        },
      };
    }

    decisions.push(Object.freeze({
      type: event.type,
      nodeId: event.nodeId,
      document: event.data,
      policyHash: recordedPolicyHash,
      decisionId: recordedDecisionId,
    }));
  }
  return { outcome: "adopted", decisions: Object.freeze(decisions) };
}

/**
 * Project the eight published route-selection members back out of an adopted
 * `RouteDecision`, so the router node binds exactly what it bound before.
 */
export function adoptedRouteSelection(
  document: Readonly<Record<string, unknown>>,
): JsonValue {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (!ROUTE_IDENTITY_MEMBERS.has(key)) output[key] = value;
  }
  return output as JsonValue;
}

export function decisionRejectionMessage(rejection: DecisionRejection): string {
  switch (rejection.code) {
    case "DUPLICATE_DECISION":
      return `Node '${rejection.nodeId}' has two committed decision events in one run`;
    case "DECISION_POLICY_DRIFT":
      return `Node '${rejection.nodeId}' recorded policy hash `
        + `${rejection.recordedPolicyHash} but the compiled policy hashes to `
        + `${rejection.currentPolicyHash}`;
    case "DECISION_IDENTITY_MISMATCH":
      return `Node '${rejection.nodeId}' recorded decision identity `
        + `${rejection.recordedDecisionId} but it recomputes to `
        + `${rejection.recomputedDecisionId}`;
  }
}
