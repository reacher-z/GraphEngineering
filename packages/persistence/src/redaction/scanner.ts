/**
 * The pre-sink canary/credential scanner of spec/redaction-semantics.md
 * Section 7, and the byte scanner used by the Section 12 canary campaign.
 *
 * The scanner checks literal UTF-8 and obvious JSON, URL, base64, hexadecimal,
 * UTF-16 LE/BE, and compressed-member forms. Section 12 records that a literal
 * scanner cannot detect every transformed, fragmented, inferred, or externally
 * exfiltrated secret; this implementation inherits that non-claim.
 *
 * Section 10 forbids the detected canary value from appearing in the failure, so
 * a detection reports only the canary identifier, the encoded form, and the sink.
 */

import { gunzipSync, inflateSync } from "node:zlib";

import type { CaptureSinkClass, GuardFailure } from "./codes.js";

export interface SeededCanary {
  /** A stable identifier. It is the only canary fact a failure may carry. */
  readonly canaryId: string;
  /** The synthetic value seeded into a source. Never persisted in a report. */
  readonly value: string;
}

export type CanaryForm =
  | "utf8"
  | "json-escaped"
  | "url-encoded"
  | "base64"
  | "base64url"
  | "hex"
  | "utf16le"
  | "utf16be"
  | "gzip-member"
  | "deflate-member";

export interface CanaryDetection {
  readonly canaryId: string;
  readonly form: CanaryForm;
}

function jsonEscaped(value: string): string {
  const serialized = JSON.stringify(value);
  return serialized.slice(1, -1);
}

function utf16Bytes(value: string, littleEndian: boolean): Buffer {
  const bytes = Buffer.alloc(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (littleEndian) bytes.writeUInt16LE(unit, index * 2);
    else bytes.writeUInt16BE(unit, index * 2);
  }
  return bytes;
}

/** Every encoded spelling of one canary that the literal scanner recognizes. */
export function canaryNeedles(value: string): ReadonlyArray<{ form: CanaryForm; needle: Buffer }> {
  const utf8 = Buffer.from(value, "utf8");
  return [
    { form: "utf8", needle: utf8 },
    { form: "json-escaped", needle: Buffer.from(jsonEscaped(value), "utf8") },
    { form: "url-encoded", needle: Buffer.from(encodeURIComponent(value), "utf8") },
    { form: "base64", needle: Buffer.from(utf8.toString("base64").replace(/=+$/, ""), "utf8") },
    { form: "base64url", needle: Buffer.from(utf8.toString("base64url"), "utf8") },
    { form: "hex", needle: Buffer.from(utf8.toString("hex"), "utf8") },
    { form: "utf16le", needle: utf16Bytes(value, true) },
    { form: "utf16be", needle: utf16Bytes(value, false) },
  ];
}

function decompressMembers(bytes: Buffer): ReadonlyArray<{ form: CanaryForm; bytes: Buffer }> {
  const members: Array<{ form: CanaryForm; bytes: Buffer }> = [];
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      members.push({ form: "gzip-member", bytes: gunzipSync(bytes) });
    } catch {
      /* not a readable member; the literal forms still apply */
    }
  }
  if (bytes.length > 2 && bytes[0] === 0x78) {
    try {
      members.push({ form: "deflate-member", bytes: inflateSync(bytes) });
    } catch {
      /* not a readable member */
    }
  }
  return members;
}

/**
 * Scan raw bytes for every seeded canary in every recognized encoded form.
 * Returns the complete detection list; an empty list is the clean control.
 */
export function scanBytesForCanaries(
  bytes: Buffer | Uint8Array | string,
  canaries: readonly SeededCanary[],
): readonly CanaryDetection[] {
  const buffer = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  const detections: CanaryDetection[] = [];
  const targets: Array<{ form: CanaryForm | undefined; bytes: Buffer }> = [
    { form: undefined, bytes: buffer },
    ...decompressMembers(buffer).map((member) => ({ form: member.form, bytes: member.bytes })),
  ];
  for (const canary of canaries) {
    for (const { form: containerForm, bytes: haystack } of targets) {
      for (const { form, needle } of canaryNeedles(canary.value)) {
        if (needle.length === 0) continue;
        if (haystack.includes(needle)) {
          detections.push({ canaryId: canary.canaryId, form: containerForm ?? form });
        }
      }
    }
  }
  return detections;
}

/**
 * Credential shapes that must never reach a sink in a denied representation.
 * These are defense in depth, not a classifier: Section 1.2 already forbids the
 * secret-bearing source classes outright.
 */
const CREDENTIAL_PATTERNS: ReadonlyArray<{ readonly id: string; readonly pattern: RegExp }> =
  Object.freeze([
    { id: "pem-private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { id: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
    { id: "bearer-authorization-header", pattern: /\bAuthorization\s*:\s*Bearer\s+\S+/i },
    { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { id: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
    { id: "private-key-json", pattern: /"private_key"\s*:\s*"-----BEGIN/ },
  ]);

export interface SinkScannerOptions {
  /** Synthetic canaries seeded by a conformance campaign. */
  readonly canaries?: readonly SeededCanary[];
  readonly scanCredentials?: boolean;
}

/**
 * The guard's step-7 scan over the exact canonical bytes it is about to
 * authorize. A detection denies the write with `SECRET_CANARY_DETECTED` and
 * reports only the canary identifier and sink.
 */
export class SinkCanaryScanner {
  readonly #canaries: readonly SeededCanary[];
  readonly #credentials: boolean;

  constructor(options: SinkScannerOptions = {}) {
    this.#canaries = options.canaries ?? [];
    this.#credentials = options.scanCredentials ?? true;
  }

  scan(bytes: string, sink: CaptureSinkClass): GuardFailure | undefined {
    const detections = scanBytesForCanaries(bytes, this.#canaries);
    const detection = detections[0];
    if (detection !== undefined) {
      return {
        code: "SECRET_CANARY_DETECTED",
        phase: "scan",
        reason: `canary:${detection.canaryId}`,
        sink,
      };
    }
    if (!this.#credentials) return undefined;
    for (const { id, pattern } of CREDENTIAL_PATTERNS) {
      if (pattern.test(bytes)) {
        return { code: "SECRET_CANARY_DETECTED", phase: "scan", reason: `credential:${id}`, sink };
      }
    }
    return undefined;
  }
}
