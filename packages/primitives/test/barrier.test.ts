import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PrimitiveValidationError,
  evaluateSettledBarrier,
  type PrimitiveValidationIssue,
  type SettledBarrierPolicy,
  type SettledBarrierResult,
  type SettledItem,
} from "../src/index.js";

const succeeded = (id: string, value: unknown = null): SettledItem =>
  ({ id, status: "succeeded", value } as SettledItem);
const failed = (id: string): SettledItem => ({ id, status: "failed" });
const missing = (id: string): SettledItem => ({ id, status: "missing" });
const timedOut = (id: string): SettledItem => ({ id, status: "timed_out" });

function invalid(items: unknown, policy: unknown = { kind: "all" }): PrimitiveValidationError {
  try {
    evaluateSettledBarrier(
      items as readonly SettledItem[],
      policy as SettledBarrierPolicy,
    );
  } catch (error) {
    if (error instanceof PrimitiveValidationError) return error;
    throw error;
  }
  throw new Error("expected PrimitiveValidationError");
}

function cyclic(): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  value.self = value;
  return value;
}

class NonJsonValue {
  readonly value = 1;
}

interface BarrierCases {
  validCases: {
    name: string;
    items: SettledItem[];
    policy: SettledBarrierPolicy;
    expect: SettledBarrierResult;
  }[];
  invalidCases: {
    name: string;
    items: unknown;
    policy: unknown;
    issues: PrimitiveValidationIssue[];
  }[];
}

function fixture(): BarrierCases {
  const path = fileURLToPath(new URL("./fixtures/settled-barrier.cases.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as BarrierCases;
}

function sharedFixture(): BarrierCases["validCases"] {
  const path = fileURLToPath(
    new URL("../../../spec/conformance/settled-barrier.case.json", import.meta.url),
  );
  return (JSON.parse(readFileSync(path, "utf8")) as { cases: BarrierCases["validCases"] }).cases;
}

describe("evaluateSettledBarrier policies", () => {
  it.each([
    { kind: "all" } as const,
    { kind: "minimum", minimum: 1 } as const,
    { kind: "percentage", basisPoints: 1 } as const,
  ])("never treats an empty set as vacuous success for $kind", (policy) => {
    expect(evaluateSettledBarrier([], policy)).toMatchObject({
      satisfied: false,
      reasonCode: "NO_ITEMS",
      total: 0,
    });
  });

  it("satisfies all only when every item succeeded", () => {
    expect(evaluateSettledBarrier([succeeded("a", 1), succeeded("b", 2)], { kind: "all" }))
      .toMatchObject({ satisfied: true, reasonCode: "ALL_SUCCEEDED", succeeded: 2 });
    expect(evaluateSettledBarrier([succeeded("a", 1), failed("b")], { kind: "all" }))
      .toMatchObject({ satisfied: false, reasonCode: "ALL_NOT_SUCCEEDED" });
  });

  it("meets minimum at its exact integer boundary", () => {
    expect(evaluateSettledBarrier([succeeded("a"), failed("b")], { kind: "minimum", minimum: 1 }))
      .toMatchObject({ satisfied: true, reasonCode: "MINIMUM_MET" });
  });

  it("reports a reachable minimum that was not met", () => {
    expect(evaluateSettledBarrier([succeeded("a"), failed("b")], { kind: "minimum", minimum: 2 }))
      .toMatchObject({ satisfied: false, reasonCode: "MINIMUM_NOT_MET" });
  });

  it("treats minimum greater than total as valid but impossible", () => {
    expect(evaluateSettledBarrier([succeeded("a")], { kind: "minimum", minimum: 2 }))
      .toMatchObject({ satisfied: false, reasonCode: "MINIMUM_EXCEEDS_TOTAL" });
  });

  it("uses exact integer cross multiplication at 5000 basis points", () => {
    expect(
      evaluateSettledBarrier([succeeded("a"), failed("b")], {
        kind: "percentage",
        basisPoints: 5000,
      }),
    ).toMatchObject({ satisfied: true, reasonCode: "PERCENTAGE_MET" });
  });

  it("does not round 5001 basis points down to one half", () => {
    expect(
      evaluateSettledBarrier([succeeded("a"), failed("b")], {
        kind: "percentage",
        basisPoints: 5001,
      }),
    ).toMatchObject({ satisfied: false, reasonCode: "PERCENTAGE_NOT_MET" });
  });

  it("handles the one and ten-thousand basis-point boundaries", () => {
    expect(
      evaluateSettledBarrier([succeeded("a"), failed("b"), failed("c")], {
        kind: "percentage",
        basisPoints: 1,
      }).satisfied,
    ).toBe(true);
    expect(
      evaluateSettledBarrier([succeeded("a"), failed("b")], {
        kind: "percentage",
        basisPoints: 10_000,
      }).satisfied,
    ).toBe(false);
    expect(
      evaluateSettledBarrier([succeeded("a"), succeeded("b")], {
        kind: "percentage",
        basisPoints: 10_000,
      }).satisfied,
    ).toBe(true);
  });

  it("preserves declaration order independently in every category", () => {
    const result = evaluateSettledBarrier(
      [
        failed("f-2"),
        succeeded("s-2"),
        missing("m-1"),
        timedOut("t-2"),
        failed("f-1"),
        succeeded("s-1"),
        timedOut("t-1"),
      ],
      { kind: "minimum", minimum: 2 },
    );
    expect(result).toEqual({
      satisfied: true,
      reasonCode: "MINIMUM_MET",
      total: 7,
      succeeded: 2,
      failed: 2,
      missing: 1,
      timedOut: 2,
      acceptedIds: ["s-2", "s-1"],
      failedIds: ["f-2", "f-1"],
      missingIds: ["m-1"],
      timedOutIds: ["t-2", "t-1"],
    });
  });

  it.each(fixture().validCases)("passes deterministic fixture: $name", (testCase) => {
    expect(evaluateSettledBarrier(testCase.items, testCase.policy)).toEqual(testCase.expect);
  });

  it.each(sharedFixture())("passes shared conformance fixture: $name", (testCase) => {
    expect(evaluateSettledBarrier(testCase.items, testCase.policy)).toEqual(testCase.expect);
  });
});

describe("evaluateSettledBarrier validation", () => {
  it("rejects a non-array item collection with a structured issue", () => {
    expect(invalid(null).issues).toEqual([
      { path: "#/items", code: "TYPE", message: "expected an item array" },
    ]);
  });

  it("rejects null and class item objects", () => {
    expect(invalid([null]).issues[0]).toMatchObject({ path: "#/items/0", code: "TYPE" });
    expect(invalid([new NonJsonValue()]).issues[0]).toMatchObject({
      path: "#/items/0",
      code: "TYPE",
    });
  });

  it("rejects sparse item arrays without iterating invented entries", () => {
    const items = new Array(2) as SettledItem[];
    items[1] = failed("present");
    expect(invalid(items).issues[0]).toEqual({
      path: "#/items/0",
      code: "TYPE",
      message: "sparse item slots are not supported",
    });
  });

  it("bounds validation work for a huge sparse item array", () => {
    const items = [] as SettledItem[];
    items.length = 0xffff_ffff;
    items[0xffff_fffe] = failed("last");
    expect(invalid(items).issues[0]).toMatchObject({
      path: "#/items/0",
      code: "TYPE",
    });
  });

  it("rejects caller-defined fields on the item array itself", () => {
    const items = [failed("a")] as SettledItem[] & { extra?: boolean };
    items.extra = true;
    expect(invalid(items).issues[0]).toEqual({
      path: "#/items/extra",
      code: "UNKNOWN_FIELD",
      message: "unknown array field",
    });
  });

  it("escapes unknown item-array and object field names as RFC 6901 segments", () => {
    const items = [failed("a")] as SettledItem[] & Record<string, unknown>;
    items["a/b"] = true;
    items["x~y"] = true;
    expect(invalid(items).issues.slice(0, 2)).toEqual([
      { path: "#/items/a~1b", code: "UNKNOWN_FIELD", message: "unknown array field" },
      { path: "#/items/x~0y", code: "UNKNOWN_FIELD", message: "unknown array field" },
    ]);

    const item = { id: "a", status: "failed", "a/b": true, "x~y": true };
    expect(invalid([item]).issues.slice(0, 2)).toEqual([
      { path: "#/items/0/a~1b", code: "UNKNOWN_FIELD", message: "unknown field" },
      { path: "#/items/0/x~0y", code: "UNKNOWN_FIELD", message: "unknown field" },
    ]);
  });

  it("rejects JSON-invisible non-enumerable item slots and fields", () => {
    const hiddenSlot: SettledItem[] = [];
    Object.defineProperty(hiddenSlot, "0", {
      value: succeeded("hidden", { accepted: true }),
      enumerable: false,
    });
    expect(Object.keys(hiddenSlot)).toEqual([]);
    expect(invalid(hiddenSlot).issues[0]).toMatchObject({ path: "#/items/0", code: "TYPE" });

    const hiddenId: Record<string, unknown> = { status: "failed" };
    Object.defineProperty(hiddenId, "id", { value: "hidden", enumerable: false });
    expect(invalid([hiddenId]).issues[0]).toMatchObject({ path: "#/items/0/id", code: "TYPE" });

    const hiddenStatus: Record<string, unknown> = { id: "hidden" };
    Object.defineProperty(hiddenStatus, "status", { value: "failed", enumerable: false });
    expect(invalid([hiddenStatus]).issues[0]).toMatchObject({
      path: "#/items/0/status",
      code: "TYPE",
    });

    const hiddenValue: Record<string, unknown> = { id: "hidden", status: "succeeded" };
    Object.defineProperty(hiddenValue, "value", { value: { accepted: true }, enumerable: false });
    expect(invalid([hiddenValue]).issues[0]).toMatchObject({
      path: "#/items/0/value",
      code: "INVALID_JSON",
    });
  });

  it("rejects JSON-invisible non-enumerable policy fields", () => {
    const hiddenKind: Record<string, unknown> = {};
    Object.defineProperty(hiddenKind, "kind", { value: "all", enumerable: false });
    expect(invalid([failed("a")], hiddenKind).issues[0]).toMatchObject({
      path: "#/policy/kind",
      code: "INVALID_POLICY",
    });

    const hiddenMinimum: Record<string, unknown> = { kind: "minimum" };
    Object.defineProperty(hiddenMinimum, "minimum", { value: 1, enumerable: false });
    expect(invalid([failed("a")], hiddenMinimum).issues[0]).toMatchObject({
      path: "#/policy/minimum",
      code: "INVALID_POLICY",
    });

    const hiddenBasisPoints: Record<string, unknown> = { kind: "percentage" };
    Object.defineProperty(hiddenBasisPoints, "basisPoints", { value: 5000, enumerable: false });
    expect(invalid([failed("a")], hiddenBasisPoints).issues[0]).toMatchObject({
      path: "#/policy/basisPoints",
      code: "INVALID_POLICY",
    });
  });

  it("rejects item unknown fields", () => {
    expect(invalid([{ id: "a", status: "failed", extra: true }]).issues[0]).toEqual({
      path: "#/items/0/extra",
      code: "UNKNOWN_FIELD",
      message: "unknown field",
    });
  });

  it.each(["../escape", ".", "..", " space", "a".repeat(129)])(
    "rejects unsafe id %j",
    (id) => {
      expect(invalid([{ id, status: "failed" }]).issues[0]).toMatchObject({
        path: "#/items/0/id",
        code: "UNSAFE_ID",
      });
    },
  );

  it("rejects non-string and duplicate IDs by exact equality", () => {
    expect(invalid([{ id: 1, status: "failed" }]).issues[0]).toMatchObject({ code: "UNSAFE_ID" });
    expect(invalid([failed("A"), failed("A")]).issues[0]).toEqual({
      path: "#/items/1/id",
      code: "DUPLICATE_ID",
      message: "duplicate id 'A'",
    });
    expect(() => evaluateSettledBarrier([failed("A"), failed("a")], { kind: "all" })).not.toThrow();
  });

  it("rejects missing IDs/statuses and unknown statuses in fixed field order", () => {
    expect(invalid([{}]).issues.map(({ path, code }) => [path, code])).toEqual([
      ["#/items/0/id", "REQUIRED"],
      ["#/items/0/status", "REQUIRED"],
    ]);
    expect(invalid([{ id: "a", status: "pending" }]).issues[0]).toMatchObject({
      path: "#/items/0/status",
      code: "INVALID_STATUS",
    });
  });

  it("requires succeeded values, including explicit null for no payload", () => {
    expect(invalid([{ id: "a", status: "succeeded" }]).issues[0]).toMatchObject({
      code: "STATUS_VALUE_MISMATCH",
    });
    expect(evaluateSettledBarrier([succeeded("a", null)], { kind: "all" }).satisfied).toBe(true);
  });

  it.each(["failed", "missing", "timed_out"] as const)(
    "forbids value on %s items",
    (status) => {
      expect(invalid([{ id: "a", status, value: null }]).issues[0]).toMatchObject({
        path: "#/items/0/value",
        code: "STATUS_VALUE_MISMATCH",
      });
    },
  );

  it.each([
    ["undefined", undefined],
    ["bigint", 1n],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["cycle", cyclic()],
    ["class instance", new NonJsonValue()],
  ])("rejects non-portable succeeded value: %s", (_name, value) => {
    const [issue] = invalid([{ id: "a", status: "succeeded", value }]).issues;
    expect(issue).toMatchObject({ code: "INVALID_JSON" });
    expect(issue?.path.startsWith("#/items/0/value")).toBe(true);
  });

  it("rejects sparse nested arrays and symbol keys", () => {
    const sparse = new Array(2);
    sparse[1] = true;
    expect(invalid([succeeded("a", sparse)]).issues[0]).toMatchObject({ code: "INVALID_JSON" });
    const symbolic = { okay: true, [Symbol("hidden")]: true };
    expect(invalid([succeeded("a", symbolic)]).issues[0]).toMatchObject({ code: "INVALID_JSON" });
  });

  it("rejects accessors without executing getter code", () => {
    let calls = 0;
    const getter = () => {
      calls += 1;
      return "must-not-run";
    };

    const idAccessor = { status: "failed" };
    Object.defineProperty(idAccessor, "id", { enumerable: true, get: getter });
    expect(invalid([idAccessor]).issues[0]).toMatchObject({ path: "#/items/0/id", code: "TYPE" });

    const valueAccessor = { id: "value-accessor", status: "succeeded" };
    Object.defineProperty(valueAccessor, "value", { enumerable: true, get: getter });
    expect(invalid([valueAccessor]).issues[0]).toMatchObject({
      path: "#/items/0/value",
      code: "INVALID_JSON",
    });

    const nestedAccessor: Record<string, unknown> = {};
    Object.defineProperty(nestedAccessor, "secret", { enumerable: true, get: getter });
    expect(invalid([succeeded("nested-accessor", nestedAccessor)]).issues[0]).toMatchObject({
      path: "#/items/0/value/secret",
      code: "INVALID_JSON",
    });

    const policyAccessor: Record<string, unknown> = {};
    Object.defineProperty(policyAccessor, "kind", { enumerable: true, get: getter });
    expect(invalid([failed("a")], policyAccessor).issues[0]).toMatchObject({
      path: "#/policy/kind",
      code: "INVALID_POLICY",
    });
    expect(calls).toBe(0);
  });

  it("allows repeated aliases and finite non-integer doubles", () => {
    const shared = { score: 1.25 };
    expect(() => evaluateSettledBarrier([succeeded("a", { left: shared, right: shared })], { kind: "all" }))
      .not.toThrow();
  });

  it("rejects additional policy fields for every exact policy shape", () => {
    for (const policy of [
      { kind: "all", minimum: 1 },
      { kind: "minimum", minimum: 1, basisPoints: 1 },
      { kind: "percentage", basisPoints: 1, minimum: 1 },
    ]) {
      expect(invalid([failed("a")], policy).issues[0]).toMatchObject({ code: "UNKNOWN_FIELD" });
    }
  });

  it("rejects missing and invalid minimum", () => {
    expect(invalid([failed("a")], { kind: "minimum" }).issues[0]).toMatchObject({ code: "REQUIRED" });
    for (const minimum of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(invalid([failed("a")], { kind: "minimum", minimum }).issues[0]).toMatchObject({
        path: "#/policy/minimum",
        code: "INVALID_POLICY",
      });
    }
  });

  it("rejects missing and out-of-range percentage basis points", () => {
    expect(invalid([failed("a")], { kind: "percentage" }).issues[0]).toMatchObject({ code: "REQUIRED" });
    for (const basisPoints of [0, 10_001, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(invalid([failed("a")], { kind: "percentage", basisPoints }).issues[0]).toMatchObject({
        path: "#/policy/basisPoints",
        code: "INVALID_POLICY",
      });
    }
  });

  it("rejects unknown, null, and class policy objects", () => {
    expect(invalid([failed("a")], { kind: "some" }).issues[0]).toMatchObject({
      path: "#/policy/kind",
      code: "INVALID_POLICY",
    });
    expect(invalid([failed("a")], null).issues[0]).toMatchObject({ path: "#/policy", code: "TYPE" });
    expect(invalid([failed("a")], new NonJsonValue()).issues[0]).toMatchObject({
      path: "#/policy",
      code: "TYPE",
    });
  });

  it.each(fixture().invalidCases)("matches ordered fixture issues: $name", (testCase) => {
    expect(invalid(testCase.items, testCase.policy).issues).toEqual(testCase.issues);
  });

  it("converts hostile inspection failures into structured errors", () => {
    const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error("do not leak"); } });
    const error = invalid([hostile]);
    expect(error).toMatchObject({ code: "PRIMITIVE_VALIDATION" });
    expect(error.issues).toEqual([
      { path: "#", code: "TYPE", message: "barrier input could not be inspected safely" },
    ]);
    expect(error.cause).toBeUndefined();
  });
});

describe("settled barrier immutability and serialization", () => {
  it("returns detached deeply frozen results", () => {
    const items = [succeeded("accepted", { score: 1 }), failed("rejected")];
    const policy = { kind: "minimum", minimum: 1 } as const;
    const result = evaluateSettledBarrier(items, policy);

    (items[0] as { id: string }).id = "changed";
    (policy as { minimum: number }).minimum = 2;
    expect(result.acceptedIds).toEqual(["accepted"]);
    expect(result.satisfied).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.acceptedIds)).toBe(true);
    expect(Object.isFrozen(result.failedIds)).toBe(true);
    expect(() => (result.acceptedIds as string[]).push("later")).toThrow(TypeError);
  });

  it("serializes errors without retaining mutable caller data", () => {
    const item = { id: "../unsafe", status: "failed" };
    const error = invalid([item]);
    item.id = "now-safe";
    const serialized = error.toJSON();
    expect(serialized).toEqual({
      name: "PrimitiveValidationError",
      code: "PRIMITIVE_VALIDATION",
      message: "Settled barrier input is invalid",
      issues: [{ path: "#/items/0/id", code: "UNSAFE_ID", message: "expected a safe identifier" }],
    });
    expect(Object.isFrozen(error.issues)).toBe(true);
    expect(Object.isFrozen(error.issues[0])).toBe(true);
    expect(Object.isFrozen(serialized)).toBe(true);
  });
});
