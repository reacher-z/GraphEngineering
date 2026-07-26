import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compileGraph } from "@graph-engineering/core";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const cliEntrypoint = resolve(import.meta.dirname, "../src/cli.js");
const canonicalTemplate = resolve(
  workspaceRoot,
  "examples/quickstart/research-diamond.graph.json",
);

interface Invocation {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface InitEnvelope {
  schemaVersion: "graph-engineering.cli/v1alpha1";
  command: "init";
  ok: boolean;
  exitCode: number;
  data: {
    targetDirectory: string;
    dryRun: boolean;
    created: boolean;
    directoryCreated: boolean;
    wouldCreateDirectory: boolean;
    files: string[];
    template: string;
    graphHash: string;
  } | null;
  error: { code: string; message: string } | null;
}

function invoke(args: readonly string[], cwd = workspaceRoot): Invocation {
  const result = spawnSync(process.execPath, [cliEntrypoint, ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function invokeAsync(args: readonly string[], cwd = workspaceRoot): Promise<Invocation> {
  return new Promise((resolveInvocation, reject) => {
    const child = spawn(process.execPath, [cliEntrypoint, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => {
      resolveInvocation({ status, stdout, stderr });
    });
  });
}

function machine(result: Invocation): InitEnvelope {
  assert.equal(result.stderr, "", "init --json must not write stderr");
  assert.ok(result.stdout.endsWith("\n"));
  assert.equal(result.stdout.trim().split("\n").length, 1);
  const envelope = JSON.parse(result.stdout) as InitEnvelope;
  assert.equal(envelope.schemaVersion, "graph-engineering.cli/v1alpha1");
  assert.equal(envelope.command, "init");
  assert.equal(envelope.exitCode, result.status);
  return envelope;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function withTemporaryDirectory(
  action: (path: string) => Promise<void>,
): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "graph-engineering-init-"));
  try {
    await action(temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test("init creates a new nested directory from the exact canonical quickstart template", async () => {
  await withTemporaryDirectory(async (temporary) => {
    const target = resolve(temporary, "nested/project");
    const result = invoke(["init", target, "--json"]);
    assert.equal(result.status, 0);
    const envelope = machine(result);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.error, null);
    assert.equal(envelope.data?.created, true);
    assert.equal(envelope.data?.directoryCreated, true);
    assert.equal(envelope.data?.wouldCreateDirectory, true);
    assert.deepEqual(envelope.data?.files, ["graph.json"]);

    const generated = await readFile(resolve(target, "graph.json"));
    const canonical = await readFile(canonicalTemplate);
    assert.deepEqual(generated, canonical);
    const compilation = compileGraph(JSON.parse(generated.toString("utf8")) as unknown);
    assert.equal(compilation.valid, true);
    assert.equal(envelope.data?.graphHash, compilation.graphHash);
  });
});

test("init accepts an existing empty non-symlink directory", async () => {
  await withTemporaryDirectory(async (temporary) => {
    const target = resolve(temporary, "empty");
    await mkdir(target);
    const result = invoke(["init", target]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^✓ Initialized Graph Engineering project/m);
    assert.deepEqual(await readdir(target), ["graph.json"]);
    assert.deepEqual(await readFile(resolve(target, "graph.json")), await readFile(canonicalTemplate));
  });
});

test("init defaults to the current empty directory", async () => {
  await withTemporaryDirectory(async (temporary) => {
    const result = invoke(["init", "--json"], temporary);
    assert.equal(result.status, 0);
    const envelope = machine(result);
    assert.equal(envelope.data?.targetDirectory, temporary);
    assert.equal(envelope.data?.directoryCreated, false);
    assert.deepEqual(await readdir(temporary), ["graph.json"]);
  });
});

test("init refuses a non-empty directory without modifying existing files", async () => {
  await withTemporaryDirectory(async (temporary) => {
    const target = resolve(temporary, "occupied");
    const sentinel = resolve(target, "keep.txt");
    await mkdir(target);
    await writeFile(sentinel, "user-owned\n", "utf8");

    const result = invoke(["init", target, "--json"]);
    assert.equal(result.status, 2);
    const envelope = machine(result);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.data, null);
    assert.equal(envelope.error?.code, "GECLI_INIT_TARGET_NOT_EMPTY");
    assert.equal(await readFile(sentinel, "utf8"), "user-owned\n");
    assert.deepEqual(await readdir(target), ["keep.txt"]);
  });
});

test("init refuses an existing file as its target", async () => {
  await withTemporaryDirectory(async (temporary) => {
    const target = resolve(temporary, "existing-file");
    await writeFile(target, "do not replace\n", "utf8");
    const result = invoke(["init", target, "--json"]);
    assert.equal(result.status, 2);
    const envelope = machine(result);
    assert.equal(envelope.error?.code, "GECLI_INIT_TARGET_NOT_DIRECTORY");
    assert.equal(await readFile(target, "utf8"), "do not replace\n");
  });
});

test("init refuses a symlink target even when it points to an empty directory", async () => {
  await withTemporaryDirectory(async (temporary) => {
    const realTarget = resolve(temporary, "real-target");
    const linkedTarget = resolve(temporary, "linked-target");
    await mkdir(realTarget);
    await symlink(realTarget, linkedTarget, "dir");

    const result = invoke(["init", linkedTarget, "--json"]);
    assert.equal(result.status, 2);
    const envelope = machine(result);
    assert.equal(envelope.error?.code, "GECLI_INIT_TARGET_SYMLINK");
    assert.deepEqual(await readdir(realTarget), []);
    assert.equal((await lstat(linkedTarget)).isSymbolicLink(), true);
  });
});

test("two concurrent init processes yield exactly one success", async () => {
  await withTemporaryDirectory(async (temporary) => {
    const target = resolve(temporary, "race-target");
    const invocations = await Promise.all([
      invokeAsync(["init", target, "--json"]),
      invokeAsync(["init", target, "--json"]),
    ]);
    assert.deepEqual(invocations.map((item) => item.status).sort(), [0, 2]);
    const envelopes = invocations.map(machine);
    assert.equal(envelopes.filter((item) => item.ok).length, 1);
    assert.equal(envelopes.filter((item) => !item.ok).length, 1);
    assert.ok(
      [
        "GECLI_INIT_TARGET_NOT_EMPTY",
        "GECLI_INIT_EXCLUSIVE_CREATE",
        "GECLI_INIT_TARGET_CHANGED",
      ].includes(envelopes.find((item) => !item.ok)?.error?.code ?? ""),
    );
    assert.deepEqual(await readdir(target), ["graph.json"]);
    assert.deepEqual(await readFile(resolve(target, "graph.json")), await readFile(canonicalTemplate));
  });
});

test("init dry-run reports the plan and performs zero writes", async () => {
  await withTemporaryDirectory(async (temporary) => {
    const target = resolve(temporary, "dry/nested/project");
    const result = invoke(["--json", "init", target, "--dry-run"]);
    assert.equal(result.status, 0);
    const envelope = machine(result);
    assert.equal(envelope.data?.dryRun, true);
    assert.equal(envelope.data?.created, false);
    assert.equal(envelope.data?.directoryCreated, false);
    assert.equal(envelope.data?.wouldCreateDirectory, true);
    assert.equal(await exists(resolve(temporary, "dry")), false);
    assert.equal(await exists(target), false);
    assert.deepEqual(await readdir(temporary), []);
  });
});

test("init human refusal writes only stderr", async () => {
  await withTemporaryDirectory(async (temporary) => {
    await writeFile(resolve(temporary, "keep.txt"), "keep", "utf8");
    const result = invoke(["init"], temporary);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /refusing non-empty init target/);
    assert.deepEqual(await readdir(temporary), ["keep.txt"]);
  });
});

test("init has no force or implicit-overwrite option", async () => {
  await withTemporaryDirectory(async (temporary) => {
    const result = invoke(["init", "--force", "--json"], temporary);
    assert.equal(result.status, 2);
    const envelope = machine(result);
    assert.equal(envelope.error?.code, "GECLI_USAGE");
    assert.deepEqual(await readdir(temporary), []);
  });
});
