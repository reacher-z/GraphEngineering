#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, "packages");
const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`,
  );
  return result;
}

const manifests = readdirSync(packageRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packageRoot, entry.name, "package.json"))
  .filter((path) => {
    try {
      return JSON.parse(readFileSync(path, "utf8")).private !== true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  })
  .sort();

assert.ok(manifests.length > 0, "no public workspace packages found");
const workspace = new Map(
  manifests.map((path) => {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    return [manifest.name, { path, manifest }];
  }),
);
const versions = new Set([...workspace.values()].map(({ manifest }) => manifest.version));
assert.equal(versions.size, 1, "public workspace packages must use one release version");
const [releaseVersion] = versions;
const authoringRoot = join(root, "spec", "conformance", "authoring");
const authoringCases = JSON.parse(readFileSync(join(authoringRoot, "authoring.case.json"), "utf8"));
const typedCase = authoringCases.equivalenceCases.find(({ name }) => name === "typed-port-diamond");
assert.ok(typedCase, "shared typed-port authoring case is missing");
const identityGolden = JSON.parse(
  readFileSync(join(authoringRoot, authoringCases.identityGolden), "utf8"),
).identities[typedCase.identityKey];
assert.ok(identityGolden, "shared typed-port identity golden is missing");
const sharedAuthoringYaml = readFileSync(join(authoringRoot, typedCase.yaml), "utf8");

const temporaryRoot = mkdtempSync(join(tmpdir(), "graph-engineering-packed-install-"));
const tarballRoot = join(temporaryRoot, "tarballs");
const consumerRoot = join(temporaryRoot, "consumer");
mkdirSync(tarballRoot);
mkdirSync(consumerRoot);

try {
  const tarballs = new Map();
  for (const [name, { path }] of workspace) {
    const before = new Set(readdirSync(tarballRoot));
    run(corepack, [
      "pnpm",
      "--dir",
      dirname(path),
      "pack",
      "--pack-destination",
      tarballRoot,
    ]);
    const created = readdirSync(tarballRoot).filter((entry) => !before.has(entry));
    assert.equal(created.length, 1, `${name}: pnpm pack must create exactly one tarball`);
    assert.match(created[0], /\.tgz$/u, `${name}: pnpm pack output is not a tarball`);
    tarballs.set(name, join(tarballRoot, created[0]));
  }

  const dependencies = Object.fromEntries(
    [...tarballs].map(([name, path]) => [name, `file:${resolve(path)}`]),
  );
  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify({
      name: "graph-engineering-packed-install-smoke",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies,
    }, null, 2)}\n`,
  );
  run(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"],
    { cwd: consumerRoot },
  );
  const installedGraphPath = join(consumerRoot, typedCase.yaml);
  writeFileSync(installedGraphPath, sharedAuthoringYaml);

  for (const [name, { manifest: sourceManifest }] of workspace) {
    const installedPath = join(consumerRoot, "node_modules", ...name.split("/"), "package.json");
    const installed = JSON.parse(readFileSync(installedPath, "utf8"));
    assert.equal(installed.version, releaseVersion, `${name}: installed version drifted`);
    for (const [dependency, range] of Object.entries(installed.dependencies ?? {})) {
      if (!workspace.has(dependency)) continue;
      assert.equal(
        range,
        releaseVersion,
        `${name}: ${dependency} was not rewritten from workspace protocol`,
      );
    }
    assert.deepEqual(
      installed.exports,
      sourceManifest.exports,
      `${name}: installed exports differ from the source manifest`,
    );
  }

  const importSmoke = [...workspace.keys()]
    .map((name) => `await import(${JSON.stringify(name)});`)
    .join("\n");
  const smokePath = join(consumerRoot, "smoke.mjs");
  writeFileSync(
    smokePath,
    `${importSmoke}
const core = await import("@graph-engineering/core");
for (const name of [
  "compileGraph",
  "decodeGraphSource",
  "graphBuilder",
  "createCompiledGraphIdentity",
  "verifyCompiledGraphIdentity",
  "validateStrictTypedPorts",
]) {
  if (typeof core[name] !== "function") throw new Error(\`installed core omits \${name}\`);
}
const installedDecoded = core.decodeGraphSource(${JSON.stringify(sharedAuthoringYaml)}, {
  format: "yaml",
});
const installedBuilder = core.graphBuilder({
  metadata: installedDecoded.metadata,
  inputSchema: installedDecoded.inputSchema,
  outputSchema: installedDecoded.outputSchema,
  ...(Object.hasOwn(installedDecoded, "stateSchema")
    ? { stateSchema: installedDecoded.stateSchema }
    : {}),
  ...(Object.hasOwn(installedDecoded, "policies")
    ? { policies: installedDecoded.policies }
    : {}),
});
for (const node of installedDecoded.nodes) installedBuilder.addNode(node);
for (const edge of installedDecoded.edges) installedBuilder.addEdge(edge);
for (const entrypoint of installedDecoded.entrypoints) installedBuilder.addEntrypoint(entrypoint);
for (const [name, endpoint] of Object.entries(installedDecoded.outputs)) {
  installedBuilder.addOutput(name, endpoint);
}
const installedBuilt = installedBuilder.build();
const installedCompiled = core.compileGraph(installedDecoded);
if (
  !installedCompiled.valid ||
  installedCompiled.graphHash !== installedBuilt.graphHash ||
  installedCompiled.graphHash !== ${JSON.stringify(typedCase.expect.graphHash)}
) {
  throw new Error("installed JSON/YAML compiler and builder hashes differ");
}
if (core.validateStrictTypedPorts(installedDecoded).length !== 0) {
  throw new Error("installed strict typed-port validator rejected the packed smoke graph");
}
const installedIdentity = core.createCompiledGraphIdentity(installedDecoded);
const installedVerification = core.verifyCompiledGraphIdentity(
  installedDecoded,
  installedIdentity,
);
if (
  !installedVerification.valid ||
  installedIdentity.revisionHash !== installedBuilt.identity.revisionHash ||
  installedIdentity.revisionHash !== ${JSON.stringify(identityGolden.revisionHash)}
) {
  throw new Error("installed component identity APIs failed their packed smoke test");
}
const { runPipeline } = await import("@graph-engineering/runtime");
if (typeof runPipeline !== "function") throw new Error("runtime package omits runPipeline");
const pipelineRun = runPipeline([null], [], { maxItems: 2, maxStages: 1 });
const pipelineItem = await pipelineRun.next();
if (pipelineItem.done || pipelineItem.value.output !== null) {
  throw new Error("installed runPipeline failed its null-presence smoke test");
}
if (!(await pipelineRun.next()).done || (await pipelineRun.completion).status !== "succeeded") {
  throw new Error("installed runPipeline failed to terminate successfully");
}
`,
  );
  run(process.execPath, [smokePath], { cwd: consumerRoot });

  const cliManifest = workspace.get("@graph-engineering/cli")?.manifest;
  assert.ok(cliManifest, "CLI package missing from release set");
  const cliPath = join(
    consumerRoot,
    "node_modules",
    "@graph-engineering",
    "cli",
    cliManifest.bin.graph,
  );
  const versionResult = run(process.execPath, [cliPath, "--version"], { cwd: consumerRoot });
  assert.equal(versionResult.stdout.trim(), releaseVersion, "installed CLI reports wrong version");
  const doctorResult = run(process.execPath, [cliPath, "doctor", "--json"], { cwd: consumerRoot });
  const doctor = JSON.parse(doctorResult.stdout);
  assert.equal(doctor.ok, true, "installed CLI doctor did not report healthy");
  const compileResult = run(
    process.execPath,
    [cliPath, "compile", installedGraphPath, "--json"],
    { cwd: consumerRoot },
  );
  const compiled = JSON.parse(compileResult.stdout);
  assert.equal(compiled.ok, true, "installed CLI did not compile the shared YAML fixture");
  assert.equal(
    compiled.data.graphHash,
    typedCase.expect.graphHash,
    "installed CLI returned the wrong shared YAML graph hash",
  );

  const mcpExecutable = join(
    consumerRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "graph-engineering-mcp.cmd" : "graph-engineering-mcp",
  );
  const mcpSmokePath = join(consumerRoot, "mcp-smoke.mjs");
  writeFileSync(
    mcpSmokePath,
    `import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GRAPH_SCHEMA_URI, SERVER_NAME } from "@graph-engineering/mcp-server";

let stderr = "";
const transport = new StdioClientTransport({
  command: ${JSON.stringify(mcpExecutable)},
  args: [],
  cwd: ${JSON.stringify(consumerRoot)},
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
const client = new Client({ name: "packed-install-smoke", version: "1.0.0" });
try {
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.name, SERVER_NAME);
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["graph_get_schema", "graph_plan", "graph_validate"],
  );
  const schema = await client.callTool({ name: "graph_get_schema", arguments: {} });
  assert.equal(schema.isError, undefined);
  assert.equal(schema.structuredContent?.uri, GRAPH_SCHEMA_URI);
} finally {
  await client.close().catch(() => undefined);
}
assert.equal(stderr, "");
`,
  );
  run(process.execPath, [mcpSmokePath], { cwd: consumerRoot });

  process.stdout.write(
    `Installed and smoke-tested ${workspace.size} pnpm tarballs at ${releaseVersion}; ` +
      "workspace dependencies were rewritten and installed bins are healthy.\n",
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
