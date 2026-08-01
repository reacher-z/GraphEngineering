import { describe, expect, it } from "vitest";

import {
  CAPTURE_SINK_CLASSES,
  CAPTURE_SOURCE_CLASSES,
  DEFAULT_CAPTURE_POLICY,
  SINK_POLICY_ROWS,
  SOURCE_CLASSIFICATION_ROWS,
  capturePolicyHash,
  evaluateFlow,
  isCaptureSinkClass,
  isCaptureSourceClass,
  validateCapturePolicy,
  validateGraphEventV1Alpha2,
  validatePayloadDispositionDocument,
  validateProtectedAadDocument,
  validateProtectedBlobDocument,
  validateProtectedStoreEnvelopeDocument,
  validateProtectedValueRefDocument,
  validateRedactionReceiptDocument,
  validateRedactionRuleDocument,
  validateSinkGuardDecisionDocument,
  type CapturePolicy,
  type DocumentCheck,
} from "../src/index.js";
import { loadRedactionCorpus, loadSpecSchema } from "./support/redaction-corpus.js";

const corpus = loadRedactionCorpus();

/**
 * Checkpoint projection support is `D9-DURABLE-EXT-SPEC-031` work and is not
 * implemented by this lane, so the two `checkpoint-v1alpha2.schema.json` wire
 * cases are not decided natively here. The set is asserted exactly so it cannot
 * quietly grow.
 */
const UNDECIDED_WIRE_CASES = new Set([
  "checkpoint-protected-valid",
  "checkpoint-arbitrary-inline-state-rejected",
]);

describe("closed inventories (redaction-semantics.md 1.2)", () => {
  it("carries the shipped 57-source and 54-sink enums verbatim", () => {
    expect([...CAPTURE_SOURCE_CLASSES]).toEqual(loadSpecSchema("capture-source.schema.json")["enum"]);
    expect([...CAPTURE_SINK_CLASSES]).toEqual(loadSpecSchema("capture-sink.schema.json")["enum"]);
    expect([...CAPTURE_SOURCE_CLASSES]).toEqual(corpus.sourceInventory);
    expect([...CAPTURE_SINK_CLASSES]).toEqual(corpus.sinkInventory);
    expect(CAPTURE_SOURCE_CLASSES.length).toBe(57);
    expect(CAPTURE_SINK_CLASSES.length).toBe(54);
  });

  it("has exactly one native classification row per source and policy row per sink", () => {
    expect(SOURCE_CLASSIFICATION_ROWS.map((row) => row.sourceClass)).toEqual(
      corpus.sensitiveFieldCases.map((row) => row["sourceClass"]),
    );
    expect(SINK_POLICY_ROWS.map((row) => row.sink)).toEqual(
      corpus.sinkPolicyCases.map((row) => row["sink"]),
    );
    for (const row of SOURCE_CLASSIFICATION_ROWS) {
      const literal = corpus.sensitiveFieldCases.find((item) => item["sourceClass"] === row.sourceClass);
      expect(literal, row.sourceClass).toBeDefined();
      expect(row.policyControl).toBe(literal?.["policyControl"]);
      expect(row.defaultAction).toBe(literal?.["defaultAction"]);
      expect(row.mayBeMetadata).toBe(literal?.["mayBeMetadata"]);
      expect(row.mayFeedScheduler).toBe(literal?.["mayFeedScheduler"]);
      expect(row.identifierTreatment).toBe(literal?.["identifierTreatment"]);
    }
    for (const row of SINK_POLICY_ROWS) {
      const literal = corpus.sinkPolicyCases.find((item) => item["sink"] === row.sink);
      expect(literal, row.sink).toBeDefined();
      expect([...row.policyControls]).toEqual(literal?.["policyControls"]);
      expect(row.acceptsProtected).toBe(literal?.["acceptsProtected"]);
      expect(row.acceptsMetadata).toBe(literal?.["acceptsMetadata"]);
      expect(row.defaultEnabled).toBe(literal?.["defaultEnabled"]);
      expect(row.family).toBe(literal?.["family"]);
    }
  });

  it("covers the complete 3,078-pair Cartesian domain without an unknown row", () => {
    let pairs = 0;
    for (const sourceClass of CAPTURE_SOURCE_CLASSES) {
      for (const sink of CAPTURE_SINK_CLASSES) {
        const row = SINK_POLICY_ROWS.find((item) => item.sink === sink);
        const control = row?.policyControls[0];
        expect(control).toBeDefined();
        const decision = evaluateFlow({
          sourceClass,
          sink,
          policyControl: control as string,
          policyEnabled: true,
        });
        expect(decision.outcome).not.toBe("failed");
        pairs += 1;
      }
    }
    expect(pairs).toBe(corpus.flowPolicy["cartesianProductCount"]);
    expect(pairs).toBe(3078);
  });

  it("denies an unknown source, sink, or control with REDACTION_POLICY_INVALID", () => {
    for (const request of [
      { sourceClass: "future-source", sink: "event-journal", policyControl: "events" },
      { sourceClass: "graph-input", sink: "future-sink", policyControl: "events" },
      { sourceClass: "graph-input", sink: "event-journal", policyControl: "future-control" },
    ]) {
      const decision = evaluateFlow({ ...request, policyEnabled: true });
      expect(decision.outcome).toBe("failed");
      expect(decision.code).toBe("REDACTION_POLICY_INVALID");
      expect(decision.writeAuthorized).toBe(false);
    }
    expect(isCaptureSourceClass("future-source")).toBe(false);
    expect(isCaptureSinkClass("future-sink")).toBe(false);
  });
});

describe("source x sink evaluator (redaction-semantics.md 1.2, 7)", () => {
  it("reproduces every literal flowCase outcome in the shipped corpus", () => {
    expect(corpus.flowCases.length).toBe(39);
    for (const flowCase of corpus.flowCases) {
      const decision = evaluateFlow({
        sourceClass: flowCase["sourceClass"] as string,
        sink: flowCase["sink"] as string,
        policyControl: flowCase["policyControl"] as string,
        policyEnabled: flowCase["policyEnabled"] as boolean,
      });
      const expected = flowCase["expected"] as Record<string, unknown>;
      const known =
        flowCase["knownSource"] === true &&
        flowCase["knownSink"] === true &&
        flowCase["knownControl"] === true;
      expect(decision.outcome, flowCase["id"] as string).toBe(
        known ? expected["outcome"] : "failed",
      );
      expect(decision.writeAuthorized, flowCase["id"] as string).toBe(
        expected["writeAuthorized"],
      );
      if (!known) expect(decision.code).toBe(expected["code"]);
    }
  });
});

function decide(schema: string, document: unknown): DocumentCheck {
  switch (schema) {
    case "capture-source.schema.json":
      return isCaptureSourceClass(document) ? { valid: true } : { valid: false, reason: "unknown" };
    case "capture-sink.schema.json":
      return isCaptureSinkClass(document) ? { valid: true } : { valid: false, reason: "unknown" };
    case "capture-policy.schema.json": {
      const result = validateCapturePolicy(document as CapturePolicy);
      return result.valid ? { valid: true } : { valid: false, reason: result.failure.reason };
    }
    case "payload-disposition.schema.json":
      return validatePayloadDispositionDocument(document);
    case "protected-value.schema.json":
      return validateProtectedValueRefDocument(document);
    case "protected-blob.schema.json":
      return validateProtectedBlobDocument(document);
    case "protected-aad.schema.json":
      return validateProtectedAadDocument(document);
    case "protected-store-envelope.schema.json":
      return validateProtectedStoreEnvelopeDocument(document);
    case "redaction-rule.schema.json":
      return validateRedactionRuleDocument(document);
    case "redaction-receipt.schema.json":
      return validateRedactionReceiptDocument(document);
    case "sink-guard-decision.schema.json":
      return validateSinkGuardDecisionDocument(document);
    case "event-v1alpha2.schema.json": {
      const result = validateGraphEventV1Alpha2(document);
      return result.valid
        ? { valid: true }
        : { valid: false, reason: result.issues[0]?.path ?? "#" };
    }
    default:
      throw new Error(`no native validator for ${schema}`);
  }
}

describe("closed wire documents (redaction-semantics.md 3, 4, 5, 6, 7)", () => {
  it("decides every literal wireCase the same way the shipped corpus does", () => {
    expect(corpus.wireCases.length).toBe(34);
    let decided = 0;
    const skipped: string[] = [];
    for (const wireCase of corpus.wireCases) {
      const id = wireCase["id"] as string;
      if (UNDECIDED_WIRE_CASES.has(id)) {
        skipped.push(id);
        continue;
      }
      const observed = decide(wireCase["schema"] as string, wireCase["document"]);
      expect(observed.valid, `${id} verdict (${observed.valid ? "" : observed.reason})`).toBe(
        wireCase["valid"],
      );
      decided += 1;
    }
    expect(new Set(skipped)).toEqual(UNDECIDED_WIRE_CASES);
    expect(decided).toBe(32);
  });

  it("keeps the corpus honest-claim flags untouched", () => {
    // This lane must never flip a corpus claim flag; it only reads them.
    expect(corpus.implementationClaim).toBe(false);
    expect(corpus.contractStatus).toBe("contract-only-native-implementation-required");
  });
});

describe("effective capture policy (redaction-semantics.md 4)", () => {
  it("hashes the default stable profile deterministically", () => {
    const first = capturePolicyHash(DEFAULT_CAPTURE_POLICY);
    const second = capturePolicyHash({ ...DEFAULT_CAPTURE_POLICY });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it("denies an inline mode without a bound risk authorization", () => {
    const inline = { ...DEFAULT_CAPTURE_POLICY, logs: "inline-unredacted" } as CapturePolicy;
    const result = validateCapturePolicy(inline);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.failure.code).toBe("REDACTION_POLICY_INVALID");
  });

  it("denies a redacted mode with no matching rule", () => {
    const redacted = { ...DEFAULT_CAPTURE_POLICY, traces: "redacted" } as CapturePolicy;
    const result = validateCapturePolicy(redacted);
    expect(result.valid).toBe(false);
  });

  it("requires a policy at all", () => {
    const result = validateCapturePolicy(undefined);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.failure.code).toBe("REDACTION_POLICY_REQUIRED");
  });
});
