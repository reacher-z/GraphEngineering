# SQLite Cursor B3 — publication-session contract hardening

Date: 2026-08-02

Branch: `feat/authoring-foundation`

Plan authority: master plan §31.37.54

Status: **accepted for scoped commit.** The publication-session boundary is
now closed strongly enough for independent TypeScript and Python runtime lanes
to implement against the same contract.

## Outcome

This leaf freezes the transition from `pre-rebind-complete` to
`publication-active`. It does not implement that transition. The contract now
defines one opaque, module-minted, single-use publication session derived from
the exact live outer publication authority and stage-adoption graph.

The session binds exactly 22 commitments, including the projection reference,
all three ownership objects, connection and transaction lineage, complete live
lock authority, provider-clock capability and second evidence, the post-0002
catalog fence, the stage-adoption receipt, and both source and target
descriptor/schema identities. Clone, cross-run and substitution attempts are
explicitly rejected.

The public orchestration shape is closed as prepare, observe, publish. Every
continuation is prepared before evidence consumption. The second provider-clock
boundary is exactly `before-cursor-rebind`, consumed by
`cursor-publication-session`, and chained to the outer-clock evidence receipt.
Cancellation is observed once before pending registration and before evidence
consumption, so a healthy cancellation can retry the same exact prepared graph
and observed evidence.

The successful publish tail is non-interruptible. It burns the three prepared
continuations, consumes the exact pre-rebind evidence, retains its tombstone,
publishes the lower ownership identities and outer session, then activates the
session. Cancellation reads, fault hooks, SQL, clock callbacks, caller
dispatch, imports, transaction control, cursor rebind and commit are all
forbidden inside the tail. Unexpected post-consumption failure poisons all
three owners and cannot expose a readable pending session.

The three layers transition together and retain four exact identity edges:
outer authority, stage ownership transfer, baseline TEMP stage, and baseline
projection. The post-tail assertion is repeatable and read-only and must
revalidate eight exact proof classes. Its only permitted SQL is the two
module-owned read-only lock/catalog probes; it cannot consume the session or
clock evidence.

## Frozen files

| File | SHA-256 |
|---|---|
| `spec/conformance/sqlite-cursor-publication-rebind-v2.case.json` | `8d6cc2a6a817cbf70ecb88cf75339d92af5cdf091ed83616682da384320cb971` |
| `spec/conformance/sqlite-cursor-publication-rebind-v2.schema.json` | `f7c96820593092694f835bfe7e122ac5611d8670d6bfc3288ae9aa4a1bce4149` |
| `spec/conformance/sqlite-cursor-publication-rebind-v2.validate.mjs` | `91bc2429ef7f8075f93b9dee31a6f3a2fd38ad42fa17ec9624bebc12f5591a8c` |
| `spec/conformance/sqlite-cursor-publication-rebind-v2.test.mjs` | `8f6e3515b7397ac959956b11004eaaba1256f830a108a5eea3b6f1fbe51dfd0c` |

Canonical publication-session digest:
`cbfeca0302748a04e3806f45016af37653660a41ab168952c842da4cf7a4a193`.

Canonical complete-fixture SHA-256:
`7f890fe0512e1b3c7b500dd9c8f20a82fc41a99296d1b3538b379c46a8c317dc`.

The hostile registry remains 145 obligations, 145 records, 25 counter
profiles and 28 normalized fields. Its trusted registry and expanded-record
hashes remain respectively
`4e08dbd783213483692c0a2c36d4b8a3732f9b6b3e1a3f0e8bda24861b816e58`
and
`6bd821819215291851f2342b41beb565288e7c095de07fc066f47511cc232f95`.

## Defect chronology

Independent review rejected earlier green candidates until every boundary was
closed:

1. the success evidence temporarily carried a 29th field and validation used
   a slicing shortcut, allowing the frozen 28-field record contract to be
   bypassed;
2. the initial SQL prohibition was time-ambiguous and accidentally prohibited
   the required post-tail read-only assertion probes;
3. cross-run and substitution rejection, the baseline projection identity
   edge, and terminal burning of every prepared continuation on registration
   failure were not explicit;
4. the post-tail assertion required state and SQL properties but did not yet
   freeze its eight mandatory revalidation proofs;
5. a projection commitment used ambiguous object/reference language; and
6. the second clock evidence did not yet bind the exact boundary, consumer,
   predecessor, capability, distinctness and unconsumed state.

Each defect was corrected in the case, schema, validator and recursive
malicious re-sign tests. No finding was waived. Two independent read-only
auditors examined the final four SHA values and reported **HIGH 0 / MEDIUM 0 /
LOW 0**.

## Validation evidence

| Gate | Final result |
|---|---|
| Focused B3 contract tests | 35/35 passed |
| Direct B3 validator | passed; 145/145 records |
| SQLite ledger contract and strict validators | 62/62 passed |
| Fixture validator | 85 JSON fixtures / 44 case manifests passed |
| Canonical publication-session digest | independently recomputed and matched |
| Complete fixture SHA-256 | Node/Python recomputation matched |
| Frozen registry counts and hashes | unchanged |
| `git diff --check` | passed |
| Master-plan append-only prefix | HEAD first 18,282 lines exactly preserved |
| Independent final audit A | H0 / M0 / L0 |
| Independent final audit B | H0 / M0 / L0 |

## Nonclaims and next boundary

All implementation, protocol, active-manifest and release claims remain false.
This leaf does not execute a publication session, rebind a cursor, run rules 11
or 12, observe the third clock boundary, mint cursor-clock authority, commit a
transaction, activate the preview manifest, or claim production readiness.

The next leaf implements this frozen publication-session boundary in the three
ownership modules in each runtime with focused success, cancellation, failure,
identity and counter tests. Only after cross-runtime real-SQLite parity and the
affected regressions pass may work proceed to the inseparable rebind + rules
11/12 + third-clock + cursor-clock boundary.
