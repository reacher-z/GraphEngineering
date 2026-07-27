# D7-TS-CYCLES-025 immutable implementation evidence

- Recorded at: `2026-07-27T09:46:33Z`
- Commit: `abd400b0ffa61b9eb648d69a173939ecf387d004`
- Tree: `54a11e5a459c1b517079f6652e041e523d9c457f`
- Parent: `eed3ddb5c4f36229c00763bd29154c5aacd43954`
- Branch: `feat/authoring-foundation`
- Remote ref observed before the next D7 commit:
  `abd400b0ffa61b9eb648d69a173939ecf387d004`
- Author: `reacher-z <mtrxcop@gmail.com>`
- Committer: `reacher-z <mtrxcop@gmail.com>`
- Co-author trailers: none
- Source verdict: **immutable and remotely bound TypeScript alpha milestone**
- Task verdict: **keep `D7-TS-CYCLES-025` in progress**

## Exact meaning of this record

This record closes the missing immutable-object follow-up requested by
`D7-TS-CYCLES-025-integrator-hostile-audit-2026-07-27.md`. It binds that audit's
remediated TypeScript source milestone to one commit, tree, parent, author,
committer, branch, and then-observed remote ref.

It does not convert the integration audit into an independent review. The root
integration agent changed the candidate during hostile review, so a fresh
reviewer who did not author or remediate the candidate is still mandatory.

## Scope

The immutable commit contains the native TypeScript bounded-cycle controller,
event fold, GraphPatch runtime, local deterministic event/checkpoint store,
public exports, operator documentation, focused runtime tests, and the
integration audit. The complete path and behavior inventory remains in the
referenced hostile-audit report and is not reinterpreted here.

The commit intentionally does not claim:

- a native Python implementation;
- executable TypeScript/Python equality;
- a production durable store or distributed fencing provider;
- ordinary-scheduler dynamic-revision integration;
- D9 payload protection;
- independent acceptance;
- a release candidate, package publication, or stable release; or
- completion of Day 7 or the master plan.

## Identity checks

The source commit resolved as:

```text
commit  abd400b0ffa61b9eb648d69a173939ecf387d004
tree    54a11e5a459c1b517079f6652e041e523d9c457f
parent  eed3ddb5c4f36229c00763bd29154c5aacd43954
```

At the immutable checkpoint, both author and committer were exactly
`reacher-z <mtrxcop@gmail.com>`, and the commit message contained no
`Co-authored-by` trailer. The feature-branch remote ref was independently read
after the push and matched the full commit ID.

The later Python/conformance commit
`a6c8e67c56d9ebcd8596307d9166763f48ac8713` names this TypeScript commit as its
only parent. That ancestry preserves the exact TypeScript implementation used
by the first executable dual-language join.

## Verification relationship

The author/integrator checks recorded before this immutable binding included:

- `@graph-engineering/core` build and 166 tests;
- `@graph-engineering/runtime` build, lint, and 163 tests;
- focused cycle-controller, fold, and GraphPatch hostile tests;
- Markdown link validation; and
- whitespace validation.

The child commit's detached clean-worktree conformance later exercised this
exact parent implementation against the Python native implementation and
matched 93 exact events, 17 activity input preimages, five terminal results,
one accepted GraphPatch/revision, one commit-then-throw/takeover recovery, all
three controller modes, and five checkpoints.

That later join is useful corroborating evidence, but it does not alter the
identity or review status of this commit.

## Open gates

`D7-TS-CYCLES-025` remains in progress until at least:

1. an independent hostile reviewer audits the immutable source or a declared
   successor;
2. the in-doubt activity cardinality/coalescing decision is made normative and
   applied consistently;
3. the complete cancellation, budget, patch rejection, replay/fork, corruption,
   and crash-boundary matrices pass;
4. production store/fencing and scheduler-integration claims have their own
   implementation and evidence; and
5. the final no-omission roll-up accepts one immutable release candidate.

No popularity or release claim receives evidence weight from this record.
