/**
 * Digest, keyed-digest, and canonical base64url helpers for the D9 contract.
 *
 * Section 5.2 requires the semantic decoder to reject padding, non-alphabet
 * characters, a length congruent to one modulo four, non-zero unused pad bits,
 * and any spelling whose decode-then-re-encode does not reproduce the input.
 * JSON Schema length/pattern checks are necessary but not sufficient.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256")
    .update(typeof input === "string" ? Buffer.from(input, "utf8") : input)
    .digest("hex");
}

export function hmacSha256Hex(key: Uint8Array, input: string | Uint8Array): string {
  return createHmac("sha256", key)
    .update(typeof input === "string" ? Buffer.from(input, "utf8") : input)
    .digest("hex");
}

export function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]*$/;

export function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export class Base64UrlError extends Error {
  constructor(reason: string) {
    super(`invalid canonical base64url: ${reason}`);
    this.name = "Base64UrlError";
  }
}

/** Strict canonical unpadded base64url decode with a re-encode round trip. */
export function decodeBase64Url(text: string): Uint8Array {
  if (!BASE64URL_ALPHABET.test(text)) throw new Base64UrlError("non-alphabet character or padding");
  if (text.length % 4 === 1) throw new Base64UrlError("length is congruent to one modulo four");
  const bytes = new Uint8Array(Buffer.from(text, "base64url"));
  if (encodeBase64Url(bytes) !== text) throw new Base64UrlError("non-canonical spelling");
  return bytes;
}
