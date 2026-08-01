import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalTagged,
  encodeDurableJson,
  keyRefHash,
  sha256Hex,
} from "../src/index.js";
import { SPEC_ROOT } from "./support/redaction-corpus.js";

interface DurableJsonCase {
  readonly name: string;
  readonly source: { readonly kind: "json" | "float64Bits"; readonly value?: unknown; readonly bits?: string };
  readonly expect: {
    readonly encoding: unknown;
    readonly canonicalJson: string;
    readonly sha256: string;
  };
}

const durableJsonCorpus = JSON.parse(
  readFileSync(join(SPEC_ROOT, "conformance", "durable-json.case.json"), "utf8"),
) as { readonly validCases: readonly DurableJsonCase[] };

function fromBits(bits: string): number {
  const bytes = new Uint8Array(8);
  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 2, index * 2 + 2), 16);
  }
  return new DataView(bytes.buffer).getFloat64(0, false);
}

/**
 * Sections 3.3, 4.1, 5.1, 5.4, 5.5, and 8.2 all hash `canonicalTagged(...)`
 * bytes, so the redaction module's encoder must be byte-identical to the
 * shipped `durable-json/v1alpha1` contract. Persistence cannot import the
 * runtime encoder (runtime depends on persistence), so the shared corpus is the
 * join point: every vector is recomputed here, never restated.
 */
describe("Tagged Durable JSON parity with the shipped contract", () => {
  it("reproduces every literal durable-json vector's encoding, bytes, and digest", () => {
    expect(durableJsonCorpus.validCases.length).toBe(14);
    for (const testCase of durableJsonCorpus.validCases) {
      const value =
        testCase.source.kind === "float64Bits"
          ? fromBits(testCase.source.bits as string)
          : testCase.source.value;
      expect(encodeDurableJson(value), testCase.name).toEqual(testCase.expect.encoding);
      expect(canonicalTagged(value), testCase.name).toBe(testCase.expect.canonicalJson);
      expect(sha256Hex(canonicalTagged(value)), testCase.name).toBe(testCase.expect.sha256);
    }
  });

  it("derives keyRefHash from the tagged key-ref domain", () => {
    const keyRef = "operator-owned-key-reference";
    expect(keyRefHash(keyRef)).toBe(sha256Hex(canonicalTagged(["key-ref/v1alpha1", keyRef])));
    expect(keyRefHash(keyRef)).toMatch(/^[0-9a-f]{64}$/);
    expect(keyRefHash(keyRef)).not.toBe(keyRefHash(`${keyRef}-other`));
  });
});
