import {
  PrimitiveValidationError,
  type PrimitiveValidationIssue,
  type PrimitiveValidationIssueCode,
} from "./errors.js";
import { compareUnicodeCodePoints } from "./json.js";
import type {
  RouteSelectionPolicy,
  RouteSelectionReasonCode,
  RouteSelectionRequest,
  RouteSelectionResult,
} from "./types.js";

const SAFE_ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REQUEST_FIELDS = new Set(["requestedRoutes", "confidenceBasisPoints"]);
const POLICY_FIELDS = new Set([
  "kind",
  "allowedRoutes",
  "defaultRoute",
  "confidence",
  "maxMulticast",
]);
const CONFIDENCE_FIELDS = new Set(["minimumBasisPoints", "escalationRoute"]);

interface DataProperty {
  present: boolean;
  valid: boolean;
  value?: unknown;
}

interface RequestSnapshot {
  requestedRoutes: readonly string[];
  confidenceBasisPoints: number | null;
  confidencePresent: boolean;
}

interface ConfidenceSnapshot {
  minimumBasisPoints: number;
  escalationRoute: string;
}

interface PolicySnapshot {
  kind: "single" | "multi";
  allowedRoutes: readonly string[];
  defaultRoute: string | null;
  confidence: Readonly<ConfidenceSnapshot> | null;
  confidencePresent: boolean;
  maxMulticast: number | null;
}

function addIssue(
  issues: PrimitiveValidationIssue[],
  path: string,
  code: PrimitiveValidationIssueCode,
  message: string,
): void {
  issues.push({ path, code, message });
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function unknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: PrimitiveValidationIssue[],
): void {
  for (const name of Object.getOwnPropertyNames(value).sort(compareUnicodeCodePoints)) {
    if (!allowed.has(name)) {
      addIssue(issues, `${path}/${pointerSegment(name)}`, "UNKNOWN_FIELD", "unknown field");
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    addIssue(issues, path, "UNKNOWN_FIELD", "symbol fields are not supported");
  }
}

function dataProperty(
  value: Record<string, unknown>,
  name: string,
  path: string,
  code: PrimitiveValidationIssueCode,
  issues: PrimitiveValidationIssue[],
): DataProperty {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (descriptor === undefined) return { present: false, valid: false };
  if (!Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
    addIssue(issues, path, code, "expected an enumerable data field");
    return { present: true, valid: false };
  }
  return { present: true, valid: true, value: descriptor.value };
}

function validRouteId(value: unknown): value is string {
  return typeof value === "string" &&
    SAFE_ROUTE_ID.test(value) &&
    value !== "." &&
    value !== "..";
}

interface RouteArrayOptions {
  duplicateCode: "DUPLICATE_ID" | "DUPLICATE_SELECTION";
  requireNonEmpty: boolean;
  emptyCode: PrimitiveValidationIssueCode;
  emptyMessage: string;
}

function validateRouteArray(
  value: unknown,
  path: string,
  options: RouteArrayOptions,
  issues: PrimitiveValidationIssue[],
): readonly string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "TYPE", "expected a route ID array");
    return Object.freeze([]);
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor !== undefined && Object.hasOwn(lengthDescriptor, "value")
    ? lengthDescriptor.value as number
    : 0;
  const indexNames: string[] = [];
  for (const name of Object.getOwnPropertyNames(value)
    .filter((item) => item !== "length")
    .sort(compareUnicodeCodePoints)) {
    const index = Number(name);
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== name) {
      addIssue(
        issues,
        `${path}/${pointerSegment(name)}`,
        "UNKNOWN_FIELD",
        "unknown array field",
      );
    } else {
      indexNames.push(name);
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    addIssue(issues, path, "UNKNOWN_FIELD", "symbol fields are not supported");
  }
  indexNames.sort((left, right) => Number(left) - Number(right));
  let expectedIndex = 0;
  for (const name of indexNames) {
    if (Number(name) !== expectedIndex) break;
    expectedIndex += 1;
  }
  if (expectedIndex !== length) {
    addIssue(issues, `${path}/${expectedIndex}`, "TYPE", "sparse route arrays are not supported");
  }
  if (options.requireNonEmpty && length === 0) {
    addIssue(issues, path, options.emptyCode, options.emptyMessage);
  }

  const routes: string[] = [];
  const seen = new Set<string>();
  for (const name of indexNames) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    const itemPath = `${path}/${name}`;
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      addIssue(issues, itemPath, "TYPE", "expected an enumerable route ID entry");
      continue;
    }
    if (!validRouteId(descriptor.value)) {
      addIssue(issues, itemPath, "UNSAFE_ID", "expected a safe route ID");
      continue;
    }
    const route = descriptor.value;
    if (seen.has(route)) {
      addIssue(
        issues,
        itemPath,
        options.duplicateCode,
        options.duplicateCode === "DUPLICATE_SELECTION"
          ? `duplicate requested route '${route}'`
          : `duplicate allowed route '${route}'`,
      );
    } else {
      seen.add(route);
    }
    routes.push(route);
  }
  return Object.freeze(routes);
}

function validateRequest(value: unknown, issues: PrimitiveValidationIssue[]): RequestSnapshot {
  const path = "#/request";
  if (!isPlainRecord(value)) {
    addIssue(issues, path, "TYPE", "expected a plain request object");
    return Object.freeze({
      requestedRoutes: Object.freeze([]),
      confidenceBasisPoints: null,
      confidencePresent: false,
    });
  }
  unknownFields(value, REQUEST_FIELDS, path, issues);

  const routesProperty = dataProperty(
    value,
    "requestedRoutes",
    `${path}/requestedRoutes`,
    "TYPE",
    issues,
  );
  let requestedRoutes: readonly string[] = Object.freeze([]);
  if (!routesProperty.present) {
    addIssue(issues, `${path}/requestedRoutes`, "REQUIRED", "requestedRoutes is required");
  } else if (routesProperty.valid) {
    requestedRoutes = validateRouteArray(
      routesProperty.value,
      `${path}/requestedRoutes`,
      {
        duplicateCode: "DUPLICATE_SELECTION",
        requireNonEmpty: false,
        emptyCode: "TYPE",
        emptyMessage: "",
      },
      issues,
    );
  }

  const confidenceProperty = dataProperty(
    value,
    "confidenceBasisPoints",
    `${path}/confidenceBasisPoints`,
    "INVALID_CONFIDENCE",
    issues,
  );
  let confidenceBasisPoints: number | null = null;
  if (confidenceProperty.present && confidenceProperty.valid) {
    if (
      !Number.isSafeInteger(confidenceProperty.value) ||
      (confidenceProperty.value as number) < 0 ||
      (confidenceProperty.value as number) > 10_000
    ) {
      addIssue(
        issues,
        `${path}/confidenceBasisPoints`,
        "INVALID_CONFIDENCE",
        "confidenceBasisPoints must be a safe integer in [0, 10000]",
      );
    } else {
      confidenceBasisPoints = confidenceProperty.value === 0 ? 0 : confidenceProperty.value as number;
    }
  }

  return Object.freeze({
    requestedRoutes,
    confidenceBasisPoints,
    confidencePresent: confidenceProperty.present,
  });
}

function validateConfidencePolicy(
  value: unknown,
  allowedRoutes: ReadonlySet<string>,
  allowedRoutesValid: boolean,
  issues: PrimitiveValidationIssue[],
): Readonly<ConfidenceSnapshot> | null {
  const path = "#/policy/confidence";
  if (!isPlainRecord(value)) {
    addIssue(issues, path, "INVALID_POLICY", "expected a plain confidence policy object");
    return null;
  }
  unknownFields(value, CONFIDENCE_FIELDS, path, issues);

  const minimumProperty = dataProperty(
    value,
    "minimumBasisPoints",
    `${path}/minimumBasisPoints`,
    "INVALID_CONFIDENCE",
    issues,
  );
  let minimumBasisPoints: number | undefined;
  if (!minimumProperty.present) {
    addIssue(issues, `${path}/minimumBasisPoints`, "REQUIRED", "minimumBasisPoints is required");
  } else if (minimumProperty.valid) {
    if (
      !Number.isSafeInteger(minimumProperty.value) ||
      (minimumProperty.value as number) < 1 ||
      (minimumProperty.value as number) > 10_000
    ) {
      addIssue(
        issues,
        `${path}/minimumBasisPoints`,
        "INVALID_CONFIDENCE",
        "minimumBasisPoints must be a safe integer in [1, 10000]",
      );
    } else {
      minimumBasisPoints = minimumProperty.value as number;
    }
  }

  const escalationProperty = dataProperty(
    value,
    "escalationRoute",
    `${path}/escalationRoute`,
    "INVALID_POLICY",
    issues,
  );
  let escalationRoute: string | undefined;
  if (!escalationProperty.present) {
    addIssue(issues, `${path}/escalationRoute`, "REQUIRED", "escalationRoute is required");
  } else if (escalationProperty.valid) {
    if (!validRouteId(escalationProperty.value)) {
      addIssue(issues, `${path}/escalationRoute`, "UNSAFE_ID", "expected a safe route ID");
    } else {
      escalationRoute = escalationProperty.value;
      if (allowedRoutesValid && !allowedRoutes.has(escalationRoute)) {
        addIssue(
          issues,
          `${path}/escalationRoute`,
          "INVALID_POLICY",
          "escalationRoute must be declared in allowedRoutes",
        );
      }
    }
  }

  if (minimumBasisPoints === undefined || escalationRoute === undefined) return null;
  return Object.freeze({ minimumBasisPoints, escalationRoute });
}

function validatePolicy(value: unknown, issues: PrimitiveValidationIssue[]): PolicySnapshot {
  const path = "#/policy";
  if (!isPlainRecord(value)) {
    addIssue(issues, path, "TYPE", "expected a plain policy object");
    return Object.freeze({
      kind: "single",
      allowedRoutes: Object.freeze([]),
      defaultRoute: null,
      confidence: null,
      confidencePresent: false,
      maxMulticast: null,
    });
  }
  unknownFields(value, POLICY_FIELDS, path, issues);

  const kindProperty = dataProperty(value, "kind", `${path}/kind`, "INVALID_POLICY", issues);
  let kind: "single" | "multi" = "single";
  let kindValid = false;
  if (!kindProperty.present) {
    addIssue(issues, `${path}/kind`, "REQUIRED", "policy kind is required");
  } else if (kindProperty.valid) {
    if (kindProperty.value !== "single" && kindProperty.value !== "multi") {
      addIssue(issues, `${path}/kind`, "INVALID_POLICY", "kind must be 'single' or 'multi'");
    } else {
      kind = kindProperty.value;
      kindValid = true;
    }
  }

  const routesProperty = dataProperty(
    value,
    "allowedRoutes",
    `${path}/allowedRoutes`,
    "TYPE",
    issues,
  );
  let allowedRoutes: readonly string[] = Object.freeze([]);
  const allowedIssuesStart = issues.length;
  if (!routesProperty.present) {
    addIssue(issues, `${path}/allowedRoutes`, "REQUIRED", "allowedRoutes is required");
  } else if (routesProperty.valid) {
    allowedRoutes = validateRouteArray(
      routesProperty.value,
      `${path}/allowedRoutes`,
      {
        duplicateCode: "DUPLICATE_ID",
        requireNonEmpty: true,
        emptyCode: "INVALID_POLICY",
        emptyMessage: "allowedRoutes must not be empty",
      },
      issues,
    );
  }
  const allowedRoutesValid = issues.length === allowedIssuesStart && routesProperty.valid;
  const allowedSet = new Set(allowedRoutes);

  const defaultProperty = dataProperty(
    value,
    "defaultRoute",
    `${path}/defaultRoute`,
    "INVALID_POLICY",
    issues,
  );
  let defaultRoute: string | null = null;
  if (defaultProperty.present && defaultProperty.valid) {
    if (!validRouteId(defaultProperty.value)) {
      addIssue(issues, `${path}/defaultRoute`, "UNSAFE_ID", "expected a safe route ID");
    } else {
      defaultRoute = defaultProperty.value;
      if (allowedRoutesValid && !allowedSet.has(defaultRoute)) {
        addIssue(
          issues,
          `${path}/defaultRoute`,
          "INVALID_POLICY",
          "defaultRoute must be declared in allowedRoutes",
        );
      }
    }
  }

  const confidenceProperty = dataProperty(
    value,
    "confidence",
    `${path}/confidence`,
    "INVALID_POLICY",
    issues,
  );
  let confidence: Readonly<ConfidenceSnapshot> | null = null;
  let confidenceConfigValid = false;
  if (confidenceProperty.present && confidenceProperty.valid) {
    const confidenceIssuesStart = issues.length;
    confidence = validateConfidencePolicy(
      confidenceProperty.value,
      allowedSet,
      allowedRoutesValid,
      issues,
    );
    confidenceConfigValid = confidence !== null && issues.length === confidenceIssuesStart;
  }

  const maxProperty = dataProperty(
    value,
    "maxMulticast",
    `${path}/maxMulticast`,
    "INVALID_POLICY",
    issues,
  );
  let maxMulticast: number | null = null;
  if (kindValid && kind === "single") {
    if (maxProperty.present) {
      addIssue(
        issues,
        `${path}/maxMulticast`,
        "INVALID_POLICY",
        "single policies must not contain maxMulticast",
      );
    }
  } else if (kindValid && kind === "multi") {
    if (!maxProperty.present) {
      addIssue(issues, `${path}/maxMulticast`, "REQUIRED", "multi policies require maxMulticast");
    } else if (maxProperty.valid) {
      if (
        !Number.isSafeInteger(maxProperty.value) ||
        (maxProperty.value as number) < 1 ||
        (allowedRoutesValid && (maxProperty.value as number) > allowedRoutes.length)
      ) {
        addIssue(
          issues,
          `${path}/maxMulticast`,
          "INVALID_POLICY",
          "maxMulticast must be a safe integer in [1, allowedRoutes.length]",
        );
      } else {
        maxMulticast = maxProperty.value as number;
      }
    }
  }

  return Object.freeze({
    kind,
    allowedRoutes,
    defaultRoute,
    confidence: confidenceConfigValid ? confidence : null,
    confidencePresent: confidenceProperty.present,
    maxMulticast,
  });
}

function result(
  reasonCode: RouteSelectionReasonCode,
  request: RequestSnapshot,
  selectedRoutes: readonly string[],
  unknownRoutes: readonly string[],
  usedDefault: boolean,
  escalated: boolean,
): RouteSelectionResult {
  const selectedSnapshot = Object.freeze([...selectedRoutes]);
  const unknownSnapshot = Object.freeze([...unknownRoutes]);
  const output: RouteSelectionResult = {
    routed: selectedSnapshot.length > 0,
    reasonCode,
    requestedRoutes: Object.freeze([...request.requestedRoutes]),
    selectedRoutes: selectedSnapshot,
    unknownRoutes: unknownSnapshot,
    confidenceBasisPoints: request.confidenceBasisPoints,
    usedDefault,
    escalated,
  };
  return Object.freeze(output);
}

function evaluate(requestValue: unknown, policyValue: unknown): RouteSelectionResult {
  const issues: PrimitiveValidationIssue[] = [];
  const request = validateRequest(requestValue, issues);
  const policy = validatePolicy(policyValue, issues);

  if (policy.confidencePresent && !request.confidencePresent) {
    addIssue(
      issues,
      "#/request/confidenceBasisPoints",
      "CONFIDENCE_CONFIGURATION",
      "confidenceBasisPoints is required when policy confidence is configured",
    );
  } else if (!policy.confidencePresent && request.confidencePresent) {
    addIssue(
      issues,
      "#/request/confidenceBasisPoints",
      "CONFIDENCE_CONFIGURATION",
      "confidenceBasisPoints requires policy confidence configuration",
    );
  }
  if (issues.length > 0) {
    throw new PrimitiveValidationError(issues, "Route selection input is invalid");
  }

  const allowedSet = new Set(policy.allowedRoutes);
  const unknownRoutes = request.requestedRoutes.filter((route) => !allowedSet.has(route));

  if (
    policy.confidence !== null &&
    request.confidenceBasisPoints !== null &&
    request.confidenceBasisPoints < policy.confidence.minimumBasisPoints
  ) {
    return result(
      "ESCALATION_SELECTED_LOW_CONFIDENCE",
      request,
      [policy.confidence.escalationRoute],
      unknownRoutes,
      false,
      true,
    );
  }

  if (request.requestedRoutes.length === 0) {
    return policy.defaultRoute === null
      ? result("NO_REQUESTED_ROUTE", request, [], [], false, false)
      : result("DEFAULT_SELECTED_NO_REQUEST", request, [policy.defaultRoute], [], true, false);
  }

  if (policy.kind === "single" && request.requestedRoutes.length > 1) {
    return result("MULTIPLE_ROUTES_FOR_SINGLE", request, [], unknownRoutes, false, false);
  }
  if (
    policy.kind === "multi" &&
    policy.maxMulticast !== null &&
    request.requestedRoutes.length > policy.maxMulticast
  ) {
    return result("MULTICAST_LIMIT_EXCEEDED", request, [], unknownRoutes, false, false);
  }

  if (unknownRoutes.length > 0) {
    return policy.defaultRoute === null
      ? result("UNKNOWN_ROUTE", request, [], unknownRoutes, false, false)
      : result(
        "DEFAULT_SELECTED_UNKNOWN_ROUTE",
        request,
        [policy.defaultRoute],
        unknownRoutes,
        true,
        false,
      );
  }

  const requestedSet = new Set(request.requestedRoutes);
  const selectedRoutes = policy.allowedRoutes.filter((route) => requestedSet.has(route));
  return result("REQUESTED_ROUTES_SELECTED", request, selectedRoutes, [], false, false);
}

/**
 * Deterministically convert a validated route request into an auditable
 * selection. State precedence is low confidence, empty request, count limits,
 * unknown/default handling, then canonical selection.
 */
export function evaluateRouteSelection(
  request: RouteSelectionRequest,
  policy: RouteSelectionPolicy,
): RouteSelectionResult {
  try {
    return evaluate(request, policy);
  } catch (error) {
    if (error instanceof PrimitiveValidationError) throw error;
    throw new PrimitiveValidationError(
      [{ path: "#", code: "TYPE", message: "route selection input could not be inspected safely" }],
      "Route selection input is invalid",
    );
  }
}
