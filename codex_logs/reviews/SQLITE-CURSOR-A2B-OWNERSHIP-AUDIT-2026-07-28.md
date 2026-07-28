# SQLite cursor A2b ownership receipt audit — 2026-07-28

## Verdict

Cursor A2b is accepted as a private, database-independent ownership primitive.
The final independent cross-runtime review reports HIGH 0 / MEDIUM 0 / LOW 0.
This verdict applies only to the files and evidence named below. It does not
complete the cursor campaign, migration, publication or the master plan.

## Audited files

- `packages/sqlite/src/operation-baseline-cursor-ownership.ts`
- `packages/sqlite/test/operation-baseline-cursor-ownership.test.ts`
- `python/src/graph_engineering/sqlite_operation_baseline_cursor_invariants.py`
- `python/src/graph_engineering/sqlite_operation_baseline_cursor_ownership.py`
- `python/tests/test_sqlite_operation_baseline_cursor_ownership.py`

Neither runtime exports the ownership module from its package entry point.

## Accepted protocol

The implementation freezes five NUL-terminated domains:

1. `graph-engineering/sqlite-cursor-ownership-contribution/v1\0`;
2. `graph-engineering/sqlite-cursor-capture-session/v1\0`;
3. `graph-engineering/sqlite-cursor-exact-projection/v1\0`;
4. `graph-engineering/sqlite-cursor-baseline-projection-reference/v1\0`;
5. `graph-engineering/sqlite-cursor-pre-rebind-receipt/v1\0`.

Every deterministic document root is
`SHA256(domain || u64be(canonicalUtf8Length) || canonicalUtf8)`. Ownership
contributions additionally bind the UTF-8 capability kind and exact copied
32-byte reference with explicit unsigned 64-bit lengths.

The physical main-table query is the exact eighteen-column projection from
`main.ge_cycle_cursors` in existing primary-key order:
`tenant_id COLLATE BINARY, token_hash COLLATE BINARY`. This is intentionally
different from the future TEMP seal order, which is token hash then tenant.
The normalized query SHA-256 is
`dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4`.
The four-field static cursor contract root is
`82bbb4c486590745fb6363151418bb8f50a1c56c4438c8b535b60f01fca7f8b9`.

An exact baseline projection reference commits the static contract plus the
actual frozen six-field baseline projection identity: baseline ID, entry count,
first and final entry hashes, legacy-operation count and projection SHA-256.
Both runtimes recompute the pre-existing baseline projection digest and reject
invalid identifiers, unsafe counts, legacy-count overflow and empty/nonempty
root inconsistency.

Four module-minted identity capabilities bind tenant, source stage, campaign
and connection. Their caller-supplied 32-byte references are copied before
hashing and never retained. A capture session binds the exact four capability
objects plus one copied 32-byte nonce. Equal bytes yield equal commitments but
new capability/session objects remain distinct and cannot substitute for the
objects expected by an issuer.

The final receipt document has exactly thirteen contributions in frozen
canonical order: four ownership commitments, capture-session root, three
source clocks, cursor count/root, exact projection-reference root and source
descriptor/schema identities. The nonce is not repeated in this document;
the capture-session root already commits it transitively.

Projection references and receipts are opaque objects. TypeScript WeakMaps and
Python identity-only WeakKeyDictionaries retain their provenance. A one-shot
issuer snapshots the exact expected object graph, validates a candidate
completely, constructs the receipt and records provenance before its final
non-throwing consumed-state assignment. Every rejected attempt leaves the
issuer usable. Every call after one success fails closed.

The package-private `assert(receipt)` fence takes the original receipt as its
sole caller input, rejects clones and returns a frozen witness containing the
exact retained source summary, clock evidence, A1 receipt, baseline projection,
projection reference, capture session and four ownership handles. It is
repeatable and non-consuming; A2b performs no lifecycle transition.

## Cross-runtime real vectors

Both runtimes independently create a real fresh-v1 SQLite source, capture its
summary, run the production baseline accumulator, run the production A1 cursor
decoder/sealer and then issue the A2b receipt. The independent audit repeated
the same stack. The accepted vectors are:

| Vector | A1 evidence | Receipt root |
|---|---|---|
| empty | count 0, root `587bd52db10d2d03c9f7b8bbcecee9c6f83d0c076b17846883e6885e10e2b47f` | `e63c0eed6c3cb3aee2f8d12e1562395ff577af4c4721b59397111cae6bc032ad` |
| one event | count 1, root `1445422fdd2e7e6f93458c6d5e4cf35c53ebac8596cf117595c1f926086681ea` | `cb710d7ec15c2e5c729ee813d5f0b03dcfdf795203df8a4ecf5a174b063743f6` |
| event + checkpoint | count 2, root `3ee9a67ea7d1d961af54178d1df8c3cdf32dddfd4d7c5dcae03aca31efad84d1` | `f0571ef81f6864bccc2bedbe81f586363bb3d8ca2ff38b3545f95bfbe808b6c7` |
| hostile MAX_SAFE fleet | count 1,024, root `2d9327dc17dadaf43c3643b853d38ea09e0e396d7005e553a5a5e88469b3857f` | `e319abeed2696190770ff3a54669afeb24eff4810dae6072cb3a8141766037fa` |

The real empty projection reference is
`2f512edf3ef9899fc109d415a2d392604f083257445ca43c2fab1aa29e06f615`.
Its thirteen-key receipt canonical JSON is 964 bytes. The source descriptor is
`4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe`
and the source schema identity is
`f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4`.

## Findings closed during review

The review intentionally rejected several earlier proposals before acceptance:

1. a token/tenant main-table query was corrected to tenant/token source order;
2. a static query reference was expanded to bind the actual baseline projection;
3. structurally cloneable evidence was replaced with exact object provenance;
4. the fence was changed to a receipt-only caller API with retained context;
5. caller-owned issuer input was replaced by a frozen descriptor snapshot;
6. Python source baseline-ID and cursor-empty-root checks were added;
7. TS and Python projection empty-root rules and baseline-ID grammar were aligned;
8. a TypeScript spread accidentally added `nonceSha256` as a fourteenth receipt
   field; it was removed and all roots were independently recomputed;
9. TypeScript initially injected A1 roots in vector tests; it now recomputes all
   four through the production decoder and seal accumulator;
10. non-enumerable extensions, accessor/proxy reads, mutable buffers, unsafe
    integers, equal-value clone substitutions and A/B mixed provenance received
    explicit hostile tests.

Claude Code 2.1.220 produced an isolated alternative implementation, but the
main audit rejected it because it used the wrong source ordering, did not bind
the actual baseline projection and represented ownership as reconstructable
scalars. None of that alternative was copied into the accepted implementation.

## Verification

- TypeScript A2b: 14/14.
- TypeScript A1/A2a/A2b adjacent: 48/48; the broader adjacent campaign reported
  280/280.
- TypeScript SQLite full: 18 files / 426 tests.
- TypeScript typecheck, lint and build: green.
- Python A2b: 25/25.
- Python A1/A2a/A2b/source/handoff: 131/131.
- Python full: 1,704/1,704.
- Python Ruff, scoped format and strict MyPy over 49 source files: green.
- Scoped diff checks: green.
- Independent final review: HIGH 0 / MEDIUM 0 / LOW 0.

## Explicit nonclaims

A2b executes no SQL, creates no TEMP object, reads no cursor table, performs no
rebind, changes no migration or permanent state, advances no stage, emits no
diagnostic and changes no registry implementation claim. It does not complete
rules one through ten, `pre-rebind-complete`, Slice B, migration `0002`, v2
publication, post-rebind rules eleven/twelve, `cursor/clock-complete`, scale or
crash/replay acceptance. It makes no release, adoption or star-count claim.
