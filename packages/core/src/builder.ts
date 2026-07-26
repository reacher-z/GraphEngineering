import {
  CanonicalizationError,
  captureCanonicalJson,
  parseFrozenCanonicalJson,
} from "./canonical.js";
import {
  createCompiledGraphIdentityFromCompilation,
  type CompiledGraphIdentity,
} from "./component-identity.js";
import { compileGraph, type CompilerDiagnostic } from "./compiler.js";
import {
  validateEdgeDocument,
  validateEndpointDocument,
  validateMetadataDocument,
  validateNodeDocument,
  validatePoliciesDocument,
} from "./schema-validation.js";
import {
  STRICT_TYPED_PORTS_POLICY,
  STRICT_TYPED_PORTS_POLICY_KEY,
} from "./typed-ports.js";
import type {
  EdgeSpec,
  Endpoint,
  GraphMetadata,
  GraphPolicies,
  GraphSpec,
  JsonSchema,
  NodeSpec,
} from "./types.js";

export type GraphBuilderErrorCode =
  | "GE_BUILDER_INVALID_INPUT"
  | "GE_BUILDER_DUPLICATE_NODE"
  | "GE_BUILDER_DUPLICATE_EDGE"
  | "GE_BUILDER_DUPLICATE_ENTRYPOINT"
  | "GE_BUILDER_DUPLICATE_OUTPUT"
  | "GE_BUILDER_MISSING_REQUIRED"
  | "GE_BUILDER_CORE_REJECTED"
  | "GE_BUILDER_SEALED";

export interface GraphBuilderErrorProjection {
  readonly code: GraphBuilderErrorCode;
  readonly message: string;
  readonly path: string;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export class GraphBuilderError extends Error implements GraphBuilderErrorProjection {
  readonly code: GraphBuilderErrorCode;
  readonly path: string;
  readonly diagnostics: readonly CompilerDiagnostic[];

  constructor(
    code: GraphBuilderErrorCode,
    message: string,
    path: string,
    diagnostics: readonly CompilerDiagnostic[] = [],
  ) {
    super(message);
    this.name = "GraphBuilderError";
    this.code = code;
    this.path = path;
    const captured = captureCanonicalJson(diagnostics);
    this.diagnostics = parseFrozenCanonicalJson<readonly CompilerDiagnostic[]>(captured.serialized);
  }

  toJSON(): GraphBuilderErrorProjection {
    return Object.freeze({
      code: this.code,
      message: this.message,
      path: this.path,
      diagnostics: this.diagnostics,
    });
  }
}

export interface GraphBuilderOptions {
  readonly metadata: GraphMetadata;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly stateSchema?: JsonSchema;
  readonly policies?: GraphPolicies;
}

export interface BuiltGraph {
  readonly graph: GraphSpec;
  readonly canonicalGraph: string;
  readonly graphHash: string;
  readonly identity: CompiledGraphIdentity;
}

const BUILDER_OPTION_KEYS = new Set([
  "metadata",
  "inputSchema",
  "outputSchema",
  "stateSchema",
  "policies",
]);

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childPath(base: string, capturedPath: string): string {
  if (capturedPath === "#") return base;
  return `${base}${capturedPath.slice(1)}`;
}

function snapshot<T>(value: unknown, path: string): T {
  try {
    return captureCanonicalJson(value).value as unknown as T;
  } catch (error) {
    const failurePath = error instanceof CanonicalizationError
      ? childPath(path, error.path)
      : path;
    throw new GraphBuilderError(
      "GE_BUILDER_INVALID_INPUT",
      "Builder input must be detached portable canonical JSON",
      failurePath,
    );
  }
}

function invalidInput(message: string, path: string): never {
  throw new GraphBuilderError("GE_BUILDER_INVALID_INPUT", message, path);
}

function requireValidFragment(
  issues: readonly string[],
  message: string,
  path: string,
): void {
  if (issues.length > 0) invalidInput(message, path);
}

function outputRecord(entries: readonly (readonly [string, Endpoint])[]): Readonly<Record<string, Endpoint>> {
  const outputs = Object.create(null) as Record<string, Endpoint>;
  for (const [name, endpoint] of entries) {
    Object.defineProperty(outputs, name, {
      value: endpoint,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(outputs);
}

/** General, inference-free authoring builder for the current v1alpha1 Graph IR. */
export class GraphBuilder {
  readonly #metadata: GraphMetadata;
  readonly #inputSchema: JsonSchema;
  readonly #outputSchema: JsonSchema;
  readonly #stateSchema: JsonSchema | undefined;
  #policies: GraphPolicies | undefined;
  readonly #nodes: NodeSpec[] = [];
  readonly #edges: EdgeSpec[] = [];
  readonly #entrypoints: string[] = [];
  readonly #outputs: [string, Endpoint][] = [];
  readonly #nodeIds = new Set<string>();
  readonly #edgeIds = new Set<string>();
  readonly #entrypointIds = new Set<string>();
  readonly #outputNames = new Set<string>();
  #sealed = false;

  constructor(options: GraphBuilderOptions | unknown) {
    const captured = snapshot<Readonly<Record<string, unknown>>>(options, "#");
    if (!record(captured)) invalidInput("Builder options must be an object", "#");
    for (const key of Object.keys(captured)) {
      if (!BUILDER_OPTION_KEYS.has(key)) {
        invalidInput(`Unknown builder option '${key}'`, `#/${key}`);
      }
    }
    for (const key of ["metadata", "inputSchema", "outputSchema"] as const) {
      if (!Object.hasOwn(captured, key)) {
        throw new GraphBuilderError(
          "GE_BUILDER_MISSING_REQUIRED",
          `Builder option '${key}' is required`,
          `#/${key}`,
        );
      }
    }
    if (!record(captured.metadata)) invalidInput("metadata must be an object", "#/metadata");
    if (!record(captured.inputSchema)) invalidInput("inputSchema must be an object", "#/inputSchema");
    if (!record(captured.outputSchema)) invalidInput("outputSchema must be an object", "#/outputSchema");
    if (captured.stateSchema !== undefined && !record(captured.stateSchema)) {
      invalidInput("stateSchema must be an object when present", "#/stateSchema");
    }
    if (captured.policies !== undefined && !record(captured.policies)) {
      invalidInput("policies must be an object when present", "#/policies");
    }
    requireValidFragment(
      validateMetadataDocument(captured.metadata),
      "metadata must be a valid Graph IR metadata object",
      "#/metadata",
    );
    if (captured.policies !== undefined) {
      requireValidFragment(
        validatePoliciesDocument(captured.policies),
        "policies must be a valid Graph IR policy object",
        "#/policies",
      );
    }
    this.#metadata = captured.metadata as unknown as GraphMetadata;
    this.#inputSchema = captured.inputSchema as JsonSchema;
    this.#outputSchema = captured.outputSchema as JsonSchema;
    this.#stateSchema = captured.stateSchema as JsonSchema | undefined;
    this.#policies = captured.policies as GraphPolicies | undefined;
  }

  #assertOpen(path = "#"): void {
    if (this.#sealed) {
      throw new GraphBuilderError(
        "GE_BUILDER_SEALED",
        "Graph builder is sealed after build()",
        path,
      );
    }
  }

  addNode(value: NodeSpec | unknown): this {
    this.#assertOpen(`#/nodes/${this.#nodes.length}`);
    const path = `#/nodes/${this.#nodes.length}`;
    const node = snapshot<NodeSpec>(value, path);
    requireValidFragment(
      validateNodeDocument(node, this.#nodes.length),
      "Node must be a valid Graph IR node object",
      path,
    );
    if (this.#nodeIds.has(node.id)) {
      throw new GraphBuilderError(
        "GE_BUILDER_DUPLICATE_NODE",
        `Node id '${node.id}' is already present`,
        `${path}/id`,
      );
    }
    this.#nodeIds.add(node.id);
    this.#nodes.push(node);
    return this;
  }

  addEdge(value: EdgeSpec | unknown): this {
    this.#assertOpen(`#/edges/${this.#edges.length}`);
    const path = `#/edges/${this.#edges.length}`;
    const edge = snapshot<EdgeSpec>(value, path);
    requireValidFragment(
      validateEdgeDocument(edge, this.#edges.length),
      "Edge must be a valid Graph IR edge object",
      path,
    );
    if (this.#edgeIds.has(edge.id)) {
      throw new GraphBuilderError(
        "GE_BUILDER_DUPLICATE_EDGE",
        `Edge id '${edge.id}' is already present`,
        `${path}/id`,
      );
    }
    this.#edgeIds.add(edge.id);
    this.#edges.push(edge);
    return this;
  }

  addEntrypoint(nodeId: string): this {
    const path = `#/entrypoints/${this.#entrypoints.length}`;
    this.#assertOpen(path);
    if (typeof nodeId !== "string" || nodeId.length === 0) {
      invalidInput("Entrypoint must be a non-empty string", path);
    }
    if (this.#entrypointIds.has(nodeId)) {
      throw new GraphBuilderError(
        "GE_BUILDER_DUPLICATE_ENTRYPOINT",
        `Entrypoint '${nodeId}' is already present`,
        path,
      );
    }
    this.#entrypointIds.add(nodeId);
    this.#entrypoints.push(nodeId);
    return this;
  }

  addOutput(name: string, value: Endpoint | unknown): this {
    const path = `#/outputs/${typeof name === "string" ? name.replaceAll("~", "~0").replaceAll("/", "~1") : ""}`;
    this.#assertOpen(path);
    if (typeof name !== "string") invalidInput("Output name must be a string", "#/outputs");
    if (this.#outputNames.has(name)) {
      throw new GraphBuilderError(
        "GE_BUILDER_DUPLICATE_OUTPUT",
        `Output '${name}' is already present`,
        path,
      );
    }
    const endpoint = snapshot<Endpoint>(value, path);
    requireValidFragment(
      validateEndpointDocument(endpoint, path),
      "Output endpoint must be a valid Graph IR endpoint object",
      path,
    );
    this.#outputNames.add(name);
    this.#outputs.push([name, endpoint]);
    return this;
  }

  /** Replace the complete graph policy object with one detached snapshot. */
  setPolicies(value: GraphPolicies | unknown): this {
    this.#assertOpen("#/policies");
    const policies = snapshot<GraphPolicies>(value, "#/policies");
    requireValidFragment(
      validatePoliciesDocument(policies),
      "policies must be a valid Graph IR policy object",
      "#/policies",
    );
    this.#policies = policies;
    return this;
  }

  enableStrictTypedPorts(): this {
    this.#assertOpen("#/policies");
    if (
      this.#policies !== undefined &&
      Object.hasOwn(this.#policies, STRICT_TYPED_PORTS_POLICY_KEY)
    ) {
      invalidInput(
        "Strict typed-port policy is already configured and will not be overwritten",
        "#/policies/graphengineering.reacher-z.github.io~1typed-ports",
      );
    }
    const policies = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(this.#policies ?? {})) {
      Object.defineProperty(policies, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    Object.defineProperty(policies, STRICT_TYPED_PORTS_POLICY_KEY, {
      value: STRICT_TYPED_PORTS_POLICY,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    this.#policies = snapshot<GraphPolicies>(policies, "#/policies");
    return this;
  }

  build(): BuiltGraph {
    this.#assertOpen("#");
    this.#sealed = true;
    if (this.#entrypoints.length === 0) {
      throw new GraphBuilderError(
        "GE_BUILDER_MISSING_REQUIRED",
        "At least one explicit entrypoint is required",
        "#/entrypoints",
      );
    }
    if (this.#outputs.length === 0) {
      throw new GraphBuilderError(
        "GE_BUILDER_MISSING_REQUIRED",
        "At least one explicit public output is required",
        "#/outputs",
      );
    }

    const candidate: Record<string, unknown> = {
      apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
      kind: "Graph",
      metadata: this.#metadata,
      inputSchema: this.#inputSchema,
      outputSchema: this.#outputSchema,
      entrypoints: [...this.#entrypoints],
      outputs: outputRecord(this.#outputs),
      nodes: [...this.#nodes],
      edges: [...this.#edges],
    };
    if (this.#stateSchema !== undefined) candidate.stateSchema = this.#stateSchema;
    if (this.#policies !== undefined) candidate.policies = this.#policies;

    const compilation = compileGraph(candidate);
    if (!compilation.valid || compilation.canonicalGraph === null || compilation.graphHash === null) {
      throw new GraphBuilderError(
        "GE_BUILDER_CORE_REJECTED",
        "Core compiler rejected the constructed graph",
        "#",
        compilation.diagnostics,
      );
    }
    const graph = parseFrozenCanonicalJson<GraphSpec>(compilation.canonicalGraph);
    return Object.freeze({
      graph,
      canonicalGraph: compilation.canonicalGraph,
      graphHash: compilation.graphHash,
      identity: createCompiledGraphIdentityFromCompilation(compilation),
    });
  }
}

export function graphBuilder(options: GraphBuilderOptions | unknown): GraphBuilder {
  return new GraphBuilder(options);
}
