import type { PrimitiveValidationIssue } from "./errors.js";

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) as number);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) as number);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function issue(issues: PrimitiveValidationIssue[], path: string, message: string): void {
  issues.push({ path, code: "INVALID_JSON", message });
}

function validateJson(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
  issues: PrimitiveValidationIssue[],
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issue(issues, path, "expected a finite JSON number");
    else if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      issue(issues, path, "JSON integers must be within ±(2^53-1)");
    }
    return;
  }
  if (typeof value !== "object") {
    issue(issues, path, `unsupported JSON value ${typeof value}`);
    return;
  }
  if (ancestors.has(value)) {
    issue(issues, path, "cyclic values are not JSON");
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    issue(issues, path, "expected a plain JSON object");
    return;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    issue(issues, path, "symbol keys are not JSON");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      const length = lengthDescriptor !== undefined && Object.hasOwn(lengthDescriptor, "value")
        ? lengthDescriptor.value as number
        : 0;
      const ownNames = Object.getOwnPropertyNames(value).filter((name) => name !== "length");
      const indexNames: string[] = [];
      for (const name of ownNames.sort(compareUnicodeCodePoints)) {
        const index = Number(name);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== name) {
          issue(issues, `${path}/${pointerSegment(name)}`, "extra array properties are not JSON");
        } else {
          indexNames.push(name);
        }
      }
      if (indexNames.length !== length) {
        issue(issues, path, "sparse arrays are not JSON");
      }
      indexNames.sort((left, right) => Number(left) - Number(right));
      for (const name of indexNames) {
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
          issue(issues, `${path}/${name}`, "accessor array entries are not JSON");
        } else if (descriptor.enumerable !== true) {
          issue(issues, `${path}/${name}`, "non-enumerable array entries are not portable JSON");
        } else {
          validateJson(descriptor.value, `${path}/${name}`, ancestors, issues);
        }
      }
      return;
    }

    for (const key of Object.getOwnPropertyNames(value).sort(compareUnicodeCodePoints)) {
      const childPath = `${path}/${pointerSegment(key)}`;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        issue(issues, childPath, "accessor properties are not JSON");
      } else if (descriptor.enumerable !== true) {
        issue(issues, childPath, "non-enumerable properties are not portable JSON");
      } else {
        validateJson(descriptor.value, childPath, ancestors, issues);
      }
    }
  } finally {
    ancestors.delete(value);
  }
}

export function appendJsonIssues(
  value: unknown,
  path: string,
  issues: PrimitiveValidationIssue[],
): void {
  try {
    validateJson(value, path, new WeakSet<object>(), issues);
  } catch {
    issue(issues, path, "value could not be inspected without executing caller code");
  }
}

export { compareUnicodeCodePoints };
