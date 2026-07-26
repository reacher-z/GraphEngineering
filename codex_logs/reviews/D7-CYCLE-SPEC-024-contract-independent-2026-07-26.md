# D7-CYCLE-SPEC-024 independent contract review

- Review completed: `2026-07-26T22:53:57Z`
- Reviewer lane: `/root/d7_contract_independent_review`
- Working branch/HEAD observed at final review: `feat/authoring-foundation` / `f57dab96d2f970e6a1c90231a3f2a1f3d4f5e58d`
- Candidate state: mutable shared working tree; this report does not claim an immutable commit or push
- Decision: **ACCEPT-FOR-SPEC-COMMIT**
- Scope verdict: **CONTRACT ACCEPTED — native execution explicitly out of scope**
- Supersedes the pre-closure verdict in `D7-CYCLE-SPEC-024-independent-2026-07-26.md`

## 1. Decision

No open P0 or P1 finding remains inside the exact scope of
`D7-CYCLE-SPEC-024`. The closed request/policy/result/revision, event,
checkpoint, GraphPatch, fold, recovery, budget-release, lease, and named
expected-test contracts are suitable for an isolated spec commit and native
handoff.

This decision does **not** mark master-plan Day 7 complete, does **not** claim
that dynamic cycles or GraphPatch execute in either runtime, and closes no
release-checklist leaf. `D7-TS-CYCLES-025`, `D7-PY-CYCLES-026`, and
`D7-CYCLE-CONFORMANCE-027` remain Open and are the required next execution
chain.

The prior review's native-runtime “P0-03” is therefore reclassified correctly:
it is a product/Day-7 P0 blocker owned by 025/026/027, not an unsatisfied
artifact or expected test of 024. Keeping it as a 024 blocker would create a
dependency cycle because both native tasks depend on the accepted spec task.

## 2. Authoritative scope evidence

The registry assigns 024 to `main`, with artifacts limited to
`spec/cycle-semantics.md`, `spec/graph-patch.schema.json`, and
`spec/conformance`, and four expected-test groups:

1. `until-dry convergence`;
2. `hard iteration/time/cost/node limits`;
3. `malicious patch rejection`; and
4. `replayed exit reason`.

By contrast, 025 owns `packages/runtime`/`packages/core`, 026 owns
`python/src/graph_engineering`, and 027 owns executable cross-language
conformance after both native runtimes. That registry split is sufficient
evidence that native execution is outside 024.

This review fully read the 368-line master plan and the 577-line
`MASTER-PLAN-EXHAUSTIVE-GAP-AUDIT-2026-07-26.md`, then checked the exact
024/025/026/027 registry objects, Day-7 coverage row, dependency graph,
release map, and mandatory-test rows.

## 3. Closed P0/P1 findings

| Finding | Severity before repair | Final disposition |
|---|---|---|
| `RoundReserved` retained only an opaque hash and could under-reserve a larger planner path | P0 | Closed: the exact request-bound `roundPlan`, its domain hash, and exact worst-case `maximum` are durable and refolded. |
| A terminal incomplete round conflicted with schema assumptions, active lease state, and in-doubt activity preservation | P0 | Closed: usage settles, exact remainder releases, terminal observation/result close the round, lease becomes null, and charged unmatched work remains in doubt. |
| Checkpoints could substitute same-count keys, request bytes, patches, rounds, or revision coordinates after recomputing `contentHash` | P0 | Closed: checkpoint validation refolds the exact named event prefix and compares the complete state/envelope/lease projection. |
| Terminal precedence and successful mode-specific exit reasons were not machine-auditable | P0 | Closed: closed `exitObservation`, exact precedence, mode-specific result constraints, hostile mutations, and replay equality are executable. |
| Budget settlements/releases were insufficiently tied to iteration, phase, remaining credit, and closing reason | P1 | Closed: per-phase committed credit, exact phase/closing releases, no-op rejection, dispatch-credit checks, and terminal reason closure are enforced. |
| `phase-complete` lacked phase provenance and hard-bound interruption lacked a legal release reason | P1 | Closed: `phase` is conditionally required only for `phase-complete`; `bound-reached` is tied to folded hard-bound evidence. |
| Non-retryable or in-doubt non-idempotent failures could be retried | P1 | Closed: retryability and side-effect class gate the next claim; a hostile retry is rejected. |
| Phase facts could name a different iteration after record-chain rehashing | P1 | Closed: every phase, settlement, release, and patch decision binds the open iteration; a hostile substitution is rejected. |
| Lease takeover/reacquisition semantics contradicted the prose and renewal could occur after expiry | P1 | Closed: higher-fenced takeover and voluntary handoff/resume are valid frozen transitions; wrong prior identity/non-advancing fence are hostile cases; expired renewal fails. |
| `until-dry` had no positive global-seen/dry-convergence carrier result | P1 | Closed: a first-occurrence global-seen fold with duplicate ordering reaches exactly two dry rounds and a valid `DRY` result; while/evaluator success and evaluator-unknown carriers are also frozen. |

Open 024 findings: **P0 = 0, P1 = 0**.

## 4. Four expected-test groups

The durable manifest contains an exact `expectedTestCoverage` map, and the
validator rejects a missing group or dangling named case.

| 024 expected test | Machine evidence |
|---|---|
| Until-dry convergence | `global-seen-dedupes-against-every-prior-observation` freezes first-occurrence order, within/across-round duplicates, global seen state, dry counter reset/increment, and `DRY`; the result schema has a valid converged carrier. |
| Hard iteration/time/cost/node limits | Seven fold vectors freeze inclusive iteration, duration, positive cost, dynamic-node, attempt, discovery, and simultaneous-precedence behavior; the durable history independently terminates at `MAX_ITERATIONS`. |
| Malicious patch rejection | Closed schema negatives plus thirteen semantic vectors cover deletion/unknown fields, stale base, ID shadowing, back-edge, capability expansion, pending-node conflict, unsupported stream edge, idempotency, race, dry-run, byte/depth limits; durable attacks cover authority detachment and budget fraud. |
| Replayed exit reason | Terminal history is folded twice with byte-equal observation/result, while hostile event and checkpoint observation substitutions are rejected after complete rehashing. |

## 5. Master-plan and mandatory-test mapping

| Requirement | What 024 supplies | Required task that remains Open |
|---|---|---|
| Master-plan Day 7 | Frozen controller/GraphPatch protocol and offline conformance oracle | 025 native TS, 026 native Python, then 027 cross-language execution; Day 7 remains Open. |
| `T08` unbounded loops | Required explicit bounds, zero/missing/unsafe-bound negatives, bounded plans and hard-stop carriers | `D7-CYCLE-CONFORMANCE-027`; `REL-T08` remains Open. |
| `T15` malicious dynamic patches/unsafe dry runs | Closed patch schema and semantic attack corpus, authority/policy/budget decision carriers | Final composite acceptance through native D7 plus D12/D16 and `CTRL-ACCEPTANCE-070`; `REL-T15` remains Open. |
| `T17` deterministic global seen convergence | Ordered duplicate/global-seen/dry fold and valid `DRY` carrier | `D7-CYCLE-CONFORMANCE-027`; `REL-T17` remains Open. |
| `T18` every hard stop | Inclusive contract vectors and exact reservation/settlement/release accounting | `D10-BUDGET-CONFORMANCE-038` plus native D7-D10 evidence; `REL-T18` remains Open. |
| `T21` replay/fork lineage/results | Hash-bound event prefix, read-only terminal replay, fork-prefix observations, exact checkpoint refold | `D9-DURABLE-EXT-CONFORMANCE-034`; `REL-T21` remains Open. |

No mandatory row above is inferred Green from accepting 024.

## 6. Verification evidence

All final commands passed:

- `corepack pnpm validate:fixtures`: 52 JSON fixtures, 17 manifests, 11 YAML
  references, 9 GraphPatch schema cases, 13 semantic patch vectors, six D7
  schemas, 16 chained event goldens, 2 valid/2 hostile lease transitions, 2
  interrupted terminal/checkpoint folds, 1 global-seen fold, 7 hard-stop folds,
  20 hostile histories, 11 hostile checkpoint folds, 4 standalone phase-event
  shapes, and all four 024 expected-test groups.
- `corepack pnpm --filter @graph-engineering/patterns test`: 93/93 passed; the
  existing static `loopUntilDry` remains honestly marked as unsupported native
  dynamic execution.
- `corepack pnpm check:docs`: 229 local Markdown links passed.
- `node --check scripts/validate-fixtures.mjs`: passed.
- Strict duplicate-key/non-finite JSON scan: 11 D7 schema/manifest files passed.
- `git diff --check`: passed.

## 7. Reviewed artifact hashes

```text
040a71396bfdc36dd177b6375b8e9ac0538e1222ad26a546276a3e6a7a8cec78  spec/cycle-semantics.md
4955f03e8bb1a74721e5457073a48eab65562b179aee17ac799362072cb7cafb  spec/graph-patch.schema.json
b7bf7c500dacbb3c980ed86ea102ea4c7e4c5517dc60c2a2473931213a4ea4e5  spec/graph-revision.schema.json
f0d9cef318c75419f48e5c292fbd204c6c35cfca05c60493a1e4b170647652f8  spec/cycle-controller-policy.schema.json
fdbbd7a49f66934d8ea27574804844af6b598f0bdd5e855b06733e44fc4910ae  spec/cycle-controller-result.schema.json
d01b4c8c4796264f6e9c3aa4f13d373cb48ec57a7bb7519988ef2fc6e96a1118  spec/cycle-controller.schema.json
095d918bffc210b69f342248bf73efee34a411310444a9b042af14402ce8a08d  spec/cycle-controller-event.schema.json
0c20fb2d740ed73cd52dcbcd4a8b46e987c1d386b0f85a07e0031aacfec6518b  spec/cycle-controller-checkpoint.schema.json
913210f2b49acdeaeefe89b57881bf948f0ecd9485dbe358b1eb5b42826090ca  spec/conformance/bounded-cycle.case.json
7315b0a4447984c8e5e54d9a9dc6b809e2c9d1ad9702dc66d28574806c0b9b76  spec/conformance/cycle-controller.case.json
cbe517cf07f40d51d79c36d075c46baa93cf9558dd62b7bbe4bdc1c9ce949a22  spec/conformance/cycle-controller-durable.case.json
fb908a407659f34d7625d7ffceeb2ddaa8d213e90ae7d52ab46b25bcf09fc35f  spec/conformance/graph-patch.case.json
8f65660ed6dd6c9f8fe1a459c70a075428e4578ad3a6b9b390228473cd69fc0d  scripts/validate-fixtures.mjs
```

The report itself is intentionally excluded from that pre-report hash set.
Integration must recompute hashes after any edit and bind the final bytes to an
isolated commit before updating registry evidence.

## 8. Non-blocking downstream boundaries

- Cost is deliberately finite ordered binary64 in 024; richer pricing/ledger
  acceptance belongs to D10.
- D7 payloads truthfully say `inline-unredacted`; protected persistence and
  sink-before-write security belong to the D9 redaction chain.
- GraphPatch semantic vectors are normative expected outcomes, not proof that a
  native compiler/applier executed them; that proof belongs to 025/026/027.
- Real distributed fencing-provider behavior remains a native/D9 operational
  test, not an offline schema claim.

## 9. Handoff

Main may isolate these reviewed D7 bytes, rerun the gates, commit/push them, and
record 024 completion evidence. Then start 025 and 026 in parallel; run 027 only
after both focused native suites pass. Do not alter Day-7 or release-leaf status
from this contract verdict alone.
