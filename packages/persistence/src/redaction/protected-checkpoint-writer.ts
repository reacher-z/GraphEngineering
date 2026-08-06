/**
 * Compose the sink-before-write guard with a guarded checkpoint sink for one
 * `checkpoints/v1alpha2` scheduler projection.
 *
 * spec/redaction-semantics.md Section 6.2: every scheduler checkpoint creates a
 * new checkpoint-bound protected occurrence for each projected application
 * value, with its own `checkpointId`, `sequence`, and field path in the AAD. An
 * event ref is never copied into the projection; the raw logical values are
 * handed to the guard as detached payload arguments and are never members of
 * the candidate record, so there is no window in which a plaintext payload
 * exists inside a record that could be serialized (Section 8.1).
 *
 * `contentHash` is Section 6.2's "SHA-256 of canonical UTF-8 JSON for the
 * entire closed checkpoint object with only `contentHash` omitted". Only the
 * guard can compute it — the hash covers the protected references the guard
 * itself places — so the request names `contentHashPath` and the guard performs
 * the finalization, exactly like `payloadHashPath` on the event path.
 */

import {
  CHECKPOINT_PROJECTION_TYPE,
  CHECKPOINT_V1ALPHA2_API_VERSION,
} from "./documents.js";
import { hmacSha256Hex } from "./crypto.js";
import { validateProtectedValueRefDocument } from "./documents.js";
import { encodeDurableJson } from "./durable-json.js";
import type { CaptureSinkClass, CaptureSourceClass, GuardFailure } from "./codes.js";
import type { GuardPayloadField, GuardResult, SinkGuard } from "./guard.js";
import { keyRefHash, type KeyProvider } from "./key-provider.js";
import { decodePointer, encodePointer } from "./pointer.js";
import { canonicalJsonString } from "./portable.js";
import {
  CONTRACT_VERSION_V1ALPHA2,
  DURABLE_CODEC,
  PROTECTED_AAD_API_VERSION,
  PROTECTED_STORE_CONTRACT,
  PROTECTED_STORE_ENVELOPE_API_VERSION,
  computeAadHash,
  computeAuthorityBindingHash,
  computeTenantScopeHash,
  issueProtectedStoreCapability,
  unprotectValue,
  type AuthorityScope,
  type ProtectedAad,
  type ProtectedPayloadStore,
  type ProtectedValueRef,
  type SemanticContext,
} from "./protected-store.js";

/** The exact source class a scheduler projection is captured from. */
export const CHECKPOINT_SOURCE_CLASS: CaptureSourceClass = "checkpoint-state";

/**
 * The part of a guarded checkpoint sink the writer needs: which of the closed
 * sink classes it occupies and the opaque per-instance binding a
 * `PreparedSinkWrite` is minted against. `GuardedFileCheckpointStore` satisfies
 * this structurally. Neither can be written to without a prepared write, which
 * is the property that matters.
 */
export interface GuardedCheckpointSink {
  readonly sink: CaptureSinkClass;
  readonly binding: object;
}

/** Section 6.2 closed failure codes a settled node projection may carry. */
export type CheckpointFailureCode =
  | "EXECUTOR_NOT_FOUND"
  | "NODE_EXECUTION_FAILED"
  | "NODE_TIMEOUT"
  | "NODE_CANCELLED"
  | "INVALID_OUTPUT"
  | "UPSTREAM_FAILED"
  | "INPUT_BINDING_FAILED"
  | "ATTEMPT_BUDGET_EXHAUSTED"
  | "NODE_EXECUTION_INTERRUPTED";

/**
 * One node projection, carrying the raw logical values the guard will protect.
 * The values never enter the candidate record; the guard places checkpoint-
 * bound references at `/nodes/<index>/inputRef` and friends.
 */
export type ProtectedCheckpointNodeSpec =
  | { readonly nodeId: string; readonly status: "pending" }
  | {
      readonly nodeId: string;
      readonly status: "running";
      readonly attempts: number;
      readonly input: unknown;
      readonly activityKey: string;
      readonly openAttempt: number;
    }
  | {
      readonly nodeId: string;
      readonly status: "retry-wait";
      readonly attempts: number;
      readonly input: unknown;
      readonly activityKey: string;
      readonly nextAttempt: number;
      readonly availableAt: string;
    }
  | {
      readonly nodeId: string;
      readonly status: "succeeded";
      readonly attempts: number;
      readonly input: unknown;
      readonly output: unknown;
      readonly activityKey: string;
    }
  | {
      readonly nodeId: string;
      readonly status: "failed" | "skipped";
      readonly attempts: number;
      readonly result: unknown;
      readonly failureCode: CheckpointFailureCode;
    };

export interface ProtectedCheckpointSpec {
  readonly decisionId: string;
  readonly runId: string;
  readonly checkpointId: string;
  readonly sequence: number;
  readonly createdAt: string;
  readonly graphRevision: number;
  readonly graphHash: string;
  readonly implementationHash: string;
  readonly keyRefHash: string;
  readonly historyPrefixHash: string;
  readonly totalAttempts: number;
  /** The raw graph input. It never enters the candidate record. */
  readonly graphInput: unknown;
  readonly nodes: readonly ProtectedCheckpointNodeSpec[];
}

interface PayloadPlan {
  readonly field: GuardPayloadField;
}

function nodePayloads(
  runId: string,
  graphRevision: number,
  index: number,
  node: ProtectedCheckpointNodeSpec,
): PayloadPlan[] {
  const at = (leaf: string): string => encodePointer(["nodes", String(index), leaf]);
  const plans: PayloadPlan[] = [];
  if (node.status === "running" || node.status === "retry-wait" || node.status === "succeeded") {
    plans.push({
      field: {
        refPath: at("inputRef"),
        macPath: at("inputMac"),
        semanticContext: { kind: "node-input", runId, graphRevision, nodeId: node.nodeId },
        value: node.input,
      },
    });
  }
  if (node.status === "succeeded") {
    plans.push({
      field: {
        refPath: at("outputRef"),
        macPath: at("outputMac"),
        semanticContext: { kind: "node-output", runId, graphRevision, nodeId: node.nodeId },
        value: node.output,
      },
    });
  }
  if (node.status === "failed" || node.status === "skipped") {
    plans.push({
      field: {
        refPath: at("resultRef"),
        macPath: at("resultMac"),
        semanticContext: { kind: "node-result", runId, graphRevision, nodeId: node.nodeId },
        value: node.result,
      },
    });
  }
  return plans;
}

function nodeSkeleton(node: ProtectedCheckpointNodeSpec): Record<string, unknown> {
  switch (node.status) {
    case "pending":
      return { nodeId: node.nodeId, status: node.status, attempts: 0 };
    case "running":
      return {
        nodeId: node.nodeId,
        status: node.status,
        attempts: node.attempts,
        activityKey: node.activityKey,
        openAttempt: node.openAttempt,
      };
    case "retry-wait":
      return {
        nodeId: node.nodeId,
        status: node.status,
        attempts: node.attempts,
        activityKey: node.activityKey,
        nextAttempt: node.nextAttempt,
        availableAt: node.availableAt,
      };
    case "succeeded":
      return {
        nodeId: node.nodeId,
        status: node.status,
        attempts: node.attempts,
        activityKey: node.activityKey,
      };
    default:
      return {
        nodeId: node.nodeId,
        status: node.status,
        attempts: node.attempts,
        failureCode: node.failureCode,
      };
  }
}

/**
 * Build the guard request for one `checkpoints/v1alpha2` projection and
 * evaluate it against the bound checkpoint sink instance. Returns `suppressed`,
 * a structured failure, or one `PreparedSinkWrite` — never `null` and never a
 * partly built record.
 */
export async function prepareProtectedCheckpoint(
  guard: SinkGuard,
  sink: GuardedCheckpointSink,
  spec: ProtectedCheckpointSpec,
): Promise<GuardResult> {
  const payloads: GuardPayloadField[] = [
    {
      refPath: encodePointer(["graphInputRef"]),
      macPath: encodePointer(["graphInputMac"]),
      semanticContext: {
        kind: "graph-input",
        runId: spec.runId,
        graphRevision: spec.graphRevision,
      },
      value: spec.graphInput,
    },
  ];
  for (const [index, node] of spec.nodes.entries()) {
    for (const plan of nodePayloads(spec.runId, spec.graphRevision, index, node)) {
      payloads.push(plan.field);
    }
  }

  const metadata: Record<string, unknown> = {
    apiVersion: CHECKPOINT_V1ALPHA2_API_VERSION,
    projectionType: CHECKPOINT_PROJECTION_TYPE,
    runId: spec.runId,
    checkpointId: spec.checkpointId,
    sequence: spec.sequence,
    createdAt: spec.createdAt,
    graphRevision: spec.graphRevision,
    graphHash: spec.graphHash,
    implementationHash: spec.implementationHash,
    capturePolicyHash: guard.capturePolicyHash,
    protectedStoreContract: PROTECTED_STORE_CONTRACT,
    keyRefHash: spec.keyRefHash,
    historyPrefixHash: spec.historyPrefixHash,
    totalAttempts: spec.totalAttempts,
    protectedRefCount: payloads.length,
    nodes: spec.nodes.map(nodeSkeleton),
  };

  return guard.prepare(
    {
      decisionId: spec.decisionId,
      sourceClass: CHECKPOINT_SOURCE_CLASS,
      sink: sink.sink,
      policyControl: "checkpointValues",
      authorityClass: "authoritative",
      metadata,
      payloads,
      contentHashPath: "/contentHash",
      occurrence: {
        runId: spec.runId,
        graphRevision: spec.graphRevision,
        recordKind: "checkpoint",
        recordType: CHECKPOINT_PROJECTION_TYPE,
        recordId: spec.checkpointId,
        sequence: spec.sequence,
      },
      occurredAt: spec.createdAt,
    },
    sink.binding,
  );
}

/* -------------------------------------------------------------------------
 * Authorized read side
 * ---------------------------------------------------------------------- */

export interface ProtectedCheckpointReaderOptions {
  readonly keys: KeyProvider;
  readonly store: ProtectedPayloadStore;
  readonly scope: AuthorityScope;
  /** The canonical policy hash the run was created under. */
  readonly capturePolicyHash: string;
}

export type ProtectedCheckpointReadResult =
  | { readonly ok: true; readonly taggedJson: string }
  | { readonly ok: false; readonly failure: GuardFailure };

function readFailure(
  code: GuardFailure["code"],
  phase: GuardFailure["phase"],
  reason: string,
): { readonly ok: false; readonly failure: GuardFailure } {
  return { ok: false, failure: { code, phase, reason, sink: "checkpoint-final" } };
}

function valueAtPointer(root: unknown, pointer: string): unknown {
  let tokens: readonly string[];
  try {
    tokens = decodePointer(pointer);
  } catch {
    return undefined;
  }
  let current: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token)) return undefined;
      current = current[Number(token)];
      continue;
    }
    if (typeof current !== "object" || current === null) return undefined;
    if (!Object.hasOwn(current as Record<string, unknown>, token)) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

/**
 * Resolve checkpoint-bound protected references out of a persisted
 * `checkpoints/v1alpha2` projection.
 *
 * A key provider is a construction requirement: the plain load path returns
 * only the projection with unresolved references, and there is no code path
 * that materializes a protected application value without this reader. The
 * occurrence AAD is rebuilt from the persisted projection envelope, so copying
 * a blob or reference to another run, checkpoint, sequence, or field path
 * fails authentication (Section 5.5).
 */
export class ProtectedCheckpointReader {
  readonly #keys: KeyProvider;
  readonly #store: ProtectedPayloadStore;
  readonly #scope: AuthorityScope;
  readonly #capturePolicyHash: string;
  readonly #capability = issueProtectedStoreCapability();

  constructor(options: ProtectedCheckpointReaderOptions) {
    this.#keys = options.keys;
    this.#store = options.store;
    this.#scope = options.scope;
    this.#capturePolicyHash = options.capturePolicyHash;
  }

  get capturePolicyHash(): string {
    return this.#capturePolicyHash;
  }

  #aad(
    checkpoint: Record<string, unknown>,
    fieldPath: string,
    reference: ProtectedValueRef,
  ): ProtectedAad {
    const runId = checkpoint["runId"] as string;
    const identityKey = this.#keys.runIdentityKey(runId);
    const tenantScopeHash = computeTenantScopeHash(identityKey, this.#scope.tenantScopeId);
    return {
      apiVersion: PROTECTED_AAD_API_VERSION,
      contractVersion: CONTRACT_VERSION_V1ALPHA2,
      runId,
      graphRevision: checkpoint["graphRevision"] as number,
      recordKind: "checkpoint",
      recordType: checkpoint["projectionType"] as string,
      checkpointId: checkpoint["checkpointId"] as string,
      sequence: checkpoint["sequence"] as number,
      fieldPath,
      capturePolicyHash: this.#capturePolicyHash,
      keyRefHash: keyRefHash(this.#keys.keyRef),
      authorityBindingHash: computeAuthorityBindingHash(identityKey, {
        authorityProviderId: this.#scope.authorityProviderId,
        authoritySubjectId: this.#scope.authoritySubjectId,
        tenantScopeHash,
        runId,
        capturePolicyHash: this.#capturePolicyHash,
        keyRefHash: keyRefHash(this.#keys.keyRef),
      }),
      tenantScopeHash,
      codec: DURABLE_CODEC,
      valueMac: reference.valueMac,
    };
  }

  /**
   * Authorize, authenticate, decrypt, and validate the semantic context of one
   * protected checkpoint field named by its RFC 6901 pointer (for example
   * `/graphInputRef` or `/nodes/0/inputRef`). Returns canonical Tagged Durable
   * JSON text or a structured failure; it never returns a partial or
   * substituted value.
   */
  async resolve(
    checkpoint: Record<string, unknown>,
    fieldPath: string,
    semanticContext: SemanticContext,
  ): Promise<ProtectedCheckpointReadResult> {
    const candidate = valueAtPointer(checkpoint, fieldPath);
    const shape = validateProtectedValueRefDocument(candidate);
    if (!shape.valid) {
      return readFailure("PROTECTED_PAYLOAD_CORRUPT", "classification", shape.reason);
    }
    const reference = candidate as ProtectedValueRef;

    // Section 6.1: the adjacent MAC must equal the referenced object's valueMac.
    if (fieldPath.endsWith("Ref")) {
      const adjacent = valueAtPointer(checkpoint, `${fieldPath.slice(0, -3)}Mac`);
      if (adjacent !== undefined && adjacent !== reference.valueMac) {
        return readFailure(
          "PROTECTED_PAYLOAD_CORRUPT",
          "classification",
          "adjacent-mac-differs-from-ref",
        );
      }
    }
    if (reference.keyRefHash !== keyRefHash(this.#keys.keyRef)) {
      return readFailure(
        "PROTECTED_PAYLOAD_UNAUTHORIZED",
        "policy",
        "reference-key-authority-differs",
      );
    }

    const aad = this.#aad(checkpoint, fieldPath, reference);
    if (computeAadHash(aad) !== reference.aadHash) {
      return readFailure("PROTECTED_PAYLOAD_CORRUPT", "classification", "occurrence-aad-hash-differs");
    }

    const fetched = await this.#store.get(this.#capability, {
      apiVersion: PROTECTED_STORE_ENVELOPE_API_VERSION,
      operationId: `${aad.checkpointId as string}.${fieldPath}.get`,
      operation: "get",
      runId: aad.runId,
      capturePolicyHash: this.#capturePolicyHash,
      keyRefHash: keyRefHash(this.#keys.keyRef),
      authorityBindingHash: aad.authorityBindingHash,
      tenantScopeHash: aad.tenantScopeHash,
      protectedValue: reference,
      aad,
    });
    if (!fetched.ok) {
      if (fetched.reason === "unauthorized") {
        return readFailure("PROTECTED_PAYLOAD_UNAUTHORIZED", "policy", "store-denied-the-read");
      }
      if (fetched.reason === "not-found") {
        return readFailure("PROTECTED_PAYLOAD_NOT_FOUND", "sink-write", "referenced-blob-is-missing");
      }
      return readFailure("PROTECTED_PAYLOAD_CORRUPT", "sink-write", fetched.reason);
    }

    const opened = unprotectValue(this.#keys, {
      protectedValue: reference,
      blob: fetched.blob,
      aad,
    });
    if (!opened.ok) {
      return readFailure("PROTECTED_PAYLOAD_CORRUPT", "protect", opened.reason);
    }

    // Section 5.6: recompute the semantic MAC over the decrypted logical value
    // and validate the expected logical context before exposing the value.
    let tagged: unknown;
    try {
      tagged = JSON.parse(opened.taggedJson);
    } catch {
      return readFailure("PROTECTED_PAYLOAD_CORRUPT", "encode", "plaintext-is-not-tagged-json");
    }
    const recomputed = hmacSha256Hex(
      this.#keys.runIdentityKey(aad.runId),
      canonicalJsonString([
        "a",
        [encodeDurableJson("value-mac/v1alpha1"), encodeDurableJson(semanticContext), tagged],
      ]),
    );
    if (recomputed !== reference.valueMac) {
      return readFailure("PROTECTED_PAYLOAD_CORRUPT", "mac", "semantic-context-or-value-mac-differs");
    }
    return { ok: true, taggedJson: opened.taggedJson };
  }
}
