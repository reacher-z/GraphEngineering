# SQLite Cursor B3 initial-adoption contract correction — 2026-07-29

## Trigger

After provider-clock milestone `97a50e8e39559124d3751dadc3a174550728738e`
was pushed, three parallel read-only lanes began the next leaf: exact B2
transfer adoption, outer publication authority, migration `0002`, three
baseline publications and atomic stage adoption. No production implementation
was started because shared-contract review found multiple unresolved literals.

## Confirmed frozen boundary

The current fixture orders B2 complete, outer authority, `0002`, post-DDL
fence, entries, header, sequence zero, initial adoption and then publication
session. It names all four initial receipts, requires validation-before-
consumption, exact-once all-or-nothing consumption, four tombstones and one
stage-adoption receipt. Current digest remains
`b92d8d9c05d16f3a230e479ee161acd26e265654e0a44ff14dfe5652328ef7f0`
until the correction is implemented.

## Blocking ambiguities

The fixture does not yet define each initial receipt's fixed asset/SQL,
parameters, result identity, predecessor, affected rows, `total_changes` and
outer-ledger transitions. It does not independently define the post-DDL fence
or stage-adoption receipt. `outerPublicationAuthority.singleUse` conflicts
with its required repeated identity references. Failure precedence jumps from
before-first-write to before-rebind and cannot determine retry versus poison
for this leaf. `retiresV1CatalogAndChangeFence` also fails to distinguish the
old B2 fence from the post-DDL fence that must remain live.

Both runtimes confirm these are implementation blockers. Existing B2 stage
fences intentionally reject any epoch, permanent-write watermark or v1 main
catalog drift. The new bridge therefore needs a precisely authorized atomic
adoption hook; allowing ordinary mutable setters would break B2 ownership.

## Decision

Contract correction precedes runtime code. The append-only master plan section
31.37.19 freezes the intended correction scope, per-receipt commitments,
authority lifecycle, fence/adoption receipts, retry/poison split, failure
precedence, hostile matrix and normalized parity counters. The contract claim
must remain false throughout this work.

## Final contract result

The correction is complete at the executable-contract layer. The prior digest
`b92d8d9c05d16f3a230e479ee161acd26e265654e0a44ff14dfe5652328ef7f0`
is superseded by
`c2ffa4100e73f823de0cfba8ae4b379ef00736b104d41988753b588b5d082eb8`.
The normative fixture, schema, strict validator, malicious re-sign tests and
protocol narrative now agree on 23 ordered stages, two rules, 34 exact opaque
objects, 12 boundary-precedence objects, 141 hostile obligations, 20 fault
boundaries, 25 cancellation labels, 19 statement/ownership boundaries, eight
cleanup faults and 28 ordered normalized parity fields.

The correction resolves every initial-adoption blocker:

- the outer clock receipt is consumed exactly once during atomic authority
  mint while the authority remains a non-transferable identity commitment
  reusable only within its exact graph;
- each of the four initial writes has exact bytes/SQL, parameters, result,
  predecessor, prepare/execute/affected-row, `total_changes` and three-
  dimensional outer-ledger commitments;
- TypeScript and Python share a domain-separated canonical parameter/result
  digest codec rather than inheriting adapter serialization;
- the post-DDL catalog fence is an independent narrowly scoped physical-
  catalog proof and remains live after adoption;
- the package-private reader lease owns the exact ordered TEMP-stage read and
  must close before adoption;
- adoption validates the complete bundle before one non-interruptible consume,
  tombstone, watermark-update, old-B2-fence-retirement and receipt-mint tail;
- presentation-only bundle errors are retryable without consumption, while
  authority, lineage, lock, catalog, count or ledger corruption poisons and
  forces rollback; and
- exact failure/cancellation/statement/cleanup precedence and real-hook parity
  measurements are executable rather than narrative-only.

The strict validator accepts the frozen fixture with canonical digest
`c2ffa4100e73f823de0cfba8ae4b379ef00736b104d41988753b588b5d082eb8`,
status `contract-frozen`, 23 stages, two rules, 141 hostile obligations and 20
fault boundaries. Implementation, release, active-manifest, protocol-
completion and production-throughput claims remain false. No runtime
implementation, cursor rebind, commit, manifest activation or accepted v2
database is claimed by this contract result.

## Runtime handoff

The next production leaf is package-private TypeScript and Python
implementation of atomic authority mint, exact migration/three-publication
write accounting, canonical digest codec, post-DDL catalog fence, reader lease
and atomic stage-adoption receipt. It stops before cursor rebind. Both runtimes
must execute the hostile registry, expose the 28-field normalized real-hook
record, prove the counter self-probe at `1/1/1` and prove cursor-rebind prepare,
cursor-rebind execute and commit at `0/0/0` for every leaf case. Focused and
full regressions, cross-runtime parity, packaged asset-byte gates, lint,
typecheck, Ruff, mypy and independent severity-zero review are mandatory
before a runtime milestone is eligible to commit and push.

## Append-only final-audit correction

The earlier `c2ffa410...` / 141-obligation acceptance above is retained as an
audit trail but is no longer the accepted contract. Independent review found
six literals that could still permit two conforming runtimes to disagree: the
execution framing of multi-execution parameter digests, terminal reader-close
proof lineage, per-hostile-case executable expectations, the complete parity
record type/vector contract, exact post-DDL physical-catalog encoding, and the
distinction between same-bundle cancellation retry and corrected-bundle
presentation retry. Runtime implementation remained paused while these were
closed.

The superseding fixture digest is
`54b24cd31bcf221d0eff57dc0fa5e11e423f3b59bd0d7f6c29939e4027174fc7`.
The fixture now contains 145 unique ordered hostile obligations and exactly
145 structured execution records. Each record freezes its ordinal, ID,
category, real injection hook, mutation, stable error code, counter profile
and semantic outcome. The registry digest is
`a241a3cb35bc88a29bf4662acc585ea3a7bcba5a61f5ea5d752dd267ad4c3936`;
the digest of all fully expanded expectations is
`c268ad7bc583cf0cdfe9a2dfaee42bfd8af98491f3de1fa84362bdbcd5444d67`.
Both TypeScript and Python must execute all 145 records, with no skip or
expected-output copying, and populate the normalized record from real hooks.

The corrected cross-runtime parameter payload is an execution-order array of
parameter-order arrays. It therefore preserves the distinction between no
executions, one zero-parameter execution, one parameterized execution and
multiple executions. Five domain-separated golden vectors lock one empty
execution, a mixed Unicode/integer/BLOB/null execution, two executions, and
zero/three affected-row aggregates. The result payload remains exactly one
logical-receipt aggregate and excludes adapter-call count and
`lastInsertRowid`.

The reader lease now has a five-state lifecycle and an opaque terminal proof.
The baseline-entry receipt commits the exact retired/closed proof, the ordered
adoption bundle presents it, and the stage-adoption receipt copies its
identity. Missing, active, substituted, replayed or failed-close proof is
rejected before receipt consumption. A presentation defect retries only after
the caller supplies a corrected complete bundle; cancellation before the
atomic tail may retry the same untouched valid bundle. Nothing may interrupt
or be injected once the atomic consume/tombstone/adopt tail begins.

The post-DDL fence now uses the exact query
`SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema WHERE name GLOB 'ge_cycle_*' AND sql IS NOT NULL ORDER BY type COLLATE BINARY, name COLLATE BINARY`.
Its query digest is
`eb165659622f52a9be19858cc96d781c38aa6899e2b21e282bef4eb0d4e2b155`.
The absence of a table/index type filter is intentional: hostile owned-prefix
views and triggers must be visible. Fresh-v2 and migrated-v2 produce the same
34 explicit objects, 5,785 canonical row bytes and catalog digest
`ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`.
Allocator-dependent `rootpage` is excluded; exact type/name/table-name and SQL
hashes remain committed.

The normalized output is now a closed 28-field typed record with three full
expected vectors: successful initial publication, invalid adoption with a
retryable untouched bundle, and post-`0002` catalog poison. For the frozen
success probe with 12 baseline entries and one legacy operation, the exact
outer ledger is `4/34/16`, receipt mint/consume/tombstone counts are `4/4/4`,
stage-adoption mint is one, reader mint/close is `1/1`, and cursor rebind and
commit remain zero. The claims stay false: this milestone freezes only the
executable contract and does not claim runtime implementation, cursor
publication, commit, active-manifest support, production readiness or release.

## Append-only executable-oracle and case-insensitive catalog correction

The immediately preceding `54b24c...`, `a241...`, `c268...` and `eb165...`
anchors are also superseded. An independent audit demonstrated that the first
structured registry still flattened 102 poisoned scenarios into a generic
`after-statement-started` expectation, referenced four undefined counter
profile slugs, conflated corrected-bundle and same-valid-bundle retry, and used
a case-sensitive owned-namespace query that missed SQLite identifiers such as
`GE_CYCLE_EVIL`. No runtime work or commit occurred while these findings were
open.

The final contract has 145 unique obligations, 145 exact ordered execution
records and 25 fully specified counter profiles. Each record now freezes phase,
child failure boundary, parent precedence bucket, injection hook, mutation,
stable code, semantic expectation, retry-evidence mode and one exact 20-field
counter profile. Resolution produces a full 28-field record. Registry and
expanded-record domains, canonical preimages and algorithms are explicit. The
accepted hashes are:

- registry:
  `4e08dbd783213483692c0a2c36d4b8a3732f9b6b3e1a3f0e8bda24861b816e58`;
- 145 by 28 expanded expectations:
  `6bd821819215291851f2342b41beb565288e7c095de07fc066f47511cc232f95`;
- full domain-separated zero-self fixture:
  `2d5a6287525753dda71d220d91c56da00b27a9c6e9c58a882fa12028fcb32205`.

Clock counters now distinguish outer authority (`P1/C1`), rejected
pre-rebind evidence (`P2/C1`), accepted rebind evidence (`P2/C2`), rejected
pre-verification evidence (`P3/C2`), completed verification audits (`P3/C3`),
pre-commit fence (`P4/C4`) and forbidden fifth observation (`P5/C4`). Reader
profiles distinguish failure before ownership (`close=0`), failure after
ownership (`close=1`) and adoption with an intentionally still-active reader
(`close=0`). Migration and baseline profiles include exact partial and complete
prepare/execute/affected/ledger watermarks. Invalid presentation requires a
corrected bundle, valid pre-tail cancellation may reuse the same exact valid
bundle, and poison requires rollback plus a fresh authority graph.

The final catalog query is
`SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema WHERE lower(name) GLOB 'ge_cycle_*' AND sql IS NOT NULL ORDER BY type COLLATE BINARY, name COLLATE BINARY`
with digest
`bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c`.
Node SQLite 3.51.3 and Python SQLite 3.46.1 independently produced the same
34 rows, 5,785 bytes and `ca85...` digest for fresh-v2 and migrated-v2.
Uppercase and mixed-case views/triggers were all enumerated and changed the
fence; unrelated objects did not.

The portable digest codec now has seven positive golden vectors, including
signed 64-bit minimum and maximum, plus explicit lexical and range rejection.
The schema retains reusable shapes and adds a recursively exact frozen fixture
tree without object `const`, preserving the duplicate-safe null-prototype
parser. Exhaustive schema self-probes rejected 4,959 scalar mutations, 222
array-length mutations, 195 valid reorders and 416 object extensions. The case
and schema lane is therefore sealed; validator/test re-anchoring and the full
repository gate remain required before commit.

## Final validator and repository evidence

The validator was re-anchored to the three domain-separated digests and now
recomputes every trusted value rather than accepting fixture self-report. The
public canonical entry always performs exact schema validation first. A
test-only semantic entry exists only to prove that maliciously re-signed data
still fails the embedded trusted anchors independently of schema rejection; it
is not exported as a production bypass.

Final local evidence on the stable bytes:

- direct canonical validator: passed;
- focused B3 tests: 33/33;
- complete SQLite ledger-contract suite: 60/60;
- fixture validation: 79 JSON fixtures and 38 case manifests;
- documentation links: 288/288;
- TypeScript/Python descriptor parity: 1/1;
- workspace lint: all eight packages;
- workspace typecheck: all eight packages;
- schema mutation campaign: 4,959 scalar mutations, 222 array-length
  mutations, 195 valid reorders and 416 object extensions all rejected;
- catalog evidence: Node/Python fresh/migrated valid parity plus real uppercase
  view and mixed-case trigger rejection; and
- scoped `git diff --check`: passed.

All five capability claims remain false. These gates accept the executable
contract only; they do not claim that either runtime executes the 145 cases,
that cursor rebind or commit exists, or that the active manifest supports v2.
Independent final severity and commit-scope audits remain the last pre-commit
gate.

## Final state-domain and public-validator closure

The preceding `2d5a6287...` fixture anchor, 33/33 focused count and statement
that a test-only semantic entry remained exported are superseded by this
append-only correction. The last adversarial audit identified three real
contract/implementation mismatches and they were fixed before staging:

- normalized `state` had retained a stale `cursor-published` reusable-schema
  value despite the authoritative five-state machine;
- `validateCursorPublicationFixtureSemanticsForTest` could be imported and
  called without exact schema validation; and
- JavaScript canonicalization used default UTF-16 key ordering while the
  contract requires Unicode code-point ordering and Unicode scalar strings.

The case now declares `fieldTypes.state=enum-state-machine-states`. The
reusable schema and semantic validator accept only `pre-rebind-complete`,
`publication-active`, `cursor/clock-complete`, `poisoned` and `disposed`.
The validator checks all 28 field types for both the three control records and
the 145 fully expanded hostile records: non-empty case ID, closed outcome,
slug-or-null failure boundary, closed state, exact four-counter arrays,
nonnegative safe-integer counters and Booleans.

The semantic-only export was removed. Every externally callable fixture
validation path is schema-first. A malicious extra root member whose value is
`undefined`—and is therefore omitted by JSON serialization—still fails
`GE_CURSOR_B3_SCHEMA`; maliciously re-signed scalar, array, object, authority,
SQL, registry and parity drift all fail through the same public entry point.

Canonical key comparison now iterates Unicode code points. A regression proves
that U+E000 sorts before U+1F600 (`😀`), which is the opposite of default
UTF-16 code-unit ordering. Canonicalization also rejects unpaired high or low
surrogates in both keys and string values, preventing a JavaScript/Python
portable-codec split. The final hashes are:

- fixture:
  `32ebd363838ac9aa5c0d3573aa31b1f45244ca469ec248f7c906ff08d3c08993`;
- ordered hostile registry:
  `4e08dbd783213483692c0a2c36d4b8a3732f9b6b3e1a3f0e8bda24861b816e58`;
- expanded 145 by 28 oracle:
  `6bd821819215291851f2342b41beb565288e7c095de07fc066f47511cc232f95`;
- exact catalog query:
  `bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c`;
  and
- valid 34-object catalog:
  `ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`.

Final stable-byte evidence after these corrections:

- direct canonical validator: passed, including real SQLite asset/catalog
  verification;
- focused B3 tests: 34/34;
- complete SQLite ledger-contract suite: 61/61;
- fixture validation: 79 JSON fixtures and 38 case manifests;
- documentation links: 288/288;
- TypeScript/Python descriptor parity: 1/1;
- workspace lint: all eight packages;
- workspace typecheck: all eight packages;
- exact schema campaign: 4,959 scalar mutations, 222 array-length mutations,
  195 valid reorders and 416 object extensions rejected; and
- scoped diff whitespace check: passed.

All implementation, protocol, production-throughput, active-manifest and
release claims remain false. This evidence accepts only the contract milestone
and does not claim that either runtime executes cursor publication, rebind,
retirement or commit.
