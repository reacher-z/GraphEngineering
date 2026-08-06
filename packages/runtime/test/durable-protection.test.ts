import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { GraphSpec, NodeSpec } from "@graph-engineering/core";
import {
  GRAPH_EVENT_API_VERSION,
  JsonlEventStore,
  MemoryEventStore,
  controlEnabled,
  policyEnabledFor,
  scanBytesForCanaries,
  type CanaryDetection,
  type GraphEvent,
  type SeededCanary,
} from "@graph-engineering/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DurableRunError,
  diagnosticEvidenceAuthorized,
  inspectLegacyDurableHistory,
  resumeDurableGraphRun,
  startDurableGraphRun,
  type DurablePayloadProtection,
} from "../src/index.js";
import {
  fileProtection,
  memoryProtection,
  persistedHistory,
  recoveredHistory,
  TEST_CAPTURE_POLICY,
  type FileProtectionHarness,
} from "./support/protected-durable.js";

let harness: FileProtectionHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

function node(id: string, overrides: Partial<NodeSpec> = {}): NodeSpec {
  return {
    id,
    kind: "agent",
    inputSchema: {},
    outputSchema: {},
    config: {},
    sideEffects: "none",
    ...overrides,
  };
}

function graph(overrides: Partial<GraphSpec> = {}): GraphSpec {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "durable-protection", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["root"],
    outputs: { result: { node: "root" } },
    nodes: [node("root")],
    edges: [],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * Section 12 seeded canary campaign, at the durable runtime layer
 * ---------------------------------------------------------------------- */

/**
 * Four distinct synthetic canaries, one per source a provider-free durable run
 * can actually populate: the graph input, the bound node input (derived from the
 * graph input), the executor output, and a thrown executor error.
 *
 * They have no meaning outside this test. The scan below walks every byte of
 * every file the durable write path produced and checks the literal UTF-8,
 * JSON-escaped, URL-encoded, base64, base64url, hexadecimal, UTF-16 LE and
 * UTF-16 BE spellings plus gzip/deflate members.
 */
const CANARIES: readonly SeededCanary[] = Object.freeze([
  { canaryId: "durable-graph-input", value: "GE-CANARY-7a13c0d9e42b-graph-input" },
  { canaryId: "durable-node-output", value: "GE-CANARY-51fd8b6a2c07-node-output" },
  { canaryId: "durable-node-error", value: "GE-CANARY-9c04e7f13a58-node-error" },
  { canaryId: "durable-run-output", value: "GE-CANARY-2b86da405fe1-run-output" },
]);

async function walkFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
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
): Promise<{ files: string[]; detections: Array<CanaryDetection & { file: string }> }> {
  const files = await walkFiles(root);
  const detections: Array<CanaryDetection & { file: string }> = [];
  for (const file of files) {
    if (!(await stat(file)).isFile()) continue;
    const bytes = await readFile(file);
    for (const detection of scanBytesForCanaries(bytes, CANARIES)) {
      detections.push({ ...detection, file });
    }
  }
  return { files, detections };
}

describe("durable seeded canary campaign (redaction-semantics.md 12)", () => {
  it("leaves no canary byte on disk after a real durable graph run", async () => {
    harness = await fileProtection();
    const chain = graph({
      outputs: { result: { node: "second" } },
      nodes: [node("root", { retry: { maxAttempts: 2 } }), node("second")],
      edges: [{ id: "root-second", from: { node: "root" }, to: { node: "second" } }],
    });
    let attempts = 0;
    const result = await startDurableGraphRun(
      chain,
      { credentials: { apiKey: CANARIES[0]!.value }, history: [{ note: CANARIES[0]!.value }] },
      {
        runId: "canary-durable-run",
        implementationId: "v1",
        protection: harness.protection,
        nodeExecutors: {
          root: (context) => {
            attempts += 1;
            // The first attempt throws with a seeded message. Section 6.1 sends
            // that text to protected evidence, never to the inline envelope.
            if (attempts === 1) throw new Error(`upstream rejected ${CANARIES[2]!.value}`);
            return { echoed: context.input, secret: CANARIES[1]!.value };
          },
          second: (context) => ({ passed: context.input, final: CANARIES[3]!.value }),
        },
      },
    );
    expect(result.status).toBe("succeeded");
    expect(attempts).toBe(2);

    const scan = await scanDirectory(harness.directory);
    // The scan must have had something to look at: the journal plus one blob per
    // protected occurrence.
    expect(scan.files.some((file) => file.endsWith(".jsonl"))).toBe(true);
    expect(scan.files.filter((file) => file.endsWith(".blob")).length).toBeGreaterThanOrEqual(6);
    // Section 5.6: no plaintext temporary file is left behind.
    expect(scan.files.filter((file) => file.endsWith(".tmp"))).toEqual([]);
    expect(scan.detections).toEqual([]);

    // The run really did carry the seeded values end to end.
    expect(result.output).toMatchObject({
      result: { final: CANARIES[3]!.value },
    });
  });

  it("is a real scan: the same seeds through the ungated v1alpha1 writer are found", async () => {
    // Section 12 requires an intentionally unsafe positive control that must
    // fail. `JsonlEventStore` is the legacy inline writer this cut displaces.
    harness = await fileProtection();
    const raw = new JsonlEventStore({ directory: harness.directory });
    const event: GraphEvent = {
      apiVersion: GRAPH_EVENT_API_VERSION,
      eventId: "evt-0",
      type: "RunCreated",
      timestamp: "2026-07-30T00:00:00Z",
      runId: "unsafe-control",
      graphRevision: 1,
      sequence: 0,
      redacted: false,
      data: { input: { credentials: { apiKey: CANARIES[0]!.value } } },
    };
    await raw.append("unsafe-control", -1, [event]);

    const scan = await scanDirectory(harness.directory);
    expect(scan.detections.map((detection) => detection.canaryId)).toContain(
      "durable-graph-input",
    );
    expect(scan.detections[0]?.form).toBe("utf8");
  });

  it("checks the encodings the campaign claims to check", () => {
    const value = CANARIES[1]!.value;
    const forms = new Set(
      scanBytesForCanaries(
        Buffer.concat([
          Buffer.from(value, "utf8"),
          Buffer.from(Buffer.from(value, "utf8").toString("base64url"), "utf8"),
          Buffer.from(Buffer.from(value, "utf8").toString("hex"), "utf8"),
          Buffer.from(value, "utf16le"),
        ]),
        CANARIES,
      ).map((detection) => detection.form),
    );
    expect(forms.has("utf8")).toBe(true);
    expect(forms.has("base64url")).toBe(true);
    expect(forms.has("hex")).toBe(true);
    expect(forms.has("utf16le")).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * Section 4.2 fail-closed behaviour
 * ---------------------------------------------------------------------- */

describe("durable payload protection is mandatory (redaction-semantics.md 4.2)", () => {
  const unconfigured = [
    ["no protection at all", undefined],
    ["no payload store", { ...memoryProtection(), payloadStore: undefined }],
    ["no key provider", { ...memoryProtection(), keys: undefined }],
    ["no guarded journal", { ...memoryProtection(), journal: undefined }],
  ] as const;

  for (const [name, protection] of unconfigured) {
    it(`refuses to start a durable run with ${name}`, async () => {
      const executor = vi.fn(() => "must-not-run");
      await expect(
        startDurableGraphRun(graph(), { value: 1 }, {
          runId: "unprotected-start",
          implementationId: "v1",
          protection: protection as unknown as DurablePayloadProtection,
          nodeExecutors: { root: executor },
        }),
      ).rejects.toMatchObject({
        name: "DurableRunError",
        code: "PAYLOAD_PROTECTION_REQUIRED",
      });
      expect(executor).not.toHaveBeenCalled();
    });

    it(`refuses to resume a durable run with ${name}`, async () => {
      const executor = vi.fn(() => "must-not-run");
      await expect(
        resumeDurableGraphRun(graph(), {
          runId: "unprotected-resume",
          implementationId: "v1",
          protection: protection as unknown as DurablePayloadProtection,
          nodeExecutors: { root: executor },
        }),
      ).rejects.toMatchObject({ code: "PAYLOAD_PROTECTION_REQUIRED" });
      expect(executor).not.toHaveBeenCalled();
    });
  }

  it("writes nothing at all when it refuses", async () => {
    harness = await fileProtection();
    await expect(
      startDurableGraphRun(graph(), { value: 1 }, {
        runId: "unprotected-no-write",
        implementationId: "v1",
        protection: { ...harness.protection, keys: undefined } as unknown as
          DurablePayloadProtection,
        nodeExecutors: { root: () => "never" },
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_PROTECTION_REQUIRED" });
    await expect(readdir(harness.directory)).resolves.toEqual([]);
  });

  it("keeps no plaintext payload in the persisted envelope", async () => {
    const protection = memoryProtection();
    await startDurableGraphRun(graph(), { seed: "sensitive-graph-input" }, {
      runId: "envelope-shape",
      implementationId: "v1",
      protection,
      nodeExecutors: { root: () => ({ note: "sensitive-node-output" }) },
    });
    const persisted = await persistedHistory(protection, "envelope-shape");
    const wire = JSON.stringify(persisted);
    expect(wire).not.toContain("sensitive-graph-input");
    expect(wire).not.toContain("sensitive-node-output");
    for (const event of persisted) {
      expect(event.redacted).toBe(false);
      expect(["metadata-only", "protected-ref"]).toContain(event.payloadDisposition);
      expect(event.capturePolicyHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(persisted[0]?.data.contractVersion).toBe("scheduler-recovery/v1alpha2");
    expect(persisted[0]?.payloadDisposition).toBe("protected-ref");
  });

  it("keeps raw attempt-failure text out of the envelope under the default profile", async () => {
    const protection = memoryProtection();
    const retrying = graph({ nodes: [node("root", { retry: { maxAttempts: 1 } })] });
    await startDurableGraphRun(retrying, {}, {
      runId: "failure-evidence",
      implementationId: "v1",
      protection,
      nodeExecutors: {
        root: () => {
          throw new Error("connection to db://user:pa55word@host refused");
        },
      },
    });
    const persisted = await persistedHistory(protection, "failure-evidence");
    const failed = persisted.find((event) => event.type === "NodeAttemptFailed");
    expect(failed).toBeDefined();
    expect(JSON.stringify(failed)).not.toContain("pa55word");
    // `$defs.attemptFailure` closes the object at exactly these members. `nodeId`
    // and `attempt` are envelope members and are not duplicated here; `message`
    // and `causeName` are producer-derived text and never reach the wire.
    expect(Object.keys(failed?.data.failure as object).sort()).toEqual([
      "causeCode", "code", "messageTemplate", "phase", "retryable",
    ]);
    expect(failed?.data.failure).toEqual({
      phase: "execute",
      code: "NODE_EXECUTION_FAILED",
      messageTemplate: "node-execution-failed/v1",
      retryable: false,
      causeCode: "EXECUTOR_REJECTED",
    });
    // Section 6.1: `exception-message` is `defaultAction: "off"`, so the default
    // profile captures no evidence at all and the record is the metadata-only
    // shape. The raw text is not protected here — it is simply never taken.
    expect(failed?.payloadDisposition).toBe("metadata-only");
    expect(Object.keys(failed?.data as object).sort()).toEqual(["failure", "terminal"]);
    // The recovered projection is the wire projection: there is no evidence to
    // resolve, and no prose anywhere. A replayed history rebuilds the message
    // from the template identifier, so both lanes reconstruct the same result.
    const recovered = await recoveredHistory(protection, "failure-evidence");
    const recoveredFailure = recovered.find((event) => event.type === "NodeAttemptFailed");
    expect(recoveredFailure?.data.failure).toEqual(failed?.data.failure);
    expect(JSON.stringify(recoveredFailure)).not.toContain("pa55word");
  });

  it("protects the raw text as evidence under errors: protected-evidence", async () => {
    // The same run under a policy that explicitly selects the one lever the
    // spec names. Section 6.1: "optional raw evidenceRef / evidenceMac only
    // under explicit protected-evidence policy" — the `errors` control, the
    // exception-message source row's control, must itself select
    // `protected-evidence`.
    const protection = memoryProtection({
      policy: { ...TEST_CAPTURE_POLICY, errors: "protected-evidence" },
    });
    const retrying = graph({ nodes: [node("root", { retry: { maxAttempts: 1 } })] });
    await startDurableGraphRun(retrying, {}, {
      runId: "failure-evidence-widened",
      implementationId: "v1",
      protection,
      nodeExecutors: {
        root: () => {
          throw new Error("connection to db://user:pa55word@host refused");
        },
      },
    });
    const persisted = await persistedHistory(protection, "failure-evidence-widened");
    const failed = persisted.find((event) => event.type === "NodeAttemptFailed");
    expect(failed).toBeDefined();
    // The disposition follows the evidence, and the secret still never appears
    // in the envelope.
    expect(failed?.payloadDisposition).toBe("protected-ref");
    expect(Object.keys(failed?.data as object).sort()).toEqual([
      "evidenceMac", "evidenceRef", "failure", "terminal",
    ]);
    expect(JSON.stringify(failed)).not.toContain("pa55word");
    // The evidence is recoverable by an authorized reader.
    const recovered = await recoveredHistory(protection, "failure-evidence-widened");
    const recoveredFailure = recovered.find((event) => event.type === "NodeAttemptFailed");
    expect((recoveredFailure?.data.failure as { message: string }).message).toContain("pa55word");
  });

  it("captures no evidence under errors: codes-only, a disabled mode", async () => {
    // Section 1.2/4.1: codes-only means stable codes only, with no payload
    // evidence in any form, so the `errors` control is disabled and the record
    // stays the metadata-only shape even though codes-only differs from the
    // default profile's codes-and-sanitized-message.
    const protection = memoryProtection({
      policy: { ...TEST_CAPTURE_POLICY, errors: "codes-only" },
    });
    const retrying = graph({ nodes: [node("root", { retry: { maxAttempts: 1 } })] });
    await startDurableGraphRun(retrying, {}, {
      runId: "failure-evidence-codes-only",
      implementationId: "v1",
      protection,
      nodeExecutors: {
        root: () => {
          throw new Error("connection to db://user:pa55word@host refused");
        },
      },
    });
    const persisted = await persistedHistory(protection, "failure-evidence-codes-only");
    const failed = persisted.find((event) => event.type === "NodeAttemptFailed");
    expect(failed?.payloadDisposition).toBe("metadata-only");
    expect(Object.keys(failed?.data as object).sort()).toEqual(["failure", "terminal"]);
    expect(JSON.stringify(persisted)).not.toContain("pa55word");
  });

  it("does not treat an unrelated widened control as protected-evidence policy", async () => {
    // Section 6.1: widening the event sink's own control (`events`) is not the
    // spec-named lever. Only `errors: "protected-evidence"` flips the
    // NodeAttemptFailed evidence branch; everything else keeps the
    // metadata-only shape.
    const protection = memoryProtection({
      policy: { ...TEST_CAPTURE_POLICY, events: "allow-redacted" },
    });
    const retrying = graph({ nodes: [node("root", { retry: { maxAttempts: 1 } })] });
    await startDurableGraphRun(retrying, {}, {
      runId: "failure-evidence-events-widened",
      implementationId: "v1",
      protection,
      nodeExecutors: {
        root: () => {
          throw new Error("connection to db://user:pa55word@host refused");
        },
      },
    });
    const persisted = await persistedHistory(protection, "failure-evidence-events-widened");
    const failed = persisted.find((event) => event.type === "NodeAttemptFailed");
    expect(failed?.payloadDisposition).toBe("metadata-only");
    expect(Object.keys(failed?.data as object).sort()).toEqual(["failure", "terminal"]);
    expect(JSON.stringify(persisted)).not.toContain("pa55word");
  });

  it("evaluates the shared Section 6.1/1.2 evidence predicate mode by mode", () => {
    // The pure predicate both language lanes share. `errors` is the only lever:
    // protected-evidence alone flips it, codes-only is disabled, and no other
    // control's widening substitutes for the errors mode.
    const cases: ReadonlyArray<readonly [Partial<typeof TEST_CAPTURE_POLICY>, boolean]> = [
      [{}, false],
      [{ errors: "protected-evidence" }, true],
      [{ errors: "codes-only" }, false],
      [{ errors: "codes-and-sanitized-message" }, false],
      [{ events: "allow-redacted" }, false],
      [{ errors: "protected-evidence", events: "allow-redacted" }, true],
    ];
    for (const [overrides, expected] of cases) {
      expect(
        diagnosticEvidenceAuthorized({ ...TEST_CAPTURE_POLICY, ...overrides }, "event-journal"),
      ).toBe(expected);
    }
  });

  it("pins codes-only as a disabled mode in the pair-enablement formula", () => {
    // Section 1.2: enablement spans the union of the source row's control and
    // the sink row's controls. `errors: "codes-only"` widens the union away
    // from the default profile but is itself disabled, so the pair stays off;
    // `errors: "protected-evidence"` both widens and enables it.
    const pair = (overrides: Partial<typeof TEST_CAPTURE_POLICY>): boolean =>
      policyEnabledFor({ ...TEST_CAPTURE_POLICY, ...overrides }, "exception-message", "event-journal");
    expect(pair({})).toBe(false);
    expect(pair({ errors: "codes-only" })).toBe(false);
    expect(pair({ errors: "protected-evidence" })).toBe(true);
    // The generic Section 1.2 gate is wider than the Section 6.1 evidence gate:
    // an events widening enables the pair but not the evidence branch above.
    expect(pair({ events: "allow-redacted" })).toBe(true);
    expect(controlEnabled({ ...TEST_CAPTURE_POLICY, errors: "codes-only" }, "errors")).toBe(false);
    expect(controlEnabled(TEST_CAPTURE_POLICY, "errors")).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * Section 9 legacy histories
 * ---------------------------------------------------------------------- */

function legacyEvent(overrides: Partial<GraphEvent> = {}): GraphEvent {
  return {
    apiVersion: GRAPH_EVENT_API_VERSION,
    eventId: "legacy-0",
    type: "RunCreated",
    timestamp: "2026-07-26T12:00:00.000Z",
    runId: "legacy-run",
    graphRevision: 1,
    sequence: 0,
    redacted: true,
    data: {
      contractVersion: "scheduler-recovery/v1alpha1",
      graphHash: "a".repeat(64),
      implementationHash: "b".repeat(64),
      input: ["o", [["seed", ["i", 1]]]],
      inputHash: "c".repeat(64),
      maxTotalAttempts: 8,
    },
    ...overrides,
  };
}

async function legacyStore(events: readonly GraphEvent[]): Promise<MemoryEventStore> {
  const store = new MemoryEventStore();
  await store.append("legacy-run", -1, events);
  return store;
}

describe("legacy v1alpha1 histories (redaction-semantics.md 9)", () => {
  it("reads and reports a misleading legacy history without repairing it", async () => {
    const store = await legacyStore([legacyEvent()]);
    const report = await inspectLegacyDurableHistory(store, "legacy-run");
    expect(report).toMatchObject({
      runId: "legacy-run",
      eventCount: 1,
      classification: "misleading-redacted-claim",
      failureCode: "LEGACY_REDACTION_MISMATCH",
      affectedSequences: [0],
    });
    expect(report.manifest?.disposition).toBe("quarantine");
    expect(report.manifest?.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    // Section 9.2: the original bytes are untouched.
    const after: GraphEvent[] = [];
    for await (const event of store.read("legacy-run")) after.push(event);
    expect(after).toEqual([legacyEvent()]);
    expect(JSON.stringify(report)).not.toContain("\"input\"");
  });

  it("classifies a truthful inline history as unauthorized rather than mismatched", async () => {
    const store = await legacyStore([legacyEvent({ redacted: false })]);
    const report = await inspectLegacyDurableHistory(store, "legacy-run");
    expect(report.classification).toBe("truthful-inline-unredacted");
    expect(report.failureCode).toBe("INLINE_CAPTURE_NOT_AUTHORIZED");
    const authorized = await inspectLegacyDurableHistory(store, "legacy-run", {
      legacyInlineAuthorized: true,
    });
    expect(authorized.failureCode).toBeUndefined();
  });

  it("refuses to resume a legacy history and appends nothing to the guarded journal", async () => {
    const store = await legacyStore([legacyEvent()]);
    const protection = memoryProtection();
    const executor = vi.fn(() => "must-not-run");
    const error = await resumeDurableGraphRun(graph(), {
      runId: "legacy-run",
      implementationId: "v1",
      protection,
      legacyEventStore: store,
      nodeExecutors: { root: executor },
    }).catch((thrown: unknown) => thrown as DurableRunError);
    expect(error).toBeInstanceOf(DurableRunError);
    expect(error.code).toBe("LEGACY_REDACTION_MISMATCH");
    expect(error.details).toMatchObject({
      classification: "misleading-redacted-claim",
      disposition: "quarantine",
    });
    expect(executor).not.toHaveBeenCalled();
    expect(await persistedHistory(protection, "legacy-run")).toEqual([]);
  });

  it("refuses to start over a legacy run id", async () => {
    const store = await legacyStore([legacyEvent({ redacted: false })]);
    await expect(
      startDurableGraphRun(graph(), {}, {
        runId: "legacy-run",
        implementationId: "v1",
        protection: memoryProtection(),
        legacyEventStore: store,
      }),
    ).rejects.toMatchObject({ code: "INLINE_CAPTURE_NOT_AUTHORIZED" });
  });

  it("ignores a legacy store that holds no history for this run", async () => {
    const protection = memoryProtection();
    const result = await startDurableGraphRun(graph(), {}, {
      runId: "fresh-run",
      implementationId: "v1",
      protection,
      legacyEventStore: new MemoryEventStore(),
      nodeExecutors: { root: () => "ok" },
    });
    expect(result.status).toBe("succeeded");
  });
});

/* -------------------------------------------------------------------------
 * Section 10 persisted-byte integrity
 * ---------------------------------------------------------------------- */

describe("persisted v1alpha2 bytes (redaction-semantics.md 10)", () => {
  it("rejects a tampered journal record instead of folding it", async () => {
    harness = await fileProtection();
    await startDurableGraphRun(graph(), { seed: 1 }, {
      runId: "tampered-journal",
      implementationId: "v1",
      protection: harness.protection,
      nodeExecutors: { root: () => "ok" },
    });
    const journalDirectory = join(harness.directory, "events-v1alpha2");
    const [name] = await readdir(journalDirectory);
    const path = join(journalDirectory, name as string);
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    const record = JSON.parse(lines[0] as string) as Record<string, unknown>;
    record.payloadHash = "f".repeat(64);
    lines[0] = JSON.stringify(record);
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");

    const executor = vi.fn(() => "must-not-run");
    await expect(
      resumeDurableGraphRun(graph(), {
        runId: "tampered-journal",
        implementationId: "v1",
        protection: harness.protection,
        nodeExecutors: { root: executor },
      }),
    ).rejects.toMatchObject({ code: "CORRUPT_EVENT_LOG" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("fails closed when a referenced protected blob is missing", async () => {
    harness = await fileProtection();
    await startDurableGraphRun(graph(), { seed: 1 }, {
      runId: "missing-blob",
      implementationId: "v1",
      protection: harness.protection,
      nodeExecutors: { root: () => "ok" },
    });
    const blobDirectory = join(harness.directory, "protected");
    const [name] = await readdir(blobDirectory);
    await writeFile(join(blobDirectory, name as string), "{}", "utf8");

    const executor = vi.fn(() => "must-not-run");
    await expect(
      resumeDurableGraphRun(graph(), {
        runId: "missing-blob",
        implementationId: "v1",
        protection: harness.protection,
        nodeExecutors: { root: executor },
      }),
    ).rejects.toMatchObject({ code: "PROTECTED_PAYLOAD_CORRUPT" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("fails closed when the run key reference changes", async () => {
    const protection = memoryProtection();
    await startDurableGraphRun(graph(), { seed: 1 }, {
      runId: "rotated-key-ref",
      implementationId: "v1",
      protection,
      nodeExecutors: { root: () => "ok" },
    });
    const rotatedKeys = {
      ...protection.keys,
      keyRef: "a-different-operator-key-reference",
      protectionKey: (runId: string) => protection.keys.protectionKey(runId),
      runIdentityKey: (runId: string) => protection.keys.runIdentityKey(runId),
      nonce: (context: { readonly runId: string; readonly aadHash: string }) =>
        protection.keys.nonce(context),
    };
    // A coherent configuration whose key reference simply differs from the one
    // that wrote the history: the policy names the key actually in use.
    const other: DurablePayloadProtection = {
      ...protection,
      keys: rotatedKeys,
      policy: { ...TEST_CAPTURE_POLICY, keyRef: rotatedKeys.keyRef },
    };
    await expect(
      resumeDurableGraphRun(graph(), {
        runId: "rotated-key-ref",
        implementationId: "v1",
        protection: other,
      }),
    ).rejects.toMatchObject({ code: "PROTECTED_PAYLOAD_UNAUTHORIZED" });

    // Section 5.1: a policy naming a key reference other than the provider's
    // attests to a key that is protecting nothing, and is refused before the
    // first event rather than producing a second, incoherent policy hash.
    await expect(
      resumeDurableGraphRun(graph(), {
        runId: "rotated-key-ref",
        implementationId: "v1",
        protection: { ...protection, keys: rotatedKeys },
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_PROTECTION_REQUIRED" });
  });
});
