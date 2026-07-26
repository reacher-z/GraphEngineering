# CTRL-EVIDENCE-BACKFILL-075 implementation record

- Recorded at: `2026-07-26T21:31:56Z`
- Role: implementation lane; this record is **not** an independent acceptance
  review.
- Canonical release root: `CTRL-RELEASE-ROLLUP-086`
- Required set: computed dynamically as the root's transitive registry
  ancestors, excluding the root itself. No task-count constant is embedded in
  the checker or tests.

## Delivered control

`scripts/check-evidence-closure.mjs` implements a strict, append-only candidate
overlay validator with these fail-closed properties:

1. An empty overlay is a valid audit state but always reports release weight
   `0`; registry status and scanner health also have weight `0`.
2. Candidate selection requires `--candidate` with a full commit object ID. The
   CLI additionally requires a clean checkout, a candidate that is an ancestor
   of the overlay commit, and canonical, committed overlay, registry,
   release-map, and checklist paths.
3. Candidate registry, release map, checklist, commit tree, spec tree, and the
   deterministic recursive spec listing are read from Git objects and digest
   checked. Dirty worktree files never substitute for candidate bytes.
4. Every current release-root ancestor must have a record. Each record repeats
   the exact candidate binding, binds the candidate task contract, retains an
   exact argv/cwd/non-secret environment/result/report, and verifies all report
   and artifact bytes against the candidate commit.
5. Independent reviewer identity, an independently digested review report,
   explicit exclusions, and fallback mode are mandatory. Reviewer and producer
   identities must differ.
6. Record IDs and canonical record digests are immutable. Supersession is a
   single append-only per-task chain: duplicate, dangling, cross-task, cyclic,
   branching, reordered, or non-monotonic history fails. Explicit candidate
   mode also compares the committed overlay with its prior Git history and
   rejects deleted or rewritten candidates and records.
7. Only the latest `passed` record contributes task weight. Latest `failed` or
   `reopened` records invalidate prior passes; a later reviewed pass may reclose
   the task without deleting history.
8. Unknown structural fields and source/root/cutoff/policy drift fail closed.
   Error output has stable machine-readable codes and a JSON mode.

The canonical manifest intentionally contains no candidate entries. Its current
audited result is therefore `0` release weight; no historical task was silently
promoted.

## Verification evidence

| Gate | Result |
|---|---|
| `corepack pnpm check:evidence-closure` | Passed: audit-only JSON reports dynamic `93` required tasks, `0` candidates, and `0/93` weight; 64 hostile/success assertions passed. The observed count is evidence, not a code constant. |
| Complete synthetic candidate | Passed: generated clean two-commit fixture (candidate plus committed overlay), full dynamic ancestor coverage, exact Git/digest binding, full selected weight. |
| Hostile candidate suite | Passed: missing/abbreviated/unrelated candidate, missing task, wrong commit/tree/spec/source/task/file/record digest, dirty worktree, deleted committed history, duplicate candidate/record, dangling/cyclic/branching supersession, failed/reopened latest record, forged historical completion, missing commands/environment/result/reports/reviewer/exclusions, self-review, sensitive environment capture, root impersonation, unknown fields, and policy/source/root/cutoff drift. |
| `corepack pnpm check:release-map` | Passed: 178/178 mappings and 34 tests. |
| `corepack pnpm check:docs` | Passed: 201 local Markdown links. |
| Scoped `git diff --check` | Passed. |

## Remaining independent gate

This implementation record does not accept its own public release control.
Before `CTRL-EVIDENCE-BACKFILL-075` is marked complete, a separate reviewer must
audit the schema, Git-object trust boundary, error precedence, supersession
semantics, negative suite, package/CI wiring, and the explicit zero-weight
canonical state. No release candidate exists in the manifest at this point.
