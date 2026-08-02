# SQLite Cursor B3 — publication-session runtime and parity acceptance

Date: 2026-08-02

Branch: `feat/authoring-foundation`

Starting commit: `91b37babcab481ff64c1a4ae3b4977b9765ea260`

Plan authority: master plan §§31.37.55–31.37.56

Status: **accepted for scoped commit.** All focused, affected-regression,
parity, static, type, package, garbage-collection and independent review gates
are green.

## Outcome

TypeScript and Python now implement the frozen publication-session lifecycle:

1. prepare the exact three-layer publication graph while every owner is still
   in `pre-rebind-complete`;
2. observe the second provider-clock boundary exactly once at
   `before-cursor-rebind`;
3. validate cancellation and pending registration before any irreversible
   transition;
4. burn every prepared continuation, consume the exact pre-rebind evidence,
   retain both clock tombstones, publish the lower ownership identities and
   outer session, and activate all three layers in one non-interruptible tail;
5. re-prove the resulting active graph against the exact connection,
   transaction lineage, live migration lock, catalog fence, predecessor,
   tombstones, ownership edges, clock head and zero-third-observation rule.

The session binds the contract's 22 identity and scalar commitments. It is an
opaque, package-private, single-use authority: clones, foreign identities,
cross-run values, substituted capabilities, wrong consumers, wrong
predecessors, expired or drifted locks, replaced transactions, epoch/change
drift, early third observations and reentrant or poisoned clock authority are
rejected.

Healthy cancellation occurs before the atomic tail and leaves the exact graph
retryable. Registration failure burns pending state without consuming clock
evidence. Unexpected failure after the irreversible point poisons the outer
authority, ownership transfer and TEMP stage together. A previously poisoned
outer owner cannot suppress lower-layer poison propagation.

## Runtime architecture

The runtime expansion remains internal to `@graph-engineering/sqlite` and the
Python SQLite provider modules. No package-root function, capability, prepared
owner, evidence, session, adoption receipt or cancellation surface was added.

The TypeScript implementation uses private module registries and frozen
snapshots. The Python mirror uses private registries plus carefully bounded
strong and weak identity edges. The registry topology retains a live authority
and its session in either direction while the graph is reachable, but it does
not globally root a dead graph. Old provider-clock capabilities and evidence
can be collected without invalidating the exact live tombstone proof chain.

Python's irreversible tail dispatches only through closure-captured intrinsic
callables and pre-resolved state. Replacing mutable module aliases cannot
redirect the tail. After pre-validation, the lower continuations perform only
one-way state assignments: no cancellation read, fault hook, SQL, provider
clock, caller callback, import, transaction control, cursor rebind, commit,
registry lookup or registry deletion can occur.

The second-boundary clock assertions are read-only. Every active assertion
performs exactly one semantic migration-lock read and one two-component catalog
observation, while performing zero provider-clock callbacks, evidence
consumption, writes, transaction transitions, rebinds or commits.

## Honest conformance activation

The conformance lane derives expected normalized records from the frozen
fixture; reporters contain no self-authored normalized oracle. The relevant
fixture slice contains 25 candidate hostile ordinals. Four are honestly
executed through both real runtimes: `20`, `100`, `101` and `102`. The other 21
are explicitly classified by the unavailable seam or future boundary that
prevents honest execution in this leaf.

The global registry remains 145 obligations and 145 records. Its
`runtimeExecutionEvidenceClaim` remains `false`; this leaf does not turn four
executed records into a claim that all 145 records have runtime evidence.
Every activated record proves the exact raw runtime error, semantic error code,
non-retryability of the poisoned graph, success of a fresh graph and the exact
28-field normalized fixture record.

Both reporters emit exactly one compact canonical JSON value followed by one
LF and no stderr. The comparator independently loads and validates the frozen
fixture, reconstructs every expected record, checks exact key order and field
types, rejects extra stdout, proves every package-root exposure false, requires
all 14 static gates true, and compares success, cancellation and activated
record bytes across runtimes.

## Defect chronology and closure

Independent review rejected intermediate green candidates until all of the
following were closed:

1. Python active assertion duplicated live-lock and catalog queries. It now
   performs one semantic lock read plus one catalog observation; its traced
   native SQL footprint is exactly five statements.
2. Python lineage drift retired lower owners before poisoning them. All three
   layers now enter terminal poison together.
3. Both runtimes originally retained registry lookup/deletion inside lower
   atomic continuations. Every lower state and continuation is now pre-resolved
   and assignment-only. The outer tail still calls the exact closure-captured
   clock-consume intrinsic; its fallible tombstone allocation/registration is
   deliberately ordered before the evidence burn.
4. Python initially lacked authority-to-session retention. A first correction
   introduced a globally rooted bidirectional cycle; the final key-owned anchor
   topology preserves live identity without leaking a dead graph.
5. TypeScript active assertion briefly performed zero fresh lock/catalog
   checks. The exact native-read budget test now proves one lock and one
   two-component catalog observation per assertion.
6. Python old clock capability/evidence rings survived complete graph
   collection. Evidence capability edges are weak, while tombstones preserve
   the required live proof chain; orphan evidence rejects both fresh and reused
   capabilities.
7. Private authority/session anchor tampering could lose canonical state or
   contaminate a foreign graph. Registry state is canonical, anchors are
   comparison/recovery edges only, and foreign state poisons only its target
   graph while the source remains healthy.
8. Python second-boundary proof omitted active-expiry validation for the outer
   and second evidence snapshots. Both are now bound to the exact expected live
   lock tuple.
9. Replacing Python module aliases could redirect tail behavior. Hidden
   closure captures now bind the exact burn, consume, publish, slot-set and
   poison intrinsics; recursive bytecode/source gates verify the closure.
10. An already-poisoned outer authority previously caused an early return and
    could leave lower owners active. Poisoning is now idempotent but always
    propagates through all three layers.
11. Early reporter source checks were lexical and could miss indirect tail
    dispatch. Reporter gates now inspect the hidden implementation, captured
    callables and bytecode recursively.
12. Complete-graph lifetime was initially tested only through partial objects.
    TypeScript now runs an isolated `node --expose-gc` probe over graph,
    authority, prepared owner, evidence, session, adoption, transfer, stage and
    connection; Python restores the exact 31-entry private-registry baseline.
13. The first TypeScript reporter inspected only the outer atomic tail, so
    forbidden direct dispatch in a lower burn/publish closure could escape its
    standalone gate. Reporter and comparator now use one shared AST kernel to
    parse all five outer/ownership/stage closures in both source TS and the
    actually executed dist JS, requiring zero parse diagnostics, unique target
    declarations and exact statement/call allowlists. Hostile source and dist
    mutations prove direct dispatch, stale activation, parse failure and
    duplicate declarations fail closed. Preloaded reporter mutations exit
    nonzero and emit no JSON, and the reporter refuses to emit unless all 14
    static gates are true.

No finding was waived.

## Frozen implementation fingerprints

### TypeScript runtime and tests

| File | SHA-256 |
|---|---|
| `packages/sqlite/src/operation-baseline-stage.ts` | `4d9339e4778c82d1659b958e7cc78d7bf7f7b9f6e3edfc5fcb2e14737f9a6fa9` |
| `packages/sqlite/src/operation-baseline-cursor-stage-ownership.ts` | `541e4a38dc3b3c7cb58c7d84aafbe611d0faf69cde4ed157e9b7c75ee3019bf4` |
| `packages/sqlite/src/cursor-publication-clock-authority.ts` | `a5abca42ac38c08f8d3a679b59c737c7abe782ac32e7b284481f78753a9b494c` |
| `packages/sqlite/src/cursor-publication-outer-authority.ts` | `d2ed68af488c5638b07740040d9fd0efa59679357930ca448d9b3e6ef4ae6fe1` |
| `packages/sqlite/test/cursor-publication-clock-authority.test.ts` | `a7ed3654c0cfa91fca88093c894c9ad16a6f173aa922b9c4adada2b0841302c2` |
| `packages/sqlite/test/cursor-publication-session.test.ts` | `f391f66859f1b4446a71a0eb731c04913818c4315b21a6009145f07695459410` |
| `packages/sqlite/test/cursor-publication-session-query-budget.test.ts` | `5b07232d459c8d655bd77c881d73e16cf60fe17bf79c7b17b1452d8071c87da7` |
| `packages/sqlite/test/cursor-publication-session-complete-graph-gc.test.ts` | `7d391f44684795d82c2bdf683d2e0766a9345ee015bb9431377f11fda3da9b17` |
| `packages/sqlite/test/probes/cursor-publication-session-complete-graph-gc.probe.test.ts` | `8cc4c99b2d31e5cdd7a2d8242e716fe7617a95a4663a463129e936afe77c7fa7` |

### Python runtime and tests

| File | SHA-256 |
|---|---|
| `python/src/graph_engineering/sqlite_cursor_publication_clock_authority.py` | `e12df510145ec2fb2fb0e0ff8ada30607e6dab412b50d8b11060bf341f008e88` |
| `python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py` | `ca2e68437d1a9f1a2b5b7fdf5cea6fffbd3f15199df9d040dc43f0f75b01ff85` |
| `python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py` | `4f17ae3f221b1cbb7f5b07b077edc091e5f4a9e0132a9311bbb74e6c68b093d6` |
| `python/src/graph_engineering/sqlite_operation_baseline_stage.py` | `cad590936adc60263bd8693137e5a3a6ba67158ff70e41dfe15999098c3b1898` |
| `python/tests/test_sqlite_cursor_publication_clock_authority.py` | `e5a59c2800f4447a361cf74d54b324288080f1a1282d697fe3681983f2955263` |
| `python/tests/test_sqlite_cursor_publication_session.py` | `da1d0e9f7e8b0ed6a82d6523015d4b8ff32374e97e22643158e4e7150bee2a4b` |

The aggregate of those six Python `sha256sum` records is
`2bed98d73d5d5c8774c2f380b8a751aef8163508643db7cdd7aefdb1dda2e177`.

### Cross-runtime conformance

| File | SHA-256 |
|---|---|
| `tools/conformance/sqlite_cursor_publication_initial_typescript_report.mjs` | `7030c05925133cceb151184efd10f07aee8a542286488ca0cbb2e2417a516924` |
| `tools/conformance/sqlite_cursor_publication_session_activated_records.mjs` | `0b043cbb479948d7f32c4dd68f1ba1e02cf43e5759dd771a3eefed382ba202be` |
| `tools/conformance/sqlite_cursor_publication_session_typescript_tail_audit.mjs` | `dce2b1ef88ce9332f5a47e3fcb7c7a7c272fc8f6f7ec93555f2530eb8a1c5d7a` |
| `tools/conformance/sqlite_cursor_publication_session_typescript_report.mjs` | `cbfe67896e8cae69ba6dba2d5ba38828ee1baba7a18288d49d345529d13543af` |
| `tools/conformance/sqlite_cursor_publication_session_python_report.py` | `27c54cbc87bc8489698829bb9991ef27246ce1de4f87b73f556b6dddbc2505e8` |
| `tools/conformance/sqlite_cursor_publication_session_parity.test.mjs` | `423e2be3b16fc3043ca5a2fe4815dcfd6654dfbd024b2d296b02252885c41556` |

## Validation evidence

| Gate | Final result |
|---|---|
| TypeScript focused publication-session/query suites | 3 files, 26 tests passed |
| TypeScript affected regression | 6 files, 14 suites, 435 tests passed |
| Full TypeScript SQLite suite | 37 files, 85 suites, 1,061 tests passed in 252.751 s |
| TypeScript typecheck | passed |
| Isolated TypeScript complete-graph GC | 1/1 passed under `node --expose-gc` |
| Python focused clock/session suite | 55/55 passed |
| Python directed lifetime/atomic-tail review | 11/11 passed |
| Python independent frozen-byte review | 10/10 passed |
| Python ten-file affected regression | 307/307 passed in 871.77 s |
| Session parity | 12/12 passed; 0 failed/skipped in 145471.305 ms, including shared-kernel source/dist fail-closed mutations |
| Initial-publication parity | 3/3 passed |
| Provider-clock parity | 2/2 passed |
| TypeScript reporter strict oracle | passed |
| Reporter protocols | TypeScript: 7,311 stdout bytes; Python: 7,038 stdout bytes; both exit 0, stderr empty, one canonical JSON + LF and 14/14 static gates |
| Python Ruff check and format | passed |
| Python mypy | four production modules passed |
| Python `py_compile` | six changed source/test modules passed |
| SQLite contract/ledger gates | 62/62 passed |
| Fixture validation | 85 JSON fixtures and 44 manifests passed |
| Documentation links after this log and plan append | 477 links passed |
| npm package-content audit | 9 manifests/tarballs passed |
| npm packed-install audit | 9 tarballs passed |
| Fresh Python wheel/sdist install | 115 wheel / 116 sdist members; isolated installs, entry points, version, shared YAML, validate and doctor passed |
| Repository-outside Python pack audit | source/wheel/sdist outer-module SHA matched; zero repository-root, tool, Codex, package, spec or test leakage |
| `git diff --check` before this log | passed |
| Independent TypeScript runtime audit | H0 / M0 / L0 |
| Independent Python runtime audit | H0 / M0 / L0 |
| Independent reporter/runtime audit | H0 / M0 / L0 |

The exact directed lifetime/atomic-tail selector was 11/11 passed with 44
deselected in 45.48 s. After this log and the append-only checkpoint were
written, documentation links, package contents, diff hygiene and every
implementation fingerprint were recomputed. The first 18,869 plan lines still
matched their frozen SHA exactly.

The final wheel SHA-256 is
`058c7a1a3ec56c12cef3177fcaf412ba4e8c6a891096b1160790ed8fb48c7893`;
the final sdist SHA-256 is
`ec09b558c0cd13f0e1872f9bc2c6206bc1dade630214c757042c411551cd37be`.
Their embedded outer-authority module SHA exactly equals the source value
`ca2e68437d1a9f1a2b5b7fdf5cea6fffbd3f15199df9d040dc43f0f75b01ff85`.
The audit rejected one build taken across the final comment-only byte change,
then performed a stable rebuild and used only the stable artifacts above as
evidence.

## Nonclaims and next boundary

This leaf does not execute cursor rebind, activate rules 11/12, observe or
consume a third provider-clock boundary, mint cursor-clock authority, commit
the transaction, activate the complete hostile registry, change the frozen
fixture, expand a package-root API or claim production/release readiness.

The next inseparable leaf is cursor rebind + rules 11/12 + third provider-clock
boundary + cursor-clock authority. Its implementation must preserve the exact
publication-session graph accepted here, must not introduce a synchronization
gap between those operations, and requires its own append-only contract and
cross-runtime acceptance barrier.
