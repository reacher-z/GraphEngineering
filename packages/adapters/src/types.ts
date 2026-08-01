/**
 * Portable types for `adapter-contract/v1alpha1`.
 *
 * Every type here mirrors a member of the frozen D13 schema set
 * (`spec/adapter-capability.schema.json`, `spec/adapter-descriptor.schema.json`,
 * `spec/adapter-usage.schema.json`, `spec/adapter-error.schema.json`). The
 * conformance corpus `spec/conformance/adapter.case.json` is the authority: the
 * package tests feed its literal documents through these types.
 */

export const ADAPTER_API_VERSION =
  "graphengineering.reacher-z.github.io/adapters/v1alpha1" as const;
export const ADAPTER_CONTRACT_VERSION = "adapter-contract/v1alpha1" as const;

/** `adapter-capability.schema.json` — closed at sixteen members. */
export type AdapterCapability =
  | "attachments"
  | "cached-input-usage-reporting"
  | "cancellation"
  | "content-filter-reporting"
  | "deterministic-replay"
  | "fault-injection"
  | "idempotency-key"
  | "parallel-tool-calls"
  | "provider-request-id"
  | "rate-limit-reporting"
  | "reasoning-usage-reporting"
  | "retry-after-hint"
  | "streaming"
  | "structured-output"
  | "tool-calling"
  | "usage-reporting";

/** `adapter-descriptor.schema.json#/$defs/adapterKind` — closed at eight kinds. */
export type AdapterKind =
  | "anthropic"
  | "google-gemini"
  | "http"
  | "mcp"
  | "mock"
  | "openai"
  | "openai-compatible"
  | "shell";

export type AdapterEvidenceClass = "deterministic-mock" | "live-provider";

/**
 * Exactly the vocabulary of
 * `cycle-controller.schema.json#/$defs/activity/properties/sideEffects`.
 */
export type SideEffectClass = "none" | "idempotent" | "non-idempotent";

/** `adapter-error.schema.json#/$defs/errorCode` — closed at fourteen codes. */
export type AdapterErrorCode =
  | "GE_ADAPTER_AUTHENTICATION"
  | "GE_ADAPTER_BOUNDS_EXCEEDED"
  | "GE_ADAPTER_CANCELLED"
  | "GE_ADAPTER_CAPABILITY_UNSUPPORTED"
  | "GE_ADAPTER_CONTENT_FILTERED"
  | "GE_ADAPTER_DESCRIPTOR_INVALID"
  | "GE_ADAPTER_INVALID_REQUEST"
  | "GE_ADAPTER_MALFORMED_RESPONSE"
  | "GE_ADAPTER_POLICY_DENIED"
  | "GE_ADAPTER_QUOTA_EXCEEDED"
  | "GE_ADAPTER_RATE_LIMITED"
  | "GE_ADAPTER_TIMEOUT"
  | "GE_ADAPTER_TOOL_VALIDATION_FAILED"
  | "GE_ADAPTER_TRANSPORT_FAILURE";

export type AdapterBoundary = "dispatch" | "pre-dispatch";
export type EffectDisposition = "applied" | "in-doubt" | "not-applied";
export type UsageDisposition = "conservative" | "none";
export type LedgerAction = "commit-conservative" | "release-reservation";

/** `adapter-error.schema.json#/$defs/denialReason` — closed at eleven reasons. */
export type DenialReason =
  | "capability-approval"
  | "circuit-open"
  | "egress-not-allowlisted"
  | "environment-not-allowlisted"
  | "executable-not-authorized"
  | "idempotency-key-missing"
  | "mcp-mutation-not-approved"
  | "mcp-tool-not-allowlisted"
  | "redirect-not-reauthorized"
  | "stdin-policy"
  | "tls-policy";

export type FinishReason =
  | "cancelled"
  | "content-filter"
  | "max-output"
  | "stop"
  | "tool-calls";

/**
 * The subset of `budget-vector.schema.json` resources an adapter may observe.
 * `money-nano-minor` and every `maximum`-aggregated resource are absent by
 * construction: an adapter reports meters, never money.
 */
export type ReportableResource =
  | "audio-units"
  | "cached-input-units"
  | "image-units"
  | "input-units"
  | "output-units"
  | "provider-calls"
  | "reasoning-units"
  | "tool-calls"
  | "transport-bytes";

export type ResourceUnit = "byte" | "count" | "usage-unit";

/** Three of the seven public cost states of budget-semantics 7.5. */
export type BudgetCostState = "estimated" | "provider-reported" | "unknown";
export type UsageTrust = "adapter-conservative" | "provider-reported" | "unknown";

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

export interface AdapterBounds {
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxStreamFrameBytes: number;
  readonly maxStreamFrames: number;
  readonly maxToolDefinitions: number;
  readonly maxToolCallsPerResponse: number;
  readonly maxAttachments: number;
  readonly maxAttachmentBytes: number;
  readonly requestTimeoutMs: number;
}

export interface AdapterRetryPolicy {
  readonly maxAttempts: number;
  readonly initialBackoffMs: number;
  /** Growth factor in thousandths. Integer arithmetic only. */
  readonly backoffMultiplierMilli: number;
  readonly maxBackoffMs: number;
  /** Always false: a jittered schedule is not reproducible across runtimes. */
  readonly jitter: false;
}

export interface AdapterCircuitPolicy {
  readonly consecutiveFailureThreshold: number;
  readonly openDurationMs: number;
  readonly halfOpenProbeLimit: 1;
}

export interface AdapterCapture {
  readonly enabled: boolean;
  readonly retention: "none" | "operator-approved" | "run-scoped";
}

export interface ProviderMetricDeclaration {
  readonly metricId: string;
  readonly unitId: string;
  readonly aggregation: "sum";
}

export interface NetworkProfile {
  readonly allowedSchemes: readonly ("http" | "https")[];
  readonly allowedHosts: readonly string[];
  readonly allowedPorts: readonly number[];
  readonly allowRedirects: boolean;
  readonly redirectReauthorization: boolean;
  readonly rebindingDefense: boolean;
  readonly credentialIsolation: boolean;
  readonly tlsMinimumVersion: "TLSv1.2" | "TLSv1.3";
}

export interface ProcessProfile {
  readonly executablePath: string;
  readonly argumentVector: readonly string[];
  readonly workingDirectory: string;
  readonly environmentAllowlist: readonly string[];
  readonly stdinPolicy: "closed" | "explicit-bytes";
  /** Always false. There is no implicit shell. */
  readonly shellExpansion: false;
  readonly maxOutputBytes: number;
  readonly maxDurationMs: number;
  readonly maxProcesses: number;
  readonly maxMemoryBytes: number;
  readonly cancelSignal: "SIGKILL" | "SIGTERM";
}

export interface McpProfile {
  readonly serverId: string;
  readonly mode: "mutating" | "read-only";
  readonly allowedTools: readonly string[];
  readonly approvalRequired: boolean;
  readonly idempotencyRequired: boolean;
}

export interface AdapterDescriptor {
  readonly apiVersion: typeof ADAPTER_API_VERSION;
  readonly kind: "AdapterDescriptor";
  readonly contractVersion: typeof ADAPTER_CONTRACT_VERSION;
  readonly adapterId: string;
  readonly adapterKind: AdapterKind;
  readonly adapterVersion: string;
  readonly evidenceClass: AdapterEvidenceClass;
  readonly sideEffectClass: SideEffectClass;
  readonly capabilities: readonly AdapterCapability[];
  readonly bounds: AdapterBounds;
  readonly retryPolicy: AdapterRetryPolicy;
  readonly circuitPolicy: AdapterCircuitPolicy;
  readonly capture: AdapterCapture;
  readonly allowedProviderMetrics: readonly ProviderMetricDeclaration[];
  readonly network: NetworkProfile | null;
  readonly process: ProcessProfile | null;
  readonly mcp: McpProfile | null;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  readonly name: string;
  readonly requiredArguments: readonly string[];
  readonly allowedArguments: readonly string[];
}

export interface RequestAttachment {
  readonly bytes: number;
}

export interface EgressTarget {
  readonly scheme: string;
  readonly host: string;
  readonly port: number;
  readonly redirected: boolean;
  readonly reauthorized: boolean;
}

export interface McpCall {
  readonly tool: string;
  readonly mutating: boolean;
  readonly approvalToken: string | null;
}

export interface ProcessCall {
  readonly argumentVector: readonly string[];
  readonly environment: readonly string[];
  readonly stdinBytes: number;
}

export type CircuitState = "closed" | "half-open" | "open";

/**
 * The preflight view of a request. It carries only what the boundary rules of
 * adapter-semantics 4 and 5 read; payload content is deliberately absent so a
 * refusal can never quote a prompt.
 */
export interface AdapterRequest {
  readonly requestId: string;
  readonly sideEffectClass: SideEffectClass;
  readonly requiredCapabilities: readonly AdapterCapability[];
  readonly requestBytes: number;
  readonly attachments: readonly RequestAttachment[];
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly streaming: boolean;
  readonly structuredOutput: boolean;
  readonly cancellable: boolean;
  readonly idempotencyKey: string | null;
  readonly circuitState: CircuitState;
  readonly target: EgressTarget | null;
  readonly mcpCall: McpCall | null;
  readonly processCall: ProcessCall | null;
}

export interface PreflightOutcome {
  readonly admitted: true;
  readonly adapterId: string;
  readonly requestId: string;
  readonly sideEffectClass: SideEffectClass;
  readonly idempotencyKey: string | null;
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

export type StreamFrameKind = "finish" | "start" | "text-delta" | "tool-call" | "usage";

export interface StreamFrame {
  readonly sequence: number;
  readonly kind: StreamFrameKind;
  readonly bytes: number;
  readonly toolCallId?: string;
  readonly finishReason?: FinishReason;
}

export interface NormalizedStream {
  readonly frames: number;
  readonly textBytes: number;
  readonly toolCalls: number;
  readonly usageFrames: number;
  readonly finishReason: FinishReason | null;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface UsageQuantity {
  readonly resource: ReportableResource;
  readonly unit: ResourceUnit;
  readonly aggregation: "sum";
  readonly amount: number;
}

export interface ProviderQuantity {
  readonly metricId: string;
  readonly unitId: string;
  readonly aggregation: "sum";
  readonly amount: number;
}

export interface AdapterUsage {
  readonly apiVersion: typeof ADAPTER_API_VERSION;
  readonly kind: "AdapterUsage";
  readonly contractVersion: typeof ADAPTER_CONTRACT_VERSION;
  readonly adapterId: string;
  readonly adapterKind: AdapterKind;
  readonly requestId: string;
  readonly providerRequestId: string | null;
  readonly trust: UsageTrust;
  readonly budgetCostState: BudgetCostState;
  readonly finishReason: FinishReason | null;
  readonly quantities: readonly UsageQuantity[];
  readonly providerSpecific: readonly ProviderQuantity[];
}

export interface NormalizedUsage {
  readonly resources: number;
  readonly providerCalls: number | undefined;
  readonly budgetCostState: BudgetCostState;
}

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ToolCallResponse {
  readonly toolCalls: readonly ModelToolCall[];
  /** Authority comes from policy; a model-selected tool never grants it. */
  readonly authorizedTools: readonly string[];
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export interface ProviderSafeField {
  readonly name: string;
  readonly value: string;
}

export interface AdapterErrorDetail {
  readonly providerSafeFields: readonly ProviderSafeField[];
}

export interface AdapterErrorEnvelope {
  readonly apiVersion: typeof ADAPTER_API_VERSION;
  readonly kind: "AdapterError";
  readonly contractVersion: typeof ADAPTER_CONTRACT_VERSION;
  readonly adapterId: string;
  readonly adapterKind: AdapterKind;
  readonly requestId: string;
  readonly attempt: number;
  readonly code: AdapterErrorCode;
  readonly boundary: AdapterBoundary;
  readonly retryable: boolean;
  readonly effectDisposition: EffectDisposition;
  readonly usageDisposition: UsageDisposition;
  readonly sideEffectClass: SideEffectClass;
  readonly denialReason: DenialReason | null;
  readonly providerRequestId: string | null;
  readonly retryAfterMs: number | null;
  readonly message: string;
  readonly detail: AdapterErrorDetail;
  readonly usage: AdapterUsage | null;
}

export interface NormalizedErrorOutcome {
  readonly code: AdapterErrorCode;
  readonly ledgerAction: LedgerAction;
  /**
   * cycle-semantics 13.4: `none` creates no in-doubt evidence; an external
   * `idempotent` or `non-idempotent` claim retains one in-doubt identity.
   */
  readonly requiresInDoubtRecord: boolean;
}

// ---------------------------------------------------------------------------
// Retry and circuit decisions
// ---------------------------------------------------------------------------

export type RetryRule = "R-001" | "R-002" | "R-003" | "R-004" | "R-005" | "R-006";

export interface RetryDecision {
  readonly mayRetry: boolean;
  readonly backoffMs: number | null;
  readonly rule: RetryRule;
}

export type CircuitEvent = "advance" | "failure" | "success";

export interface CircuitStep {
  readonly event: CircuitEvent;
  readonly nowMs: number;
  readonly code?: AdapterErrorCode;
}

export interface CircuitProjection {
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly openedAtMs: number | null;
  readonly admitted: number;
  readonly refused: number;
}

/** The only source of time in this contract. There is no wall clock. */
export type InjectedClock = () => number;
