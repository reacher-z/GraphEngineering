# SQLite P11-A projection-count receipt and native-callsite triage review

Date: 2026-08-03 PDT

Task: `D9-SQLITE-OWNER-COMPOSITION-P11-094`

Disposition: bounded P11-A progress only. P11 remains `in_progress` and this
review contributes no release-candidate evidence or release weight.

## Accepted implementation boundary

The TypeScript and Python owner-composition lattices now require an opaque
one-shot retained-projection count receipt for `main.baseline-entries`. The
receipt is bound to the exact composition, P9 owner, BEGIN/current generation,
route descriptor, retained container identity, definition-owned computed count,
and an unguessable token/nonce. The parent retains the consumed receipt and the
receipt retains the projection, so the count proof cannot disappear while the
parent is live.

The implementation rejects scalar fake zero, mutable or structurally invalid
containers, subclass/proxy presentations, cloned/replayed/cross-composition
receipts, wrong fixed counts, hostile transition order, captured-intrinsic
replacement, and stale weak cleanup. Every terminal error continues through the
exact P9 rollback/close/reopen path with commit attempts fixed at zero.

This is intentionally not native-source provenance. An internal caller can
still supply an immutable empty projection. Both runtime snapshots therefore
state `nativeSourceProvenance=false`, `genuineZeroClaim=false`,
`actualNativeIoCount=0`, and `sqlAuthority=false`. The parity cases remain named
`reusable-shape-0` and `reusable-shape-3`, not genuine-zero/native execution.

## Conservative callsite triage

The scanner preserves all 457 candidates and all 457 remain route-unknown. It
adds a unique stable source identity and a TypeScript receiver-evidence layer:

- 206 TypeScript candidates: 15 confirmed native receivers, 184 exact
  wrapper/guard/test-like production probes, 5 proven false positives, and 2
  receiver unknowns;
- 251 Python candidates: 187 confirmed native receivers, 31 exact
  wrapper/guard/test-like production probes, 0 proven false positives, and 33
  receiver unknowns.

Names never upgrade confidence. TypeScript requires local `node:sqlite` or
known-wrapper structural evidence. Python independently reparses each source
file and requires exact `sqlite3` annotations/construction or same-scope
derivation. Cross-function return guesses, unresolved members and conflicting
evidence remain unknown. The four buckets are triage only: fixture/phase/
parameter/budget/resource authorization is still absent, so
`routeClosureClaimed=false`, fixture classified count remains zero, and P11-A
native closure remains Open.

The cross-process parity test runs the Node scanner and Python reporter twice,
requires byte-identical output, proves a 251-candidate identity/occurrence
bijection, recomputes every candidate digest, checks all 457 scanner identities
are unique, and fails closed on spawn errors, signals, nonzero exits or stderr.

## Verification executed

- P11 contract and validator: 6/6.
- TypeScript owner-composition focused matrix: 81/81.
- Python owner-composition focused matrix: 83/83.
- Forced TypeScript/Python P11 normalized parity: 3/3, no availability skip.
- TypeScript callsite discovery hostile matrix: 6/6.
- Python callsite classification hostile matrix: 10/10 plus Ruff and strict
  project-config Mypy.
- Cross-process callsite classification parity: 2/2.
- P9 transaction-owner regression: parity 2/2, TypeScript 27/27, Python 36/36.
- P10 Rule12 runtime gate: passed after replacing its environment-dependent bare
  `pnpm` child invocation with `corepack pnpm`.
- TypeScript typecheck, owner-composition Ruff/Mypy, and `git diff --check`:
  passed.

## Security review findings resolved during the tranche

Independent review dynamically reproduced a Python builtins-replacement bypass:
the left side of exact type checks used captured `type`, but the right side
still resolved mutable `builtins.int` and `builtins.tuple`. Definition-time
`_INT` and `_TUPLE` captures now close that bypass across count proofs,
retained projections, child ordinals and maximum-row budgets; hostile success-
path tests freeze the correction.

The same review required TypeScript to reject Array subclasses, required
cross-composition presentation to leave the foreign source receipt usable, and
required parent-to-receipt retention plus weak-callback/id-reuse tests. It also
found and closed a Markdown wording contradiction and forced both portable
reporters to mint receipts instead of passing baseline count scalars.

Classifier red-team review also found and closed over-broad local-class
inference, nested Python stderr swallowing, noncanonical/root-escaping source
and fixture paths, locale-dependent ordering, and a CI job without `uv` setup.
Local classes now require exact imported lineage or exact method-to-native-field
delegation; otherwise they remain unknown. Explicit inputs must be canonical,
contained, regular, nonsymlink files. Node and Python share Unicode code-point
ordering, every nested process failure channel is terminal, Mypy loads the
strict project config, and `uv`-dependent gates run only in the pinned/locked
cross-language CI job.

## Strict nonclaims and next work

This tranche does not prove a lower-owned native projection, genuine N=0,
execute-N parameter binding, runtime-real fixed-read retirement, any fixture-
authorized native callsite, zero route-unknown callsites, P11-A completion,
P11-B/C/D, stage 18, third-clock consumption, COMMIT, D9 completion, an immutable
release candidate, production readiness, or release weight. The release overlay
must remain audit-only at 0/93.

The next implementation must map the 15 TypeScript and 187 Python confirmed
native receivers plus their wrapper paths to exact route or forbidden contracts,
then integrate the lower-owned native projection reader so it alone can mint or
adopt count provenance. Fixed-read resource retirement and mutation writer hooks
must become runtime-real before P11-A can close.

## Append-only plan binding

The first 22,908 master-plan lines retain SHA-256
`ce9a6b00ad99494ece99d73951baa0e2dcc8cd865bfd3853aac2a3a07549b681`.
Section 31.37.90 appended 176 lines; its 23,084-line prefix has SHA-256
`882b05994cbab40e8a87b21cb24f2b909182de6e4e7430b04b004cf21d54114a`.
The CI-job correction in 31.37.91 appended another 10 lines. The resulting
23,094-line plan has SHA-256
`4d55ec83276c0bb4d8cc420db2545327db912096337766671a00a79d1ac8c43e`.
No earlier plan byte was changed.

Section 31.37.92 appends the independently required classifier-hardening and
final-count correction after the 23,094-line prefix. The resulting 23,117-line
plan has SHA-256
`f9ce35de3177b0e837a23c1e0bcd569f209ed6498268764abbf0d524ea07c551`;
the 22,908-, 23,084-, and 23,094-line prefix hashes above remain unchanged.

## Final independent disposition

After dynamically reproducing and closing the builtins-type bypass,
over-broad class inference, nested-stderr swallowing, canonical-path,
locale-ordering, Unicode candidate-ID, strict-Mypy, CI-uv, reporter migration,
and specification wording findings, the frozen whole-diff review is
`H0 / M0 / L0`. This accepts the tranche only within the bounded scope and
strict nonclaims above; it does not change P11 or release status.

## Immutable implementation binding

The accepted 18-file implementation was committed and pushed as
`90fae463db5ef3097cf4b21ff4e07517edfbebd0` with 3,827 insertions and 97
deletions. Author and committer are `reacher-z <mtrxcop@gmail.com>` and no
co-author trailer is present. Local, tracking, and remote branch refs were
verified at that exact object. This binding does not broaden the bounded
review disposition or any nonclaim above.

The evidence reconciliation preserves the 23,117-line master-plan prefix at
SHA-256 `f9ce35de3177b0e837a23c1e0bcd569f209ed6498268764abbf0d524ea07c551`
and appends RM1/NP1 planning through line 23,225. The resulting plan SHA-256 is
`bc46ef2b6028b140a9531fec76b4d1f2268defce73a1faab3a9093fd721dc0bf`.
