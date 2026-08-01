import { readFileSync } from "node:fs";

import type {
  AdapterCapability,
  AdapterDescriptor,
  AdapterErrorCode,
  AdapterErrorEnvelope,
  AdapterRequest,
  AdapterUsage,
  CircuitStep,
  DenialReason,
  FinishReason,
  NormalizedStream,
  NormalizedUsage,
  ProviderMetricDeclaration,
  ReportableResource,
  RetryDecision,
  SideEffectClass,
  StreamFrame,
  ToolCallResponse,
} from "../src/index.js";

/**
 * The literal D13 conformance corpus. Nothing in this file restates a contract
 * fact: every expectation the package tests assert is read from here.
 */
export const CORPUS_PATH = new URL(
  "../../../spec/conformance/adapter.case.json",
  import.meta.url,
);

export interface Mutation {
  readonly op: "add" | "remove" | "replace";
  readonly path: string;
  readonly value?: unknown;
}

export interface DescriptorCase {
  readonly id: string;
  readonly base: string;
  readonly mutations: readonly Mutation[];
  readonly expectedCode: AdapterErrorCode | null;
  readonly expectedRule: string | null;
  readonly capabilitiesExercised?: readonly AdapterCapability[];
}

export interface PreflightCase {
  readonly id: string;
  readonly descriptor: string;
  readonly descriptorMutations?: readonly Mutation[];
  readonly requestMutations?: readonly Mutation[];
  readonly expectedCode: AdapterErrorCode | null;
  readonly expectedRule: string | null;
  readonly expectedMessage?: string;
  readonly expectedDenialReason?: DenialReason;
  readonly capabilitiesExercised?: readonly AdapterCapability[];
}

export interface StreamCase {
  readonly id: string;
  readonly descriptor: string;
  readonly descriptorMutations?: readonly Mutation[];
  readonly mutations?: readonly Mutation[];
  readonly expectedCode: AdapterErrorCode | null;
  readonly expectedRule: string | null;
  readonly expectedNormalized?: NormalizedStream;
  readonly finishReasonExercised?: FinishReason;
  readonly capabilitiesExercised?: readonly AdapterCapability[];
}

export interface UsageCase {
  readonly id: string;
  readonly descriptor: string;
  readonly descriptorMutations?: readonly Mutation[];
  readonly mutations?: readonly Mutation[];
  readonly expectedCode: AdapterErrorCode | null;
  readonly expectedRule: string | null;
  readonly expectedSummary?: NormalizedUsage;
  readonly schemaValid?: boolean;
  readonly resourcesExercised?: readonly ReportableResource[];
  readonly capabilitiesExercised?: readonly AdapterCapability[];
}

export interface ToolCase {
  readonly id: string;
  readonly descriptor: string;
  readonly descriptorMutations?: readonly Mutation[];
  readonly requestMutations?: readonly Mutation[];
  readonly mutations?: readonly Mutation[];
  readonly expectedCode: AdapterErrorCode | null;
  readonly expectedRule: string | null;
}

export interface ErrorCase {
  readonly id: string;
  readonly descriptor: string;
  readonly descriptorMutations?: readonly Mutation[];
  readonly mutations?: readonly Mutation[];
  readonly expectedCode: AdapterErrorCode | null;
  readonly expectedRule: string | null;
  readonly expectedSummary?: unknown;
  readonly schemaValid?: boolean;
}

export interface RetryCase {
  readonly id: string;
  readonly descriptor: string;
  readonly descriptorMutations?: readonly Mutation[];
  readonly code: AdapterErrorCode;
  readonly sideEffectClass: SideEffectClass;
  readonly attempt: number;
  readonly retryAfterMs: number | null;
  readonly expected: RetryDecision;
}

export interface CircuitCase {
  readonly id: string;
  readonly descriptor: string;
  readonly rules: readonly string[];
  readonly script: readonly CircuitStep[];
  readonly expected: unknown;
}

export interface SchemaNegativeCase {
  readonly id: string;
  readonly schema: string;
  readonly mutations: readonly Mutation[];
}

export interface RuleRegisterRow {
  readonly rule: string;
  readonly kind: "decision" | "rejection";
  readonly code: AdapterErrorCode | null;
  readonly denialReason: DenialReason | null;
  readonly obligation: string;
}

export interface TaxonomyRow {
  readonly code: AdapterErrorCode;
  readonly boundary: string;
  readonly retryable: boolean;
  readonly effectDisposition: string;
  readonly usageDisposition: string;
  readonly ledgerAction: string;
  readonly summary: string;
}

export interface AdapterCorpus {
  readonly apiVersion: string;
  readonly contractStatus: string;
  readonly implementationClaim: boolean;
  readonly evidenceClass: string;
  readonly environmentAssertions: Readonly<Record<string, boolean>>;
  readonly capabilityInventory: readonly AdapterCapability[];
  readonly adapterKindInventory: readonly string[];
  readonly denialReasonInventory: readonly DenialReason[];
  readonly finishReasonInventory: readonly FinishReason[];
  readonly reportableResourceInventory: readonly ReportableResource[];
  readonly budgetPolicyAllowedProviderMetrics: readonly ProviderMetricDeclaration[];
  readonly budgetComposition: {
    readonly resourceBindings: readonly {
      readonly resource: ReportableResource;
      readonly unit: string;
      readonly aggregation: string;
    }[];
    readonly forbiddenResources: readonly string[];
    readonly costStateBindings: readonly {
      readonly trust: string;
      readonly budgetCostState: string;
    }[];
  };
  readonly cycleComposition: {
    readonly sideEffectClasses: readonly SideEffectClass[];
    readonly matrix: readonly {
      readonly effectDisposition: string;
      readonly recordsInDoubtIdentity: boolean;
      readonly retryPermittedBySideEffect: boolean;
      readonly sideEffectClass: SideEffectClass;
    }[];
  };
  readonly errorTaxonomy: readonly TaxonomyRow[];
  readonly ruleRegister: readonly RuleRegisterRow[];
  readonly forbiddenMarkers: readonly string[];
  readonly declaredCounts: Readonly<Record<string, number>>;
  readonly descriptors: readonly AdapterDescriptor[];
  readonly requestTemplate: AdapterRequest;
  readonly streamTemplate: readonly StreamFrame[];
  readonly usageTemplate: AdapterUsage;
  readonly errorTemplate: AdapterErrorEnvelope;
  readonly toolResponseTemplate: ToolCallResponse;
  readonly schemaNegativeBase: string;
  readonly descriptorCases: readonly DescriptorCase[];
  readonly preflightCases: readonly PreflightCase[];
  readonly streamCases: readonly StreamCase[];
  readonly usageCases: readonly UsageCase[];
  readonly toolCases: readonly ToolCase[];
  readonly errorCases: readonly ErrorCase[];
  readonly retryCases: readonly RetryCase[];
  readonly circuitCases: readonly CircuitCase[];
  readonly schemaNegativeCases: readonly SchemaNegativeCase[];
  readonly integrationNotes: readonly {
    readonly integration: string;
    readonly mechanism: string;
    readonly officialV1Adapter: boolean;
    readonly privateApiClaim: boolean;
  }[];
  readonly nonClaims: readonly string[];
}

export const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as AdapterCorpus;

export function clone<T>(value: T): T {
  return structuredClone(value);
}

function pointerSegments(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`JSON Pointer must be empty or start with '/': ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** The corpus mutation language, applied exactly as the shipped oracle applies it. */
export function applyMutations<T>(document: T, mutations: readonly Mutation[] = []): T {
  for (const mutation of mutations) {
    const segments = pointerSegments(mutation.path);
    const leaf = segments.pop();
    if (leaf === undefined) throw new Error(`root mutation is not supported: ${mutation.path}`);
    let parent: unknown = document;
    for (const segment of segments) {
      if (parent === null || typeof parent !== "object") {
        throw new Error(`mutation parent does not exist: ${mutation.path}`);
      }
      parent = (parent as Record<string, unknown>)[segment];
    }
    if (parent === null || typeof parent !== "object") {
      throw new Error(`mutation parent does not exist: ${mutation.path}`);
    }
    const container = parent as Record<string, unknown>;
    if (mutation.op === "remove") {
      if (Array.isArray(container)) (container as unknown[]).splice(Number(leaf), 1);
      else delete container[leaf];
      continue;
    }
    const value = clone(mutation.value);
    if (mutation.op === "add") {
      if (Array.isArray(container)) (container as unknown[]).splice(Number(leaf), 0, value);
      else container[leaf] = value;
      continue;
    }
    if (mutation.op !== "replace") throw new Error(`unknown mutation op: ${mutation.op}`);
    container[leaf] = value;
  }
  return document;
}

export function descriptorNamed(adapterId: string): AdapterDescriptor {
  const found = corpus.descriptors.find((item) => item.adapterId === adapterId);
  if (found === undefined) throw new Error(`unknown corpus descriptor '${adapterId}'`);
  return found;
}

export function descriptorFor(
  adapterId: string,
  mutations: readonly Mutation[] = [],
): AdapterDescriptor {
  return applyMutations(clone(descriptorNamed(adapterId)), mutations);
}

export function requestFrom(mutations: readonly Mutation[] = []): AdapterRequest {
  return applyMutations(clone(corpus.requestTemplate), mutations);
}
