# SQLite publication transaction owner runtime — Wave 1E/P9

Date: 2026-08-02 PDT
Branch: `feat/authoring-foundation`
Scope: package-private registration, guarded BEGIN, authenticated failure cleanup, and portable parity
Final review: fresh-context H0 / M0 / L0, ACCEPT
Commit/push: authorized after this evidence freeze; exact SHA is recorded by git history

## Outcome boundary

P9 implements the first runtime tranche of the P8 transaction-owner contract in
TypeScript and Python. It does not implement the success COMMIT path. COMMIT is
deliberately rejected before native transaction I/O until Rule 12, the remaining
clocks, publication receipts, TEMP retirement, pre-commit evidence, and the exact
final transaction fence exist.

The accepted implementation claims for this tranche are limited to:

- package-private exact owner registration;
- a distinct pre-I/O provisional generation and attempted lineage;
- one exact `BEGIN EXCLUSIVE` attempt;
- promotion and receipt minting only after exact returned postflight;
- 19-class terminal and permanent-mutation guard coverage;
- authenticated active-transaction failure selection;
- exact rollback, close, and source-v1 reopen cleanup on the implemented paths;
- cross-runtime portable evidence for the three common cases;
- runtime-local truth about real versus structurally absent guard surfaces.

The following remain false: runtime COMMIT, success selection, complete-v2
classification, driver-native BEGIN/rollback/close throw coverage, crash/process
recovery, public API, release gate, and complete atomic publication.

## Runtime files

TypeScript implementation and tests:

- `packages/sqlite/src/cursor-publication-transaction-owner.ts`
- `packages/sqlite/src/sqlite-publication-source-v1-audit.ts`
- `packages/sqlite/src/sqlite-connection.ts`
- `packages/sqlite/src/operation-baseline-stage.ts`
- `packages/sqlite/src/semantic-integrity.ts`
- `packages/sqlite/test/cursor-publication-transaction-owner.test.ts`
- `packages/sqlite/test/cursor-publication-transaction-owner-parity.test.ts`

Python implementation and tests:

- `python/src/graph_engineering/sqlite_cursor_publication_transaction_owner.py`
- `python/src/graph_engineering/sqlite_operation_baseline_source.py`
- `python/tests/test_sqlite_cursor_publication_transaction_owner.py`
- `python/tests/sqlite_cursor_publication_transaction_owner_report.py`

Integration:

- `package.json`: focused runtime gate.
- `.github/workflows/ci.yml`: cross-language job executes the focused gate.

The owner modules are intentionally absent from the TypeScript package root and
Python package root. Build output and public API tests prove that this tranche
does not widen the supported API.

## TypeScript authority graph

Registration creates null-prototype opaque owner, provisional generation, and
attempted lineage objects. Authority is kept in private weak registries. The
connection registry retains only a `WeakRef` to owner state, so abandoning the
owner cannot silently release a live guard; the next guarded route fails closed.

Registration verifies a recoverable file-backed connection, a closed main
catalog, source-v1 application/schema identity, no attached database, no
pre-existing TEMP catalog, full application semantic integrity, and a stable
source fingerprint. A lower-owned, path-free, one-shot reopen capability is
bound to the exact owner and exact connection. The transaction-owner module
cannot read or replace its path.

BEGIN performs one owner-only lower call with the exact attempted lineage and
provisional generation. Returned postflight must prove all of the following
before promotion or receipt minting:

1. the connection remains the exact registered connection;
2. the exact attempted lineage is selected;
3. the exact provisional generation is active;
4. the mode is `exclusive`;
5. the transaction epoch advanced exactly once;
6. total changes did not move;
7. the conservative TEMP mutation epoch did not move;
8. complete source-v1 semantics are re-proven inside the exact transaction;
9. the registration fingerprint is unchanged.

Any returned mismatch or injected after-return primary tombstones provisional
authority before cleanup. Rollback is authorized only for the exact observed
lineage/generation. Close consumes the live connection. Reopen consumes the
opaque capability exactly once and must classify source-v1 or corruption. The
owner, receipt, generation, lineage, connection, primary, and capability graph
is cleared on every terminal path.

## Python authority graph

Python uses weakref-capable wrapper, lineage, generation, receipt, and primary
objects rather than treating raw `sqlite3.Connection` or integer IDs as
authority. Registration installs the lower guard before retaining source
evidence and removes registry state on any registration failure.

The lower source validator checks the exact catalog, table/index identity,
application and user versions, schema/migration singleton bindings, row counts,
physical integrity, foreign keys, topology, TEMP closed set, and the provider's
complete semantic audit. BEGIN returned postflight re-runs that complete audit
under the exact owned exclusive transaction and compares the registration
logical dump before promotion and receipt minting. This closes both ordinary
registration-to-BEGIN writer drift and the narrower case where the initial
fingerprint itself observed already-corrupted state after an earlier audit.

Python exposes 16 native connection guard routes. The three prepared-statement
only routes present in Node SQLite are truthfully reported as structurally
absent, not simulated with fake helpers. The portable projection nevertheless
reports the same 19 contractual categories and `no-native-io-bypass` result.

## Guard inventory

The frozen 19 categories cover:

1. connection commit;
2. connection rollback;
3. SQL COMMIT/END;
4. SQL ROLLBACK;
5. SQL BEGIN;
6. SAVEPOINT/RELEASE/ROLLBACK TO;
7. multi-statement transaction control;
8. prepared transaction control;
9. scripted transaction control;
10. nested BEGIN;
11. close while guarded and live;
12. newly prepared permanent DML;
13. already prepared permanent DML;
14. newly prepared permanent DDL;
15. already prepared permanent DDL;
16. persistent PRAGMA;
17. VACUUM/ANALYZE/REINDEX;
18. ATTACH/DETACH/topology mutation;
19. every other permanent-state or proof-history mutation.

Each rejection is checked against transaction epoch, total changes, and TEMP
epoch so a thrown error without a zero-I/O proof is insufficient evidence.

## Portable parity

The TypeScript parity test launches the Python report and compares a strict
portable projection. Both reports bind:

- schema version and P8 contract ID;
- the canonical P8 fixture SHA-256;
- exactly three common cases: returned active BEGIN, authenticated active
  failure cleanup, and COMMIT hard-disabled;
- the complete 19-entry guard inventory;
- accepted runtime claims and explicit nonclaims;
- runtime-local capability evidence outside the portable equality projection.

The CI command provisions `uv`, so the committed gate requires 2/2 parity cases
with no environment skip. Python's three absent prepared-only capabilities are
retained in runtime-local evidence instead of being hidden by portable equality.

## Rejected-first security review

No rejected intermediate version was committed. Independent reviews repeatedly
kept the integration verdict at REJECT even when focused tests were green.

The repair sequence was:

1. Python structural/physical integrity could accept a corrupt application
   blob. Registration and reopen were changed to reuse the full provider
   semantic audit; a real `value_blob` corruption test was added.
2. Registration validation and BEGIN were separated by a writer race. Both
   runtimes now re-prove full semantics under the exact owned transaction and
   compare registration evidence before receipt promotion.
3. Node versions without a prototype `isOpen` descriptor broke module import.
   Cleanup now uses captured close semantics without relying on that descriptor.
4. Dynamic Database/Statement prototype calls allowed clean-database read
   redirection. Database and statement methods and setters are captured at
   module definition and called through captured `Reflect.apply`.
5. Dynamic `Array.push` and `Buffer.equals/from` paths allowed result
   substitution. Array and Buffer primitives are captured and hostile tests
   replace the live prototypes while exact audit still rejects corruption.
6. A mutable `Map.prototype.size` getter could forge stream/head cardinality.
   The audit now maintains an explicit trusted head counter.
7. Node builtin live bindings could be changed through
   `syncBuiltinESMExports`. Database, Buffer, hash, decoder, and Uint8Array test
   values/functions are copied at definition time. A UTF-16 authoritative blob
   remains rejected after a synced decoder replacement.
8. Captured RegExp replacement still consulted a mutable `exec`. Catalog SQL
   whitespace normalization is now a deterministic code-unit scan with no
   RegExp dispatch.
9. Shared codec parsers could be influenced internally after their outer
   method reference was captured. Record, checkpoint, ledger result, and summary
   blobs are rebound to locally produced canonical UTF-8 bytes.
10. Raw-byte equality did not independently prove the record chain root. The
    semantic audit now recomputes the domain-separated record hash from the
    persisted body with locally captured SHA-256 operations.
11. Shared ledger parsing did not independently prove every result constraint.
    A local closed validator now covers all nine mutation-result shapes,
    including exact keys, nested tails, identifiers, hashes, safe integers,
    timestamp syntax, lease and migration expiry ordering, fixed governance
    modes, and strictly ordered unique legal-hold IDs.
12. Relative file names were retained for independent audit and reopen, so a
    later working-directory change could select a different same-name file.
    Construction now binds one absolute path used by native open, registration,
    post-BEGIN audit, and the opaque reopen capability, while the public path
    getter preserves its compatible caller spelling.
13. JavaScript `Date.parse` normalizes impossible calendar dates. The local
    RFC3339 verifier now performs explicit Gregorian year/month/day and leap-year
    validation before epoch conversion; hostile runtime validators cannot make
    year zero, non-leap February 29, February 31, or April 31 valid.
14. Checkpoint and revision validation still delegated identifier/timestamp
    rules to the shared codec. The audit now applies an exact nine-key local
    checkpoint contract, validates every put summary, and validates tenant,
    scope, and checkpoint identifiers before both put and delete revision
    branches. A coherent invalid delete tombstone is rejected.
15. Reopen classification was not fully aligned with the frozen lifecycle.
    Both runtimes now distinguish source-v1, corruption, and I/O unavailability,
    retain the original primary as cause/aggregate diagnostic, clear the exact
    authority graph, and expose `finalized` as the terminal snapshot. Fingerprint
    drift is corruption rather than unavailability.

Decisive regressions include unchanged-catalog blob corruption, clean-database
redirection, hostile Buffer equality, forged Map size, synced decoder changes,
catalog-comment erasure, hostile record decoder, forged record hash, reversed
lease expiry, invalid legal-hold IDs, external writer drift, attached databases,
TEMP residue, abandoned owner GC, stale/clone capability replay, and every guard
category.

## Verification evidence

Final focused evidence before commit:

```text
corepack pnpm test:sqlite-transaction-owner-runtime
  portable parity: 2/2 passed
  TypeScript owner with forced GC: 27/27 passed, 0 skipped
  Python owner: 36/36 passed

TypeScript semantic and integrity suites
  12/12 passed

Python source plus owner
  83/83 passed

Ruff
  passed

mypy on both changed Python implementation modules
  passed

P8 contract
  20/20 passed; canonical validator and trusted anchors passed

Fixture gate
  89 JSON fixtures / 46 case manifests and the complete repository corpus passed

Documentation links
  478 local Markdown links passed

SQLite stage/rebind serial regression before the final focused deltas
  469/469 passed

Complete SQLite serial package suite before the final focused deltas
  44 files passed, 1 conditional file skipped
  1,252 tests passed, 2 conditional skips, 0 failures
  duration 795.29 seconds

SQLite build and public root test
  build passed; public API 1/1 passed; no transaction-owner symbols exported

git diff --check
  passed
```

An earlier parallel full-package execution had no assertion failure but hit one
resource-sensitive 45-second timeout; that test passed alone. The later
single-worker full suite above completed cleanly. The final path, lifecycle,
calendar, and revision deltas were then covered by the 27/27 focused owner gate,
12/12 semantic/integrity gate, parity, typecheck, build, and public-root checks;
the log does not claim a second full-suite run after those narrow deltas.

## Progress scanner

The existing 30-minute progress scanner remains installed. A manual status read
for this integration window reported 108 tasks: 46 healthy, 61 waiting on
declared dependencies, 1 stale, 0 blocked, and 0 integration risk. It queued
three evidence-based supervisor nudges. Scanner health is operational evidence,
not proof that the master plan or release is complete.

## Remaining nonclaims and next bounded action

P9 does not prove the historical target of ledger results when the retained
ledger format does not preserve canonical request bytes. It validates closed
canonical result semantics and all available database identity bindings; it
does not invent missing request evidence.

P9 also does not implement Rule 12, main-table seal acceptance, the third
pre-verification clock, cursor-clock completion, lineage/metadata/rules/fresh-v2
receipts, TEMP retirement, fourth pre-commit clock, final transaction fence,
native COMMIT, complete-v2 reopen, crash/process interoperability, public
orchestrator integration, manifest activation, or release acceptance.

The next bounded tranche is P10: Rule 12 plus third-clock authority, with COMMIT
remaining hard-disabled. GitHub popularity and 5K/6K stars remain product and
community targets; no runtime test or commit can guarantee them.

## Append-only plan proof

- pre-append line count: 21,715;
- pre-append and preserved-prefix SHA-256:
  `8d1b44f07a81c600e4e5af6cc654c59f8de92942eaf8fafb1ec609139fcccf76`;
- P9 main append line count: 22,011 and SHA-256:
  `c0eb0dfa225679c62e8cea96c99a91aa714f8c485d7d59f97eb80e6eaa587b7e`;
- final Python correction append line count: 22,030;
- final complete plan SHA-256:
  `a2a8b224993b79adfd2b20d3a78e8591dd7e53fc2cdb18756f406afee198cdf0`;
- the first 21,715 lines still hash exactly to the pre-append value.
- the first 22,011 lines still hash exactly to the P9 main-append value.

## Final file hashes before commit

```text
efbc0f923632fa0f1de1728b7d908d5bfb5924ba95feb883d98678682275b7d1  .github/workflows/ci.yml
e788b30abda5079b487ea134dfaa60b3ef6b7ec703609ad6fbc9441810c46bef  package.json
36d788336dc87c310378fd17e68f639ea5794a95097ae82989c836853ef926f6  packages/sqlite/src/operation-baseline-stage.ts
50405140fbda1aa139e07d8d4cc91bdf785f9b2a80ec65c0b872bfc45ab1c836  packages/sqlite/src/semantic-integrity.ts
52170e8990ae27d6f300b75589d364fa51d683374137239ef1721013147b812e  packages/sqlite/src/sqlite-connection.ts
f831d5b4fe28950bf6ed675fb3206822bf4c1f59196fc207e4308aac8634cdac  packages/sqlite/src/cursor-publication-transaction-owner.ts
c2554a257563899fd2f980d61560d3d823a294333a547214c8396c8aa9a453f7  packages/sqlite/src/sqlite-publication-source-v1-audit.ts
f9b4617b908efe9811b7c96112e5df41937d4a54d84234485ceb5c23ad99b1b2  packages/sqlite/test/cursor-publication-transaction-owner.test.ts
4da247eaadb3a23192008de9584d9c44636ed8220aab4cd2b947cb4350f3486c  packages/sqlite/test/cursor-publication-transaction-owner-parity.test.ts
1434b5fe477c7ad628c5eeaa7640580d177c041dee26730bfccb4adbc92b02fe  python/src/graph_engineering/sqlite_operation_baseline_source.py
710a9da73869db1662874b8b3264490644259a4b800fc895212bd084d60af39b  python/src/graph_engineering/sqlite_cursor_publication_transaction_owner.py
1ef8ba60ecca597930b1f68412a43ecf5c84e3e4c9ca27c5cd802b772eb0fe01  python/tests/test_sqlite_cursor_publication_transaction_owner.py
ae9fd45f8e295148cc2538e0b73f834f6ac832bd6e328556d56305ea35649b1e  python/tests/sqlite_cursor_publication_transaction_owner_report.py
a2a8b224993b79adfd2b20d3a78e8591dd7e53fc2cdb18756f406afee198cdf0  codex_plans/Graph-Engineering-21-Day-Master-Plan.md
```

## Final independent acceptance audit

The last fresh-context audit initially rejected relative Python path reuse and
stale terminal transaction mode. After the absolute-path and terminal-clear
correction it re-read current bytes and returned H0 / M0 / L0, ACCEPT. Its
independent focused gate passed TypeScript typecheck, portable parity 2/2,
TypeScript owner 27/27, Python owner 36/36, and public root 1/1. It found no new
correctness defect in record, ledger, checkpoint, revision, calendar, CI, or API
scope.
