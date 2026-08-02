# Python cursor B3 baseline-header publication review — 2026-08-01

## Bounded result

This record covers the Python third initial-write leaf: permanent publication
of `main.ge_cycle_operation_baselines` after the exact baseline-entry receipt.
The candidate is frozen and has passed focused, adjacent, cross-runtime,
static/type, repository-wide, independent audit and complete Python gates.

This leaf does not publish sequence zero, consume any initial-write receipt,
adopt the TEMP stage, rebind a cursor, retire TEMP state, commit the caller
transaction, activate a manifest or establish release/adoption readiness.

## Frozen bytes

- source owner SHA-256:
  `e07f18b686f3589176234baab8328f9f2af2cfc9d4ca81516b07fc20121f73e9`;
- outer authority SHA-256:
  `1f5001102adbc6ca5f70bf2dec1ecb9835c2b63c1ceae7cffa63138fa69c8919`;
- hostile test SHA-256:
  `16629e53c51e9e2ee88749b158bc1dce84ba5d86a2d261f4caca1ebdc9994a40`.

The test file has 1,630 lines, 37 test functions and 47 collected cases.

## Source execution boundary

The source owns the exact 488-byte INSERT with SHA-256
`b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a`.
Format version one, application ID 1195724359 and source user version one are
SQL literals. Exactly fourteen package-owned values are bound in the frozen
order: baseline ID, source schema hash, migration-lineage ID and hash, source
descriptor hash, capture time, legacy count, entry count, first/final hashes,
projection hash, runtime, runtime version and policy BLOB.

Python `prepare_count == 1` means one cursor/session reservation because the
standard `sqlite3` binding has no prepare-only API. It is not a native compile
claim. The opaque weak execution is single-run, exact-lineage and caller-SQL
free. Native return advances completed/affected/epoch state before result or
counter inspection. Success and every failure path clear and close the cursor
exactly once; primary error precedence is preserved and only a scalar cleanup
code is retained.

## Header provenance and canonical frame

The outer authority authenticates the exact reusable, non-consuming entries
receipt and performs no new SELECT. Header source values come from an
independent frozen five-scalar commitment constructed at authority preparation
from the authenticated detached source envelope and cross-checked against the
source seal. Mutable authority state is freshly compared with that commitment
before source prepare and again during receipt assertion.

The runtime identity is the frozen conformance identity
`graph-engineering-python@0.1.0a1`, not the ambient interpreter or current
package version. The canonical policy is 946 bytes with SHA-256
`67cbe0ac8bf04f28061d50f8b7089312cc1e1f9a9520ede95deec0d1f4ec5eb0`.
The outer writer defensively detaches it.

Two different callables independently rebuild the complete `1 x 14` tagged
frame. Receipt registration requires agreement on the parameter digest and the
exact aggregate result digest for `{"affectedRows":"1"}`. The control fixture
known answers are
`08d9635267a488ec2a7f2277646708c8636c2266944bbb50383b230bf38817ff`
and
`2475973b53ba5659827cf78fca83b7a040172ae04e0c03d7de1cd7a297f1a96e`.

## Receipt, phase and ledger

The opaque receipt snapshot has the exact 42-field order frozen in plan
section 31.37.48.11. Its weak record stores scalars, exact identity values and
weak graph edges; it does not retain the connection, projection, source
envelope, policy bytes, cursor, snapshot, exception or traceback strongly.
Assertion is reusable and non-consuming, fresh-reproves the predecessor graph
and permits only monotonic authorized later ledger advancement.

The phase transition is
`baseline-entries-complete -> executing-baseline-header -> baseline-header-complete`.
For the control `E=12`, `L=1` graph the ledger moves from `2/32/14` to
`3/33/15`, exactly `+1/+1/+1`. Native completion followed by result, counter,
digest or cleanup failure retains physical progress, mints no receipt and
never advances the logical sequence.

The header INSERT SQL/SHA pair is captured at module load, copied into the
receipt record and freshly rehashed during assertion. A paired mutation of
public SQL and SHA values cannot rewrite historical receipt meaning.

## Hostile defect found and closed

Independent audit found one medium issue before acceptance. The five source
header scalars initially existed only in mutable authority state, so internal
state drift after entries publication could be written and authenticated by
the header leaf. A probe changed `captured_at_ms` and reproduced a minted
receipt containing the changed value.

The fix added the independent frozen source-header commitment described above.
Five parameterized hostile cases mutate capture time, lineage ID, lineage hash,
descriptor hash and schema-identity hash. Every case now fails before source
prepare with authority poisoned, logical/prepare/execute/affected counters zero,
no header row and no receipt. The five-way targeted gate passed 5/5.

## Executed evidence

- final Python header hostile suite: 47/47 in 207.73 seconds;
- ten-file serial B3 integration through header: 359/359 in 1,067.31 seconds;
- TypeScript header behavior oracle: 20/20 in 17.99 seconds;
- prior outer/fence regression: 35/35;
- prior reader/entries regression: 129/129;
- source regression: 47/47;
- Ruff lint and format: green on all three changed Python files;
- mypy: zero issues across 99 source files;
- `py_compile` and `git diff --check`: exit zero;
- source-only contract audit: HIGH 0 / MEDIUM 0 / LOW 0;
- final outer/source/receipt audit after remediation: HIGH 0 / MEDIUM 0 /
  LOW 0.

The exact serial Python integration command included the source, clock,
target-catalog, migration asset, migration execution, outer authority,
post-DDL fence, post-DDL reader, baseline entries and baseline header test
files in that order.

Additional repository gates required by the earlier plan also passed:

- `corepack pnpm test:sqlite-ledger-contract` — 61/61 Node tests plus all six
  strict validators; the B3 registry remains exactly 145 hostile records and
  20 fault boundaries with implementation/active-manifest claims false;
- `corepack pnpm validate:fixtures` — 85 JSON fixtures and 44 case manifests,
  including the exact 145-record B3 hostile inventory, passed;
- `corepack pnpm check:sqlite-migrations` — source/mirror digest closure and
  6/6 migration release tests passed;
- `corepack pnpm check:packages` — 9/9 npm package manifests and dry-run
  tarballs passed; and
- `corepack pnpm check:packed-install` — run serially after package-content
  validation; 9/9 tarballs installed and smoke-tested with healthy bins.

The complete Python regression passed **3,688/3,688** in 2,606.85 seconds
(43 minutes 26 seconds), with zero failures and zero skips, on the same frozen
production and hostile-test bytes.

## Final authorization

All bounded header gates are green. This record authorizes one scoped
baseline-header commit and push. It authorizes only the operation-sequence-zero
successor and does not broaden any nonclaim above.

## Plan integrity and next leaf

The pre-append master plan has 17,195 lines and SHA-256
`d45a9643f02a933ba7c038a1dd043fecfcc4636c27f1e87e5d3225fb59ad8c5a`.
The acceptance section is appended only at EOF and must preserve this prefix.

Passing the complete regression authorizes only Python operation-sequence-zero
publication under section 31.37.35. It does not authorize four-receipt adoption
or any later B3 phase. External star counts remain an outcome target, not an
engineering claim.
