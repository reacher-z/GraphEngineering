# CTRL-EVIDENCE-BACKFILL-075 independent review

- Reviewed at: `2026-07-26T22:08:32Z`
- Reviewer: `/root/evidence_closure_review`
- Role: independent adversarial review and remediation
- Control under review: `CTRL-EVIDENCE-BACKFILL-075`
- Canonical release root: `CTRL-RELEASE-ROLLUP-086`
- Verdict: **ACCEPT the evidence-closure control for integration**
- Release effect: **none**. The canonical overlay contains no candidate, so
  release weight remains `0/93`; this review does not accept a product release,
  a release candidate, historical completion claims, or the 21-day plan.

## Scope and method

The review read the master-plan evidence requirements, Section 13 of the task
dependency graph, the release checklist and machine map, the task registry, the
candidate overlay, the implementation record, the checker, its complete test
suite, package wiring, and CI wiring. It then attacked the control through
temporary Git repositories and in-memory fixtures. No fixture candidate was
written to the canonical overlay, and temporary repositories were removed by
the test harness.

The audit covered:

1. the empty-overlay audit state and zero-weight policy;
2. full candidate SHA, candidate commit/tree/spec/source/map/checklist digests,
   and exact task-contract binding;
3. dynamic transitive closure of the release root, excluding the root itself;
4. record identity, record digest, ordering, supersession, latest-state, and
   historical-status behavior;
5. exact commands, environment, exit status, timestamps, result reports,
   artifacts, review evidence, exclusions, and fallback mode;
6. complete overlay ancestry, deletion/rewrite laundering, merge parents,
   shallow history, replacement refs, grafts, and candidate ancestry;
7. worktree/index ambiguity, traversal, pathspec metacharacters, `.git` paths,
   symlinks, submodules, dirty files, skip-worktree, and assume-unchanged;
8. plain-object/prototype ambiguity, unknown fields, secret-bearing environment
   capture, invalid timestamps, and exact argv behavior; and
9. size and count denial-of-service boundaries before hashing or traversal.

## Findings and disposition

| Severity | Finding | Disposition |
|---|---|---|
| P0 | Append-only validation compared only a nearby historical state. A candidate or record could be deleted or rewritten, followed by an unrelated commit, and the nearest-parent comparison could miss the earlier violation. | **Closed.** Candidate mode now walks the complete overlay ancestry and checks the candidate/record prefix over every parent edge. It fails closed on deletion, rewrite, incompatible merge history, shallow traversal, replace refs, and grafts. |
| P0 | A task whose latest record was `failed` or `reopened` could be reclosed by cloning stale command and review evidence under a new record ID. | **Closed.** Every superseding record must use command and review timestamps strictly later than its predecessor and may not reuse any earlier command/review report path or blob digest in that task chain. |
| P0 | A structurally valid record could assert every natural-language requirement while binding unrelated commands or repeatedly using one generic artifact. | **Closed at the machine-verifiable boundary.** Every exact `expected_tests` string and `expected_artifacts` path is now represented once, in candidate-contract order, with nonempty valid indexes. Command/artifact index sets are closed; dangling, duplicate, invented, reordered, uncovered, failed-command, and adjacent-prefix claims reject. Coverage is record-digest protected. Semantic truth remains an independent-review responsibility, as documented below. |
| P1 | Worktree bytes or Git path ambiguity could weaken immutable-candidate binding, including symlinks, wildcard pathspec behavior, and hidden index flags. | **Closed.** Evidence resolves through literal tree entries and regular Git blobs. Symlinks and submodules reject. Candidate mode rejects dirty/untracked files, skip-worktree, assume-unchanged, shallow checkouts, replace refs, grafts, traversal/control/colon paths, and `.git` paths. Every retained candidate, not only the selected one, must be an overlay ancestor. |
| P1 | Unbounded manifests, Git blobs, task/record collections, commands, artifacts, environment fields, strings, and history traversal could exhaust memory or time. | **Closed.** Explicit size/count ceilings are enforced before expensive hashing or traversal, including manifest/source/evidence/Git-output bytes and candidates/tasks/dependencies/contracts/records/commands/argv/environment/artifacts/exclusions/history counts. |
| P1 | Command and review envelopes admitted ambiguity around timestamps and report identity. | **Closed.** UTC timestamps must be real calendar instants; exact argv remains positional and may legitimately repeat arguments; cwd, environment, exit, status, start/finish order, result report, and digest are checked. Review evidence must be independent, use a distinct path and blob digest, include exclusions/fallback, and identify a reviewer distinct from the producer. |
| P2 | Prototype-bearing JSON-shaped objects and unknown structural fields could create inconsistent digest/validation behavior outside the normal parser path. | **Closed.** Validation requires plain JSON objects and rejects prototype-bearing inputs and unknown fields before digesting. |

No open P0, P1, or P2 finding remains in this review scope.

## Exact coverage boundary

The checker can prove that a candidate-bound record names every exact test and
artifact requirement, that each name is mapped to immutable command/artifact
evidence, and that no evidence item escapes that mapping. It cannot infer that a
command actually exercises the natural-language behavior it claims to cover,
that a five-byte report is intellectually adequate, or that two differently
named people are organizationally independent. Those are semantic assertions.

Accordingly, the machine gate and human gate are deliberately cumulative:

- the checker enforces immutable identity, complete declared coverage, exact
  envelopes, history, and fail-closed structural rules; and
- the distinct reviewer must inspect whether the declared commands, artifacts,
  reports, exclusions, and conclusions genuinely prove the task contract.

This boundary is now explicit in Section 13 and
`codex_logs/release-evidence/README.md`. The control does not treat structural
coverage as semantic acceptance.

## Adversarial regression evidence

The final evidence suite contains `102/102` passing assertions, up from the
implementation record's initial `64`. Named regression cases include:

- `CLI full overlay ancestry rejects deletion washed through an unrelated later commit`;
- `a newer passed record can reclose only with later unique command and review reports`;
- `supersession rejects stale command/review time and reused report blobs`;
- `task coverage exactly closes expected tests and artifacts`, including nine
  subcases for missing, duplicate, forged, dangling, repeated, adjacent-prefix,
  uncovered-command, uncovered-artifact, and failed-command bindings;
- `coverage mapping is part of the canonical record digest`;
- `Git symlink cannot masquerade as an artifact blob`;
- `CLI clean-check rejects skip-worktree hiding a tracked artifact mutation`;
- `CLI candidate validation rejects shallow overlay ancestry`;
- `CLI requires every recorded candidate, not only the selected one, to be an overlay ancestor`;
- `oversized candidate blob fails before hashing`;
- `candidate record-count resource bound fails closed before traversal`; and
- `prototype-bearing JSON-shaped objects fail before digesting`.

The broader suite also exercises full/abbreviated/unrelated candidate IDs,
tree/spec/source/map/checklist/record/file digest drift, literal wildcard paths,
path traversal, dirty and untracked files, malformed times, secret environment
keys, self-review, missing exclusions/fallback, unknown fields, candidate and
record duplication, malformed supersession, historical zero weight, and latest
failed/reopened status.

## Final gates

| Command | Result |
|---|---|
| `corepack pnpm check:evidence-closure` | Passed. Audit-only canonical state reports `93` dynamically required ancestors, `0` candidates, release weight `0/93`, historical weight `0`; `102/102` tests passed. |
| `node scripts/check-evidence-closure.mjs --json` | Passed in audit mode with the same explicit zero-candidate, zero-weight result. |
| `corepack pnpm check:release-map` | Passed: `178/178` checklist leaves, `175` blocking and `3` nonblocking mappings, `37` blocking producers, `94`-task closure including the root, `107` acyclic registry tasks, and `40/40` tests. |
| `corepack pnpm check:docs` | Passed: `228` local Markdown links. |
| `node --check scripts/check-evidence-closure.mjs` | Passed. |
| `node --check scripts/tests/evidence-closure.test.mjs` | Passed. |
| `git diff --check` | Passed. |

## Verdict and exclusions

**ACCEPT** `CTRL-EVIDENCE-BACKFILL-075` as a fail-closed, candidate-bound
evidence control suitable for integration and for later independent candidate
reviews. This verdict accepts the checker and its documented protocol only.

It explicitly does **not**:

- create or accept a canonical candidate;
- backfill any historical task as passed;
- assign release weight to registry status, logs, or scanner output;
- decide stable, complete-RC, Beta, or any other release label;
- prove external usability, provenance, publishing authority, community growth,
  or a `6k+` star outcome; or
- claim completion of the master plan or product implementation.

The canonical `candidates` array remains empty. A future release decision must
use a real full candidate commit, candidate-contained evidence for every
dynamically required task, an independent semantic review, and a clean explicit
`--candidate` validation. No synthetic candidate has been inserted into
canonical history.
