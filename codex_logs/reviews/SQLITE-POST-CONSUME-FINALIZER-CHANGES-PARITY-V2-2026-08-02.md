# SQLite post-consume finalizer changes-primary and recovery parity v2

Date: 2026-08-02 PDT
Branch: `feat/authoring-foundation`
Base commit: `24f8777a24d7fad76e18a5d7e1ba67fa69c8de21`

## Accepted outcome

This wave extends the package-private failure finalizer from the native rebind
failure boundary to every authenticated post-T serialized `changes()` boundary
implemented by the TypeScript and Python runtimes. It also adds an independently
checked, real-SQLite, cross-runtime recovery reporter.

The accepted scope remains failure-only. It does not own BEGIN, COMMIT, Rule 12,
TEMP retirement, a success commit fence, or a public workflow integration.

## Cross-runtime recovery parity

The first reporter draft passed byte parity while hiding a real state difference:
TypeScript inserted its source cursor inside the transaction and recovered zero
rows, while Python committed the cursor before BEGIN and recovered one row. An
independent audit rejected that draft as H1.

The corrected graph builder commits the TypeScript control operation and cursor
population before `BEGIN EXCLUSIVE`, matching Python. Recovery now publishes and
strictly checks this ordered exact evidence:

- application ID `1195724359`;
- `user_version=1` and schema singleton `current_version=1`;
- schema identity `f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4`;
- trusted v1 catalog SHA-256
  `8fab5049e2c9de5d114abc0c682934f1bc6fb5abd2e4c2e3ae55ef329c3e7264`;
- exact cursor and operation row counts `1/1`;
- zero matches across all nine v2-only or migration-temporary catalog names;
- zero foreign-key violations and `integrity_check=ok`;
- domain-separated, fully typed cursor+operation baseline SHA-256
  `7844faec4246da8bbc86a74f5677117f04ac7f574e0bdc1eee5558dea8d0efce`.

The comparator rejects unknown/missing/reordered fields, unsafe counts, diagnostic
or claim drift, and two mutations for every recovery field. The Node test performs
a fresh SQLite package build before loading `dist`. Python removes its temporary
root even if graph construction fails. Corrected parity passed repeatedly; final
main-thread run passed 1/1 in 51.79 seconds. The old Rule 11 parity remained 3/3.
Independent final parity audit: H0/M0/L0.

## TypeScript serialized changes primary

An exact-S package-private arm weakly records authority, connection and error,
then hands the selected fault to the exact prepared E only after authenticating
S/context/prepared-owner/execution identity. The E registry also weakly records
connection and error. Both levels use register-then-throw rollback,
delete-before-use, dead-error fail-closed behavior, cross/forged/proxy rejection,
and bounded-GC evidence proving no reverse root.

The explicit after-native-return marker is written only when the registered exact
E is actually taken. Genuine driver/native errors leave that marker null and are
classified from authenticated post-T progress instead of being mislabeled:

- native execute: zero total delta, zero private ledger and zero changes counts;
- genuine changes prepare: exact B2/native progress, `0/0/0`, result absent;
- genuine changes fetch or validation: `1/1/1`, result absent;
- genuine changes postflight: `1/1/1`, result equals affected;
- injected prepare/fetch/shape/release: explicit exact-E boundary plus its exact
  counter/result projection.

All changes paths bind affected rows to the exact context B2 population, including
0, 1 and 3, and bind total delta plus private ledger `(affected,1,1)`. A selected
plain Error bypasses generic SQLite translation only when object identity equals
the exact registry result. Cleanup faults cannot replace it. Real native prepare,
native `all()`, postflight, injected four-stage, reopen, fresh graph, replay,
near-neighbor and root non-export cases are covered.

The six-file suite passed 91/91 with isolated GC subprocesses. Independent audit
found H0/M0/L1: only two shared registration helpers emitted release-specific
expiry text for changes faults. The helpers now take an exact fault-kind literal;
typecheck and focused registration/exact-S/exact-E tests passed 11/11. No semantic
finding remains. `StatementSync` has no native close interface, so release remains
honestly described as logical retirement.

## Python exact lower-E identity

The initial expansion correctly covered pre-query, prepare, execute, fetch,
release and post-query state shapes, but authenticated provenance only by scanning
the exception traceback for the lower proof code object. An independent reviewer
demonstrated that a substitute exception could copy the real traceback, retain the
same poisoned graph state and mint an owner. That version was rejected as H1 and
never committed.

The accepted design moves identity evidence into the lower execution owner. At
the instant each serialized changes primary escapes, lower state records only
`id(E)` and one honest six-way boundary literal. It stores no Error or traceback
reference. The package-private take intrinsic authenticates exact connection and
execution, copies the integer identity and boundary, clears both fields before
any later check, and accepts only a poisoned execution whose recorded ID equals
the directly caught E.

Capture consumes that record once and stores the pure boundary in finalizer state.
Finalize does not consume a second time: it revalidates the stored boundary against
the exact authority/context/T/E graph, B2 population, transaction generation and
epoch, total changes, cursor ledger, changes counters and result shape. A mismatch
is destructive and cannot be retried as an oracle.

The final six-case correctness matrix catches a genuine lower primary, creates a
different exception carrying `real.__traceback__`, and raises the substitute for
pre-query, prepare, execute, fetch, release and post-query. All 6/6 substitutes
are rejected; after mismatch, even the real original cannot consume the cleared
record. Genuine lower primaries still mint and finalize, retain exact object
identity, perform one real rollback and one real close, reopen to v1, and preserve
the existing GC and one-shot properties.

Final Python results on frozen bytes:

- finalizer: 44 passed in 217.70 seconds;
- subprotocol: 60 passed and one honest bounded CPython ID-reuse skip in 239.03 seconds;
- lower source: 40 passed in 1.90 seconds;
- copied-traceback matrix: 6 passed in 28.13 seconds;
- Ruff lint and mypy: passed;
- independent final correctness audit: H0/M0/L0.

The touched lower source already had repository-wide Ruff formatter drift on the
base commit; CI runs Ruff lint, not formatter check. This wave did not introduce a
large unrelated whole-file formatting rewrite. Ruff lint is clean and all changed
Python logic is type-checked.

## Main-thread verification

- Canonical finalizer contract: 10/10.
- Standalone trusted validator: passed.
- TypeScript typecheck: passed after the diagnostic correction.
- TypeScript finalizer focused rerun: 20/20.
- TypeScript registration/exact-S/exact-E correction: 11/11.
- Python copied-traceback matrix: 6/6.
- Python lower-source regression: 40/40.
- Python Ruff lint and mypy: passed.
- Final real-SQLite cross-runtime parity after all runtime edits: 1/1.
- Whole-tree `git diff --check`: passed.

## Frozen file identities

All files are mode 0644.

- TS rebind: `ef0a5a141f3e719f83b7e6908ddc50974ec8f673b6f8d5f0fd0cd702b9b1712f`
- TS finalizer: `3c938e6d00ea70af63b39577a5e3557b152d615a3e14db0d6f2b6e62ee6532bd`
- TS connection: `62e553dbd29798c94c2140a5fcba35b76268195d4543f088c2cec01529b34d9a`
- TS connection test: `b491f916a7f1d1b6f93fd16e78e82f730e9733b54cca627698ab4c73932c1ba7`
- TS Rule 11 test: `034bf09da8fca924072009740eba9d9ce52264b1381a92fc98061f867deb0bb9`
- TS finalizer test: `8cbb7cfff8f5bed6a183f9b2e7e955ea819c520f97d41bdc580e25e1d415a56d`
- Python lower source: `f1e883f43f363d22fe90da188042462c9099b507a5cbfa4a4c608f7c54f330f7`
- Python finalizer: `0d538ff906aed829570dd06cec9f7be4985dbdc59a26954fcd7220b6f06588a3`
- Python finalizer test: `1bad045c8a6df8d902a7b3fc8639aed22e4a502ee5abeaeb90afd67848569017`
- Rule 11 TS graph helper: `f6cf1c28df55b3a243336cd2a5354839440f54704cdcc7716e79bbb661abd397`
- TS reporter: `85ea8a4093c21799b8726c4c8761e95152f6b9d19a1b7c5170fe8a7653b2653c`
- Python reporter: `4274ee529be36340667ae1bd86c25efe11b8925afbc7baf30e037487ef004c13`
- parity test: `f9f258582358acc383730f4f4dcd1d8fd3035d5b3c3ce34f7fef0c2802a84912`

## Remaining strict nonclaims

- No public production workflow or release-gate integration.
- No success transaction owner, BEGIN/COMMIT ownership, Rule 12, TEMP retirement,
  third clock or final commit fence.
- No driver-native rollback or close throw; cleanup injection remains explicitly
  after-native-return ambiguity.
- No claim that the complete native/changes/total/ledger pairwise and multi-point
  mismatch matrix is finished.
- No claim that the bounded Python ID-reuse test observed a real reuse on this host.
