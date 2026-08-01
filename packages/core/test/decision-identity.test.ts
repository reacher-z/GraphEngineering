import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  BARRIER_DECISION_DOMAIN,
  POLICY_HASH_DOMAIN,
  ROUTE_DECISION_DOMAIN,
  barrierDecisionId,
  canonicalHash,
  canonicalSerialize,
  decisionDocumentIdentifierIssues,
  decisionIdentity,
  decisionPolicyHash,
  routeDecisionId,
  type DecisionDocumentKind,
  type PolicyKindTag,
} from "../src/index.js";

interface IdentityCase {
  readonly name: string;
  readonly documentKind: DecisionDocumentKind;
  readonly decisionDomain: string;
  readonly policyKindTag: PolicyKindTag;
  readonly policy: unknown;
  readonly runId: string;
  readonly graphRevision: number;
  readonly nodeId: string;
  readonly naiveConcatenationGroup?: string;
  readonly nullMemberWitness?: string;
  readonly canonicalEvidenceKeyOrder?: readonly string[];
  readonly evidenceInputs?: readonly {
    readonly sourceNodeId: string;
    readonly evidence: unknown;
    readonly evidenceHash: string;
  }[];
  readonly document: Readonly<Record<string, unknown>>;
  readonly expect: {
    readonly policyHash: string;
    readonly decisionId: string;
    readonly canonicalPolicyUtf8Bytes: number;
    readonly canonicalDocumentWithoutDecisionIdUtf8Bytes: number;
  };
}

interface IdentifierCase {
  readonly name: string;
  readonly documentKind: DecisionDocumentKind;
  readonly path: string;
  readonly value: string;
  readonly expect: { readonly valid: boolean; readonly reason: string };
}

interface BarrierCorpus {
  readonly hashContract: {
    readonly framing: string;
    readonly policyHashDomain: string;
    readonly policyKindTags: readonly PolicyKindTag[];
    readonly barrierDecisionDomain: string;
    readonly routeDecisionDomain: string;
    readonly policyHashFrames: readonly string[];
    readonly decisionIdFrames: readonly string[];
    readonly crossRuntimeRequirement: string;
    readonly domainSeparation: {
      readonly policy: unknown;
      readonly canonicalPolicy: string;
      readonly barrierPolicyHash: string;
      readonly routerPolicyHash: string;
    };
  };
  readonly identifierContract: {
    readonly nodeIdPattern: string;
    readonly safeRouteIdPattern: string;
    readonly reservedRouteKeys: readonly string[];
  };
  readonly identityCases: readonly IdentityCase[];
  readonly identifierBaseDocuments: Readonly<
    Record<DecisionDocumentKind, Readonly<Record<string, unknown>>>
  >;
  readonly identifierCases: readonly IdentifierCase[];
}

const corpus = JSON.parse(readFileSync(
  new URL("../../../spec/conformance/integrated-barrier.case.json", import.meta.url),
  "utf8",
)) as BarrierCorpus;

const utf8Bytes = (value: string): number => Buffer.byteLength(value, "utf8");

/** Replace one JSON-pointer location in a cloned document. */
function withValue(
  document: Readonly<Record<string, unknown>>,
  pointer: string,
  value: string,
): Readonly<Record<string, unknown>> {
  const segments = pointer.split("/").slice(1);
  const clone = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
  let cursor: Record<string, unknown> = clone;
  for (const segment of segments.slice(0, -1)) {
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1] as string] = value;
  return clone;
}

describe("durable decision identity conformance", () => {
  test("this suite consumes the whole identity and identifier sections", () => {
    expect(corpus.identityCases).toHaveLength(12);
    expect(corpus.identifierCases).toHaveLength(12);
  });

  test("the framing and domain tags are the implemented ones", () => {
    expect(POLICY_HASH_DOMAIN).toBe(corpus.hashContract.policyHashDomain);
    expect(BARRIER_DECISION_DOMAIN).toBe(corpus.hashContract.barrierDecisionDomain);
    expect(ROUTE_DECISION_DOMAIN).toBe(corpus.hashContract.routeDecisionDomain);
    expect(corpus.hashContract.framing).toBe("frame(s) = uint32be(byteLength(utf8(s))) || utf8(s)");
    expect(corpus.hashContract.policyHashFrames)
      .toEqual(["policyHashDomain", "policyKindTag", "canonicalSerialize(policy)"]);
    expect(corpus.hashContract.decisionIdFrames).toEqual([
      "decisionDomain",
      "runId",
      "decimal(graphRevision)",
      "nodeId",
      "canonicalSerialize(document without decisionId)",
    ]);
    expect(corpus.hashContract.crossRuntimeRequirement)
      .toContain("neither may import an expectation from the other");
  });

  test("the same policy hashes differently as a barrier and as a router policy", () => {
    const { domainSeparation } = corpus.hashContract;
    expect(canonicalSerialize(domainSeparation.policy)).toBe(domainSeparation.canonicalPolicy);
    expect(decisionPolicyHash("barrier", domainSeparation.policy))
      .toBe(domainSeparation.barrierPolicyHash);
    expect(decisionPolicyHash("router", domainSeparation.policy))
      .toBe(domainSeparation.routerPolicyHash);
    expect(domainSeparation.barrierPolicyHash).not.toBe(domainSeparation.routerPolicyHash);
    expect(corpus.hashContract.policyKindTags).toEqual(["barrier", "router"]);
  });

  test.each(corpus.identityCases)("identity: $name", (identityCase) => {
    const { decisionId: _decisionId, ...withoutDecisionId } = identityCase.document;
    expect(utf8Bytes(canonicalSerialize(identityCase.policy)))
      .toBe(identityCase.expect.canonicalPolicyUtf8Bytes);
    expect(utf8Bytes(canonicalSerialize(withoutDecisionId)))
      .toBe(identityCase.expect.canonicalDocumentWithoutDecisionIdUtf8Bytes);

    const policyHash = decisionPolicyHash(identityCase.policyKindTag, identityCase.policy);
    expect(policyHash).toBe(identityCase.expect.policyHash);
    // The recorded document carries the same hash it claims.
    expect(identityCase.document.policyHash).toBe(policyHash);

    const context = {
      runId: identityCase.runId,
      graphRevision: identityCase.graphRevision,
      nodeId: identityCase.nodeId,
    };
    const identity = identityCase.documentKind === "BarrierDecision"
      ? barrierDecisionId(context, identityCase.document)
      : routeDecisionId(context, identityCase.document);
    expect(identity).toBe(identityCase.expect.decisionId);
    expect(identityCase.document.decisionId).toBe(identity);
    expect(decisionIdentity(
      identityCase.decisionDomain as typeof BARRIER_DECISION_DOMAIN,
      context,
      identityCase.document,
    )).toBe(identity);
  });

  test("the decision identity binds the run ID", () => {
    const forked = corpus.identityCases.find(
      (item) => item.name === "barrier-identity-binds-the-run-id",
    );
    const parent = corpus.identityCases.find(
      (item) => item.name === "barrier-all-satisfied-identity",
    );
    if (forked === undefined || parent === undefined) throw new Error("missing identity witness");
    // Same policy, same revision, same node, same document body: only the run
    // differs, and the identity must differ with it.
    const { decisionId: _forkedId, ...forkedBody } = forked.document;
    const { decisionId: _parentId, ...parentBody } = parent.document;
    expect(canonicalSerialize(forkedBody)).toBe(canonicalSerialize(parentBody));
    expect(forked.runId).not.toBe(parent.runId);
    expect(forked.expect.decisionId).not.toBe(parent.expect.decisionId);
  });

  test("explicit byte lengths defeat naive concatenation", () => {
    const group = corpus.identityCases.filter(
      (item) => item.naiveConcatenationGroup === "run-id-graph-revision-boundary",
    );
    expect(group).toHaveLength(2);
    const [left, right] = group as [IdentityCase, IdentityCase];
    // "run-1" + "23" and "run-12" + "3" concatenate to the same bytes.
    expect(left.runId + String(left.graphRevision))
      .toBe(right.runId + String(right.graphRevision));
    const { decisionId: _leftId, ...leftBody } = left.document;
    const { decisionId: _rightId, ...rightBody } = right.document;
    expect(canonicalSerialize(leftBody)).toBe(canonicalSerialize(rightBody));
    expect(left.expect.decisionId).not.toBe(right.expect.decisionId);
    expect(barrierDecisionId(
      { runId: left.runId, graphRevision: left.graphRevision, nodeId: left.nodeId },
      left.document,
    )).not.toBe(barrierDecisionId(
      { runId: right.runId, graphRevision: right.graphRevision, nodeId: right.nodeId },
      right.document,
    ));
  });

  test("evidence hashes sort object keys by Unicode code point", () => {
    const witness = corpus.identityCases.find(
      (item) => item.name === "barrier-quorum-identity-with-non-ascii-evidence-keys",
    );
    if (witness?.evidenceInputs === undefined) throw new Error("missing evidence witness");
    for (const input of witness.evidenceInputs) {
      expect(canonicalHash(input.evidence)).toBe(input.evidenceHash);
    }
    const serialized = canonicalSerialize(witness.evidenceInputs[0]?.evidence);
    const order = (witness.canonicalEvidenceKeyOrder as readonly string[])
      .map((key) => serialized.indexOf(JSON.stringify(key)));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  test("a route decision carries absent confidence as explicit null", () => {
    const witnesses = corpus.identityCases.filter(
      (item) => item.nullMemberWitness === "confidenceBasisPoints",
    );
    expect(witnesses.length).toBeGreaterThan(0);
    for (const witness of witnesses) {
      expect(witness.document.confidenceBasisPoints).toBeNull();
      // Null is serialized, never omitted; the identity depends on it.
      expect(canonicalSerialize(witness.document)).toContain("\"confidenceBasisPoints\":null");
    }
  });

  test.each(corpus.identifierCases)("identifier: $name", (identifierCase) => {
    const base = corpus.identifierBaseDocuments[identifierCase.documentKind];
    const document = withValue(base, identifierCase.path, identifierCase.value);
    const issues = decisionDocumentIdentifierIssues(identifierCase.documentKind, document);
    expect(issues.includes(identifierCase.path)).toBe(!identifierCase.expect.valid);
    // The base document itself is always clean, so an issue can only come from
    // the mutated member.
    expect(decisionDocumentIdentifierIssues(identifierCase.documentKind, base)).toEqual([]);
    if (identifierCase.expect.valid) expect(issues).toEqual([]);
    else expect(issues).toEqual([identifierCase.path]);
  });

  test("node IDs and route keys use deliberately different patterns", () => {
    expect(corpus.identifierContract.nodeIdPattern).toBe("^[A-Za-z][A-Za-z0-9_.-]{0,127}$");
    expect(corpus.identifierContract.safeRouteIdPattern)
      .toBe("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$");
    expect(corpus.identifierContract.reservedRouteKeys).toEqual([".", ".."]);
    // A leading digit is a route key but never a node ID.
    const route = corpus.identifierBaseDocuments.RouteDecision;
    expect(decisionDocumentIdentifierIssues("RouteDecision", route)).toEqual([]);
    expect(route.selectedRoutes).toEqual(["7audit"]);
    expect(decisionDocumentIdentifierIssues("BarrierDecision", {
      ...corpus.identifierBaseDocuments.BarrierDecision,
      barrierNodeId: "7audit",
    })).toEqual(["/barrierNodeId"]);
  });
});
