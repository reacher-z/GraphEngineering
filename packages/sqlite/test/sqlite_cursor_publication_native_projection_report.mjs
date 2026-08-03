#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  canonicalReportJson,
} from "../../../spec/conformance/sqlite-cursor-publication-native-projection-np1.validate.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "graph-engineering-np1-ts-report-"));
const output = join(temporaryRoot, "report.json");
try {
  const child = spawnSync(
    "corepack",
    [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "test/cursor-publication-native-projection-report-cli.test.ts",
      "--reporter=dot",
    ],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GRAPH_ENGINEERING_NP1_TYPESCRIPT_REPORT_OUTPUT: output,
      },
      timeout: 180_000,
    },
  );
  if (child.error !== undefined || child.status !== 0 || child.signal !== null) {
    process.stderr.write(child.stderr || child.stdout || String(child.error));
    process.exitCode = child.status ?? 1;
  } else {
    const encoded = readFileSync(output, "utf8");
    const decoded = JSON.parse(encoded);
    process.stdout.write(`${canonicalReportJson(decoded)}\n`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
