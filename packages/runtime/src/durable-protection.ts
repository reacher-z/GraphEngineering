/**
 * The guarded `events/v1alpha2` write and read path for the durable scheduler.
 *
 * spec/redaction-semantics.md Section 7 requires that every default runtime sink
 * receive data only after the shared deterministic guard has completed, and that
 * "the default runtime dependency graph exposes only sinks whose public write
 * method accepts a `PreparedSinkWrite`". This module is the durable scheduler's
 * single door to the journal: it turns a scheduler event draft into one guarded
 * record whose authoritative application values exist on the wire only as
 * validated `ProtectedValueRef`s, and it resolves those references back into
 * detached values on recovery.
 *
 * There is no fallback. If a compatible `ProtectedPayloadStore` and
 * `KeyProvider` are not configured, `assertPayloadProtection` fails with
 * `PAYLOAD_PROTECTION_REQUIRED` before the first event, checkpoint, log, error
 * payload, temporary file, or executor invocation (Section 4.2).
 *
 * Honest claim boundary: a recovered value is decoded into process memory so the
 * scheduler can bind it as node input. Section 13 already states that this
 * contract does not hide values "from an authorized executor after decryption or
 * from the runtime process memory needed to execute". What it does guarantee is
 * that no byte of that value reaches a sink outside the protected blob.
 */

import { canonicalHash } from "@graph-engineering/core";
import {
  DEFAULT_CAPTURE_POLICY,
  PROTECTED_STORE_CONTRACT,
  ProtectedEventReader,
  SinkGuard,
  canonicalTagged,
  computeValueMac,
  hmacSha256Hex,
  keyRefHash,
  prepareProtectedEvent,
  type AuthorityScope,
  type CapturePolicy,
  type CaptureSinkClass,
  type CaptureSourceClass,
  type GraphEventType,
  type GraphEventV1Alpha2,
  type GraphEventV1Alpha2Type,
  type GuardFailure,
  type KeyProvider,
  type PreparedSinkWrite,
  type ProtectedEventSpec,
  type ProtectedPayloadStore,
  type SemanticContext,
  type SinkScannerOptions,
} from "@graph-engineering/persistence";

import { decodeDurableJson } from "./durable-json.js";
import { DurableRunError, type DurableRunErrorCode } from "./durable-types.js";
import type { JsonValue } from "./types.js";

export const DURABLE_CONTRACT_VERSION = "scheduler-recovery/v1alpha2" as const;
export const DURABLE_GRAPH_REVISION = 1;

/**
 * The guarded journal surface. `ProtectedJsonlEventStore` and
 * `MemoryProtectedEventStore` both satisfy it structurally. The only way to put
 * a byte in one is a `PreparedSinkWrite` minted by the guard for that exact
 * instance, so an adapter cannot opt out by calling a lower-level raw writer.
 */
export interface GuardedDurableJournal {
  readonly sink: CaptureSinkClass;
  readonly binding: object;
  append(
    runId: string,
    expectedVersion: number,
    writes: readonly PreparedSinkWrite[],
  ): Promise<number>;
  read(runId: string, fromSequence?: number): AsyncIterable<GraphEventV1Alpha2>;
}

/** Operator-owned payload protection for one durable run (Sections 4.1 and 5.3). */
export interface DurablePayloadProtection {
  readonly journal: GuardedDurableJournal;
  readonly payloadStore: ProtectedPayloadStore;
  readonly keys: KeyProvider;
  readonly scope: AuthorityScope;
  /** Defaults to the Section 4.1 stable profile. */
  readonly policy?: CapturePolicy;
  readonly scanner?: SinkScannerOptions;
}

export interface DurablePayloadDraft {
  /** The `data` member that will hold the reference. */
  readonly field: "inputRef" | "outputRef" | "resultRef" | "evidenceRef";
  readonly semanticContext: SemanticContext;
  /** The raw application value. It never enters the candidate record. */
  readonly value: unknown;
}

export interface DurableEventDraft {
  readonly type: GraphEventV1Alpha2Type;
  /** Closed metadata members only. No application value belongs here. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly payloads?: readonly DurablePayloadDraft[];
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly attempt?: number;
}

/**
 * One persisted event with its protected references resolved back into detached
 * values. This is a recovery projection held in process memory; it is never
 * serialized to any sink.
 */
export interface RecoveredEvent {
  readonly eventId: string;
  readonly type: GraphEventType;
  readonly timestamp: string;
  readonly runId: string;
  readonly graphRevision: number;
  readonly sequence: number;
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly attempt?: number;
  readonly payloadHash: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Section 1.2 source classification for each scheduler event type. A name that
 * sounds like metadata does not make its contents safe, so every event carrying
 * an application payload is classified by what that payload actually is.
 */
const EVENT_SOURCE_CLASS: Readonly<Record<GraphEventV1Alpha2Type, CaptureSourceClass>> =
  Object.freeze({
    RunCreated: "graph-input",
    RunStarted: "runtime-generated-identifier",
    RunResumed: "runtime-generated-identifier",
    NodeScheduled: "bound-node-input",
    NodeStarted: "runtime-generated-identifier",
    NodeAttemptFailed: "exception-message",
    NodeSettledWithoutAttempt: "node-result",
    NodeRetried: "runtime-generated-identifier",
    NodeSucceeded: "node-output",
    EdgeEmitted: "runtime-generated-identifier",
    RunCancelled: "run-result",
    RunFailed: "run-result",
    RunSucceeded: "run-result",
  });

const MAC_FIELD: Readonly<Record<DurablePayloadDraft["field"], string>> = Object.freeze({
  inputRef: "inputMac",
  outputRef: "outputMac",
  resultRef: "resultMac",
  evidenceRef: "evidenceMac",
});

/** Section 10 codes are portable; they surface as durable run error codes. */
function protectionCode(failure: GuardFailure): DurableRunErrorCode {
  switch (failure.code) {
    case "PAYLOAD_PROTECTION_REQUIRED":
    case "PAYLOAD_PROTECTION_FAILED":
    case "CAPTURE_POLICY_MISMATCH":
    case "INLINE_CAPTURE_NOT_AUTHORIZED":
    case "PROTECTED_PAYLOAD_NOT_FOUND":
    case "PROTECTED_PAYLOAD_UNAUTHORIZED":
    case "PROTECTED_PAYLOAD_CORRUPT":
    case "SECRET_CANARY_DETECTED":
      return failure.code;
    default:
      return "PAYLOAD_PROTECTION_FAILED";
  }
}

/**
 * Section 10: the failure is structured and does not echo the offending value.
 * Only the stable code, phase, safe reason token, and run/node identifiers are
 * carried out.
 */
export function protectionError(runId: string, failure: GuardFailure): DurableRunError {
  return new DurableRunError(
    protectionCode(failure),
    runId,
    "durable payload protection refused the operation",
    {
      code: failure.code,
      phase: failure.phase,
      reason: failure.reason,
      ...(failure.sink === undefined ? {} : { sink: failure.sink }),
      ...(failure.sourceClass === undefined ? {} : { sourceClass: failure.sourceClass }),
    },
  );
}

/**
 * Section 4.2: a durable start, resume, or checkpoint save that would persist an
 * authoritative application value without a compatible `ProtectedPayloadStore`
 * plus `KeyProvider` fails with `PAYLOAD_PROTECTION_REQUIRED` before the first
 * event, checkpoint, log, error payload, temporary plaintext file, or executor
 * invocation. It never generates a key beside the ciphertext and never falls
 * back to inline capture.
 */
export function assertPayloadProtection(
  runId: string,
  protection: DurablePayloadProtection | undefined,
): asserts protection is DurablePayloadProtection {
  const missing: string[] = [];
  const has = (owner: unknown, ...methods: readonly string[]): boolean =>
    typeof owner === "object" &&
    owner !== null &&
    methods.every((name) => typeof (owner as Record<string, unknown>)[name] === "function");

  if (typeof protection !== "object" || protection === null) {
    missing.push("protection");
  } else {
    if (!has(protection.journal, "append", "read")) missing.push("journal");
    if (!has(protection.payloadStore, "put", "get")) missing.push("payloadStore");
    if (
      !has(protection.keys, "protectionKey", "runIdentityKey", "nonce") ||
      typeof protection.keys.keyRef !== "string" ||
      protection.keys.keyRef.length === 0
    ) {
      missing.push("keys");
    }
    const scope = protection.scope as unknown as Record<string, unknown> | undefined;
    if (
      typeof scope !== "object" ||
      scope === null ||
      typeof scope["tenantScopeId"] !== "string" ||
      typeof scope["authorityProviderId"] !== "string" ||
      typeof scope["authoritySubjectId"] !== "string"
    ) {
      missing.push("scope");
    }
  }
  if (missing.length === 0) return;
  throw new DurableRunError(
    "PAYLOAD_PROTECTION_REQUIRED",
    runId,
    "durable persistence requires a protected payload store and key provider",
    { missing, contract: PROTECTED_STORE_CONTRACT },
  );
}

/** Section 8.2 activity/idempotency key. Attempt is deliberately excluded. */
export function durableActivityKey(
  identityKey: Uint8Array,
  fields: { runId: string; graphRevision: number; nodeId: string; inputMac: string },
): string {
  return hmacSha256Hex(
    identityKey,
    canonicalTagged([
      "activity/v1alpha2",
      fields.runId,
      fields.graphRevision,
      fields.nodeId,
      fields.inputMac,
    ]),
  );
}

interface ProtectedFieldSpec {
  readonly field: DurablePayloadDraft["field"];
  readonly semanticContext: SemanticContext;
  /** The hydrated `data` member that receives the decoded value. */
  readonly target: string;
  /** True when the hydrated member holds the tagged encoding, not the value. */
  readonly tagged: boolean;
}

/**
 * One protected durable run: the guard, the guarded journal it is bound to, and
 * the authorized reader for its references.
 */
export class ProtectedDurableRun {
  readonly runId: string;
  readonly #protection: DurablePayloadProtection;
  readonly #guard: SinkGuard;
  readonly #reader: ProtectedEventReader;
  readonly #identityKey: Uint8Array;

  constructor(protection: DurablePayloadProtection, runId: string) {
    this.runId = runId;
    this.#protection = protection;
    this.#guard = new SinkGuard({
      policy: protection.policy ?? DEFAULT_CAPTURE_POLICY,
      keys: protection.keys,
      store: protection.payloadStore,
      scope: protection.scope,
      ...(protection.scanner === undefined ? {} : { scanner: protection.scanner }),
    });
    this.#reader = new ProtectedEventReader({
      keys: protection.keys,
      store: protection.payloadStore,
      scope: protection.scope,
      capturePolicyHash: this.#guard.capturePolicyHash,
    });
    this.#identityKey = protection.keys.runIdentityKey(runId);
  }

  get capturePolicyHash(): string {
    return this.#guard.capturePolicyHash;
  }

  get keyRefHash(): string {
    return keyRefHash(this.#protection.keys.keyRef);
  }

  /** Section 4.4: a resume whose policy hash differs is `CAPTURE_POLICY_MISMATCH`. */
  assertPolicyHash(expected: unknown): void {
    if (typeof expected !== "string") {
      throw new DurableRunError(
        "CAPTURE_POLICY_MISMATCH",
        this.runId,
        "durable run does not record a capture policy hash",
      );
    }
    const failure = this.#guard.assertPolicyHash(expected);
    if (failure !== undefined) throw protectionError(this.runId, failure);
  }

  /** Section 5.4 semantic value MAC, the logical identity used in recovery. */
  valueMac(semanticContext: SemanticContext, value: unknown): string {
    return computeValueMac(this.#identityKey, semanticContext, value);
  }

  activityKey(nodeId: string, inputMac: string): string {
    return durableActivityKey(this.#identityKey, {
      runId: this.runId,
      graphRevision: DURABLE_GRAPH_REVISION,
      nodeId,
      inputMac,
    });
  }

  /**
   * Guard one batch and commit it as a unit. Section 7: a multi-event commit is
   * rejected as a unit before a dependent is released, so every prepared write
   * is minted before the journal is touched.
   */
  async append(
    expectedVersion: number,
    drafts: readonly DurableEventDraft[],
    eventIdFor: (sequence: number, type: GraphEventV1Alpha2Type) => string,
    timestamp: () => string,
  ): Promise<number> {
    const prepared: PreparedSinkWrite[] = [];
    for (const [index, draft] of drafts.entries()) {
      const sequence = expectedVersion + 1 + index;
      const eventId = eventIdFor(sequence, draft.type);
      const spec: ProtectedEventSpec = {
        decisionId: `${this.runId}.${sequence}.${draft.type}`,
        eventId,
        type: draft.type,
        timestamp: timestamp(),
        runId: this.runId,
        graphRevision: DURABLE_GRAPH_REVISION,
        sequence,
        sourceClass: EVENT_SOURCE_CLASS[draft.type],
        data: draft.data,
        ...(draft.nodeId === undefined ? {} : { nodeId: draft.nodeId }),
        ...(draft.edgeId === undefined ? {} : { edgeId: draft.edgeId }),
        ...(draft.attempt === undefined ? {} : { attempt: draft.attempt }),
        ...(draft.payloads === undefined || draft.payloads.length === 0
          ? {}
          : {
              payloads: draft.payloads.map((payload) => ({
                field: payload.field,
                macField: MAC_FIELD[payload.field],
                semanticContext: payload.semanticContext,
                value: payload.value,
              })),
            }),
      };
      const result = await prepareProtectedEvent(this.#guard, this.#protection.journal, spec);
      if (result.kind === "failed") throw protectionError(this.runId, result.failure);
      if (result.kind === "suppressed") {
        throw protectionError(this.runId, {
          code: "PAYLOAD_PROTECTION_FAILED",
          phase: "policy",
          reason: "capture-policy-suppressed-an-authoritative-durable-event",
        });
      }
      prepared.push(result.prepared);
    }
    return this.#protection.journal.append(this.runId, expectedVersion, prepared);
  }

  /** Read the persisted stream with every protected reference resolved. */
  async read(): Promise<readonly RecoveredEvent[]> {
    const persisted: GraphEventV1Alpha2[] = [];
    for await (const event of this.#protection.journal.read(this.runId)) persisted.push(event);
    const recovered: RecoveredEvent[] = [];
    for (const event of persisted) recovered.push(await this.#recover(event));
    return recovered;
  }

  #fields(event: GraphEventV1Alpha2): readonly ProtectedFieldSpec[] {
    const runId = event.runId;
    const graphRevision = event.graphRevision;
    const nodeId = event.nodeId as string;
    switch (event.type) {
      case "RunCreated":
        return [{
          field: "inputRef",
          semanticContext: { kind: "graph-input", runId, graphRevision },
          target: "input",
          tagged: true,
        }];
      case "NodeScheduled":
        return [{
          field: "inputRef",
          semanticContext: { kind: "node-input", runId, graphRevision, nodeId },
          target: "input",
          tagged: true,
        }];
      case "NodeSucceeded":
        return [{
          field: "outputRef",
          semanticContext: { kind: "node-output", runId, graphRevision, nodeId },
          target: "output",
          tagged: true,
        }];
      case "NodeSettledWithoutAttempt":
        return [{
          field: "resultRef",
          semanticContext: { kind: "node-result", runId, graphRevision, nodeId },
          target: "result",
          tagged: true,
        }];
      case "RunSucceeded":
      case "RunFailed":
      case "RunCancelled":
        return [{
          field: "resultRef",
          semanticContext: { kind: "run-result", runId, graphRevision },
          target: "result",
          tagged: true,
        }];
      case "NodeAttemptFailed": {
        if (event.data["evidenceRef"] === undefined) return [];
        const inline = event.data["failure"];
        const code =
          typeof inline === "object" && inline !== null
            ? String((inline as Record<string, unknown>)["code"])
            : "";
        return [{
          field: "evidenceRef",
          semanticContext: {
            kind: "diagnostic-evidence",
            runId,
            graphRevision,
            nodeId,
            attempt: event.attempt as number,
            code,
          },
          target: "failure",
          tagged: false,
        }];
      }
      default:
        return [];
    }
  }

  async #recover(event: GraphEventV1Alpha2): Promise<RecoveredEvent> {
    // The recovery projection keeps every closed metadata member and every
    // adjacent `*Mac` identity, drops the opaque references it just resolved,
    // and drops `evidenceMac` because the resolved evidence replaces the closed
    // failure projection wholesale.
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.data)) {
      if (key.endsWith("Ref") || key === "evidenceMac") continue;
      data[key] = value;
    }

    for (const spec of this.#fields(event)) {
      const resolved = await this.#reader.resolve(event, spec.field, spec.semanticContext);
      if (!resolved.ok) throw protectionError(this.runId, resolved.failure);
      let tagged: unknown;
      try {
        tagged = JSON.parse(resolved.taggedJson);
      } catch {
        throw protectionError(this.runId, {
          code: "PROTECTED_PAYLOAD_CORRUPT",
          phase: "encode",
          reason: "protected-plaintext-is-not-tagged-json",
        });
      }
      if (spec.tagged) {
        data[spec.target] = tagged;
        continue;
      }
      let decoded: JsonValue;
      try {
        decoded = decodeDurableJson(tagged);
      } catch {
        throw protectionError(this.runId, {
          code: "PROTECTED_PAYLOAD_CORRUPT",
          phase: "encode",
          reason: "protected-plaintext-is-not-canonical-durable-json",
        });
      }
      // Section 6.1 keeps the closed inline projection authoritative for the
      // fields it carries; the protected evidence must agree with it exactly.
      const inline = data[spec.target];
      if (typeof inline === "object" && inline !== null && typeof decoded === "object" &&
          decoded !== null && !Array.isArray(decoded)) {
        for (const [key, value] of Object.entries(inline as Record<string, unknown>)) {
          if (JSON.stringify((decoded as Record<string, unknown>)[key]) !== JSON.stringify(value)) {
            throw protectionError(this.runId, {
              code: "PROTECTED_PAYLOAD_CORRUPT",
              phase: "classification",
              reason: "protected-evidence-contradicts-its-closed-metadata-projection",
            });
          }
        }
      }
      data[spec.target] = decoded;
    }

    return {
      eventId: event.eventId,
      type: event.type,
      timestamp: event.timestamp,
      runId: event.runId,
      graphRevision: event.graphRevision,
      sequence: event.sequence,
      ...(event.nodeId === undefined ? {} : { nodeId: event.nodeId }),
      ...(event.edgeId === undefined ? {} : { edgeId: event.edgeId }),
      ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
      payloadHash: canonicalHash(data),
      data,
    };
  }
}
