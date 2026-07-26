import { createHash } from "node:crypto";
import { UnsafeIdentifierError } from "./errors.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertSafeIdentifier(
  value: unknown,
  kind: "runId" | "checkpointId",
): asserts value is string {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value) || value === "." || value === "..") {
    throw new UnsafeIdentifierError(kind, value);
  }
}

/** Files never contain caller-controlled path text, even after validation. */
export function identifierHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
