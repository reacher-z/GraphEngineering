import { canonicalSerialize, type CompilationResult, type CompilerDiagnostic, type GraphSpec } from "@graph-engineering/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { STRUCTURED_CONTENT_VERSION } from "./constants.js";
import { compileGraphBounded, type McpIssue } from "./limits.js";
import { getBundledGraphSchema } from "./schema.js";

const issueSchema = z
  .object({
    code: z.enum([
      "MCP_INPUT_TOO_LARGE",
      "MCP_GRAPH_TOO_LARGE",
      "MCP_TOOL_TIMEOUT",
      "MCP_REQUEST_CANCELLED",
      "MCP_INTERNAL_ERROR",
    ]),
    message: z.string(),
  })
  .nullable();

const diagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  path: z.string().nullable(),
  nodeIds: z.array(z.string()),
  edgeId: z.string().nullable(),
});

export const graphInputSchema = z.strictObject({
  graph: z.unknown().describe("A Graph Engineering Graph IR JSON value"),
});

export const emptyInputSchema = z.strictObject({});

export const validationOutputSchema = z.object({
  schemaVersion: z.literal(STRUCTURED_CONTENT_VERSION),
  valid: z.boolean(),
  graphHash: z.string().nullable(),
  diagnosticCodes: z.array(z.string()),
  diagnostics: z.array(diagnosticSchema),
  issue: issueSchema,
});

export const planOutputSchema = z.object({
  schemaVersion: z.literal(STRUCTURED_CONTENT_VERSION),
  valid: z.boolean(),
  graphHash: z.string().nullable(),
  graphName: z.string().nullable(),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  layerCount: z.number().int().nonnegative(),
  maxParallelWidth: z.number().int().nonnegative(),
  configuredMaxConcurrency: z.number().int().positive().nullable(),
  topologicalLayers: z.array(z.array(z.string())),
  diagnosticCodes: z.array(z.string()),
  diagnostics: z.array(diagnosticSchema),
  issue: issueSchema,
});

export const schemaOutputSchema = z.object({
  schemaVersion: z.literal(STRUCTURED_CONTENT_VERSION),
  apiVersion: z.string().nullable(),
  uri: z.string().nullable(),
  schemaId: z.string().nullable(),
  canonicalSha256: z.string().nullable(),
  schema: z.record(z.string(), z.unknown()).nullable(),
  issue: issueSchema,
});

export interface NormalizedDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  path: string | null;
  nodeIds: string[];
  edgeId: string | null;
}

function normalizeDiagnostics(diagnostics: readonly CompilerDiagnostic[]): NormalizedDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    path: diagnostic.path ?? null,
    nodeIds: diagnostic.nodeIds === undefined ? [] : [...diagnostic.nodeIds],
    edgeId: diagnostic.edgeId ?? null,
  }));
}

function diagnosticCodes(diagnostics: readonly CompilerDiagnostic[]): string[] {
  return [...new Set(diagnostics.map((diagnostic) => diagnostic.code))];
}

function toolResult(structuredContent: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: canonicalSerialize(structuredContent) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function validationRecord(compilation: CompilationResult): Record<string, unknown> {
  return {
    schemaVersion: STRUCTURED_CONTENT_VERSION,
    valid: compilation.valid,
    graphHash: compilation.graphHash,
    diagnosticCodes: diagnosticCodes(compilation.diagnostics),
    diagnostics: normalizeDiagnostics(compilation.diagnostics),
    issue: null,
  };
}

function compilationIssueRecord(issue: McpIssue): Record<string, unknown> {
  return {
    schemaVersion: STRUCTURED_CONTENT_VERSION,
    valid: false,
    graphHash: null,
    diagnosticCodes: [],
    diagnostics: [],
    issue,
  };
}

export async function graphValidate(graph: unknown, signal?: AbortSignal): Promise<CallToolResult> {
  const bounded = await compileGraphBounded(graph, signal);
  return bounded.ok
    ? toolResult(validationRecord(bounded.compilation))
    : toolResult(compilationIssueRecord(bounded.issue), true);
}

export async function graphPlan(graph: unknown, signal?: AbortSignal): Promise<CallToolResult> {
  const bounded = await compileGraphBounded(graph, signal);
  if (!bounded.ok) {
    return toolResult(
      {
        ...compilationIssueRecord(bounded.issue),
        graphName: null,
        nodeCount: 0,
        edgeCount: 0,
        layerCount: 0,
        maxParallelWidth: 0,
        configuredMaxConcurrency: null,
        topologicalLayers: [],
      },
      true,
    );
  }
  const { compilation } = bounded;
  if (!compilation.valid) {
    return toolResult({
      ...validationRecord(compilation),
      graphName: null,
      nodeCount: 0,
      edgeCount: 0,
      layerCount: 0,
      maxParallelWidth: 0,
      configuredMaxConcurrency: null,
      topologicalLayers: [],
    });
  }

  const value = graph as GraphSpec;
  const layers = compilation.topologicalLayers.map((layer) => [...layer]);
  return toolResult({
    ...validationRecord(compilation),
    graphName: value.metadata.name,
    nodeCount: value.nodes.length,
    edgeCount: value.edges.length,
    layerCount: layers.length,
    maxParallelWidth: Math.max(0, ...layers.map((layer) => layer.length)),
    configuredMaxConcurrency: value.policies?.maxConcurrency ?? null,
    topologicalLayers: layers,
  });
}

export async function graphGetSchema(): Promise<CallToolResult> {
  try {
    const bundled = await getBundledGraphSchema();
    return toolResult({
      schemaVersion: STRUCTURED_CONTENT_VERSION,
      apiVersion: bundled.apiVersion,
      uri: bundled.uri,
      schemaId: bundled.schemaId,
      canonicalSha256: bundled.canonicalSha256,
      schema: bundled.schema,
      issue: null,
    });
  } catch (error) {
    return toolResult(
      {
        schemaVersion: STRUCTURED_CONTENT_VERSION,
        apiVersion: null,
        uri: null,
        schemaId: null,
        canonicalSha256: null,
        schema: null,
        issue: {
          code: "MCP_INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Could not load bundled Graph IR schema",
        },
      },
      true,
    );
  }
}
