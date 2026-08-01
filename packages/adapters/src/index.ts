/**
 * `@graph-engineering/adapters` — the provider and tool adapter boundary of
 * `adapter-contract/v1alpha1`.
 *
 * Three adapters ship here: the deterministic mock (fully featured), the
 * generic HTTP tool adapter (transport injected, no network fallback) and the
 * shell adapter (declaration and argument construction only — execution
 * refuses while no isolation provider exists).
 *
 * No OpenAI, Anthropic or Gemini client exists in this package. Those kinds
 * name intended boundary shapes in the contract; no request has ever been sent
 * to any of them by this code.
 */

export * from "./types.js";
export {
  ADAPTER_CAPABILITIES,
  ADAPTER_ERROR_CODES,
  ADAPTER_KINDS,
  CAPABILITY_GATED_RESOURCES,
  CAPABILITY_IMPLICATIONS,
  DENIAL_REASONS,
  FINISH_REASONS,
  MOCK_ONLY_CAPABILITIES,
  MODEL_ADAPTER_KINDS,
  REPORTABLE_RESOURCES,
  RESOURCE_UNITS,
  SIDE_EFFECT_ORDER,
  STREAM_FRAME_KINDS,
  TAXONOMY_FACTS,
  USAGE_UNIT_RESOURCES,
  deriveBudgetCostState,
  deriveLedgerAction,
  deriveUsageDisposition,
  escalatesSideEffect,
  isNonRoutableHost,
  requiresInDoubtRecord,
  sideEffectPermitsRetry,
  taxonomyFacts,
  type TaxonomyFacts,
} from "./contract.js";
export { AdapterContractError, fail, isAdapterContractError } from "./errors.js";
export { compareUnicodeCodePoints, isSortedByCodePoint, sortByCodePoint } from "./ordering.js";
export {
  validateDescriptor,
  validateDescriptorAgainstBudgetPolicy,
} from "./descriptor.js";
export { capabilityFailureMessage, preflight } from "./preflight.js";
export { normalizeStream } from "./stream.js";
export { composeUsage, validateUsage, type UsageDraft } from "./usage.js";
export { validateToolCalls, type NormalizedToolCalls } from "./tools.js";
export {
  normalizedAdapterError,
  validateErrorEnvelope,
  type AdapterErrorInput,
} from "./envelope.js";
export { computedBackoffMs, retryDecision } from "./retry.js";
export { CircuitBreaker, circuitFold } from "./circuit.js";
export {
  envelopeFromContractError,
  isAborted,
  ok,
  refused,
  runPreflight,
  type Adapter,
  type AdapterBaseOptions,
  type AdapterCallOptions,
  type AdapterOutcome,
  type AdapterResponse,
  type AdapterStream,
  type StreamingAdapter,
} from "./adapter.js";
export {
  MockAdapter,
  createMockAdapter,
  type MockAdapterOptions,
  type MockOutcome,
} from "./mock-adapter.js";
export {
  DEFAULT_HTTP_STATUS_CODES,
  HttpAdapter,
  classifyHttpStatus,
  createHttpAdapter,
  parseRetryAfterMs,
  type HttpAdapterOptions,
  type HttpCallSpec,
  type HttpFetch,
  type HttpRequestInit,
  type HttpRequestPlan,
  type HttpResponseLike,
} from "./http-adapter.js";
export {
  SHELL_EXECUTION_BLOCKING_TASK,
  SHELL_EXECUTION_CAPABILITY_DOMAIN,
  SHELL_EXECUTION_DENIAL_REASON,
  SHELL_EXECUTION_ISOLATION_CODE,
  ShellAdapter,
  createShellAdapter,
  type ProcessLaunchPlan,
  type ProcessLaunchSpec,
  type ShellAdapterOptions,
} from "./shell-adapter.js";
export {
  AdapterDispatchError,
  createAdapterExecutor,
  type AdapterExecutorContext,
  type AdapterExecutorOptions,
} from "./executor.js";
