export type PatternErrorCode =
  | "GE_PATTERN_INVALID_INPUT"
  | "GE_PATTERN_UNKNOWN_FIELD"
  | "GE_PATTERN_INVALID_IDENTIFIER"
  | "GE_PATTERN_EMPTY_COLLECTION"
  | "GE_PATTERN_TOO_MANY_ITEMS"
  | "GE_PATTERN_DUPLICATE_KEY"
  | "GE_PATTERN_DUPLICATE_NODE_ID"
  | "GE_PATTERN_INVALID_MAX_ROUNDS"
  | "GE_PATTERN_ROUND_COUNT_MISMATCH"
  | "GE_PATTERN_RESERVED_LABEL_CONFLICT"
  | "GE_PATTERN_CORE_REJECTED";

/** Stable input failure thrown before an invalid pattern graph can escape. */
export class PatternInputError extends TypeError {
  readonly code: PatternErrorCode;
  readonly path: string;

  constructor(code: PatternErrorCode, message: string, path: string) {
    super(`${message} at ${path}`);
    this.name = "PatternInputError";
    this.code = code;
    this.path = path;
  }
}
