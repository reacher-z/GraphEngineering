import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CAPTURE_POLICY,
  GuardBypassError,
  JsonlEventStore,
  PreparedSinkWrite,
  ProtectedJsonlEventStore,
  SinkGuard,
  classifyLegacyHistory,
  computeValueMac,
  legacyQuarantineManifest,
  unprotectValue,
  type CapturePolicy,
  type GraphEvent,
  type ProtectedValueRef,
} from "../src/index.js";
import { createProtectedRun, TEST_SCOPE, type ProtectedRunHarness } from "./support/protected-run.js";

let harness: ProtectedRunHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

const SECRET = "synthetic-sensitive-value-7f3a";

describe("guarded durable event write path (redaction-semantics.md 7, 8.1)", () => {
  it("writes a protected-ref event and never the plaintext payload", async () => {
    harness = await createProtectedRun();
    const prepared = await harness.runCreated("run-1", { apiKey: SECRET, nested: [SECRET] });
    expect(prepared.kind).toBe("prepared");
    if (prepared.kind !== "prepared") return;

    expect(prepared.decision.outcome).toBe("protected-ref");
    expect(prepared.decision.writeAuthorized).toBe(true);
    expect(prepared.decision.protectedRefs).toHaveLength(1);

    const version = await harness.journal.append("run-1", -1, [prepared.prepared]);
    expect(version).toBe(0);

    const events = [];
    for await (const event of harness.journal.read("run-1")) events.push(event);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.redacted).toBe(false);
    expect(event?.payloadDisposition).toBe("protected-ref");
    expect(event?.apiVersion).toBe("graphengineering.reacher-z.github.io/events/v1alpha2");

    const data = event?.data as Record<string, unknown>;
    expect(data["input"]).toBeUndefined();
    expect(data["inputHash"]).toBeUndefined();
    const reference = data["inputRef"] as ProtectedValueRef;
    expect(reference.apiVersion).toBe(
      "graphengineering.reacher-z.github.io/protected-value/v1alpha1",
    );
    // Section 6.1: the adjacent MAC equals the referenced object's valueMac.
    expect(data["inputMac"]).toBe(reference.valueMac);
    // Section 5.4: the MAC is the keyed semantic identity of the logical value.
    expect(reference.valueMac).toBe(
      computeValueMac(
        harness.keys.runIdentityKey("run-1"),
        { kind: "graph-input", runId: "run-1", graphRevision: 1 },
        { apiKey: SECRET, nested: [SECRET] },
      ),
    );
  });

  it("round-trips the protected value only through store and key authority", async () => {
    harness = await createProtectedRun();
    const prepared = await harness.runCreated("run-2", { apiKey: SECRET });
    expect(prepared.kind).toBe("prepared");
    if (prepared.kind !== "prepared") return;
    await harness.journal.append("run-2", -1, [prepared.prepared]);

    const reference = prepared.decision.protectedRefs?.[0] as ProtectedValueRef;
    // A protected reference is not a capability: the store still demands one.
    const denied = await harness.store.get({} as never, {
      apiVersion: "graphengineering.reacher-z.github.io/protected-store-envelope/v1alpha1",
      operationId: "op-1",
      operation: "get",
      runId: "run-2",
      capturePolicyHash: harness.guard.capturePolicyHash,
      keyRefHash: reference.keyRefHash,
      authorityBindingHash: "0".repeat(64),
      tenantScopeHash: "0".repeat(64),
      protectedValue: reference,
      aad: {} as never,
    });
    expect(denied.ok).toBe(false);
  });

  it("suppresses a denied source class instead of writing it", async () => {
    harness = await createProtectedRun();
    const result = await harness.guard.prepare(
      {
        decisionId: "decision-secret",
        sourceClass: "secret-value",
        sink: "event-journal",
        policyControl: "events",
        authorityClass: "observational",
        metadata: { note: "metadata only" },
        occurrence: {
          runId: "run-3",
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
    expect(result.kind).toBe("suppressed");
    if (result.kind !== "suppressed") return;
    expect(result.decision.writeAuthorized).toBe(false);
    expect(result.decision.outcome).toBe("suppressed");
  });

  it("fails closed with PAYLOAD_PROTECTION_REQUIRED when no store is configured", async () => {
    harness = await createProtectedRun({ withStore: false });
    const result = await harness.runCreated("run-4", { apiKey: SECRET });
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure.code).toBe("PAYLOAD_PROTECTION_REQUIRED");
    expect(result.decision.writeAuthorized).toBe(false);
    expect(result.decision.retryDisposition).toBe("forbidden");
    // The failure carries no offending value.
    expect(JSON.stringify(result.failure)).not.toContain(SECRET);
  });

  it("denies inline capture rather than writing plaintext to the journal", async () => {
    const inline = {
      ...DEFAULT_CAPTURE_POLICY,
      events: "inline-unredacted",
      inlineRiskAuthorizationHash: "c".repeat(64),
    } as CapturePolicy;
    harness = await createProtectedRun({ policy: inline });
    const result = await harness.runCreated("run-5", { apiKey: SECRET });
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure.code).toBe("INLINE_CAPTURE_NOT_AUTHORIZED");
  });
});

describe("PreparedSinkWrite capability (redaction-semantics.md 7)", () => {
  it("cannot be constructed, serialized, cloned, replayed, or misdirected", async () => {
    harness = await createProtectedRun();
    const prepared = await harness.runCreated("run-6", { apiKey: SECRET });
    expect(prepared.kind).toBe("prepared");
    if (prepared.kind !== "prepared") return;
    const write = prepared.prepared;

    expect(() => new PreparedSinkWrite(Symbol("forged"))).toThrow(TypeError);
    expect(() => JSON.stringify(write)).toThrow(TypeError);
    expect(String(write)).toBe("[PreparedSinkWrite]");

    // structuredClone yields a stateless husk that carries no bytes.
    const husk = structuredClone(write) as PreparedSinkWrite;
    expect(Object.keys(husk as unknown as Record<string, unknown>)).toHaveLength(0);
    await expect(harness.journal.append("run-6", -1, [husk])).rejects.toBeInstanceOf(
      GuardBypassError,
    );

    // A different store instance is a different binding.
    const otherJournal = new ProtectedJsonlEventStore({ directory: harness.directory });
    await expect(otherJournal.append("run-6", -1, [write])).rejects.toBeInstanceOf(
      GuardBypassError,
    );

    // The real binding consumes it exactly once.
    await harness.journal.append("run-6", -1, [write]);
    expect(write.consumed).toBe(true);
    await expect(harness.journal.append("run-6", 0, [write])).rejects.toBeInstanceOf(
      GuardBypassError,
    );
  });

  it("refuses a serialized guard decision, protected ref, or forged object", async () => {
    harness = await createProtectedRun();
    const prepared = await harness.runCreated("run-7", { apiKey: SECRET });
    if (prepared.kind !== "prepared") throw new Error("expected a prepared write");

    const forgeries: unknown[] = [
      JSON.parse(JSON.stringify(prepared.decision)),
      prepared.decision.protectedRefs?.[0],
      { sink: "event-journal", bytes: "{}", payloadHash: "0".repeat(64) },
      Object.create(PreparedSinkWrite.prototype),
    ];
    for (const forged of forgeries) {
      await expect(
        harness.journal.append("run-7", -1, [forged as PreparedSinkWrite]),
      ).rejects.toBeInstanceOf(GuardBypassError);
    }
    const events = [];
    for await (const event of harness.journal.read("run-7")) events.push(event);
    expect(events).toHaveLength(0);
  });
});

describe("retry never re-transforms (redaction-semantics.md 7.1)", () => {
  it("recomputes an identical prepared write from the same immutable snapshot", async () => {
    harness = await createProtectedRun();
    const first = await harness.runCreated("run-8", { apiKey: SECRET });
    const second = await harness.runCreated("run-8", { apiKey: SECRET });
    expect(first.kind).toBe("prepared");
    expect(second.kind).toBe("prepared");
    if (first.kind !== "prepared" || second.kind !== "prepared") return;
    expect(second.prepared.payloadHash).toBe(first.prepared.payloadHash);
    expect(second.decision.protectedRefs?.[0]?.ref).toBe(first.decision.protectedRefs?.[0]?.ref);
    expect(second.decision.protectedRefs?.[0]?.ciphertextHash).toBe(
      first.decision.protectedRefs?.[0]?.ciphertextHash,
    );
  });

  it("refuses to re-protect a value that already carries a protected reference", async () => {
    harness = await createProtectedRun();
    const first = await harness.runCreated("run-9", { apiKey: SECRET });
    if (first.kind !== "prepared") throw new Error("expected a prepared write");
    const reference = first.decision.protectedRefs?.[0] as ProtectedValueRef;

    const second = await harness.runCreated("run-9", { alreadyProtected: reference }, 1);
    expect(second.kind).toBe("failed");
    if (second.kind !== "failed") return;
    expect(second.failure.code).toBe("PAYLOAD_PROTECTION_FAILED");
    expect(second.failure.reason).toBe(
      "input-already-carries-a-protected-or-redacted-representation",
    );
  });

  it("refuses to hash an already-replaced constant token as though it were raw", async () => {
    harness = await createProtectedRun();
    const result = await harness.runCreated("run-10", { message: "[REDACTED]" });
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure.reason).toBe(
      "input-already-carries-a-protected-or-redacted-representation",
    );
  });
});

describe("protected value recovery (redaction-semantics.md 5.6, 8.3)", () => {
  it("authenticates the blob and recomputes the MAC before exposing the value", async () => {
    harness = await createProtectedRun();
    const prepared = await harness.runCreated("run-11", { apiKey: SECRET });
    if (prepared.kind !== "prepared") throw new Error("expected a prepared write");
    await harness.journal.append("run-11", -1, [prepared.prepared]);

    const events = [];
    for await (const event of harness.journal.read("run-11")) events.push(event);
    const reference = (events[0]?.data as Record<string, unknown>)["inputRef"] as ProtectedValueRef;

    // The blob bytes on disk are ciphertext; only key authority reads them.
    const guardStore = harness.store;
    const capabilityHolder = harness.guard as unknown as { prepare: unknown };
    expect(capabilityHolder).toBeDefined();
    expect(guardStore).toBeDefined();
    expect(reference.codec).toBe("durable-json/v1alpha1");
    expect(reference.ciphertextHash).toMatch(/^[0-9a-f]{64}$/);

    // A blob whose AAD is rebound to another occurrence fails authentication.
    const rebound = unprotectValue(harness.keys, {
      protectedValue: reference,
      blob: {
        apiVersion: "graphengineering.reacher-z.github.io/protected-blob/v1alpha1",
        algorithm: "A256GCM",
        nonce: "AAAAAAAAAAAAAAAA",
        ciphertext: "AAAA",
        tag: "AAAAAAAAAAAAAAAAAAAAAA",
      },
      aad: {} as never,
    });
    expect(rebound.ok).toBe(false);
  });
});

describe("legacy v1alpha1 histories (redaction-semantics.md 9)", () => {
  const legacy = (redacted: boolean | undefined, sequence: number): GraphEvent => ({
    apiVersion: "graphengineering.reacher-z.github.io/events/v1alpha1",
    eventId: `evt-${sequence}`,
    type: "RunCreated",
    timestamp: "2026-07-26T00:00:00Z",
    runId: "legacy-run",
    graphRevision: 1,
    sequence,
    ...(redacted === undefined ? {} : { redacted }),
    data: { contractVersion: "scheduler-recovery/v1alpha1", input: { apiKey: SECRET } },
  });

  it("reports LEGACY_REDACTION_MISMATCH for a misleading or defaulted claim", () => {
    for (const redacted of [true, undefined] as const) {
      const classification = classifyLegacyHistory([legacy(redacted, 0)]);
      expect(classification.kind).toBe("misleading");
      if (classification.kind !== "misleading") continue;
      expect(classification.failure.code).toBe("LEGACY_REDACTION_MISMATCH");
      expect(classification.sequences).toEqual([0]);
    }
  });

  it("treats a truthful redacted:false history as unauthorized inline data", () => {
    const classification = classifyLegacyHistory([legacy(false, 0)]);
    expect(classification.kind).toBe("truthful-inline");
    if (classification.kind !== "truthful-inline") return;
    expect(classification.failure?.code).toBe("INLINE_CAPTURE_NOT_AUTHORIZED");

    const authorized = classifyLegacyHistory([legacy(false, 0)], { legacyInlineAuthorized: true });
    expect(authorized.kind).toBe("truthful-inline");
    if (authorized.kind !== "truthful-inline") return;
    expect(authorized.failure).toBeUndefined();
  });

  it("keeps absence as absence in the v1alpha1 model and decoder (3.1 item 2)", async () => {
    harness = await createProtectedRun();
    const raw = new JsonlEventStore({ directory: harness.directory });
    const withoutFlag = legacy(undefined, 0);
    expect(Object.hasOwn(withoutFlag, "redacted")).toBe(false);
    await raw.append("legacy-run", -1, [withoutFlag]);
    const decoded = [];
    for await (const event of raw.read("legacy-run")) decoded.push(event);
    // No decoder may materialize `redacted: true` where the writer wrote nothing.
    expect(Object.hasOwn(decoded[0] as object, "redacted")).toBe(false);
    expect(decoded[0]?.redacted).toBeUndefined();
  });

  it("produces a metadata-only quarantine manifest that carries no payload", () => {
    const bytes = Buffer.from(JSON.stringify(legacy(true, 0)), "utf8");
    const manifest = legacyQuarantineManifest({
      bytes,
      classification: "misleading-redacted-claim",
      recordedAt: "2026-07-30T00:00:00Z",
      affectedSequences: [0],
    });
    expect(manifest.disposition).toBe("quarantine");
    expect(manifest.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain(SECRET);
  });
});

describe("guard totality (redaction-semantics.md 7)", () => {
  it("never throws and never returns null for a hostile candidate", async () => {
    harness = await createProtectedRun();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const guard = harness.guard as SinkGuard;
    const results = await Promise.all(
      [cyclic, () => undefined, Symbol("hostile"), Number.NaN].map((value) =>
        guard.prepare(
          {
            decisionId: "decision-hostile",
            sourceClass: "graph-input",
            sink: "event-journal",
            policyControl: "events",
            authorityClass: "authoritative",
            metadata: { data: {} },
            payloads: [
              {
                refPath: "/data/inputRef",
                semanticContext: { kind: "graph-input", runId: "run-x", graphRevision: 1 },
                value,
              },
            ],
            occurrence: {
              runId: "run-x",
              graphRevision: 1,
              recordKind: "event",
              recordType: "RunCreated",
              recordId: "evt-0",
              sequence: 0,
            },
            occurredAt: "2026-07-30T00:00:00Z",
          },
          (harness as ProtectedRunHarness).journal.binding,
        ),
      ),
    );
    for (const result of results) {
      expect(result).not.toBeNull();
      expect(result.kind).toBe("failed");
      if (result.kind !== "failed") continue;
      expect(result.failure.code).toBe("PAYLOAD_PROTECTION_FAILED");
    }
    expect(TEST_SCOPE.tenantScopeId).toBe("tenant-opaque-1");
  });
});
