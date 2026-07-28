import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { canonicalSerialize } from "@graph-engineering/core";
import { describe, expect, it } from "vitest";
import {
  CYCLE_STORE_OPERATION_DOMAIN,
  MAX_CYCLE_STORE_APPEND_BYTES,
  CycleStoreProviderError,
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
  createReferenceCycleStoreProviderDescriptor,
  cycleStoreAdapterCodec,
  decodeCanonicalMutationRequest,
  encodeCanonicalMutationRequest,
  hashWithDomain,
  operationRequestHash,
  type CycleStoreAuthorizationContext,
  type CycleStoreCanonicalRequestByOperation,
  type CycleStoreMutationContext,
  type CycleStoreMutationOperation,
} from "../src/index.js";

const AUTH: CycleStoreAuthorizationContext = Object.freeze({
  tenantId: "tenant-a",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});

function mutation(operationId: string): CycleStoreMutationContext {
  return Object.freeze({ ...AUTH, operationId });
}

type AnyMutationRequest =
  CycleStoreCanonicalRequestByOperation[CycleStoreMutationOperation];

interface MutationVector {
  readonly operation: CycleStoreMutationOperation;
  readonly request: AnyMutationRequest;
}

function mutationVectors(): readonly MutationVector[] {
  const descriptor = createReferenceCycleStoreProviderDescriptor();
  const record = createCycleStoreRecord({
    recordId: "record-0",
    sequence: 0,
    previousRecordHash: null,
    value: { nested: ["graph", { exact: true }], ratio: 1.25 },
  });
  const checkpoint = createCycleStoreCheckpoint({
    checkpointScope: "scope-a",
    checkpointId: "checkpoint-a",
    streamId: "stream-a",
    boundSequence: 0,
    boundRecordHash: record.recordHash,
    createdAt: "2026-07-27T00:00:01Z",
    value: { state: "ready", attempts: [1, 2, 3] },
  });
  const lease = Object.freeze({
    leaseId: "lease-a",
    holderId: "holder-a",
    fencingToken: 1,
  });
  const raw: readonly {
    readonly operation: CycleStoreMutationOperation;
    readonly value: unknown;
  }[] = [
    {
      operation: "append",
      value: {
        context: mutation("op-append"),
        streamId: "stream-a",
        expectedTail: { exists: false, sequence: -1, recordHash: null },
        lease: null,
        records: [record],
      },
    },
    {
      operation: "save-checkpoint",
      value: { context: mutation("op-save"), checkpoint, lease: null },
    },
    {
      operation: "delete-checkpoint",
      value: {
        context: mutation("op-delete"),
        checkpointScope: "scope-a",
        checkpointId: "checkpoint-a",
        expectedValueHash: checkpoint.valueHash,
      },
    },
    {
      operation: "acquire-lease",
      value: {
        context: mutation("op-acquire-lease"),
        streamId: "stream-a",
        leaseId: "lease-a",
        holderId: "holder-a",
        ttlMs: 1_000,
        mode: "acquire",
        expectedFencingToken: 0,
      },
    },
    {
      operation: "renew-lease",
      value: {
        context: mutation("op-renew-lease"),
        streamId: "stream-a",
        lease,
        ttlMs: 2_000,
      },
    },
    {
      operation: "release-lease",
      value: {
        context: mutation("op-release-lease"),
        streamId: "stream-a",
        lease,
      },
    },
    {
      operation: "set-legal-hold",
      value: {
        context: mutation("op-legal-hold"),
        streamId: "stream-a",
        holdId: "hold-a",
        action: "place",
      },
    },
    {
      operation: "acquire-migration-lock",
      value: {
        context: mutation("op-acquire-migration"),
        lockId: "migration-a",
        ownerId: "owner-a",
        sourceSchemaVersion: 1,
        targetSchemaVersion: 2,
        ttlMs: 3_000,
        mode: "acquire",
        expectedFencingToken: 0,
      },
    },
    {
      operation: "release-migration-lock",
      value: {
        context: mutation("op-release-migration"),
        lockId: "migration-a",
        ownerId: "owner-a",
        fencingToken: 1,
      },
    },
  ];
  return raw.map(({ operation, value }) => ({
    operation,
    request: cycleStoreAdapterCodec.captureRequest(operation, value, descriptor),
  }));
}

function expectCorruption(action: () => unknown): CycleStoreProviderError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    const providerError = error as CycleStoreProviderError;
    expect(providerError.code).toBe("GE_CYCLE_STORE_CORRUPTION");
    expect(providerError.retryable).toBe(false);
    expect(providerError.message).toBe("operation ledger request bytes are corrupt");
    expect(providerError.details).toEqual({});
    return providerError;
  }
  throw new Error("expected GE_CYCLE_STORE_CORRUPTION");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("canonical CycleStore mutation request storage codec", () => {
  it("round-trips byte-identical closed vectors for all nine mutation operations", () => {
    const vectors = mutationVectors();
    expect(vectors.map(({ operation }) => operation)).toEqual([
      "append",
      "save-checkpoint",
      "delete-checkpoint",
      "acquire-lease",
      "renew-lease",
      "release-lease",
      "set-legal-hold",
      "acquire-migration-lock",
      "release-migration-lock",
    ]);

    for (const { operation, request } of vectors) {
      const bytes = encodeCanonicalMutationRequest(operation, request);
      const codecBytes = cycleStoreAdapterCodec.encodeCanonicalMutationRequest(
        operation,
        request,
      );
      expect(codecBytes, operation).toEqual(bytes);
      expect(Buffer.from(bytes).toString("utf8"), operation).toBe(
        canonicalSerialize(request),
      );

      const decoded = decodeCanonicalMutationRequest(operation, bytes);
      expect(decoded, operation).toEqual(request);
      expect(
        cycleStoreAdapterCodec.decodeCanonicalMutationRequest(operation, bytes),
        operation,
      ).toEqual(request);
      expect(encodeCanonicalMutationRequest(operation, decoded), operation).toEqual(bytes);
      expect(Object.isFrozen(decoded), operation).toBe(true);
      expect(Object.isFrozen(decoded.context), operation).toBe(true);
      expect(decoded.context.tenantId, operation).toBe("tenant-a");
      expect(decoded.context.operationId, operation).toMatch(/^op-/u);

      const context = (JSON.parse(Buffer.from(bytes).toString("utf8")) as {
        context: Record<string, unknown>;
      }).context;
      expect(Object.keys(context).sort(), operation).toEqual([
        "authorizationHash",
        "operationId",
        "principalHash",
        "tenantId",
      ]);
      expect(canonicalSerialize(context), operation).not.toContain("bearer");

      expect(operationRequestHash(operation, request), operation).toBe(
        hashWithDomain(CYCLE_STORE_OPERATION_DOMAIN, { operation, request }),
      );
    }
  });

  it("locks the canonical byte and domain-separated hash vectors", () => {
    const byteDigests = Object.fromEntries(mutationVectors().map(({ operation, request }) => [
      operation,
      sha256(encodeCanonicalMutationRequest(operation, request)),
    ]));
    const requestHashes = Object.fromEntries(mutationVectors().map(({ operation, request }) => [
      operation,
      operationRequestHash(operation, request),
    ]));

    expect(byteDigests).toEqual({
      append: "f8c2b14eaed47cbd761e84125fc9c59fe3869c848a90eb26240dfbcca6341d23",
      "save-checkpoint": "dc1a5978db6fa16a37feae8506852fb5dfaf2245126d3b6febe2668cc9aa38cf",
      "delete-checkpoint": "f5b8023f875d9fde2058fcd46a8a774a3a3e9aa2287d90741ef279092d307c3a",
      "acquire-lease": "3dc466db729fbae8aa32251f1e877bd3d722b82426cdb3d6224603d49951f698",
      "renew-lease": "d0cb7056c5cf11147ef7f939b26bad37110ef79fd190e9b058865069557901cd",
      "release-lease": "bc81d03dca032deb3a3361fe1f6f0beae87237902d6918075fd491ef0261c7b1",
      "set-legal-hold": "ca2fa725ce0c504e173c91bb003134d8bff1e6b77803229bb91a52c68f83de13",
      "acquire-migration-lock": "d69ad30bcd3004390feba799ac5840483bc88b1f2b97e97a7c3ecb5ab72df26f",
      "release-migration-lock": "e58c1bc1902e1f17b05268e3199bae4a562c53b91c0ecd81d0548684635bb99a",
    });
    expect(requestHashes).toEqual({
      append: "88a1f35127aa3aa2499c4df133d667b9d56d8067cea61162359de7acc48be826",
      "save-checkpoint": "c2dda448a616b64d6d7d07be2b8a4ac7528c5f928eefa745a859d92389936c57",
      "delete-checkpoint": "a529641f4fb853f8bc712df2b216ea75539ee4dd0b69c3db9331c93711e71be1",
      "acquire-lease": "d63bf8db6351f9d07aa10c7a6022cf0bf4d325e01dd5544398500bd5ea63b66e",
      "renew-lease": "80a033b7274b0e52dfd31ac91c87659ca83ce8ff305a9c35983824dc07653b8c",
      "release-lease": "4ef921ec5d717cadcd87b26ec4777660301861c4989cec5fd30043298d0a644f",
      "set-legal-hold": "77ab0a0c24e192fe3894ae3522f358c044d26cf8a8a4a89be8a0c9231e1d4f21",
      "acquire-migration-lock": "a3fa5fe0c98bebeb20958e8ae6ec8a2713d821ae084d91f364e60559586b402d",
      "release-migration-lock": "9476bb24dc6325cfb27ef3f75bfe1465997fefa559df5a5bf68e15e7d0424218",
    });
  });

  it("rejects invalid UTF-8, invalid JSON, and every noncanonical spelling", () => {
    const hold = mutationVectors().find(({ operation }) => operation === "set-legal-hold")!;
    const canonical = Buffer.from(
      encodeCanonicalMutationRequest(hold.operation, hold.request),
    ).toString("utf8");
    const parsed = JSON.parse(canonical) as Record<string, unknown>;
    const reordered = JSON.stringify({
      streamId: parsed.streamId,
      context: parsed.context,
      holdId: parsed.holdId,
      action: parsed.action,
    });
    const escaped = canonical.replace("tenant-a", "tenant\\u002da");

    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      { byteLength: 1 } as unknown as Uint8Array,
    ));
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Uint8Array.from([0xc3, 0x28]),
    ));
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.from("{", "utf8"),
    ));
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.from(` ${canonical}`, "utf8"),
    ));
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.from(reordered, "utf8"),
    ));
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.from(escaped, "utf8"),
    ));
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical, "utf8")]),
    ));
  });

  it("rejects operation, shape, hash-field, and credential-context confusion", () => {
    const descriptor = createReferenceCycleStoreProviderDescriptor();
    const hold = mutationVectors().find(({ operation }) => operation === "set-legal-hold")!;
    const holdBytes = encodeCanonicalMutationRequest(hold.operation, hold.request);
    const raw = JSON.parse(Buffer.from(holdBytes).toString("utf8")) as Record<string, unknown>;

    expectCorruption(() => decodeCanonicalMutationRequest("release-lease", holdBytes));
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.from(canonicalSerialize({ ...raw, requestHash: "c".repeat(64) }), "utf8"),
    ));
    const { action: _missing, ...missing } = raw;
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.from(canonicalSerialize(missing), "utf8"),
    ));
    const context = raw.context as Record<string, unknown>;
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.from(canonicalSerialize({
        ...raw,
        context: { ...context, bearerToken: "MUST_NOT_LEAK" },
      }), "utf8"),
    ));
    const { operationId: _operationId, ...contextWithoutOperation } = context;
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.from(canonicalSerialize({ ...raw, context: contextWithoutOperation }), "utf8"),
    ));

    const changedTenant = cycleStoreAdapterCodec.captureRequest("set-legal-hold", {
      ...raw,
      context: { ...context, tenantId: "tenant-b" },
    }, descriptor);
    const changedOperationId = cycleStoreAdapterCodec.captureRequest("set-legal-hold", {
      ...raw,
      context: { ...context, operationId: "op-legal-hold-other" },
    }, descriptor);
    const originalHash = operationRequestHash("set-legal-hold", hold.request);
    expect(operationRequestHash("set-legal-hold", changedTenant)).not.toBe(originalHash);
    expect(operationRequestHash("set-legal-hold", changedOperationId)).not.toBe(originalHash);
    expect(() => operationRequestHash(
      "release-lease",
      hold.request as CycleStoreCanonicalRequestByOperation["release-lease"],
    )).toThrow(CycleStoreProviderError);
  });

  it("enforces byte, depth, array, and portable-number bounds", () => {
    expectCorruption(() => decodeCanonicalMutationRequest(
      "append",
      new Uint8Array(MAX_CYCLE_STORE_APPEND_BYTES + 1),
    ));

    const append = mutationVectors().find(({ operation }) => operation === "append")!;
    const rawAppend = JSON.parse(
      Buffer.from(encodeCanonicalMutationRequest(append.operation, append.request)).toString("utf8"),
    ) as Record<string, unknown>;
    const records = rawAppend.records as unknown[];
    expectCorruption(() => decodeCanonicalMutationRequest(
      "append",
      Buffer.from(canonicalSerialize({
        ...rawAppend,
        records: Array.from({ length: 65 }, () => records[0]),
      }), "utf8"),
    ));

    let excessiveDepth: unknown = true;
    for (let index = 0; index < 102; index += 1) excessiveDepth = [excessiveDepth];
    expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.from(canonicalSerialize({
        context: mutation("deep"), streamId: "stream-a", holdId: "hold-a",
        action: "place", nested: excessiveDepth,
      }), "utf8"),
    ));

    expectCorruption(() => decodeCanonicalMutationRequest(
      "acquire-lease",
      Buffer.from(
        `{"context":{"authorizationHash":"${"b".repeat(64)}","operationId":"unsafe",`
          + `"principalHash":"${"a".repeat(64)}","tenantId":"tenant-a"},`
          + '"expectedFencingToken":9007199254740992,"holderId":"holder-a",'
          + '"leaseId":"lease-a","mode":"acquire","streamId":"stream-a","ttlMs":1000}',
        "utf8",
      ),
    ));
    expectCorruption(() => decodeCanonicalMutationRequest(
      "renew-lease",
      Buffer.from(canonicalSerialize({
        context: mutation("float"), streamId: "stream-a",
        lease: { leaseId: "lease-a", holderId: "holder-a", fencingToken: 1 },
        ttlMs: 1.5,
      }), "utf8"),
    ));
  });

  it("detaches callers and never leaks hostile stored bytes through typed corruption", () => {
    const append = mutationVectors().find(({ operation }) => operation === "append")!;
    const mutable = JSON.parse(canonicalSerialize(append.request)) as {
      streamId: string;
      records: { value: { nested: unknown[] } }[];
    };
    const bytes = encodeCanonicalMutationRequest("append", mutable as unknown as
      CycleStoreCanonicalRequestByOperation["append"]);
    const expectedBytes = Uint8Array.from(bytes);
    mutable.streamId = "changed-after-encode";
    mutable.records[0]!.value.nested[0] = "changed-after-encode";
    expect(bytes).toEqual(expectedBytes);

    const decoded = decodeCanonicalMutationRequest("append", bytes);
    bytes.fill(0);
    expect(decoded.streamId).toBe("stream-a");
    expect(decoded.records[0]!.value).toEqual({
      nested: ["graph", { exact: true }], ratio: 1.25,
    });
    expect(Object.isFrozen(decoded.records)).toBe(true);
    expect(Object.isFrozen(decoded.records[0]!.value)).toBe(true);

    const marker = "MUST_NOT_LEAK_BEARER_7f9238";
    const error = expectCorruption(() => decodeCanonicalMutationRequest(
      "set-legal-hold",
      Buffer.from(canonicalSerialize({ bearerToken: marker }), "utf8"),
    ));
    expect(canonicalSerialize(error.toJSON())).not.toContain(marker);
    expect(canonicalSerialize(error.toJSON())).not.toContain("bearerToken");
  });
});
