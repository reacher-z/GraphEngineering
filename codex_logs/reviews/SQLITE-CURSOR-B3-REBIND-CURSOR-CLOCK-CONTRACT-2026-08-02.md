# SQLite Cursor B3 Rebind and Cursor-Clock Contract Acceptance

Date: 2026-08-02 PDT

Branch: `feat/authoring-foundation`

Parent commit: `2a1fbcd2dc94d75687b5c392adf887ff5e5428fd`

Milestone type: contract hardening only

## Outcome

The cursor-rebind leaf from `publication-active` to
`cursor/clock-complete` now has one closed, exact, independently audited
contract. The fixture, Draft 2020-12 schema mirror, semantic validator and
malicious re-signing tests agree on:

- one opaque cursor-rebind prepared owner;
- publication-session single-use consumption and retained tombstone;
- the fixed rebind write receipt and exact statement/change/ledger proof;
- Rule 11 and Rule 12 success receipts with exact predecessor identity;
- the third `before-verification` clock observation after Rule 12;
- an unreadable pending cursor-clock graph;
- a non-interruptible completion tail with one clock-owned allocation
  exception;
- three-layer completion in exact reverse continuation order;
- a repeatable read-only active assertion with a fixed read budget;
- 25 exact failure-precedence arrays;
- six leaf failure profiles and one exact 28-field success record; and
- a nine-stage top-level order cross-linked to the prepared-owner lifecycle.

No production runtime was changed by this milestone. The fixture continues to
state `implementationClaim=false`, `protocolClaim=false`,
`activeManifestClaim=false` and `releaseGate=false`.

## Independent review corrections

The first independent audit found one high-severity internal contradiction.
The coarse top-level stage list consumed the publication session before
preparation, while the prepared-owner, retry and boundary contracts required
EQP validation, statement preparation and both cancellation checks before
consumption. A validator could have accepted both contradictory arrays because
each was independently frozen.

The contract was corrected to this exact order:

1. prepare the exact owner through final pre-execute cancellation without
   consuming the session;
2. consume the exact session and retain its tombstone at the final no-write
   pre-execution boundary;
3. execute the fixed cursor rebind once;
4. release and prove affected count, `changes()`, `total_changes` and ledger;
5. mint Rule 11 success;
6. mint Rule 12 success after the bounded seal proof;
7. observe the third clock;
8. register the pending graph and three continuations; and
9. consume third evidence and complete all layers atomically.

The next independent audit found one medium-severity evidence gap: the test
called its mutation coverage systematic, but several new semantic groups could
only fall through to the generic fixture-hash rejection. The semantic validator
was extended with ten complete canonical object-group digests and dedicated
error codes. Re-signed mutations now exercise each group and the named thin
fields, including authority opacity/input, write execute count, Rule 11/12
blocking, bounded cursor counts, fourth-clock denial, pending cancellation,
partial-publication denial, failure-profile order, retry rollback and the root
transition.

The final review then found one remaining medium evidence gap relative to the
append-only plan: the nine-stage order and prepared-owner order were exact but
not relationally cross-linked. The validator now raises
`GE_CURSOR_B3_CURSOR_SESSION_CONSUMPTION_ORDER` before the root digest unless
all of these relations hold:

`pre-prepare cancellation < prepare < pre-execute cancellation < session consume < tombstone retain < execute`

It also cross-checks `orderedStages[0..2]`, the exact session-consumption
boundary and both pre-consumption retry declarations. Three re-signed tests
independently move consumption before preparation, move execution before
consumption and make healthy pre-consumption cancellation terminal. All three
must reach the dedicated error code.

After these corrections, two independent read-only final audits reported
H0/M0/L0.

## Frozen identities

- Case file SHA-256:
  `e188b35f43021186756edb60715ba6a6edc9699f9f5b885578fab7bd2b51a883`
- Schema file SHA-256:
  `70347ad80215cb39071de2a97d7c420e0ee86288cf50b7b5f51fee409edc62f9`
- Validator file SHA-256:
  `449dda8f9535703ae47b20e78fa954888b92ee1eb28a65ca6279ea0d0320eb09`
- Test file SHA-256:
  `9b1bff2a991949f57f9485c38ef49f74a21c9d1953137cfedf21448fca78104e`
- Canonical fixture digest:
  `d368cd53e819e06e950f2dabedcb5a5b2fca535536efe85abb2e4b488bae2e7d`
- Trusted hostile registry digest:
  `4e08dbd783213483692c0a2c36d4b8a3732f9b6b3e1a3f0e8bda24861b816e58`
- Trusted expanded-expectations digest:
  `6bd821819215291851f2342b41beb565288e7c095de07fc066f47511cc232f95`

The 145 hostile obligations and 145 hostile execution records are exact-equal
to the parent commit. Record ordinals remain consecutive from 1 through 145.

## Validation evidence

### Focused and semantic

- `node --test spec/conformance/sqlite-cursor-publication-rebind-v2.test.mjs`
  passed 39/39.
- `node spec/conformance/sqlite-cursor-publication-rebind-v2.validate.mjs`
  passed and recomputed the accepted canonical digest.
- `node --check` passed for validator and test.
- strict JSON parsing with duplicate-key detection passed for case and schema.
- duplicate-key and trailing-content attack inputs were rejected.
- strict Ajv Draft 2020-12 schema validation passed.
- unknown-field injection at all 453 concrete fixture object paths accepted
  zero mutations.
- ten semantic-group digests were independently recomputed and matched their
  trusted constants.
- independent additional mutations returned their group-specific error codes.

### Wider gates

- `corepack pnpm test:sqlite-ledger-contract` passed 66/66 test cases and all
  chained validators.
- `corepack pnpm validate:fixtures` validated 85 JSON fixtures, including 44
  case manifests, and retained the 145-obligation B3 corpus.
- `corepack pnpm check:docs` checked 477 local Markdown links.
- `git diff --check` passed.

## Append-only plan proof

- Parent-plan prefix, first 19,060 lines:
  `71740e6b4a574a41cb9684c64711557ea8fc28d5bde05e1446ded9ab1e10aaa8`
- Contract-barrier prefix, first 19,440 lines:
  `aaa0a5fd9135ca5788915a5f199662f959d5bb5d93e7677188f5025a1bd76998`
- Tombstone-correction prefix, first 19,476 lines:
  `bcb3dffac0803f72a16fb013f86ae0571604cc161fdaf311b071551a0fd5e37e`

Every prefix matches its recorded value. Sections 31.37.58 through 31.37.60
were appended; no pre-existing plan byte changed.

## Explicit nonclaims and next leaf

This milestone does not execute the cursor update, implement Rule 11 or Rule
12, observe a runtime third clock, mint runtime cursor-clock authority, retire
TEMP state, publish lineage or metadata, commit a migration, activate the v2
manifest, prove runtime parity, claim production readiness or guarantee GitHub
stars.

The next authorized implementation leaf is the indivisible TypeScript and
Python runtime transition from `publication-active` to
`cursor/clock-complete`, driven by this accepted contract. Runtime activation
must remain false until real hook evidence, hostile fault/cancellation tests,
query budgets, static gates, cross-runtime parity, full SQLite regressions,
fresh artifacts, installed smokes, GC probes and another independent
severity-zero review all pass.
