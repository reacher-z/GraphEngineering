#!/usr/bin/env node

/**
 * Pattern-bundle machine gate (master plan section 21.1).
 *
 * For every `examples/patterns/<bundle>/manifest.json` this checker:
 *
 *   1. validates the manifest against `spec/pattern-bundle.schema.json`
 *      (Draft 2020-12, same Ajv engine as `scripts/validate-fixtures.mjs`);
 *   2. cross-checks the manifest's claims against the filesystem: every file
 *      the manifest references must exist, every referenced markdown anchor
 *      must resolve to a real heading, the committed JSON graph must
 *      canonicalize to the recorded `graphs.canonicalHash` under the real
 *      `packages/core` hash, and the committed YAML graph must decode to the
 *      same document and therefore the same hash.
 *
 * The gate checks claims in both directions and only in both directions:
 * a manifest claiming an artifact the filesystem lacks fails; a manifest
 * honestly declaring a gap (`adapters.realProvider: null`,
 * `tests.packedInstall: null`, a `limitations` entry such as `notInCi`)
 * passes. The checker never fabricates a capability claim from a declared
 * absence.
 *
 * Modes:
 *   --all                       check every discovered bundle (default)
 *   --root <dir>                discover bundles under <dir> instead of
 *                               examples/patterns (used for self-tests)
 *   --negative-fixture <file>   additionally assert that <file> is REJECTED
 *                               by the schema; a validating negative fixture
 *                               fails the gate (gate self-test)
 *
 * Prerequisite: `packages/core/dist` must exist (the hash cross-check uses
 * the real canonicalHash/decodeGraphSource implementations, exactly like
 * `packages/patterns/test/research-diamond.test.ts`). Build it with:
 *   corepack pnpm --filter @graph-engineering/core build
 */

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = join(repositoryRoot, "spec", "pattern-bundle.schema.json");
const coreDistEntry = join(repositoryRoot, "packages", "core", "dist", "index.js");

function fail(message) {
  process.stderr.write(`check-pattern-bundles: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let checkAll = false;
let negativeFixturePath = null;
let bundleDiscoveryRoot = join(repositoryRoot, "examples", "patterns");
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--all") {
    checkAll = true;
  } else if (argument === "--negative-fixture") {
    index += 1;
    if (index >= args.length) fail("--negative-fixture requires a file argument");
    negativeFixturePath = resolve(repositoryRoot, args[index]);
  } else if (argument === "--root") {
    index += 1;
    if (index >= args.length) fail("--root requires a directory argument");
    bundleDiscoveryRoot = resolve(repositoryRoot, args[index]);
  } else {
    fail(`unknown argument: ${argument}`);
  }
}
if (!checkAll && negativeFixturePath === null) checkAll = true;

// Bundles live at `<repo>/examples/patterns/<bundle>/`, so the repository a
// discovery root belongs to is always two levels up. Keeping this relative to
// the discovery root (instead of hard-coding this checkout) is what lets the
// self-test run the checker against a corrupted copy under a scratch root.
const bundleRepositoryRoot = resolve(bundleDiscoveryRoot, "..", "..");

// ---------------------------------------------------------------------------
// Real hash implementation from packages/core (build prerequisite)
// ---------------------------------------------------------------------------

if (!existsSync(coreDistEntry)) {
  fail(
    "packages/core/dist/index.js is missing. The hash cross-check uses the real "
      + "packages/core canonicalizer; build it first with:\n"
      + "  corepack pnpm --filter @graph-engineering/core build",
  );
}
const { canonicalHash, decodeGraphSource } = await import(pathToFileURL(coreDistEntry).href);

// ---------------------------------------------------------------------------
// Schema compilation — same Ajv engine and settings as validate-fixtures.mjs
// ---------------------------------------------------------------------------

const bundleSchema = JSON.parse(await readFile(schemaPath, "utf8"));
const engine = new Ajv2020({ allErrors: true, strict: true });
if (engine.validateSchema(bundleSchema) !== true) {
  fail(`spec/pattern-bundle.schema.json is not a valid Draft 2020-12 schema: ${JSON.stringify(engine.errors)}`);
}
const validateBundle = engine.compile(bundleSchema);

function formatSchemaErrors(errors) {
  return (errors ?? []).map((error) => `${error.instancePath || "#"} ${error.message}`);
}

// ---------------------------------------------------------------------------
// Cross-check helpers
// ---------------------------------------------------------------------------

function isPathWithin(candidate, root) {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !relation.startsWith(sep));
}

/** GitHub-style anchor for a markdown heading. */
function headingAnchor(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/gu, "-");
}

async function markdownAnchors(filePath) {
  const anchors = new Set();
  let inFence = false;
  for (const line of (await readFile(filePath, "utf8")).split("\n")) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^#{1,6}\s+(.+?)\s*$/u.exec(line);
    if (match) anchors.add(headingAnchor(match[1]));
  }
  return anchors;
}

async function checkBundle(bundleDirectory) {
  const bundleName = relative(bundleRepositoryRoot, bundleDirectory);
  const issues = [];
  const notes = [];
  const manifestPath = join(bundleDirectory, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return { bundleName, issues: [`manifest.json could not be parsed: ${error.message}`], notes };
  }

  if (validateBundle(manifest) !== true) {
    issues.push(...formatSchemaErrors(validateBundle.errors).map((text) => `schema: ${text}`));
    return { bundleName, issues, notes };
  }

  /** Resolve a manifest file reference (relative to the bundle directory). */
  function resolveReference(reference, label) {
    if (reference.includes("\\")) {
      issues.push(`${label}: reference must use '/' separators: ${reference}`);
      return null;
    }
    const candidate = normalize(join(bundleDirectory, reference));
    if (!isPathWithin(candidate, bundleRepositoryRoot)) {
      issues.push(`${label}: reference escapes the repository root: ${reference}`);
      return null;
    }
    return candidate;
  }

  function requireFile(reference, label) {
    const candidate = resolveReference(reference, label);
    if (candidate === null) return null;
    if (!existsSync(candidate)) {
      issues.push(`${label}: manifest claims ${reference} but no such file exists`);
      return null;
    }
    return candidate;
  }

  async function requireAnchor(reference, label) {
    const [filePart, ...anchorParts] = reference.split("#");
    const filePath = requireFile(filePart, label);
    if (filePath === null || anchorParts.length === 0) return;
    const anchor = anchorParts.join("#");
    const anchors = await markdownAnchors(filePath);
    if (!anchors.has(anchor)) {
      issues.push(`${label}: manifest claims anchor #${anchor} but ${filePart} has no such heading`);
    }
  }

  // -- graphs: files exist, JSON canonicalizes to the recorded hash, and the
  //    YAML document decodes to the same graph (therefore the same hash).
  const graphJsonPath = requireFile(manifest.graphs.json, "graphs.json");
  const graphYamlPath = requireFile(manifest.graphs.yaml, "graphs.yaml");
  let graphDocument = null;
  if (graphJsonPath !== null) {
    try {
      graphDocument = JSON.parse(await readFile(graphJsonPath, "utf8"));
    } catch (error) {
      issues.push(`graphs.json: ${manifest.graphs.json} is not valid JSON: ${error.message}`);
    }
  }
  if (graphDocument !== null) {
    const jsonHash = canonicalHash(graphDocument);
    if (jsonHash !== manifest.graphs.canonicalHash) {
      issues.push(
        `graphs.canonicalHash: manifest records ${manifest.graphs.canonicalHash} `
          + `but ${manifest.graphs.json} canonicalizes to ${jsonHash}`,
      );
    }
    if (graphYamlPath !== null) {
      try {
        const yamlDocument = decodeGraphSource(await readFile(graphYamlPath, "utf8"), { format: "yaml" });
        const yamlHash = canonicalHash(yamlDocument);
        if (yamlHash !== jsonHash) {
          issues.push(
            `graphs.yaml: ${manifest.graphs.yaml} canonicalizes to ${yamlHash}, `
              + `which is not the JSON graph's ${jsonHash}`,
          );
        }
      } catch (error) {
        issues.push(`graphs.yaml: ${manifest.graphs.yaml} could not be decoded: ${error.message}`);
      }
    }
  }

  // -- fixtures: files exist; a fixture that itself records a graph hash must
  //    agree with the manifest (the identity check the package test performs).
  for (const key of ["sourceCorpus", "expectedRun", "expectedEvents"]) {
    const fixturePath = requireFile(manifest.fixtures[key], `fixtures.${key}`);
    if (fixturePath !== null && key === "expectedRun") {
      try {
        const expectedRun = JSON.parse(await readFile(fixturePath, "utf8"));
        if (typeof expectedRun?.graphHash === "string"
          && expectedRun.graphHash !== manifest.graphs.canonicalHash) {
          issues.push(
            `fixtures.expectedRun: fixture records graphHash ${expectedRun.graphHash} `
              + `but the manifest records ${manifest.graphs.canonicalHash}`,
          );
        }
      } catch (error) {
        issues.push(`fixtures.expectedRun: ${manifest.fixtures[key]} is not valid JSON: ${error.message}`);
      }
    }
  }

  // -- adapters: the deterministic mock must exist; a null realProvider is an
  //    honest declared gap and must not fail.
  requireFile(manifest.adapters.deterministicMock, "adapters.deterministicMock");
  if (manifest.adapters.realProvider === null) {
    notes.push("adapters.realProvider is declared null (honest gap; not a failure)");
  } else {
    requireFile(manifest.adapters.realProvider, "adapters.realProvider");
  }

  // -- constructors: both language sources must exist.
  requireFile(manifest.constructors.typescript.source, "constructors.typescript.source");
  requireFile(manifest.constructors.python.source, "constructors.python.source");

  // -- executions: every command must name at least one existing file inside
  //    this bundle (repository-root relative, the way the commands are run).
  for (const [scenario, commands] of Object.entries(manifest.executions)) {
    for (const [language, command] of Object.entries(commands)) {
      const label = `executions.${scenario}.${language}`;
      const pathTokens = command.split(/\s+/u).filter((token) => token.includes("/"));
      const bundleFiles = pathTokens
        .map((token) => normalize(join(bundleRepositoryRoot, token)))
        .filter((candidate) => isPathWithin(candidate, bundleDirectory));
      if (bundleFiles.length === 0) {
        issues.push(`${label}: command references no file inside ${bundleName}: ${command}`);
        continue;
      }
      for (const candidate of bundleFiles) {
        if (!existsSync(candidate)) {
          issues.push(
            `${label}: command references ${relative(bundleRepositoryRoot, candidate)} but no such file exists`,
          );
        }
      }
    }
  }

  // -- tests: the fixture-agreement test file must exist (repository-root
  //    relative); packedInstall: null is an honest declared gap.
  const fixtureAgreementPath = normalize(join(bundleRepositoryRoot, manifest.tests.fixtureAgreement));
  if (!isPathWithin(fixtureAgreementPath, bundleRepositoryRoot) || !existsSync(fixtureAgreementPath)) {
    issues.push(
      `tests.fixtureAgreement: manifest claims ${manifest.tests.fixtureAgreement} but no such file exists`,
    );
  }
  if (manifest.tests.packedInstall === null) {
    notes.push("tests.packedInstall is declared null (honest gap; not a failure)");
  }
  if (typeof manifest.limitations.notInCi === "string") {
    notes.push("limitations.notInCi is declared (honest gap; not a failure)");
  }

  // -- docs and diagrams: files exist and anchored references resolve to a
  //    real markdown heading. `diagrams.traceVisualization` is prose, not a
  //    file reference, and the schema keeps it that way.
  await requireAnchor(manifest.docs.bundleReadme, "docs.bundleReadme");
  await requireAnchor(manifest.docs.launchGuides, "docs.launchGuides");
  await requireAnchor(manifest.docs.runbook, "docs.runbook");
  for (const key of ["topology", "sequence", "recovery", "dataFlow", "authority"]) {
    await requireAnchor(manifest.diagrams[key], `diagrams.${key}`);
  }

  return { bundleName, issues, notes };
}

// ---------------------------------------------------------------------------
// Negative fixture self-test: the schema must REJECT the fixture
// ---------------------------------------------------------------------------

let failed = false;

if (negativeFixturePath !== null) {
  let fixture;
  try {
    fixture = JSON.parse(await readFile(negativeFixturePath, "utf8"));
  } catch (error) {
    fail(`negative fixture could not be read: ${error.message}`);
  }
  if (validateBundle(fixture) === true) {
    process.stdout.write(
      `FAIL negative fixture ${relative(repositoryRoot, negativeFixturePath)} — `
        + "the schema ACCEPTED it, so the gate cannot detect a missing resume section\n",
    );
    failed = true;
  } else {
    const reasons = formatSchemaErrors(validateBundle.errors);
    process.stdout.write(
      `ok   negative fixture ${relative(repositoryRoot, negativeFixturePath)} rejected `
        + `(${reasons.length} schema error${reasons.length === 1 ? "" : "s"})\n`,
    );
    for (const reason of reasons) process.stdout.write(`       - ${reason}\n`);
  }
}

// ---------------------------------------------------------------------------
// Bundle discovery and checking
// ---------------------------------------------------------------------------

if (checkAll) {
  if (!existsSync(bundleDiscoveryRoot)) fail(`bundle root does not exist: ${bundleDiscoveryRoot}`);
  const entries = await readdir(bundleDiscoveryRoot, { withFileTypes: true });
  const bundleDirectories = entries
    .filter((entry) => entry.isDirectory()
      && existsSync(join(bundleDiscoveryRoot, entry.name, "manifest.json")))
    .map((entry) => join(bundleDiscoveryRoot, entry.name))
    .sort();
  if (bundleDirectories.length === 0) {
    fail(`no */manifest.json bundles found under ${bundleDiscoveryRoot}`);
  }
  for (const bundleDirectory of bundleDirectories) {
    const { bundleName, issues, notes } = await checkBundle(bundleDirectory);
    if (issues.length === 0) {
      process.stdout.write(`ok   ${bundleName}\n`);
      for (const note of notes) process.stdout.write(`       note: ${note}\n`);
    } else {
      failed = true;
      process.stdout.write(`FAIL ${bundleName}\n`);
      for (const issue of issues) process.stdout.write(`       - ${issue}\n`);
    }
  }
}

process.exit(failed ? 1 : 0);
