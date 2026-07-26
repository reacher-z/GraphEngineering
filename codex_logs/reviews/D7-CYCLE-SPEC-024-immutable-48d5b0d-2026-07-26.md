# D7-CYCLE-SPEC-024 immutable integration evidence

- Recorded at: `2026-07-26T23:17:10Z`
- Commit: `48d5b0d99618e899c15c5f718dcca4a7d8300225`
- Tree: `0f9e8d0ee237c9964b9270ea310de2e7fc99664d`
- Parent: `f57dab96d2f970e6a1c90231a3f2a1f3d4f5e58d`
- Branch: `feat/authoring-foundation`
- Remote ref observed: `48d5b0d99618e899c15c5f718dcca4a7d8300225`
- Integration verdict: **immutable D7 specification milestone accepted**
- Product/release verdict: **native execution and every release leaf remain Open**

## Exact boundary

The commit changes exactly 21 files and contains the D7 specification,
machine schemas, four conformance manifests, shared fixture validator,
capability-boundary documentation, and the complete author/hostile/final
independent review trail. It contains no TypeScript native-cycle runtime,
Python runtime, redaction contract, subgraph contract, master-plan append,
task-registry mutation, daily-log mutation, or generated scanner lockfile.

The commit author and committer are both exactly
`reacher-z <mtrxcop@gmail.com>`. The commit message body contains no co-author
trailer. The parent is an ancestor of the candidate, the object resolves as a
Git commit, and the pushed remote branch resolves to the full commit ID above.

## Independent semantic verdict

The committed report
`codex_logs/reviews/D7-CYCLE-SPEC-024-contract-independent-2026-07-26.md`
was produced by the independent `/root/d7_contract_independent_review` lane.
It supersedes the earlier blocked report and records:

- exact task-boundary review of 024 versus 025/026/027;
- zero open P0 findings inside 024;
- zero open P1 findings inside 024;
- complete coverage of until-dry convergence, hard resource stops, malicious
  patch rejection, and replayed exit reason; and
- an explicit prohibition on treating offline fixtures as native runtime or
  cross-language execution evidence.

Its SHA-256 at the immutable tree is
`c6c196e2e541dc9dc6bd067b4d043c3e4805d8124e932a994b74032391669e5e`.

## Clean-tree validation

Before moving the branch, main wrote the exact staged tree, created a temporary
detached candidate with that tree, installed from the existing pnpm store with
`--offline --frozen-lockfile`, and ran the following clean-worktree sequence:

```text
corepack pnpm install --offline --frozen-lockfile
corepack pnpm validate:fixtures
corepack pnpm --filter @graph-engineering/core build
corepack pnpm --filter @graph-engineering/patterns test
corepack pnpm check:docs
node --check scripts/validate-fixtures.mjs
git diff --check
git status --porcelain
```

The exact candidate tree was
`0f9e8d0ee237c9964b9270ea310de2e7fc99664d`, byte-identical to the published
commit tree. Results were:

- 51 JSON fixtures and 16 case manifests loaded in the isolated tree;
- all 11 YAML fixtures referenced exactly once by the case corpus;
- all six D7 controller/revision/event/checkpoint schemas meta-valid;
- nine GraphPatch schema cases and thirteen closed semantic patch vectors;
- sixteen chained event goldens;
- two valid and two hostile lease transitions;
- two interrupted terminal/checkpoint folds;
- one global-seen convergence fold;
- seven hard-stop folds;
- twenty hostile histories and eleven hostile checkpoint folds;
- four standalone phase-event shapes;
- all four registry expected-test groups mapped;
- `@graph-engineering/core` built cleanly;
- `@graph-engineering/patterns` passed 93 of 93 tests;
- 228 commit-local Markdown links passed;
- fixture-validator syntax and `git diff --check` passed; and
- the detached candidate remained clean.

A separate strict object-pairs JSON parse rejected duplicate keys and
non-finite constants while successfully parsing all eleven D7 schema/manifest
documents.

## Reproducibility correction retained in the record

The first detached attempt invoked the patterns package test without first
building its workspace dependency. It correctly failed because the fresh
worktree had no pre-existing `@graph-engineering/core` distribution. No source
test failed. The final sequence explicitly built core first and passed 93 of
93. This correction is retained so future validation does not mistake local
build cache for release evidence.

## Reviewed byte identity

The immutable commit retains every principal artifact digest recorded by the
independent reviewer, including:

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

## Scope that remains open

This evidence can close only `D7-CYCLE-SPEC-024`. It cannot close or provide
release weight for:

- `D7-TS-CYCLES-025` native TypeScript execution;
- `D7-PY-CYCLES-026` native Python execution;
- `D7-CYCLE-CONFORMANCE-027` executable cross-language equality;
- D10 pricing and budget-ledger semantics;
- D9 protected persistence, distributed fencing, replay, or fork operations;
- any Day-7 aggregate claim; or
- any of the 178 release-checklist leaves.

The release candidate overlay therefore remains empty and the stable release
weight remains zero until the full final-roll-up ancestor set has fresh,
immutable candidate evidence.
