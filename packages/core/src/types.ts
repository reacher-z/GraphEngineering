/** The JSON Schema subset is deliberately represented without a validator dependency. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export type NodeKind =
  | "agent"
  | "model"
  | "tool"
  | "transform"
  | "subgraph"
  | "router"
  | "barrier"
  | "validator"
  | "human";

export type EdgeMode = "value" | "stream" | "artifact-ref";
export type SideEffectMode = "none" | "idempotent" | "non-idempotent";

export interface GraphMetadata {
  name: string;
  version: string;
  description?: string;
  labels?: Readonly<Record<string, string>>;
}

export interface Endpoint {
  node: string;
  port?: string;
}

export interface RetryPolicy {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
}

export interface NodeSpec {
  id: string;
  kind: NodeKind;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  config: unknown;
  retry?: RetryPolicy;
  timeoutMs?: number;
  cache?: Readonly<Record<string, unknown>>;
  resources?: Readonly<Record<string, unknown>>;
  isolation?: Readonly<Record<string, unknown>>;
  sideEffects?: SideEffectMode;
}

export interface EdgeSpec {
  id: string;
  from: Endpoint;
  to: Endpoint;
  map?: Readonly<Record<string, unknown>>;
  condition?: Readonly<Record<string, unknown>>;
  mode?: EdgeMode;
  schema?: JsonSchema;
}

export interface GraphPolicies extends Readonly<Record<string, unknown>> {
  maxConcurrency?: number;
  maxDynamicNodes?: number;
  maxDepth?: number;
  maxFanOut?: number;
  maxTotalAttempts?: number;
  maxDurationMs?: number;
  maxCostUsd?: number;
}

/**
 * Language-neutral Graph Engineering v1alpha1 intermediate representation.
 *
 * `entrypoints` are the only nodes which receive graph input directly. Named
 * graph `outputs` make terminal values explicit instead of relying on an
 * implementation-specific sink-node convention.
 */
export interface GraphSpec {
  apiVersion: "graphengineering.reacher-z.github.io/v1alpha1";
  kind: "Graph";
  metadata: GraphMetadata;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  stateSchema?: JsonSchema;
  entrypoints: readonly string[];
  outputs: Readonly<Record<string, Endpoint>>;
  nodes: readonly NodeSpec[];
  edges: readonly EdgeSpec[];
  policies?: GraphPolicies;
}
