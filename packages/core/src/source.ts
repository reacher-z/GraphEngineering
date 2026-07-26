import { isProxy } from "node:util/types";
import {
  CST,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  Lexer,
  LineCounter,
  Parser,
  parseAllDocuments,
  type Node,
  type Scalar,
} from "yaml";

export type GraphSourceFormat = "json" | "yaml";

export type GraphSourceErrorCode =
  | "GE_SOURCE_INVALID_UTF8"
  | "GE_SOURCE_TOO_LARGE"
  | "GE_SOURCE_SYNTAX"
  | "GE_SOURCE_MULTIPLE_DOCUMENTS"
  | "GE_SOURCE_DUPLICATE_KEY"
  | "GE_SOURCE_UNSAFE_YAML_FEATURE"
  | "GE_SOURCE_NON_JSON_VALUE";

export interface GraphSourceErrorProjection {
  readonly code: GraphSourceErrorCode;
  readonly format: GraphSourceFormat;
  readonly message: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly column: number | null;
}

export class GraphSourceError extends Error implements GraphSourceErrorProjection {
  readonly code: GraphSourceErrorCode;
  readonly format: GraphSourceFormat;
  readonly path: string | null;
  readonly line: number | null;
  readonly column: number | null;

  constructor(
    code: GraphSourceErrorCode,
    format: GraphSourceFormat,
    message: string,
    fields: {
      readonly path?: string | null;
      readonly line?: number | null;
      readonly column?: number | null;
    } = {},
  ) {
    super(message);
    this.name = "GraphSourceError";
    this.code = code;
    this.format = format;
    this.path = fields.path ?? null;
    this.line = fields.line ?? null;
    this.column = fields.column ?? null;
  }

  toJSON(): GraphSourceErrorProjection {
    return Object.freeze({
      code: this.code,
      format: this.format,
      message: this.message,
      path: this.path,
      line: this.line,
      column: this.column,
    });
  }
}

export const MAX_GRAPH_SOURCE_BYTES = 1024 * 1024;
export const MAX_GRAPH_SOURCE_DEPTH = 100;
export const MAX_GRAPH_SOURCE_NODES = 100_000;

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;

export interface GraphSourceLimits {
  /** May lower, but never raise, the hard 1 MiB source ceiling. */
  readonly maxBytes?: number;
  /** May lower, but never raise, the hard 100-level nesting ceiling. */
  readonly maxDepth?: number;
  /** May lower, but never raise, the hard 100,000-value ceiling. */
  readonly maxNodes?: number;
}

export interface GraphSourceOptions {
  readonly format?: GraphSourceFormat;
  readonly limits?: GraphSourceLimits;
}

interface ResolvedLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}

interface Position {
  readonly line: number;
  readonly column: number;
}

interface AstState {
  count: number;
  readonly limits: ResolvedLimits;
  readonly lineCounter: LineCounter;
}

function sourceError(
  code: GraphSourceErrorCode,
  format: GraphSourceFormat,
  message: string,
  fields: {
    readonly path?: string | null;
    readonly line?: number | null;
    readonly column?: number | null;
  } = {},
): never {
  throw new GraphSourceError(code, format, message, fields);
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator <= 0 ? "#" : path.slice(0, separator);
}

function positionAt(offset: number | undefined, lineCounter: LineCounter): Position | null {
  if (offset === undefined || offset < 0) return null;
  const position = lineCounter.linePos(offset);
  return { line: position.line, column: position.col };
}

function errorFields(
  path: string | null,
  position: Position | null,
): { readonly path: string | null; readonly line: number | null; readonly column: number | null } {
  return {
    path,
    line: position?.line ?? null,
    column: position?.column ?? null,
  };
}

function inspectOwnDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (
    typeof value !== "object" ||
    value === null ||
    isProxy(value) ||
    Array.isArray(value)
  ) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const inspected: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      Object.defineProperty(inspected, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(inspected);
  } catch {
    return null;
  }
}

function resolveOptions(options: GraphSourceOptions | unknown): {
  readonly format: GraphSourceFormat;
  readonly limits: ResolvedLimits;
} {
  const captured = inspectOwnDataRecord(options === undefined ? {} : options);
  if (captured === null) {
    return sourceError(
      "GE_SOURCE_SYNTAX",
      "json",
      "Source options must be portable data properties",
    );
  }
  const record = captured;
  for (const key of Object.keys(record)) {
    if (key !== "format" && key !== "limits") {
      return sourceError("GE_SOURCE_SYNTAX", "json", "Source options contain an unknown field");
    }
  }
  const format = record.format ?? "json";
  if (format !== "json" && format !== "yaml") {
    return sourceError("GE_SOURCE_SYNTAX", "json", "Source format must be 'json' or 'yaml'");
  }

  const hardLimits = {
    maxBytes: MAX_GRAPH_SOURCE_BYTES,
    maxDepth: MAX_GRAPH_SOURCE_DEPTH,
    maxNodes: MAX_GRAPH_SOURCE_NODES,
  } as const;
  if (record.limits === undefined) return { format, limits: hardLimits };
  const requested = inspectOwnDataRecord(record.limits);
  if (requested === null) {
    return sourceError("GE_SOURCE_TOO_LARGE", format, "Source limits must be an object");
  }
  for (const key of Object.keys(requested)) {
    if (key !== "maxBytes" && key !== "maxDepth" && key !== "maxNodes") {
      return sourceError("GE_SOURCE_TOO_LARGE", format, "Source limits contain an unknown field");
    }
  }
  const resolved: Record<keyof ResolvedLimits, number> = { ...hardLimits };
  for (const key of ["maxBytes", "maxDepth", "maxNodes"] as const) {
    const value = requested[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > hardLimits[key]) {
      return sourceError(
        "GE_SOURCE_TOO_LARGE",
        format,
        `Source limit '${key}' must be a positive safe integer no greater than the hard ceiling`,
      );
    }
    resolved[key] = value as number;
  }
  return { format, limits: Object.freeze(resolved) };
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function decodeSource(
  source: string | Uint8Array | unknown,
  format: GraphSourceFormat,
  maxBytes: number,
): string {
  let text: string;
  let byteLength: number;
  if (typeof source === "string") {
    if (hasUnpairedSurrogate(source)) {
      return sourceError(
        "GE_SOURCE_INVALID_UTF8",
        format,
        "Source text contains an unpaired Unicode surrogate",
      );
    }
    text = source;
    byteLength = Buffer.byteLength(text, "utf8");
  } else {
    if (typeof source !== "object" || source === null || isProxy(source) || !(source instanceof Uint8Array)) {
      return sourceError(
        "GE_SOURCE_INVALID_UTF8",
        format,
        "Source must be a string or Uint8Array",
      );
    }
    let observedLength: number;
    try {
      if (typedArrayByteLengthGetter === undefined) throw new TypeError("unavailable byteLength");
      observedLength = Reflect.apply(typedArrayByteLengthGetter, source, []) as number;
    } catch {
      return sourceError(
        "GE_SOURCE_INVALID_UTF8",
        format,
        "Source bytes could not be inspected safely",
      );
    }
    if (observedLength > maxBytes) {
      return sourceError(
        "GE_SOURCE_TOO_LARGE",
        format,
        `Source exceeds the configured ${maxBytes}-byte limit`,
      );
    }
    let detached: Uint8Array;
    try {
      detached = new Uint8Array(source);
    } catch {
      return sourceError(
        "GE_SOURCE_INVALID_UTF8",
        format,
        "Source bytes could not be snapshotted safely",
      );
    }
    byteLength = detached.byteLength;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(detached);
    } catch {
      return sourceError(
        "GE_SOURCE_INVALID_UTF8",
        format,
        "Source bytes are not valid UTF-8",
      );
    }
  }
  if (byteLength > maxBytes) {
    return sourceError(
      "GE_SOURCE_TOO_LARGE",
      format,
      `Source exceeds the configured ${maxBytes}-byte limit`,
    );
  }
  return text;
}

function validateYamlLexicalSource(text: string): void {
  let line = 1;
  let column = 1;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0xfeff) {
      if (index === 0) continue;
      return sourceError(
        "GE_SOURCE_SYNTAX",
        "yaml",
        "YAML source contains a byte-order mark outside source position zero",
        { path: "#", line, column },
      );
    }
    if (code === 0x0d) {
      if (text.charCodeAt(index + 1) !== 0x0a) {
        return sourceError(
          "GE_SOURCE_SYNTAX",
          "yaml",
          "YAML source contains a disallowed raw control character or line break",
          { path: "#", line, column },
        );
      }
      index += 1;
      line += 1;
      column = 1;
      continue;
    }
    if (code === 0x0a) {
      line += 1;
      column = 1;
      continue;
    }
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      return sourceError(
        "GE_SOURCE_SYNTAX",
        "yaml",
        "YAML source contains a disallowed raw control character or line break",
        { path: "#", line, column },
      );
    }
    if (code >= 0xd800 && code <= 0xdbff) index += 1;
    column += 1;
  }
}

function textPosition(text: string, offset: number): Position {
  const prefix = text.slice(0, offset);
  const line = 1 + (prefix.match(/\n/gu)?.length ?? 0);
  const lastLineFeed = prefix.lastIndexOf("\n");
  return { line, column: offset - lastLineFeed };
}

function yamlMarker(value: string, marker: "---" | "..."): boolean {
  if (!value.startsWith(marker)) return false;
  const remainder = value.slice(marker.length);
  return remainder.length === 0 || /^ +(?:#.*)?$/u.test(remainder);
}

interface SignificantYamlLine {
  readonly raw: string;
  readonly offset: number;
  readonly nextOffset: number;
}

function nextSignificantYamlLine(text: string, startOffset: number): SignificantYamlLine | null {
  let cursor = startOffset;
  while (cursor <= text.length) {
    const lineFeed = text.indexOf("\n", cursor);
    const lineEnd = lineFeed === -1 ? text.length : lineFeed;
    let raw = text.slice(cursor, lineEnd);
    if (raw.endsWith("\r")) raw = raw.slice(0, -1);
    const bomOffset = cursor === 0 && raw.startsWith("\ufeff") ? 1 : 0;
    if (bomOffset === 1) raw = raw.slice(1);
    const trimmed = raw.trim();
    const nextOffset = lineFeed === -1 ? text.length + 1 : lineFeed + 1;
    if (trimmed.length > 0 && !trimmed.startsWith("#")) {
      return { raw, offset: cursor + bomOffset, nextOffset };
    }
    if (lineFeed === -1) return null;
    cursor = nextOffset;
  }
  return null;
}

function preflightYamlStructure(text: string): void {
  const first = nextSignificantYamlLine(text, 0);
  if (first === null) return;
  if (first.raw.startsWith("%")) {
    return sourceError(
      "GE_SOURCE_UNSAFE_YAML_FEATURE",
      "yaml",
      "YAML directives are not supported",
      errorFields("#", textPosition(text, first.offset)),
    );
  }
  if (/^ +%/u.test(first.raw)) {
    const percentOffset = first.offset + first.raw.indexOf("%");
    return sourceError(
      "GE_SOURCE_SYNTAX",
      "yaml",
      "An indented percent token cannot begin a YAML document",
      errorFields("#", textPosition(text, percentOffset)),
    );
  }
  if (!yamlMarker(first.raw, "...")) return;
  const trailing = nextSignificantYamlLine(text, first.nextOffset);
  if (trailing?.raw.startsWith("%") === true) {
    return sourceError(
      "GE_SOURCE_UNSAFE_YAML_FEATURE",
      "yaml",
      "YAML directives are not supported",
      errorFields("#", textPosition(text, trailing.offset)),
    );
  }
  if (trailing !== null && !yamlMarker(trailing.raw, "---")) {
    return sourceError(
      "GE_SOURCE_SYNTAX",
      "yaml",
      "YAML source has content after an explicit document end",
      errorFields("#", textPosition(text, trailing.offset)),
    );
  }
}

const YAML_PARSER_WORK_PER_NODE = 8;
const YAML_PARSER_WORK_ALLOWANCE = 64;
const YAML_PREFLIGHT_DEPTH_ALLOWANCE = 16;

function yamlCollectionDepth(parser: Parser): number {
  return parser.stack.reduce(
    (depth, token) =>
      token.type === "block-map" ||
      token.type === "block-seq" ||
      token.type === "flow-collection"
        ? depth + 1
        : depth,
    0,
  );
}

function preflightYamlResources(text: string, limits: ResolvedLimits): GraphSourceError | null {
  const lexer = new Lexer();
  const parser = new Parser();
  const seenCollections = new WeakSet<object>();
  const workLimit = limits.maxNodes * YAML_PARSER_WORK_PER_NODE + YAML_PARSER_WORK_ALLOWANCE;
  const nodeGuard = limits.maxNodes + YAML_PARSER_WORK_ALLOWANCE;
  const depthGuard = limits.maxDepth + YAML_PREFLIGHT_DEPTH_ALLOWANCE;
  let work = 0;
  let nodeLowerBound = 0;
  let sequenceItemLowerBound = 0;
  let mappingPairLowerBound = 0;
  let pendingProfileError: GraphSourceError | null = null;
  const flowCollections: Array<{ kind: "map" | "sequence"; lastScalar: "plain" | "quoted" | null }> = [];

  const inspectParserStack = (tokenType: ReturnType<typeof CST.tokenType>): void => {
    for (const token of parser.stack) {
      if (
        (token.type === "block-map" ||
          token.type === "block-seq" ||
          token.type === "flow-collection") &&
        !seenCollections.has(token)
      ) {
        seenCollections.add(token);
        nodeLowerBound += 1;
      }
    }

    if (
      tokenType === "scalar" ||
      tokenType === "single-quoted-scalar" ||
      tokenType === "double-quoted-scalar" ||
      tokenType === "alias"
    ) {
      nodeLowerBound += 1;
    }

    if (tokenType === "seq-item-ind") sequenceItemLowerBound += 1;
    if (tokenType === "map-value-ind") mappingPairLowerBound += 1;

    const collectionDepth = yamlCollectionDepth(parser);
    const addressesChild =
      tokenType === "scalar" ||
      tokenType === "single-quoted-scalar" ||
      tokenType === "double-quoted-scalar" ||
      tokenType === "alias" ||
      tokenType === "map-value-ind" ||
      tokenType === "seq-item-ind" ||
      tokenType === "explicit-key-ind";
    const observedDepth = collectionDepth + (addressesChild ? 1 : 0);
    if (observedDepth > depthGuard) {
      return sourceError(
        "GE_SOURCE_TOO_LARGE",
        "yaml",
        `YAML exceeds the configured ${limits.maxDepth}-level nesting limit`,
        errorFields("#", textPosition(text, Math.min(parser.offset, text.length))),
      );
    }
    const effectiveNodeLowerBound = Math.max(
      nodeLowerBound,
      sequenceItemLowerBound === 0 ? 0 : sequenceItemLowerBound + 1,
      mappingPairLowerBound === 0 ? 0 : mappingPairLowerBound * 2 + 1,
    );
    if (effectiveNodeLowerBound > nodeGuard) {
      return sourceError(
        "GE_SOURCE_TOO_LARGE",
        "yaml",
        `YAML exceeds the configured ${limits.maxNodes}-node limit`,
        errorFields("#", textPosition(text, Math.min(parser.offset, text.length))),
      );
    }
  };

  try {
    for (const lexeme of lexer.lex(text)) {
      const tokenType = CST.tokenType(lexeme);
      if (tokenType === "directive-line") {
        return sourceError(
          "GE_SOURCE_UNSAFE_YAML_FEATURE",
          "yaml",
          "YAML directives are not supported",
          errorFields("#", textPosition(text, Math.min(parser.offset, text.length))),
        );
      }
      if (
        pendingProfileError === null &&
        ((tokenType === "alias" && lexeme === "*") ||
          (tokenType === "anchor" && lexeme === "&") ||
          (tokenType === "tag" && lexeme === "!"))
      ) {
        pendingProfileError = new GraphSourceError(
          "GE_SOURCE_SYNTAX",
          "yaml",
          "YAML contains an incomplete alias, anchor, or tag indicator",
          errorFields("#", textPosition(text, Math.min(parser.offset, text.length))),
        );
      }
      if (
        tokenType !== null &&
        tokenType !== "space" &&
        tokenType !== "comment" &&
        tokenType !== "newline" &&
        tokenType !== "byte-order-mark" &&
        tokenType !== "doc-mode"
      ) {
        work += 1;
        if (work > workLimit) {
          return sourceError(
            "GE_SOURCE_TOO_LARGE",
            "yaml",
            "YAML parser work exceeds the configured resource budget",
            errorFields("#", textPosition(text, Math.min(parser.offset, text.length))),
          );
        }
      }
      for (const _token of parser.next(lexeme)) {
        // Draining completed CST tokens keeps this pass streaming.
      }
      if (tokenType === "flow-map-start") {
        flowCollections.push({ kind: "map", lastScalar: null });
      } else if (tokenType === "flow-seq-start") {
        flowCollections.push({ kind: "sequence", lastScalar: null });
      } else if (tokenType === "scalar") {
        const flow = flowCollections.at(-1);
        if (flow !== undefined) flow.lastScalar = "plain";
      } else if (
        tokenType === "single-quoted-scalar" ||
        tokenType === "double-quoted-scalar"
      ) {
        const flow = flowCollections.at(-1);
        if (flow !== undefined) flow.lastScalar = "quoted";
      } else if (tokenType === "map-value-ind") {
        const flow = flowCollections.at(-1);
        const nextCharacter = text[parser.offset];
        if (
          flow?.lastScalar === "plain" &&
          nextCharacter !== undefined &&
          !/[ \t\r\n]/u.test(nextCharacter)
        ) {
          pendingProfileError ??= new GraphSourceError(
            "GE_SOURCE_SYNTAX",
            "yaml",
            "Plain flow mapping keys require whitespace after ':' in the safe YAML profile",
            errorFields("#", textPosition(text, Math.max(0, parser.offset - 1))),
          );
        }
        if (flow !== undefined) flow.lastScalar = null;
      } else if (tokenType === "comma") {
        const flow = flowCollections.at(-1);
        if (flow !== undefined) flow.lastScalar = null;
      } else if (tokenType === "flow-map-end" || tokenType === "flow-seq-end") {
        flowCollections.pop();
      }
      inspectParserStack(tokenType);
    }
    for (const _token of parser.end()) {
      // Flush the final CST token without retaining it.
    }
    inspectParserStack(null);
    return pendingProfileError;
  } catch (error) {
    if (error instanceof GraphSourceError) throw error;
    if (error instanceof RangeError) {
      return sourceError(
        "GE_SOURCE_TOO_LARGE",
        "yaml",
        "YAML parser exhausted the configured resource budget",
      );
    }
    // Syntax and semantic classification remains the strict parser's job.
    return pendingProfileError;
  }
}

class StrictJsonParser {
  readonly #text: string;
  readonly #limits: ResolvedLimits;
  #index = 0;
  #nodes = 0;

  constructor(text: string, limits: ResolvedLimits) {
    this.#text = text;
    this.#limits = limits;
  }

  parse(): unknown {
    this.#skipWhitespace();
    if (this.#index >= this.#text.length) this.#syntax("JSON document is empty", "#");
    const value = this.#value("#", 1);
    this.#skipWhitespace();
    if (this.#index !== this.#text.length) {
      this.#syntax("JSON contains trailing content", "#");
    }
    return value;
  }

  #position(offset = this.#index): Position {
    const before = this.#text.slice(0, offset);
    const lines = before.split("\n");
    return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
  }

  #syntax(_reason: string, path: string, offset = this.#index): never {
    return sourceError(
      "GE_SOURCE_SYNTAX",
      "json",
      "JSON source is not syntactically valid",
      errorFields(path, this.#position(offset)),
    );
  }

  #count(path: string, depth: number): void {
    this.#nodes += 1;
    if (this.#nodes > this.#limits.maxNodes) {
      return sourceError(
        "GE_SOURCE_TOO_LARGE",
        "json",
        `JSON exceeds the configured ${this.#limits.maxNodes}-node limit`,
        errorFields(path, this.#position()),
      );
    }
    if (depth > this.#limits.maxDepth) {
      return sourceError(
        "GE_SOURCE_TOO_LARGE",
        "json",
        `JSON exceeds the configured ${this.#limits.maxDepth}-level nesting limit`,
        errorFields(parentPath(path), this.#position()),
      );
    }
  }

  #skipWhitespace(): void {
    while (
      this.#index < this.#text.length &&
      (this.#text[this.#index] === " " ||
        this.#text[this.#index] === "\t" ||
        this.#text[this.#index] === "\n" ||
        this.#text[this.#index] === "\r")
    ) {
      this.#index += 1;
    }
  }

  #value(path: string, depth: number): unknown {
    this.#skipWhitespace();
    this.#count(path, depth);
    for (const token of ["NaN", "Infinity", "-Infinity"] as const) {
      if (this.#text.startsWith(token, this.#index)) {
        return sourceError(
          "GE_SOURCE_NON_JSON_VALUE",
          "json",
          "JSON non-standard numeric constants are not supported",
          errorFields(path, this.#position()),
        );
      }
    }
    const character = this.#text[this.#index];
    if (character === "{") return this.#object(path, depth);
    if (character === "[") return this.#array(path, depth);
    if (character === '"') return this.#string(path);
    if (character === "t") return this.#literal("true", true, path);
    if (character === "f") return this.#literal("false", false, path);
    if (character === "n") return this.#literal("null", null, path);
    if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) {
      return this.#number(path);
    }
    return this.#syntax("Expected a JSON value", path);
  }

  #literal<T extends boolean | null>(token: string, value: T, path: string): T {
    if (this.#text.slice(this.#index, this.#index + token.length) !== token) {
      return this.#syntax("Invalid JSON literal", path);
    }
    this.#index += token.length;
    return value;
  }

  #string(path: string): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.#text.length) {
      const character = this.#text[this.#index];
      if (character === '"') {
        this.#index += 1;
        try {
          return JSON.parse(this.#text.slice(start, this.#index)) as string;
        } catch {
          return this.#syntax("Invalid JSON string", path, start);
        }
      }
      if (character === "\\") {
        const escape = this.#text[this.#index + 1];
        if (escape === "u") {
          const digits = this.#text.slice(this.#index + 2, this.#index + 6);
          if (!/^[0-9A-Fa-f]{4}$/u.test(digits)) {
            return this.#syntax("Invalid Unicode escape", path, this.#index);
          }
          this.#index += 6;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
          return this.#syntax("Invalid string escape", path, this.#index);
        }
        this.#index += 2;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) <= 0x1f) {
        return this.#syntax("Unescaped control character", path, this.#index);
      }
      this.#index += 1;
    }
    return this.#syntax("Unterminated JSON string", path, start);
  }

  #number(path: string): number {
    const start = this.#index;
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.#text.slice(start),
    );
    if (match === null) return this.#syntax("Invalid JSON number", path);
    const token = match[0];
    this.#index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      return sourceError(
        "GE_SOURCE_NON_JSON_VALUE",
        "json",
        "JSON number is not finite or safely interoperable",
        errorFields(path, this.#position(start)),
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  #object(path: string, depth: number): Readonly<Record<string, unknown>> {
    this.#index += 1;
    this.#skipWhitespace();
    const value: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.#text[this.#index] === "}") {
      this.#index += 1;
      return Object.freeze(value);
    }
    while (this.#index < this.#text.length) {
      this.#skipWhitespace();
      if (this.#text[this.#index] !== '"') this.#syntax("Object key must be a string", path);
      const keyOffset = this.#index;
      const key = this.#string(path);
      const childPath = `${path}/${pointerSegment(key)}`;
      if (keys.has(key)) {
        return sourceError(
          "GE_SOURCE_DUPLICATE_KEY",
          "json",
          "JSON mapping keys must be unique",
          errorFields(childPath, this.#position(keyOffset)),
        );
      }
      keys.add(key);
      this.#count(childPath, depth + 1);
      this.#skipWhitespace();
      if (this.#text[this.#index] !== ":") this.#syntax("Missing object colon", childPath);
      this.#index += 1;
      const child = this.#value(childPath, depth + 1);
      Object.defineProperty(value, key, {
        value: child,
        enumerable: true,
        configurable: false,
        writable: false,
      });
      this.#skipWhitespace();
      const delimiter = this.#text[this.#index];
      if (delimiter === "}") {
        this.#index += 1;
        return Object.freeze(value);
      }
      if (delimiter !== ",") this.#syntax("Missing object delimiter", path);
      this.#index += 1;
    }
    return this.#syntax("Unterminated JSON object", path);
  }

  #array(path: string, depth: number): readonly unknown[] {
    this.#index += 1;
    this.#skipWhitespace();
    const values: unknown[] = [];
    if (this.#text[this.#index] === "]") {
      this.#index += 1;
      return Object.freeze(values);
    }
    while (this.#index < this.#text.length) {
      values.push(this.#value(`${path}/${values.length}`, depth + 1));
      this.#skipWhitespace();
      const delimiter = this.#text[this.#index];
      if (delimiter === "]") {
        this.#index += 1;
        return Object.freeze(values);
      }
      if (delimiter !== ",") this.#syntax("Missing array delimiter", path);
      this.#index += 1;
    }
    return this.#syntax("Unterminated JSON array", path);
  }
}

function parseJsonSource(text: string, limits: ResolvedLimits): unknown {
  return new StrictJsonParser(text, limits).parse();
}

function astPosition(node: { readonly range?: readonly number[] | null }, state: AstState): Position | null {
  return positionAt(node.range?.[0], state.lineCounter);
}

function incrementAst(path: string, depth: number, state: AstState, node: { readonly range?: readonly number[] | null }): void {
  state.count += 1;
  const position = astPosition(node, state);
  if (state.count > state.limits.maxNodes) {
    return sourceError(
      "GE_SOURCE_TOO_LARGE",
      "yaml",
      `YAML exceeds the configured ${state.limits.maxNodes}-node limit`,
      errorFields(path, position),
    );
  }
  if (depth > state.limits.maxDepth) {
    return sourceError(
      "GE_SOURCE_TOO_LARGE",
      "yaml",
      `YAML exceeds the configured ${state.limits.maxDepth}-level nesting limit`,
      errorFields(parentPath(path), position),
    );
  }
}

function incrementImplicitNull(
  path: string,
  depth: number,
  state: AstState,
  parent: { readonly range?: readonly number[] | null },
): void {
  state.count += 1;
  const position = astPosition(parent, state);
  if (state.count > state.limits.maxNodes) {
    return sourceError(
      "GE_SOURCE_TOO_LARGE",
      "yaml",
      `YAML exceeds the configured ${state.limits.maxNodes}-node limit`,
      errorFields(path, position),
    );
  }
  if (depth > state.limits.maxDepth) {
    return sourceError(
      "GE_SOURCE_TOO_LARGE",
      "yaml",
      `YAML exceeds the configured ${state.limits.maxDepth}-level nesting limit`,
      errorFields(parentPath(path), position),
    );
  }
}

function scalarValue(node: Scalar, path: string, state: AstState): null | string | boolean | number {
  const value = node.value;
  const fields = errorFields(path, astPosition(node, state));
  if (node.type === "PLAIN" && typeof node.source === "string" && node.source.startsWith("%")) {
    return sourceError(
      "GE_SOURCE_SYNTAX",
      "yaml",
      "A percent indicator cannot begin a plain YAML scalar",
      fields,
    );
  }
  if (typeof value === "string" && isPlainYamlTimestamp(node)) {
    return sourceError(
      "GE_SOURCE_NON_JSON_VALUE",
      "yaml",
      "Plain YAML timestamps and dates are outside the safe JSON profile; quote them as strings",
      fields,
    );
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") {
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return sourceError(
        "GE_SOURCE_NON_JSON_VALUE",
        "yaml",
        "YAML integer is outside the interoperable safe-integer range",
        fields,
      );
    }
    return Number(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      return sourceError(
        "GE_SOURCE_NON_JSON_VALUE",
        "yaml",
        "YAML number is not finite or safely interoperable",
        fields,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  return sourceError(
    "GE_SOURCE_NON_JSON_VALUE",
    "yaml",
    "YAML scalar is outside the JSON data model",
    fields,
  );
}

function isPlainYamlTimestamp(node: Scalar): boolean {
  if (node.type !== "PLAIN" || typeof node.source !== "string") return false;
  const source = node.source;
  return (
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(source) ||
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[Tt]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:[ \t]*(?:Z|[+-][0-9]{1,2}(?::[0-9]{2})?))?$/u.test(source)
  );
}

function yamlNodeToPortable(node: Node, path: string, depth: number, state: AstState): unknown {
  incrementAst(path, depth, state, node);
  if (isAlias(node)) {
    return sourceError(
      "GE_SOURCE_UNSAFE_YAML_FEATURE",
      "yaml",
      "YAML aliases are not supported",
      errorFields(path, astPosition(node, state)),
    );
  }
  if (node.anchor !== undefined || node.tag !== undefined) {
    return sourceError(
      "GE_SOURCE_UNSAFE_YAML_FEATURE",
      "yaml",
      "YAML anchors and explicit tags are not supported",
      errorFields(path, astPosition(node, state)),
    );
  }
  if (isScalar(node)) return scalarValue(node, path, state);
  if (isSeq(node)) {
    const values: unknown[] = [];
    for (const [index, child] of node.items.entries()) {
      if (child === null) {
        incrementImplicitNull(`${path}/${index}`, depth + 1, state, node);
        values.push(null);
      } else {
        values.push(yamlNodeToPortable(child as Node, `${path}/${index}`, depth + 1, state));
      }
    }
    return Object.freeze(values);
  }
  if (isMap(node)) {
    const value: Record<string, unknown> = {};
    const keys = new Set<string>();
    for (const pair of node.items) {
      const keyNode = pair.key as Node | null;
      if (
        keyNode !== null &&
        keyNode !== undefined &&
        (isAlias(keyNode) || keyNode.anchor !== undefined || keyNode.tag !== undefined)
      ) {
        return sourceError(
          "GE_SOURCE_UNSAFE_YAML_FEATURE",
          "yaml",
          "YAML key aliases, anchors, and explicit tags are not supported",
          errorFields(path, astPosition(keyNode, state)),
        );
      }
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
        return sourceError(
          "GE_SOURCE_NON_JSON_VALUE",
          "yaml",
          "YAML mapping keys must be strings",
          errorFields(
            path,
            pair.key === null || pair.key === undefined
              ? astPosition(node, state)
              : astPosition(pair.key, state),
          ),
        );
      }
      const key = pair.key.value;
      const childPath = `${path}/${pointerSegment(key)}`;
      incrementAst(childPath, depth + 1, state, pair.key);
      if (
        pair.key.type === "PLAIN" &&
        typeof pair.key.source === "string" &&
        pair.key.source.startsWith("%")
      ) {
        return sourceError(
          "GE_SOURCE_SYNTAX",
          "yaml",
          "A percent indicator cannot begin a plain YAML key",
          errorFields(childPath, astPosition(pair.key, state)),
        );
      }
      if (isPlainYamlTimestamp(pair.key)) {
        return sourceError(
          "GE_SOURCE_NON_JSON_VALUE",
          "yaml",
          "Plain YAML timestamp and date keys are outside the safe JSON profile",
          errorFields(childPath, astPosition(pair.key, state)),
        );
      }
      if (key === "<<") {
        return sourceError(
          "GE_SOURCE_UNSAFE_YAML_FEATURE",
          "yaml",
          "YAML merge keys are not supported",
          errorFields(childPath, astPosition(pair.key, state)),
        );
      }
      if (keys.has(key)) {
        return sourceError(
          "GE_SOURCE_DUPLICATE_KEY",
          "yaml",
          "YAML mapping keys must be unique",
          errorFields(childPath, astPosition(pair.key, state)),
        );
      }
      keys.add(key);
      let child: unknown;
      if (pair.value === null) {
        incrementImplicitNull(childPath, depth + 1, state, node);
        child = null;
      } else {
        child = yamlNodeToPortable(pair.value as Node, childPath, depth + 1, state);
      }
      Object.defineProperty(value, key, {
        value: child,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(value);
  }
  return sourceError(
    "GE_SOURCE_NON_JSON_VALUE",
    "yaml",
    "YAML contains a node outside the JSON data model",
    errorFields(path, astPosition(node, state)),
  );
}

function parserErrorCode(code: string): GraphSourceErrorCode {
  if (code === "DUPLICATE_KEY") return "GE_SOURCE_DUPLICATE_KEY";
  if (code === "MULTIPLE_DOCS") return "GE_SOURCE_MULTIPLE_DOCUMENTS";
  if (code === "RESOURCE_EXHAUSTION") return "GE_SOURCE_TOO_LARGE";
  if (
    code === "ALIAS_PROPS" ||
    code === "BAD_ALIAS" ||
    code === "MULTIPLE_ANCHORS" ||
    code === "MULTIPLE_TAGS" ||
    code === "TAG_RESOLVE_FAILED"
  ) {
    return "GE_SOURCE_UNSAFE_YAML_FEATURE";
  }
  if (code === "NON_STRING_KEY" || code === "BAD_COLLECTION_TYPE") {
    return "GE_SOURCE_NON_JSON_VALUE";
  }
  return "GE_SOURCE_SYNTAX";
}

function parseYamlSource(
  text: string,
  limits: ResolvedLimits,
  pendingProfileError: GraphSourceError | null,
): unknown {
  const lineCounter = new LineCounter();
  let documents: ReturnType<typeof parseAllDocuments>;
  try {
    documents = parseAllDocuments(text, {
      intAsBigInt: true,
      keepSourceTokens: true,
      lineCounter,
      logLevel: "silent",
      merge: false,
      prettyErrors: false,
      resolveKnownTags: false,
      schema: "core",
      strict: true,
      uniqueKeys: false,
      version: "1.2",
    });
  } catch {
    return sourceError("GE_SOURCE_SYNTAX", "yaml", "YAML parser rejected the source");
  }
  const directiveDocument = documents.find((candidate) => {
    const directives = candidate.directives;
    return (
      directives?.yaml.explicit === true ||
      Object.keys(directives?.tags ?? {}).some((key) => key !== "!!")
    );
  });
  if (directiveDocument !== undefined) {
    return sourceError(
      "GE_SOURCE_UNSAFE_YAML_FEATURE",
      "yaml",
      "YAML directives are not supported",
      errorFields("#", positionAt(directiveDocument.range?.[0], lineCounter)),
    );
  }
  if (documents.length > 1) {
    const second = documents[1];
    const position = positionAt(second?.range?.[0], lineCounter);
    return sourceError(
      "GE_SOURCE_MULTIPLE_DOCUMENTS",
      "yaml",
      "YAML source must contain exactly one document",
      errorFields("#", position),
    );
  }
  if (documents.length === 0) {
    return null;
  }
  const document = documents[0];
  if (document === undefined) return null;

  if (pendingProfileError !== null) throw pendingProfileError;

  const issue = document.errors[0] ?? document.warnings[0];
  if (issue !== undefined) {
    return sourceError(
      parserErrorCode(issue.code),
      "yaml",
      "YAML source was rejected by the strict parser",
      errorFields("#", positionAt(issue.pos[0], lineCounter)),
    );
  }
  if (document.contents === null) return null;

  const state: AstState = { count: 0, limits, lineCounter };
  return yamlNodeToPortable(document.contents, "#", 1, state);
}

/**
 * Decode bytes or text into a detached, deeply frozen portable JSON value.
 * Graph envelope validity remains the responsibility of `compileGraph`.
 */
export function decodeGraphSource(
  source: string | Uint8Array | unknown,
  options: GraphSourceOptions | unknown = {},
): unknown {
  const { format, limits } = resolveOptions(options);
  const text = decodeSource(source, format, limits.maxBytes);
  if (format === "yaml") {
    validateYamlLexicalSource(text);
    preflightYamlStructure(text);
    const pendingProfileError = preflightYamlResources(text, limits);
    return parseYamlSource(text, limits, pendingProfileError);
  }
  return parseJsonSource(text, limits);
}

/** Language-friendly alias for callers which prefer parse terminology. */
export const parseGraphSource = decodeGraphSource;
