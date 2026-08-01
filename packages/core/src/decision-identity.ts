import { createHash } from "node:crypto";

import { canonicalSerialize } from "./canonical.js";

/**
 * Durable decision identity for `integrated-barrier-semantics.md`.
 *
 * Both hashes are domain separated with explicit byte lengths, so concatenation
 * is injective and no field boundary can be forged by crafted content. Nothing
 * here reads a clock, a timer, or any ambient state: the same inputs produce the
 * same digest in TypeScript and in Python.
 */

/** Domain tag of the policy hash. */
export const POLICY_HASH_DOMAIN = "graphengineering.policy.v1alpha1" as const;
/** Domain tag of a `BarrierSatisfied` decision identity. */
export const BARRIER_DECISION_DOMAIN = "graphengineering.barrier-decision.v1alpha1" as const;
/** Domain tag of a `RouteSelected` decision identity. */
export const ROUTE_DECISION_DOMAIN = "graphengineering.route-decision.v1alpha1" as const;

/** The two policy families that own a domain-separated policy hash. */
export type PolicyKindTag = "barrier" | "router";

/** Decision families, keyed by the durable event type that carries them. */
export type DecisionDocumentKind = "BarrierDecision" | "RouteDecision";

/**
 * A Graph IR node identifier. It can never begin with a digit, so a decision
 * document must never accept a node ID the compiler could not have produced.
 */
export const DECISION_NODE_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
/** A SafeRouteId. It may begin with a digit but is never `.` or `..`. */
export const DECISION_SAFE_ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const NODE_ID_LIST_MEMBERS = [
  "acceptedIds",
  "failedIds",
  "missingIds",
  "timedOutIds",
  "abstainedIds",
  "unknownIds",
] as const;
const ROUTE_KEY_LIST_MEMBERS = [
  "requestedRoutes",
  "selectedRoutes",
  "unknownRoutes",
] as const;

function frame(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
}

function digest(frames: readonly string[]): string {
  return createHash("sha256").update(Buffer.concat(frames.map(frame))).digest("hex");
}

/**
 * Lowercase hex SHA-256 over
 * `frame(domain) || frame(kindTag) || frame(canonicalSerialize(policy))`.
 *
 * The kind tag is framed separately from the policy bytes, so the identical
 * policy document hashes differently as a barrier policy and as a router
 * policy.
 */
export function decisionPolicyHash(kindTag: PolicyKindTag, policy: unknown): string {
  return digest([POLICY_HASH_DOMAIN, kindTag, canonicalSerialize(policy)]);
}

export interface DecisionIdentityContext {
  readonly runId: string;
  readonly graphRevision: number;
  readonly nodeId: string;
}

/**
 * Lowercase hex SHA-256 over the domain, run ID, decimal graph revision, node
 * ID, and the canonical bytes of the document **without** `decisionId`.
 *
 * Binding `runId` is what makes a parent decision adopted verbatim by a forked
 * child run a `DECISION_IDENTITY_MISMATCH` rather than a silent reuse.
 */
export function decisionIdentity(
  domain: typeof BARRIER_DECISION_DOMAIN | typeof ROUTE_DECISION_DOMAIN,
  context: DecisionIdentityContext,
  document: Readonly<Record<string, unknown>>,
): string {
  const { decisionId: _decisionId, ...rest } = document;
  if (!Number.isSafeInteger(context.graphRevision)) {
    throw new TypeError("graphRevision must be a safe integer");
  }
  return digest([
    domain,
    context.runId,
    String(context.graphRevision),
    context.nodeId,
    canonicalSerialize(rest),
  ]);
}

/** `decisionIdentity` bound to the barrier domain. */
export function barrierDecisionId(
  context: DecisionIdentityContext,
  document: Readonly<Record<string, unknown>>,
): string {
  return decisionIdentity(BARRIER_DECISION_DOMAIN, context, document);
}

/** `decisionIdentity` bound to the route domain. */
export function routeDecisionId(
  context: DecisionIdentityContext,
  document: Readonly<Record<string, unknown>>,
): string {
  return decisionIdentity(ROUTE_DECISION_DOMAIN, context, document);
}

function nodeIdIssue(value: unknown, path: string): readonly string[] {
  return typeof value === "string" && DECISION_NODE_ID.test(value) ? [] : [path];
}

function routeKeyIssue(value: unknown, path: string): readonly string[] {
  return typeof value === "string" &&
    DECISION_SAFE_ROUTE_ID.test(value) &&
    value !== "." &&
    value !== ".."
    ? []
    : [path];
}

function listIssues(
  document: Readonly<Record<string, unknown>>,
  member: string,
  check: (value: unknown, path: string) => readonly string[],
): readonly string[] {
  const list: unknown = document[member];
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, index) => check(item, `/${member}/${index}`));
}

/**
 * Every identifier member of a decision document that is not the identifier its
 * member type admits, as JSON pointers in document order.
 *
 * The node-ID and route-key patterns are deliberately different: a node ID can
 * never begin with a digit, while a route key can, and only a route key has the
 * reserved `.` and `..` exclusions.
 */
export function decisionDocumentIdentifierIssues(
  kind: DecisionDocumentKind,
  document: Readonly<Record<string, unknown>>,
): readonly string[] {
  if (kind === "RouteDecision") {
    return Object.freeze([
      ...nodeIdIssue(document.routerNodeId, "/routerNodeId"),
      ...ROUTE_KEY_LIST_MEMBERS.flatMap((member) =>
        listIssues(document, member, routeKeyIssue)),
    ]);
  }
  const votes: unknown = document.votes;
  return Object.freeze([
    ...nodeIdIssue(document.barrierNodeId, "/barrierNodeId"),
    ...NODE_ID_LIST_MEMBERS.flatMap((member) => listIssues(document, member, nodeIdIssue)),
    ...(Array.isArray(votes)
      ? votes.flatMap((vote: unknown, index) => nodeIdIssue(
        (vote as Readonly<Record<string, unknown>> | null)?.sourceNodeId,
        `/votes/${index}/sourceNodeId`,
      ))
      : []),
  ]);
}
