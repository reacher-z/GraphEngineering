import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compileGraph, type GraphSpec, type NodeKind } from "@graph-engineering/core";
import { visualizeGraph, type VisualizationFormat } from "../src/visualize.js";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const fixtures = resolve(workspaceRoot, "spec/conformance");
const diamondPath = resolve(fixtures, "diamond.graph.json");
const invalidCyclePath = resolve(fixtures, "invalid-cycle.graph.json");
const cliEntrypoint = resolve(import.meta.dirname, "../src/cli.js");

interface Invocation {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Envelope<T extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: "graph-engineering.cli/v1alpha1";
  command: "visualize" | "validate" | null;
  ok: boolean;
  exitCode: number;
  data: T | null;
  error: { code: string; message: string } | null;
}

function invoke(args: readonly string[], input?: string): Invocation {
  const result = spawnSync(process.execPath, [cliEntrypoint, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parseMachine<T extends Record<string, unknown>>(result: Invocation): Envelope<T> {
  assert.equal(result.stderr, "", "machine mode must never write stderr");
  assert.ok(result.stdout.endsWith("\n"), "machine output must be newline terminated");
  assert.equal(result.stdout.trim().split("\n").length, 1, "machine mode emits one JSON line");
  const envelope = JSON.parse(result.stdout) as Envelope<T>;
  assert.equal(envelope.schemaVersion, "graph-engineering.cli/v1alpha1");
  assert.equal(envelope.exitCode, result.status);
  return envelope;
}

async function diamond(): Promise<GraphSpec> {
  return JSON.parse(await readFile(diamondPath, "utf8")) as GraphSpec;
}

const expectedMermaid = `flowchart TD
  n0["id=split; kind=transform; entrypoint"]
  n1["id=left; kind=transform"]
  n2["id=right; kind=transform"]
  n3["id=merge; kind=barrier; outputs=result"]
  n0 e0@-->|"id=split-left; fromPort=default; toPort=default; mode=value"| n1
  n0 e1@-->|"id=split-right; fromPort=default; toPort=default; mode=value"| n2
  n1 e2@-->|"id=left-merge; fromPort=default; toPort=left; mode=value"| n3
  n2 e3@-->|"id=right-merge; fromPort=default; toPort=right; mode=value"| n3
`;

const expectedDot = `digraph GraphEngineering {
  rankdir=TB;
  node [shape=box];
  n0 [label="id=split; kind=transform; entrypoint"];
  n1 [label="id=left; kind=transform"];
  n2 [label="id=right; kind=transform"];
  n3 [label="id=merge; kind=barrier; outputs=result"];
  n0 -> n1 [id="e0", label="id=split-left; fromPort=default; toPort=default; mode=value"];
  n0 -> n2 [id="e1", label="id=split-right; fromPort=default; toPort=default; mode=value"];
  n1 -> n3 [id="e2", label="id=left-merge; fromPort=default; toPort=left; mode=value"];
  n2 -> n3 [id="e3", label="id=right-merge; fromPort=default; toPort=right; mode=value"];
}
`;

function unsafeRendererGraph(value: string): GraphSpec {
  const sourceId = `source${value}`;
  const outputName = `result${value}`;
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "renderer-safety", version: "1.0.0" },
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    entrypoints: [sourceId],
    outputs: Object.fromEntries([
      [outputName, { node: "sink", port: `output${value}` }],
    ]),
    nodes: [
      {
        id: sourceId,
        kind: `tool${value}` as NodeKind,
        inputSchema: {},
        outputSchema: {},
        config: {},
      },
      {
        id: "sink",
        kind: "barrier",
        inputSchema: {},
        outputSchema: {},
        config: {},
      },
    ],
    edges: [
      {
        id: `edge${value}`,
        from: { node: sourceId, port: `from${value}` },
        to: { node: "sink", port: `to${value}` },
        mode: `value${value}` as "value",
      },
    ],
  };
}

function assertMermaidStatementBoundary(content: string, nodeCount: number, edgeCount: number): void {
  const lines = content.trimEnd().split("\n");
  assert.equal(lines.length, 1 + nodeCount + edgeCount);
  assert.equal(lines[0], "flowchart TD");
  for (let index = 0; index < nodeCount; index += 1) {
    assert.match(lines[index + 1] ?? "", new RegExp(`^  n${index}\\["[^"\\n]*"\\]$`));
  }
  for (let index = 0; index < edgeCount; index += 1) {
    assert.match(
      lines[1 + nodeCount + index] ?? "",
      new RegExp(`^  n\\d+ e${index}@-->\\|"[^"\\n]*"\\| n\\d+$`),
    );
  }
}

function assertDotStatementBoundary(content: string, nodeCount: number, edgeCount: number): void {
  const lines = content.trimEnd().split("\n");
  assert.equal(lines.length, 4 + nodeCount + edgeCount);
  assert.deepEqual(lines.slice(0, 3), [
    "digraph GraphEngineering {",
    "  rankdir=TB;",
    "  node [shape=box];",
  ]);
  for (let index = 0; index < nodeCount; index += 1) {
    assert.match(lines[index + 3] ?? "", new RegExp(`^  n${index} \\[label="[^"\\n]*"\\];$`));
  }
  for (let index = 0; index < edgeCount; index += 1) {
    assert.match(
      lines[3 + nodeCount + index] ?? "",
      new RegExp(`^  n\\d+ -> n\\d+ \\[id="e${index}", label="[^"\\n]*"\\];$`),
    );
  }
  assert.equal(lines.at(-1), "}");
}

test("visualize defaults to exact deterministic Mermaid on stdout", () => {
  const result = invoke(["visualize", diamondPath]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expectedMermaid);
});

test("explicit Mermaid format is identical to the default", () => {
  assert.equal(invoke(["visualize", diamondPath, "--format", "mermaid"]).stdout, expectedMermaid);
});

test("equals-form Mermaid format is accepted", () => {
  assert.equal(invoke(["visualize", diamondPath, "--format=mermaid"]).stdout, expectedMermaid);
});

test("visualize emits exact deterministic DOT on stdout", () => {
  const result = invoke(["visualize", diamondPath, "--format", "dot"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expectedDot);
});

test("equals-form DOT format is accepted", () => {
  assert.equal(invoke(["visualize", diamondPath, "--format=dot"]).stdout, expectedDot);
});

test("format may precede the command", () => {
  assert.equal(invoke(["--format", "dot", "visualize", diamondPath]).stdout, expectedDot);
});

test("default JSON data has exactly the documented visualization fields", () => {
  const result = invoke(["visualize", diamondPath, "--json"]);
  assert.equal(result.status, 0);
  const envelope = parseMachine<{
    graphHash: string;
    format: string;
    content: string;
    nodeCount: number;
    edgeCount: number;
  }>(result);
  assert.equal(envelope.command, "visualize");
  assert.equal(envelope.ok, true);
  assert.equal(envelope.error, null);
  assert.deepEqual(Object.keys(envelope.data ?? {}), [
    "graphHash",
    "format",
    "content",
    "nodeCount",
    "edgeCount",
  ]);
  assert.equal(envelope.data?.format, "mermaid");
  assert.equal(envelope.data?.content, expectedMermaid);
  assert.equal(envelope.data?.nodeCount, 4);
  assert.equal(envelope.data?.edgeCount, 4);
});

test("DOT JSON data embeds DOT without producing a second document", () => {
  const result = invoke(["visualize", diamondPath, "--format", "dot", "--json"]);
  const envelope = parseMachine<{ format: string; content: string }>(result);
  assert.equal(envelope.data?.format, "dot");
  assert.equal(envelope.data?.content, expectedDot);
});

test("visualization graph hash is the canonical core compiler hash", async () => {
  const graph = await diamond();
  const core = compileGraph(graph);
  const envelope = parseMachine<{ graphHash: string }>(
    invoke(["visualize", diamondPath, "--json"]),
  );
  assert.equal(envelope.data?.graphHash, core.graphHash);
});

test("Mermaid accepts Graph IR from stdin", async () => {
  const result = invoke(["visualize", "-"], await readFile(diamondPath, "utf8"));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expectedMermaid);
});

test("DOT accepts Graph IR from stdin", async () => {
  const result = invoke(
    ["visualize", "-", "--format", "dot"],
    await readFile(diamondPath, "utf8"),
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, expectedDot);
});

test("Mermaid JSON mode accepts Graph IR from stdin", async () => {
  const envelope = parseMachine<{ content: string }>(
    invoke(["visualize", "-", "--json"], await readFile(diamondPath, "utf8")),
  );
  assert.equal(envelope.data?.content, expectedMermaid);
});

test("DOT JSON mode accepts Graph IR from stdin", async () => {
  const envelope = parseMachine<{ content: string }>(
    invoke(
      ["visualize", "-", "--format", "dot", "--json"],
      await readFile(diamondPath, "utf8"),
    ),
  );
  assert.equal(envelope.data?.content, expectedDot);
});

for (const [format, expected] of [
  ["mermaid", expectedMermaid],
  ["dot", expectedDot],
] as const) {
  test(`${format} output is byte-deterministic across repeated processes`, () => {
    const args = format === "mermaid"
      ? ["visualize", diamondPath]
      : ["visualize", diamondPath, "--format", format];
    const first = invoke(args);
    const second = invoke(args);
    assert.equal(first.stdout, expected);
    assert.equal(second.stdout, first.stdout);
  });
}

test("node aliases follow declaration order rather than caller IDs", async () => {
  const graph = await diamond();
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const reordered: GraphSpec = {
    ...graph,
    nodes: ["merge", "right", "split", "left"].map((id) => {
      const node = byId.get(id);
      assert.ok(node);
      return node;
    }),
  };
  const core = compileGraph(reordered);
  assert.equal(core.valid, true);
  const output = invoke(["visualize", "-"], JSON.stringify(reordered)).stdout;
  assert.match(output, /^  n0\["id=merge;/m);
  assert.match(output, /^  n1\["id=right;/m);
  assert.match(output, /^  n2\["id=split;/m);
  assert.match(output, /^  n3\["id=left;/m);
  assert.match(output, /^  n2 e0@.* n3$/m);
});

test("edge aliases follow edge declaration order", async () => {
  const graph = await diamond();
  const reordered: GraphSpec = { ...graph, edges: [...graph.edges].reverse() };
  assert.equal(compileGraph(reordered).valid, true);
  const output = invoke(["visualize", "-"], JSON.stringify(reordered)).stdout;
  assert.match(output, /^  n2 e0@--.*id=right-merge.* n3$/m);
  assert.match(output, /^  n0 e3@--.*id=split-left.* n1$/m);
});

test("entrypoint and named graph output annotations are visible", () => {
  assert.match(expectedMermaid, /n0\["[^"]*entrypoint/);
  assert.match(expectedMermaid, /n3\["[^"]*outputs=result/);
});

test("edge ports and mode are visible", () => {
  assert.match(expectedMermaid, /fromPort=default; toPort=left; mode=value/);
  assert.match(expectedDot, /fromPort=default; toPort=right; mode=value/);
});

test("omitted edge mode is marked as default", async () => {
  const graph = await diamond();
  const withoutMode: GraphSpec = {
    ...graph,
    edges: graph.edges.map((edge) => {
      const { mode: _mode, ...rest } = edge;
      return rest;
    }),
  };
  assert.equal(compileGraph(withoutMode).valid, true);
  assert.match(visualizeGraph(withoutMode, "mermaid").content, /mode=default/);
});

test("named output ports are annotated", async () => {
  const graph = await diamond();
  const withPort: GraphSpec = {
    ...graph,
    outputs: { result: { node: "merge", port: "final" } },
  };
  assert.equal(compileGraph(withPort).valid, true);
  assert.match(visualizeGraph(withPort, "dot").content, /outputs=result at final/);
});

test("multiple named outputs preserve their object declaration order", async () => {
  const graph = await diamond();
  const withOutputs: GraphSpec = {
    ...graph,
    outputs: Object.fromEntries([
      ["zeta", { node: "merge" }],
      ["alpha", { node: "merge", port: "secondary" }],
    ]),
  };
  assert.equal(compileGraph(withOutputs).valid, true);
  assert.match(
    visualizeGraph(withOutputs, "mermaid").content,
    /outputs=zeta, alpha at secondary/,
  );
});

test("unsupported format exits two in one machine envelope", () => {
  const result = invoke(["visualize", diamondPath, "--format", "svg", "--json"]);
  assert.equal(result.status, 2);
  const envelope = parseMachine(result);
  assert.equal(envelope.command, "visualize");
  assert.equal(envelope.data, null);
  assert.equal(envelope.error?.code, "GECLI_USAGE");
  assert.match(envelope.error?.message ?? "", /mermaid or dot/);
});

test("unsupported format is a human stderr usage error", () => {
  const result = invoke(["visualize", diamondPath, "--format", "html"]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /unsupported visualization format html/);
});

test("missing format value exits two", () => {
  const envelope = parseMachine(invoke(["visualize", diamondPath, "--format", "--json"]));
  assert.equal(envelope.exitCode, 2);
  assert.equal(envelope.error?.code, "GECLI_USAGE");
  assert.match(envelope.error?.message ?? "", /requires mermaid or dot/);
});

test("empty equals-form format exits two", () => {
  const envelope = parseMachine(invoke(["visualize", diamondPath, "--format=", "--json"]));
  assert.equal(envelope.exitCode, 2);
  assert.equal(envelope.error?.code, "GECLI_USAGE");
});

test("duplicate format options exit two", () => {
  const envelope = parseMachine(
    invoke(["visualize", diamondPath, "--format", "dot", "--format=mermaid", "--json"]),
  );
  assert.equal(envelope.exitCode, 2);
  assert.match(envelope.error?.message ?? "", /at most once/);
});

test("format is rejected on non-visualize commands", () => {
  const envelope = parseMachine(
    invoke(["validate", diamondPath, "--format", "dot", "--json"]),
  );
  assert.equal(envelope.command, "validate");
  assert.equal(envelope.exitCode, 2);
  assert.match(envelope.error?.message ?? "", /only by visualize/);
});

test("visualize missing its graph operand exits two", () => {
  const envelope = parseMachine(invoke(["visualize", "--json"]));
  assert.equal(envelope.exitCode, 2);
  assert.equal(envelope.error?.code, "GECLI_USAGE");
  assert.match(envelope.error?.message ?? "", /exactly one/);
});

test("visualize rejects extra operands", () => {
  const envelope = parseMachine(invoke(["visualize", diamondPath, diamondPath, "--json"]));
  assert.equal(envelope.exitCode, 2);
  assert.equal(envelope.error?.code, "GECLI_USAGE");
});

test("visualize missing input file exits two", () => {
  const envelope = parseMachine(
    invoke(["visualize", resolve(fixtures, "not-present.graph.json"), "--json"]),
  );
  assert.equal(envelope.exitCode, 2);
  assert.equal(envelope.error?.code, "GECLI_INPUT_READ");
});

test("visualize invalid stdin JSON exits two", () => {
  const envelope = parseMachine(invoke(["visualize", "-", "--json"], "{bad json"));
  assert.equal(envelope.exitCode, 2);
  assert.equal(envelope.error?.code, "GE_SOURCE_SYNTAX");
});

test("invalid format is rejected before attempting to read the input", () => {
  const envelope = parseMachine(
    invoke(["visualize", "/definitely/not/read.json", "--format", "png", "--json"]),
  );
  assert.equal(envelope.exitCode, 2);
  assert.equal(envelope.error?.code, "GECLI_USAGE");
});

test("invalid Graph IR follows the existing exit-one diagnostics envelope", () => {
  const result = invoke(["visualize", invalidCyclePath, "--json"]);
  assert.equal(result.status, 1);
  const envelope = parseMachine<{ valid: boolean; diagnosticCodes: string[] }>(result);
  assert.equal(envelope.command, "visualize");
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error, null);
  assert.equal(envelope.data?.valid, false);
  assert.deepEqual(envelope.data?.diagnosticCodes, ["GE1005_CYCLE"]);
  assert.equal("content" in (envelope.data ?? {}), false);
});

test("invalid Graph IR human diagnostics stay on stderr", () => {
  const result = invoke(["visualize", invalidCyclePath]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /GE1005_CYCLE/);
});

test("schema-invalid caller IDs are rejected before visualization", async () => {
  const graph = await diamond();
  const invalid = {
    ...graph,
    nodes: graph.nodes.map((node, index) => index === 0
      ? { ...node, id: "bad\nclick n9" }
      : node),
  };
  const envelope = parseMachine<{ valid: boolean; diagnostics: unknown[] }>(
    invoke(["visualize", "-", "--json"], JSON.stringify(invalid)),
  );
  assert.equal(envelope.exitCode, 1);
  assert.equal(envelope.data?.valid, false);
  assert.equal("content" in (envelope.data ?? {}), false);
});

test("help documents visualize and its two formats", () => {
  const result = invoke(["--help"]);
  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /graph visualize <graph\.json\|graph\.yaml\|-> \[--input-format json\|yaml\|auto\] \[--format mermaid\|dot\]/,
  );
  assert.match(result.stdout, /read-only Mermaid \(default\) or DOT/);
});

test("visualize does not modify its input file", async () => {
  const beforeBytes = await readFile(diamondPath);
  const before = await stat(diamondPath);
  const result = invoke(["visualize", diamondPath, "--format", "dot"]);
  const after = await stat(diamondPath);
  assert.equal(result.status, 0);
  assert.deepEqual(await readFile(diamondPath), beforeBytes);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.ctimeMs, before.ctimeMs);
  assert.equal(after.mode, before.mode);
});

test("visualize never executes a tool node", async () => {
  const graph = await diamond();
  const sentinel = join(
    tmpdir(),
    `graph-engineering-visualize-must-not-exist-${process.pid}-${Date.now()}`,
  );
  const weaponized: GraphSpec = {
    ...graph,
    nodes: graph.nodes.map((node, index) => index === 0
      ? {
          ...node,
          kind: "tool",
          config: {
            command: process.execPath,
            args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran')`],
          },
        }
      : node),
  };
  assert.equal(compileGraph(weaponized).valid, true);
  const result = invoke(["visualize", "-"], JSON.stringify(weaponized));
  assert.equal(result.status, 0);
  await assert.rejects(access(sentinel), { code: "ENOENT" });
});

test("renderer result reports format and exact counts", async () => {
  const graph = await diamond();
  assert.deepEqual(
    visualizeGraph(graph, "mermaid"),
    { format: "mermaid", content: expectedMermaid, nodeCount: 4, edgeCount: 4 },
  );
});

test("renderer rejects an endpoint which has no internal node alias", async () => {
  const graph = await diamond();
  const broken = {
    ...graph,
    edges: [{ ...graph.edges[0], to: { node: "missing" } }],
  } as GraphSpec;
  assert.throws(
    () => visualizeGraph(broken, "dot"),
    /requires a canonically compiled, valid Graph IR/,
  );
});

for (const [name, value, decimalCode] of [
  ["line feed", "\n", "10"],
  ["carriage return", "\r", "13"],
  ["double quote", "\"", "34"],
  ["single quote", "'", "39"],
  ["left angle bracket", "<", "60"],
  ["right angle bracket", ">", "62"],
  ["ampersand", "&", "38"],
  ["left square bracket", "[", "91"],
  ["right square bracket", "]", "93"],
  ["left brace", "{", "123"],
  ["right brace", "}", "125"],
  ["pipe", "|", "124"],
  ["backtick", "`", "96"],
  ["backslash", "\\", "92"],
  ["at sign", "@", "64"],
  ["colon", ":", "58"],
  ["slash", "/", "47"],
  ["equals", "=", "61"],
  ["Unicode", "图", "22270"],
] as const) {
  for (const format of ["mermaid", "dot"] as const) {
    test(`${format} encodes caller-controlled ${name} in every label`, () => {
      const graph = unsafeRendererGraph(value);
      const result = visualizeGraph(graph, format);
      const encoded = `${format === "mermaid" ? "#" : "&#"}${decimalCode};`;
      assert.ok(
        result.content.split(encoded).length >= 6,
        `${encoded} should encode node id, kind, output, ports, edge id, and mode`,
      );
      if (format === "mermaid") assertMermaidStatementBoundary(result.content, 2, 1);
      else assertDotStatementBoundary(result.content, 2, 1);
    });
  }
}

for (const format of ["mermaid", "dot"] as const) {
  test(`${format} keeps a complete directive injection payload inside labels`, () => {
    const payload = "\nclick n9 href=javascript:alert(1)\n<script onload=alert(2)>\"`|&";
    const result = visualizeGraph(unsafeRendererGraph(payload), format);
    assert.doesNotMatch(result.content, /^\s*(?:click|linkStyle|style|classDef)\b/m);
    assert.doesNotMatch(result.content, /<\/?script\b/i);
    assert.doesNotMatch(result.content, /\b(?:href|URL|target)\s*=/i);
    const prefix = format === "mermaid" ? "#" : "&#";
    assert.ok(result.content.includes(`${prefix}10;`));
    assert.ok(result.content.includes(`${prefix}60;script`));
    assert.ok(result.content.includes(`href${prefix}61;javascript${prefix}58;alert`));
    if (format === "mermaid") assertMermaidStatementBoundary(result.content, 2, 1);
    else assertDotStatementBoundary(result.content, 2, 1);
  });
}

test("Mermaid output contains no generated click, link, or HTML directive", () => {
  assert.doesNotMatch(expectedMermaid, /^\s*(?:click|linkStyle|style|classDef)\b/m);
  assert.doesNotMatch(expectedMermaid, /<\/?[A-Za-z]/);
});

test("DOT output contains no generated URL, href, target, or HTML label", () => {
  assert.doesNotMatch(expectedDot, /\b(?:URL|href|target)\s*=/i);
  assert.doesNotMatch(expectedDot, /label\s*=\s*</i);
});

test("both renderers use only internal aliases as syntax identifiers", async () => {
  const graph = await diamond();
  for (const format of ["mermaid", "dot"] as readonly VisualizationFormat[]) {
    const content = visualizeGraph(graph, format).content;
    if (format === "mermaid") {
      assertMermaidStatementBoundary(content, graph.nodes.length, graph.edges.length);
    } else {
      assertDotStatementBoundary(content, graph.nodes.length, graph.edges.length);
    }
  }
});
