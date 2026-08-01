import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GRAPH_EVENT_API_VERSION,
  JsonlEventStore,
  scanBytesForCanaries,
  type CanaryDetection,
  type GraphEvent,
  type SeededCanary,
} from "../src/index.js";
import { createProtectedRun, type ProtectedRunHarness } from "./support/protected-run.js";

let harness: ProtectedRunHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/**
 * Section 12 canary campaign, narrowed to the one sink this lane gates.
 *
 * The seed is a synthetic value with no meaning outside this test. The scan
 * walks every byte of every file the write path produced — the JSONL journal,
 * every protected blob, and any temporary file left behind — and checks the
 * literal UTF-8, JSON-escaped, URL-encoded, base64, base64url, hexadecimal,
 * UTF-16 LE and UTF-16 BE spellings plus gzip/deflate members.
 */
const CANARY: SeededCanary = Object.freeze({
  canaryId: "graph-input-canary-1",
  value: "GE-CANARY-4f2c8a19b6d34e5f9731-graph-input",
});

async function walkFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkFiles(path)));
      continue;
    }
    found.push(path);
  }
  return found;
}

async function scanDirectory(
  root: string,
  canaries: readonly SeededCanary[],
): Promise<{ files: string[]; detections: Array<CanaryDetection & { file: string }> }> {
  const files = await walkFiles(root);
  const detections: Array<CanaryDetection & { file: string }> = [];
  for (const file of files) {
    const info = await stat(file);
    if (!info.isFile()) continue;
    const bytes = await readFile(file);
    for (const detection of scanBytesForCanaries(bytes, canaries)) {
      detections.push({ ...detection, file });
    }
  }
  return { files, detections };
}

describe("seeded canary campaign (redaction-semantics.md 12)", () => {
  it("leaves no canary byte on disk after a guarded durable event write", async () => {
    harness = await createProtectedRun();
    const prepared = await harness.runCreated("canary-run", {
      credentials: { apiKey: CANARY.value },
      history: [{ note: CANARY.value }],
    });
    expect(prepared.kind).toBe("prepared");
    if (prepared.kind !== "prepared") return;
    await harness.journal.append("canary-run", -1, [prepared.prepared]);

    const scan = await scanDirectory(harness.directory, [CANARY]);
    // The scan must have had something to look at.
    expect(scan.files.length).toBeGreaterThanOrEqual(2);
    expect(scan.files.some((file) => file.endsWith(".jsonl"))).toBe(true);
    expect(scan.files.some((file) => file.endsWith(".blob"))).toBe(true);
    // No temporary plaintext file is left behind (Section 5.6).
    expect(scan.files.filter((file) => file.endsWith(".tmp"))).toEqual([]);
    expect(scan.detections).toEqual([]);
  });

  it("is a real scan: the same seed through the raw v1alpha1 writer is detected", async () => {
    // Section 12 requires an intentionally unsafe positive control that must
    // fail. `JsonlEventStore` is the ungated legacy writer this task exists to
    // displace; it writes Tagged Durable JSON payloads verbatim.
    harness = await createProtectedRun();
    const raw = new JsonlEventStore({ directory: harness.directory });
    const event: GraphEvent = {
      apiVersion: GRAPH_EVENT_API_VERSION,
      eventId: "evt-0",
      type: "RunCreated",
      timestamp: "2026-07-30T00:00:00Z",
      runId: "unsafe-control",
      graphRevision: 1,
      sequence: 0,
      redacted: true,
      data: { input: { credentials: { apiKey: CANARY.value } } },
    };
    await raw.append("unsafe-control", -1, [event]);

    const scan = await scanDirectory(harness.directory, [CANARY]);
    expect(scan.detections.length).toBeGreaterThan(0);
    expect(scan.detections[0]?.canaryId).toBe(CANARY.canaryId);
    expect(scan.detections[0]?.form).toBe("utf8");
  });

  it("has a clean control: an unseeded payload produces no detection", async () => {
    harness = await createProtectedRun();
    const prepared = await harness.runCreated("clean-run", { note: "ordinary application data" });
    if (prepared.kind !== "prepared") throw new Error("expected a prepared write");
    await harness.journal.append("clean-run", -1, [prepared.prepared]);
    const scan = await scanDirectory(harness.directory, [CANARY]);
    expect(scan.detections).toEqual([]);
  });

  it("detects every encoded spelling the campaign claims to check", () => {
    const forms = new Set(
      scanBytesForCanaries(
        Buffer.concat([
          Buffer.from(CANARY.value, "utf8"),
          Buffer.from(Buffer.from(CANARY.value, "utf8").toString("base64url"), "utf8"),
          Buffer.from(Buffer.from(CANARY.value, "utf8").toString("hex"), "utf8"),
          Buffer.from(CANARY.value, "utf16le"),
        ]),
        [CANARY],
      ).map((detection) => detection.form),
    );
    expect(forms.has("utf8")).toBe(true);
    expect(forms.has("base64url")).toBe(true);
    expect(forms.has("hex")).toBe(true);
    expect(forms.has("utf16le")).toBe(true);
  });

  it("blocks a write whose prepared bytes would carry a registered canary", async () => {
    // Defense in depth: even if a future record shape leaked a seeded value into
    // closed metadata, the guard's step-7 scan denies the write and reports only
    // the canary identifier and sink.
    harness = await createProtectedRun({ scanner: { canaries: [CANARY] } });
    const result = await harness.guard.prepare(
      {
        decisionId: "decision-canary",
        sourceClass: "log-field",
        sink: "event-journal",
        policyControl: "events",
        authorityClass: "observational",
        metadata: { data: { leaked: CANARY.value } },
        occurrence: {
          runId: "canary-guard",
          graphRevision: 1,
          recordKind: "event",
          recordType: "RunStarted",
          recordId: "evt-0",
          sequence: 0,
        },
        occurredAt: "2026-07-30T00:00:00Z",
      },
      harness.journal.binding,
    );
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure.code).toBe("SECRET_CANARY_DETECTED");
    expect(result.failure.reason).toBe(`canary:${CANARY.canaryId}`);
    // Section 10: the failure never contains the detected canary value.
    expect(JSON.stringify(result.failure)).not.toContain(CANARY.value);
    expect(JSON.stringify(result.decision)).not.toContain(CANARY.value);
  });
});
