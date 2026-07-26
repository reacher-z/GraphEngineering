import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CANONICAL_SOURCES,
  EVIDENCE_LIMITS,
  EVIDENCE_POLICY,
  EvidenceClosureError,
  HISTORICAL_CUTOFF,
  RELEASE_ROOT_TASK_ID,
  RepositoryGitReader,
  computeRecordDigest,
  computeTaskContractDigest,
  inspectCandidateCommit,
  sha256Hex,
  validateEvidenceClosure,
} from "../check-evidence-closure.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REGISTRY = JSON.parse(
  fs.readFileSync(path.join(ROOT, CANONICAL_SOURCES.registry), "utf8"),
);
const RELEASE_MAP = JSON.parse(
  fs.readFileSync(path.join(ROOT, CANONICAL_SOURCES.release_task_map), "utf8"),
);
const CHECKLIST = fs.readFileSync(
  path.join(ROOT, CANONICAL_SOURCES.release_checklist),
  "utf8",
);
const EMPTY_MANIFEST = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "codex_logs/release-evidence/task-revalidation.json"),
    "utf8",
  ),
);

function clone(value) {
  return structuredClone(value);
}

function requiredTaskIds(registry) {
  const byId = new Map(registry.tasks.map((task) => [task.id, task]));
  const result = new Set();
  const visit = (taskId) => {
    for (const dependency of byId.get(taskId).depends_on) {
      if (!result.has(dependency)) {
        result.add(dependency);
        visit(dependency);
      }
    }
  };
  visit(RELEASE_ROOT_TASK_ID);
  result.delete(RELEASE_ROOT_TASK_ID);
  return [...result].sort();
}

function git(repository, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function writeFixtureFile(repository, relativePath, contents) {
  const target = path.join(repository, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function materializeExpectedArtifact(repository, requirement) {
  const target = path.join(repository, requirement);
  if (fs.existsSync(target)) {
    if (fs.statSync(target).isFile()) {
      return requirement;
    }
    const child = `${requirement}/.coverage-evidence`;
    writeFixtureFile(
      repository,
      child,
      `synthetic coverage for ${requirement}\n`,
    );
    return child;
  }
  if (path.posix.extname(requirement) !== "") {
    writeFixtureFile(
      repository,
      requirement,
      `synthetic coverage for ${requirement}\n`,
    );
    return requirement;
  }
  const child = `${requirement}/.coverage-evidence`;
  writeFixtureFile(
    repository,
    child,
    `synthetic coverage for ${requirement}\n`,
  );
  return child;
}

function buildGitFixture() {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), "graph-evidence-closure-"),
  );
  git(repository, ["init", "--quiet"]);
  git(repository, ["config", "user.name", "Evidence Fixture"]);
  git(repository, ["config", "user.email", "evidence@example.invalid"]);

  const candidateRegistry = clone(REGISTRY);
  const required = requiredTaskIds(candidateRegistry);
  const requiredSet = new Set(required);
  for (const task of candidateRegistry.tasks) {
    if (requiredSet.has(task.id)) {
      task.status = "completed";
    }
  }

  writeFixtureFile(
    repository,
    CANONICAL_SOURCES.registry,
    `${JSON.stringify(candidateRegistry, null, 2)}\n`,
  );
  writeFixtureFile(
    repository,
    CANONICAL_SOURCES.release_task_map,
    `${JSON.stringify(RELEASE_MAP, null, 2)}\n`,
  );
  writeFixtureFile(repository, CANONICAL_SOURCES.release_checklist, CHECKLIST);
  writeFixtureFile(
    repository,
    "codex_logs/release-evidence/task-revalidation.json",
    `${JSON.stringify(EMPTY_MANIFEST, null, 2)}\n`,
  );
  writeFixtureFile(
    repository,
    "spec/evidence-fixture.txt",
    "immutable candidate spec fixture\n",
  );
  for (let index = 1; index <= 5; index += 1) {
    writeFixtureFile(
      repository,
      `evidence/command-report-${index}.json`,
      `${JSON.stringify({ ok: true, suite: "synthetic-candidate", sequence: index })}\n`,
    );
    writeFixtureFile(
      repository,
      `evidence/review-report-${index}.md`,
      `# Independent synthetic review ${index}\n\nAccepted sequence ${index} for checker tests.\n`,
    );
  }
  writeFixtureFile(
    repository,
    "evidence/artifact.bin",
    Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xff]),
  );
  writeFixtureFile(repository, "evidence/literal*.bin", "literal star path\n");
  writeFixtureFile(repository, "evidence/literal-match.bin", "not the star path\n");
  writeFixtureFile(
    repository,
    "evidence/command-report-1-copy.json",
    `${JSON.stringify({ ok: true, suite: "synthetic-candidate", sequence: 1 })}\n`,
  );
  fs.symlinkSync(
    "artifact.bin",
    path.join(repository, "evidence/artifact-link.bin"),
  );
  const oversizedPath = path.join(repository, "evidence/oversized.bin");
  fs.closeSync(fs.openSync(oversizedPath, "w"));
  fs.truncateSync(
    oversizedPath,
    EVIDENCE_LIMITS.referenced_blob_bytes + 1,
  );
  const artifactPathByRequirement = new Map();
  for (const task of candidateRegistry.tasks) {
    for (const requirement of task.expected_artifacts ?? []) {
      if (!artifactPathByRequirement.has(requirement)) {
        artifactPathByRequirement.set(
          requirement,
          materializeExpectedArtifact(repository, requirement),
        );
      }
    }
  }
  git(repository, ["add", "."]);
  git(repository, ["commit", "--quiet", "-m", "synthetic candidate"]);
  const commitSha = git(repository, ["rev-parse", "HEAD"]);
  const gitReader = new RepositoryGitReader(repository);
  const facts = inspectCandidateCommit(gitReader, commitSha);
  const taskById = new Map(
    facts.sources.registry.tasks.map((task) => [task.id, task]),
  );
  const reportSets = Array.from({ length: 5 }, (_, offset) => {
    const index = offset + 1;
    const commandPath = `evidence/command-report-${index}.json`;
    const reviewPath = `evidence/review-report-${index}.md`;
    return {
      command: {
        path: commandPath,
        sha256: sha256Hex(gitReader.readFile(commitSha, commandPath)),
      },
      review: {
        path: reviewPath,
        sha256: sha256Hex(gitReader.readFile(commitSha, reviewPath)),
      },
    };
  });
  const artifactReferenceByRequirement = new Map(
    [...artifactPathByRequirement].map(([requirement, artifactPath]) => [
      requirement,
      {
        path: artifactPath,
        sha256: sha256Hex(gitReader.readFile(commitSha, artifactPath)),
      },
    ]),
  );

  const taskRecords = required.map((taskId, index) => {
    const task = taskById.get(taskId);
    const record = {
      record_id: `synthetic:${String(index + 1).padStart(3, "0")}:${taskId}`,
      task_id: taskId,
      state: "passed",
      supersedes: null,
      recorded_at: "2026-07-26T00:03:00Z",
      producer_id: `producer:${taskId}`,
      binding: clone(facts.binding),
      task_contract_digest_sha256: computeTaskContractDigest(task),
      commands: [
        {
          argv: ["node", "synthetic-check.mjs", taskId],
          cwd: ".",
          environment: {
            OS: "linux",
            ARCH: "x64",
            NODE_VERSION: "22.17.0",
          },
          result: {
            status: "passed",
            exit_code: 0,
            started_at: "2026-07-26T00:00:00Z",
            completed_at: "2026-07-26T00:01:00Z",
            report: clone(reportSets[0].command),
          },
        },
      ],
      artifacts: task.expected_artifacts.map((requirement) =>
        clone(artifactReferenceByRequirement.get(requirement)),
      ),
      coverage: {
        tests: task.expected_tests.map((requirement) => ({
          requirement,
          command_indexes: [0],
        })),
        artifacts: task.expected_artifacts.map((requirement, artifactIndex) => ({
          requirement,
          artifact_indexes: [artifactIndex],
        })),
      },
      review: {
        reviewer_id: "independent:synthetic-reviewer",
        independent: true,
        decision: "accepted",
        reviewed_at: "2026-07-26T00:02:00Z",
        report: clone(reportSets[0].review),
        exclusions: [],
        fallback_mode: "no release when any required record is not passed",
      },
      record_digest_sha256: "0".repeat(64),
    };
    record.record_digest_sha256 = computeRecordDigest(record);
    return record;
  });

  const candidate = {
    commit_sha: commitSha,
    commit_tree: facts.commitTree,
    spec_tree: facts.specTree,
    spec_digest_sha256: facts.specDigest,
    source_digests: clone(facts.sources.digests),
    created_at: "2026-07-26T00:04:00Z",
    task_records: taskRecords,
  };
  const manifest = clone(EMPTY_MANIFEST);
  manifest.candidates = [candidate];
  writeFixtureFile(
    repository,
    "codex_logs/release-evidence/task-revalidation.json",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  git(repository, ["add", "codex_logs/release-evidence/task-revalidation.json"]);
  git(repository, ["commit", "--quiet", "-m", "bind candidate overlay"]);
  const overlayCommit = git(repository, ["rev-parse", "HEAD"]);
  return {
    repository,
    gitReader,
    commitSha,
    overlayCommit,
    manifest,
    required,
    reportSets,
  };
}

const FIXTURE = buildGitFixture();
process.on("exit", () => {
  fs.rmSync(FIXTURE.repository, { recursive: true, force: true });
});

function validate({
  manifest = EMPTY_MANIFEST,
  registry = REGISTRY,
  releaseMap = RELEASE_MAP,
  checklist = CHECKLIST,
  selectedCandidate = null,
} = {}) {
  return validateEvidenceClosure({
    manifest,
    registry,
    releaseMap,
    checklist,
    gitReader: FIXTURE.gitReader,
    selectedCandidate,
  });
}

function assertCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof EvidenceClosureError, error?.stack);
    assert.equal(error.code, code, error.message);
    return true;
  });
}

function firstRecord(manifest) {
  return manifest.candidates[0].task_records[0];
}

function refreshRecord(record) {
  record.record_digest_sha256 = computeRecordDigest(record);
  return record;
}

function appendStateRecord(manifest, state, suffix, recordedAt) {
  const candidate = manifest.candidates[0];
  const taskId = candidate.task_records[0].task_id;
  const history = candidate.task_records.filter(
    ({ task_id: recordTaskId }) => recordTaskId === taskId,
  );
  const previous = history.at(-1);
  const next = clone(previous);
  next.record_id = `${previous.record_id}:${suffix}`;
  next.state = state;
  next.supersedes = previous.record_id;
  next.recorded_at = recordedAt;
  next.review.decision = {
    passed: "accepted",
    failed: "rejected",
    reopened: "reopened",
  }[state];
  const reportSet = FIXTURE.reportSets[history.length];
  assert.ok(reportSet, "synthetic fixture needs a fresh report set");
  next.commands[0].result.report = clone(reportSet.command);
  next.review.report = clone(reportSet.review);
  const recorded = Date.parse(recordedAt);
  next.commands[0].result.started_at = new Date(recorded - 45_000).toISOString();
  next.commands[0].result.completed_at = new Date(recorded - 30_000).toISOString();
  next.review.reviewed_at = new Date(recorded - 15_000).toISOString();
  refreshRecord(next);
  candidate.task_records.push(next);
  return next;
}

test("canonical empty overlay audits successfully and contributes zero weight", () => {
  const summary = validate();
  assert.equal(summary.mode, "audit-only");
  assert.equal(summary.requiredTaskCount, requiredTaskIds(REGISTRY).length);
  assert.equal(summary.manifestCandidateCount, 0);
  assert.equal(summary.releaseWeight, 0);
  assert.equal(summary.releaseWeightMaximum, summary.requiredTaskCount);
  assert.equal(summary.historicalStatusWeight, 0);
});

test("forged historical completed status still contributes zero release weight", () => {
  const registry = clone(REGISTRY);
  const required = new Set(requiredTaskIds(registry));
  for (const task of registry.tasks) {
    if (required.has(task.id)) {
      task.status = "completed";
    }
  }
  const summary = validate({ registry });
  assert.equal(summary.releaseWeight, 0);
  assert.equal(summary.selectedTaskCount, 0);
  assert.equal(summary.historicalStatusWeight, 0);
});

test("a complete immutable synthetic candidate closes the dynamic ancestor set", () => {
  const summary = validate({
    manifest: FIXTURE.manifest,
    selectedCandidate: FIXTURE.commitSha,
  });
  assert.equal(summary.mode, "candidate");
  assert.equal(summary.requiredTaskCount, FIXTURE.required.length);
  assert.equal(summary.selectedTaskCount, FIXTURE.required.length);
  assert.equal(summary.releaseWeight, FIXTURE.required.length);
  assert.equal(summary.candidateSummaries[0].complete, true);
  assert.equal(
    summary.candidateSummaries[0].recordCount,
    FIXTURE.required.length,
  );
});

test("CLI candidate mode binds a clean committed overlay checkout", () => {
  const output = execFileSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/check-evidence-closure.mjs"),
      "--repo",
      FIXTURE.repository,
      "--manifest",
      path.join(
        FIXTURE.repository,
        "codex_logs/release-evidence/task-revalidation.json",
      ),
      "--registry",
      path.join(FIXTURE.repository, CANONICAL_SOURCES.registry),
      "--release-map",
      path.join(FIXTURE.repository, CANONICAL_SOURCES.release_task_map),
      "--checklist",
      path.join(FIXTURE.repository, CANONICAL_SOURCES.release_checklist),
      "--candidate",
      FIXTURE.commitSha,
      "--json",
    ],
    { encoding: "utf8" },
  );
  const summary = JSON.parse(output);
  assert.equal(summary.ok, true);
  assert.equal(summary.selectedCandidate, FIXTURE.commitSha);
  assert.equal(summary.overlayCommit, FIXTURE.overlayCommit);
  assert.equal(summary.releaseWeight, FIXTURE.required.length);
});

test("CLI explicit candidate rejects a dirty worktree impersonation", () => {
  const dirtyRepository = fs.mkdtempSync(
    path.join(os.tmpdir(), "graph-evidence-dirty-"),
  );
  try {
    execFileSync("git", ["clone", "--quiet", FIXTURE.repository, dirtyRepository]);
    fs.writeFileSync(path.join(dirtyRepository, "uncommitted-evidence.txt"), "forged\n");
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts/check-evidence-closure.mjs"),
            "--repo",
            dirtyRepository,
            "--manifest",
            path.join(
              dirtyRepository,
              "codex_logs/release-evidence/task-revalidation.json",
            ),
            "--registry",
            path.join(dirtyRepository, CANONICAL_SOURCES.registry),
            "--release-map",
            path.join(dirtyRepository, CANONICAL_SOURCES.release_task_map),
            "--checklist",
            path.join(dirtyRepository, CANONICAL_SOURCES.release_checklist),
            "--candidate",
            FIXTURE.commitSha,
            "--json",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      (error) => {
        const failure = JSON.parse(error.stderr);
        assert.equal(failure.ok, false);
        assert.equal(failure.error.code, "dirty-candidate-worktree");
        return true;
      },
    );
  } finally {
    fs.rmSync(dirtyRepository, { recursive: true, force: true });
  }
});

test("CLI clean-check rejects skip-worktree hiding a tracked artifact mutation", () => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), "graph-evidence-index-flags-"),
  );
  try {
    execFileSync("git", ["clone", "--quiet", FIXTURE.repository, repository]);
    git(repository, ["update-index", "--skip-worktree", "evidence/artifact.bin"]);
    fs.writeFileSync(path.join(repository, "evidence/artifact.bin"), "forged\n");
    assert.equal(git(repository, ["status", "--porcelain=v1"]), "");
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts/check-evidence-closure.mjs"),
            "--repo",
            repository,
            "--manifest",
            path.join(
              repository,
              "codex_logs/release-evidence/task-revalidation.json",
            ),
            "--registry",
            path.join(repository, CANONICAL_SOURCES.registry),
            "--release-map",
            path.join(repository, CANONICAL_SOURCES.release_task_map),
            "--checklist",
            path.join(repository, CANONICAL_SOURCES.release_checklist),
            "--candidate",
            FIXTURE.commitSha,
            "--json",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      (error) => {
        const failure = JSON.parse(error.stderr);
        assert.equal(failure.error.code, "unsafe-index-flags");
        return true;
      },
    );
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("CLI candidate validation rejects shallow overlay ancestry", () => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), "graph-evidence-shallow-"),
  );
  fs.rmSync(repository, { recursive: true, force: true });
  try {
    execFileSync("git", [
      "clone",
      "--quiet",
      "--depth",
      "1",
      pathToFileURL(FIXTURE.repository).href,
      repository,
    ]);
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts/check-evidence-closure.mjs"),
            "--repo",
            repository,
            "--manifest",
            path.join(
              repository,
              "codex_logs/release-evidence/task-revalidation.json",
            ),
            "--registry",
            path.join(repository, CANONICAL_SOURCES.registry),
            "--release-map",
            path.join(repository, CANONICAL_SOURCES.release_task_map),
            "--checklist",
            path.join(repository, CANONICAL_SOURCES.release_checklist),
            "--candidate",
            FIXTURE.commitSha,
            "--json",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      (error) => {
        const failure = JSON.parse(error.stderr);
        assert.equal(failure.error.code, "shallow-overlay-history");
        return true;
      },
    );
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("CLI explicit candidate must be an ancestor of the committed overlay", () => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), "graph-evidence-unrelated-"),
  );
  try {
    execFileSync("git", ["clone", "--quiet", FIXTURE.repository, repository]);
    const tree = git(repository, ["rev-parse", "HEAD^{tree}"]);
    const unrelated = git(repository, [
      "commit-tree",
      tree,
      "-m",
      "unrelated candidate",
    ]);
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts/check-evidence-closure.mjs"),
            "--repo",
            repository,
            "--manifest",
            path.join(
              repository,
              "codex_logs/release-evidence/task-revalidation.json",
            ),
            "--registry",
            path.join(repository, CANONICAL_SOURCES.registry),
            "--release-map",
            path.join(repository, CANONICAL_SOURCES.release_task_map),
            "--checklist",
            path.join(repository, CANONICAL_SOURCES.release_checklist),
            "--candidate",
            unrelated,
            "--json",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      (error) => {
        const failure = JSON.parse(error.stderr);
        assert.equal(failure.error.code, "candidate-not-overlay-ancestor");
        return true;
      },
    );
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("CLI requires every recorded candidate, not only the selected one, to be an overlay ancestor", () => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), "graph-evidence-all-candidate-ancestry-"),
  );
  try {
    execFileSync("git", ["clone", "--quiet", FIXTURE.repository, repository]);
    git(repository, ["config", "user.name", "Evidence Fixture"]);
    git(repository, ["config", "user.email", "evidence@example.invalid"]);
    const tree = git(repository, ["rev-parse", `${FIXTURE.commitSha}^{tree}`]);
    const unrelated = git(repository, [
      "commit-tree",
      tree,
      "-m",
      "unrelated recorded candidate",
    ]);
    const gitReader = new RepositoryGitReader(repository);
    const unrelatedFacts = inspectCandidateCommit(gitReader, unrelated);
    const manifest = clone(FIXTURE.manifest);
    const unrelatedCandidate = clone(manifest.candidates[0]);
    unrelatedCandidate.commit_sha = unrelated;
    unrelatedCandidate.commit_tree = unrelatedFacts.commitTree;
    unrelatedCandidate.spec_tree = unrelatedFacts.specTree;
    unrelatedCandidate.spec_digest_sha256 = unrelatedFacts.specDigest;
    unrelatedCandidate.source_digests = clone(unrelatedFacts.sources.digests);
    for (const record of unrelatedCandidate.task_records) {
      record.binding = clone(unrelatedFacts.binding);
      refreshRecord(record);
    }
    manifest.candidates.push(unrelatedCandidate);
    const manifestPath = path.join(
      repository,
      "codex_logs/release-evidence/task-revalidation.json",
    );
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    git(repository, ["add", "codex_logs/release-evidence/task-revalidation.json"]);
    git(repository, ["commit", "--quiet", "-m", "append unrelated candidate"]);

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts/check-evidence-closure.mjs"),
            "--repo",
            repository,
            "--manifest",
            manifestPath,
            "--registry",
            path.join(repository, CANONICAL_SOURCES.registry),
            "--release-map",
            path.join(repository, CANONICAL_SOURCES.release_task_map),
            "--checklist",
            path.join(repository, CANONICAL_SOURCES.release_checklist),
            "--candidate",
            FIXTURE.commitSha,
            "--json",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      (error) => {
        const failure = JSON.parse(error.stderr);
        assert.equal(failure.error.code, "candidate-not-overlay-ancestor");
        return true;
      },
    );
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("CLI full overlay ancestry rejects deletion washed through an unrelated later commit", () => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), "graph-evidence-history-"),
  );
  try {
    execFileSync("git", ["clone", "--quiet", FIXTURE.repository, repository]);
    git(repository, ["config", "user.name", "Evidence Fixture"]);
    git(repository, ["config", "user.email", "evidence@example.invalid"]);
    const manifestPath = path.join(
      repository,
      "codex_logs/release-evidence/task-revalidation.json",
    );
    const appended = clone(FIXTURE.manifest);
    appendStateRecord(
      appended,
      "failed",
      "committed-failure",
      "2026-07-26T00:04:00Z",
    );
    fs.writeFileSync(manifestPath, `${JSON.stringify(appended, null, 2)}\n`);
    git(repository, ["add", "codex_logs/release-evidence/task-revalidation.json"]);
    git(repository, ["commit", "--quiet", "-m", "append failure record"]);

    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(FIXTURE.manifest, null, 2)}\n`,
    );
    git(repository, ["add", "codex_logs/release-evidence/task-revalidation.json"]);
    git(repository, ["commit", "--quiet", "-m", "delete failure history"]);
    writeFixtureFile(repository, "unrelated.txt", "history wash attempt\n");
    git(repository, ["add", "unrelated.txt"]);
    git(repository, ["commit", "--quiet", "-m", "unrelated commit after deletion"]);

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts/check-evidence-closure.mjs"),
            "--repo",
            repository,
            "--manifest",
            manifestPath,
            "--registry",
            path.join(repository, CANONICAL_SOURCES.registry),
            "--release-map",
            path.join(repository, CANONICAL_SOURCES.release_task_map),
            "--checklist",
            path.join(repository, CANONICAL_SOURCES.release_checklist),
            "--candidate",
            FIXTURE.commitSha,
            "--json",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      (error) => {
        const failure = JSON.parse(error.stderr);
        assert.equal(failure.error.code, "non-append-only-overlay");
        return true;
      },
    );
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("a recorded candidate has no implicit weight without --candidate", () => {
  const summary = validate({ manifest: FIXTURE.manifest });
  assert.equal(summary.candidateSummaries[0].complete, true);
  assert.equal(summary.selectedCandidate, null);
  assert.equal(summary.releaseWeight, 0);
});

test("explicit candidate must be a full immutable object ID", () => {
  assertCode("invalid-object-id", () =>
    validate({ manifest: FIXTURE.manifest, selectedCandidate: "582b78b" }),
  );
});

test("explicit candidate with no overlay entry fails closed", () => {
  assertCode("candidate-not-found", () =>
    validate({
      manifest: EMPTY_MANIFEST,
      selectedCandidate: "f".repeat(40),
    }),
  );
});

test("candidate entries must resolve to a real commit", () => {
  const manifest = clone(FIXTURE.manifest);
  manifest.candidates[0].commit_sha = "f".repeat(40);
  assertCode("candidate-commit-not-found", () => validate({ manifest }));
});

test("candidate object ID cannot name a non-commit Git object", () => {
  const manifest = clone(FIXTURE.manifest);
  manifest.candidates[0].commit_sha = git(FIXTURE.repository, [
    "rev-parse",
    `${FIXTURE.commitSha}:evidence/artifact.bin`,
  ]);
  assertCode("candidate-commit-not-found", () => validate({ manifest }));
});

test("every dynamic root ancestor needs a task record", () => {
  const manifest = clone(FIXTURE.manifest);
  manifest.candidates[0].task_records.pop();
  assertCode("missing-task-record", () => validate({ manifest }));
});

test("candidate commit tree is verified from Git", () => {
  const manifest = clone(FIXTURE.manifest);
  manifest.candidates[0].commit_tree = "0".repeat(40);
  assertCode("candidate-tree-mismatch", () => validate({ manifest }));
});

test("candidate spec tree and deterministic spec digest are verified", async (t) => {
  await t.test("wrong spec tree", () => {
    const manifest = clone(FIXTURE.manifest);
    manifest.candidates[0].spec_tree = "0".repeat(40);
    assertCode("candidate-spec-tree-mismatch", () => validate({ manifest }));
  });
  await t.test("wrong spec digest", () => {
    const manifest = clone(FIXTURE.manifest);
    manifest.candidates[0].spec_digest_sha256 = "0".repeat(64);
    assertCode("candidate-spec-digest-mismatch", () => validate({ manifest }));
  });
});

test("candidate canonical source digests are verified from Git", async (t) => {
  for (const field of [
    "registry_sha256",
    "release_task_map_sha256",
    "release_checklist_sha256",
  ]) {
    await t.test(field, () => {
      const manifest = clone(FIXTURE.manifest);
      manifest.candidates[0].source_digests[field] = "0".repeat(64);
      assertCode("candidate-source-digest-mismatch", () => validate({ manifest }));
    });
  }
});

test("every task record repeats the exact candidate binding", () => {
  const manifest = clone(FIXTURE.manifest);
  firstRecord(manifest).binding.commit_sha = "0".repeat(40);
  assertCode("record-binding-mismatch", () => validate({ manifest }));
});

test("task contract digest binds candidate expected artifacts and tests", () => {
  const manifest = clone(FIXTURE.manifest);
  firstRecord(manifest).task_contract_digest_sha256 = "0".repeat(64);
  assertCode("task-contract-digest-mismatch", () => validate({ manifest }));
});

test("task coverage exactly closes expected tests and artifacts", async (t) => {
  await t.test("missing expected test requirement", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).coverage.tests.pop();
    assertCode("coverage-requirement-mismatch", () => validate({ manifest }));
  });
  await t.test("duplicate expected test requirement", () => {
    const manifest = clone(FIXTURE.manifest);
    const coverage = firstRecord(manifest).coverage.tests;
    coverage[1].requirement = coverage[0].requirement;
    assertCode("coverage-requirement-mismatch", () => validate({ manifest }));
  });
  await t.test("forged expected test requirement", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).coverage.tests[0].requirement = "echo passed";
    assertCode("coverage-requirement-mismatch", () => validate({ manifest }));
  });
  await t.test("dangling command index", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).coverage.tests[0].command_indexes = [99_999];
    assertCode("dangling-coverage-index", () => validate({ manifest }));
  });
  await t.test("duplicate command index", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).coverage.tests[0].command_indexes = [0, 0];
    assertCode("duplicate-coverage-index", () => validate({ manifest }));
  });
  await t.test("artifact from an adjacent requirement cannot satisfy a path", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).coverage.artifacts[0].artifact_indexes = [1];
    assertCode("artifact-coverage-path-mismatch", () => validate({ manifest }));
  });
  await t.test("uncovered additional command index", () => {
    const manifest = clone(FIXTURE.manifest);
    const record = firstRecord(manifest);
    record.commands.push(clone(record.commands[0]));
    refreshRecord(record);
    assertCode("uncovered-evidence-index", () => validate({ manifest }));
  });
  await t.test("uncovered additional artifact index", () => {
    const manifest = clone(FIXTURE.manifest);
    const record = firstRecord(manifest);
    record.artifacts.push({
      path: "evidence/artifact.bin",
      sha256: sha256Hex(
        FIXTURE.gitReader.readFile(FIXTURE.commitSha, "evidence/artifact.bin"),
      ),
    });
    refreshRecord(record);
    assertCode("uncovered-evidence-index", () => validate({ manifest }));
  });
  await t.test("passed record cannot cover a failed command", () => {
    const manifest = clone(FIXTURE.manifest);
    const result = firstRecord(manifest).commands[0].result;
    result.status = "failed";
    result.exit_code = 1;
    assertCode("passed-record-has-failed-command", () => validate({ manifest }));
  });
});

test("artifact and report bytes are read from the candidate commit", async (t) => {
  await t.test("artifact digest", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).artifacts[0].sha256 = "0".repeat(64);
    assertCode("file-digest-mismatch", () => validate({ manifest }));
  });
  await t.test("command report digest", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).commands[0].result.report.sha256 = "0".repeat(64);
    assertCode("file-digest-mismatch", () => validate({ manifest }));
  });
  await t.test("review report digest", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).review.report.sha256 = "0".repeat(64);
    assertCode("file-digest-mismatch", () => validate({ manifest }));
  });
  await t.test("missing candidate path", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).artifacts[0].path = "evidence/missing.bin";
    assertCode("candidate-path-missing", () => validate({ manifest }));
  });
  await t.test("Git symlink cannot masquerade as an artifact blob", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).artifacts[0] = {
      path: "evidence/artifact-link.bin",
      sha256: sha256Hex(Buffer.from("artifact.bin")),
    };
    assertCode("candidate-path-not-file", () => validate({ manifest }));
  });
  await t.test("oversized candidate blob fails before hashing", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).artifacts[0] = {
      path: "evidence/oversized.bin",
      sha256: "0".repeat(64),
    };
    assertCode("candidate-blob-too-large", () => validate({ manifest }));
  });
  await t.test("repository traversal path is rejected", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).artifacts[0].path = "../outside.bin";
    assertCode("invalid-repository-path", () => validate({ manifest }));
  });
  await t.test("Git wildcard syntax is treated as one literal path", () => {
    const bytes = FIXTURE.gitReader.readFile(
      FIXTURE.commitSha,
      "evidence/literal*.bin",
    );
    assert.equal(bytes.toString("utf8"), "literal star path\n");
    assert.notEqual(
      sha256Hex(bytes),
      sha256Hex(
        FIXTURE.gitReader.readFile(
          FIXTURE.commitSha,
          "evidence/literal-match.bin",
        ),
      ),
    );
  });
});

test("record IDs cannot be duplicated", () => {
  const manifest = clone(FIXTURE.manifest);
  manifest.candidates[0].task_records.push(clone(firstRecord(manifest)));
  assertCode("duplicate-record-id", () => validate({ manifest }));
});

test("supersedes links reject dangling, cyclic, and branching history", async (t) => {
  await t.test("dangling", () => {
    const manifest = clone(FIXTURE.manifest);
    const next = appendStateRecord(
      manifest,
      "passed",
      "dangling",
      "2026-07-26T00:04:00Z",
    );
    next.supersedes = "missing:record";
    refreshRecord(next);
    assertCode("dangling-supersedes", () => validate({ manifest }));
  });
  await t.test("cyclic", () => {
    const manifest = clone(FIXTURE.manifest);
    const initial = firstRecord(manifest);
    const next = appendStateRecord(
      manifest,
      "passed",
      "cycle",
      "2026-07-26T00:04:00Z",
    );
    initial.supersedes = next.record_id;
    refreshRecord(initial);
    assertCode("cyclic-supersedes", () => validate({ manifest }));
  });
  await t.test("branch from non-latest", () => {
    const manifest = clone(FIXTURE.manifest);
    const initial = firstRecord(manifest);
    appendStateRecord(
      manifest,
      "failed",
      "second",
      "2026-07-26T00:04:00Z",
    );
    const third = appendStateRecord(
      manifest,
      "passed",
      "third",
      "2026-07-26T00:05:00Z",
    );
    third.supersedes = initial.record_id;
    refreshRecord(third);
    assertCode("non-linear-supersedes", () => validate({ manifest }));
  });
  await t.test("cross-task predecessor", () => {
    const manifest = clone(FIXTURE.manifest);
    const first = manifest.candidates[0].task_records[0];
    const second = manifest.candidates[0].task_records[1];
    second.supersedes = first.record_id;
    refreshRecord(second);
    assertCode("cross-task-supersedes", () => validate({ manifest }));
  });
});

test("latest failed and reopened records invalidate older passes", async (t) => {
  for (const [state, countField] of [
    ["failed", "failedLatestCount"],
    ["reopened", "reopenedLatestCount"],
  ]) {
    await t.test(state, () => {
      const manifest = clone(FIXTURE.manifest);
      appendStateRecord(
        manifest,
        state,
        state,
        "2026-07-26T00:04:00Z",
      );
      const audit = validate({ manifest });
      assert.equal(audit.releaseWeight, 0);
      assert.equal(audit.candidateSummaries[0].complete, false);
      assert.equal(audit.candidateSummaries[0][countField], 1);
      assertCode("candidate-not-closed", () =>
        validate({ manifest, selectedCandidate: FIXTURE.commitSha }),
      );
    });
  }
});

test("a newer passed record can reclose only with later unique command and review reports", () => {
  const manifest = clone(FIXTURE.manifest);
  appendStateRecord(
    manifest,
    "failed",
    "failed",
    "2026-07-26T00:04:00Z",
  );
  appendStateRecord(
    manifest,
    "passed",
    "reclosed",
    "2026-07-26T00:05:00Z",
  );
  const summary = validate({
    manifest,
    selectedCandidate: FIXTURE.commitSha,
  });
  assert.equal(summary.candidateSummaries[0].complete, true);
  assert.equal(
    summary.candidateSummaries[0].recordCount,
    FIXTURE.required.length + 2,
  );
});

test("supersession rejects stale command/review time and reused report blobs", async (t) => {
  await t.test("stale command and review", () => {
    const manifest = clone(FIXTURE.manifest);
    const initial = firstRecord(manifest);
    const next = appendStateRecord(
      manifest,
      "failed",
      "stale-evidence",
      "2026-07-26T00:04:00Z",
    );
    next.commands[0].result.started_at = initial.commands[0].result.started_at;
    next.commands[0].result.completed_at = initial.commands[0].result.completed_at;
    next.review.reviewed_at = initial.review.reviewed_at;
    refreshRecord(next);
    assertCode("stale-supersession-evidence", () => validate({ manifest }));
  });

  await t.test("reused command and review report blobs", () => {
    const manifest = clone(FIXTURE.manifest);
    const initial = firstRecord(manifest);
    const next = appendStateRecord(
      manifest,
      "failed",
      "reused-reports",
      "2026-07-26T00:04:00Z",
    );
    next.commands[0].result.report = clone(initial.commands[0].result.report);
    next.review.report = clone(initial.review.report);
    refreshRecord(next);
    assertCode("reused-supersession-report", () => validate({ manifest }));
  });
});

test("candidate record-count resource bound fails closed before traversal", () => {
  const manifest = clone(FIXTURE.manifest);
  manifest.candidates[0].task_records = Array.from(
    { length: EVIDENCE_LIMITS.records_per_candidate + 1 },
    () => clone(firstRecord(FIXTURE.manifest)),
  );
  assertCode("resource-limit", () => validate({ manifest }));
});

test("required command/reviewer/exclusion/result/report fields fail closed", async (t) => {
  const mutations = [
    ["commands", (record) => delete record.commands],
    ["coverage", (record) => delete record.coverage],
    ["review", (record) => delete record.review],
    ["reviewer", (record) => delete record.review.reviewer_id],
    ["exclusions", (record) => delete record.review.exclusions],
    ["environment", (record) => delete record.commands[0].environment],
    ["result", (record) => delete record.commands[0].result],
    ["command report", (record) => delete record.commands[0].result.report],
    ["review report", (record) => delete record.review.report],
  ];
  for (const [label, mutate] of mutations) {
    await t.test(label, () => {
      const manifest = clone(FIXTURE.manifest);
      mutate(firstRecord(manifest));
      assertCode("missing-field", () => validate({ manifest }));
    });
  }
});

test("empty commands and environment do not count as exact execution evidence", async (t) => {
  await t.test("empty commands", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).commands = [];
    assertCode("missing-command-evidence", () => validate({ manifest }));
  });
  await t.test("empty environment", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).commands[0].environment = {};
    assertCode("invalid-environment", () => validate({ manifest }));
  });
});

test("command argv cwd exit and time envelopes fail closed exactly", async (t) => {
  await t.test("passed status with nonzero exit", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).commands[0].result.exit_code = 1;
    assertCode("inconsistent-command-result", () => validate({ manifest }));
  });
  await t.test("exit outside portable process range", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).commands[0].result.exit_code = 256;
    assertCode("invalid-command-result", () => validate({ manifest }));
  });
  await t.test("command working-directory traversal", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).commands[0].cwd = "../outside";
    assertCode("invalid-repository-path", () => validate({ manifest }));
  });
  await t.test("impossible calendar timestamp", () => {
    const manifest = clone(FIXTURE.manifest);
    firstRecord(manifest).commands[0].result.started_at =
      "2026-02-31T00:00:00Z";
    assertCode("invalid-timestamp", () => validate({ manifest }));
  });
  await t.test("repeated argv values remain exact and valid", () => {
    const manifest = clone(FIXTURE.manifest);
    const record = firstRecord(manifest);
    record.commands[0].argv = ["node", "--filter", "same", "--filter", "same"];
    refreshRecord(record);
    assert.equal(validate({ manifest }).candidateSummaries[0].complete, true);
  });
});

test("sensitive environment fields are rejected from evidence", () => {
  const manifest = clone(FIXTURE.manifest);
  firstRecord(manifest).commands[0].environment.API_TOKEN = "must-not-be-logged";
  assertCode("sensitive-environment-key", () => validate({ manifest }));
});

test("reviewer identity and report must be independent", async (t) => {
  await t.test("reviewer equals producer", () => {
    const manifest = clone(FIXTURE.manifest);
    const record = firstRecord(manifest);
    record.review.reviewer_id = record.producer_id;
    assertCode("reviewer-is-producer", () => validate({ manifest }));
  });
  await t.test("review reuses command report", () => {
    const manifest = clone(FIXTURE.manifest);
    const record = firstRecord(manifest);
    record.review.report = clone(record.commands[0].result.report);
    assertCode("review-report-not-independent", () => validate({ manifest }));
  });
  await t.test("review uses a distinct path with identical report bytes", () => {
    const manifest = clone(FIXTURE.manifest);
    const record = firstRecord(manifest);
    record.review.report = {
      path: "evidence/command-report-1-copy.json",
      sha256: record.commands[0].result.report.sha256,
    };
    assertCode("review-report-not-independent", () => validate({ manifest }));
  });
  await t.test("review omits fallback mode", () => {
    const manifest = clone(FIXTURE.manifest);
    delete firstRecord(manifest).review.fallback_mode;
    assertCode("missing-field", () => validate({ manifest }));
  });
});

test("canonical record hash makes otherwise valid record mutation visible", () => {
  const manifest = clone(FIXTURE.manifest);
  firstRecord(manifest).producer_id = "different:producer";
  assertCode("record-digest-mismatch", () => validate({ manifest }));
});

test("coverage mapping is part of the canonical record digest", () => {
  const manifest = clone(FIXTURE.manifest);
  const record = manifest.candidates[0].task_records.find(
    ({ task_id: taskId }) => taskId === "PATTERN-01-RESEARCH",
  );
  assert.ok(record);
  assert.equal(record.coverage.artifacts.length, 2);
  record.coverage.artifacts[0].artifact_indexes.push(1);
  assertCode("record-digest-mismatch", () => validate({ manifest }));
});

test("unknown structural fields fail closed at every layer", async (t) => {
  const mutations = [
    ["manifest", (manifest) => (manifest.allow_historical_status = true)],
    ["candidate", (manifest) => (manifest.candidates[0].dirty_tree_ok = true)],
    ["record", (manifest) => (firstRecord(manifest).waive_digest = true)],
    [
      "command",
      (manifest) => (firstRecord(manifest).commands[0].shell = true),
    ],
    [
      "review",
      (manifest) => (firstRecord(manifest).review.self_attested = true),
    ],
    [
      "coverage",
      (manifest) => (firstRecord(manifest).coverage.allow_echo = true),
    ],
  ];
  for (const [label, mutate] of mutations) {
    await t.test(label, () => {
      const manifest = clone(FIXTURE.manifest);
      mutate(manifest);
      assertCode("unknown-field", () => validate({ manifest }));
    });
  }
});

test("prototype-bearing JSON-shaped objects fail before digesting", () => {
  const manifest = clone(EMPTY_MANIFEST);
  Object.setPrototypeOf(manifest, { polluted: true });
  assertCode("invalid-shape", () => validate({ manifest }));
  assert.equal(Object.prototype.polluted, undefined);
});

test("canonical source, root, cutoff, and policy declarations cannot drift", async (t) => {
  await t.test("source", () => {
    const manifest = clone(EMPTY_MANIFEST);
    manifest.sources.registry = "other-registry.json";
    assertCode("source-declaration-drift", () => validate({ manifest }));
  });
  await t.test("root", () => {
    const manifest = clone(EMPTY_MANIFEST);
    manifest.root_task_id = "D21-RELEASE-067";
    assertCode("release-root-drift", () => validate({ manifest }));
  });
  await t.test("cutoff", () => {
    const manifest = clone(EMPTY_MANIFEST);
    manifest.historical_cutoff = "2026-07-26T00:00:00Z";
    assertCode("historical-cutoff-drift", () => validate({ manifest }));
  });
  await t.test("policy", () => {
    const manifest = clone(EMPTY_MANIFEST);
    manifest.policy.missing_task_record_weight = 1;
    assertCode("evidence-policy-drift", () => validate({ manifest }));
  });
  await t.test("policy field", () => {
    const manifest = clone(EMPTY_MANIFEST);
    manifest.policy.allow_waiver = true;
    assertCode("unknown-field", () => validate({ manifest }));
  });
  assert.deepEqual(EMPTY_MANIFEST.sources, CANONICAL_SOURCES);
  assert.deepEqual(EMPTY_MANIFEST.policy, EVIDENCE_POLICY);
  assert.equal(EMPTY_MANIFEST.historical_cutoff, HISTORICAL_CUTOFF);
});

test("duplicate candidate SHA fails closed", () => {
  const manifest = clone(FIXTURE.manifest);
  manifest.candidates.push(clone(manifest.candidates[0]));
  assertCode("duplicate-candidate", () => validate({ manifest }));
});

test("a record for the release root cannot masquerade as ancestor evidence", () => {
  const manifest = clone(FIXTURE.manifest);
  const record = clone(firstRecord(manifest));
  record.record_id = "synthetic:release-root";
  record.task_id = RELEASE_ROOT_TASK_ID;
  refreshRecord(record);
  manifest.candidates[0].task_records.push(record);
  assertCode("record-for-non-ancestor", () => validate({ manifest }));
});
