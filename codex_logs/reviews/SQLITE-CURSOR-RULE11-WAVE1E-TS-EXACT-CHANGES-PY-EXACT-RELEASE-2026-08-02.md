# SQLite Cursor Rule 11 Wave 1E — TS exact changes / Python exact release

Date: 2026-08-02 PDT
Branch: `feat/authoring-foundation`

## Accepted increment

This increment closes two bounded Wave 1E gaps without claiming the wave complete.

1. TypeScript cursor-rebind `changes()` proof now uses a definition-time captured
   `StatementSync.prototype.all` and accepts only an exact one-row, one-column,
   safe-bigint result equal to the native affected count.
2. Python now has an exact-session to exact-execution pre-consume release-failure
   seam, bound to authentic graph authority, connection, prepared owner, context,
   and execution identities.

Both implementations fail closed, retire their selected resources once, preserve
primary-error precedence, and avoid minting post-consume evidence on the injected
pre-consume failure path.

## Security and lifecycle properties

- TypeScript rejects proxy, subclass, sparse, accessor, extra-key, zero-row,
  two-row, wrong-type, negative, unsafe and native-mismatch results.
- TypeScript captures `Array.isArray`, `Array.prototype`, `Number`, the bigint
  safe-integer bound and `StatementSync.prototype.all` before hostile rebinding.
- Python upper and lower fault registries use weak keys and weak error values.
- Arbitrary exception back-references cannot root S, E, authority, connection or
  the graph through a registry value.
- Dead errors are exact-discarded; upper cleanup leaves the same S retryable,
  while lower selected release closes once and poisons E.
- Registration failure removes partial exact entries at both layers.
- The selected release primary wins over simultaneous second-boundary
  cancellation and over a real cursor-close secondary.

## Verification

- TS connection suite: 37/37 passed (77.42s).
- TS package typecheck: passed.
- Python lower full: 40/40 passed (2.40s).
- Python composite full: 40/40 passed (150.19s).
- Python seam targets: lower 5/5, upper 8/8, reverse-root 2/2.
- Ruff: passed.
- mypy on four Python files: passed.
- Cross-runtime Rule 11 parity: 3/3 passed; real dual-runtime case 54.52s.
- `git diff --check`: passed.
- Independent TS audit: H0/M0/L0.
- Independent Python final weak-error audit: H0/M0/L0.

## Frozen file identities

- `packages/sqlite/src/sqlite-connection.ts` —
  `ef769cdeb7c6b38cb98c2dca386662c549726cf5b07c074b3ef758bcce6ff13f`
- `packages/sqlite/test/cursor-publication-rebind-connection.test.ts` —
  `ac98cd0c41e1147863a5833d0f64a3d4b34de2257d597a39334cf4f73fa68097`
- `python/src/graph_engineering/sqlite_operation_baseline_source.py` —
  `d937f2fd90925599d7b68ed89ca71f9bf4b8d1c7505eefad55994d31429c397e`
- `python/src/graph_engineering/sqlite_cursor_publication_subprotocol.py` —
  `3c6c2a1ade23a9441ee21b937a2cd6eb31a09c8eb95c91c0595f5f92a2ca2925`
- `python/tests/test_sqlite_cursor_publication_rebind_source.py` —
  `76edb3d8f704fbbc4d04048bc3c97b793d0254593931ac3f0cd355d26d3e873b`
- `python/tests/test_sqlite_cursor_publication_subprotocol.py` —
  `565f510c6e91ae5b9df5bc65865efedcf868f7cc56be28c8fa48a6102a47a5f2`

All six files are mode 0644.

## Strict nonclaims

Wave 1E remains open. TypeScript exact-E pre-consume release, complete native
affected hostile matrices, B2 and ledger single-field drift, transaction-owner
rollback/close precedence, Python bounded real-id-reuse evidence, Rule 12 and the
third clock remain future work. GitHub star targets remain adoption goals, not a
property guaranteed by tests or code completion.
