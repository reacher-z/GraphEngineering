# SQLite Cursor Slice B B0b/B1 final consolidated audit

Date: 2026-07-28
Auditor lane: independent read-mostly cross-runtime review
Authority: `codex_logs/reviews/SQLITE-CURSOR-SLICE-B-B0-STAGE-OWNER-BRIDGE-DESIGN-2026-07-28.md`
Shared fixture: `spec/conformance/sqlite-cursor-stage-ownership.case.json`
Final disposition: **ACCEPTED — HIGH 0 / MEDIUM 0 / LOW 0**

## 1. Scope and nonclaims

This audit accepts only the combined Slice B ownership seam implemented by:

- B0b: the one-way transfer from the exact A2b/B0a captured-source evidence
  to one exact completed baseline TEMP stage and one exact live cursor-campaign
  session; and
- B1: creation, validation and adoption of the exact private
  `temp.ge_blr_cursor_seal` catalog through one stage-owned DDL transition.

The audit does not accept or claim B2 cursor scanning, bounded diagnostic rules
1–10, A1-root reproduction over real cursor rows, publication/rebind,
post-rebind validation, migration `0002`, permanent v2 state, scale evidence,
crash/replay, release readiness, adoption or popularity outcomes.

## 2. Reviewed implementation surface

### TypeScript

- `packages/sqlite/src/cursor-seal-temp-table-contract.ts`
- `packages/sqlite/src/operation-baseline-cooperation.ts`
- `packages/sqlite/src/operation-baseline-cursor-ownership.ts`
- `packages/sqlite/src/operation-baseline-cursor-stage-ownership.ts`
- `packages/sqlite/src/operation-baseline-stage.ts`
- `packages/sqlite/src/sqlite-connection.ts`
- `packages/sqlite/test/operation-baseline-cursor-stage-ownership.test.ts`
- `packages/sqlite/src/index.ts`

### Python

- `python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py`
- `python/src/graph_engineering/sqlite_operation_baseline_stage.py`
- `python/tests/test_sqlite_operation_baseline_cursor_stage_ownership.py`
- `python/src/graph_engineering/__init__.py`

### Shared contract

- `spec/conformance/sqlite-cursor-stage-ownership.case.json`
- the B0b/B1 requirements in the 624-line implementation brief named above;
- the related append-only master-plan Slice B entries.

## 3. Review history retained

Acceptance was not granted to the first implementation. The initial independent
gate rejected it at **HIGH 2 / MEDIUM 4 / LOW 1**:

1. the B1 exact one-statement TEMP DDL seam was not yet implemented;
2. replaceable class/prototype dispatch could substitute ownership checks;
3. Python cleanup and primary-exception precedence were incomplete;
4. wrong exact-stage presentation was not terminal after source authority had
   already been accepted;
5. the wrong lifecycle boundary could remain retryable rather than burned;
6. TypeScript consumed-witness behavior diverged from the design's retained,
   non-consuming historical evidence;
7. required replacement, drift and failure-precedence gates were missing; and
8. TypeScript still admitted an unsupported options surface.

The implementations were revised rather than the requirements being weakened.
The unsupported options and consumed-witness behavior were removed; wrong-stage
and wrong-phase attempts became terminal after authority acceptance; both
languages gained the exact B1 catalog; dynamic B0b/B1 dispatch was replaced by
captured exact intrinsics; and the missing cross-runtime fixture and focused
cases were added.

Subsequent review rounds found additional blocking defects and kept the gate
closed until each was reproduced and corrected:

- a TypeScript public epoch getter could return one true value followed by a
  stable false value while an internal catalog helper adopted the false value;
- a TypeScript cleanup-owner snapshot could replace the authoritative B1
  exception;
- Python marked the cursor-seal object as owned only after the first DDL cursor
  close, so a close failure could leave the seal plus all baseline reserved
  objects while disposal appeared complete;
- Python's B1 entry called a mutable class lookup for
  `_assert_cursor_stage_transfer`, allowing a replacement method to skip the
  exact retained-session fence;
- both runtimes initially cleaned B1 failure by table name alone, so a
  rollback/rebegin followed by a same-name replacement could cause the stale
  stage to delete an object from the new transaction generation; and
- the shared-fixture tests did not initially freeze every top-level contract
  field. This final LOW was corrected in both languages.

No item in this history is waived. Every item has a source-level correction and
a retained regression or an independently executed probe.

## 4. Final authority and lifecycle result

### 4.1 B0b authority order

Both runtimes now preserve the required order:

1. non-consuming A2b receipt provenance is evaluated first;
2. exact historical source/connection evidence is derived from that receipt;
3. the exact registered baseline stage is required;
4. ordered handoff and all four predecessor campaigns must be complete with no
   active cursor, session or cleanup residue;
5. the exact receipt-derived source and projection identities must match the
   stage's retained identities;
6. baseline TEMP catalog, main catalog, common counts and relation coverage are
   re-proved;
7. current stage epoch and allowed `total_changes` are fenced with private,
   captured owner observations; and
8. one opaque transfer/session identity is published once.

B0b itself executes no cursor DDL, creates no cursor object, changes no row,
does not advance the owner epoch and does not rewrite the captured epoch.

### 4.2 One-way historical/live epoch split

The capture epoch remains immutable historical evidence. The live stage epoch
is a separate owner value. After the exact B1 DDL, the old historical witness
correctly becomes stale, while the retained B0b stage/session fence remains
valid at the adopted live epoch. Neither runtime mutates the source summary or
capture registry to make old evidence appear current.

### 4.3 Exact B1 catalog

The two implementations and shared fixture use byte-identical DDL with SHA-256:

```text
032db65e1e8c11d90ed27fc6a6e2cab130d1bf33c7d688381f5666379c52b84a
```

The accepted object is exactly one `ge_blr_cursor_seal` TEMP table with:

- 30 frozen columns in exact order;
- `STRICT` and `WITHOUT ROWID` both enabled;
- primary key `(token_hash, tenant_id)`;
- exact stored `sqlite_schema.sql` bytes;
- one positive rootpage stable within the retained stage session;
- all baseline reserved objects still exact; and
- no additional reserved object.

The B1 transition is accepted only at owner epoch `before + 1` and
`total_changes == before`. `+0`, `+2`, row movement, caller DDL, catalog shape
drift and transaction replacement are rejected and never adopted.

## 5. Captured-intrinsic result

### TypeScript

The coordinator invokes captured begin, fence, abort and create intrinsics.
Owner epoch and total-change observations use class-private snapshots invoked
through captured base functions. The exact B1 statement uses the captured base
`execTrusted`; the immediate attempt-identity query uses the captured base
`prepare`. Later prototype/instance replacements therefore cannot become an
ownership decision.

The retained fence compares private owner snapshots before and after catalog
work and repeats a final epoch equality. It never adopts a value read only from
the replaceable public getter. The public getter remains an additional drift
detector, not an authority source.

### Python

The coordinator captures exact stage begin, retained-fence, abort and B1-create
methods. Inside B1, the retained fence and phase-aware catalog validator are
also frozen after class creation and invoked directly. Owner properties,
`execute`, cursor `fetchone` and the internal cursor close used for attempt
identity are captured exact functions. Exact-type and weak-registry checks
remain mandatory.

An independent valid-receipt/fake-session probe replaced the public class
method and invoked the captured B1 entry directly. The replacement method was
called zero times, the fake session was rejected, and no seal table appeared.

## 6. Failure and cleanup semantics

### 6.1 Authoritative exception preservation

After DDL execution returns, Python records ownership before the caller-visible
DDL cursor close. A first-close failure is therefore treated as a post-create
failure, not a pre-create failure. Both runtimes preserve the original B1
exception when cleanup, owner snapshot, poisoning or cursor close also fails.

### 6.2 Exact-attempt cleanup

Cleanup is no longer authorized by name alone.

TypeScript freezes the just-created rootpage, exact stored SQL and private
owner generation immediately after the owned create. Cleanup requires the
same active EXCLUSIVE generation, unchanged row counter and the same exact
rootpage/SQL identity.

Python freezes the same rootpage/SQL identity with captured connection/cursor
intrinsics and records the post-create epoch. Cleanup requires the same active
EXCLUSIVE epoch, unchanged row counter and unchanged identity. Successful drop
is accepted only after the object is proven absent and the exact cleanup epoch
is observed.

### 6.3 Same-name replacement preservation

The final replacement probes perform a real rollback after the owned create,
begin a new EXCLUSIVE transaction and create a same-name replacement. The
primary failure is preserved, cleanup refuses to drop the replacement, and
the stale stage does not adopt the replacement generation.

TypeScript disposal leaves the new-generation replacement untouched. Python
disposal refuses to report completion while reserved objects remain and leaves
the replacement untouched. This is the required distinction between cleanup
of the exact failed attempt and deletion by a reused name.

### 6.4 No false disposal after the Python close failure

The Python first-DDL-close regression proves all of the following together:

- the unique primary exception object/message survives;
- the seal table is absent after B1 cleanup;
- the stage is poisoned until explicit disposal;
- cleanup epoch ownership is synchronized only after exact drop proof;
- disposal drops every baseline reserved object; and
- the stage reaches `disposed` only with reserved-object count zero.

## 7. Shared fixture parity

Both language tests now freeze all nine top-level fixture fields:

1. `contract`;
2. `cursorSealTempTableDdl`;
3. `cursorSealTempTableDdlSha256`;
4. `sqliteSchemaSql`;
5. `rootpageRule`;
6. `tableList`;
7. all 30 `xinfo` rows;
8. all eight outcomes; and
9. all 17 required scenarios.

The frozen outcomes are `accepted`, `invalid-authority`, `stale-epoch`,
`unexplained-write`, `incomplete-stage`, `already-started`, `poisoned` and
`disposed`. Both runtimes bind the same scenario names to the same outcomes.

## 8. Public-surface result

The B0b/B1 coordinator, opaque handle, stage intrinsics and catalog constants
remain package private. `packages/sqlite/src/index.ts` does not export them,
and `graph_engineering.__init__` does not re-export the Python private names.
Focused runtime checks confirm absence from both package roots.

## 9. Verification evidence

Independent final commands/results:

```text
TypeScript focused B0b/B1
  1 file / 31 tests passed

TypeScript @graph-engineering/sqlite full source suite
  20 files / 464 tests passed

TypeScript static/package gates
  typecheck passed
  lint/type gate passed
  build passed

Python focused B0b/B1
  44 tests passed

Python adjacent source/stage/handoff/campaign/cursor suites
  609 tests passed

Python isolated B0b/B1 integration suite
  full repository snapshot: 1,804 passed, 2 skipped, plus 2 nested subtests
  scoped Ruff check and format check passed
  strict MyPy over 53 source files passed

Shared/scoped repository gates
  exact fixture field binding passed in both runtimes
  package-root non-export passed in both runtimes
  git diff --check passed for all B0b/B1 source, test and fixture paths
```

A combined full Python run was also repeated after the concurrently developed
D6 compiler tests were migrated to their new compile-invalid contract:

```text
Python combined full repository suite
  1,798 tests passed in 108.25 seconds
```

## 10. Final disposition

The final B0b/B1 implementation matches the implementation brief and shared
fixture with **HIGH 0 / MEDIUM 0 / LOW 0**.

The gate is accepted because the exact authority chain, one-way epoch split,
one-statement DDL delta, catalog identity, replacement preservation, exception
precedence, cleanup ownership, disposal semantics, cross-runtime fixture and
package-private boundary are all implemented and directly verified. This
acceptance closes B0b and B1 only; Slice B remains open for B2 and every later
nonclaim listed in section 1.
