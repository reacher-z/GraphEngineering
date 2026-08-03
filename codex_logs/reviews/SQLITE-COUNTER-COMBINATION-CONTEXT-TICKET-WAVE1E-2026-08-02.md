# SQLite counter-combination and context-ticket Wave 1E review — 2026-08-02

Status: implementation, independent review, runtime tests, cross-runtime parity, and recovery
evidence complete for this bounded slice. This document does not declare the whole SQLite
transaction owner, Wave 1E, or the public Graph Engineering release complete.

## 1. Scope and acceptance boundary

This slice followed the strict remaining work recorded in master-plan section 31.37.73.5. It
implemented and verified:

1. a TypeScript package-private five-dimension evidence-mismatch seam over native affected,
   `changes()` affected, native `totalChanges` delta, outer ledger, and cursor-private ledger;
2. every `C(5,2)=10` selected pair plus four multi-dimension selections, including all five;
3. completed native E → adoption → W/Rule11 failure authentication and handoff to the existing
   post-consume transaction failure finalizer;
4. a Python exact-E handoff that is safe against CPython object-ID reuse, copied ContextVar
   contexts, retained copied contexts, replay, and graph reverse roots;
5. a real SQLite `AFTER UPDATE` amplification case common to TypeScript and Python;
6. a portable reporter/comparator for one authentic success baseline, one genuine native trigger
   disagreement, and 11 pure checker-input combinations derived from authentic real-SQLite
   evidence;
7. rollback, close, reopen, integrity, foreign-key, baseline-row, and v2-artifact recovery proof.

It intentionally did not add a public API, package-root export, release gate, success transaction
owner, Rule12, TEMP retirement, third clock, final commit fence, or driver-native cleanup-throw
adapter.

## 2. Rejected implementations and why they were rejected

### 2.1 Python integer identity was not object identity

The prior implementation stored only `id(E)` and a boundary in the execution state. An independent
review forced the original exception out of scope, allocated a same-class replacement, and observed
immediate CPython ID reuse for both raw pre-query and raw post-query failures. The replacement was
incorrectly accepted. This was an H1 correctness defect even though the earlier transferred-
traceback substitution tests passed.

The integer-only design was removed. It is not retained as a fallback.

### 2.2 A global execution-state strong Error was also rejected

A temporary fix stored exact E strongly in the globally reachable execution state. That prevents ID
reuse, but E's traceback can retain the proof frame, execution, connection, and graph. The global
registry then retains E, so the weak execution callback cannot fire. Main-thread analysis rejected
this reverse-root cycle before acceptance.

### 2.3 Mutable ContextVar capture admitted copied contexts

The next design used a synchronous ContextVar capture and cleared it in the finalizer's `finally`.
An independent read-only audit used `copy_context().run(lower_proof)`. Because copied contexts shared
the same mutable capture object, the child context wrote a ticket that the parent context consumed.
The audit also retained the copied Context and proved the ticket's non-optional connection field kept
the connection rooted after reset. This was M1 and blocked release of the slice.

The accepted Python design uses:

- a frozen per-context phase wrapper: `armed → recorded → consumed`;
- an unforgeable per-arm nonce;
- a shared short-lived ticket whose connection/state/error/boundary fields are all clearable;
- child-context `ContextVar.set(recorded)` that cannot update the parent's phase;
- destructive clearing before object-identity and graph checks;
- unconditional clearing again before token reset on every exit.

If a copied child records E, the parent remains `armed`, so take rejects. Parent reset clears the
shared ticket, so a deliberately retained child Context references only an empty ticket. The formal
regression retained the child Context while proving execution, error, and authority weak references
all became dead and the execution registry returned to baseline.

### 2.4 TypeScript outer-ledger rows initially overstated combination coverage

The first TypeScript matrix selected all requested dimensions, but an outer-ledger selection threw
before the native/changes/total/cursor projections were evaluated. Four pair rows and two multi rows
therefore proved outer-first fail-closed behavior but did not prove the other selected dimensions had
actually reached the checker. An independent audit classified this as an M truthfulness gap.

The accepted implementation freezes honest real-E counts, constructs every selected projection,
runs the pure five-count evaluator, and records exact projected counts/evaluated dimensions before
choosing the outer-ledger first-poison branch. The outcome verifier recomputes each projected field
from honest observation plus the selected dimension, recomputes the checker result, and binds the
outer bit. Completed-E finalizer authentication requires that verifier and requires a rejected
checker with exactly one violation for both outer-ledger and five-count boundaries.

## 3. TypeScript runtime matrix and completed-E finalizer

The exact-S arm validates a normal array with sorted, unique dimensions from the fixed five-value
vocabulary. It is one-shot and mutually exclusive with existing release and changes fault arms. The
handoff authenticates session, authority, connection, context, prepared owner, and exact E before
moving the immutable selection to the lower execution.

The lower seam is keyed by exact E and consumed only after real native UPDATE, real `changes()`, and
real `totalChanges` observations have completed. It never replaces the stored production execution
snapshot. Instead it builds a bounded test projection and records both honest and projected tuples.

The matrix contains the ten fixed pairs and four fixed multi selections:

- all ten pairs among N, C, T, O, and L;
- `{N,C,T}`;
- `{C,O,L}`;
- `{N,C,T,L}`;
- `{N,C,T,O,L}`.

For every selected graph, real E remains completed with honest N=C=T=L=population before projection.
The session tombstone, context, adoption, and authority are poisoned. Outer-containing selections
choose `SQLite rebind evidence mismatch outer ledger` first, leave W absent, and never mint Rule11.
Non-outer selections choose `SQLite Rule 11 five counts disagree`, poison W, and never mint Rule11.
Each adjacent unselected graph completes Rule11 with all five counts equal.

The completed-E primary registry stores only WeakRefs and is keyed by exact execution. Registration
rollback removes the pending ticket. Capture consumes it delete-before-use and checks exact
connection/session/context/tombstone/adoption/execution/primary plus the complete outcome projection.
Finalize repeats a pure graph assertion and preserves primary > rollback secondary > close tertiary.
The five-way case includes rollback and close ambiguity and still rethrows the exact leaf primary.

Frozen TypeScript validation:

- targeted matrix/completed-ticket cases: 17 passed, 27 skipped;
- complete Rule11 suite: 44 passed;
- complete finalizer suite: 20 passed;
- combined complete gate: 64/64;
- TypeScript typecheck: passed;
- SQLite build: passed;
- whole-tree diff check: passed.

Independent TypeScript audit final result: H0 / M0 / L0.

## 4. Python exact-E and real trigger mismatch

Six lower boundaries record exact E only inside an armed synchronous capture:

- serialized changes pre-query;
- prepare;
- execute;
- fetch;
- release;
- post-query.

Take switches the current phase to consumed, copies the exact presentation, clears connection/state/
error/boundary, and only then validates nonce, phase, exact connection, exact state, poisoned
lifecycle, and `recorded_error is caught_error`. Replay cannot install a new ContextVar phase. Nested
arm, cross connection, copied context, transferred traceback, substitute object, and post-reset take
all fail closed.

The real Python trigger case adds one genuine `AFTER UPDATE` write. Native affected, `changes()`, and
cursor ledger remain 1 while native total delta becomes 2. Admission is narrowly limited to the exact
lower post-query `ValueError("GE_CURSOR_B3_CURSOR_CHANGES_LINEAGE")`, changes counts `(1,1,1)`,
changes affected equal to native affected, total delta greater than affected, and otherwise exact
connection/generation/epoch/ledger predicates. A raw post-query exception under the same trigger is
rejected, proving the count shape alone cannot mint authority.

Frozen Python validation before the final mechanical formatter pass:

- finalizer suite: 51/51 in 268.96 seconds on the main-thread rerun;
- subprotocol suite: 60 passed and one honest bounded CPython ID-reuse skip in 251.35 seconds;
- lower rebind source suite: 40/40 in 2.31 seconds.

Ruff formatting then changed only layout in the finalizer and test file. Independent `git diff -w`
review found no semantic change. On the formatted frozen bytes, the decisive copied-context,
six-boundary transferred-traceback, real-trigger, and raw-post-query cases passed 9/9. Ruff lint,
Ruff format-check for the two normally formatted files, mypy, py_compile, and diff-check passed.

Independent formatted-byte Python audit final result: H0 / M0 / L0.

## 5. Portable counter-combination conformance

The portable reporter deliberately separates genuine native observation from pure checker-input
corruption.

Authentic baseline:

- B2/N/C/T/L = `1/1/1/1/1`;
- outer ledger stays `4/27/9`;
- cursor ledger moves `0/0/0 → 1/1/1`;
- actual runtime checker accepts.

Genuine trigger amplification:

- B2/N/C/T/L = `1/1/1/2/1`;
- disagreement edges are N!=T, C!=T, and T!=L;
- exact primary is preserved;
- rollback and close attempt exactly once;
- reopen proves cursor count 1, operation count 1, v2-only artifact count 0,
  foreign-key violations 0, and integrity `ok`.

Checker-input layer:

- starts from the authentic real-SQLite tuple;
- executes each runtime's actual pure Rule11 checker;
- covers six pairs, four triples, and one four-way subset over N/C/T/L;
- all 11 are rejected with one violation and non-truncated diagnostics;
- explicitly labels these as checker-input corruption, not native driver observation.

Fixed nonclaims cover all O-containing portable combinations, independent native/changes,
native/cursor-ledger, and changes/cursor-ledger native-observation drift, plus driver-native result
shape/throw combinations. The reporter never fabricates those as real SQLite output.

Final frozen-byte parity:

- new counter-combination suite: 3/3, 32.99 seconds;
- old Rule11 plus old finalizer parity: 4/4, 115.40 seconds;
- both reporters run twice per runtime and require per-runtime determinism and runtime-neutral
  byte equality;
- hostile comparator mutations and reporter-source isolation pass.

## 6. Frozen file identity

All files are mode 0644.

- TypeScript rebind: `5c27bfa818ea611eddada813e8cc8c79058bd4a01ace3e735c9ce23954ba1e6b`;
- TypeScript finalizer: `dfcd8534ca9900b3965900fbc4dedcff9d0f40019e9364db7e1ad040f4120d89`;
- TypeScript connection: `139adb6967787eca4707ae93d1b840e080ac466a2e772a733b801692ff4495c4`;
- TypeScript Rule11 test: `bcfd544b7280a696ce8f7de005e709ace4f5a754ee4f18d76d4e30a70023e81f`;
- Python lower source: `b3f28c3edf86a32c5c7778f4d2e116660c35f228d7abff3bb246a63bb001b961`;
- Python finalizer: `fbd3e1e3e6c81649b407c4aa8263c293c4406afbb462d35f4baeecb5ff4940e1`;
- Python finalizer test: `d451013434ded959bbdda92633a4abc813710eeff2fd09049d51f8d30a463862`;
- TypeScript counter reporter: `b5ddb68aad7c7f95ad4058130c6f68231d53cb0397b31a988cf23360a85c1560`;
- Python counter reporter: `a923add81d56a5160d279392c1c85c0c5b70b629052e43420d839e1d80439f68`;
- counter parity test: `da96fd7a42bd31080f6a714f0f2c7d37e345c9cab22ecb67fb6f74ccf4ce8df4`.

## 7. Strict nonclaims and next work

This slice does not prove the full Python runtime-local five-dimension pair/multi projection matrix;
Python contributes the genuine native total-amplification case and portable pure-checker matrix.
It does not prove driver-native rollback or close throws. It does not complete the success-side
transaction owner, BEGIN/COMMIT ownership, Rule12, TEMP retirement, third clock, or final commit
fence. It adds no public workflow integration or release gate.

The next implementation slice should choose one bounded objective: either build the Python
runtime-local five-dimension matrix with the same post-observation truthfulness and cleanup semantics,
or start the success transaction owner contract. It must not combine both into one unverifiable
claim.
