/**
 * Closed vocabularies for the D9 redaction contract (spec/redaction-semantics.md).
 *
 * Section 1.2 fixes the 57 source classes and 54 sink classes exactly; Section 10
 * fixes the twelve stable failure codes. These constants are the native copies the
 * guard joins against, and the conformance test proves they equal the shipped
 * schema enums.
 */

export const CAPTURE_SOURCE_CLASSES = Object.freeze([
  "graph-input",
  "graph-output",
  "bound-node-input",
  "node-output",
  "node-result",
  "run-result",
  "event-data",
  "checkpoint-state",
  "artifact-body",
  "artifact-metadata",
  "graph-metadata",
  "node-metadata",
  "edge-metadata",
  "node-config",
  "planner-output",
  "router-output",
  "verifier-evidence",
  "approval-context",
  "prompt",
  "model-request",
  "model-response",
  "provider-request",
  "provider-response",
  "provider-usage",
  "provider-error",
  "tool-request",
  "tool-response",
  "tool-error",
  "exception-message",
  "exception-stack",
  "filesystem-path",
  "process-environment",
  "secret-value",
  "trace-attribute",
  "metrics-attribute",
  "log-field",
  "cli-argument",
  "mcp-request",
  "mcp-response",
  "plugin-request",
  "plugin-response",
  "explorer-payload",
  "worktree-output",
  "process-output",
  "container-output",
  "database-index-value",
  "database-projection-value",
  "backup-source",
  "export-source",
  "replay-report",
  "fork-report",
  "support-field",
  "migration-source",
  "test-failure-artifact",
  "benchmark-artifact",
  "caller-controlled-identifier",
  "runtime-generated-identifier",
] as const);

export const CAPTURE_SINK_CLASSES = Object.freeze([
  "event-memory",
  "event-journal-buffer",
  "event-journal",
  "checkpoint-memory",
  "checkpoint-temporary",
  "checkpoint-final",
  "protected-blob-memory",
  "protected-blob-temporary",
  "protected-blob-final",
  "artifact-memory",
  "artifact-temporary",
  "artifact-final",
  "retry-buffer",
  "dead-letter",
  "transport-buffer",
  "provider-request-transport",
  "provider-response-buffer",
  "tool-request-transport",
  "tool-response-buffer",
  "stdout",
  "stderr",
  "runtime-log",
  "application-log-adapter",
  "trace-buffer",
  "trace-export",
  "metrics-buffer",
  "metrics-export",
  "error-envelope",
  "error-aggregator",
  "cli-json",
  "cli-diagnostic",
  "mcp-request-buffer",
  "mcp-response",
  "plugin-request",
  "plugin-response",
  "worktree-output",
  "process-output",
  "container-output",
  "explorer-response",
  "explorer-cache",
  "http-response",
  "network-export",
  "database-index",
  "database-materialized-projection",
  "database-backup",
  "export-report",
  "replay-report",
  "fork-report",
  "support-bundle-staging",
  "support-bundle-final",
  "migration-manifest",
  "test-failure-artifact",
  "benchmark-artifact",
  "release-evidence",
] as const);

export const POLICY_CONTROLS = Object.freeze([
  "artifacts",
  "checkpointValues",
  "database",
  "deny",
  "durableValues",
  "errors",
  "events",
  "exports",
  "identifiers",
  "isolationOutputs",
  "logs",
  "mcp",
  "metrics",
  "plugins",
  "prompts",
  "responses",
  "supportBundles",
  "testArtifacts",
  "tools",
  "traces",
] as const);

export const REDACTION_FAILURE_CODES = Object.freeze([
  "REDACTION_POLICY_REQUIRED",
  "REDACTION_POLICY_INVALID",
  "CAPTURE_POLICY_MISMATCH",
  "INLINE_CAPTURE_NOT_AUTHORIZED",
  "PAYLOAD_PROTECTION_REQUIRED",
  "PAYLOAD_PROTECTION_FAILED",
  "PROTECTED_PAYLOAD_NOT_FOUND",
  "PROTECTED_PAYLOAD_UNAUTHORIZED",
  "PROTECTED_PAYLOAD_CORRUPT",
  "REDACTION_RECEIPT_INVALID",
  "LEGACY_REDACTION_MISMATCH",
  "SECRET_CANARY_DETECTED",
] as const);

export type CaptureSourceClass = (typeof CAPTURE_SOURCE_CLASSES)[number];
export type CaptureSinkClass = (typeof CAPTURE_SINK_CLASSES)[number];
export type PolicyControl = (typeof POLICY_CONTROLS)[number];
export type RedactionFailureCode = (typeof REDACTION_FAILURE_CODES)[number];

/** Section 7 guard phases; every phase denies before any sink byte is produced. */
export const GUARD_FAILURE_PHASES = Object.freeze([
  "snapshot",
  "classification",
  "policy",
  "encode",
  "mac",
  "protect",
  "atomic-publish",
  "receipt",
  "scan",
  "canonicalize",
  "sink-write",
  "compare-and-swap",
] as const);

export type GuardFailurePhase = (typeof GUARD_FAILURE_PHASES)[number];

/**
 * A structured denial. Section 10 forbids offending bytes, keys, plaintext, raw
 * exception text, or a detected canary value in these details, so the shape
 * carries only stable identifiers and the phase.
 */
export interface GuardFailure {
  readonly code: RedactionFailureCode;
  readonly phase: GuardFailurePhase;
  /** Stable, non-sensitive reason key. Never provider or caller text. */
  readonly reason: string;
  readonly sink?: CaptureSinkClass;
  readonly sourceClass?: CaptureSourceClass;
  readonly decisionId?: string;
}
