import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GRAPH_SCHEMA_URI,
  SERVER_NAME,
  SERVER_VERSION,
} from "./constants.js";
import { getBundledGraphSchema } from "./schema.js";
import {
  emptyInputSchema,
  graphGetSchema,
  graphInputSchema,
  graphPlan,
  graphValidate,
  planOutputSchema,
  schemaOutputSchema,
  validationOutputSchema,
} from "./tools.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createGraphEngineeringMcpServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Read-only Graph Engineering pre-alpha server. It validates and plans supplied Graph IR " +
        "and returns one bundled schema. It cannot execute graphs, call models, access arbitrary " +
        "paths, run shell commands, persist runs, or mutate state.",
    },
  );

  server.registerTool(
    "graph_validate",
    {
      title: "Validate Graph IR",
      description: "Compile supplied Graph IR and return the canonical core hash and diagnostics without executing it.",
      inputSchema: graphInputSchema,
      outputSchema: validationOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ graph }, extra) => await graphValidate(graph, extra.signal),
  );

  server.registerTool(
    "graph_plan",
    {
      title: "Plan Graph IR",
      description:
        "For valid supplied Graph IR, return deterministic core layers, parallel width, and configured concurrency without execution.",
      inputSchema: graphInputSchema,
      outputSchema: planOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ graph }, extra) => await graphPlan(graph, extra.signal),
  );

  server.registerTool(
    "graph_get_schema",
    {
      title: "Get Graph IR Schema",
      description: "Return the bundled, versioned v1alpha1 Graph IR schema. This tool accepts no path or URI argument.",
      inputSchema: emptyInputSchema,
      outputSchema: schemaOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => await graphGetSchema(),
  );

  server.registerResource(
    "graph-schema-v1alpha1",
    GRAPH_SCHEMA_URI,
    {
      title: "Graph Engineering Graph IR v1alpha1 schema",
      description: "Bundled read-only JSON Schema for the supported Graph IR version",
      mimeType: "application/schema+json",
    },
    async (uri) => {
      const bundled = await getBundledGraphSchema();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/schema+json",
            text: JSON.stringify(bundled.schema, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
