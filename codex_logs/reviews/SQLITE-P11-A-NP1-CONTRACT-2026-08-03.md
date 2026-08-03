# SQLite P11-A NP1 canonical contract review — 2026-08-03

## Accepted scope

This review accepts only the canonical NP1 design boundary committed as
`96eec95022ab6ac96bbea1e0886de6198d355c01`. The accepted files are the
append-only master-plan additions, the NP1 section in the canonical P11
specification, and the updated Markdown SHA/invariant checks in the existing
P11 conformance validator. It does not accept any uncommitted runtime code.

## Correctness decisions

1. The pre-existing generic retained array/tuple receipt remains a shape-only,
   zero-I/O authority. It cannot be converted to or consumed as a lower-native
   receipt or parent.
2. The native read must be bound to the exact transaction owner, BEGIN receipt,
   composition, hidden source connection, lineage, generation, source summary,
   and read session before the first native projection I/O. A source-only drain
   followed by post-hoc owner adoption is explicitly forbidden.
3. The dependency graph is acyclic: baseline-source may call the transaction
   owner's exact composition/connection reproof; owner-composition may consume
   the resulting source receipt; transaction-owner does not import source.
4. The read covers all twelve frozen source families, reaches terminal for each,
   reconciles every observed count with the captured summary, freezes the full
   projection and digest, and retires every real native resource before mint.
5. Three v1 families are mandatory singletons. Therefore optional dynamic
   N=0/1/3 produces total projection counts 3/4/6. Baseline totals 0 and 1 are
   impossible hostile cases, and `main.baseline-entries` never claims genuine
   zero. Empty optional-family or cursor projections cannot be laundered into a
   baseline genuine-zero claim.
6. Success does not grant arbitrary SQL authority, accept a P11 publication
   stage, present COMMIT, close global route unknowns, or change release weight.

## Falsifiability and validation

- `corepack pnpm test:sqlite-owner-composition-contract`: 6/6 passed after the
  canonical Markdown hash was deliberately re-signed.
- The validator now requires the lower-native count provenance, no post-hoc
  adoption wording, all three total-3/4/6 case identifiers, and the v1
  genuine-zero prohibition.
- `corepack pnpm check:docs`: 478 local Markdown links passed.
- `git diff --check`: passed for the contract tranche.
- The first contract run failed exactly because the old Markdown SHA remained
  frozen; updating only the trusted SHA and required NP1 invariants restored the
  gate. This demonstrates that the asset binding is active rather than cosmetic.

## Open implementation blockers

The current runtime work remains unaccepted until both languages remove any
source/composition import cycle, perform exact graph reproof before every native
projection boundary, report truthful logical read and runtime-local retirement
telemetry, use an exact cross-runtime projection digest, preserve primary-over-
cleanup identity, reject total 0/1 without a receipt, pass the full hostile/fault
matrix, and receive an independent H0/M0/L0 whole-diff verdict.

## Nonclaims

P11-A, P11-B, P11-C, P11-D, stage 18, third-clock consumption, COMMIT, D9,
release evidence, RC/stable, adoption, and GitHub popularity remain open. The
P11 registry stays `in_progress`; release evidence remains audit-only 0/93.
