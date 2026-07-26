export type PersistenceErrorCode =
  | "PERSISTENCE_VALIDATION"
  | "UNSAFE_IDENTIFIER"
  | "VERSION_CONFLICT"
  | "CORRUPT_EVENT_LOG"
  | "CORRUPT_CHECKPOINT"
  | "PERSISTENCE_IO";

export interface SerializedPersistenceError {
  name: string;
  code: PersistenceErrorCode;
  message: string;
  details: Readonly<Record<string, unknown>>;
}

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: PersistenceErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "PersistenceError";
    this.code = code;
    this.details = details;
  }

  toJSON(): SerializedPersistenceError {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class PersistenceValidationError extends PersistenceError {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[]) {
    super("PERSISTENCE_VALIDATION", message, { issues });
    this.name = "PersistenceValidationError";
    this.issues = issues;
  }
}

export class UnsafeIdentifierError extends PersistenceError {
  readonly identifierKind: "runId" | "checkpointId";

  constructor(identifierKind: "runId" | "checkpointId", value: unknown) {
    super("UNSAFE_IDENTIFIER", `${identifierKind} is not a safe persistence identifier`, {
      identifierKind,
      value,
    });
    this.name = "UnsafeIdentifierError";
    this.identifierKind = identifierKind;
  }
}

export class VersionConflictError extends PersistenceError {
  readonly runId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(runId: string, expectedVersion: number, actualVersion: number) {
    super(
      "VERSION_CONFLICT",
      `Event stream '${runId}' expected version ${expectedVersion}, but is at ${actualVersion}`,
      { runId, expectedVersion, actualVersion },
    );
    this.name = "VersionConflictError";
    this.runId = runId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class CorruptEventLogError extends PersistenceError {
  constructor(runId: string, reason: string, line?: number) {
    super("CORRUPT_EVENT_LOG", `Event log '${runId}' is corrupt: ${reason}`, {
      runId,
      reason,
      ...(line === undefined ? {} : { line }),
    });
    this.name = "CorruptEventLogError";
  }
}

export class CorruptCheckpointError extends PersistenceError {
  constructor(runId: string, checkpointId: string, reason: string) {
    super("CORRUPT_CHECKPOINT", `Checkpoint '${runId}/${checkpointId}' is corrupt: ${reason}`, {
      runId,
      checkpointId,
      reason,
    });
    this.name = "CorruptCheckpointError";
  }
}

export class PersistenceIoError extends PersistenceError {
  constructor(operation: string, path: string, cause: unknown) {
    super("PERSISTENCE_IO", `Persistence ${operation} failed`, { operation, path }, { cause });
    this.name = "PersistenceIoError";
  }
}
