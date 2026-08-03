# SQLite P11-A global callsite inventory closure log

Date: 2026-08-03 PDT

Task: `D9-SQLITE-OWNER-COMPOSITION-P11-094`

Status: accepted bounded inventory/CI remediation; P11 remains `in_progress`

## Trigger and root cause

After the NP1 runtime and evidence commits were pushed, the full native-callsite
scanner reported 451 candidates instead of the frozen 457. The initial six-item
drop was not a harmless golden-number change: NP1 had replaced member-method
access with definition-time native helper calls that the scanner could not see.
The NP1 local umbrella also omitted the already existing classification-parity,
callsite-contract, and route-map gates, so the focused runtime command could pass
while the complete CI graph would fail.

The remediation therefore strengthened observation rather than weakening the
expected counts. TypeScript now proves canonical `sqlite-connection` helper
imports and immutable aliases for prepare, iterate, next, and return. Python now
proves the complete private producer binder before recognizing owner execute,
cursor fetch, and cursor close. The independent Python classifier reparses and
reproves that binder instead of trusting scanner confidence.

## Hostile review and repairs

Parallel review rejected early implementations until all of these cases failed
closed: parameter/local/mutable helper shadowing; function, class, `var`, block,
catch, loop, and switch lexical shadowing; type-only imports; same-basename fake
modules; binder capture replacement; `Assign`/`AnnAssign` rebinding; parameter
store; nested-producer argument replacement; binder return replacement; hidden
install under `if False`; install inside an uncalled function; and a valid
top-level install accompanied by a hidden duplicate.

The accepted proof requires exactly one install call in the entire Python AST,
exactly one direct top-level module expression containing that same AST node,
no keyword arguments, one exact binder argument, one exact implementation, and
the unique direct binder return of its nested producer. Independent final review
reported `H0 / M0 / L0`.

## Accepted immutable implementation

Implementation commit:
`a7452f03d4dfe7d5001f49acfaae4d037bd9bc04`

Subject: `fix(sqlite): close native callsite inventory drift`

The commit contains 12 files, 2,849 insertions, and 1,100 deletions. Author and
committer are both `reacher-z <mtrxcop@gmail.com>`; the body is empty and has no
co-author trailer. The commit was pushed to
`origin/feat/authoring-foundation`; local `HEAD`, tracking ref, and remote ref
were read back as the same full SHA.

The master plan change is append-only section 31.37.105. Its original 23,623-line
prefix retains SHA-256
`92b436db91f891de0f03e4d4a45e38f64ddd418c34ab376a5f1d8ba66445c42f`.

## Deterministic accepted inventory

- Global scanner candidates: 485 = TypeScript 231 + Python 254.
- Global route classifications: 485 unknown; none dropped.
- RM1 bounded source scope: 70 = TypeScript 20 + Python 50.
- Scoped call families: 23.
- Scoped logical executions: 50.
- Scoped resource lifecycles: 50.
- TypeScript scoped receiver categories: 8 confirmed native + 12 wrapper/probe.
- Python scoped receiver categories: 35 confirmed native + 6 wrapper/probe + 9 unknown.
- Python global classifier: 190 confirmed native + 31 wrapper/probe + 0 false
  positive + 33 unknown.
- Route, runtime, projection, and arbitrary SQL authority remain false.

## Executed acceptance evidence

`corepack pnpm test:sqlite-native-projection-runtime` exited 0 after the final
install-proof repair. Its expanded graph passed:

- NP1 contract: 6/6.
- TypeScript typecheck and focused/GC tests: 183/183.
- Python NP1 tests: 41/41, plus Ruff and strict mypy.
- Cross-runtime NP1 parity: 2/2.
- Native-callsite discovery: 7/7 and deterministic 485-candidate report.
- Python independent classifier: 11/11, plus Ruff and strict mypy.
- Classification parity: 2/2.
- Frozen callsite-map contract: 6/6.
- Route-map hostile/join suite: 11/11.

Additional controls passed: 478 documentation links; task registry 112 tasks/44
completed and graph 299 dependency edges/72 semantic edges; release map 178/178
with 40/40 tests; evidence closure audit-only 0/93 with 102/102 tests; JSON parse,
append-only prefix proof, and `git diff --check`.

## Strict nonclaims and next action

This tranche closes the scanner/classifier/manifest drift and aligns the local
NP1 umbrella with CI. It does not classify or authorize the 485 route-unknown
candidates, complete P11-A/B/C/D, accept stage 18, consume the third clock,
enable COMMIT, complete D9, add release evidence weight, establish RC/stable
readiness, or prove any GitHub star/popularity outcome.

The next bounded action is conservative whole-inventory triage: partition all
485 candidates by independently proven receiver role, bind every confirmed
native callsite to a fixed route or forbidden disposition with owner,
composition, budget, fault, and retirement evidence, and retain every unresolved
candidate until confirmed-native route unknown is actually zero.
