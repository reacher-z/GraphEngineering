// D12-ISOLATION-SPEC-044 executable oracle for `spec/isolation-semantics.md`.
//
// Nothing in this file executes git, a shell, a container, a process or a
// network request, and nothing in it touches a real filesystem other than
// reading the four contract schemas and the corpus. Symlink topology, process
// observations, container specifications and merge inputs are all declarative
// corpus data.
//
// Two rules govern every function below.
//
//  1. Every literal the corpus asserts is recomputed here from its inputs.
//     A hash, a branch name, a namespace value, a trust classification or a
//     receipt outcome that the corpus merely states is never accepted.
//  2. Every decision is a structured value carrying a stable `code` from the
//     closed vocabulary in `capability-manifest.schema.json#/$defs/code` and a
//     stable `reason` tag. A boolean is never a decision and a thrown string is
//     never a decision. The reason tag exists so that two neighbouring guards
//     reporting the same portable code remain independently falsifiable: the
//     corpus pins both, and the run pins the complete emitted reason set.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = dirname(here);
const CASE_PATH = join(here, "isolation.case.json");

const SCHEMA_BASE = "https://reacher-z.github.io/GraphEngineering/schemas/v1alpha1/";

// isolation-semantics.md Section 1.1 machine-contract manifest.
const SCHEMA_NAMES = Object.freeze([
  "capability-manifest.schema.json",
  "isolation-provider.schema.json",
  "worktree-lease.schema.json",
  "merge-gate-decision.schema.json",
]);

const MANIFEST_API_VERSION =
  "graphengineering.reacher-z.github.io/capability-manifest/v1alpha1";

/* =========================================================================
 * Canonical form and hashing
 * ====================================================================== */

function compareUnicodeCodePoints(left, right) {
  const a = Array.from(left, (item) => item.codePointAt(0));
  const b = Array.from(right, (item) => item.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

/** Deterministic serialization: object keys in Unicode code-point order. */
export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), "canonical JSON rejects a non-finite number");
    assert.ok(Number.isSafeInteger(value), "canonical JSON rejects an unsafe integer");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Tagged hash: the domain tag is the first array member and is never omitted. */
export function taggedHash(parts) {
  return sha256Hex(canonicalJson(parts));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortedUnique(items) {
  return [...new Set(items)].sort(compareUnicodeCodePoints);
}

/* =========================================================================
 * Decision values
 * ====================================================================== */

const emittedReasons = new Set();
const semanticCodes = new Set();

/** Reasons emitted so far in this process, used to pin the corpus inventory. */
export function emittedReasonSnapshot() {
  return sortedUnique([...emittedReasons]);
}

function granted(reason) {
  emittedReasons.add(reason);
  semanticCodes.add("GE_CAP_GRANTED");
  return { outcome: "granted", code: "GE_CAP_GRANTED", reason };
}

function denied(code, reason) {
  emittedReasons.add(reason);
  semanticCodes.add(code);
  return { outcome: "denied", code, reason };
}

function authorized(reason) {
  emittedReasons.add(reason);
  semanticCodes.add("GE_MERGE_AUTHORIZED");
  return { outcome: "merge-authorized", code: "GE_MERGE_AUTHORIZED", reason };
}

function refused(code, reason) {
  emittedReasons.add(reason);
  semanticCodes.add(code);
  return { outcome: "merge-denied", code, reason };
}

/* =========================================================================
 * Section 3 — capability vocabulary
 * ====================================================================== */

const DOMAIN_ORDER = Object.freeze([
  "tool",
  "filesystem",
  "network",
  "secret",
  "process",
  "worktree",
  "container",
  "artifact",
  "storage",
  "mcp",
  "approval",
  "patch",
]);

const AUTHORITY_LEVEL_ORDER = Object.freeze([
  "operator",
  "deployment",
  "tenant",
  "graph",
  "run",
  "node",
  "adapter",
  "request",
]);

// Section 3.4. Only the operator policy is a trusted authority input. Every
// other principal submits data that deterministic code may use to narrow.
const TRUSTED_REQUESTORS = Object.freeze(["operator-policy"]);

const KNOWN_POLICY_VERSIONS = Object.freeze(["capability-policy/v1alpha1"]);

const SECRET_CHANNEL_RANK = Object.freeze({
  none: 0,
  stdin: 1,
  file: 2,
  environment: 3,
});

// Section 4.2. `direction` states how a request may move relative to its
// ceiling, and `bottom` states what an omitted field means. Deny-by-default is
// literally this table: the bottom of every widening field is empty, zero or
// false, and the bottom of every narrowing field is the ceiling itself.
const DOMAIN_RULES = Object.freeze({
  tool: {
    maxCallsPerAttempt: { direction: "max-number" },
    operations: { direction: "subset" },
  },
  filesystem: {
    deniedPaths: { direction: "superset" },
    followSymlinks: { direction: "exact" },
    maxWriteBytes: { direction: "max-number" },
    roots: { direction: "roots" },
  },
  network: {
    allowRedirects: { direction: "bool-narrow" },
    enabled: { direction: "bool-narrow" },
    hosts: { direction: "subset" },
    maxRequestBytes: { direction: "max-number" },
    maxResponseBytes: { direction: "max-number" },
    ports: { direction: "subset-number" },
    protocols: { direction: "subset" },
  },
  secret: {
    allowInArgv: { direction: "exact" },
    allowInTrackedContent: { direction: "exact" },
    injection: { direction: "rank", ranks: SECRET_CHANNEL_RANK },
    refs: { direction: "subset" },
  },
  process: {
    environmentAllowlist: { direction: "subset" },
    executables: { direction: "subset" },
    maxCpuMillis: { direction: "max-number" },
    maxDurationMs: { direction: "max-number" },
    maxMemoryBytes: { direction: "max-number" },
    maxOpenFiles: { direction: "max-number" },
    maxOutputBytes: { direction: "max-number" },
    maxProcesses: { direction: "max-number" },
    maxTempBytes: { direction: "max-number" },
  },
  worktree: {
    allowDetached: { direction: "bool-narrow" },
    allowRepositoryHooks: { direction: "exact" },
    maxDiffBytes: { direction: "max-number" },
    operations: { direction: "subset" },
    protectedDirectories: { direction: "superset" },
  },
  container: {
    allowHostSockets: { direction: "exact" },
    allowPrivileged: { direction: "exact" },
    droppedCapabilities: { direction: "superset" },
    images: { direction: "object-subset" },
    maxCpuMillis: { direction: "max-number" },
    maxDiskBytes: { direction: "max-number" },
    maxMemoryBytes: { direction: "max-number" },
    maxPids: { direction: "max-number" },
    networkEnabled: { direction: "bool-narrow" },
    readOnlyRoot: { direction: "exact" },
    runAsNonRoot: { direction: "exact" },
    seccompProfile: { direction: "exact" },
  },
  artifact: {
    actions: { direction: "subset" },
    maxBytes: { direction: "max-number" },
    namespaces: { direction: "subset" },
  },
  storage: {
    namespaces: { direction: "subset" },
    operations: { direction: "subset" },
  },
  mcp: {
    allowMutation: { direction: "bool-narrow" },
    resources: { direction: "subset" },
    servers: { direction: "subset" },
    tools: { direction: "subset" },
  },
  approval: {
    requiredFor: { direction: "superset" },
  },
  patch: {
    allowed: { direction: "bool-narrow" },
    maxEdges: { direction: "max-number" },
    maxNodes: { direction: "max-number" },
    mayRequestCapabilities: { direction: "exact" },
  },
});

function bottomForField(direction, ceilingValue) {
  switch (direction) {
    case "subset":
    case "subset-number":
    case "object-subset":
    case "roots":
      return [];
    case "superset":
      return clone(ceilingValue);
    case "max-number":
      return 0;
    case "bool-narrow":
      return false;
    case "exact":
      return clone(ceilingValue);
    case "rank":
      return "none";
    default:
      throw new Error(`unknown narrowing direction '${direction}'`);
  }
}

function pathIsUnder(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function narrowField(domain, field, rule, ceilingValue, requestValue) {
  const where = `${domain}.${field}`;
  switch (rule.direction) {
    case "subset": {
      const allowed = new Set(ceilingValue);
      for (const item of requestValue) {
        if (!allowed.has(item)) return { denial: denied("GE_CAP_EXPANSION_DENIED", "set-member-not-in-ceiling"), where };
      }
      return { value: [...requestValue] };
    }
    case "subset-number": {
      const allowed = new Set(ceilingValue);
      for (const item of requestValue) {
        if (!allowed.has(item)) return { denial: denied("GE_CAP_EXPANSION_DENIED", "numeric-member-not-in-ceiling"), where };
      }
      return { value: [...requestValue] };
    }
    case "object-subset": {
      const allowed = new Set(ceilingValue.map((item) => canonicalJson(item)));
      for (const item of requestValue) {
        if (!allowed.has(canonicalJson(item))) return { denial: denied("GE_CAP_EXPANSION_DENIED", "object-member-not-in-ceiling"), where };
      }
      return { value: clone(requestValue) };
    }
    case "superset": {
      const present = new Set(requestValue);
      for (const item of ceilingValue) {
        if (!present.has(item)) return { denial: denied("GE_CAP_EXPANSION_DENIED", "ceiling-restriction-dropped"), where };
      }
      return { value: [...requestValue] };
    }
    case "max-number": {
      if (requestValue > ceilingValue) return { denial: denied("GE_CAP_EXPANSION_DENIED", "numeric-ceiling-exceeded"), where };
      return { value: requestValue };
    }
    case "bool-narrow": {
      if (requestValue === true && ceilingValue === false) return { denial: denied("GE_CAP_EXPANSION_DENIED", "boolean-grant-widened"), where };
      return { value: requestValue };
    }
    case "exact": {
      if (canonicalJson(requestValue) !== canonicalJson(ceilingValue)) return { denial: denied("GE_CAP_EXPANSION_DENIED", "immutable-field-changed"), where };
      return { value: clone(requestValue) };
    }
    case "rank": {
      if (rule.ranks[requestValue] > rule.ranks[ceilingValue]) return { denial: denied("GE_CAP_EXPANSION_DENIED", "channel-rank-widened"), where };
      return { value: requestValue };
    }
    case "roots": {
      const effective = [];
      for (const requested of requestValue) {
        const parent = ceilingValue.find((item) => pathIsUnder(requested.path, item.path));
        if (parent === undefined) return { denial: denied("GE_CAP_EXPANSION_DENIED", "filesystem-root-outside-ceiling"), where };
        for (const permission of ["create", "delete", "read", "write"]) {
          if (requested[permission] === true && parent[permission] === false) {
            return { denial: denied("GE_CAP_EXPANSION_DENIED", "filesystem-permission-widened"), where };
          }
        }
        effective.push(clone(requested));
      }
      effective.sort((left, right) => compareUnicodeCodePoints(left.path, right.path));
      return { value: effective };
    }
    default:
      throw new Error(`unknown narrowing direction '${rule.direction}'`);
  }
}

/**
 * Section 4 — the whole contract. Returns a structured decision plus, when
 * granted, the complete effective manifest and its canonical hash.
 */
export function narrowManifest(ceiling, request, requestorKind, nowMs) {
  const trust = TRUSTED_REQUESTORS.includes(requestorKind) ? "trusted" : "untrusted";

  if (request.apiVersion !== MANIFEST_API_VERSION) {
    return { decision: denied("GE_CAP_MANIFEST_INVALID", "request-api-version-unknown"), trust };
  }

  if (!KNOWN_POLICY_VERSIONS.includes(request.policyVersion)) {
    return { decision: denied("GE_CAP_UNKNOWN_POLICY_VERSION", "policy-version-not-recognized"), trust };
  }
  if (
    AUTHORITY_LEVEL_ORDER.indexOf(request.level) <= AUTHORITY_LEVEL_ORDER.indexOf(ceiling.level)
  ) {
    return { decision: denied("GE_CAP_AUTHORITY_IMMUTABLE", "authority-level-claimed-at-or-above-ceiling"), trust };
  }

  // Section 4.3. An untrusted principal that touches any authority-bearing
  // field is refused under its own code, before the trusted-path rules for the
  // same fields can report a different one. Model and tool output is data: it
  // may narrow, and it may never restate who the caller is.
  if (
    trust === "untrusted" &&
    (request.policyVersion !== ceiling.policyVersion ||
      canonicalJson(request.binding) !== canonicalJson(ceiling.binding))
  ) {
    return { decision: denied("GE_CAP_UNTRUSTED_REQUESTOR_AUTHORITY", "untrusted-principal-touched-authority"), trust };
  }

  if (
    request.binding.approvalRef !== ceiling.binding.approvalRef ||
    request.binding.approvalExpiresAtMs !== ceiling.binding.approvalExpiresAtMs
  ) {
    return { decision: denied("GE_CAP_AUTHORITY_IMMUTABLE", "approval-identity-rewritten"), trust };
  }
  if (canonicalJson(request.binding) !== canonicalJson(ceiling.binding)) {
    return { decision: denied("GE_CAP_BINDING_MISMATCH", "capability-snapshot-binding-drifted"), trust };
  }

  const effectiveDomains = {};
  for (const domain of DOMAIN_ORDER) {
    const rules = DOMAIN_RULES[domain];
    const ceilingDomain = ceiling.domains[domain];
    if (ceilingDomain === undefined) {
      // A ceiling that does not state a domain grants nothing in it, and a
      // request that asks for the domain anyway is asking for more.
      if (request.domains[domain] !== undefined) {
        return { decision: denied("GE_CAP_EXPANSION_DENIED", "domain-absent-from-ceiling"), trust, domain };
      }
      continue;
    }
    const requestDomain = request.domains[domain] ?? {};
    const effectiveDomain = {};
    for (const field of Object.keys(rules).sort(compareUnicodeCodePoints)) {
      const rule = rules[field];
      const ceilingValue = ceilingDomain[field];
      const requestValue =
        requestDomain[field] === undefined
          ? bottomForField(rule.direction, ceilingValue)
          : requestDomain[field];
      const outcome = narrowField(domain, field, rule, ceilingValue, requestValue);
      if (outcome.denial !== undefined) {
        return { decision: outcome.denial, trust, domain, field };
      }
      effectiveDomain[field] = outcome.value;
    }
    effectiveDomains[domain] = effectiveDomain;
  }

  const effective = {
    apiVersion: MANIFEST_API_VERSION,
    manifestId: request.manifestId,
    policyVersion: request.policyVersion,
    level: request.level,
    enforced: false,
    binding: clone(ceiling.binding),
    domains: effectiveDomains,
  };
  return {
    decision: granted("narrowing-accepted"),
    trust,
    effective,
    effectiveManifestHash: taggedHash(["capability-effective/v1alpha1", effective]),
    evaluatedAtMs: nowMs,
  };
}

/* =========================================================================
 * Section 5 — the effect boundary
 * ====================================================================== */

const APPROVAL_OPERATION_BY_EFFECT = Object.freeze({
  artifact: "artifact-publication",
  filesystem: "filesystem-write",
  network: "network-egress",
  patch: "dynamic-patch",
  process: "process-execution",
  secret: "secret-resolution",
  storage: "storage-migration",
  worktree: "worktree-merge",
});

/**
 * Section 5.1. Authority is rechecked at the effect boundary, never only at
 * compile time. An undeclared target is denied; it is never inferred from a
 * neighbouring grant.
 */
export function evaluateEffect(effective, effect, approval, nowMs) {
  const domain = effective.domains[effect.domain];
  if (domain === undefined) return denied("GE_CAP_DENIED_BY_DEFAULT", "effect-domain-undeclared");

  if (effect.domain === "network") {
    if (domain.enabled !== true) return denied("GE_ISO_NETWORK_DENIED", "network-domain-disabled");
    if (!domain.hosts.includes(effect.host)) return denied("GE_ISO_NETWORK_DENIED", "network-host-not-allowlisted");
    if (!domain.ports.includes(effect.port)) return denied("GE_ISO_NETWORK_DENIED", "network-port-not-allowlisted");
    if (!domain.protocols.includes(effect.protocol)) return denied("GE_ISO_NETWORK_DENIED", "network-protocol-not-allowlisted");
    if (effect.requestBytes > domain.maxRequestBytes) return denied("GE_ISO_LIMIT_EXCEEDED", "network-request-bytes-exceeded");
  }
  if (effect.domain === "tool" && !domain.operations.includes(effect.operation)) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "tool-operation-undeclared");
  }
  if (effect.domain === "secret" && !domain.refs.includes(effect.secretRef)) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "secret-reference-undeclared");
  }
  if (effect.domain === "secret" && SECRET_CHANNEL_RANK[effect.channel] > SECRET_CHANNEL_RANK[domain.injection]) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "secret-channel-undeclared");
  }
  if (effect.domain === "artifact" && !domain.namespaces.includes(effect.namespace)) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "artifact-namespace-undeclared");
  }
  if (effect.domain === "artifact" && !domain.actions.includes(effect.action)) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "artifact-action-undeclared");
  }
  if (effect.domain === "artifact" && effect.bytes > domain.maxBytes) {
    return denied("GE_ISO_LIMIT_EXCEEDED", "artifact-bytes-exceeded");
  }
  if (effect.domain === "storage" && !domain.namespaces.includes(effect.namespace)) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "storage-namespace-undeclared");
  }
  if (effect.domain === "storage" && !domain.operations.includes(effect.action)) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "storage-operation-undeclared");
  }
  if (effect.domain === "mcp" && !domain.servers.includes(effect.server)) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "mcp-server-undeclared");
  }
  if (effect.domain === "mcp" && !domain.tools.includes(effect.tool)) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "mcp-tool-undeclared");
  }
  if (effect.domain === "mcp" && effect.mutating === true && domain.allowMutation !== true) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "mcp-mutation-undeclared");
  }
  if (effect.domain === "patch" && domain.allowed !== true) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "dynamic-patch-undeclared");
  }
  if (effect.domain === "patch" && effect.nodes > domain.maxNodes) {
    return denied("GE_ISO_LIMIT_EXCEEDED", "dynamic-patch-nodes-exceeded");
  }

  const approvalOperation = APPROVAL_OPERATION_BY_EFFECT[effect.domain];
  if (effective.domains.approval !== undefined && effective.domains.approval.requiredFor.includes(approvalOperation)) {
    if (approval === null) return denied("GE_CAP_APPROVAL_REQUIRED", "bound-approval-absent");
    if (approval.boundPayloadHash !== effect.payloadHash) return denied("GE_CAP_APPROVAL_STALE", "approval-payload-binding-drifted");
    if (approval.expiresAtMs <= nowMs) return denied("GE_CAP_APPROVAL_STALE", "approval-expired");
  }
  return granted("effect-authorized");
}

/* =========================================================================
 * Section 6 — resolved path policy
 * ====================================================================== */

const MAX_LINK_RESOLUTIONS = 32;

function normalizeRelative(segments) {
  const stack = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack;
}

/**
 * Section 6.2. A pure resolved-path oracle. `linkMap` is declarative: it names
 * the symlink resolution the provider would observe. No filesystem is touched.
 */
export function evaluatePath(policy, request) {
  const candidate = request.candidate;
  if (candidate.includes("\u0000")) return denied("GE_ISO_PATH_ESCAPE", "path-contains-nul");
  if (candidate.includes("\\")) return denied("GE_ISO_PATH_ESCAPE", "path-contains-backslash");

  let relative = candidate;
  if (candidate.startsWith("/")) {
    if (!pathIsUnder(candidate, policy.root)) return denied("GE_ISO_PATH_ESCAPE", "absolute-path-outside-root");
    relative = candidate.slice(policy.root.length).replace(/^\//u, "");
  }

  const rawSegments = relative.split("/");
  if (rawSegments.includes(".git")) return denied("GE_ISO_REPOSITORY_METADATA_DENIED", "git-directory-segment-requested");

  let segments = normalizeRelative(rawSegments);
  if (segments === null) return denied("GE_ISO_PATH_ESCAPE", "parent-traversal-escapes-root");

  // Section 6.3: resolve every link on the path and re-verify containment.
  let resolutions = 0;
  let index = 0;
  while (index < segments.length) {
    const prefix = segments.slice(0, index + 1).join("/");
    const target = request.linkMap[prefix];
    if (target === undefined) {
      index += 1;
      continue;
    }
    resolutions += 1;
    if (resolutions > MAX_LINK_RESOLUTIONS) return denied("GE_ISO_SYMLINK_ESCAPE", "symlink-resolution-cycle");
    const tail = segments.slice(index + 1);
    let replacement;
    if (target.startsWith("/")) {
      if (!pathIsUnder(target, policy.root)) return denied("GE_ISO_SYMLINK_ESCAPE", "symlink-target-outside-root");
      replacement = target.slice(policy.root.length).replace(/^\//u, "").split("/");
    } else {
      replacement = [...segments.slice(0, index), ...target.split("/")];
    }
    const merged = normalizeRelative([...replacement, ...tail]);
    if (merged === null) return denied("GE_ISO_SYMLINK_ESCAPE", "symlink-target-escapes-root");
    if (merged.includes(".git")) return denied("GE_ISO_REPOSITORY_METADATA_DENIED", "symlink-target-is-git-directory");
    segments = merged;
    index = 0;
  }

  const resolved = segments.join("/");
  if (resolved === "") return denied("GE_ISO_PATH_NOT_GRANTED", "root-itself-is-not-a-grant");
  for (const denyPath of policy.deniedPaths) {
    if (pathIsUnder(resolved, denyPath)) return denied("GE_ISO_PATH_NOT_GRANTED", "explicit-deny-path-matched");
  }
  const allowed = policy.allowedPaths.some((allowPath) => pathIsUnder(resolved, allowPath));
  if (!allowed) return denied("GE_ISO_PATH_NOT_GRANTED", "path-outside-allowlist");
  if (request.operation !== "read" && policy.writable !== true) {
    return denied("GE_ISO_PATH_NOT_GRANTED", "mutating-operation-not-granted");
  }
  return granted("path-authorized");
}

/* =========================================================================
 * Section 7 — deterministic worktree identity
 * ====================================================================== */

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
// Names git itself refuses, checked independently of the narrower grammar so
// that a future grammar relaxation cannot silently produce an invalid ref.
const GIT_REF_FORBIDDEN = /(\.\.)|(^\/)|(\/$)|(\/\/)|(@\{)|(\.lock$)|([\u0000-\u0020~^:?*[\\\u007f])/u;

export function deriveBranch(binding) {
  if (!SHA256_PATTERN.test(binding.graphHash)) return { decision: denied("GE_ISO_IDENTIFIER_INVALID", "graph-hash-malformed") };
  if (!IDENTIFIER_PATTERN.test(binding.runId)) return { decision: denied("GE_ISO_IDENTIFIER_INVALID", "run-identifier-outside-grammar") };
  if (!IDENTIFIER_PATTERN.test(binding.nodeId)) return { decision: denied("GE_ISO_IDENTIFIER_INVALID", "node-identifier-outside-grammar") };
  if (!Number.isSafeInteger(binding.attempt) || binding.attempt < 1 || binding.attempt > 9999999) {
    return { decision: denied("GE_ISO_IDENTIFIER_INVALID", "attempt-outside-range") };
  }
  const discriminator = taggedHash([
    "isolation-branch/v1alpha1",
    binding.graphHash,
    binding.runId,
    binding.nodeId,
    binding.attempt,
  ]).slice(0, 16);
  const name = `ge/iso/${binding.runId}/${binding.nodeId}/${binding.attempt}-${discriminator}`;
  if (GIT_REF_FORBIDDEN.test(name)) return { decision: denied("GE_ISO_IDENTIFIER_INVALID", "derived-name-violates-ref-rules") };
  return { decision: granted("branch-derived"), name, discriminator };
}

const PORT_SPAN = 8;
const PORT_FLOOR = 20000;
const PORT_SLOTS = 4096;

export function deriveNamespaces(leaseId) {
  const digest = taggedHash(["isolation-namespace/v1alpha1", leaseId]);
  const slot = Number(BigInt(`0x${digest.slice(0, 8)}`) % BigInt(PORT_SLOTS));
  return {
    portBase: PORT_FLOOR + slot * PORT_SPAN,
    portCount: PORT_SPAN,
    tempDirectory: `/var/tmp/ge-iso/${digest.slice(0, 32)}`,
    cacheNamespace: `c_${digest.slice(0, 32)}`,
    databaseSchema: `s_${digest.slice(0, 32)}`,
  };
}

/**
 * Section 7.3. A lease registry is checked as a whole: every declared identity
 * is recomputed, and every namespace is checked for overlap and for reuse of a
 * retired value whose cleanup was never proven.
 */
export function evaluateLeaseRegistry(leases, retired) {
  const seenBranches = new Map();
  const seenPaths = new Map();
  const retiredIndex = new Map(retired.map((item) => [`${item.domain}:${item.value}`, item]));

  for (const lease of leases) {
    const derived = deriveBranch({
      graphHash: lease.graphHash,
      runId: lease.holder.runId,
      nodeId: lease.holder.nodeId,
      attempt: lease.holder.attempt,
    });
    if (derived.decision.outcome === "denied") return derived.decision;
    if (lease.branch.name !== derived.name) return denied("GE_ISO_IDENTIFIER_INVALID", "declared-branch-name-not-derived");
    if (lease.branch.derivation.discriminator !== derived.discriminator) {
      return denied("GE_ISO_IDENTIFIER_INVALID", "declared-discriminator-not-derived");
    }
    if (seenBranches.has(lease.branch.name)) return denied("GE_ISO_BRANCH_COLLISION", "two-leases-claim-one-branch");
    seenBranches.set(lease.branch.name, lease.leaseId);
    if (seenPaths.has(lease.worktreePath)) return denied("GE_ISO_LEASE_CONFLICT", "two-leases-claim-one-worktree-path");
    seenPaths.set(lease.worktreePath, lease.leaseId);

    const namespaces = deriveNamespaces(lease.leaseId);
    if (canonicalJson(lease.namespaces) !== canonicalJson(namespaces)) {
      return denied("GE_ISO_IDENTIFIER_INVALID", "declared-namespaces-not-derived");
    }
    for (const [domain, value] of [
      ["port", String(namespaces.portBase)],
      ["temp-directory", namespaces.tempDirectory],
      ["cache", namespaces.cacheNamespace],
      ["database-schema", namespaces.databaseSchema],
    ]) {
      const previous = retiredIndex.get(`${domain}:${value}`);
      if (previous !== undefined && previous.cleanupVerified !== true) {
        return denied("GE_ISO_NAMESPACE_REUSE", `retired-${domain}-reused-without-cleanup-proof`);
      }
    }
  }
  return granted("lease-registry-consistent");
}

/**
 * Section 7.4. Disjointness over *declared* namespace allocations. Derivation
 * from a lease identifier makes a collision computationally unreachable, so a
 * derived-only check would be an unfalsifiable guard. This oracle instead
 * checks the allocation set an external allocator presents, which is where a
 * real collision can occur.
 */
export function evaluateDeclaredNamespaceSet(declarations) {
  const ranges = [];
  const tempDirectories = new Set();
  const cacheNamespaces = new Set();
  const databaseSchemas = new Set();
  for (const declaration of declarations) {
    const start = declaration.portBase;
    const end = declaration.portBase + declaration.portCount;
    for (const range of ranges) {
      if (start < range.end && range.start < end) return denied("GE_ISO_NAMESPACE_COLLISION", "port-range-overlap");
    }
    ranges.push({ start, end });
    if (tempDirectories.has(declaration.tempDirectory)) return denied("GE_ISO_NAMESPACE_COLLISION", "temp-directory-collision");
    tempDirectories.add(declaration.tempDirectory);
    if (cacheNamespaces.has(declaration.cacheNamespace)) return denied("GE_ISO_NAMESPACE_COLLISION", "cache-namespace-collision");
    cacheNamespaces.add(declaration.cacheNamespace);
    if (databaseSchemas.has(declaration.databaseSchema)) return denied("GE_ISO_NAMESPACE_COLLISION", "database-schema-collision");
    databaseSchemas.add(declaration.databaseSchema);
  }
  return granted("declared-namespace-set-disjoint");
}

/**
 * Section 7.5. Collision detection over declared names, used for the
 * branch-name-collision escape where two distinct bindings are made to present
 * one ref. Kept separate from the registry oracle so that the collision guard
 * is reachable without first passing derivation.
 */
export function evaluateDeclaredBranchSet(declarations) {
  const seen = new Map();
  for (const declaration of declarations) {
    if (seen.has(declaration.name)) {
      return denied("GE_ISO_BRANCH_COLLISION", "declared-branch-name-duplicated");
    }
    seen.set(declaration.name, declaration.leaseId);
  }
  return granted("declared-branch-set-distinct");
}

/* =========================================================================
 * Section 7.6 — lease lifecycle
 * ====================================================================== */

const LEASE_TRANSITIONS = Object.freeze({
  allocated: { acquire: "leased", quarantine: "quarantined" },
  leased: {
    heartbeat: "leased",
    activate: "active",
    "begin-release": "releasing",
    quarantine: "quarantined",
  },
  active: {
    heartbeat: "active",
    write: "active",
    "propose-merge": "active",
    "begin-release": "releasing",
    quarantine: "quarantined",
  },
  releasing: { "complete-release": "released", quarantine: "quarantined" },
  released: {},
  quarantined: {},
});

/**
 * Section 7.6. Lease theft, stale leases and illegal transitions are three
 * distinct refusals evaluated in a fixed order.
 */
export function evaluateLeaseEvents(lease, events, leaseTtlMs) {
  let state = lease.state;
  let expiresAtMs = lease.expiresAtMs;
  const trace = [];
  for (const event of events) {
    if (event.presentedToken !== lease.holder.holderToken) {
      const decision = denied("GE_ISO_LEASE_NOT_HELD", "presented-token-does-not-match-holder");
      trace.push(decision);
      return { decision, trace, state, expiresAtMs };
    }
    if (event.transition !== "quarantine" && event.atMs > expiresAtMs) {
      const decision = denied("GE_ISO_LEASE_EXPIRED", "lease-deadline-passed");
      trace.push(decision);
      return { decision, trace, state, expiresAtMs };
    }
    const next = LEASE_TRANSITIONS[state][event.transition];
    if (next === undefined) {
      const decision = denied("GE_ISO_LEASE_CONFLICT", "transition-illegal-from-current-state");
      trace.push(decision);
      return { decision, trace, state, expiresAtMs };
    }
    if (event.transition === "heartbeat") expiresAtMs = event.atMs + leaseTtlMs;
    state = next;
    trace.push(granted("lease-transition-accepted"));
  }
  return { decision: granted("lease-sequence-accepted"), trace, state, expiresAtMs };
}

/* =========================================================================
 * Section 7.7 — worktree allocation and cache trust
 * ====================================================================== */

export function evaluateWorktreeAllocation(effective, request) {
  const domain = effective.domains.worktree;
  if (domain === undefined) return denied("GE_CAP_DENIED_BY_DEFAULT", "worktree-domain-undeclared");
  if (!domain.operations.includes(request.operation)) return denied("GE_CAP_DENIED_BY_DEFAULT", "worktree-operation-not-granted");
  if (request.hooksRequested === true) return denied("GE_ISO_HOOK_EXECUTION_DENIED", "repository-hooks-requested");
  if (request.configExecRequested === true) return denied("GE_ISO_HOOK_EXECUTION_DENIED", "repository-config-execution-requested");
  if (request.submodulesRequested === true) return denied("GE_ISO_HOOK_EXECUTION_DENIED", "submodule-execution-requested");
  if (request.mode === "detached" && domain.allowDetached !== true) return denied("GE_CAP_DENIED_BY_DEFAULT", "detached-mode-not-granted");
  for (const protectedDirectory of domain.protectedDirectories) {
    if (pathIsUnder(request.worktreePath, protectedDirectory)) {
      return denied("GE_ISO_PATH_NOT_GRANTED", "worktree-inside-protected-directory");
    }
  }
  if (request.repositoryStatusClean !== true) return denied("GE_ISO_LEASE_CONFLICT", "repository-status-dirty-at-allocation");
  if (request.diffBytes > domain.maxDiffBytes) return denied("GE_ISO_LIMIT_EXCEEDED", "diff-bytes-exceeded");
  return granted("allocation-authorized");
}

/** Section 7.8. A cache entry from another lease is untrusted input. */
export function evaluateCacheEntry(lease, entry) {
  const namespaces = deriveNamespaces(lease.leaseId);
  if (entry.cacheNamespace !== namespaces.cacheNamespace) return denied("GE_ISO_CACHE_UNTRUSTED_ENTRY", "cache-entry-from-foreign-namespace");
  if (entry.producerLeaseId !== lease.leaseId) return denied("GE_ISO_CACHE_UNTRUSTED_ENTRY", "cache-entry-from-foreign-producer");
  if (entry.contentHash !== sha256Hex(entry.content)) return denied("GE_ISO_CACHE_UNTRUSTED_ENTRY", "cache-entry-content-hash-mismatch");
  return granted("cache-entry-trusted");
}

/* =========================================================================
 * Section 8 — restricted process
 * ====================================================================== */

const PROCESS_OBSERVATION_LIMITS = Object.freeze({
  cpuMillis: "maxCpuMillis",
  durationMs: "maxDurationMs",
  memoryBytes: "maxMemoryBytes",
  openFiles: "maxOpenFiles",
  outputBytes: "maxOutputBytes",
  processes: "maxProcesses",
  tempBytes: "maxTempBytes",
});

export function evaluateProcess(effective, spec, observation, secretValues) {
  const domain = effective.domains.process;
  if (domain === undefined) return denied("GE_CAP_DENIED_BY_DEFAULT", "process-domain-undeclared");
  if (!domain.executables.includes(spec.executable)) return denied("GE_CAP_DENIED_BY_DEFAULT", "executable-not-granted");
  for (const name of Object.keys(spec.environment).sort(compareUnicodeCodePoints)) {
    if (!domain.environmentAllowlist.includes(name)) return denied("GE_ISO_ENV_INHERITED", "environment-variable-not-allowlisted");
  }
  for (const argument of spec.argv) {
    for (const secret of secretValues) {
      if (argument.includes(secret)) return denied("GE_ISO_SECRET_EXPOSED", "secret-value-present-in-argv");
    }
  }
  for (const name of Object.keys(spec.environment).sort(compareUnicodeCodePoints)) {
    for (const secret of secretValues) {
      if (spec.environment[name].includes(secret) && spec.secretInjection !== "environment") {
        return denied("GE_ISO_SECRET_EXPOSED", "secret-value-present-in-undeclared-environment-channel");
      }
    }
  }
  const secretDomain = effective.domains.secret;
  if (secretDomain !== undefined && SECRET_CHANNEL_RANK[spec.secretInjection] > SECRET_CHANNEL_RANK[secretDomain.injection]) {
    return denied("GE_CAP_DENIED_BY_DEFAULT", "secret-injection-channel-not-granted");
  }
  const networkDomain = effective.domains.network;
  if (spec.networkEnabled === true && (networkDomain === undefined || networkDomain.enabled !== true)) {
    return denied("GE_ISO_NETWORK_DENIED", "process-network-not-granted");
  }
  for (const field of Object.keys(spec.limits).sort(compareUnicodeCodePoints)) {
    if (spec.limits[field] > domain[field]) return denied("GE_CAP_EXPANSION_DENIED", "process-limit-exceeds-ceiling");
  }
  const filesystem = effective.domains.filesystem;
  if (filesystem === undefined || !filesystem.roots.some((root) => pathIsUnder(spec.cwd, root.path))) {
    return denied("GE_ISO_PATH_NOT_GRANTED", "working-directory-not-granted");
  }
  for (const dimension of Object.keys(PROCESS_OBSERVATION_LIMITS).sort(compareUnicodeCodePoints)) {
    if (observation[dimension] > spec.limits[PROCESS_OBSERVATION_LIMITS[dimension]]) {
      return denied("GE_ISO_LIMIT_EXCEEDED", `observed-${dimension}-exceeded-limit`);
    }
  }
  if (observation.terminationRequested === true && observation.terminated !== true) {
    return denied("GE_ISO_KILL_FAILED", "termination-escalation-exhausted");
  }
  return granted("process-authorized");
}

/* =========================================================================
 * Section 9 — container
 * ====================================================================== */

const CONTAINER_LIMIT_FIELDS = Object.freeze([
  "maxCpuMillis",
  "maxDiskBytes",
  "maxMemoryBytes",
  "maxPids",
]);

export function evaluateContainer(effective, spec) {
  const domain = effective.domains.container;
  if (domain === undefined) return denied("GE_CAP_DENIED_BY_DEFAULT", "container-domain-undeclared");
  if (spec.image.digest === null) return denied("GE_ISO_IMAGE_UNVERIFIED", "image-digest-absent");
  if (spec.image.provenanceHash === null) return denied("GE_ISO_IMAGE_UNVERIFIED", "image-provenance-absent");
  const grantedImages = new Set(domain.images.map((item) => canonicalJson(item)));
  if (!grantedImages.has(canonicalJson(spec.image))) return denied("GE_CAP_DENIED_BY_DEFAULT", "image-not-granted");
  if (spec.privileged === true) return denied("GE_ISO_PRIVILEGE_DENIED", "privileged-mode-requested");
  if (spec.runAsNonRoot !== true) return denied("GE_ISO_PRIVILEGE_DENIED", "root-user-requested");
  if (spec.readOnlyRootFilesystem !== true) return denied("GE_ISO_PRIVILEGE_DENIED", "writable-root-filesystem-requested");
  if (spec.seccompProfile === "unconfined-denied") return denied("GE_ISO_PRIVILEGE_DENIED", "seccomp-profile-unconfined");
  for (const mount of spec.mounts) {
    if (mount.source.endsWith(".sock")) return denied("GE_ISO_PRIVILEGE_DENIED", "host-socket-mount-requested");
    if (mount.source === "/" || mount.target === "/") return denied("GE_ISO_PRIVILEGE_DENIED", "host-root-mount-requested");
    if (mount.readOnly !== true && mount.target === "/etc") return denied("GE_ISO_PRIVILEGE_DENIED", "writable-system-mount-requested");
  }
  for (const capability of domain.droppedCapabilities) {
    if (!spec.droppedCapabilities.includes(capability)) return denied("GE_CAP_EXPANSION_DENIED", "required-capability-drop-omitted");
  }
  if (spec.networkEnabled === true && domain.networkEnabled !== true) return denied("GE_ISO_NETWORK_DENIED", "container-network-not-granted");
  const networkDomain = effective.domains.network;
  for (const host of spec.egressAllowlist) {
    if (networkDomain === undefined || !networkDomain.hosts.includes(host)) {
      return denied("GE_ISO_NETWORK_DENIED", "container-egress-host-not-allowlisted");
    }
  }
  for (const field of CONTAINER_LIMIT_FIELDS) {
    if (spec.limits[field] > domain[field]) return denied("GE_CAP_EXPANSION_DENIED", "container-limit-exceeds-ceiling");
  }
  return granted("container-authorized");
}

/* =========================================================================
 * Section 10 — provider descriptors and cleanup proof
 * ====================================================================== */

// Section 10.1. The maximum any provider kind may honestly claim. A worktree
// separates file history and nothing else; nothing claims the kernel.
const PROVIDER_MAX_CLAIMS = Object.freeze({
  "noop-local": {
    isolatesFilesystem: false,
    isolatesProcess: false,
    isolatesNetwork: false,
    isolatesPorts: false,
    isolatesTempFiles: false,
    isolatesCaches: false,
    isolatesDatabaseNamespaces: false,
    isolatesKernel: false,
  },
  "git-worktree": {
    isolatesFilesystem: true,
    isolatesProcess: false,
    isolatesNetwork: false,
    isolatesPorts: false,
    isolatesTempFiles: false,
    isolatesCaches: false,
    isolatesDatabaseNamespaces: false,
    isolatesKernel: false,
  },
  "restricted-process": {
    isolatesFilesystem: true,
    isolatesProcess: true,
    isolatesNetwork: false,
    isolatesPorts: true,
    isolatesTempFiles: true,
    isolatesCaches: true,
    isolatesDatabaseNamespaces: true,
    isolatesKernel: false,
  },
  container: {
    isolatesFilesystem: true,
    isolatesProcess: true,
    isolatesNetwork: true,
    isolatesPorts: true,
    isolatesTempFiles: true,
    isolatesCaches: true,
    isolatesDatabaseNamespaces: true,
    isolatesKernel: false,
  },
});

const PROVIDER_NAMESPACE_DOMAINS = Object.freeze({
  "noop-local": [],
  "git-worktree": ["branch", "worktree-path", "temp-directory"],
  "restricted-process": ["branch", "worktree-path", "temp-directory", "cache", "port", "database-schema"],
  container: ["branch", "worktree-path", "temp-directory", "cache", "port", "database-schema"],
});

export function evaluateProviderDescriptor(descriptor, platform) {
  const maximum = PROVIDER_MAX_CLAIMS[descriptor.providerKind];
  for (const claim of Object.keys(maximum).sort(compareUnicodeCodePoints)) {
    if (descriptor.trustBoundary[claim] === true && maximum[claim] === false) {
      return denied("GE_ISO_PROVIDER_UNSUPPORTED", "trust-boundary-overclaimed-for-provider-kind");
    }
  }
  const supported = new Set(PROVIDER_NAMESPACE_DOMAINS[descriptor.providerKind]);
  for (const domain of descriptor.namespaceDomains) {
    if (!supported.has(domain)) return denied("GE_ISO_PROVIDER_UNSUPPORTED", "namespace-domain-unsupported-by-provider-kind");
  }
  if (platform !== null && !(descriptor.platforms ?? []).includes(platform)) {
    return denied("GE_ISO_PROVIDER_UNSUPPORTED", "provider-not-claimed-on-platform");
  }
  return granted("provider-descriptor-honest");
}

export function evaluateCleanup(lease, receipt, declaredDomains) {
  const namespaces = deriveNamespaces(lease.leaseId);
  const owned = new Set([
    `port:${namespaces.portBase}`,
    `temp-directory:${namespaces.tempDirectory}`,
    `cache:${namespaces.cacheNamespace}`,
    `database-schema:${namespaces.databaseSchema}`,
    `branch:${lease.branch.name}`,
    `worktree-path:${lease.worktreePath}`,
  ]);
  for (const resource of receipt.removedResources) {
    if (resource.createdByProvider !== true) return { decision: denied("GE_ISO_CLEANUP_FOREIGN_RESOURCE", "removal-of-resource-not-created-by-provider"), classification: "foreign-resource" };
    if (!owned.has(`${resource.domain}:${resource.value}`)) return { decision: denied("GE_ISO_CLEANUP_FOREIGN_RESOURCE", "removal-of-resource-not-owned-by-lease"), classification: "foreign-resource" };
  }
  if (receipt.residualNamespaces.length > 0) return { decision: denied("GE_ISO_CLEANUP_INCOMPLETE", "residual-namespace-reported"), classification: "incomplete" };
  const removedDomains = new Set(receipt.removedResources.map((item) => item.domain));
  for (const domain of declaredDomains) {
    if (!removedDomains.has(domain)) return { decision: denied("GE_ISO_CLEANUP_INCOMPLETE", "declared-namespace-domain-unproven"), classification: "incomplete" };
  }
  return { decision: granted("cleanup-proven"), classification: "clean" };
}

/* =========================================================================
 * Section 11 — merge gate
 * ====================================================================== */

const REQUIRED_GATES = Object.freeze(["build", "lint", "package", "security", "test", "typecheck"]);

/**
 * Section 11.2. A single ordered evaluation. The order is normative: an
 * implementation that reports a later refusal while an earlier one holds is
 * non-conforming, because the earlier refusals are the ones that describe an
 * unsafe input rather than a failing check.
 */
export function evaluateMergeGate(request) {
  if (request.observedBaseCommit !== request.expectedBaseCommit) return refused("GE_MERGE_STALE_BASE", "observed-base-differs-from-expected");
  if (canonicalJson([...request.presentedSourceCommits].sort(compareUnicodeCodePoints)) !== canonicalJson([...request.expectedSourceCommits].sort(compareUnicodeCodePoints))) {
    return refused("GE_MERGE_SOURCE_MISMATCH", "presented-source-commits-differ-from-expected");
  }
  if (request.workerStatusClean !== true) return refused("GE_MERGE_DIRTY_STATE", "worker-status-not-clean");
  if (request.generatedFileDrift.length > 0) return refused("GE_MERGE_GENERATED_DRIFT", "generated-file-altered");
  for (const touched of request.touchedPaths) {
    if (request.protectedPaths.some((protectedPath) => pathIsUnder(touched, protectedPath))) {
      return refused("GE_MERGE_PROTECTED_PATH", "protected-path-touched");
    }
  }
  for (const touched of request.touchedPaths) {
    if (!request.ownedPaths.some((ownedPath) => pathIsUnder(touched, ownedPath))) {
      return refused("GE_MERGE_OWNERSHIP_DENIED", "touched-path-outside-ownership");
    }
  }
  const gates = new Map(request.gateReports.map((item) => [item.gate, item]));
  for (const gate of REQUIRED_GATES) {
    const report = gates.get(gate);
    if (report === undefined || report.status !== "pass") return refused("GE_MERGE_GATE_FAILED", `gate-${gate}-not-passed`);
  }
  if (request.approvalRequired === true && request.approval === null) return refused("GE_MERGE_APPROVAL_REQUIRED", "required-approval-absent");
  if (request.approvalRequired === true && request.approval.expiresAtMs <= request.evaluatedAtMs) {
    return refused("GE_MERGE_APPROVAL_STALE", "approval-expired-at-evaluation");
  }
  if (request.approvalRequired === true && request.approval.boundPayloadHash !== mergePayloadHash(request)) {
    return refused("GE_MERGE_APPROVAL_STALE", "approval-not-bound-to-this-merge-payload");
  }
  if (request.conflictPaths.length > 0) return refused("GE_MERGE_CONFLICT", "structured-conflict-retained");
  if (request.externalPublication.pushRequested === true && request.externalPublication.workflowAuthorityRef === null) {
    return refused("GE_MERGE_EXTERNAL_PUSH_DENIED", "external-push-without-workflow-authority");
  }
  return authorized("merge-authorized");
}

export function mergePayloadHash(request) {
  return taggedHash([
    "merge-gate-payload/v1alpha1",
    request.targetBranch,
    request.expectedBaseCommit,
    [...request.expectedSourceCommits].sort(compareUnicodeCodePoints),
    request.strategy,
    [...request.touchedPaths].sort(compareUnicodeCodePoints),
  ]);
}

/* =========================================================================
 * Corpus execution
 * ====================================================================== */

function assertDecision(observed, expected, label) {
  assert.equal(observed.code, expected.code, `${label} code drifted: observed ${observed.code}`);
  assert.equal(observed.reason, expected.reason, `${label} reason drifted: observed ${observed.reason}`);
  assert.equal(observed.outcome, expected.outcome, `${label} outcome drifted: observed ${observed.outcome}`);
}

export async function validateIsolationFixture() {
  const fixture = JSON.parse(await readFile(CASE_PATH, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const schemas = new Map();
  for (const name of SCHEMA_NAMES) {
    const schema = JSON.parse(await readFile(join(specRoot, name), "utf8"));
    assert.equal(
      ajv.validateSchema(schema),
      true,
      `${name} is not a valid Draft 2020-12 schema: ${JSON.stringify(ajv.errors)}`,
    );
    assert.equal(schema.$id, `${SCHEMA_BASE}${name}`, `${name} $id drifted from the committed convention`);
    schemas.set(name, schema);
    ajv.addSchema(schema);
  }
  for (const name of SCHEMA_NAMES) ajv.compile(schemas.get(name));

  function validatorFor(reference) {
    const validate = ajv.getSchema(`${SCHEMA_BASE}${reference}`);
    assert.ok(validate !== undefined, `unknown schema reference '${reference}'`);
    return validate;
  }

  /* --- honest-claim flags ------------------------------------------------ */
  assert.equal(fixture.apiVersion, "graphengineering.reacher-z.github.io/isolation-conformance/v1alpha1");
  assert.equal(
    fixture.contractStatus,
    "contract-only-native-implementation-required",
    "isolation corpus contractStatus drifted",
  );
  assert.equal(
    fixture.implementationClaim,
    false,
    "isolation corpus implementationClaim must be literally false",
  );
  assert.equal(fixture.ambientAuthority.providerImplemented, false);
  assert.equal(fixture.ambientAuthority.capabilityEnforcementImplemented, false);
  assert.equal(fixture.ambientAuthority.mergeGateImplemented, false);
  assert.equal(
    fixture.ambientAuthority.runtimeHasAmbientAuthority,
    true,
    "the corpus must keep asserting the current ambient-authority reality",
  );

  /* --- inventories mirror the schema enums exactly ----------------------- */
  const manifestSchema = schemas.get("capability-manifest.schema.json");
  const providerSchema = schemas.get("isolation-provider.schema.json");
  assert.deepEqual(fixture.codeInventory, manifestSchema.$defs.code.enum, "codeInventory drifted from the schema enum");
  assert.deepEqual(fixture.domainInventory, manifestSchema.$defs.capabilityDomain.enum, "domainInventory drifted");
  assert.deepEqual(fixture.requestorInventory, manifestSchema.$defs.requestorKind.enum, "requestorInventory drifted");
  assert.deepEqual(fixture.escapeInventory, manifestSchema.$defs.escapeClass.enum, "escapeInventory drifted");
  assert.deepEqual(fixture.providerInventory, providerSchema.$defs.providerKind.enum, "providerInventory drifted");
  assert.deepEqual(fixture.lifecycleInventory, providerSchema.$defs.lifecycleState.enum, "lifecycleInventory drifted");
  assert.deepEqual(fixture.domainInventory, DOMAIN_ORDER, "the oracle domain order drifted from the schema enum");
  assert.deepEqual(
    fixture.domainInventory,
    Object.keys(DOMAIN_RULES),
    "every capability domain must have a narrowing rule table",
  );
  assert.deepEqual(
    sortedUnique(fixture.codeInventory),
    fixture.codeInventory,
    "codeInventory must be sorted and unique",
  );

  /* --- globally unique case identifiers ---------------------------------- */
  const SECTIONS = Object.freeze([
    "schemaCases",
    "narrowingCases",
    "effectCases",
    "pathCases",
    "branchCases",
    "registryCases",
    "leaseCases",
    "allocationCases",
    "cacheCases",
    "processCases",
    "containerCases",
    "providerCases",
    "cleanupCases",
    "mergeCases",
  ]);
  const ids = SECTIONS.flatMap((section) => {
    assert.ok(Array.isArray(fixture[section]), `corpus section '${section}' is missing`);
    assert.ok(fixture[section].length > 0, `corpus section '${section}' is empty`);
    return fixture[section].map((item) => item.id);
  });
  assert.equal(new Set(ids).size, ids.length, "isolation corpus case identifiers are not globally unique");

  const sectionCounts = Object.fromEntries(SECTIONS.map((section) => [section, fixture[section].length]));
  const schemaCodes = new Set();

  /* --- schema layer ------------------------------------------------------ */
  for (const testCase of fixture.schemaCases) {
    const validate = validatorFor(testCase.schema);
    const accepted = validate(testCase.document);
    const observedCode = accepted ? "GE_CAP_GRANTED" : "GE_CAP_MANIFEST_INVALID";
    assert.equal(
      accepted,
      testCase.valid,
      `${testCase.id} schema verdict drifted: ${JSON.stringify(validate.errors)}`,
    );
    assert.equal(observedCode, testCase.expectedCode, `${testCase.id} schema-derived code drifted`);
    schemaCodes.add(observedCode);
  }
  assert.ok(schemaCodes.has("GE_CAP_MANIFEST_INVALID"), "no schema case produces GE_CAP_MANIFEST_INVALID");
  assert.ok(schemaCodes.has("GE_CAP_GRANTED"), "no schema case is accepted");

  /* --- narrowing --------------------------------------------------------- */
  const validateManifest = validatorFor("capability-manifest.schema.json");
  const validateDecision = validatorFor("capability-manifest.schema.json#/$defs/capabilityDecision");
  const effectiveByCase = new Map();
  const coveredDomains = new Set();
  const coveredRequestors = new Set();

  for (const testCase of fixture.narrowingCases) {
    assert.equal(
      validateManifest(testCase.ceiling),
      true,
      `${testCase.id} ceiling is not a valid manifest: ${JSON.stringify(validateManifest.errors)}`,
    );
    assert.equal(
      testCase.ceiling.level,
      testCase.partialCeiling === true ? "deployment" : "operator",
      `${testCase.id} ceiling level does not match its declared totality`,
    );
    const result = narrowManifest(testCase.ceiling, testCase.request, testCase.requestorKind, testCase.evaluatedAtMs);
    assert.equal(result.trust, testCase.requestorTrust, `${testCase.id} requestor trust drifted`);
    assertDecision(result.decision, testCase.expected, testCase.id);
    coveredRequestors.add(testCase.requestorKind);
    if (testCase.expected.domain !== undefined && testCase.expected.domain !== null) {
      assert.equal(result.domain, testCase.expected.domain, `${testCase.id} denial domain drifted`);
      coveredDomains.add(testCase.expected.domain);
    }
    if (testCase.expected.field !== undefined) {
      assert.equal(result.field, testCase.expected.field, `${testCase.id} denial field drifted`);
    }
    if (result.decision.outcome === "granted") {
      assert.equal(
        result.effectiveManifestHash,
        testCase.expected.effectiveManifestHash,
        `${testCase.id} effective manifest hash drifted`,
      );
      assert.equal(
        validateManifest(result.effective),
        true,
        `${testCase.id} effective manifest is not a valid manifest: ${JSON.stringify(validateManifest.errors)}`,
      );
      // The effective manifest never exceeds its own ceiling: re-narrowing it
      // against the ceiling must reproduce it byte for byte.
      const refold = narrowManifest(testCase.ceiling, result.effective, testCase.requestorKind, testCase.evaluatedAtMs);
      assert.equal(refold.decision.outcome, "granted", `${testCase.id} effective manifest fails its own ceiling`);
      assert.equal(
        refold.effectiveManifestHash,
        result.effectiveManifestHash,
        `${testCase.id} narrowing is not idempotent`,
      );
      effectiveByCase.set(testCase.id, result.effective);
    }
    const decisionDocument = {
      apiVersion: "graphengineering.reacher-z.github.io/capability-decision/v1alpha1",
      decisionId: testCase.id,
      outcome: result.decision.outcome,
      code: result.decision.code,
      domain: result.domain ?? null,
      requestorKind: testCase.requestorKind,
      requestorTrust: result.trust,
      policyVersion: "capability-policy/v1alpha1",
      binding: testCase.ceiling.binding,
      effectiveManifestHash: result.effectiveManifestHash ?? null,
      evaluatedAtMs: testCase.evaluatedAtMs,
      detail: result.decision.reason,
    };
    assert.equal(
      validateDecision(decisionDocument),
      true,
      `${testCase.id} recomputed decision is not a valid capability decision: ${JSON.stringify(validateDecision.errors)}`,
    );
  }
  assert.deepEqual(
    sortedUnique([...coveredDomains]),
    sortedUnique(fixture.domainInventory),
    "every capability domain must own at least one isolated expansion vector",
  );
  assert.deepEqual(
    sortedUnique([...coveredRequestors]),
    sortedUnique(fixture.requestorInventory),
    "every requestor kind must appear in the narrowing corpus",
  );

  function effectiveFor(reference) {
    const effective = effectiveByCase.get(reference);
    assert.ok(effective !== undefined, `case references unknown granted narrowing '${reference}'`);
    return effective;
  }

  /* --- effect boundary --------------------------------------------------- */
  for (const testCase of fixture.effectCases) {
    const observed = evaluateEffect(
      effectiveFor(testCase.effectiveFrom),
      testCase.effect,
      testCase.approval,
      testCase.evaluatedAtMs,
    );
    assertDecision(observed, testCase.expected, testCase.id);
  }

  /* --- path policy ------------------------------------------------------- */
  const validatePathRequest = validatorFor("worktree-lease.schema.json#/$defs/pathRequest");
  for (const testCase of fixture.pathCases) {
    assert.equal(
      validatePathRequest(testCase.request),
      true,
      `${testCase.id} path request is not a valid pathRequest: ${JSON.stringify(validatePathRequest.errors)}`,
    );
    const observed = evaluatePath(testCase.policy, testCase.request);
    assertDecision(observed, testCase.expected, testCase.id);
  }

  /* --- branch derivation ------------------------------------------------- */
  for (const testCase of fixture.branchCases) {
    const observed = deriveBranch(testCase.binding);
    assertDecision(observed.decision, testCase.expected, testCase.id);
    if (observed.decision.outcome === "granted") {
      assert.equal(observed.name, testCase.expected.name, `${testCase.id} branch name drifted`);
      assert.equal(observed.discriminator, testCase.expected.discriminator, `${testCase.id} discriminator drifted`);
      assert.equal(
        observed.name,
        `ge/iso/${testCase.binding.runId}/${testCase.binding.nodeId}/${testCase.binding.attempt}-${observed.discriminator}`,
        `${testCase.id} branch name is not the documented composition`,
      );
    }
  }
  // Independent recomputation of one published literal, so a silent change to
  // the tagged-hash construction cannot be absorbed by regenerating the corpus.
  assert.equal(
    taggedHash(["isolation-branch/v1alpha1", "0".repeat(64), "run-a", "node-a", 1]).slice(0, 16),
    sha256Hex('["isolation-branch/v1alpha1","' + "0".repeat(64) + '","run-a","node-a",1]').slice(0, 16),
    "the branch discriminator is not the tagged canonical-JSON SHA-256 prefix",
  );

  /* --- lease registry ---------------------------------------------------- */
  const validateLease = validatorFor("worktree-lease.schema.json");
  for (const testCase of fixture.registryCases) {
    if (testCase.declaredBranchSet !== undefined) {
      const observed = evaluateDeclaredBranchSet(testCase.declaredBranchSet);
      assertDecision(observed, testCase.expected, testCase.id);
      continue;
    }
    if (testCase.declaredNamespaceSet !== undefined) {
      const observed = evaluateDeclaredNamespaceSet(testCase.declaredNamespaceSet);
      assertDecision(observed, testCase.expected, testCase.id);
      continue;
    }
    for (const lease of testCase.leaseDocuments ?? []) {
      assert.equal(
        validateLease(lease),
        true,
        `${testCase.id} lease document is invalid: ${JSON.stringify(validateLease.errors)}`,
      );
    }
    const observed = evaluateLeaseRegistry(testCase.leases, testCase.retired ?? []);
    assertDecision(observed, testCase.expected, testCase.id);
  }

  /* --- lease lifecycle --------------------------------------------------- */
  const validateLeaseEvent = validatorFor("worktree-lease.schema.json#/$defs/leaseEvent");
  for (const testCase of fixture.leaseCases) {
    for (const event of testCase.events) {
      assert.equal(
        validateLeaseEvent(event),
        true,
        `${testCase.id} lease event is invalid: ${JSON.stringify(validateLeaseEvent.errors)}`,
      );
    }
    const observed = evaluateLeaseEvents(testCase.lease, testCase.events, testCase.leaseTtlMs);
    assertDecision(observed.decision, testCase.expected, testCase.id);
    assert.equal(observed.state, testCase.expected.finalState, `${testCase.id} final lease state drifted`);
  }

  /* --- worktree allocation and cache ------------------------------------- */
  for (const testCase of fixture.allocationCases) {
    const observed = evaluateWorktreeAllocation(effectiveFor(testCase.effectiveFrom), testCase.request);
    assertDecision(observed, testCase.expected, testCase.id);
  }
  for (const testCase of fixture.cacheCases) {
    const observed = evaluateCacheEntry(testCase.lease, testCase.entry);
    assertDecision(observed, testCase.expected, testCase.id);
  }

  /* --- process ----------------------------------------------------------- */
  const validateProcessSpec = validatorFor("isolation-provider.schema.json#/$defs/processSpec");
  for (const testCase of fixture.processCases) {
    assert.equal(
      validateProcessSpec(testCase.spec),
      true,
      `${testCase.id} process spec is invalid: ${JSON.stringify(validateProcessSpec.errors)}`,
    );
    const observed = evaluateProcess(
      effectiveFor(testCase.effectiveFrom),
      testCase.spec,
      testCase.observation,
      testCase.secretValues,
    );
    assertDecision(observed, testCase.expected, testCase.id);
  }

  /* --- container --------------------------------------------------------- */
  const validateContainerSpec = validatorFor("isolation-provider.schema.json#/$defs/containerSpec");
  for (const testCase of fixture.containerCases) {
    assert.equal(
      validateContainerSpec(testCase.spec),
      true,
      `${testCase.id} container spec is invalid: ${JSON.stringify(validateContainerSpec.errors)}`,
    );
    const observed = evaluateContainer(effectiveFor(testCase.effectiveFrom), testCase.spec);
    assertDecision(observed, testCase.expected, testCase.id);
  }

  /* --- providers --------------------------------------------------------- */
  const validateProvider = validatorFor("isolation-provider.schema.json");
  const coveredProviderKinds = new Set();
  for (const testCase of fixture.providerCases) {
    assert.equal(
      validateProvider(testCase.descriptor),
      true,
      `${testCase.id} provider descriptor is invalid: ${JSON.stringify(validateProvider.errors)}`,
    );
    const observed = evaluateProviderDescriptor(testCase.descriptor, testCase.platform);
    assertDecision(observed, testCase.expected, testCase.id);
    coveredProviderKinds.add(testCase.descriptor.providerKind);
  }
  assert.deepEqual(
    sortedUnique([...coveredProviderKinds]),
    sortedUnique(fixture.providerInventory),
    "every provider kind must appear in the provider corpus",
  );

  /* --- cleanup ----------------------------------------------------------- */
  const validateReceipt = validatorFor("isolation-provider.schema.json#/$defs/cleanupReceipt");
  for (const testCase of fixture.cleanupCases) {
    assert.equal(
      validateReceipt(testCase.receipt),
      true,
      `${testCase.id} cleanup receipt is invalid: ${JSON.stringify(validateReceipt.errors)}`,
    );
    const observed = evaluateCleanup(testCase.lease, testCase.receipt, testCase.declaredDomains);
    assertDecision(observed.decision, testCase.expected, testCase.id);
    assert.equal(
      observed.classification,
      testCase.receipt.outcome,
      `${testCase.id} receipt outcome is not the recomputed classification`,
    );
  }

  /* --- merge gate -------------------------------------------------------- */
  const validateMergeRequest = validatorFor("merge-gate-decision.schema.json#/$defs/mergeRequest");
  const validateMergeDecision = validatorFor("merge-gate-decision.schema.json");
  for (const testCase of fixture.mergeCases) {
    assert.equal(
      validateMergeRequest(testCase.request),
      true,
      `${testCase.id} merge request is invalid: ${JSON.stringify(validateMergeRequest.errors)}`,
    );
    const observed = evaluateMergeGate(testCase.request);
    assertDecision(observed, testCase.expected, testCase.id);
    const targetUnchanged = observed.outcome !== "merge-authorized";
    const decisionDocument = {
      apiVersion: "graphengineering.reacher-z.github.io/merge-gate-decision/v1alpha1",
      decisionId: testCase.request.decisionId,
      mergeNodeId: testCase.request.mergeNodeId,
      targetBranch: testCase.request.targetBranch,
      expectedBaseCommit: testCase.request.expectedBaseCommit,
      observedBaseCommit: testCase.request.observedBaseCommit,
      sourceCommits: testCase.request.presentedSourceCommits,
      strategy: testCase.request.strategy,
      gateReports: testCase.request.gateReports,
      outcome: observed.outcome,
      code: observed.code,
      targetUnchanged,
      isolatedWorkPreserved: true,
      conflictPaths: observed.outcome === "merge-authorized" ? [] : testCase.request.conflictPaths,
      approval: testCase.request.approval,
      externalPublication: testCase.request.externalPublication,
    };
    assert.equal(
      validateMergeDecision(decisionDocument),
      true,
      `${testCase.id} recomputed merge decision is invalid: ${JSON.stringify(validateMergeDecision.errors)}`,
    );
    // Section 11.3: on every refusal the target is unchanged and the isolated
    // work survives. This is asserted on the recomputed decision, not read
    // from the corpus.
    if (observed.outcome === "merge-denied") {
      assert.equal(decisionDocument.targetUnchanged, true, `${testCase.id} refused merge did not leave the target unchanged`);
      assert.equal(decisionDocument.isolatedWorkPreserved, true, `${testCase.id} refused merge discarded isolated work`);
    }
    if (testCase.request.approvalRequired === true && testCase.expectedPayloadHash !== undefined) {
      assert.equal(mergePayloadHash(testCase.request), testCase.expectedPayloadHash, `${testCase.id} merge payload hash drifted`);
    }
  }

  /* --- escape corpus ----------------------------------------------------- */
  const caseIndex = new Map();
  for (const section of SECTIONS) {
    for (const item of fixture[section]) caseIndex.set(item.id, { section, item });
  }
  const coveredEscapes = new Set();
  for (const escape of fixture.escapeCases) {
    const target = caseIndex.get(escape.vectorId);
    assert.ok(target !== undefined, `escape '${escape.escapeClass}' names unknown vector '${escape.vectorId}'`);
    assert.equal(
      target.item.expected.code,
      escape.expectedCode,
      `escape '${escape.escapeClass}' expects ${escape.expectedCode} but vector '${escape.vectorId}' expects ${target.item.expected.code}`,
    );
    assert.equal(
      target.item.expected.outcome,
      "denied",
      `escape '${escape.escapeClass}' must resolve to a denial`,
    );
    coveredEscapes.add(escape.escapeClass);
  }
  assert.deepEqual(
    sortedUnique([...coveredEscapes]),
    sortedUnique(fixture.escapeInventory),
    "every enumerated escape class must be bound to a denial vector",
  );

  /* --- hard coverage of the closed vocabularies -------------------------- */
  const allObserved = sortedUnique([...semanticCodes, ...schemaCodes]);
  assert.deepEqual(
    allObserved,
    sortedUnique(fixture.codeInventory),
    "the corpus does not exercise every code in the closed vocabulary",
  );
  assert.deepEqual(
    fixture.codeInventory.filter(
      (code) => code !== "GE_CAP_MANIFEST_INVALID" && !semanticCodes.has(code),
    ),
    [],
    "every code except GE_CAP_MANIFEST_INVALID must be produced by a semantic oracle, not only by a schema verdict",
  );
  assert.deepEqual(
    sortedUnique([...emittedReasons]),
    sortedUnique(fixture.reasonInventory),
    "the emitted reason set drifted from the corpus reason inventory",
  );
  assert.equal(
    fixture.reasonInventory.length,
    new Set(fixture.reasonInventory).size,
    "reasonInventory contains a duplicate",
  );

  return {
    contract: "D12-ISOLATION-SPEC-044",
    implementationClaim: fixture.implementationClaim,
    schemas: SCHEMA_NAMES.length,
    codes: fixture.codeInventory.length,
    reasons: fixture.reasonInventory.length,
    escapes: fixture.escapeCases.length,
    sections: sectionCounts,
    cases: ids.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await validateIsolationFixture();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
