# SQLite Cursor B3 — initial-publication real-SQLite parity

Date: 2026-08-02

Branch: `feat/authoring-foundation`

Plan authority: master plan §§31.37.52 and 31.37.53.8

Status: **accepted for scoped commit.** The final frozen TypeScript and Python
reports, strict comparator, affected runtime regressions, artifact smokes and
two independent read-only audits completed successfully.

## Outcome

This leaf proves exact TypeScript/Python parity for three real-SQLite initial
publication controls:

1. `initial-publication-success-control`;
2. `initial-publication-invalid-adoption-bundle`; and
3. `initial-publication-post-0002-catalog-drift`.

Each runtime independently constructs and observes its own SQLite graph. The
reports do not import each other, the comparator does not manufacture subject
records, and the frozen fixture remains read-only. Each runtime emits exactly
three ordered records with the frozen 28-field shape. The comparator requires
exact fixture equality and exact cross-runtime canonical equality.

The success control independently validates the four frozen write arrays:

- prepare: `[20, 1, 1, 1]`;
- execute: `[1, 12, 1, 1]`;
- affected rows: `[2, 12, 1, 1]`; and
- native `total_changes`: `[2, 12, 1, 1]`.

The invalid-bundle control proves the initial rejection is non-mutating, then
retries the original authentic bundle. The corrected retry reads real
authority and adoption snapshots, proves receipt consumption, tombstone mint
and adoption mint are exactly `4/4/1`, proves the adoption receipt and four
original receipt identities, and proves each original receipt is consumed.

The catalog-drift control performs a same-count physical index substitution on
the same native database owner. Both runtimes prove the target inventory still
contains 34 rows while its digest differs from the frozen target. TypeScript
locks its real `GE_CYCLE_STORE_CORRUPTION` code and exact catalog-mismatch
message; Python locks its internal exact
`GE_CURSOR_B3_TARGET_CATALOG_MISMATCH` failure. Both normalize to the frozen
parity record.

All three subject graphs retain rollback, rebind and commit counts at zero.
This leaf performs no publication-session acquisition, cursor rebind, rules 11
or 12, transaction completion, crash/reopen reconciliation, manifest
activation or release authorization.

## Frozen files

| File | Lines | SHA-256 |
|---|---:|---|
| `tools/conformance/sqlite_cursor_publication_initial_typescript_report.mjs` | 991 | `86e728ddd2b8bf38c56c5a78e7713b2d1545306da2f12605d8ce8cac2bdf44d1` |
| `tools/conformance/sqlite_cursor_publication_initial_python_report.py` | 1,121 | `637165ab492cbfad00219f1b8448a2fcaf0fe7b75178e6c5648f5112d5165a68` |
| `tools/conformance/sqlite_cursor_publication_initial_parity.test.mjs` | 390 | `f728466e1556e361f7a1492105a3107a32ff2c33a220229c775d34ecc9bd1f2a` |
| `python/tests/test_sqlite_cursor_publication_initial_parity_report.py` | 141 | `790524144c922f8f9a01edb80456d8ddd9a7cb1f473de5abcaff573e66db11cf` |

`package.json` adds the single integration command
`test:sqlite-cursor-publication-initial-parity`. It builds the Core, Runtime and
SQLite packages before launching the strict Node comparator.

## Evidence closure

The report envelope is closed and ordered: `runtime`, `publicExports`,
`counterProbe`, `rollbackCount`, `cases`. Each report writes one compact JSON
document plus one final LF and no diagnostic output. The comparator rejects
duplicate JSON keys, prefix or suffix noise, abnormal child termination,
missing, extra or reordered keys, unsafe or negative counters, scalar type
drift, incorrect four-array lengths or order, non-live self-probes and any
fixture or cross-runtime difference.

The isolated self-probes explicitly activate every independent counter hook
and each of the four array slots exactly once. They are separate from the
three subject graphs. Package-root privacy checks prove the private adoption
and measurement capabilities are not exported from either public root.

## Defect chronology

Independent review rejected green candidates until their observations were
complete:

1. the Python candidate originally hard-coded catalog fence outcomes, used a
   broad drift exception check, omitted the corrected-retry authority snapshot
   and generated its self-probe through a generic field loop;
2. Python was changed to use real 34-row catalog observations and digests,
   exact drift failure, complete corrected-retry `4/4/1` evidence, four
   consumed-receipt proofs and explicit per-counter activation;
3. the TypeScript candidate then lacked explicit 34-row success/invalid
   assertions, complete corrected-retry evidence and exact drift-message
   binding;
4. TypeScript was changed to prove those observations and to inject same-count
   drift through the captured native owner so that the real catalog fence,
   rather than an earlier ledger fence, is the rejection boundary; and
5. the comparator's unused `node:path` import was removed.

No finding was waived. Two independent audits of the final SHA set reported
**HIGH 0 / MEDIUM 0 / LOW 0**.

## Validation evidence

| Gate | Final result |
|---|---|
| Initial-publication TS/Python comparator | 3/3 passed, 22.52 s |
| Python focused reporter tests | 3/3 passed, 17.49 s |
| TypeScript initial-stage adoption regression | 17/17 passed, 30.55 s |
| Python initial-stage adoption regression | 119/119 passed, 636.58 s |
| SQLite ledger contract and strict validators | 61/61 passed |
| Fixture validator | 85 JSON fixtures and 44 case manifests passed |
| Existing publication clock parity | 2/2 passed |
| SQLite TypeScript typecheck and Node syntax checks | passed |
| Ruff check, Ruff format check and mypy | passed |
| npm package content/dry-run tarballs | 9/9 passed |
| packed npm install and smoke | 9/9 passed |
| Python wheel/sdist build and installed smoke | 114/115 entries, passed |
| Plan append-only prefix proof | 18,230-line HEAD prefix SHA-256 `b465bc40c149786dad3a2a83c8824a9e61f0f1afb6aed2942a95a88822a22ed4` matched before checkpoint append |
| Independent final audit A | H0 / M0 / L0 |
| Independent final audit B | H0 / M0 / L0 |

The earlier full Python regression from the immediately preceding production
milestone remains 3,908 passed plus two subtests. This parity leaf changes no
production module or fixture, so its affected Python adoption regression and
artifact smokes are the scoped runtime acceptance evidence.

## Nonclaims

This three-control proof is not the complete executable 145-case publication
campaign. It does not claim that remaining B3 phases exist, that the preview
manifest is active, that an alpha or stable release is authorized, or that a
GitHub star target is guaranteed. The next work remains the isolated phases in
§31.37.53.7, beginning with publication-session and second provider-clock
authority.
