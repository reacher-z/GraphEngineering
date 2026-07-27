import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalHash } from "@graph-engineering/core";
import type { JsonValue } from "../src/index.js";
import {
  createCycleControllerEvent,
  createCycleInlinePayload,
  type CycleControllerCheckpoint,
  type CycleControllerEvent,
  type CycleControllerRequest,
  type CycleControllerResult,
  type GraphPatch,
  type GraphRevision,
} from "../src/index.js";

export interface NamedDocument<T> {
  readonly name: string;
  readonly document: T;
  readonly expectObjectiveHash?: string;
  readonly expectControllerHash?: string;
  readonly expectRequestHash?: string;
}

export interface CycleControllerFixture {
  readonly hashDomains: Readonly<Record<string, string>>;
  readonly validPolicies: readonly NamedDocument<unknown>[];
  readonly invalidPolicyCases: readonly { readonly name: string; readonly document: unknown }[];
  readonly validRequests: readonly NamedDocument<CycleControllerRequest>[];
  readonly invalidRequestCases: readonly { readonly name: string; readonly document: unknown }[];
  readonly validResults: readonly NamedDocument<CycleControllerResult>[];
  readonly validRevisions: readonly NamedDocument<GraphRevision>[];
}

interface EventRecipe {
  readonly type: CycleControllerEvent["type"];
  readonly graphRevision: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface DurableCycleFixture {
  readonly validHistory: {
    readonly requestFixture: string;
    readonly resultFixture: string;
    readonly patchFixture: string;
    readonly revisionFixture: string;
    readonly lease: NonNullable<CycleControllerEvent["lease"]>;
    readonly events: readonly EventRecipe[];
    readonly expectEventRecordHashes: readonly string[];
    readonly expectTerminalRecordHash: string;
  };
  readonly checkpoint: {
    readonly name: string;
    readonly body: CycleControllerCheckpoint;
    readonly expectContentHash: string;
  };
  readonly invalidEventHistoryCases: readonly { readonly name: string; readonly mutations: readonly unknown[] }[];
  readonly invalidCheckpointSemanticCases: readonly { readonly name: string; readonly mutations: readonly unknown[] }[];
  readonly recoveryBoundaries: readonly { readonly name: string }[];
}

export interface GraphPatchFixture {
  readonly validCases: readonly NamedDocument<GraphPatch>[];
  readonly invalidCases: readonly { readonly name: string; readonly document?: unknown }[];
  readonly semanticCases: readonly { readonly name: string }[];
}

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`../../../spec/conformance/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export const cycleFixture = fixture<CycleControllerFixture>("cycle-controller.case.json");
export const durableCycleFixture = fixture<DurableCycleFixture>("cycle-controller-durable.case.json");
export const graphPatchFixture = fixture<GraphPatchFixture>("graph-patch.case.json");

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function materializeDurableHistory(): {
  readonly request: CycleControllerRequest;
  readonly result: CycleControllerResult;
  readonly patch: GraphPatch;
  readonly revision: GraphRevision;
  readonly events: readonly CycleControllerEvent[];
  readonly checkpoint: CycleControllerCheckpoint;
} {
  const recipe = durableCycleFixture.validHistory;
  const requestCase = cycleFixture.validRequests.find(({ name }) => name === recipe.requestFixture);
  const resultCase = cycleFixture.validResults.find(({ name }) => name === recipe.resultFixture);
  const patchCase = graphPatchFixture.validCases.find(({ name }) => name === recipe.patchFixture);
  const revisionCase = cycleFixture.validRevisions.find(({ name }) => name === recipe.revisionFixture);
  if (requestCase === undefined || resultCase === undefined || patchCase === undefined || revisionCase === undefined) {
    throw new TypeError("durable cycle recipe references a missing fixture");
  }
  const request = clone(requestCase.document);
  const result = clone(resultCase.document);
  const patch = clone(patchCase.document);
  const revision = clone(revisionCase.document);
  const patchPayload = createCycleInlinePayload(patch, 4_194_304);
  const events: CycleControllerEvent[] = [];
  const startedAtMs = Date.parse("2026-07-26T00:00:00Z");
  let previousEventHash: string | null = null;
  let observedDurationMs = 0;
  let checkpointMode = false;

  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (value !== null && typeof value === "object") {
      const item = value as Record<string, unknown>;
      if (Object.keys(item).length === 1 && "$fixture" in item) {
        if (item.$fixture === "request") return clone(request);
        if (item.$fixture === "policy") return clone(request.policy);
        if (item.$fixture === "patch-payload") return clone(patchPayload);
        if (item.$fixture === "revision") return clone(revision);
        if (item.$fixture === "lease") return clone(recipe.lease);
        if (item.$fixture === "round-record") return clone(events[14]!.data.record);
        if (item.$fixture === "terminal-record-hash") return events.at(-1)!.recordHash;
        if (item.$fixture === "result") {
          return {
            ...clone(result),
            historyPrefixHash: checkpointMode
              ? events[14]!.recordHash
              : previousEventHash ?? events[14]!.recordHash,
          };
        }
        throw new TypeError(`unknown durable fixture marker ${String(item.$fixture)}`);
      }
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, resolve(child)]));
    }
    return value;
  };

  for (const [sequence, eventRecipe] of recipe.events.entries()) {
    const data = resolve(eventRecipe.data) as Readonly<Record<string, unknown>>;
    const eventDuration = Number(
      data.durationMs
      ?? data.decidedAtDurationMs
      ?? (data.record as Record<string, unknown> | undefined)?.durationMs
      ?? (data.result as Record<string, unknown> | undefined)?.durationMs
      ?? observedDurationMs,
    );
    observedDurationMs = Math.max(observedDurationMs, eventDuration);
    const timestamp = observedDurationMs === 0
      ? "2026-07-26T00:00:00Z"
      : new Date(startedAtMs + observedDurationMs).toISOString();
    const event = createCycleControllerEvent({
      request,
      controllerHash: requestCase.expectControllerHash as string,
      requestHash: requestCase.expectRequestHash as string,
      type: eventRecipe.type,
      data,
      graphRevision: eventRecipe.graphRevision,
      sequence,
      previousEventHash,
      lease: sequence === 0 ? null : clone(recipe.lease),
      timestamp,
      eventId: `cycle-run-1-${sequence}`,
    });
    events.push(event);
    previousEventHash = event.recordHash;
  }

  checkpointMode = true;
  const checkpointBody = resolve(durableCycleFixture.checkpoint.body) as Omit<CycleControllerCheckpoint, "contentHash">;
  const checkpoint = {
    ...checkpointBody,
    contentHash: canonicalHash(checkpointBody),
  } as CycleControllerCheckpoint;
  return Object.freeze({ request, result, patch, revision, events: Object.freeze(events), checkpoint });
}

export function json<T extends JsonValue>(value: T): T {
  return value;
}
