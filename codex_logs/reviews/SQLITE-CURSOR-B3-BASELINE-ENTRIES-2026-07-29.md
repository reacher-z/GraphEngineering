# SQLite B3 baseline-entry publication receipt review — 2026-07-29

## Scope

This review covers only the TypeScript baseline-entry permanent publication
leaf after the exact migration `0002`, post-DDL catalog fence and terminal
publication reader lease. It does not claim baseline header, sequence zero,
four-receipt adoption, Python parity, cursor rebind, commit, active manifest or
release completion.

## Implemented boundary

- Closed-set connection-owned INSERT session with one captured-native prepare.
- Exact 183-byte SQL and SHA-256
  `b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b`.
- Seven exact parameters per retained canonical row and strict ordinal order.
- Native-return progress boundary with independent attempt/completion/change
  counters and failure-safe snapshots.
- Exact terminal reader lease/private retained rows; no second TEMP SELECT.
- Two-dimensional parameter and aggregate result digest commitments.
- Independent pre-mint digest verification after complete DML.
- Explicit source-read, close, rederived-projection, baseline/hash-chain,
  connection/lineage and three-ledger receipt commitments.
- Reusable non-consuming authentic receipt assertion and package-root export
  isolation.
- Captured database, statement, string and SHA-256 intrinsics under hostile
  prototype replacement.

## Parallel review and defects closed

Three independent work lanes were used for the native connection session,
outer authority/receipt and adversarial tests. The integration review found
and closed:

1. mutable `String.prototype.charCodeAt`, `startsWith` and `slice` calls in
   parameter validation;
2. incomplete explicit terminal reader/source-read commitments in the receipt;
3. post-write parameter/result digest drift that could otherwise mint a
   receipt after complete DML;
4. mutable `Hash.prototype.update` and `digest` calls outside the structured
   poison boundary; and
5. authority snapshot omissions for logical/prepare/execute/affected counters.

No assertion, skip, timeout or production invariant was weakened to close
these findings.

## Executed evidence

- `corepack pnpm --filter @graph-engineering/sqlite typecheck` — passed after
  production integration and receipt commitment expansion.
- `corepack pnpm --filter @graph-engineering/sqlite lint` — passed.
- `corepack pnpm --filter @graph-engineering/sqlite exec vitest run test/cursor-publication-baseline-entries.test.ts --maxWorkers=1`
  — 19/19 passed after the pre-mint digest fix.
- Final four-file serial integration after captured-hash hardening: baseline
  entries, post-DDL reader, outer authority and connection — 104/104 passed,
  duration 94.00 seconds.
- Final complete SQLite package regression after all production and test edits:
  28/28 files, 962/962 tests, duration 302.87 seconds.
- Workspace typecheck and lint — all eight implementation packages passed.
- B3/ledger contract gates — 61/61 contract tests plus all validators passed;
  the frozen B3 registry remains 145 hostile records with
  `implementationClaim: false` and `activeManifestClaim: false`.
- SQLite migration release gate — source/mirror digest checks and 6/6 release
  tests passed.
- npm package contents — all eight package tarballs passed.
- packed-install smoke — all eight tarballs installed and exposed healthy bins.
- `git diff --check` — passed throughout integration.
- Master-plan pre-append prefix: 14,695 lines, SHA-256
  `e54ea6e2fe71555fbf089fbec1df0c15143a3e29fcd9e78df0b07f86d58ce27c`.
  The same first 14,695 lines retained that digest after section 31.37.31 was
  appended at true EOF.

## Hostile coverage

The dedicated suite covers successful E=12 publication, exact SQL/hash,
strict 12-by-7 digest framing, continuous entry hashes, no second TEMP read,
prepare failure, six-row partial failure, affected-count drift, complete-write
parameter/result digest faults, captured native/string/hash intrinsics,
transaction noninterference, receipt clone/Proxy/wrong-run rejection, replay,
wrong fence/reader, failed reader close, rollback/rebegin lineage and
unexplained write-watermark drift. The final focused suite is 20/20 and also
replaces the real `Hash` prototype after terminal-reader construction, proving
both publication and receipt assertion use captured update/digest intrinsics
with zero hostile method calls.

## Final review result

Independent static review after all fixes is HIGH 0 / MEDIUM 0 / LOW 0. The
review checked terminal private-row provenance, exact SQL/hash commitments,
one-prepare/E-run ownership, real partial ledger progress, pre-mint digest
verification, replay and wrong-graph behavior, captured mutable intrinsics and
structured poison/error boundaries.

## Honest remaining work

The next ordered leaf is the baseline-header publication receipt. Sequence
zero, atomic adoption of all four receipts, Python parity, the complete B3
hostile/parity campaign, publication session, cursor rules 11/12, retirement,
commit/reopen matrix, manifest activation and release gates remain incomplete.
GitHub star counts are an adoption target, not an implementation result or a
guarantee.
