import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TaskRegistryError,
  parseJsonText,
  validateTaskRegistry,
  validateTaskRegistryCandidate,
} from "../check-task-registry.mjs";
import { parseDependencyRulesText, validateTaskGraph } from "../check-task-graph.mjs";
import "./release-invalidation.test.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, "codex_logs/task-registry.json"), "utf8"));
const GRAPH = fs.readFileSync(path.join(ROOT, "codex_plans/delivery/task-dependency-graph.md"), "utf8");
const RULES_TEXT = fs.readFileSync(path.join(ROOT, "codex_plans/delivery/release-dependency-rules.json"), "utf8");
const RULES = parseDependencyRulesText(RULES_TEXT);
const clone = (value) => structuredClone(value);

function rejects(code, operation) {
  assert.throws(operation, (error) => error instanceof TaskRegistryError && error.code === code);
}

test("live registry is structurally valid and acyclic", () => {
  const registry = validateTaskRegistry(REGISTRY, { repoRoot: ROOT });
  assert.equal(registry.taskCount, 111);
  const graph = validateTaskGraph(REGISTRY, GRAPH, RULES);
  assert.equal(graph.taskCount, 111);
  assert.equal(graph.semanticEdgeCount, 70);
});

test("raw duplicate JSON keys cannot hide dependency attacks", () => {
  rejects("duplicate-json-key", () => parseJsonText('{"depends_on":["D99-MISSING-999"],"depends_on":[]}'));
  rejects("duplicate-json-key", () => parseDependencyRulesText('{"schema_version":1,"schema_version":1}'));
});

test("duplicate IDs and dangling dependencies fail closed", () => {
  const duplicate = clone(REGISTRY);
  duplicate.tasks[1].id = duplicate.tasks[0].id;
  rejects("duplicate-task", () => validateTaskRegistry(duplicate, { repoRoot: ROOT }));
  const dangling = clone(REGISTRY);
  dangling.tasks.at(-1).depends_on = ["D99-MISSING-999"];
  rejects("dangling-dependency", () => validateTaskRegistry(dangling, { repoRoot: ROOT }));
});

test("dependency cycles and unknown documented tasks fail closed", () => {
  const cyclic = clone(REGISTRY);
  const trace = cyclic.tasks.find(({ id }) => id === "D4-TRACE-SUBGRAPH-022");
  const router = cyclic.tasks.find(({ id }) => id === "D6-ROUTER-BARRIER-023");
  trace.depends_on = ["D6-ROUTER-BARRIER-023"];
  router.depends_on = ["D4-TRACE-SUBGRAPH-022"];
  rejects("dependency-cycle", () => validateTaskGraph(cyclic));
  rejects(
    "unknown-documented-task",
    () => validateTaskGraph(REGISTRY, `${GRAPH}\nUnknown control: D99-MISSING-999.`),
  );
});

test("strict mode cannot be waived with evidence_required false", () => {
  const registry = minimalRegistry();
  registry.tasks[0].evidence_required = false;
  registry.tasks[0].test_evidence = [];
  registry.tasks[0].completion_evidence = [];
  rejects("strict-evidence-open", () => validateTaskRegistry(registry, { repoRoot: ROOT, strict: true }));
});

test("unsafe artifacts, impossible instants, and stale roots fail closed", () => {
  const unsafe = clone(REGISTRY);
  unsafe.tasks[0].expected_artifacts[0] = "../escape";
  rejects("unsafe-artifact", () => validateTaskRegistry(unsafe, { repoRoot: ROOT }));
  const impossible = clone(REGISTRY);
  impossible.tasks[0].assigned_at = "2099-02-31T00:00:00Z";
  rejects("invalid-time", () => validateTaskRegistry(impossible, { repoRoot: ROOT }));
  const stale = clone(REGISTRY);
  stale.tasks.forEach((task) => { task.test_evidence = []; });
  stale.updated_at = "2026-07-30T13:44:59Z";
  rejects("stale-root", () => validateTaskRegistry(stale, { repoRoot: ROOT }));
});

test("completion and evidence chronology fail closed", () => {
  const completion = minimalRegistry();
  completion.tasks[0].started_at = "2026-01-01T00:03:00Z";
  completion.tasks[0].completed_at = "2026-01-01T00:02:00Z";
  completion.tasks[0].last_heartbeat = "2026-01-01T00:04:00Z";
  completion.updated_at = "2026-01-01T00:04:00Z";
  rejects("invalid-time-order", () => validateTaskRegistry(completion, { repoRoot: ROOT }));

  const evidence = minimalRegistry();
  evidence.tasks[0].test_evidence[0].recorded_at = "2026-01-01T00:03:00Z";
  rejects("invalid-evidence-time", () => validateTaskRegistry(evidence, { repoRoot: ROOT }));
});

test("candidate validation reads immutable Git registry and artifact entries", (context) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "graph-task-candidate-"));
  context.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Task Control Test");
  git("config", "user.email", "task-control@example.invalid");
  fs.mkdirSync(path.join(repo, "codex_logs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "artifact.txt"), "immutable artifact\n");
  git("add", "artifact.txt");
  git("commit", "--quiet", "-m", "artifact evidence");
  const evidenceCommit = git("rev-parse", "HEAD");
  const registry = minimalRegistry({
    artifact: "artifact.txt",
    completionEvidence: [`commit:${evidenceCommit}`, "artifact.txt"],
    evidenceReference: "artifact.txt",
  });
  fs.writeFileSync(path.join(repo, "codex_logs/task-registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
  git("add", "codex_logs/task-registry.json");
  git("commit", "--quiet", "-m", "candidate registry");
  const candidate = git("rev-parse", "HEAD");

  fs.rmSync(path.join(repo, "artifact.txt"));
  fs.writeFileSync(path.join(repo, "codex_logs/task-registry.json"), "{}\n");
  const result = validateTaskRegistryCandidate(candidate, {
    repoRoot: repo,
    registryPath: path.join(repo, "codex_logs/task-registry.json"),
  });
  assert.deepEqual(result, { taskCount: 1, completedCount: 1 });

  fs.writeFileSync(path.join(repo, "artifact.txt"), "immutable artifact\n");
  const fabricated = minimalRegistry({
    artifact: "artifact.txt",
    completionEvidence: [`commit:${evidenceCommit}`, "artifact.txt"],
    evidenceReference: "fabricated-reference",
  });
  fs.writeFileSync(path.join(repo, "codex_logs/task-registry.json"), `${JSON.stringify(fabricated, null, 2)}\n`);
  git("add", "artifact.txt", "codex_logs/task-registry.json");
  git("commit", "--quiet", "-m", "fabricated evidence reference");
  const fabricatedCandidate = git("rev-parse", "HEAD");
  rejects("candidate-artifact-missing", () => validateTaskRegistryCandidate(fabricatedCandidate, {
    repoRoot: repo,
    registryPath: path.join(repo, "codex_logs/task-registry.json"),
  }));

  fs.writeFileSync(path.join(repo, "codex_logs/task-registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
  git("add", "codex_logs/task-registry.json");
  git("commit", "--quiet", "-m", "restore exact evidence reference");
  const restoredCandidate = git("rev-parse", "HEAD");

  const orphan = git("commit-tree", `${restoredCandidate}^{tree}`, "-m", "unrelated candidate");
  rejects("candidate-not-ancestor", () => validateTaskRegistryCandidate(orphan, {
    repoRoot: repo,
    registryPath: path.join(repo, "codex_logs/task-registry.json"),
  }));

  fs.rmSync(path.join(repo, "artifact.txt"));
  git("add", "-u");
  git("commit", "--quiet", "-m", "remove candidate artifact");
  const missingArtifactCandidate = git("rev-parse", "HEAD");
  rejects("candidate-artifact-missing", () => validateTaskRegistryCandidate(missingArtifactCandidate, {
    repoRoot: repo,
    registryPath: path.join(repo, "codex_logs/task-registry.json"),
  }));
});

function minimalRegistry({
  artifact = "package.json",
  completionEvidence = ["package.json"],
  evidenceReference = "deterministic fixture",
} = {}) {
  return {
    schema_version: 1,
    repository: ".",
    updated_at: "2026-01-01T00:02:00Z",
    tasks: [{
      id: "D1-TEST-999",
      title: "Hostile control fixture",
      owner: "test",
      status: "completed",
      work_package: "test",
      depends_on: [],
      expected_artifacts: [artifact],
      expected_tests: ["hostile mutation is rejected"],
      test_evidence: [{
        requirement: "hostile mutation is rejected",
        result: "passed",
        recorded_at: "2026-01-01T00:02:00Z",
        reference: evidenceReference,
      }],
      completion_evidence: completionEvidence,
      evidence_required: true,
      assigned_at: "2026-01-01T00:00:00Z",
      started_at: "2026-01-01T00:01:00Z",
      last_heartbeat: "2026-01-01T00:02:00Z",
      completed_at: "2026-01-01T00:02:00Z",
      risk: "low",
      blocker: null,
      next_action: "retain fixture",
    }],
  };
}
