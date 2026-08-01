/**
 * The payload-disposition truth table of spec/redaction-semantics.md Section 3.2.
 *
 * | Persisted condition                                   | disposition         | redacted |
 * | ----------------------------------------------------- | ------------------- | -------- |
 * | No application payload field was sourced               | metadata-only       | false    |
 * | Authoritative values appear only as protected refs     | protected-ref       | false    |
 * | An irreversible transform ran and a receipt is present | redacted            | true     |
 * | Plaintext application material remains                 | inline-unredacted   | false    |
 *
 * `redacted` tells the truth about the bytes in *this* record and nothing else.
 * Section 2.3 forbids reading `redacted: true` as a claim about another sink,
 * and forbids calling encryption, base64, hashing, HMAC, or compression
 * redaction.
 */

import type { RedactionReceipt } from "./receipt.js";
import { NEVER_REDACTABLE_SOURCE_CLASSES } from "./receipt.js";

export const PAYLOAD_DISPOSITIONS = Object.freeze([
  "metadata-only",
  "protected-ref",
  "redacted",
  "inline-unredacted",
] as const);

export type PayloadDisposition = (typeof PAYLOAD_DISPOSITIONS)[number];

export interface DispositionRow {
  readonly redacted: boolean;
  /** Required presence of `redactionReceipt` for this disposition. */
  readonly receipt: boolean;
}

export const DISPOSITION_TRUTH_TABLE: Readonly<Record<PayloadDisposition, DispositionRow>> =
  Object.freeze({
    "metadata-only": Object.freeze({ redacted: false, receipt: false }),
    "protected-ref": Object.freeze({ redacted: false, receipt: false }),
    redacted: Object.freeze({ redacted: true, receipt: true }),
    "inline-unredacted": Object.freeze({ redacted: false, receipt: false }),
  });

export interface DispositionFacts {
  readonly payloadDisposition: PayloadDisposition;
  readonly redacted: boolean;
  readonly redactionReceipt?: RedactionReceipt;
}

export type DispositionCheck =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

/**
 * Validate one disposition/redacted/receipt triple. Every combination outside
 * the table is invalid; in particular `protected-ref` with `redacted: true`,
 * `redacted` with `redacted: false`, `redacted: true` without a valid receipt,
 * and a receipt on any other disposition.
 */
export function checkDispositionFacts(facts: DispositionFacts): DispositionCheck {
  const row = DISPOSITION_TRUTH_TABLE[facts.payloadDisposition];
  if (row === undefined) return { valid: false, reason: "unknown-payload-disposition" };
  if (facts.redacted !== row.redacted) {
    return { valid: false, reason: "redacted-flag-contradicts-disposition" };
  }
  const hasReceipt = facts.redactionReceipt !== undefined;
  if (hasReceipt !== row.receipt) {
    return { valid: false, reason: "receipt-presence-contradicts-disposition" };
  }
  if (hasReceipt) {
    const receipt = facts.redactionReceipt as RedactionReceipt;
    if (receipt.count !== receipt.paths.length) {
      return { valid: false, reason: "receipt-count-does-not-equal-paths-length" };
    }
    if (NEVER_REDACTABLE_SOURCE_CLASSES.includes(receipt.sourceClass)) {
      return { valid: false, reason: "receipt-redacts-an-authoritative-source-class" };
    }
  }
  return { valid: true };
}

/** Section 3.2 facts for a record whose authoritative values are protected refs. */
export function protectedRefFacts(): DispositionFacts {
  return { payloadDisposition: "protected-ref", redacted: false };
}

/** Section 3.2 facts for a closed metadata-only record. */
export function metadataOnlyFacts(): DispositionFacts {
  return { payloadDisposition: "metadata-only", redacted: false };
}

/** Section 3.2 facts for an observational record proved by a receipt. */
export function redactedFacts(receipt: RedactionReceipt): DispositionFacts {
  return { payloadDisposition: "redacted", redacted: true, redactionReceipt: receipt };
}
