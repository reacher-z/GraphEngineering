import { createHash } from "node:crypto";
import { PersistenceValidationError, type ValidationIssue } from "./errors.js";

export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) as number);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) as number);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

export interface JsonValidationOptions {
  safeIntegersOnly?: boolean;
}

function validateJson(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
  issues: ValidationIssue[],
  options: JsonValidationOptions,
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push({ path, message: "expected a finite JSON number" });
    else if (options.safeIntegersOnly && !Number.isSafeInteger(value)) {
      issues.push({ path, message: "checkpoint numbers must be safe integers" });
    }
    return;
  }
  if (typeof value !== "object") {
    issues.push({ path, message: `unsupported JSON value ${typeof value}` });
    return;
  }
  if (ancestors.has(value)) {
    issues.push({ path, message: "cyclic values are not JSON" });
    return;
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          issues.push({ path: `${path}/${index}`, message: "sparse arrays are not JSON" });
        } else {
          validateJson(value[index], `${path}/${index}`, ancestors, issues, options);
        }
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      issues.push({ path, message: "expected a plain JSON object" });
      return;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      issues.push({ path, message: "symbol object keys are not JSON" });
    }
    for (const [key, child] of Object.entries(value)) {
      validateJson(
        child,
        `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        ancestors,
        issues,
        options,
      );
    }
  } finally {
    ancestors.delete(value);
  }
}

export function jsonValidationIssues(
  value: unknown,
  path = "#",
  options: JsonValidationOptions = {},
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateJson(value, path, new WeakSet<object>(), issues, options);
  return issues;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareUnicodeCodePoints)
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  const issues = jsonValidationIssues(value);
  if (issues.length > 0) throw new PersistenceValidationError("Value is not canonical JSON", issues);
  return canonical(value);
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
