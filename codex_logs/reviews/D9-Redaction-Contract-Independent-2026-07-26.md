# D9 redaction contract independent hostile review — 2026-07-26

- Review lane: `/root/d9_contract_independent_review`
- Producer lane under review: `/root/d9_redaction_contract_closure`
- Task: `D9-REDACTION-039`
- Risk class: critical / R3
- Repository: `/home/nick/work/GraphEngineering`
- Branch observed: `feat/authoring-foundation`
- HEAD and remote feature ref observed:
  `f57dab96d2f970e6a1c90231a3f2a1f3d4f5e58d`
- Review output ownership: this report only
- Verdict: **CHANGES REQUIRED / BLOCKED**
- Contract state: **Draft**, not **Contract accepted**
- Commit disposition: **DO NOT ISSUE `ACCEPT-FOR-CONTRACT-COMMIT`**

There are no newly discovered contract-level P0 findings, but there are seven
open contract-level P1 findings. The already known product/release P0 remains:
both native v1alpha1 durable writers persist raw payloads while asserting
`redacted: true`. That inherited P0 is intentionally left to
`D9-TS-REDACTION-087`, `D9-PY-REDACTION-088`, and
`D9-REDACTION-CONFORMANCE-089`; it is not hidden by this review and is not used
to force native implementation into `039`.

Severity census at this reviewed snapshot:

| Class | Count | Disposition |
| --- | ---: | --- |
| New contract P0 | 0 | None found |
| Inherited runtime/release P0 | 1 | Open downstream; current false v1alpha1 wire signal |
| Contract P1 | 7 | All must close before contract acceptance |
| P2 maintenance/coverage | 2 | May remain only with owners and explicit follow-up |

## 1. Independence, scope, and immutable review boundary

The reviewer did not author the D9 contract, did not edit any of the fourteen
schemas, the corpus, author reports, master plan, registry, architecture,
shared validator, TypeScript, or Python. The only repository write from this
lane is this report.

The review read, rather than inferred from summaries:

- the complete current 3,164-line append-only master plan, including the
  original 368 lines and Sections 9–30, with detailed attention to Sections
  15, 23, 26.3, 27, and 29;
- the complete 577-line exhaustive master-plan audit;
- the prior D9 audit and the producer closure handoff;
- all 1,273 lines of `spec/redaction-semantics.md`;
- all fourteen D9 JSON Schemas and every case in
  `spec/conformance/redaction.case.json`;
- the complete D9 implementation brief, security/isolation architecture, task
  dependency graph, release checklist mappings, and live task registry joins;
- the current TypeScript and Python event, checkpoint, persistence, durable
  runtime, CLI, MCP, and serialization paths; and
- the shared validator and spec registry/README paths.

The master plan grew append-only during this review. The final plan snapshot
used for the verdict is:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| Complete master plan | 3,164 | `8679289cb7540c1e0dfe35d7733cfbf9d5534eb828e1f8ca7718b5452ab53527` |
| Original first 368 lines | 368 | `2adf06d48d89787cda77ddbf6f3480e2b9a922f632e94d7b2603c10700cda475` |
| Exhaustive master-plan audit | 577 | `4585c726c8be3d465b3e23322b789e8de1d5a12c9094aca84597d230a3c894f7` |

The append-only plan extension is material. It now explicitly requires a live
source/sink inventory, no prototype traversal, portable pointer/value resource
bounds, receipts bound to source/result/rules/implementation/registry/
authority/context, property/fuzz coverage, and a specification task that can
complete before its native dependents. The producer correctly reviewed the
then-current 368-line plan, but its contract must now satisfy the stricter
canonical plan before acceptance.

The worktree was intentionally dirty with concurrent root/D7/D4/TS work. This
review binds the D9 artifact hashes below and makes no claim that the whole
working tree is an immutable candidate.

## 2. What independently passed

The producer delivered substantial and useful contract work. The following
facts were independently reproduced:

1. All fourteen schemas parse without duplicate keys and satisfy the JSON
   Schema Draft 2020-12 meta-schema.
2. Ajv 8.20.0 compiles all fourteen under `strict: true`; the corpus validates;
   all 20 wire cases match their declared outcomes: 11 valid and 9 invalid.
3. The corpus has 109 globally unique case IDs across the seven case sections:
   20 wire, 16 pointer, 15 guard, 6 bypass, 10 derivative, 35 source, and 7
   legacy cases.
4. The present schema enums and fixture inventories agree exactly at 34 sink
   names and 35 source names.
5. An independently written RFC 6901 reference transform reproduced all 16
   fixture outcomes, including strict escaping, array indices, missing targets,
   overlap, duplicate location, ordering, immutable-snapshot resolution, and
   remove versus replacement behavior.
6. The six modeled store bypasses deny and write zero sinks; all modeled failed
   guard paths write zero raw bytes; observational/redacted derivative cases do
   not feed scheduling.
7. The live registry dependency join is exact:
   `039 -> 087/088 -> 089`, while `089 + 077 -> 031`.
8. The semantics correctly distinguish protected/encrypted from redacted,
   require `redacted: false` for protected refs, make the event journal
   authoritative, keep checkpoints rebuildable, and forbid redacted
   observations from scheduler authority.
9. The post-executor protection-failure prose is conservative: no false
   success, false executor failure, edge, terminal record, or dependent release;
   effectful outcomes become in-doubt.
10. Legacy misleading v1alpha1 histories are explicitly unsafe and cannot be
    silently rewritten or resumed.

These passes are structural and partial semantic evidence. They do not erase
the P1 carrier gaps below.

## 3. Open contract P1 findings and executable fixes

### P1-01 — AAD is not occurrence- or authority-complete

**Affected contract files and fields**

- `spec/protected-aad.schema.json`, required properties and `$defs`;
- `spec/redaction-semantics.md`, Sections 5.5, 5.6, 6.2, and 8.5;
- `spec/protected-store-envelope.schema.json`, `authorityBindingHash`, `aad`,
  and `protectedValue` semantic joins;
- `spec/conformance/redaction.case.json`, protected AAD/store/checkpoint/
  derivative cases.

`protected-aad/v1alpha1` currently binds run, graph revision, record kind/type,
optional node/edge/attempt, field path, policy, codec, and value MAC. It does
not bind `eventId`, event `sequence`, `checkpointId`, checkpoint `sequence`,
`keyRefHash`, or a closed tenant/authority scope identity.

That contradicts three normative claims:

- encryption is bound to a persisted occurrence;
- every scheduler checkpoint creates a new checkpoint-bound occurrence/AAD;
- copying a ref to a different occurrence must fail.

Two checkpoints in one run can differ in checkpoint ID and through-sequence but
have identical current AAD for the same projection type, node, attempt, field,
policy, and value MAC. The contract simultaneously permits ref reuse whenever
the complete current AAD is byte-identical. A copied old checkpoint ref can
therefore authenticate as the supposedly new checkpoint occurrence. Likewise,
the cryptographic AAD does not distinguish two tenant/authority scopes that
reuse a run identifier and underlying protection key. Store authorization may
still reject the lookup, but the portable cryptographic carrier cannot prove
the claimed occurrence/authority separation, and two implementations can make
different choices.

**Minimum `039` fix**

Define one closed occurrence identity in AAD. At minimum:

- event occurrences bind `eventId` and `sequence`;
- checkpoint occurrences bind `checkpointId` and `sequence`;
- AAD binds `keyRefHash` and either a privacy-safe `authorityScopeHash`/
  tenant-scope hash or a precisely specified equivalent portable binding;
- conditionals require the right occurrence fields for `recordKind` and forbid
  the wrong fields;
- ref reuse language is reconciled with “always new checkpoint occurrence”; and
- store semantic validation defines exact equality among envelope run/policy/
  key/authority, AAD, ref, blob, and host capability scope.

**Minimum positive and hostile fixtures**

- same value in two different checkpoints: different AAD/aadHash/ref;
- copy checkpoint A ref into checkpoint B: reject before fold/executor;
- same event data at two sequences/event IDs: distinct occurrence AAD;
- change only key-reference identity: reject;
- change only tenant/authority scope: reject;
- retain the same logical `valueMac` across a legitimate retry while creating
  fresh occurrence AAD where any occurrence field differs;
- exact byte-identical idempotent replay of one store operation remains valid.

**Task boundary**

`039` owns the closed fields, conditionals, semantics, and fixtures. `087` and
`088` later implement native AAD construction and store enforcement. `089`
owns fixed crypto vectors, cross-language bytes, copy/substitution attacks, and
packaged canary evidence. No native code is required to close this contract
finding.

### P1-02 — the redaction receipt and rule-registry carrier cannot bind the transform claimed by the current master plan

**Affected contract files and fields**

- `spec/redaction-receipt.schema.json`;
- `spec/redaction-rule.schema.json`;
- `spec/capture-policy.schema.json`;
- `spec/payload-disposition.schema.json` and
  `spec/sink-guard-decision.schema.json` receipt references;
- `spec/redaction-semantics.md`, Sections 3.3, 4.1, and 7;
- receipt/policy/guard cases in `spec/conformance/redaction.case.json`.

The current receipt contains only `policyHash`, transform version, paths,
replacement mode, and count. The plan now requires receipts that bind the
source hash, result hash, rule set, policy, transform implementation, live rule
registry, authority, and timestamp/event context. Policy hashing does bind the
inline rule list, and deterministic guard replay is valuable, but it does not
provide the remaining carrier identities. There is no registry identity or
version, no source/result hash, no implementation identity, no authority
binding, and no occurrence/context field in the receipt.

Without these fields a serialized receipt is not self-identifying evidence for
which source/result/context was checked. It must always be reconstructed from
ambient candidate state, and exported/audited receipts from distinct writes
can be swapped without structural rejection. Guard replay can detect some
swaps, but the durable audit carrier still fails the stricter contract and
cannot support live registry mutation/stale-policy tests unambiguously.

**Minimum `039` fix**

Version the receipt/rule contract and add privacy-safe, domain-separated fields
for at least:

- `sourceHash` and `resultHash` over exact canonical pre/post-transform bytes;
- `ruleSetHash` (even if also transitively present in `policyHash`);
- `transformImplementationHash` or a closed normative implementation identity;
- `ruleRegistryHash`/version and resolution identity;
- `authorityBindingHash` with a defined hash input, not arbitrary hex;
- sink/decision/occurrence context, including the event or write identity and
  a deterministic persisted timestamp/context when one is required; and
- an exact rule explaining which fields are audit correlation and which are
  authenticated authorization inputs.

The receipt must still contain no secret, removed value, reversible token,
unkeyed logical-value digest, or value length.

**Minimum positive and hostile fixtures**

- exact source/rules/policy/registry/authority/context reproduces the result;
- mutate source only, result only, rule order, registry version, transform
  identity, authority scope, sink, or occurrence: `REDACTION_RECEIPT_INVALID`;
- stale registry resolution during a write is atomic failure, not mixed policy;
- receipt from one derivative cannot bless another derivative or authority;
- canonical receipt bytes and hashes agree cross-language.

**Task boundary**

`039` owns the carrier and deterministic validation rules. `087`/`088` create
and check receipts in native guards. `089` performs stale-registry races,
cross-language byte comparison, derivative swaps, and canary scans.

### P1-03 — the claimed 34-sink/35-source inventory is neither complete for the canonical plan nor a machine-complete source-by-sink policy join

**Affected contract files and fields**

- `spec/capture-source.schema.json` and `spec/capture-sink.schema.json` enums;
- `spec/capture-policy.schema.json` controls;
- `spec/redaction-semantics.md`, Sections 1.2 and 4;
- `spec/redaction-conformance.schema.json`, inventory, sensitive-field, and
  guard-case shapes;
- `spec/conformance/redaction.case.json`, inventories and policy intersection
  cases.

The exact enum/corpus equality check passes at 34/35, but equality to itself is
not completeness. Canonical plan Section 15.2 requires a machine-readable live
inventory for, at minimum, event data, checkpoint state, metrics attributes,
MCP request and response, plugin communication, worktree/process/container
output, database indexes/materialized projections, backups, export/replay/fork
reports, and test/benchmark failure artifacts. Several have no unambiguous
current source, sink, or policy-control row. Generic `network-export`,
`transport-buffer`, `trace-attribute`, or `release-evidence` names do not define
which exact intersection controls these distinct destinations.

There is also no machine-readable complete source-by-sink policy table or total
evaluator corpus. The 35 sensitive-field cases state one default action per
source without a destination. The 15 guard cases exercise only 7 of 34 sink
classes. Thus neither 1,190 intersections nor an equivalent total rule table is
machine-checked. The prose says all applicable controls intersect, but a new
adapter cannot currently run CI to prove that every field has exactly one
classification and every destination has a disposition.

Runtime/customer-controlled identifiers are another unclosed path. Public run,
event, checkpoint, graph, node, and edge identifiers are persisted as inline
metadata and appear in errors/CLI/MCP projections. A canary that satisfies the
identifier regex can bypass application-value protection unless the contract
classifies these identifiers and constrains whether they are operator-safe,
opaque generated values, or untrusted application metadata.

**Minimum `039` fix**

- Reconcile the enums/mappings with every minimum category in master-plan
  Section 15.2, or explicitly version a closed carrier that names each category
  and maps it to an existing enum without ambiguity.
- Add controls/mappings for metrics, plugin, worker/isolation output, database
  projections/backups, and test/benchmark artifacts.
- Define treatment of public/caller-controlled identifiers.
- Add a machine-readable total source×sink rule table or a deterministic total
  policy evaluator fixture that covers every current source and sink and
  rejects unknowns.
- Make inventory evolution fail CI when a new code sink/source lacks a row.

**Minimum positive and hostile fixtures**

- exact plan-minimum inventory equality and unique mapping;
- at least one permitted and one denied intersection per destination family;
- every source and every sink participates in a machine-evaluated case;
- metrics, plugin, process/worktree, database-index, backup, export, and test
  failure artifact rows;
- secret-like caller identifiers are rejected, generated opaque, protected, or
  explicitly classified—not silently treated as safe metadata;
- unknown source/sink/control always denies, never aliases to the nearest enum.

**Task boundary**

`039` owns inventory and intersection carriers. `087`/`088` inventory actual
native call sites and make default sinks accept only prepared writes. `089`
seeds one or more canaries per source/sink, verifies detector controls, and
scans actual bytes. Future code must version/extend the live inventory rather
than bypass it.

### P1-04 — pointer/prototype and portable resource bounds are incomplete

**Affected contract files and fields**

- `spec/redaction-rule.schema.json`, `paths`;
- `spec/redaction-receipt.schema.json`, `paths`;
- `spec/protected-aad.schema.json`, `fieldPath`;
- `spec/capture-policy.schema.json`, total canonical byte size;
- `spec/checkpoint-v1alpha2.schema.json`, aggregate protected-ref count;
- `spec/redaction-semantics.md`, Sections 3.3 and 11;
- pointer, policy, checkpoint, and hostile cases in the corpus.

The 16 current pointer cases correctly settle basic RFC 6901 behavior, but the
expanded plan requires no prototype-property traversal plus maxima for pointer
count, token count, token bytes, value depth, value count, and transformed
bytes. The current contract has no depth, token-count, value-count, or
transformed-byte bound and does not reject `__proto__`, `prototype`, or
`constructor` paths. The prose currently treats any exact object key as a
target, while the canonical plan says prototype-property traversal is invalid.

JSON Schema `maxLength` counts Unicode characters, not UTF-8 bytes. An AAD path
of `/` plus 600 `é` characters passes the 1,024-character schema limit while
exceeding the normative 1,024-byte limit. A capture policy with 1,024 long
paths passes its structural schema while exceeding the normative 65,536-byte
canonical policy limit. A structurally valid checkpoint with 1,025 succeeded
nodes and two refs per node contains 2,051 refs and passes the schema despite
the normative 1,024-ref aggregate maximum. A deeply nested value under 64 MiB
can still exhaust recursive TS/Python walkers.

**Minimum `039` fix**

- Define exact forbidden prototype-name/path behavior and own-property-only
  traversal, including null-prototype/`Object.hasOwn` safe implementation
  requirements for JavaScript.
- Add portable maxima for value depth, total containers/members/values,
  pointer tokens, token UTF-8 bytes, transformed UTF-8 bytes, and aggregate
  refs.
- State iterative or bounded traversal behavior and failure precedence.
- Add semantic byte/count checks where JSON Schema cannot express them.
- Reconcile the checkpoint schema maximum with the aggregate ref maximum.

**Minimum positive and hostile fixtures**

- `__proto__`, `constructor`, `constructor/prototype`, and `prototype` paths;
- exact-bound and over-bound UTF-8 paths using multi-byte Unicode;
- exact-bound and over-bound depth/token/value/container/transformed bytes;
- exact 1,024 refs and 1,025 refs across one event/checkpoint;
- policy at 65,536 canonical bytes and one byte above;
- normalization-collision keys and hostile deep arrays/objects;
- both runtimes return the same stable failure before partial transform/write.

**Task boundary**

`039` owns limits, precedence, and fixtures. `087`/`088` implement bounded,
prototype-safe native traversal. `089` runs differential fuzz/property/resource
tests and byte scans.

### P1-05 — the attack corpus does not carry the semantic invalid cases that the contract says a shared validator must enforce

**Affected contract files and fields**

- `spec/redaction-conformance.schema.json` case sections;
- `spec/conformance/redaction.case.json` hostile semantic cases;
- `spec/redaction-semantics.md`, Sections 1.1, 4, 5, 6, 7, 11, and 12.

JSON Schema is correctly described as structural only. Therefore Ajv accepting
a cross-object inconsistency is not itself a schema bug. The blocker is that
the checked-in attack corpus does not contain the inputs/expected failures for
many mandatory semantic rules, and no durable corpus oracle can be implemented
from the fixture alone.

An independent hostile suite constructed 19 prose-invalid mutations. Strict
Ajv accepted all 19, as expected for structural validation:

1. rule incompatible with metadata-only policy;
2. noncanonical policy path order;
3. duplicate rule sink;
4. policy over 65,536 canonical UTF-8 bytes;
5. receipt count unequal to path count;
6. noncanonical receipt path order;
7. non-zero unused base64url tag bits;
8. ciphertext length congruent to one modulo four;
9. AAD path over the UTF-8 byte limit;
10. store run ID unequal to AAD run ID;
11. ref value MAC unequal to AAD value MAC;
12. store policy unequal to AAD policy;
13. event output MAC unequal to ref value MAC;
14. parent span without a surrounding trace/span;
15. checkpoint graph-input MAC unequal to its ref;
16. checkpoint with 2,051 refs over the aggregate limit;
17. failed guard omitting executor/retry disposition;
18. one missing source-classification case; and
19. one case ID duplicated across two corpus sections.

The fixture currently contains no canonical mutated documents and expected
codes for most of these. The producer's ephemeral semantic script is useful
author evidence but is not a versioned, reproducible contract carrier.

**Minimum `039` fix**

- Extend the corpus schema with semantic-mutation/state-relation cases, or add
  equivalent versioned case sections.
- Check in every mutation above with expected validity/code/no-write/
  no-executor behavior.
- Define global ID uniqueness and exactly-one classification case per source in
  the corpus semantics, not merely an author script.
- Include canonical base64 decode/re-encode, cross-object hash/MAC/AAD joins,
  policy/rule consistency, event/checkpoint fold relations, and aggregate
  bounds.

The shared repository validator integration itself is explicitly a Wave 26.3
integration-lane action after contract acceptance. This finding does **not**
require editing `scripts/validate-fixtures.mjs` inside the producer lane. It
requires the `039` corpus to carry enough inputs and expected outcomes so that
the integration lane can implement a durable oracle without inventing missing
semantics.

**Minimum positive and hostile fixtures**

- every mutation above and its exact stable code;
- one valid fixed join beside each invalid mutation;
- unknown fields and absent/defaulted conditional fields;
- global case ID duplicate and missing/duplicate source/sink coverage;
- no-write/no-executor assertions for authority-affecting failures.

**Task boundary**

`039` owns semantic fixtures and their expected outcomes. Root/integration
joins them into the shared validator after acceptance. `087`/`088` consume the
same cases in native validators. `089` adds runtime, crypto-vector, race,
package, and byte-level security evidence.

### P1-06 — omitted `sideEffects` has no v1alpha2 normalization or rejection rule

**Affected contract files and fields**

- `spec/event-v1alpha2.schema.json`, `$defs.nodeScheduledData.sideEffects`;
- `spec/redaction-semantics.md`, Sections 6.1, 8, and 10.1;
- guard/recovery cases in `spec/conformance/redaction.case.json`;
- the Graph IR contract as a referenced compatibility input.

Graph IR currently makes `NodeSpec.sideEffects` optional. Both native durable
implementations normalize omission to the string `unspecified`. The v1alpha2
event schema requires `NodeScheduled.sideEffects` and permits only `none`,
`idempotent`, or `non-idempotent`. The redaction/recovery prose uses that field
to decide whether an open attempt may be retried or is in-doubt but does not
say what a fresh v1alpha2 start does when the graph omits the optional field.

One implementation may reject before the run, another may default to `none`,
and another may preserve `unspecified`. Defaulting to `none` can automatically
repeat an effect after a post-executor protection failure. This is an authority
and retry-safety divergence, not just a type mismatch.

**Minimum `039` fix**

Choose and freeze one of two safe behaviors:

1. add closed `unspecified` to v1alpha2, serialize it, and always classify its
   open attempts as `in-doubt-effect`; or
2. require explicit side-effect classification for v1alpha2 and reject the
   graph/start before any event, protected-store write, or executor call.

Never infer `none` from omission.

**Minimum positive and hostile fixtures**

- omitted Graph IR side effects at fresh start;
- explicit `none`, `idempotent`, and `non-idempotent`;
- unknown classification rejection;
- open-attempt resume after executor success/protection failure for every
  classification, including omission/unspecified;
- exact retry disposition, executor call count, and event-write count.

**Task boundary**

`039` defines normalization/rejection and recovery semantics. `087`/`088`
implement them. `089` proves cross-language recovery parity and effect-safe
fault injection.

### P1-07 — task completion documents create a specification/native dependency deadlock and retain stale security mapping

**Affected control files**

- `codex_plans/delivery/d9-redaction-implementation-brief.md`, Section 14;
- `codex_plans/architecture/security-and-isolation.md`, Sections 18.1–18.2;
- `codex_logs/task-registry.json`, task scopes/dependencies/status evidence;
- master-plan Section 9.5 and Wave 26.3 as the controlling rule.

The live registry and producer handoff correctly narrow `039` to the contract,
with `087`/`088` depending on completed `039` and `089` depending on both
native tasks. The implementation brief nevertheless says `D9-REDACTION-039`
is complete only after default packaged native behavior, both-language
hash/replay behavior, clean-package canary scans, focused native suites, full
workspace gates, and independent R3 all pass. Those are downstream
`087`/`088`/`089` requirements. If that Definition of Done controls status,
the native tasks cannot start because they depend on the task whose completion
requires them.

The current master plan explicitly forbids this: a specification task must be
scoped so it can complete before its native dependents. The security
architecture is also stale: it still says the false-redaction correction has
no dedicated registry task and S0 is unmapped, despite live tasks 039/087/088/
089.

**Minimum `039`/integration fix**

- Rewrite the brief's Section 14 as the contract-only Definition of Done:
  closed normative carriers, hostile fixtures, exact hashes, no contract
  P0/P1, independent R3, and explicit downstream exclusions.
- Move native/package/canary requirements into 087/088/089 definitions and the
  Wave B roll-up without weakening them.
- Update the security architecture to point to the live corrective tasks and
  distinguish contract accepted from native/conformant/candidate Green.
- Complete `039` only after a remediated independent review; then dispatch
  087/088 from the frozen hash.

**Minimum positive and hostile controls**

- registry DAG remains unique, acyclic, and exact;
- a task cannot require artifacts owned only by a dependent task;
- documentation scope matches registry expected artifacts/tests;
- release map/checklist remain Open for native/security/candidate leaves;
- stale “unmapped” security text is rejected by a docs/control check or review.

**Task boundary**

This is a contract/control-document fix, not native work. `039` can then close
honestly; 087/088/089 stay Open and retain every implementation, canary,
package, and independent security requirement.

## 4. P2 findings

### P2-01 — producer tool-version transcript is not reproducible in the reviewed environment

The producer reports Python 3.14.4 and jsonschema 4.19.2. The exact repository
command during independent review reports Python 3.14.0 and jsonschema 4.26.0.
The schema outcomes still agree, so this is not a P1, but an immutable review
must record actual argv/tool resolution and should not reuse the producer's
version line without a preserved environment manifest.

### P2-02 — failure/legacy coverage remains sparse after the P1 corpus gaps

The 15 guard cases reach 7 of 34 current sink enums. `encode`, `mac`, and
`canonicalize` exist in the failure-point vocabulary but have no guard case;
most failure-point × side-effect combinations are absent. The seven legacy
cases do not exhaust misleading-true/absent/truthful-false across terminal and
nonterminal shapes. Normative prose largely defines the result, so these are
P2 at contract freeze if P1-05 is fixed, but they are mandatory native/fault
injection work in 087/088/089 and candidate Section 23.5 evidence.

## 5. Disposition of the original eight blockers

| # | Original blocker | Independent disposition | Reason |
| ---: | --- | --- | --- |
| 1 | No total pre-sink transform | **Partially answered; P1 open** | Prepared-write prose is strong, but the receipt carrier and durable semantic attack corpus are incomplete (P1-02/P1-05). |
| 2 | Sink inventory incomplete | **Open P1** | Self-equality at 34/35 does not satisfy the expanded live inventory or a machine-complete source×sink join (P1-03). |
| 3 | RFC 6901 ambiguity | **Core behavior passes; P1 open** | All 16 cases pass, but prototype traversal and portable depth/token/value/byte/ref bounds remain undefined or untested (P1-04). |
| 4 | Store/default-adapter bypass | **Contract prose substantially answered; P1 open** | Opaque capability/deny cases are sound, but occurrence/authority/key joins and semantic mutations are not complete carriers (P1-01/P1-05). Native bypass evidence remains 087/088/089. |
| 5 | Derivative/replay/fork inheritance | **Open P1** | Reclassification prose is strong, but checkpoint AAD cannot cryptographically distinguish the required new occurrence (P1-01). |
| 6 | Secret-bearing sources incomplete | **Open P1** | Expanded sources/sinks and caller-controlled identifier treatment are not machine-mapped (P1-03). |
| 7 | Post-executor protection failure | **Partially answered; P1 open** | Atomicity prose/cases are conservative, but optional `sideEffects` has no safe v1alpha2 decision (P1-06); exhaustive fault injection remains downstream. |
| 8 | Security dependency join absent | **Registry join passes; control P1 open** | Live edges are exact, but the brief's `039` Definition of Done makes completion circular and security mapping is stale (P1-07). |

## 6. `D9-REDACTION-039` expected-test verdicts

| Registry expected test | Verdict | Evidence and gap |
| --- | --- | --- |
| Canonical wire flag truth table | **Contract shape conditionally passes** | Protected/metadata v1alpha2 records are `redacted: false`; observational redaction requires a receipt. Current v1alpha1 runtime/schema hotfix remains deliberately downstream/Open. |
| Sink-before-write transform and policy contract | **Blocked** | Guard shape is useful, but receipt identity, complete inventory/intersection, bounds, and semantic hostile corpus have P1 gaps. |
| Replay identity and authority invariants | **Blocked** | Checkpoint occurrence AAD and authority/key binding are incomplete; omission of side effects can diverge on safe retry. |
| Legacy misleading-history migration contract | **Contract baseline passes with P2 coverage gap** | Reject/quarantine/archive/new-run rules are clear; native migration and package evidence remain Open. |

Therefore `039` cannot be marked completed or accepted at this snapshot.

## 7. Day 9, Day 16, I06, T26, and release boundary

| Requirement | Independent state | Why it remains Open |
| --- | --- | --- |
| Day 9 durable execution | Partial local-DAG milestone; redaction contract Draft | Seven contract P1s plus all native redaction, approvals, leases, replay/fork, SQLite/artifacts, races, and production stores remain. |
| Day 16 security | Open/planned | Requires 089, isolation, privacy, fuzz/property tests, secret/license/SBOM/package scans, and zero unaccepted high/critical findings. |
| `I06` / `REL-I06` | Open | Default policy prose is not clean-installed telemetry/capture proof; privacy/retention/withdrawal and enabled-capture sinks remain. |
| `T26` / `REL-T26` | Open | No TS/Python installed sink-byte campaign, negative detector harness, or candidate-bound independent security disposition exists. |
| `D16-PRIVACY-079` | Open/planned | Consent, retention, deletion/withdrawal and human data-owner authority remain. |
| `D16-SECURITY-062` | Open/planned | Full candidate security preflight remains. |
| `D18-SUPPORT-READINESS-080` | Open/planned/external | Real support-bundle sink, incident/tabletop and acknowledged roster remain. |
| Provenance/RC/release | Open | No candidate overlay, package provenance, supportable RC, stable decision, or release authorization follows from a contract. |

The 6,000-star objective is an organic stretch outcome, not an engineering or
security acceptance condition and not something this report can guarantee.

## 8. Actual native and sink-path audit

The contract handoff is honest that native work is absent. Direct inspection
confirms the following current boundaries:

| Surface | Current code evidence | Disposition |
| --- | --- | --- |
| TypeScript durable writer | `packages/runtime/src/durable.ts:397-409` hashes raw draft data, sets `redacted: true`, and retains `data: draft.data`. | Known inherited product P0; 087 Open. |
| Python durable writer | `python/src/graph_engineering/durable.py:217-228` does the same. | Known inherited product P0; 088 Open. |
| Python event model | `python/src/graph_engineering/events.py:84` defaults `redacted` to `True`. | Known inherited P0 carrier behavior; native/schema hotfix Open. |
| TS JSONL event store | `packages/persistence/src/jsonl-event-store.ts:107-137` accepts validated `GraphEvent` values and serializes them directly. | No prepared-write guard yet. |
| Python JSONL event store | `python/src/graph_engineering/persistence/event_store.py:222-250` serializes current `GraphEvent` values directly. | No prepared-write guard yet. |
| TS checkpoint store | `packages/persistence/src/file-checkpoint-store.ts:215-257` snapshots arbitrary v1alpha1 state and writes temp/final JSON. | Current raw checkpoint path; 087 Open. |
| Python checkpoint store | `python/src/graph_engineering/persistence/checkpoint_store.py:242-272` writes current v1alpha1 state to a temporary then final file. | Current raw checkpoint path; 088 Open. |
| TS CLI | `packages/cli/src/cli.ts:500-512` serializes machine envelopes; diagnostics include caller/source-controlled metadata. | Must be inventoried/integrated by 087/089 as runtime surfaces grow. |
| Python CLI | `python/src/graph_engineering/cli.py:1118-1141` writes compact JSON/human errors to stdout/stderr. | Must be inventoried/integrated by 088/089. |
| MCP | `packages/mcp-server/src/server.ts:89` and tool projections serialize schema/diagnostic data. | Read-only today; redaction mapping and future mutation remain downstream. |

There is no `packages/persistence/src/redaction.ts`, no
`python/src/graph_engineering/redaction.py`, and no packaged secret-canary
harness or immutable redaction manifest. That is expected Open work, not a
reason to label the current contract implementation-complete.

## 9. Exact validation environment and commands

Working directory for every command below:
`/home/nick/work/GraphEngineering`.

Observed versions:

```text
$ node --version
v22.23.1
$ corepack pnpm exec node -e "console.log('ajv',require('ajv/package.json').version)"
ajv 8.20.0
$ uv run --project python python -c "import platform,importlib.metadata; print(platform.python_version()); print(importlib.metadata.version('jsonschema'))"
3.14.0
4.26.0
```

### 9.1 Duplicate-key parsing and Draft 2020-12 meta-schema

Exact invocation:

```bash
uv run --project python python - <<'PY'
import json
from pathlib import Path
from jsonschema import Draft202012Validator
NAMES={
 'capture-policy.schema.json','capture-sink.schema.json','capture-source.schema.json',
 'checkpoint-v1alpha2.schema.json','event-v1alpha2.schema.json','payload-disposition.schema.json',
 'protected-aad.schema.json','protected-blob.schema.json','protected-store-envelope.schema.json',
 'protected-value.schema.json','redaction-conformance.schema.json','redaction-receipt.schema.json',
 'redaction-rule.schema.json','sink-guard-decision.schema.json'}
schemas=[p for p in sorted(Path('spec').glob('*schema.json')) if p.name in NAMES]
def reject(pairs):
    out={}
    for key,value in pairs:
        if key in out: raise ValueError(f'duplicate key: {key}')
        out[key]=value
    return out
for path in [*schemas,Path('spec/conformance/redaction.case.json')]:
    doc=json.loads(path.read_text(),object_pairs_hook=reject)
    if path in schemas: Draft202012Validator.check_schema(doc)
print(f'PASS duplicate-key + Draft202012 meta-schema: schemas={len(schemas)} fixture=1 fixtureKeys={len(json.loads(Path("spec/conformance/redaction.case.json").read_text()))}')
PY
```

Result:

```text
PASS duplicate-key + Draft202012 meta-schema: schemas=14 fixture=1 fixtureKeys=12
```

### 9.2 Ajv strict compile, corpus, and wire oracle

Exact invocation:

```bash
corepack pnpm exec node --input-type=module <<'JS'
import fs from 'node:fs'; import Ajv2020 from 'ajv/dist/2020.js';
const names=['capture-policy.schema.json','capture-sink.schema.json','capture-source.schema.json','checkpoint-v1alpha2.schema.json','event-v1alpha2.schema.json','payload-disposition.schema.json','protected-aad.schema.json','protected-blob.schema.json','protected-store-envelope.schema.json','protected-value.schema.json','redaction-conformance.schema.json','redaction-receipt.schema.json','redaction-rule.schema.json','sink-guard-decision.schema.json'];
const parse=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const ajv=new Ajv2020({strict:true,allErrors:true,validateFormats:false});
for(const name of names) ajv.addSchema(parse(`spec/${name}`),name);
for(const name of names) if(!ajv.getSchema(name)) throw new Error(`not compiled: ${name}`);
const corpus=parse('spec/conformance/redaction.case.json');
if(!ajv.getSchema('redaction-conformance.schema.json')(corpus)) throw new Error(ajv.errorsText(ajv.getSchema('redaction-conformance.schema.json').errors));
let valid=0,invalid=0;
for(const c of corpus.wireCases){const actual=Boolean(ajv.getSchema(c.schema)(c.document)); if(actual!==c.valid) throw new Error(`${c.id}: expected ${c.valid}, got ${actual}`); c.valid?valid++:invalid++;}
console.log(`PASS Ajv strict compile/corpus/wire: schemas=${names.length} wire=${corpus.wireCases.length} valid=${valid} invalid=${invalid}`);
JS
```

Result:

```text
PASS Ajv strict compile/corpus/wire: schemas=14 wire=20 valid=11 invalid=9
```

### 9.3 Independent corpus and live dependency oracle

Exact invocation:

```bash
uv run --project python python - <<'PY'
import json
from pathlib import Path
spec=Path('spec'); case=json.loads((spec/'conformance/redaction.case.json').read_text())
load=lambda n: json.loads((spec/n).read_text())
sinks=load('capture-sink.schema.json')['enum']; sources=load('capture-source.schema.json')['enum']
assert case['sinkInventory']==sinks and len(set(sinks))==34
assert case['sourceInventory']==sources and len(set(sources))==35
sections=['wireCases','pointerCases','guardCases','storeBypassCases','derivativeCases','sensitiveFieldCases','legacyCases']
ids=[item['id'] for section in sections for item in case[section]]
assert len(ids)==len(set(ids))==109
assert [x['sourceClass'] for x in case['sensitiveFieldCases']]==sources
assert all(x['expected']['rawWrites']==0 for x in case['guardCases'])
assert all(x['expected']['dependentReleases']==0 for x in case['guardCases'] if x['failurePoint']!='none')
assert all(x['expected']['denied'] and x['expected']['sinkWrites']==0 for x in case['storeBypassCases'])
assert all(not x['expected']['mayFeedScheduler'] for x in case['derivativeCases'] if x['expected']['disposition'] in {'redacted','metadata-only','forbidden'})
assert all(x['expected']['executorCalls']==0 and x['expected']['sourceRewritten']==False for x in case['legacyCases'])
registry=json.loads(Path('codex_logs/task-registry.json').read_text()); tasks={x['id']:x for x in registry['tasks']}; join=case['dependencyJoin']
assert tasks['D9-TS-REDACTION-087']['depends_on']==['D9-REDACTION-039']
assert tasks['D9-PY-REDACTION-088']['depends_on']==['D9-REDACTION-039']
assert tasks['D9-REDACTION-CONFORMANCE-089']['depends_on']==['D9-TS-REDACTION-087','D9-PY-REDACTION-088']
assert set(join['durableExtensionRequires']) <= set(tasks['D9-DURABLE-EXT-SPEC-031']['depends_on'])
print('PASS independent corpus invariants: sinks=34 sources=35 ids=109 pointer=16 guard=15 bypass=6 derivative=10 legacy=7 dependencyJoin=exact')
print(f"COVERAGE observation: guardSinkClasses={len(set(x['sink'] for x in case['guardCases']))}/34 wireSchemas={len(set(x['schema'] for x in case['wireCases']))}/14")
PY
```

Result:

```text
PASS independent corpus invariants: sinks=34 sources=35 ids=109 pointer=16 guard=15 bypass=6 derivative=10 legacy=7 dependencyJoin=exact
COVERAGE observation: guardSinkClasses=7/34 wireSchemas=8/14
```

### 9.4 Independent RFC 6901 oracle

The independent oracle performed strict `~0`/`~1` decoding and re-encoding,
object versus array resolution, immutable-snapshot resolution, strict array
indices, duplicate/overlap/order checks, deepest/reverse application, and
remove/replacement behavior. It also built a surrogate-pair normalization
collision and addressed prototype-named own keys in safe host code to prove the
missing protocol prohibition.

Exact top-level invocation:

```bash
uv run --project python python - <<'PY'
# Standalone reference transform; it imports only copy/json/re/pathlib, reads
# `.pointerCases`, resolves every case independently, and asserts declared
# validity/output/canonicalPaths. It then tests __proto__/constructor/prototype
# own keys and a surrogate-pair normalization collision.
# The full algorithm is described above and no repository implementation is
# imported or used as an oracle.
PY
```

Result:

```text
PASS independent RFC6901 oracle: fixture=16/16
OBSERVE prototype-name paths: safe-reference=addressable; master-plan=no-traversal; committed-fixture=absent
PASS hostile normalization-collision construction: distinctInputs=2 normalizedKeys=1 reject=required
```

### 9.5 Hostile semantic mutation suite

Exact executable shape:

```bash
corepack pnpm exec node --input-type=module <<'JS'
// Ajv2020 strict/allErrors/no-formats; add the exact 14 schemas by filename.
// Clone the valid corpus documents and apply, one at a time, the 19 mutations
// enumerated in P1-05. Validate each mutated document against its referenced
// schema (or the complete mutated corpus against redaction-conformance).
// Count structural acceptance; throw only if setup/compilation fails.
JS
```

The exact mutation values were:

- metadata-only policy plus a `log` rule;
- `log:redacted` paths `[/z,/a]`;
- two `log` rules;
- one log rule with 1,024 unique approximately 1,006-character paths;
- receipt count 2 for one path;
- receipt paths `[/z,/a]`;
- tag final base64url character changed from `A` to `B`;
- ciphertext `A`;
- AAD field path `/` plus 600 `é` characters;
- store `runId=run-2` with AAD `run-1`;
- ref `valueMac=f*64` with AAD `valueMac=b*64`;
- store `capturePolicyHash=f*64` with AAD `a*64`;
- event `outputMac=f*64` with ref `valueMac=c*64`;
- metadata event with only `parentSpanId=1*16`;
- checkpoint `graphInputMac=f*64` with ref `valueMac=b*64`;
- checkpoint containing 1,025 succeeded nodes, two refs each, plus graph input;
- failed guard decision with no executor/retry fields;
- corpus with one `sensitiveFieldCases` entry removed; and
- corpus pointer case ID replaced with the first wire case ID.

Result:

```text
ACCEPTED policy rule incompatible with metadata-only mode
ACCEPTED policy paths noncanonical order
ACCEPTED policy duplicate sink rules
ACCEPTED policy canonical UTF-8 bytes exceed 65,536
ACCEPTED receipt count differs from paths length
ACCEPTED receipt paths noncanonical order
ACCEPTED tag nonzero unused base64url pad bits
ACCEPTED ciphertext length mod4=1
ACCEPTED AAD fieldPath >1024 UTF-8 bytes
ACCEPTED store runId differs from AAD runId
ACCEPTED store ref valueMac differs from AAD valueMac
ACCEPTED store policy differs from AAD policy
ACCEPTED event outputMac differs from ref valueMac
ACCEPTED event parent span without trace/span
ACCEPTED checkpoint graphInputMac differs from ref
ACCEPTED checkpoint contains 2051 refs over 1024 portable limit
ACCEPTED failed guard omits executor/retry disposition
ACCEPTED corpus omits one source classification case
ACCEPTED corpus repeats a global case ID across sections
SUMMARY semantic-invalid accepted=19/19
```

Again, structural acceptance is expected; absence of durable semantic hostile
cases/oracles is the finding.

### 9.6 Hash and state commands

```bash
git rev-parse HEAD
git branch --show-current
git rev-parse --verify origin/feat/authoring-foundation
wc -l codex_plans/Graph-Engineering-21-Day-Master-Plan.md codex_logs/reviews/MASTER-PLAN-EXHAUSTIVE-GAP-AUDIT-2026-07-26.md
head -n 368 codex_plans/Graph-Engineering-21-Day-Master-Plan.md | sha256sum
sha256sum codex_plans/Graph-Engineering-21-Day-Master-Plan.md codex_logs/reviews/MASTER-PLAN-EXHAUSTIVE-GAP-AUDIT-2026-07-26.md
sha256sum spec/redaction-semantics.md spec/capture-source.schema.json spec/capture-sink.schema.json spec/redaction-rule.schema.json spec/redaction-receipt.schema.json spec/capture-policy.schema.json spec/protected-value.schema.json spec/protected-blob.schema.json spec/protected-aad.schema.json spec/payload-disposition.schema.json spec/sink-guard-decision.schema.json spec/protected-store-envelope.schema.json spec/event-v1alpha2.schema.json spec/checkpoint-v1alpha2.schema.json spec/redaction-conformance.schema.json spec/conformance/redaction.case.json
```

## 10. Reviewed D9 artifact manifest

The producer artifact hashes remained stable throughout the independent tests:

| Artifact | SHA-256 |
| --- | --- |
| `spec/redaction-semantics.md` | `2a5cc0528c1bd3999d5bb67e229a4b4f9c6dd59972ebef6f4ed1f282176fddf7` |
| `spec/capture-source.schema.json` | `33c224a8e2e5ae01c2982f56336bcacb3767fb8c65fbe0effd9c4f2bea263504` |
| `spec/capture-sink.schema.json` | `40c269c072711f4de8497cb0b25ba43a84579c2c3b059bf2d5beb306622e77b3` |
| `spec/redaction-rule.schema.json` | `18e5646dece9b359b907bb540e85febf3bf71783a93ee291df1a1b4a43cef821` |
| `spec/redaction-receipt.schema.json` | `e4e0ee2bf6426dc7d195337e1471e1eae39d240658377626d940de8419ea6d33` |
| `spec/capture-policy.schema.json` | `efe0f5d9b5ca00fcfe52258fe1eab247d9bbb6d0a9860954ee020fc6586c2e7f` |
| `spec/protected-value.schema.json` | `1bb2adbab65beab0c1ba64db590963ca942fe68a0f23be9fdf09c614e2537453` |
| `spec/protected-blob.schema.json` | `5dc764b76e12a77921dfce737b789ec2c27289514f67adff4bee1b2cea11fa78` |
| `spec/protected-aad.schema.json` | `651f8c3e7e2f1d99bacbec60cf4baedf777d0197af452f1bf49ee1f51d6ddf3a` |
| `spec/payload-disposition.schema.json` | `0986f97368e5745e0ed57428051fcedf1e0aa8469a21a351ca90fe6fd19195ab` |
| `spec/sink-guard-decision.schema.json` | `f4da05e432c67e38a1bed614d2873821d8f2a71a00dbeaafd826c33b448b106f` |
| `spec/protected-store-envelope.schema.json` | `16062f1125695223f7d58e51988b96e56402d76ccad1749bfffa017e44962787` |
| `spec/event-v1alpha2.schema.json` | `16fcf1107c25c1fda3d4f206614a51a8130b03b8795d264094484a40a658ede1` |
| `spec/checkpoint-v1alpha2.schema.json` | `f2bdc1a343e1cba29cc7f484b1854a677845b16510fbdee996d348dd67264971` |
| `spec/redaction-conformance.schema.json` | `b7cb28376e19f208632f697da5245a6423a7ce46b0f0589474c0a1f1f620b082` |
| `spec/conformance/redaction.case.json` | `baca1cba640cd85aa63866367341a8012956708fe016304de8a6af7f3d82427d` |
| Prior D9 audit | `586ca1ef7710ad3b38acb8e53dbe203f1e9e0e439a0e1fce4692264bdb09c18b` |
| Producer closure handoff | `3f6c16aaef631d31edb6aefd3e71ac27a303564ab2a02371027983ad5544f29b` |
| D9 implementation brief | `da09c62fa7a48e7bdef0e9ffb8fc0747ab3a79f6f92ed74239acf05615d63642` |
| Security/isolation architecture | `2778b71b9781381bf82bc613bdcd5c9b633e0bd6999a4d02003ee11c2dfb50d2` |

Any change to these contract bytes invalidates the validation results and
requires a fresh independent review of the affected findings.

## 11. Minimum remediation and re-review sequence

The shortest safe path is:

1. Keep `039` in progress and keep 087/088/089 Open.
2. Update only the canonical contract/carrier files necessary for P1-01 through
   P1-06 and their shared cases.
3. Narrow the implementation brief's `039` Definition of Done and repair the
   stale security task mapping for P1-07.
4. Re-run duplicate-key/meta-schema, Ajv strict compile, the 16 pointer oracle,
   all semantic mutations, source×sink completeness, registry dependency joins,
   docs/diff hygiene, and an independent hostile review.
5. Accept `039` only if the remediated immutable contract has zero open P0/P1.
6. Integration then joins the frozen corpus into the shared validator, commits
   the reviewed D9 set with exact hashes, and dispatches independent 087/088.
7. `089` remains owned by integration/QA/security and performs native parity,
   fixed crypto vectors, races, bypasses, migration, package scans, full
   canaries, and its own independent disposition.
8. Leave Day 16, I06, T26, privacy, support, provenance, RC, release, and growth
   Open until their own candidate-bound evidence exists.

## 12. Final independent disposition

**BLOCKED / CHANGES REQUIRED.**

The D9 draft is a strong basis, and its structural schemas, core pointer cases,
truthful protected-versus-redacted distinction, failure atomicity prose, legacy
quarantine rules, and live registry dependency edges are valuable. It is not
yet an accepted contract carrier under the current 3,164-line canonical plan.

Open P1s remain in occurrence/AAD/authority identity, receipt and live-rule
registry identity, source/sink completeness and policy joins, prototype and
portable resource bounds, semantic hostile corpus coverage, optional
side-effect recovery semantics, and the specification/native completion
topology. Because acceptance explicitly requires no open P0/P1, this reviewer
does not authorize `ACCEPT-FOR-CONTRACT-COMMIT`, task completion, native
dispatch, release evidence, or any stable/RC/security/privacy claim from the
reviewed bytes.

All downstream work—087, 088, 089, approval, extended durability, Day 16
privacy/security, support, provenance, release, and organic adoption—remains
explicitly Open.
