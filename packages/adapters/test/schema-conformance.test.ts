/**
 * The documents this package emits, validated against the shipped D13 schemas.
 *
 * The corpus oracle already proves the schemas are internally consistent. What
 * is proved here is the thing an implementation can get wrong: that a usage
 * envelope or an error envelope this package *constructs* is accepted by
 * `adapter-usage.schema.json` and `adapter-error.schema.json`, and that the
 * twenty-four schema negatives are still rejected.
 */

import { readFileSync } from "node:fs";

import * as AjvModule from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  composeUsage,
  createHttpAdapter,
  createMockAdapter,
  createShellAdapter,
  normalizedAdapterError,
  type AdapterErrorCode,
} from "../src/index.js";
import { applyMutations, clone, corpus, descriptorFor, requestFrom } from "./corpus.js";

const SCHEMA_NAMES = [
  "adapter-capability.schema.json",
  "adapter-error.schema.json",
  "adapter-usage.schema.json",
  "adapter-descriptor.schema.json",
] as const;

type SchemaName = (typeof SCHEMA_NAMES)[number];
type Validator = (document: unknown) => boolean;

interface AjvLike {
  validateSchema(schema: object): boolean;
  addSchema(schema: object): unknown;
  compile(schema: object): Validator;
}

/** Ajv ships a CommonJS default export; NodeNext needs the interop unwrapped. */
const Ajv = ((AjvModule as { default?: unknown }).default ?? AjvModule) as new (
  options: object,
) => AjvLike;

const compiled = new Map<SchemaName, Validator>();

beforeAll(() => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const schemas = new Map<SchemaName, unknown>();
  for (const name of SCHEMA_NAMES) {
    const schema: unknown = JSON.parse(
      readFileSync(new URL(`../../../spec/${name}`, import.meta.url), "utf8"),
    );
    expect(ajv.validateSchema(schema as object)).toBe(true);
    schemas.set(name, schema);
    ajv.addSchema(schema as object);
  }
  for (const name of SCHEMA_NAMES) {
    compiled.set(name, ajv.compile(schemas.get(name) as object));
  }
});

function validate(name: SchemaName, document: unknown): boolean {
  const validator = compiled.get(name);
  if (validator === undefined) throw new Error(`schema '${name}' was not compiled`);
  return validator(document);
}

describe("the corpus documents validate", () => {
  it("accepts all twelve descriptors and both templates", () => {
    for (const descriptor of corpus.descriptors) {
      expect(validate("adapter-descriptor.schema.json", descriptor)).toBe(true);
    }
    expect(validate("adapter-usage.schema.json", corpus.usageTemplate)).toBe(true);
    expect(validate("adapter-error.schema.json", corpus.errorTemplate)).toBe(true);
  });
});

describe.each(corpus.schemaNegativeCases)("schema negative $id", (testCase) => {
  it("is rejected by the schema it names", () => {
    const build = (): unknown => {
      if (testCase.schema === "adapter-descriptor.schema.json") {
        return clone(descriptorFor(corpus.schemaNegativeBase));
      }
      if (testCase.schema === "adapter-usage.schema.json") return clone(corpus.usageTemplate);
      if (testCase.schema === "adapter-error.schema.json") return clone(corpus.errorTemplate);
      throw new Error(`unknown schema '${testCase.schema}'`);
    };
    const document = applyMutations(build(), testCase.mutations);
    expect(validate(testCase.schema as SchemaName, document)).toBe(false);
  });
});

describe("documents this package constructs are schema-valid", () => {
  it("accepts a composed usage envelope", () => {
    const descriptor = descriptorFor("mock-full");
    const usage = composeUsage({
      descriptor,
      requestId: "req-baseline",
      providerRequestId: "mock-req-000001",
      trust: "provider-reported",
      finishReason: "stop",
      meters: { "provider-calls": 1, "input-units": 8, "output-units": 4, "transport-bytes": 64 },
      providerSpecific: corpus.budgetPolicyAllowedProviderMetrics.map((metric) => ({
        ...metric,
        amount: 3,
      })),
    });
    expect(validate("adapter-usage.schema.json", usage)).toBe(true);
    // adapter-semantics 7.1: the envelope is unable to carry money.
    expect(Object.hasOwn(usage, "currency")).toBe(false);
    expect(usage.quantities.map((quantity) => quantity.resource)).not.toContain(
      "money-nano-minor",
    );
  });

  it("accepts an envelope for every code in the closed taxonomy", () => {
    const descriptor = descriptorFor("mock-full");
    for (const row of corpus.errorTaxonomy) {
      const code = row.code as AdapterErrorCode;
      const envelope = normalizedAdapterError({
        descriptor,
        requestId: "req-baseline",
        attempt: 1,
        code,
        sideEffectClass: "none",
        message: `normalized ${code}`,
        denialReason: code === "GE_ADAPTER_POLICY_DENIED" ? "circuit-open" : null,
        rule: "none",
      });
      expect(validate("adapter-error.schema.json", envelope)).toBe(true);
      expect(envelope.boundary).toBe(row.boundary);
      expect(envelope.retryable).toBe(row.retryable);
      expect(envelope.effectDisposition).toBe(row.effectDisposition);
      expect(envelope.usageDisposition).toBe(row.usageDisposition);
    }
  });

  it("accepts every envelope the three adapters actually emit", async () => {
    const emitted = [];

    const mock = createMockAdapter({
      descriptor: descriptorFor("mock-full"),
      budgetPolicyAllowedProviderMetrics: corpus.budgetPolicyAllowedProviderMetrics,
      script: [{ fail: "GE_ADAPTER_TIMEOUT" }],
    });
    const mockOutcome = await mock.call(requestFrom());
    if (!mockOutcome.ok) emitted.push(mockOutcome.error);

    const http = createHttpAdapter({
      descriptor: descriptorFor("http-mock"),
      fetch: async () => ({
        status: 429,
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "2" : null) },
        body: null,
      }),
    });
    const httpOutcome = await http.call(
      requestFrom([
        {
          op: "replace",
          path: "/target",
          value: {
            scheme: "https",
            host: "gateway.invalid",
            port: 443,
            redirected: false,
            reauthorized: false,
          },
        },
      ]),
    );
    if (!httpOutcome.ok) emitted.push(httpOutcome.error);

    const shell = createShellAdapter({ descriptor: descriptorFor("shell-mock") });
    const shellOutcome = await shell.call(requestFrom());
    if (!shellOutcome.ok) emitted.push(shellOutcome.error);

    expect(emitted).toHaveLength(3);
    for (const envelope of emitted) {
      expect(validate("adapter-error.schema.json", envelope)).toBe(true);
      if (envelope.usage !== null) {
        expect(validate("adapter-usage.schema.json", envelope.usage)).toBe(true);
      }
    }
  });

  it("accepts a successful call's usage envelope", async () => {
    const mock = createMockAdapter({
      descriptor: descriptorFor("mock-full"),
      budgetPolicyAllowedProviderMetrics: corpus.budgetPolicyAllowedProviderMetrics,
    });
    const outcome = await mock.call(requestFrom());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(validate("adapter-usage.schema.json", outcome.value.usage)).toBe(true);
  });
});
