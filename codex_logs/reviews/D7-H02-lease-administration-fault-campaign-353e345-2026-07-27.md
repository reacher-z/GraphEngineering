# D7-H02 lease-administration behavioral fault campaign evidence

Date: 2026-07-27
Candidate commit: `353e3455238957ff76285a06f8bd09c1806e7bd3`
Candidate tree: `b86d43a5299e481a09ad0a1a48733d0e3c29d317`
Parent: `9780d1262d8a19224f5fb1b12d7ae17f1790dd50`
Branch: `feat/authoring-foundation`
Producer: `/root`
Author and committer: `reacher-z <mtrxcop@gmail.com>`
Review mode: main-agent hostile self-review plus clean detached execution
Independent acceptance: **not obtained; still required**

## Decision

The candidate is accepted as an immutable D7-H02 implementation milestone for
public, zero-dispatch lease renewal and voluntary release plus the first 100
fully behavioral rows of the 855-row durable fault lattice. It is not an
acceptance of the complete D7 workstream, does not close the release roll-up,
and does not prove production durability or distributed fencing.

The prior D7-H02 candidate made the complete event/stage/fault lattice closed
and executable as structure. This candidate takes the two lease-administration
events across all ten applicable durable stages and all five retained fault
kinds, injects every row into a real controller history in both native
runtimes, recovers it, and compares the complete TypeScript and Python reports.

The implementation also closes two coordination defects found during hostile
review:

1. a resumed lease must now advance lease identity as well as epoch and fencing
   token; and
2. the TypeScript process-local CAS store rechecks its tail after asynchronous
   before-commit hooks, preventing concurrent promises from degrading into a
   last-writer-wins overwrite.

## Exact candidate identity and scope

The candidate contains 16 files, 1,707 insertions, and 42 deletions:

- TypeScript public renewal and pause types, functions, exports, errors,
  checkpoint behavior, exact-version mapping, CAS race protection, tests, and
  package documentation;
- Python public renewal result and function, strengthened pause result and
  semantics, exports, fold alignment, tests, and package documentation;
- a retained 100-row behavioral campaign declaration inside the existing
  durable-fault fixture;
- closed fixture validation for campaign event, stage, fault-kind, seed,
  assertion, and cardinality declarations;
- independent TypeScript and Python execution of all 100 rows followed by one
  exact deep comparison; and
- normative cycle-semantics text for lease administration, checkpoint
  authority, concurrency, and the honest structural/behavioral boundary.

No D4, D9, D10, master-plan, task-registry, daily-log, progress-scanner
lockfile, or unrelated shared-worktree changes are part of the candidate.

## Public lease-administration contract

Both native runtimes now expose two explicit operations on an existing,
nonterminal controller stream:

- renewal preserves `leaseId`, `holderId`, `leaseEpoch`, `fencingToken`, and
  `acquiredAt`, while strictly extending the exclusive `expiresAt`; and
- pause appends `LeaseReleased` with the closed reason `paused` or `handoff`.

Both operations:

- validate the complete request and stored request/controller identity;
- require an exact nonnegative current stream version;
- require one active, unexpired, nonterminal lease;
- sample the trusted clock once for the authoritative event;
- invoke no finder, evaluator, planner, optimizer, patch, or graph handler;
- prospective-fold the complete candidate prefix before store append;
- commit through the event-store compare-and-swap;
- write `{controllerRunId}-latest` after the authoritative event;
- preserve the committed event and return a structured warning if ordinary
  checkpoint persistence fails; and
- expose the event and resulting fold to the caller.

A stale pre-read version returns `GE_CYCLE_VERSION_CONFLICT` before append. If
two administrators both prepare against the same tail, exactly one CAS wins;
the losing TypeScript store error is translated to the same stable
`GE_CYCLE_VERSION_CONFLICT` public code as Python. The loser cannot overwrite
or append after the winner.

## Fence hardening

Resume previously required a strictly greater epoch and fencing token. The
candidate additionally rejects reuse of the last recorded `leaseId` in both
languages. A new holder cannot disguise a stale or replayed identity merely by
changing other fields.

Renewal cannot change any fenced identity field. It also rejects:

- a non-extending or equal expiry;
- renewal at or after the old exclusive expiry;
- a released or terminal stream;
- a mismatched request;
- an invalid event/checkpoint adapter;
- an invalid expected sequence; and
- a lost compare-and-swap.

Pause rejects an unknown release reason, expiry, release, terminal state,
request mismatch, stale version, and lost compare-and-swap before it can
release work or dispatch a handler.

## Checkpoint and clock behavior

The event stream remains authoritative. A successful administration event is
not rolled back or reinterpreted when its acceleration checkpoint fails.

The TypeScript journal checkpoint implementation was extracted without
changing ordinary interval or terminal checkpoint boundaries. The Python
checkpoint helper now accepts the event timestamp for administration calls,
so both languages use one trusted clock sample and byte-identical checkpoint
creation time rather than sampling Python's clock a second time.

Unit tests prove:

- renewal checkpoint failure returns `GE_CYCLE_STORE_FAILED` as a warning;
- the `LeaseRenewed` event remains durable;
- a later pause can write the latest checkpoint successfully;
- that checkpoint contains the release tail and no active lease; and
- one renewal plus one pause makes exactly two administration clock calls.

## Behavioral campaign identity

The retained campaign ID is `lease-administration-v1alpha1`. Its exact product
is:

- two event types: `LeaseRenewed` and `LeaseReleased`;
- ten nonterminal durable stages;
- five retained fault kinds; and
- 2 x 10 x 5 = **100 executable obligations**.

The ten stages are:

1. before event construction;
2. after event construction;
3. after prospective fold;
4. before store commit;
5. after store commit but before store return;
6. after store return but before state replacement;
7. after state replacement;
8. before checkpoint construction;
9. after checkpoint construction but before save; and
10. after checkpoint save but before acknowledgement.

The five fault kinds now carry different observed deterministic signals rather
than repeating one anonymous exception five times:

| Fault kind | Required observed signal |
|---|---|
| `process-loss` | `coordinator-process-lost` |
| `store-error` | `durable-store-error` |
| `timeout` | `operation-deadline-exceeded` |
| `cancellation` | `operation-cancelled` |
| `commit-then-throw` | `commit-acknowledgement-lost` |

These are deterministic simulation carriers. They do not claim to reproduce
an operating-system crash, network partition, or storage engine transaction.
The durable stage determines what can be observed after interruption; the
fault signal proves that every declared kind was actually selected and seen.

## Per-row recovery oracle

Every one of the 100 TypeScript runs and every one of the 100 Python runs:

1. creates a unique controller, stream, checkpoint scope, and initial lease;
2. stops after a durable `RoundReserved` and before finder dispatch;
3. injects the row's exact fault-kind signal at the row's exact boundary;
4. reads and folds the interrupted authoritative prefix;
5. checks whether the target event and checkpoint presence match the declared
   durability class;
6. retries administration only when the target event did not commit;
7. proves the complete recovered history contains exactly one target event;
8. retries the old expected version and proves a version-conflict zero write;
9. attempts resume with a stale fence and proves zero writes and zero handler
   calls;
10. resumes with a new lease identity, epoch, and fencing token;
11. proves exactly one safe finder dispatch and no evaluator dispatch;
12. reaches the same `MAX_ITERATIONS` terminal result;
13. replays read-only and compares the terminal result;
14. attempts terminal resume with a throwing clock and handlers; and
15. proves terminal resume performs zero writes, zero clock calls, and zero
    dispatches.

Each native report includes the obligation, signal, interrupted tail hash,
interrupted record hashes, checkpoint bytes or absence, canonical target
event, stable rejection codes, zero-write observations, handler counts,
canonical terminal result, final event types, final record hashes, canonical
final checkpoint, and terminal-resume observations. The TypeScript report is
deep-compared against the Python report; aggregate counts alone cannot pass.

## Concurrent CAS oracle

Separate public unit tests drive renewal and pause concurrently from the same
tail. Both operations wait at their pre-CAS boundary, then enter the store as
competing promises/tasks.

The required outcome in each language is:

- exactly one fulfilled administration;
- exactly one `GE_CYCLE_VERSION_CONFLICT` failure;
- exactly one additional event in the stream; and
- exactly one of `LeaseRenewed` or `LeaseReleased` in the winning suffix.

The TypeScript memory store now performs a second tail check immediately after
awaited before-commit hooks and immediately before its synchronous map
replacement. This is required because an `await`, even for a deterministic
hook, permits another promise to win after the optimistic read.

## Main shared-worktree verification

The following gates passed against the final implementation before the
immutable candidate was committed:

| Gate | Result |
|---|---|
| TypeScript build | all seven public workspace packages passed |
| TypeScript lint and typecheck | all seven public workspace packages passed |
| TypeScript tests | core 166, persistence 27, primitives 147, MCP server 15, patterns 93, runtime 181, CLI 147; **776 total** |
| Python tests | **1,084 passed** |
| Python Ruff | passed |
| Python Mypy | 35 source files, no issues |
| fixture validation | shared worktree 55 JSON fixtures and 20 case manifests; 855 structural obligations and the 100-row campaign declaration passed |
| documentation links | shared worktree 250 links passed |
| cross-language conformance | 132 exact baseline events, 24 activity inputs, 855 structural obligations, and **100 behavioral lease recoveries** passed |
| release task map | 178/178 release leaves and 40 validator tests passed |
| evidence closure | audit-only mode and 102 hostile subtests passed |
| npm contents | all seven public package manifests and dry-run tarballs passed; runtime contained 59 files |
| packed npm install | all seven tarballs installed and exported bins passed smoke tests |
| Python artifacts | wheel 41 entries and sdist 42 entries; both installed and passed entry-point/shared-YAML/validate/doctor smoke |
| production dependency audit | no known vulnerabilities at the moderate threshold |
| whitespace audit | `git diff --check` passed |

The shared-worktree fixture and documentation totals include preserved,
uncommitted D4/D9/D10 work. They are reported for transparency but are not used
as immutable candidate counts.

## Clean detached verification

Detached worktree:
`/tmp/graph-engineering-h02-verify.nl82Wh`

The worktree was created at the exact 40-character candidate object ID. It had
no branch and no tracked changes before verification. Node dependencies were
installed from the committed lockfile and local cache with:

`corepack pnpm install --frozen-lockfile --offline`

The final successful Python development environment was installed with:

`uv sync --project python --extra dev --offline --locked`

The following gates then passed against only committed bytes:

1. `corepack pnpm build`;
2. `corepack pnpm test`;
3. `corepack pnpm lint`;
4. `corepack pnpm typecheck`;
5. `python/.venv/bin/python -m pytest`;
6. `python/.venv/bin/ruff check python/src python/tests tools/conformance/python_cycle_report.py`;
7. `python/.venv/bin/mypy python/src tools/conformance/python_cycle_report.py`;
8. `corepack pnpm validate:fixtures`;
9. `corepack pnpm check:docs`;
10. `corepack pnpm check:release-map`;
11. `corepack pnpm check:evidence-closure`;
12. `corepack pnpm audit:prod`;
13. `corepack pnpm test:conformance`;
14. `corepack pnpm check:packages`;
15. `corepack pnpm check:packed-install`;
16. `(cd python && uv build --offline)`; and
17. `python3 scripts/check-python-artifacts.py`.

The exact cold results were:

- all seven TypeScript package builds, lint, and type checks passed;
- all **776 TypeScript tests** passed;
- all **1,084 Python tests** passed;
- Ruff passed and Mypy found no issue in 35 source files;
- 52 committed JSON fixtures and 17 committed case manifests passed;
- 229 committed documentation links passed;
- cross-language conformance passed for 132 exact baseline events, 24 activity
  inputs, 855 obligations over 171 boundaries, and 100 executable lease
  renewal/release recoveries;
- all three controller modes, two in-doubt recovery outcomes, one terminal
  resolution, eight terminal results, one accepted patch/revision, one
  crash/takeover resume, and eight baseline checkpoints passed;
- release mapping passed for 178/178 leaves and all 40 tests;
- evidence closure passed in audit-only mode and all 102 subtests;
- seven npm package contents and all seven isolated tarball installs passed;
- the runtime tarball contained 59 files;
- the Python wheel contained 41 entries and the sdist contained 42 entries;
- isolated wheel and sdist installs passed console-entry-point, shared YAML,
  `validate`, and `doctor` smoke tests; and
- the production dependency audit found no known vulnerability at the
  configured moderate threshold.

After all cold gates, `git status --short` was empty and the worktree still
resolved to candidate `353e3455238957ff76285a06f8bd09c1806e7bd3`, tree
`b86d43a5299e481a09ad0a1a48733d0e3c29d317`.

## Retained cold-environment correction

The first cold Python attempt used:

1. `uv sync --project python --offline --locked`; then
2. `uv run --project python --offline pytest`.

The project declares test tools in the optional `dev` extra, so the first sync
installed the package and runtime dependencies but not `pytest`. The second
command selected an external pytest/Python and failed collection with 23
`ModuleNotFoundError: graph_engineering` errors. Exit status was 2.

This was an environment-preparation error, not a candidate defect. It is
retained rather than hidden. No source file changed. Installing the explicit
committed `dev` extra and invoking the project interpreter directly produced
1,084/1,084 passes.

## Review independence and agent availability

The implementation, hostile review, remediation, and evidence were performed
by `/root`. The three available subagents had exhausted their execution quota
until 2026-08-02 15:10, so no fresh independent reviewer could execute this
candidate during the milestone. This log records self-review plus executable
hostile oracles and explicitly does not claim independent acceptance.

An independent reviewer must still inspect the immutable candidate, reproduce
the 100-row product from the retained fixture, challenge the lease and CAS
boundaries, and confirm the durability observations before the applicable D7
task can be closed.

## Commit hygiene

The candidate subject is `execute lease administration fault campaign`.
Author and committer are exactly `reacher-z <mtrxcop@gmail.com>`. The commit
message body is empty and has no co-author trailer.

This evidence file is intentionally separate from the implementation commit so
the candidate tree, tests, and review boundary remain immutable and auditable.

## Explicit remaining D7 work

This milestone converts 100 of 855 obligations into full behavioral recovery
proofs. The remaining **755 rows are still structural obligations**, not
exhaustively executed recovery claims.

Material remaining work includes:

- independent hostile review of this exact immutable candidate;
- full behavioral restart/recovery oracles for the other 755 matrix rows;
- every-exit-reason and one-below/at/above hard-stop differential matrices;
- rejected, malformed, stale, conflicting, and malicious GraphPatch histories;
- checkpoint corruption, truncation, stale acceleration, and replay proofs;
- fork lineage trees, missing or cyclic ancestry, parent uncertainty, and
  competing lease/fencing races against production-grade providers;
- durable database-backed event/checkpoint stores with transaction and fsync
  evidence;
- distributed lease backends and takeover tests under real contention;
- scheduler revision integration and patch activation barriers;
- property/model tests and long-running randomized crash campaigns;
- performance and memory benchmarks at large history and campaign sizes;
- operator observability, safe redaction, migrations, compatibility policy,
  and production deployment guidance; and
- the still-open master-plan tasks outside the D7 cycle subsystem.

Accordingly, all release-level, popularity, star-count, and full-plan
completion claims remain open.
