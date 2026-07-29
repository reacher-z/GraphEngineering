import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { describe, expect, it } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8,
  SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8,
  SQLITE_INITIAL_WRITE_SIGNED_INT64_MAXIMUM,
  SQLITE_INITIAL_WRITE_SIGNED_INT64_MINIMUM,
  digestSQLiteInitialWriteParametersIntrinsic,
  digestSQLiteInitialWriteResultIntrinsic,
  encodeSQLiteInitialWriteParameterPayloadIntrinsic,
  encodeSQLiteInitialWriteResultPayloadIntrinsic,
  type SQLiteInitialWriteParameterExecutions,
  type SQLiteInitialWriteResult,
  type SQLiteInitialWriteSha256,
  type SQLiteInitialWriteTaggedScalar,
} from "../src/cursor-publication-initial-write-digest.js";

const text = (value: string): SQLiteInitialWriteTaggedScalar => Object.freeze({
  type: "text",
  value,
});
const integer = (value: string): SQLiteInitialWriteTaggedScalar => Object.freeze({
  type: "integer",
  value,
});
const blob = (value: string): SQLiteInitialWriteTaggedScalar => Object.freeze({
  type: "blob",
  value,
});
const nullValue = (): SQLiteInitialWriteTaggedScalar => Object.freeze({ type: "null" });
const frame = (
  ...executions: readonly (readonly SQLiteInitialWriteTaggedScalar[])[]
): SQLiteInitialWriteParameterExecutions => Object.freeze(
  executions.map((execution) => Object.freeze([...execution])),
);

const GOLDEN_VECTORS = Object.freeze([
  Object.freeze({
    canonicalJson: "[[]]",
    id: "one-empty-execution",
    input: frame([]),
    kind: "parameters" as const,
    sha256: "8acdf04fe02395192d1c7d704cf8ecf52e29513ccd77024ff4f9cc9e230da80a",
  }),
  Object.freeze({
    canonicalJson: "[[{\"type\":\"text\",\"value\":\"Aé😀\"},{\"type\":\"integer\",\"value\":\"-42\"},{\"type\":\"blob\",\"value\":\"AP8\"},{\"type\":\"null\"}]]",
    id: "one-mixed-execution",
    input: frame([text("Aé😀"), integer("-42"), blob("AP8"), nullValue()]),
    kind: "parameters" as const,
    sha256: "8fcf64e97e9fda027b287997e43efc5226b596207dfc56ed161e46859027c271",
  }),
  Object.freeze({
    canonicalJson: "[[{\"type\":\"text\",\"value\":\"x\"},{\"type\":\"integer\",\"value\":\"0\"}],[{\"type\":\"text\",\"value\":\"y\"},{\"type\":\"integer\",\"value\":\"9007199254740991\"}]]",
    id: "two-executions",
    input: frame([text("x"), integer("0")], [text("y"), integer("9007199254740991")]),
    kind: "parameters" as const,
    sha256: "379049937f6797daade28d4b963dcc865f51afa5fa3422b90f4e505deaad838e",
  }),
  Object.freeze({
    canonicalJson: "[[{\"type\":\"integer\",\"value\":\"-9223372036854775808\"}]]",
    id: "integer-signed-64-minimum",
    input: frame([integer("-9223372036854775808")]),
    kind: "parameters" as const,
    sha256: "d3d9b55872b8b14e2ec8a3c2b5ca27db179993b97ce9e47845efd2923eef4460",
  }),
  Object.freeze({
    canonicalJson: "[[{\"type\":\"integer\",\"value\":\"9223372036854775807\"}]]",
    id: "integer-signed-64-maximum",
    input: frame([integer("9223372036854775807")]),
    kind: "parameters" as const,
    sha256: "be263941652b27aa8254e518d3de8853c3071e7b7310449a7af13fb8bd2765ce",
  }),
  Object.freeze({
    canonicalJson: "{\"affectedRows\":\"0\"}",
    id: "result-zero",
    input: Object.freeze({ affectedRows: "0" }) satisfies SQLiteInitialWriteResult,
    kind: "result" as const,
    sha256: "7d4e42c580be36f078371942187c0bdf048da4ffa35556c3f219f5930c5abd62",
  }),
  Object.freeze({
    canonicalJson: "{\"affectedRows\":\"3\"}",
    id: "result-three",
    input: Object.freeze({ affectedRows: "3" }) satisfies SQLiteInitialWriteResult,
    kind: "result" as const,
    sha256: "9c4a39646a7cb26c3ba53e91941b6fe0f4435355a06d2138156d1fd9551ba417",
  }),
]);

function independentlyDigest(domain: string, canonicalJson: string): string {
  return createHash("sha256")
    .update(Buffer.from(domain, "utf8"))
    .update(Buffer.from(canonicalJson, "utf8"))
    .digest("hex");
}

function expectInvalid(callback: () => unknown): CycleStoreProviderError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect((error as CycleStoreProviderError).code).toBe("GE_CYCLE_STORE_INVALID_ARGUMENT");
    return error as CycleStoreProviderError;
  }
  throw new Error("expected GE_CYCLE_STORE_INVALID_ARGUMENT");
}

function expectParameterInvalid(value: unknown): void {
  expectInvalid(() => encodeSQLiteInitialWriteParameterPayloadIntrinsic(value));
  expectInvalid(() => digestSQLiteInitialWriteParametersIntrinsic(value));
}

function expectResultInvalid(value: unknown): void {
  expectInvalid(() => encodeSQLiteInitialWriteResultPayloadIntrinsic(value));
  expectInvalid(() => digestSQLiteInitialWriteResultIntrinsic(value));
}

describe("SQLite portable initial-write digest codec", () => {
  it("matches all seven frozen cross-runtime golden vectors", () => {
    expect(Object.isFrozen(GOLDEN_VECTORS)).toBe(true);
    for (const vector of GOLDEN_VECTORS) {
      expect(Object.isFrozen(vector)).toBe(true);
      if (vector.kind === "parameters") {
        expect(encodeSQLiteInitialWriteParameterPayloadIntrinsic(vector.input))
          .toBe(vector.canonicalJson);
        const digest: SQLiteInitialWriteSha256 =
          digestSQLiteInitialWriteParametersIntrinsic(vector.input);
        expect(digest).toBe(vector.sha256);
      } else {
        expect(encodeSQLiteInitialWriteResultPayloadIntrinsic(vector.input))
          .toBe(vector.canonicalJson);
        const digest: SQLiteInitialWriteSha256 =
          digestSQLiteInitialWriteResultIntrinsic(vector.input);
        expect(digest).toBe(vector.sha256);
      }
    }
  });

  it("uses the exact NUL-terminated domains with direct byte concatenation", () => {
    expect(SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8)
      .toBe("graph-engineering/sqlite-initial-write-parameters/v1\0");
    expect(SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8)
      .toBe("graph-engineering/sqlite-initial-write-result/v1\0");
    expect(SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8)
      .not.toBe(SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8);
    for (const vector of GOLDEN_VECTORS) {
      const domain = vector.kind === "parameters"
        ? SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8
        : SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8;
      expect(independentlyDigest(domain, vector.canonicalJson)).toBe(vector.sha256);
      const wrongDomain = vector.kind === "parameters"
        ? SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8
        : SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8;
      expect(independentlyDigest(wrongDomain, vector.canonicalJson)).not.toBe(vector.sha256);
    }
  });

  it("preserves both execution and parameter framing dimensions without ambiguity", () => {
    const none = frame();
    const oneEmpty = frame([]);
    const oneExecution = frame([text("a"), text("b")]);
    const twoExecutions = frame([text("a")], [text("b")]);
    const splitLeft = frame([text("ab"), text("c")]);
    const splitRight = frame([text("a"), text("bc")]);
    const executionOrder = frame([text("first")], [text("second")]);
    const reversedExecutionOrder = frame([text("second")], [text("first")]);
    const parameterOrder = frame([text("first"), text("second")]);
    const reversedParameterOrder = frame([text("second"), text("first")]);

    expect(encodeSQLiteInitialWriteParameterPayloadIntrinsic(none)).toBe("[]");
    expect(encodeSQLiteInitialWriteParameterPayloadIntrinsic(oneEmpty)).toBe("[[]]");
    expect(encodeSQLiteInitialWriteParameterPayloadIntrinsic(oneExecution))
      .toBe("[[{\"type\":\"text\",\"value\":\"a\"},{\"type\":\"text\",\"value\":\"b\"}]]");
    expect(encodeSQLiteInitialWriteParameterPayloadIntrinsic(twoExecutions))
      .toBe("[[{\"type\":\"text\",\"value\":\"a\"}],[{\"type\":\"text\",\"value\":\"b\"}]]");
    for (const [left, right] of [
      [none, oneEmpty],
      [oneExecution, twoExecutions],
      [splitLeft, splitRight],
      [executionOrder, reversedExecutionOrder],
      [parameterOrder, reversedParameterOrder],
    ] as const) {
      expect(digestSQLiteInitialWriteParametersIntrinsic(left))
        .not.toBe(digestSQLiteInitialWriteParametersIntrinsic(right));
    }
  });

  it("canonicalizes key order, preserves Unicode scalars, and rejects lone surrogates", () => {
    const reversedInsertionOrder = Object.freeze({ value: "Aé😀", type: "text" });
    expect(encodeSQLiteInitialWriteParameterPayloadIntrinsic([[reversedInsertionOrder]]))
      .toBe("[[{\"type\":\"text\",\"value\":\"Aé😀\"}]]");

    const composed = frame([text("é")]);
    const decomposed = frame([text("e\u0301")]);
    expect(digestSQLiteInitialWriteParametersIntrinsic(composed))
      .not.toBe(digestSQLiteInitialWriteParametersIntrinsic(decomposed));
    expect(encodeSQLiteInitialWriteParameterPayloadIntrinsic(decomposed)).toContain("e\u0301");
    for (const hostile of ["\uD800", "\uDC00", "before\uD800after", "\uD83Dtext"]) {
      expectParameterInvalid([[{ type: "text", value: hostile }]]);
    }
  });

  it("accepts exact signed int64 boundaries and rejects noncanonical or out-of-range integers", () => {
    expect(SQLITE_INITIAL_WRITE_SIGNED_INT64_MINIMUM).toBe("-9223372036854775808");
    expect(SQLITE_INITIAL_WRITE_SIGNED_INT64_MAXIMUM).toBe("9223372036854775807");
    for (const value of ["0", "-1", "1", SQLITE_INITIAL_WRITE_SIGNED_INT64_MINIMUM,
      SQLITE_INITIAL_WRITE_SIGNED_INT64_MAXIMUM]) {
      expect(() => digestSQLiteInitialWriteParametersIntrinsic(frame([integer(value)])))
        .not.toThrow();
    }
    for (const value of [
      "+1", "01", "00", "-0", "-01", " 1", "1 ", "1.0", "1e0", "",
      "9223372036854775808", "-9223372036854775809",
    ]) expectParameterInvalid([[{ type: "integer", value }]]);
    expectParameterInvalid([[{ type: "integer", value: "9".repeat(100_000) }]]);
    for (const value of [0, -0, 1, 1n, Number.MAX_SAFE_INTEGER + 1]) {
      expectParameterInvalid([[{ type: "integer", value }]]);
    }
  });

  it("accepts canonical unpadded base64url and rejects padding, alphabet and pad-bit drift", () => {
    for (const value of ["", "AA", "AAE", "AAEC", "-_8", "AP8"]) {
      expect(() => digestSQLiteInitialWriteParametersIntrinsic(frame([blob(value)])))
        .not.toThrow();
    }
    for (const value of [
      "AA=", "AA==", "+/8", "AA/", "AA+", "A A", "A\nA", "A", "AB", "AAB",
    ]) {
      expectParameterInvalid([[{ type: "blob", value }]]);
    }
  });

  it("rejects numeric presentations including NaN, infinities, negative zero and unsafe integers", () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expectParameterInvalid([[{ type: "integer", value }]]);
      expectResultInvalid({ affectedRows: value });
    }
  });

  it("rejects extra, missing, mistyped, inherited, sparse and wrongly nested parameter shapes", () => {
    const sparseOuter: unknown[] = [];
    sparseOuter.length = 1;
    const sparseInner: unknown[] = [];
    sparseInner.length = 1;
    const inherited = Object.create({ type: "null" }) as object;
    const cyclic: { type: string; value?: unknown } = { type: "text" };
    cyclic.value = cyclic;
    const symbolKey = { type: "null" } as Record<PropertyKey, unknown>;
    Object.defineProperty(symbolKey, Symbol("extra"), { enumerable: true, value: true });
    const nonEnumerableKey = { type: "null" };
    Object.defineProperty(nonEnumerableKey, "extra", { enumerable: false, value: true });
    const outerWithExtra = [[nullValue()]] as unknown[] & { extra?: boolean };
    outerWithExtra.extra = true;
    const innerWithExtra = [nullValue()] as unknown[] & { extra?: boolean };
    innerWithExtra.extra = true;
    const outerWithSymbol = [[nullValue()]];
    Object.defineProperty(outerWithSymbol, Symbol("extra"), { value: true });
    const innerWithSymbol = [nullValue()];
    Object.defineProperty(innerWithSymbol, Symbol("extra"), { value: true });
    const outerWithNonEnumerable = [[nullValue()]];
    Object.defineProperty(outerWithNonEnumerable, "extra", {
      enumerable: false,
      value: true,
    });
    const innerWithNonEnumerable = [nullValue()];
    Object.defineProperty(innerWithNonEnumerable, "extra", {
      enumerable: false,
      value: true,
    });
    let proxyTrapCalls = 0;
    const hostileHandler: ProxyHandler<object> = {
      get: () => {
        proxyTrapCalls += 1;
        throw new Error("proxy get trap reached");
      },
      getOwnPropertyDescriptor: () => {
        proxyTrapCalls += 1;
        throw new Error("proxy descriptor trap reached");
      },
      getPrototypeOf: () => {
        proxyTrapCalls += 1;
        throw new Error("proxy prototype trap reached");
      },
      ownKeys: () => {
        proxyTrapCalls += 1;
        throw new Error("proxy ownKeys trap reached");
      },
    };
    const transparentProxy = new Proxy({ type: "null" }, {});
    const hostileProxy = new Proxy({ type: "null" }, hostileHandler);
    const revokedScalar = Proxy.revocable({ type: "null" }, hostileHandler);
    revokedScalar.revoke();
    const revokedOuter = Proxy.revocable([[nullValue()]], hostileHandler);
    revokedOuter.revoke();
    const revokedInner = Proxy.revocable([nullValue()], hostileHandler);
    revokedInner.revoke();
    for (const value of [
      null,
      undefined,
      {},
      "[]",
      { type: "null" },
      [nullValue()],
      [[[nullValue()]]],
      [[[]]],
      sparseOuter,
      [sparseInner],
      [[inherited]],
      [[{ type: "unknown" }]],
      [[{ type: "text" }]],
      [[{ type: "text", value: "x", extra: true }]],
      [[{ type: "integer" }]],
      [[{ type: "blob", value: 0 }]],
      [[{ type: "null", value: null }]],
      [[cyclic]],
      [[symbolKey]],
      [[nonEnumerableKey]],
      outerWithExtra,
      [innerWithExtra],
      outerWithSymbol,
      [innerWithSymbol],
      outerWithNonEnumerable,
      [innerWithNonEnumerable],
      [[transparentProxy]],
      [[hostileProxy]],
      [[revokedScalar.proxy]],
      revokedOuter.proxy,
      [revokedInner.proxy],
      [[true]],
      [[1.5]],
      [[1n]],
      [[undefined]],
      [[() => undefined]],
      [[new Map()]],
      [[new Set()]],
      [[new Date(0)]],
      [[null]],
      [["text"]],
      [[[]]],
    ]) expectParameterInvalid(value);
    expect(proxyTrapCalls).toBe(0);

    let arrayGetterCalls = 0;
    const accessorExecution: unknown[] = [];
    Object.defineProperty(accessorExecution, "0", {
      enumerable: true,
      get: () => {
        arrayGetterCalls += 1;
        return nullValue();
      },
    });
    accessorExecution.length = 1;
    expectParameterInvalid([accessorExecution]);
    expect(arrayGetterCalls).toBe(0);
  });

  it("rejects noncanonical result types, shapes and decimal lexemes", () => {
    let proxyTrapCalls = 0;
    const hostileHandler: ProxyHandler<object> = {
      get: () => {
        proxyTrapCalls += 1;
        throw new Error("result proxy get trap reached");
      },
      getOwnPropertyDescriptor: () => {
        proxyTrapCalls += 1;
        throw new Error("result proxy descriptor trap reached");
      },
      getPrototypeOf: () => {
        proxyTrapCalls += 1;
        throw new Error("result proxy prototype trap reached");
      },
      ownKeys: () => {
        proxyTrapCalls += 1;
        throw new Error("result proxy ownKeys trap reached");
      },
    };
    const transparentProxy = new Proxy({ affectedRows: "0" }, {});
    const hostileProxy = new Proxy({ affectedRows: "0" }, hostileHandler);
    const revoked = Proxy.revocable({ affectedRows: "0" }, hostileHandler);
    revoked.revoke();
    const symbolKey = { affectedRows: "0" } as Record<PropertyKey, unknown>;
    Object.defineProperty(symbolKey, Symbol("extra"), { value: true });
    const nonEnumerableExtra = { affectedRows: "0" };
    Object.defineProperty(nonEnumerableExtra, "extra", { enumerable: false, value: true });
    const inherited = Object.create({ inherited: true }) as { affectedRows?: string };
    inherited.affectedRows = "0";
    for (const value of [
      null, undefined, {}, [], 0, 0n, true, "0",
      { affectedRows: "0", extra: true }, { affected_rows: "0" },
      { affectedRows: "0", lastInsertRowid: "1" },
      { affectedRows: ["0"] },
      { affectedRows: [{ affectedRows: "0" }] },
      transparentProxy,
      hostileProxy,
      revoked.proxy,
      symbolKey,
      nonEnumerableExtra,
      inherited,
    ]) expectResultInvalid(value);
    expect(proxyTrapCalls).toBe(0);

    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "affectedRows", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "0";
      },
    });
    expectResultInvalid(accessor);
    expect(getterCalls).toBe(0);
    for (const affectedRows of [
      "", "+1", "01", "00", "-0", "-1", " 1", "1 ", "1.0", "1e0",
    ]) expectResultInvalid({ affectedRows });
    for (const value of ["0", "1", "3", "9007199254740992", "18446744073709551616"]) {
      const result = Object.freeze({ affectedRows: value }) satisfies SQLiteInitialWriteResult;
      expect(encodeSQLiteInitialWriteResultPayloadIntrinsic(result))
        .toBe(`{\"affectedRows\":\"${value}\"}`);
      expect(digestSQLiteInitialWriteResultIntrinsic(result)).toMatch(/^[0-9a-f]{64}$/u);
    }
    const longValue = "9".repeat(128);
    const longResult = Object.freeze({ affectedRows: longValue }) satisfies SQLiteInitialWriteResult;
    const longJson = `{\"affectedRows\":\"${longValue}\"}`;
    expect(encodeSQLiteInitialWriteResultPayloadIntrinsic(longResult)).toBe(longJson);
    expect(digestSQLiteInitialWriteResultIntrinsic(longResult)).toBe(
      independentlyDigest(SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8, longJson),
    );
  });

  it("does not mutate inputs and rejects accessors without invoking them", () => {
    const input = [[
      { value: "mutable", type: "text" },
      { type: "integer", value: "7" },
      { type: "blob", value: "AAE" },
      { type: "null" },
    ]];
    const before = JSON.stringify(input);
    const first = digestSQLiteInitialWriteParametersIntrinsic(input);
    const second = digestSQLiteInitialWriteParametersIntrinsic(input);
    expect(first).toBe(second);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input[0])).toBe(false);
    expect(Object.isFrozen(input[0]![0])).toBe(false);

    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "type", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "text";
      },
    });
    Object.defineProperty(accessor, "value", { enumerable: true, value: "x" });
    expectParameterInvalid([[accessor]]);
    expect(getterCalls).toBe(0);
  });

  it("uses captured intrinsics after hostile ambient replacement for all seven vectors", () => {
    const objectKeysDescriptor = Object.getOwnPropertyDescriptor(Object, "keys")!;
    const mapDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const sortDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "sort")!;
    const someDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "some")!;
    const regexpTestDescriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")!;
    const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze")!;
    const bigIntDescriptor = Object.getOwnPropertyDescriptor(globalThis, "BigInt")!;
    const bufferFromDescriptor = Object.getOwnPropertyDescriptor(Buffer, "from")!;
    const hostile = (): never => {
      throw new Error("hostile ambient intrinsic reached digest codec");
    };
    const observed: Array<Readonly<{ encoded: string; sha256: string }>> = [];
    try {
      Object.defineProperty(Object, "keys", { ...objectKeysDescriptor, value: hostile });
      Object.defineProperty(Array.prototype, "map", { ...mapDescriptor, value: hostile });
      Object.defineProperty(Array.prototype, "sort", { ...sortDescriptor, value: hostile });
      Object.defineProperty(Array.prototype, "some", { ...someDescriptor, value: hostile });
      Object.defineProperty(RegExp.prototype, "test", {
        ...regexpTestDescriptor,
        value: hostile,
      });
      Object.defineProperty(Object, "freeze", { ...freezeDescriptor, value: hostile });
      Object.defineProperty(globalThis, "BigInt", { ...bigIntDescriptor, value: hostile });
      Object.defineProperty(Buffer, "from", { ...bufferFromDescriptor, value: hostile });

      for (const vector of GOLDEN_VECTORS) {
        observed.push(vector.kind === "parameters"
          ? {
              encoded: encodeSQLiteInitialWriteParameterPayloadIntrinsic(vector.input),
              sha256: digestSQLiteInitialWriteParametersIntrinsic(vector.input),
            }
          : {
              encoded: encodeSQLiteInitialWriteResultPayloadIntrinsic(vector.input),
              sha256: digestSQLiteInitialWriteResultIntrinsic(vector.input),
            });
      }
    } finally {
      Object.defineProperty(Object, "keys", objectKeysDescriptor);
      Object.defineProperty(Array.prototype, "map", mapDescriptor);
      Object.defineProperty(Array.prototype, "sort", sortDescriptor);
      Object.defineProperty(Array.prototype, "some", someDescriptor);
      Object.defineProperty(RegExp.prototype, "test", regexpTestDescriptor);
      Object.defineProperty(Object, "freeze", freezeDescriptor);
      Object.defineProperty(globalThis, "BigInt", bigIntDescriptor);
      Object.defineProperty(Buffer, "from", bufferFromDescriptor);
    }
    expect(observed).toHaveLength(GOLDEN_VECTORS.length);
    for (const [index, vector] of GOLDEN_VECTORS.entries()) {
      expect(observed[index]).toEqual({
        encoded: vector.canonicalJson,
        sha256: vector.sha256,
      });
    }
  });

  it("keeps the entire digest codec leaf off the package root", () => {
    const names = [
      "SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8",
      "SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8",
      "SQLITE_INITIAL_WRITE_SIGNED_INT64_MINIMUM",
      "SQLITE_INITIAL_WRITE_SIGNED_INT64_MAXIMUM",
      "SQLiteInitialWriteTaggedScalar",
      "SQLiteInitialWriteParameterExecutions",
      "SQLiteInitialWriteResult",
      "SQLiteInitialWriteSha256",
      "encodeSQLiteInitialWriteParameterPayloadIntrinsic",
      "digestSQLiteInitialWriteParametersIntrinsic",
      "encodeSQLiteInitialWriteResultPayloadIntrinsic",
      "digestSQLiteInitialWriteResultIntrinsic",
    ] as const;
    const rootSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    for (const name of names) {
      expect(Object.keys(sqliteRoot)).not.toContain(name);
      expect(rootSource).not.toContain(name);
    }
  });

  it("contains no SQL, migration, cursor-rebind, write execution, or transaction control", () => {
    const source = readFileSync(new URL(
      "../src/cursor-publication-initial-write-digest.ts", import.meta.url,
    ), "utf8");
    expect(source).not.toContain("execTrusted");
    expect(source).not.toMatch(/\.(?:prepare|run|exec|all|get)\s*\(/u);
    expect(source).not.toContain("0002-v1-to-v2-operation-replay.sql");
    expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/u);
    expect(source).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/u);
    expect(source).not.toContain("ge_cycle_");
    expect(source).not.toContain("cursor-rebind");
  });
});
