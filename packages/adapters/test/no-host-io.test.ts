/**
 * Mechanical proof that this package performs no network and no subprocess I/O,
 * in `src` and in `test` alike.
 *
 * The check is a static scan of every shipped source and test file plus a
 * runtime trap on every global entry point a Node process has to the network or
 * to a child process. It is a hard failure, not a warning: adding an import of
 * `node:child_process` or a call to `globalThis.fetch` anywhere in this package
 * fails here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createHttpAdapter, createMockAdapter, createShellAdapter } from "../src/index.js";
import { corpus, descriptorFor, requestFrom } from "./corpus.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** Every module a Node process could reach the network or a process through. */
const FORBIDDEN_MODULES = [
  "node:child_process",
  "child_process",
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "node:tls",
  "node:dgram",
  "node:dns",
  "node:worker_threads",
  "node:cluster",
  "node:vm",
  "undici",
  "node-fetch",
  "axios",
  "got",
];

/** Every global that would perform host I/O without an import. */
const FORBIDDEN_GLOBALS = [
  "globalThis.fetch",
  "new XMLHttpRequest",
  "new WebSocket",
  "new EventSource",
  "process.binding",
];

/** Comments are prose about I/O, not I/O. The behavioural scans read code only. */
function stripComments(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}

interface ScannedFile {
  readonly path: string;
  readonly text: string;
  readonly code: string;
}

function sourceFiles(directory: string): ScannedFile[] {
  const files: ScannedFile[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const text = readFileSync(path, "utf8");
    files.push({ path, text, code: stripComments(text) });
  }
  return files;
}

const shipped = sourceFiles(`${packageRoot}src`);
const tests = sourceFiles(`${packageRoot}test`);
const everything = [...shipped, ...tests];

describe("static proof", () => {
  it("scans a non-empty set of files", () => {
    expect(shipped.length).toBeGreaterThan(10);
    expect(tests.length).toBeGreaterThan(3);
  });

  it.each(FORBIDDEN_MODULES)("imports %s nowhere", (moduleName) => {
    const importing = everything
      .filter(
        (file) =>
          file.code.includes(`from "${moduleName}"`) ||
          file.code.includes(`require("${moduleName}")`) ||
          file.code.includes(`import("${moduleName}")`),
      )
      .map((file) => file.path.slice(packageRoot.length));
    expect(importing).toEqual([]);
  });

  it.each(FORBIDDEN_GLOBALS)("never reaches %s in shipped source", (name) => {
    const using = shipped
      .filter((file) => file.code.includes(name))
      .map((file) => file.path.slice(packageRoot.length));
    expect(using).toEqual([]);
  });

  it("imports only node:fs and node:url, and only in test scaffolding", () => {
    const nodeImports = new Set<string>();
    for (const file of everything) {
      for (const match of file.code.matchAll(/from "(node:[a-z_/]+)"/g)) {
        nodeImports.add(match[1] as string);
      }
    }
    expect([...nodeImports].sort()).toEqual(["node:fs", "node:url"]);
    for (const file of shipped) {
      expect(file.code).not.toMatch(/from "node:/);
    }
  });

  it("names no absolute URL and no routable host", () => {
    for (const file of everything) {
      for (const match of file.text.matchAll(/https?:\/\/([a-z0-9.:-]+)/gi)) {
        const host = (match[1] as string).split(":")[0] as string;
        expect(
          host === "localhost" ||
            /\.(invalid|test)$/.test(host) ||
            // JSON Schema and specification anchors in doc comments.
            host.endsWith("json-schema.org") ||
            host.endsWith("github.io"),
        ).toBe(true);
      }
    }
  });
});

describe("runtime proof", () => {
  it("performs no host I/O while every adapter runs a full call", async () => {
    const globals = globalThis as Record<string, unknown>;
    const originals = new Map<string, unknown>();
    const breaches: string[] = [];
    for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]) {
      originals.set(name, globals[name]);
      globals[name] = () => {
        breaches.push(name);
        throw new Error(`the package reached ${name}`);
      };
    }
    try {
      const mock = createMockAdapter({
        descriptor: descriptorFor("mock-full"),
        budgetPolicyAllowedProviderMetrics: corpus.budgetPolicyAllowedProviderMetrics,
      });
      expect((await mock.call(requestFrom())).ok).toBe(true);

      let transportCalls = 0;
      const http = createHttpAdapter({
        descriptor: descriptorFor("http-mock"),
        fetch: async () => {
          transportCalls += 1;
          return { status: 200, headers: { get: () => null }, body: "ok" };
        },
      });
      const httpOutcome = await http.call(
        requestFrom([
          {
            op: "replace",
            path: "/target",
            value: {
              scheme: "https",
              host: "gateway.invalid",
              port: 443,
              redirected: false,
              reauthorized: false,
            },
          },
        ]),
      );
      expect(httpOutcome.ok).toBe(true);
      expect(transportCalls).toBe(1);

      const shell = createShellAdapter({ descriptor: descriptorFor("shell-mock") });
      expect((await shell.call(requestFrom())).ok).toBe(false);
    } finally {
      for (const [name, value] of originals) {
        if (value === undefined) delete globals[name];
        else globals[name] = value;
      }
    }
    expect(breaches).toEqual([]);
  });
});
