import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = dirname(here);
const CASE_PATH = join(here, "redaction.case.json");

// The complete D9-REDACTION-039 machine-contract manifest from
// redaction-semantics.md Section 1.1. Every entry is compiled under
// Ajv2020 { allErrors: true, strict: true } before any case executes.
const SCHEMA_NAMES = Object.freeze([
  "capture-source.schema.json",
  "capture-sink.schema.json",
  "redaction-rule.schema.json",
  "redaction-receipt.schema.json",
  "capture-policy.schema.json",
  "protected-value.schema.json",
  "protected-blob.schema.json",
  "protected-aad.schema.json",
  "payload-disposition.schema.json",
  "sink-guard-decision.schema.json",
  "protected-store-envelope.schema.json",
  "event-v1alpha2.schema.json",
  "checkpoint-v1alpha2.schema.json",
  "redaction-conformance.schema.json",
]);

const CORPUS_SCHEMA = "redaction-conformance.schema.json";

const REDACTION_TOKEN = "[REDACTED]";
const FORBIDDEN_POINTER_TOKENS = Object.freeze(["__proto__", "prototype", "constructor"]);

// redaction-semantics.md Section 1.2 row 1: "Authoritative; protect, never
// redact", reinforced by Section 2.2 ("Redacted data can never be
// authoritative") and Section 2.3 ("Redaction is allowed only for
// observational values").
const NEVER_REDACTABLE_SOURCE_CLASSES = Object.freeze([
  "bound-node-input",
  "checkpoint-state",
  "event-data",
  "graph-input",
  "graph-output",
  "node-output",
  "node-result",
  "run-result",
]);

// Section 2.3: encryption is never redaction, so the protected-store family
// cannot be the sink of an irreversible-transform receipt.
const NEVER_REDACTABLE_SINKS = Object.freeze([
  "protected-blob-final",
  "protected-blob-memory",
  "protected-blob-temporary",
]);

// Section 3.2 truth table. `receipt` is the required presence of
// `redactionReceipt` for the disposition.
const DISPOSITION_TRUTH_TABLE = Object.freeze({
  "metadata-only": { redacted: false, receipt: false },
  "protected-ref": { redacted: false, receipt: false },
  redacted: { redacted: true, receipt: true },
  "inline-unredacted": { redacted: false, receipt: false },
});

// Section 4.1 closed mode vocabulary, keyed by policy field.
const POLICY_MODE_VOCABULARY = Object.freeze({
  durableValues: ["protected", "inline-unredacted"],
  checkpointValues: ["protected", "inline-unredacted"],
  events: ["metadata-or-protected", "allow-redacted", "inline-unredacted"],
  errors: [
    "codes-only",
    "codes-and-sanitized-message",
    "redacted",
    "protected-evidence",
    "inline-unredacted",
  ],
  logs: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  traces: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  metrics: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  artifacts: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  prompts: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  responses: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  tools: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  mcp: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  plugins: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  isolationOutputs: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  database: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  exports: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  supportBundles: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  testArtifacts: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  identifiers: ["generated-opaque-only", "protected", "inline-unredacted"],
});

// Section 4.1 default stable profile modes. Declared here rather than read
// from the corpus so a corpus edit cannot silently redefine the baseline the
// Section 1.2 widening formula compares against.
const DEFAULT_POLICY_MODES = Object.freeze({
  durableValues: "protected",
  checkpointValues: "protected",
  events: "metadata-or-protected",
  artifacts: "off",
  errors: "codes-and-sanitized-message",
  logs: "metadata-only",
  traces: "off",
  metrics: "off",
  prompts: "off",
  responses: "off",
  tools: "off",
  mcp: "off",
  plugins: "off",
  isolationOutputs: "off",
  database: "off",
  exports: "off",
  supportBundles: "off",
  testArtifacts: "off",
  identifiers: "generated-opaque-only",
});

// Section 1.2/4.1: the disabled modes. `codes-only` means stable codes only,
// with no payload evidence in any form; the `deny` pseudo-control has no
// enabling mode at all.
const DISABLED_POLICY_MODES = Object.freeze(["off", "codes-only"]);

// Section 11 limit key per corpus mutation operator, plus the failure code the
// contract requires. Declared here rather than read from the corpus so a
// corpus edit cannot silently redefine the rule it is supposed to prove.
const LIMIT_OPERATORS = Object.freeze({
  "construct-value-depth": {
    limit: "maxValueDepth",
    code: "REDACTION_RECEIPT_INVALID",
    parameter: "depth",
    constructed: true,
  },
  "construct-value-node-count": {
    limit: "maxValueNodes",
    code: "REDACTION_RECEIPT_INVALID",
    parameter: "nodes",
    constructed: false,
  },
  "construct-container-count": {
    limit: "maxContainers",
    code: "REDACTION_RECEIPT_INVALID",
    parameter: "containers",
    constructed: false,
  },
  "construct-object-member-count": {
    limit: "maxObjectMembers",
    code: "REDACTION_RECEIPT_INVALID",
    parameter: "members",
    constructed: false,
  },
  "construct-protected-utf8-bytes": {
    limit: "maxProtectedValueUtf8Bytes",
    code: "PAYLOAD_PROTECTION_FAILED",
    parameter: "utf8Bytes",
    constructed: false,
  },
  "construct-transformed-utf8-bytes": {
    limit: "maxTransformedUtf8Bytes",
    code: "REDACTION_RECEIPT_INVALID",
    parameter: "utf8Bytes",
    constructed: false,
  },
  "construct-rule-pointer-count": {
    limit: "maxPointersPerRule",
    code: "REDACTION_POLICY_INVALID",
    parameter: "pointers",
    constructed: true,
  },
  "construct-pointer-token-count": {
    limit: "maxPointerTokens",
    code: "REDACTION_RECEIPT_INVALID",
    parameter: "tokens",
    constructed: true,
  },
  "construct-pointer-utf8-bytes": {
    limit: "maxPointerUtf8Bytes",
    code: "REDACTION_POLICY_INVALID",
    parameter: "utf8Bytes",
    constructed: true,
  },
  "construct-pointer-token-utf8-bytes": {
    limit: "maxPointerTokenUtf8Bytes",
    code: "REDACTION_RECEIPT_INVALID",
    parameter: "utf8Bytes",
    constructed: true,
  },
  "construct-ref-utf8-bytes": {
    limit: "maxRefUtf8Bytes",
    code: "PAYLOAD_PROTECTION_FAILED",
    parameter: "utf8Bytes",
    constructed: false,
  },
  "construct-diagnostic-utf8-bytes": {
    limit: "maxDiagnosticUtf8Bytes",
    code: "REDACTION_POLICY_INVALID",
    parameter: "utf8Bytes",
    constructed: false,
  },
});

const encoder = new TextEncoder();

function compareUnicodeCodePoints(left, right) {
  const a = Array.from(left, (item) => item.codePointAt(0));
  const b = Array.from(right, (item) => item.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function utf8ByteLength(value) {
  return encoder.encode(value).length;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/* -------------------------------------------------------------------------
 * RFC 6901 pointer oracle (redaction-semantics.md Section 3.3.1)
 * ---------------------------------------------------------------------- */

class TransformDenial extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.name = "TransformDenial";
    this.code = code;
    this.reason = reason;
  }
}

function deny(code, reason) {
  throw new TransformDenial(code, reason);
}

/** Step 2: decode one pointer into its exact reference tokens. */
export function decodePointer(pointer) {
  if (typeof pointer !== "string") deny("REDACTION_RECEIPT_INVALID", "pointer is not a string");
  if (pointer.length === 0) deny("REDACTION_RECEIPT_INVALID", "root pointer is not permitted");
  if (!pointer.startsWith("/")) deny("REDACTION_RECEIPT_INVALID", "pointer must start with '/'");
  const rawTokens = pointer.slice(1).split("/");
  const tokens = [];
  for (const rawToken of rawTokens) {
    let decoded = "";
    for (let index = 0; index < rawToken.length; index += 1) {
      const character = rawToken[index];
      if (character !== "~") {
        decoded += character;
        continue;
      }
      const next = rawToken[index + 1];
      if (next !== "0" && next !== "1") {
        deny("REDACTION_RECEIPT_INVALID", `invalid escape in token '${rawToken}'`);
      }
      decoded += next === "0" ? "~" : "/";
      index += 1;
    }
    const reEncoded = decoded.replaceAll("~", "~0").replaceAll("/", "~1");
    if (reEncoded !== rawToken) {
      deny("REDACTION_RECEIPT_INVALID", `token '${rawToken}' is not canonically escaped`);
    }
    if (FORBIDDEN_POINTER_TOKENS.includes(decoded)) {
      deny("REDACTION_RECEIPT_INVALID", `forbidden pointer token '${decoded}'`);
    }
    tokens.push(decoded);
  }
  return tokens;
}

function enforcePointerLimits(pointer, tokens, limits) {
  if (utf8ByteLength(pointer) > limits.maxPointerUtf8Bytes) {
    deny("REDACTION_POLICY_INVALID", "pointer exceeds maxPointerUtf8Bytes");
  }
  if (tokens.length > limits.maxPointerTokens) {
    deny("REDACTION_RECEIPT_INVALID", "pointer exceeds maxPointerTokens");
  }
  for (const token of tokens) {
    if (utf8ByteLength(token) > limits.maxPointerTokenUtf8Bytes) {
      deny("REDACTION_RECEIPT_INVALID", "pointer token exceeds maxPointerTokenUtf8Bytes");
    }
  }
}

/** Step 1: portable-JSON snapshot measurement plus key-collision rejection. */
function measureSnapshot(value, limits) {
  // The root value sits at depth 0, so a pointer with N reference tokens
  // addresses depth N. maxValueDepth therefore bounds both consistently.
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  let containers = 0;
  let members = 0;
  let maxDepth = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    maxDepth = Math.max(maxDepth, current.depth);
    if (Array.isArray(current.value)) {
      containers += 1;
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (isPlainObject(current.value)) {
      containers += 1;
      const keys = Object.keys(current.value);
      members += keys.length;
      const normalized = new Set();
      for (const key of keys) {
        const portable = String.fromCodePoint(...Array.from(key, (c) => c.codePointAt(0)));
        if (normalized.has(portable)) {
          deny("REDACTION_RECEIPT_INVALID", "object keys collide after portable normalization");
        }
        normalized.add(portable);
        stack.push({ value: current.value[key], depth: current.depth + 1 });
      }
    }
  }
  if (maxDepth > limits.maxValueDepth) deny("REDACTION_RECEIPT_INVALID", "value exceeds maxValueDepth");
  if (nodes > limits.maxValueNodes) deny("REDACTION_RECEIPT_INVALID", "value exceeds maxValueNodes");
  if (containers > limits.maxContainers) deny("REDACTION_RECEIPT_INVALID", "value exceeds maxContainers");
  if (members > limits.maxObjectMembers) {
    deny("REDACTION_RECEIPT_INVALID", "value exceeds maxObjectMembers");
  }
  return { nodes, containers, members, maxDepth };
}

/** Step 3/4: resolve one decoded token list against the immutable snapshot. */
function resolveTokens(snapshot, tokens) {
  let current = snapshot;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (Array.isArray(current)) {
      if (token !== "0" && !/^[1-9][0-9]*$/.test(token)) {
        deny("REDACTION_RECEIPT_INVALID", `array token '${token}' is not a canonical index`);
      }
      const parsed = Number(token);
      if (parsed >= current.length) {
        deny("REDACTION_RECEIPT_INVALID", `array index ${parsed} is out of range`);
      }
      current = current[parsed];
      continue;
    }
    if (isPlainObject(current)) {
      if (!Object.hasOwn(current, token)) {
        deny("REDACTION_RECEIPT_INVALID", `member '${token}' does not exist`);
      }
      current = current[token];
      continue;
    }
    deny("REDACTION_RECEIPT_INVALID", `token '${token}' addresses a non-container`);
  }
  return current;
}

function containerAt(root, tokens) {
  let current = root;
  for (const token of tokens.slice(0, -1)) {
    current = Array.isArray(current) ? current[Number(token)] : current[token];
  }
  return current;
}

function isAncestor(shorter, longer) {
  if (shorter.length >= longer.length) return false;
  return shorter.every((token, index) => token === longer[index]);
}

/**
 * The complete deterministic transform: one transformed snapshot plus its
 * canonical path list, or one structured denial. Never partial.
 */
export function redactionTransform(input, paths, replacementMode, limits) {
  try {
    if (!Array.isArray(paths) || paths.length === 0) {
      deny("REDACTION_RECEIPT_INVALID", "at least one pointer is required");
    }
    if (paths.length > limits.maxPointersPerRule) {
      deny("REDACTION_POLICY_INVALID", "rule exceeds maxPointersPerRule");
    }
    if (replacementMode !== "remove" && replacementMode !== "constant-token") {
      deny("REDACTION_RECEIPT_INVALID", `unknown replacement mode '${replacementMode}'`);
    }

    // Limit failure wins before missing-target, overlap, or mutation checks.
    const decoded = paths.map((pointer) => {
      const tokens = decodePointer(pointer);
      enforcePointerLimits(pointer, tokens, limits);
      return tokens;
    });
    const snapshot = clone(input);
    measureSnapshot(snapshot, limits);

    for (let index = 1; index < paths.length; index += 1) {
      if (compareUnicodeCodePoints(paths[index - 1], paths[index]) >= 0) {
        deny(
          "REDACTION_RECEIPT_INVALID",
          "pointers are not in strictly increasing code-point order",
        );
      }
    }
    for (let left = 0; left < decoded.length; left += 1) {
      for (let right = 0; right < decoded.length; right += 1) {
        if (left === right) continue;
        if (isAncestor(decoded[left], decoded[right])) {
          deny("REDACTION_RECEIPT_INVALID", "pointers form an ancestor/descendant pair");
        }
      }
    }

    for (const tokens of decoded) resolveTokens(snapshot, tokens);

    const resolvedKeys = decoded.map((tokens) => JSON.stringify(tokens));
    if (new Set(resolvedKeys).size !== resolvedKeys.length) {
      deny("REDACTION_RECEIPT_INVALID", "pointers resolve to duplicate locations");
    }

    if (replacementMode === "remove") {
      for (const tokens of decoded) {
        const parent = containerAt(snapshot, tokens);
        if (Array.isArray(parent)) {
          deny("REDACTION_RECEIPT_INVALID", "remove cannot delete an array element");
        }
      }
    }

    const ordered = decoded
      .map((tokens, index) => ({ tokens, pointer: paths[index] }))
      .sort((left, right) => {
        if (left.tokens.length !== right.tokens.length) {
          return right.tokens.length - left.tokens.length;
        }
        return compareUnicodeCodePoints(right.pointer, left.pointer);
      });

    for (const { tokens } of ordered) {
      const parent = containerAt(snapshot, tokens);
      const leaf = tokens[tokens.length - 1];
      if (Array.isArray(parent)) {
        parent[Number(leaf)] = REDACTION_TOKEN;
        continue;
      }
      if (replacementMode === "remove") {
        delete parent[leaf];
        continue;
      }
      parent[leaf] = REDACTION_TOKEN;
    }

    if (utf8ByteLength(JSON.stringify(snapshot)) > limits.maxTransformedUtf8Bytes) {
      deny("REDACTION_RECEIPT_INVALID", "transformed value exceeds maxTransformedUtf8Bytes");
    }

    return { valid: true, output: snapshot, canonicalPaths: [...paths] };
  } catch (error) {
    if (!(error instanceof TransformDenial)) throw error;
    return { valid: false, code: error.code, reason: error.reason };
  }
}

/* -------------------------------------------------------------------------
 * Semantic obligations delegated to the shared validator by Section 1.1
 * ---------------------------------------------------------------------- */

function assertReceiptSemantics(receipt, label) {
  assert.equal(
    receipt.count,
    receipt.paths.length,
    `${label} receipt count does not equal paths.length`,
  );
  for (let index = 1; index < receipt.paths.length; index += 1) {
    assert.ok(
      compareUnicodeCodePoints(receipt.paths[index - 1], receipt.paths[index]) < 0,
      `${label} receipt paths are not in strictly increasing code-point order`,
    );
  }
  for (const pointer of [...receipt.paths, receipt.fieldPath]) {
    assert.doesNotThrow(
      () => decodePointer(pointer),
      `${label} receipt pointer '${pointer}' is not a canonical RFC 6901 pointer`,
    );
  }
  assert.ok(
    !NEVER_REDACTABLE_SOURCE_CLASSES.includes(receipt.sourceClass),
    `${label} receipt redacts authoritative source class '${receipt.sourceClass}'`,
  );
  assert.ok(
    !NEVER_REDACTABLE_SINKS.includes(receipt.sink),
    `${label} receipt names protected-store sink '${receipt.sink}'`,
  );
}

function assertDispositionTruth(document, label) {
  if (!isPlainObject(document)) return 0;
  if (!Object.hasOwn(document, "payloadDisposition")) return 0;
  const row = DISPOSITION_TRUTH_TABLE[document.payloadDisposition];
  assert.ok(row !== undefined, `${label} uses unknown disposition '${document.payloadDisposition}'`);
  assert.equal(
    document.redacted,
    row.redacted,
    `${label} disposition '${document.payloadDisposition}' carries redacted=${document.redacted}`,
  );
  assert.equal(
    Object.hasOwn(document, "redactionReceipt"),
    row.receipt,
    `${label} receipt presence contradicts disposition '${document.payloadDisposition}'`,
  );
  if (row.receipt) assertReceiptSemantics(document.redactionReceipt, label);
  return 1;
}

function assertAadRelations(aad, label) {
  if (aad.recordKind === "event") {
    assert.ok(Object.hasOwn(aad, "eventId"), `${label} event AAD is missing eventId`);
    assert.ok(!Object.hasOwn(aad, "checkpointId"), `${label} event AAD carries checkpointId`);
  } else {
    assert.ok(Object.hasOwn(aad, "checkpointId"), `${label} checkpoint AAD is missing checkpointId`);
    assert.ok(!Object.hasOwn(aad, "eventId"), `${label} checkpoint AAD carries eventId`);
  }
  assert.ok(Object.hasOwn(aad, "sequence"), `${label} AAD is missing sequence`);
  assert.doesNotThrow(
    () => decodePointer(aad.fieldPath),
    `${label} AAD fieldPath is not a canonical RFC 6901 pointer`,
  );
}

function assertEnvelopeRelations(envelope, label) {
  const { aad, protectedValue } = envelope;
  for (const field of [
    "runId",
    "capturePolicyHash",
    "keyRefHash",
    "authorityBindingHash",
    "tenantScopeHash",
  ]) {
    assert.equal(envelope[field], aad[field], `${label} envelope/AAD ${field} differ`);
  }
  assert.equal(
    protectedValue.keyRefHash,
    aad.keyRefHash,
    `${label} reference and AAD keyRefHash differ`,
  );
  assert.equal(
    protectedValue.valueMac,
    aad.valueMac,
    `${label} reference and AAD valueMac differ`,
  );
  assertAadRelations(aad, label);
}

/** Section 6.1/6.2: every adjacent *Mac equals its reference valueMac. */
function assertAdjacentMacEquality(container, label) {
  let checked = 0;
  if (!isPlainObject(container)) return checked;
  for (const [key, value] of Object.entries(container)) {
    if (isPlainObject(value)
      && value.apiVersion === "graphengineering.reacher-z.github.io/protected-value/v1alpha1"
      && key.endsWith("Ref")) {
      const macKey = `${key.slice(0, -3)}Mac`;
      if (Object.hasOwn(container, macKey)) {
        assert.equal(
          container[macKey],
          value.valueMac,
          `${label} ${macKey} does not equal ${key}.valueMac`,
        );
        checked += 1;
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) checked += assertAdjacentMacEquality(item, label);
      continue;
    }
    if (isPlainObject(value)) checked += assertAdjacentMacEquality(value, label);
  }
  return checked;
}

/** Section 4.1: policy/rule consistency, evaluated against the sink table. */
function assertPolicyRuleConsistency(policy, sinkControls, sinkOrder, label) {
  let inlineSelected = false;
  for (const [field, modes] of Object.entries(POLICY_MODE_VOCABULARY)) {
    assert.ok(
      modes.includes(policy[field]),
      `${label} policy field '${field}' has unknown mode '${policy[field]}'`,
    );
    if (policy[field] === "inline-unredacted") inlineSelected = true;
  }
  assert.equal(
    Object.hasOwn(policy, "inlineRiskAuthorizationHash"),
    inlineSelected,
    `${label} inlineRiskAuthorizationHash presence does not match inline mode selection`,
  );
  assert.ok(
    Number.isInteger(policy.maxDiagnosticUtf8Bytes)
      && policy.maxDiagnosticUtf8Bytes >= 0
      && policy.maxDiagnosticUtf8Bytes <= 1024,
    `${label} maxDiagnosticUtf8Bytes is out of the 0..1024 range`,
  );

  const rules = policy.redactionRules;
  const seenSinks = new Set();
  let previousKey = null;
  for (const rule of rules) {
    assert.ok(sinkOrder.has(rule.sink), `${label} rule names unknown sink '${rule.sink}'`);
    assert.ok(!seenSinks.has(rule.sink), `${label} declares two rules for sink '${rule.sink}'`);
    seenSinks.add(rule.sink);
    assert.equal(
      rule.registryVersion,
      policy.ruleRegistryVersion,
      `${label} rule '${rule.ruleId}' registryVersion differs from the policy snapshot`,
    );
    assert.ok(rule.paths.length >= 1, `${label} rule '${rule.ruleId}' has no path`);
    for (let index = 1; index < rule.paths.length; index += 1) {
      assert.ok(
        compareUnicodeCodePoints(rule.paths[index - 1], rule.paths[index]) < 0,
        `${label} rule '${rule.ruleId}' paths are not in strictly increasing order`,
      );
    }
    for (const pointer of rule.paths) {
      assert.doesNotThrow(
        () => decodePointer(pointer),
        `${label} rule '${rule.ruleId}' pointer '${pointer}' is not canonical`,
      );
    }
    const key = [sinkOrder.get(rule.sink), rule.ruleId];
    if (previousKey !== null) {
      const ordered = previousKey[0] < key[0]
        || (previousKey[0] === key[0] && compareUnicodeCodePoints(previousKey[1], key[1]) < 0);
      assert.ok(ordered, `${label} rules are not ordered by sink enum order then ruleId`);
    }
    previousKey = key;

    const controls = sinkControls.get(rule.sink);
    const compatible = controls.some((control) =>
      policy[control] === "redacted" || policy[control] === "allow-redacted");
    assert.ok(
      compatible,
      `${label} rule for sink '${rule.sink}' has no control in redacted/allow-redacted mode`,
    );
  }

  for (const [field, mode] of Object.entries(policy)) {
    if (mode !== "redacted") continue;
    if (!Object.hasOwn(POLICY_MODE_VOCABULARY, field)) continue;
    const covered = rules.some((rule) => sinkControls.get(rule.sink)?.includes(field));
    assert.ok(covered, `${label} policy field '${field}' selects redacted with no matching rule`);
  }
}

/* -------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------- */

export async function validateRedactionFixture() {
  const fixture = JSON.parse(await readFile(CASE_PATH, "utf8"));
  const schemas = new Map();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const name of SCHEMA_NAMES) {
    const schema = JSON.parse(await readFile(join(specRoot, name), "utf8"));
    assert.equal(
      ajv.validateSchema(schema),
      true,
      `${name} is not a valid Draft 2020-12 schema: ${JSON.stringify(ajv.errors)}`,
    );
    schemas.set(name, schema);
    ajv.addSchema(schema);
  }
  const compiled = new Map(
    SCHEMA_NAMES.map((name) => [name, ajv.compile(schemas.get(name))]),
  );

  const validateCorpus = compiled.get(CORPUS_SCHEMA);
  assert.equal(
    validateCorpus(fixture),
    true,
    `redaction corpus is invalid: ${JSON.stringify(validateCorpus.errors)}`,
  );

  // --- honest-claim flags -------------------------------------------------
  assert.equal(
    fixture.contractStatus,
    "contract-only-native-implementation-required",
    "redaction corpus contractStatus drifted",
  );
  assert.equal(
    fixture.implementationClaim,
    false,
    "redaction corpus implementationClaim must be literally false",
  );

  // --- inventory and Cartesian completeness -------------------------------
  const sourceEnum = schemas.get("capture-source.schema.json").enum;
  const sinkEnum = schemas.get("capture-sink.schema.json").enum;
  assert.deepEqual(fixture.sourceInventory, sourceEnum, "sourceInventory drifted from capture-source");
  assert.deepEqual(fixture.sinkInventory, sinkEnum, "sinkInventory drifted from capture-sink");
  assert.equal(fixture.flowPolicy.sourceRuleCount, sourceEnum.length, "sourceRuleCount drifted");
  assert.equal(fixture.flowPolicy.sinkRuleCount, sinkEnum.length, "sinkRuleCount drifted");
  assert.equal(
    fixture.flowPolicy.cartesianProductCount,
    sourceEnum.length * sinkEnum.length,
    "cartesianProductCount is not the exact source x sink product",
  );

  const sourceRows = new Map(fixture.sensitiveFieldCases.map((item) => [item.sourceClass, item]));
  const sinkRows = new Map(fixture.sinkPolicyCases.map((item) => [item.sink, item]));
  for (const sourceClass of sourceEnum) {
    assert.ok(
      sourceRows.has(sourceClass),
      `source class '${sourceClass}' has no sensitiveFieldCases row`,
    );
  }
  for (const sink of sinkEnum) {
    assert.ok(sinkRows.has(sink), `sink class '${sink}' has no sinkPolicyCases row`);
  }
  assert.equal(sourceRows.size, sourceEnum.length, "sensitiveFieldCases contains an unknown source");
  assert.equal(sinkRows.size, sinkEnum.length, "sinkPolicyCases contains an unknown sink");
  for (const sourceClass of NEVER_REDACTABLE_SOURCE_CLASSES) {
    assert.ok(
      sourceEnum.includes(sourceClass),
      `never-redactable source class '${sourceClass}' is not in capture-source`,
    );
  }
  for (const sink of NEVER_REDACTABLE_SINKS) {
    assert.ok(sinkEnum.includes(sink), `never-redactable sink '${sink}' is not in capture-sink`);
  }

  // Globally unique case identifiers across every case-bearing section.
  const idSections = [
    "sinkPolicyCases",
    "flowCases",
    "policyEnablementCases",
    "wireCases",
    "pointerCases",
    "semanticCases",
    "guardCases",
    "normalizationCases",
    "storeBypassCases",
    "derivativeCases",
    "sensitiveFieldCases",
    "legacyCases",
  ];
  const globalIds = idSections.flatMap((section) => fixture[section].map((item) => item.id));
  assert.equal(
    new Set(globalIds).size,
    globalIds.length,
    "redaction corpus case identifiers are not globally unique",
  );

  // --- pointer oracle: execute every pointerCase --------------------------
  const limits = fixture.resourceLimits;
  for (const testCase of fixture.pointerCases) {
    const observed = redactionTransform(
      testCase.input,
      testCase.paths,
      testCase.replacementMode,
      limits,
    );
    if (testCase.expected.valid === false) {
      assert.equal(observed.valid, false, `${testCase.id} was accepted but must be denied`);
      assert.equal(observed.code, testCase.expected.code, `${testCase.id} denial code drifted`);
      continue;
    }
    assert.equal(
      observed.valid,
      true,
      `${testCase.id} was denied (${observed.code}: ${observed.reason})`,
    );
    assert.deepEqual(observed.output, testCase.expected.output, `${testCase.id} output drifted`);
    assert.deepEqual(
      observed.canonicalPaths,
      testCase.expected.canonicalPaths,
      `${testCase.id} canonical paths drifted`,
    );
    // The transform never mutates the caller's snapshot.
    assert.notEqual(observed.output, testCase.input, `${testCase.id} returned the input by reference`);
  }

  // --- wire cases: schema truth plus the disposition truth table ----------
  let dispositionChecks = 0;
  let macChecks = 0;
  let receiptChecks = 0;
  let policyChecks = 0;
  let aadChecks = 0;
  const sinkControls = new Map(
    fixture.sinkPolicyCases.map((item) => [item.sink, item.policyControls]),
  );
  const sinkOrder = new Map(sinkEnum.map((sink, index) => [sink, index]));

  for (const testCase of fixture.wireCases) {
    const validate = compiled.get(testCase.schema);
    assert.ok(validate !== undefined, `${testCase.id} names unknown schema '${testCase.schema}'`);
    const observed = validate(testCase.document);
    assert.equal(
      observed,
      testCase.valid,
      `${testCase.id} schema verdict drifted: ${JSON.stringify(validate.errors)}`,
    );
    if (testCase.valid === false) {
      assert.ok(
        typeof testCase.expectedCode === "string" && testCase.expectedCode.length > 0,
        `${testCase.id} is a negative case without an expected failure code`,
      );
      continue;
    }
    dispositionChecks += assertDispositionTruth(testCase.document, testCase.id);
    if (testCase.schema === "redaction-receipt.schema.json") {
      assertReceiptSemantics(testCase.document, testCase.id);
      receiptChecks += 1;
    }
    if (testCase.schema === "capture-policy.schema.json") {
      assertPolicyRuleConsistency(testCase.document, sinkControls, sinkOrder, testCase.id);
      policyChecks += 1;
    }
    if (testCase.schema === "protected-aad.schema.json") {
      assertAadRelations(testCase.document, testCase.id);
      aadChecks += 1;
    }
    if (testCase.schema === "protected-store-envelope.schema.json") {
      assertEnvelopeRelations(testCase.document, testCase.id);
      aadChecks += 1;
    }
    if (testCase.schema === "event-v1alpha2.schema.json") {
      macChecks += assertAdjacentMacEquality(testCase.document.data ?? {}, testCase.id);
    }
    if (testCase.schema === "checkpoint-v1alpha2.schema.json") {
      macChecks += assertAdjacentMacEquality(testCase.document, testCase.id);
    }
  }
  assert.ok(dispositionChecks > 0, "no wire case exercised the payload-disposition truth table");
  assert.ok(macChecks > 0, "no wire case exercised adjacent MAC equality");
  assert.ok(receiptChecks > 0, "no wire case exercised receipt semantics");
  assert.ok(policyChecks > 0, "no wire case exercised policy/rule consistency");
  assert.ok(aadChecks > 0, "no wire case exercised AAD relations");

  // --- total source x sink evaluation reproduced from the closed tables ---
  for (const flowCase of fixture.flowCases) {
    let outcome;
    if (!flowCase.knownSource || !flowCase.knownSink || !flowCase.knownControl) {
      outcome = "failed";
      assert.equal(
        flowCase.expected.code,
        "REDACTION_POLICY_INVALID",
        `${flowCase.id} unknown row must deny with REDACTION_POLICY_INVALID`,
      );
    } else {
      const sourceRow = sourceRows.get(flowCase.sourceClass);
      const sinkRow = sinkRows.get(flowCase.sink);
      assert.ok(sourceRow !== undefined, `${flowCase.id} names an unclassified source`);
      assert.ok(sinkRow !== undefined, `${flowCase.id} names an unclassified sink`);
      assert.ok(
        sinkRow.policyControls.includes(flowCase.policyControl),
        `${flowCase.id} control '${flowCase.policyControl}' is not owned by sink '${flowCase.sink}'`,
      );
      if (!flowCase.policyEnabled || sourceRow.policyControl === "deny") {
        outcome = "suppressed";
      } else if (sourceRow.defaultAction === "metadata-only-allowlist") {
        outcome = sinkRow.acceptsMetadata ? "metadata-only" : "suppressed";
      } else {
        outcome = sinkRow.acceptsProtected ? "protected-ref" : "suppressed";
      }
    }
    assert.equal(outcome, flowCase.expected.outcome, `${flowCase.id} flow outcome drifted`);
    assert.equal(
      flowCase.expected.writeAuthorized,
      outcome === "protected-ref" || outcome === "metadata-only" || outcome === "redacted",
      `${flowCase.id} writeAuthorized contradicts its outcome`,
    );
  }

  // --- Section 1.2 widening / Section 6.1 protected-evidence enablement ----
  // Recomputed from the closed tables above: `pairEnabled` is the Section 1.2
  // formula (default matrix, explicit widening over the union of the source
  // row's control and the sink row's controls, every control in that union
  // enabled), and `evidenceAuthorized` is the stricter Section 6.1 gate that
  // additionally requires `errors: "protected-evidence"` itself.
  for (const enablementCase of fixture.policyEnablementCases) {
    const sourceRow = sourceRows.get(enablementCase.sourceClass);
    const sinkRow = sinkRows.get(enablementCase.sink);
    assert.ok(sourceRow !== undefined, `${enablementCase.id} names an unclassified source`);
    assert.ok(sinkRow !== undefined, `${enablementCase.id} names an unclassified sink`);
    const modes = { ...DEFAULT_POLICY_MODES, ...enablementCase.policyOverrides };
    const controlUnion = [sourceRow.policyControl, ...sinkRow.policyControls];
    const widened = controlUnion.some(
      (control) => control !== "deny" && modes[control] !== DEFAULT_POLICY_MODES[control],
    );
    const controlEnabled = (control) =>
      control !== "deny" && !DISABLED_POLICY_MODES.includes(modes[control]);
    let pairEnabled;
    if ((!sinkRow.defaultEnabled || sourceRow.defaultAction === "off") && !widened) {
      pairEnabled = false;
    } else {
      pairEnabled = controlUnion.every(controlEnabled);
    }
    const evidenceAuthorized = modes.errors === "protected-evidence" && pairEnabled;
    assert.equal(
      pairEnabled,
      enablementCase.expected.pairEnabled,
      `${enablementCase.id} pairEnabled drifted`,
    );
    assert.equal(
      evidenceAuthorized,
      enablementCase.expected.evidenceAuthorized,
      `${enablementCase.id} evidenceAuthorized drifted`,
    );
    assert.equal(
      evidenceAuthorized ? "protected-ref" : "metadata-only",
      enablementCase.expected.nodeAttemptFailedDisposition,
      `${enablementCase.id} NodeAttemptFailed disposition drifted`,
    );
  }
  assert.ok(
    fixture.policyEnablementCases.some((item) => item.expected.evidenceAuthorized),
    "no policyEnablementCases entry authorizes evidence, so the lever is unwitnessed",
  );
  assert.ok(
    fixture.policyEnablementCases.some(
      (item) => item.policyOverrides.errors === "codes-only" && !item.expected.pairEnabled,
    ),
    "no policyEnablementCases entry pins codes-only as a disabled mode",
  );

  // --- semantic case structure plus the executable subset -----------------
  const pairs = new Map();
  for (const item of fixture.semanticCases) {
    const bucket = pairs.get(item.pairId) ?? [];
    bucket.push(item);
    pairs.set(item.pairId, bucket);
  }
  for (const [pairId, bucket] of pairs) {
    assert.equal(bucket.length, 2, `${pairId} is not a positive/hostile pair`);
    const polarities = bucket.map((item) => item.polarity).sort();
    assert.deepEqual(polarities, ["hostile", "positive"], `${pairId} polarity set drifted`);
    assert.equal(new Set(bucket.map((item) => item.rule)).size, 1, `${pairId} spans two rules`);
    for (const item of bucket) {
      assert.equal(item.expected.rawWrites, 0, `${item.id} permits a raw write`);
      assert.equal(item.expected.executorCalls, 0, `${item.id} permits an executor call`);
      assert.equal(item.expected.dependentReleases, 0, `${item.id} releases a dependent`);
      assert.equal(
        item.expected.valid,
        item.polarity === "positive",
        `${item.id} polarity contradicts expected validity`,
      );
      if (item.polarity === "hostile") {
        assert.equal(item.expected.sinkWrites, 0, `${item.id} lets a denied write reach a sink`);
        assert.ok(
          typeof item.expected.code === "string" && item.expected.code.length > 0,
          `${item.id} is hostile without a stable failure code`,
        );
      } else {
        assert.ok(
          item.expected.sinkWrites === 0 || item.expected.sinkWrites === 1,
          `${item.id} claims more than one guarded sink write`,
        );
      }
      const section = fixture[item.baseSection];
      if (Array.isArray(section)) {
        assert.ok(
          section.some((base) => base.id === item.baseCaseId),
          `${item.id} names missing base case '${item.baseCaseId}'`,
        );
      }
    }
  }

  // Executable subset 1: Section 11 limits.
  let limitCasesExecuted = 0;
  for (const item of fixture.semanticCases) {
    const rule = LIMIT_OPERATORS[item.mutation.operator];
    if (rule === undefined) continue;
    const parameter = item.mutation.parameters.find((entry) => entry.name === rule.parameter);
    assert.ok(parameter !== undefined, `${item.id} is missing parameter '${rule.parameter}'`);
    const bound = limits[rule.limit];
    const withinLimit = parameter.value <= bound;
    assert.equal(withinLimit, item.expected.valid, `${item.id} limit verdict drifted`);
    if (!withinLimit) {
      assert.equal(item.expected.code, rule.code, `${item.id} limit failure code drifted`);
    }
    if (rule.constructed) {
      const observed = executeConstructedLimit(item.mutation.operator, parameter.value, limits);
      assert.equal(observed.valid, item.expected.valid, `${item.id} constructed limit verdict drifted`);
      if (!observed.valid) {
        assert.equal(observed.code, rule.code, `${item.id} constructed limit code drifted`);
      }
    }
    limitCasesExecuted += 1;
  }
  assert.equal(limitCasesExecuted, 24, "the Section 11 limit pairs are no longer fully executed");

  // Executable subset 2: the two pointer-grounded semantic cases.
  const prototypePositive = fixture.pointerCases.find((item) => item.id === "pointer-empty-object-key");
  const prototypeHostile = fixture.pointerCases
    .find((item) => item.id === "pointer-constructor-prototype-rejected");
  assert.ok(prototypePositive !== undefined && prototypeHostile !== undefined,
    "the prototype-segment semantic pair lost its pointer base cases");
  assert.equal(
    redactionTransform(prototypePositive.input, prototypePositive.paths, "constant-token", limits).valid,
    true,
    "own empty-key resolution regressed",
  );
  assert.equal(
    redactionTransform(prototypeHostile.input, prototypeHostile.paths, "constant-token", limits).code,
    "REDACTION_RECEIPT_INVALID",
    "forbidden prototype segment resolution regressed",
  );

  // Executable subset 3: the corpus inventory/Cartesian mutation pair, run as
  // a real deletion against a corpus copy rather than asserted in prose.
  for (const [section, key, victim] of [
    ["sensitiveFieldCases", "sourceClass", "runtime-generated-identifier"],
    ["sinkPolicyCases", "sink", "release-evidence"],
  ]) {
    const mutated = clone(fixture);
    mutated[section] = mutated[section].filter((item) => item[key] !== victim);
    const domain = section === "sensitiveFieldCases" ? sourceEnum : sinkEnum;
    const present = new Set(mutated[section].map((item) => item[key]));
    assert.ok(
      domain.some((value) => !present.has(value)),
      `removing '${victim}' from ${section} did not break completeness`,
    );
  }

  return {
    contractStatus: fixture.contractStatus,
    implementationClaim: fixture.implementationClaim,
    schemas: SCHEMA_NAMES.length,
    sourceClasses: sourceEnum.length,
    sinkClasses: sinkEnum.length,
    cartesianPairs: fixture.flowPolicy.cartesianProductCount,
    pointerCases: fixture.pointerCases.length,
    wireCases: fixture.wireCases.length,
    flowCases: fixture.flowCases.length,
    policyEnablementCases: fixture.policyEnablementCases.length,
    semanticPairs: pairs.size,
    executedSemanticCases: limitCasesExecuted + 2,
    dispositionChecks,
    receiptChecks,
    policyChecks,
    aadChecks,
    macChecks,
  };
}

/** Build the nested document addressed by one exact token chain. */
function chainDocument(tokens) {
  let node = "synthetic-sensitive-value";
  for (let index = tokens.length - 1; index >= 0; index -= 1) node = { [tokens[index]]: node };
  return node;
}

function encodeChain(tokens) {
  return tokens.map((token) => `/${token.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

/** Segment one pointer into tokens whose encoded form is exactly `target` bytes. */
function tokensOfPointerBytes(target) {
  const tokens = [];
  let remaining = target;
  while (remaining > 128) {
    tokens.push("a".repeat(127));
    remaining -= 128;
  }
  tokens.push("a".repeat(remaining - 1));
  return tokens;
}

function executeConstructedLimit(operator, value, limits) {
  if (operator === "construct-value-depth") {
    // A shallow pointer isolates the depth bound from the pointer bounds.
    let node = "synthetic-sensitive-value";
    for (let index = 0; index < value; index += 1) node = { nested: node };
    return redactionTransform(node, ["/nested"], "constant-token", limits);
  }
  if (operator === "construct-rule-pointer-count") {
    const input = {};
    const paths = [];
    for (let index = 0; index < value; index += 1) {
      const key = `f${String(index).padStart(6, "0")}`;
      input[key] = "synthetic-sensitive-value";
      paths.push(`/${key}`);
    }
    paths.sort(compareUnicodeCodePoints);
    return redactionTransform(input, paths, "constant-token", limits);
  }
  if (operator === "construct-pointer-token-count") {
    const tokens = Array.from({ length: value }, () => "n");
    return redactionTransform(
      chainDocument(tokens),
      [encodeChain(tokens)],
      "constant-token",
      limits,
    );
  }
  if (operator === "construct-pointer-utf8-bytes") {
    const tokens = tokensOfPointerBytes(value);
    return redactionTransform(
      chainDocument(tokens),
      [encodeChain(tokens)],
      "constant-token",
      limits,
    );
  }
  if (operator === "construct-pointer-token-utf8-bytes") {
    const tokens = ["a".repeat(value)];
    return redactionTransform(
      chainDocument(tokens),
      [encodeChain(tokens)],
      "constant-token",
      limits,
    );
  }
  throw new Error(`no constructed execution for operator '${operator}'`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await validateRedactionFixture();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
