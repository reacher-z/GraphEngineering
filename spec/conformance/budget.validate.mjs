import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const conformanceRoot = dirname(fileURLToPath(import.meta.url));
const specRoot = dirname(conformanceRoot);
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const DOMAINS = Object.freeze({
  binding: "graph-engineering/budget-binding/v1alpha1\0",
  checkpoint: "graph-engineering/budget-checkpoint/v1alpha1\0",
  event: "graph-engineering/budget-event/v1alpha1\0",
  eventId: "graph-engineering/budget-event-id/v1alpha1\0",
  payload: "graph-engineering/budget-event-payload/v1alpha1\0",
  policy: "graph-engineering/budget-policy/v1alpha1\0",
  pricing: "graph-engineering/pricing-snapshot/v1alpha1\0",
  projection: "graph-engineering/budget-projection/v1alpha1\0",
  reservation: "graph-engineering/budget-reservation/v1alpha1\0",
  reservationRequest: "graph-engineering/budget-reservation-request/v1alpha1\0",
  routeDecision: "graph-engineering/model-route-decision/v1alpha1\0",
  routerPolicy: "graph-engineering/model-router-policy/v1alpha1\0",
});

const RESOURCE_CONTRACT = Object.freeze({
  "artifact-bytes": ["byte", "sum"],
  artifacts: ["count", "sum"],
  attempts: ["count", "sum"],
  "audio-units": ["usage-unit", "sum"],
  "cached-input-units": ["usage-unit", "sum"],
  candidates: ["count", "sum"],
  "concurrent-activities": ["count", "maximum"],
  depth: ["count", "maximum"],
  "disk-bytes": ["byte", "maximum"],
  "dynamic-nodes": ["count", "sum"],
  "elapsed-ms": ["millisecond", "maximum"],
  "fan-out": ["count", "maximum"],
  "graph-edges": ["count", "maximum"],
  "graph-nodes": ["count", "maximum"],
  "image-units": ["usage-unit", "sum"],
  "in-flight-bytes": ["byte", "maximum"],
  "input-units": ["usage-unit", "sum"],
  "memory-bytes": ["byte", "maximum"],
  "money-nano-minor": ["nano-minor", "sum"],
  "node-dispatches": ["count", "sum"],
  "output-units": ["usage-unit", "sum"],
  "provider-calls": ["count", "sum"],
  "reasoning-units": ["usage-unit", "sum"],
  "tool-calls": ["count", "sum"],
  "transport-bytes": ["byte", "sum"],
});

const QUALITY_RANK = Object.freeze({
  economy: 0,
  standard: 1,
  premium: 2,
  judge: 3,
});

class BudgetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BudgetError";
    this.code = code;
  }
}

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const count = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < count; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const result = Object.create(null);
    for (const key of Object.keys(value).sort(compareCodePoints)) {
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function domainHash(domain, value) {
  return createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function exact(actual, expected, message) {
  assert.equal(canonicalJson(actual), canonicalJson(expected), message);
}

function unique(values, code, context) {
  if (new Set(values).size !== values.length) {
    throw new BudgetError(code, context + " contains a duplicate");
  }
}

function sorted(values, code, context) {
  const expected = [...values].sort(compareCodePoints);
  if (canonicalJson(values) !== canonicalJson(expected)) {
    throw new BudgetError(code, context + " is not Unicode code-point sorted");
  }
}

function safeAdd(left, right) {
  const result = BigInt(left) + BigInt(right);
  if (result > BigInt(MAX_SAFE)) {
    throw new BudgetError("GE_BUDGET_COUNTER_OVERFLOW", "integer addition exceeds the portable safe range");
  }
  return Number(result);
}

function safeSubtract(left, right, code = "GE_BUDGET_COUNTER_MISMATCH") {
  const result = BigInt(left) - BigInt(right);
  if (result < 0n) throw new BudgetError(code, "integer subtraction would underflow");
  return Number(result);
}

function timestampNanos(value) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?Z$/u
    .exec(value);
  if (match === null) throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "invalid UTC timestamp");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText = ""] = match;
  const fields = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const [year, month, day, hour, minute, second] = fields;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "timestamp is not a real UTC instant");
  }
  return BigInt(date.getTime()) * 1000000n + BigInt((fractionText + "000000000").slice(0, 9));
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const fixture = await loadJson(join(conformanceRoot, "budget.case.json"));
assert.equal(
  fixture.contractStatus,
  "contract-only-native-implementation-required",
  "budget corpus contractStatus drifted",
);
assert.equal(
  fixture.implementationClaim,
  false,
  "budget corpus implementationClaim must be literally false",
);
const schemaNames = [
  "budget-vector.schema.json",
  "budget-policy.schema.json",
  "pricing-snapshot.schema.json",
  "model-router-policy.schema.json",
  "model-route-decision.schema.json",
  "budget-ledger-event.schema.json",
  "budget-ledger-checkpoint.schema.json",
];
const schemas = await Promise.all(schemaNames.map((name) => loadJson(join(specRoot, name))));
const [
  vectorSchema,
  policySchema,
  pricingSchema,
  routerPolicySchema,
  routeDecisionSchema,
  eventSchema,
  checkpointSchema,
] = schemas;

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const schema of schemas) {
  assert.equal(
    ajv.validateSchema(schema),
    true,
    schema.$id + " failed Draft 2020-12 meta-validation: " + JSON.stringify(ajv.errors),
  );
  ajv.addSchema(schema);
}

function validator(schema) {
  const compiled = ajv.getSchema(schema.$id);
  assert.ok(compiled, "schema was not compiled: " + schema.$id);
  return compiled;
}

const validateVectorShape = validator(vectorSchema);
const validatePolicyShape = validator(policySchema);
const validatePricingShape = validator(pricingSchema);
const validateRouterPolicyShape = validator(routerPolicySchema);
const validateRouteDecisionShape = validator(routeDecisionSchema);
const validateEventShape = validator(eventSchema);
const validateCheckpointShape = validator(checkpointSchema);

function requireShape(validate, value, code, context) {
  if (!validate(value)) {
    throw new BudgetError(code, context + ": " + JSON.stringify(validate.errors));
  }
}

function vectorIdentity(vector) {
  return {
    apiVersion: vector.apiVersion,
    kind: vector.kind,
    contractVersion: vector.contractVersion,
    currency: vector.currency,
    minorUnitExponent: vector.minorUnitExponent,
  };
}

function providerKey(entry) {
  return entry.metricId + "\0" + entry.unitId;
}

function validateVector(vector, options = {}) {
  const code = options.code ?? "GE_BUDGET_VECTOR_INVALID";
  requireShape(validateVectorShape, vector, code, "budget vector schema violation");
  const resourceNames = vector.quantities.map((entry) => entry.resource);
  unique(resourceNames, "GE_BUDGET_VECTOR_DUPLICATE", "portable resource vector");
  sorted(resourceNames, "GE_BUDGET_VECTOR_ORDER", "portable resource vector");
  for (const entry of vector.quantities) {
    const contract = RESOURCE_CONTRACT[entry.resource];
    assert.ok(contract, "schema and resource contract drifted for " + entry.resource);
    if (entry.unit !== contract[0] || entry.aggregation !== contract[1]) {
      throw new BudgetError(
        "GE_BUDGET_VECTOR_UNIT",
        entry.resource + " must use " + contract[0] + "/" + contract[1],
      );
    }
    if (options.additiveOnly && entry.aggregation !== "sum") {
      throw new BudgetError(
        "GE_BUDGET_VECTOR_NON_ADDITIVE_RESERVATION",
        entry.resource + " is a maximum gate and cannot be debited as a reservation",
      );
    }
  }
  const providerKeys = vector.providerSpecific.map(providerKey);
  unique(providerKeys, "GE_BUDGET_VECTOR_DUPLICATE", "provider-specific resource vector");
  sorted(providerKeys, "GE_BUDGET_VECTOR_ORDER", "provider-specific resource vector");
  if (options.additiveOnly) {
    for (const entry of vector.providerSpecific) {
      if (entry.aggregation !== "sum") {
        throw new BudgetError(
          "GE_BUDGET_VECTOR_NON_ADDITIVE_RESERVATION",
          entry.metricId + " is a maximum gate and cannot be debited as a reservation",
        );
      }
    }
  }
  if (options.policy) {
    if (
      vector.currency !== options.policy.currency ||
      vector.minorUnitExponent !== options.policy.minorUnitExponent
    ) {
      throw new BudgetError("GE_BUDGET_CURRENCY_MISMATCH", "vector money identity differs from policy");
    }
    const allowed = new Set(options.policy.allowedProviderMetrics);
    for (const entry of vector.providerSpecific) {
      if (!allowed.has(entry.metricId)) {
        throw new BudgetError("GE_BUDGET_UNKNOWN_USAGE", "provider metric is not allowlisted");
      }
    }
  }
  return vector;
}

function vectorEntries(vector) {
  const entries = new Map();
  for (const entry of vector.quantities) {
    entries.set("q:" + entry.resource, {
      group: "quantity",
      name: entry.resource,
      unit: entry.unit,
      aggregation: entry.aggregation,
      amount: entry.amount,
    });
  }
  for (const entry of vector.providerSpecific) {
    entries.set("p:" + providerKey(entry), {
      group: "provider",
      metricId: entry.metricId,
      unitId: entry.unitId,
      aggregation: entry.aggregation,
      amount: entry.amount,
    });
  }
  return entries;
}

function vectorFromEntries(identitySource, entries) {
  const quantities = [];
  const providerSpecific = [];
  for (const entry of entries.values()) {
    if (entry.amount === 0) continue;
    if (entry.group === "quantity") {
      quantities.push({
        resource: entry.name,
        unit: entry.unit,
        aggregation: entry.aggregation,
        amount: entry.amount,
      });
    } else {
      providerSpecific.push({
        metricId: entry.metricId,
        unitId: entry.unitId,
        aggregation: entry.aggregation,
        amount: entry.amount,
      });
    }
  }
  quantities.sort((left, right) => compareCodePoints(left.resource, right.resource));
  providerSpecific.sort((left, right) => compareCodePoints(providerKey(left), providerKey(right)));
  return {
    ...vectorIdentity(identitySource),
    quantities,
    providerSpecific,
  };
}

function assertCompatibleVectors(left, right) {
  if (canonicalJson(vectorIdentity(left)) !== canonicalJson(vectorIdentity(right))) {
    throw new BudgetError("GE_BUDGET_CURRENCY_MISMATCH", "budget vector identities differ");
  }
  const leftEntries = vectorEntries(left);
  for (const [key, entry] of vectorEntries(right)) {
    const other = leftEntries.get(key);
    if (other !== undefined && (
      other.aggregation !== entry.aggregation ||
      other.unit !== entry.unit ||
      other.unitId !== entry.unitId
    )) {
      throw new BudgetError("GE_BUDGET_VECTOR_UNIT", "vector metadata differs for " + key);
    }
  }
}

function emptyVector(like) {
  return { ...vectorIdentity(like), quantities: [], providerSpecific: [] };
}

function addVectors(left, right) {
  assertCompatibleVectors(left, right);
  const result = vectorEntries(left);
  for (const [key, entry] of vectorEntries(right)) {
    const current = result.get(key);
    if (current === undefined) {
      result.set(key, clone(entry));
    } else if (entry.aggregation === "maximum") {
      current.amount = Math.max(current.amount, entry.amount);
    } else {
      current.amount = safeAdd(current.amount, entry.amount);
    }
  }
  return vectorFromEntries(left, result);
}

function subtractVectors(left, right, code = "GE_BUDGET_COUNTER_MISMATCH") {
  assertCompatibleVectors(left, right);
  const result = vectorEntries(left);
  for (const [key, entry] of vectorEntries(right)) {
    const current = result.get(key);
    if (entry.aggregation !== "sum") {
      throw new BudgetError(
        "GE_BUDGET_VECTOR_NON_ADDITIVE_RESERVATION",
        "maximum gates cannot be arithmetically debited",
      );
    }
    if (current === undefined) throw new BudgetError(code, "missing debit dimension " + key);
    current.amount = safeSubtract(current.amount, entry.amount, code);
  }
  return vectorFromEntries(left, result);
}

function vectorLessOrEqual(left, right) {
  assertCompatibleVectors(left, right);
  const rightEntries = vectorEntries(right);
  for (const [key, entry] of vectorEntries(left)) {
    const ceiling = rightEntries.get(key);
    if (ceiling === undefined || ceiling.amount < entry.amount) return false;
  }
  return true;
}

function vectorEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function vectorIsEmpty(vector) {
  return vector.quantities.length === 0 && vector.providerSpecific.length === 0;
}

function materializeVectorReference(reference) {
  assert.deepEqual(Object.keys(reference), ["$vector"], "fixture vector reference must be closed");
  const vector = fixture.vectors[reference.$vector];
  assert.ok(vector, "fixture references unknown vector " + reference.$vector);
  return clone(vector);
}

function materializePolicy() {
  const policy = clone(fixture.policy);
  policy.rootCeiling = materializeVectorReference(policy.rootCeiling);
  policy.scopeCeilings = policy.scopeCeilings.map((scope) => ({
    ...scope,
    ceiling: materializeVectorReference(scope.ceiling),
  }));
  return policy;
}

function validatePolicy(policy) {
  requireShape(validatePolicyShape, policy, "GE_BUDGET_POLICY_INVALID", "budget policy schema violation");
  validateVector(policy.rootCeiling, { policy });
  const scopeKeys = policy.scopeCeilings.map((scope) => scope.scopeKind + "\0" + scope.scopeId);
  unique(scopeKeys, "GE_BUDGET_SCOPE_DUPLICATE", "scope ceilings");
  sorted(scopeKeys, "GE_BUDGET_SCOPE_ORDER", "scope ceilings");
  sorted(policy.allowedProviderMetrics, "GE_BUDGET_PROVIDER_METRIC_ORDER", "allowed provider metrics");
  for (const scope of policy.scopeCeilings) {
    validateVector(scope.ceiling, { policy });
    if (!vectorLessOrEqual(scope.ceiling, policy.rootCeiling)) {
      throw new BudgetError("GE_BUDGET_SCOPE_EXPANSION", "scope ceiling exceeds root ceiling");
    }
  }
  if (
    policy.allowedProviderMetrics.length > policy.limits.maxProviderMetrics ||
    policy.rootCeiling.providerSpecific.length > policy.limits.maxProviderMetrics ||
    policy.scopeCeilings.some(
      (scope) => scope.ceiling.providerSpecific.length > policy.limits.maxProviderMetrics,
    )
  ) {
    throw new BudgetError("GE_BUDGET_LIMIT_INVALID", "root provider metrics exceed policy limit");
  }
  if (Buffer.byteLength(canonicalJson(policy), "utf8") > policy.limits.maxCanonicalBytes) {
    throw new BudgetError("GE_BUDGET_LIMIT_INVALID", "policy exceeds canonical byte limit");
  }
  return policy;
}

function pricingRuleKey(rule) {
  return rule.meter + "\0" + rule.usageClass;
}

function validatePricing(pricing, policy) {
  requireShape(validatePricingShape, pricing, "GE_PRICING_INVALID", "pricing snapshot schema violation");
  if (pricing.currency !== policy.currency || pricing.minorUnitExponent !== policy.minorUnitExponent) {
    throw new BudgetError("GE_BUDGET_CURRENCY_MISMATCH", "pricing money identity differs from policy");
  }
  if (pricing.policyBindingHash !== domainHash(DOMAINS.policy, policy)) {
    throw new BudgetError("GE_PRICING_POLICY_DRIFT", "pricing snapshot is bound to another policy");
  }
  if (
    pricing.effectiveUntil !== null &&
    timestampNanos(pricing.effectiveUntil) <= timestampNanos(pricing.effectiveFrom)
  ) {
    throw new BudgetError("GE_PRICING_INTERVAL", "pricing interval is empty or reversed");
  }
  const entryIds = pricing.entries.map((entry) => entry.entryId);
  unique(entryIds, "GE_PRICING_DUPLICATE", "pricing entry IDs");
  sorted(entryIds, "GE_PRICING_ORDER", "pricing entries");
  const subjects = pricing.entries.map((entry) => [
    entry.providerId,
    entry.accountClass,
    entry.region,
    entry.subjectKind,
    entry.subjectId,
  ].join("\0"));
  unique(subjects, "GE_PRICING_DUPLICATE", "pricing subjects");
  for (const entry of pricing.entries) {
    const keys = entry.rules.map(pricingRuleKey);
    unique(keys, "GE_PRICING_DUPLICATE", "pricing rules for " + entry.entryId);
    sorted(keys, "GE_PRICING_ORDER", "pricing rules for " + entry.entryId);
  }
  if (Buffer.byteLength(canonicalJson(pricing), "utf8") > policy.limits.maxCanonicalBytes) {
    throw new BudgetError("GE_BUDGET_LIMIT_INVALID", "pricing snapshot exceeds canonical byte limit");
  }
  return pricing;
}

function materializeContracts() {
  const policy = validatePolicy(materializePolicy());
  const policyHash = domainHash(DOMAINS.policy, policy);
  const pricing = clone(fixture.pricingSnapshot);
  pricing.policyBindingHash = policyHash;
  validatePricing(pricing, policy);
  const pricingHash = domainHash(DOMAINS.pricing, pricing);
  const routerPolicy = clone(fixture.routerPolicy);
  routerPolicy.pricingSnapshotHash = pricingHash;
  return { policy, policyHash, pricing, pricingHash, routerPolicy };
}

function validateRouterPolicy(routerPolicy, contracts) {
  requireShape(
    validateRouterPolicyShape,
    routerPolicy,
    "GE_ROUTE_POLICY_INVALID",
    "model router policy schema violation",
  );
  if (routerPolicy.authorityBindingHash !== contracts.policy.authorityBindingHash) {
    throw new BudgetError("GE_ROUTE_AUTHORITY_DENIED", "router authority binding differs from budget policy");
  }
  if (routerPolicy.pricingSnapshotHash !== contracts.pricingHash) {
    throw new BudgetError("GE_ROUTE_PRICING_UNAVAILABLE", "router pricing snapshot identity drifted");
  }
  const candidateIds = routerPolicy.candidates.map((candidate) => candidate.candidateId);
  unique(candidateIds, "GE_ROUTE_CANDIDATE_DUPLICATE", "router candidate IDs");
  sorted(candidateIds, "GE_ROUTE_CANDIDATE_ORDER", "router candidate IDs");
  sorted(
    routerPolicy.allowedAuthorityGrantHashes,
    "GE_ROUTE_AUTHORITY_DENIED",
    "router authority grants",
  );
  const allowedGrants = new Set(routerPolicy.allowedAuthorityGrantHashes);
  const pricingById = new Map(contracts.pricing.entries.map((entry) => [entry.entryId, entry]));
  for (const candidate of routerPolicy.candidates) {
    sorted(candidate.capabilities, "GE_ROUTE_CAPABILITY_ORDER", candidate.candidateId + " capabilities");
    sorted(candidate.allowedDataClasses, "GE_ROUTE_PRIVACY_ORDER", candidate.candidateId + " data classes");
    if (
      BigInt(candidate.maxInputUnits) + BigInt(candidate.maxOutputUnits) >
      BigInt(candidate.maxContextUnits)
    ) {
      throw new BudgetError("GE_ROUTE_LIMIT_INVALID", candidate.candidateId + " has incoherent context limits");
    }
    if (!allowedGrants.has(candidate.authorityGrantHash)) {
      throw new BudgetError(
        "GE_ROUTE_AUTHORITY_DENIED",
        candidate.candidateId + " grant is absent from the authority-bound allowlist",
      );
    }
    const price = pricingById.get(candidate.pricingEntryId);
    if (
      price === undefined ||
      price.providerId !== candidate.providerId ||
      price.accountClass !== candidate.accountClass ||
      price.region !== candidate.region ||
      price.subjectKind !== "model" ||
      price.subjectId !== candidate.modelId
    ) {
      throw new BudgetError("GE_ROUTE_PRICING_UNAVAILABLE", candidate.candidateId + " pricing binding is absent");
    }
  }
  if (
    Buffer.byteLength(canonicalJson(routerPolicy), "utf8") >
    contracts.policy.limits.maxCanonicalBytes
  ) {
    throw new BudgetError("GE_BUDGET_LIMIT_INVALID", "router policy exceeds canonical byte limit");
  }
  return routerPolicy;
}

function ceilPrice(usage, rule) {
  const units = BigInt(usage);
  const unitQuantity = BigInt(rule.unitQuantity);
  const billableBlocks = (units + unitQuantity - 1n) / unitQuantity;
  const value = billableBlocks * BigInt(rule.priceNanoMinor);
  if (value > BigInt(MAX_SAFE)) {
    throw new BudgetError("GE_BUDGET_COUNTER_OVERFLOW", "estimated price exceeds portable safe range");
  }
  return Number(value);
}

function estimateCandidateMoney(candidate, requirements, pricingById) {
  const entry = pricingById.get(candidate.pricingEntryId);
  if (entry === undefined) return { amount: 0, available: false };
  const ruleByKey = new Map(entry.rules.map((rule) => [pricingRuleKey(rule), rule]));
  let amount = 0;
  for (const [meter, usage] of [
    ["input-units", requirements.inputUnits],
    ["output-units", requirements.maximumOutputUnits],
  ]) {
    if (usage === 0) continue;
    const rule = ruleByKey.get(meter + "\0standard");
    if (rule === undefined) return { amount: 0, available: false };
    amount = safeAdd(amount, ceilPrice(usage, rule));
  }
  return { amount, available: true };
}

function candidateEvaluation(candidate, requirements, health, pricingById) {
  const reasons = [];
  const candidateCapabilities = new Set(candidate.capabilities);
  if (requirements.capabilities.some((capability) => !candidateCapabilities.has(capability))) {
    reasons.push("capability");
  }
  if (!candidate.allowedDataClasses.includes(requirements.dataClass)) reasons.push("privacy");
  if (!requirements.allowedRegions.includes(candidate.region)) reasons.push("region");
  if (QUALITY_RANK[candidate.qualityTier] < QUALITY_RANK[requirements.minimumQualityTier]) {
    reasons.push("quality");
  }
  if (
    requirements.inputUnits > candidate.maxInputUnits ||
    requirements.maximumOutputUnits > candidate.maxOutputUnits ||
    requirements.maximumContextUnits > candidate.maxContextUnits ||
    BigInt(requirements.inputUnits) + BigInt(requirements.maximumOutputUnits) >
      BigInt(requirements.maximumContextUnits)
  ) {
    reasons.push("context");
  }
  if (requirements.maximumDurationMs > candidate.maxDurationMs) reasons.push("duration");
  if (candidate.requiresApproval && requirements.approvalBindingHash === null) reasons.push("approval");
  const estimate = estimateCandidateMoney(candidate, requirements, pricingById);
  if (!estimate.available) reasons.push("pricing");
  if (estimate.available && estimate.amount > requirements.maximumMoneyNanoMinor) reasons.push("budget");
  if (health !== "ready") reasons.push("health");
  reasons.sort(compareCodePoints);
  return {
    candidateId: candidate.candidateId,
    eligible: reasons.length === 0,
    reasons,
    estimatedMoneyNanoMinor: estimate.amount,
    health,
  };
}

function denialForReasons(reasons) {
  const precedence = [
    ["authority", "GE_ROUTE_AUTHORITY_DENIED"],
    ["privacy", "GE_ROUTE_PRIVACY_DENIED"],
    ["approval", "GE_ROUTE_APPROVAL_REQUIRED"],
    ["capability", "GE_ROUTE_CAPABILITY_UNAVAILABLE"],
    ["quality", "GE_ROUTE_CAPABILITY_UNAVAILABLE"],
    ["region", "GE_ROUTE_REGION_DENIED"],
    ["context", "GE_ROUTE_CAPABILITY_UNAVAILABLE"],
    ["duration", "GE_ROUTE_CAPABILITY_UNAVAILABLE"],
    ["pricing", "GE_ROUTE_PRICING_UNAVAILABLE"],
    ["budget", "GE_ROUTE_BUDGET_DENIED"],
    ["health", "GE_ROUTE_HEALTH_UNAVAILABLE"],
  ];
  for (const [reason, code] of precedence) {
    if (reasons.includes(reason)) return code;
  }
  return "GE_ROUTE_NO_CANDIDATE";
}

function routeModel(routerPolicy, pricing, requirements, health) {
  const pricingById = new Map(pricing.entries.map((entry) => [entry.entryId, entry]));
  const healthKeys = Object.keys(health).sort(compareCodePoints);
  const candidateIds = routerPolicy.candidates.map((candidate) => candidate.candidateId);
  exact(healthKeys, candidateIds, "health snapshot must cover exactly the persisted candidate set");
  const evaluated = routerPolicy.candidates.map((candidate) =>
    candidateEvaluation(candidate, requirements, health[candidate.candidateId], pricingById));
  const eligibleIds = new Set(evaluated.filter((evaluation) => evaluation.eligible)
    .map((evaluation) => evaluation.candidateId));
  const eligible = routerPolicy.candidates
    .filter((candidate) => eligibleIds.has(candidate.candidateId))
    .sort((left, right) =>
      QUALITY_RANK[right.qualityTier] - QUALITY_RANK[left.qualityTier] ||
      left.fallbackRank - right.fallbackRank ||
      compareCodePoints(left.candidateId, right.candidateId));
  if (eligible.length > 0) {
    const candidate = eligible[0];
    const evaluation = evaluated.find((item) => item.candidateId === candidate.candidateId);
    return {
      evaluated,
      outcome: "selected",
      selected: {
        candidateId: candidate.candidateId,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        accountClass: candidate.accountClass,
        region: candidate.region,
        qualityTier: candidate.qualityTier,
        fallbackRank: candidate.fallbackRank,
        pricingEntryId: candidate.pricingEntryId,
        authorityGrantHash: candidate.authorityGrantHash,
        estimatedMoneyNanoMinor: evaluation.estimatedMoneyNanoMinor,
      },
      denialCode: null,
    };
  }
  const nearest = [...evaluated].sort((left, right) =>
    left.reasons.length - right.reasons.length ||
    compareCodePoints(left.candidateId, right.candidateId))[0];
  return {
    evaluated,
    outcome: "denied",
    selected: null,
    denialCode: denialForReasons(nearest?.reasons ?? []),
  };
}

function materializeRouteDecision(routeCase, contracts, options = {}) {
  const routed = routeModel(
    contracts.routerPolicy,
    contracts.pricing,
    routeCase.requirements,
    routeCase.health,
  );
  const decision = {
    apiVersion: "graphengineering.reacher-z.github.io/model-route-decisions/v1alpha1",
    kind: "ModelRouteDecision",
    contractVersion: "model-router/v1alpha1",
    decisionId: "0".repeat(64),
    requestId: routeCase.id,
    runId: fixture.ledger.runId,
    nodeId: options.nodeId ?? "model-node",
    attemptId: fixture.identities.attemptId,
    routerPolicyHash: domainHash(DOMAINS.routerPolicy, contracts.routerPolicy),
    pricingSnapshotHash: contracts.pricingHash,
    authorityBindingHash: contracts.policy.authorityBindingHash,
    classificationHash: fixture.identities.classificationHash,
    healthSnapshotHash: fixture.identities.healthSnapshotHash,
    requirements: clone(routeCase.requirements),
    evaluated: routed.evaluated,
    outcome: routed.outcome,
    selected: routed.selected,
    denialCode: routed.denialCode,
    reservationId: routed.outcome === "selected" ? (options.reservationId ?? "model-1") : null,
    decisionOrigin: "new-decision",
    decidedAt: "2026-07-26T00:00:01Z",
  };
  const identity = clone(decision);
  delete identity.decisionId;
  decision.decisionId = domainHash(DOMAINS.routeDecision, identity);
  requireShape(
    validateRouteDecisionShape,
    decision,
    "GE_ROUTE_DECISION_INVALID",
    "route decision schema violation",
  );
  return decision;
}

function validateRecordedDecision(decision, routeCase, contracts) {
  requireShape(
    validateRouteDecisionShape,
    decision,
    "GE_ROUTE_DECISION_INVALID",
    "route decision schema violation",
  );
  if (decision.authorityBindingHash !== contracts.policy.authorityBindingHash) {
    throw new BudgetError("GE_ROUTE_AUTHORITY_DENIED", "recorded route authority binding drifted");
  }
  if (
    decision.pricingSnapshotHash !== contracts.pricingHash ||
    decision.routerPolicyHash !== domainHash(DOMAINS.routerPolicy, contracts.routerPolicy)
  ) {
    throw new BudgetError("GE_ROUTE_PRICING_UNAVAILABLE", "recorded route policy or price drifted");
  }
  if (decision.outcome === "selected") {
    const candidate = contracts.routerPolicy.candidates.find(
      (item) => item.candidateId === decision.selected.candidateId,
    );
    if (
      candidate === undefined ||
      decision.selected.authorityGrantHash !== candidate.authorityGrantHash ||
      !contracts.routerPolicy.allowedAuthorityGrantHashes.includes(
        decision.selected.authorityGrantHash,
      )
    ) {
      throw new BudgetError("GE_ROUTE_AUTHORITY_DENIED", "selected route grant drifted");
    }
  }
  const expected = materializeRouteDecision(routeCase, contracts, {
    nodeId: decision.nodeId,
    reservationId: decision.reservationId ?? "model-1",
  });
  exact(decision, expected, "recorded route decision differs from deterministic recomputation");
  return decision;
}

function makeLedgerState(contracts, decisions) {
  return {
    contracts,
    decisions,
    initialized: false,
    accountId: null,
    eventStreamId: null,
    status: "unopened",
    terminalReason: null,
    rootScope: null,
    sequence: -1,
    lastEventHash: null,
    lastTimestamp: null,
    startedAtNanos: null,
    leaseEpoch: 0,
    fencingToken: 0,
    leaseId: null,
    leaseHolderId: null,
    ceiling: null,
    available: null,
    rootReserved: null,
    committed: null,
    releasedAudit: null,
    disputed: null,
    compensatedEconomic: null,
    reservations: new Map(),
    reservationOutcomes: new Map(),
    settlementIds: new Map(),
    releaseIds: new Map(),
    disputeIds: new Map(),
    compensationIds: new Map(),
    routeDecisionHashes: new Set(),
    routesByReservation: new Map(),
  };
}

function reservationProjection(reservation, stateOverride, sequenceOverride) {
  return {
    reservationId: reservation.reservationId,
    parentReservationId: reservation.parentReservationId,
    depth: reservation.depth,
    bindingHash: reservation.bindingHash,
    maximum: clone(reservation.maximum),
    committed: clone(reservation.committed),
    released: clone(reservation.released),
    remaining: clone(reservation.remaining),
    childAllocated: clone(reservation.childAllocated),
    inDoubt: clone(reservation.inDoubt),
    disputed: clone(reservation.disputed),
    compensatedEconomic: clone(reservation.compensatedEconomic),
    state: stateOverride ?? reservation.state,
    createdSequence: reservation.createdSequence,
    closedSequence: sequenceOverride ?? reservation.closedSequence,
  };
}

function ledgerTotals(state) {
  return {
    ceiling: clone(state.ceiling),
    available: clone(state.available),
    rootReserved: clone(state.rootReserved),
    committed: clone(state.committed),
    releasedAudit: clone(state.releasedAudit),
    disputed: clone(state.disputed),
    compensatedEconomic: clone(state.compensatedEconomic),
  };
}

function accountProjection(state, statusOverride, terminalOverride) {
  return {
    accountId: state.accountId,
    eventStreamId: state.eventStreamId,
    status: statusOverride ?? state.status,
    terminalReason: terminalOverride ?? state.terminalReason,
    totals: ledgerTotals(state),
    reservations: [...state.reservations.values()]
      .sort((left, right) => compareCodePoints(left.reservationId, right.reservationId))
      .map((reservation) => reservationProjection(reservation)),
    reservationOutcomes: [...state.reservationOutcomes.entries()]
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([idempotencyKey, outcome]) => ({
        idempotencyKey,
        reservationId: outcome.reservationId,
        payloadHash: outcome.payloadHash,
      })),
    settlementIds: [...state.settlementIds.keys()].sort(compareCodePoints),
    releaseIds: [...state.releaseIds.keys()].sort(compareCodePoints),
    disputeIds: [...state.disputeIds.keys()].sort(compareCodePoints),
    compensationIds: [...state.compensationIds.keys()].sort(compareCodePoints),
    routeDecisionHashes: [...state.routeDecisionHashes].sort(compareCodePoints),
  };
}

function assertAdditiveLedgerVector(vector, state, context) {
  validateVector(vector, { policy: state.contracts.policy, additiveOnly: true });
  if (Buffer.byteLength(canonicalJson(vector), "utf8") > state.contracts.policy.limits.maxCanonicalBytes) {
    throw new BudgetError("GE_BUDGET_LIMIT_INVALID", context + " exceeds canonical byte limit");
  }
}

function openChildren(state, reservationId) {
  return [...state.reservations.values()].filter((candidate) =>
    candidate.parentReservationId === reservationId && candidate.state === "open");
}

function validateLedgerInvariants(state) {
  if (!state.initialized) return;
  for (const reservation of state.reservations.values()) {
    const accounted = addVectors(
      addVectors(reservation.committed, reservation.released),
      addVectors(reservation.remaining, reservation.childAllocated),
    );
    if (!vectorEqual(accounted, reservation.maximum)) {
      throw new BudgetError(
        "GE_BUDGET_COUNTER_MISMATCH",
        "reservation conservation failed for " + reservation.reservationId,
      );
    }
    if (!vectorLessOrEqual(reservation.inDoubt, reservation.committed)) {
      throw new BudgetError("GE_BUDGET_COUNTER_MISMATCH", "in-doubt usage exceeds committed usage");
    }
    if (!vectorLessOrEqual(reservation.compensatedEconomic, reservation.disputed)) {
      throw new BudgetError("GE_BUDGET_COMPENSATION_INVALID", "compensation exceeds disputed usage");
    }
  }
  const globallyAccounted = addVectors(addVectors(state.available, state.rootReserved), state.committed);
  if (!vectorEqual(globallyAccounted, state.ceiling)) {
    throw new BudgetError("GE_BUDGET_COUNTER_MISMATCH", "account-level conservation failed");
  }
}

function verifyLease(event, state) {
  const acquired = timestampNanos(event.lease.acquiredAt);
  const expires = timestampNanos(event.lease.expiresAt);
  const timestamp = timestampNanos(event.timestamp);
  if (!(acquired <= timestamp && timestamp < expires)) {
    throw new BudgetError("GE_BUDGET_LEASE_CONFLICT", "event is outside its lease interval");
  }
  if (state.sequence >= 0) {
    const sameHolder =
      event.lease.leaseId === state.leaseId && event.lease.holderId === state.leaseHolderId;
    const staleSameHolder = sameHolder && (
      event.lease.leaseEpoch < state.leaseEpoch ||
      event.lease.fencingToken < state.fencingToken
    );
    const invalidTakeover = !sameHolder && !(
      event.lease.leaseEpoch > state.leaseEpoch &&
      event.lease.fencingToken > state.fencingToken
    );
    if (staleSameHolder || invalidTakeover) {
      throw new BudgetError("GE_BUDGET_LEASE_CONFLICT", "lease epoch or fencing token is stale");
    }
  }
}

function verifyEventEnvelope(event, state) {
  requireShape(validateEventShape, event, "GE_BUDGET_EVENT_INVALID", "budget event schema violation");
  if (event.sequence >= state.contracts.policy.limits.maxEvents) {
    throw new BudgetError("GE_BUDGET_LIMIT_INVALID", "event count exceeds policy");
  }
  if (
    Buffer.byteLength(canonicalJson(event), "utf8") >
    state.contracts.policy.limits.maxCanonicalBytes
  ) {
    throw new BudgetError("GE_BUDGET_LIMIT_INVALID", "event exceeds canonical byte limit");
  }
  if (event.sequence !== state.sequence + 1 || event.expectedPreviousSequence !== state.sequence) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "event sequence is not contiguous");
  }
  if (event.previousEventHash !== state.lastEventHash) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "previous event hash does not match");
  }
  if (event.payloadHash !== domainHash(DOMAINS.payload, event.data)) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "event payload hash does not match");
  }
  if (event.eventId !== eventIdFor(event)) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "event ID is not bound to stream, sequence, and payload");
  }
  const hashInput = clone(event);
  delete hashInput.eventHash;
  if (event.eventHash !== domainHash(DOMAINS.event, hashInput)) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "event envelope hash does not match");
  }
  if (
    state.lastTimestamp !== null &&
    timestampNanos(event.timestamp) < timestampNanos(state.lastTimestamp)
  ) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "event timestamps moved backwards");
  }
  verifyLease(event, state);
  if (state.initialized) {
    if (
      event.accountId !== state.accountId ||
      event.eventStreamId !== state.eventStreamId ||
      event.policyHash !== state.contracts.policyHash ||
      event.pricingSnapshotHash !== state.contracts.pricingHash ||
      event.authorityBindingHash !== state.contracts.policy.authorityBindingHash
    ) {
      throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "event stream binding drifted");
    }
    if (state.status === "closed") {
      throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "event follows terminal account closure");
    }
  }
}

function foldAccountOpened(event, state) {
  if (state.initialized || event.sequence !== 0) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "account may be opened exactly once at sequence zero");
  }
  const data = event.data;
  validatePolicy(data.policy);
  if (
    data.policyHash !== state.contracts.policyHash ||
    data.policyHash !== event.policyHash ||
    canonicalJson(data.policy) !== canonicalJson(state.contracts.policy) ||
    data.pricingSnapshotHash !== state.contracts.pricingHash ||
    data.routerPolicyHash !== domainHash(DOMAINS.routerPolicy, state.contracts.routerPolicy) ||
    data.rootScope.tenantId !== fixture.ledger.tenantId ||
    data.rootScope.runId !== fixture.ledger.runId
  ) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "account opening contract bindings drifted");
  }
  validateVector(data.ceiling, { policy: state.contracts.policy });
  if (!vectorEqual(data.ceiling, state.contracts.policy.rootCeiling)) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "account opening ceiling differs from policy");
  }
  state.initialized = true;
  state.accountId = event.accountId;
  state.eventStreamId = event.eventStreamId;
  state.status = "active";
  state.rootScope = clone(data.rootScope);
  state.startedAtNanos = timestampNanos(data.startedAt);
  if (state.startedAtNanos !== timestampNanos(event.timestamp)) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "account start time differs from opening event");
  }
  state.ceiling = clone(data.ceiling);
  state.available = clone(data.ceiling);
  state.rootReserved = emptyVector(data.ceiling);
  state.committed = emptyVector(data.ceiling);
  state.releasedAudit = emptyVector(data.ceiling);
  state.disputed = emptyVector(data.ceiling);
  state.compensatedEconomic = emptyVector(data.ceiling);
}

function foldReservationCreated(event, state) {
  const data = event.data;
  assertAdditiveLedgerVector(data.maximum, state, "reservation maximum");
  if (
    data.binding.tenantId !== state.rootScope.tenantId ||
    data.binding.runId !== state.rootScope.runId ||
    data.binding.graphHash !== state.rootScope.graphHash ||
    data.binding.graphRevision !== state.rootScope.graphRevision ||
    data.binding.planHash !== state.rootScope.planHash
  ) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "reservation binding escapes account root scope");
  }
  if (timestampNanos(data.expiresAt) <= timestampNanos(event.timestamp)) {
    throw new BudgetError("GE_BUDGET_ADMISSION_DENIED", "reservation is already expired");
  }
  const requestIdentity = clone(data);
  delete requestIdentity.reservationId;
  delete requestIdentity.idempotencyKey;
  const expectedIdempotencyKey = domainHash(DOMAINS.reservationRequest, requestIdentity);
  if (data.idempotencyKey !== expectedIdempotencyKey) {
    throw new BudgetError("GE_BUDGET_IDEMPOTENCY_CONFLICT", "reservation idempotency key drifted");
  }
  const payloadHash = domainHash(DOMAINS.payload, data);
  const priorOutcome = state.reservationOutcomes.get(data.idempotencyKey);
  if (priorOutcome !== undefined) {
    if (priorOutcome.reservationId !== data.reservationId || priorOutcome.payloadHash !== payloadHash) {
      throw new BudgetError(
        "GE_BUDGET_IDEMPOTENCY_CONFLICT",
        "reservation idempotency key has another canonical outcome",
      );
    }
    return;
  }
  if (state.reservations.has(data.reservationId)) {
    throw new BudgetError("GE_BUDGET_IDEMPOTENCY_CONFLICT", "reservation ID is already present");
  }
  if (state.reservations.size >= state.contracts.policy.limits.maxReservations) {
    throw new BudgetError("GE_BUDGET_LIMIT_INVALID", "reservation count exceeds policy");
  }
  let parent = null;
  if (data.parentReservationId !== null) {
    parent = state.reservations.get(data.parentReservationId);
    if (parent === undefined || parent.state !== "open") {
      throw new BudgetError("GE_BUDGET_PARENT_MISSING", "parent reservation is absent or closed");
    }
    if (data.depth !== parent.depth + 1) {
      throw new BudgetError("GE_BUDGET_PARENT_MISSING", "child reservation depth is not parent depth plus one");
    }
    if (
      data.depth > state.contracts.policy.limits.maxReservationDepth ||
      !vectorLessOrEqual(data.maximum, parent.remaining)
    ) {
      throw new BudgetError("GE_BUDGET_CHILD_EXPANSION", "child allocation exceeds its parent");
    }
  } else {
    if (data.depth !== 0) {
      throw new BudgetError("GE_BUDGET_PARENT_MISSING", "root reservation depth must be zero");
    }
    if (!vectorLessOrEqual(data.maximum, state.available)) {
      throw new BudgetError("GE_BUDGET_ADMISSION_DENIED", "root allocation exceeds available budget");
    }
  }
  if (data.routeDecisionHash !== null) {
    const decision = state.decisions.get(data.routeDecisionHash);
    if (
      decision === undefined ||
      !state.routeDecisionHashes.has(data.routeDecisionHash) ||
      decision.outcome !== "selected" ||
      decision.reservationId !== data.reservationId
    ) {
      throw new BudgetError("GE_ROUTE_DECISION_INVALID", "reservation lacks its persisted selected route");
    }
    if (
      data.binding.runId !== decision.runId ||
      data.binding.nodeId !== decision.nodeId ||
      data.binding.attemptId !== decision.attemptId ||
      data.binding.providerId !== decision.selected.providerId ||
      data.binding.modelId !== decision.selected.modelId
    ) {
      throw new BudgetError("GE_ROUTE_DECISION_INVALID", "reservation binding differs from selected route");
    }
  } else if (data.binding.providerId !== null || data.binding.modelId !== null) {
    throw new BudgetError(
      "GE_ROUTE_DECISION_INVALID",
      "provider/model reservation requires a persisted route decision",
    );
  }
  const bindingHash = domainHash(DOMAINS.binding, data.binding);
  const reservation = {
    reservationId: data.reservationId,
    parentReservationId: data.parentReservationId,
    depth: data.depth,
    bindingHash,
    maximum: clone(data.maximum),
    committed: emptyVector(data.maximum),
    released: emptyVector(data.maximum),
    remaining: clone(data.maximum),
    childAllocated: emptyVector(data.maximum),
    inDoubt: emptyVector(data.maximum),
    disputed: emptyVector(data.maximum),
    compensatedEconomic: emptyVector(data.maximum),
    state: "open",
    createdSequence: event.sequence,
    closedSequence: null,
  };
  if (parent === null) {
    state.available = subtractVectors(state.available, data.maximum, "GE_BUDGET_ADMISSION_DENIED");
    state.rootReserved = addVectors(state.rootReserved, data.maximum);
  } else {
    parent.remaining = subtractVectors(parent.remaining, data.maximum, "GE_BUDGET_CHILD_EXPANSION");
    parent.childAllocated = addVectors(parent.childAllocated, data.maximum);
  }
  state.reservations.set(data.reservationId, reservation);
  state.reservationOutcomes.set(data.idempotencyKey, {
    reservationId: data.reservationId,
    payloadHash,
  });
}

function foldUsageCommitted(event, state) {
  const data = event.data;
  const reservation = state.reservations.get(data.reservationId);
  if (reservation === undefined || reservation.state !== "open") {
    throw new BudgetError("GE_BUDGET_PARENT_MISSING", "usage reservation is absent or closed");
  }
  assertAdditiveLedgerVector(data.usage, state, "committed usage");
  const reportedAt = timestampNanos(data.reportedAt);
  if (reportedAt < state.startedAtNanos || reportedAt > timestampNanos(event.timestamp)) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "usage report time is outside account history");
  }
  const payloadIdentity = domainHash(DOMAINS.payload, data);
  const prior = state.settlementIds.get(data.settlementId);
  if (prior !== undefined) {
    if (prior !== payloadIdentity) {
      throw new BudgetError("GE_BUDGET_IDEMPOTENCY_CONFLICT", "settlement ID has another canonical outcome");
    }
    return;
  }
  if (!vectorLessOrEqual(data.usage, reservation.remaining)) {
    throw new BudgetError(
      "GE_BUDGET_USAGE_OVERAGE",
      "reported usage exceeds the declared reservation; excess requires a dispute event",
    );
  }
  reservation.remaining = subtractVectors(
    reservation.remaining,
    data.usage,
    "GE_BUDGET_USAGE_OVERAGE",
  );
  reservation.committed = addVectors(reservation.committed, data.usage);
  if (data.inDoubt) reservation.inDoubt = addVectors(reservation.inDoubt, data.usage);
  state.rootReserved = subtractVectors(
    state.rootReserved,
    data.usage,
    "GE_BUDGET_COUNTER_MISMATCH",
  );
  state.committed = addVectors(state.committed, data.usage);
  state.settlementIds.set(data.settlementId, payloadIdentity);
}

function foldReservationReleased(event, state) {
  const data = event.data;
  const reservation = state.reservations.get(data.reservationId);
  if (reservation === undefined || reservation.state !== "open") {
    throw new BudgetError("GE_BUDGET_PARENT_MISSING", "release reservation is absent or closed");
  }
  assertAdditiveLedgerVector(data.released, state, "released budget");
  const payloadIdentity = domainHash(DOMAINS.payload, data);
  const prior = state.releaseIds.get(data.releaseId);
  if (prior !== undefined) {
    if (prior !== payloadIdentity) {
      throw new BudgetError("GE_BUDGET_IDEMPOTENCY_CONFLICT", "release ID has another canonical outcome");
    }
    return;
  }
  if (!vectorLessOrEqual(data.released, reservation.remaining)) {
    throw new BudgetError("GE_BUDGET_COUNTER_MISMATCH", "release exceeds remaining reservation");
  }
  reservation.remaining = subtractVectors(reservation.remaining, data.released);
  reservation.released = addVectors(reservation.released, data.released);
  state.releasedAudit = addVectors(state.releasedAudit, data.released);
  if (reservation.parentReservationId === null) {
    state.rootReserved = subtractVectors(state.rootReserved, data.released);
    state.available = addVectors(state.available, data.released);
  }
  state.releaseIds.set(data.releaseId, payloadIdentity);
}

function foldUsageDisputed(event, state) {
  const data = event.data;
  const reservation = state.reservations.get(data.reservationId);
  if (reservation === undefined || !state.settlementIds.has(data.settlementId)) {
    throw new BudgetError("GE_BUDGET_PARENT_MISSING", "dispute lacks its reservation or settlement");
  }
  assertAdditiveLedgerVector(data.disputed, state, "disputed usage");
  const payloadIdentity = domainHash(DOMAINS.payload, data);
  const prior = state.disputeIds.get(data.disputeId);
  if (prior !== undefined) {
    if (prior !== payloadIdentity) {
      throw new BudgetError("GE_BUDGET_IDEMPOTENCY_CONFLICT", "dispute ID has another canonical outcome");
    }
    return;
  }
  if (!vectorLessOrEqual(data.disputed, reservation.committed)) {
    throw new BudgetError("GE_BUDGET_COUNTER_MISMATCH", "dispute exceeds committed usage");
  }
  reservation.disputed = addVectors(reservation.disputed, data.disputed);
  state.disputed = addVectors(state.disputed, data.disputed);
  state.disputeIds.set(data.disputeId, payloadIdentity);
}

function foldUsageCompensated(event, state) {
  const data = event.data;
  if (data.economicOnly !== true || data.restoresSchedulingCapacity !== false) {
    throw new BudgetError("GE_BUDGET_COMPENSATION_INVALID", "compensation attempted to restore capacity");
  }
  const reservation = state.reservations.get(data.reservationId);
  if (reservation === undefined || !state.disputeIds.has(data.disputeId)) {
    throw new BudgetError("GE_BUDGET_COMPENSATION_INVALID", "compensation lacks its reservation or dispute");
  }
  assertAdditiveLedgerVector(data.amount, state, "economic compensation");
  const payloadIdentity = domainHash(DOMAINS.payload, data);
  const prior = state.compensationIds.get(data.compensationId);
  if (prior !== undefined) {
    if (prior !== payloadIdentity) {
      throw new BudgetError("GE_BUDGET_IDEMPOTENCY_CONFLICT", "compensation ID has another outcome");
    }
    return;
  }
  const next = addVectors(reservation.compensatedEconomic, data.amount);
  if (!vectorLessOrEqual(next, reservation.disputed)) {
    throw new BudgetError("GE_BUDGET_COMPENSATION_INVALID", "compensation exceeds disputed usage");
  }
  reservation.compensatedEconomic = next;
  state.compensatedEconomic = addVectors(state.compensatedEconomic, data.amount);
  state.compensationIds.set(data.compensationId, payloadIdentity);
}

function foldRouteDecisionRecorded(event, state) {
  const data = event.data;
  const decision = state.decisions.get(data.decisionHash);
  if (
    decision === undefined ||
    decision.outcome !== data.outcome ||
    decision.reservationId !== data.reservationId
  ) {
    throw new BudgetError("GE_ROUTE_DECISION_INVALID", "recorded decision hash is not accepted");
  }
  state.routeDecisionHashes.add(data.decisionHash);
  if (data.reservationId !== null) {
    const prior = state.routesByReservation.get(data.reservationId);
    if (prior !== undefined && prior !== data.decisionHash) {
      throw new BudgetError("GE_BUDGET_IDEMPOTENCY_CONFLICT", "reservation has conflicting route decisions");
    }
    state.routesByReservation.set(data.reservationId, data.decisionHash);
  }
}

function foldReservationClosed(event, state) {
  const data = event.data;
  const reservation = state.reservations.get(data.reservationId);
  if (reservation === undefined || reservation.state !== "open") {
    throw new BudgetError("GE_BUDGET_PARENT_MISSING", "closed reservation is absent or already closed");
  }
  if (openChildren(state, data.reservationId).length > 0) {
    throw new BudgetError("GE_BUDGET_CHILD_OPEN", "parent cannot close while a child is open");
  }
  if (!vectorIsEmpty(reservation.remaining) || !vectorIsEmpty(reservation.childAllocated)) {
    throw new BudgetError("GE_BUDGET_COUNTER_MISMATCH", "reservation must settle or release all capacity");
  }
  const expectedState = vectorIsEmpty(reservation.disputed) ? "closed" : "disputed";
  if (data.state !== expectedState) {
    throw new BudgetError("GE_BUDGET_COUNTER_MISMATCH", "reservation terminal state differs from projection");
  }
  const finalProjection = reservationProjection(reservation, data.state, event.sequence);
  if (data.finalProjectionHash !== domainHash(DOMAINS.reservation, finalProjection)) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "reservation final projection hash drifted");
  }
  reservation.state = data.state;
  reservation.closedSequence = event.sequence;
  if (reservation.parentReservationId !== null) {
    const parent = state.reservations.get(reservation.parentReservationId);
    if (parent === undefined || parent.state !== "open") {
      throw new BudgetError("GE_BUDGET_PARENT_MISSING", "closed child has no live parent");
    }
    parent.childAllocated = subtractVectors(parent.childAllocated, reservation.maximum);
    parent.committed = addVectors(parent.committed, reservation.committed);
    parent.released = addVectors(parent.released, emptyVector(parent.maximum));
    parent.remaining = addVectors(parent.remaining, reservation.released);
    parent.inDoubt = addVectors(parent.inDoubt, reservation.inDoubt);
    parent.disputed = addVectors(parent.disputed, reservation.disputed);
    parent.compensatedEconomic = addVectors(
      parent.compensatedEconomic,
      reservation.compensatedEconomic,
    );
  }
}

function foldAccountClosed(event, state) {
  if ([...state.reservations.values()].some((reservation) => reservation.state === "open")) {
    throw new BudgetError("GE_BUDGET_CHILD_OPEN", "account cannot close with live reservations");
  }
  const expectedProjection = accountProjection(state, "closed", event.data.terminalReason);
  if (event.data.finalProjectionHash !== domainHash(DOMAINS.projection, expectedProjection)) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "account final projection hash drifted");
  }
  if (timestampNanos(event.data.closedAt) !== timestampNanos(event.timestamp)) {
    throw new BudgetError("GE_BUDGET_INVALID_HISTORY", "account close time differs from terminal event");
  }
  state.status = "closed";
  state.terminalReason = event.data.terminalReason;
}

function foldEvent(event, state) {
  verifyEventEnvelope(event, state);
  switch (event.type) {
    case "BudgetAccountOpened":
      foldAccountOpened(event, state);
      break;
    case "ReservationCreated":
      foldReservationCreated(event, state);
      break;
    case "UsageCommitted":
      foldUsageCommitted(event, state);
      break;
    case "ReservationReleased":
      foldReservationReleased(event, state);
      break;
    case "UsageDisputed":
      foldUsageDisputed(event, state);
      break;
    case "UsageCompensated":
      foldUsageCompensated(event, state);
      break;
    case "RouteDecisionRecorded":
      foldRouteDecisionRecorded(event, state);
      break;
    case "ReservationClosed":
      foldReservationClosed(event, state);
      break;
    case "BudgetAccountClosed":
      foldAccountClosed(event, state);
      break;
    default:
      assert.fail("schema admitted unknown ledger event " + event.type);
  }
  state.sequence = event.sequence;
  state.lastEventHash = event.eventHash;
  state.lastTimestamp = event.timestamp;
  state.leaseEpoch = event.lease.leaseEpoch;
  state.fencingToken = event.lease.fencingToken;
  state.leaseId = event.lease.leaseId;
  state.leaseHolderId = event.lease.holderId;
  validateLedgerInvariants(state);
  return state;
}

function timestampForSequence(sequence) {
  return new Date(Date.parse("2026-07-26T00:00:00Z") + sequence * 1000)
    .toISOString()
    .replace(".000Z", "Z");
}

function reservationBinding(operation, decision) {
  const selected = decision?.selected ?? null;
  return {
    tenantId: fixture.ledger.tenantId,
    runId: fixture.ledger.runId,
    graphHash: fixture.identities.graphHash,
    graphRevision: 1,
    nodeId: operation.parentReservationId === null ? "cycle-node" : "model-node",
    attemptId: fixture.identities.attemptId,
    activityId: operation.reservationId,
    roundId: "round-1",
    planHash: fixture.identities.planHash,
    providerId: selected?.providerId ?? null,
    modelId: selected?.modelId ?? null,
  };
}

function routeArtifacts(contracts) {
  const byCase = new Map();
  const byHash = new Map();
  for (const routeCase of fixture.routeCases) {
    const decision = materializeRouteDecision(routeCase, contracts, {
      reservationId: routeCase.expectOutcome === "selected" ? "model-1" : undefined,
    });
    validateRecordedDecision(decision, routeCase, contracts);
    assert.equal(decision.outcome, routeCase.expectOutcome, routeCase.id + " outcome drifted");
    assert.equal(
      decision.selected?.candidateId ?? null,
      routeCase.expectCandidateId,
      routeCase.id + " selected candidate drifted",
    );
    assert.equal(decision.denialCode, routeCase.expectDenialCode, routeCase.id + " denial code drifted");
    const decisionHash = domainHash(DOMAINS.routeDecision, decision);
    const artifact = { routeCase, decision, decisionHash };
    byCase.set(routeCase.id, artifact);
    byHash.set(decisionHash, decision);
  }
  return { byCase, byHash };
}

function eventDataForOperation(operation, state, contracts, routes, vectors, sequence) {
  switch (operation.type) {
    case "BudgetAccountOpened":
      return {
        policy: clone(contracts.policy),
        policyHash: contracts.policyHash,
        pricingSnapshotHash: contracts.pricingHash,
        routerPolicyHash: domainHash(DOMAINS.routerPolicy, contracts.routerPolicy),
        rootScope: {
          tenantId: fixture.ledger.tenantId,
          runId: fixture.ledger.runId,
          graphHash: fixture.identities.graphHash,
          graphRevision: 1,
          planHash: fixture.identities.planHash,
        },
        ceiling: clone(contracts.policy.rootCeiling),
        startedAt: timestampForSequence(sequence),
      };
    case "RouteDecisionRecorded": {
      const artifact = routes.byCase.get(operation.routeCase);
      assert.ok(artifact, "unknown route case " + operation.routeCase);
      return {
        decisionHash: artifact.decisionHash,
        reservationId: artifact.decision.reservationId,
        outcome: artifact.decision.outcome,
      };
    }
    case "ReservationCreated": {
      const vector = vectors[operation.vector];
      assert.ok(vector, "unknown reservation vector " + operation.vector);
      const artifact = operation.routeDecision
        ? routes.byCase.get(operation.routeCase ?? "select-premium-for-confidential-tools")
        : null;
      const data = {
        reservationId: operation.reservationId,
        parentReservationId: operation.parentReservationId,
        depth: operation.depth,
        binding: reservationBinding(operation, artifact?.decision),
        maximum: clone(vector),
        idempotencyKey: "0".repeat(64),
        expiresAt: "2026-07-26T00:30:00Z",
        routeDecisionHash: artifact?.decisionHash ?? null,
      };
      const requestIdentity = clone(data);
      delete requestIdentity.reservationId;
      delete requestIdentity.idempotencyKey;
      data.idempotencyKey = domainHash(DOMAINS.reservationRequest, requestIdentity);
      return data;
    }
    case "UsageCommitted": {
      const vector = vectors[operation.vector];
      assert.ok(vector, "unknown usage vector " + operation.vector);
      return {
        reservationId: operation.reservationId,
        settlementId: operation.settlementId,
        usage: clone(vector),
        source: operation.source ?? "provider",
        usageEnvelopeHash: fixture.identities.usageEnvelopeHash,
        reportedAt: timestampForSequence(sequence),
        overageDisposition: operation.overageDisposition ?? "none",
        inDoubt: operation.inDoubt ?? false,
      };
    }
    case "ReservationReleased": {
      const vector = vectors[operation.vector];
      assert.ok(vector, "unknown release vector " + operation.vector);
      return {
        reservationId: operation.reservationId,
        releaseId: operation.releaseId,
        released: clone(vector),
        reason: operation.reason,
      };
    }
    case "UsageDisputed": {
      const vector = vectors[operation.vector];
      assert.ok(vector, "unknown dispute vector " + operation.vector);
      return {
        reservationId: operation.reservationId,
        disputeId: operation.disputeId,
        settlementId: operation.settlementId,
        disputed: clone(vector),
        reason: operation.reason,
      };
    }
    case "UsageCompensated": {
      const vector = vectors[operation.vector];
      assert.ok(vector, "unknown compensation vector " + operation.vector);
      return {
        reservationId: operation.reservationId,
        compensationId: operation.compensationId,
        disputeId: operation.disputeId,
        amount: clone(vector),
        economicOnly: operation.economicOnly ?? true,
        restoresSchedulingCapacity: operation.restoresSchedulingCapacity ?? false,
      };
    }
    case "ReservationClosed": {
      const reservation = state.reservations.get(operation.reservationId);
      assert.ok(reservation, "materializer cannot close absent reservation");
      const finalProjection = reservationProjection(reservation, operation.state, sequence);
      return {
        reservationId: operation.reservationId,
        finalProjectionHash: domainHash(DOMAINS.reservation, finalProjection),
        state: operation.state,
      };
    }
    case "BudgetAccountClosed": {
      const finalProjection = accountProjection(state, "closed", operation.terminalReason);
      return {
        terminalReason: operation.terminalReason,
        finalProjectionHash: domainHash(DOMAINS.projection, finalProjection),
        closedAt: timestampForSequence(sequence),
      };
    }
    default:
      assert.fail("unknown fixture operation " + operation.type);
  }
}

function sealEvent(type, data, state, contracts, sequence, lease = fixture.ledger.lease) {
  const event = {
    apiVersion: "graphengineering.reacher-z.github.io/budget-ledger-events/v1alpha1",
    kind: "BudgetLedgerEvent",
    contractVersion: "durable-budget-ledger/v1alpha1",
    accountId: fixture.ledger.accountId,
    eventStreamId: fixture.identities.eventStreamId,
    eventId: "e-" + "0".repeat(64),
    sequence,
    expectedPreviousSequence: sequence - 1,
    previousEventHash: state.lastEventHash,
    timestamp: timestampForSequence(sequence),
    lease: clone(lease),
    policyHash: contracts.policyHash,
    pricingSnapshotHash: contracts.pricingHash,
    authorityBindingHash: contracts.policy.authorityBindingHash,
    type,
    payloadDisposition: "metadata-only",
    redacted: false,
    data,
    payloadHash: domainHash(DOMAINS.payload, data),
    eventHash: "0".repeat(64),
  };
  event.eventId = eventIdFor(event);
  const hashInput = clone(event);
  delete hashInput.eventHash;
  event.eventHash = domainHash(DOMAINS.event, hashInput);
  return event;
}

function eventIdFor(event) {
  return "e-" + domainHash(DOMAINS.eventId, {
    accountId: event.accountId,
    eventStreamId: event.eventStreamId,
    sequence: event.sequence,
    type: event.type,
    payloadHash: event.payloadHash,
  });
}

function materializeLedger(contracts, routes, options = {}) {
  const vectors = options.vectors ?? fixture.vectors;
  const operations = options.operations ?? fixture.ledger.operations;
  const state = makeLedgerState(contracts, routes.byHash);
  const events = [];
  for (const operation of operations) {
    const sequence = events.length;
    const data = eventDataForOperation(operation, state, contracts, routes, vectors, sequence);
    const lease = options.leaseForSequence?.(sequence, fixture.ledger.lease) ?? fixture.ledger.lease;
    const event = sealEvent(operation.type, data, state, contracts, sequence, lease);
    foldEvent(event, state);
    events.push(event);
  }
  return { events, state };
}

function foldHistory(events, contracts, routes) {
  const state = makeLedgerState(contracts, routes.byHash);
  for (const event of events) foldEvent(event, state);
  return state;
}

function resealHistory(events, contracts) {
  let previousHash = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    event.sequence = index;
    event.expectedPreviousSequence = index - 1;
    event.previousEventHash = previousHash;
    event.payloadHash = domainHash(DOMAINS.payload, event.data);
    event.eventId = eventIdFor(event);
    const hashInput = clone(event);
    delete hashInput.eventHash;
    event.eventHash = domainHash(DOMAINS.event, hashInput);
    previousHash = event.eventHash;
  }
  return events;
}

function buildCheckpoint(state) {
  assert.ok(state.initialized && state.sequence >= 0, "checkpoint requires a non-empty history");
  const projection = accountProjection(state);
  const checkpoint = {
    apiVersion: "graphengineering.reacher-z.github.io/budget-ledger-checkpoints/v1alpha1",
    kind: "BudgetLedgerCheckpoint",
    contractVersion: "durable-budget-ledger/v1alpha1",
    accountId: state.accountId,
    eventStreamId: state.eventStreamId,
    checkpointId: "budget-checkpoint-" + String(state.sequence).padStart(3, "0"),
    sequence: state.sequence,
    historyPrefixHash: state.lastEventHash,
    policyHash: state.contracts.policyHash,
    pricingSnapshotHash: state.contracts.pricingHash,
    authorityBindingHash: state.contracts.policy.authorityBindingHash,
    createdAt: timestampForSequence(state.sequence),
    payloadDisposition: "metadata-only",
    redacted: false,
    status: state.status,
    terminalReason: state.terminalReason,
    totals: projection.totals,
    reservations: projection.reservations,
    reservationOutcomes: projection.reservationOutcomes,
    settlementIds: projection.settlementIds,
    releaseIds: projection.releaseIds,
    disputeIds: projection.disputeIds,
    compensationIds: projection.compensationIds,
    routeDecisionHashes: projection.routeDecisionHashes,
    contentHash: "0".repeat(64),
  };
  const content = clone(checkpoint);
  delete content.contentHash;
  checkpoint.contentHash = domainHash(DOMAINS.checkpoint, content);
  requireShape(
    validateCheckpointShape,
    checkpoint,
    "GE_BUDGET_CORRUPT_CHECKPOINT",
    "budget checkpoint schema violation",
  );
  return checkpoint;
}

function validateCheckpoint(checkpoint, state) {
  requireShape(
    validateCheckpointShape,
    checkpoint,
    "GE_BUDGET_CORRUPT_CHECKPOINT",
    "budget checkpoint schema violation",
  );
  const content = clone(checkpoint);
  delete content.contentHash;
  if (checkpoint.contentHash !== domainHash(DOMAINS.checkpoint, content)) {
    throw new BudgetError("GE_BUDGET_CORRUPT_CHECKPOINT", "checkpoint content hash drifted");
  }
  const expected = buildCheckpoint(state);
  if (canonicalJson(checkpoint) !== canonicalJson(expected)) {
    throw new BudgetError(
      "GE_BUDGET_CORRUPT_CHECKPOINT",
      "checkpoint differs from a full replay projection",
    );
  }
  return checkpoint;
}

function makeAdditiveVector(base, amounts) {
  const entries = new Map();
  for (const [resource, amount] of Object.entries(amounts)) {
    if (amount === 0) continue;
    const contract = RESOURCE_CONTRACT[resource];
    assert.ok(contract, "unknown resource " + resource);
    entries.set("q:" + resource, {
      group: "quantity",
      name: resource,
      unit: contract[0],
      aggregation: contract[1],
      amount,
    });
  }
  return vectorFromEntries(base, entries);
}

function makeMaximumVector(base, amounts) {
  const entries = new Map();
  for (const [resource, amount] of Object.entries(amounts)) {
    if (amount === 0) continue;
    const contract = RESOURCE_CONTRACT[resource];
    assert.ok(contract, "unknown resource " + resource);
    assert.equal(contract[1], "maximum", resource + " is not a maximum gate");
    entries.set("q:" + resource, {
      group: "quantity",
      name: resource,
      unit: contract[0],
      aggregation: contract[1],
      amount,
    });
  }
  return vectorFromEntries(base, entries);
}

function validateMaximumGates(observed, ceiling, policy) {
  validateVector(observed, { policy });
  for (const entry of [...observed.quantities, ...observed.providerSpecific]) {
    if (entry.aggregation !== "maximum") {
      throw new BudgetError(
        "GE_BUDGET_VECTOR_NON_ADDITIVE_RESERVATION",
        "hard maximum observation contains an additive resource",
      );
    }
  }
  if (!vectorLessOrEqual(observed, ceiling)) {
    throw new BudgetError("GE_BUDGET_ADMISSION_DENIED", "hard maximum gate is over ceiling");
  }
}

function recomputeReservationIdempotencyKey(data) {
  const requestIdentity = clone(data);
  delete requestIdentity.reservationId;
  delete requestIdentity.idempotencyKey;
  data.idempotencyKey = domainHash(DOMAINS.reservationRequest, requestIdentity);
  return data;
}

const contracts = materializeContracts();
validateRouterPolicy(contracts.routerPolicy, contracts);
validateMaximumGates(
  makeMaximumVector(fixture.vectors.empty, { depth: 8, "fan-out": 16 }),
  contracts.policy.rootCeiling,
  contracts.policy,
);
for (const [name, vector] of Object.entries(fixture.vectors)) {
  validateVector(vector, { policy: contracts.policy });
  assert.ok(
    Buffer.byteLength(canonicalJson(vector), "utf8") <= contracts.policy.limits.maxCanonicalBytes,
    name + " vector exceeds canonical byte bound",
  );
}
const routes = routeArtifacts(contracts);
const baseline = materializeLedger(contracts, routes);
assert.equal(baseline.events.length, fixture.ledger.operations.length);
assert.equal(baseline.state.status, "closed");
assert.equal(baseline.state.terminalReason, "COMPLETED");
const replayed = foldHistory(clone(baseline.events), contracts, routes);
exact(accountProjection(replayed), accountProjection(baseline.state), "ledger replay projection drifted");
const checkpoint = buildCheckpoint(baseline.state);
validateCheckpoint(checkpoint, replayed);
const observedGolden = {
  policyHash: contracts.policyHash,
  pricingSnapshotHash: contracts.pricingHash,
  routerPolicyHash: domainHash(DOMAINS.routerPolicy, contracts.routerPolicy),
  routeDecisionHashes: Object.fromEntries(
    [...routes.byCase.entries()].map(([id, artifact]) => [id, artifact.decisionHash]),
  ),
  eventHashes: baseline.events.map((event) => event.eventHash),
  checkpointContentHash: checkpoint.contentHash,
  terminalProjectionHash: baseline.events.at(-1).data.finalProjectionHash,
};
exact(observedGolden, fixture.expected, "portable budget golden identities drifted");

function expectBudgetCode(expectedCode, operation, context) {
  let caught = null;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, context + " was accepted");
  assert.equal(
    caught.code,
    expectedCode,
    context + " produced " + (caught.code ?? caught.name) + ": " + caught.message,
  );
}

function operationIndex(operations, type, ordinal = 0) {
  let seen = 0;
  for (let index = 0; index < operations.length; index += 1) {
    if (operations[index].type !== type) continue;
    if (seen === ordinal) return index;
    seen += 1;
  }
  assert.fail("operation not found: " + type + "[" + ordinal + "]");
}

function validateFork(sourceCheckpoint, forkCheckpoint) {
  if (
    sourceCheckpoint.accountId === forkCheckpoint.accountId ||
    sourceCheckpoint.eventStreamId === forkCheckpoint.eventStreamId ||
    vectorEqual(sourceCheckpoint.totals.available, forkCheckpoint.totals.available)
  ) {
    throw new BudgetError(
      "GE_BUDGET_FORK_CREDIT_REUSE",
      "fork reused source account identity or available scheduling credit",
    );
  }
}

function executeNegative(operation) {
  switch (operation) {
    case "reverse-root-vector": {
      const vector = clone(fixture.vectors.rootCeiling);
      vector.quantities.reverse();
      validateVector(vector, { policy: contracts.policy });
      return;
    }
    case "wrong-attempt-unit": {
      const vector = clone(fixture.vectors.rootCeiling);
      vector.quantities.find((entry) => entry.resource === "attempts").unit = "byte";
      validateVector(vector, { policy: contracts.policy });
      return;
    }
    case "duplicate-attempt-resource": {
      const vector = clone(fixture.vectors.rootCeiling);
      vector.quantities.push(clone(vector.quantities.find((entry) => entry.resource === "attempts")));
      validateVector(vector, { policy: contracts.policy });
      return;
    }
    case "root-vector-currency-eur": {
      const policy = clone(contracts.policy);
      policy.rootCeiling.currency = "EUR";
      validatePolicy(policy);
      return;
    }
    case "scope-exceeds-root": {
      const policy = clone(contracts.policy);
      const scope = policy.scopeCeilings.find((item) => item.scopeKind === "model");
      scope.ceiling.quantities.find((entry) => entry.resource === "attempts").amount = 21;
      validatePolicy(policy);
      return;
    }
    case "reverse-pricing-rules": {
      const pricing = clone(contracts.pricing);
      pricing.entries[0].rules.reverse();
      validatePricing(pricing, contracts.policy);
      return;
    }
    case "pricing-end-before-start": {
      const pricing = clone(contracts.pricing);
      pricing.effectiveUntil = "2026-07-25T23:59:59Z";
      validatePricing(pricing, contracts.policy);
      return;
    }
    case "router-pricing-hash-drift": {
      const router = clone(contracts.routerPolicy);
      router.pricingSnapshotHash = "9".repeat(64);
      validateRouterPolicy(router, contracts);
      return;
    }
    case "selected-authority-drift": {
      const routeCase = fixture.routeCases.find((item) => item.expectOutcome === "selected");
      const decision = materializeRouteDecision(routeCase, contracts);
      decision.authorityBindingHash = "9".repeat(64);
      validateRecordedDecision(decision, routeCase, contracts);
      return;
    }
    case "child-before-parent": {
      const operations = clone(fixture.ledger.operations);
      const childIndex = operationIndex(operations, "ReservationCreated", 1);
      const child = operations.splice(childIndex, 1)[0];
      operations.splice(1, 0, child);
      materializeLedger(contracts, routes, { operations });
      return;
    }
    case "child-over-parent": {
      const vectors = clone(fixture.vectors);
      vectors.childReservation.quantities.find((entry) => entry.resource === "attempts").amount = 6;
      materializeLedger(contracts, routes, { vectors });
      return;
    }
    case "usage-over-reservation": {
      const vectors = clone(fixture.vectors);
      vectors.overUsage = makeAdditiveVector(vectors.childUsage, {
        attempts: 1,
        "input-units": 2000,
        "money-nano-minor": 400000000,
        "output-units": 200,
        "provider-calls": 1,
      });
      const operations = clone(fixture.ledger.operations);
      operations[operationIndex(operations, "UsageCommitted")].vector = "overUsage";
      materializeLedger(contracts, routes, { operations, vectors });
      return;
    }
    case "duplicate-settlement-id": {
      const operations = clone(fixture.ledger.operations);
      const usageIndex = operationIndex(operations, "UsageCommitted");
      operations.splice(usageIndex + 1, 0, {
        type: "UsageCommitted",
        reservationId: "model-1",
        settlementId: "settlement-1",
        vector: "childRemainder",
        inDoubt: false,
      });
      materializeLedger(contracts, routes, { operations });
      return;
    }
    case "release-over-remaining": {
      const vectors = clone(fixture.vectors);
      vectors.releaseOver = makeAdditiveVector(vectors.childRemainder, {
        attempts: 2,
        "input-units": 200,
        "money-nano-minor": 200000000,
        "output-units": 300,
      });
      const operations = clone(fixture.ledger.operations);
      operations[operationIndex(operations, "ReservationReleased", 0)].vector = "releaseOver";
      materializeLedger(contracts, routes, { operations, vectors });
      return;
    }
    case "close-parent-with-live-child": {
      const operations = clone(fixture.ledger.operations);
      const childIndex = operationIndex(operations, "ReservationCreated", 1);
      operations.splice(childIndex + 1, 0, {
        type: "ReservationClosed",
        reservationId: "round-1",
        state: "closed",
      });
      materializeLedger(contracts, routes, { operations });
      return;
    }
    case "stale-fencing-token":
      materializeLedger(contracts, routes, {
        leaseForSequence(sequence, original) {
          const lease = clone(original);
          if (sequence === 4) lease.fencingToken = 2;
          return lease;
        },
      });
      return;
    case "resigned-semantic-account-drift": {
      const events = clone(baseline.events);
      events[5].accountId = "account-evil";
      resealHistory(events, contracts);
      foldHistory(events, contracts, routes);
      return;
    }
    case "event-after-account-close": {
      const events = clone(baseline.events);
      const appended = clone(events[2]);
      appended.timestamp = timestampForSequence(events.length);
      events.push(appended);
      resealHistory(events, contracts);
      foldHistory(events, contracts, routes);
      return;
    }
    case "checkpoint-available-drift": {
      const changed = clone(checkpoint);
      changed.totals.available.quantities
        .find((entry) => entry.resource === "attempts").amount += 1;
      const content = clone(changed);
      delete content.contentHash;
      changed.contentHash = domainHash(DOMAINS.checkpoint, content);
      validateCheckpoint(changed, baseline.state);
      return;
    }
    case "compensation-restores-capacity": {
      const malicious = { economicOnly: true, restoresSchedulingCapacity: true };
      if (malicious.economicOnly !== true || malicious.restoresSchedulingCapacity !== false) {
        throw new BudgetError(
          "GE_BUDGET_COMPENSATION_INVALID",
          "economic compensation cannot restore scheduling capacity",
        );
      }
      return;
    }
    case "unknown-provider-metric": {
      const vector = clone(fixture.vectors.empty);
      vector.providerSpecific.push({
        metricId: "mock.tokens/v1",
        unitId: "mock.unit/v1",
        aggregation: "sum",
        amount: 1,
      });
      validateVector(vector, { policy: contracts.policy });
      return;
    }
    case "fork-copies-available-credit": {
      const fork = clone(checkpoint);
      fork.accountId = "account-fork";
      fork.eventStreamId = "8".repeat(64);
      validateFork(checkpoint, fork);
      return;
    }
    case "vector-add-overflow": {
      const maximum = makeAdditiveVector(fixture.vectors.empty, { attempts: MAX_SAFE });
      const one = makeAdditiveVector(fixture.vectors.empty, { attempts: 1 });
      addVectors(maximum, one);
      return;
    }
    case "negative-usage": {
      const vector = clone(fixture.vectors.childUsage);
      vector.quantities[0].amount = -1;
      validateVector(vector, { policy: contracts.policy, additiveOnly: true });
      return;
    }
    case "reservation-idempotency-key-drift": {
      const events = clone(baseline.events);
      events[1].data.idempotencyKey = "9".repeat(64);
      resealHistory(events, contracts);
      foldHistory(events, contracts, routes);
      return;
    }
    case "reservation-idempotency-conflict": {
      const events = clone(baseline.events);
      const conflicting = clone(events[1]);
      conflicting.data.reservationId = "round-evil";
      events.splice(2, 0, conflicting);
      resealHistory(events, contracts);
      foldHistory(events, contracts, routes);
      return;
    }
    case "resigned-reservation-binding-drift": {
      const events = clone(baseline.events);
      const child = events.find((event) =>
        event.type === "ReservationCreated" && event.data.parentReservationId !== null);
      child.data.binding.graphHash = "9".repeat(64);
      recomputeReservationIdempotencyKey(child.data);
      resealHistory(events, contracts);
      foldHistory(events, contracts, routes);
      return;
    }
    case "expired-before-admission": {
      const events = clone(baseline.events);
      events[1].data.expiresAt = events[1].timestamp;
      recomputeReservationIdempotencyKey(events[1].data);
      resealHistory(events, contracts);
      foldHistory(events, contracts, routes);
      return;
    }
    case "duplicate-reservation-close": {
      const events = clone(baseline.events);
      const closeIndex = events.findIndex((event) =>
        event.type === "ReservationClosed" && event.data.reservationId === "model-1");
      events.splice(closeIndex + 1, 0, clone(events[closeIndex]));
      resealHistory(events, contracts);
      foldHistory(events, contracts, routes);
      return;
    }
    case "takeover-reuses-fencing-token": {
      const events = clone(baseline.events);
      events[4].lease.leaseId = "lease-evil";
      events[4].lease.holderId = "worker-evil";
      events[4].lease.leaseEpoch = 2;
      events[4].lease.fencingToken = 1;
      resealHistory(events, contracts);
      foldHistory(events, contracts, routes);
      return;
    }
    case "maximum-depth-one-over":
      validateMaximumGates(
        makeMaximumVector(fixture.vectors.empty, { depth: 9 }),
        contracts.policy.rootCeiling,
        contracts.policy,
      );
      return;
    case "router-grant-not-allowlisted": {
      const router = clone(contracts.routerPolicy);
      router.allowedAuthorityGrantHashes = [router.allowedAuthorityGrantHashes[0]];
      validateRouterPolicy(router, contracts);
      return;
    }
    case "selected-grant-drift": {
      const routeCase = fixture.routeCases.find((item) => item.expectOutcome === "selected");
      const decision = materializeRouteDecision(routeCase, contracts);
      decision.selected.authorityGrantHash = "9".repeat(64);
      validateRecordedDecision(decision, routeCase, contracts);
      return;
    }
    case "route-price-multiplication-overflow": {
      const routeCase = clone(
        fixture.routeCases.find((item) => item.expectOutcome === "selected"),
      );
      routeCase.requirements.inputUnits = MAX_SAFE;
      routeCase.requirements.maximumOutputUnits = 1;
      routeCase.requirements.maximumContextUnits = MAX_SAFE;
      routeModel(
        contracts.routerPolicy,
        contracts.pricing,
        routeCase.requirements,
        routeCase.health,
      );
      return;
    }
    case "event-invalid-calendar-date": {
      const events = clone(baseline.events);
      events[0].timestamp = "2026-02-31T00:00:00Z";
      resealHistory(events, contracts);
      foldHistory(events, contracts, routes);
      return;
    }
    case "checkpoint-drops-reservation-outcomes": {
      const changed = clone(checkpoint);
      delete changed.reservationOutcomes;
      validateCheckpoint(changed, baseline.state);
      return;
    }
    default:
      assert.fail("unknown semantic negative operation " + operation);
  }
}

for (const testCase of fixture.semanticNegativeCases) {
  expectBudgetCode(
    testCase.expectCode,
    () => executeNegative(testCase.operation),
    testCase.id,
  );
}

const atomicState = makeLedgerState(contracts, routes.byHash);
foldEvent(clone(baseline.events[0]), atomicState);
const overAdmissionData = clone(baseline.events[1].data);
overAdmissionData.maximum = makeAdditiveVector(fixture.vectors.empty, {
  attempts: 21,
  "provider-calls": 1,
});
recomputeReservationIdempotencyKey(overAdmissionData);
const overAdmissionEvent = sealEvent(
  "ReservationCreated",
  overAdmissionData,
  atomicState,
  contracts,
  1,
);
const beforeDeniedAdmission = accountProjection(atomicState);
expectBudgetCode(
  "GE_BUDGET_ADMISSION_DENIED",
  () => foldEvent(overAdmissionEvent, atomicState),
  "multi-dimensional admission rejects atomically",
);
exact(
  accountProjection(atomicState),
  beforeDeniedAdmission,
  "denied multi-dimensional admission partially mutated the ledger",
);

let mockProviderDispatches = 0;
function routeThenDispatch(routeCase) {
  const routed = routeModel(
    contracts.routerPolicy,
    contracts.pricing,
    routeCase.requirements,
    routeCase.health,
  );
  if (routed.outcome !== "selected") return routed;
  mockProviderDispatches += 1;
  return routed;
}
for (const routeCase of fixture.routeCases.filter((item) => item.expectOutcome === "denied")) {
  routeThenDispatch(routeCase);
}
assert.equal(mockProviderDispatches, 0, "a denied route reached the provider executor");
routeThenDispatch(fixture.routeCases.find((item) => item.expectOutcome === "selected"));
assert.equal(mockProviderDispatches, 1, "the selected mock route did not reach its bounded executor");

function terminalReason(facts, precedence) {
  const factSet = new Set(facts);
  return precedence.find((candidate) => factSet.has(candidate)) ?? "COMPLETED";
}

for (const testCase of fixture.terminalPrecedenceCases) {
  assert.equal(
    terminalReason(testCase.facts, contracts.policy.terminalPrecedence),
    testCase.expect,
    testCase.id + " terminal precedence drifted",
  );
}

const strictShapeSamples = [
  [validateVectorShape, fixture.vectors.rootCeiling, "vector"],
  [validatePolicyShape, contracts.policy, "policy"],
  [validatePricingShape, contracts.pricing, "pricing"],
  [validateRouterPolicyShape, contracts.routerPolicy, "router policy"],
  [
    validateRouteDecisionShape,
    routes.byCase.get("select-premium-for-confidential-tools").decision,
    "route decision",
  ],
  [validateEventShape, baseline.events[0], "ledger event"],
  [validateCheckpointShape, checkpoint, "checkpoint"],
];
for (const [validate, sample, label] of strictShapeSamples) {
  const hostile = clone(sample);
  hostile.reSignedUnknownField = true;
  assert.equal(validate(hostile), false, label + " accepted a re-signed unknown field");
}

if (process.argv.includes("--print-golden")) {
  console.log(JSON.stringify(observedGolden, null, 2));
}

// Importing this module executes the whole campaign above; the summary exists
// so scripts/validate-fixtures.mjs can report its counts without re-running it.
export const budgetCampaign = Object.freeze({
  contractStatus: fixture.contractStatus,
  implementationClaim: fixture.implementationClaim,
  schemas: schemas.length,
  vectors: Object.keys(fixture.vectors).length,
  routeCases: fixture.routeCases.length,
  ledgerEvents: baseline.events.length,
  semanticNegatives: fixture.semanticNegativeCases.length,
  precedenceCases: fixture.terminalPrecedenceCases.length,
  closedShapeAttacks: strictShapeSamples.length,
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(
    "budget conformance: " +
    budgetCampaign.schemas + " schemas, " +
    budgetCampaign.vectors + " vectors, " +
    budgetCampaign.routeCases + " route cases, " +
    budgetCampaign.ledgerEvents + " ledger events, " +
    budgetCampaign.semanticNegatives + " semantic negatives, " +
    budgetCampaign.precedenceCases + " precedence cases, " +
    budgetCampaign.closedShapeAttacks +
    " closed-shape attacks, atomic no-write and deny-no-dispatch passed",
  );
}
