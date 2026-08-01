// GENERATED-DERIVED CONTRACT DATA. Section 1.2 of spec/redaction-semantics.md fixes
// exactly one classification row per source class and exactly one policy row per
// sink class. These are the native tables the guard joins; the conformance test
// asserts them equal to the literal corpus rows so drift fails the build.

import type { CaptureSinkClass, CaptureSourceClass, PolicyControl } from "./codes.js";

export interface SourceClassificationRow {
  readonly sourceClass: CaptureSourceClass;
  readonly policyControl: PolicyControl;
  readonly defaultAction: SourceDefaultAction;
  readonly mayBeMetadata: boolean;
  readonly mayFeedScheduler: boolean;
  readonly identifierTreatment: IdentifierTreatment;
}

export type SourceDefaultAction =
  | "metadata-only-allowlist"
  | "off"
  | "protected-ref";

export type IdentifierTreatment =
  | "generated-opaque-metadata"
  | "not-applicable"
  | "replace-with-runtime-opaque-and-protect-original";

export type SinkFamily =
  | "artifact"
  | "checkpoint"
  | "cli-mcp"
  | "database"
  | "error"
  | "event"
  | "explorer-http"
  | "export-replay-fork"
  | "isolation"
  | "metrics"
  | "plugin"
  | "process-diagnostic"
  | "protected-store"
  | "provider-tool"
  | "queue-transport"
  | "support-migration"
  | "test-evidence"
  | "trace";

export interface SinkPolicyRow {
  readonly sink: CaptureSinkClass;
  readonly family: SinkFamily;
  readonly policyControls: readonly PolicyControl[];
  readonly acceptsProtected: boolean;
  readonly acceptsMetadata: boolean;
  readonly defaultEnabled: boolean;
}

export const SOURCE_CLASSIFICATION_ROWS: readonly SourceClassificationRow[] = Object.freeze([
  { sourceClass: "graph-input", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "graph-output", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "bound-node-input", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "node-output", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "node-result", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "run-result", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "event-data", policyControl: "events", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "checkpoint-state", policyControl: "checkpointValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "artifact-body", policyControl: "artifacts", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "artifact-metadata", policyControl: "artifacts", defaultAction: "metadata-only-allowlist", mayBeMetadata: true, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "graph-metadata", policyControl: "events", defaultAction: "metadata-only-allowlist", mayBeMetadata: true, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "node-metadata", policyControl: "events", defaultAction: "metadata-only-allowlist", mayBeMetadata: true, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "edge-metadata", policyControl: "events", defaultAction: "metadata-only-allowlist", mayBeMetadata: true, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "node-config", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "planner-output", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "router-output", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "verifier-evidence", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "approval-context", policyControl: "durableValues", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "not-applicable" },
  { sourceClass: "prompt", policyControl: "prompts", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "model-request", policyControl: "prompts", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "model-response", policyControl: "responses", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "provider-request", policyControl: "prompts", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "provider-response", policyControl: "responses", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "provider-usage", policyControl: "responses", defaultAction: "metadata-only-allowlist", mayBeMetadata: true, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "provider-error", policyControl: "errors", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "tool-request", policyControl: "tools", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "tool-response", policyControl: "tools", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "tool-error", policyControl: "tools", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "exception-message", policyControl: "errors", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "exception-stack", policyControl: "errors", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "filesystem-path", policyControl: "logs", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "process-environment", policyControl: "deny", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "secret-value", policyControl: "deny", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "trace-attribute", policyControl: "traces", defaultAction: "metadata-only-allowlist", mayBeMetadata: true, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "metrics-attribute", policyControl: "metrics", defaultAction: "metadata-only-allowlist", mayBeMetadata: true, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "log-field", policyControl: "logs", defaultAction: "metadata-only-allowlist", mayBeMetadata: true, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "cli-argument", policyControl: "logs", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "mcp-request", policyControl: "mcp", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "mcp-response", policyControl: "mcp", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "plugin-request", policyControl: "plugins", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "plugin-response", policyControl: "plugins", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "explorer-payload", policyControl: "exports", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "worktree-output", policyControl: "isolationOutputs", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "process-output", policyControl: "isolationOutputs", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "container-output", policyControl: "isolationOutputs", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "database-index-value", policyControl: "database", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "database-projection-value", policyControl: "database", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "backup-source", policyControl: "database", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "export-source", policyControl: "exports", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "replay-report", policyControl: "exports", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "fork-report", policyControl: "exports", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "support-field", policyControl: "supportBundles", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "migration-source", policyControl: "exports", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "test-failure-artifact", policyControl: "testArtifacts", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "benchmark-artifact", policyControl: "testArtifacts", defaultAction: "off", mayBeMetadata: false, mayFeedScheduler: false, identifierTreatment: "not-applicable" },
  { sourceClass: "caller-controlled-identifier", policyControl: "identifiers", defaultAction: "protected-ref", mayBeMetadata: false, mayFeedScheduler: true, identifierTreatment: "replace-with-runtime-opaque-and-protect-original" },
  { sourceClass: "runtime-generated-identifier", policyControl: "identifiers", defaultAction: "metadata-only-allowlist", mayBeMetadata: true, mayFeedScheduler: true, identifierTreatment: "generated-opaque-metadata" },
]);

export const SINK_POLICY_ROWS: readonly SinkPolicyRow[] = Object.freeze([
  { sink: "event-memory", family: "event", policyControls: ["events"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: true },
  { sink: "event-journal-buffer", family: "event", policyControls: ["events"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: true },
  { sink: "event-journal", family: "event", policyControls: ["events"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: true },
  { sink: "checkpoint-memory", family: "checkpoint", policyControls: ["checkpointValues"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: true },
  { sink: "checkpoint-temporary", family: "checkpoint", policyControls: ["checkpointValues"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: true },
  { sink: "checkpoint-final", family: "checkpoint", policyControls: ["checkpointValues"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: true },
  { sink: "protected-blob-memory", family: "protected-store", policyControls: ["durableValues"], acceptsProtected: true, acceptsMetadata: false, defaultEnabled: true },
  { sink: "protected-blob-temporary", family: "protected-store", policyControls: ["durableValues"], acceptsProtected: true, acceptsMetadata: false, defaultEnabled: true },
  { sink: "protected-blob-final", family: "protected-store", policyControls: ["durableValues"], acceptsProtected: true, acceptsMetadata: false, defaultEnabled: true },
  { sink: "artifact-memory", family: "artifact", policyControls: ["artifacts"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "artifact-temporary", family: "artifact", policyControls: ["artifacts"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "artifact-final", family: "artifact", policyControls: ["artifacts"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "retry-buffer", family: "queue-transport", policyControls: ["events"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: true },
  { sink: "dead-letter", family: "queue-transport", policyControls: ["events", "errors"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "transport-buffer", family: "queue-transport", policyControls: ["exports"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "provider-request-transport", family: "provider-tool", policyControls: ["prompts"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "provider-response-buffer", family: "provider-tool", policyControls: ["responses"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "tool-request-transport", family: "provider-tool", policyControls: ["tools"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "tool-response-buffer", family: "provider-tool", policyControls: ["tools"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "stdout", family: "process-diagnostic", policyControls: ["logs", "identifiers"], acceptsProtected: false, acceptsMetadata: true, defaultEnabled: true },
  { sink: "stderr", family: "process-diagnostic", policyControls: ["logs", "errors", "identifiers"], acceptsProtected: false, acceptsMetadata: true, defaultEnabled: true },
  { sink: "runtime-log", family: "process-diagnostic", policyControls: ["logs", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: true },
  { sink: "application-log-adapter", family: "process-diagnostic", policyControls: ["logs", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: true },
  { sink: "trace-buffer", family: "trace", policyControls: ["traces", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "trace-export", family: "trace", policyControls: ["traces", "exports", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "metrics-buffer", family: "metrics", policyControls: ["metrics", "identifiers"], acceptsProtected: false, acceptsMetadata: true, defaultEnabled: false },
  { sink: "metrics-export", family: "metrics", policyControls: ["metrics", "exports", "identifiers"], acceptsProtected: false, acceptsMetadata: true, defaultEnabled: false },
  { sink: "error-envelope", family: "error", policyControls: ["errors", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: true },
  { sink: "error-aggregator", family: "error", policyControls: ["errors", "exports", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "cli-json", family: "cli-mcp", policyControls: ["events", "errors", "logs", "identifiers"], acceptsProtected: false, acceptsMetadata: true, defaultEnabled: true },
  { sink: "cli-diagnostic", family: "cli-mcp", policyControls: ["errors", "logs", "identifiers"], acceptsProtected: false, acceptsMetadata: true, defaultEnabled: true },
  { sink: "mcp-request-buffer", family: "cli-mcp", policyControls: ["mcp", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "mcp-response", family: "cli-mcp", policyControls: ["mcp", "errors", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "plugin-request", family: "plugin", policyControls: ["plugins", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "plugin-response", family: "plugin", policyControls: ["plugins", "errors", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "worktree-output", family: "isolation", policyControls: ["isolationOutputs", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "process-output", family: "isolation", policyControls: ["isolationOutputs", "errors", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "container-output", family: "isolation", policyControls: ["isolationOutputs", "errors", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "explorer-response", family: "explorer-http", policyControls: ["events", "errors", "identifiers"], acceptsProtected: false, acceptsMetadata: true, defaultEnabled: false },
  { sink: "explorer-cache", family: "explorer-http", policyControls: ["events", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "http-response", family: "explorer-http", policyControls: ["exports", "errors", "identifiers"], acceptsProtected: false, acceptsMetadata: true, defaultEnabled: false },
  { sink: "network-export", family: "explorer-http", policyControls: ["exports", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "database-index", family: "database", policyControls: ["database", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "database-materialized-projection", family: "database", policyControls: ["database", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "database-backup", family: "database", policyControls: ["database", "exports", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "export-report", family: "export-replay-fork", policyControls: ["exports", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "replay-report", family: "export-replay-fork", policyControls: ["exports", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "fork-report", family: "export-replay-fork", policyControls: ["exports", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "support-bundle-staging", family: "support-migration", policyControls: ["supportBundles", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "support-bundle-final", family: "support-migration", policyControls: ["supportBundles", "exports", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "migration-manifest", family: "support-migration", policyControls: ["exports", "identifiers"], acceptsProtected: false, acceptsMetadata: true, defaultEnabled: false },
  { sink: "test-failure-artifact", family: "test-evidence", policyControls: ["testArtifacts", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "benchmark-artifact", family: "test-evidence", policyControls: ["testArtifacts", "identifiers"], acceptsProtected: true, acceptsMetadata: true, defaultEnabled: false },
  { sink: "release-evidence", family: "test-evidence", policyControls: ["testArtifacts", "identifiers"], acceptsProtected: false, acceptsMetadata: true, defaultEnabled: false },
]);

const SOURCE_INDEX = new Map<string, SourceClassificationRow>(
  SOURCE_CLASSIFICATION_ROWS.map((row) => [row.sourceClass, row]),
);
const SINK_INDEX = new Map<string, SinkPolicyRow>(SINK_POLICY_ROWS.map((row) => [row.sink, row]));

/** Section 7: locate the unique source row, or undefined for an unknown class. */
export function sourceRow(sourceClass: string): SourceClassificationRow | undefined {
  return SOURCE_INDEX.get(sourceClass);
}

/** Section 7: locate the unique sink row, or undefined for an unknown sink. */
export function sinkRow(sink: string): SinkPolicyRow | undefined {
  return SINK_INDEX.get(sink);
}
