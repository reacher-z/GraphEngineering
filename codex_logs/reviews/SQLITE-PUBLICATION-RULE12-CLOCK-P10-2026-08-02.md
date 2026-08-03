# SQLite publication Rule 12 and third-clock P10 review

Status: accepted bounded implementation; immutable implementation commit
evidence is recorded by the subsequent registry/evidence commit.

Date: 2026-08-02/03 PDT

Immutable implementation commit:
`e8e2598fa78e11427684be727c4198f6ce2ba02b` (author and committer
`reacher-z <mtrxcop@gmail.com>`, no co-author). Local, tracking, and remote
branch SHAs were verified identical after push.

## Accepted scope under review

This review covers exactly one bounded package-private transition:

```text
exact live Rule 11 owner
  -> bounded Rule 12 main/TEMP seal acceptance
  -> exact opaque Rule 12 receipt
  -> authenticated before-verification clock observation
  -> retained unconsumed third evidence (observed/consumed = 3/2)
```

It does not consume the third receipt, mint cursor-clock capability, complete
the cursor/clock graph, retire TEMP objects, observe the fourth clock, mint a
final fence, authorize or execute COMMIT, reopen as complete-v2, export a
public API, activate a manifest, close release evidence, or establish a star
outcome.

The existing P9 transaction owner remains an independently verified bounded
component. The selected P10 test graph begins from the older exact exclusive
transaction chain and does not yet retain the P9 owner/begin receipt. That
end-to-end composition requires explicit phase-bound mutation scopes across
the earlier B2 and permanent-write stages; it is recorded as P11 and is not
claimed here.

## Rejected-first history

Independent review rejected multiple green intermediate implementations. The
following issues were fixed before this candidate could enter final gates:

1. A module-local used set attempted to impersonate consumption of the real
   Rule 11 owner. Rule 11 now transitions in its retained subprotocol state:
   `active -> rule12-pending -> rule12-complete | poisoned`.
2. Constant SQL names/hashes and projected Boolean fields were presented as
   executed EQP/blob evidence. The final implementation runs three real SQLite
   EQP probes, retains their normalized detail/digests, and rejects sorter or
   non-point plans before rebind UPDATE.
3. Generic third-clock access could bypass Rule 12 authorization and generic
   consume/fourth routes did not enforce the P10 boundary. The third wrapper
   now opens a private exact receipt/capability/predecessor authorization only
   around one provider observation; consume remains disabled and a premature
   fourth attempt poisons the selected P10 graph without presenting COMMIT.
4. Rule 12 cancellation initially lacked a final post-comparison observation,
   especially for N=0. Both runtimes now test N=0/1/3 after complete count,
   root, target identity and seal validation, before receipt mint.
5. Cancellation could mask stale authority, live-lock, catalog, lineage, or
   retained EQP corruption. Both runtimes now perform provider-free current
   entry proof before the first cancellation observation and test combined
   drift plus already-cancelled cases.
6. Provider `BaseException`/throw cleanup, third authorization cleanup, and
   partially registered third evidence were incomplete. Failure now clears
   authorization/observing state, poisons the clock and selected graph, erases
   partial generic evidence/bindings, and preserves the original primary.
7. Registration and adoption fault tests covered the Rule 12 receipt but not
   the three stateful third-tail points. Both runtimes now inject and reject
   evidence-binding, outer-adoption, and selected-owner-binding faults and
   prove captured partial evidence unreadable.
8. Python weak registries temporarily retained dead weak entries between
   tests, and CPython ID reuse was an honest skip instead of deterministic
   evidence. Production paths now purge dead entries; tests force identity
   collisions and delayed stale callbacks to prove an old callback cannot
   delete a new exact identity. Focused Python evidence has zero skips.
9. Python EQP used mutable live aliases and cleanup could replace a fetch or
   validation primary. Definition-time defaults, hostile alias/prototype tests,
   real bad sorter/point plans, and primary-over-close cleanup are now covered.
10. The first portable reporter hard-coded successful phase and failure codes,
    and could report a named failure even if no exception occurred. It now
    reads real runtime snapshots, requires exact native failures, maps only
    verified native codes, and has a negative self-integrity test.
11. The first TypeScript parity test never launched Python. The final test
    starts the real Python reporter twice, checks process status/signal/stderr,
    single-line canonical JSON and byte determinism, removes only the explicit
    runtime label, then requires direct ordered JSON byte equality. A dedicated
    CI command fails closed when uv is unavailable.
12. An affected session regression still expected an unauthenticated direct
    third boundary. The test was reconciled to the new Rule12-only authority:
    the unauthenticated call rejects without advancing the head, and the same
    session can still publish normally. The implementation was not weakened.

## Native TypeScript evidence

The TypeScript candidate includes package-private Rule 12 state, the true
Rule 11 bridge, retained outer phases, exact third-clock ownership, three
third-tail fault points, cancellation/cleanup seams, privacy checks and an
isolated forced-GC probe.

Verified results so far:

- SQLite package typecheck: passed;
- dedicated Rule 12/third-clock hostile suite: 29/29 passed;
- four-file Rule12/clock/rebind/read affected suite before the final precedence
  delta: 106/106 passed;
- corrected session regression using fork pool: 12/12 passed;
- transaction-owner affected regression using fork pool: 26 passed, one
  existing conditional skip;
- package diff check: passed.

## Native Python evidence

The Python candidate includes an opaque Rule 12 owner, exact-object/weak
registries, true Rule 11 lifecycle integration, real 3-EQP pre-UPDATE proof,
current entry precedence, exact third authorization and cleanup, deterministic
identity-collision tests, and a normalized real-SQLite reporter.

Main-thread verified results:

- full P10 focused file: 41/41 passed in 202.81 seconds, zero skips;
- Ruff across changed implementation, tests and reporter: passed;
- mypy across source/lower, clock, Rule 12 and third wrapper: zero issues;
- Python diff check: passed.

## Cross-runtime evidence

The portable case order is frozen as:

1. `success-0`;
2. `success-1`;
3. `success-3`;
4. `replay`;
5. `cancel`;
6. `provider`.

Success cases carry the real Rule ID/position, B2/main/driver/lookup/accumulator
counts, computed root and equality to the retained receipt, actual
`pre-verification-clock-read-unconsumed` phase, boundary/head/consumed facts,
and `commitPresented=false`. Failure cases require an actual runtime failure,
selected-graph poison, no third readable result, and no COMMIT presentation.

Main-thread required parity run: 2/2 passed in 68.81 seconds. Python reporter
executed twice with byte-identical single-line canonical output; portable
ordered JSON matched TypeScript after removing only `implementation`.

## Final gate and independent disposition

The complete SQLite Vitest suite ran with fork pool and one worker after the
final session-test correction:

- 46 files passed and 2 conditional files skipped;
- 1,288 tests passed and 3 conditional tests skipped;
- 0 tests failed;
- duration 883.89 seconds.

The independent reviewer re-read the frozen TypeScript/Python sources, tests,
reporters, CI/package gates, spec, review record and explicit P11 composition
nonclaim. Final disposition: **ACCEPT — H0/M0/L0**. The session correction
changed only the stale test; the Rule12-only authorization was not weakened.

P10 is accepted only as Rule 12 plus the retained unconsumed third clock at
3/2. The P9 owner/BEGIN composition gap remains assigned to P11. No third
consume, fourth clock, final fence, COMMIT, complete-v2, public API, release or
star claim follows from this acceptance.

Even after P10 acceptance, release evidence remains audit-only with no selected
candidate and 0/93 release weight.
