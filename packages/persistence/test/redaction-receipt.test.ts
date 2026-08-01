import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CAPTURE_POLICY,
  REDACTION_RULE_API_VERSION,
  REDACTION_TOKEN,
  computeSourceHash,
  validateCapturePolicy,
  validateRedactionReceiptDocument,
  type CapturePolicy,
  type RedactionReceipt,
} from "../src/index.js";
import { createProtectedRun, type ProtectedRunHarness } from "./support/protected-run.js";

let harness: ProtectedRunHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

const SECRET = "synthetic-sensitive-query-value";

/**
 * Section 4.1: a `redacted` mode requires at least one matching rule, and a rule
 * is invalid for a sink whose mode is not `redacted` or `allow-redacted`.
 * `trace-export` names three controls, so every one of them must be enabled for
 * the flow to authorize a write at all.
 */
const TRACE_POLICY = {
  ...DEFAULT_CAPTURE_POLICY,
  traces: "redacted",
  exports: "metadata-only",
  redactionRules: [
    {
      apiVersion: REDACTION_RULE_API_VERSION,
      ruleId: "trace-query-v1",
      registryVersion: DEFAULT_CAPTURE_POLICY.ruleRegistryVersion,
      sink: "trace-export",
      paths: ["/attributes/query"],
      replacementMode: "constant-token",
    },
  ],
} as CapturePolicy;

async function prepareTrace(value: unknown) {
  harness = await createProtectedRun({ policy: TRACE_POLICY });
  return {
    harness,
    result: await harness.guard.prepare(
      {
        decisionId: "decision-trace-1",
        sourceClass: "trace-attribute",
        sink: "trace-export",
        policyControl: "traces",
        authorityClass: "observational",
        metadata: { span: "span-1" },
        observational: {
          fieldPath: "/attributes",
          value,
          ruleResolutionId: "resolution-1",
        },
        occurrence: {
          runId: "trace-run",
          graphRevision: 1,
          recordKind: "event",
          recordType: "TraceExport",
          recordId: "write-1",
          sequence: 4,
        },
        occurredAt: "2026-07-30T00:00:00Z",
      },
      harness.journal.binding,
    ),
  };
}

describe("observational redaction receipt (redaction-semantics.md 3.2, 3.3)", () => {
  it("accepts the redacted rule policy", () => {
    expect(validateCapturePolicy(TRACE_POLICY).valid).toBe(true);
  });

  it("emits redacted:true with a receipt that reproduces the transform", async () => {
    const { result } = await prepareTrace({ attributes: { query: SECRET, safe: "ok" } });
    expect(result.kind).toBe("prepared");
    if (result.kind !== "prepared") return;

    expect(result.prepared.payloadDisposition).toBe("redacted");
    const receipt = result.decision.redactionReceipt as RedactionReceipt;
    expect(receipt).toBeDefined();
    expect(validateRedactionReceiptDocument(receipt).valid).toBe(true);
    expect(receipt.count).toBe(1);
    expect(receipt.paths).toEqual(["/attributes/query"]);
    expect(receipt.replacementMode).toBe("constant-token");
    expect(receipt.sink).toBe("trace-export");
    expect(receipt.sourceClass).toBe("trace-attribute");
    expect(receipt.occurrenceId).toBe("write-1");
    expect(receipt.occurrenceSequence).toBe(4);
    expect(receipt.occurredAt).toBe("2026-07-30T00:00:00Z");
    expect(receipt.transformImplementationHash).toBe(
      TRACE_POLICY.transformImplementationHash,
    );

    // Section 3.3: the receipt contains no removed value, reversible token,
    // unkeyed digest, or value length.
    expect(JSON.stringify(receipt)).not.toContain(SECRET);
  });

  it("computes sourceHash over the pre-transform snapshot, not the replaced token", async () => {
    const original = { attributes: { query: SECRET, safe: "ok" } };
    const { harness: run, result } = await prepareTrace(original);
    if (result.kind !== "prepared") throw new Error("expected a prepared write");
    const receipt = result.decision.redactionReceipt as RedactionReceipt;

    const identityKey = run.keys.runIdentityKey("trace-run");
    const overRaw = computeSourceHash(identityKey, {
      sourceClass: "trace-attribute",
      sink: "trace-export",
      fieldPath: "/attributes",
      sourceSnapshot: original,
    });
    const overToken = computeSourceHash(identityKey, {
      sourceClass: "trace-attribute",
      sink: "trace-export",
      fieldPath: "/attributes",
      sourceSnapshot: { attributes: { query: REDACTION_TOKEN, safe: "ok" } },
    });
    // Section 7.1 error 2: hashing the token would attest to a source nobody
    // ever held.
    expect(receipt.sourceHash).toBe(overRaw);
    expect(receipt.sourceHash).not.toBe(overToken);
    expect(receipt.resultHash).not.toBe(receipt.sourceHash);
  });

  it("refuses to transform a value that already holds the replacement token", async () => {
    const { result } = await prepareTrace({ attributes: { query: REDACTION_TOKEN } });
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure.code).toBe("REDACTION_RECEIPT_INVALID");
  });

  it("denies a redacted derivative when the sink has no rule", async () => {
    harness = await createProtectedRun();
    const result = await harness.guard.prepare(
      {
        decisionId: "decision-no-rule",
        sourceClass: "log-field",
        sink: "runtime-log",
        policyControl: "logs",
        authorityClass: "observational",
        metadata: { span: "span-1" },
        observational: { fieldPath: "/attributes", value: { a: 1 }, ruleResolutionId: "r-1" },
        occurrence: {
          runId: "log-run",
          graphRevision: 1,
          recordKind: "event",
          recordType: "LogRecord",
          recordId: "write-1",
          sequence: 0,
        },
        occurredAt: "2026-07-30T00:00:00Z",
      },
      harness.journal.binding,
    );
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure.code).toBe("REDACTION_POLICY_INVALID");
  });

  it("refuses to mix a redacted derivative with protected authoritative refs", async () => {
    harness = await createProtectedRun({ policy: TRACE_POLICY });
    const result = await harness.guard.prepare(
      {
        decisionId: "decision-mixed",
        sourceClass: "trace-attribute",
        sink: "trace-export",
        policyControl: "traces",
        authorityClass: "observational",
        metadata: { data: {} },
        payloads: [
          {
            refPath: "/data/inputRef",
            semanticContext: { kind: "graph-input", runId: "trace-run", graphRevision: 1 },
            value: { a: 1 },
          },
        ],
        observational: { fieldPath: "/attributes", value: { a: 1 }, ruleResolutionId: "r-1" },
        occurrence: {
          runId: "trace-run",
          graphRevision: 1,
          recordKind: "event",
          recordType: "TraceExport",
          recordId: "write-1",
          sequence: 0,
        },
        occurredAt: "2026-07-30T00:00:00Z",
      },
      harness.journal.binding,
    );
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure.reason).toBe(
      "one-record-cannot-mix-redacted-and-protected-material",
    );
  });
});
