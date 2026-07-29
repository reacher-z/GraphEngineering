# SQLite Cursor B3 contract-freeze development log — 2026-07-29

## Scope

This log records the append-only `SQLITE-CURSOR-B3-PUBLICATION-REBIND`
contract milestone. It does not claim runtime B3, rules 11/12, migration
`0002`, active schema v2, permanent baseline publication, production
throughput, release, adoption or star completion.

The work intentionally avoided the pre-existing unrelated modified and
untracked D4, D9, budget, redaction, subgraph and progress-scanner paths.

## Parallel read-only audits

Three independent agents read the full 12,007-line master plan and audited
TypeScript, Python and hostile boundaries before implementation.

The TypeScript audit established that B0a/B0b/B1/B2 stop exactly at
`pre-rebind-complete`, rules 11/12 and `0002` runtime execution are absent, the
active package remains schema v1 and the final v2 descriptor was not yet
frozen.

The Python audit established the same v1 boundary, including a runtime asset
loader that accepts only v1/`0001`, a ledger without request bytes or global
commit sequence, a directly constructible B2 outcome that cannot serve as B3
authority, a consumed one-shot ordered baseline reader and no executable native
96-case replay registry.

The hostile audit rejected direct rebind development because B3/`0002`
ownership was ambiguous, B2 did not hand over a post-DDL capability, scheduled
10K/100K and crash evidence was absent, publication-rule ownership was
unresolved and permanent update failure precedence was not frozen.

## Cross-runtime descriptor derivation

TypeScript and Python independently reproduced the current v1 descriptor:

`4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe`

With the SQLite profile unchanged except for schema/reader/writer version 2,
both derived:

- v2 descriptor:
  `f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92`;
- canonical body SHA-256:
  `7bb784e57922facd28034dfdd504b37bd60c89e6c09fcd0d3f9adabb8456e214`;
- complete canonical descriptor SHA-256:
  `27cfd73833b3a8ff29f0b33d2a73a51d1409b40a07e62c96ec4d9910a705a7d9`.

The body is 1,451 bytes, the descriptor domain is 59 bytes, the
domain-separated input is 1,510 bytes and the complete descriptor is 1,535
bytes. The target schema identity is
`9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634`.

## Initial contract implementation

The main lane added a closed fixture, JSON Schema, validator, hostile tests,
semantic document, Python derivation report, TypeScript/Python parity test,
fixture-validator integration, SQLite contract integration, documentation link
and CI parity step.

The contract freezes:

- all implementation/release/active-manifest claims false;
- B3 as a subprotocol of a nineteen-stage one-commit migration;
- exact source, target and preview migration identities;
- one fixed cursor UPDATE and four supporting fixed queries;
- rules 11 and 12;
- two mutable and sixteen immutable physical fields;
- one-way private state transitions;
- 38 hostile obligations;
- 20 crash/fault boundaries;
- 20 cancellation labels;
- 16 statement lifecycle boundaries;
- seven cleanup faults; and
- 13 cross-runtime/artifact/reopen gates.

## First hostile review findings

The first independent review found HIGH 3 / MEDIUM 4 / LOW 1 even though the
initial 15 tests passed.

1. The fixture digest was self-reported. A malicious input could mutate and
   re-sign commitments, SQL, rules, hostile obligations or parity gates.
2. A direct main scan ordered by token then tenant used an unbounded TEMP
   sorter because the main primary key is tenant then token.
3. A pre-DDL publication session could not truthfully commit to a post-DDL
   fence that did not exist, and its single-write ledger conflicted with outer
   migration writes.
4. The strict parser used ordinary object assignment and allowed `__proto__`
   to escape own-property validation/digesting.
5. Cancellation and cleanup semantics were a flat list rather than
   boundary-local behavior.
6. Rule 12 incorrectly claimed a cursor-row diagnostic even for aggregate
   count/root mismatches.
7. Migration-lock expiry/provider-clock freshness was absent.
8. Descriptor identity lacked a runtime parity derivation gate.

## Remediation

The validator now carries trusted fixture digest
`b19d754dd68f78f8197532cee23488941e7ab8e054886de15b3c6f2349783c67`
and exact independent constants for the normative arrays and SQL. Hostile tests
mutate and re-sign commitments, affected-count SQL, rule semantics, hostile
obligations and parity gates; all are rejected.

Strict JSON objects now use null prototypes. Duplicate keys, trailing content,
own `__proto__` and own `constructor` attacks are tested and rejected by the
closed schema.

Authority is split into:

1. a pre-DDL outer publication authority with the outer migration ledger;
2. an observed post-DDL catalog fence; and
3. a derived cursor publication session whose ledger opens immediately before
   rebind and closes after rule 12.

The active lock binds both authority phases and includes expiry plus
provider-clock evidence. Freshness is reproved at the frozen boundaries.

Rule 12 now uses the owner-fenced `(token_hash, tenant_id)` TEMP primary key as
an ordered key driver and performs a fresh 18-column main point lookup through
the `(tenant_id, token_hash)` main primary key for every key. A separate count
closes extra-row attacks. Real `EXPLAIN QUERY PLAN` validation rejects
`AUTOMATIC`, `MATERIALIZE`, `USE TEMP B-TREE` and `CO-ROUTINE` and requires the
two primary-key plans.

Rules 11 and 12 each emit one aggregate diagnostic unit. Failure precedence is
boundary-local and explicitly distinguishes pre-first-write, pre-rebind,
post-statement and commit-returned behavior.

The cross-runtime parity test now derives both v1 and v2 descriptor bytes with
the native TypeScript and Python codecs and compares every frozen digest.

The second review found that trusted outer writes still invalidated B2's v1
catalog/change fence, that lock expiry had declarations without exact
capability/clock objects, that aggregate `count(*)` lacked a cancellable
long-scan boundary and that successful TEMP cleanup was not ordered before
commit. The final candidate adds an intrinsic outer-write receipt adoption
bridge, exact lock/clock objects and expiry comparison, a cancellable main-key
count scan, 20 request/observation cancellation points, at-most-two cursor
ownership, TEMP retirement after all audits and a final lock/transaction fence
before commit. TypeScript promises logical statement ownership retirement, not
a nonexistent native finalize call.

## Scale evidence fact-check

The existing fast characterization legitimately covers only 128 and 1,024
rows. A measured two-runtime 1,024-row run took about three minutes and peaked
near 112 MiB RSS. Independent observed component times were approximately 24
seconds TypeScript and 148 seconds Python.

The existing Python production script constructs a population-sized list and
uses an in-memory database, so its allow-list cannot simply be widened. The new
append-only plan requires a disk-backed constant-space worker, live process
barriers, `/proc/<pid>/fd` inspection for unlinked FILE-backed SQLite TEMP,
RSS sampling, DB/WAL/SHM sizes, raw phase timings, exact quantiles and scheduled
matrix artifact fan-in. No 10K/100K result is claimed in this milestone.

## Executed evidence before final independent review

- focused B3 contract tests: 16/16;
- combined SQLite ledger contract tests: 43/43;
- canonical B3 validator: stages 22, rules 2, hostile 38, faults 20;
- fixture validation: 79 JSON fixtures and 38 case manifests;
- TypeScript/Python descriptor parity: 1/1;
- workspace lint: eight packages green;
- workspace typecheck: eight packages green;
- Python report Ruff lint and format: green;
- documentation links: 288 green;
- master plan append: 422 additions, zero deletions;
- scoped whitespace diff: green.

Final severity disposition is appended only after the remediation audit
returns. Until then this log is evidence of an implementation candidate, not
an accepted release or runtime milestone.

## Final-review blockers and third remediation

The first claimed final candidate did not pass independent review. One auditor
reported MEDIUM 1 / LOW 1: a single provider-clock evidence snapshot could be
reused at later fences even after real time crossed lock expiry, and the
main-key count cursor lacked exact phase-local cancellation/cleanup precedence.
A second auditor reported HIGH 1: lineage and metadata writes after
`cursor/clock-complete` advanced the live stage epoch without a second adoption
path, making exact TEMP retirement impossible in both current runtime ownership
models.

The candidate was not committed. It was expanded to:

- four distinct opaque, single-use clock receipts obtained from a bound
  capability at four live boundaries;
- live lock reread, fresh provider-clock read, monotonic time and strict expiry
  at every boundary;
- exact post-cursor lineage/metadata and zero-write audit receipts;
- a second package-private pre-retirement adoption that does not mint another
  initial stage-adoption receipt;
- exact full-identity TEMP retirement, unrelated-TEMP preservation and a
  zero-residue retirement receipt;
- a one-shot final commit-fence receipt;
- phase-separated main-key-count and seal-stream cleanup; and
- exact count-row/cursor-close/cancellation precedence.

The resulting candidate has 23 ordered stages, 63 hostile obligations, 20
fault boundaries, 20 cancellation labels, 16 statement lifecycle boundaries,
seven cleanup faults and trusted canonical SHA-256
`047dae82864b72fda1e2877be4e2a149ca3c7adefbd3394bfbfffbe7b66436ef`.
Focused tests now pass 18/18 and the independent TypeScript/Python descriptor
parity gate remains green. Three fresh read-only severity-zero audits are in
progress. This remains a contract candidate, not runtime implementation or
release evidence, until those audits and the final workspace gates pass.

## Root-page reuse and transitive-authority remediation

A subsequent strict audit reproduced SQLite TEMP root-page reuse for identical
drop/recreate DDL and rejected `rootpage` as sufficient identity. It also found
single-use receipt consumption ambiguities across pre-verification, audit
adoption and final fence. No commit was made while those findings were open.

The candidate now treats root page as diagnostic only; binds an unforgeable
runtime object generation and guarded TEMP-catalog mutation epoch; accounts for
each owned drop through an authorized epoch-receipt chain; assigns one explicit
consumer to each of four clock receipts; freezes cursor-clock, outer-write,
pre-retirement, retirement and final-commit opaque authority contracts; and
uses consumed-receipt tombstones so the final fence never re-consumes audit
receipts.

The stable candidate contains 23 stages, 80 hostile obligations and trusted
canonical SHA-256
`9ed27de3dadb8989b51da9864b2109f0b760043bea52b3c73234013150e74ef3`.
Focused contract coverage is 19 tests, including explicit malicious re-signing
of the transitive receipt chain. Final severity disposition is still pending a
fresh review of this exact digest.

## Final severity disposition and accepted contract evidence

Three independent read-only audits reviewed the same stable digest
`9ed27de3dadb8989b51da9864b2109f0b760043bea52b3c73234013150e74ef3`.
Each returned HIGH 0 / MEDIUM 0 / LOW 0. Their independent checks included
real EQP execution, SQLite same-DDL/root-page reuse, TypeScript disposal paths,
Python replacement cleanup, clock receipt consumption, post-cursor epoch
adoption, transitive receipt/tombstone commitments, authorized TEMP-drop epoch
chains and malicious fixture re-signing.

Final local gates:

- focused B3 contract: 19/19;
- combined SQLite ledger contract: 46/46;
- TypeScript/Python descriptor parity: 1/1;
- fixture validation: 79 JSON fixtures and 38 case manifests;
- workspace lint: eight packages green;
- workspace typecheck: eight packages green;
- documentation links: 288 green;
- Python report Ruff lint and format: green;
- scoped whitespace diff: green.

This evidence authorizes a contract-freeze milestone commit only. It does not
claim that B3 runtime behavior, v2 activation, scheduled scale evidence,
release readiness, community adoption or repository star objectives are
complete.
