export type PrimitiveErrorCode = "PRIMITIVE_VALIDATION";

export type PrimitiveValidationIssueCode =
  | "TYPE"
  | "REQUIRED"
  | "UNKNOWN_FIELD"
  | "UNSAFE_ID"
  | "DUPLICATE_ID"
  | "INVALID_STATUS"
  | "STATUS_VALUE_MISMATCH"
  | "INVALID_JSON"
  | "INVALID_POLICY"
  | "DUPLICATE_SELECTION"
  | "INVALID_CONFIDENCE"
  | "CONFIDENCE_CONFIGURATION";

export interface PrimitiveValidationIssue {
  readonly path: string;
  readonly code: PrimitiveValidationIssueCode;
  readonly message: string;
}

export interface SerializedPrimitiveValidationError {
  readonly name: "PrimitiveValidationError";
  readonly code: "PRIMITIVE_VALIDATION";
  readonly message: string;
  readonly issues: readonly PrimitiveValidationIssue[];
}

function freezeIssues(issues: readonly PrimitiveValidationIssue[]): readonly PrimitiveValidationIssue[] {
  return Object.freeze(
    issues.map((issue) => Object.freeze({ path: issue.path, code: issue.code, message: issue.message })),
  );
}

/** Stable, serializable validation failure that never retains caller input. */
export class PrimitiveValidationError extends Error {
  readonly code = "PRIMITIVE_VALIDATION" as const;
  readonly issues: readonly PrimitiveValidationIssue[];

  constructor(
    issues: readonly PrimitiveValidationIssue[],
    message = "Settled barrier input is invalid",
  ) {
    super(message);
    this.name = "PrimitiveValidationError";
    this.issues = freezeIssues(issues);
  }

  toJSON(): SerializedPrimitiveValidationError {
    return Object.freeze({
      name: "PrimitiveValidationError",
      code: this.code,
      message: this.message,
      issues: this.issues,
    });
  }
}
