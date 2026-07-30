import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  INTEGRATED_BARRIER_API_VERSION,
  claimsIntegratedBarrierPolicy,
  compileGraph,
  validateBarrierPolicy,
  type BarrierPolicyValidation,
  type CompilerDiagnostic,
  type GraphSpec,
  type IntegratedBarrierPolicySnapshot,
} from "../src/index.js";

interface PolicyCase {
  readonly name: string;
  readonly config: unknown;
  readonly contractOrderWitness?: boolean;
  readonly integerSourceLiteral?: string;
  readonly expect: {
    readonly valid: boolean;
    readonly claimed: boolean;
    readonly code?: string;
    readonly relativePath?: string;
    readonly policy?: IntegratedBarrierPolicySnapshot;
  };
}

interface OwnershipCase {
  readonly name: string;
  readonly config: unknown;
  readonly note?: string;
  readonly expect: {
    readonly claimed: boolean;
    readonly diagnostics: readonly Readonly<{ code: string; relativePath: string }>[];
  };
}

interface CompilerCase {
  readonly name: string;
  readonly graphHash: string;
  readonly expectValid: boolean;
  readonly expectDiagnostics: readonly Readonly<Record<string, unknown>>[];
  readonly graph: GraphSpec;
}

interface BarrierCorpus {
  readonly contract: string;
  readonly implementationClaim: boolean;
  readonly claims: {
    readonly implementationClaim: boolean;
    readonly typescriptRuntimeClaim: boolean;
    readonly pythonRuntimeClaim: boolean;
    readonly capabilityGateClaim: boolean;
  };
  readonly diagnosticCodes: readonly string[];
  readonly firstInvalidDescendantRule: {
    readonly policyFieldOrder: readonly string[];
    readonly quorumFieldOrder: readonly string[];
    readonly deadlineFieldOrder: readonly string[];
    readonly cardinalityFieldOrder: readonly string[];
  };
  readonly policyCases: readonly PolicyCase[];
  readonly ownershipCases: readonly OwnershipCase[];
  readonly compilerCases: readonly CompilerCase[];
}

const corpus = JSON.parse(readFileSync(
  new URL("../../../spec/conformance/integrated-barrier.case.json", import.meta.url),
  "utf8",
)) as BarrierCorpus;

function projectDiagnostic(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    code: value.code,
    path: value.path,
    nodeIds: value.nodeIds,
    ...(value.edgeId === undefined ? {} : { edgeId: value.edgeId }),
  };
}

function compilerCase(name: string): CompilerCase {
  const found = corpus.compilerCases.find((item) => item.name === name);
  if (found === undefined) throw new Error(`missing compiler case '${name}'`);
  return found;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function diagnostics(graph: GraphSpec): readonly CompilerDiagnostic[] {
  return compileGraph(graph).diagnostics;
}

function codes(graph: GraphSpec): readonly string[] {
  return diagnostics(graph).map((item) => item.code);
}

/** A two-input barrier at node index 3, so GE1423 can never confound ownership. */
const OWNERSHIP_PROBE = compilerCase(
  "ge1421-unknown-policy-field-reports-the-first-invalid-descendant",
).graph;

function probeGraph(config: unknown): GraphSpec {
  const document = clone(OWNERSHIP_PROBE);
  (document.nodes[3] as { config: unknown }).config = config;
  return document;
}

describe("integrated barrier conformance", () => {
  test("the corpus is the frozen contract candidate this tranche consumes", () => {
    expect(corpus.contract)
      .toBe("graphengineering.reacher-z.github.io/integrated-barrier/v1alpha1");
    expect(corpus.implementationClaim).toBe(false);
    expect(corpus.claims.capabilityGateClaim).toBe(false);
    expect(corpus.diagnosticCodes).toEqual([
      "GE1421_INVALID_BARRIER_POLICY",
      "GE1422_BARRIER_POLICY_KIND_MISMATCH",
      "GE1423_BARRIER_NO_INPUTS",
      "GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS",
    ]);
    expect(corpus.policyCases).toHaveLength(79);
    expect(corpus.ownershipCases).toHaveLength(15);
    expect(corpus.compilerCases).toHaveLength(16);
  });

  test("contract order is the declaration block, not the schema properties order", () => {
    expect(corpus.firstInvalidDescendantRule.policyFieldOrder).toEqual([
      "apiVersion",
      "kind",
      "minimum",
      "basisPoints",
      "quorum",
      "deadline",
      "onUnsatisfied",
      "lateArrival",
    ]);
    expect(corpus.firstInvalidDescendantRule.quorumFieldOrder)
      .toEqual(["accepts", "countAbstainAsParticipant"]);
    expect(corpus.firstInvalidDescendantRule.deadlineFieldOrder).toEqual(["afterMs"]);
    expect(corpus.firstInvalidDescendantRule.cardinalityFieldOrder)
      .toEqual(["minimum", "basisPoints", "quorum"]);

    const schema = JSON.parse(readFileSync(
      new URL("../../../spec/integrated-barrier-policy.schema.json", import.meta.url),
      "utf8",
    )) as {
      readonly properties: Readonly<Record<string, { readonly const?: string }>>;
      readonly required: readonly string[];
    };
    expect(schema.properties.apiVersion?.const).toBe(INTEGRATED_BARRIER_API_VERSION);
    expect(schema.required).toContain("apiVersion");
    // The two orders really do disagree; the corpus witnesses freeze that fact.
    expect(Object.keys(schema.properties))
      .not.toEqual(corpus.firstInvalidDescendantRule.policyFieldOrder);
  });

  test.each(corpus.policyCases)("policy: $name", ({ config, expect: expected }) => {
    const actual: BarrierPolicyValidation = validateBarrierPolicy(config);
    expect(actual.valid).toBe(expected.valid);
    expect(actual.claimed).toBe(expected.claimed);
    if (actual.valid) {
      expect(actual.policy).toEqual(expected.policy);
    } else if (actual.claimed) {
      expect(actual.code).toBe(expected.code);
      expect(actual.relativePath).toBe(expected.relativePath);
    } else {
      // An unclaimed config carries no code and no path at all.
      expect(expected.code).toBeUndefined();
      expect(expected.relativePath).toBeUndefined();
    }
  });

  test.each(corpus.ownershipCases)("ownership: $name", ({ config, expect: expected }) => {
    const actual = validateBarrierPolicy(config);
    expect(actual.claimed).toBe(expected.claimed);
    expect(claimsIntegratedBarrierPolicy(config)).toBe(expected.claimed);
    expect(actual.valid ? [] : actual.claimed
      ? [{ code: actual.code, relativePath: actual.relativePath }]
      : []).toEqual(expected.diagnostics);
  });

  test.each(corpus.ownershipCases)(
    "ownership through the real compiler pass: $name",
    ({ config, expect: expected }) => {
      // The same ownership rule must hold for a barrier node inside a graph, not
      // only for the bare validator.
      expect(diagnostics(probeGraph(config)).map((item) => ({
        code: item.code,
        path: item.path,
      }))).toEqual(expected.diagnostics.map((item) => ({
        code: item.code,
        path: `#/nodes/3/config${item.relativePath}`,
      })));
    },
  );

  test("no ownership case leaves a legacy barrier config diagnosed", () => {
    const unclaimed = corpus.ownershipCases.filter((item) => !item.expect.claimed);
    expect(unclaimed.length).toBeGreaterThan(0);
    for (const item of unclaimed) {
      expect(item.expect.diagnostics, item.name).toEqual([]);
      expect(codes(probeGraph(item.config)), item.name).toEqual([]);
    }
    // The two configs this repository actually ships must be among them.
    expect(unclaimed.map((item) => JSON.stringify(item.config)))
      .toEqual(expect.arrayContaining(['{"condition":"all"}', "{}"]));
  });

  test("a claimed carrier is diagnosed rather than silently passed", () => {
    const claimed = corpus.ownershipCases.filter((item) => item.expect.claimed);
    expect(claimed.length).toBeGreaterThan(0);
    for (const item of claimed) {
      expect(claimsIntegratedBarrierPolicy(item.config), item.name).toBe(true);
      expect(codes(probeGraph(item.config)), item.name)
        .toEqual(item.expect.diagnostics.map((entry) => entry.code));
    }
  });

  test("every contract-order witness case is consumed", () => {
    const witnesses = corpus.policyCases.filter((item) => item.contractOrderWitness === true);
    expect(witnesses.map((item) => item.name)).toEqual([
      "threshold-field-precedes-resolution-field-in-contract-order",
      "deadline-precedes-resolution-field-in-contract-order",
      "shape-error-suppresses-a-cardinality-error-on-the-same-config",
    ]);
    for (const witness of witnesses) {
      const actual = validateBarrierPolicy(witness.config);
      expect(actual.valid, witness.name).toBe(false);
      if (actual.valid || !actual.claimed) throw new Error(`${witness.name} must be diagnosed`);
      expect(actual.relativePath, witness.name).toBe(witness.expect.relativePath);
      expect(actual.code, witness.name).toBe(witness.expect.code);
    }
  });

  test("JSON 1.0 integer source literals are accepted as integer one", () => {
    const literals = corpus.policyCases.filter(
      (item) => item.integerSourceLiteral !== undefined,
    );
    expect(literals).toHaveLength(4);
    for (const item of literals) {
      expect(validateBarrierPolicy(item.config).valid, item.name).toBe(true);
    }
    // Re-parse the literal forms from raw JSON text so 1.0 really enters as a
    // JSON number rather than a TypeScript integer written by this test.
    for (const literal of ["1.0", "1e0", "1.0000"]) {
      expect(validateBarrierPolicy(JSON.parse(
        `{"apiVersion":"${INTEGRATED_BARRIER_API_VERSION}","kind":"minimum",`
          + `"minimum":${literal},"onUnsatisfied":"fail","lateArrival":"ignore"}`,
      )).valid, literal).toBe(true);
    }
  });

  test.each(corpus.compilerCases)("compiler: $name", (fixture) => {
    const actual = compileGraph(fixture.graph);
    expect(actual.graphHash).toBe(fixture.graphHash);
    expect(actual.diagnostics.map(
      (item) => projectDiagnostic(item as unknown as Readonly<Record<string, unknown>>),
    )).toEqual(fixture.expectDiagnostics);
    expect(actual.valid).toBe(fixture.expectValid);
  });

  test("GE1422 covers both the absent and the forbidden direction", () => {
    for (const name of [
      "ge1422-kind-required-field-absent",
      "ge1422-kind-forbidden-field-present",
    ]) {
      const fixture = compilerCase(name);
      const actual = diagnostics(fixture.graph);
      expect(actual.map((item) => item.code), name)
        .toEqual(["GE1422_BARRIER_POLICY_KIND_MISMATCH"]);
      expect(actual[0]?.path, name).toBe("#/nodes/3/config/minimum");
    }
    // The two directions really are different configs: one omits the member the
    // kind requires, the other carries a member the kind forbids.
    expect(compilerCase("ge1422-kind-required-field-absent").graph.nodes[3]?.config)
      .not.toEqual(compilerCase("ge1422-kind-forbidden-field-present").graph.nodes[3]?.config);
  });

  test("GE1421 suppresses GE1422 and GE1424 on its own node only", () => {
    const fixture = compilerCase("ge1421-suppresses-ge1422-and-ge1424-on-the-same-node-only");
    expect(diagnostics(fixture.graph).map((item) => [item.code, item.nodeIds?.[0]])).toEqual([
      ["GE1421_INVALID_BARRIER_POLICY", "gate-bad"],
      ["GE1422_BARRIER_POLICY_KIND_MISMATCH", "gate-other"],
    ]);
  });

  test("GE1422 suppresses GE1424 on the same node", () => {
    expect(codes(compilerCase("ge1422-suppresses-ge1424-on-the-same-node").graph))
      .toEqual(["GE1422_BARRIER_POLICY_KIND_MISMATCH"]);
  });

  test("GE1421 does not suppress GE1423 on the same node", () => {
    expect(codes(compilerCase("ge1421-does-not-suppress-ge1423-on-the-same-node").graph))
      .toEqual(["GE1421_INVALID_BARRIER_POLICY", "GE1423_BARRIER_NO_INPUTS"]);
  });

  test("the router pass emits before the barrier pass", () => {
    expect(codes(compilerCase("router-pass-emits-before-the-barrier-pass").graph))
      .toEqual(["GE1401_INVALID_ROUTER_POLICY", "GE1421_INVALID_BARRIER_POLICY"]);
  });

  test("a legacy barrier config beside a claimed one is left untouched", () => {
    for (const name of [
      "legacy-barrier-config-is-untouched-beside-a-claimed-policy",
      "empty-legacy-barrier-config-emits-nothing",
    ]) {
      const fixture = compilerCase(name);
      const legacyIds = fixture.graph.nodes
        .filter((node) => node.kind === "barrier" && !claimsIntegratedBarrierPolicy(node.config))
        .map((node) => node.id);
      expect(legacyIds.length, name).toBeGreaterThan(0);
      for (const diagnostic of diagnostics(fixture.graph)) {
        expect(diagnostic.nodeIds ?? [], `${name}:${diagnostic.code}`)
          .not.toEqual(expect.arrayContaining(legacyIds));
      }
    }
  });

  test("non-barrier configs are never interpreted as barrier policies", () => {
    const document = probeGraph({
      apiVersion: INTEGRATED_BARRIER_API_VERSION,
      kind: "all",
      onUnsatisfied: "fail",
      lateArrival: "ignore",
      extra: true,
    });
    expect(codes(document)).toEqual(["GE1421_INVALID_BARRIER_POLICY"]);
    (document.nodes[3] as { kind: string }).kind = "transform";
    expect(codes(document)).toEqual([]);
  });

  test("Graph envelope owns non-portable barrier configs before GE1421", () => {
    let invoked = false;
    const config = {
      apiVersion: INTEGRATED_BARRIER_API_VERSION,
      onUnsatisfied: "fail",
      lateArrival: "ignore",
    };
    Object.defineProperty(config, "kind", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "all";
      },
    });
    const document = clone(OWNERSHIP_PROBE);
    (document.nodes[3] as { config: unknown }).config = config;
    expect(codes(document)).toEqual(["GE1007_INVALID_GRAPH"]);
    expect(invoked).toBe(false);
  });

  test("the barrier pass does not suppress the later strict typed-port pass", () => {
    const document = probeGraph({
      apiVersion: INTEGRATED_BARRIER_API_VERSION,
      kind: "all",
      onUnsatisfied: "fail",
      lateArrival: "ignore",
      extra: true,
    });
    document.policies = {
      "graphengineering.reacher-z.github.io/typed-ports": {
        apiVersion: "graphengineering.reacher-z.github.io/typed-ports/v1alpha1",
        mode: "strict",
      },
    } as unknown as GraphSpec["policies"];
    const actual = codes(document);
    expect(actual[0]).toBe("GE1421_INVALID_BARRIER_POLICY");
    expect(actual.filter((code) => code.startsWith("GE12")).length).toBeGreaterThan(0);
  });
});
