import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_RELEASE_LEAF_COUNT,
  ReleaseTaskMapError,
  extractChecklistReleaseLeaves,
  validateReleaseTaskMap,
} from "../check-release-task-map.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CHECKLIST = fs.readFileSync(
  path.join(ROOT, "codex_plans/delivery/release-checklist.md"),
  "utf8",
);
const REGISTRY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "codex_logs/task-registry.json"), "utf8"),
);
const MANIFEST = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "codex_plans/delivery/release-task-map.json"),
    "utf8",
  ),
);

// This independently reviewed table freezes the whole-requirement producer for
// every release leaf. Structural validation alone cannot tell whether a task
// implements one noun from a checklist sentence or proves the complete join.
const SEMANTIC_BINDING_GROUPS = Object.freeze([
  ["CTRL-ACCEPTANCE-070", Object.freeze(["REL-V1-01", "REL-V1-02", "REL-V1-03", "REL-I02", "REL-I03", "REL-I04", "REL-I05", "REL-I07", "REL-X06", "REL-X10", "REL-T05", "REL-T11", "REL-T15", "REL-T27", "REL-Q01", "REL-Q02", "REL-Q03"])],
  ["CTRL-DOCS-073", Object.freeze(["REL-DOC05", "REL-DOC10"])],
  ["CTRL-GROWTH-072", Object.freeze(["REL-UX09", "REL-DOC12", "REL-DOC14", "REL-GR01", "REL-GR02", "REL-GR03", "REL-GR04", "REL-GR05", "REL-GR06", "REL-GR07"])],
  ["CTRL-PATTERNS-071", Object.freeze(["REL-T31", "REL-PAT00"])],
  ["CTRL-RELEASE-ROLLUP-086", Object.freeze(["REL-V1-06", "REL-V1-07", "REL-V1-08", "REL-I10", "REL-DOC16", "REL-RC01", "REL-RC02", "REL-RC03", "REL-RC04", "REL-RC05", "REL-RC09"])],
  ["D10-BUDGET-CONFORMANCE-038", Object.freeze(["REL-T18"])],
  ["D11-VERIFY-CONFORMANCE-043", Object.freeze(["REL-I09", "REL-T16"])],
  ["D12-ISOLATION-REDTEAM-047", Object.freeze(["REL-T09", "REL-T23", "REL-T24"])],
  ["D13-ADAPTERS-049", Object.freeze(["REL-T25", "REL-Q06"])],
  ["D13-DX-051", Object.freeze(["REL-DOC09"])],
  ["D14-NPM-DIST-078", Object.freeze(["REL-PKG02"])],
  ["D15-EXPLORER-060", Object.freeze(["REL-DOC03", "REL-DOC11"])],
  ["D15-PERFORMANCE-061", Object.freeze(["REL-Q07", "REL-DOC07"])],
  ["D15-STORAGE-WORKERS-054", Object.freeze(["REL-T30"])],
  ["D16-PRIVACY-079", Object.freeze(["REL-I06"])],
  ["D16-SECURITY-062", Object.freeze(["REL-I08", "REL-T28", "REL-Q08", "REL-SC08", "REL-SC09", "REL-SC10", "REL-SC11", "REL-SC12"])],
  ["D17-USABILITY-076", Object.freeze(["REL-V1-05", "REL-Q10", "REL-Q11", "REL-UX01", "REL-UX02", "REL-UX03", "REL-UX04", "REL-UX05", "REL-UX06", "REL-UX07", "REL-UX08", "REL-UX10"])],
  ["D18-COMPAT-BENCH-064", Object.freeze(["REL-I01", "REL-X02", "REL-X07", "REL-X09", "REL-T10", "REL-T32", "REL-T33", "REL-Q04", "REL-MX-X01", "REL-MX-X02"])],
  ["D18-EDUCATION-ASSETS-083", Object.freeze(["REL-DOC01", "REL-DOC02", "REL-DOC04", "REL-DOC06", "REL-DOC08", "REL-DOC13"])],
  ["D18-SUPPORT-READINESS-080", Object.freeze(["REL-T26", "REL-SUP01", "REL-SUP02", "REL-SUP03", "REL-SUP04", "REL-SUP05", "REL-SUP06", "REL-SUP07", "REL-SUP08", "REL-RC07", "REL-RC08", "REL-RC10"])],
  ["D19-RC-065", Object.freeze(["REL-T29", "REL-Q05", "REL-MX-N01", "REL-MX-N02", "REL-MX-N03", "REL-MX-N04", "REL-MX-N05", "REL-MX-N06", "REL-MX-P01", "REL-MX-P02", "REL-MX-P03", "REL-MX-P04", "REL-MX-P05", "REL-MX-P06", "REL-MX-P07", "REL-MX-P08", "REL-MX-P09", "REL-PKG04", "REL-PKG05", "REL-PKG06", "REL-PKG07", "REL-PKG08", "REL-PKG09", "REL-PKG10", "REL-PKG11", "REL-PKG12", "REL-DOC15"])],
  ["D2-BUILDERS-YAML-020", Object.freeze(["REL-X01", "REL-T01", "REL-T02", "REL-T03", "REL-T04", "REL-T06"])],
  ["D20-PROVENANCE-066", Object.freeze(["REL-V1-04", "REL-Q09", "REL-PKG01", "REL-PKG03", "REL-PKG13", "REL-SC01", "REL-SC02", "REL-SC03", "REL-SC04", "REL-SC05", "REL-SC06", "REL-SC07", "REL-SC13", "REL-SC14", "REL-RC06"])],
  ["D6-ROUTER-BARRIER-023", Object.freeze(["REL-X04", "REL-T07", "REL-T13"])],
  ["D7-CYCLE-CONFORMANCE-027", Object.freeze(["REL-T08", "REL-T17"])],
  ["D7-PIPELINE-CONFORMANCE-013", Object.freeze(["REL-T12"])],
  ["D9-DURABLE-EXT-CONFORMANCE-034", Object.freeze(["REL-X03", "REL-X05", "REL-X08", "REL-T14", "REL-T19", "REL-T20", "REL-T21", "REL-T22"])],
  ["PATTERN-01-RESEARCH", Object.freeze(["REL-PAT01"])],
  ["PATTERN-02-CITED", Object.freeze(["REL-PAT02"])],
  ["PATTERN-03-AUTH", Object.freeze(["REL-PAT03"])],
  ["PATTERN-04-DIFF", Object.freeze(["REL-PAT04"])],
  ["PATTERN-05-UNTIL-DRY", Object.freeze(["REL-PAT05"])],
  ["PATTERN-06-MIGRATION", Object.freeze(["REL-PAT06"])],
  ["PATTERN-07-CI", Object.freeze(["REL-PAT07"])],
  ["PATTERN-08-DEPS", Object.freeze(["REL-PAT08"])],
  ["PATTERN-09-PR", Object.freeze(["REL-PAT09"])],
  ["PATTERN-10-ECOSYSTEM", Object.freeze(["REL-PAT10"])],
]);

function clone(value) {
  return structuredClone(value);
}

function assertCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof ReleaseTaskMapError);
    assert.equal(error.code, code);
    return true;
  });
}

function validate({
  checklistText = CHECKLIST,
  registry = REGISTRY,
  manifest = MANIFEST,
} = {}) {
  return validateReleaseTaskMap({ checklistText, registry, manifest });
}

function taskById(registry, taskId) {
  const task = registry.tasks.find(({ id }) => id === taskId);
  assert.ok(task, `missing registry task ${taskId}`);
  return task;
}

function assertSemanticBindings(manifest) {
  const expected = new Map();
  for (const [taskId, releaseIds] of SEMANTIC_BINDING_GROUPS) {
    for (const releaseId of releaseIds) {
      assert.ok(!expected.has(releaseId), `duplicate semantic binding for ${releaseId}`);
      expected.set(releaseId, taskId);
    }
  }
  assert.equal(expected.size, CANONICAL_RELEASE_LEAF_COUNT);

  const actual = new Map();
  for (const { release_id: releaseId, task_id: taskId } of manifest.mappings) {
    assert.ok(!actual.has(releaseId), `duplicate manifest binding for ${releaseId}`);
    actual.set(releaseId, taskId);
  }
  assert.equal(actual.size, expected.size);
  for (const [releaseId, taskId] of expected) {
    assert.equal(
      actual.get(releaseId),
      taskId,
      `${releaseId} must bind to the complete producer ${taskId}`,
    );
  }
}

function assertSemanticTaskPlans(registry) {
  const requirements = {
    "D2-BUILDERS-YAML-020": {
      tests: [
        "builder hash parity",
        "missing duplicate unreachable endpoint port and implicit-cycle",
        "canonical graph node edge and schema bytes and stable hashes",
      ],
    },
    "D4-TRACE-SUBGRAPH-022": {
      dependencies: [
        "D2-BUILDERS-YAML-020",
        "D3-TS-RUNTIME-002",
        "D3-PY-RUNTIME-002",
        "D6-DURABLE-SPEC-010",
        "D7-PIPELINE-CONFORMANCE-013",
      ],
      artifacts: ["subgraph-and-edge-semantics.md", "subgraph-edge.case.json"],
      tests: ["subgraph reducer artifact-ref and stream-edge parity"],
    },
    "D7-CYCLE-SPEC-024": {
      dependencies: ["D2-BUILDERS-YAML-020"],
      tests: ["malicious patch rejection"],
    },
    "D6-ROUTER-BARRIER-023": {
      tests: [
        "all minimum percentage quorum and deadline barrier settlement parity",
        "incomplete single and multicast routers",
      ],
    },
    "D7-CYCLE-CONFORMANCE-027": {
      tests: [
        "seen-set parity",
        "missing and unsafe loop bounds reject",
        "duplicate and discovery ordering produces deterministic global seen-set",
      ],
    },
    "D7-PIPELINE-CONFORMANCE-013": {
      tests: ["shared trace and terminal projection parity", "adversarial cancellation and cleanup"],
    },
    "D9-DURABLE-EXT-SPEC-031": {
      dependencies: ["D9-APPROVAL-077", "D9-REDACTION-CONFORMANCE-089"],
      tests: ["stale approval", "non-idempotent confirmation"],
    },
    "D9-DURABLE-EXT-CONFORMANCE-034": {
      dependencies: ["D6-ROUTER-BARRIER-023", "D9-APPROVAL-077"],
      tests: [
        "router replay without rejudgment",
        "stale approval binding",
        "single and multicast route decisions",
        "event ordering constraints and terminal-history envelopes",
      ],
    },
    "D10-BUDGET-CONFORMANCE-038": {
      dependencies: ["D7-CYCLE-CONFORMANCE-027"],
      artifacts: ["hard-budget-matrix.json"],
      tests: ["iteration duration cost node fan-out and attempt bounds"],
    },
    "D11-VERIFY-CONFORMANCE-043": {
      tests: ["abstention and unknown", "all votes original evidence rubric versions"],
    },
    "D12-ISOLATION-REDTEAM-047": {
      tests: [
        "unauthorized deterministic or model transforms",
        "worktree lease allowed and denied paths test gates",
        "port/process/container escape",
        "concurrent process and container port temp cache database namespace isolation",
      ],
    },
    "D13-ADAPTERS-049": {
      tests: [
        "fallback cancellation and redaction parity",
        "normal CI uses only deterministic mock providers",
      ],
    },
    "D13-DX-051": {
      tests: ["deterministic G0-G4 score", "top-three remediation"],
    },
    "D14-NPM-DIST-078": {
      dependencies: ["D14-API-FREEZE-050", "D3-CLI-002"],
      tests: ["clean tarball install on Node 20 and 22", "graph and grapheng binaries work"],
    },
    "D15-STORAGE-WORKERS-054": {
      tests: ["Event Checkpoint Artifact and Lock interfaces plus SQLite PostgreSQL and S3"],
    },
    "D15-EXPLORER-060": {
      tests: [
        "interactive linear-versus-graph comparison uses real topology and events",
        "topology state budget critical-path utilization barrier-wait retry verdict",
      ],
    },
    "D15-PERFORMANCE-061": {
      tests: ["10 percent regression gate", "performance and recovery benchmarks retain versioned inputs"],
    },
    "D16-PRIVACY-079": {
      dependencies: ["D9-REDACTION-CONFORMANCE-089"],
      tests: [
        "telemetry and capture default off",
        "PII canary",
        "enabled prompt and response capture is redacted before every sink",
      ],
    },
    "D16-SECURITY-062": {
      artifacts: ["authority-boundary-matrix.json"],
      tests: [
        "planner prompt tool shell write network secret and MCP mutation authority expansion",
        "production dependency license static-analysis and threat-model reports",
        "parser schema redaction capability and prompt-injection fuzz corpora",
      ],
    },
    "D17-BETA-063": {
      dependencies: ["D13-DX-051"],
      tests: ["complete Beta API and quickstart"],
    },
    "D17-USABILITY-076": {
      dependencies: ["D17-BETA-063", "D16-PRIVACY-079"],
      artifacts: ["cohort-results.json", "independent-review.json"],
      tests: [
        "at least five authentic external reports",
        "at least 80 percent finish in 300 seconds",
        "canonical Quickstart uses no more than three commands",
        "no provider account credential network dependency or telemetry opt-in",
        "more than one OS and both TypeScript and Python",
        "independent reviewer verifies report authenticity",
      ],
    },
    "D18-COMPAT-BENCH-064": {
      dependencies: ["D9-OPS-CONTROL-085", "D13-DX-051"],
      artifacts: [
        "cross-language-conformance.json",
        "source-cli-parity.json",
        "os-behavior-matrix.json",
        "chaos-resource-report.json",
      ],
      tests: [
        "full source CLI golden JSON",
        "exit-code matrix",
        "complete positive and negative compiler corpus",
        "kill network store and artifact chaos",
        "bidirectional interop runs on Linux macOS and Windows",
        "100-way parallel run reports configured concurrency utilization",
        "1000-node compiler scheduler and worker run",
      ],
    },
    "D19-RC-065": {
      dependencies: [
        "D14-NPM-DIST-078",
        "D18-COMPAT-BENCH-064",
        "D18-SUPPORT-READINESS-080",
      ],
      artifacts: [
        "installed-runtime-matrix.json",
        "package-executable-matrix.json",
        "installed-cli-matrix.json",
        "version-identity-audit.json",
        "reference-surface-audit.json",
      ],
      tests: [
        "npm tarball and Python wheel/sdist graph and grapheng",
        "full installed CLI command JSON",
        "Linux macOS Windows clean installed-artifact matrix",
        "every Node matrix cell performs packed install build typecheck",
        "every Python matrix cell performs wheel install unit integration Ruff mypy",
        "package Graph IR API tag documentation and generated-asset versions",
        "API CLI MCP extension provider store upgrade security and support references",
        "npm and Python prerelease to RC to candidate upgrades preserve configuration",
      ],
    },
    "D20-PROVENANCE-066": {
      dependencies: ["D19-RC-065", "D16-SECURITY-062"],
      artifacts: [
        "registry-namespace-audit.json",
        "installed-default-off-observation.json",
        "package-content-manifests.json",
        "full-secret-scan.json",
        "prerelease-invalidation-rebuild.json",
      ],
      tests: [
        "npm and PyPI canonical names aliases owners",
        "telemetry and prompt-response capture off",
        "npm tarballs and Python wheel and sdist contain only intended runtime files",
        "repository history packages source maps documentation traces and support bundles",
        "two clean trusted-runner artifact manifests",
        "last verified prerelease remains available",
      ],
    },
    "CTRL-ACCEPTANCE-070": {
      dependencies: ["D19-RC-065", "D20-PROVENANCE-066", "D8-CHAOS-OPS-030"],
      artifacts: [
        "cross-cutting-invariants.json",
        "durable-recovery-join.json",
        "security-candidate-join.json",
        "cross-language-x01-x10.json",
        "adapter-storage-conformance.json",
        "structured-failure-policies.json",
      ],
      tests: [
        "implicit-cycle rejection bounded retry dynamic fan-out caps",
        "at-least-once documentation idempotency authority-bound approval and explicit compensation",
        "dynamic GraphPatch compiler policy permission and budget caps",
        "final candidate security join covers T09 T15 T23 through T28 Q08",
        "all X01 through X10 cross-language rows",
        "structured terminal failures are never replaced by null",
        "one shared adapter and Event Checkpoint Artifact Lock",
        "compiler scheduler event store and policy each meet 90 percent statement",
      ],
    },
    "CTRL-GROWTH-072": {
      dependencies: [
        "D16-SECURITY-062",
        "D16-PRIVACY-079",
        "D17-BETA-063",
        "D17-USABILITY-076",
        "D18-EDUCATION-ASSETS-083",
      ],
      artifacts: ["gallery-consent-and-authenticity.json"],
      tests: [
        "authentic consented redacted and withdrawable",
        "organic-conduct audit rejects paid stars",
        "Alpha recovery verifier Explorer Beta RC security and release content beats",
        "visits stars installs runs and retention signals",
        "contributor governance security-reporting",
      ],
    },
    "CTRL-DOCS-073": {
      tests: [
        "architecture essay claim-to-spec review",
        "pattern picker anti-pattern failure-mode operations and safety guide manifest",
      ],
    },
    "CTRL-PATTERNS-071": {
      artifacts: ["manifest.schema.json", "patterns.json"],
      tests: ["bundle schema checker validates all ten manifests"],
    },
    "D18-EDUCATION-ASSETS-083": {
      dependencies: ["D17-USABILITY-076", "D18-COMPAT-BENCH-064"],
      artifacts: ["quickstart/manifest.json", "ts-python-conformance.json"],
      tests: [
        "four authentic cases including failure",
        "claim version bilingual",
        "60-second mock-first English and Chinese Quickstart",
        "side-by-side TypeScript and Python examples",
      ],
    },
    "D18-SUPPORT-READINESS-080": {
      dependencies: ["D16-SECURITY-062", "D18-COMPAT-BENCH-064"],
      artifacts: [
        "recovery-side-effect-fallback.json",
        "support-bundle-redaction.json",
        "continuing-rc-operation.json",
      ],
      tests: [
        "irreversible external-effect recovery never claims rollback",
        "explicit compensation success and failure",
        "release notes cover known limits supported matrices",
        "RC support disclosure security response blocker cadence",
      ],
    },
    "CTRL-RELEASE-ROLLUP-086": {
      dependencies: [
        "D20-PROVENANCE-066",
        "CTRL-ACCEPTANCE-070",
        "CTRL-DOCS-073",
        "CTRL-GROWTH-072",
        "D18-SUPPORT-READINESS-080",
      ],
      artifacts: [
        "claims-audit.json",
        "release-asset-manifest.json",
        "surface-identity-and-known-limits.json",
        "rc-channel-protection.json",
      ],
      tests: [
        "unsupported battle-tested production-proven or exactly-once claims",
        "Open Partial and Blocked mandatory rows each force stable-v1 no-go",
        "all planned Day-21 assets and a supportable complete Beta or RC",
        "fallback package tags version strings site docs and channel copy",
        "site release notes changelog package READMEs draft GitHub Release",
        "any non-Green stable gate prevents stable npm and PyPI tags",
      ],
    },
  };

  for (const [taskId] of SEMANTIC_BINDING_GROUPS) {
    if (taskId.startsWith("PATTERN-")) {
      requirements[taskId] = {
        artifacts: ["manifest.json"],
        tests: ["PB manifest includes"],
      };
    }
  }

  const mappedTaskIds = new Set(MANIFEST.mappings.map(({ task_id: taskId }) => taskId));
  for (const taskId of mappedTaskIds) {
    assert.ok(
      Object.hasOwn(requirements, taskId),
      `semantic evidence contract is missing for mapped producer ${taskId}`,
    );
  }

  for (const [taskId, requirement] of Object.entries(requirements)) {
    const task = taskById(registry, taskId);
    for (const dependency of requirement.dependencies ?? []) {
      assert.ok(
        task.depends_on.includes(dependency),
        `${taskId} must depend directly on ${dependency}`,
      );
    }
    for (const artifact of requirement.artifacts ?? []) {
      assert.ok(
        task.expected_artifacts.some((value) => value.includes(artifact)),
        `${taskId} must plan artifact ${artifact}`,
      );
    }
    for (const expectedTest of requirement.tests ?? []) {
      assert.ok(
        task.expected_tests.some((value) => value.includes(expectedTest)),
        `${taskId} must plan test ${expectedTest}`,
      );
    }
  }
}

function mutateChecklistRow(gate, mutate) {
  const lines = CHECKLIST.split(/\r?\n/u);
  const lineIndex = lines.findIndex((line) => line.startsWith(`| \`${gate}\` |`));
  assert.notEqual(lineIndex, -1, `missing checklist row ${gate}`);
  const cells = lines[lineIndex]
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
  mutate(cells);
  lines[lineIndex] = `| ${cells.join(" | ")} |`;
  return lines.join("\n");
}

test("canonical checklist contains 178 exact unique release leaf cells", () => {
  const leaves = extractChecklistReleaseLeaves(CHECKLIST);
  assert.equal(leaves.length, CANONICAL_RELEASE_LEAF_COUNT);
  assert.equal(new Set(leaves.map(({ id }) => id)).size, leaves.length);
});

test("canonical map covers every leaf once with explicit classification", () => {
  const summary = validate();
  assert.deepEqual(
    {
      releaseLeafCount: summary.releaseLeafCount,
      mappingCount: summary.mappingCount,
      blockingCount: summary.blockingCount,
      nonBlockingCount: summary.nonBlockingCount,
      registryTaskCount: summary.registryTaskCount,
    },
    {
    releaseLeafCount: 178,
    mappingCount: 178,
    blockingCount: 175,
    nonBlockingCount: 3,
    registryTaskCount: REGISTRY.tasks.length,
    },
  );
  const expectedProducerCount = new Set(
    MANIFEST.mappings
      .filter(({ blocking }) => blocking)
      .map(({ task_id }) => task_id),
  ).size;
  assert.equal(summary.blockingProducerCount, expectedProducerCount);
  assert.ok(summary.rollupAncestorCount >= summary.blockingProducerCount);
});

test("all 178 leaves retain the independently reviewed whole-requirement producer", () => {
  assertSemanticBindings(MANIFEST);
});

test("current checklist keeps every release leaf Open", () => {
  const statusCells = CHECKLIST.split(/\r?\n/u)
    .filter((line) => /^\| `(?:V1-|I|X|T|Q|MX-|PKG|SC|UX|PB|P\d|DOC|GR|SUP|RC)/u.test(line))
    .map((line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim())[4]);
  assert.equal(statusCells.length, CANONICAL_RELEASE_LEAF_COUNT);
  assert.ok(statusCells.every((status) => status === "Open" || status.startsWith("Open;")));
});

test("partial-producer substitutions fail the semantic binding audit", () => {
  for (const [releaseId, partialTaskId] of [
    ["REL-V1-02", "D16-SECURITY-062"],
    ["REL-X02", "D2-BUILDERS-YAML-020"],
    ["REL-SC07", "D16-SECURITY-062"],
    ["REL-DOC16", "D19-RC-065"],
    ["REL-RC03", "D19-RC-065"],
  ]) {
    const manifest = clone(MANIFEST);
    manifest.mappings.find(({ release_id: id }) => id === releaseId).task_id = partialTaskId;
    assert.throws(() => assertSemanticBindings(manifest), {
      name: "AssertionError",
    });
  }
});

test("the pre-remediation 42-producer and 34-test completion cannot impersonate the semantic map", () => {
  const task = taskById(REGISTRY, "CTRL-RELEASE-MAP-074");
  const latest = new Map();
  for (const [index, record] of (task.test_evidence ?? []).entries()) {
    const prior = latest.get(record.requirement);
    const coordinate = [record.recorded_at, index];
    if (!prior || coordinate[0] > prior.coordinate[0] ||
        (coordinate[0] === prior.coordinate[0] && coordinate[1] > prior.coordinate[1])) {
      latest.set(record.requirement, { coordinate, record });
    }
  }

  if (task.status === "completed") {
    for (const requirement of task.expected_tests) {
      const record = latest.get(requirement)?.record;
      assert.equal(record?.result, "passed", `${requirement} needs superseding evidence`);
      assert.doesNotMatch(record.reference, /(?:34\/34|42 blocking producers)/u);
    }
    assert.ok(
      task.completion_evidence.some((value) => value.includes("semantic-independent")),
      "completed semantic map needs the superseding independent review",
    );
  } else {
    assert.equal(task.status, "in_progress");
    for (const requirement of task.expected_tests.slice(0, 4)) {
      assert.notEqual(latest.get(requirement)?.record.result, "passed");
    }
    assert.notEqual(latest.get(task.expected_tests[4])?.record.result, "passed");
  }
});

test("cross-cutting leaves bind to the task that can prove the whole requirement", () => {
  const taskFor = (releaseId) =>
    MANIFEST.mappings.find(({ release_id }) => release_id === releaseId).task_id;
  assert.deepEqual(
    {
      "REL-V1-06": taskFor("REL-V1-06"),
      "REL-V1-07": taskFor("REL-V1-07"),
      "REL-V1-01": taskFor("REL-V1-01"),
      "REL-V1-02": taskFor("REL-V1-02"),
      "REL-I01": taskFor("REL-I01"),
      "REL-I02": taskFor("REL-I02"),
      "REL-I03": taskFor("REL-I03"),
      "REL-I04": taskFor("REL-I04"),
      "REL-I05": taskFor("REL-I05"),
      "REL-I07": taskFor("REL-I07"),
      "REL-I08": taskFor("REL-I08"),
      "REL-I10": taskFor("REL-I10"),
      "REL-X02": taskFor("REL-X02"),
      "REL-X06": taskFor("REL-X06"),
      "REL-X07": taskFor("REL-X07"),
      "REL-X09": taskFor("REL-X09"),
      "REL-X10": taskFor("REL-X10"),
      "REL-T05": taskFor("REL-T05"),
      "REL-T11": taskFor("REL-T11"),
      "REL-T15": taskFor("REL-T15"),
      "REL-T18": taskFor("REL-T18"),
      "REL-T22": taskFor("REL-T22"),
      "REL-T26": taskFor("REL-T26"),
      "REL-T27": taskFor("REL-T27"),
      "REL-T28": taskFor("REL-T28"),
      "REL-T29": taskFor("REL-T29"),
      "REL-Q03": taskFor("REL-Q03"),
      "REL-Q04": taskFor("REL-Q04"),
      "REL-Q05": taskFor("REL-Q05"),
      "REL-PKG05": taskFor("REL-PKG05"),
      "REL-PKG09": taskFor("REL-PKG09"),
      "REL-PKG10": taskFor("REL-PKG10"),
      "REL-PKG12": taskFor("REL-PKG12"),
      "REL-PKG13": taskFor("REL-PKG13"),
      "REL-SC13": taskFor("REL-SC13"),
      "REL-UX09": taskFor("REL-UX09"),
      "REL-DOC12": taskFor("REL-DOC12"),
      "REL-DOC15": taskFor("REL-DOC15"),
      "REL-DOC16": taskFor("REL-DOC16"),
      "REL-SC07": taskFor("REL-SC07"),
      "REL-SC12": taskFor("REL-SC12"),
      "REL-RC05": taskFor("REL-RC05"),
      "REL-RC03": taskFor("REL-RC03"),
      "REL-RC08": taskFor("REL-RC08"),
    },
    {
      "REL-V1-06": "CTRL-RELEASE-ROLLUP-086",
      "REL-V1-07": "CTRL-RELEASE-ROLLUP-086",
      "REL-V1-01": "CTRL-ACCEPTANCE-070",
      "REL-V1-02": "CTRL-ACCEPTANCE-070",
      "REL-I01": "D18-COMPAT-BENCH-064",
      "REL-I02": "CTRL-ACCEPTANCE-070",
      "REL-I03": "CTRL-ACCEPTANCE-070",
      "REL-I04": "CTRL-ACCEPTANCE-070",
      "REL-I05": "CTRL-ACCEPTANCE-070",
      "REL-I07": "CTRL-ACCEPTANCE-070",
      "REL-I08": "D16-SECURITY-062",
      "REL-I10": "CTRL-RELEASE-ROLLUP-086",
      "REL-X02": "D18-COMPAT-BENCH-064",
      "REL-X06": "CTRL-ACCEPTANCE-070",
      "REL-X07": "D18-COMPAT-BENCH-064",
      "REL-X09": "D18-COMPAT-BENCH-064",
      "REL-X10": "CTRL-ACCEPTANCE-070",
      "REL-T05": "CTRL-ACCEPTANCE-070",
      "REL-T11": "CTRL-ACCEPTANCE-070",
      "REL-T15": "CTRL-ACCEPTANCE-070",
      "REL-T18": "D10-BUDGET-CONFORMANCE-038",
      "REL-T22": "D9-DURABLE-EXT-CONFORMANCE-034",
      "REL-T26": "D18-SUPPORT-READINESS-080",
      "REL-T27": "CTRL-ACCEPTANCE-070",
      "REL-T28": "D16-SECURITY-062",
      "REL-T29": "D19-RC-065",
      "REL-Q03": "CTRL-ACCEPTANCE-070",
      "REL-Q04": "D18-COMPAT-BENCH-064",
      "REL-Q05": "D19-RC-065",
      "REL-PKG05": "D19-RC-065",
      "REL-PKG09": "D19-RC-065",
      "REL-PKG10": "D19-RC-065",
      "REL-PKG12": "D19-RC-065",
      "REL-PKG13": "D20-PROVENANCE-066",
      "REL-SC13": "D20-PROVENANCE-066",
      "REL-UX09": "CTRL-GROWTH-072",
      "REL-DOC12": "CTRL-GROWTH-072",
      "REL-DOC15": "D19-RC-065",
      "REL-DOC16": "CTRL-RELEASE-ROLLUP-086",
      "REL-SC07": "D20-PROVENANCE-066",
      "REL-SC12": "D16-SECURITY-062",
      "REL-RC05": "CTRL-RELEASE-ROLLUP-086",
      "REL-RC03": "CTRL-RELEASE-ROLLUP-086",
      "REL-RC08": "D18-SUPPORT-READINESS-080",
    },
  );
});

test("semantic joins retain their complete dependency and evidence contracts", () => {
  assertSemanticTaskPlans(REGISTRY);
});

test("semantic join dependency or evidence removal is detected", () => {
  const missingGraphIrFreeze = clone(REGISTRY);
  taskById(missingGraphIrFreeze, "D7-CYCLE-SPEC-024").depends_on = [
    "D1-SPEC-001",
  ];
  assert.throws(() => assertSemanticTaskPlans(missingGraphIrFreeze));

  const missingRouterReplayProducer = clone(REGISTRY);
  taskById(
    missingRouterReplayProducer,
    "D9-DURABLE-EXT-CONFORMANCE-034",
  ).depends_on = ["D9-APPROVAL-077"];
  assert.throws(() => assertSemanticTaskPlans(missingRouterReplayProducer));

  const missingCliJoin = clone(REGISTRY);
  taskById(missingCliJoin, "D18-COMPAT-BENCH-064").depends_on = ["D17-BETA-063"];
  assert.throws(() => assertSemanticTaskPlans(missingCliJoin));

  const missingInstalledPython = clone(REGISTRY);
  taskById(missingInstalledPython, "D19-RC-065").expected_tests = [
    "clean npm install only",
  ];
  assert.throws(() => assertSemanticTaskPlans(missingInstalledPython));

  const missingCompensation = clone(REGISTRY);
  taskById(missingCompensation, "D18-SUPPORT-READINESS-080").expected_tests = [
    "approval contract only",
  ];
  assert.throws(() => assertSemanticTaskPlans(missingCompensation));

  const missingFinalSecurityAndProvenanceJoin = clone(REGISTRY);
  taskById(
    missingFinalSecurityAndProvenanceJoin,
    "CTRL-ACCEPTANCE-070",
  ).depends_on = taskById(
    missingFinalSecurityAndProvenanceJoin,
    "CTRL-ACCEPTANCE-070",
  ).depends_on.filter((id) => id !== "D20-PROVENANCE-066");
  assert.throws(() => assertSemanticTaskPlans(missingFinalSecurityAndProvenanceJoin));

  const missingFullSecretScan = clone(REGISTRY);
  taskById(missingFullSecretScan, "D20-PROVENANCE-066").expected_artifacts = [
    "codex_logs/release-evidence/provenance",
  ];
  assert.throws(() => assertSemanticTaskPlans(missingFullSecretScan));

  const missingFinalSurfaceIdentity = clone(REGISTRY);
  taskById(
    missingFinalSurfaceIdentity,
    "CTRL-RELEASE-ROLLUP-086",
  ).expected_tests = ["generic claim audit"];
  assert.throws(() => assertSemanticTaskPlans(missingFinalSurfaceIdentity));

  const missingFinalCompilerCorpus = clone(REGISTRY);
  taskById(missingFinalCompilerCorpus, "D18-COMPAT-BENCH-064").expected_tests = [
    "base compiler only",
  ];
  assert.throws(() => assertSemanticTaskPlans(missingFinalCompilerCorpus));
});

test("duplicate release mappings fail closed", () => {
  const manifest = clone(MANIFEST);
  manifest.mappings.push(clone(manifest.mappings[0]));
  assertCode("duplicate-release-mapping", () => validate({ manifest }));
});

test("a dangling mapped task fails closed", () => {
  const manifest = clone(MANIFEST);
  manifest.mappings[0].task_id = "DOES-NOT-EXIST";
  assertCode("dangling-task-mapping", () => validate({ manifest }));
});

test("an unknown release leaf fails closed", () => {
  const manifest = clone(MANIFEST);
  manifest.mappings[0].release_id = "REL-UNKNOWN-999";
  assertCode("unknown-release-leaf", () => validate({ manifest }));
});

test("an uncovered release leaf fails closed", () => {
  const manifest = clone(MANIFEST);
  manifest.mappings.pop();
  assertCode("unmapped-release-leaves", () => validate({ manifest }));
});

test("missing blocking boolean fails closed", () => {
  const manifest = clone(MANIFEST);
  delete manifest.mappings[0].blocking;
  assertCode("missing-blocking-classification", () => validate({ manifest }));
});

test("mandatory leaf cannot be downgraded to non-blocking", () => {
  const manifest = clone(MANIFEST);
  const mapping = manifest.mappings.find(
    ({ release_id }) => release_id === "REL-V1-01",
  );
  mapping.blocking = false;
  assertCode("incorrect-blocking-classification", () => validate({ manifest }));
});

test("tracking leaf cannot be upgraded into the stable blocking set", () => {
  const manifest = clone(MANIFEST);
  const mapping = manifest.mappings.find(
    ({ release_id }) => release_id === "REL-GR03",
  );
  mapping.blocking = true;
  assertCode("incorrect-blocking-classification", () => validate({ manifest }));
});

test("checklist text cannot label a mandatory leaf non-blocking", () => {
  const checklistText = mutateChecklistRow("GR01", (cells) => {
    cells[1] = "**Tracking, non-blocking:** synthetic downgrade";
  });
  assertCode("checklist-classification-mismatch", () =>
    validate({ checklistText }),
  );
});

test("every allowed tracking outcome stays explicitly non-blocking", () => {
  const checklistText = mutateChecklistRow("GR03", (cells) => {
    cells[1] = cells[1].replace("non-blocking", "tracking");
  });
  assertCode("checklist-classification-mismatch", () =>
    validate({ checklistText }),
  );
});

test("registry dependency cycle fails closed", () => {
  const registry = clone(REGISTRY);
  const first = registry.tasks.find(({ id }) => id === "D1-SPEC-001");
  first.depends_on = ["CTRL-RELEASE-ROLLUP-086"];
  assertCode("cyclic-registry", () => validate({ registry }));
});

test("every blocking mapped producer must feed the release roll-up", () => {
  const registry = clone(REGISTRY);
  const rc = registry.tasks.find(({ id }) => id === "D19-RC-065");
  rc.depends_on = rc.depends_on.filter((id) => id !== "D14-NPM-DIST-078");
  assertCode("blocking-task-outside-rollup", () => validate({ registry }));
});

test("a blocking leaf cannot map to a task downstream of the roll-up", () => {
  const manifest = clone(MANIFEST);
  manifest.mappings.find(
    ({ release_id }) => release_id === "REL-PKG02",
  ).task_id = "D21-RELEASE-067";
  assertCode("blocking-task-outside-rollup", () => validate({ manifest }));
});

test("dangling registry dependency fails closed", () => {
  const registry = clone(REGISTRY);
  registry.tasks[0].depends_on = ["UNKNOWN-PREDECESSOR"];
  assertCode("dangling-registry-dependency", () => validate({ registry }));
});

test("duplicate registry task ID fails closed", () => {
  const registry = clone(REGISTRY);
  registry.tasks.push(clone(registry.tasks[0]));
  assertCode("duplicate-registry-task", () => validate({ registry }));
});

test("mapping to a retired task fails closed", () => {
  const registry = clone(REGISTRY);
  const mappedTaskId = MANIFEST.mappings[0].task_id;
  registry.tasks.find(({ id }) => id === mappedTaskId).status = "retired";
  assertCode("non-live-task-mapping", () => validate({ registry }));
});

test("duplicate checklist gate definition fails closed", () => {
  const lines = CHECKLIST.split(/\r?\n/u);
  const rowIndex = lines.findIndex((line) => line.startsWith("| `V1-01` |"));
  lines.splice(rowIndex + 1, 0, lines[rowIndex]);
  assertCode("duplicate-checklist-gate", () =>
    validate({ checklistText: lines.join("\n") }),
  );
});

test("an exact REL cell in a synthetic table cannot impersonate a leaf", () => {
  const checklistText = `${CHECKLIST}\n| synthetic | \`REL-SYNTHETIC\` |\n`;
  assertCode("pseudo-checklist-leaf", () => validate({ checklistText }));
});

test("an exact REL cell in an evidence column cannot impersonate evidence", () => {
  const checklistText = mutateChecklistRow("V1-01", (cells) => {
    cells[5] = "`REL-V1-01`";
  });
  assertCode("pseudo-checklist-leaf", () => validate({ checklistText }));
});

test("swapped checklist Task IDs fail their gate binding", () => {
  let checklistText = mutateChecklistRow("V1-01", (cells) => {
    cells[3] = "`REL-V1-02`";
  });
  const lines = checklistText.split(/\r?\n/u);
  const second = lines.findIndex((line) => line.startsWith("| `V1-02` |"));
  const cells = lines[second]
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
  cells[3] = "`REL-V1-01`";
  lines[second] = `| ${cells.join(" | ")} |`;
  checklistText = lines.join("\n");
  assertCode("mismatched-checklist-task-id", () => validate({ checklistText }));
});

test("empty checklist evidence slots fail closed", () => {
  const checklistText = mutateChecklistRow("V1-01", (cells) => {
    cells[5] = "";
  });
  assertCode("empty-checklist-cell", () => validate({ checklistText }));
});

test("invalid checklist status fails closed", () => {
  const checklistText = mutateChecklistRow("V1-01", (cells) => {
    cells[4] = "Maybe";
  });
  assertCode("invalid-checklist-status", () => validate({ checklistText }));
});

test("an extra table column fails closed", () => {
  const checklistText = mutateChecklistRow("V1-01", (cells) => {
    cells.splice(3, 0, "shadow cell");
  });
  assertCode("invalid-checklist-row", () => validate({ checklistText }));
});

test("malformed canonical table pipes fail closed", () => {
  const checklistText = CHECKLIST.replace(
    "| Gate | Mandatory decision condition | Owner | Task ID | Status | Evidence slot |",
    "| Gate | Mandatory decision condition | Owner | Task ID | Status | Evidence slot",
  );
  assertCode("invalid-checklist-table", () => validate({ checklistText }));
});

test("pipes inside code spans and escaped cells do not create fake columns", () => {
  const checklistText = mutateChecklistRow("V1-01", (cells) => {
    cells[1] = `${cells[1]} with \`status|watch\` and escaped \\| text`;
  });
  assert.equal(validate({ checklistText }).releaseLeafCount, 178);
});

test("checklist gate-inventory drift fails closed", () => {
  const checklistText = CHECKLIST.replace(
    "| `V1-01` |",
    "| `V1-01-REMOVED` |",
  ).replace("| `REL-V1-01` |", "| `REMOVED-V1-01` |");
  assertCode("unexpected-checklist-gate", () => validate({ checklistText }));
});

test("mapped tasks need a non-empty artifact evidence plan", () => {
  const registry = clone(REGISTRY);
  const mappedTaskId = MANIFEST.mappings[0].task_id;
  registry.tasks.find(({ id }) => id === mappedTaskId).expected_artifacts = [];
  assertCode("empty-task-evidence-plan", () => validate({ registry }));
});

test("mapped tasks need non-empty expected-test entries", () => {
  const registry = clone(REGISTRY);
  const mappedTaskId = MANIFEST.mappings[0].task_id;
  registry.tasks.find(({ id }) => id === mappedTaskId).expected_tests = ["   "];
  assertCode("invalid-shape", () => validate({ registry }));
});

test("duplicate task evidence-plan entries fail closed", () => {
  const registry = clone(REGISTRY);
  const mappedTaskId = MANIFEST.mappings[0].task_id;
  const task = registry.tasks.find(({ id }) => id === mappedTaskId);
  task.expected_tests.push(task.expected_tests[0]);
  assertCode("duplicate-task-evidence-plan", () => validate({ registry }));
});

test("manifest cannot redefine the non-blocking policy", () => {
  const manifest = clone(MANIFEST);
  manifest.classification_policy.non_blocking_release_ids.push("REL-GR01");
  assertCode("invalid-classification-policy", () => validate({ manifest }));
});

test("manifest cannot redirect its authoritative source declarations", () => {
  const manifest = clone(MANIFEST);
  manifest.sources.registry = "some-other-registry.json";
  assertCode("invalid-source-declaration", () => validate({ manifest }));
});

test("unknown manifest fields fail closed", () => {
  const manifest = clone(MANIFEST);
  manifest.allow_unmapped = true;
  assertCode("unknown-field", () => validate({ manifest }));
});
