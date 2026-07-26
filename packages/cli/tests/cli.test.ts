import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compileGraph as compileCoreGraph } from "@graph-engineering/core";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const fixtures = resolve(workspaceRoot, "spec/conformance");
const cliEntrypoint = resolve(import.meta.dirname, "../src/cli.js");

interface Invocation {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Envelope<T extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: "graph-engineering.cli/v1alpha1";
  command: "validate" | "plan" | "compile" | "visualize" | "doctor" | "init" | null;
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
  assert.ok(result.stdout.endsWith("\n"), "machine output must end with one newline");
  assert.equal(result.stdout.trim().split("\n").length, 1, "machine mode must emit one JSON line");
  const envelope = JSON.parse(result.stdout) as Envelope<T>;
  assert.equal(envelope.schemaVersion, "graph-engineering.cli/v1alpha1");
  assert.equal(envelope.exitCode, result.status);
  return envelope;
}

test("validate emits one stable machine envelope", () => {
  const result = invoke(["--json", "validate", resolve(fixtures, "diamond.graph.json")]);
  assert.equal(result.status, 0);
  const envelope = parseMachine<{
    valid: boolean;
    graphHash: string;
    diagnosticCodes: string[];
  }>(result);
  assert.equal(envelope.command, "validate");
  assert.equal(envelope.ok, true);
  assert.equal(envelope.error, null);
  assert.equal(envelope.data?.valid, true);
  assert.equal(envelope.data?.graphHash, "24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288");
  assert.deepEqual(envelope.data?.diagnosticCodes, []);
});

test("plan envelope reports the diamond's parallel layer", () => {
  const result = invoke(["plan", resolve(fixtures, "diamond.graph.json"), "--json"]);
  assert.equal(result.status, 0);
  const envelope = parseMachine<{
    topologicalLayers: string[][];
    maxParallelWidth: number;
  }>(result);
  assert.equal(envelope.command, "plan");
  assert.deepEqual(envelope.data?.topologicalLayers[1], ["left", "right"]);
  assert.equal(envelope.data?.maxParallelWidth, 2);
});

test("compile returns the exact canonical graph and hash produced by core", async () => {
  const path = resolve(fixtures, "diamond.graph.json");
  const document = JSON.parse(await readFile(path, "utf8")) as unknown;
  const core = compileCoreGraph(document);
  const result = invoke(["compile", path, "--json"]);
  assert.equal(result.status, 0);
  const envelope = parseMachine<{
    valid: boolean;
    graphHash: string;
    canonicalGraph: string;
    canonicalBytes: number;
  }>(result);

  assert.equal(envelope.command, "compile");
  assert.equal(envelope.data?.valid, true);
  assert.equal(envelope.data?.graphHash, core.graphHash);
  assert.equal(envelope.data?.canonicalGraph, core.canonicalGraph);
  assert.equal(envelope.data?.canonicalBytes, Buffer.byteLength(core.canonicalGraph ?? "", "utf8"));
  assert.deepEqual(JSON.parse(envelope.data?.canonicalGraph ?? "null"), document);
});

test("compile defaults to a concise human summary", () => {
  const result = invoke(["compile", resolve(fixtures, "diamond.graph.json")]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^✓ Compiled diamond\.graph\.json/m);
  assert.match(result.stdout, /sha256 24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288/);
  assert.match(result.stdout, /canonical bytes \d+/);
  assert.doesNotMatch(result.stdout, /"apiVersion"/);
});

test("invalid graph uses exit one and keeps diagnostics in its envelope", () => {
  const result = invoke(["validate", resolve(fixtures, "invalid-cycle.graph.json"), "--json"]);
  assert.equal(result.status, 1);
  const envelope = parseMachine<{ valid: boolean; diagnosticCodes: string[] }>(result);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error, null);
  assert.equal(envelope.data?.valid, false);
  assert.deepEqual(envelope.data?.diagnosticCodes, ["GE1005_CYCLE"]);
});

for (const command of ["plan", "compile"] as const) {
  test(`${command} keeps invalid Graph IR inside its own machine envelope`, () => {
    const result = invoke([command, resolve(fixtures, "invalid-cycle.graph.json"), "--json"]);
    assert.equal(result.status, 1);
    const envelope = parseMachine<{ valid: boolean; diagnosticCodes: string[] }>(result);
    assert.equal(envelope.command, command);
    assert.equal(envelope.data?.valid, false);
    assert.deepEqual(envelope.data?.diagnosticCodes, ["GE1005_CYCLE"]);
  });
}

test("invalid human output is isolated to stderr", () => {
  const result = invoke(["compile", resolve(fixtures, "invalid-cycle.graph.json")]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /GE1005_CYCLE/);
});

test("missing input uses exit two and one JSON error envelope", () => {
  const result = invoke(["validate", resolve(fixtures, "does-not-exist.json"), "--json"]);
  assert.equal(result.status, 2);
  const envelope = parseMachine(result);
  assert.equal(envelope.command, "validate");
  assert.equal(envelope.data, null);
  assert.equal(envelope.error?.code, "GECLI_INPUT_READ");
});

test("invalid JSON from stdin respects the machine stream boundary", () => {
  const result = invoke(["validate", "-", "--json"], "{not json");
  assert.equal(result.status, 2);
  const envelope = parseMachine(result);
  assert.equal(envelope.error?.code, "GECLI_INPUT_JSON");
});

test("doctor reports a healthy local installation through the common envelope", () => {
  const result = invoke(["doctor", "--json"]);
  assert.equal(result.status, 0);
  const envelope = parseMachine<{
    healthy: boolean;
    checks: Array<{ id: string; status: string }>;
    remediations: string[];
  }>(result);
  assert.equal(envelope.command, "doctor");
  assert.equal(envelope.data?.healthy, true);
  assert.deepEqual(
    envelope.data?.checks.map((item) => item.id),
    [
      "node.version",
      "asset.graph-schema",
      "asset.diamond-fixture",
      "dependency.core",
      "dependency.runtime",
    ],
  );
  assert.ok(envelope.data?.checks.every((item) => item.status === "pass"));
  assert.deepEqual(envelope.data?.remediations, []);
});

test("doctor human output remains a read-only summary on stdout", () => {
  const result = invoke(["doctor"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^Graph Engineering doctor: healthy/m);
  assert.match(result.stdout, /Canonical core compiler/);
  assert.match(result.stdout, /Graph runtime package/);
});

test("a broken package-local doctor exits three with bounded remediation", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "graph-engineering-cli-doctor-"));
  try {
    const copiedSource = resolve(temporaryRoot, "dist/src");
    await mkdir(copiedSource, { recursive: true });
    await cp(resolve(import.meta.dirname, "../src"), copiedSource, { recursive: true });
    const result = spawnSync(process.execPath, [resolve(copiedSource, "cli.js"), "doctor", "--json"], {
      cwd: temporaryRoot,
      encoding: "utf8",
    });
    if (result.error !== undefined) throw result.error;
    const invocation = { status: result.status, stdout: result.stdout, stderr: result.stderr };
    assert.equal(invocation.status, 3);
    const envelope = parseMachine<{ healthy: boolean; remediations: string[] }>(invocation);
    assert.equal(envelope.command, "doctor");
    assert.equal(envelope.data?.healthy, false);
    assert.ok((envelope.data?.remediations.length ?? 0) <= 3);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("doctor rejects operands before performing any path-based check", () => {
  const result = invoke(["doctor", "/definitely/not/a/doctor/input", "--json"]);
  assert.equal(result.status, 2);
  const envelope = parseMachine(result);
  assert.equal(envelope.command, "doctor");
  assert.equal(envelope.error?.code, "GECLI_USAGE");
  assert.match(envelope.error?.message ?? "", /does not accept/);
});
