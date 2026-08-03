# SQLite P11-A NP1 runtime implementation log — 2026-08-03

## Scope and current disposition

This record covers only the bounded `main.baseline-entries` lower-native
projection tranche inside task `D9-SQLITE-OWNER-COMPOSITION-P11-094`. The
canonical contract is bound by commit
`96eec95022ab6ac96bbea1e0886de6198d355c01`. The implementation working tree is
now a tested acceptance candidate, but this log does not itself make it
immutable: the runtime commit SHA and ref equality remain to be appended after
the intentional commit and push.

P11 remains `in_progress`. NP1 does not close global P11-A route discovery,
P11-B/C/D, stage 18, the unconsumed third clock, COMMIT, D9, RC/stable, release
evidence, GitHub stars, or popularity. Release evidence remains audit-only at
`0/93`; stars remain a post-publication measurable goal, never an implementation
guarantee.

## Append-only plan and contract binding

- The repository HEAD plan prefix is exactly 23,484 lines with SHA-256
  `fcff41d3c4533ef877220b5611485e2e6cd6c32b5a4b38b56709f8f3c63372a9`.
- The working plan has 23,623 lines. It only appends sections 31.37.101 through
  31.37.104; `cmp` proves the complete HEAD prefix is byte-identical.
- The 23,510-line pre-31.37.102 prefix remains
  `686092349089eb71ce95e5dcf89929a198e9e9d9cdfa386ec0a995395475bade`.
- The 23,575-line pre-31.37.103 prefix remains
  `786fc6e992240949ecf17035a5f3babedb7d09fb49f17d0a88293ad35911f09f`.
- The 23,600-line pre-31.37.104 prefix remains
  `812aad2d926a0a778dd098bec5d8cdc6426eb645b7af9d86bb5e1642f5cfd9a6`.
- Section 31.37.103 freezes the cross-runtime normalizer to ASCII SQL
  formatting whitespace only. Section 31.37.104 distinguishes zero surviving
  failure authority from truthful historical mint/consume transitions.
- The P11 Markdown raw SHA-256 is
  `363786579a357b03113dfb767e04a382b2660dc6e2be4f27c20455efefe8e311`
  and is enforced by its executable validator.

## Implemented runtime boundary

### TypeScript

- Drains all twelve definition-owned SQLite v1 source families in canonical
  order through real file-backed native statements and iterators.
- Records exact statement/iterator retirement, normalized/raw SQL digests,
  expected/observed counts, projection/source digests, and a distinct read
  session commitment.
- Atomically adopts the opaque lower token, consumes its receipt, issues the
  reusable parent, strongly retains the projection until parent consumption,
  and releases it on legal consume or terminal failure.
- Uses definition-captured Object, Array, Map, Set, WeakMap, native statement,
  codec, bounded-JSON, and transaction-owner intrinsics across the reachable
  authority path. The hostile success probe replaces every covered ambient
  constructor/prototype and observes zero calls and no raw authority.
- Every source, consumer, and parent-issue fault poisons the composition. Replay
  after failure returns a terminal rejection without a second P9 cleanup.

### Python

- Uses an import-leaf one-shot bridge, closure-private source/receipt/parent
  registries, exact source/connection/generation reproof, and a sole atomic
  drain/adopt entry. Bootstrap installers, invokers, and registry factories are
  removed from live module namespaces after definition-time binding.
- Binds the private lower-native parent to the canonical route, immutable
  expected/retained count, receipt snapshot, and an independently advanced full
  lifecycle/counter signature. Count, route, provenance, lifecycle, and
  coordinated-counter rewrites terminalize instead of upgrading authority.
- Parent consume captures its exact release/advance closures; a caller cannot
  replace cleanup through an optional/default callable.
- Resource pairing retains the twelve exact `sqlite3.Cursor` objects returned
  inside the owner-execute capabilities, validates exact type and unique
  identity, observes terminal, and proves close attempt/native return 1/1.
  Synthetic pairing nonces were removed.
- The bridge immediately tombstones an abandoned receipt while preserving the
  exact adoption primary over any cleanup secondary.

## Executable reports and parity

- The strict NP1 JSON Schema rejects all extra object fields and freezes the
  three success cases, two impossible-total rejections, twelve-family vectors,
  authority booleans, cleanup, and nonclaims.
- The semantic validator independently freezes all twelve normalized SQL
  digests and rejects case/family reorder, count drift, oracle substitution,
  runtime/raw inventory drift, and portable divergence.
- Both reporters run real temporary file-backed SQLite fixtures. TypeScript and
  Python each emit exactly one key-sorted canonical JSON line. TypeScript output
  is 14,337 bytes; repeated runs are byte-stable.
- Each runtime first verifies its exact structured native error code/message
  and P9 counters. Runtime-specific codes are then mapped to the canonical
  `pre-native-source-conservation` portable stage; a caller stage label is not
  accepted as evidence.

## Closed adversarial findings

The implementation was repeatedly rejected until each reproduced finding was
closed. Material examples include:

- mutable Python registry/token/record authority and presentation-synchronized
  forgery;
- lost strong retention, released-parent lifecycle rewind, and native-to-shape
  provenance downgrade;
- Python expected-count/descriptor/counter rewrites that previously turned a
  real total-three parent into false zero completion;
- a live bridge pipeline invoker that previously allowed producer failure
  outside P9 cleanup;
- caller-replaceable parent release and synthetic instead of raw-cursor pairing;
- TypeScript late WeakMap/Object/Array/Map/Set/codec hooks that could observe or
  disturb raw identities;
- TypeScript composition state remaining active after lower source or consumer
  failure;
- non-canonical TypeScript reporter output and Unicode-whitespace disagreement;
- receipt authority retained through consume-before/after fault tracebacks.

The independent Python whole-diff review concluded `H0 / M0 / L0` after 41/41
focused tests. The cross-runtime integration reviewers found no remaining code,
contract, schema, parity, or nonclaim defect after the final composition,
canonical-report, plan-correction, log, and artifact-inventory fixes. The final
fresh post-log acceptance audit concluded `H0 / M0 / L0` with no blocker.

## Accepted candidate test evidence

- `corepack pnpm test:sqlite-native-projection-runtime`: exit 0
  - NP1 schema/semantic hostile contract: 6/6
  - SQLite TypeScript typecheck: pass
  - TypeScript NP1 focused plus isolated GC: 183/183
  - Python NP1 focused, including the 314-case family/boundary/row matrix:
    41/41
  - Python Ruff: pass
  - strict mypy over four source modules plus standalone reporter: pass
  - required cross-runtime parity: 2/2
- P11 owner-composition runtime: parity 3/3, TypeScript 81/81, Python 83/83,
  Ruff/mypy/typecheck pass.
- P9 transaction-owner runtime: parity 2/2, TypeScript 27/27, Python 36/36.
- P10 Rule 12 runtime: parity 2/2, TypeScript 29/29, Python 41/41;
  typecheck pass.
- Baseline-source regression: TypeScript 13/13 and Python 47/47.
- Runtime package regression after shared intrinsic hardening: 341/341.
- P11 contract: 6/6; normalized SQL/schema contract: 6/6.
- Task controls: 112 tasks, 44 completed, 299 dependency edges, 72 semantic
  edges, 12/12 tests.
- Release map: 178/178 leaves and 40/40 tests.
- Evidence closure: audit-only, zero candidates, `0/93`, 102/102 tests.
- Documentation: 478 local Markdown links.
- `git diff --check`: pass.

## Immutable commit binding

The accepted implementation was committed as
`3608d82407905c16c6094598872995384c836b93` with subject
`feat(sqlite): implement NP1 native projection`. It contains 32 paths, 7,670
insertions, and 99 deletions. Author and committer are both
`reacher-z <mtrxcop@gmail.com>`; the commit body is empty and has no co-author
trailer.

The commit was pushed to `origin/feat/authoring-foundation`. Read-after-write
verification proved local `HEAD`, the tracking ref, and `git ls-remote` all
equal the full SHA above. This evidence reconciliation keeps P11 `in_progress`,
adds no completion/test evidence or release weight, and advances only the
bounded next action to the remaining P11-A global route-unknown closure and red
matrix.
