# SQLite cursor B3 migration 0002 executor and receipt review — 2026-07-29

## Outcome

This batch implements the exact TypeScript/Node SQLite migration-0002 asset
closure, connection-owned sequential executor, outer-authority permanent-write
ledger and authentic single-use catalog-rebuild receipt. It intentionally does
not activate manifest v2 and does not claim the later post-DDL fence, reader
lease, cursor adoption or commit stages.

Branch: `feat/authoring-foundation`

Baseline commit: `431380b03eec61e27006f3fff1c9ec4ac1d7024e`

Commit identity required for the accepted batch:
`reacher-z <mtrxcop@gmail.com>` with no co-author trailer.

## Exact packaged assets

| Asset | Bytes | SHA-256 |
|---|---:|---|
| `0002-v1-to-v2-operation-replay.sql` | 9,523 | `1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d` |
| `manifest-v2.preview.json` | 4,908 | `f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf` |

Both assets exist in the npm migration directory and the Python package's
`_sqlite_migrations` directory. Release automation verifies source parity and
published npm/Python artifact inclusion. The active manifest remains v1; the
new manifest is explicitly named and treated as preview material.

## Production implementation

### Asset and manifest authority

`cursor-publication-migration-0002-asset.ts` reads package-relative files and
fails closed on non-files, byte/digest drift, BOM, CR, malformed text/JSON,
statement-count drift and migration/target identity drift. The SQL is parsed as
exactly twenty statements. Asset and manifest proofs are frozen
null-prototype values authenticated by private weak identity rather than by
caller-visible fields.

### Connection-owned execution

`sqlite-connection.ts` adds a closed-set TEMP-conflict preflight and opaque
migration execution session. It captures native `StatementSync.run`, uses the
already captured native prepare/setter trust root, and exposes no arbitrary SQL
or parameter seam. Statements execute one at a time in fixed order; later
statements are not prepared early.

After native `run()` returns, completed-count, next-index and transaction epoch
advance before the subsequent `total_changes()` read. Therefore a counter-read
failure cannot falsely report that a native statement never ran. Best-effort
counter synchronization never replaces the primary error.

For the two data-writing statements, safely decoded native run changes are
reconciled with real `total_changes()` deltas. Expected deltas are statement 4
= 1 schema row, statement 17 = `L` legacy rows and every other statement = 0.

### Outer authority and receipt

The outer authority now owns mutable, monotonic transaction and write evidence:

- transaction epoch;
- `total_changes` watermark;
- logical write sequence;
- fixed statement count; and
- affected-row watermark.

The execution phase is `ready-0002 -> executing-0002 -> 0002-complete`; any
authority mismatch, accounting drift or second execution transitions to a
fail-closed state. Successful execution advances twenty statement epochs, one
logical write and `1 + L` permanent rows.

The authentic receipt binds the exact authority, connection, transaction
lineage, pre/post counter state, explicit three-dimensional ledger
before/after/delta, exact asset and preview-manifest identities, target schema
identity, pre/post catalog digests, versions, source counts, parameter/result
digests and all twenty statement deltas. Receipt reads freshly revalidate the
live authority. Rollback, close, poison or transaction restart invalidates the
old receipt.

## Independent audit findings and remediation

Three read-only subagents inspected the batch independently.

1. A high-risk stale-success receipt after rollback was found. The reader now
   revalidates authority activity, exact connection/lineage, phase, watermarks
   and stored asset/manifest identities; rollback and re-begin are covered by a
   regression test.
2. A high-risk native-run/counter-read window could under-report completed
   statements. The executor now makes completion/epoch advancement irreversible
   immediately after native run returns, before later observations.
3. A high-risk release-closure gap allowed the preview manifest and Python
   copies to be absent while old release checks stayed green. Exact Python
   mirrors and npm/Python artifact checks were added.
4. The receipt previously bound only a manifest digest rather than the real
   verified manifest proof. The loader now mints a real opaque manifest
   identity and the receipt binds it.
5. Non-empty legacy copy and exact affected-row vectors were under-tested.
   Tests now cover `L = 0` and `L = 2`, including canonical operation survival.
6. Ledger delta was derivable but not explicit. A frozen explicit delta is now
   part of the authentic receipt.
7. `1 + L` overflow safety was implicit. Execution now proves both operands
   and their sum are safe integers before issuing migration SQL.

## Verification record

The acceptance run records the final uncontended results for:

- focused outer-authority/migration/target-catalog tests;
- complete `@graph-engineering/sqlite` tests;
- SQLite and workspace typecheck;
- workspace lint;
- source-only release verification;
- release-checker unit tests, including preview drift rejection;
- Python release-script Ruff validation and artifact checks;
- full B3 ledger conformance with both implementation/active-manifest claims
  still false;
- `git diff --check` and staged-scope review; and
- final independent static audit after remediation.

Final uncontended outcomes:

- focused authority/catalog/migration/connection tests: 4 files, 70/70;
- complete SQLite package tests after the final lifecycle patch: 26 files,
  899/899, exit 0;
- SQLite package typecheck: exit 0;
- workspace typecheck: all eight implementation packages passed;
- workspace lint: all eight implementation packages passed;
- source release gate: active assets 4, preview assets 2, npm/Python mirrored
  copies verified, exit 0;
- release-checker self-tests: 6/6, including one-byte preview drift rejection;
- Python checker Ruff: exit 0;
- Python wheel/sdist/installed gate: wheel entries 71, sdist entries 72, two
  isolated provider installations, active assets 4, preview assets 2;
- frozen SQLite ledger/B3 suite: 61/61 followed by every validator, with
  `implementationClaim: false` and `activeManifestClaim: false` retained;
- three final independent static reviews: H=0/M=0 for receipt/adversarial,
  native execution/runtime and release/scope lanes;
- `git diff --check`: exit 0; and
- append-only plan preservation: original first 14,174 lines remain SHA-256
  `f3a1a8e6822ae1f3fd2f5fa7e9bd0536908b8b25f8c1f80ad172f07562570dee`.

No partial or CPU-contended test attempt is promoted as acceptance evidence.
The exact pushed commit and remote parity are reported in the commit handoff,
because embedding a commit's own hash inside that commit would be circular.

## Honest remaining nonclaims and next DAG leaf

This batch does not provide a Python-native migration executor; Python currently
receives byte-exact preview assets and artifact verification only. It also does
not expose a production fault-injection seam. A deterministic, non-public
statement-10 partial-failure harness and exhaustive per-name TEMP-shadow matrix
remain a hostile-testing follow-up.

The immediate next implementation leaf is the post-DDL catalog fence. It must
perform a fresh read from the exact connection and bind the authentic receipt,
outer authority, transaction lineage, epoch, total-change watermark and
three-dimensional ledger. It cannot trust a stored or caller-supplied target
snapshot. Reader lease/terminal proof, baseline receipts, four-receipt adoption,
cursor rebind, validation rules 11/12, TEMP retirement and commit remain later
leaves.
