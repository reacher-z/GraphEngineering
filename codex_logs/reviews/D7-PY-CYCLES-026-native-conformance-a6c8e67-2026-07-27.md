# D7 Python native-cycle and executable conformance milestone

- Recorded at: `2026-07-27T09:46:33Z`
- Commit: `a6c8e67c56d9ebcd8596307d9166763f48ac8713`
- Tree: `1c61314bb4abc89222606c4bca15d20275e30e15`
- Parent: `abd400b0ffa61b9eb648d69a173939ecf387d004`
- Branch: `feat/authoring-foundation`
- Remote ref after push:
  `a6c8e67c56d9ebcd8596307d9166763f48ac8713`
- Author: `reacher-z <mtrxcop@gmail.com>`
- Committer: `reacher-z <mtrxcop@gmail.com>`
- Co-author trailers: none
- Candidate verdict: **cleanly verified and remotely bound alpha milestone**
- Task verdict: **keep `D7-PY-CYCLES-026` and
  `D7-CYCLE-CONFORMANCE-027` in progress**
- Review independence: **not independently accepted**; the root integrator
  authored/remediated and verified this milestone after sub-agent capacity was
  unavailable.

## 1. Exact source boundary

The commit changes exactly these 16 paths:

1. `README.md`
2. `docs/CONCEPTS.md`
3. `docs/FAILURE_MODES.md`
4. `python/README.md`
5. `python/src/graph_engineering/__init__.py`
6. `python/src/graph_engineering/cycle_contract.py`
7. `python/src/graph_engineering/cycle_controller.py`
8. `python/src/graph_engineering/cycle_fold.py`
9. `python/src/graph_engineering/cycle_store.py`
10. `python/src/graph_engineering/graph_patch.py`
11. `python/tests/test_cycle_contract.py`
12. `python/tests/test_cycle_controller.py`
13. `python/tests/test_cycle_fold.py`
14. `python/tests/test_graph_patch_runtime.py`
15. `tools/conformance/python_cycle_report.py`
16. `tools/conformance/run.mjs`

The sorted path-list SHA-256 is
`24d245a8485ca91c64ff19def951e1d24c96b63d4fdd700bf857662019cfddee`.
The commit contains 9,307 insertions and 23 deletions. No D4/D9/D10 draft,
task-registry mutation, daily-log mutation, master-plan append, scanner lockfile,
or unrelated shared-worktree file was staged into the source commit.

Principal immutable file digests are:

| Path | SHA-256 |
| --- | --- |
| `python/src/graph_engineering/cycle_contract.py` | `aee7b2398148eb5b4d71dd816aa7cf0848a3a7e9c671c56d2e7ce105d8153368` |
| `python/src/graph_engineering/cycle_controller.py` | `463ee4ac588ea431d011048559c43648cd0b04e06ea6ea218c5e6e71775ec485` |
| `python/src/graph_engineering/cycle_fold.py` | `dc076720e3bd61c7ab93a7a3ed0a1f6958eef48b3f28b937077c98af88e7d959` |
| `python/src/graph_engineering/cycle_store.py` | `402567610dc1bc735a377d38a05f50a8e86c1f670c292e313e3571a6f1231fb8` |
| `python/src/graph_engineering/graph_patch.py` | `96cf20de19aa460ddbcd88d2a003b98233f399b2e602eb69666c373dd3e3dde1` |
| `tools/conformance/python_cycle_report.py` | `f48be34d7066075744bd288abf263fd50198dcf285972e36c4f4a2f36096377d` |
| `tools/conformance/run.mjs` | `316a4fe33f671e2b01f4e2d46f26edaa9295e4e4c7941ec2353a54293fa0e155` |

## 2. Implemented Python behavior

This milestone adds a native Python implementation rather than delegating to
Node or TypeScript. It includes:

- strict closed request/policy/activity/lease/candidate/verdict validation;
- bounded portable JSON capture and canonical domain-separated identities;
- native event creation and prospective full-prefix folding before store CAS;
- deterministic local event/checkpoint storage;
- `until-dry`, `while`, and evaluator-optimizer modes;
- global seen-state deduplication against every discovered key;
- complete request-bound worst-case reservation for finder, evaluator, mode,
  and enabled patch-planner activity retries;
- zero-dispatch preflight termination when the complete round envelope cannot
  fit remaining attempts, cost, or dynamic-node capacity;
- deterministic release of unused retries and route capacity;
- request-bound activity preimages aligned exactly with TypeScript;
- durable retry, cancellation, timeout, structured failure, and stable
  idempotency-key handling;
- start, resume, pause, replay, and fork public operations;
- fail-closed resume/fork behavior for inherited or open non-idempotent claims;
- native GraphPatch shape validation, authority/policy/budget/graph gates,
  accepted/rejected decision projections, and revision recovery; and
- strict GraphPatch validation on live apply, restoration, and pure event replay.

## 3. Remediations completed during integration

### 3.1 Full round-envelope preflight

The Python round planner now reserves the complete worst-case retry envelope
specified by the request. It does not shrink retry counts to fit remaining
capacity. Patch-planner capacity is reserved whenever request bindings enable
patches, even when the runtime route is skipped, then released deterministically
if unused.

Regressions prove that capacity sufficient for one attempt per phase but
insufficient for the full retry envelope terminates with the appropriate
maximum reason and zero handler dispatch.

### 3.2 Strict GraphPatch fragments at every trust boundary

`validate_graph_patch_shape` reuses strict node, edge, endpoint, and output
validation. Missing node config, missing edge `from`, and empty ports are
rejected before recorder calls or revision mutation. A correctly re-signed
malicious durable proposal is also rejected as invalid history during fold.

### 3.3 Non-idempotent recovery

`resume_cycle` now rejects an open non-idempotent claim with
`IN_DOUBT_SIDE_EFFECT` before acquiring/appending a new lease or invoking any
handler. Fork records only its child creation event and then blocks on inherited
in-doubt state without inventing a child attempt or cost charge.

Tests assert the original active prefix remains valid, the resume path writes
nothing, the fork path writes only the child creation event, dispatch count is
zero, and counters remain event-derived.

### 3.4 Activity input preimage parity

Python activity preimages were reduced to the exact TypeScript contract:

- finder: objective, current revision, remaining discovery credit;
- candidate evaluator: objective and first-occurrence fresh candidates;
- condition/optimizer: objective, candidates, committed verdicts, graph hash;
- patch planner: objective, candidates, verdicts, mode outcome, current
  revision.

Removing Python-only iteration/seen/limit fields made activity input hashes,
activity keys, downstream events, and checkpoints byte-equal in the executable
join.

## 4. Executable TypeScript/Python join

`tools/conformance/python_cycle_report.py` runs the Python controller and emits
canonical reports. `tools/conformance/run.mjs` independently runs the native
TypeScript controller and compares exact objects and canonical bytes.

The joined scenarios cover:

- until-dry with duplicate and rediscovered rejected findings, global seen
  state, and two consecutive dry rounds;
- a requested/enabled patch planner whose runtime route is skipped and whose
  unused envelope is released;
- one accepted append-only patch adding a validator node, edge, and output;
- exact candidate graph hash and revision chain;
- commit-then-throw after `DiscoveryCommitted`, takeover resume, and proof that
  the finder ran exactly once;
- a `while` condition that returns false; and
- an evaluator-optimizer decision that accepts.

The final runner reports exact equality for:

- 93 complete canonical events;
- 17 activity input preimages;
- all three controller modes;
- five terminal result objects and canonical encodings;
- one accepted GraphPatch/revision;
- one interrupted/takeover recovery;
- five checkpoint objects, encodings, and state projections;
- record hashes, activity keys, event type sequences, and request bytes.

This is an executable cross-language slice. It is not yet the complete hostile
boundary matrix required by the D7 conformance task.

## 5. Main-worktree verification before commit

The integrated workspace passed:

| Command | Result |
| --- | --- |
| `uv run --project python pytest -q` | exit 0; 1,065 passed, 2 subtests passed |
| `uv run --project python ruff check python/src python/tests tools/conformance/python_cycle_report.py` | exit 0 |
| `uv run --project python mypy python/src tools/conformance/python_cycle_report.py` | exit 0; 34 source files |
| `corepack pnpm --filter @graph-engineering/runtime test -- cycle-contract.test.ts cycle-controller.test.ts cycle-fold.test.ts graph-patch.test.ts` | exit 0; 8 files, 163 tests |
| `corepack pnpm lint` | exit 0; seven workspace projects |
| `corepack pnpm typecheck` | exit 0; seven workspace projects |
| `corepack pnpm test:conformance` | exit 0; complete runner including 93-event D7 join |
| `corepack pnpm check:docs` | exit 0; 250 local Markdown links in the shared workspace |
| `corepack pnpm check:python-package` | exit 0; wheel/sdist install smoke |
| `git diff --cached --check` | exit 0 |

The initial bare `uv run --project python mypy` invocation returned usage exit
2 because Mypy requires a target when invoked this way. It was corrected to the
explicit source/report paths above and passed. This command-orchestration error
is retained rather than misreported as a type-check success.

## 6. Detached clean-worktree verification

After committing locally and before pushing, the exact commit was checked out
detached at `/tmp/graph-engineering-d7-verify.bojV7K`. Dependencies were
installed with:

```text
corepack pnpm install --offline --frozen-lockfile
uv sync --project python --extra dev --offline --frozen
```

The exact detached commit then passed:

| Command | Result |
| --- | --- |
| `corepack pnpm test:conformance` | exit 0; full cross-language runner including 93 exact D7 events |
| `uv run --project python pytest -q` | exit 0; 1,065 passed, 2 subtests passed in 43.69s |
| `uv run --project python ruff check ...` | exit 0 |
| `uv run --project python mypy python/src tools/conformance/python_cycle_report.py` | exit 0; 34 source files |
| `corepack pnpm lint` | exit 0 |
| `corepack pnpm typecheck` | exit 0 |
| `corepack pnpm check:docs` | exit 0; 229 commit-local Markdown links |
| `uv build --project python` | exit 0; wheel and sdist created |
| `corepack pnpm check:python-package` | exit 0; 40 wheel entries, 41 sdist entries, both installed and smoke-tested |
| `git status --short --branch` before generated verification artifacts | clean detached HEAD |

Two reproducibility corrections are deliberately retained:

1. the first clean Python test/static invocation omitted the `dev` extra. `uv`
   correctly created a runtime-only environment, after which an ambient system
   pytest could not import the project and Ruff was absent. The clean worktree
   was explicitly synchronized with `--extra dev --offline --frozen`; the exact
   tests and static checks were rerun and passed.
2. the first Python package checker invocation ran before building `python/dist`
   and correctly reported that it found no wheel/sdist. `uv build --project
   python` was then run, followed by the exact checker, which passed both fresh
   installation paths.

These failures were missing-command-precondition signals, not source test
failures. They remain recorded so future clean validation uses the complete
sequence and does not rely on a populated developer environment.

Verification toolchain observed:

- Node.js `v22.23.1`;
- pnpm `10.13.1` through Corepack;
- uv `0.11.11`;
- repository clean-worktree Python environment selected from the lock; and
- artifact smoke checker host Python `3.14.4`.

## 7. Commit, push, and remote identity

The exact commit has:

```text
commit  a6c8e67c56d9ebcd8596307d9166763f48ac8713
tree    1c61314bb4abc89222606c4bca15d20275e30e15
parent  abd400b0ffa61b9eb648d69a173939ecf387d004
author  reacher-z <mtrxcop@gmail.com>
commit  reacher-z <mtrxcop@gmail.com>
subject implement native Python cycle conformance
```

It was pushed with a normal non-force update from `abd400b` to `a6c8e67`.
`git ls-remote origin refs/heads/feat/authoring-foundation` then returned the
full commit ID `a6c8e67c56d9ebcd8596307d9166763f48ac8713`.

## 8. Explicit open findings and non-claims

The following work remains open and prevents completion/production claims:

- a fresh independent hostile reviewer could not be started because the
  platform reported an account-level usage limit until
  `2026-08-02T15:10:00-07:00`;
- TypeScript and Python need one normative decision for in-doubt activity
  cardinality/coalescing; the TypeScript fold can retain settled `inDoubt`
  entries while the checkpoint schema currently caps the collection at one;
- exact cross-language rejected-patch, cancellation-at-every-boundary,
  one-below/at/above budget, fork lineage, corrupt checkpoint, and competing
  lease-race cases remain to be added;
- there is no production SQLite/PostgreSQL cycle store or real database fence;
- checkpoint acceleration is not implemented;
- accepted GraphPatch revisions are not integrated into the ordinary scheduler;
- telemetry payload protection and redaction remain D9 work; and
- no release candidate, independent acceptance, adoption, or star-count claim
  is authorized.

The master plan therefore retains all D7 tasks as in progress and appends a
productionization/hardening expansion rather than reducing the remaining scope.

## 9. Required next actions

1. resolve the in-doubt semantics with expected fixtures before implementation;
2. expand the executable join across the complete hostile boundary lattice;
3. derive crash/fault cases from the event vocabulary;
4. add an independent budget-ledger oracle;
5. specify the provider-neutral store/fencing contract;
6. implement durable adapters and checkpoint acceleration under separate
   evidence;
7. integrate accepted revisions with the ordinary scheduler only after the
   revision handoff contract is frozen;
8. obtain fresh independent hostile review; and
9. rerun the no-omission audit on one immutable candidate before any completion
   or release statement.
