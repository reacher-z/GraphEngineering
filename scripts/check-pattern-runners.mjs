#!/usr/bin/env node

/**
 * Pattern-bundle runner gate (master plan section 21.1).
 *
 * Discovers every `examples/patterns/<bundle>/manifest.json` and executes each
 * command the manifest declares under `executions.*` as a real subprocess from
 * the repository root, asserting exit code 0. The runners compare themselves
 * against the committed fixtures internally; this gate only proves that the
 * documented commands actually run and pass.
 *
 * Prerequisites (fail-fast with an explicit message, never a resolution
 * stack trace):
 *
 *   - The TypeScript runners import from `packages/<name>/dist`, so the
 *     workspace packages they use must be built first:
 *       corepack pnpm --filter @graph-engineering/core build
 *       corepack pnpm --filter @graph-engineering/persistence build
 *       corepack pnpm --filter @graph-engineering/runtime build
 *       corepack pnpm --filter @graph-engineering/adapters build
 *       corepack pnpm --filter @graph-engineering/patterns build
 *     (the root `check:pattern-runners` script performs exactly these builds)
 *   - The Python runners are executed through `uv run --project python`, so
 *     `uv` must be installed and able to materialize the python project env.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const patternsRoot = join(repositoryRoot, "examples", "patterns");
const COMMAND_TIMEOUT_MS = 300_000;

function fail(message) {
  process.stderr.write(`check-pattern-runners: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build prerequisite: the dist entry points the runners import must exist.
// ---------------------------------------------------------------------------

const requiredDistEntries = [
  ["@graph-engineering/core", join("packages", "core", "dist", "index.js")],
  ["@graph-engineering/persistence", join("packages", "persistence", "dist", "index.js")],
  ["@graph-engineering/runtime", join("packages", "runtime", "dist", "index.js")],
  ["@graph-engineering/adapters", join("packages", "adapters", "dist", "index.js")],
  ["@graph-engineering/patterns", join("packages", "patterns", "dist", "src", "index.js")],
];
const missingDist = requiredDistEntries.filter(([, entry]) => !existsSync(join(repositoryRoot, entry)));
if (missingDist.length > 0) {
  fail(
    "the pattern runners import compiled workspace output that is missing:\n"
      + missingDist.map(([name, entry]) => `  - ${entry} (build with: corepack pnpm --filter ${name} build)\n`).join("")
      + "Build the packages above, then re-run this gate.",
  );
}

// ---------------------------------------------------------------------------
// Collect the executions every bundle manifest declares.
// ---------------------------------------------------------------------------

if (!existsSync(patternsRoot)) fail(`bundle root does not exist: ${patternsRoot}`);
const entries = await readdir(patternsRoot, { withFileTypes: true });
const bundleDirectories = entries
  .filter((entry) => entry.isDirectory() && existsSync(join(patternsRoot, entry.name, "manifest.json")))
  .map((entry) => entry.name)
  .sort();
if (bundleDirectories.length === 0) fail(`no */manifest.json bundles found under ${patternsRoot}`);

const commands = [];
for (const bundleName of bundleDirectories) {
  const manifest = JSON.parse(
    await readFile(join(patternsRoot, bundleName, "manifest.json"), "utf8"),
  );
  const executions = manifest.executions;
  if (executions === null || typeof executions !== "object") {
    fail(`${bundleName}/manifest.json declares no executions object`);
  }
  for (const [scenario, languages] of Object.entries(executions)) {
    for (const [language, command] of Object.entries(languages)) {
      if (typeof command !== "string" || command.trim().length === 0) {
        fail(`${bundleName}/manifest.json executions.${scenario}.${language} is not a command`);
      }
      commands.push({ bundleName, scenario, language, command });
    }
  }
}

const needsUv = commands.some(({ command }) => command.split(/\s+/u)[0] === "uv");
if (needsUv) {
  const probe = spawnSync("uv", ["--version"], { encoding: "utf8" });
  if (probe.error !== undefined || probe.status !== 0) {
    fail(
      "a manifest execution uses `uv run --project python`, but `uv` is not runnable "
        + "on this machine. Install uv (https://docs.astral.sh/uv/) and re-run this gate.",
    );
  }
}

// ---------------------------------------------------------------------------
// Run every declared execution as a real subprocess and assert exit 0.
// ---------------------------------------------------------------------------

let failed = false;
for (const { bundleName, scenario, language, command } of commands) {
  const [executable, ...commandArguments] = command.split(/\s+/u);
  const startedAt = Date.now();
  const result = spawnSync(executable, commandArguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - startedAt;
  const label = `${bundleName} ${scenario}.${language}`;
  if (result.error !== undefined || result.status !== 0) {
    failed = true;
    const reason = result.error !== undefined
      ? result.error.message
      : `exit code ${result.status ?? `signal ${result.signal}`}`;
    process.stdout.write(`FAIL ${label} (${reason}, ${elapsedMs}ms): ${command}\n`);
    if (typeof result.stdout === "string" && result.stdout.length > 0) {
      process.stdout.write(`--- stdout ---\n${result.stdout}\n`);
    }
    if (typeof result.stderr === "string" && result.stderr.length > 0) {
      process.stdout.write(`--- stderr ---\n${result.stderr}\n`);
    }
  } else {
    process.stdout.write(`ok   ${label} (exit 0, ${elapsedMs}ms): ${command}\n`);
  }
}

process.exit(failed ? 1 : 0);
