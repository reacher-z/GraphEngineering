# SQLite Cursor B3 — four-receipt atomic initial-stage adoption

Date: 2026-08-01
Plan leaf: §31.37.36
Branch: `feat/authoring-foundation`
Status: final verification in progress; this log is completed only with the
acceptance checkpoint committed beside it.

## Delivered boundary

This leaf adopts the exact ordered receipt tuple
`[migration-0002, baseline entries, baseline header, operation sequence zero]`
into one opaque initial-stage adoption receipt. It validates the complete live
authority graph before consuming anything, then performs a no-fail atomic tail
that publishes the lower stage transition, installs four distinct consumed
tombstones, records one adoption receipt and retires the obsolete B2 fence.

The adoption proof commits exact connection and transaction lineage, private
mutation epoch, real `total_changes`, three-dimensional outer ledger, full
post-DDL target-catalog identity, terminal reader lease, projection identity,
four original receipt identities, four tombstone identities and the retired
B2 fence. After success the four old receipt assert/read surfaces reject while
the post-DDL catalog fence remains provable through the exact migration
tombstone and adoption receipt.

The implementation deliberately performs no permanent SQL, transaction
control, callback, cancellation read or cursor rebind in its atomic tail.
Malformed presentation consumes nothing and permits a corrected retry. A
prepared cancellation also consumes nothing and permits the same exact bundle
to retry. Clone, substitution, cross-run presentation, replay, authority drift,
ledger drift, lineage drift and lower-tail revival fail closed.

## Review history and remediations

The implementation received repeated independent source passes and executable
hostile probes. The first converged pass reported H0/M0. A deeper final hostile
dependency audit then found four material ambient-mutation gaps and one array
iterator gap; all were retained as failing regressions before remediation.

1. Adoption catalog reads captured `SQLiteConnection.prepare` but invoked the
   returned `StatementSync.get` dynamically. Both catalog reads and the
   provider-clock live-lock read now use the captured native statement getter.
2. The connection had captured `DatabaseSync.prepare`, but adoption reached it
   through the public fault-injectable prepare path. Three closed native-read
   kinds now prepare only the migration-lock, schema-version and main-operations
   catalog queries through the captured database intrinsic. The public prepare
   contract remains fault-injectable for the existing B1/B2 adversarial suite;
   its SQL tokenizer separately uses captured String, Array, Set and RegExp
   operations.
3. Receipt presentation and receipt assertion used array destructuring or
   iteration after their descriptor-safe checks. Both use direct indexed reads
   and indexed loops, so replacing `Array.prototype[Symbol.iterator]` cannot
   bypass or abort validation.
4. The lower stage authority shape check used live `Object.isFrozen`,
   `Object.getPrototypeOf` and `Reflect.ownKeys`. It now invokes captured
   intrinsics through captured `Reflect.apply`.
5. Clock graph checks used live `instanceof SQLiteConnection`. They now rely on
   private registry identity plus captured owner, lineage and live-lock proofs.
6. Canonical policy revalidation reached live Object, Array, Number, String,
   WeakSet, JSON and hash methods. Canonical capture, sort, serialization and
   hashing now retain and invoke their module-load intrinsics without array
   iteration or caller-owned accessors.
7. The initially prepared cancellation point preceded full stage validation
   and could self-lock the retry. Cancellation now occurs after preparation but
   before any tombstone or receipt allocation, and the prepared graph accepts
   the same exact corrected retry.
8. A lower stage publication tail originally survived wrapper retirement.
   Retirement and poisoning now burn both continuation levels; authentic
   publish is one-shot and replay, retire-then-publish and poison-then-publish
   are directly tested.

The hostile-intrinsic matrix now replaces fourteen mutable entry points after
module import, including Object shape operations, WeakMap operations,
`Reflect.apply`, `Reflect.ownKeys`, numeric/array validators,
`DatabaseSync.prepare` and `StatementSync.get`. A separate receipt assertion
probe replaces the array iterator while the assertion is executing. Every
descriptor is restored in `finally`.

An independent final source-only pass on the remediated byte set reported
**HIGH 0 / MEDIUM 0 / LOW 0**. It re-walked receipt presentation, consumption,
activation and assertion; native prepare/get paths; adoption-reachable SQL
validation; canonical detached capture and Unicode serialization; lower-stage
authority shape validation; and the provider-clock private-registry brand
proof. It made no edits and ran no tests.

The broad gate itself caught an over-broad first remediation. Routing the
entire public `SQLiteConnection.prepare` surface through the captured native
method caused 95 B1/B2 adversarial cases to stop injecting their intended
faults. That change was not papered over by rewriting the fault matrix: public
prepare was restored, and only three package-private, closed SQL kinds were
given captured native reads. Representative injection probes passed, and the
next full run restored all 362 B1/B2 cases. That run reached 1039/1041 overall;
the only two failures were the now-obsolete outer prototype expectation and a
15-second timeout in the expanded fourteen-path hostile test. The outer test
now proves exact captured-success receipt/counter/ledger commitments, and the
hostile test has an explicit 45-second loaded-suite budget. Both corrections
passed in isolation before the final full rerun.

## Dedicated regression matrix

The 17-case adoption suite covers successful proof commitments; ten malformed
bundle families with corrected retry; missing, cloned, cross-run and active
reader presentations; prepared cancellation and retry; consumption of all old
proofs with surviving post-DDL fence; receipt clone/substitution/replay;
mutation-epoch, `total_changes`, ledger and lineage drift; zero SQL/transaction
control/rebind; hostile mutable intrinsics; authentic lower-tail publication;
lower-tail replay; retirement; poisoning; and package-root runtime/type
isolation.

Verified on the candidate byte set before the final broad gate:

- SQLite typecheck: pass.
- Dedicated adoption suite: 17/17 pass.
- Core typecheck: pass.
- Core package tests after canonical hardening: 10/10 files, 465/465 tests.
- Scoped `git diff --check`: pass.

The final SQLite package, migration, ledger, workspace, fixture, documentation
and packaging results are appended below only after they execute against the
same final bytes.

## Explicit non-claims

This leaf does not open a publication session, rebind a cursor, implement rules
11 or 12, observe a second provider-clock boundary, publish lineage or metadata
rows, retire the TEMP catalog, commit or roll back a transaction, activate the
v2 manifest, add Python parity or run the final semantic release audit.
`implementationClaim`, `activeManifestClaim`, protocol, release and external
adoption claims remain false. GitHub star targets are product goals, not a
technical acceptance claim.

## Final gate results

- `@graph-engineering/core` typecheck: pass.
- Core tests: 10/10 files, 465/465 tests.
- `@graph-engineering/sqlite` typecheck: pass.
- Dedicated adoption tests: 17/17.
- Final SQLite package tests: 33/33 files, 1,041/1,041 tests; Vitest 257.55
  seconds, wall clock 258.86 seconds.
- SQLite ledger/B3 contracts: 61/61 tests plus all strict validators; frozen
  claims remain false.
- SQLite migration release: source/mirror checks pass and 6/6 tests pass.
- Fixtures: 85 JSON fixtures, 44 case manifests, 145 B3 hostile obligations
  and 20 B3 fault boundaries pass.
- Documentation: 477 local Markdown links pass.
- Workspace typecheck and lint: all nine participating packages pass.
- Workspace build: all nine participating packages pass.
- Package contents: 9/9 npm manifests and tarballs pass; SQLite is explicitly
  bounded at 2.5 MB and measures 2,058,027 unpacked bytes.
- Packed install: 9/9 pnpm tarballs install and smoke-test successfully.
- SQLite installed artifacts: npm source/install/runtime smoke and Python
  wheel/sdist asset parity pass; the staging closure now includes Runtime's
  declared Primitives dependency.
- Release task map: 178/178 leaves and 40/40 tests pass.
- Evidence closure: audit-only, zero release weight, 102/102 tests pass.
- Independent final and incremental source audits: H0/M0/L0.
- Scoped `git diff --check`: pass.

The plan was append-only. Before the final acceptance append it contained
15,516 lines with SHA-256
`05e39a262a189462c6f8e008a51764ac17e5783dba91278813437970e82f0fde`;
that exact prefix still matches. The original 15,306-line prefix still matches
`f44aad42cdb09d4ae3e887298b6eabc7cd2b8d1caedf3f00ea6fa71673c7af07`.
The 15,711-line acceptance prefix also remains exact at
`74909401c6c2d80d03897bd4f0f6690e223a92beaf80108a768479f4632cc52c`;
the packaging extension is appended after it.
