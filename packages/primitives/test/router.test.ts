import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PrimitiveValidationError,
  evaluateRouteSelection,
  type PrimitiveValidationIssue,
  type RouteSelectionPolicy,
  type RouteSelectionRequest,
  type RouteSelectionResult,
} from "../src/index.js";

interface RouteCases {
  validCases: {
    name: string;
    request: RouteSelectionRequest;
    policy: RouteSelectionPolicy;
    expect: RouteSelectionResult;
  }[];
  invalidCases: {
    name: string;
    request: unknown;
    policy: unknown;
    issues: PrimitiveValidationIssue[];
  }[];
}

function packageFixture(): RouteCases {
  const path = fileURLToPath(new URL("./fixtures/route-selection.cases.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as RouteCases;
}

function sharedFixture(): RouteCases["validCases"] {
  const path = fileURLToPath(
    new URL("../../../spec/conformance/route-selection.case.json", import.meta.url),
  );
  return (JSON.parse(readFileSync(path, "utf8")) as { cases: RouteCases["validCases"] }).cases;
}

function invalid(request: unknown, policy: unknown): PrimitiveValidationError {
  try {
    evaluateRouteSelection(request as RouteSelectionRequest, policy as RouteSelectionPolicy);
  } catch (error) {
    if (error instanceof PrimitiveValidationError) return error;
    throw error;
  }
  throw new Error("expected PrimitiveValidationError");
}

function singlePolicy(overrides: Record<string, unknown> = {}): RouteSelectionPolicy {
  return {
    kind: "single",
    allowedRoutes: ["quick", "audit", "human"],
    ...overrides,
  } as RouteSelectionPolicy;
}

function multiPolicy(overrides: Record<string, unknown> = {}): RouteSelectionPolicy {
  return {
    kind: "multi",
    allowedRoutes: ["quick", "audit", "human"],
    maxMulticast: 2,
    ...overrides,
  } as RouteSelectionPolicy;
}

class CustomValue {
  readonly value = true;
}

describe("evaluateRouteSelection state machine", () => {
  it.each(packageFixture().validCases)("passes package fixture: $name", (testCase) => {
    const result = evaluateRouteSelection(testCase.request, testCase.policy);
    expect(result).toEqual(testCase.expect);
    expect(result.routed).toBe(result.selectedRoutes.length > 0);
  });

  it.each(sharedFixture())("passes shared conformance fixture: $name", (testCase) => {
    const result = evaluateRouteSelection(testCase.request, testCase.policy);
    expect(result).toEqual(testCase.expect);
    expect(result.routed).toBe(result.selectedRoutes.length > 0);
  });

  it.each([
    {
      name: "empty",
      request: { requestedRoutes: [], confidenceBasisPoints: 0 },
      policy: singlePolicy({
        defaultRoute: "quick",
        confidence: { minimumBasisPoints: 7000, escalationRoute: "human" },
      }),
      unknownRoutes: [],
    },
    {
      name: "unknown",
      request: { requestedRoutes: ["invented"], confidenceBasisPoints: 0 },
      policy: singlePolicy({
        defaultRoute: "quick",
        confidence: { minimumBasisPoints: 7000, escalationRoute: "human" },
      }),
      unknownRoutes: ["invented"],
    },
    {
      name: "single count violation",
      request: { requestedRoutes: ["quick", "audit"], confidenceBasisPoints: 0 },
      policy: singlePolicy({
        defaultRoute: "quick",
        confidence: { minimumBasisPoints: 7000, escalationRoute: "human" },
      }),
      unknownRoutes: [],
    },
    {
      name: "multicast violation",
      request: {
        requestedRoutes: ["quick", "audit", "invented"],
        confidenceBasisPoints: 0,
      },
      policy: multiPolicy({
        defaultRoute: "quick",
        confidence: { minimumBasisPoints: 7000, escalationRoute: "human" },
      }),
      unknownRoutes: ["invented"],
    },
  ])("low confidence safely precedes $name", ({ request, policy, unknownRoutes }) => {
    expect(evaluateRouteSelection(request, policy)).toEqual({
      routed: true,
      reasonCode: "ESCALATION_SELECTED_LOW_CONFIDENCE",
      requestedRoutes: request.requestedRoutes,
      selectedRoutes: ["human"],
      unknownRoutes,
      confidenceBasisPoints: 0,
      usedDefault: false,
      escalated: true,
    });
  });

  it("treats confidence equal to threshold as normal selection", () => {
    expect(
      evaluateRouteSelection(
        { requestedRoutes: ["audit"], confidenceBasisPoints: 7000 },
        singlePolicy({ confidence: { minimumBasisPoints: 7000, escalationRoute: "human" } }),
      ),
    ).toMatchObject({
      reasonCode: "REQUESTED_ROUTES_SELECTED",
      selectedRoutes: ["audit"],
      escalated: false,
    });
  });

  it("normalizes negative-zero confidence in the portable result snapshot", () => {
    const result = evaluateRouteSelection(
      { requestedRoutes: ["audit"], confidenceBasisPoints: -0 },
      singlePolicy({ confidence: { minimumBasisPoints: 1, escalationRoute: "human" } }),
    );
    expect(result.confidenceBasisPoints).toBe(0);
    expect(Object.is(result.confidenceBasisPoints, -0)).toBe(false);
  });

  it("accepts a mathematically integral 1.0 Number on the integer wire", () => {
    const result = evaluateRouteSelection(
      { requestedRoutes: ["audit"], confidenceBasisPoints: 1.0 },
      singlePolicy({ confidence: { minimumBasisPoints: 1.0, escalationRoute: "human" } }),
    );
    expect(result).toMatchObject({
      reasonCode: "REQUESTED_ROUTES_SELECTED",
      selectedRoutes: ["audit"],
      confidenceBasisPoints: 1,
      escalated: false,
    });
  });

  it("handles the 1 and 10000 confidence-threshold boundaries exactly", () => {
    expect(
      evaluateRouteSelection(
        { requestedRoutes: ["audit"], confidenceBasisPoints: 0 },
        singlePolicy({ confidence: { minimumBasisPoints: 1, escalationRoute: "human" } }),
      ).reasonCode,
    ).toBe("ESCALATION_SELECTED_LOW_CONFIDENCE");
    expect(
      evaluateRouteSelection(
        { requestedRoutes: ["audit"], confidenceBasisPoints: 9999 },
        singlePolicy({ confidence: { minimumBasisPoints: 10_000, escalationRoute: "human" } }),
      ).reasonCode,
    ).toBe("ESCALATION_SELECTED_LOW_CONFIDENCE");
    expect(
      evaluateRouteSelection(
        { requestedRoutes: ["audit"], confidenceBasisPoints: 10_000 },
        singlePolicy({ confidence: { minimumBasisPoints: 10_000, escalationRoute: "human" } }),
      ).reasonCode,
    ).toBe("REQUESTED_ROUTES_SELECTED");
  });

  it("retains unknown request order while using the whole-request default", () => {
    const result = evaluateRouteSelection(
      { requestedRoutes: ["unknown-z", "quick", "unknown-a"] },
      multiPolicy({ defaultRoute: "human", maxMulticast: 3 }),
    );
    expect(result).toMatchObject({
      reasonCode: "DEFAULT_SELECTED_UNKNOWN_ROUTE",
      requestedRoutes: ["unknown-z", "quick", "unknown-a"],
      selectedRoutes: ["human"],
      unknownRoutes: ["unknown-z", "unknown-a"],
      usedDefault: true,
    });
  });

  it("never chooses the first allowed route as an implicit default", () => {
    expect(evaluateRouteSelection({ requestedRoutes: [] }, singlePolicy())).toMatchObject({
      routed: false,
      reasonCode: "NO_REQUESTED_ROUTE",
      selectedRoutes: [],
    });
    expect(
      evaluateRouteSelection({ requestedRoutes: ["invented"] }, singlePolicy()),
    ).toMatchObject({ routed: false, reasonCode: "UNKNOWN_ROUTE", selectedRoutes: [] });
  });

  it("checks single count before allowing an unknown-route default", () => {
    expect(
      evaluateRouteSelection(
        { requestedRoutes: ["quick", "invented"] },
        singlePolicy({ defaultRoute: "human" }),
      ),
    ).toMatchObject({
      routed: false,
      reasonCode: "MULTIPLE_ROUTES_FOR_SINGLE",
      usedDefault: false,
      unknownRoutes: ["invented"],
    });
  });

  it("checks multicast count before allowing an unknown-route default", () => {
    expect(
      evaluateRouteSelection(
        { requestedRoutes: ["quick", "audit", "invented"] },
        multiPolicy({ defaultRoute: "human", maxMulticast: 2 }),
      ),
    ).toMatchObject({
      routed: false,
      reasonCode: "MULTICAST_LIMIT_EXCEEDED",
      usedDefault: false,
      unknownRoutes: ["invented"],
    });
  });
});

describe("evaluateRouteSelection request validation", () => {
  it.each([null, [], new CustomValue()])("rejects non-plain request %#", (request) => {
    expect(invalid(request, singlePolicy()).issues[0]).toMatchObject({
      path: "#/request",
      code: "TYPE",
    });
  });

  it("rejects request unknown and symbol fields in deterministic order", () => {
    const request = { requestedRoutes: [], z: true, a: true, [Symbol("field")]: true };
    expect(invalid(request, singlePolicy()).issues.slice(0, 3)).toEqual([
      { path: "#/request/a", code: "UNKNOWN_FIELD", message: "unknown field" },
      { path: "#/request/z", code: "UNKNOWN_FIELD", message: "unknown field" },
      { path: "#/request", code: "UNKNOWN_FIELD", message: "symbol fields are not supported" },
    ]);
  });

  it("escapes unknown request and array field names as RFC 6901 segments", () => {
    const request = { requestedRoutes: [], "a/b": true, "x~y": true };
    expect(invalid(request, singlePolicy()).issues.slice(0, 2)).toEqual([
      { path: "#/request/a~1b", code: "UNKNOWN_FIELD", message: "unknown field" },
      { path: "#/request/x~0y", code: "UNKNOWN_FIELD", message: "unknown field" },
    ]);

    const routes = ["quick"] as string[] & Record<string, unknown>;
    routes["a/b"] = true;
    routes["x~y"] = true;
    expect(invalid({ requestedRoutes: routes }, singlePolicy()).issues.slice(0, 2)).toEqual([
      {
        path: "#/request/requestedRoutes/a~1b",
        code: "UNKNOWN_FIELD",
        message: "unknown array field",
      },
      {
        path: "#/request/requestedRoutes/x~0y",
        code: "UNKNOWN_FIELD",
        message: "unknown array field",
      },
    ]);
  });

  it("requires requestedRoutes as an enumerable data field", () => {
    expect(invalid({}, singlePolicy()).issues[0]).toMatchObject({
      path: "#/request/requestedRoutes",
      code: "REQUIRED",
    });
    const request: Record<string, unknown> = {};
    Object.defineProperty(request, "requestedRoutes", { value: [], enumerable: false });
    expect(invalid(request, singlePolicy()).issues[0]).toMatchObject({
      path: "#/request/requestedRoutes",
      code: "TYPE",
    });
  });

  it("rejects non-array, sparse, and extended requestedRoutes arrays", () => {
    expect(invalid({ requestedRoutes: "quick" }, singlePolicy()).issues[0]).toMatchObject({
      path: "#/request/requestedRoutes",
      code: "TYPE",
    });
    const sparse = new Array(2);
    sparse[1] = "quick";
    expect(invalid({ requestedRoutes: sparse }, singlePolicy()).issues[0]).toMatchObject({
      path: "#/request/requestedRoutes/0",
      code: "TYPE",
    });
    const extended = ["quick"] as string[] & { extra?: boolean };
    extended.extra = true;
    expect(invalid({ requestedRoutes: extended }, singlePolicy()).issues[0]).toMatchObject({
      path: "#/request/requestedRoutes/extra",
      code: "UNKNOWN_FIELD",
    });
  });

  it.each(["../escape", ".", "..", "has space", "a".repeat(129), 42])(
    "rejects unsafe requested route %#",
    (route) => {
      expect(invalid({ requestedRoutes: [route] }, singlePolicy()).issues[0]).toMatchObject({
        path: "#/request/requestedRoutes/0",
        code: "UNSAFE_ID",
      });
    },
  );

  it("rejects duplicate selections exactly without case folding", () => {
    expect(invalid({ requestedRoutes: ["audit", "audit"] }, singlePolicy()).issues[0]).toEqual({
      path: "#/request/requestedRoutes/1",
      code: "DUPLICATE_SELECTION",
      message: "duplicate requested route 'audit'",
    });
    expect(() =>
      evaluateRouteSelection({ requestedRoutes: ["audit", "Audit"] }, multiPolicy()),
    ).not.toThrow();
  });

  it.each([-1, 10_001, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "rejects invalid request confidence %#",
    (confidenceBasisPoints) => {
      expect(
        invalid(
          { requestedRoutes: ["audit"], confidenceBasisPoints },
          singlePolicy({ confidence: { minimumBasisPoints: 1, escalationRoute: "human" } }),
        ).issues[0],
      ).toMatchObject({ path: "#/request/confidenceBasisPoints", code: "INVALID_CONFIDENCE" });
    },
  );

  it("requires confidence request and policy configuration to appear together", () => {
    expect(
      invalid(
        { requestedRoutes: ["audit"], confidenceBasisPoints: 5000 },
        singlePolicy(),
      ).issues.at(-1),
    ).toMatchObject({ code: "CONFIDENCE_CONFIGURATION" });
    expect(
      invalid(
        { requestedRoutes: ["audit"] },
        singlePolicy({ confidence: { minimumBasisPoints: 5000, escalationRoute: "human" } }),
      ).issues.at(-1),
    ).toMatchObject({ code: "CONFIDENCE_CONFIGURATION" });
  });
});

describe("evaluateRouteSelection policy validation", () => {
  it.each([null, [], new CustomValue()])("rejects non-plain policy %#", (policy) => {
    expect(invalid({ requestedRoutes: [] }, policy).issues[0]).toMatchObject({
      path: "#/policy",
      code: "TYPE",
    });
  });

  it("rejects top-level policy unknown fields", () => {
    expect(invalid({ requestedRoutes: [] }, singlePolicy({ extra: true })).issues[0]).toEqual({
      path: "#/policy/extra",
      code: "UNKNOWN_FIELD",
      message: "unknown field",
    });
  });

  it("requires a valid policy kind", () => {
    expect(
      invalid({ requestedRoutes: [] }, { allowedRoutes: ["quick"] }).issues[0],
    ).toMatchObject({ path: "#/policy/kind", code: "REQUIRED" });
    expect(
      invalid({ requestedRoutes: [] }, { kind: "broadcast", allowedRoutes: ["quick"] }).issues[0],
    ).toMatchObject({ path: "#/policy/kind", code: "INVALID_POLICY" });
  });

  it("requires a non-empty allowedRoutes array", () => {
    expect(invalid({ requestedRoutes: [] }, { kind: "single" }).issues[0]).toMatchObject({
      path: "#/policy/allowedRoutes",
      code: "REQUIRED",
    });
    expect(
      invalid({ requestedRoutes: [] }, { kind: "single", allowedRoutes: "quick" }).issues[0],
    ).toMatchObject({ path: "#/policy/allowedRoutes", code: "TYPE" });
    expect(
      invalid({ requestedRoutes: [] }, { kind: "single", allowedRoutes: [] }).issues[0],
    ).toMatchObject({ path: "#/policy/allowedRoutes", code: "INVALID_POLICY" });
  });

  it.each(["../escape", ".", "..", "bad route", "a".repeat(129)])(
    "rejects unsafe allowed route %j",
    (route) => {
      expect(
        invalid(
          { requestedRoutes: [] },
          { kind: "single", allowedRoutes: [route] },
        ).issues[0],
      ).toMatchObject({ path: "#/policy/allowedRoutes/0", code: "UNSAFE_ID" });
    },
  );

  it("rejects duplicate allowed routes", () => {
    expect(
      invalid(
        { requestedRoutes: [] },
        { kind: "single", allowedRoutes: ["quick", "quick"] },
      ).issues[0],
    ).toEqual({
      path: "#/policy/allowedRoutes/1",
      code: "DUPLICATE_ID",
      message: "duplicate allowed route 'quick'",
    });
  });

  it("requires defaultRoute to be safe and declared", () => {
    expect(
      invalid({ requestedRoutes: [] }, singlePolicy({ defaultRoute: "../escape" })).issues[0],
    ).toMatchObject({ path: "#/policy/defaultRoute", code: "UNSAFE_ID" });
    expect(
      invalid({ requestedRoutes: [] }, singlePolicy({ defaultRoute: "undeclared" })).issues[0],
    ).toMatchObject({ path: "#/policy/defaultRoute", code: "INVALID_POLICY" });
  });

  it("requires confidence to be a closed object", () => {
    expect(
      invalid({ requestedRoutes: [] }, singlePolicy({ confidence: null })).issues[0],
    ).toMatchObject({ path: "#/policy/confidence", code: "INVALID_POLICY" });
    expect(
      invalid(
        { requestedRoutes: [], confidenceBasisPoints: 1 },
        singlePolicy({
          confidence: { minimumBasisPoints: 1, escalationRoute: "human", extra: true },
        }),
      ).issues,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNKNOWN_FIELD" })]));
  });

  it("requires both confidence policy fields", () => {
    expect(
      invalid(
        { requestedRoutes: [], confidenceBasisPoints: 1 },
        singlePolicy({ confidence: { escalationRoute: "human" } }),
      ).issues,
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "#/policy/confidence/minimumBasisPoints", code: "REQUIRED" }),
    ]));
    expect(
      invalid(
        { requestedRoutes: [], confidenceBasisPoints: 1 },
        singlePolicy({ confidence: { minimumBasisPoints: 1 } }),
      ).issues,
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "#/policy/confidence/escalationRoute", code: "REQUIRED" }),
    ]));
  });

  it.each([0, 10_001, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "rejects invalid minimum confidence %#",
    (minimumBasisPoints) => {
      expect(
        invalid(
          { requestedRoutes: [], confidenceBasisPoints: 1 },
          singlePolicy({ confidence: { minimumBasisPoints, escalationRoute: "human" } }),
        ).issues,
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: "#/policy/confidence/minimumBasisPoints",
          code: "INVALID_CONFIDENCE",
        }),
      ]));
    },
  );

  it("requires escalationRoute to be safe and declared", () => {
    expect(
      invalid(
        { requestedRoutes: [], confidenceBasisPoints: 1 },
        singlePolicy({ confidence: { minimumBasisPoints: 1, escalationRoute: "../escape" } }),
      ).issues,
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "#/policy/confidence/escalationRoute", code: "UNSAFE_ID" }),
    ]));
    expect(
      invalid(
        { requestedRoutes: [], confidenceBasisPoints: 1 },
        singlePolicy({ confidence: { minimumBasisPoints: 1, escalationRoute: "undeclared" } }),
      ).issues,
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "#/policy/confidence/escalationRoute", code: "INVALID_POLICY" }),
    ]));
  });

  it("forbids maxMulticast on single and requires it on multi", () => {
    expect(
      invalid({ requestedRoutes: [] }, singlePolicy({ maxMulticast: 1 })).issues.at(-1),
    ).toMatchObject({ path: "#/policy/maxMulticast", code: "INVALID_POLICY" });
    expect(
      invalid(
        { requestedRoutes: [] },
        { kind: "multi", allowedRoutes: ["quick", "audit"] },
      ).issues.at(-1),
    ).toMatchObject({ path: "#/policy/maxMulticast", code: "REQUIRED" });
  });

  it.each([0, 4, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid maxMulticast %#",
    (maxMulticast) => {
      expect(
        invalid({ requestedRoutes: [] }, multiPolicy({ maxMulticast })).issues.at(-1),
      ).toMatchObject({ path: "#/policy/maxMulticast", code: "INVALID_POLICY" });
    },
  );
});

describe("route selection validation safety and immutability", () => {
  it("matches the package ordered invalid fixture", () => {
    for (const testCase of packageFixture().invalidCases) {
      expect(invalid(testCase.request, testCase.policy).issues).toEqual(testCase.issues);
    }
  });

  it("never executes request, array, policy, or nested confidence accessors", () => {
    let calls = 0;
    const getter = () => {
      calls += 1;
      return [];
    };

    const request: Record<string, unknown> = {};
    Object.defineProperty(request, "requestedRoutes", { enumerable: true, get: getter });
    invalid(request, singlePolicy());

    const routes: string[] = [];
    Object.defineProperty(routes, "0", { enumerable: true, get: getter });
    routes.length = 1;
    invalid({ requestedRoutes: routes }, singlePolicy());

    const policy: Record<string, unknown> = { allowedRoutes: ["quick"] };
    Object.defineProperty(policy, "kind", { enumerable: true, get: getter });
    invalid({ requestedRoutes: [] }, policy);

    const confidence: Record<string, unknown> = { escalationRoute: "human" };
    Object.defineProperty(confidence, "minimumBasisPoints", { enumerable: true, get: getter });
    invalid(
      { requestedRoutes: [], confidenceBasisPoints: 1 },
      singlePolicy({ confidence }),
    );
    expect(calls).toBe(0);
  });

  it("converts hostile proxy traps into structured errors without a cause", () => {
    const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error("secret"); } });
    const error = invalid(hostile, singlePolicy());
    expect(error.issues).toEqual([
      { path: "#", code: "TYPE", message: "route selection input could not be inspected safely" },
    ]);
    expect(error.cause).toBeUndefined();
  });

  it("returns detached deeply frozen output and enforces routed invariant", () => {
    const requestedRoutes = ["audit", "quick"];
    const allowedRoutes = ["quick", "audit", "human"];
    const request = { requestedRoutes };
    const policy = { kind: "multi", allowedRoutes, maxMulticast: 2 } as const;
    const result = evaluateRouteSelection(request, policy);
    requestedRoutes.reverse();
    allowedRoutes.reverse();

    expect(result.requestedRoutes).toEqual(["audit", "quick"]);
    expect(result.selectedRoutes).toEqual(["quick", "audit"]);
    expect(result.routed).toBe(result.selectedRoutes.length > 0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.requestedRoutes)).toBe(true);
    expect(Object.isFrozen(result.selectedRoutes)).toBe(true);
    expect(Object.isFrozen(result.unknownRoutes)).toBe(true);
    expect(() => (result.selectedRoutes as string[]).push("later")).toThrow(TypeError);
  });

  it("uses the route-specific error message and stable JSON projection", () => {
    const request = { requestedRoutes: ["audit", "audit"] };
    const error = invalid(request, singlePolicy());
    request.requestedRoutes[1] = "quick";
    expect(error.toJSON()).toEqual({
      name: "PrimitiveValidationError",
      code: "PRIMITIVE_VALIDATION",
      message: "Route selection input is invalid",
      issues: [
        {
          path: "#/request/requestedRoutes/1",
          code: "DUPLICATE_SELECTION",
          message: "duplicate requested route 'audit'",
        },
      ],
    });
    expect(Object.isFrozen(error.issues)).toBe(true);
  });
});
