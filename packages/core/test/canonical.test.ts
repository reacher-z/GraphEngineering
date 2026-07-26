import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CanonicalizationError,
  canonicalHash,
  canonicalSerialize,
  compareUnicodeCodePoints,
  type GraphSpec,
} from "../src/index.js";

const fixturePath = fileURLToPath(
  new URL("../../../spec/conformance/diamond.graph.json", import.meta.url),
);
const expectedPath = fileURLToPath(new URL("../../../spec/conformance/expected.json", import.meta.url));

describe("canonical JSON", () => {
  it("matches the cross-language diamond hash fixture", () => {
    const graph = JSON.parse(readFileSync(fixturePath, "utf8")) as GraphSpec;
    const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as {
      canonicalization: Record<string, { sha256: string }>;
    };

    expect(canonicalHash(graph)).toBe(expected.canonicalization["diamond.graph.json"]?.sha256);
  });

  it("recursively sorts keys and emits no whitespace", () => {
    expect(canonicalSerialize({ z: 1, a: { d: true, c: [3, 2, 1] } })).toBe(
      '{"a":{"c":[3,2,1],"d":true},"z":1}',
    );
  });

  it("sorts astral keys by code point rather than UTF-16 unit", () => {
    const bmp = "\uE000";
    const astral = "\u{10000}";
    expect(compareUnicodeCodePoints(bmp, astral)).toBeLessThan(0);
    expect(canonicalSerialize({ [astral]: 2, [bmp]: 1 })).toBe(`{"${bmp}":1,"${astral}":2}`);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    undefined,
    1n,
    () => true,
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    "rejects non-JSON value %s",
    (value) => {
      expect(() => canonicalSerialize(value)).toThrow(CanonicalizationError);
    },
  );

  it("rejects cycles and sparse arrays", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalSerialize(cyclic)).toThrow(/Cyclic values/);

    const sparse = new Array(2);
    sparse[1] = "present";
    expect(() => canonicalSerialize(sparse)).toThrow(/Sparse arrays/);
  });

  it("rejects getters and setters without executing either accessor", () => {
    let getterCalls = 0;
    let setterCalls = 0;
    const value: Record<string, unknown> = {};
    Object.defineProperty(value, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "leaked";
      },
      set() {
        setterCalls += 1;
      },
    });

    expect(() => canonicalSerialize(value)).toThrowError(
      new CanonicalizationError("Accessor properties are not supported", "#/secret"),
    );
    expect(() => canonicalHash(value)).toThrow(CanonicalizationError);
    expect(getterCalls).toBe(0);
    expect(setterCalls).toBe(0);
  });

  it("rejects hostile proxies before invoking any user-defined trap", () => {
    let trapCalls = 0;
    const value = new Proxy({}, {
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("TOP_SECRET_PROXY_CAUSE");
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error("TOP_SECRET_PROXY_CAUSE");
      },
    });

    for (const operation of [() => canonicalSerialize(value), () => canonicalHash(value)]) {
      let failure: unknown;
      try {
        operation();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(TypeError);
      expect(failure).toBeInstanceOf(CanonicalizationError);
      expect((failure as Error).message).toBe("Proxy values are not supported at #");
      expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();
    }
    expect(trapCalls).toBe(0);
  });

  it("rejects hidden fields, custom prototypes, symbols, and extra array fields", () => {
    const hidden = {};
    Object.defineProperty(hidden, "value", { value: 1, enumerable: false });

    const custom = Object.create({ inherited: true }) as Record<string, unknown>;
    custom.value = 1;

    const symbolic = { value: 1, [Symbol("hidden")]: true };

    const extraArray = [1] as unknown[] & { extra?: boolean };
    extraArray.extra = true;

    for (const value of [hidden, custom, symbolic, extraArray]) {
      expect(() => canonicalSerialize(value)).toThrow(CanonicalizationError);
    }
  });

  it("normalizes negative zero and snapshots repeated aliases by value", () => {
    const shared = { score: -0 };
    const serialized = canonicalSerialize({ left: shared, right: shared });
    shared.score = 99;
    expect(serialized).toBe('{"left":{"score":0},"right":{"score":0}}');
  });
});
