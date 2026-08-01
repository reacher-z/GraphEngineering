import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The literal D9 corpus. Tests consume these documents as data; nothing here
 * restates a case, and no claim flag is ever rewritten. If the implementation
 * disagrees with a corpus literal, the corpus is the authority.
 */
const here = dirname(fileURLToPath(import.meta.url));
export const SPEC_ROOT = join(here, "..", "..", "..", "..", "spec");
export const CORPUS_PATH = join(SPEC_ROOT, "conformance", "redaction.case.json");

export interface RedactionCorpus {
  readonly apiVersion: string;
  readonly contractStatus: string;
  readonly implementationClaim: boolean;
  readonly sinkInventory: readonly string[];
  readonly sourceInventory: readonly string[];
  readonly resourceLimits: Readonly<Record<string, number>>;
  readonly flowPolicy: Readonly<Record<string, unknown>>;
  readonly sinkPolicyCases: readonly Record<string, unknown>[];
  readonly flowCases: readonly Record<string, unknown>[];
  readonly wireCases: readonly Record<string, unknown>[];
  readonly pointerCases: readonly Record<string, unknown>[];
  readonly sensitiveFieldCases: readonly Record<string, unknown>[];
  readonly normalizationCases: readonly Record<string, unknown>[];
  readonly legacyCases: readonly Record<string, unknown>[];
}

export function loadRedactionCorpus(): RedactionCorpus {
  return JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as RedactionCorpus;
}

export function loadSpecSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SPEC_ROOT, name), "utf8")) as Record<string, unknown>;
}
