import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TaskRegistryError } from "../check-task-registry.mjs";
import { parseDependencyRulesText, validateTaskGraph } from "../check-task-graph.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, "codex_logs/task-registry.json"), "utf8"));
const RULES = parseDependencyRulesText(
  fs.readFileSync(path.join(ROOT, "codex_plans/delivery/release-dependency-rules.json"), "utf8"),
);
const clone = (value) => structuredClone(value);

function rejects(code, operation) {
  assert.throws(operation, (error) => error instanceof TaskRegistryError && error.code === code);
}

test("semantic dependency removal invalidates the graph", () => {
  const registry = clone(REGISTRY);
  const p9 = registry.tasks.find(({ id }) => id === "D9-SQLITE-PUBLICATION-TX-OWNER-092");
  p9.depends_on = [];
  rejects("missing-semantic-edge", () => validateTaskGraph(registry, null, RULES));
});

test("completed consumers are invalidated when a predecessor reopens", () => {
  const registry = clone(REGISTRY);
  const rule11 = registry.tasks.find(({ id }) => id === "D9-SQLITE-RULE11-PREDECESSOR-091");
  rule11.status = "planned";
  delete rule11.completed_at;
  rejects("completed-dependency-open", () => validateTaskGraph(registry, null, RULES));
});

test("a release cannot be marked completed over an open roll-up", () => {
  const registry = clone(REGISTRY);
  const release = registry.tasks.find(({ id }) => id === "D21-RELEASE-067");
  release.status = "completed";
  release.completed_at = release.last_heartbeat;
  rejects("completed-dependency-open", () => validateTaskGraph(registry, null, RULES));
});

test("API, pattern, security, and SQLite composition semantic edges are machine-required", () => {
  for (const [consumer, producer] of [
    ["D14-API-FREEZE-050", "D4-TRACE-SUBGRAPH-022"],
    ["D15-EXPLORER-060", "D9-OPS-CONTROL-085"],
    ["D19-RC-065", "CTRL-PATTERNS-071"],
    ["D16-SECURITY-062", "D15-EXPLORER-060"],
    ["D9-SQLITE-OWNER-COMPOSITION-P11-094", "D9-SQLITE-PUBLICATION-TX-OWNER-092"],
    ["D9-SQLITE-OWNER-COMPOSITION-P11-094", "D9-SQLITE-RULE12-CLOCK-P10-093"],
  ]) {
    const registry = clone(REGISTRY);
    const task = registry.tasks.find(({ id }) => id === consumer);
    task.depends_on = task.depends_on.filter((id) => id !== producer);
    rejects("missing-semantic-edge", () => validateTaskGraph(registry, null, RULES));
  }
});
