import { describe, expect, it } from "vitest";
import {
  GraphSourceError,
  MAX_GRAPH_SOURCE_NODES,
  canonicalSerialize,
  decodeGraphSource,
  parseGraphSource,
} from "../src/index.js";

function failure(source: string | Uint8Array | unknown, format: "json" | "yaml" = "yaml") {
  try {
    decodeGraphSource(source, { format });
  } catch (error) {
    expect(error).toBeInstanceOf(GraphSourceError);
    return error as GraphSourceError;
  }
  throw new Error("expected source decoding to fail");
}

describe("strict graph source decoding", () => {
  it("decodes comments, block/flow collections, block strings, Unicode, and YAML 1.2 scalars", () => {
    const source = `
# YAML 1.2 core leaves the legacy booleans and dates as strings.
name: 图工程
description: |
  first line
  second line
legacy: {yes: yes, on: on, date: "2026-07-26"}
items: [1, -2, 3.5, true, false, null]
`;
    expect(decodeGraphSource(source, { format: "yaml" })).toEqual({
      name: "图工程",
      description: "first line\nsecond line\n",
      legacy: { yes: "yes", on: "on", date: "2026-07-26" },
      items: [1, -2, 3.5, true, false, null],
    });
  });

  it.each([
    "2026-07-26",
    "2026-07-26T12:34:56Z",
    "2026-07-26 12:34:56.123 -07:00",
  ])("rejects plain YAML timestamp/date %s while accepting the quoted string", (value) => {
    const error = failure(`value: ${value}\n`);
    expect(error).toMatchObject({
      code: "GE_SOURCE_NON_JSON_VALUE",
      path: "#/value",
    });
    expect(decodeGraphSource(`value: ${JSON.stringify(value)}\n`, { format: "yaml" })).toEqual({
      value,
    });
  });

  it("uses YAML 1.2 core numeric forms without YAML 1.1-only coercion", () => {
    expect(decodeGraphSource(
      "decimal: 42\noctal: 0o10\nhex: 0x10\nfloat: 1.5\nexponent: 1e3\nunderscored: 1_000\nbinary: 0b10\npositiveOctal: +0o10\nnegativeOctal: -0o10\npositiveHex: +0xA\nnegativeHex: -0xA\n",
      { format: "yaml" },
    )).toEqual({
      decimal: 42,
      octal: 8,
      hex: 16,
      float: 1.5,
      exponent: 1000,
      underscored: "1_000",
      binary: "0b10",
      positiveOctal: "+0o10",
      negativeOctal: "-0o10",
      positiveHex: "+0xA",
      negativeHex: "-0xA",
    });
  });

  it("produces exact detached canonical data for equivalent JSON and YAML", () => {
    const json = '{"metadata":{"name":"demo","labels":{"b":"2","a":"1"}},"items":[1,true,null]}';
    const yaml = `metadata:
  name: demo
  labels:
    b: "2"
    a: "1"
items:
  - 1
  - true
  - null
`;
    const fromJson = decodeGraphSource(json, { format: "json" });
    const fromYaml = parseGraphSource(yaml, { format: "yaml" });
    expect(canonicalSerialize(fromYaml)).toBe(canonicalSerialize(fromJson));
    expect(Object.isFrozen(fromJson)).toBe(true);
    expect(Object.isFrozen((fromYaml as { metadata: object }).metadata)).toBe(true);
  });

  it("preserves source mapping insertion order until canonical serialization", () => {
    for (const [source, format] of [
      ['{"z":1,"a":2,"m":3}', "json"],
      ["z: 1\na: 2\nm: 3\n", "yaml"],
    ] as const) {
      const value = decodeGraphSource(source, { format }) as Readonly<Record<string, unknown>>;
      expect(Object.keys(value)).toEqual(["z", "a", "m"]);
      expect(canonicalSerialize(value)).toBe('{"a":2,"m":3,"z":1}');
    }
  });

  it("uses fatal UTF-8 for raw bytes and does not accept unpaired source-text surrogates", () => {
    const invalidBytes = Uint8Array.from([0x7b, 0xff, 0x7d]);
    expect(failure(invalidBytes, "json").toJSON()).toEqual({
      code: "GE_SOURCE_INVALID_UTF8",
      format: "json",
      message: "Source bytes are not valid UTF-8",
      path: null,
      line: null,
      column: null,
    });
    expect(failure('"\ud800"', "json").code).toBe("GE_SOURCE_INVALID_UTF8");

    // An escaped JSON vector remains ASCII source bytes and preserves its JSON
    // string value; it is not confused with malformed UTF-8 input.
    expect(decodeGraphSource('"\\ud800"', { format: "json" })).toBe("\ud800");
    expect(failure(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "json").code).toBe(
      "GE_SOURCE_SYNTAX",
    );
  });

  it("enforces byte, nesting, and node ceilings with caller limits only allowed to lower them", () => {
    expect(() => decodeGraphSource("abcdef", {
      format: "yaml",
      limits: { maxBytes: 5 },
    })).toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
    expect(() => decodeGraphSource("a:\n  b:\n    c: 1\n", {
      format: "yaml",
      limits: { maxDepth: 2 },
    })).toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
    expect(() => decodeGraphSource("a: 1\nb: 2\n", {
      format: "yaml",
      limits: { maxNodes: 2 },
    })).toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
    expect(() => decodeGraphSource("{}", {
      format: "json",
      limits: { maxBytes: 1_048_577 },
    })).toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
    expect(decodeGraphSource("{}", { format: "json", limits: undefined })).toEqual({});
    expect(decodeGraphSource("{}", {
      format: "json",
      limits: { maxNodes: undefined },
    })).toEqual({});
  });

  it("bounds YAML parser work before AST construction without charging trivia or scalar bytes", () => {
    expect(() => decodeGraphSource(`${"[".repeat(128)}0${"]".repeat(128)}\n`, {
      format: "yaml",
      limits: { maxDepth: 1 },
    })).toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
    expect(() => decodeGraphSource("- value\n".repeat(1_000), {
      format: "yaml",
      limits: { maxNodes: 1 },
    })).toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
    expect(decodeGraphSource(`${"# comment\n".repeat(1_000)}${"x".repeat(8_000)}\n`, {
      format: "yaml",
      limits: { maxNodes: 1 },
    })).toBe("x".repeat(8_000));
  });

  it("keeps wide YAML resource checks linear and returns a structured hard-limit error", () => {
    const started = performance.now();
    const wide = decodeGraphSource("-\n".repeat(10_000), { format: "yaml" });
    expect(wide).toHaveLength(10_000);
    expect(performance.now() - started).toBeLessThan(5_000);

    expect(() => decodeGraphSource("-\n".repeat(MAX_GRAPH_SOURCE_NODES), {
      format: "yaml",
    })).toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
    const implicitMapping = Array.from(
      { length: MAX_GRAPH_SOURCE_NODES / 2 },
      (_, index) => `key-${index}:\n`,
    ).join("");
    expect(() => decodeGraphSource(implicitMapping, { format: "yaml" }))
      .toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
  }, 20_000);

  it.each([
    ["root duplicate", "a: 1\na: 2\n", "#/a"],
    ["nested duplicate", "root:\n  a: 1\n  a: 2\n", "#/root/a"],
  ])("rejects %s mapping keys before object construction", (_name, source, path) => {
    const error = failure(source);
    expect(error).toMatchObject({
      code: "GE_SOURCE_DUPLICATE_KEY",
      format: "yaml",
      path,
    });
    expect(error.line).toBeGreaterThan(0);
    expect(error.column).toBeGreaterThan(0);
  });

  it.each([
    ["root duplicate", '{"a":1,"a":2}', "#/a"],
    ["nested duplicate", '{"root":{"a":1,"a":2}}', "#/root/a"],
    ["escape-normalized duplicate", '{"a":1,"\\u0061":2}', "#/a"],
  ])("strict JSON rejects %s keys before constructing the object", (_name, source, path) => {
    const error = failure(source, "json");
    expect(error).toMatchObject({
      code: "GE_SOURCE_DUPLICATE_KEY",
      format: "json",
      path,
    });
    expect(error.line).toBe(1);
    expect(error.column).toBeGreaterThan(0);
  });

  it.each([
    ["anchor", "a: &shared 1\n"],
    ["alias", "a: *missing\n"],
    ["merge", "<<: {a: 1}\n"],
    ["explicit tag", "a: !!str value\n"],
    ["custom tag", "a: !custom value\n"],
    ["YAML directive", "%YAML 1.2\n---\na: 1\n"],
    ["unknown directive", "%FOO bar\n---\na: 1\n"],
    ["unsupported YAML directive", "%YAML 9.9\n---\na: 1\n"],
    ["TAG directive", "%TAG !e! tag:example.com,2026:\n---\na: 1\n"],
  ])("rejects unsafe YAML %s", (_name, source) => {
    const error = failure(source);
    expect(error.code).toBe("GE_SOURCE_UNSAFE_YAML_FEATURE");
    expect(error.message).not.toContain(source);
  });

  it.each(["%0 foo\n---\na: 1\n", "%\n", "%x\n"])(
    "classifies every leading column-zero percent token as an unsafe directive",
    (source) => {
      expect(failure(source)).toMatchObject({ code: "GE_SOURCE_UNSAFE_YAML_FEATURE" });
    },
  );

  it.each([
    ['"a\n%b"\n', "a %b"],
    ["'a\n%b'\n", "a %b"],
    ["a\n%b\n", "a %b"],
  ])("does not reinterpret scalar continuation percent tokens as directives", (source, expected) => {
    expect(decodeGraphSource(source, { format: "yaml" })).toBe(expected);
  });

  it("requires quoted continuations in collections to remain indented", () => {
    for (const source of ['a: "x\ny"\n', "a: 'x\ny'\n", '- "x\ny"\n', "- 'x\ny'\n"]) {
      expect(failure(source)).toMatchObject({ code: "GE_SOURCE_SYNTAX" });
    }
    expect(decodeGraphSource('a: "x\n y"\n', { format: "yaml" })).toEqual({ a: "x y" });
    expect(decodeGraphSource("- 'x\n y'\n", { format: "yaml" })).toEqual(["x y"]);
  });

  it("fails closed on adjacent colons after plain keys inside flow collections", () => {
    for (const source of ["{a:}\n", "{a:, b: 2}\n", "{a:[]}\n", "{a:{}}\n", "[a:]\n"]) {
      expect(failure(source)).toMatchObject({ code: "GE_SOURCE_SYNTAX" });
    }
    expect(decodeGraphSource("{a: []}\n", { format: "yaml" })).toEqual({ a: [] });
    expect(decodeGraphSource('{"a":[]}\n', { format: "yaml" })).toEqual({ a: [] });
  });

  it("requires whitespace before comments after quoted or flow values", () => {
    for (const source of [
      "''#c\n",
      '"x"#c\n',
      "[]#c\n",
      "{a: b}#c\n",
      'a: "x"#c\n',
      "a: []#c\n",
      "- {}#c\n",
    ]) {
      expect(failure(source)).toMatchObject({ code: "GE_SOURCE_SYNTAX" });
    }
    expect(decodeGraphSource('"x" #c\n', { format: "yaml" })).toBe("x");
    expect(decodeGraphSource("[] #c\n", { format: "yaml" })).toEqual([]);
    expect(decodeGraphSource("a#c\n", { format: "yaml" })).toBe("a#c");
    expect(decodeGraphSource('a: "x" #c\n', { format: "yaml" })).toEqual({ a: "x" });
  });

  it("classifies malformed unsafe indicators as syntax and defers profile syntax behind document count", () => {
    for (const source of ["*\n", "&\n", "!x]\n", "![\n"]) {
      expect(failure(source)).toMatchObject({ code: "GE_SOURCE_SYNTAX" });
    }
    expect(failure("*missing\n")).toMatchObject({ code: "GE_SOURCE_UNSAFE_YAML_FEATURE" });
    expect(failure("&a 1\n")).toMatchObject({ code: "GE_SOURCE_UNSAFE_YAML_FEATURE" });
    expect(failure("!x value\n")).toMatchObject({ code: "GE_SOURCE_UNSAFE_YAML_FEATURE" });
    expect(failure("{a:}\n---\nb: 2\n"))
      .toMatchObject({ code: "GE_SOURCE_MULTIPLE_DOCUMENTS" });
  });

  it("distinguishes indented percent syntax and trailing content after an explicit end", () => {
    expect(failure(" %FOO bar\n")).toMatchObject({ code: "GE_SOURCE_SYNTAX" });
    expect(failure("...\nfoo\n")).toMatchObject({ code: "GE_SOURCE_SYNTAX" });
    expect(failure("...\n...\n")).toMatchObject({ code: "GE_SOURCE_SYNTAX" });
    expect(failure("...\n---\n")).toMatchObject({ code: "GE_SOURCE_MULTIPLE_DOCUMENTS" });
    expect(decodeGraphSource("...   \n", { format: "yaml" })).toBeNull();
    expect(failure("...   \nfoo\n")).toMatchObject({ code: "GE_SOURCE_SYNTAX" });
    expect(failure("...   \n---\n")).toMatchObject({ code: "GE_SOURCE_MULTIPLE_DOCUMENTS" });
    expect(failure("...   \n%x\n")).toMatchObject({ code: "GE_SOURCE_UNSAFE_YAML_FEATURE" });
    expect(failure("---\n...\n%YAML 1.2\n---\n"))
      .toMatchObject({ code: "GE_SOURCE_UNSAFE_YAML_FEATURE" });
    expect(failure("---\n...\n%x\n"))
      .toMatchObject({ code: "GE_SOURCE_UNSAFE_YAML_FEATURE" });
  });

  it("rejects document streams even when each individual document is valid", () => {
    const error = failure("---\na: 1\n---\nb: 2\n");
    expect(error.code).toBe("GE_SOURCE_MULTIPLE_DOCUMENTS");
    expect(error.line).toBe(3);
    expect(error.column).toBe(1);
  });

  it.each([
    ["complex key", "? [a, b]\n: value\n"],
    ["NaN", "value: .nan\n"],
    ["positive infinity", "value: .inf\n"],
    ["negative infinity", "value: -.inf\n"],
    ["unsafe positive integer", `value: ${Number.MAX_SAFE_INTEGER + 1}\n`],
    ["unsafe negative integer", `value: ${Number.MIN_SAFE_INTEGER - 1}\n`],
  ])("rejects non-JSON YAML %s", (_name, source) => {
    expect(failure(source).code).toBe("GE_SOURCE_NON_JSON_VALUE");
  });

  it("leaves a portable root sequence for the Graph compiler to reject as GE1007", () => {
    expect(decodeGraphSource("- one\n- two\n", { format: "yaml" })).toEqual(["one", "two"]);
  });

  it("rejects parser errors and reports one-based locations without leaking source or parser stacks", () => {
    const secret = "VERY_SECRET_TRAILING_VALUE";
    const error = failure(`root:\n  value: ok\n  ] ${secret}\n`);
    expect(error).toMatchObject({ code: "GE_SOURCE_SYNTAX", format: "yaml" });
    expect(error.line).toBeGreaterThan(0);
    expect(error.column).toBeGreaterThan(0);
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error.stack).not.toBeUndefined();
    expect(error.toJSON()).not.toHaveProperty("stack");
  });

  it.each([
    ["NUL", "a\u0000b"],
    ["raw tab", "a\tb"],
    ["vertical tab", "a\u000bb"],
    ["lone CR", "a\rb"],
    ["DEL", "a\u007fb"],
    ["NEL", "a\u0085b"],
    ["C1 control", "a\u009fb"],
    ["line separator", "a\u2028b"],
    ["paragraph separator", "a\u2029b"],
    ["U+FFFE", "a\ufffeb"],
    ["U+FFFF", "a\uffffb"],
  ])("rejects YAML lexical preflight case %s before AST parsing", (_name, source) => {
    const error = failure(source);
    expect(error).toMatchObject({
      code: "GE_SOURCE_SYNTAX",
      format: "yaml",
      path: "#",
      line: 1,
      column: 2,
    });
    expect(error.message).not.toContain(source);
  });

  it("accepts LF/CRLF and escaped tabs without accepting raw tabs", () => {
    expect(decodeGraphSource("first: one\r\nsecond: two\r\n", { format: "yaml" })).toEqual({
      first: "one",
      second: "two",
    });
    expect(decodeGraphSource('value: "\\t"\n', { format: "yaml" })).toEqual({ value: "\t" });
    expect(decodeGraphSource('line: "\\L"\nparagraph: "\\P"\n', { format: "yaml" })).toEqual({
      line: "\u2028",
      paragraph: "\u2029",
    });
  });

  it("allows one leading YAML BOM while preserving directive and misplaced-BOM rejection", () => {
    expect(decodeGraphSource("\ufeffvalue: ok\n", { format: "yaml" })).toEqual({ value: "ok" });
    expect(decodeGraphSource(
      Uint8Array.from([0xef, 0xbb, 0xbf, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x3a, 0x20, 0x6f, 0x6b]),
      { format: "yaml" },
    )).toEqual({ value: "ok" });
    for (const source of [
      "\ufeff%FOO bar\n---\nvalue: ok\n",
      "\ufeff%YAML 9.9\n---\nvalue: ok\n",
    ]) {
      expect(failure(source).code).toBe("GE_SOURCE_UNSAFE_YAML_FEATURE");
    }
    for (const source of ["\ufeff\ufeffvalue: ok\n", "value: a\ufeffb\n"]) {
      expect(failure(source).code).toBe("GE_SOURCE_SYNTAX");
    }
  });

  it("maps unsafe JSON numbers and syntax into stable local source errors", () => {
    const unsafe = failure(`{"value":${Number.MAX_SAFE_INTEGER + 1}}`, "json");
    expect(unsafe).toMatchObject({
      code: "GE_SOURCE_NON_JSON_VALUE",
      format: "json",
      path: "#/value",
    });
    const syntax = failure('{"secret":"do-not-leak",}', "json");
    expect(syntax.code).toBe("GE_SOURCE_SYNTAX");
    expect(syntax.message).not.toContain("do-not-leak");
    for (const invalid of ["01", "1.", "1e", "{} trailing"]) {
      expect(failure(invalid, "json").code).toBe("GE_SOURCE_SYNTAX");
    }
    for (const invalid of ["NaN", "Infinity", "-Infinity"]) {
      expect(failure(invalid, "json").code).toBe("GE_SOURCE_NON_JSON_VALUE");
    }
    expect(failure("1e400", "json").code).toBe("GE_SOURCE_NON_JSON_VALUE");
    expect(failure(`${Number.MAX_SAFE_INTEGER + 1}.0`, "json").code).toBe(
      "GE_SOURCE_NON_JSON_VALUE",
    );
  });

  it("applies identical semantic depth and value-node limits to JSON and YAML", () => {
    for (const [source, format] of [
      ['{"a":1,"b":2}', "json"],
      ["a: 1\nb: 2\n", "yaml"],
    ] as const) {
      expect(() => decodeGraphSource(source, {
        format,
        limits: { maxNodes: 2 },
      })).toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
    }
    for (const [source, format] of [
      ['{"a":{"b":1}}', "json"],
      ["a:\n  b: 1\n", "yaml"],
    ] as const) {
      expect(() => decodeGraphSource(source, {
        format,
        limits: { maxDepth: 2 },
      })).toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
    }
    for (const [source, format] of [
      ['{"a":1}', "json"],
      ["a: 1\n", "yaml"],
    ] as const) {
      expect(decodeGraphSource(source, { format, limits: { maxNodes: 3 } })).toEqual({ a: 1 });
      expect(() => decodeGraphSource(source, {
        format,
        limits: { maxNodes: 2 },
      })).toThrowError(expect.objectContaining({ code: "GE_SOURCE_TOO_LARGE" }));
    }
  });

  it("supports empty documents and reserved mapping keys without prototype effects", () => {
    expect(decodeGraphSource("# comment only\n", { format: "yaml" })).toBeNull();
    expect(decodeGraphSource("...\n", { format: "yaml" })).toBeNull();
    expect(decodeGraphSource("---\n...\n", { format: "yaml" })).toBeNull();
    const parsed = decodeGraphSource('__proto__: safe\nconstructor: still-safe\n', {
      format: "yaml",
    }) as Readonly<Record<string, unknown>>;
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed.__proto__).toBe("safe");
    expect(parsed.constructor).toBe("still-safe");
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("snapshots byte views without invoking shadowed properties and contains detached-buffer failure", () => {
    let calls = 0;
    const bytes = new TextEncoder().encode("{}");
    Object.defineProperty(bytes, "byteLength", {
      configurable: true,
      get() {
        calls += 1;
        throw new Error("SECRET_BYTE_LENGTH_GETTER");
      },
    });
    expect(decodeGraphSource(bytes, { format: "json" })).toEqual({});
    expect(calls).toBe(0);

    const detached = Uint8Array.from([0x7b, 0x7d]);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    const error = failure(detached, "json");
    expect(error.code).toBe("GE_SOURCE_INVALID_UTF8");
    expect(error.message).not.toContain("detached");
  });

  it("rejects hostile source and option proxies without invoking traps", () => {
    let calls = 0;
    const hostile = new Proxy(new Uint8Array([0x7b, 0x7d]), {
      getPrototypeOf() {
        calls += 1;
        throw new Error("SECRET_PROXY_SOURCE");
      },
    });
    const hostileOptions = new Proxy({}, {
      ownKeys() {
        calls += 1;
        throw new Error("SECRET_PROXY_OPTIONS");
      },
    });
    expect(failure(hostile, "json").code).toBe("GE_SOURCE_INVALID_UTF8");
    expect(() => decodeGraphSource("{}", hostileOptions)).toThrowError(
      expect.objectContaining({ code: "GE_SOURCE_SYNTAX" }),
    );
    expect(calls).toBe(0);
  });
});
