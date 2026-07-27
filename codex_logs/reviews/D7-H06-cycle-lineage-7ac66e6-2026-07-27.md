# D7-H06 multi-generation cycle-lineage evidence

## Decision

`D7-H06 lineage model` is accepted for its bounded implementation scope at the
immutable implementation tip identified below. This decision covers native
TypeScript and Python root-to-target lineage export, closed-manifest
validation, offline replay, fork-of-fork resolution, adversarial conformance,
documentation, and package inclusion.

It does not close D7 as a whole, the production `CycleStore` work, SQLite,
PostgreSQL, the release roll-up, or any popularity/Star target. Those remain
open and must not inherit release weight from this report.

Evidence captured: `2026-07-27T18:10:03Z`.

## Immutable Git identities

Final implementation tip:

- commit: `7ac66e631500e23e73d7a6b7fe9ff49ecb908635`
- tree: `89c479b2f17ca119f688d12bff7ccff241bd1dbe`
- parent: `afa2c7c70f5da512e9b0086ec9ecafcdd65ee697`
- subject: `require lineage in Python package audits`
- author: `reacher-z <mtrxcop@gmail.com>`
- committer: `reacher-z <mtrxcop@gmail.com>`
- body: empty; no coauthor trailer
- commit time: `2026-07-27T10:59:53-07:00`

Primary H06 implementation commit:

- commit: `afa2c7c70f5da512e9b0086ec9ecafcdd65ee697`
- tree: `23194690de088a3305e42c96b2a3d88f72e2ecfb`
- parent/base: `ae826eaebfb65836d88c3b6fa33d5bc469bce0a0`
- subject: `add multi-generation cycle lineage manifests`
- author and committer: `reacher-z <mtrxcop@gmail.com>`
- body: empty; no coauthor trailer
- commit time: `2026-07-27T10:47:51-07:00`

The final tip changes only the development log and Python artifact audit on top
of the primary implementation. Both commits were pushed to
`origin/feat/authoring-foundation`. A post-push fetch produced left/right
divergence `0 0`, and both local and remote resolved to
`7ac66e631500e23e73d7a6b7fe9ff49ecb908635` before this evidence file was
created.

## Append-only plan proof

The H06 execution contract was appended as section 31.28 to:

`codex_plans/Graph-Engineering-21-Day-Master-Plan.md`

The base-to-primary-implementation diff for that file is exactly:

- additions: 344 lines
- deletions: 0 lines

No pre-existing plan line was modified by H06.

## Delivered contract

The implementation adds these public capabilities in both languages:

- bounded root-to-target lineage export;
- recursive ancestor resolution by durable controller-run identity;
- a closed `v1alpha1` manifest with fixed limits and a domain-separated hash;
- validation of every embedded event prefix through the native fold;
- direct parent-binding validation at every edge;
- duplicate run, duplicate stream, cycle, missing ancestor, truncation,
  substitution, target drift, count drift, and open-object refusal;
- offline replay without stores, handlers, leases, clocks, or dispatch;
- optional terminal-target enforcement;
- native TypeScript fork-of-fork support when the parent store advertises the
  lineage resolution capability;
- fail-closed behavior when a forked parent lacks that capability;
- physical store-key/request stream-ID binding in both memory stores;
- unique controller-run indexing in the TypeScript memory store;
- a Draft 2020-12 schema, normative semantics, package exports, and user docs;
- a dual-runtime 20-case conformance campaign with complete report comparison;
  and
- package audits that now require `cycle_lineage.py` in both wheel and sdist.

Contract bounds are fixed at:

- maximum ancestry depth: 32 edges;
- maximum streams: 33;
- maximum total embedded events: 1,024; and
- maximum canonical manifest bytes: 16,777,216.

## Portable identities

Case campaign:

- cases: 20 total;
- behaviors: 4;
- attacks: 16;
- case-list canonical bytes: 2,879;
- case-list canonical SHA-256:
  `4fc297589a67621570a067c1cfc072888632128c7ab794dcba88baac070d5713`;
- case-file raw SHA-256:
  `f7a967b9e1d160906ea9f5fda9df59247776a47413f2559b03b3417201dd9f8c`.

Portable root-to-grandchild manifest:

- streams: 3;
- total events: 4;
- canonical bytes: 18,392;
- raw canonical SHA-256:
  `67b436c51ea8395b380579453758ffed0273cecef6ac4f4a012981c18bc01084`;
- domain-separated manifest hash:
  `05f3503d99ba4918e6430843534ad739cd5dc0fe59a0fca4bd6ab33787df4d58`.

Raw immutable source identities at the final tree:

- manifest schema:
  `b5fe95479282199c6518eeb54b1bd50d809765390f1b5d4b8947e66ad69a1636`;
- TypeScript lineage implementation:
  `0e16862e99c3c36db183b085f4389060f9caddf56d83abb01bb99648a2660e63`;
- Python lineage implementation:
  `46cb48d6fd28062f7b966466a03dbc38114c767993bffac99c1d8b6ace5c2b58`;
- TypeScript conformance runner:
  `9dc7cdcbaedb58d4d661c2d085c2fc4791dab2b480fdb2db40785222a0514c3e`;
- Python conformance runner:
  `707f5bc06a96341ac94b2faa6c33d33fb2a09babc69ad01b2bd19ea8d99be12d`.

## Final detached-worktree proof

The final verification worktree was created from the exact final tip at:

`/tmp/graph-engineering-h06-final.459pZi`

Before dependency installation it reported detached `HEAD`, no tracked or
untracked changes, commit
`7ac66e631500e23e73d7a6b7fe9ff49ecb908635`, and tree
`89c479b2f17ca119f688d12bff7ccff241bd1dbe`.

Prerequisites were installed from locked inputs:

1. `corepack pnpm install --frozen-lockfile` — passed; 142 packages reused,
   zero downloads.
2. From `python/`, `uv sync --extra dev --frozen` — passed; the runtime and dev
   tools were installed into the worktree-local environment.
3. `corepack pnpm build` — passed for all seven public workspace packages.

The following commands then passed at that exact tree:

1. `corepack pnpm test`
   - core: 166;
   - persistence: 27;
   - primitives: 147;
   - MCP server: 15;
   - patterns: 93;
   - runtime: 194;
   - CLI: 147;
   - total: 789 passed, zero failed.
2. From `python/`, `uv run pytest -q`
   - 1,091 passed, zero failed.
3. `corepack pnpm lint`
   - all seven public packages passed.
4. `corepack pnpm typecheck`
   - all seven public packages passed.
5. From `python/`, `uv run ruff check .`
   - passed.
6. From `python/`, `uv run mypy src`
   - passed with no issues in 35 source files.
7. `corepack pnpm validate:fixtures`
   - 60 committed JSON fixtures;
   - 25 committed case manifests;
   - seven D7 controller/revision/event/checkpoint/lineage schemas;
   - 20 lineage replay/corruption cases;
   - 855 retained durable fault obligations;
   - all other reported fixture joins passed.
8. `corepack pnpm check:docs`
   - 248 committed local Markdown links checked.
9. `corepack pnpm check:release-map`
   - 178/178 exact leaves;
   - 175 blocking and three non-blocking;
   - 107 registry tasks;
   - acyclic dependency graph;
   - 40 checker tests passed.
10. `corepack pnpm check:evidence-closure`
    - audit-only result `ok: true`;
    - 102 tests passed;
    - no release weight was claimed.
11. `corepack pnpm audit:prod`
    - no known vulnerabilities found.
12. `corepack pnpm test:conformance`
    - 14 graph fixtures passed;
    - 10,000 seeded canonical-number bit patterns passed;
    - 54 hostile GraphPatch shape attacks passed;
    - 24 hostile GraphPatch semantic cases passed;
    - 34 hostile GraphPatch restore cases passed;
    - all 20 lineage cases passed: 16 attacks and four behaviors;
    - 132 exact native-cycle baseline events passed;
    - 855 durable fault obligations over 171 boundaries passed;
    - 100 lease-renew/release recoveries passed;
    - 68 activity cancellation/timeout recoveries passed;
    - 25 public-operation interruption recoveries passed;
    - 35 PatchAccepted visibility recoveries passed;
    - 15 PatchAccepted checkpoint recoveries passed;
    - complete authoring conformance passed.
13. `corepack pnpm check:packages`
    - private-workspace leak guard passed;
    - all seven npm manifests and dry-run tarballs passed;
    - runtime tarball contained 63 files.
14. `corepack pnpm check:packed-install`
    - all seven pnpm tarballs installed and smoke-tested;
    - rewritten workspace dependencies and installed bins were healthy.
15. `uv build --project python`
    - built one wheel and one sdist from the exact tree.
16. `corepack pnpm check:python-package`
    - 42 wheel entries and 43 sdist entries passed;
    - both formats installed in isolated environments;
    - entry points, shared YAML authoring, validate, and doctor passed;
    - the hardened audit required `cycle_lineage.py` in both archives.

The rebuilt Python artifact identities were:

- wheel SHA-256:
  `b6c8f3cf14e1f6d9831c1423cfeab969bf3358fe37cb026ec79858f67c0added`;
- sdist SHA-256:
  `841c1e1c4dc412ccda6ee55a4c468938c5d2c6167020eaeed5dfded38b830ff1`.

Archive inspection found exactly these required paths:

- wheel: `graph_engineering/cycle_lineage.py`;
- sdist:
  `graph_engineering-0.1.0a1/src/graph_engineering/cycle_lineage.py`.

The final worktree status remained clean after all gates. Its commit and tree
still matched the identities above. The temporary worktree was then removed
with an explicit path; no project or user data was deleted.

## Repair and falsification ledger

No failed observation was counted as passing evidence.

### Sibling-isolation test construction

The first development-tree TypeScript workspace run passed 193 of 194 runtime
tests but failed the new sibling assertion. Investigation showed the helper had
fed `root-seen` to the sibling while the assertion expected `sibling-only`.
The helper was changed to emit the branch-specific key. The focused group then
passed 3/3 and the complete workspace passed 789/789. Production validation was
not weakened.

### Concurrent npm artifact writer

One development-tree package-content run raced with packed-install while the
latter rebuilt CLI `dist`, observing a transient missing `index.d.ts`. That
result was rejected. The file was present after the writer completed and the
content audit passed alone. All final cold package gates were serialized and
passed.

### First cold-worktree prerequisite attempt

The first cold worktree deliberately started from only installed dependencies.
Workspace tests demonstrated that this repository requires a workspace build
before package tests resolve local declaration outputs. The first Python
attempt also used a runtime-only sync, so a system pytest could not import the
worktree package. Those results were rejected. The final proof uses the
documented build order and the explicit Python `dev` extra.

### Stale Python artifacts

The development tree initially audited a pre-existing 41-entry wheel and
42-entry sdist without rebuilding them. Cold `uv build` produced the correct
42/43 artifacts containing the new module, revealing that the audit's required
path set did not explicitly name `cycle_lineage.py`. The final implementation
tip hardens both wheel and sdist checks, and the complete final cold proof was
repeated at that new tip.

## Dirty-worktree exclusions

The shared primary worktree contained unrelated D4, D9, D10, security,
task-registry, and progress-scanner work. H06 commits intentionally excluded:

- `codex_logs/daily/2026-07-26.md`;
- `codex_logs/task-registry.json`;
- `codex_plans/architecture/security-and-isolation.md`;
- `codex_plans/delivery/d9-redaction-implementation-brief.md`;
- the untracked D4/D9 review logs;
- the untracked budget, redaction, protected-value, capture, subgraph-edge,
  checkpoint-v1alpha2, event-v1alpha2, router, pricing, and artifact schemas,
  semantics, fixtures, and validators; and
- `tools/progress-scanner/uv.lock`.

The committed-tree fixture count of 60/25 and link count of 248 are therefore
the authoritative H06 evidence. The larger dirty-tree counts of 63/28 and 269
included unrelated uncommitted files and are retained only as development
observations.

## Reviewer and agent boundary

The three pre-existing subagents were unavailable because their service quota
was exhausted until `2026-08-02 15:10`. They were not retried, and their failed
or absent output was not represented as independent review. Independence was
preserved at the executable boundary through separately implemented
TypeScript/Python runners and complete structural report comparison, but this
does not impersonate a human or separate-agent acceptance review.

## Remaining open work

The next D7 dependency is `D7-S01 provider-neutral CycleStore conformance`:

- provider operations and capabilities;
- closed error taxonomy;
- reference model;
- CAS and idempotency semantics;
- exact pagination;
- checkpoint-cache semantics;
- lease and fencing behavior;
- authorization and tenant isolation hooks;
- corruption and ambiguous-commit cases; and
- native TypeScript/Python differential conformance.

SQLite and PostgreSQL adapters must remain downstream of that provider
contract. H06 does not authorize claiming the repository plan, release, or
5K/6K Star objective complete.
