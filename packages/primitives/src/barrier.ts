import {
  PrimitiveValidationError,
  type PrimitiveValidationIssue,
} from "./errors.js";
import { appendJsonIssues, compareUnicodeCodePoints } from "./json.js";
import type {
  SettledBarrierPolicy,
  SettledBarrierReasonCode,
  SettledBarrierResult,
  SettledItem,
  SettledStatus,
} from "./types.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ITEM_FIELDS = new Set(["id", "status", "value"]);
const STATUSES = new Set<SettledStatus>(["succeeded", "failed", "missing", "timed_out"]);

interface ValidatedItem {
  id: string;
  status: SettledStatus;
}

interface OwnDataProperty {
  present: boolean;
  readable: boolean;
  value?: unknown;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function addIssue(
  issues: PrimitiveValidationIssue[],
  path: string,
  code: PrimitiveValidationIssue["code"],
  message: string,
): void {
  issues.push({ path, code, message });
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function ownDataProperty(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: PrimitiveValidationIssue["code"],
  message: string,
  issues: PrimitiveValidationIssue[],
): OwnDataProperty {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return { present: false, readable: false };
  if (!Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
    addIssue(issues, path, code, message);
    return { present: true, readable: false };
  }
  return { present: true, readable: true, value: descriptor.value };
}

function unknownFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: PrimitiveValidationIssue[],
): void {
  for (const key of Object.getOwnPropertyNames(record).sort(compareUnicodeCodePoints)) {
    if (!allowed.has(key)) {
      addIssue(issues, `${path}/${pointerSegment(key)}`, "UNKNOWN_FIELD", "unknown field");
    }
  }
  if (Object.getOwnPropertySymbols(record).length > 0) {
    addIssue(issues, path, "UNKNOWN_FIELD", "symbol fields are not supported");
  }
}

function validateItems(value: unknown, issues: PrimitiveValidationIssue[]): ValidatedItem[] {
  if (!Array.isArray(value)) {
    addIssue(issues, "#/items", "TYPE", "expected an item array");
    return [];
  }

  const validated: ValidatedItem[] = [];
  const seenIds = new Set<string>();
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
        `#/items/${pointerSegment(name)}`,
        "UNKNOWN_FIELD",
        "unknown array field",
      );
    } else {
      indexNames.push(name);
    }
  }
  indexNames.sort((left, right) => Number(left) - Number(right));
  if (Object.getOwnPropertySymbols(value).length > 0) {
    addIssue(issues, "#/items", "UNKNOWN_FIELD", "symbol fields are not supported");
  }
  let expectedIndex = 0;
  for (const name of indexNames) {
    const index = Number(name);
    if (index !== expectedIndex) break;
    expectedIndex += 1;
  }
  if (expectedIndex !== length) {
    addIssue(issues, `#/items/${expectedIndex}`, "TYPE", "sparse item slots are not supported");
  }

  for (const name of indexNames) {
    const index = Number(name);
    const path = `#/items/${index}`;
    const itemDescriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      itemDescriptor === undefined ||
      !Object.hasOwn(itemDescriptor, "value") ||
      itemDescriptor.enumerable !== true
    ) {
      addIssue(issues, path, "TYPE", "expected an enumerable item data entry");
      continue;
    }
    const item: unknown = itemDescriptor.value;
    if (!isPlainRecord(item)) {
      addIssue(issues, path, "TYPE", "expected a plain item object");
      continue;
    }

    unknownFields(item, ITEM_FIELDS, path, issues);

    let id: string | undefined;
    const idProperty = ownDataProperty(
      item,
      "id",
      `${path}/id`,
      "TYPE",
      "id must be an enumerable data field",
      issues,
    );
    if (!idProperty.present) {
      addIssue(issues, `${path}/id`, "REQUIRED", "id is required");
    } else if (idProperty.readable && (
      typeof idProperty.value !== "string" ||
      !SAFE_ID.test(idProperty.value) ||
      idProperty.value === "." ||
      idProperty.value === ".."
    )
    ) {
      addIssue(issues, `${path}/id`, "UNSAFE_ID", "expected a safe identifier");
    } else if (idProperty.readable) {
      id = idProperty.value as string;
      if (seenIds.has(id)) {
        addIssue(issues, `${path}/id`, "DUPLICATE_ID", `duplicate id '${id}'`);
      } else {
        seenIds.add(id);
      }
    }

    let status: SettledStatus | undefined;
    const statusProperty = ownDataProperty(
      item,
      "status",
      `${path}/status`,
      "TYPE",
      "status must be an enumerable data field",
      issues,
    );
    if (!statusProperty.present) {
      addIssue(issues, `${path}/status`, "REQUIRED", "status is required");
    } else if (
      statusProperty.readable &&
      (typeof statusProperty.value !== "string" || !STATUSES.has(statusProperty.value as SettledStatus))
    ) {
      addIssue(issues, `${path}/status`, "INVALID_STATUS", "unknown settled status");
    } else if (statusProperty.readable) {
      status = statusProperty.value as SettledStatus;
    }

    const valueDescriptor = Object.getOwnPropertyDescriptor(item, "value");
    const hasValue = valueDescriptor !== undefined;
    if (status === "succeeded") {
      if (!hasValue) {
        addIssue(
          issues,
          `${path}/value`,
          "STATUS_VALUE_MISMATCH",
          "succeeded items require a value",
        );
      } else if (
        !Object.hasOwn(valueDescriptor, "value") ||
        valueDescriptor.enumerable !== true
      ) {
        addIssue(
          issues,
          `${path}/value`,
          "INVALID_JSON",
          "value must be an enumerable data field",
        );
      } else {
        appendJsonIssues(valueDescriptor.value, `${path}/value`, issues);
      }
    } else if (status !== undefined && hasValue) {
      addIssue(
        issues,
        `${path}/value`,
        "STATUS_VALUE_MISMATCH",
        `${status} items must not contain a value`,
      );
    }

    if (id !== undefined && status !== undefined) validated.push({ id, status });
  }
  return validated;
}

function validatePolicy(value: unknown, issues: PrimitiveValidationIssue[]): SettledBarrierPolicy {
  const path = "#/policy";
  if (!isPlainRecord(value)) {
    addIssue(issues, path, "TYPE", "expected a plain policy object");
    return { kind: "all" };
  }

  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  const kind = kindDescriptor !== undefined && Object.hasOwn(kindDescriptor, "value")
    ? kindDescriptor.value
    : undefined;
  const allowed = kind === "minimum"
    ? new Set(["kind", "minimum"])
    : kind === "percentage"
      ? new Set(["kind", "basisPoints"])
      : new Set(["kind"]);
  unknownFields(value, allowed, path, issues);

  if (kindDescriptor === undefined) {
    addIssue(issues, `${path}/kind`, "REQUIRED", "policy kind is required");
    return { kind: "all" };
  }
  if (!Object.hasOwn(kindDescriptor, "value") || kindDescriptor.enumerable !== true) {
    addIssue(
      issues,
      `${path}/kind`,
      "INVALID_POLICY",
      "policy kind must be an enumerable data field",
    );
    return { kind: "all" };
  }
  if (kind !== "all" && kind !== "minimum" && kind !== "percentage") {
    addIssue(issues, `${path}/kind`, "INVALID_POLICY", "unknown barrier policy kind");
    return { kind: "all" };
  }
  if (kind === "all") return { kind };

  if (kind === "minimum") {
    const minimumDescriptor = Object.getOwnPropertyDescriptor(value, "minimum");
    if (minimumDescriptor === undefined) {
      addIssue(issues, `${path}/minimum`, "REQUIRED", "minimum is required");
      return { kind, minimum: 1 };
    }
    if (!Object.hasOwn(minimumDescriptor, "value") || minimumDescriptor.enumerable !== true) {
      addIssue(
        issues,
        `${path}/minimum`,
        "INVALID_POLICY",
        "minimum must be an enumerable data field",
      );
      return { kind, minimum: 1 };
    }
    if (!Number.isSafeInteger(minimumDescriptor.value) || (minimumDescriptor.value as number) < 1) {
      addIssue(
        issues,
        `${path}/minimum`,
        "INVALID_POLICY",
        "minimum must be a safe integer >= 1",
      );
      return { kind, minimum: 1 };
    }
    return { kind, minimum: minimumDescriptor.value as number };
  }

  const basisPointsDescriptor = Object.getOwnPropertyDescriptor(value, "basisPoints");
  if (basisPointsDescriptor === undefined) {
    addIssue(issues, `${path}/basisPoints`, "REQUIRED", "basisPoints is required");
    return { kind, basisPoints: 1 };
  }
  if (!Object.hasOwn(basisPointsDescriptor, "value") || basisPointsDescriptor.enumerable !== true) {
    addIssue(
      issues,
      `${path}/basisPoints`,
      "INVALID_POLICY",
      "basisPoints must be an enumerable data field",
    );
    return { kind, basisPoints: 1 };
  }
  if (
    !Number.isSafeInteger(basisPointsDescriptor.value) ||
    (basisPointsDescriptor.value as number) < 1 ||
    (basisPointsDescriptor.value as number) > 10_000
  ) {
    addIssue(
      issues,
      `${path}/basisPoints`,
      "INVALID_POLICY",
      "basisPoints must be a safe integer in [1, 10000]",
    );
    return { kind, basisPoints: 1 };
  }
  return { kind, basisPoints: basisPointsDescriptor.value as number };
}

function reason(
  total: number,
  succeeded: number,
  policy: SettledBarrierPolicy,
): { satisfied: boolean; reasonCode: SettledBarrierReasonCode } {
  if (total === 0) return { satisfied: false, reasonCode: "NO_ITEMS" };
  if (policy.kind === "all") {
    return succeeded === total
      ? { satisfied: true, reasonCode: "ALL_SUCCEEDED" }
      : { satisfied: false, reasonCode: "ALL_NOT_SUCCEEDED" };
  }
  if (policy.kind === "minimum") {
    if (policy.minimum > total) {
      return { satisfied: false, reasonCode: "MINIMUM_EXCEEDS_TOTAL" };
    }
    return succeeded >= policy.minimum
      ? { satisfied: true, reasonCode: "MINIMUM_MET" }
      : { satisfied: false, reasonCode: "MINIMUM_NOT_MET" };
  }

  // Both products remain exact safe integers because JS array length is below
  // 2^32 and basis points are capped at 10,000. No floating-point ratio exists.
  return succeeded * 10_000 >= total * policy.basisPoints
    ? { satisfied: true, reasonCode: "PERCENTAGE_MET" }
    : { satisfied: false, reasonCode: "PERCENTAGE_NOT_MET" };
}

function freezeResult(result: SettledBarrierResult): SettledBarrierResult {
  Object.freeze(result.acceptedIds);
  Object.freeze(result.failedIds);
  Object.freeze(result.missingIds);
  Object.freeze(result.timedOutIds);
  return Object.freeze(result);
}

function evaluate(itemsValue: unknown, policyValue: unknown): SettledBarrierResult {
  const issues: PrimitiveValidationIssue[] = [];
  const items = validateItems(itemsValue, issues);
  const policy = validatePolicy(policyValue, issues);
  if (issues.length > 0) throw new PrimitiveValidationError(issues);

  const acceptedIds: string[] = [];
  const failedIds: string[] = [];
  const missingIds: string[] = [];
  const timedOutIds: string[] = [];
  for (const item of items) {
    switch (item.status) {
      case "succeeded": acceptedIds.push(item.id); break;
      case "failed": failedIds.push(item.id); break;
      case "missing": missingIds.push(item.id); break;
      case "timed_out": timedOutIds.push(item.id); break;
    }
  }
  const outcome = reason(items.length, acceptedIds.length, policy);
  return freezeResult({
    ...outcome,
    total: items.length,
    succeeded: acceptedIds.length,
    failed: failedIds.length,
    missing: missingIds.length,
    timedOut: timedOutIds.length,
    acceptedIds,
    failedIds,
    missingIds,
    timedOutIds,
  });
}

/** Evaluate a fully settled item set with no model calls, timers, or side effects. */
export function evaluateSettledBarrier(
  items: readonly SettledItem[],
  policy: SettledBarrierPolicy,
): SettledBarrierResult {
  try {
    return evaluate(items, policy);
  } catch (error) {
    if (error instanceof PrimitiveValidationError) throw error;
    throw new PrimitiveValidationError([
      { path: "#", code: "TYPE", message: "barrier input could not be inspected safely" },
    ]);
  }
}
