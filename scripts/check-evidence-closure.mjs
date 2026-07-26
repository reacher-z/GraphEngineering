#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ReleaseTaskMapError,
  validateReleaseTaskMap,
} from "./check-release-task-map.mjs";

export const RELEASE_ROOT_TASK_ID = "CTRL-RELEASE-ROLLUP-086";
export const HISTORICAL_CUTOFF = "2026-07-26T16:20:00Z";

export const CANONICAL_SOURCES = Object.freeze({
  registry: "codex_logs/task-registry.json",
  release_task_map: "codex_plans/delivery/release-task-map.json",
  release_checklist: "codex_plans/delivery/release-checklist.md",
});

export const EVIDENCE_POLICY = Object.freeze({
  missing_candidate_weight: 0,
  missing_task_record_weight: 0,
  failed_or_superseded_record_weight: 0,
  require_independent_reviewer: true,
  require_explicit_exclusions: true,
});

const MANIFEST_KEYS = new Set([
  "schema_version",
  "sources",
  "root_task_id",
  "historical_cutoff",
  "policy",
  "candidates",
]);
const SOURCE_KEYS = new Set(Object.keys(CANONICAL_SOURCES));
const POLICY_KEYS = new Set(Object.keys(EVIDENCE_POLICY));
const CANDIDATE_KEYS = new Set([
  "commit_sha",
  "commit_tree",
  "spec_tree",
  "spec_digest_sha256",
  "source_digests",
  "created_at",
  "task_records",
]);
const SOURCE_DIGEST_KEYS = new Set([
  "registry_sha256",
  "release_task_map_sha256",
  "release_checklist_sha256",
]);
const RECORD_KEYS = new Set([
  "record_id",
  "task_id",
  "state",
  "supersedes",
  "recorded_at",
  "producer_id",
  "binding",
  "task_contract_digest_sha256",
  "commands",
  "artifacts",
  "coverage",
  "review",
  "record_digest_sha256",
]);
const BINDING_KEYS = new Set([
  "commit_sha",
  "commit_tree",
  "spec_tree",
  "spec_digest_sha256",
  "registry_sha256",
  "release_task_map_sha256",
  "release_checklist_sha256",
]);
const COMMAND_KEYS = new Set(["argv", "cwd", "environment", "result"]);
const RESULT_KEYS = new Set([
  "status",
  "exit_code",
  "started_at",
  "completed_at",
  "report",
]);
const FILE_REFERENCE_KEYS = new Set(["path", "sha256"]);
const COVERAGE_KEYS = new Set(["tests", "artifacts"]);
const TEST_COVERAGE_KEYS = new Set(["requirement", "command_indexes"]);
const ARTIFACT_COVERAGE_KEYS = new Set([
  "requirement",
  "artifact_indexes",
]);
const REVIEW_KEYS = new Set([
  "reviewer_id",
  "independent",
  "decision",
  "reviewed_at",
  "report",
  "exclusions",
  "fallback_mode",
]);
const RECORD_STATES = new Set(["passed", "failed", "reopened"]);
const REVIEW_DECISION_FOR_STATE = Object.freeze({
  passed: "accepted",
  failed: "rejected",
  reopened: "reopened",
});
const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;
const ENVIRONMENT_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u;
const SECRET_ENVIRONMENT_KEY =
  /(?:^|[-_.])auth(?:$|[-_.])|(?:authorization|bearer|cookie|credential|password|passwd|secret|token|api[-_.]?key|access[-_.]?key|private[-_.]?key|session[-_.]?key)/iu;

export const EVIDENCE_LIMITS = Object.freeze({
  manifest_bytes: 32 * 1024 * 1024,
  source_bytes: 16 * 1024 * 1024,
  referenced_blob_bytes: 64 * 1024 * 1024,
  git_output_bytes: 64 * 1024 * 1024,
  string_bytes: 64 * 1024,
  repository_path_bytes: 4 * 1024,
  candidates: 32,
  registry_tasks: 4_096,
  dependencies_per_task: 4_096,
  expected_contract_items: 4_096,
  records_per_candidate: 8_192,
  commands_per_record: 128,
  argv_items: 4_096,
  environment_fields: 256,
  artifacts_per_record: 1_024,
  exclusions_per_review: 1_024,
  overlay_history_commits: 20_000,
});

const DEFAULT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CANONICAL_MANIFEST =
  "codex_logs/release-evidence/task-revalidation.json";
const DEFAULT_PATHS = Object.freeze({
  repo: DEFAULT_ROOT,
  manifest: path.join(
    DEFAULT_ROOT,
    "codex_logs/release-evidence/task-revalidation.json",
  ),
  registry: path.join(DEFAULT_ROOT, CANONICAL_SOURCES.registry),
  releaseMap: path.join(DEFAULT_ROOT, CANONICAL_SOURCES.release_task_map),
  checklist: path.join(DEFAULT_ROOT, CANONICAL_SOURCES.release_checklist),
});

export class EvidenceClosureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EvidenceClosureError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new EvidenceClosureError(code, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, keys, context) {
  if (!isRecord(value)) {
    fail("invalid-shape", `${context} must be a JSON object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid-shape", `${context} must be a plain JSON object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      fail(
        "unknown-field",
        `${context} contains unknown field ${JSON.stringify(key)}`,
      );
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail("missing-field", `${context} is missing required field ${key}`);
    }
  }
}

function assertNonEmptyString(value, context) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("invalid-shape", `${context} must be a non-empty string`);
  }
  if (Buffer.byteLength(value, "utf8") > EVIDENCE_LIMITS.string_bytes) {
    fail(
      "resource-limit",
      `${context} exceeds ${EVIDENCE_LIMITS.string_bytes} UTF-8 bytes`,
    );
  }
}

function assertSha256(value, context) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("invalid-digest", `${context} must be a lowercase SHA-256 digest`);
  }
}

function assertObjectId(value, context) {
  if (typeof value !== "string" || !FULL_OBJECT_ID.test(value)) {
    fail(
      "invalid-object-id",
      `${context} must be a full lowercase 40- or 64-character Git object ID`,
    );
  }
}

function timestampMillis(value, context) {
  const match =
    typeof value === "string"
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u.exec(
          value,
        )
      : null;
  if (!match) {
    fail("invalid-timestamp", `${context} must be an RFC 3339 UTC timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    fail("invalid-timestamp", `${context} is not a real timestamp`);
  }
  const canonical = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${(match[7] ?? "").padEnd(3, "0")}Z`;
  if (new Date(parsed).toISOString() !== canonical) {
    fail("invalid-timestamp", `${context} is not a real UTC calendar timestamp`);
  }
  return parsed;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}

function assertStringArray(
  value,
  context,
  {
    allowEmpty = false,
    allowDuplicates = false,
    maximum = EVIDENCE_LIMITS.expected_contract_items,
  } = {},
) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(
      "invalid-shape",
      `${context} must be ${allowEmpty ? "an" : "a non-empty"} array`,
    );
  }
  if (value.length > maximum) {
    fail("resource-limit", `${context} exceeds ${maximum} entries`);
  }
  for (const [index, item] of value.entries()) {
    assertNonEmptyString(item, `${context}[${index}]`);
  }
  const duplicates = allowDuplicates ? [] : duplicateValues(value);
  if (duplicates.length > 0) {
    fail(
      "duplicate-value",
      `${context} repeats values: ${duplicates.join(", ")}`,
    );
  }
}

function compareCodePoints(left, right) {
  const leftPoints = [...left].map((character) => character.codePointAt(0));
  const rightPoints = [...right].map((character) => character.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalJsonValue(value, seen = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail(
        "invalid-record-digest-input",
        "evidence digest input numbers must be safe integers",
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    fail(
      "invalid-record-digest-input",
      `evidence digest input contains unsupported ${typeof value}`,
    );
  }
  if (seen.has(value)) {
    fail("invalid-record-digest-input", "evidence digest input is cyclic");
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => canonicalJsonValue(item, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(
        "invalid-record-digest-input",
        "evidence digest input must contain plain JSON objects",
      );
    }
    result = {};
    for (const key of Object.keys(value).sort(compareCodePoints)) {
      result[key] = canonicalJsonValue(value[key], seen);
    }
  }
  seen.delete(value);
  return result;
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function canonicalDigest(value) {
  return sha256Hex(JSON.stringify(canonicalJsonValue(value)));
}

function canonicalText(value) {
  return JSON.stringify(canonicalJsonValue(value));
}

export function computeRecordDigest(record) {
  if (!isRecord(record)) {
    fail("invalid-shape", "task record must be an object");
  }
  const payload = { ...record };
  delete payload.record_digest_sha256;
  return canonicalDigest(payload);
}

export function computeTaskContractDigest(task) {
  return canonicalDigest({
    task_id: task.id,
    title: task.title,
    status: task.status,
    depends_on: task.depends_on,
    expected_artifacts: task.expected_artifacts,
    expected_tests: task.expected_tests,
    evidence_required: task.evidence_required === true,
    external_gate: task.external_gate ?? null,
  });
}

function repositoryPath(value, context) {
  assertNonEmptyString(value, context);
  if (
    value === "." ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > EVIDENCE_LIMITS.repository_path_bytes
  ) {
    fail(
      "invalid-repository-path",
      `${context} must be a normalized repository-relative path`,
    );
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized === ".git" ||
    normalized.startsWith(".git/")
  ) {
    fail(
      "invalid-repository-path",
      `${context} must stay inside the candidate repository`,
    );
  }
  return value;
}

function commandCwd(value, context) {
  if (value === ".") {
    return value;
  }
  return repositoryPath(value, context);
}

export class RepositoryGitReader {
  constructor(repositoryRoot) {
    this.repositoryRoot = path.resolve(repositoryRoot);
    this.fileCache = new Map();
    this.typeCache = new Map();
    this.entryCache = new Map();
    this.commandCache = new Map();
    this.gitEnvironment = { ...process.env };
    for (const key of Object.keys(this.gitEnvironment)) {
      if (key.startsWith("GIT_")) {
        delete this.gitEnvironment[key];
      }
    }
    this.gitEnvironment.GIT_NO_REPLACE_OBJECTS = "1";
    this.gitEnvironment.GIT_OPTIONAL_LOCKS = "0";
    this.gitEnvironment.LC_ALL = "C";
  }

  run(args, { encoding = "utf8", code = "git-error" } = {}) {
    const cacheKey = `${encoding}:${JSON.stringify(args)}`;
    if (this.commandCache.has(cacheKey)) {
      return this.commandCache.get(cacheKey);
    }
    try {
      const value = execFileSync("git", args, {
        cwd: this.repositoryRoot,
        env: this.gitEnvironment,
        encoding: encoding === null ? null : encoding,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: EVIDENCE_LIMITS.git_output_bytes,
      });
      this.commandCache.set(cacheKey, value);
      return value;
    } catch (error) {
      const detail = Buffer.isBuffer(error.stderr)
        ? error.stderr.toString("utf8").trim()
        : String(error.stderr ?? error.message).trim();
      fail(code, detail || `git ${args[0]} failed`);
    }
  }

  resolveCommit(commitSha) {
    assertObjectId(commitSha, "candidate commit_sha");
    const resolved = this.run(
      ["rev-parse", "--verify", `${commitSha}^{commit}`],
      { code: "candidate-commit-not-found" },
    ).trim();
    if (resolved !== commitSha) {
      fail(
        "candidate-commit-mismatch",
        `candidate ${commitSha} resolved to unexpected commit ${resolved}`,
      );
    }
    return resolved;
  }

  headCommit() {
    return this.run(["rev-parse", "--verify", "HEAD^{commit}"], {
      code: "overlay-commit-missing",
    }).trim();
  }

  assertCleanWorktree() {
    const status = this.run(
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { code: "worktree-status-failed" },
    );
    if (status.trim() !== "") {
      const changedPaths = status
        .trim()
        .split(/\r?\n/u)
        .slice(0, 8)
        .join("; ");
      fail(
        "dirty-candidate-worktree",
        `explicit candidate validation requires a clean overlay checkout; changed paths: ${changedPaths}`,
      );
    }
    const indexFlags = this.run(["ls-files", "-v", "-z"], {
      code: "worktree-status-failed",
    });
    const unsafeIndexEntries = indexFlags
      .split("\0")
      .filter(Boolean)
      .filter((entry) => entry[0] === "S" || entry[0] === entry[0].toLowerCase())
      .slice(0, 8);
    if (unsafeIndexEntries.length > 0) {
      fail(
        "unsafe-index-flags",
        `explicit candidate validation rejects skip-worktree/assume-unchanged entries: ${unsafeIndexEntries.join("; ")}`,
      );
    }
  }

  assertCompleteHistory() {
    const shallow = this.run(["rev-parse", "--is-shallow-repository"], {
      code: "overlay-history-unavailable",
    }).trim();
    if (shallow !== "false") {
      fail(
        "shallow-overlay-history",
        "explicit candidate validation requires complete Git history",
      );
    }
    const replaceRefs = this.run(
      ["for-each-ref", "--format=%(refname)", "refs/replace"],
      { code: "overlay-history-unavailable" },
    ).trim();
    if (replaceRefs !== "") {
      fail(
        "rewritten-overlay-history",
        "explicit candidate validation rejects Git replace refs",
      );
    }
    const graftsPath = this.run(["rev-parse", "--git-path", "info/grafts"], {
      code: "overlay-history-unavailable",
    }).trim();
    const resolvedGraftsPath = path.isAbsolute(graftsPath)
      ? graftsPath
      : path.join(this.repositoryRoot, graftsPath);
    if (
      fs.existsSync(resolvedGraftsPath) &&
      fs.statSync(resolvedGraftsPath).size > 0
    ) {
      fail(
        "rewritten-overlay-history",
        "explicit candidate validation rejects Git grafts",
      );
    }
  }

  assertAncestor(ancestorCommit, descendantCommit) {
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", ancestorCommit, descendantCommit],
        {
          cwd: this.repositoryRoot,
          env: this.gitEnvironment,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch {
      fail(
        "candidate-not-overlay-ancestor",
        `candidate ${ancestorCommit} is not an ancestor of overlay commit ${descendantCommit}`,
      );
    }
  }

  commitAncestry(commitSha) {
    const lines = this.run(["rev-list", "--parents", commitSha], {
      code: "overlay-history-unavailable",
    })
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    if (lines.length > EVIDENCE_LIMITS.overlay_history_commits) {
      fail(
        "resource-limit",
        `overlay ancestry exceeds ${EVIDENCE_LIMITS.overlay_history_commits} commits`,
      );
    }
    return lines.map((line) => {
      const [commit, ...parents] = line.split(/\s+/u);
      return { commit, parents };
    });
  }

  commitTree(commitSha) {
    return this.run(["rev-parse", "--verify", `${commitSha}^{tree}`], {
      code: "candidate-tree-unavailable",
    }).trim();
  }

  pathEntry(commitSha, repositoryRelativePath) {
    repositoryPath(repositoryRelativePath, "candidate file path");
    const key = `${commitSha}:${repositoryRelativePath}`;
    if (!this.entryCache.has(key)) {
      const output = this.run(
        [
          "ls-tree",
          "-z",
          "--full-tree",
          commitSha,
          "--",
          `:(literal)${repositoryRelativePath}`,
        ],
        { encoding: null, code: "candidate-path-query-failed" },
      );
      if (output.length === 0) {
        this.entryCache.set(key, null);
      } else {
        const records = output.subarray(0, -1).toString("utf8").split("\0");
        if (records.length !== 1) {
          fail(
            "ambiguous-candidate-path",
            `${repositoryRelativePath} resolved to ${records.length} Git entries at ${commitSha}`,
          );
        }
        const separator = records[0].indexOf("\t");
        const header = records[0].slice(0, separator).split(" ");
        const returnedPath = records[0].slice(separator + 1);
        if (
          separator < 0 ||
          header.length !== 3 ||
          returnedPath !== repositoryRelativePath
        ) {
          fail(
            "ambiguous-candidate-path",
            `${repositoryRelativePath} did not resolve exactly at ${commitSha}`,
          );
        }
        this.entryCache.set(key, {
          mode: header[0],
          type: header[1],
          objectId: header[2],
        });
      }
    }
    return this.entryCache.get(key);
  }

  objectType(commitSha, repositoryRelativePath) {
    const key = `${commitSha}:${repositoryRelativePath}`;
    if (!this.typeCache.has(key)) {
      const entry = this.pathEntry(commitSha, repositoryRelativePath);
      if (entry === null) {
        fail(
          "candidate-path-missing",
          `${repositoryRelativePath} does not exist at ${commitSha}`,
        );
      }
      this.typeCache.set(key, entry.type);
    }
    return this.typeCache.get(key);
  }

  readFile(commitSha, repositoryRelativePath) {
    repositoryPath(repositoryRelativePath, "candidate file path");
    const key = `${commitSha}:${repositoryRelativePath}`;
    if (!this.fileCache.has(key)) {
      const entry = this.pathEntry(commitSha, repositoryRelativePath);
      if (entry === null) {
        fail(
          "candidate-path-missing",
          `${repositoryRelativePath} does not exist at ${commitSha}`,
        );
      }
      if (entry.type !== "blob" || !new Set(["100644", "100755"]).has(entry.mode)) {
        fail(
          "candidate-path-not-file",
          `${repositoryRelativePath} is Git mode ${entry.mode} type ${entry.type}, not a regular file, at ${commitSha}`,
        );
      }
      const size = Number(
        this.run(["cat-file", "-s", entry.objectId], {
          code: "candidate-path-missing",
        }).trim(),
      );
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        size > EVIDENCE_LIMITS.referenced_blob_bytes
      ) {
        fail(
          "candidate-blob-too-large",
          `${repositoryRelativePath} exceeds the ${EVIDENCE_LIMITS.referenced_blob_bytes}-byte evidence limit`,
        );
      }
      this.fileCache.set(
        key,
        this.run(["cat-file", "blob", entry.objectId], {
          encoding: null,
          code: "candidate-path-missing",
        }),
      );
    }
    return this.fileCache.get(key);
  }

  directoryExists(commitSha, repositoryRelativePath) {
    if (repositoryRelativePath === ".") {
      return true;
    }
    return this.pathEntry(commitSha, repositoryRelativePath)?.type === "tree";
  }

  specTree(commitSha) {
    const entry = this.pathEntry(commitSha, "spec");
    if (entry?.type !== "tree") {
      fail("candidate-spec-missing", `spec is not a tree at ${commitSha}`);
    }
    return entry.objectId;
  }

  specDigest(commitSha) {
    const listing = this.run(
      [
        "ls-tree",
        "-r",
        "--full-tree",
        "-z",
        commitSha,
        "--",
        ":(literal)spec",
      ],
      { encoding: null, code: "candidate-spec-missing" },
    );
    if (listing.length === 0) {
      fail("candidate-spec-missing", `spec has no tracked files at ${commitSha}`);
    }
    return sha256Hex(listing);
  }
}

function parseJsonBuffer(buffer, context) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    fail("json-error", `cannot parse ${context}: ${error.message}`);
  }
}

function validateRegistryGraph(registry, context) {
  if (!isRecord(registry) || !Array.isArray(registry.tasks)) {
    fail("invalid-registry", `${context}.tasks must be an array`);
  }
  if (registry.tasks.length > EVIDENCE_LIMITS.registry_tasks) {
    fail(
      "resource-limit",
      `${context}.tasks exceeds ${EVIDENCE_LIMITS.registry_tasks} entries`,
    );
  }
  const taskById = new Map();
  for (const [index, task] of registry.tasks.entries()) {
    if (!isRecord(task)) {
      fail("invalid-registry", `${context}.tasks[${index}] must be an object`);
    }
    assertNonEmptyString(task.id, `${context}.tasks[${index}].id`);
    if (taskById.has(task.id)) {
      fail("duplicate-registry-task", `${context} repeats task ${task.id}`);
    }
    if (!Array.isArray(task.depends_on)) {
      fail(
        "invalid-registry",
        `${context} task ${task.id} must declare depends_on as an array`,
      );
    }
    assertStringArray(task.depends_on, `${context} task ${task.id}.depends_on`, {
      allowEmpty: true,
      maximum: EVIDENCE_LIMITS.dependencies_per_task,
    });
    taskById.set(task.id, task);
  }
  for (const task of taskById.values()) {
    for (const dependency of task.depends_on) {
      if (!taskById.has(dependency)) {
        fail(
          "dangling-registry-dependency",
          `${context} task ${task.id} depends on unknown task ${dependency}`,
        );
      }
    }
  }

  const states = new Map();
  const stack = [];
  const visit = (taskId) => {
    const state = states.get(taskId) ?? 0;
    if (state === 2) {
      return;
    }
    if (state === 1) {
      const start = stack.indexOf(taskId);
      fail(
        "cyclic-registry",
        `${context} dependency cycle: ${[...stack.slice(start), taskId].join(" -> ")}`,
      );
    }
    states.set(taskId, 1);
    stack.push(taskId);
    for (const dependency of taskById.get(taskId).depends_on) {
      visit(dependency);
    }
    stack.pop();
    states.set(taskId, 2);
  };
  for (const taskId of taskById.keys()) {
    visit(taskId);
  }
  return taskById;
}

function releaseAncestorClosure(taskById, rootTaskId) {
  if (!taskById.has(rootTaskId)) {
    fail("missing-release-root", `registry has no release root ${rootTaskId}`);
  }
  const ancestors = new Set();
  const visit = (taskId) => {
    for (const dependency of taskById.get(taskId).depends_on) {
      if (!ancestors.has(dependency)) {
        ancestors.add(dependency);
        visit(dependency);
      }
    }
  };
  visit(rootTaskId);
  ancestors.delete(rootTaskId);
  return [...ancestors].sort(compareCodePoints);
}

function validateCutoff(registry, manifestCutoff, context) {
  if (manifestCutoff !== HISTORICAL_CUTOFF) {
    fail(
      "historical-cutoff-drift",
      `historical_cutoff must remain ${HISTORICAL_CUTOFF}`,
    );
  }
  const registryCutoff =
    registry?.evidence_policy?.required_for_assigned_at_or_after;
  if (registryCutoff !== manifestCutoff) {
    fail(
      "registry-evidence-policy-drift",
      `${context} evidence cutoff ${JSON.stringify(registryCutoff)} does not match ${manifestCutoff}`,
    );
  }
}

function validateReleaseMapSources({ registry, releaseMap, checklist }, context) {
  try {
    validateReleaseTaskMap({
      registry,
      manifest: releaseMap,
      checklistText: checklist,
    });
  } catch (error) {
    if (error instanceof ReleaseTaskMapError) {
      fail(
        "release-map-invalid",
        `${context} release task map failed ${error.code}: ${error.message}`,
      );
    }
    throw error;
  }
}

function candidateSources(gitReader, commitSha) {
  const registryBuffer = gitReader.readFile(
    commitSha,
    CANONICAL_SOURCES.registry,
  );
  const releaseMapBuffer = gitReader.readFile(
    commitSha,
    CANONICAL_SOURCES.release_task_map,
  );
  const checklistBuffer = gitReader.readFile(
    commitSha,
    CANONICAL_SOURCES.release_checklist,
  );
  return {
    registry: parseJsonBuffer(registryBuffer, `${commitSha}:registry`),
    releaseMap: parseJsonBuffer(
      releaseMapBuffer,
      `${commitSha}:release task map`,
    ),
    checklist: checklistBuffer.toString("utf8"),
    digests: {
      registry_sha256: sha256Hex(registryBuffer),
      release_task_map_sha256: sha256Hex(releaseMapBuffer),
      release_checklist_sha256: sha256Hex(checklistBuffer),
    },
  };
}

export function inspectCandidateCommit(gitReader, commitSha) {
  const resolved = gitReader.resolveCommit(commitSha);
  const sources = candidateSources(gitReader, resolved);
  const commitTree = gitReader.commitTree(resolved);
  const specTree = gitReader.specTree(resolved);
  const specDigest = gitReader.specDigest(resolved);
  return {
    commitSha: resolved,
    commitTree,
    specTree,
    specDigest,
    sources,
    binding: {
      commit_sha: resolved,
      commit_tree: commitTree,
      spec_tree: specTree,
      spec_digest_sha256: specDigest,
      ...sources.digests,
    },
  };
}

function equalStringArrays(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function assertExactValueObject(actual, expected, context, errorCode) {
  assertObject(actual, new Set(Object.keys(expected)), context);
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      fail(
        errorCode,
        `${context}.${key} must be ${JSON.stringify(value)}, not ${JSON.stringify(actual[key])}`,
      );
    }
  }
}

function validateFileReference(
  reference,
  context,
  { gitReader, commitSha, digestCache },
) {
  assertObject(reference, FILE_REFERENCE_KEYS, context);
  repositoryPath(reference.path, `${context}.path`);
  assertSha256(reference.sha256, `${context}.sha256`);
  const cacheKey = `${commitSha}:${reference.path}`;
  if (!digestCache.has(cacheKey)) {
    digestCache.set(
      cacheKey,
      sha256Hex(gitReader.readFile(commitSha, reference.path)),
    );
  }
  const actual = digestCache.get(cacheKey);
  if (actual !== reference.sha256) {
    fail(
      "file-digest-mismatch",
      `${context} digest ${reference.sha256} does not match candidate file ${reference.path} (${actual})`,
    );
  }
}

function validateEnvironment(environment, context) {
  if (!isRecord(environment) || Object.keys(environment).length === 0) {
    fail("invalid-environment", `${context} must be a non-empty JSON object`);
  }
  const prototype = Object.getPrototypeOf(environment);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid-environment", `${context} must be a plain JSON object`);
  }
  if (Object.keys(environment).length > EVIDENCE_LIMITS.environment_fields) {
    fail(
      "resource-limit",
      `${context} exceeds ${EVIDENCE_LIMITS.environment_fields} fields`,
    );
  }
  for (const [key, value] of Object.entries(environment)) {
    if (!ENVIRONMENT_KEY.test(key)) {
      fail("invalid-environment", `${context} has invalid key ${JSON.stringify(key)}`);
    }
    if (SECRET_ENVIRONMENT_KEY.test(key)) {
      fail(
        "sensitive-environment-key",
        `${context} must not capture sensitive environment field ${JSON.stringify(key)}`,
      );
    }
    assertNonEmptyString(value, `${context}.${key}`);
  }
}

function validateCommand(command, context, evidenceContext) {
  assertObject(command, COMMAND_KEYS, context);
  assertStringArray(command.argv, `${context}.argv`, {
    allowDuplicates: true,
    maximum: EVIDENCE_LIMITS.argv_items,
  });
  const cwd = commandCwd(command.cwd, `${context}.cwd`);
  if (!evidenceContext.gitReader.directoryExists(evidenceContext.commitSha, cwd)) {
    fail(
      "candidate-cwd-missing",
      `${context}.cwd ${cwd} is not a directory in ${evidenceContext.commitSha}`,
    );
  }
  validateEnvironment(command.environment, `${context}.environment`);
  assertObject(command.result, RESULT_KEYS, `${context}.result`);
  if (!new Set(["passed", "failed"]).has(command.result.status)) {
    fail(
      "invalid-command-result",
      `${context}.result.status must be passed or failed`,
    );
  }
  if (
    !Number.isSafeInteger(command.result.exit_code) ||
    command.result.exit_code < 0 ||
    command.result.exit_code > 255
  ) {
    fail(
      "invalid-command-result",
      `${context}.result.exit_code must be an integer from 0 through 255`,
    );
  }
  if (
    (command.result.status === "passed" && command.result.exit_code !== 0) ||
    (command.result.status === "failed" && command.result.exit_code === 0)
  ) {
    fail(
      "inconsistent-command-result",
      `${context}.result status and exit_code disagree`,
    );
  }
  const started = timestampMillis(
    command.result.started_at,
    `${context}.result.started_at`,
  );
  const completed = timestampMillis(
    command.result.completed_at,
    `${context}.result.completed_at`,
  );
  if (completed < started) {
    fail(
      "invalid-command-time-order",
      `${context} completed before it started`,
    );
  }
  validateFileReference(
    command.result.report,
    `${context}.result.report`,
    evidenceContext,
  );
  return {
    started,
    completed,
    status: command.result.status,
    reportPath: command.result.report.path,
    reportDigest: command.result.report.sha256,
  };
}

function validateReview(review, context, record, commandResults, evidenceContext) {
  assertObject(review, REVIEW_KEYS, context);
  assertNonEmptyString(review.reviewer_id, `${context}.reviewer_id`);
  if (review.independent !== true) {
    fail("review-not-independent", `${context}.independent must be true`);
  }
  if (review.reviewer_id === record.producer_id) {
    fail(
      "reviewer-is-producer",
      `${context}.reviewer_id must differ from producer_id`,
    );
  }
  const expectedDecision = REVIEW_DECISION_FOR_STATE[record.state];
  if (review.decision !== expectedDecision) {
    fail(
      "review-state-mismatch",
      `${context}.decision must be ${expectedDecision} for state ${record.state}`,
    );
  }
  const reviewedAt = timestampMillis(review.reviewed_at, `${context}.reviewed_at`);
  if (commandResults.some(({ completed }) => reviewedAt < completed)) {
    fail(
      "invalid-review-time-order",
      `${context} predates a command result it reviews`,
    );
  }
  validateFileReference(review.report, `${context}.report`, evidenceContext);
  const commandReportPaths = new Set(
    record.commands.map(({ result }) => result.report.path),
  );
  if (commandReportPaths.has(review.report.path)) {
    fail(
      "review-report-not-independent",
      `${context}.report must be distinct from command result reports`,
    );
  }
  const commandReportDigests = new Set(
    record.commands.map(({ result }) => result.report.sha256),
  );
  if (commandReportDigests.has(review.report.sha256)) {
    fail(
      "review-report-not-independent",
      `${context}.report blob must differ from command result reports`,
    );
  }
  assertStringArray(review.exclusions, `${context}.exclusions`, {
    allowEmpty: true,
    maximum: EVIDENCE_LIMITS.exclusions_per_review,
  });
  assertNonEmptyString(review.fallback_mode, `${context}.fallback_mode`);
  return {
    reviewedAt,
    reportPath: review.report.path,
    reportDigest: review.report.sha256,
  };
}

function validateCoverageIndexes(value, context, evidenceCount) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("invalid-coverage", `${context} must be a non-empty array`);
  }
  const seen = new Set();
  for (const [index, evidenceIndex] of value.entries()) {
    if (
      !Number.isSafeInteger(evidenceIndex) ||
      evidenceIndex < 0 ||
      evidenceIndex >= evidenceCount
    ) {
      fail(
        "dangling-coverage-index",
        `${context}[${index}] does not name an evidence index from 0 through ${evidenceCount - 1}`,
      );
    }
    if (seen.has(evidenceIndex)) {
      fail(
        "duplicate-coverage-index",
        `${context} repeats evidence index ${evidenceIndex}`,
      );
    }
    seen.add(evidenceIndex);
  }
  return seen;
}

function validateCoverageEntries({
  entries,
  expectedRequirements,
  evidenceCount,
  entryKeys,
  indexField,
  context,
  onReference,
}) {
  if (!Array.isArray(entries)) {
    fail("invalid-coverage", `${context} must be an array`);
  }
  if (entries.length !== expectedRequirements.length) {
    fail(
      "coverage-requirement-mismatch",
      `${context} has ${entries.length} entries; candidate task requires ${expectedRequirements.length}`,
    );
  }
  const referencedEvidence = new Set();
  for (const [index, expectedRequirement] of expectedRequirements.entries()) {
    const entry = entries[index];
    assertObject(entry, entryKeys, `${context}[${index}]`);
    assertNonEmptyString(entry.requirement, `${context}[${index}].requirement`);
    if (entry.requirement !== expectedRequirement) {
      fail(
        "coverage-requirement-mismatch",
        `${context}[${index}].requirement must exactly equal ${JSON.stringify(expectedRequirement)}`,
      );
    }
    const indexes = validateCoverageIndexes(
      entry[indexField],
      `${context}[${index}].${indexField}`,
      evidenceCount,
    );
    for (const evidenceIndex of indexes) {
      referencedEvidence.add(evidenceIndex);
      onReference(expectedRequirement, evidenceIndex, `${context}[${index}]`);
    }
  }
  const uncovered = Array.from(
    { length: evidenceCount },
    (_, index) => index,
  ).filter((index) => !referencedEvidence.has(index));
  if (uncovered.length > 0) {
    fail(
      "uncovered-evidence-index",
      `${context} does not bind evidence indexes: ${uncovered.join(", ")}`,
    );
  }
}

function validateCoverage(record, task, commandResults, context) {
  assertObject(record.coverage, COVERAGE_KEYS, `${context}.coverage`);
  validateCoverageEntries({
    entries: record.coverage.tests,
    expectedRequirements: task.expected_tests,
    evidenceCount: record.commands.length,
    entryKeys: TEST_COVERAGE_KEYS,
    indexField: "command_indexes",
    context: `${context}.coverage.tests`,
    onReference: (_requirement, commandIndex, entryContext) => {
      if (
        record.state === "passed" &&
        commandResults[commandIndex].status !== "passed"
      ) {
        fail(
          "passed-coverage-has-failed-command",
          `${entryContext} references failed command ${commandIndex} from a passed record`,
        );
      }
    },
  });
  validateCoverageEntries({
    entries: record.coverage.artifacts,
    expectedRequirements: task.expected_artifacts,
    evidenceCount: record.artifacts.length,
    entryKeys: ARTIFACT_COVERAGE_KEYS,
    indexField: "artifact_indexes",
    context: `${context}.coverage.artifacts`,
    onReference: (requirement, artifactIndex, entryContext) => {
      repositoryPath(requirement, `${entryContext}.requirement`);
      const artifactPath = record.artifacts[artifactIndex].path;
      if (
        artifactPath !== requirement &&
        !artifactPath.startsWith(`${requirement}/`)
      ) {
        fail(
          "artifact-coverage-path-mismatch",
          `${entryContext} maps ${JSON.stringify(requirement)} to unrelated artifact ${JSON.stringify(artifactPath)}`,
        );
      }
    },
  });
}

function validateTaskRecord(record, context, candidateContext) {
  assertObject(record, RECORD_KEYS, context);
  if (typeof record.record_id !== "string" || !RECORD_ID.test(record.record_id)) {
    fail("invalid-record-id", `${context}.record_id is invalid`);
  }
  assertNonEmptyString(record.task_id, `${context}.task_id`);
  if (!RECORD_STATES.has(record.state)) {
    fail(
      "invalid-record-state",
      `${context}.state must be passed, failed, or reopened`,
    );
  }
  if (record.supersedes !== null) {
    if (typeof record.supersedes !== "string" || !RECORD_ID.test(record.supersedes)) {
      fail(
        "invalid-supersedes",
        `${context}.supersedes must be null or a valid record ID`,
      );
    }
  }
  const recordedAt = timestampMillis(record.recorded_at, `${context}.recorded_at`);
  assertNonEmptyString(record.producer_id, `${context}.producer_id`);
  assertExactValueObject(
    record.binding,
    candidateContext.binding,
    `${context}.binding`,
    "record-binding-mismatch",
  );
  assertSha256(
    record.task_contract_digest_sha256,
    `${context}.task_contract_digest_sha256`,
  );
  const task = candidateContext.taskById.get(record.task_id);
  if (!task || !candidateContext.requiredTaskIds.has(record.task_id)) {
    fail(
      "record-for-non-ancestor",
      `${context} references task ${record.task_id}, which is not a release-root ancestor`,
    );
  }
  for (const field of ["expected_artifacts", "expected_tests"]) {
    assertStringArray(task[field], `${context} candidate task ${record.task_id}.${field}`, {
      maximum: EVIDENCE_LIMITS.expected_contract_items,
    });
  }
  const contractDigest = computeTaskContractDigest(task);
  if (record.task_contract_digest_sha256 !== contractDigest) {
    fail(
      "task-contract-digest-mismatch",
      `${context} task contract digest does not match candidate registry (${contractDigest})`,
    );
  }
  if (!Array.isArray(record.commands) || record.commands.length === 0) {
    fail("missing-command-evidence", `${context}.commands must not be empty`);
  }
  if (record.commands.length > EVIDENCE_LIMITS.commands_per_record) {
    fail(
      "resource-limit",
      `${context}.commands exceeds ${EVIDENCE_LIMITS.commands_per_record} entries`,
    );
  }
  const commandResults = record.commands.map((command, index) =>
    validateCommand(command, `${context}.commands[${index}]`, candidateContext),
  );
  if (
    record.state === "passed" &&
    commandResults.some(({ status }) => status !== "passed")
  ) {
    fail(
      "passed-record-has-failed-command",
      `${context} cannot pass while a command failed`,
    );
  }
  if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) {
    fail("missing-artifact-evidence", `${context}.artifacts must not be empty`);
  }
  if (record.artifacts.length > EVIDENCE_LIMITS.artifacts_per_record) {
    fail(
      "resource-limit",
      `${context}.artifacts exceeds ${EVIDENCE_LIMITS.artifacts_per_record} entries`,
    );
  }
  for (const [index, artifact] of record.artifacts.entries()) {
    validateFileReference(
      artifact,
      `${context}.artifacts[${index}]`,
      candidateContext,
    );
  }
  const duplicateArtifactPaths = duplicateValues(
    record.artifacts.map(({ path: artifactPath }) => artifactPath),
  );
  if (duplicateArtifactPaths.length > 0) {
    fail(
      "duplicate-artifact",
      `${context} repeats artifact paths: ${duplicateArtifactPaths.join(", ")}`,
    );
  }
  validateCoverage(record, task, commandResults, context);
  const reviewResult = validateReview(
    record.review,
    `${context}.review`,
    record,
    commandResults,
    candidateContext,
  );
  if (recordedAt < reviewResult.reviewedAt) {
    fail(
      "invalid-record-time-order",
      `${context}.recorded_at predates its review`,
    );
  }
  assertSha256(record.record_digest_sha256, `${context}.record_digest_sha256`);
  const recordDigest = computeRecordDigest(record);
  if (record.record_digest_sha256 !== recordDigest) {
    fail(
      "record-digest-mismatch",
      `${context} digest does not match its canonical record (${recordDigest})`,
    );
  }
  return {
    recordedAt,
    task,
    commandResults,
    reviewedAt: reviewResult.reviewedAt,
    reportPaths: [
      ...commandResults.map(({ reportPath }) => reportPath),
      reviewResult.reportPath,
    ],
    reportDigests: [
      ...commandResults.map(({ reportDigest }) => reportDigest),
      reviewResult.reportDigest,
    ],
  };
}

function detectSupersedesCycles(recordById) {
  const states = new Map();
  const stack = [];
  const visit = (recordId) => {
    const state = states.get(recordId) ?? 0;
    if (state === 2) {
      return;
    }
    if (state === 1) {
      const start = stack.indexOf(recordId);
      fail(
        "cyclic-supersedes",
        `evidence supersedes cycle: ${[...stack.slice(start), recordId].join(" -> ")}`,
      );
    }
    states.set(recordId, 1);
    stack.push(recordId);
    const supersedes = recordById.get(recordId).supersedes;
    if (supersedes !== null) {
      visit(supersedes);
    }
    stack.pop();
    states.set(recordId, 2);
  };
  for (const recordId of recordById.keys()) {
    visit(recordId);
  }
}

function validateRecordHistory(candidate, candidateContext) {
  if (!Array.isArray(candidate.task_records)) {
    fail("invalid-shape", "candidate.task_records must be an array");
  }
  if (candidate.task_records.length > EVIDENCE_LIMITS.records_per_candidate) {
    fail(
      "resource-limit",
      `candidate.task_records exceeds ${EVIDENCE_LIMITS.records_per_candidate} entries`,
    );
  }
  const recordById = new Map();
  const recordsByTask = new Map();
  for (const [index, record] of candidate.task_records.entries()) {
    const context = `candidate ${candidate.commit_sha}.task_records[${index}]`;
    const validated = validateTaskRecord(record, context, candidateContext);
    if (recordById.has(record.record_id)) {
      fail(
        "duplicate-record-id",
        `candidate ${candidate.commit_sha} repeats record ${record.record_id}`,
      );
    }
    recordById.set(record.record_id, record);
    const taskRecords = recordsByTask.get(record.task_id) ?? [];
    taskRecords.push({ record, validated, index });
    recordsByTask.set(record.task_id, taskRecords);
  }

  for (const record of recordById.values()) {
    if (record.supersedes === null) {
      continue;
    }
    const predecessor = recordById.get(record.supersedes);
    if (!predecessor) {
      fail(
        "dangling-supersedes",
        `record ${record.record_id} supersedes missing record ${record.supersedes}`,
      );
    }
    if (predecessor.task_id !== record.task_id) {
      fail(
        "cross-task-supersedes",
        `record ${record.record_id} cannot supersede ${record.supersedes} from task ${predecessor.task_id}`,
      );
    }
  }
  detectSupersedesCycles(recordById);

  const latestByTask = new Map();
  for (const taskId of candidateContext.requiredTaskIds) {
    const history = recordsByTask.get(taskId);
    if (!history || history.length === 0) {
      fail(
        "missing-task-record",
        `candidate ${candidate.commit_sha} has no revalidation record for ${taskId}`,
      );
    }
    let previous = null;
    const priorReportPaths = new Set();
    const priorReportDigests = new Set();
    for (const { record, validated } of history) {
      if (record.supersedes !== (previous?.record.record_id ?? null)) {
        fail(
          "non-linear-supersedes",
          `record ${record.record_id} must supersede the immediately previous ${taskId} record`,
        );
      }
      if (
        previous &&
        validated.recordedAt <= previous.validated.recordedAt
      ) {
        fail(
          "non-monotonic-record-time",
          `record ${record.record_id} must be newer than ${previous.record.record_id}`,
        );
      }
      if (previous) {
        if (
          validated.commandResults.some(
            ({ started }) => started <= previous.validated.recordedAt,
          ) ||
          validated.reviewedAt <= previous.validated.recordedAt
        ) {
          fail(
            "stale-supersession-evidence",
            `record ${record.record_id} must use commands and review strictly newer than superseded record ${previous.record.record_id}`,
          );
        }
        const reusedPath = validated.reportPaths.find((reportPath) =>
          priorReportPaths.has(reportPath),
        );
        const reusedDigest = validated.reportDigests.find((digest) =>
          priorReportDigests.has(digest),
        );
        if (reusedPath || reusedDigest) {
          fail(
            "reused-supersession-report",
            `record ${record.record_id} reuses prior report ${reusedPath ?? reusedDigest}`,
          );
        }
      }
      for (const reportPath of validated.reportPaths) {
        priorReportPaths.add(reportPath);
      }
      for (const digest of validated.reportDigests) {
        priorReportDigests.add(digest);
      }
      previous = { record, validated };
    }
    latestByTask.set(taskId, previous.record);
  }

  return latestByTask;
}

function validateCandidate(
  candidate,
  index,
  { gitReader, currentRequiredTaskIds, manifestCutoff },
) {
  const context = `candidates[${index}]`;
  assertObject(candidate, CANDIDATE_KEYS, context);
  assertObjectId(candidate.commit_sha, `${context}.commit_sha`);
  assertObjectId(candidate.commit_tree, `${context}.commit_tree`);
  assertObjectId(candidate.spec_tree, `${context}.spec_tree`);
  assertSha256(candidate.spec_digest_sha256, `${context}.spec_digest_sha256`);
  timestampMillis(candidate.created_at, `${context}.created_at`);
  assertObject(candidate.source_digests, SOURCE_DIGEST_KEYS, `${context}.source_digests`);
  for (const key of SOURCE_DIGEST_KEYS) {
    assertSha256(candidate.source_digests[key], `${context}.source_digests.${key}`);
  }

  const facts = inspectCandidateCommit(gitReader, candidate.commit_sha);
  if (candidate.commit_tree !== facts.commitTree) {
    fail(
      "candidate-tree-mismatch",
      `${context}.commit_tree does not match ${candidate.commit_sha} (${facts.commitTree})`,
    );
  }
  if (candidate.spec_tree !== facts.specTree) {
    fail(
      "candidate-spec-tree-mismatch",
      `${context}.spec_tree does not match ${candidate.commit_sha}:spec (${facts.specTree})`,
    );
  }
  if (candidate.spec_digest_sha256 !== facts.specDigest) {
    fail(
      "candidate-spec-digest-mismatch",
      `${context}.spec_digest_sha256 does not match the immutable spec listing (${facts.specDigest})`,
    );
  }
  for (const [key, value] of Object.entries(facts.sources.digests)) {
    if (candidate.source_digests[key] !== value) {
      fail(
        "candidate-source-digest-mismatch",
        `${context}.source_digests.${key} does not match ${candidate.commit_sha} (${value})`,
      );
    }
  }

  validateCutoff(facts.sources.registry, manifestCutoff, `${context} registry`);
  validateReleaseMapSources(facts.sources, `${context} candidate`);
  const taskById = validateRegistryGraph(
    facts.sources.registry,
    `${context} candidate registry`,
  );
  const candidateRequired = releaseAncestorClosure(taskById, RELEASE_ROOT_TASK_ID);
  if (!equalStringArrays(candidateRequired, currentRequiredTaskIds)) {
    fail(
      "candidate-task-set-drift",
      `${context} release ancestor set differs from the current canonical registry`,
    );
  }

  const digestCache = new Map();
  const candidateContext = {
    gitReader,
    commitSha: candidate.commit_sha,
    binding: facts.binding,
    digestCache,
    taskById,
    requiredTaskIds: new Set(candidateRequired),
  };
  const latestByTask = validateRecordHistory(candidate, candidateContext);
  let passed = 0;
  let failed = 0;
  let reopened = 0;
  const nonPassedTasks = [];
  for (const taskId of candidateRequired) {
    const latest = latestByTask.get(taskId);
    if (latest.state === "passed") {
      const task = taskById.get(taskId);
      if (task.status !== "completed") {
        fail(
          "passed-task-not-completed",
          `latest ${taskId} record passes but candidate registry status is ${JSON.stringify(task.status)}`,
        );
      }
      passed += 1;
    } else {
      nonPassedTasks.push(taskId);
      if (latest.state === "failed") {
        failed += 1;
      } else {
        reopened += 1;
      }
    }
  }
  return Object.freeze({
    commitSha: candidate.commit_sha,
    taskCount: candidateRequired.length,
    recordCount: candidate.task_records.length,
    passedLatestCount: passed,
    failedLatestCount: failed,
    reopenedLatestCount: reopened,
    complete: nonPassedTasks.length === 0,
    nonPassedTasks,
  });
}

function validateManifestHeader(manifest) {
  assertObject(manifest, MANIFEST_KEYS, "evidence manifest");
  if (manifest.schema_version !== 1) {
    fail("unsupported-schema", "evidence manifest schema_version must be 1");
  }
  assertExactValueObject(
    manifest.sources,
    CANONICAL_SOURCES,
    "evidence manifest.sources",
    "source-declaration-drift",
  );
  if (manifest.root_task_id !== RELEASE_ROOT_TASK_ID) {
    fail(
      "release-root-drift",
      `root_task_id must remain ${RELEASE_ROOT_TASK_ID}`,
    );
  }
  if (manifest.historical_cutoff !== HISTORICAL_CUTOFF) {
    fail(
      "historical-cutoff-drift",
      `historical_cutoff must remain ${HISTORICAL_CUTOFF}`,
    );
  }
  assertExactValueObject(
    manifest.policy,
    EVIDENCE_POLICY,
    "evidence manifest.policy",
    "evidence-policy-drift",
  );
  if (!Array.isArray(manifest.candidates)) {
    fail("invalid-shape", "evidence manifest.candidates must be an array");
  }
  if (manifest.candidates.length > EVIDENCE_LIMITS.candidates) {
    fail(
      "resource-limit",
      `evidence manifest.candidates exceeds ${EVIDENCE_LIMITS.candidates} entries`,
    );
  }
}

export function validateEvidenceClosure({
  manifest,
  registry,
  releaseMap,
  checklist,
  gitReader,
  selectedCandidate = null,
}) {
  validateManifestHeader(manifest);
  if (selectedCandidate !== null) {
    assertObjectId(selectedCandidate, "--candidate");
  }
  validateCutoff(registry, manifest.historical_cutoff, "working registry");
  validateReleaseMapSources({ registry, releaseMap, checklist }, "working tree");
  const taskById = validateRegistryGraph(registry, "working registry");
  const currentRequiredTaskIds = releaseAncestorClosure(
    taskById,
    RELEASE_ROOT_TASK_ID,
  );

  const candidateSummaries = [];
  const candidateShas = new Set();
  for (const [index, candidate] of manifest.candidates.entries()) {
    if (isRecord(candidate) && typeof candidate.commit_sha === "string") {
      if (candidateShas.has(candidate.commit_sha)) {
        fail(
          "duplicate-candidate",
          `evidence manifest repeats candidate ${candidate.commit_sha}`,
        );
      }
      candidateShas.add(candidate.commit_sha);
    }
    candidateSummaries.push(
      validateCandidate(candidate, index, {
        gitReader,
        currentRequiredTaskIds,
        manifestCutoff: manifest.historical_cutoff,
      }),
    );
  }

  let selectedSummary = null;
  if (selectedCandidate !== null) {
    selectedSummary = candidateSummaries.find(
      ({ commitSha }) => commitSha === selectedCandidate,
    );
    if (!selectedSummary) {
      fail(
        "candidate-not-found",
        `explicit candidate ${selectedCandidate} has no immutable overlay entry`,
      );
    }
    if (!selectedSummary.complete) {
      fail(
        "candidate-not-closed",
        `candidate ${selectedCandidate} has ${selectedSummary.failedLatestCount} failed and ${selectedSummary.reopenedLatestCount} reopened latest task records: ${selectedSummary.nonPassedTasks.join(", ")}`,
      );
    }
  }

  return Object.freeze({
    mode: selectedCandidate === null ? "audit-only" : "candidate",
    rootTaskId: RELEASE_ROOT_TASK_ID,
    requiredTaskCount: currentRequiredTaskIds.length,
    manifestCandidateCount: candidateSummaries.length,
    selectedCandidate,
    selectedTaskCount: selectedSummary?.taskCount ?? 0,
    releaseWeight: selectedSummary?.passedLatestCount ?? 0,
    releaseWeightMaximum: currentRequiredTaskIds.length,
    historicalStatusWeight: 0,
    candidateSummaries,
  });
}

function parseArgs(argv) {
  const result = { ...DEFAULT_PATHS, candidate: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      result.json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    const optionNames = new Map([
      ["--repo", "repo"],
      ["--manifest", "manifest"],
      ["--registry", "registry"],
      ["--release-map", "releaseMap"],
      ["--checklist", "checklist"],
      ["--candidate", "candidate"],
    ]);
    const property = optionNames.get(argument);
    if (!property) {
      fail("invalid-argument", `unknown argument ${JSON.stringify(argument)}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("invalid-argument", `${argument} requires a value`);
    }
    result[property] = property === "candidate" ? value : path.resolve(value);
    index += 1;
  }
  return result;
}

function readText(
  filePath,
  context,
  maximumBytes = EVIDENCE_LIMITS.source_bytes,
) {
  try {
    return readBinary(filePath, context, maximumBytes).toString("utf8");
  } catch (error) {
    if (error instanceof EvidenceClosureError) {
      throw error;
    }
    fail("read-error", `cannot read ${context} ${filePath}: ${error.message}`);
  }
}

function readBinary(
  filePath,
  context,
  maximumBytes = EVIDENCE_LIMITS.source_bytes,
) {
  try {
    const size = fs.statSync(filePath).size;
    if (!Number.isSafeInteger(size) || size < 0 || size > maximumBytes) {
      fail(
        "resource-limit",
        `${context} exceeds the ${maximumBytes}-byte input limit`,
      );
    }
    return fs.readFileSync(filePath);
  } catch (error) {
    if (error instanceof EvidenceClosureError) {
      throw error;
    }
    fail("read-error", `cannot read ${context} ${filePath}: ${error.message}`);
  }
}

function readJson(
  filePath,
  context,
  maximumBytes = EVIDENCE_LIMITS.source_bytes,
) {
  const text = readText(filePath, context, maximumBytes);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("json-error", `cannot parse ${context} ${filePath}: ${error.message}`);
  }
}

function assertAppendOnlyOverlay(previous, current, previousCommit) {
  if (!isRecord(previous)) {
    fail(
      "previous-overlay-invalid",
      `${previousCommit}:${CANONICAL_MANIFEST} is not a JSON object`,
    );
  }
  const previousHeader = { ...previous };
  const currentHeader = { ...current };
  delete previousHeader.candidates;
  delete currentHeader.candidates;
  if (canonicalText(previousHeader) !== canonicalText(currentHeader)) {
    fail(
      "non-append-only-overlay",
      `overlay header changed since ${previousCommit}`,
    );
  }
  if (!Array.isArray(previous.candidates) || !Array.isArray(current.candidates)) {
    fail(
      "previous-overlay-invalid",
      `${previousCommit}:${CANONICAL_MANIFEST} has invalid candidates`,
    );
  }
  if (current.candidates.length < previous.candidates.length) {
    fail(
      "non-append-only-overlay",
      `overlay deleted candidate history recorded at ${previousCommit}`,
    );
  }
  for (const [candidateIndex, previousCandidate] of previous.candidates.entries()) {
    const currentCandidate = current.candidates[candidateIndex];
    if (!isRecord(previousCandidate) || !isRecord(currentCandidate)) {
      fail(
        "previous-overlay-invalid",
        `${previousCommit} candidate ${candidateIndex} is invalid`,
      );
    }
    const previousMetadata = { ...previousCandidate };
    const currentMetadata = { ...currentCandidate };
    delete previousMetadata.task_records;
    delete currentMetadata.task_records;
    if (canonicalText(previousMetadata) !== canonicalText(currentMetadata)) {
      fail(
        "non-append-only-overlay",
        `overlay changed candidate ${candidateIndex} metadata from ${previousCommit}`,
      );
    }
    if (
      !Array.isArray(previousCandidate.task_records) ||
      !Array.isArray(currentCandidate.task_records)
    ) {
      fail(
        "previous-overlay-invalid",
        `${previousCommit} candidate ${candidateIndex} has invalid task_records`,
      );
    }
    if (
      currentCandidate.task_records.length <
      previousCandidate.task_records.length
    ) {
      fail(
        "non-append-only-overlay",
        `overlay deleted task record history for candidate ${previousCandidate.commit_sha}`,
      );
    }
    for (
      let recordIndex = 0;
      recordIndex < previousCandidate.task_records.length;
      recordIndex += 1
    ) {
      if (
        canonicalText(previousCandidate.task_records[recordIndex]) !==
        canonicalText(currentCandidate.task_records[recordIndex])
      ) {
        fail(
          "non-append-only-overlay",
          `overlay changed task record ${recordIndex} for candidate ${previousCandidate.commit_sha}`,
        );
      }
    }
  }
}

function verifyOverlayHistory(gitReader, overlayCommit, currentManifest) {
  const manifestCache = new Map();
  const manifestAt = (commitSha, entry) => {
    if (!manifestCache.has(entry.objectId)) {
      const parsed = parseJsonBuffer(
        gitReader.readFile(commitSha, CANONICAL_MANIFEST),
        `${commitSha}:${CANONICAL_MANIFEST}`,
      );
      validateManifestHeader(parsed);
      manifestCache.set(entry.objectId, parsed);
    }
    return manifestCache.get(entry.objectId);
  };
  const overlayEntry = gitReader.pathEntry(overlayCommit, CANONICAL_MANIFEST);
  if (overlayEntry === null) {
    fail(
      "overlay-manifest-missing",
      `${overlayCommit}:${CANONICAL_MANIFEST} is missing`,
    );
  }
  manifestCache.set(overlayEntry.objectId, currentManifest);

  for (const { commit, parents } of gitReader.commitAncestry(overlayCommit)) {
    const childEntry = gitReader.pathEntry(commit, CANONICAL_MANIFEST);
    for (const parent of parents) {
      const parentEntry = gitReader.pathEntry(parent, CANONICAL_MANIFEST);
      if (parentEntry !== null && childEntry === null) {
        fail(
          "non-append-only-overlay",
          `overlay deleted ${CANONICAL_MANIFEST} at ${commit} from parent ${parent}`,
        );
      }
      if (
        parentEntry === null ||
        childEntry === null ||
        parentEntry.objectId === childEntry.objectId
      ) {
        continue;
      }
      const previousManifest = manifestAt(parent, parentEntry);
      const nextManifest = manifestAt(commit, childEntry);
      assertAppendOnlyOverlay(previousManifest, nextManifest, parent);
    }
  }
}

function explicitCandidatePreflight(args, gitReader, manifest) {
  const expected = new Map([
    ["manifest", CANONICAL_MANIFEST],
    ["registry", CANONICAL_SOURCES.registry],
    ["releaseMap", CANONICAL_SOURCES.release_task_map],
    ["checklist", CANONICAL_SOURCES.release_checklist],
  ]);
  for (const [property, relativePath] of expected) {
    const expectedPath = path.resolve(args.repo, relativePath);
    if (path.resolve(args[property]) !== expectedPath) {
      fail(
        "noncanonical-candidate-input",
        `explicit candidate validation requires ${property} at ${expectedPath}`,
      );
    }
  }
  gitReader.assertCleanWorktree();
  gitReader.assertCompleteHistory();
  const overlayCommit = gitReader.headCommit();
  gitReader.resolveCommit(args.candidate);
  gitReader.assertAncestor(args.candidate, overlayCommit);
  for (const [index, candidate] of manifest.candidates.entries()) {
    if (!isRecord(candidate)) {
      fail("invalid-shape", `candidates[${index}] must be a JSON object`);
    }
    assertObjectId(candidate.commit_sha, `candidates[${index}].commit_sha`);
    gitReader.resolveCommit(candidate.commit_sha);
    gitReader.assertAncestor(candidate.commit_sha, overlayCommit);
  }
  for (const [property, relativePath] of expected) {
    const maximumBytes =
      property === "manifest"
        ? EVIDENCE_LIMITS.manifest_bytes
        : EVIDENCE_LIMITS.source_bytes;
    const worktreeBytes = readBinary(args[property], property, maximumBytes);
    const committedBytes = gitReader.readFile(overlayCommit, relativePath);
    if (!worktreeBytes.equals(committedBytes)) {
      fail(
        "uncommitted-candidate-input",
        `${property} does not byte-match ${overlayCommit}:${relativePath}`,
      );
    }
  }
  verifyOverlayHistory(gitReader, overlayCommit, manifest);
  return overlayCommit;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node scripts/check-evidence-closure.mjs [--candidate FULL_SHA] [--json] " +
        "[--repo PATH] [--manifest PATH] [--registry PATH] [--release-map PATH] [--checklist PATH]\n",
    );
    return 0;
  }
  const manifest = readJson(
    args.manifest,
    "evidence manifest",
    EVIDENCE_LIMITS.manifest_bytes,
  );
  validateManifestHeader(manifest);
  const gitReader = new RepositoryGitReader(args.repo);
  const overlayCommit =
    args.candidate === null
      ? null
      : explicitCandidatePreflight(args, gitReader, manifest);
  const summary = validateEvidenceClosure({
    manifest,
    registry: readJson(args.registry, "task registry"),
    releaseMap: readJson(args.releaseMap, "release task map"),
    checklist: readText(args.checklist, "release checklist"),
    gitReader,
    selectedCandidate: args.candidate,
  });
  const output = { ...summary, overlayCommit };
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...output })}\n`);
  } else {
    process.stdout.write(
      `evidence-closure OK (${summary.mode}): ${summary.requiredTaskCount} required release ancestors; ` +
        `${summary.manifestCandidateCount} recorded candidates; selected=${summary.selectedCandidate ?? "none"}; ` +
        `release weight ${summary.releaseWeight}/${summary.releaseWeightMaximum}; historical status weight 0; ` +
        `overlay=${overlayCommit ?? "unbound audit"}\n`,
    );
  }
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    const code =
      error instanceof EvidenceClosureError ? error.code : "unexpected";
    if (process.argv.includes("--json")) {
      process.stderr.write(
        `${JSON.stringify({ ok: false, error: { code, message: error.message } })}\n`,
      );
    } else {
      process.stderr.write(`evidence-closure ${code}: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
