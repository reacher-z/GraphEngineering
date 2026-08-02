# SQLite Cursor B3 Post-Rebind Seal Evidence Acceptance

Date: 2026-08-02 PDT

Branch: `feat/authoring-foundation`

Parent commit: `efcd84ee8e4e83085280f1a739d0b3a97c58cdac`

Milestone type: private TypeScript and Python connection evidence, Wave 1C

## Outcome

TypeScript and Python now execute the frozen post-rebind cursor-seal read on the
same live exclusive connection that completed the cursor rebind. Both runtimes
perform a bounded main-key scan, a separately ordered TEMP driver scan and one
exact point lookup per driver key. The physical row is decoded and appended to
the existing constant-space immutable-seal accumulator without allowing raw
rows, decoded carriers, statements or cursors to escape the connection owner.

This milestone returns raw connection evidence only. It does not compare the
result with the retained B2 receipt, does not consume the publication session,
does not execute Rule 11 or the upper Rule 12 gate, does not mint a Rule 12
success receipt and cannot authorize the third provider clock.

## Frozen SQL and topology

The two runtimes use byte-identical fixed SQL and SHA-256 identities:

1. main key scan, ordered by `tenant_id, token_hash`:
   `09d1ce669070093fbbf0dfd8ce7e2a7bbfde96d051b3ce9341be85495479ec32`;
2. TEMP key driver, ordered by `token_hash, tenant_id`:
   `1694ab6fe938203b0d8f6cb72cf82238e89234c21086ff5d224c7de4db7b1266`;
3. exact 18-column main point lookup with `LIMIT 1`:
   `bd056ee55f2bd27eee3277ed7bfee8ae7b7db935edc3cf0937fc8167e2eac342`.

Successful execution proves main prepare/terminal-fetch/close `1/1/1`, driver
prepare/terminal-fetch/close `1/1/1`, logical reusable point owner
prepare/execute/release `1/N/1`, point cursor create/close `N/N`, lookup and
accumulator counts `N`, and equality with the main and driver counts. Point
lookup performs exactly one fetch and never spends a terminal-fetch budget.

The current/max resource budgets are enforced as follows:

- successful current active cursors, physical rows and carriers are `0/0/0`;
- maximum active cursors is at most two;
- maximum live physical rows is at most one;
- maximum live decoded carriers is at most one;
- main ownership is fully retired before driver preparation;
- a point cursor closes before the next driver fetch; and
- the point statement is logically retired before the driver cursor closes.

The zero-row path still constructs a real zero-identity accumulator, calls
`finish()` and verifies the canonical empty root. It does not use a shortcut
constant as computed evidence.

## TypeScript ownership

The TypeScript connection owns an opaque scan execution and all six nullable
native ownership slots: main statement/iterator, driver statement/iterator and
point statement/iterator. The public package-internal generic read kind excludes
the three seal SQL routes; a runtime cast to the generic helper is also rejected.
The facade never imports or receives `StatementSync`, a native iterator, a raw
row, the row decoder or the accumulator.

All fixed SQL, iteration, key validation, decode, accumulation, ordering and
budget enforcement occurs inside `sqlite-connection.ts`. Native handles are
cleared only after the corresponding native return succeeds. A close failure
therefore leaves an honest retained-owner snapshot. Explicit poisoned dispose
retries point, driver and main handles in that order, increments a second real
close attempt, preserves the first error and clears ownership only on success.

Cleanup precedence uses an explicit `{hasPrimary, value}` record. A legal
JavaScript `throw undefined` is therefore still a real terminal primary and
cannot be mistaken for the absence of an error. Directly used `Math.max` is
captured at module definition time. Database prepare, statement iterate and the
native iterator next/return methods are also definition-time captures.

The outer opaque read binds the exact completed connection rebind, connection,
transaction lineage, transaction epoch and total-changes watermark. A WeakMap
tombstone makes one rebind usable for at most one seal-read begin. Forged,
proxied, cross-connection, second-begin, second-execute and release/reuse paths
are rejected.

The isolated `--expose-gc` probe exercises two separate graphs: one completed
seal execution and one unexecuted released execution. After graph disposal and
dropping strong references, all six tracked seal/rebind/connection objects are
collected within the bounded probe. This proves the facade and scan WeakMaps do
not retain either terminal graph.

## Python ownership

The Python connection owner uses definition-time captured SQLite descriptors
and methods, a weak/id registry with callback-reference exact comparison, and an
opaque exact-owner execution. Begin accepts only the exact completed rebind and
is single-use through the rebind state's private begin counter.

One `_CursorSealReadPointStatementOwner` freezes the point SQL, connection and
execution lifecycle. It executes N real connection-bound point cursors and is
released once only after its active cursor is gone. Main, driver and point
cursor references remain in execution state until successful close or recovery.
Attempt and success counts are separate; a failed normal close followed by a
successful recovery reports two attempts and one success, while a double close
failure truthfully retains one active cursor and reports zero success.

The root is assigned to state only after all counts, resources and a final
lineage/total-changes proof succeed. Every exception clears it, and non-completed
snapshots disclose `None`. Decode failure never enters the carrier gauge. The
execution entry revalidates all three state SQL strings and hashes but executes
only definition-time literals, preventing prepared-state SQL drift.

The Python focused suite contains a test-side one-row SHA chain implemented
with independent `hashlib` and canonical JSON construction; it does not call the
production decoder or accumulator. Same-length BLOB substitution changes the
computed raw root in both runtimes.

## Review corrections

Iterative independent review closed the following findings before acceptance:

1. the first TypeScript draft performed orchestration outside the connection
   and received naked statements/iterators;
2. raw row/callback boundaries could not prove carrier lifetime;
3. close failures discarded real iterator ownership and had no recovery path;
4. recovery attempts were not separately counted;
5. `undefined` was incorrectly usable as both a thrown primary and no-error
   sentinel;
6. mutable `Math.max` could falsify resource watermarks;
7. definition-time iterator next/return and same-transaction total drift lacked
   executable tests;
8. the first GC probe covered release but was incorrectly named as completed;
9. Python initially counted a logical point statement without an enforcing
   owner, disclosed a locally computed root after late failure and lacked an
   independent root oracle; and
10. a pre-existing WeakKeyDictionary test took its exact baseline before
    clearing unrelated unreachable keys, causing one full affected run to fail
    673/674 when GC removed a stale witness. The baseline now runs `gc.collect()`
    first; its entire 13-test file and the isolated failing case pass.

Final independent audits reported TypeScript H0/M0/L0, Python H0/M0/L0 and
cross-runtime H0/M0/L0.

## Validation evidence

- TypeScript Rule12-read focused: 22/22;
- TypeScript rebind regression combined with Rule12-read: 36/36;
- TypeScript isolated completed/released GC probe: 1/1;
- TypeScript affected cursor-publication suites: 248/248 across 15 files;
- `@graph-engineering/sqlite` typecheck: passed;
- a full-package TypeScript run encountered one pre-existing concurrent
  reservation-retry timing failure; that exact test passed 1/1 immediately in
  isolation, while the 248 affected publication tests remained green;
- Python seal-read/rebind/baseline focused: 83/83;
- Python source-fence file after deterministic weak-registry baseline fix: 13/13;
- Python affected debug-memory campaign: 673/674 before the unrelated weak-key
  baseline fix; the sole failing case then passed isolated and its full file
  passed 13/13 after the fix;
- Ruff on changed Python source/tests: passed;
- mypy on the changed Python source and seal test: passed;
- cursor publication contract parity: 1/1;
- fixture validation: 85 JSON fixtures and 44 case manifests;
- SQLite ledger contract and chained validators: 66/66;
- documentation links: 477;
- `git diff --check`: passed; and
- all new files have mode `0644`.

## Frozen implementation identities

- TypeScript rebind/read SQL contract:
  `9aa3625e4ff85be40f1e9cf6cf56878f119c635af2402b3313be30dd1986c2ec`;
- TypeScript connection owner:
  `1ac835d5044d26d77359a404927ab3dd5eaf963c3dee4cb45110af4b9f801540`;
- TypeScript read facade:
  `42a5d14b9749110030c15a7eaedfc4a201aa1b79471b5633e8cf5da57432ef84`;
- TypeScript focused test:
  `ea9df34e6fe086ccce1015c71d054488e0761f1e0b15ac3de52f65aa7322292e`;
- TypeScript GC probe:
  `5b52456dc798919a473620a7629ed6c992ae1e6ae94b61c482af13ebe5c148a4`;
- Python connection owner:
  `890acd70bf6301077091c00aace93b24087b7ab5737bb1531303ef93412e5125`;
- Python focused test:
  `2f9eb79aef87e8388d35c2c7ce6252a2d3883c79d5874a64a32de2592317ee18`;
- deterministic source-fence test:
  `5e098d191226a89b3eeeb2ee963d5db19a5e7ed0438d8e30e318fa6a9e1caedd`.

## Explicit nonclaims and next boundary

This acceptance is intentionally connection-only. EQP acceptance, retained B2
expected count/root comparison, target descriptor/schema comparison, exact
publication-session consumption, Rule 11, the true Rule 12 receipt, third clock,
lower completion continuations, hostile runtime hook activation, manifest
activation, artifact release and GitHub-star outcomes remain incomplete.

The next serialized leaf is the exact session-consumption and cursor-rebind
write-receipt bridge. It must adopt the authentic post-rebind epoch/total
watermarks without weakening or rewriting the historical initial-adoption
receipt, compare the five Rule 11 counts with zero SQL, and mint an opaque
single-use Rule 11 predecessor before the upper Rule 12 verifier can begin.
