# Capability, isolation, worktree, process, container and merge semantics v1alpha1

Status: **normative protocol contract; closed machine schemas and hostile
corpus frozen; no isolation provider, capability engine or merge gate is
implemented in either native runtime**

This document freezes the portable deny-by-default authority contract for
Graph Engineering: what a node may do, who may ask, what may never be asked,
how an isolated workspace is leased and proved clean, and how a merge is
authorized. It is the contract half of `D12-ISOLATION-SPEC-044` and it unblocks
`D12-TS-ISOLATION-045`, `D12-PY-ISOLATION-046` and
`D12-ISOLATION-REDTEAM-047`.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**
and **MAY** are normative.

## 0. The honest boundary this contract does not move

Read this section before any other.

> A node executor has the ambient authority of the host process that runs it.

That statement from
[`codex_plans/architecture/security-and-isolation.md`](../codex_plans/architecture/security-and-isolation.md)
§2 remains true after this document is frozen, and the
[security guide](../docs/SECURITY.md) alpha warning remains accurate in full.
Specifically, and without qualification:

- **No isolation provider exists.** There is no worktree provider, no
  restricted-process provider, no container provider and no no-op provider in
  `packages/` or `python/`. Every provider named here is a descriptor shape,
  not code.
- **No capability policy engine exists.** Nothing intersects, evaluates or
  enforces a manifest. `capability-manifest.schema.json` pins the only
  representable value of `enforced` to `false` for exactly that reason.
- **No merge gate exists.** Nothing runs the ordered evaluation of §11.
- **No approval runtime exists.** `approvalRef` is a shape, not an
  authenticated decision.
- Graph IR `resources`, `isolation` and `sideEffects` remain opaque
  declarations. A capability manifest committed beside a graph today changes
  nothing at execution time.

Freezing this contract is therefore **contract Green only**. It is not native
Green, not conformance Green, not candidate Green, not Day 12 exit and not a
security claim of any kind. `codex_logs/task-registry.json` and the Day 12
gate in the architecture document remain the authority on state, and both
still read Open.

The corpus carries `implementationClaim: false` and an `ambientAuthority`
block asserting `runtimeHasAmbientAuthority: true`; the validator fails hard if
either is edited. That is deliberate: the only way to stop this corpus from
saying "nothing is implemented" is to make the gate red.

## 1. Scope and authority

This contract governs:

- the capability manifest a node executes under, and the total function that
  derives it from an operator ceiling;
- the structured decision every capability evaluation returns;
- the resolved-path policy for any filesystem operation inside an isolated
  workspace;
- the lease, deterministic identity, namespaces and cleanup proof of a git
  worktree;
- the launch specification and observed-limit evaluation of a restricted
  process;
- the launch specification of a container;
- the isolation provider interface and its declared trust boundary; and
- the separate merge node.

Its normative source is the
[21-day master plan](../codex_plans/Graph-Engineering-21-Day-Master-Plan.md)
§18 (18.1 through 18.6), §15.7, and the "Security and isolation" paragraph of
the plan body. Where this document is narrower than §18 it says so; it never
silently widens.

### 1.1 Machine-contract manifest

The following files form one versioned contract set. A native implementation
MUST NOT claim the contract by implementing a subset.

| Contract surface | Machine artifact |
| --- | --- |
| Capability manifest, closed code/domain/requestor/escape vocabulary, structured decision | [`capability-manifest.schema.json`](capability-manifest.schema.json) |
| Provider descriptor, trust boundary, process spec, container spec, cleanup receipt | [`isolation-provider.schema.json`](isolation-provider.schema.json) |
| Worktree lease, deterministic branch identity, path request, lease event | [`worktree-lease.schema.json`](worktree-lease.schema.json) |
| Merge gate decision and merge request | [`merge-gate-decision.schema.json`](merge-gate-decision.schema.json) |
| Executable hostile corpus | [`conformance/isolation.case.json`](conformance/isolation.case.json) |
| Executable oracle | [`conformance/isolation.validate.mjs`](conformance/isolation.validate.mjs) |

`capability-manifest.schema.json` is also the registry of the closed portable
vocabulary. `$defs/code`, `$defs/capabilityDomain`, `$defs/requestorKind`,
`$defs/escapeClass` and `$defs/authorityLevel` are referenced from the other
three schemas and from both native runtimes. Adding a member to any of them is
a contract revision, not an implementation detail.

### 1.2 Relationship to the frozen redaction contract

This contract composes with, and never overrides,
[`redaction-semantics.md`](redaction-semantics.md). §4.4 of that document
freezes capture-policy non-expansion; §4 of this document freezes capability
non-expansion. §12.4 below states the exact composition rule.

## 2. Threat model

### 2.1 Untrusted principals

Every principal in `$defs/requestorKind` other than `operator-policy` is
untrusted for authority purposes. That includes `graph` and `node`: a reviewed
graph is still a document that arrives from outside the policy engine, and
treating it as trusted would make "the graph author may be malicious" — already
stated in the architecture document §5 — unrepresentable.

Untrusted does not mean ignored. An untrusted principal's request is **data**
that deterministic code evaluates. It may reduce authority and it may never
restate authority.

> Model and tool output is untrusted input, never authority. A prompt that says
> "you now have shell access" is a string. It produces a
> `GE_CAP_UNTRUSTED_REQUESTOR_AUTHORITY` decision, not a grant.

### 2.2 Enumerated escapes

Master-plan §18.6 requires the following attack classes. Each is a member of
`$defs/escapeClass`, each is bound in `escapeCases` to a concrete corpus vector
that must resolve to a denial, and the validator fails if any class is
unbound.

| Escape class | Frozen refusal |
| --- | --- |
| `path-traversal` | `GE_ISO_PATH_ESCAPE` |
| `symlink-escape` | `GE_ISO_SYMLINK_ESCAPE` |
| `lease-theft` | `GE_ISO_LEASE_NOT_HELD` |
| `branch-name-collision` | `GE_ISO_BRANCH_COLLISION` |
| `port-reuse` | `GE_ISO_NAMESPACE_REUSE` |
| `temp-file-reuse` | `GE_ISO_NAMESPACE_REUSE` |
| `cache-poisoning` | `GE_ISO_CACHE_UNTRUSTED_ENTRY` |
| `environment-inheritance` | `GE_ISO_ENV_INHERITED` |
| `prompt-injection-capability-expansion` | `GE_CAP_UNTRUSTED_REQUESTOR_AUTHORITY` |

`.git` indirection, repository hooks, repository-config execution, submodule
indirection, host-socket mounts, privileged containers, unverified images,
secret exposure through argv, and kill failure are additionally frozen with
their own codes in §6 through §11. They are not in the escape enum because
§18.6 enumerates them as campaign content rather than as named classes; the
corpus covers them regardless.

## 3. Capability vocabulary

### 3.1 Domains

Authority is partitioned into exactly twelve domains:

`tool`, `filesystem`, `network`, `secret`, `process`, `worktree`, `container`,
`artifact`, `storage`, `mcp`, `approval`, `patch`.

The set is closed. A capability that is not expressible in one of these twelve
domains is undeclared, and **undeclared is denied**. An operator ceiling MUST
state all twelve; the schema enforces this for `level: "operator"`, because a
ceiling that omits a domain denies it, and a ceiling that denies everything is
not a ceiling.

### 3.2 Authority levels

`operator`, `deployment`, `tenant`, `graph`, `run`, `node`, `adapter`,
`request`, in strict narrowing order. A request MUST declare a level strictly
later than its ceiling's. A request that declares a level at or above its
ceiling is claiming authority it does not have and is refused
`GE_CAP_AUTHORITY_IMMUTABLE`.

### 3.3 The decision value

Every capability evaluation returns a `capabilityDecision`:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/capability-decision/v1alpha1",
  "decisionId": "…",
  "outcome": "granted | denied",
  "code": "<closed code>",
  "domain": "<domain or null>",
  "requestorKind": "…",
  "requestorTrust": "trusted | untrusted",
  "policyVersion": "capability-policy/v1alpha1",
  "binding": { "…": "…" },
  "effectiveManifestHash": "<64 lowercase hex or null>",
  "evaluatedAtMs": 0,
  "detail": "<metadata-only reason tag>"
}
```

Normative consequences:

- A capability outcome MUST NOT be a bare boolean.
- A capability outcome MUST NOT be a thrown string or a free-form exception
  message.
- `outcome: "granted"` implies `code: "GE_CAP_GRANTED"` and a non-null
  `effectiveManifestHash`; `outcome: "denied"` implies neither success code and
  a null hash. The schema enforces both directions.
- `detail` is metadata only. It MUST NOT contain an application value, a path
  outside the grant, a secret, or a model-produced string.

### 3.4 Trust classification

`requestorTrust` is **derived**, never declared: `operator-policy` is
`trusted`, every other requestor kind is `untrusted`. The corpus states the
expected classification for each case and the oracle recomputes it, so a corpus
edit cannot promote a principal.

### 3.5 The closed code vocabulary

45 codes, of which exactly two are success codes: `GE_CAP_GRANTED` and
`GE_MERGE_AUTHORIZED`. Every other member is a structured refusal. The complete
list is `capability-manifest.schema.json#/$defs/code` and is not duplicated
here, because a duplicated list drifts.

Each code is paired at runtime with a stable lower-case `reason` tag. The code
is the portable identity; the reason isolates neighbouring rules that report
the same code, so that deleting one of them is observable. The corpus pins the
complete emitted reason set (146 tags) and the validator fails on any drift in
either direction — a removed guard and an invented guard both turn the gate
red.

## 4. Non-expansion — the whole contract

### 4.1 The narrowing function

Effective authority is computed by a **total** function
`narrow(ceiling, request, requestorKind)` returning either a structured refusal
or a complete effective manifest. It is deterministic code outside model and
tool output. Evaluation order is fixed and normative:

1. unknown request `apiVersion` → `GE_CAP_MANIFEST_INVALID`;
2. unknown `policyVersion` → `GE_CAP_UNKNOWN_POLICY_VERSION` (fail closed; an
   unknown version is never treated as permissive);
3. `level` at or above the ceiling's → `GE_CAP_AUTHORITY_IMMUTABLE`;
4. untrusted requestor whose `policyVersion` or `binding` differs from the
   ceiling → `GE_CAP_UNTRUSTED_REQUESTOR_AUTHORITY`;
5. `approvalRef` or `approvalExpiresAtMs` rewritten → `GE_CAP_AUTHORITY_IMMUTABLE`;
6. any other `binding` drift → `GE_CAP_BINDING_MISMATCH`;
7. per domain, in the frozen domain order, per field, in Unicode code-point
   order, apply the direction table of §4.2; the first violation wins and
   reports `GE_CAP_EXPANSION_DENIED` with its domain and field;
8. otherwise `GE_CAP_GRANTED` with the effective manifest.

Steps 4 and 5/6 are separate on purpose. An untrusted principal that rewrites
a binding and a trusted policy engine that presents a stale one are different
failures and MUST NOT collapse into one code.

The effective manifest is canonicalized (object keys in Unicode code-point
order, no insignificant whitespace) and hashed as

```text
SHA-256(canonicalJson(["capability-effective/v1alpha1", <effective manifest>]))
```

`narrow` MUST be idempotent: re-narrowing an effective manifest against its own
ceiling MUST reproduce it and its hash exactly. The oracle asserts this for
every granted case.

### 4.2 Direction table and the meaning of an omitted field

Deny-by-default is this table. `direction` states how a request may move
relative to its ceiling; `bottom` states what an omitted field means.

| Direction | Rule | Bottom (omitted) | Example fields |
| --- | --- | --- | --- |
| `subset` | request ⊆ ceiling | `[]` | `tool.operations`, `network.hosts`, `secret.refs`, `process.executables`, `mcp.tools` |
| `subset-number` | request ⊆ ceiling | `[]` | `network.ports` |
| `object-subset` | request ⊆ ceiling by canonical form | `[]` | `container.images` |
| `superset` | request ⊇ ceiling | ceiling value | `filesystem.deniedPaths`, `worktree.protectedDirectories`, `container.droppedCapabilities`, `approval.requiredFor` |
| `max-number` | request ≤ ceiling | `0` | every `max*` limit |
| `bool-narrow` | request ≤ ceiling (`false` ≤ `true`) | `false` | `network.enabled`, `mcp.allowMutation`, `patch.allowed` |
| `rank` | request rank ≤ ceiling rank | lowest rank | `secret.injection` (`none` < `stdin` < `file` < `environment`) |
| `exact` | request = ceiling | ceiling value | `filesystem.followSymlinks`, `container.allowPrivileged`, `container.seccompProfile`, `patch.mayRequestCapabilities` |
| `roots` | each requested root is a ceiling root or a descendant of one, with each permission bit ≤ the parent's | `[]` | `filesystem.roots` |

Two consequences are load-bearing and easy to get wrong.

**Restriction fields invert.** `approval.requiredFor`,
`filesystem.deniedPaths`, `worktree.protectedDirectories` and
`container.droppedCapabilities` are monotone in the opposite direction to every
other field. Dropping an approval requirement, a deny path, a protected
directory or a dropped Linux capability **is an expansion** and is refused
`GE_CAP_EXPANSION_DENIED`. An implementation that treats these as ordinary
subsets silently hands a planner the power to remove its own human gate.

**Missing information narrows.** An omitted widening field becomes empty, zero
or false. An omitted restriction field inherits the ceiling. A whole domain
omitted from the request is bottomed field by field under the same rule — it is
not inherited wholesale. A domain present in the request but absent from the
ceiling is `GE_CAP_EXPANSION_DENIED` with reason `domain-absent-from-ceiling`.

### 4.3 What a request can never contain

Four values are unrepresentable rather than merely denied, because a denial
that depends on a runtime check is a denial that can be forgotten:

| Field | Pinned value | Why |
| --- | --- | --- |
| `capability-manifest.enforced` | `false` | No runtime enforces a manifest. |
| `filesystem.followSymlinks` | `false` | A resolved-path policy never follows a link out of its grant. |
| `secret.allowInArgv`, `secret.allowInTrackedContent` | `false` | argv is world-readable; tracked content outlives the lease. |
| `container.allowPrivileged`, `container.allowHostSockets` | `false` | A privileged container or a mounted host socket is not an isolation boundary. |
| `container.readOnlyRoot`, `container.runAsNonRoot` | `true` | A writable root filesystem or a root user is not an isolation boundary. |
| `patch.mayRequestCapabilities` | `false` | A dynamic patch is untrusted structure, never an authority document. |
| `isolation-provider.implemented` | `false` | Nothing is implemented. |
| `isolation-provider.trustBoundary.isolatesKernel` | `false` | No provider here isolates the host kernel. |
| `worktree-lease.repository.hooksEnabled` | `false` | Hooks are untrusted execution inputs. |

### 4.4 The non-expansion rule stated for implementers

> A graph, node, router, planner, verifier, provider, tool, model response,
> resumed worker, dynamic patch or child graph MAY request **less** authority
> than its ceiling. None of them may request more, and none of them may restate
> who the caller is.

Retry and resume reuse the capability snapshot bound in `binding`. They MUST
NOT re-derive authority from ambient credentials that became available after
the snapshot. A resumed worker presenting a drifted `inputHash` is
`GE_CAP_BINDING_MISMATCH`, not a fresh grant.

## 5. The effect boundary

Authority is rechecked where the effect happens, not only where the graph
compiles. `evaluateEffect(effective, effect, approval, nowMs)` is evaluated in
this order:

1. domain absent from the effective manifest → `GE_CAP_DENIED_BY_DEFAULT`;
2. `network` with `enabled: false` → `GE_ISO_NETWORK_DENIED` (an explicit
   domain-level deny, distinct from an undeclared target);
3. target not present in the effective set → `GE_CAP_DENIED_BY_DEFAULT`;
4. a declared numeric bound exceeded → `GE_ISO_LIMIT_EXCEEDED`;
5. `approval.requiredFor` names this operation and no approval is bound →
   `GE_CAP_APPROVAL_REQUIRED`;
6. the approval is not bound to this exact payload hash, or has expired under
   the injected clock → `GE_CAP_APPROVAL_STALE`;
7. otherwise `GE_CAP_GRANTED`.

Tool discovery never implies tool authorization. An MCP tool that appears in a
server listing but not in `mcp.tools` is `GE_CAP_DENIED_BY_DEFAULT`. A mutating
MCP call under `allowMutation: false` is likewise denied; the current read-only
MCP default in [`docs/SECURITY.md`](../docs/SECURITY.md) is the contract
default, not an accident.

After a denial, no write, merge, external call or secret access may occur. A
denial is a structured terminal or routable result. It is never a prompt asking
a model how to proceed.

## 6. Resolved filesystem path policy

`evaluatePath(policy, request)` operates on resolved paths, never string
prefixes. `policy` names an already-resolved `root`, lease-relative
`allowedPaths` and `deniedPaths`, and whether mutation is granted. The request
carries a candidate string and a declarative `linkMap` naming the symlink
resolution the provider would observe.

Ordered evaluation:

1. NUL or backslash in the candidate → `GE_ISO_PATH_ESCAPE`;
2. absolute candidate not under `root` on a segment boundary →
   `GE_ISO_PATH_ESCAPE`;
3. any `.git` segment → `GE_ISO_REPOSITORY_METADATA_DENIED`;
4. lexical normalization; a `..` that underflows the root →
   `GE_ISO_PATH_ESCAPE`;
5. link resolution, re-verifying containment after **every** substitution; a
   target outside the root, a relative target that escapes, or a resolution
   cycle beyond 32 steps → `GE_ISO_SYMLINK_ESCAPE`; a target that lands in
   `.git` → `GE_ISO_REPOSITORY_METADATA_DENIED`;
6. the resolved path matches `deniedPaths` → `GE_ISO_PATH_NOT_GRANTED`
   (**deny precedes allow**; a path in both lists is denied);
7. the resolved path matches no `allowedPaths` entry →
   `GE_ISO_PATH_NOT_GRANTED`;
8. a mutating operation without a write grant → `GE_ISO_PATH_NOT_GRANTED`;
9. otherwise `GE_CAP_GRANTED`.

Authority MUST be rechecked at the operation boundary, not only at open time,
to reduce time-of-check/time-of-use exposure. An environment variable, `~`, a
glob, a command substitution or a model-produced string MUST NOT be a security
selector for a destructive target.

## 7. Git worktree provider

### 7.1 Deterministic branch identity

```text
name          = "ge/iso/" + runId + "/" + nodeId + "/" + attempt + "-" + discriminator
discriminator = SHA-256(canonicalJson([
                  "isolation-branch/v1alpha1", graphHash, runId, nodeId, attempt
                ]))[0:16]
```

`runId` and `nodeId` MUST match `^[a-z0-9][a-z0-9_-]{0,63}$` and `attempt` MUST
be an integer in `[1, 9999999]`. Anything else is `GE_ISO_IDENTIFIER_INVALID`
before a name is composed. The grammar is strictly narrower than git's own ref
rules, so no identifier can inject a ref path segment; the composed name is
additionally checked against the forbidden git-ref constructs as defence in
depth.

A lease whose declared `branch.name` or `derivation.discriminator` is not the
recomputed value is `GE_ISO_IDENTIFIER_INVALID`. Two leases claiming one branch
name are `GE_ISO_BRANCH_COLLISION`.

### 7.2 Namespaces are not only files

A worktree separates file history and nothing else. Isolation of parallel
writers therefore allocates, per lease:

```text
digest         = SHA-256(canonicalJson(["isolation-namespace/v1alpha1", leaseId]))
portBase       = 20000 + (digest[0:8] as integer mod 4096) * 8
portCount      = 8
tempDirectory  = "/var/tmp/ge-iso/" + digest[0:32]
cacheNamespace = "c_" + digest[0:32]
databaseSchema = "s_" + digest[0:32]
```

A declared allocation that is not the recomputed value is
`GE_ISO_IDENTIFIER_INVALID`. Overlapping port ranges, or an equal temporary
directory, cache namespace or database schema across two live allocations, are
`GE_ISO_NAMESPACE_COLLISION`.

### 7.3 Reuse requires a cleanup proof

A lease MUST NOT claim a port, temporary directory, cache namespace or database
schema that a previous lease retired unless that lease's cleanup receipt was
verified. Reuse without proof is `GE_ISO_NAMESPACE_REUSE`. This is the frozen
refusal for both the `port-reuse` and `temp-file-reuse` escape classes.

### 7.4 Cache entries are untrusted input

A cache entry is trusted only if it is in this lease's cache namespace, was
produced by this lease, and its content hash matches its bytes. Any other entry
is `GE_ISO_CACHE_UNTRUSTED_ENTRY`. The three conditions carry distinct reason
tags so that removing one is observable.

### 7.5 Lease lifecycle

States: `allocated → leased → active → releasing → released`, with
`quarantined` reachable from every non-terminal state. `released` and
`quarantined` are terminal.

Every lease event is evaluated in this order:

1. presented token ≠ `holder.holderToken` → `GE_ISO_LEASE_NOT_HELD` (this is
   the frozen refusal for lease theft);
2. the event is later than `expiresAtMs` and is not `quarantine` →
   `GE_ISO_LEASE_EXPIRED`;
3. the transition is not legal from the current state →
   `GE_ISO_LEASE_CONFLICT`.

`heartbeat` extends `expiresAtMs` by the lease TTL. `quarantine` is exempt from
expiry on purpose: a stale lease must still be quarantinable, or a crashed
worker's evidence is unreachable. Two leases claiming one worktree path are
`GE_ISO_LEASE_CONFLICT`.

Parallel agents never share a writable worktree.

### 7.6 Allocation

Allocation is refused when the worktree domain is undeclared, the requested
operation is not granted, repository hooks are requested, repository-config
execution is requested, submodule execution is requested
(`GE_ISO_HOOK_EXECUTION_DENIED` for all three), detached mode is requested
without a grant, the worktree path is inside a protected directory
(`GE_ISO_PATH_NOT_GRANTED`), the repository status is dirty
(`GE_ISO_LEASE_CONFLICT`), or the declared diff exceeds the grant
(`GE_ISO_LIMIT_EXCEEDED`).

Sparse or filtered checkout behaviour is declared explicitly in the lease and
never inferred.

### 7.7 Cleanup

Cleanup removes only a resource the provider created and still owns. A receipt
naming a resource with `createdByProvider: false`, or a value that is not
derivable from this lease, is `GE_ISO_CLEANUP_FOREIGN_RESOURCE`. A receipt
reporting a residual namespace, or failing to prove every declared namespace
domain, is `GE_ISO_CLEANUP_INCOMPLETE`. The receipt's own `outcome` field MUST
equal the recomputed classification; the oracle recomputes it rather than
trusting it.

Cleanup MUST NOT remove unrelated user work, and a security-relevant failure
preserves or quarantines the workspace rather than deleting it.

## 8. Restricted process isolation

A process specification is total: executable, argv, cwd, environment, secret
channel, network flag, seven limits and stream framing. Nothing is inherited
from the host.

Ordered refusals:

1. executable not in the grant → `GE_CAP_DENIED_BY_DEFAULT`;
2. any environment name outside the allowlist → `GE_ISO_ENV_INHERITED` (the
   frozen refusal for the `environment-inheritance` escape);
3. a secret value present in argv → `GE_ISO_SECRET_EXPOSED`;
4. a secret value present in an environment value while the declared channel is
   not `environment` → `GE_ISO_SECRET_EXPOSED`;
5. a secret channel broader than the grant → `GE_CAP_DENIED_BY_DEFAULT`;
6. network requested without a grant → `GE_ISO_NETWORK_DENIED`;
7. a declared limit above the ceiling → `GE_CAP_EXPANSION_DENIED`;
8. a working directory outside every granted root → `GE_ISO_PATH_NOT_GRANTED`;
9. an observed CPU, duration, memory, open-file, output-byte, process-count or
   temporary-byte value above its declared limit → `GE_ISO_LIMIT_EXCEEDED`;
10. termination requested and not achieved → `GE_ISO_KILL_FAILED`.

`truncationReceiptRequired` is pinned `true`: bounded stdout/stderr capture
without a truncation receipt would let a provider silently drop evidence.

An unsupported platform MUST answer `GE_ISO_PROVIDER_UNSUPPORTED` with a
structured diagnostic. It MUST NOT silently degrade to unrestricted execution.

## 9. Container isolation

Ordered refusals:

1. image digest absent, or provenance hash absent →
   `GE_ISO_IMAGE_UNVERIFIED` (a mutable tag is never an image identity);
2. image not in the grant → `GE_CAP_DENIED_BY_DEFAULT`;
3. privileged mode, root user, writable root filesystem, an unconfined seccomp
   profile, a host-socket mount, a host-root mount or a writable system mount →
   `GE_ISO_PRIVILEGE_DENIED`;
4. a required dropped capability omitted → `GE_CAP_EXPANSION_DENIED`;
5. network enabled without a grant, or an egress host outside the network
   allowlist → `GE_ISO_NETWORK_DENIED`;
6. a declared limit above the ceiling → `GE_CAP_EXPANSION_DENIED`.

> Container availability does not itself prove safety.

`trustBoundary.isolatesKernel` is pinned `false` for every provider kind
including `container`. Configuration and escape tests are candidate evidence;
the presence of a container runtime is not.

## 10. Isolation provider interface

### 10.1 Total operation set

Every provider MUST answer all eight operations of §18.1 — `allocate`,
`execute`, `exchange`, `inspect`, `cancel`, `diagnostics`, `release`,
`prove-cleanup`. A provider that cannot perform one answers
`GE_ISO_PROVIDER_UNSUPPORTED`; it MUST NOT omit the operation, because an
omitted operation is indistinguishable from a silently skipped one.

`prove-cleanup` is not optional. `cleanupProof.provesNoNamespaceRemains` is
pinned `true` and `scope` is pinned `provider-created-only`.

### 10.2 Declared trust boundary and the overclaim rule

Each provider declares exactly what it separates. The contract pins the maximum
each kind may claim:

| Provider kind | May claim |
| --- | --- |
| `noop-local` | nothing |
| `git-worktree` | filesystem only |
| `restricted-process` | filesystem, process, ports, temp files, caches, database namespaces |
| `container` | the above plus network |
| any | never the kernel |

A descriptor claiming more than its kind's maximum is
`GE_ISO_PROVIDER_UNSUPPORTED` with reason
`trust-boundary-overclaimed-for-provider-kind`, as is a namespace domain the
kind cannot separate, or an operation requested on a platform the descriptor
does not claim. A `false` in a trust boundary is a disclosure, not a defect.

## 11. Safe merge gate

### 11.1 Merge is a separate node

The merge node consumes immutable commits, diffs and gate reports. It never
receives a mutable worktree directory handle, and it is never an implicit
consequence of worker success. `merge-gate-decision.schema.json#/$defs/mergeRequest`
is the complete input; there is no directory field in it.

### 11.2 Ordered evaluation

The order is normative. An implementation that reports a later refusal while an
earlier one holds is non-conforming, because the earlier refusals describe an
unsafe input rather than a failing check.

1. observed base ≠ expected base → `GE_MERGE_STALE_BASE`;
2. presented source commits ≠ expected → `GE_MERGE_SOURCE_MISMATCH`;
3. worker status not clean → `GE_MERGE_DIRTY_STATE`;
4. a generated file altered → `GE_MERGE_GENERATED_DRIFT`;
5. a protected path touched → `GE_MERGE_PROTECTED_PATH`;
6. a touched path outside the worker's ownership → `GE_MERGE_OWNERSHIP_DENIED`;
7. any of lint, typecheck, test, build, security or package not `pass` →
   `GE_MERGE_GATE_FAILED` (a skipped gate is a failure, never a pass);
8. required approval absent → `GE_MERGE_APPROVAL_REQUIRED`;
9. approval expired, or not bound to this exact merge payload hash →
   `GE_MERGE_APPROVAL_STALE`;
10. a conflict present → `GE_MERGE_CONFLICT`;
11. external push requested without workflow authority →
    `GE_MERGE_EXTERNAL_PUSH_DENIED`;
12. otherwise `GE_MERGE_AUTHORIZED`.

The approval payload hash is

```text
SHA-256(canonicalJson([
  "merge-gate-payload/v1alpha1",
  targetBranch, expectedBaseCommit, sorted(expectedSourceCommits),
  strategy, sorted(touchedPaths)
]))
```

so any change to the target, base, sources, strategy or touched set invalidates
the approval automatically.

### 11.3 The invariant on every refusal

> On every non-authorized outcome the merge target is unchanged and the isolated
> work is preserved.

This is enforced twice: the schema pins `targetUnchanged: true` and
`isolatedWorkPreserved: true` on any outcome other than `merge-authorized`, and
the oracle asserts it on the recomputed decision rather than reading it from
the corpus. A conflict is a structured failure with retained conflict paths. It
is never a silent overwrite and never a destructive cleanup.

Nothing is pushed or merged externally without explicit workflow authority.

## 12. Composition with other frozen contracts

### 12.1 Redaction

Isolation output is a capture source and a capture sink.
`redaction-semantics.md` already classifies `worktree-output`,
`process-output` and `container-output` as sinks, and its capture policy has an
`isolationOutputs` mode. Diagnostics collected under §18.1 are observational,
never authoritative, and pass through the redaction contract before any sink
write. This document does not restate those rules and does not weaken them.

### 12.2 Approval

`binding.approvalRef` and `binding.approvalExpiresAtMs` are references to the
approval contract of master-plan §15.6, which is not frozen here. This document
freezes only that an approval is bound by hash, that it expires, that
rewriting it is `GE_CAP_AUTHORITY_IMMUTABLE`, and that a payload-unbound or
expired approval is stale.

### 12.3 Budget and verification

Isolation limits are per-attempt bounds on a single execution. They are not
budget accounting and MUST NOT be treated as a substitute for the D10 budget
ledger.

### 12.4 How capability non-expansion composes with redaction §4.4

The two rules are the same rule applied to two different lattices, and they
compose by intersection rather than by precedence.

`redaction-semantics.md` §4.4 says a graph, node, router, planner, verifier,
provider, tool, resumed worker, dynamic patch or child graph may request *less
observational capture*, and may not change `keyRef` or the policy hash, enable
a disabled sink, weaken a disposition, add a redaction path, raise a diagnostic
byte bound, or remove protection from an authoritative value.

§4 of this document says the same principals may request *less authority*, and
may not change the policy version, the authority level, the capability binding
or the approval identity, may not add a capability the ceiling does not
contain, and may not drop a restriction the ceiling imposes.

The composition rules are:

1. **Same requestor lattice.** Both contracts enumerate the same principals and
   place all of them below the operator policy. A principal that is untrusted
   for capture is untrusted for capability; there is no principal that may
   narrow one and widen the other.
2. **Both are intersections, so order does not matter.** Effective capture is
   `operator capture ∩ runtime support ∩ request`; effective authority is
   `operator ceiling ∩ … ∩ request`. Applying capability narrowing before or
   after capture narrowing yields the same pair, because neither function can
   increase the other's input.
3. **Two immutable identities, never merged.** The capture policy hash and
   `keyRef` are owned by §4.4; the capability `policyVersion`, `binding` and
   `approvalRef` are owned by §4 here. Neither contract may rewrite the other's
   identity, and an attempt to do so is that contract's own
   `CAPTURE_POLICY_MISMATCH` or `GE_CAP_AUTHORITY_IMMUTABLE` — the codes stay
   distinct so a joint failure names which lattice moved.
4. **Restriction fields invert in both.** §4.4's "cannot add a redaction path
   or increase the diagnostic byte bound" is the same monotonicity as this
   document's `superset` direction. An implementation that gets the direction
   right in one contract and wrong in the other has a real hole, and both
   corpora carry a vector for it.
5. **Fail-closed dominates in both.** §4.4 fails the operation rather than
   silently reducing capture when reduction would make recovery impossible;
   §4 fails closed on an unknown policy version. Where a capability denial and
   a capture denial are both live, the operation is refused and both structured
   decisions are retained; neither is downgraded to a warning.
6. **A denial is not a capture event.** A capability decision's `detail` is a
   metadata-only reason tag by §3.3, so recording a denial can never itself
   become an unredacted sink write.

## 13. Conformance obligations

The checked corpus contains 192 identified cases across fourteen sections plus
nine escape bindings:

| Section | Cases | What it isolates |
| --- | ---: | --- |
| `schemaCases` | 28 | closed-envelope truth for all four schemas and both sub-document families |
| `narrowingCases` | 26 | every pre-check, every direction of the §4.2 table, every domain, every requestor kind |
| `effectCases` | 25 | the §5 boundary including approval absence, drift and expiry |
| `pathCases` | 15 | traversal, absolute escape, `.git`, three symlink escapes, a cycle, deny-before-allow, allowlist, NUL, backslash, root, mutation |
| `branchCases` | 6 | derivation and all four identifier refusals |
| `registryCases` | 17 | forged names, forged namespaces, branch and path collisions, reuse with and without cleanup proof, declared-set disjointness |
| `leaseCases` | 6 | the full sequence, theft, expiry, illegal transition, heartbeat extension, quarantine-after-expiry |
| `allocationCases` | 10 | hooks, config execution, submodules, detached mode, protected directories, dirty status, diff bound |
| `cacheCases` | 4 | trusted entry and three poisoning shapes |
| `processCases` | 13 | the ten §8 refusals plus the granted path |
| `containerCases` | 16 | the §9 refusals including three privilege-mount shapes |
| `providerCases` | 7 | all four provider kinds plus overclaim, unsupported namespace, unsupported platform |
| `cleanupCases` | 5 | clean, two foreign-resource shapes, two incomplete shapes |
| `mergeCases` | 14 | every stage of the §11.2 order |

Hard coverage assertions, each a gate failure rather than a warning:

- every member of the 45-code vocabulary is produced by the run, and every code
  except `GE_CAP_MANIFEST_INVALID` is produced by a **semantic oracle** rather
  than by a schema verdict;
- the complete emitted reason set equals the corpus `reasonInventory`
  (146 tags), in both directions;
- every capability domain owns at least one isolated expansion vector;
- every requestor kind appears;
- every provider kind appears;
- every escape class is bound to a vector that resolves to a denial with the
  stated code;
- every inventory in the corpus deep-equals the corresponding schema enum;
- `implementationClaim` is literally `false` and
  `ambientAuthority.runtimeHasAmbientAuthority` is literally `true`.

### 13.1 Mutation adequacy

A corpus that only re-derives one golden run is not evidence. The binding
obligation is therefore stated as a mutation criterion:

> For every rejection rule the oracle implements, at least one vector must exist
> that isolates it — deleting that rule from the oracle must make the shipped
> corpus fail.

The criterion is verifiable mechanically. A harness replaces the condition of
each `if` that owns a refusal with `false` — that is, deletes the rule — and
requires the shipped corpus to fail. **On the corpus as shipped, 128 of 129
rules are held that way.**

The single survivor is disclosed rather than left for the next audit:

- `deriveBranch`'s forbidden-git-ref check. `runId` and `nodeId` are already
  constrained to `^[a-z0-9][a-z0-9_-]{0,63}$` and the composition inserts only
  `ge/iso/`, `/`, a decimal attempt and 16 hex characters, so no accepted input
  can produce `..`, `//`, `@{`, a `.lock` suffix, a control character or a
  git-special character. The check is defence in depth against a future
  relaxation of the grammar. It is implemented and it cannot fire from the
  frozen grammar; a vector for it would require changing §7.1.

Two shapes of vector are required by construction and must not be weakened.

First, a rule that shares a portable code with a neighbour is isolated by its
**reason tag**, not by its code. Deleting either of two guards that both report
`GE_ISO_CACHE_UNTRUSTED_ENTRY` changes the emitted reason set, and the corpus
pins that set exactly. This is the mechanism that keeps single-rule deletion
observable where a code-only comparison would be blind.

Second, a granted narrowing case is not proof on its own. Each one additionally
requires that re-narrowing the effective manifest against its own ceiling
reproduces the same canonical hash, so an oracle that widens during folding
fails even though its first answer looked right.

### 13.2 What the corpus deliberately does not contain

- No git command, shell command, container command or network request.
- No real filesystem access beyond reading the four schemas and the corpus.
- No real secret. `synthetic-isolation-secret` and
  `synthetic-cache-content` are the only seeded values, and they exist only as
  detector inputs.
- No claim that any decision in it was ever produced by a running system.

### 13.3 Native suite obligations

Both native runtimes MUST implement this contract independently against the
same corpus, and MUST add, without weakening any vector above:

1. cancellation before and after every allocate, execute, exchange, release and
   merge boundary;
2. crash and restart at every lease state, with lease recovery and stale-lease
   takeover;
3. real time-of-check/time-of-use races on path resolution, including a symlink
   swapped between check and open;
4. concurrent allocation of many leases with observed port, temporary
   directory, cache and database-schema disjointness under load;
5. non-cooperative executables that ignore termination, proving the independent
   kill path and `GE_ISO_KILL_FAILED` when it is exhausted;
6. repository hooks, `.git` indirection, submodules and hostile repository
   configuration as untrusted inputs;
7. hostile provider and support output, including oversized and malformed
   diagnostics;
8. prompt-injection campaigns attempting capability expansion through every
   requestor kind; and
9. the Linux, macOS and Windows matrix wherever a provider is claimed, with
   `GE_ISO_PROVIDER_UNSUPPORTED` everywhere it is not.

None of that exists today.

## 14. Master-plan and gate mapping

| Plan or gate | What this contract freezes | What remains Open |
| --- | --- | --- |
| §18.1 provider interface | Descriptor, total eight-operation set, declared trust boundary, overclaim rule, cleanup proof | Every provider implementation |
| §18.2 git worktree | Lease, deterministic identity, allow/deny paths, namespaces, reuse proof, cleanup scope, quarantine | Allocation, checkout, crash recovery, stale-lease takeover |
| §18.3 process isolation | Total launch spec, environment sanitation, secret channels, seven limits, observed-limit and kill refusals | Any launcher, any UID/GID or platform boundary |
| §18.4 container isolation | Image identity and provenance, privilege refusals, mounts, egress, limits | Any container runtime integration or vulnerability gate |
| §18.5 safe merge gate | The separate node, the ordered evaluation, the payload binding, the target-unchanged invariant | The merge node itself and its gate runners |
| §18.6 red-team campaign | Nine escape classes bound to denial vectors; the corpus and its mutation criterion | `D12-ISOLATION-REDTEAM-047`, the OS matrix, independent adversarial ownership |
| §15.7 capability policy | Twelve domains, eight levels, deny-by-default, the narrowing algebra, non-expansion | Any policy engine in any runtime |
| Day 12 exit gate | Nothing | All of it; the gate stays Open |
| `T09`, `T23`, `T24`, `T28` | The shared vectors those campaigns will run | The campaigns and their R3 evidence |

Freezing this contract does not move the Day 12 gate, does not change the
`S1`, `S2` or `S3` rows of the architecture backlog, and does not license any
adapter, mutating MCP surface, shared worker or launch claim to proceed as
though isolation existed.
