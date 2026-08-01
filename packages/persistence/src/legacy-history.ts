/**
 * Legacy `scheduler-recovery/v1alpha1` history detection, per
 * spec/redaction-semantics.md Section 9.
 *
 * Section 9.2 forbids repair: an implementation MUST NOT flip a flag in place,
 * add a default and reinterpret old bytes as protected, recompute hashes and
 * rewrite JSONL, scrub or truncate the original history, copy a nonterminal
 * stream under a new run ID while retaining refs/MACs/activity keys, or
 * automatically resume externally effectful work. Nothing in this module writes
 * to a legacy journal; it only classifies and produces a metadata-only manifest.
 */

import { createHash } from "node:crypto";

import type { GraphEvent } from "./events.js";
import type { GuardFailure } from "./redaction/index.js";

export const LEGACY_CONTRACT_VERSION = "scheduler-recovery/v1alpha1" as const;

/** Section 9.1 known inline payload shapes, by event type. */
const KNOWN_INLINE_SHAPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  RunCreated: ["input"],
  NodeScheduled: ["input"],
  NodeSucceeded: ["output"],
  NodeSettledWithoutAttempt: ["result"],
  RunCancelled: ["result"],
  RunFailed: ["result"],
  RunSucceeded: ["result"],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when this event carries a known inline application payload shape. */
export function hasKnownInlineShape(event: GraphEvent): boolean {
  const fields = KNOWN_INLINE_SHAPES[event.type];
  if (fields !== undefined && fields.some((field) => Object.hasOwn(event.data, field))) return true;
  if (event.type !== "NodeAttemptFailed") return false;
  const failure = (event.data as Record<string, unknown>)["failure"];
  if (!isRecord(failure)) return false;
  return Object.hasOwn(failure, "message") || Object.hasOwn(failure, "causeName");
}

export type LegacyClassification =
  | { readonly kind: "not-legacy" }
  | { readonly kind: "misleading"; readonly failure: GuardFailure; readonly sequences: readonly number[] }
  | {
      readonly kind: "truthful-inline";
      readonly failure: GuardFailure | undefined;
      readonly sequences: readonly number[];
    };

export interface LegacyClassificationOptions {
  /**
   * Section 9.1: explicit legacy-inline authorization may permit a narrowly
   * scoped unsafe read/continuation during the truth-hotfix window. It is never
   * protected D9 evidence and the stable production profile disables it.
   */
  readonly legacyInlineAuthorized?: boolean;
}

/**
 * Classify a v1alpha1 stream before `RunResumed`, before append, and before any
 * executor invocation. A terminal stream is not exempt.
 */
export function classifyLegacyHistory(
  events: readonly GraphEvent[],
  options: LegacyClassificationOptions = {},
): LegacyClassification {
  const created = events.find((event) => event.type === "RunCreated");
  const contractVersion = created === undefined ? undefined : created.data["contractVersion"];
  if (contractVersion !== LEGACY_CONTRACT_VERSION) return { kind: "not-legacy" };

  const inline = events.filter((event) => hasKnownInlineShape(event));
  if (inline.length === 0) return { kind: "not-legacy" };

  // "redacted was absent/defaulted" is the same observable fact as a true claim:
  // the v1alpha1 schema supplied `default: true`, so absence read as true.
  const misleading = inline.filter((event) => event.redacted !== false);
  if (misleading.length > 0) {
    return {
      kind: "misleading",
      failure: {
        code: "LEGACY_REDACTION_MISMATCH",
        phase: "classification",
        reason: "v1alpha1-inline-payload-claims-or-defaults-to-redacted",
      },
      sequences: misleading.map((event) => event.sequence),
    };
  }

  return {
    kind: "truthful-inline",
    failure:
      options.legacyInlineAuthorized === true
        ? undefined
        : {
            code: "INLINE_CAPTURE_NOT_AUTHORIZED",
            phase: "policy",
            reason: "v1alpha1-inline-history-requires-explicit-legacy-authorization",
          },
    sequences: inline.map((event) => event.sequence),
  };
}

export interface LegacyQuarantineManifest {
  readonly apiVersion: "graphengineering.reacher-z.github.io/legacy-quarantine/v1alpha1";
  readonly sourceDigest: string;
  readonly sourceByteLength: number;
  readonly classification: "misleading-redacted-claim" | "truthful-inline-unredacted";
  readonly disposition: "quarantine";
  readonly recordedAt: string;
  readonly affectedSequences: readonly number[];
}

/**
 * Section 9.3 quarantine: preserve the original bytes read-only, record their
 * SHA-256 digest and unsafe classification in a metadata-only manifest, and
 * block resume. The manifest never contains source payloads, canary values, or
 * unkeyed logical-value digests — the digest is over the whole file, which is
 * the artifact being quarantined, not a logical value.
 */
export function legacyQuarantineManifest(input: {
  readonly bytes: Uint8Array;
  readonly classification: LegacyQuarantineManifest["classification"];
  readonly recordedAt: string;
  readonly affectedSequences: readonly number[];
}): LegacyQuarantineManifest {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/legacy-quarantine/v1alpha1",
    sourceDigest: createHash("sha256").update(input.bytes).digest("hex"),
    sourceByteLength: input.bytes.byteLength,
    classification: input.classification,
    disposition: "quarantine",
    recordedAt: input.recordedAt,
    affectedSequences: [...input.affectedSequences],
  };
}
