import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const cliEntrypoint = resolve(import.meta.dirname, "../src/cli.js");
const validGraphPath = resolve(workspaceRoot, "examples/quickstart/research-diamond.graph.json");
const invalidGraphPath = resolve(workspaceRoot, "spec/conformance/invalid-cycle.graph.json");

const HOSTILE_CONTROLS =
  "C0\u0001BEL\u0007BS\u0008TAB\u0009LF\u000ACR\u000DESC\u001B" +
  "DEL\u007FC1\u009BALM\u061CLRM\u200ERLM\u200FLS\u2028PS\u2029" +
  "LRE\u202ARLE\u202BRLO\u202EPDF\u202CLRI\u2066RLI\u2067FSI\u2068PDI\u2069";

const EXPECTED_VISIBLE_ESCAPES = [
  "\\u{0001}",
  "\\u{0007}",
  "\\u{0008}",
  "\\u{0009}",
  "\\u{000A}",
  "\\u{000D}",
  "\\u{001B}",
  "\\u{007F}",
  "\\u{009B}",
  "\\u{061C}",
  "\\u{200E}",
  "\\u{200F}",
  "\\u{2028}",
  "\\u{2029}",
  "\\u{202A}",
  "\\u{202B}",
  "\\u{202E}",
  "\\u{202C}",
  "\\u{2066}",
  "\\u{2067}",
  "\\u{2068}",
  "\\u{2069}",
] as const;

const UNSAFE_TERMINAL_CHARACTER =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

interface Invocation {
  status: number | null;
  stdout: string;
  stderr: string;
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

function assertSafeHumanStream(stream: string, expectedPhysicalLines: number): void {
  assert.ok(stream.endsWith("\n"), "human output must retain its final newline");
  const lines = stream.slice(0, -1).split("\n");
  assert.equal(lines.length, expectedPhysicalLines, "caller input must not inject lines");
  for (const line of lines) {
    assert.doesNotMatch(line, UNSAFE_TERMINAL_CHARACTER);
  }
}

function assertAllControlsVisible(stream: string): void {
  for (const escaped of EXPECTED_VISIBLE_ESCAPES) {
    assert.ok(stream.includes(escaped), `human output should contain ${escaped}`);
  }
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(access(path), { code: "ENOENT" });
}

test("missing-input human diagnostics neutralize real argv terminal controls", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-terminal-read-"));
  try {
    const path = join(root, `missing-${HOSTILE_CONTROLS}.json`);
    const result = invoke(["validate", path]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assertSafeHumanStream(result.stderr, 1);
    assertAllControlsVisible(result.stderr);
    assert.match(result.stderr, /^graph: cannot read /);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("machine missing-input diagnostics retain one standard JSON document", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-terminal-machine-"));
  try {
    const path = join(root, `missing-${HOSTILE_CONTROLS}.json`);
    const result = invoke(["validate", path, "--json"]);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.endsWith("\n"));
    assert.equal(result.stdout.trimEnd().split("\n").length, 1);
    const envelope = JSON.parse(result.stdout) as {
      error: { code: string; message: string };
    };
    assert.equal(envelope.error.code, "GECLI_INPUT_READ");
    assert.ok(envelope.error.message.includes("\n"));
    assert.ok(envelope.error.message.includes("\u001b"));
    assert.ok(envelope.error.message.includes("\u009b"));
    assert.ok(envelope.error.message.includes("\u202e"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid-JSON diagnostics neutralize controls in an existing input path", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-terminal-json-"));
  try {
    const path = join(root, `invalid-${HOSTILE_CONTROLS}.json`);
    await writeFile(path, "{not valid json", "utf8");
    const result = invoke(["validate", path]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assertSafeHumanStream(result.stderr, 1);
    assertAllControlsVisible(result.stderr);
    assert.match(result.stderr, /^graph: invalid JSON in /);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful human summaries neutralize controls in an existing filename", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-terminal-success-"));
  try {
    const path = join(root, `valid-${HOSTILE_CONTROLS}.json`);
    await writeFile(path, await readFile(validGraphPath, "utf8"), "utf8");
    for (const [command, lines] of [["validate", 2], ["compile", 3]] as const) {
      const result = invoke([command, path]);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      assertSafeHumanStream(result.stdout, lines);
      assertAllControlsVisible(result.stdout);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid-graph human diagnostics remain safe for a hostile input filename", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-terminal-invalid-"));
  try {
    const path = join(root, `cycle-${HOSTILE_CONTROLS}.json`);
    await writeFile(path, await readFile(invalidGraphPath, "utf8"), "utf8");
    const result = invoke(["validate", path]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assertSafeHumanStream(result.stderr, 2);
    assertAllControlsVisible(result.stderr);
    assert.match(result.stderr, /GE1005_CYCLE/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("core diagnostic text cannot inject terminal controls", async () => {
  const graph = JSON.parse(await readFile(validGraphPath, "utf8")) as {
    edges: Array<{ from: { node: string } }>;
  };
  assert.ok(graph.edges.length > 0);
  graph.edges[0]!.from.node = HOSTILE_CONTROLS;
  const result = invoke(["validate", "-"], JSON.stringify(graph));
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assertSafeHumanStream(result.stderr, 2);
  assertAllControlsVisible(result.stderr);
  assert.match(result.stderr, /GE1003_MISSING_SOURCE/);
});

test("init dry-run makes a hostile target visible without creating it", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-terminal-init-dry-"));
  try {
    const target = join(root, `target-${HOSTILE_CONTROLS}`);
    await assertMissing(target);
    const result = invoke(["init", target, "--dry-run"]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assertSafeHumanStream(result.stdout, 4);
    assertAllControlsVisible(result.stdout);
    await assertMissing(target);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init refusal neutralizes controls in a hostile existing target", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-terminal-init-error-"));
  try {
    const target = join(root, `file-${HOSTILE_CONTROLS}`);
    await writeFile(target, "occupied", "utf8");
    const result = invoke(["init", target]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assertSafeHumanStream(result.stderr, 1);
    assertAllControlsVisible(result.stderr);
    assert.equal(await readFile(target, "utf8"), "occupied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("usage errors neutralize controls in a real format argv", () => {
  const result = invoke([
    "visualize",
    validGraphPath,
    "--format",
    `svg-${HOSTILE_CONTROLS}`,
  ]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assertSafeHumanStream(result.stderr, 2);
  assertAllControlsVisible(result.stderr);
  assert.match(result.stderr, /Run graph --help for usage\.$/m);
});

test("ordinary ASCII paths remain readable instead of being blanket escaped", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge-cli-terminal-ascii-"));
  try {
    const path = join(root, "ordinary missing graph.json");
    const result = invoke(["validate", path]);
    assert.equal(result.status, 2);
    assertSafeHumanStream(result.stderr, 1);
    assert.ok(result.stderr.includes(path));
    assert.equal(result.stderr.includes("\\u{"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
