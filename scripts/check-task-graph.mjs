#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TaskRegistryError, parseJsonText, validateTaskRegistry } from "./check-task-registry.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TASK_ID_SOURCE = "(?:D\\d+-[A-Z0-9-]+-\\d{3}|CTRL-[A-Z0-9-]+-\\d{3}|PATTERN-\\d{2}-[A-Z0-9-]+)";
const TASK_ID = new RegExp(`^${TASK_ID_SOURCE}$`, "u");

function fail(code, message) {
  throw new TaskRegistryError(code, message);
}

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-rules", `${label} must be an object`);
  }
  return value;
}

function taskId(value, label) {
  if (typeof value !== "string" || !TASK_ID.test(value)) {
    fail("invalid-rules", `${label} must be a valid task ID`);
  }
  return value;
}

export function parseDependencyRulesText(source, label = "dependency rules") {
  return parseJsonText(source, label);
}

function validateRules(rulesValue, tasks) {
  if (rulesValue === null) return Object.freeze({ requiredEdges: [], roots: new Set() });
  const rules = record(rulesValue, "dependency rules");
  if (rules.schema_version !== 1) fail("invalid-rules", "dependency rules schema_version must be 1");
  if (!Array.isArray(rules.required_edges) || !Array.isArray(rules.invalidation_roots)) {
    fail("invalid-rules", "dependency rules must declare required_edges and invalidation_roots arrays");
  }
  const seen = new Set();
  const requiredEdges = rules.required_edges.map((raw, index) => {
    const edge = record(raw, `required_edges[${index}]`);
    const consumer = taskId(edge.consumer, `required_edges[${index}].consumer`);
    const producer = taskId(edge.producer, `required_edges[${index}].producer`);
    if (consumer === producer) fail("invalid-rules", `required_edges[${index}] is a self-edge`);
    if (!tasks.has(consumer) || !tasks.has(producer)) {
      fail("unknown-rule-task", `required edge ${consumer} -> ${producer} names an unknown task`);
    }
    if (typeof edge.reason !== "string" || edge.reason.trim() === "") {
      fail("invalid-rules", `required_edges[${index}].reason must be a non-empty string`);
    }
    const identity = `${consumer}\0${producer}`;
    if (seen.has(identity)) fail("duplicate-rule", `required edge ${consumer} -> ${producer} is duplicated`);
    seen.add(identity);
    return Object.freeze({ consumer, producer });
  });
  const roots = new Set();
  for (const [index, raw] of rules.invalidation_roots.entries()) {
    const root = taskId(raw, `invalidation_roots[${index}]`);
    if (!tasks.has(root)) fail("unknown-rule-task", `invalidation root ${root} is unknown`);
    if (roots.has(root)) fail("duplicate-rule", `invalidation root ${root} is duplicated`);
    roots.add(root);
  }
  return Object.freeze({ requiredEdges, roots });
}

function assertCompletedClosure(tasks) {
  for (const task of tasks.values()) {
    if (task.status !== "completed") continue;
    for (const dependency of task.depends_on) {
      const predecessor = tasks.get(dependency);
      if (predecessor.status !== "completed") {
        fail(
          "completed-dependency-open",
          `${task.id} is completed while predecessor ${dependency} is ${predecessor.status}; downstream completion is invalidated`,
        );
      }
    }
  }
}

function assertInvalidationRoots(tasks, roots) {
  for (const root of roots) {
    if (tasks.get(root).status !== "completed") continue;
    const pending = [root];
    const visited = new Set();
    while (pending.length > 0) {
      const selected = pending.pop();
      if (visited.has(selected)) continue;
      visited.add(selected);
      for (const dependency of tasks.get(selected).depends_on) {
        if (tasks.get(dependency).status !== "completed") {
          fail(
            "release-invalidation-open",
            `${root} is completed while release ancestor ${dependency} is ${tasks.get(dependency).status}`,
          );
        }
        pending.push(dependency);
      }
    }
  }
}

export function validateTaskGraph(registry, dependencyGraphText = null, dependencyRules = null) {
  validateTaskRegistry(registry, { repoRoot: ROOT });
  const tasks = new Map(registry.tasks.map((task) => [task.id, task]));
  assertCompletedClosure(tasks);

  const color = new Map();
  const trail = [];
  const visit = (id) => {
    const selected = color.get(id);
    if (selected === "black") return;
    if (selected === "gray") {
      const start = trail.indexOf(id);
      fail("dependency-cycle", `dependency cycle: ${[...trail.slice(start), id].join(" -> ")}`);
    }
    color.set(id, "gray");
    trail.push(id);
    for (const dependency of tasks.get(id).depends_on) visit(dependency);
    trail.pop();
    color.set(id, "black");
  };
  for (const id of tasks.keys()) visit(id);

  if (dependencyGraphText !== null) {
    const mentioned = [...dependencyGraphText.matchAll(new RegExp(`\\b(${TASK_ID_SOURCE})\\b`, "gu"))]
      .map((match) => match[1]);
    const unknown = [...new Set(mentioned)].filter((id) => !tasks.has(id));
    if (unknown.length > 0) {
      fail("unknown-documented-task", `dependency graph names unknown task IDs: ${unknown.join(", ")}`);
    }
  }

  const rules = validateRules(dependencyRules, tasks);
  for (const { consumer, producer } of rules.requiredEdges) {
    if (!tasks.get(consumer).depends_on.includes(producer)) {
      fail("missing-semantic-edge", `${consumer} must directly depend on ${producer}`);
    }
  }
  assertInvalidationRoots(tasks, rules.roots);

  const edgeCount = registry.tasks.reduce((total, task) => total + task.depends_on.length, 0);
  return Object.freeze({
    taskCount: tasks.size,
    edgeCount,
    semanticEdgeCount: rules.requiredEdges.length,
  });
}

function parseArgs(argv) {
  const options = {
    registry: path.join(ROOT, "codex_logs/task-registry.json"),
    dependencyGraph: null,
    rules: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--registry") options.registry = path.resolve(argv[++index]);
    else if (argv[index] === "--dependency-graph") options.dependencyGraph = path.resolve(argv[++index]);
    else if (argv[index] === "--rules") options.rules = path.resolve(argv[++index]);
    else fail("unknown-argument", `unknown argument ${JSON.stringify(argv[index])}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const registry = parseJsonText(fs.readFileSync(options.registry, "utf8"), options.registry);
  const graph = options.dependencyGraph === null ? null : fs.readFileSync(options.dependencyGraph, "utf8");
  const rules = options.rules === null
    ? null
    : parseDependencyRulesText(fs.readFileSync(options.rules, "utf8"), options.rules);
  const result = validateTaskGraph(registry, graph, rules);
  console.log(
    `task-graph OK: ${result.taskCount} tasks; ${result.edgeCount} dependency edges; ${result.semanticEdgeCount} semantic edges; acyclic`,
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
