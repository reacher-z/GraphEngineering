import {
  compileGraph,
  type CompilerDiagnostic,
  type DiagnosticCode,
  type GraphSpec,
} from "@graph-engineering/core";

export type CliDiagnosticCode = DiagnosticCode;
export type CliDiagnostic = CompilerDiagnostic;

/**
 * The CLI's read-only view of a core compilation.
 *
 * Hashing, canonicalization, structural checks, semantic checks, diagnostics,
 * and topology are all produced by @graph-engineering/core. The CLI keeps the
 * values intact and only adds presentation-friendly aliases.
 */
export interface ValidationResult {
  valid: boolean;
  graph: GraphSpec | null;
  graphName?: string;
  canonicalSha256: string | null;
  canonicalGraph: string | null;
  topologicalLayers: readonly (readonly string[])[];
  diagnostics: readonly CliDiagnostic[];
  diagnosticCodes: readonly CliDiagnosticCode[];
}

function uniqueCodes(diagnostics: readonly CliDiagnostic[]): CliDiagnosticCode[] {
  return [...new Set(diagnostics.map((item) => item.code))];
}

/** Compile an untrusted JSON value through the canonical core compiler. */
export function validateGraphDocument(value: unknown): ValidationResult {
  const compilation = compileGraph(value);
  const graph = compilation.valid ? (value as GraphSpec) : null;

  return {
    valid: compilation.valid,
    graph,
    ...(graph === null ? {} : { graphName: graph.metadata.name }),
    canonicalSha256: compilation.graphHash,
    canonicalGraph: compilation.canonicalGraph,
    topologicalLayers: compilation.topologicalLayers,
    diagnostics: compilation.diagnostics,
    diagnosticCodes: uniqueCodes(compilation.diagnostics),
  };
}
