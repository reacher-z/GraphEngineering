/**
 * Compose the sink-before-write guard with the guarded journal for one
 * `events/v1alpha2` record.
 *
 * Section 8.1 order: snapshot and validate the logical value, encode canonical
 * Tagged Durable JSON, compute its semantic-context `valueMac`, construct
 * occurrence-specific AAD, protect and atomically publish the blob, persist only
 * the validated `ProtectedValueRef` and allowed metadata, compute `payloadHash`
 * over the exact persisted `data` containing refs, and only then commit.
 *
 * The raw application value is passed to the guard as a detached argument and is
 * never a member of the candidate record, so there is no window in which a
 * plaintext payload exists inside a record that could be serialized.
 */

import type { GraphEventV1Alpha2Type } from "./events-v1alpha2.js";
import { GRAPH_EVENT_V1ALPHA2_API_VERSION } from "./events-v1alpha2.js";
import {
  encodePointer,
  type CaptureSinkClass,
  type CaptureSourceClass,
  type GuardPayloadField,
  type GuardResult,
  type SemanticContext,
  type SinkGuard,
} from "./redaction/index.js";

/**
 * The part of a guarded journal the writer needs: which of the 54 sink classes
 * it occupies and the opaque per-instance binding a `PreparedSinkWrite` is
 * minted against. `ProtectedJsonlEventStore` satisfies this structurally; so
 * does an in-memory guarded journal. Neither can be written to without a
 * prepared write, which is the property that matters.
 */
export interface GuardedEventSink {
  readonly sink: CaptureSinkClass;
  readonly binding: object;
}

export interface ProtectedEventPayload {
  /** The `data` member that will hold the reference, e.g. `inputRef`. */
  readonly field: string;
  /** The adjacent metadata MAC member, e.g. `inputMac`. */
  readonly macField?: string;
  readonly semanticContext: SemanticContext;
  /** The raw application value. It never enters the candidate record. */
  readonly value: unknown;
}

export interface ProtectedEventSpec {
  readonly decisionId: string;
  readonly eventId: string;
  readonly type: GraphEventV1Alpha2Type;
  readonly timestamp: string;
  readonly runId: string;
  readonly graphRevision: number;
  readonly sequence: number;
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly attempt?: number;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
  /** The closed metadata members of `data`. No application value belongs here. */
  readonly data?: Readonly<Record<string, unknown>>;
  readonly payloads?: readonly ProtectedEventPayload[];
  /** The exact source class from the closed 57-value inventory. */
  readonly sourceClass: CaptureSourceClass;
}

/**
 * Build the guard request for one v1alpha2 event and evaluate it against the
 * bound journal instance. Returns `suppressed`, a structured failure, or one
 * `PreparedSinkWrite` — never `null` and never a partly built record.
 */
export async function prepareProtectedEvent(
  guard: SinkGuard,
  journal: GuardedEventSink,
  spec: ProtectedEventSpec,
): Promise<GuardResult> {
  const payloads: GuardPayloadField[] = (spec.payloads ?? []).map((payload) => ({
    refPath: encodePointer(["data", payload.field]),
    ...(payload.macField === undefined
      ? {}
      : { macPath: encodePointer(["data", payload.macField]) }),
    semanticContext: payload.semanticContext,
    value: payload.value,
  }));

  const metadata: Record<string, unknown> = {
    apiVersion: GRAPH_EVENT_V1ALPHA2_API_VERSION,
    eventId: spec.eventId,
    type: spec.type,
    timestamp: spec.timestamp,
    runId: spec.runId,
    graphRevision: spec.graphRevision,
    sequence: spec.sequence,
    capturePolicyHash: guard.capturePolicyHash,
    data: { ...(spec.data ?? {}) },
  };
  for (const key of ["nodeId", "edgeId", "attempt", "traceId", "spanId", "parentSpanId"] as const) {
    const value = spec[key];
    if (value !== undefined) metadata[key] = value;
  }

  return guard.prepare(
    {
      decisionId: spec.decisionId,
      sourceClass: spec.sourceClass,
      sink: journal.sink,
      policyControl: "events",
      authorityClass: payloads.length > 0 ? "authoritative" : "observational",
      metadata,
      payloads,
      payloadHashPath: "/payloadHash",
      occurrence: {
        runId: spec.runId,
        graphRevision: spec.graphRevision,
        recordKind: "event",
        recordType: spec.type,
        recordId: spec.eventId,
        sequence: spec.sequence,
        ...(spec.nodeId === undefined ? {} : { nodeId: spec.nodeId }),
        ...(spec.edgeId === undefined ? {} : { edgeId: spec.edgeId }),
        ...(spec.attempt === undefined ? {} : { attempt: spec.attempt }),
      },
      occurredAt: spec.timestamp,
    },
    journal.binding,
  );
}
