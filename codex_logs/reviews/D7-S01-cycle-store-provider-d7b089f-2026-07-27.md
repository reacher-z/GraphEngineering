# D7-S01 provider-neutral CycleStore contract evidence

## Decision

`D7-S01 provider-neutral CycleStore contract and conformance` is accepted for
its bounded implementation scope at the immutable implementation commit below.
The accepted scope includes the provider protocol, native TypeScript and
Python in-memory reference models, closed descriptor schema, stable error
taxonomy, append/CAS/idempotency semantics, snapshot pagination, checkpoint
cache, leases and fencing, tenant authorization, governance controls, 54-case
dual-runtime conformance, documentation, and package inclusion.

This report does not claim SQLite or PostgreSQL adapter completion, distributed
database validation, D7 completion, release-roll-up closure, or any GitHub Star
outcome. Those remain open downstream work.

Evidence captured on 2026-07-27 after a detached-worktree verification of the
exact implementation tree.

## Immutable Git identity

- implementation commit:
  `d7b089f1adec92ba18a69e69748a77e7615d5a4c`;
- tree: `cd77b3cab4e17c0a9a143a5576c7896ce7d7bb89`;
- parent: `e51db58aa51ccd020d875389849352e76fe84e88`;
- subject: `add provider-neutral cycle store contract`;
- author: `reacher-z <mtrxcop@gmail.com>`;
- committer: `reacher-z <mtrxcop@gmail.com>`;
- body: empty, with no coauthor trailer;
- commit time: `2026-07-27T12:08:35-07:00`.

The commit was pushed to `origin/feat/authoring-foundation`. A post-push fetch
resolved local `HEAD`, `FETCH_HEAD`, and the remote-tracking reference to the
same full object ID above before the cold worktree was created.

## Append-only plan proof

The execution contract is section 31.29 of:

`codex_plans/Graph-Engineering-21-Day-Master-Plan.md`

The parent-to-implementation diff for that file is exactly 503 additions and
zero deletions. Its only diff hunk begins after the prior 4,664-line end of
file. No earlier master-plan line was changed or marked complete.

## Delivered contract

The implementation adds a provider-neutral asynchronous API in both native
languages for:

- descriptor discovery and validation;
- atomic multi-record append with expected sequence and expected tail hash;
- operation-key idempotency with exact retry recovery after an ambiguous
  commit acknowledgement;
- immutable event pages with single-use, provider-versioned snapshot cursors;
- checkpoint save, load, list, and delete operations;
- lease acquire, renew, release, inspect, expiry takeover, epoch progression,
  and fence-bound writes;
- tenant authorization before existence checks;
- legal-hold inspection and mutation refusal;
- exclusive migration lock acquisition, renewal, release, takeover, and
  incompatible online-write exclusion;
- schema-version discovery;
- bounded provider state and payload-free diagnostics; and
- test-only deterministic clocks, fault boundaries, corruption hooks, and
  counter snapshots.

The TypeScript and Python implementations independently enforce:

- capture-before-await and caller-object detachment;
- tenant-wide record-ID uniqueness;
- exact retry lookup before live CAS, lease-expiry, fence, and migration
  checks;
- snapshot isolation for appends that occur during pagination;
- cursor scope, page-size, expiry, and replay binding;
- monotonic provider time and refusal of clock rollback;
- immutable checkpoint identity and event-authority separation;
- stale or expired fence rejection;
- fence and epoch overflow refusal;
- active incompatible migration exclusion;
- authorization failure without existence disclosure;
- closed input objects and bounded portable JSON; and
- payload-free serialized provider errors.

The stable closed error set contains exactly:

1. `GE_CYCLE_STORE_INVALID_ARGUMENT`;
2. `GE_CYCLE_STORE_INVALID_CURSOR`;
3. `GE_CYCLE_STORE_NOT_FOUND`;
4. `GE_CYCLE_STORE_CONFLICT`;
5. `GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT`;
6. `GE_CYCLE_STORE_LEASE_CONFLICT`;
7. `GE_CYCLE_STORE_STALE_FENCE`;
8. `GE_CYCLE_STORE_UNAVAILABLE`;
9. `GE_CYCLE_STORE_CORRUPTION`;
10. `GE_CYCLE_STORE_QUOTA_EXCEEDED`;
11. `GE_CYCLE_STORE_PERMISSION_DENIED`;
12. `GE_CYCLE_STORE_UNSUPPORTED_VERSION`;
13. `GE_CYCLE_STORE_LEGAL_HOLD`;
14. `GE_CYCLE_STORE_MIGRATION_LOCKED`; and
15. `GE_CYCLE_STORE_INTERNAL`.

Every error carries the exact provider operation, stable retryability, a safe
message, and bounded safe details. Generic exceptions cannot satisfy a
conformance attack that expects a provider error.

## Portable identities

The independently constructed TypeScript and Python reports retained these
identities:

- reference descriptor hash:
  `8a0caf1fd5c58a94ae15a627098396a033e7026ead96756ea8e7ad6998b6de4c`;
- conformance cases: 54 total, 26 behaviors, and 28 attacks;
- case-list canonical bytes: 14,288;
- case-list canonical SHA-256:
  `4c9e40becaba72eed5ae06f95d016d0e7e08806c4e915bf2b0ae16eb16c0b725`;
- conformance probe record hash:
  `6639322ad64aa287c1be2f6076c3bfb7c26a348d026aff0a9300035875a1c6bb`;
- conformance probe operation hash:
  `55f0de54ede354f7f4602a85aa0c37f2c7650fc5a5a7553cb54dcb5672512d85`.

The aggregate final counters across fresh per-case providers are 44 streams,
70 records, 70 record IDs, six checkpoints, 12 lease streams, 74 idempotency
entries, four retained hostile cursors, one legal hold, and aggregate migration
fence four.

Raw committed source SHA-256 identities are:

- descriptor schema:
  `daa375017ad7131976637e9fe5dbff8d9a59052d27a5b03d76291cb8dad21d0d`;
- conformance case file:
  `ff467d8a2576a818dc9684414eb2849eb929d2c36febdcdff1a4e3b30397a34a`;
- TypeScript provider:
  `13040240cbaa606527cfa8c981501030a2a6abf484fc7876cc7748968edb3ba8`;
- Python provider:
  `8580759096d0f9bcf53a55bc6c363df39ed6a0d435dd6887d334553f617f75a8`;
- TypeScript conformance runner:
  `2d21da17a61ba08b7ed81513e99cf5850d90a1c72b422cdc98277de6b156922c`;
- Python conformance runner:
  `ae3fe5ec11131bb0905a2212cca4511e4533f53f046277dca6ea0f0b1ab3f4b1`.

## Detached-worktree verification

The cold worktree was created at the explicit temporary path:

`/tmp/graph-engineering-d7-s01-cold-u7NzK7xk`

It was detached directly at the implementation commit. Before and after all
gates, `git status --short --untracked-files=all` was empty, `git diff
--exit-code` passed, and `HEAD` remained the exact implementation object ID.

Environment versions were:

- Node.js `v22.23.1`;
- pnpm `10.13.1` through Corepack;
- uv `0.11.11`;
- the project Python environment used CPython `3.14.0`; and
- isolated artifact smoke environments used system CPython `3.14.4`.

Locked prerequisites and build:

1. `corepack pnpm install --frozen-lockfile` passed with all 142 packages
   reused and zero downloads.
2. `uv sync --project python --frozen --extra dev` passed and installed the
   runtime plus explicit development extra into `python/.venv`.
3. `corepack pnpm build` passed for all seven publishable workspace projects.

Native and static gates:

1. `corepack pnpm test` passed with zero failures:
   - runtime: 210;
   - core: 166;
   - primitives: 147;
   - CLI: 147;
   - patterns: 93;
   - persistence: 27;
   - MCP server: 15;
   - total: 805 tests.
2. `uv run --project python pytest -q` passed 1,118 tests plus two subtests in
   70.57 seconds.
3. `corepack pnpm lint` passed all seven publishable packages.
4. `corepack pnpm typecheck` passed all seven publishable packages.
5. From `python/`, `uv run ruff check .` passed.
6. From `python/`, `uv run mypy src` passed with no issues in 36 source files.
7. `python3 -m py_compile scripts/check-python-artifacts.py
   tools/conformance/python_cycle_store_provider_report.py` passed.
8. `corepack pnpm validate:fixtures` passed the committed-tree inventory of
   61 JSON fixtures and 26 case manifests, including the exact closed
   CycleStore descriptor schema and all 54 cases.
9. `corepack pnpm check:docs` checked 255 committed local Markdown links.

Release and supply-chain gates:

1. `corepack pnpm check:release-map` passed 178/178 exact release leaves and
   all 40 checker tests. The map retained 175 blocking and three non-blocking
   leaves, 107 registry tasks, and an acyclic dependency graph.
2. `corepack pnpm check:evidence-closure` returned audit-only `ok: true` and
   passed all 102 fail-closed tests. No release weight was claimed.
3. `corepack pnpm audit:prod` found no known production vulnerabilities.
4. `corepack pnpm check:packages` passed the private-workspace leak guard and
   all seven npm manifests and dry-run tarballs. The runtime tarball contained
   67 files.
5. `corepack pnpm check:packed-install` installed and smoke-tested all seven
   tarballs, rewrote workspace dependencies, and verified installed bins.
6. `uv build --project python` built the wheel and sdist from the exact tree.
7. `python3 scripts/check-python-artifacts.py` validated 43 wheel entries and
   44 sdist entries, installed both archives into independent environments,
   and passed entry-point, YAML authoring, validate, doctor, provider public
   import, descriptor-identity, and record-identity probes.

The rebuilt Python artifact SHA-256 identities are:

- wheel:
  `d9ba7df30f09bb8bc45c8b2267597955a2b483c923efbb322a3a3e06dbfe9bcd`;
- sdist:
  `b6d98930ecb202a9d90b1c74fe5ea3873269492de78d24066f606c38e5e0b9`.

Both archives were required to contain
`graph_engineering/cycle_store_provider.py` at their format-appropriate path.

## Complete conformance result

`corepack pnpm test:conformance` exited zero at the exact implementation tree.
It passed:

- 14 graph fixtures;
- 24 RFC formatter vectors, 13 portable values, 15 public-boundary
  rejections, and 10,000 seeded finite bit patterns;
- runtime ready queues, invalid output/cancellation, eight settled barriers,
  12 route-selection cases, persistence, durable recovery, and terminal
  history interoperability;
- eight bounded-pipeline cases;
- 54 hostile GraphPatch shape attacks across eight categories;
- 24 hostile GraphPatch semantic cases;
- 34 hostile GraphPatch restore cases;
- 20 cycle-controller lineage cases;
- all 54 CycleStore cases with complete native report equality;
- 132 exact native-cycle baseline events;
- 24 activity inputs;
- 855 durable fault obligations over 171 boundaries;
- 100 executable lease-renew/release recoveries;
- 68 exact activity cancellation/timeout recoveries;
- 25 pause/resume/replay/fork interruption recoveries;
- 35 PatchAccepted visibility fault recoveries;
- 15 PatchAccepted checkpoint fault recoveries;
- all three controller modes and retained terminal/in-doubt outcomes; and
- every authoring path, valid source, diagnostic, failure, and identity
  mutation in the retained authoring campaign.

TypeScript and Python each construct their own provider, descriptor, records,
operations, clocks, expected identities, and final observations. The
conformance join compares the complete normalized reports, rather than only a
pass count or selected hash.

## Repair and falsification ledger

No failed observation was counted as passing evidence.

### Immutable constructor test repair

The first focused TypeScript test attempted to mutate a value obtained from an
intentionally frozen constructed record. The test was corrected to mutate the
original caller-owned object and prove detachment; production immutability was
not weakened.

### Migration fence setup repair

The initial live-migration test supplied stale expected fence zero after fence
one existed and correctly received `GE_CYCLE_STORE_STALE_FENCE`. The test was
corrected to supply the live fence and then verified
`GE_CYCLE_STORE_MIGRATION_LOCKED`.

### Descriptor generalization

The first validator accepted only the in-memory reference descriptor. It was
generalized to accept closed stronger durable profiles and smaller advertised
limits while preserving fixed capability vocabularies, ceilings, and exact
descriptor hashes.

### Migration write exclusion

The initial reference model did not block online writers during an active
incompatible migration. Every online mutation now checks the lock after
idempotency recovery and before mutation.

### Cursor and lease classification

Malformed cursors initially produced a generic invalid-argument error and
expired cursor state was retained. The final implementation returns the exact
invalid-cursor code and cleans same-scope expired state. Lease release also now
rejects an exact but expired identity as stale.

### Conformance harness baseline

One first-pass TypeScript harness assertion compared a read-only case's state
against an empty provider before scenario setup. The harness now snapshots
attacks after setup and proves zero unintended mutation; behavior cases retain
exact final-state assertions.

### Cold Python development extra

The first cold sync intentionally used only `uv sync --frozen`. The project
declares pytest under optional extra `dev`, so `uv run ... pytest` resolved a
user-level pytest outside the worktree and collection could not import the
worktree package. That failed result was rejected. Diagnostics proved the
worktree Python itself imported the package correctly, the environment was
resynchronized with `--extra dev`, and all 1,118 tests plus two subtests then
passed from the local environment.

## Dirty-worktree exclusions

The primary shared worktree retained unrelated D4, D9, D10, security,
task-registry, and progress-scanner work. The implementation commit and this
evidence intentionally exclude:

- `codex_logs/daily/2026-07-26.md`;
- `codex_logs/task-registry.json`;
- `codex_plans/architecture/security-and-isolation.md`;
- `codex_plans/delivery/d9-redaction-implementation-brief.md`;
- untracked D4 and D9 review logs;
- untracked budget, redaction, protected-value, capture, subgraph-edge,
  checkpoint-v1alpha2, event-v1alpha2, model-router, pricing, artifact, and
  sink-guard schemas, semantics, cases, and validators; and
- `tools/progress-scanner/uv.lock`.

The committed-tree counts of 61 JSON fixtures, 26 case manifests, and 255
Markdown links are the authoritative cold evidence. Larger warm-tree counts
included unrelated uncommitted paths and are only development observations.

## Reviewer and agent boundary

The three pre-existing subagents remained unavailable because their service
quota was exhausted until `2026-08-02 15:10`. They were not retried and their
absent output is not represented as review evidence. Executable independence
is retained through separate native implementations, native tests, native
report processes, and a complete structural differential join. This does not
impersonate an independent human or separate-agent review.

## Remaining open work

The next planned D7 milestone is the SQLite adapter on top of this exact
provider contract, followed by the PostgreSQL adapter and fault-backed adapter
parity. Required future work includes real transaction isolation, process
restart durability, database migration execution, database-native
concurrency, multi-process fencing, backup/restore, performance characterization,
and adapter-specific operational documentation.

This S01 report must not be used to claim the 21-day plan, release, or 5K/6K
Star objective complete.
