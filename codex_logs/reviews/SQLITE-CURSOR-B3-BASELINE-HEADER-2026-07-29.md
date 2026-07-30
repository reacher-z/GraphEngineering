# SQLite B3 baseline-header publication review — 2026-07-29

## Scope

TypeScript baseline-header permanent publication after the authentic entries
receipt. Sequence zero, receipt consumption/adoption, Python parity, cursor
rebind, commit and manifest activation remain out of scope.

## Delivered contract

- Exact fixed header INSERT SQL/SHA and fourteen-parameter order.
- Connection-owned captured-native one-prepare/one-run session.
- Exclusive lineage, private epoch and real `total_changes` fences.
- Header fields derived only from retained A2b source envelope, exact
  projection, fixed TypeScript runtime literals and canonical policy bytes.
- Strict one-by-fourteen tagged parameter digest and aggregate result digest.
- Independent digest verification before receipt registry mint.
- Exact entries predecessor, reader/fence/authority graph and reusable
  null-prototype header receipt.
- Real prepare/run/native-return partial progress and replay poison semantics.
- Structured poison boundary under database, statement, string and hash
  prototype replacement.

## Defects found and closed

Adversarial integration found that initial header code dynamically re-entered
pre-rebind provenance after a terminal reader, exposing an older mutable hash
dependency. The already validated source envelope is now retained privately in
the authority and reused by the header. Review also found dynamic header hash
calls and raw ordinary-error rethrows; all were replaced with captured
intrinsics plus translate-then-poison handling. A stale-lineage test initially
queried a v2 table after rolling back the DDL; the test was corrected to inspect
write counters and prepare non-entry instead of assuming rolled-back schema.

No production invariant, timeout, assertion or skip was weakened.

## Current evidence

- Header focused hostile tests: 19/19.
- Header plus entries focused regression: 39/39.
- SQLite package typecheck: passed.
- Complete SQLite regression: 29/29 files, 981/981 tests, duration 311.76
  seconds.
- Workspace typecheck and lint: all eight implementation packages passed.
- B3/ledger contract gates: 61/61 plus validators; the 145-record hostile
  registry remains frozen with implementation/active-manifest claims false.
- Migration release gates: exact source/mirror digests and 6/6 tests passed.
- npm package contents and packed-install smoke: eight/eight packages passed.
- `git diff --check`: passed.
- Append-only starting prefix: 14,892 lines with SHA-256
  `5c34ede9379797e0b1b9b70672fb7014c9b8b0ccd5dcb93aab37fc26580a88cf`.
- Independent final static audit: HIGH 0 / MEDIUM 0 / LOW 0 after closing
  structured owner/counter observation and exact `+1n` header epoch checks.

## Remaining nonclaims

The next leaf is exact operation-sequence-zero publication. Four-receipt
adoption, Python parity, publication session, cursor rebind, retirement,
commit/reopen and release remain incomplete. External adoption and star counts
remain targets, never guaranteed implementation evidence.
