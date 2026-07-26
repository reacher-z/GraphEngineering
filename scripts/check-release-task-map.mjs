#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CANONICAL_RELEASE_LEAF_COUNT = 178;
export const NON_BLOCKING_RELEASE_IDS = Object.freeze([
  "REL-GR03",
  "REL-GR04",
  "REL-GR05",
]);

export const RELEASE_ROLLUP_TASK_ID = "CTRL-RELEASE-ROLLUP-086";

const numberRange = (prefix, start, end) =>
  Array.from(
    { length: end - start + 1 },
    (_, offset) => `${prefix}${String(start + offset).padStart(2, "0")}`,
  );

/**
 * Canonical checklist tables and their gate inventory.
 *
 * The exact inventory is intentional. Counting arbitrary `REL-*` cells lets a
 * deleted leaf be replaced by a prose/overlay/synthetic-table reference while
 * preserving the total of 178. Binding each table header to its exact gate set
 * also prevents two task IDs from being swapped between otherwise valid rows.
 */
const CHECKLIST_TABLE_SPECS = Object.freeze([
  {
    header: ["Gate", "Mandatory decision condition", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("V1-", 1, 8),
  },
  {
    header: ["Gate", "Mandatory condition", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("I", 1, 10),
  },
  {
    header: ["Gate", "TS/Python equality requirement", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("X", 1, 10),
  },
  {
    header: ["Gate", "Mandatory candidate test", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("T", 1, 33),
  },
  {
    header: ["Gate", "Mandatory threshold", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("Q", 1, 11),
  },
  {
    header: ["Matrix cell", "Required environment", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: [
      ...numberRange("MX-N", 1, 6),
      ...numberRange("MX-P", 1, 9),
      ...numberRange("MX-X", 1, 2),
    ],
  },
  {
    header: ["Gate", "Mandatory package check", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("PKG", 1, 13),
  },
  {
    header: ["Gate", "Mandatory supply-chain check", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("SC", 1, 14),
  },
  {
    header: ["Gate", "Mandatory external check", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("UX", 1, 10),
  },
  {
    header: ["Gate", "Mandatory pattern check", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: ["PB", ...numberRange("P", 1, 10)],
  },
  {
    header: ["Gate", "Mandatory asset", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("DOC", 1, 16),
  },
  {
    header: ["Gate", "Classification and requirement", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("GR", 1, 7),
  },
  {
    header: ["Gate", "Mandatory support check", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("SUP", 1, 8),
  },
  {
    header: ["Gate", "Mandatory fallback condition/action", "Owner", "Task ID", "Status", "Evidence slot"],
    gates: numberRange("RC", 1, 10),
  },
]);

const CHECKLIST_STATUS = /^(Open|Partial|Green|Blocked)(?:;\s+\S.*)?$/u;
const TABLE_SEPARATOR = /^:?-{3,}:?$/u;

const LIVE_TASK_STATUSES = new Set([
  "planned",
  "in_progress",
  "blocked",
  "completed",
]);

const MANIFEST_KEYS = new Set([
  "schema_version",
  "expected_release_leaf_count",
  "sources",
  "classification_policy",
  "mappings",
]);
const SOURCE_KEYS = new Set(["checklist", "registry"]);
const POLICY_KEYS = new Set([
  "blocking_default",
  "non_blocking_release_ids",
]);
const MAPPING_KEYS = new Set(["release_id", "task_id", "blocking"]);

const DEFAULT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_PATHS = Object.freeze({
  checklist: path.join(
    DEFAULT_ROOT,
    "codex_plans/delivery/release-checklist.md",
  ),
  registry: path.join(DEFAULT_ROOT, "codex_logs/task-registry.json"),
  map: path.join(
    DEFAULT_ROOT,
    "codex_plans/delivery/release-task-map.json",
  ),
});
const CANONICAL_SOURCES = Object.freeze({
  checklist: "codex_plans/delivery/release-checklist.md",
  registry: "codex_logs/task-registry.json",
});

export class ReleaseTaskMapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseTaskMapError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseTaskMapError(code, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, allowed, context) {
  if (!isRecord(value)) {
    fail("invalid-shape", `${context} must be a JSON object`);
  }

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("unknown-field", `${context} contains unknown field ${JSON.stringify(key)}`);
    }
  }
}

function assertNonEmptyString(value, context) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("invalid-shape", `${context} must be a non-empty string`);
  }
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

function splitMarkdownTableLine(line, lineNumber) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    fail(
      "invalid-checklist-table",
      `checklist line ${lineNumber} must use explicit leading and trailing table pipes`,
    );
  }

  const cells = [];
  let current = "";
  let codeDelimiterLength = 0;
  const body = trimmed.slice(1, -1);

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "`") {
      let runLength = 1;
      while (body[index + runLength] === "`") {
        runLength += 1;
      }
      if (codeDelimiterLength === 0) {
        codeDelimiterLength = runLength;
      } else if (codeDelimiterLength === runLength) {
        codeDelimiterLength = 0;
      }
      current += "`".repeat(runLength);
      index += runLength - 1;
      continue;
    }

    if (character === "|" && codeDelimiterLength === 0) {
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && body[cursor] === "\\"; cursor -= 1) {
        backslashes += 1;
      }
      if (backslashes % 2 === 0) {
        cells.push(current.trim());
        current = "";
        continue;
      }
    }
    current += character;
  }

  if (codeDelimiterLength !== 0) {
    fail(
      "invalid-checklist-table",
      `checklist line ${lineNumber} contains an unterminated code span`,
    );
  }
  cells.push(current.trim());
  return cells;
}

function exactInlineCode(value, context) {
  const match = /^`([^`]+)`$/u.exec(value);
  if (!match) {
    fail("invalid-checklist-row", `${context} must be one exact inline-code value`);
  }
  return match[1];
}

function releaseIdForGate(gate) {
  if (gate === "PB") {
    return "REL-PAT00";
  }
  if (/^P\d{2}$/u.test(gate)) {
    return `REL-PAT${gate.slice(1)}`;
  }
  return `REL-${gate}`;
}

function sameCells(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Extract checklist leaf definitions from the fourteen canonical release
 * tables. References in prose, evidence slots, and the post-audit overlay do
 * not count, and an exact release cell outside the canonical Task ID column is
 * rejected as a pseudo-leaf rather than silently contributing to the total.
 */
export function extractChecklistReleaseLeaves(checklistText) {
  if (typeof checklistText !== "string") {
    fail("invalid-checklist", "checklist input must be text");
  }

  const lines = checklistText.split(/\r?\n/u);
  const leaves = [];
  const recognizedReleaseCells = new Set();
  const seenTables = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trimStart().startsWith("|")) {
      continue;
    }
    const cells = splitMarkdownTableLine(line, index + 1);
    const tableIndex = CHECKLIST_TABLE_SPECS.findIndex(({ header }) => sameCells(cells, header));
    if (tableIndex === -1) {
      continue;
    }
    if (seenTables.has(tableIndex)) {
      fail(
        "duplicate-checklist-table",
        `checklist repeats canonical release table ${JSON.stringify(cells[1])}`,
      );
    }
    seenTables.add(tableIndex);

    const separatorLine = lines[index + 1];
    if (separatorLine === undefined || !separatorLine.trimStart().startsWith("|")) {
      fail(
        "invalid-checklist-table",
        `checklist table at line ${index + 1} has no separator row`,
      );
    }
    const separator = splitMarkdownTableLine(separatorLine, index + 2);
    if (
      separator.length !== cells.length ||
      separator.some((cell) => !TABLE_SEPARATOR.test(cell))
    ) {
      fail(
        "invalid-checklist-table",
        `checklist line ${index + 2} is not a six-column Markdown separator`,
      );
    }

    const spec = CHECKLIST_TABLE_SPECS[tableIndex];
    const expectedGates = new Set(spec.gates);
    const actualGates = new Set();
    index += 2;
    while (index < lines.length && lines[index].trimStart().startsWith("|")) {
      const rowLine = index + 1;
      const row = splitMarkdownTableLine(lines[index], rowLine);
      if (row.length !== 6) {
        fail(
          "invalid-checklist-row",
          `checklist release row at line ${rowLine} has ${row.length} cells; expected 6`,
        );
      }
      const gate = exactInlineCode(row[0], `checklist gate at line ${rowLine}`);
      if (!expectedGates.has(gate)) {
        fail(
          "unexpected-checklist-gate",
          `checklist table ${JSON.stringify(spec.header[1])} contains unexpected gate ${gate}`,
        );
      }
      if (actualGates.has(gate)) {
        fail("duplicate-checklist-gate", `checklist gate ${gate} is duplicated`);
      }
      actualGates.add(gate);

      for (const [cellIndex, label] of [
        [1, "requirement"],
        [2, "owner"],
        [4, "status"],
        [5, "evidence slot"],
      ]) {
        if (row[cellIndex].trim() === "") {
          fail(
            "empty-checklist-cell",
            `checklist ${label} for ${gate} at line ${rowLine} must not be empty`,
          );
        }
      }
      if (!CHECKLIST_STATUS.test(row[4])) {
        fail(
          "invalid-checklist-status",
          `checklist status for ${gate} at line ${rowLine} is invalid: ${JSON.stringify(row[4])}`,
        );
      }

      const releaseId = exactInlineCode(
        row[3],
        `checklist Task ID for ${gate} at line ${rowLine}`,
      );
      const expectedReleaseId = releaseIdForGate(gate);
      if (releaseId !== expectedReleaseId) {
        fail(
          "mismatched-checklist-task-id",
          `checklist gate ${gate} must use Task ID ${expectedReleaseId}, not ${releaseId}`,
        );
      }
      const isNonBlocking = NON_BLOCKING_RELEASE_IDS.includes(releaseId);
      const declaresNonBlocking = /\bnon-blocking\b/iu.test(row[1]);
      if (isNonBlocking !== declaresNonBlocking) {
        fail(
          "checklist-classification-mismatch",
          isNonBlocking
            ? `${releaseId} must be explicitly labeled non-blocking in its requirement cell`
            : `${releaseId} is not allowed to be labeled non-blocking`,
        );
      }
      leaves.push({ id: releaseId, line: rowLine, gate });
      recognizedReleaseCells.add(`${rowLine}:3:${releaseId}`);
      index += 1;
    }
    index -= 1;

    const missingGates = spec.gates.filter((gate) => !actualGates.has(gate));
    if (missingGates.length > 0) {
      fail(
        "missing-checklist-gates",
        `checklist table ${JSON.stringify(spec.header[1])} is missing gates: ${missingGates.join(", ")}`,
      );
    }
  }

  if (seenTables.size !== CHECKLIST_TABLE_SPECS.length) {
    const missingTables = CHECKLIST_TABLE_SPECS
      .filter((_, index) => !seenTables.has(index))
      .map(({ header }) => header[1]);
    fail(
      "missing-checklist-tables",
      `checklist is missing canonical release tables: ${missingTables.join(", ")}`,
    );
  }

  for (const [index, line] of lines.entries()) {
    if (!line.trimStart().startsWith("|")) {
      continue;
    }
    const cells = splitMarkdownTableLine(line, index + 1);
    for (const [cellIndex, cell] of cells.entries()) {
      const match = /^`(REL-[A-Z0-9-]+)`$/u.exec(cell);
      if (match && !recognizedReleaseCells.has(`${index + 1}:${cellIndex}:${match[1]}`)) {
        fail(
          "pseudo-checklist-leaf",
          `exact release cell ${match[1]} at line ${index + 1} is outside a canonical Task ID column`,
        );
      }
    }
  }

  if (leaves.length === 0) {
    fail("no-checklist-leaves", "checklist contains no exact REL-* leaf cells");
  }

  const duplicates = duplicateValues(leaves.map(({ id }) => id));
  if (duplicates.length > 0) {
    fail(
      "duplicate-checklist-leaf",
      `checklist defines duplicate release leaves: ${duplicates.join(", ")}`,
    );
  }

  return leaves;
}

function validateRegistry(registry) {
  if (!isRecord(registry) || !Array.isArray(registry.tasks)) {
    fail("invalid-registry", "registry.tasks must be an array");
  }

  const taskById = new Map();
  for (const [index, task] of registry.tasks.entries()) {
    if (!isRecord(task)) {
      fail("invalid-registry", `registry.tasks[${index}] must be an object`);
    }
    assertNonEmptyString(task.id, `registry.tasks[${index}].id`);
    if (taskById.has(task.id)) {
      fail("duplicate-registry-task", `registry task ${task.id} is duplicated`);
    }
    if (!Array.isArray(task.depends_on)) {
      fail(
        "invalid-registry",
        `registry task ${task.id} must declare depends_on as an array`,
      );
    }
    const duplicateDependencies = duplicateValues(task.depends_on);
    if (duplicateDependencies.length > 0) {
      fail(
        "duplicate-registry-dependency",
        `registry task ${task.id} repeats dependencies: ${duplicateDependencies.join(", ")}`,
      );
    }
    for (const dependency of task.depends_on) {
      assertNonEmptyString(dependency, `dependency of registry task ${task.id}`);
    }
    taskById.set(task.id, task);
  }

  for (const task of taskById.values()) {
    for (const dependency of task.depends_on) {
      if (!taskById.has(dependency)) {
        fail(
          "dangling-registry-dependency",
          `registry task ${task.id} depends on unknown task ${dependency}`,
        );
      }
    }
  }

  const state = new Map();
  const stack = [];
  const visit = (taskId) => {
    const current = state.get(taskId) ?? 0;
    if (current === 2) {
      return;
    }
    if (current === 1) {
      const cycleStart = stack.indexOf(taskId);
      const cycle = [...stack.slice(cycleStart), taskId];
      fail("cyclic-registry", `registry dependency cycle: ${cycle.join(" -> ")}`);
    }

    state.set(taskId, 1);
    stack.push(taskId);
    for (const dependency of taskById.get(taskId).depends_on) {
      visit(dependency);
    }
    stack.pop();
    state.set(taskId, 2);
  };

  for (const taskId of taskById.keys()) {
    visit(taskId);
  }

  return taskById;
}

function validateMappedTaskEvidencePlan(task) {
  for (const field of ["expected_artifacts", "expected_tests"]) {
    const values = task[field];
    if (!Array.isArray(values) || values.length === 0) {
      fail(
        "empty-task-evidence-plan",
        `mapped task ${task.id} must declare at least one ${field} entry`,
      );
    }
    for (const [index, value] of values.entries()) {
      assertNonEmptyString(value, `${field}[${index}] of mapped task ${task.id}`);
    }
    const duplicates = duplicateValues(values);
    if (duplicates.length > 0) {
      fail(
        "duplicate-task-evidence-plan",
        `mapped task ${task.id} repeats ${field} entries: ${duplicates.join(", ")}`,
      );
    }
  }
}

function dependencyAncestors(taskById, taskId) {
  const ancestors = new Set();
  const visit = (currentId) => {
    if (ancestors.has(currentId)) {
      return;
    }
    ancestors.add(currentId);
    for (const dependency of taskById.get(currentId).depends_on) {
      visit(dependency);
    }
  };
  visit(taskId);
  return ancestors;
}

function validatePolicy(manifest) {
  assertExactKeys(
    manifest.classification_policy,
    POLICY_KEYS,
    "classification_policy",
  );
  if (manifest.classification_policy.blocking_default !== true) {
    fail(
      "invalid-classification-policy",
      "classification_policy.blocking_default must be true",
    );
  }
  const configured = manifest.classification_policy.non_blocking_release_ids;
  if (!Array.isArray(configured)) {
    fail(
      "invalid-classification-policy",
      "classification_policy.non_blocking_release_ids must be an array",
    );
  }
  const duplicates = duplicateValues(configured);
  if (duplicates.length > 0) {
    fail(
      "invalid-classification-policy",
      `classification policy repeats IDs: ${duplicates.join(", ")}`,
    );
  }
  const expected = [...NON_BLOCKING_RELEASE_IDS].sort();
  const actual = [...configured].sort();
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    fail(
      "invalid-classification-policy",
      `non-blocking release IDs must be exactly ${expected.join(", ")}`,
    );
  }
}

export function validateReleaseTaskMap({
  checklistText,
  registry,
  manifest,
  expectedLeafCount = CANONICAL_RELEASE_LEAF_COUNT,
}) {
  if (!Number.isSafeInteger(expectedLeafCount) || expectedLeafCount <= 0) {
    fail("invalid-expected-count", "expectedLeafCount must be a positive integer");
  }

  const checklistLeaves = extractChecklistReleaseLeaves(checklistText);
  if (checklistLeaves.length !== expectedLeafCount) {
    fail(
      "checklist-count-mismatch",
      `checklist defines ${checklistLeaves.length} leaves; expected ${expectedLeafCount}`,
    );
  }
  const checklistIds = new Set(checklistLeaves.map(({ id }) => id));

  const taskById = validateRegistry(registry);

  assertExactKeys(manifest, MANIFEST_KEYS, "release task map");
  if (manifest.schema_version !== 1) {
    fail("unsupported-schema", "release task map schema_version must be 1");
  }
  if (manifest.expected_release_leaf_count !== expectedLeafCount) {
    fail(
      "manifest-count-mismatch",
      `map expects ${manifest.expected_release_leaf_count} leaves; required ${expectedLeafCount}`,
    );
  }

  assertExactKeys(manifest.sources, SOURCE_KEYS, "sources");
  assertNonEmptyString(manifest.sources.checklist, "sources.checklist");
  assertNonEmptyString(manifest.sources.registry, "sources.registry");
  for (const [source, expectedPath] of Object.entries(CANONICAL_SOURCES)) {
    if (manifest.sources[source] !== expectedPath) {
      fail(
        "invalid-source-declaration",
        `sources.${source} must be ${JSON.stringify(expectedPath)}`,
      );
    }
  }
  validatePolicy(manifest);

  if (!Array.isArray(manifest.mappings)) {
    fail("invalid-shape", "release task map mappings must be an array");
  }

  const mappedReleaseIds = new Set();
  const blockingTaskIds = new Set();
  let blockingCount = 0;
  let nonBlockingCount = 0;
  for (const [index, mapping] of manifest.mappings.entries()) {
    assertExactKeys(mapping, MAPPING_KEYS, `mappings[${index}]`);
    assertNonEmptyString(mapping.release_id, `mappings[${index}].release_id`);
    assertNonEmptyString(mapping.task_id, `mappings[${index}].task_id`);
    if (typeof mapping.blocking !== "boolean") {
      fail(
        "missing-blocking-classification",
        `mapping ${mapping.release_id} must declare blocking as a boolean`,
      );
    }
    if (mappedReleaseIds.has(mapping.release_id)) {
      fail(
        "duplicate-release-mapping",
        `release leaf ${mapping.release_id} is mapped more than once`,
      );
    }
    mappedReleaseIds.add(mapping.release_id);

    if (!checklistIds.has(mapping.release_id)) {
      fail(
        "unknown-release-leaf",
        `map references unknown release leaf ${mapping.release_id}`,
      );
    }

    const task = taskById.get(mapping.task_id);
    if (!task) {
      fail(
        "dangling-task-mapping",
        `release leaf ${mapping.release_id} maps to unknown task ${mapping.task_id}`,
      );
    }
    if (!LIVE_TASK_STATUSES.has(task.status)) {
      fail(
        "non-live-task-mapping",
        `release leaf ${mapping.release_id} maps to non-live task ${mapping.task_id} with status ${JSON.stringify(task.status)}`,
      );
    }
    validateMappedTaskEvidencePlan(task);

    const shouldBlock = !NON_BLOCKING_RELEASE_IDS.includes(mapping.release_id);
    if (mapping.blocking !== shouldBlock) {
      fail(
        "incorrect-blocking-classification",
        `${mapping.release_id} must declare blocking=${shouldBlock}`,
      );
    }
    if (mapping.blocking) {
      blockingCount += 1;
      blockingTaskIds.add(mapping.task_id);
    } else {
      nonBlockingCount += 1;
    }
  }

  const missing = [...checklistIds].filter((id) => !mappedReleaseIds.has(id));
  if (missing.length > 0) {
    fail(
      "unmapped-release-leaves",
      `release leaves without a mapping: ${missing.join(", ")}`,
    );
  }
  if (manifest.mappings.length !== expectedLeafCount) {
    fail(
      "mapping-count-mismatch",
      `map contains ${manifest.mappings.length} mappings; expected ${expectedLeafCount}`,
    );
  }

  const rollupTask = taskById.get(RELEASE_ROLLUP_TASK_ID);
  if (!rollupTask || !LIVE_TASK_STATUSES.has(rollupTask.status)) {
    fail(
      "missing-release-rollup",
      `registry must contain live release roll-up task ${RELEASE_ROLLUP_TASK_ID}`,
    );
  }
  const rollupAncestors = dependencyAncestors(taskById, RELEASE_ROLLUP_TASK_ID);
  const producersOutsideRollup = [...blockingTaskIds]
    .filter(
      (taskId) =>
        taskId !== RELEASE_ROLLUP_TASK_ID && !rollupAncestors.has(taskId),
    )
    .sort();
  if (producersOutsideRollup.length > 0) {
    fail(
      "blocking-task-outside-rollup",
      `blocking mapped tasks are not transitive predecessors of ${RELEASE_ROLLUP_TASK_ID}: ${producersOutsideRollup.join(", ")}`,
    );
  }

  return Object.freeze({
    releaseLeafCount: checklistLeaves.length,
    mappingCount: manifest.mappings.length,
    blockingCount,
    nonBlockingCount,
    blockingProducerCount: blockingTaskIds.size,
    rollupAncestorCount: rollupAncestors.size,
    registryTaskCount: taskById.size,
  });
}

function parseArgs(argv) {
  const result = { ...DEFAULT_PATHS, json: false };
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
    if (!["--checklist", "--registry", "--map"].includes(argument)) {
      fail("invalid-argument", `unknown argument ${JSON.stringify(argument)}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("invalid-argument", `${argument} requires a path`);
    }
    result[argument.slice(2)] = path.resolve(value);
    index += 1;
  }
  return result;
}

function readJson(filePath, label) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    fail("read-error", `cannot read ${label} ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("json-error", `cannot parse ${label} ${filePath}: ${error.message}`);
  }
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node scripts/check-release-task-map.mjs [--checklist PATH] [--registry PATH] [--map PATH] [--json]\n",
    );
    return 0;
  }

  let checklistText;
  try {
    checklistText = fs.readFileSync(args.checklist, "utf8");
  } catch (error) {
    fail(
      "read-error",
      `cannot read checklist ${args.checklist}: ${error.message}`,
    );
  }
  const summary = validateReleaseTaskMap({
    checklistText,
    registry: readJson(args.registry, "registry"),
    manifest: readJson(args.map, "release task map"),
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...summary })}\n`);
  } else {
    process.stdout.write(
      `release-task-map OK: ${summary.mappingCount}/${summary.releaseLeafCount} leaves; ` +
        `${summary.blockingCount} blocking, ${summary.nonBlockingCount} non-blocking; ` +
        `${summary.blockingProducerCount} blocking producers in a ${summary.rollupAncestorCount}-task roll-up closure; ` +
        `${summary.registryTaskCount} registry tasks; dependency graph acyclic\n`,
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
    const code = error instanceof ReleaseTaskMapError ? error.code : "unexpected";
    process.stderr.write(`release-task-map ${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
