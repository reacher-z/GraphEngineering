import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { GraphSpec } from "@graph-engineering/core";
import { GRAPH_SCHEMA_URI, MAX_GRAPH_BYTES, SERVER_NAME } from "../src/constants.js";
import { isStdioEntrypoint } from "../src/stdio.js";

const fixtures = resolve(import.meta.dirname, "../../../../spec/conformance");
const canonicalSchemaPath = resolve(import.meta.dirname, "../../../../spec/graph.schema.json");
const bundledSchemaPath = resolve(import.meta.dirname, "../../schemas/v1alpha1/graph.schema.json");
const stdioEntrypoint = resolve(import.meta.dirname, "../src/stdio.js");

let client: Client;
let transport: StdioClientTransport;
let stderr = "";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(fixtures, name), "utf8")) as unknown;
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  assert.ok("structuredContent" in result);
  assert.ok(result.structuredContent);
  return result.structuredContent as Record<string, unknown>;
}

before(async () => {
  client = new Client({ name: "graph-engineering-mcp-tests", version: "1.0.0" });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [stdioEntrypoint],
    cwd: resolve(import.meta.dirname, "../../../.."),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  await client.connect(transport);
});

after(async () => {
  await client.close();
  assert.equal(stderr, "");
});

test("starts over stdio with explicit read-only instructions", () => {
  assert.ok(transport.pid);
  assert.equal(client.getServerVersion()?.name, SERVER_NAME);
  assert.match(client.getInstructions() ?? "", /Read-only/);
  assert.match(client.getInstructions() ?? "", /cannot execute graphs/);
});

test("entrypoint detection fails closed for absent argv and realpath failures", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "graph-engineering-mcp-entrypoint-"));
  try {
    assert.equal(await isStdioEntrypoint(undefined), false);
    assert.equal(await isStdioEntrypoint(resolve(temporaryRoot, "does-not-exist")), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("an installed-style executable symlink initializes and serves tools", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "graph-engineering-mcp-bin-"));
  const executable = resolve(temporaryRoot, "graph-engineering-mcp");
  await symlink(stdioEntrypoint, executable);
  assert.equal(await isStdioEntrypoint(executable), true);

  let symlinkStderr = "";
  const binTransport = new StdioClientTransport({
    command: executable,
    args: [],
    cwd: temporaryRoot,
    stderr: "pipe",
  });
  binTransport.stderr?.on("data", (chunk) => {
    symlinkStderr += String(chunk);
  });
  const binClient = new Client({ name: "graph-engineering-bin-test", version: "1.0.0" });

  try {
    await binClient.connect(binTransport);
    assert.equal(binClient.getServerVersion()?.name, SERVER_NAME);
    const { tools } = await binClient.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ["graph_get_schema", "graph_plan", "graph_validate"],
    );
    const schema = structured(
      await binClient.callTool({ name: "graph_get_schema", arguments: {} }),
    );
    assert.equal(schema.uri, GRAPH_SCHEMA_URI);
    assert.equal(typeof schema.schemaId, "string");
  } finally {
    await binClient.close().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  assert.equal(symlinkStderr, "");
});

test("registers exactly three read-only, non-destructive tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["graph_get_schema", "graph_plan", "graph_validate"],
  );
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.idempotentHint, true);
    assert.equal(tool.annotations?.openWorldHint, false);
    assert.ok(tool.outputSchema);
    assert.doesNotMatch(tool.name, /run|execute|mutate|write|shell/i);
  }
  const schemaTool = tools.find((tool) => tool.name === "graph_get_schema");
  assert.deepEqual(schemaTool?.inputSchema.properties ?? {}, {});
  assert.equal(schemaTool?.inputSchema.additionalProperties, false);
});

test("graph_validate returns the canonical core hash for a valid graph", async () => {
  const graph = await fixture("diamond.graph.json");
  const result = await client.callTool({ name: "graph_validate", arguments: { graph } });
  const output = structured(result);

  assert.equal(result.isError, undefined);
  assert.equal(output.valid, true);
  assert.equal(output.graphHash, "24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288");
  assert.deepEqual(output.diagnosticCodes, []);
  assert.equal(output.issue, null);
});

test("graph_validate preserves core diagnostics for an invalid graph", async () => {
  const graph = await fixture("invalid-cycle.graph.json");
  const result = await client.callTool({ name: "graph_validate", arguments: { graph } });
  const output = structured(result);

  assert.equal(output.valid, false);
  assert.deepEqual(output.diagnosticCodes, ["GE1005_CYCLE"]);
  assert.deepEqual(
    (output.diagnostics as { code: string }[]).map((item) => item.code),
    ["GE1005_CYCLE"],
  );
  assert.equal(output.issue, null);
});

test("graph_validate returns a stable structured issue when its graph is too large", async () => {
  const result = await client.callTool({
    name: "graph_validate",
    arguments: { graph: { description: "x".repeat(MAX_GRAPH_BYTES) } },
  });
  const output = structured(result);
  assert.equal(result.isError, true);
  assert.equal(output.valid, false);
  assert.deepEqual(output.issue, {
    code: "MCP_INPUT_TOO_LARGE",
    message: `Graph input exceeds the ${MAX_GRAPH_BYTES}-byte limit`,
  });
});

test("graph_plan returns deterministic layers, parallel width, and concurrency", async () => {
  const graph = (await fixture("diamond.graph.json")) as GraphSpec;
  const result = await client.callTool({ name: "graph_plan", arguments: { graph } });
  const output = structured(result);

  assert.equal(output.valid, true);
  assert.equal(output.graphName, "diamond");
  assert.deepEqual(output.topologicalLayers, [["split"], ["left", "right"], ["merge"]]);
  assert.equal(output.maxParallelWidth, 2);
  assert.equal(output.configuredMaxConcurrency, 2);
  assert.equal(output.nodeCount, 4);
  assert.equal(output.edgeCount, 4);
});

test("graph_get_schema and the fixed resource return the bundled canonical schema", async () => {
  assert.deepEqual(await readFile(bundledSchemaPath), await readFile(canonicalSchemaPath));
  const canonicalSchema = JSON.parse(await readFile(canonicalSchemaPath, "utf8")) as Record<string, unknown>;
  const toolResult = await client.callTool({ name: "graph_get_schema", arguments: {} });
  const toolOutput = structured(toolResult);
  assert.deepEqual(toolOutput.schema, canonicalSchema);
  assert.equal(toolOutput.schemaId, canonicalSchema.$id);
  assert.equal(toolOutput.uri, GRAPH_SCHEMA_URI);

  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((resource) => resource.uri), [GRAPH_SCHEMA_URI]);
  const resource = await client.readResource({ uri: GRAPH_SCHEMA_URI });
  assert.equal(resource.contents.length, 1);
  const content = resource.contents[0];
  assert.ok(content && "text" in content);
  assert.deepEqual(JSON.parse(content.text), canonicalSchema);
});

test("schema access rejects arbitrary path arguments and unknown resource URIs", async () => {
  const result = await client.callTool({
    name: "graph_get_schema",
    arguments: { path: "../../../../etc/passwd" },
  });
  assert.equal(result.isError, true);
  assert.equal("structuredContent" in result && result.structuredContent !== undefined, false);

  await assert.rejects(
    client.readResource({ uri: "graph-engineering://schemas/v1alpha1/../../../../etc/passwd" }),
  );
});
