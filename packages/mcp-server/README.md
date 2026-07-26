# `@graph-engineering/mcp-server`

A deliberately read-only, local stdio MCP server for inspecting Graph
Engineering Graph IR. This is an early-alpha package; it does not execute graphs.

The package pins the current stable `@modelcontextprotocol/sdk` v1 release
(`1.29.0`) and follows its high-level `McpServer`, structured tool output, static
resource, and `StdioServerTransport` APIs. Zod v4 validates every tool argument
and structured result. The dependency is pinned rather than following the MCP SDK
v2 prerelease line implicitly.

The SDK currently declares an `@hono/node-server` v1 dependency with a moderate
Windows static-file advisory. That HTTP adapter is unreachable from this
stdio-only server, and the workspace lock overrides it to patched v2.0.12 so a
source checkout audits cleanly. Overrides do not propagate to npm consumers, so
the standalone MCP package will not be published until the SDK ships a compatible
fix or a separate packaging review records an equally safe resolution.

## Exposed surface

Exactly three tools are registered:

| Tool | Strict input | Structured result |
| --- | --- | --- |
| `graph_validate` | `{ "graph": <Graph IR> }` | Core validity, canonical graph hash, diagnostic codes, normalized diagnostics, limit issue |
| `graph_plan` | `{ "graph": <Graph IR> }` | The validation result plus graph name, node/edge counts, core topological layers, maximum parallel width, and configured concurrency |
| `graph_get_schema` | `{}` | The bundled v1alpha1 schema, fixed URI/ID, API version, and canonical schema hash |

Every tool advertises `readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true`, and `openWorldHint: false`. All successful structured
results include:

```json
{
  "schemaVersion": "graph-engineering.mcp/v1alpha1",
  "issue": null
}
```

Limit/cancellation failures use the same result family with a stable `issue`
object and MCP `isError: true`. An invalid Graph IR document is a successful
inspection with `valid: false` and core diagnostics; it is not confused with a
server failure.

One static resource is exposed:

```text
graph-engineering://schemas/v1alpha1/graph
```

It serves the package's bundled `application/schema+json` document. The build has
no resource template and the schema tool accepts no path or URI argument. A test
requires the bundled schema bytes to match the canonical repository schema, so a
protocol update cannot silently leave the MCP copy behind.

## Explicitly absent

This server registers no graph run, resume, replay, persistence, model, provider,
MCP proxy, file-write, mutation, network, subprocess, or shell tool. It does not
read client roots and does not accept a filesystem path. It is not a façade over
the runtime scheduler or a claim that durable execution exists.

Only supplied JSON values and one package-owned schema file are inspected.
`@graph-engineering/core` remains the source of graph hashing, structural/schema
diagnostics, policy diagnostics, and topological layers.

## Bounds and cancellation

Before a compiler worker starts, each graph is bounded to:

- 524,288 serialized UTF-8 bytes;
- 2,048 nodes;
- 8,192 edges.

Compilation runs in an isolated worker thread with a 2,000 ms hard deadline. The
worker is terminated on timeout or MCP request cancellation. These bounds protect
the compiler step; they are **not a transport-level frame limit**. The official
stdio SDK parses the JSON-RPC request before the handler can measure the graph, so
a deployment that accepts hostile local clients must also enforce process/pipe
and operating-system resource limits outside this server.

The bundled schema has a fixed package-controlled size and path. Schema loading
does not perform network I/O or resolve user input.

## Run over stdio

After the workspace has been installed and built:

```bash
node packages/mcp-server/dist/src/stdio.js
```

Or use the package bin after installation:

```text
graph-engineering-mcp
```

An MCP host should launch the command and communicate over stdin/stdout. Stdout is
reserved exclusively for MCP JSON-RPC; startup and errors use stderr. `SIGINT` and
`SIGTERM` close the server transport.

Example host configuration:

```json
{
  "mcpServers": {
    "graph-engineering": {
      "command": "node",
      "args": ["/absolute/path/to/GraphEngineering/packages/mcp-server/dist/src/stdio.js"]
    }
  }
}
```

Use an explicit, reviewed absolute path in host configuration. The server itself
does not derive paths from model input.

## Security boundary

Stdio is a local process transport, not authentication. The spawning MCP host
controls whether a model can see and call this server. Tool annotations are hints
to clients; the actual safety property comes from registering only local,
read-only handlers with strict schemas.

Graph documents remain untrusted input. Core validation runs before planning, and
an invalid graph receives no plan. Returned diagnostics may echo identifiers and
schema locations from the submitted graph, so the host should still treat output
as untrusted display data. The server never logs graph content.

The worker thread is a timeout boundary, not an OS sandbox. It imports reviewed
core code and receives only the submitted graph. Future tools that access tools,
networks, repositories, credentials, or runtime state require a separate threat
model and are intentionally out of scope for this package.

## Development

From the repository root:

```bash
corepack pnpm --filter @graph-engineering/core build
corepack pnpm --filter @graph-engineering/mcp-server typecheck
corepack pnpm --filter @graph-engineering/mcp-server test
corepack pnpm --filter @graph-engineering/mcp-server build
```

Tests launch the built server through the SDK's real `StdioClientTransport` and
verify initialization, exact tool/resource registration, valid and invalid graph
results, core hash/diagnostics, plan shape, strict no-path schema access, bundled
schema parity, size limits, cancellation, and worker timeout.

Official references:

- [MCP TypeScript SDK v1 server guide](https://ts.sdk.modelcontextprotocol.io/server)
- [`@modelcontextprotocol/sdk` package](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
