import { PersistenceValidationError, type ValidationIssue } from "./errors.js";
import { assertGraphEvent, type GraphEvent } from "./events.js";
import { assertSafeIdentifier } from "./identifiers.js";

export function validateReadRequest(runId: string, fromSequence: number): void {
  assertSafeIdentifier(runId, "runId");
  if (!Number.isSafeInteger(fromSequence) || fromSequence < 0) {
    throw new PersistenceValidationError("fromSequence must be a non-negative safe integer", [
      { path: "#/fromSequence", message: "expected a safe integer >= 0" },
    ]);
  }
}

/**
 * Validate only the parts of an append request that are independent of the
 * current stream and detach valid event values from caller mutation.
 *
 * Event envelope validation intentionally happens after the store has loaded
 * and compared the current version. This preserves the cross-runtime error
 * priority: corrupt stream, then version conflict, then invalid new events.
 */
export function prepareAppendRequest(
  runId: string,
  expectedVersion: number,
  events: unknown,
): readonly unknown[] {
  assertSafeIdentifier(runId, "runId");
  const issues: ValidationIssue[] = [];
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < -1) {
    issues.push({ path: "#/expectedVersion", message: "expected a safe integer >= -1" });
  }
  if (!Array.isArray(events)) {
    issues.push({ path: "#/events", message: "expected an event array" });
  }
  if (issues.length > 0) {
    throw new PersistenceValidationError("Event append request is invalid", issues);
  }

  // structuredClone accepts every valid GraphEvent and also snapshots most
  // invalid runtime values (including cycles and bigint) without trying to
  // interpret them before CAS. The shallow fallback keeps envelope validation
  // on the post-CAS side for values such as functions that cannot be cloned.
  try {
    return structuredClone(events as readonly unknown[]);
  } catch {
    return [...(events as readonly unknown[])];
  }
}

/** Validate append payloads only after the stream's expected version matches. */
export function validateAppendEvents(
  runId: string,
  expectedVersion: number,
  events: readonly unknown[],
): asserts events is readonly GraphEvent[] {
  const issues: ValidationIssue[] = [];
  for (const [index, event] of events.entries()) {
    let validEvent: GraphEvent | undefined;
    try {
      assertGraphEvent(event);
      validEvent = event;
    } catch (error) {
      if (error instanceof PersistenceValidationError) {
        issues.push(
          ...error.issues.map((issue) => ({
            path: `#/events/${index}${issue.path.slice(1)}`,
            message: issue.message,
          })),
        );
      } else {
        throw error;
      }
    }
    if (validEvent !== undefined) {
      if (validEvent.runId !== runId) {
        issues.push({ path: `#/events/${index}/runId`, message: "must match append runId" });
      }
      const expectedSequence = expectedVersion + 1 + index;
      if (validEvent.sequence !== expectedSequence) {
        issues.push({
          path: `#/events/${index}/sequence`,
          message: `expected contiguous sequence ${expectedSequence}`,
        });
      }
    }
  }
  if (issues.length > 0) {
    throw new PersistenceValidationError("Event append request is invalid", issues);
  }
}
