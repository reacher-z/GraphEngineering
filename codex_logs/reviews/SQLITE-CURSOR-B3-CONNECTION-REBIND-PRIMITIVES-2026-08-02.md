# SQLite Cursor B3 Connection Rebind Primitives Acceptance

Date: 2026-08-02 PDT

Branch: `feat/authoring-foundation`

Parent commit: `ebb24ab5d8d0b0ce13ca07b849c7d5df718b8ac0`

Milestone type: private TypeScript and Python connection primitives, Wave 1A/1B

## Outcome

Both runtimes now own a package-private connection primitive for the fixed
cursor publication rebind leaf. Each implementation binds one opaque execution
to one exact live `BEGIN EXCLUSIVE` connection owner, freezes the accepted SQL
and positional parameters at definition time, executes the native update once,
retires the native statement/cursor once, obtains an independent `changes()`
observation and preserves a private cursor ledger of `1/1/N`.

This is an isolated connection-layer milestone. It deliberately does not yet
consume the publication session or mint Rule 11, Rule 12, third-clock,
cursor-clock, TEMP-retirement, lineage-publication, commit or manifest
activation authority.

## Implemented TypeScript surface

The internal TypeScript connection module now provides:

- `beginSQLiteConnectionCursorRebindExecutionIntrinsic`;
- `executeSQLiteConnectionCursorRebindIntrinsic`;
- `releaseSQLiteConnectionCursorRebindExecutionIntrinsic` for deterministic
  prepared cancellation cleanup; and
- `readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic`.

The execution handle has a null prototype, no public keys and a WeakMap-backed
exact-owner state. It cannot be cloned, substituted across connections,
executed after release, released twice or reused after completion/poison. The
owned native statement never crosses the module boundary. Logical release is
recorded exactly once even though Node's `StatementSync` has no synthetic
finalize operation.

Definition-time captures protect database prepare, statement run and statement
get from post-import prototype replacement. The fixed update and independent
changes query use exact SHA-256 identities and the four accepted positional
parameters. Native run count, `changes()`, `total_changes` and the private
cursor ledger are observed independently and must agree before completion.

A package-private one-shot fault seam proves that cleanup counter failure does
not replace the authoritative execution/result/count disagreement primary. It
is absent from the package root and clears itself before raising. Isolated
`--expose-gc` coverage proves completed and prepared-cancellation graphs are
collectible.

## Implemented Python surface

The Python source owner now provides matching private prepare, execute, release,
changes-proof and immutable snapshot operations. The execution registry uses a
weak reference plus callback-reference comparison, avoiding both a value-to-key
cycle and stale callback deletion after an object-ID reuse surrogate.

The source records native cursor rowcount and aggregate `total_changes`
separately immediately after the update. It then closes the rebind cursor,
executes and closes the independent `SELECT changes()` cursor, and only after
that validates the final aggregate delta. This ordering preserves the frozen
changes lifecycle and matches TypeScript.

The trigger-amplification regression demonstrates the distinction explicitly:
native rowcount and `changes()` are `1`, aggregate delta is `2`, the cursor
ledger remains `1/1/1`, changes prepare/fetch/release is `1/1/1`, and the owner
becomes terminally poisoned only at the final disagreement boundary.

Same-value inputs poison before any native update and the same execution cannot
be retried. Counter faults at both the entry and tail of the changes proof also
poison before rethrowing the original error. A later retry is rejected. Primary
rowcount/shape failures survive hostile cleanup and recovery-counter failures.

## Independent review corrections

Review was iterative and all findings were closed before acceptance:

1. The first TypeScript review found no prepared-cancellation release path.
   An explicit release intrinsic and terminal double-release/execute-after-
   release tests were added.
2. The TypeScript evidence review found primary-versus-cleanup precedence was
   only statically visible. A real one-shot cleanup fault path and trigger
   disagreement test now execute that ordering.
3. The first Python review found SQL identity could be rebound after prepare and
   a cleanup read could replace the primary. Both identities are now frozen in
   execution state and cleanup is best effort behind the original exception.
4. The next Python review found same-value rejection left the token reusable and
   trigger writes confused aggregate delta with native rowcount. Same-value is
   terminal; native affected, changes and aggregate counters are independent.
5. The next review found entry/tail changes-counter exceptions could leave a
   released execution retryable. Both boundaries now poison before rethrow and
   fault-at-entry/fault-at-tail tests prove no retry.
6. The cross-runtime review found Python detected trigger aggregate drift before
   release and `changes()`, while the frozen lifecycle required the final check
   afterward. Python now completes release and changes `1/1/1` before terminal
   aggregate comparison, matching TypeScript.

Three final independent read-only reviews reported H0/M0/L0.

## Frozen implementation identities

- TypeScript connection source SHA-256:
  `02f90cbb7d76c8aed7fb2ad3a387fd7c35cf40ca6e7f19d87cb178e0d4e4f609`
- TypeScript rebind contract source SHA-256:
  `7a51b2f3f5a68e1d0f92cc0b04b13b9bfc84636f95878c3ba9191b9f026de0f9`
- TypeScript focused test SHA-256:
  `3428c4a18983d01c7fbf7ba2d8f53c9328ec0dcb852ee3d8adb372e6efc1e521`
- Python connection source SHA-256:
  `8471c254e4474c0a699e168f5f88d9991313372686b372a5dfc76448c535ae9c`
- Python focused test SHA-256:
  `6398351dd2fadfabaf83812a30408ddb78a4f03f2dceda0b5d07278375a3fb89`

## Validation evidence

### Focused and static

- TypeScript cursor-rebind focused suite passed 14/14 under
  `NODE_OPTIONS=--expose-gc`.
- `@graph-engineering/sqlite` TypeScript typecheck passed.
- Python cursor-rebind source tests passed 20/20; the combined rebind and
  operation-baseline focused set passed 67/67.
- Ruff passed for the changed Python source and focused test.
- mypy passed for the changed Python source.
- Internal API privacy checks found no rebind or fault-seam export from the
  TypeScript package root or Python package initializer.

### Affected and contract gates

- The four affected TypeScript publication suites passed 40/40.
- The four affected Python publication suites passed 122/122 after the final
  connection-counter fault tests were added.
- Cursor publication contract parity passed 1/1.
- Fixture validation accepted 85 JSON fixtures and 44 case manifests.
- SQLite ledger contract tests and chained validators passed 66/66.
- Documentation validation checked 477 local Markdown links.
- `git diff --check` passed.

## Append-only plan proof

- Pre-Wave-1 plan prefix, first 19,595 lines:
  `59eca0449c37d0c4c8bff5b05c421bde076798974a20f9f1ced491e7fefe4013`
- Wave-1 execution-plan prefix, first 19,839 lines:
  `5a9eb685c5de79c737042095d6b75941b30691aedf1286f0081736f62be58a64`

Both prefixes match their recorded values. The acceptance checkpoint appended
after those prefixes does not modify any pre-existing plan byte.

## Explicit nonclaims and next leaf

This milestone does not claim the complete cursor subprotocol, real hostile
ordinal activation, runtime contract parity, release readiness, production
performance or any guaranteed GitHub star count. The attempted temporary third
clock authorization token was rejected during review and fully reverted; a real
third clock must consume a real Rule 12 receipt in the same integration wave.

The next implementation leaf is the real bounded Rule 12 connection proof and
receipt, followed by lower completion bridges. Only after a real Rule 12 owner
exists may the third clock be implemented. Publication-session consumption,
Rule 11, integrated orchestration, real hook evidence and manifest activation
remain later serialized waves.
