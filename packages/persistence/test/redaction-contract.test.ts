import { describe, expect, it } from "vitest";

import {
  CAPTURE_SINK_CLASSES,
  CAPTURE_SOURCE_CLASSES,
  DEFAULT_CAPTURE_POLICY,
  SINK_POLICY_ROWS,
  SOURCE_CLASSIFICATION_ROWS,
  DETERMINISTIC_TEST_KEY_REF,
  DeterministicTestKeyProvider,
  capturePolicyHash,
  computeValueMac,
  evaluateFlow,
  keyRefHash,
  isCaptureSinkClass,
  isCaptureSourceClass,
  validateCapturePolicy,
  validateCheckpointV1Alpha2Document,
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

  /**
   * Section 7 has the guard locate the sink row and then verify *the row's*
   * named policy control. Vocabulary membership is not the test. No corpus
   * fixture separates the two readings — `spec/conformance/redaction.validate.mjs`
   * refuses a flow case whose control the named sink does not declare — so the
   * case is pinned here instead, where it does not need a fixture. Before this
   * was pinned, TypeScript denied and Python authorized the write.
   */
  it("denies a vocabulary control that the named sink row does not own", () => {
    for (const [sink, control] of [
      // `database` is a real control; `event-journal` owns only `events`.
      ["event-journal", "database"],
      // `events` is a real control; `checkpoint-final` owns only `checkpointValues`.
      ["checkpoint-final", "events"],
      // `deny` is in the vocabulary and is owned by no sink at all.
      ["event-journal", "deny"],
    ] as const) {
      const row = SINK_POLICY_ROWS.find((item) => item.sink === sink);
      expect(row, sink).toBeDefined();
      expect((row?.policyControls as readonly string[]).includes(control)).toBe(false);
      const decision = evaluateFlow({
        sourceClass: "graph-input",
        sink,
        policyControl: control,
        policyEnabled: true,
      });
      expect(decision.outcome, `${sink}/${control}`).toBe("failed");
      expect(decision.code).toBe("REDACTION_POLICY_INVALID");
      expect(decision.writeAuthorized).toBe(false);
    }
  });

  /**
   * The mandated opaque replacement for a caller-controlled identifier is a
   * property of the source row, so it is reported even when the write is
   * suppressed: the host must still replace the identifier.
   */
  it("reports the mandated identifier replacement even when policy is disabled", () => {
    const decision = evaluateFlow({
      sourceClass: "caller-controlled-identifier",
      sink: "runtime-log",
      policyControl: "logs",
      policyEnabled: false,
    });
    expect(decision.outcome).toBe("suppressed");
    expect(decision.writeAuthorized).toBe(false);
    expect(decision.requiresOpaqueIdentifierReplacement).toBe(true);
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
    case "checkpoint-v1alpha2.schema.json":
      return validateCheckpointV1Alpha2Document(document);
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
    for (const wireCase of corpus.wireCases) {
      const id = wireCase["id"] as string;
      const observed = decide(wireCase["schema"] as string, wireCase["document"]);
      expect(observed.valid, `${id} verdict (${observed.valid ? "" : observed.reason})`).toBe(
        wireCase["valid"],
      );
      decided += 1;
    }
    // Every case is decided natively. There is no documented blind spot here:
    // an undecidable case would now throw out of `decide` instead of being
    // excluded from the count.
    expect(decided).toBe(34);
  });

  it("carries a native validator for every schema the corpus names", () => {
    const named = new Set(corpus.wireCases.map((wireCase) => wireCase["schema"] as string));
    expect(named.size).toBe(13);
    for (const schema of named) {
      // A missing validator throws rather than silently accepting.
      expect(() => decide(schema, {})).not.toThrow();
    }
  });

  /**
   * Section 5.3 shared deterministic test provider.
   *
   * This provider exists only so shared conformance can compare exact ciphertext
   * vectors across the TypeScript and Python lanes, which is a claim about both
   * lanes, not about this one. These constants are restated verbatim by
   * `test_the_deterministic_test_provider_matches_the_typescript_vector` in
   * `python/tests/test_redaction_corpus.py`; if either lane changes its key
   * reference, derivation, domain string, or nonce rule, exactly one of the two
   * tests goes red.
   */
  it("derives the shared cross-language key vector", () => {
    const keys = new DeterministicTestKeyProvider();
    const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
    const runId = "run-vector-1";
    const aadHash = "a".repeat(64);
    expect(keys.keyRef).toBe(DETERMINISTIC_TEST_KEY_REF);
    expect(keys.keyRef).toBe("test-key-provider/deterministic/v1alpha1");
    expect(keyRefHash(keys.keyRef)).toBe(
      "c04d0abfcb3aa0cb7c74e6134d9f0eb525f9f0e0e405fa70e0c8401395625956",
    );
    expect(hex(keys.protectionKey(runId))).toBe(
      "045d7f3efb794ef3e5e122a3bb79240c491d30df3dd3b010b63f100c2fdb3fb4",
    );
    expect(hex(keys.runIdentityKey(runId))).toBe(
      "d3d3e6c607bda59e78181d3c97d06859cff8e85d3f4f2a1c4a50949d6c3e187f",
    );
    expect(hex(keys.nonce({ runId, aadHash }))).toBe("0eb8c477da0f8264cd5b82dc");
    expect(
      computeValueMac(
        keys.runIdentityKey(runId),
        { kind: "node-input", runId, graphRevision: 1, nodeId: "n1" },
        { x: [1, 2, 3] },
      ),
    ).toBe("947f7559ba85073706bcb7accac4a1dc1c094ed1552b809633af4d78845a1ee7");
    // The nonce is a pure function of the occurrence, not of call order.
    expect(hex(keys.nonce({ runId, aadHash }))).toBe(hex(keys.nonce({ runId, aadHash })));
    expect(hex(keys.nonce({ runId, aadHash: "b".repeat(64) }))).not.toBe(
      hex(keys.nonce({ runId, aadHash })),
    );
    // The key reference is an input, not decoration.
    expect(hex(new DeterministicTestKeyProvider("other-ref").protectionKey(runId))).not.toBe(
      hex(keys.protectionKey(runId)),
    );
  });

  /**
   * `$defs.attemptFailure` is the one sub-object the event schema closes, and
   * nothing checked it: the envelope was validated, the `data` member names were
   * counted, and the object inside `failure` was never looked at. Both runtimes
   * therefore wrote a non-conforming `NodeAttemptFailed` for as long as the
   * defect existed, and each rejected the other's record.
   */
  it("rejects a NodeAttemptFailed whose failure object does not conform", () => {
    const conforming = {
      phase: "execute",
      code: "NODE_EXECUTION_FAILED",
      messageTemplate: "node-execution-failed/v1",
      retryable: false,
      causeCode: "EXECUTOR_REJECTED",
    };
    const event = (failure: unknown): unknown => ({
      apiVersion: "graphengineering.reacher-z.github.io/events/v1alpha2",
      eventId: "e1",
      type: "NodeAttemptFailed",
      timestamp: "2026-07-26T12:00:00.000Z",
      runId: "r1",
      graphRevision: 1,
      sequence: 3,
      nodeId: "root",
      attempt: 1,
      payloadHash: "a".repeat(64),
      capturePolicyHash: "b".repeat(64),
      redacted: false,
      payloadDisposition: "metadata-only",
      data: { terminal: true, failure },
    });

    expect(validateGraphEventV1Alpha2(event(conforming)).valid).toBe(true);

    const rejected: readonly [string, unknown, string][] = [
      // The exact shape both runtimes used to emit.
      ["duplicates the envelope node identity", { ...conforming, nodeId: "root" },
        "#/data/failure/nodeId"],
      ["duplicates the envelope attempt", { ...conforming, attempt: 1 },
        "#/data/failure/attempt"],
      // Producer-derived text. This is the member the whole contract exists for.
      ["carries producer text", { ...conforming, message: "db://user:pa55word@host" },
        "#/data/failure/message"],
      ["carries a host cause name", { ...conforming, causeName: "ECONNREFUSED" },
        "#/data/failure/causeName"],
      ["omits the message template",
        { phase: "execute", code: "NODE_EXECUTION_FAILED", retryable: false },
        "#/data/failure/messageTemplate"],
      ["uses a settle-without-attempt code", { ...conforming, code: "EXECUTOR_NOT_FOUND" },
        "#/data/failure/code"],
      ["invents a message template", { ...conforming, messageTemplate: "node-exploded/v1" },
        "#/data/failure/messageTemplate"],
      ["invents a cause code", { ...conforming, causeCode: "GREMLINS" },
        "#/data/failure/causeCode"],
      ["uses a non-execute phase", { ...conforming, phase: "output" },
        "#/data/failure/phase"],
      ["uses a non-boolean retry flag", { ...conforming, retryable: "no" },
        "#/data/failure/retryable"],
      ["is not an object", "NODE_EXECUTION_FAILED", "#/data/failure"],
    ];
    for (const [label, failure, path] of rejected) {
      const result = validateGraphEventV1Alpha2(event(failure));
      expect(result.valid, label).toBe(false);
      if (result.valid) continue;
      expect(result.issues.map((issue) => issue.path), label).toContain(path);
    }
  });

  /** `$defs.settledFailureCode` is closed and carries no sentinel member. */
  it("rejects a NodeSettledWithoutAttempt sentinel failure code", () => {
    const settled = (failureCode: string): unknown => ({
      apiVersion: "graphengineering.reacher-z.github.io/events/v1alpha2",
      eventId: "e2",
      type: "NodeSettledWithoutAttempt",
      timestamp: "2026-07-26T12:00:00.000Z",
      runId: "r1",
      graphRevision: 1,
      sequence: 4,
      nodeId: "root",
      payloadHash: "a".repeat(64),
      capturePolicyHash: "b".repeat(64),
      redacted: false,
      payloadDisposition: "protected-ref",
      data: {
        resultRef: { apiVersion: "x" },
        resultMac: "c".repeat(64),
        status: "skipped",
        attempts: 0,
        failureCode,
      },
    });
    expect(validateGraphEventV1Alpha2(settled("ROUTE_NOT_SELECTED")).valid).toBe(true);
    for (const code of ["SETTLED_WITHOUT_FAILURE", "NODE_EXECUTION_FAILED"]) {
      const result = validateGraphEventV1Alpha2(settled(code));
      expect(result.valid, code).toBe(false);
      if (result.valid) continue;
      expect(result.issues.map((issue) => issue.path)).toContain("#/data/failureCode");
    }
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
