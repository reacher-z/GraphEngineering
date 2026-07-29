# SQLite Cursor Slice B2 final consolidated audit

Date: 2026-07-29
Branch: `feat/authoring-foundation`
Canonical fixture: `spec/conformance/sqlite-cursor-pre-rebind-v1.case.json`
Final disposition: **ACCEPTED — HIGH 0 / MEDIUM 0 / LOW 0**

## 1. Accepted scope

This audit accepts only the private pre-rebind Cursor Slice B2 tranche:

- bounded permissive inspection of the exact 18-column physical cursor row;
- deterministic staging into the exact 30-column STRICT/WITHOUT ROWID TEMP
  table;
- exact ordered execution of rules 1 through 10;
- bounded, safe and receipt-free diagnosed outcomes;
- A1 accumulator reuse for clean root reproduction;
- exact source, transaction, owner, catalog, SQL and EQP fences;
- one registered source, EQP, rule or seal cursor at a time;
- bounded synchronous event/checkpoint point lookup;
- cancellation and authoritative-error precedence; and
- one-way terminal publication as `pre-rebind-complete`, `diagnosed` or
  `poisoned`.

It does not accept B3 publication/rebind, rules 11/12, migration `0002`,
permanent v2 state, 10K/100K throughput, RSS/TEMP-file bounds, crash/replay,
release readiness, community adoption or star objectives.

## 2. Canonical contract

The self-excluding canonical contract SHA-256 is:

`6acb99d9593b37d6e29b6862531e3ade2dae051b21a628a26cc4e1d7e2fdb8bc`

This digest is computed from the canonical contract representation and must
not be described as the raw file-byte hash. The closed fixture freezes:

- ten ordered rules;
- five semantic vectors and independently reproduced A1 roots;
- 12 pristine, 27 hostile and 31 lifecycle obligations;
- 70 globally unique obligation names;
- six main SQL statements and nine row-rule markers, 15 SQL contracts total;
- exact normalized SQL and SHA-256 values;
- the 30-column TEMP insertion order;
- exact diagnostic/truncation bounds;
- the `pre-rebind-complete` and `diagnosed` output shapes;
- conservative protocol/release/throughput nonclaims; and
- four forbidden EQP fragments plus positive relation/lookup requirements.

The schema is closed, duplicate JSON keys are rejected, and fixture mutation
tests retain the contract rather than normalizing an implementation defect.

## 3. Final implementation shape

Both runtimes now use the same graph of authority and data movement:

1. validate A2b receipt provenance;
2. bind the exact B0b transfer/session, stage generation and owner epoch;
3. prove EXCLUSIVE transaction plus source/TEMP/main catalog identities;
4. capture and validate all 15 query plans under the registered campaign
   cursor;
5. walk one physical source row at a time;
6. inspect each field under rule-local interpretability;
7. stage representable rows with deterministic invalid namespaces;
8. accumulate bounded pre-stage evidence for nonstageable rows;
9. run the ten exact bounded rule queries in frozen order;
10. reproduce the clean A1 seal/root or publish receipt-free diagnostics; and
11. retire campaign authority, and additionally retire transfer authority for
    the terminal diagnosed path.

Deterministic code owns flattening, counting, ordering, boundedness and catalog
checks. No model call is used for database plumbing.

## 4. Review and remediation history

Acceptance was not granted to the first green runtime-local test state.
Earlier adversarial reviews found and closed incomplete source-catalog identity,
lookup marker shape/value gaps, cancellation/catalog precedence inversions,
loss of insert/close exception identity, late cursor registration, Python row
liveness ambiguity, wrong-arity attribution drift, TypeScript active-dispose
state overwrite and static registry evidence that did not prove execution.

A later differential audit rejected acceptance for mixed storage/semantic
divergence, a legal token colliding with a sentinel, incorrect pre-stage harness
attribution and ineffective nested timeouts. Those were remediated by field-
local interpretation, non-hex ordinal-qualified invalid-token keys, two direct
nonstageable harness cases, honest lifecycle reporting and a dedicated bounded
CI hierarchy.

The final audits then found and closed:

- real TEMP count replaced by constants;
- Python active B2 disposal dispatching through replaceable `cursor.close`;
- outer abort revalidating or dynamically popping registry metadata before
  preserving the primary;
- Python catalog collection lacking an explicit plus-one cutoff;
- terminal diagnosed authorities retained in registries;
- TypeScript B2 owner fences calling replaceable public SQL/epoch paths;
- a raw closed-database Node exception escaping structured provider errors;
- subprocess failures dropping one of stdout/stderr or file-level messages;
- local timeout margin too small for the 1,024-row campaign; and
- timeout cleanup that did not cover complete child process trees.

Every item received a regression or executable diagnostic and a separate
read-only re-audit. Final independent review found no unresolved HIGH, MEDIUM
or LOW item.

## 5. Rule and staging parity

Storage interpretation is field-local in both runtimes. Rule 8 owns malformed
storage/shape evidence while every other rule executes if its own prerequisites
remain interpretable. Real campaigns prove mixed pairs for rules 1+8, 2+8,
8+9 and 8+10. The direct harness additionally freezes mixed authorization plus
storage vector `[1,0,0,0,0,0,0,1,0,0]`.

Representable invalid keys use bounded source-ordinal-qualified namespaces.
Invalid token keys are outside the legal lowercase 64-hex namespace, preventing
a valid token from colliding with an internal stage key. Physically
nonstageable rows contribute bounded pre-stage rule evidence and the real
walked-versus-staged rule-7 mismatch; they are not logically added to TEMP.

The direct nonstageable vectors are:

- source-key storage failure: `[1,0,0,0,0,0,1,1,0,0]`;
- wrong 18-column arity with interpretable key positions:
  `[0,0,0,0,0,0,1,1,0,0]`.

## 6. Exact executable coverage

The final executable registry completed in 970233 ms.

Common inventory:

- executed: TypeScript 70/70 and Python 70/70;
- groups: pristine 12/12, hostile 27/27, lifecycle 31/31;
- case-ID digest:
  `bcf1f08d9bc53647466d8dcb7e7d5a6833447da01ad1cd08c2510ba82fd1d067`;
- missing/unexpected/duplicate/OPEN evidence: zero.

Group digests:

- pristine:
  `2dd908834ac6df709656bf45a9be3c3586379145116b220a0ec3b653bde36dee`;
- hostile:
  `f2d27053b760e7ad5fd9f116501fd8372e2f5a2c8957762bf68d3802f6d5e9c0`;
- lifecycle:
  `914005cc51f337e3e556047fb169adff49896d04c795ddf9990d09bc7c28407d`.

TypeScript execution identities:

- required/matched: 261/261;
- digest:
  `0c85e3176c5b25a0cf973a0d92da536924f5a79efc2275e4f354b77af23a38aa`.

Python execution identities:

- required/matched: 302/302;
- digest:
  `7e50c85e616e2371e38178be2bcddc4388050745491251ebb1408148cfb760f1`.

Strict parity completed with `parityDifferences: []` and
`remainingEvidence: []`.

## 7. Direct parity harness

The deterministic harness compares production inspectors and A1 accumulators,
not an independently invented substitute algorithm. Final direct evidence:

- five semantic cases;
- eleven isolated/aggregate hostile rule cases;
- two pre-stage cases;
- one mixed storage/semantic case;
- 19 total harness cases;
- 24 representable staged tuples;
- two nonstageable pre-stage tuples;
- five carrier row digests;
- zero parity differences.

The harness reports `lifecycleCasesExecuted: 0`; lifecycle acceptance comes
from the exact executable registry.

## 8. Production boundedness evidence

### 8.1 Population 128

Root:
`fc3699d41e2c4c9b0f45aa6c2afc1cfcbb7a89d1476420995427dd827bac9e32`

### 8.2 Population 1,024

Root:
`9ad8d233c1f4d4717c126a9cf3aeb89675a3ddb15682e68b230c6fbec3e9e9a2`

For both populations and runtimes:

- source/TEMP/seal count equals the population;
- 15 EQP statements are accepted;
- EQP provenance is `in-campaign-registered-cursor`;
- event and checkpoint point lookup execute exactly once each;
- maximum fetch, raw row, decoded row, carrier, registered cursor and nested
  point operation is one;
- final active cursor, decoded/raw row and nested operation is zero;
- TEMP object current/final/maximum/external count is one;
- TEMP measurement provenance is `in-campaign-temp-schema-scalar`;
- three in-campaign TEMP catalog measurements occur; and
- final/maximum TEMP rows equal the population.

TEMP page counts were observed and bounded but remain environment-dependent;
they are not identity or parity assertions. These probes establish bounded
application ownership and deterministic roots at 128/1,024 only. They do not
establish scheduled 10K/100K throughput, latency percentiles, RSS, TEMP-file
size or crash safety.

## 9. Cancellation, failure and terminal semantics

“Cancellation before begin” means before first operational `run:start`, after
mandatory provenance and authority construction. Both runtimes retain this
precedence: A2b provenance; transfer/session/exact stage; owner epoch and
EXCLUSIVE mode; catalog/statement/EQP/marker authority; cancellation; cleanup.

A close failure without an earlier primary becomes authoritative. Cleanup
cannot replace an existing primary. Python captures cursor-close and weak-
registry pop intrinsics for active abort/dispose paths. TypeScript captures SQL,
owner, total-change and epoch intrinsics for active B2. Closed connections map
to structured `GE_CYCLE_STORE_UNAVAILABLE` while abort retains responsibility
for poison and owned-cursor cleanup.

Diagnosed publication is terminal and receipt-free. It retires campaign and
transfer authority. Reuse fails at the registry provenance boundary and does
not rewrite `open + diagnosed` into poison. Clean publication retains the exact
input receipt for B3 but performs no B3 work in this tranche.

## 10. Timeout and failure-evidence hardening

The final hierarchy is bounded and nested:

- ordinary strict Vitest tests: 30 seconds;
- 1,024-row production case: 90 seconds;
- TypeScript exact child: 20 minutes;
- Python exact child: 35 minutes;
- coverage child: 60 minutes;
- production child: 12 minutes;
- Python parity-report child: five minutes;
- CI parity step: 90 minutes;
- dedicated CI parity job: 120 minutes.

Failure evidence preserves exit status, signal, system error, stdout, stderr,
failed test messages and file/suite/import/hook messages. Timed-out subprocesses
use separate POSIX process groups and negative-PID termination; Windows uses
`taskkill /pid ... /t /f`. Static registry checks remain fast and independent.

## 11. Full verification matrix

Final commands/results:

- TypeScript SQLite suite: 22 files, 836/836 tests;
- Python full suite: 2,234/2,234 tests;
- exact B2 executable coverage: 70/70 cases per runtime;
- workspace TypeScript build/typecheck/lint: passed;
- Ruff implementation/test/plugin lint and B2 formatting: passed;
- strict MyPy over 54 Python source files: passed;
- fixture validation: 75 JSON fixtures and 36 case manifests;
- documentation validation: 286 local links;
- SQLite ledger/contract: 27/27;
- npm package-content validation: eight packages;
- Python artifacts: 68 wheel entries and 69 sdist entries;
- isolated wheel and sdist install/entry-point/YAML smoke: passed;
- strict harness: 19 cases and zero difference;
- scoped diff/whitespace check: passed; and
- master-plan prefix: append-only relative to HEAD.

## 12. Final severity disposition

Open findings:

- HIGH: 0;
- MEDIUM: 0;
- LOW: 0.

The bounded Cursor Slice B2 implementation is accepted.

## 13. Preserved nonclaims

The following remain open and must not be inferred from this acceptance:

- B3 cursor publication and rebind;
- rules 11 and 12;
- migration `0002` and permanent v2 state;
- 10K/100K performance characterization;
- latency, RSS and TEMP-file claims;
- subprocess crash/replay proof;
- release candidate or stable release;
- public adoption; and
- 5K/6K GitHub stars.

Repository popularity is an external outcome and cannot be guaranteed by an
implementation checkpoint.
