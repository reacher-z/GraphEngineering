# CTRL control commit `105881f` immutable review

- Review time (UTC): `2026-07-26T22:19:07Z`
- Review time (America/Vancouver): `2026-07-26T15:19:07-07:00`
- Reviewer lane: `/root/control_commit_immutable_review`
- Review mode: independent, detached-worktree validation from committed bytes
- Candidate commit: `105881fccab3d556b5b987e062cced9e645099b7`
- Verdict: **ACCEPT — immutable control commit is internally consistent and every requested gate passed**

## Scope and isolation

The review used a fresh detached worktree created directly from the candidate
commit. The temporary path was `/tmp/graph-control-105881f.tJFwsk`. The main
worktree was not checked out, reset, committed, or otherwise rewritten. After
all checks, `git worktree remove --force /tmp/graph-control-105881f.tJFwsk`
completed successfully, the directory no longer existed, and `git worktree
list --porcelain` contained only:

```text
worktree /home/nick/work/GraphEngineering
HEAD 105881fccab3d556b5b987e062cced9e645099b7
branch refs/heads/feat/authoring-foundation
```

The review environment reported:

```text
node: v22.23.1
pnpm: 10.13.1
git: git version 2.53.0
```

## Immutable identity

`git cat-file -t` identified the object as a commit. The exact reviewed
identity was:

```text
commit=105881fccab3d556b5b987e062cced9e645099b7
tree=13054dae3111c20d6ba481a97a316f1919deaf2d
parents=dd8c0f7a159a717fc4cd75a5c9b3d90451433a93
author_name=reacher-z
author_email=mtrxcop@gmail.com
author_date=2026-07-26T15:16:50-07:00
committer_name=reacher-z
committer_email=mtrxcop@gmail.com
committer_date=2026-07-26T15:16:50-07:00
subject=feat: enforce fail-closed release controls
```

The raw commit payload ended as follows:

```text
tree 13054dae3111c20d6ba481a97a316f1919deaf2d
parent dd8c0f7a159a717fc4cd75a5c9b3d90451433a93
author reacher-z <mtrxcop@gmail.com> 1785104210 -0700
committer reacher-z <mtrxcop@gmail.com> 1785104210 -0700

feat: enforce fail-closed release controls
```

`git show -s --format=%B` produced the following hexadecimal message bytes:

```text
666561743a20656e666f726365206661696c2d636c6f7365642072656c6561736520636f6e74726f6c730a0a
```

Those bytes are exactly the subject plus terminating blank line; the body is
empty. A case-insensitive search of the raw commit object for `co-authored-by`
or `coauthor` returned no match. The author and committer are both exactly
`reacher-z <mtrxcop@gmail.com>`.

## Exact 24-file manifest

The parent-to-candidate manifest contained exactly 24 paths. Its ordered
newline-delimited path-list SHA-256 was
`90c5ec083b54f39fdf74ef0f2455f9d51a9db4985956585bfa04dcc99f370f7e`.

```text
M  .github/workflows/ci.yml
M  CONTRIBUTING.md
M  README.md
M  codex_logs/README.md
A  codex_logs/release-evidence/README.md
A  codex_logs/release-evidence/d2-authoring-dd8c0f7.json
A  codex_logs/release-evidence/task-revalidation.json
A  codex_logs/reviews/CTRL-EVIDENCE-BACKFILL-075-implementation-2026-07-26.md
A  codex_logs/reviews/CTRL-EVIDENCE-BACKFILL-075-independent-2026-07-26.md
A  codex_logs/reviews/CTRL-RELEASE-MAP-074-2026-07-26.md
A  codex_logs/reviews/CTRL-RELEASE-MAP-074-independent-2026-07-26.md
A  codex_logs/reviews/CTRL-RELEASE-MAP-074-semantic-independent-2026-07-26.md
A  codex_logs/reviews/CTRL-RELEASE-MAP-074-semantic-remediation-2026-07-26.md
A  codex_logs/reviews/D2-Authoring-Canonical-Independent-2026-07-26.md
A  codex_logs/reviews/Full-Plan-Gap-Audit-2026-07-26.md
M  codex_logs/task-registry.json
M  codex_plans/delivery/release-checklist.md
A  codex_plans/delivery/release-task-map.json
M  codex_plans/delivery/task-dependency-graph.md
M  package.json
A  scripts/check-evidence-closure.mjs
A  scripts/check-release-task-map.mjs
A  scripts/tests/evidence-closure.test.mjs
A  scripts/tests/release-task-map.test.mjs
```

The manifest contains no `spec/**` path, no D7 or D9 review/contract path, no
cycle or redaction path, no schema path, no `scripts/validate-fixtures.mjs`,
no `spec/README.md`, no progress-scanner lock file, and no concurrently edited
status documents. In particular, all of the following were absent:

- `codex_logs/daily/2026-07-26.md`
- `codex_plans/Graph-Engineering-21-Day-Master-Plan.md`
- `codex_plans/architecture/cross-language-conformance.md`
- `codex_plans/architecture/graph-ir-and-schema.md`
- `codex_plans/architecture/persistence-and-recovery.md`
- `codex_plans/architecture/runtime-semantics.md`
- `codex_plans/delivery/agent-ownership-map.md`
- `codex_plans/delivery/d2-builder-yaml-implementation-brief.md`
- `codex_plans/delivery/master-plan-coverage-matrix.md`
- `scripts/validate-fixtures.mjs`
- `spec/README.md`
- every outstanding D7/D9 schema, fixture, contract, and review path
- `tools/progress-scanner/uv.lock`

The automated forbidden-path scan printed exactly:

```text
forbidden_paths=NONE
coauthor_marker=NONE
```

## Frozen dependency installation

Command:

```text
corepack pnpm install --frozen-lockfile
```

Exit code: `0`.

Output:

```text
Scope: all 8 workspace projects
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +142
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 142, reused 142, downloaded 0, added 142, done

devDependencies:
+ ajv 8.20.0

Done in 1.4s using pnpm v10.13.1
```

`git status --short` remained empty after installation and all checks, so the
frozen install did not alter tracked commit bytes.

## Release-map gate

Command:

```text
corepack pnpm check:release-map
```

Exit code: `0`.

Primary output:

```text
release-task-map OK: 178/178 leaves; 175 blocking, 3 non-blocking; 37 blocking producers in a 94-task roll-up closure; 107 registry tasks; dependency graph acyclic
```

TAP result:

```text
1..40
# tests 40
# suites 0
# pass 40
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 473.902107
```

This includes positive canonical coverage and fail-closed tests for semantic
producer substitution, semantic joins, mapping/checklist drift, dependency
cycles, duplicate/dangling/retired tasks, blocking classification, roll-up
reachability, evidence plans, and manifest-source/policy mutation.

## Evidence-closure and zero-weight overlay gate

Command:

```text
corepack pnpm check:evidence-closure
```

Exit code: `0`.

The checker returned this exact audit object:

```json
{"ok":true,"mode":"audit-only","rootTaskId":"CTRL-RELEASE-ROLLUP-086","requiredTaskCount":93,"manifestCandidateCount":0,"selectedCandidate":null,"selectedTaskCount":0,"releaseWeight":0,"releaseWeightMaximum":93,"historicalStatusWeight":0,"candidateSummaries":[],"overlayCommit":null}
```

TAP result:

```text
1..41
# tests 102
# suites 0
# pass 102
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 16324.058724
```

The canonical overlay file independently parsed to:

```json
{
  "candidates": [],
  "candidateCount": 0
}
```

Therefore the canonical overlay has no candidate, selects no task evidence,
and contributes exactly `0/93` release weight. Historical task status also
contributes zero. This review does not upgrade any release leaf or claim a
release candidate.

The 102 assertions include immutable Git-object identity, clean overlay
checkout, full overlay ancestry, deletion/rewrite resistance, exact ancestor
closure, source/spec/tree digests, exact task contracts and coverage,
candidate-blob mode/size/digest enforcement, supersession history,
failed/reopened invalidation, fresh non-reused reclosure evidence, resource
bounds, timestamp/argv/cwd/result validation, reviewer independence,
canonical record hashing, and unknown-field rejection.

## Documentation and fixture gates

Command:

```text
corepack pnpm check:docs
```

Exit code: `0`.

Output:

```text
Checked 197 local Markdown links.
```

Command:

```text
corepack pnpm validate:fixtures
```

Exit code: `0`.

Output:

```text
Validated 27 JSON fixtures, 1 graph hash, 1 checkpoint hash, and 14 Durable JSON vectors.
```

## Syntax and whitespace gates

All four committed checker/test entry points were parsed independently:

```text
node --check scripts/check-release-task-map.mjs
node --check scripts/tests/release-task-map.test.mjs
node --check scripts/check-evidence-closure.mjs
node --check scripts/tests/evidence-closure.test.mjs
```

Each command exited `0` with empty standard output and standard error.

Both whitespace checks passed with exit code `0` and empty output:

```text
git diff --check dd8c0f7a159a717fc4cd75a5c9b3d90451433a93 105881fccab3d556b5b987e062cced9e645099b7
git diff --check
```

The final detached-worktree `git status --short` also exited `0` with empty
output.

## Verdict

**ACCEPT.** Commit `105881fccab3d556b5b987e062cced9e645099b7`
is the reviewed immutable control commit. Its tree, parent, author/committer,
empty body, no-coauthor condition, 24-file boundary, and requested exclusions
all match the review contract. Frozen installation and every requested release
map, evidence closure, documentation, fixture, syntax, and diff gate passed.
The canonical candidate overlay remains deliberately empty and carries zero
release weight.
