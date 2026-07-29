# SQLite B3 post-DDL physical-catalog fence review — 2026-07-29

## Outcome

This batch implements the package-private fence immediately after authentic
migration 0002 execution. The fence is minted once, can be presented repeatedly
inside its exact live authority graph, consumes no write receipt and makes no
permanent write. It is intentionally not a final v2 semantic proof.

Baseline commit: `a30502ccd0284f1dcae7fdb2dab828eabade62bd`

## Authority and catalog closure

Mint input is limited to the exact outer publication authority and its exact
0002 catalog-rebuild receipt. Receipt presentation is authenticated before any
live SQLite read, so a forged or cross-run receipt is rejected without changing
the healthy graph. Early mint and second mint remain invariant violations.

The mint function proves exact equality with the receipt-after epoch,
`total_changes` and all three outer-ledger dimensions. It then calls the
connection-owned validated catalog reader itself. No caller catalog snapshot,
digest, inventory, connection or ledger value is accepted.

The fence binds the exact lower-case owned-prefix catalog query and query hash,
34-entry ordered inventory, 5,785 canonical bytes, target digest, application
ID, user version, authority/receipt/connection identities, transaction lineage,
epoch, counter and ledger watermarks. The token is frozen, null-prototype and
WeakMap-authenticated.

Every exact assertion performs another fresh catalog read. It accepts later
authorized progress only as non-regressing authority-owned watermarks; it never
accepts a reconstructed fence or stored catalog as fresh evidence.

## Error ordering and terminal states

Independent review found and closed three material issues:

1. Receipt identity was originally checked after live authority SQL. The gate
   now authenticates receipt provenance before live revalidation, preserving
   presentation rejection without poisoning a healthy graph.
2. Repeated post-retirement presentation could change `retired` to `poisoned`.
   Poison and retire helpers are now terminal-idempotent, and a regression test
   proves lifecycle monotonicity.
3. Target-catalog iterator close error could outrank later metadata/catalog
   corruption. The reader now defers cleanup error through metadata, snapshot
   construction and complete expected-catalog validation. Row/fetch primary
   still outranks cleanup, and close is attempted exactly once.

The close-path test exposed a fourth real driver boundary: owner snapshot read
`DatabaseSync.isTransaction` before checking whether the database was closed,
which leaked a raw native error. Owner snapshot now checks open state first and
returns structured `GE_CYCLE_STORE_UNAVAILABLE`; the authority then becomes
terminally poisoned.

## Hostile evidence

Focused tests cover:

- success with `L=2` and unchanged 1/20/3 outer ledger;
- repeated exact assertion with mint count one;
- exact query, query hash, domain, inventory, lineage, epoch and counter fields;
- forged and cross-run receipt presentation plus corrected retry;
- forged, structural clone, Proxy, revoked Proxy and cross-run fence attacks;
- early and repeated mint poisoning before new SQL;
- old fence rejection after second-mint poison;
- rollback/rebegin and repeated post-retirement presentation;
- closed connection classification and terminal replay;
- live catalog/epoch drift poisoning; and
- independent spies proving mint and assertion each invoke the fresh validated
  catalog reader and poison if that reader fails.

## Verification

Current focused acceptance after all fixes:

- SQLite typecheck: passed;
- authority + target-catalog + migration + connection: 4 files, 78/78;
- `git diff --check`: passed;
- final runtime-topology audit: H=0/M=0;
- final adversarial/provenance audit: H=0/M=0; and
- final fixture/scope audit: H=0/M=0.

Final uncontended acceptance:

- complete SQLite package: 26 files, 907/907;
- workspace typecheck: all eight implementation packages passed;
- workspace lint: all eight implementation packages passed;
- frozen SQLite ledger/B3 suite: 61/61 plus every validator;
- B3 `implementationClaim: false` and `activeManifestClaim: false` retained;
- append-only plan preservation: the previously committed 14,407 lines remain
  SHA-256
  `780200c002fa8ac305d767c1132d96cb96ad697b25fb16eb931fc4d60a06c3e9`;
  and
- final `git diff --check`: passed.

The batch is accepted from the full gate set, not from focused tests alone.

## Nonclaims and next leaf

The implementation does not mint the post-DDL publication reader lease, read
the TEMP projection, publish baseline rows/header/sequence zero, consume any
receipt, adopt stage authority, rebind cursors, execute rules 11/12, retire TEMP
objects, commit, activate manifest v2 or implement Python parity.

The next dependency leaf is the independent reader lease and terminal proof.
It must bind this exact fence, stage and projection; open at most one fixed
ordered TEMP reader; close exactly once; make cleanup precedence explicit; and
be terminally closed before stage adoption.
