import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  CheckpointProtectionRequiredError,
  DEFAULT_CAPTURE_POLICY,
  DeterministicTestKeyProvider,
  FileCheckpointStore,
  FileProtectedPayloadStore,
  GuardedFileCheckpointStore,
  keyRefHash,
  PersistenceError,
  prepareProtectedCheckpoint,
  ProtectedCheckpointReader,
  ProtectedCheckpointWriter,
  scanBytesForCanaries,
  SinkGuard,
  type AuthorityScope,
  type CanaryDetection,
  type CapturePolicy,
  type ProtectedCheckpointSpec,
  type SeededCanary,
} from "../src/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const specDirectory = join(repositoryRoot, "spec");

const SCOPE: AuthorityScope = Object.freeze({
  tenantScopeId: "tenant-opaque-1",
  authorityProviderId: "provider-opaque-1",
  authoritySubjectId: "subject-opaque-1",
});

/** Distinct synthetic canaries, one per seed point the projection can carry. */
const CANARIES: Record<string, SeededCanary> = Object.freeze({
  graphInput: { canaryId: "ckpt-graph-input", value: "GE-CKPT-CANARY-9f31ab7742d0-graph-input" },
  nodeInput: { canaryId: "ckpt-node-input", value: "GE-CKPT-CANARY-8e20bc6631cf-node-input" },
  nodeOutput: { canaryId: "ckpt-node-output", value: "GE-CKPT-CANARY-7d1fcd5520be-node-output" },
  nodeResult: { canaryId: "ckpt-node-result", value: "GE-CKPT-CANARY-6c0ede4419ad-node-result" },
});

interface Harness {
  readonly directory: string;
  readonly keys: DeterministicTestKeyProvider;
  readonly payloadStore: FileProtectedPayloadStore;
  readonly policy: CapturePolicy;
  readonly writer: ProtectedCheckpointWriter;
  readonly store: GuardedFileCheckpointStore;
  dispose(): Promise<void>;
}

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

async function createHarness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "ge-protected-ckpt-"));
  const keys = new DeterministicTestKeyProvider();
  const payloadStore = new FileProtectedPayloadStore({ directory });
  const policy: CapturePolicy = {
    ...DEFAULT_CAPTURE_POLICY,
    transformImplementationHash: "11".repeat(32),
    ruleRegistryVersion: 1,
    ruleRegistryHash: "22".repeat(32),
    keyRef: keys.keyRef,
  };
  const writer = new ProtectedCheckpointWriter({ keys, store: payloadStore, scope: SCOPE, policy });
  const store = new GuardedFileCheckpointStore({ directory });
  return {
    directory,
    keys,
    payloadStore,
    policy,
    writer,
    store,
    dispose: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function seededSpec(keys: DeterministicTestKeyProvider): ProtectedCheckpointSpec {
  return {
    decisionId: "decision-canary-checkpoint-1",
    runId: "canary-run",
    checkpointId: "ckpt-canary-1",
    sequence: 7,
    createdAt: "2026-08-01T00:00:00Z",
    graphRevision: 1,
    graphHash: "ab".repeat(32),
    implementationHash: "cd".repeat(32),
    keyRefHash: keyRefHash(keys.keyRef),
    historyPrefixHash: "ef".repeat(32),
    totalAttempts: 3,
    graphInput: { question: CANARIES["graphInput"]?.value },
    nodes: [
      {
        nodeId: "planner",
        status: "succeeded",
        attempts: 1,
        input: { prompt: CANARIES["nodeInput"]?.value },
        output: { answer: CANARIES["nodeOutput"]?.value },
        activityKey: "12".repeat(32),
      },
      {
        nodeId: "fallback",
        status: "failed",
        attempts: 2,
        result: { detail: CANARIES["nodeResult"]?.value },
        failureCode: "NODE_EXECUTION_FAILED",
      },
    ],
  };
}

async function walkFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await walkFiles(path)));
    else found.push(path);
  }
  return found;
}

async function scanDirectory(
  root: string,
  canaries: readonly SeededCanary[],
): Promise<{
  files: string[];
  bytesScanned: number;
  detections: Array<CanaryDetection & { file: string }>;
}> {
  const files = await walkFiles(root);
  const detections: Array<CanaryDetection & { file: string }> = [];
  let bytesScanned = 0;
  for (const file of files) {
    const info = await stat(file);
    if (!info.isFile()) continue;
    const bytes = await readFile(file);
    bytesScanned += bytes.byteLength;
    for (const detection of scanBytesForCanaries(bytes, canaries)) {
      detections.push({ ...detection, file });
    }
  }
  return { files, bytesScanned, detections };
}

async function loadSchemaValidator(): Promise<(document: unknown) => boolean> {
  const ajv = new Ajv2020.default({ strict: false, allErrors: true });
  ajv.addSchema(
    JSON.parse(await readFile(join(specDirectory, "protected-value.schema.json"), "utf8")),
  );
  const validate = ajv.compile(
    JSON.parse(await readFile(join(specDirectory, "checkpoint-v1alpha2.schema.json"), "utf8")),
  );
  return (document: unknown) => {
    const valid = validate(document);
    if (!valid) throw new Error(JSON.stringify(validate.errors));
    return valid;
  };
}

describe("guarded checkpoints/v1alpha2 write path", () => {
  it("produces schema-valid checkpoint-v1alpha2 bytes (validated against the frozen schema)", async () => {
    harness = await createHarness();
    const saved = await harness.writer.save(harness.store, seededSpec(harness.keys));
    const validate = await loadSchemaValidator();
    expect(validate(saved)).toBe(true);

    // The exact persisted bytes, not just the returned object.
    const raw = await readFile(harness.store.pathForCheckpoint("canary-run", "ckpt-canary-1"));
    const text = raw.toString("utf8");
    expect(text.endsWith("\n")).toBe(true);
    const persisted = JSON.parse(text.slice(0, -1)) as Record<string, unknown>;
    expect(validate(persisted)).toBe(true);
    expect(persisted["payloadDisposition"]).toBe("protected-ref");
    expect(persisted["redacted"]).toBe(false);
    expect(persisted["protectedRefCount"]).toBe(4);
  });

  it("leaves no canary byte in any temporary or final file across the whole save", async () => {
    harness = await createHarness();
    await harness.writer.save(harness.store, seededSpec(harness.keys));

    const canaries = Object.values(CANARIES);
    const scan = await scanDirectory(harness.directory, canaries);
    // The scan must have had something to look at: the projection plus one
    // protected blob per protected occurrence.
    expect(scan.files.some((file) => file.endsWith(".checkpoint.json"))).toBe(true);
    expect(scan.files.filter((file) => file.endsWith(".blob")).length).toBe(4);
    // No temporary plaintext file is left behind (Section 5.6).
    expect(scan.files.filter((file) => file.endsWith(".tmp"))).toEqual([]);
    expect(scan.bytesScanned).toBeGreaterThan(0);
    expect(scan.detections).toEqual([]);
  });

  it("is a real scan: the same seeds through the unguarded v1alpha1 store are detected", async () => {
    harness = await createHarness();
    // Positive control: the legacy plaintext writer this lane exists to
    // displace persists the same values verbatim and the scan must see them.
    const raw = new FileCheckpointStore({ directory: harness.directory });
    await raw.save({
      runId: "unsafe-control",
      checkpointId: "ckpt-unsafe-1",
      sequence: 0,
      createdAt: "2026-08-01T00:00:00Z",
      state: {
        question: CANARIES["graphInput"]?.value,
        output: CANARIES["nodeOutput"]?.value,
      },
    });
    const scan = await scanDirectory(harness.directory, Object.values(CANARIES));
    expect(scan.detections.length).toBeGreaterThan(0);
    expect(scan.detections.map((detection) => detection.canaryId)).toContain("ckpt-graph-input");
    expect(scan.detections[0]?.form).toBe("utf8");
  });

  it("detects every encoded spelling the campaign claims to check", () => {
    const value = CANARIES["graphInput"]?.value as string;
    const forms = new Set(
      scanBytesForCanaries(
        Buffer.concat([
          Buffer.from(value, "utf8"),
          Buffer.from(Buffer.from(value, "utf8").toString("base64url"), "utf8"),
          Buffer.from(Buffer.from(value, "utf8").toString("hex"), "utf8"),
          Buffer.from(value, "utf16le"),
        ]),
        [CANARIES["graphInput"] as SeededCanary],
      ).map((detection) => detection.form),
    );
    expect(forms.has("utf8")).toBe(true);
    expect(forms.has("base64url")).toBe(true);
    expect(forms.has("hex")).toBe(true);
    expect(forms.has("utf16le")).toBe(true);
  });

  it("has a clean control: an unseeded projection produces no detection", async () => {
    harness = await createHarness();
    const spec: ProtectedCheckpointSpec = {
      ...seededSpec(harness.keys),
      graphInput: { question: "ordinary application data" },
      nodes: [],
    };
    await harness.writer.save(harness.store, spec);
    const scan = await scanDirectory(harness.directory, Object.values(CANARIES));
    expect(scan.detections).toEqual([]);
  });

  it("fails closed with CHECKPOINT_PROTECTION_REQUIRED when constructed without protection", () => {
    for (const options of [
      {},
      { store: new FileProtectedPayloadStore({ directory: "/tmp/unused" }), scope: SCOPE },
      { keys: new DeterministicTestKeyProvider(), scope: SCOPE },
      { keys: new DeterministicTestKeyProvider(), store: new FileProtectedPayloadStore({ directory: "/tmp/unused" }) },
    ]) {
      let caught: unknown;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new ProtectedCheckpointWriter(options as any);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CheckpointProtectionRequiredError);
      expect((caught as PersistenceError).code).toBe("CHECKPOINT_PROTECTION_REQUIRED");
    }
  });

  it("fails closed when the capture policy names a different keyRef", () => {
    const keys = new DeterministicTestKeyProvider();
    let caught: unknown;
    try {
      new ProtectedCheckpointWriter({
        keys,
        store: new FileProtectedPayloadStore({ directory: "/tmp/unused" }),
        scope: SCOPE,
        policy: DEFAULT_CAPTURE_POLICY, // keyRef "operator-owned-key-reference"
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as PersistenceError).code).toBe("CHECKPOINT_PROTECTION_REQUIRED");
  });

  it("refuses any save that is not a guard-minted prepared write", async () => {
    harness = await createHarness();
    for (const forged of [undefined, null, {}, { bytes: "{}" }, "prepared", 42]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(harness.store.save(forged as any)).rejects.toMatchObject({
        code: "CHECKPOINT_PROTECTION_REQUIRED",
      });
    }
  });

  it("refuses a prepared write bound to another sink instance, and replay", async () => {
    harness = await createHarness();
    const other = new GuardedFileCheckpointStore({
      directory: join(harness.directory, "other"),
    });
    const prepared = await harness.writer.prepare(harness.store, seededSpec(harness.keys));
    await expect(other.save(prepared)).rejects.toMatchObject({
      code: "CHECKPOINT_PROTECTION_REQUIRED",
    });
    // The misdirected consume did not burn the capability for the bound sink.
    await harness.store.save(prepared);
    await expect(harness.store.save(prepared)).rejects.toMatchObject({
      code: "CHECKPOINT_PROTECTION_REQUIRED",
    });
  });

  it("fails closed with CHECKPOINT_PROTECTION_REQUIRED when the guard has no key provider", async () => {
    harness = await createHarness();
    const guard = new SinkGuard({ policy: harness.policy, scope: SCOPE });
    const result = await prepareProtectedCheckpoint(guard, harness.store, seededSpec(harness.keys));
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure.code).toBe("PAYLOAD_PROTECTION_REQUIRED");
    // Nothing reached disk: no checkpoint file, no blob, no temporary.
    const files = await walkFiles(harness.directory);
    expect(files.filter((file) => !file.includes("protected"))).toEqual([]);
  });

  it("round-trips: load returns the exact projection with unresolved refs", async () => {
    harness = await createHarness();
    const saved = await harness.writer.save(harness.store, seededSpec(harness.keys));
    const loaded = await harness.store.load("canary-run", "ckpt-canary-1");
    expect(loaded).toEqual(saved);
    expect(await harness.store.load("canary-run", "ckpt-missing")).toBeNull();
    // The plain load path exposes references, never application values.
    const graphInputRef = (loaded as Record<string, unknown>)["graphInputRef"] as Record<string, unknown>;
    expect(typeof graphInputRef["ref"]).toBe("string");
    expect(JSON.stringify(loaded)).not.toContain(CANARIES["graphInput"]?.value as string);
  });

  it("resolves protected refs only through an authorized reader with the right keys", async () => {
    harness = await createHarness();
    const saved = await harness.writer.save(harness.store, seededSpec(harness.keys));
    const reader = new ProtectedCheckpointReader({
      keys: harness.keys,
      store: harness.payloadStore,
      scope: SCOPE,
      capturePolicyHash: harness.writer.capturePolicyHash,
    });
    const resolved = await reader.resolve(
      saved as Record<string, unknown>,
      "/graphInputRef",
      { kind: "graph-input", runId: "canary-run", graphRevision: 1 },
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.taggedJson).toContain(CANARIES["graphInput"]?.value as string);
    }
    const nodeOutput = await reader.resolve(
      saved as Record<string, unknown>,
      "/nodes/0/outputRef",
      { kind: "node-output", runId: "canary-run", graphRevision: 1, nodeId: "planner" },
    );
    expect(nodeOutput.ok).toBe(true);

    // A reader holding a different key authority is refused, not given bytes.
    const wrongKeys = new DeterministicTestKeyProvider("another-key-ref/v1");
    const unauthorized = new ProtectedCheckpointReader({
      keys: wrongKeys,
      store: harness.payloadStore,
      scope: SCOPE,
      capturePolicyHash: harness.writer.capturePolicyHash,
    });
    const refused = await unauthorized.resolve(
      saved as Record<string, unknown>,
      "/graphInputRef",
      { kind: "graph-input", runId: "canary-run", graphRevision: 1 },
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.failure.code).toBe("PROTECTED_PAYLOAD_UNAUTHORIZED");
    }
  });

  it("reproduces the shared cross-language parity vector byte for byte", async () => {
    harness = await createHarness();
    const fixture = JSON.parse(
      await readFile(
        join(specDirectory, "conformance", "protected-checkpoint-parity.case.json"),
        "utf8",
      ),
    ) as {
      policy: { capturePolicyHash: string };
      input: Omit<ProtectedCheckpointSpec, "keyRefHash">;
      expect: {
        protectedRefCount: number;
        contentHash: string;
        canonicalSha256: string;
        record: Record<string, unknown>;
      };
    };
    expect(harness.writer.capturePolicyHash).toBe(fixture.policy.capturePolicyHash);
    const saved = await harness.writer.save(harness.store, {
      ...fixture.input,
      keyRefHash: keyRefHash(harness.keys.keyRef),
    } as ProtectedCheckpointSpec);
    expect(saved).toEqual(fixture.expect.record);
    expect(saved["contentHash"]).toBe(fixture.expect.contentHash);
    expect(saved["protectedRefCount"]).toBe(fixture.expect.protectedRefCount);

    const raw = await readFile(
      harness.store.pathForCheckpoint(fixture.input.runId, fixture.input.checkpointId),
    );
    const canonical = raw.subarray(0, raw.byteLength - 1);
    expect(createHash("sha256").update(canonical).digest("hex")).toBe(
      fixture.expect.canonicalSha256,
    );
  });
});
