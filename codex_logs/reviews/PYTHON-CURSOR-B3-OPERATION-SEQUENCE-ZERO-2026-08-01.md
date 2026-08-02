# Python cursor B3 operation-sequence-zero review — 2026-08-01

## Scope

This record covers the fourth and final initial-write receipt in Python:
publication of singleton operation-sequence zero after the exact baseline
header receipt. The candidate is frozen and has passed focused, serial,
cross-runtime, static/type and independent audit gates. The complete Python
regression is running and is not claimed before its terminal result.

The leaf does not consume the four initial-write receipts, adopt the TEMP
stage, create a publication session, rebind cursors, retire TEMP state, commit
the caller transaction or activate a manifest.

## Frozen bytes

- source SHA-256:
  `b96bb38c50a36b1ce73cacfa5e36e6e99510017b312ee52895c322faff9e7a52`;
- outer authority SHA-256:
  `cc22b3cf2f30e132aa60521db7baf01c056a3cc870e14c7816fce3af274a2ffb`;
- direct source test SHA-256:
  `dd28255c8e7277753269fd643cb4fb086b331514e38718f19eaad7f92db2ac59`;
- outer hostile test SHA-256:
  `572e48950295486336ff2077ce552e9eab594a9614304d47ca3de2b0d8395bcf`.

The two dedicated test files contain 1,901 lines and 84 collected cases.

## Exact source session

The only new SQL is the exact 154-byte INSERT into
`main.ge_cycle_operation_sequence`, with SHA-256
`a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85`.
It fixes singleton one and last commit sequence zero in SQL and binds exactly
baseline ID, baseline capture time and updated time.

The source execution is opaque, weakly registered, exact-lineage and one-run.
Python prepare count denotes one cursor/session reservation, not native
prepare-only compilation. Native return advances completed/affected/epoch
state before result/counter inspection. Every terminal path closes exactly
once and clears the cursor; primary failure precedence is preserved.

The exact source SQL and SHA are captured at definition time. Begin verifies
the definition-time pair before cursor allocation. Execute freshly compares
the session record pair and the independent captured pair before any attempt,
epoch or native call, and native execute consumes only definition-time SQL.
Late public/private alias rebinding and session SQL-only or paired SQL/SHA drift
cannot redirect the statement.

## Clock, frame and ledger

The outer writer authenticates the exact reusable, non-consuming header
receipt. It re-reads the retained provider clock evidence/value instead of
trusting caller time, wall clock, environment or a cached receipt snapshot.
`updated_at_ms` must be greater than or equal to baseline capture time; the
earlier-time branch is distinct and poisons before prepare.

Two independent callables rebuild the exact `1 x 3` tagged frame and result
digest. The source and outer SQL commitments are independently definition-time
captured. Preflight, mint and receipt assertion fresh-check the canonical pair;
paired SQL/SHA/global-getter rebinding cannot mint a false SQL receipt.

The phase transition is
`baseline-header-complete -> executing-sequence-zero -> sequence-zero-complete`.
For the control graph the outer ledger moves from `3/33/15` to `4/34/16`,
exactly logical/fixed/affected `+1/+1/+1`. Physical native completion followed
by result, counter, digest or cleanup failure retains the real one-row progress
but mints no receipt and leaves logical sequence three.

## Receipt

The opaque snapshot has exactly 34 fields in the order frozen by plan section
31.37.49.7. It binds both earlier write receipts, migration/fence/reader graph,
projection identity/reference, exact clock evidence and value, SQL/SHA,
parameter order/digest, result digest, epoch/counter deltas, ledger transition,
capture/update time and write kind.

The receipt record stores scalar/identity commitments and required weak graph
edges without retaining connection, projection, cursor, snapshot, exception or
traceback strongly. Receipt assertion is reusable and non-consuming, rejects
phase or ledger regression, and accepts only the explicitly authorized later
adoption phase. Publication/execution replay, clone, cross-run presentation and
record tamper reject.

## Hostile defects found and closed

1. Source initially read a mutable module SQL global at execute, allowing a
   late three-parameter UPDATE to return success while no sequence row existed.
   Definition-time capture closed the redirect.
2. The source session record SQL/SHA could be internally drifted between begin
   and execute. Fresh record/captured checks plus captured-only native execute
   now reject SQL-only and paired drift before any native call.
3. Outer initially treated a mutable paired SQL/SHA as canonical, allowing a
   receipt to claim hostile SQL even while source executed the correct INSERT.
4. A first outer fix still looked up a mutable canonical getter. Definition-time
   default capture at every call site closes SQL/SHA/getter triple rebinding.
5. Receipt assertion accepted write-phase rollback. It now rejects regression
   and allows only current sequence completion or explicit adoption successor.
6. SQL identity failure initially collapsed into a generic predecessor poison
   reason. It now has the exact sequence-zero SQL identity reason before source
   begin.

All issues were dynamically reproduced before repair and dynamically disproved
on frozen bytes. Final source and outer audits are HIGH 0 / MEDIUM 0 / LOW 0.

## Executed evidence

- direct source hostile suite: 28/28 in 123.08 seconds;
- outer sequence-zero hostile suite: 56/56 in 247.76 seconds;
- combined focused count: 84/84;
- twelve-file serial B3 integration through sequence zero: 443/443 in
  1,435.22 seconds;
- TypeScript direct-source plus outer oracle: 39/39 in 24.71 seconds;
- Ruff and format: green on four changed Python files;
- mypy: zero issues across 99 source files;
- `py_compile` and `git diff --check`: green;
- source final audit: HIGH 0 / MEDIUM 0 / LOW 0; and
- outer/source/receipt final audit: HIGH 0 / MEDIUM 0 / LOW 0.

Repository-wide gates on the same frozen sequence candidate also passed:

- `corepack pnpm test:sqlite-ledger-contract`: 61/61 plus every strict
  validator, with 145 B3 hostile records, 25 counter profiles and 20 fault
  boundaries; implementation/active-manifest claims remain false;
- `corepack pnpm validate:fixtures`: 85 JSON fixtures and 44 case manifests;
- `corepack pnpm check:sqlite-migrations`: source/mirror closure and 6/6 tests;
- `corepack pnpm check:packages`: 9/9 manifests and dry-run tarballs; and
- `corepack pnpm check:packed-install`, serialized after package contents:
  9/9 tarballs installed and smoke-tested with healthy binaries.

The exact Python serial integration command named, in order, the source,
clock, target catalog, migration asset, migration execution, outer authority,
post-DDL fence, post-DDL reader, entries, header, direct sequence source and
outer sequence receipt files. The exact TypeScript oracle command named
`sqlite-connection-operation-sequence-zero-session.test.ts` and
`cursor-publication-operation-sequence-zero.test.ts`.

The complete Python regression passed **3,772/3,772** in 2,929.24 seconds
(48 minutes 49 seconds), with zero failures and zero skips, on the same frozen
production and hostile-test bytes.

## Final authorization

All bounded sequence-zero gates are green. This record authorizes one scoped
sequence-zero commit and push. It authorizes only the validation-first atomic
adoption successor and does not broaden any nonclaim above.

## Append-only plan and successor

Before the sequence acceptance append, the plan contains 17,438 lines and has
SHA-256
`fdb0790253fb3bea3f7baae4881360b2690cfcf136670765c294ee6fac0fad23`.
This prefix must remain byte-identical.

Passing the complete regression authorizes only validation-first four-receipt
atomic adoption. Publication session, rebind, retirement, commit, manifest,
release, adoption and star outcomes remain unclaimed.
