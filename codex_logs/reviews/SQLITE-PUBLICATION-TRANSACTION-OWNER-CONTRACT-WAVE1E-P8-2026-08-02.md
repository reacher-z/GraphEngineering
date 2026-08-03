# SQLite publication transaction owner contract — Wave 1E/P8

Date: 2026-08-02 PDT
Branch: `feat/authoring-foundation`
Scope: contract/redbar only; no runtime transaction control
Final review: three independent lanes, each H0/M0/L0, ACCEPT

## Outcome

P8 freezes the package-private transaction owner authority boundary needed
before either runtime may own the single SQLite publication transaction. The
slice is deliberately not a runtime implementation. Canonical validator output:

```json
{
  "ok": true,
  "status": "contract-frozen-redbar",
  "describedFutureScenarioCount": 32,
  "runtimeExecutedCaseCount": 0,
  "runtimeTransactionControlCount": 0,
  "atomicPublicationStageCount": 30,
  "implementationClaim": false,
  "protocolClaim": false,
  "releaseGate": false,
  "fixtureCanonicalSha256": "e900c0d822a31690c6cd4ef8d160d1cc4474bf4c605471d1aac899d4b293b303",
  "anchorsVerified": true
}
```

The 32 scenarios are normative future targets. They are not evidence that
TypeScript or Python executed BEGIN, COMMIT, rollback, close, or reopen.

## Files

Created:

- `spec/conformance/sqlite-cursor-publication-transaction-owner-v1.case.json`
- `spec/conformance/sqlite-cursor-publication-transaction-owner-v1.schema.json`
- `spec/conformance/sqlite-cursor-publication-transaction-owner-v1.validate.mjs`
- `spec/conformance/sqlite-cursor-publication-transaction-owner-v1.test.mjs`
- `spec/sqlite-cursor-publication-transaction-owner-v1.md`

Integrated:

- `package.json`: focused `test:sqlite-transaction-owner-contract` gate.
- `.github/workflows/ci.yml`: runs the focused gate after the SQLite ledger contract.
- `spec/README.md`: documents the redbar and its non-evidence boundary.
- `codex_plans/Graph-Engineering-21-Day-Master-Plan.md`: appended section 31.37.76.

All integration artifacts are mode 0644.

## Frozen authority and lifecycle

The contract freezes:

1. registration before native BEGIN I/O;
2. a weakref-capable provisional generation bound to exact owner, exact
   connection wrapper, and one-attempt nonce;
3. promotion only after returned postflight proves the exact exclusive
   transaction active;
4. tombstone before cleanup on every throw or postflight mismatch;
5. direct COMMIT presentation of owner plus exact final fence only;
6. transitive final-fence authentication of Rule 11/12, clocks, publication,
   audits, TEMP retirement, and pre-commit evidence;
7. monotonic `unclaimed -> failure-claimed | success-claimed` arbitration;
8. commit-primary cleanup internal to success after tombstoning;
9. honest rollback-failed and rollback-in-doubt states;
10. exact reopen classification from physical and semantic evidence.

The complete 30-stage publication order ends with final migration-lock
transaction fence, internal success selection that mints no new capability,
and one atomic COMMIT.

## BEGIN outcome partition

The future oracle covers:

- returned + exact active: promote and enter active;
- returned + autocommit: stable postflight failure, no rollback, reopen v1;
- returned + different generation: no rollback of unknown state, corruption if
  reopen is intermediate;
- returned + observation unavailable: close/reopen or unresolved;
- threw + exact provisional generation active: preserve primary, rollback once;
- threw + autocommit: no rollback, reopen v1;
- threw + observation unavailable: no rollback, close/reopen or unresolved.

Caller outcome Booleans, callbacks, thunks, paths, or connection substitutes
are forbidden.

## COMMIT, cleanup, and reopen partition

COMMIT rollback authorization requires the exact connection, in-transaction
truth, exact lineage, exact generation, allowed epoch baseline, and exclusive
mode. The epoch baseline is the exact pre-attempt snapshot plus only the
owner-recorded commit-attempt accounting transition.

The contract distinguishes commit returned, exact-active throw, verified
autocommit throw, different-generation active, and observation unavailable.
There is never a COMMIT retry. Autocommit alone is never v2 proof.

Rollback future targets explicitly distinguish:

- returned / timing not applicable;
- threw after native return;
- threw before native return;
- threw with outcome unavailable.

A rollback throw never enters `rolled-back`; it enters `rollback-failed` or
`rollback-in-doubt`, still closes once, and relies on reopen. These future rows
do not activate the false driver-native throw claim.

The reopen oracle covers commit-returned, rollback-completed, and
commit-in-doubt across source-v1, complete-v2, intermediate-corrupt, and
unavailable-unresolved. Commit-in-doubt covers verified autocommit, different
generation, and unavailable intrinsic observation.

## Guard inventory

The connection guard freezes 19 bypass classes: native commit/rollback,
COMMIT/END/ROLLBACK/BEGIN SQL, SAVEPOINT family, multi-statement, prepared,
scripted and nested control, live close, new/already-prepared permanent DML/DDL,
persistent PRAGMA, VACUUM/ANALYZE/REINDEX, ATTACH/DETACH/topology, and a final
catch-all for permanent-state or proof-history mutation.

## Validator and adversarial coverage

The validator combines:

- closed Draft 2020-12 schema;
- strict duplicate/trailing/prohibited-key parsing;
- independent exact semantic constants and cross-field projections;
- Unicode code-point canonical JSON;
- domain-separated SHA-256 with field/computed/trusted triple equality;
- default-on execution of both anchored dependency validators.

The 20 Node tests cover claims, trusted anchors, guard bypasses, provisional
BEGIN identity, direct/transitive object separation, 30-stage reorder, rejected
authorities, monotonic arbiter, lifecycle shortcuts, same-generation proof,
reopen evidence, diagnostic precedence, future counter orders, BEGIN postflight,
rollback throw state/timing, reopen matrix, malicious synchronous re-signing,
trusted-root substitution, unknown fields, duplicate keys, prohibited keys and
trailing JSON.

## Rejected-first review and repairs

The first final review rejected an earlier green build. Findings and repairs:

- Missing BEGIN-returned mismatch branches: added three fail-closed targets.
- Rollback throw could only transition to rolled-back: added failed/in-doubt.
- BEGIN throw could not identify generation: added pre-I/O provisional bearer.
- Success tombstone counter contradicted lifecycle: all success outcomes now
  pass through the tombstone state.
- Epoch comparison was ambiguous: froze exact pre-attempt baseline and the only
  permitted accounting transition.
- Guard list missed PRAGMA/topology/permanent writes: expanded to 19 with
  catch-all.
- Reopen coverage was partial: added complete three-by-four outcome mapping.
- Cleanup throw timing was implicit: froze before-return, after-return,
  unavailable, and not-applicable values.

No rejected version was committed.

## Commands and results

```text
corepack pnpm test:sqlite-transaction-owner-contract
  20 tests, 20 passed, 0 failed, 0 skipped
  canonical validator passed; both anchors verified

corepack pnpm check:docs
  478 local Markdown links checked

corepack pnpm validate:fixtures
  89 JSON fixtures / 46 case manifests validated; full fixture gate passed

git diff --check
  passed

node JSON parse checks for package, fixture, schema
  passed
```

A direct `pnpm` invocation was unavailable on the shell PATH; the repository's
declared Corepack package-manager entrypoint was used. A standalone ESLint
attempt found no repository ESLint configuration and is not a project gate; it
made no changes.

## Independent final audits

Plan/truthfulness lane:

- H0 / M0 / L0, ACCEPT.
- Verified append-only scope, 0 runtime evidence, complete predecessor order,
  postflight/cleanup/reopen matrices and final throw-timing delta.

TypeScript/SQLite lane:

- H0 / M0 / L0, ACCEPT.
- Verified monotonic arbiter, internal commit-primary cleanup, same-generation
  proof, persistent mutation guard, tombstone state and API outcomes.

Python/identity lane:

- H0 / M0 / L0, ACCEPT.
- Verified provisional weakref-capable bearer, no raw-driver weakref
  requirement, observation-unavailable behavior, default-on anchors, GC and
  ContextVar boundaries.

## Final hashes

```text
0aabb5ee18ce821c59de0521617d145187835bfe5806b2b0c05ff848c7c80d08  .github/workflows/ci.yml
24873237d926499f512caf4785d8388f7d2a414a3b960178016ef52292993c9f  package.json
14106e2f434b733535ea6ae4dbcd7be8d83d51fd8e27edddedc046bbae1add99  spec/README.md
3b4fe85133857e12e5c2202724ff8e7abc3c3e56dc40694eb9aebd0911aeabb5  fixture
7b15a8b69889dd2adcb93eff8d4807677f2c284ae9436df8091bc2c1c006b30c  schema
b6d59728188c919b3d62dfec8dfe848a1df6d876e5fb15c3e50bcd28d423c99c  validator
a992033cde8b9d296b6247cc05c21b63b145fcb5c4f699a157c6b97f7aafbee1  tests
20abcb41a3ebb8c72da7c5f322921dbd110a9175bac4fa02f2b592683c404d2a  human specification
8d1b44f07a81c600e4e5af6cc654c59f8de92942eaf8fafb1ec609139fcccf76  appended master plan
```

Plan append-only proof:

- pre-append line count: 21,516;
- pre-append/full-prefix SHA-256:
  `016dcdbe152a126070c4f37199296df58650d6df570b849e45a7d1df638a4965`;
- post-append line count: 21,715;
- the first 21,516 lines still hash exactly to the pre-append value.

## Remaining nonclaims and next action

This slice does not implement either runtime owner, Rule 12, remaining clocks,
post-cursor receipts, TEMP retirement, final fence, COMMIT, crash/reopen,
orchestrator, public export, manifest, or release acceptance.

P9 must implement package-private owner registration, the 19-class terminal /
mutation guard, provisional generation, guarded BEGIN, and failure cleanup in
both runtimes with parity. Runtime COMMIT remains hard-disabled until every
30-stage predecessor and exact final fence exists.
