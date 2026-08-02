# SQLite Cursor Rule 11 Wave 1E — exact release, drift, hostile evidence, parity v2

Date: 2026-08-02 PDT
Branch: `feat/authoring-foundation`

## Accepted scope

This increment accepts four bounded pieces of Wave 1E work:

1. TypeScript authentic exact-S to exact-E pre-consume release failure.
2. Python serialized native-affected and changes hostile evidence.
3. TypeScript B2, outer-ledger and cursor-ledger 11-field validation drift.
4. Cross-runtime Rule 11 parity v2 with a real pre-consume release case.

It does not claim Wave 1E, a production transaction owner, Rule 12, the third
clock, or the publication success/commit path complete.

## TypeScript exact release

- Lower and upper fault registries use exact WeakMap keys and WeakRef values.
- Handoff authenticates S, authority, connection, context, P and E identities.
- Selected faults are delete-before-throw, one-shot and graph-local.
- Release primary beats simultaneous second-boundary cancellation.
- S is not consumed; T, A, W and R11 are not minted.
- Selected E/context/authority poison; unselected graphs remain healthy.
- Registration-failure envelopes weakly hold object errors and directly tag
  primitives, including `undefined`.
- Reverse-root, dead-error, abandoned-arm, registration rollback, replay and
  package-root non-export cases are covered.

Verification: connection 40/40; Rule11 20/20; scoped typecheck and diff-check
passed. Independent final audit: H0/M0/L0.

## Python hostile and id-reuse evidence

- Rowcount descriptor lookup failures normalize to the structured affected
  error while preserving native-progress recovery and primary precedence.
- Serialized native matrix covers missing, descriptor/accessor throw, hostile,
  string, float, negative and unsafe results.
- Serialized changes matrix covers prepare/fetch, zero/two rows, outer/row
  shape, type/range, close and primary-over-close behavior.
- All cases traverse the real post-T composite boundary and prove no A/W/R11.
- Existing private-root GC remains an unconditional pass.
- A separate 65,536-attempt real-id-reuse test honestly skips when CPython does
  not produce the retired exact ID.

Verification: lower 40 passed; composite 60 passed and 1 honest skip; Ruff,
mypy and diff-check passed. Independent final audit: H0/M0/L0.

## B2 and ledger matrix

The package-private seam weakly keys the exact context and stores only one of 11
enum values. It is default-off, one-shot, registration-rollback-safe and absent
from the package root. Each observation enters the normal consume closed
predicate. B2 root/count/stage/projection/parameter, outer ledger
logical/fixed/affected and cursor ledger logical/fixed/affected are each tested
independently with a healthy unselected graph.

Verification: focused 13/13; outer-authority 36/36; Rule11/session regression
31/31; typecheck and diff-check passed. Independent audit: H0/M0/L0.

## Parity v2

Both reporters create a real SQLite graph, mint an authentic session, arm the
runtime-private exact-S seam and execute the normal serialized leaf. The new
portable projection proves primary identity, selected poison, no T, poisoned
context/E, execute zero, release one and replay rejection. Comparator hostile
tests cover unknown IDs, key order, unsafe counts, native affected mismatch and
changes fetch count drift.

Final root run: 3/3 passed; real dual-runtime repeated reporters were canonical
byte exact in about 65.01 seconds. Build, Ruff, py_compile and diff-check passed.
Independent final audit: H0/M0/L0.

## Strict remaining work

- TypeScript serialized native/changes hostile completion.
- Multi-counter mismatch combinations.
- Actual observed Python ID reuse (not seen within the bounded budget).
- A real post-consume transaction failure finalizer with rollback/reopen/close
  evidence and honest after-native-return fault naming.
- Rule 12, TEMP retirement, success commit fence and the third clock.

GitHub stars remain an adoption outcome, never a property guaranteed by this
test evidence.
