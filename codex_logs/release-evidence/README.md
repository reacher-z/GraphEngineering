# Candidate revalidation evidence

`task-revalidation.json` is an append-only overlay for immutable release
candidates. The canonical file intentionally starts with an empty `candidates`
array. Audit-only validation succeeds in that state but always reports zero
release weight.

A release decision must run:

```text
node scripts/check-evidence-closure.mjs --candidate <full-commit-sha> --json
```

from a clean, non-shallow checkout. The selected candidate and every candidate
already retained by the overlay must be ancestors of the overlay commit. The
checker reads candidate sources, reports, and artifacts from regular Git blobs;
worktree bytes, symlinks, replace refs, grafts, skip-worktree entries, and
assume-unchanged entries cannot substitute for those objects.

## Record coverage

Every task record binds the exact candidate task contract and contains
`commands`, `artifacts`, and a `coverage` object. Coverage is positional and
closed:

```json
{
  "coverage": {
    "tests": [
      {
        "requirement": "the exact expected_tests string",
        "command_indexes": [0]
      }
    ],
    "artifacts": [
      {
        "requirement": "the exact expected_artifacts path",
        "artifact_indexes": [0]
      }
    ]
  }
}
```

- Coverage entries must occur exactly once and in the same order as the
  candidate registry contract. Missing, duplicate, invented, or reordered
  requirements fail.
- Every index must exist, every command and artifact must be referenced, and
  duplicate indexes inside an entry fail.
- An artifact must be the expected path or a regular file below its exact
  `expected/path/` boundary. A similarly prefixed sibling path does not count.
- A passed record may reference only passed commands. Exact argv, cwd,
  non-secret environment, exit status, timestamps, result report, artifact
  digests, coverage, review, exclusions, and fallback mode are protected by the
  record digest.

Machine validation proves exact binding and complete coverage declarations. It
does not understand whether a command meaningfully tests a natural-language
requirement or whether a report's conclusions are true. The distinct
independent reviewer remains responsible for that semantic judgment, and the
review report is itself an immutable candidate blob.

## Supersession and history

Records form one linear per-task `supersedes` chain. A later record must use
commands and review timestamps strictly newer than the superseded record and
must not reuse any earlier command or review report path or digest. Latest
`failed` and `reopened` records invalidate earlier passes.

Candidate mode walks every parent edge in the complete overlay ancestry and
checks the full retained candidate and record prefixes. A deletion or rewrite
therefore remains detectable even if unrelated commits follow it. Explicit
resource ceilings bound manifest/source/blob sizes, candidates, tasks, records,
commands, artifacts, environment fields, strings, and history traversal.
