import { writeFileSync } from "node:fs";

import { expect, it } from "vitest";

// The executable validator is intentionally plain ESM and has no declaration file.
// @ts-expect-error conformance validators are JavaScript oracles
import { canonicalReportJson } from
  "../../../spec/conformance/sqlite-cursor-publication-native-projection-np1.validate.mjs";

import { buildTypeScriptSQLiteCursorNativeProjectionReport } from
  "./support/cursor-publication-native-projection-report-runner.js";

it("builds one canonical JSON-only TypeScript NP1 report", () => {
  const report = buildTypeScriptSQLiteCursorNativeProjectionReport();
  const encoded = `${canonicalReportJson(report)}\n`;
  expect(canonicalReportJson(JSON.parse(encoded))).toBe(encoded.trimEnd());
  expect(report.portable.successCases).toHaveLength(3);
  expect(report.portable.rejectionCases).toHaveLength(2);
  const output = process.env.GRAPH_ENGINEERING_NP1_TYPESCRIPT_REPORT_OUTPUT;
  if (output !== undefined) writeFileSync(output, encoded, "utf8");
});
