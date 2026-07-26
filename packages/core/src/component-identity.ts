import { createHash } from "node:crypto";
import {
  CanonicalizationError,
  canonicalSerialize,
  captureCanonicalJson,
  parseFrozenCanonicalJson,
} from "./canonical.js";
import {
  compileGraph,
  type CompilationResult,
  type CompilerDiagnostic,
  type DiagnosticCode,
} from "./compiler.js";
import type { GraphSpec } from "./types.js";

export const COMPILED_IDENTITY_API_VERSION =
  "graphengineering.reacher-z.github.io/compiled-identity/v1alpha1" as const;

const COMPONENT_DOMAIN = "graph-engineering/component/v1alpha1\0";
const REVISION_DOMAIN = "graph-engineering/revision/v1alpha1\0";

export type ComponentIdentityKind = "node" | "edge" | "schema";

export interface CompiledNodeIdentity {
  readonly id: string;
  readonly index: number;
  readonly contentHash: string;
  readonly inputSchemaHash: string;
  readonly outputSchemaHash: string;
}

export interface CompiledEdgeIdentity {
  readonly id: string;
  readonly index: number;
  readonly contentHash: string;
  readonly schemaHash: string | null;
}

export interface CompiledGraphSchemaIdentity {
  readonly input: string;
  readonly output: string;
  readonly state: string | null;
}

export interface CompiledGraphIdentity {
  readonly apiVersion: typeof COMPILED_IDENTITY_API_VERSION;
  readonly kind: "CompiledGraphIdentity";
  readonly graphRevision: 1;
  readonly graphHash: string;
  readonly nodes: readonly CompiledNodeIdentity[];
  readonly edges: readonly CompiledEdgeIdentity[];
  readonly graphSchemas: CompiledGraphSchemaIdentity;
  readonly revisionHash: string;
}

export interface IdentityVerificationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export class CompiledIdentityCreationError extends Error {
  readonly diagnostics: readonly CompilerDiagnostic[];

  constructor(diagnostics: readonly CompilerDiagnostic[]) {
    super("A compiled identity can only be created for a valid v1alpha1 graph");
    this.name = "CompiledIdentityCreationError";
    const captured = captureCanonicalJson(diagnostics);
    this.diagnostics = parseFrozenCanonicalJson<readonly CompilerDiagnostic[]>(captured.serialized);
  }
}

function sha256Domain(domain: string, value: string): string {
  return createHash("sha256").update(domain, "utf8").update(value, "utf8").digest("hex");
}

/** Domain-separated hash of one detached node, edge, or schema value. */
export function componentHash(kind: ComponentIdentityKind, value: unknown): string {
  if (kind !== "node" && kind !== "edge" && kind !== "schema") {
    throw new TypeError("Component identity kind must be 'node', 'edge', or 'schema'");
  }
  return sha256Domain(`${COMPONENT_DOMAIN}${kind}\0`, canonicalSerialize(value));
}

function identityDiagnostic(
  code: Extract<
    DiagnosticCode,
    | "GE1301_UNSUPPORTED_GRAPH_REVISION"
    | "GE1302_GRAPH_IDENTITY_MISMATCH"
    | "GE1303_COMPONENT_IDENTITY_MISMATCH"
  >,
  message: string,
  path: string,
): CompilerDiagnostic {
  return Object.freeze({ code, severity: "error", message, path });
}

function invalidVerification(diagnostic: CompilerDiagnostic): IdentityVerificationResult {
  return Object.freeze({ valid: false, diagnostics: Object.freeze([diagnostic]) });
}

function snapshotCompiledGraph(compilation: CompilationResult): {
  readonly graph: GraphSpec;
  readonly graphHash: string;
} {
  if (!compilation.valid || compilation.canonicalGraph === null || compilation.graphHash === null) {
    throw new CompiledIdentityCreationError(compilation.diagnostics);
  }

  // The compiler canonical string and hash were produced from one detached
  // capture. Rehydrate only those bytes so component identities cannot observe
  // later caller mutation or execute caller-owned accessors.
  const graph = captureCanonicalJson(JSON.parse(compilation.canonicalGraph)).value as unknown as GraphSpec;
  return Object.freeze({ graph, graphHash: compilation.graphHash });
}

/**
 * Bind an identity to an already completed compiler capture. Kept out of the
 * package barrel because authoring consumers should normally use the graph API;
 * the builder uses it to uphold the exactly-one-compilation invariant.
 */
export function createCompiledGraphIdentityFromCompilation(
  compilation: CompilationResult,
): CompiledGraphIdentity {
  const { graph, graphHash } = snapshotCompiledGraph(compilation);
  return createIdentityFromSnapshot(graph, graphHash);
}

/** Build the immutable, revision-1 component identity for a valid graph. */
export function createCompiledGraphIdentity(
  document: GraphSpec | unknown,
): CompiledGraphIdentity {
  return createCompiledGraphIdentityFromCompilation(compileGraph(document));
}

function createIdentityFromSnapshot(
  graph: GraphSpec,
  graphHash: string,
): CompiledGraphIdentity {
  const unsigned = {
    apiVersion: COMPILED_IDENTITY_API_VERSION,
    kind: "CompiledGraphIdentity" as const,
    graphRevision: 1 as const,
    graphHash,
    nodes: graph.nodes.map((node, index) => ({
      id: node.id,
      index,
      contentHash: componentHash("node", node),
      inputSchemaHash: componentHash("schema", node.inputSchema),
      outputSchemaHash: componentHash("schema", node.outputSchema),
    })),
    edges: graph.edges.map((edge, index) => ({
      id: edge.id,
      index,
      contentHash: componentHash("edge", edge),
      schemaHash: edge.schema === undefined ? null : componentHash("schema", edge.schema),
    })),
    graphSchemas: {
      input: componentHash("schema", graph.inputSchema),
      output: componentHash("schema", graph.outputSchema),
      state: graph.stateSchema === undefined ? null : componentHash("schema", graph.stateSchema),
    },
  };
  const identity = {
    ...unsigned,
    revisionHash: sha256Domain(REVISION_DOMAIN, canonicalSerialize(unsigned)),
  };
  return parseFrozenCanonicalJson<CompiledGraphIdentity>(canonicalSerialize(identity));
}

/**
 * Verify a candidate revision-1 manifest by recomputing every component in
 * declaration order. This verifier intentionally does not create revision 2.
 */
export function verifyCompiledGraphIdentity(
  document: GraphSpec | unknown,
  candidate: CompiledGraphIdentity | unknown,
): IdentityVerificationResult {
  let capturedCandidate: ReturnType<typeof captureCanonicalJson>;
  try {
    capturedCandidate = captureCanonicalJson(candidate);
  } catch (error) {
    const isRevisionIntegerFailure =
      error instanceof CanonicalizationError && error.path === "#/graphRevision";
    return invalidVerification(
      isRevisionIntegerFailure
        ? identityDiagnostic(
          "GE1301_UNSUPPORTED_GRAPH_REVISION",
          "Compiled graph identity revision must be the safe integer 1",
          "#/graphRevision",
        )
        : identityDiagnostic(
          "GE1303_COMPONENT_IDENTITY_MISMATCH",
          "Compiled graph identity is not portable canonical JSON",
          "#",
        ),
    );
  }

  const value = capturedCandidate.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidVerification(
      identityDiagnostic(
        "GE1303_COMPONENT_IDENTITY_MISMATCH",
        "Compiled graph identity must be an object",
        "#",
      ),
    );
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (record.graphRevision !== 1) {
    return invalidVerification(
      identityDiagnostic(
        "GE1301_UNSUPPORTED_GRAPH_REVISION",
        "Only initial graph revision 1 is supported",
        "#/graphRevision",
      ),
    );
  }

  let expected: CompiledGraphIdentity;
  try {
    expected = createCompiledGraphIdentityFromCompilation(compileGraph(document));
  } catch (error) {
    if (error instanceof CompiledIdentityCreationError) {
      return Object.freeze({ valid: false, diagnostics: error.diagnostics });
    }
    return invalidVerification(
      identityDiagnostic(
        "GE1302_GRAPH_IDENTITY_MISMATCH",
        "Graph identity verification could not be completed safely",
        "#",
      ),
    );
  }

  if (record.graphHash !== expected.graphHash) {
    return invalidVerification(
      identityDiagnostic(
        "GE1302_GRAPH_IDENTITY_MISMATCH",
        "Compiled identity graphHash does not match the graph",
        "#/graphHash",
      ),
    );
  }
  if (capturedCandidate.serialized !== canonicalSerialize(expected)) {
    return invalidVerification(
      identityDiagnostic(
        "GE1303_COMPONENT_IDENTITY_MISMATCH",
        "Compiled component identities, declaration order, or revisionHash do not match",
        "#",
      ),
    );
  }
  return Object.freeze({ valid: true, diagnostics: Object.freeze([]) });
}
