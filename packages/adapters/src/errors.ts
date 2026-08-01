/**
 * The failure carrier every rule in this package throws.
 *
 * `code` is the only portable fact. `rule` is a stable diagnostic identifier
 * from the register of adapter-semantics 12 — normative to report, never an
 * authorization fact. adapter-semantics 9.5 requires it because fourteen codes
 * cannot distinguish 131 rules.
 */

import type { AdapterErrorCode, DenialReason } from "./types.js";

export class AdapterContractError extends Error {
  readonly code: AdapterErrorCode;
  readonly rule: string;
  readonly denialReason: DenialReason | null;

  constructor(
    code: AdapterErrorCode,
    rule: string,
    message: string,
    denialReason: DenialReason | null = null,
  ) {
    super(message);
    this.name = "AdapterContractError";
    this.code = code;
    this.rule = rule;
    this.denialReason = denialReason;
  }
}

export function fail(
  code: AdapterErrorCode,
  rule: string,
  message: string,
  denialReason: DenialReason | null = null,
): never {
  throw new AdapterContractError(code, rule, message, denialReason);
}

export function isAdapterContractError(value: unknown): value is AdapterContractError {
  return value instanceof AdapterContractError;
}
