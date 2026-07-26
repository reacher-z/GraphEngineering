import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { MAX_GRAPH_SOURCE_BYTES } from "@graph-engineering/core";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const cliEntrypoint = resolve(import.meta.dirname, "../src/cli.js");

const graph = {
  apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
  kind: "Graph",
  metadata: { name: "cli-source", version: "1.0.0" },
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  nodes: [
    {
      id: "only",
      kind: "transform",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      config: null,
    },
  ],
  edges: [],
  entrypoints: ["only"],
  outputs: { result: { node: "only" } },
};

const yamlGraph = `apiVersion: graphengineering.reacher-z.github.io/v1alpha1
kind: Graph
metadata:
  name: cli-source
  version: 1.0.0
inputSchema:
  type: object
outputSchema:
  type: object
nodes:
  - id: only
    kind: transform
    inputSchema:
      type: object
    outputSchema:
      type: object
    config: null
edges: []
entrypoints:
  - only
outputs:
  result:
    node: only
`;

interface Invocation {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Envelope {
  schemaVersion: "graph-engineering.cli/v1alpha1";
  command: string | null;
  ok: boolean;
  exitCode: number;
  data: Record<string, unknown> | null;
  error: {
    code: string;
    message: string;
    format?: "json" | "yaml";
    path?: string | null;
    line?: number | null;
    column?: number | null;
  } | null;
}

function invoke(args: readonly string[], input?: string | Uint8Array): Invocation {
  const result = spawnSync(process.execPath, [cliEntrypoint, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function machine(result: Invocation): Envelope {
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim().split("\n").length, 1);
  const envelope = JSON.parse(result.stdout) as Envelope;
  assert.equal(envelope.schemaVersion, "graph-engineering.cli/v1alpha1");
  assert.equal(envelope.exitCode, result.status);
  return envelope;
}

test("auto selects .yaml and .yml without changing canonical graph identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-yaml-auto-"));
  try {
    const expected = machine(invoke(["compile", "-", "--json"], JSON.stringify(graph)));
    const expectedHash = expected.data?.graphHash;
    for (const extension of ["yaml", "yml", "YAML"] as const) {
      const path = join(root, `graph.${extension}`);
      await writeFile(path, yamlGraph, "utf8");
      const result = invoke([
        "compile",
        path,
        ...(extension === "yaml" ? ["--input-format", "auto"] : []),
        "--json",
      ]);
      assert.equal(result.status, 0);
      const envelope = machine(result);
      assert.equal(envelope.error, null);
      assert.equal(envelope.data?.graphHash, expectedHash);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stdin auto remains JSON and YAML requires an explicit input format", () => {
  const jsonResult = machine(invoke(["validate", "-", "--json"], JSON.stringify(graph)));
  assert.equal(jsonResult.exitCode, 0);

  const defaultYaml = machine(invoke(["validate", "-", "--json"], yamlGraph));
  assert.equal(defaultYaml.exitCode, 2);
  assert.equal(defaultYaml.error?.code, "GE_SOURCE_SYNTAX");
  assert.equal(defaultYaml.error?.format, "json");

  const explicitYaml = machine(
    invoke(["validate", "-", "--input-format", "yaml", "--json"], yamlGraph),
  );
  assert.equal(explicitYaml.exitCode, 0);
  assert.equal(explicitYaml.error, null);
});

test("explicit json or yaml overrides an unknown file extension", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-explicit-source-"));
  try {
    const yamlPath = join(root, "graph.source");
    await writeFile(yamlPath, yamlGraph, "utf8");

    const automatic = machine(invoke(["validate", yamlPath, "--json"]));
    assert.equal(automatic.exitCode, 2);
    assert.equal(automatic.error?.code, "GECLI_INPUT_FORMAT");

    const yaml = machine(
      invoke(["validate", yamlPath, "--input-format=yaml", "--json"]),
    );
    assert.equal(yaml.exitCode, 0);

    const forcedJson = machine(
      invoke(["validate", yamlPath, "--input-format=json", "--json"]),
    );
    assert.equal(forcedJson.exitCode, 2);
    assert.equal(forcedJson.error?.code, "GE_SOURCE_SYNTAX");
    assert.equal(forcedJson.error?.format, "json");

    const jsonPath = join(root, "graph.data");
    await writeFile(jsonPath, JSON.stringify(graph), "utf8");
    const json = machine(
      invoke(["validate", jsonPath, "--input-format", "json", "--json"]),
    );
    assert.equal(json.exitCode, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves unknown extensions before touching the filesystem", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-format-before-io-"));
  try {
    const missing = machine(invoke(["validate", join(root, "missing.data"), "--json"]));
    assert.equal(missing.exitCode, 2);
    assert.equal(missing.error?.code, "GECLI_INPUT_FORMAT");

    const largePath = join(root, "large.unknown");
    await writeFile(largePath, Buffer.alloc(MAX_GRAPH_SOURCE_BYTES + 1, 0x20));
    const large = machine(invoke(["validate", largePath, "--json"]));
    assert.equal(large.exitCode, 2);
    assert.equal(large.error?.code, "GECLI_INPUT_FORMAT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounds file and stdin reads at exactly one MiB", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-bounded-read-"));
  const exact = `"${"x".repeat(MAX_GRAPH_SOURCE_BYTES - 2)}"`;
  const over = `"${"x".repeat(MAX_GRAPH_SOURCE_BYTES - 1)}"`;
  try {
    const exactPath = join(root, "exact.json");
    const overPath = join(root, "over.json");
    await writeFile(exactPath, exact);
    await writeFile(overPath, over);

    for (const invocation of [
      invoke(["validate", exactPath, "--json"]),
      invoke(["validate", "-", "--json"], exact),
    ]) {
      const result = machine(invocation);
      assert.equal(result.exitCode, 1);
      assert.equal(result.error, null);
      assert.deepEqual(result.data?.diagnosticCodes, ["GE1007_INVALID_GRAPH"]);
    }

    for (const invocation of [
      invoke(["validate", overPath, "--json"]),
      invoke(["validate", "-", "--json"], over),
    ]) {
      const result = machine(invocation);
      assert.equal(result.exitCode, 2);
      assert.equal(result.data, null);
      assert.equal(result.error?.code, "GE_SOURCE_TOO_LARGE");
      assert.equal(result.error?.format, "json");
      assert.equal(result.error?.path, null);
      assert.equal(result.error?.line, null);
      assert.equal(result.error?.column, null);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("input format and visualization output format are independent", () => {
  const result = invoke([
    "visualize",
    "-",
    "--input-format",
    "yaml",
    "--format",
    "dot",
  ], yamlGraph);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^digraph GraphEngineering \{/);
});

test("core YAML source errors stay structured and use exit two", () => {
  const result = machine(
    invoke(["validate", "-", "--input-format", "yaml", "--json"], "kind: Graph\nkind: Other\n"),
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.data, null);
  assert.equal(result.error?.code, "GE_SOURCE_DUPLICATE_KEY");
  assert.equal(result.error?.format, "yaml");
  assert.equal(typeof result.error?.path, "string");
  assert.equal(typeof result.error?.line, "number");
  assert.equal(typeof result.error?.column, "number");
  assert.doesNotMatch(result.error?.message ?? "", /kind: Graph/);
});

test("invalid UTF-8 is rejected by core before source parsing", () => {
  const result = machine(
    invoke(["validate", "-", "--input-format", "json", "--json"], Uint8Array.from([0xc3, 0x28])),
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.error?.code, "GE_SOURCE_INVALID_UTF8");
  assert.equal(result.error?.format, "json");
  assert.equal(result.error?.path, null);
  assert.equal(result.error?.line, null);
  assert.equal(result.error?.column, null);
});

test("valid YAML containing invalid Graph IR remains compiler exit one", () => {
  const result = machine(
    invoke(["compile", "-", "--input-format=yaml", "--json"], "kind: NotAGraph\n"),
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.error, null);
  assert.equal(result.data?.valid, false);
  assert.deepEqual(result.data?.diagnosticCodes, ["GE1007_INVALID_GRAPH"]);
});

for (const args of [
  ["validate", "-", "--input-format", "toml", "--json"],
  ["validate", "-", "--input-format=", "--json"],
  ["validate", "-", "--input-format", "--json"],
  ["validate", "-", "--input-format", "json", "--input-format=yaml", "--json"],
  ["doctor", "--input-format", "json", "--json"],
  ["init", "--input-format=json", "--json"],
] as const) {
  test(`invalid input-format arguments fail before reading: ${args.join(" ")}`, () => {
    const result = machine(invoke(args));
    assert.equal(result.exitCode, 2);
    assert.equal(result.error?.code, "GECLI_USAGE");
  });
}

test("help documents source formats separately from visualization formats", () => {
  const result = invoke(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--input-format json\|yaml\|auto/);
  assert.match(result.stdout, /--format mermaid\|dot/);
});
