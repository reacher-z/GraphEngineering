#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_REGISTRY = path.join(ROOT, "codex_logs/task-registry.json");
const STATUSES = new Set(["planned", "in_progress", "blocked", "completed"]);
const RISKS = new Set(["low", "medium", "high", "critical"]);
const TASK_ID = /^(?:D\d+-[A-Z0-9-]+-\d{3}|CTRL-[A-Z0-9-]+-\d{3}|PATTERN-\d{2}-[A-Z0-9-]+)$/u;
const GIT_OID = /^[0-9a-f]{40}$/u;
const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/u;

export class TaskRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TaskRegistryError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new TaskRegistryError(code, message);
}

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-shape", `${label} must be an object`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("invalid-shape", `${label} must be a non-empty string`);
  }
  return value;
}

function strings(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail("invalid-shape", `${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const selected = value.map((entry, index) => string(entry, `${label}[${index}]`));
  if (new Set(selected).size !== selected.length) {
    fail("duplicate-value", `${label} contains duplicates`);
  }
  return selected;
}

function rejectDuplicateJsonKeys(source, label) {
  let cursor = 0;
  const whitespace = () => {
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  };
  const jsonString = () => {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") cursor += 2;
      else if (source[cursor] === "\"") {
        cursor += 1;
        return JSON.parse(source.slice(start, cursor));
      } else cursor += 1;
    }
    return "";
  };
  const value = (location) => {
    whitespace();
    if (source[cursor] === "{") {
      cursor += 1;
      whitespace();
      const keys = new Set();
      if (source[cursor] === "}") {
        cursor += 1;
        return;
      }
      while (cursor < source.length) {
        whitespace();
        const key = jsonString();
        if (keys.has(key)) fail("duplicate-json-key", `${label} repeats JSON key ${JSON.stringify(key)} at ${location}`);
        keys.add(key);
        whitespace();
        cursor += 1; // JSON.parse already proved this byte is ':'.
        value(`${location}/${key}`);
        whitespace();
        if (source[cursor] === "}") {
          cursor += 1;
          return;
        }
        cursor += 1; // JSON.parse already proved this byte is ','.
      }
      return;
    }
    if (source[cursor] === "[") {
      cursor += 1;
      whitespace();
      if (source[cursor] === "]") {
        cursor += 1;
        return;
      }
      let index = 0;
      while (cursor < source.length) {
        value(`${location}/${index}`);
        index += 1;
        whitespace();
        if (source[cursor] === "]") {
          cursor += 1;
          return;
        }
        cursor += 1;
      }
      return;
    }
    if (source[cursor] === "\"") {
      jsonString();
      return;
    }
    while (cursor < source.length && !/[\s,\]}]/u.test(source[cursor])) cursor += 1;
  };
  value("$");
}

export function parseJsonText(source, label = "JSON document") {
  if (typeof source !== "string") fail("invalid-json", `${label} must be UTF-8 text`);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    fail("invalid-json", `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  rejectDuplicateJsonKeys(source, label);
  return parsed;
}

function instant(value, label) {
  const selected = string(value, label);
  const match = UTC_INSTANT.exec(selected);
  if (match === null) fail("invalid-time", `${label} must be a canonical ISO-8601 UTC timestamp`);
  const [, year, month, day, hour, minute, second, millisecond = "000"] = match;
  const time = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, +millisecond);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== +year
    || date.getUTCMonth() !== +month - 1
    || date.getUTCDate() !== +day
    || date.getUTCHours() !== +hour
    || date.getUTCMinutes() !== +minute
    || date.getUTCSeconds() !== +second
    || date.getUTCMilliseconds() !== +millisecond
  ) {
    fail("invalid-time", `${label} must name a real UTC instant without normalization`);
  }
  return time;
}

function relativeArtifact(value, label) {
  const selected = string(value, label);
  if (path.isAbsolute(selected) || selected.includes("\0")) {
    fail("unsafe-artifact", `${label} must be a safe repository-relative path`);
  }
  const normalized = path.posix.normalize(selected.replaceAll("\\", "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    fail("unsafe-artifact", `${label} must identify a repository entry`);
  }
  return normalized;
}

function evidenceByRequirement(task, { assignedAt, startedAt, completedAt, updatedAt }) {
  const latest = new Map();
  let newest = 0;
  if (task.test_evidence === undefined) return { latest, newest };
  if (!Array.isArray(task.test_evidence)) {
    fail("invalid-shape", `${task.id}.test_evidence must be an array`);
  }
  const lowerBound = startedAt ?? assignedAt;
  const upperBound = completedAt ?? updatedAt;
  for (const [index, raw] of task.test_evidence.entries()) {
    const evidence = record(raw, `${task.id}.test_evidence[${index}]`);
    const requirement = string(evidence.requirement, `${task.id}.test_evidence[${index}].requirement`);
    if (!task.expected_tests.includes(requirement)) {
      fail("unknown-evidence", `${task.id} records evidence for undeclared requirement ${JSON.stringify(requirement)}`);
    }
    if (evidence.result !== "passed" && evidence.result !== "failed") {
      fail("invalid-evidence", `${task.id} evidence result must be passed or failed`);
    }
    const recordedAt = instant(evidence.recorded_at, `${task.id}.test_evidence[${index}].recorded_at`);
    if (recordedAt < lowerBound || recordedAt > upperBound) {
      fail("invalid-evidence-time", `${task.id} evidence falls outside its task chronology`);
    }
    const reference = string(evidence.reference, `${task.id}.test_evidence[${index}].reference`);
    newest = Math.max(newest, recordedAt);
    const previous = latest.get(requirement);
    if (previous === undefined || recordedAt >= previous.recordedAt) {
      latest.set(requirement, { result: evidence.result, recordedAt, reference });
    }
  }
  return { latest, newest };
}

function runGit(repoRoot, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function resolveCandidate(repoRoot, candidate) {
  if (!GIT_OID.test(candidate)) fail("invalid-candidate", "candidate must be a full lowercase commit SHA");
  let resolved;
  try {
    resolved = runGit(repoRoot, ["rev-parse", "--verify", `${candidate}^{commit}`]).trim();
  } catch {
    fail("invalid-candidate", "candidate commit is unavailable in this checkout");
  }
  if (resolved !== candidate) fail("invalid-candidate", "candidate must resolve exactly to the supplied commit SHA");
  try {
    runGit(repoRoot, ["merge-base", "--is-ancestor", candidate, "HEAD"]);
  } catch {
    fail("candidate-not-ancestor", "candidate must be an ancestor of the checked-out HEAD");
  }
  return candidate;
}

function candidateEntry(repoRoot, candidate, artifact, label) {
  let output;
  try {
    output = runGit(repoRoot, ["ls-tree", "-z", candidate, "--", `:(literal)${artifact}`]);
  } catch {
    fail("candidate-artifact-missing", `${label} is unavailable at candidate ${candidate}`);
  }
  const entries = output.split("\0").filter(Boolean);
  if (entries.length !== 1) fail("candidate-artifact-missing", `${label} is absent at candidate ${candidate}`);
  const match = /^(\d{6}) (blob|tree) ([0-9a-f]{40})\t(.+)$/u.exec(entries[0]);
  if (match === null || match[4] !== artifact || !new Set(["040000", "100644", "100755"]).has(match[1])) {
    fail("unsafe-candidate-artifact", `${label} must be an exact regular blob or tree at candidate ${candidate}`);
  }
  return Object.freeze({ mode: match[1], type: match[2], oid: match[3] });
}

function validateCandidateCompletionReference(reference, context, label) {
  if (reference.startsWith("commit:")) {
    const commit = reference.slice("commit:".length);
    if (!GIT_OID.test(commit)) fail("invalid-completion-reference", `${label} has an invalid commit reference`);
    try {
      const type = runGit(context.repoRoot, ["cat-file", "-t", commit]).trim();
      if (type !== "commit") fail("invalid-completion-reference", `${label} does not identify a commit`);
      runGit(context.repoRoot, ["merge-base", "--is-ancestor", commit, context.candidate]);
    } catch (error) {
      if (error instanceof TaskRegistryError) throw error;
      fail("invalid-completion-reference", `${label} must identify an ancestor of the candidate`);
    }
    return;
  }
  if (reference.startsWith("tree:")) {
    const tree = reference.slice("tree:".length);
    if (!GIT_OID.test(tree)) fail("invalid-completion-reference", `${label} has an invalid tree reference`);
    try {
      if (runGit(context.repoRoot, ["cat-file", "-t", tree]).trim() !== "tree") {
        fail("invalid-completion-reference", `${label} does not identify a tree`);
      }
      if (!context.ancestorTrees.has(tree)) {
        fail("invalid-completion-reference", `${label} must identify the root tree of a candidate ancestor`);
      }
    } catch (error) {
      if (error instanceof TaskRegistryError) throw error;
      fail("invalid-completion-reference", `${label} identifies an unavailable tree`);
    }
    return;
  }
  const artifact = relativeArtifact(reference, label);
  candidateEntry(context.repoRoot, context.candidate, artifact, label);
}

function validateWorktreeArtifact(repoRoot, artifact, label) {
  let selected;
  try {
    selected = fs.lstatSync(path.join(repoRoot, artifact));
  } catch {
    fail("strict-artifact-open", `${label} is absent from the worktree`);
  }
  if (selected.isSymbolicLink() || (!selected.isFile() && !selected.isDirectory())) {
    fail("strict-artifact-open", `${label} must be a regular file or directory`);
  }
}

export function validateTaskRegistry(registryValue, {
  repoRoot = ROOT,
  strict = false,
  candidateContext = null,
} = {}) {
  const registry = record(registryValue, "registry");
  if (registry.schema_version !== 1 || registry.repository !== ".") {
    fail("invalid-root", "registry schema_version must be 1 and repository must be '.'");
  }
  const updatedAt = instant(registry.updated_at, "registry.updated_at");
  if (candidateContext !== null && updatedAt > candidateContext.committedAt) {
    fail("candidate-time-order", "registry.updated_at is later than the immutable candidate commit");
  }
  if (registry.evidence_policy?.required_for_assigned_at_or_after !== undefined) {
    instant(
      registry.evidence_policy.required_for_assigned_at_or_after,
      "registry.evidence_policy.required_for_assigned_at_or_after",
    );
  }
  if (!Array.isArray(registry.tasks) || registry.tasks.length === 0) {
    fail("invalid-shape", "registry.tasks must be a non-empty array");
  }

  const tasks = [];
  const ids = new Set();
  let newestTaskTime = 0;
  const strictFailures = [];
  for (const [index, raw] of registry.tasks.entries()) {
    const task = record(raw, `tasks[${index}]`);
    const id = string(task.id, `tasks[${index}].id`);
    if (!TASK_ID.test(id)) fail("invalid-task-id", `invalid task id ${JSON.stringify(id)}`);
    if (ids.has(id)) fail("duplicate-task", `duplicate task id ${id}`);
    ids.add(id);
    string(task.title, `${id}.title`);
    string(task.owner, `${id}.owner`);
    string(task.work_package, `${id}.work_package`);
    string(task.next_action, `${id}.next_action`);
    if (!STATUSES.has(task.status)) fail("invalid-status", `${id} has invalid status ${JSON.stringify(task.status)}`);
    if (!RISKS.has(task.risk)) fail("invalid-risk", `${id} has invalid risk ${JSON.stringify(task.risk)}`);
    if (task.blocker !== null && typeof task.blocker !== "string") {
      fail("invalid-blocker", `${id}.blocker must be null or a string`);
    }
    if (task.evidence_required !== undefined && typeof task.evidence_required !== "boolean") {
      fail("invalid-evidence-policy", `${id}.evidence_required must be a boolean when present`);
    }
    task.depends_on = strings(task.depends_on, `${id}.depends_on`);
    task.expected_tests = strings(task.expected_tests, `${id}.expected_tests`, { allowEmpty: false });
    task.expected_artifacts = strings(task.expected_artifacts, `${id}.expected_artifacts`, { allowEmpty: false })
      .map((entry, artifactIndex) => relativeArtifact(entry, `${id}.expected_artifacts[${artifactIndex}]`));
    const assignedAt = instant(task.assigned_at, `${id}.assigned_at`);
    const heartbeat = instant(task.last_heartbeat, `${id}.last_heartbeat`);
    if (heartbeat < assignedAt) fail("invalid-time-order", `${id} heartbeat predates assignment`);
    newestTaskTime = Math.max(newestTaskTime, assignedAt, heartbeat);
    let startedAt = null;
    if (task.started_at !== null && task.started_at !== undefined) {
      startedAt = instant(task.started_at, `${id}.started_at`);
      if (startedAt < assignedAt || heartbeat < startedAt) {
        fail("invalid-time-order", `${id} has invalid assignment/start/heartbeat order`);
      }
      newestTaskTime = Math.max(newestTaskTime, startedAt);
    }
    let completedAt = null;
    if (task.completed_at !== undefined) {
      completedAt = instant(task.completed_at, `${id}.completed_at`);
      if (
        task.status !== "completed"
        || completedAt < assignedAt
        || (startedAt !== null && completedAt < startedAt)
        || heartbeat < completedAt
      ) {
        fail("invalid-time-order", `${id} has invalid completion timestamp`);
      }
      newestTaskTime = Math.max(newestTaskTime, completedAt);
    }
    if (task.status === "blocked" && (task.blocker === null || task.blocker.trim() === "")) {
      fail("missing-blocker", `${id} is blocked without a blocker`);
    }

    const evidence = evidenceByRequirement(task, { assignedAt, startedAt, completedAt, updatedAt });
    newestTaskTime = Math.max(newestTaskTime, evidence.newest);
    if (strict && task.status === "completed") {
      const missing = task.expected_tests.filter((requirement) => evidence.latest.get(requirement)?.result !== "passed");
      const completion = task.completion_evidence;
      if (missing.length > 0 || !Array.isArray(completion) || completion.length === 0) {
        strictFailures.push(`${id}: missing passing evidence for [${missing.join(", ")}] or completion evidence`);
      } else {
        const references = strings(completion, `${id}.completion_evidence`, { allowEmpty: false });
        if (candidateContext !== null) {
          for (const [referenceIndex, reference] of references.entries()) {
            validateCandidateCompletionReference(reference, candidateContext, `${id}.completion_evidence[${referenceIndex}]`);
          }
        }
      }
      if (candidateContext !== null) {
        for (const requirement of task.expected_tests) {
          const selected = evidence.latest.get(requirement);
          if (selected?.result === "passed") {
            validateCandidateCompletionReference(
              selected.reference,
              candidateContext,
              `${id}.test_evidence[${JSON.stringify(requirement)}].reference`,
            );
          }
        }
      }
      for (const artifact of task.expected_artifacts) {
        if (candidateContext === null) validateWorktreeArtifact(repoRoot, artifact, `${id}:${artifact}`);
        else candidateEntry(candidateContext.repoRoot, candidateContext.candidate, artifact, `${id}:${artifact}`);
      }
    }
    tasks.push(task);
  }

  if (updatedAt < newestTaskTime) {
    fail("stale-root", "registry.updated_at predates a task or evidence timestamp");
  }
  for (const task of tasks) {
    for (const dependency of task.depends_on) {
      if (dependency === task.id) fail("self-dependency", `${task.id} depends on itself`);
      if (!ids.has(dependency)) fail("dangling-dependency", `${task.id} depends on missing ${dependency}`);
    }
  }
  if (strictFailures.length > 0) {
    fail("strict-evidence-open", `strict registry evidence is open:\n- ${strictFailures.join("\n- ")}`);
  }

  return Object.freeze({ taskCount: tasks.length, completedCount: tasks.filter(({ status }) => status === "completed").length });
}

export function validateTaskRegistryCandidate(candidate, {
  repoRoot = ROOT,
  registryPath = DEFAULT_REGISTRY,
  strict = true,
} = {}) {
  const selected = resolveCandidate(repoRoot, candidate);
  const relative = path.relative(path.resolve(repoRoot), path.resolve(registryPath)).replaceAll("\\", "/");
  const registryGitPath = relativeArtifact(relative, "candidate registry path");
  const entry = candidateEntry(repoRoot, selected, registryGitPath, "candidate registry");
  if (entry.type !== "blob") fail("invalid-candidate-registry", "candidate registry must be a regular blob");
  let source;
  try {
    source = runGit(repoRoot, ["cat-file", "blob", `${selected}:${registryGitPath}`]);
  } catch {
    fail("invalid-candidate-registry", "candidate registry blob is unavailable");
  }
  const registry = parseJsonText(source, `${selected}:${registryGitPath}`);
  const committedAt = Date.parse(runGit(repoRoot, ["show", "-s", "--format=%cI", selected]).trim());
  const ancestorTrees = new Set(
    runGit(repoRoot, ["log", "--format=%T", selected]).split(/\r?\n/u).filter(Boolean),
  );
  return validateTaskRegistry(registry, {
    repoRoot,
    strict,
    candidateContext: Object.freeze({ repoRoot, candidate: selected, committedAt, ancestorTrees }),
  });
}

function parseArgs(argv) {
  const options = { registry: DEFAULT_REGISTRY, strict: false, candidate: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") options.strict = true;
    else if (arg === "--registry") options.registry = path.resolve(string(argv[++index], "--registry"));
    else if (arg === "--candidate") options.candidate = string(argv[++index], "--candidate");
    else fail("unknown-argument", `unknown argument ${JSON.stringify(arg)}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.strict && options.candidate === null) {
    fail("candidate-required", "strict validation requires --candidate so evidence and artifacts bind immutable Git bytes");
  }
  const result = options.candidate === null
    ? validateTaskRegistry(parseJsonText(fs.readFileSync(options.registry, "utf8"), options.registry), { repoRoot: ROOT })
    : validateTaskRegistryCandidate(options.candidate, {
      repoRoot: ROOT,
      registryPath: options.registry,
      strict: options.strict,
    });
  console.log(
    `task-registry OK: ${result.taskCount} tasks; ${result.completedCount} completed${options.strict ? "; candidate-bound strict evidence closed" : ""}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
