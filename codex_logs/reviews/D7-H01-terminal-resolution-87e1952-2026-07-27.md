# D7-H01 authority-bound terminal in-doubt resolution evidence

Date: 2026-07-27
Candidate commit: `87e195251d916c414de09da2b934cbeb77505199`
Candidate tree: `14f2b9895444a19a9ead34c8d3a20cb4b3812cb5`
Parent: `25355640590ad61ca9e216aacee0b640388fe6a9`
Branch: `feat/authoring-foundation`
Producer: `/root`
Review mode: main-agent self-review plus executable differential and hostile oracles
Independent acceptance: **not obtained; still required**

## Decision

The candidate is accepted as an immutable implementation milestone for the
first terminal in-doubt resolution protocol. It is not an acceptance of the
complete D7 workstream and does not authorize a production-ready claim.

The implementation closes the operator-resolution portion left open by
`2535564`:

- one closed, versioned resolution command;
- a domain-separated command hash;
- one `InDoubtActivityResolved` event appended after the terminal event;
- exact controller, request, stream, sequence, history-prefix, graph-revision,
  and activity-key binding;
- a strictly increasing administrative lease epoch and fencing token;
- a new lease identity and an inclusive-acquisition/exclusive-expiry interval;
- SHA-256 binding between the recorded authority snapshot and lease holder;
- compare-and-swap append against the command's exact expected sequence;
- byte-identical duplicate-command replay as a zero-write success;
- changed bytes under an existing resolution ID as a conflict;
- resolution checkpoint parity with the terminal result and accounting retained;
- complete native TypeScript and native Python implementations.

The first protocol deliberately resolves only a terminal stream containing
exactly one unresolved external-effect activity. It does not resolve an open,
nonterminal activity claim. A confirmed disposition clears uncertainty but
does not rewrite the already durable terminal result, cost, attempts, duration,
or graph revision.

## Exact candidate scope

The commit contains 17 files, 2,083 insertions, and 13 deletions:

- TypeScript command validation, public types/API, controller operation, fold,
  exports, and runtime tests;
- Python command validation, public types/API, controller operation, fold,
  exports, and tests;
- the closed event JSON Schema and normative cycle semantics;
- 18 reference-model resolution vectors in the durable conformance fixture;
- fixture validation for positive and hostile commands/events;
- a complete native TypeScript/Python differential resolution report.

No D4, D9, D10, master-plan, shared registry, or unrelated working-tree files
were staged in the candidate.

## Fail-closed hostile coverage

The fixture reference model executes 18 terminal-resolution cases. Native
cross-language execution additionally compares stable error codes for:

1. an unknown command field;
2. a wrong activity key;
3. a stale expected sequence;
4. a stale lease epoch/fencing token;
5. a changed lease holder;
6. a regressing event clock;
7. an expired lease interval;
8. changed command bytes under an existing resolution ID;
9. a second resolution after the singleton has been cleared.

The native tests separately prove:

- wrong target, stale tail, stale fence, and authority mismatch append nothing;
- a valid resolution appends exactly one event;
- the post-resolution checkpoint has an empty in-doubt projection;
- the original terminal result is byte-preserved;
- duplicate replay accepts a malformed unused lease and never samples the
  supplied clock;
- duplicate replay writes neither event nor checkpoint;
- a nonterminal interrupted claim returns
  `GE_CYCLE_RESOLUTION_NOT_TERMINAL` before append;
- terminal resume remains a read-only return after resolution.

## Cross-language differential proof

`node tools/conformance/run.mjs` passed in the main worktree and in the clean
detached candidate. The D7 native join now compares:

- 132 complete canonical events;
- 24 activity input preimages;
- all three controller modes;
- recovered and exhausted idempotent ambiguity;
- one authority-bound terminal resolution;
- eight terminal results;
- one accepted GraphPatch/revision;
- one crash/takeover resume;
- eight checkpoints.

For the resolution scenario, equality covers the complete command and command
hash, event envelope and record hash, all prior history, result bytes, fold
state, pre/post in-doubt projection, checkpoint bytes, nine hostile error
codes, and duplicate zero-write/zero-clock behavior. The shared command hash is
`4866f043e66e71ea37f3cef2308c1c3da2804fee8ea52c4c354abacb16fd2974`.

## Main-worktree validation

The following checks passed after the candidate implementation:

- `corepack pnpm --filter @graph-engineering/runtime test` — 8 files, 167 tests;
- `uv run --project python pytest -q python/tests` — 1,054 tests;
- `corepack pnpm lint`;
- `corepack pnpm typecheck`;
- `uv run --project python ruff check ...`;
- `uv run --project python mypy python/src` — 33 source files;
- `node scripts/validate-fixtures.mjs` — including 18 terminal resolution cases;
- `node scripts/check-doc-links.mjs`;
- `corepack pnpm build`;
- `corepack pnpm test` for all seven public workspace packages;
- `node tools/conformance/run.mjs`;
- `corepack pnpm check:packages` — seven package tarball manifests;
- `corepack pnpm check:packed-install` — seven packed packages installed and
  their bins smoke-tested;
- `corepack pnpm check:python-package` — 40 wheel entries and 41 sdist entries;
- `corepack pnpm check:release-map` — 178/178 exact release leaves;
- `corepack pnpm check:evidence-closure` — audit-only closure checks and 102
  adversarial subtests;
- `corepack pnpm audit --prod --audit-level moderate` — no known vulnerabilities.

One concurrent main-worktree package-content check raced the packed-install
check over package build directories and briefly reported an absent CLI
declaration. After the concurrent command completed, the declaration existed
and the package-content check passed when rerun alone. This was an orchestration
collision, not a candidate defect.

## Clean detached verification

Detached worktree:
`/tmp/graph-engineering-h02-verify.w7xJPP`

The worktree was created directly from the full candidate object ID. Its
tracked status remained clean after verification. The cold sequence was:

1. `corepack pnpm install --offline --frozen-lockfile`;
2. `uv sync --project python --frozen --offline`;
3. `corepack pnpm build`;
4. workspace lint and typecheck;
5. fixture and documentation validation;
6. `uv sync --project python --frozen --offline --extra dev`;
7. Ruff and Mypy;
8. all workspace tests and all 1,054 Python tests;
9. complete cross-language conformance;
10. seven npm package-content checks;
11. packed-install smoke;
12. release-map and evidence-closure checks;
13. `uv build --project python --offline`;
14. Python wheel/sdist installation smoke.

The first cold Ruff/Mypy invocation correctly failed because the default sync
does not install the optional `dev` extra. The commands passed after installing
that lockfile-declared extra. The first Python artifact smoke correctly failed
because a cold checkout has no `python/dist` artifacts. `uv build` created the
wheel and sdist, after which the full smoke passed. Both precondition findings
are retained here rather than hidden.

The clean candidate reported 51 committed JSON fixtures and 229 committed
Markdown links. The larger main-worktree counts came from unrelated untracked
D4/D9/D10 work and are not attributed to this candidate.

## Commit and remote identity

The candidate subject is `add authority-bound in-doubt resolution`. Author and
committer are exactly `reacher-z <mtrxcop@gmail.com>`. The message contains no
co-author trailer.

The branch was pushed normally. A post-push `git ls-remote` returned the exact
full candidate ID for `refs/heads/feat/authoring-foundation`.

## Explicit remaining work

The following are still open and prevent completion of D7-TS-CYCLES-025,
D7-PY-CYCLES-026, D7-CYCLE-CONFORMANCE-027, or a production-ready statement:

- fresh independent hostile review by an agent that did not author or
  remediate the candidate;
- every-exit-reason and one-below/at/above hard-stop differential matrices;
- rejected and malicious GraphPatch differential histories;
- cancellation and crash injection at every durable boundary;
- checkpoint corruption and checkpoint-acceleration proofs;
- fork lineage trees, missing/cyclic ancestry, and competing lease races;
- production event/checkpoint stores and real distributed fencing;
- scheduler revision integration, property/model testing, benchmarks, operator
  UI/redaction integration, migration, and production compatibility work;
- any protocol for resolving a still-open nonterminal activity claim.

All three D7 native/conformance tasks therefore remain `in_progress`.
