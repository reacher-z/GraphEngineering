import { describe, expect, it } from "vitest";
import { canonicalSerialize } from "@graph-engineering/core";
import {
  createCycleInlinePayload,
  cycleControllerHash,
  cycleRequestHash,
  decodeCycleInlinePayload,
  observeCycleExit,
  selectCycleExitReason,
  validateCycleCandidates,
  validateCycleControllerPolicy,
  validateCycleControllerRequest,
  validateCycleLease,
  validateCycleVerdicts,
  type CycleControllerPolicy,
} from "../src/index.js";
import { cycleFixture, durableCycleFixture } from "./cycle-fixtures.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface Mutation {
  readonly op: "add" | "replace" | "remove";
  readonly path: string;
  readonly value?: unknown;
  readonly valueFrom?: string;
}

function pointer(root: unknown, path: string): { parent: Record<string, unknown>; key: string } {
  const parts = path.split("/").slice(1);
  const key = parts.pop() as string;
  let value = root as Record<string, unknown>;
  for (const part of parts) value = value[part] as Record<string, unknown>;
  return { parent: value, key };
}

function mutate(root: unknown, mutation: Mutation): unknown {
  const result = clone(root);
  const { parent, key } = pointer(result, mutation.path);
  if (mutation.op === "remove") delete parent[key];
  else {
    parent[key] = mutation.valueFrom === undefined
      ? clone(mutation.value)
      : clone(pointer(result, mutation.valueFrom).parent[pointer(result, mutation.valueFrom).key]);
  }
  return result;
}

describe("cycle wire contracts", () => {
  it("validates every shared policy/request and reproduces canonical identities", () => {
    for (const item of cycleFixture.validPolicies) {
      expect(validateCycleControllerPolicy(item.document)).toEqual(item.document);
    }
    for (const item of cycleFixture.validRequests) {
      const request = validateCycleControllerRequest(item.document);
      expect(cycleControllerHash(request)).toBe(item.expectControllerHash);
      expect(cycleRequestHash(request)).toBe(item.expectRequestHash);
      expect(Object.isFrozen(request)).toBe(true);
    }
  });

  it("rejects every shared invalid policy and request mutation", () => {
    for (const item of cycleFixture.invalidPolicyCases as readonly {
      name: string; base?: string; mutation: Mutation;
    }[]) {
      const base = cycleFixture.validPolicies.find(({ name }) => name === (item.base ?? "until-dry-all-effective-bounds"));
      expect(() => validateCycleControllerPolicy(mutate(base?.document, item.mutation)), item.name).toThrow();
    }
    const base = cycleFixture.validRequests[0]!.document;
    for (const item of cycleFixture.invalidRequestCases as readonly { name: string; mutation: Mutation }[]) {
      expect(() => validateCycleControllerRequest(mutate(base, item.mutation)), item.name).toThrow();
    }
  });

  it("rejects proxy, getter, cyclic, excessive-depth, and unsafe-number request carriers", () => {
    const base = clone(cycleFixture.validRequests[0]!.document) as Record<string, unknown>;
    expect(() => validateCycleControllerRequest(new Proxy(base, {}))).toThrow(/portable JSON/u);

    const getter = clone(base);
    Object.defineProperty(getter, "poison", { enumerable: true, get: () => true });
    expect(() => validateCycleControllerRequest(getter)).toThrow(/portable JSON/u);

    const cyclic = clone(base);
    cyclic.poison = cyclic;
    expect(() => validateCycleControllerRequest(cyclic)).toThrow(/portable JSON/u);

    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 102; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    const nested = clone(base);
    nested.poison = deep;
    expect(() => validateCycleControllerRequest(nested)).toThrow(/portable JSON/u);

    const unsafe = clone(base);
    (unsafe.initialGraph as Record<string, unknown>).graphRevision = Number.MAX_SAFE_INTEGER + 1;
    expect(() => validateCycleControllerRequest(unsafe)).toThrow(/portable JSON/u);
  });

  it("validates lease carriers without executing accessors and enforces timestamp wire format", () => {
    let getterCalls = 0;
    const poisoned: Record<string, unknown> = {
      leaseId: "lease-1", holderId: "holder-1", leaseEpoch: 1, fencingToken: 1,
      acquiredAt: "2026-07-26T00:00:00Z", expiresAt: "2026-07-26T00:01:00Z",
    };
    Object.defineProperty(poisoned, "leaseId", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "lease-1";
      },
    });
    expect(() => validateCycleLease(poisoned)).toThrow(/bounded portable JSON/u);
    expect(getterCalls).toBe(0);
    expect(() => validateCycleLease({
      leaseId: "lease-1", holderId: "holder-1", leaseEpoch: 1, fencingToken: 1,
      acquiredAt: "July 26 2026 00:00:00 UTC", expiresAt: "2026-07-26T00:01:00Z",
    })).toThrow(/interval is invalid/u);
  });

  it("globally deduplicates all prior observations and requires exact verdict coverage", () => {
    const policy = validateCycleControllerPolicy(cycleFixture.validPolicies[0]!.document);
    const classified = validateCycleCandidates([
      { key: "rejected-before", value: { finding: 1 } },
      { key: "fresh", value: { finding: 2 } },
      { key: "fresh", value: { finding: 3 } },
      { key: "unknown-before", value: { finding: 4 } },
    ], policy, new Set(["rejected-before", "unknown-before"]));
    expect(classified.freshKeys).toEqual(["fresh"]);
    expect(classified.duplicateKeys).toEqual(["rejected-before", "fresh", "unknown-before"]);
    expect(classified.seenAdditions).toEqual(["fresh"]);

    expect(validateCycleVerdicts([{ key: "fresh", verdict: "reject" }], classified.freshKeys)).toMatchObject({
      rejectedKeys: ["fresh"], acceptedKeys: [], unknownKeys: [],
    });
    expect(() => validateCycleVerdicts([], classified.freshKeys)).toThrow(/every fresh key/u);
    expect(() => validateCycleVerdicts([
      { key: "fresh", verdict: "accept" }, { key: "fresh", verdict: "reject" },
    ], classified.freshKeys)).toThrow();
  });

  it("enforces exact candidate count, item-byte, batch-byte, and discovery-credit boundaries", () => {
    const base = cycleFixture.validPolicies[0]!.document as CycleControllerPolicy;
    const candidate = { key: "a", value: { claim: "x" } };
    const itemBytes = Buffer.byteLength(canonicalSerialize(candidate), "utf8");
    const batchBytes = Buffer.byteLength(canonicalSerialize([candidate]), "utf8");
    const exact = validateCycleControllerPolicy({
      ...base,
      maxCandidatesPerRound: 1,
      maxCandidateBytes: itemBytes,
      maxCandidateBatchBytes: batchBytes,
      maxDiscoveries: 1,
    });
    expect(validateCycleCandidates([candidate], exact, new Set()).freshKeys).toEqual(["a"]);
    expect(() => validateCycleCandidates(
      [candidate], validateCycleControllerPolicy({ ...exact, maxCandidateBytes: itemBytes - 1 }), new Set(),
    )).toThrowError(expect.objectContaining({ code: "GE_CYCLE_INVALID_CANDIDATE" }));
    expect(() => validateCycleCandidates(
      [candidate], validateCycleControllerPolicy({ ...exact, maxCandidateBatchBytes: batchBytes - 1 }), new Set(),
    )).toThrowError(expect.objectContaining({ code: "GE_CYCLE_INVALID_CANDIDATE" }));
    expect(() => validateCycleCandidates([candidate, candidate], exact, new Set())).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_INVALID_CANDIDATE" }),
    );
    expect(() => validateCycleCandidates(
      [candidate, { key: "b", value: true }],
      validateCycleControllerPolicy({
        ...exact, maxCandidatesPerRound: 2, maxCandidateBytes: 1024, maxCandidateBatchBytes: 4096,
      }),
      new Set(),
    )).toThrowError(expect.objectContaining({ code: "GE_CYCLE_INVALID_CANDIDATE" }));
  });

  it("round-trips truthful inline payloads without retaining caller mutation", () => {
    const input = { secret: "visible-by-explicit-alpha-contract", nested: [1, 2] };
    const payload = createCycleInlinePayload(input);
    input.nested.push(3);
    expect(payload.redacted).toBe(false);
    expect(payload.disposition).toBe("inline-unredacted");
    expect(decodeCycleInlinePayload(payload, 1024)).toEqual({
      secret: "visible-by-explicit-alpha-contract", nested: [1, 2],
    });
  });

  it("matches every shared inclusive hard-stop precedence oracle", () => {
    const base = cycleFixture.validPolicies[0]!.document as CycleControllerPolicy;
    const bounds = (durableCycleFixture as unknown as {
      hardStopPolicy: Partial<CycleControllerPolicy>;
      hardStopFoldCases: readonly {
        name: string;
        fold: {
          cancelled: boolean; durationMs: number; costUsd: number; attemptsUsed: number;
          dynamicNodes: number; seenCount: number; iterations: number; patchRejected: boolean;
          failed: boolean; unknownVerdict: boolean;
          convergenceReason: "DRY" | "CONDITION_FALSE" | "EVALUATOR_ACCEPTED" | null;
        };
        expectExitReason: string;
      }[];
    });
    const policy = validateCycleControllerPolicy({ ...base, ...bounds.hardStopPolicy });
    for (const item of bounds.hardStopFoldCases) {
      const observation = observeCycleExit({
        policy,
        ...item.fold,
        failureCode: item.fold.failed ? "GE_CYCLE_ACTIVITY_FAILED" : null,
      });
      expect(selectCycleExitReason(observation), item.name).toBe(item.expectExitReason);
    }
  });
});
