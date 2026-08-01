import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_CAPTURE_POLICY,
  DeterministicTestKeyProvider,
  FileProtectedPayloadStore,
  ProtectedJsonlEventStore,
  SinkGuard,
  keyRefHash,
  prepareProtectedEvent,
  type AuthorityScope,
  type CapturePolicy,
  type GuardResult,
  type ProtectedEventSpec,
} from "../../src/index.js";

export const TEST_SCOPE: AuthorityScope = Object.freeze({
  tenantScopeId: "tenant-opaque-1",
  authorityProviderId: "provider-opaque-1",
  authoritySubjectId: "subject-opaque-1",
});

export interface ProtectedRunHarness {
  readonly directory: string;
  readonly guard: SinkGuard;
  readonly journal: ProtectedJsonlEventStore;
  readonly keys: DeterministicTestKeyProvider;
  readonly store: FileProtectedPayloadStore;
  runCreated(runId: string, input: unknown, sequence?: number): Promise<GuardResult>;
  dispose(): Promise<void>;
}

export async function createProtectedRun(options: {
  readonly policy?: CapturePolicy;
  readonly withStore?: boolean;
  readonly scanner?: ConstructorParameters<typeof SinkGuard>[0]["scanner"];
} = {}): Promise<ProtectedRunHarness> {
  const directory = await mkdtemp(join(tmpdir(), "ge-protected-"));
  const keys = new DeterministicTestKeyProvider();
  const store = new FileProtectedPayloadStore({ directory });
  const journal = new ProtectedJsonlEventStore({ directory });
  const guard = new SinkGuard({
    policy: options.policy ?? DEFAULT_CAPTURE_POLICY,
    keys,
    ...(options.withStore === false ? {} : { store }),
    scope: TEST_SCOPE,
    ...(options.scanner === undefined ? {} : { scanner: options.scanner }),
  });

  const runCreated = async (
    runId: string,
    input: unknown,
    sequence = 0,
  ): Promise<GuardResult> => {
    const spec: ProtectedEventSpec = {
      decisionId: `decision-${runId}-${sequence}`,
      eventId: `evt-${sequence}`,
      type: "RunCreated",
      timestamp: "2026-07-30T00:00:00Z",
      runId,
      graphRevision: 1,
      sequence,
      sourceClass: "graph-input",
      data: {
        contractVersion: "scheduler-recovery/v1alpha2",
        graphHash: "a".repeat(64),
        implementationHash: "b".repeat(64),
        capturePolicyHash: guard.capturePolicyHash,
        protectedStoreContract: "protected-payload-store/v1alpha1",
        keyRefHash: keyRefHash(keys.keyRef),
        maxTotalAttempts: 8,
      },
      payloads: [
        {
          field: "inputRef",
          macField: "inputMac",
          semanticContext: { kind: "graph-input", runId, graphRevision: 1 },
          value: input,
        },
      ],
    };
    return prepareProtectedEvent(guard, journal, spec);
  };

  return {
    directory,
    guard,
    journal,
    keys,
    store,
    runCreated,
    dispose: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}
