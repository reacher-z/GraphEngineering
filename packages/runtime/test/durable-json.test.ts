import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodeDurableJson,
  durableJsonHash,
  encodeDurableJson,
} from "../src/durable-json.js";

interface DurableJsonCorpus {
  validCases: Array<{
    name: string;
    source: { kind: "json"; value: unknown } | { kind: "float64Bits"; bits: string };
    expect: { encoding: unknown; canonicalJson: string; sha256: string };
  }>;
  invalidEncodedCases: Array<{ name: string; encoding: unknown }>;
}

function corpus(): DurableJsonCorpus {
  const path = fileURLToPath(
    new URL("../../../spec/conformance/durable-json.case.json", import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as DurableJsonCorpus;
}

function floatFromBits(bits: string): number {
  const bytes = new Uint8Array(8);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 2, index * 2 + 2), 16);
  }
  return new DataView(bytes.buffer).getFloat64(0, false);
}

describe("Tagged Durable JSON", () => {
  it("round-trips every portable value and preserves binary64 bits", () => {
    const value = {
      z: [null, true, "text", 42, 1.5, -0.125],
      a: { nested: 0 },
    };
    const encoded = encodeDurableJson(value);
    expect(encoded).toEqual([
      "o",
      [
        ["a", ["o", [["nested", ["i", 0]]]]],
        [
          "z",
          [
            "a",
            [["n"], ["b", true], ["s", "text"], ["i", 42], ["f", "3ff8000000000000"], ["f", "bfc0000000000000"]],
          ],
        ],
      ],
    ]);
    expect(decodeDurableJson(encoded)).toEqual(value);
    expect(Object.isFrozen(encoded)).toBe(true);
  });

  it("normalizes negative zero and hashes the tagged bytes deterministically", () => {
    expect(encodeDurableJson(-0)).toEqual(["i", 0]);
    expect(durableJsonHash({ b: 2, a: 1 })).toBe(durableJsonHash({ a: 1, b: 2 }));
    expect(durableJsonHash(1.5)).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    [["x"]],
    [["n", null]],
    [["i", 1.5]],
    [["f", "3FF8000000000000"]],
    [["f", "3ff0000000000000"]],
    [["a", "not-an-array"]],
    [["o", [["b", ["i", 2]], ["a", ["i", 1]]]]],
    [["o", [["a", ["i", 1]], ["a", ["i", 2]]]]],
  ])("rejects malformed or non-canonical tagged data %#", (value) => {
    expect(() => decodeDurableJson(value)).toThrow(TypeError);
  });

  it("keeps the existing portable JSON rejection boundary", () => {
    expect(() => encodeDurableJson(Number.NaN)).toThrow(TypeError);
    expect(() => encodeDurableJson(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
    expect(() => encodeDurableJson(1n)).toThrow(TypeError);
  });

  it("passes every valid vector in the shared cross-language corpus", () => {
    for (const testCase of corpus().validCases) {
      const value = testCase.source.kind === "json"
        ? testCase.source.value
        : floatFromBits(testCase.source.bits);
      const encoded = encodeDurableJson(value);
      expect(encoded, testCase.name).toEqual(testCase.expect.encoding);
      expect(JSON.stringify(encoded), testCase.name).toBe(testCase.expect.canonicalJson);
      expect(durableJsonHash(value), testCase.name).toBe(testCase.expect.sha256);
      const decoded = decodeDurableJson(encoded);
      if (Object.is(value, -0)) expect(Object.is(decoded, 0), testCase.name).toBe(true);
      else expect(decoded, testCase.name).toEqual(value);
    }
  });

  it("rejects every invalid encoding in the shared cross-language corpus", () => {
    for (const testCase of corpus().invalidEncodedCases) {
      expect(() => decodeDurableJson(testCase.encoding), testCase.name).toThrow(TypeError);
    }
  });

  it("round-trips an own __proto__ key without prototype mutation", () => {
    const source = JSON.parse('{"__proto__":{"polluted":true},"safe":1}') as Record<string, unknown>;
    const decoded = decodeDurableJson(encodeDurableJson(source)) as Record<string, unknown>;
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
    expect(decoded.__proto__).toEqual({ polluted: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.isFrozen(decoded)).toBe(true);
  });
});
