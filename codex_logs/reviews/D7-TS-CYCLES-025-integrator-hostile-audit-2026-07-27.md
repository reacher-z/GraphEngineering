# D7-TS-CYCLES-025 integrator hostile audit

- Recorded at: `2026-07-27T09:04:13Z`
- Reviewer role: `/root` integration agent
- Producer role: `/root/d7_ts_cycles_native`
- Review independence: **not independent after remediation**. The integration
  agent found and repaired defects during this audit. A fresh external reviewer
  is still required before `D7-TS-CYCLES-025` may be marked completed.
- Candidate state: **native one-language implementation candidate**
- Task decision: **READY TO COMMIT AS A TESTED SOURCE MILESTONE; KEEP TASK IN
  PROGRESS PENDING INDEPENDENT ACCEPTANCE AND D7 CROSS-LANGUAGE JOIN**
- Base source commit: `eed3ddb5c4f36229c00763bd29154c5aacd43954`
- Accepted D7 contract commit: `48d5b0d99618e899c15c5f718dcca4a7d8300225`
- Accepted D7 contract tree: `0f9e8d0ee237c9964b9270ea310de2e7fc99664d`
- Candidate commit: assigned by the enclosing source commit; an immutable
  follow-up record must bind its final commit/tree and remote ref.

## 1. Scope and exclusions

This audit covers the native TypeScript bounded-cycle and GraphPatch runtime
under `packages/runtime/**`, plus the minimal public exports from
`packages/core/src/index.ts` required to reuse the existing dependency-free
Graph IR fragment validators.

The exact candidate path list is:

1. `packages/core/src/index.ts`
2. `packages/runtime/README.md`
3. `packages/runtime/src/index.ts`
4. `packages/runtime/src/cycle-contract.ts`
5. `packages/runtime/src/cycle-controller.ts`
6. `packages/runtime/src/cycle-fold.ts`
7. `packages/runtime/src/cycle-types.ts`
8. `packages/runtime/src/graph-patch.ts`
9. `packages/runtime/test/cycle-contract.test.ts`
10. `packages/runtime/test/cycle-controller.test.ts`
11. `packages/runtime/test/cycle-fixtures.ts`
12. `packages/runtime/test/cycle-fold.test.ts`
13. `packages/runtime/test/graph-patch.test.ts`
14. this report

The thirteen product/test path names above, before adding this report, have
SHA-256 list digest:
`944e359598af962864b9e3070281df73a78371044bd30146948c16c4ed1f67c1`.
The product and test implementation contains 8,165 source/documentation lines
across those thirteen paths.

Explicit exclusions remain:

- native Python acceptance (`D7-PY-CYCLES-026`);
- exact TypeScript/Python byte-for-byte join (`D7-CYCLE-CONFORMANCE-027`);
- a fresh reviewer independent of both producer and remediation;
- a distributed fencing provider; the in-memory store remains local/test only;
- D9 protected payload persistence; D7 still truthfully emits
  `inline-unredacted` and `redacted: false`;
- D10 native budget/pricing/model-router integration;
- installed candidate, package tarball, release, tag, and public release gates.

No Day-7 Green, Candidate Green, release, adoption, or star-count claim is
authorized by this report.

## 2. Contract inputs pinned by digest

The implementation was audited against the immutable D7 contract and the
following exact source digests:

| Contract artifact | SHA-256 |
| --- | --- |
| `spec/cycle-semantics.md` | `040a71396bfdc36dd177b6375b8e9ac0538e1222ad26a546276a3e6a7a8cec78` |
| `spec/graph-patch.schema.json` | `4955f03e8bb1a74721e5457073a48eab65562b179aee17ac799362072cb7cafb` |
| `spec/conformance/bounded-cycle.case.json` | `913210f2b49acdeaeefe89b57881bf948f0ecd9485dbe358b1eb5b42826090ca` |
| `spec/conformance/graph-patch.case.json` | `fb908a407659f34d7625d7ffceeb2ddaa8d213e90ae7d52ab46b25bcf09fc35f` |
| `spec/conformance/cycle-controller.case.json` | `7315b0a4447984c8e5e54d9a9dc6b809e2c9d1ad9702dc66d28574806c0b9b76` |
| `spec/conformance/cycle-controller-durable.case.json` | `cbe517cf07f40d51d79c36d075c46baa93cf9558dd62b7bbe4bdc1c9ce949a22` |

## 3. Implemented behavior audited

The candidate provides:

- strict bounded portable capture that rejects proxies, getters, cycles,
  sparse arrays, symbol keys, non-plain objects, unsafe integers, non-finite
  numbers, excessive depth/value counts, and byte overflows before scheduling;
- closed request/policy/activity/lease/candidate/verdict/patch validation;
- domain-separated controller, request, activity, event, round-plan, and graph
  revision identities;
- immutable event folding with exact envelope/data discriminators;
- a full-prefix semantic fold before every authoritative event-store CAS;
- start-only empty-stream enforcement and resume-only nonempty-stream
  enforcement;
- monotonically increasing lease epochs and fencing tokens, stale expected
  version rejection, expired-lease rejection, and single CAS winner behavior;
- deterministic `until-dry`, bounded `while`, and evaluator-optimizer modes;
- a global durable seen set containing accepted, rejected, and unknown keys;
- complete fresh-key verdict coverage and stable first-occurrence ordering;
- exact worst-case per-round attempts/cost/dynamic-node reservation;
- explicit settlement and release facts with no silent capacity mutation;
- hard iteration, duration, cost, attempt, discovery, candidate count, item
  bytes, batch bytes, dynamic node, graph node/edge/output, depth, and fan-out
  bounds;
- activity timeout/cancellation boundaries that ignore a handler's late result;
- at-least-once external-effect semantics with stable idempotency keys;
- crash/resume reuse of committed discovery, evaluation, mode, patch, and
  settlement facts;
- replay with no activity, clock, random, policy, authority, or write adapter;
- fork lineage binding to an exact parent run/sequence/history hash;
- append-only GraphPatch compilation, authority/capability ceilings, budget
  gates, stale base detection, durable decision restoration, accepted/rejected
  idempotency, and complete graph limits;
- full-prefix checkpoint construction and checkpoint substitution rejection;
- structured terminal result and exit-precedence projection; and
- public TypeScript exports and operator documentation.

## 4. Hostile findings and remediation

### 4.1 P1 — malformed external failure could release in-doubt cost

Before remediation, a handler-controlled malformed cost such as `Infinity`
caused the controller to normalize cost to zero even when the activity had
idempotent or non-idempotent external effects. This contradicted the accepted
rule that in-doubt external usage remains charged and could make reserved credit
spendable twice.

Remediation:

- derive in-doubt status from the trusted binding and validated failure;
- for any ambiguous external outcome, commit the binding's complete
  `maxCostUsdPerAttempt` ceiling;
- retain zero only for an activity whose trusted side-effect class is `none`;
- add a two-class hostile test using a non-finite attacker cost; and
- assert terminal totals, settlement bytes, zero retry, and replay equality.

Result: closed by `retains the reserved cost ceiling for malformed in-doubt
external failures`.

### 4.2 P1 — already-cancelled recovery could release an unmatched external claim

When recovery found a durable open activity and its cancellation signal was
already aborted, the termination helper committed one attempt but zero cost.
The activity could have crossed the external side-effect boundary before the
prior process disappeared.

Remediation:

- charge zero only for a trusted `none` binding;
- charge the complete per-attempt ceiling for unmatched idempotent or
  non-idempotent external claims;
- preserve the unmatched activity for the fold's in-doubt projection; and
- add a crash-after-`ActivityStarted`, cancelled-resume, zero-redispatch,
  exact-settlement, replay-equality regression.

Result: closed by `charges an unproven external claim when an
already-cancelled resume terminates`.

### 4.3 P1 — GraphPatch fast validation accepted incomplete Graph IR fragments

The patch shape gate rejected unknown node/edge fields but did not itself
enforce every required Graph IR fragment field and endpoint constraint. A live
apply normally reached the complete compiler, but a pure durable fold/replay
must not accept a malformed proposal merely because no scheduler is running.

Remediation:

- export the existing dependency-free core node, edge, and endpoint fragment
  validators;
- use them directly from `validateGraphPatchShape` after bounded detachment;
- reject missing node `config`, missing edge endpoints, empty output ports, and
  all other Graph IR fragment schema violations before compilation or replay;
- preserve the complete compiler as the later whole-graph semantic gate; and
- add pre-compilation hostile regressions proving no graph mutation.

Result: closed by `rejects incomplete Graph IR fragments before compilation or
durable replay`.

### 4.4 P1 — caller-constructed fork Fold could claim inherited state

Fork lineage binds a parent event-prefix hash, but the public fold option
previously accepted any structurally compatible `CycleControllerFold`. A caller
could copy a real fold identity/hash while replacing inherited counters or seen
state, then ask a pure child-prefix replay to trust the copied projection.

Remediation:

- mark only folds returned by the strict event-prefix fold as verified
  inheritance authority using a module-private `WeakSet`;
- reject unverified/caller-constructed parent fold objects;
- reject parent projections on non-fork histories;
- preserve cross-process operation by requiring local replay of the exact
  parent event prefix after restart; and
- document the boundary and add a forged-counter replay regression.

Result: closed by the augmented immutable-parent fork test.

### 4.5 P2 observations retained for the independent reviewer

- The public low-level GraphPatch `prepare`/`commitPrepared` API intentionally
  separates computation from the caller's durable CAS. The reviewer should
  attack misuse and documentation around dry-run versus prepared decisions.
- Authority hashes are validated as closed authenticated inputs and the
  proposer activity key is event-bound. Full grant-intersection derivation and
  protected authority storage remain D9/D10 integration work and must not be
  claimed by D7 alone.
- The in-memory event/checkpoint stores demonstrate deterministic local CAS and
  recovery semantics; they are explicitly not evidence of distributed lease
  fencing.
- A future cross-language join must attack inherited in-doubt projection,
  floating-point addition order, exact-bound versus over-bound behavior, and
  every crash point in both runtimes using shared vectors.

## 5. Verification evidence

Environment:

- platform: repository Linux development environment
- Node.js: `v22.23.1`
- package manager: `pnpm 10.13.1` through Corepack
- source working directory: `/home/nick/work/GraphEngineering`

Final scoped gates after all remediation:

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @graph-engineering/core build` | exit 0 |
| `corepack pnpm --filter @graph-engineering/core test` | exit 0; 6 files, 166 tests |
| `corepack pnpm --filter @graph-engineering/runtime build` | exit 0 |
| `corepack pnpm --filter @graph-engineering/runtime lint` | exit 0 |
| `corepack pnpm --filter @graph-engineering/runtime test` | exit 0; 8 files, 163 tests |
| `corepack pnpm --filter @graph-engineering/runtime exec vitest run test/graph-patch.test.ts test/cycle-controller.test.ts` | exit 0; 2 files, 31 tests at that checkpoint |
| `corepack pnpm --filter @graph-engineering/runtime exec vitest run test/cycle-controller.test.ts test/cycle-fold.test.ts` | exit 0; 2 files, 32 tests |
| `corepack pnpm check:docs` | exit 0; 250 local Markdown links |
| `git diff --check -- packages/core/src/index.ts packages/runtime` | exit 0 |

One intermediate runtime lint invocation raced the concurrently running core
build and read the previous core declaration output, reporting the three new
fragment exports as absent. After the dependency build completed, the exact
runtime lint command was rerun and passed. This is retained as orchestration
evidence, not hidden as though the first invocation had been green.

## 6. Decision and required next actions

There is no known open P0/P1 in the audited TypeScript source boundary after
the four remediations above and the final scoped gates are green. The work is a
meaningful commit-ready native TypeScript source milestone.

It is not independently accepted because the integration reviewer changed the
implementation. Fresh reviewer attempts could not start because the platform
reported an account-level usage limit with the next retry time
`2026-08-02T15:10:00-07:00`. This operational limitation does not weaken the
acceptance rule.

Next actions are mandatory:

1. commit only the exact D7 TypeScript/core/report paths with author and
   committer `reacher-z <mtrxcop@gmail.com>` and no co-author trailer;
2. revalidate the immutable commit from a detached clean worktree;
3. push the feature branch and verify its exact remote object ID;
4. obtain a fresh independent hostile review after reviewer capacity returns;
5. complete native Python D7 behavior without Node/TypeScript delegation;
6. execute exact cross-language result/event/checkpoint/hash comparisons; and
7. keep D7 Green and every release leaf open until all evidence conjunctions
   genuinely pass.
