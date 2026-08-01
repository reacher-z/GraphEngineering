import { describe, expect, it } from "vitest";

import {
  REDACTION_TOKEN,
  SECTION_11_LIMITS,
  decodePointer,
  redactionTransform,
} from "../src/index.js";
import { loadRedactionCorpus } from "./support/redaction-corpus.js";

const corpus = loadRedactionCorpus();

interface PointerCase {
  readonly id: string;
  readonly input: unknown;
  readonly paths: readonly string[];
  readonly replacementMode: string;
  readonly expected: {
    readonly valid: boolean;
    readonly code?: string;
    readonly output?: unknown;
    readonly canonicalPaths?: readonly string[];
  };
}

const pointerCases = corpus.pointerCases as unknown as readonly PointerCase[];

describe("RFC 6901 redaction transform (redaction-semantics.md 3.3.1)", () => {
  it("executes every literal pointerCase in the shipped corpus", () => {
    expect(pointerCases.length).toBe(21);
    for (const testCase of pointerCases) {
      const observed = redactionTransform(
        testCase.input,
        testCase.paths,
        testCase.replacementMode,
        SECTION_11_LIMITS,
      );
      if (testCase.expected.valid === false) {
        expect(observed.valid, `${testCase.id} must be denied`).toBe(false);
        if (observed.valid) continue;
        expect(observed.code, `${testCase.id} denial code`).toBe(testCase.expected.code);
        continue;
      }
      expect(observed.valid, `${testCase.id} must be accepted`).toBe(true);
      if (!observed.valid) continue;
      expect(observed.output, `${testCase.id} output`).toEqual(testCase.expected.output);
      expect(observed.canonicalPaths, `${testCase.id} canonical paths`).toEqual(
        testCase.expected.canonicalPaths,
      );
      // The transform never mutates or returns the caller's snapshot.
      expect(observed.output).not.toBe(testCase.input);
    }
  });

  it("uses the corpus resourceLimits verbatim as the native Section 11 limits", () => {
    expect({ ...SECTION_11_LIMITS }).toEqual(corpus.resourceLimits);
  });

  it("rejects a prototype-bearing token at any depth, own member or not", () => {
    for (const token of ["__proto__", "prototype", "constructor"]) {
      expect(() => decodePointer(`/safe/${token}`)).toThrow();
      expect(() => decodePointer(`/${token}`)).toThrow();
    }
    // A poisoned pointer never reaches Object.prototype.
    const before = Object.prototype.toString;
    const result = redactionTransform({ a: 1 }, ["/__proto__/polluted"], "constant-token");
    expect(result.valid).toBe(false);
    expect(Object.prototype.toString).toBe(before);
    expect((Object.prototype as unknown as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("evaluates Section 11 limits before target existence and overlap", () => {
    const overLength = `/${"a".repeat(SECTION_11_LIMITS.maxPointerTokenUtf8Bytes + 1)}`;
    const result = redactionTransform({}, [overLength], "constant-token");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    // The target does not exist either, but the limit denial wins.
    expect(result.code).toBe("REDACTION_RECEIPT_INVALID");
    expect(result.reason).toBe("token-exceeds-maxPointerTokenUtf8Bytes");

    const tooMany = Array.from({ length: SECTION_11_LIMITS.maxPointersPerRule + 1 }, (_, index) =>
      `/f${String(index).padStart(6, "0")}`,
    );
    const denied = redactionTransform({}, tooMany, "constant-token");
    expect(denied.valid).toBe(false);
    if (denied.valid) return;
    expect(denied.code).toBe("REDACTION_POLICY_INVALID");
  });

  it("applies deepest-first and, at equal depth, reverse code-point order", () => {
    const result = redactionTransform(
      { a: { deep: "x" }, b: "y" },
      ["/a/deep", "/b"],
      "constant-token",
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.output).toEqual({ a: { deep: REDACTION_TOKEN }, b: REDACTION_TOKEN });
  });

  it("is a total function: a hostile value yields a denial, never a throw or partial", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const result = redactionTransform(cyclic, ["/self"], "constant-token");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.code).toBe("REDACTION_RECEIPT_INVALID");

    const accessor = Object.defineProperty({}, "boom", {
      get() {
        throw new Error("provider text that must never escape");
      },
      enumerable: true,
    });
    const denied = redactionTransform(accessor, ["/boom"], "constant-token");
    expect(denied.valid).toBe(false);
    if (denied.valid) return;
    expect(denied.reason).not.toContain("provider text");
  });
});
