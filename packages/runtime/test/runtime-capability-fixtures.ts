import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { GraphSpec } from "@graph-engineering/core";

export interface RuntimeCapabilityExpectedFailure {
  readonly code: "UNSUPPORTED_RUNTIME_CAPABILITY";
  readonly nodeId: string;
  readonly message: string;
}

export interface RuntimeCapabilityCase {
  readonly name: string;
  readonly graph: GraphSpec;
  readonly expect: {
    readonly supported: boolean;
    readonly failures: readonly RuntimeCapabilityExpectedFailure[];
  };
}

export interface RuntimeCapabilityCorpus {
  readonly contract: "runtime-capability/v1alpha1";
  readonly failureCode: "UNSUPPORTED_RUNTIME_CAPABILITY";
  readonly failureProjection: {
    readonly status: "failed";
    readonly nodeCount: 0;
    readonly totalAttempts: 0;
    readonly scheduledOrder: readonly [];
    readonly completionOrder: readonly [];
    readonly executorCalls: 0;
    readonly ordinaryJournalCalls: 0;
    readonly durableReadCalls: 0;
    readonly durableAppendCalls: 0;
  };
  readonly cases: readonly RuntimeCapabilityCase[];
}

export function runtimeCapabilityCorpus(): RuntimeCapabilityCorpus {
  const path = fileURLToPath(new URL(
    "../../../spec/conformance/runtime-capability.case.json",
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, "utf8")) as RuntimeCapabilityCorpus;
}

export function projectedRuntimeCapabilityFailures(
  testCase: RuntimeCapabilityCase,
): readonly Readonly<{
  phase: "execute";
  nodeId: string;
  code: "UNSUPPORTED_RUNTIME_CAPABILITY";
  message: string;
  attempt: 0;
  retryable: false;
}>[] {
  return testCase.expect.failures.map((failure) => ({
    phase: "execute" as const,
    ...failure,
    attempt: 0 as const,
    retryable: false as const,
  }));
}
