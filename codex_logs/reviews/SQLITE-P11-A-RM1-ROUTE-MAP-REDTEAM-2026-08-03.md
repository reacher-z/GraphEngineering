# P11-A-RM1 baseline-source route-map red-team record

Date: 2026-08-03 PDT

Scope: read-only review of the 18 TypeScript and 47 Python scanner identities
in the two operation-baseline-source files. This is a design/threat-model
record, not final acceptance of the RM1 implementation.

## Inventory truth

- TypeScript: 18 identities, all classified wrapper/guard/test-like probe.
- Python: 47 identities: 32 confirmed native receivers, 6 wrapper/probes, and
  9 structural unknowns.
- The 65 identities are API stages and sinks, not 65 independently authorized
  SQL routes. Route authorization and route closure remain false.

## High-risk false-authorization patterns

1. TypeScript generic sinks at lines 232 and 286 accept caller SQL. A sink
   identity cannot inherit a digest/route from one current caller; future
   callers must not become implicitly authorized.
2. TypeScript prepare plus get/iterate identities describe stages of one
   logical execution edge. Counting both as routes, I/O, receipts, or release
   weight is invalid.
3. Python shared validator callsites at lines 5586 through 5743 execute in
   inactive validation, active exact-owner validation, and reopened-audit
   contexts. Path/line/digest does not prove connection role or owner phase.
4. Receiver truth, exact SQL, source provenance, or an EXCLUSIVE transaction
   does not substitute for the exact P9 composition, P11 owner, and child
   permit.
5. Captured/default callable seams remain injectable. A production default
   that reaches SQLite cannot turn the wrapper callsite into an exact native
   authority edge.
6. Python cursor-allocation identities are resource edges, not SQL routes.
   They must eventually bind the same cursor generation to execute, terminal
   observation, and close/retirement.
7. Failure-reopen audit reads use a different connection role and can share
   SQL digests with active reads. They are permanently forbidden from reusing
   an active owner permit.
8. Dynamic table/asset/family dispatch must be represented as a frozen closed
   expansion with exact ordinal, digest, parameter shape, and cardinality.
   Authorizing the generic sink would create an open-ended capability.
9. A forbidden or unknown mapping means no permit, native execution claim,
   receipt authority, or release weight. Inventory completeness cannot flip
   any runtime claim flag.

## TypeScript groups

- Lines 232 prepare/iterate and 286 prepare/iterate are two generic dispatch
  families. Caller set, SQL, route, phase, owner, permit, and exact native leaf
  remain unresolved.
- Line 256 prepare/get is a fixed `total_changes()` read but remains a legacy
  mutation-accounting candidate without P11 authority.
- Lines 841, 856, 869, 912, 925, and 932 are six fixed source-capture logical
  reads, each represented by prepare/get stages. Their exact SQL is useful
  identity evidence but legacy callers and missing P11 permit prevent route
  authorization.

## Python groups

- Generic/control sinks: line 2153 generic public execute, line 4278 script,
  and line 4388 BEGIN. Script and transaction-control operations are P11
  forbidden candidates; the generic public sink can never gain caller-derived
  authority.
- Cursor allocation: lines 3201, 3344, 3603, 3859, 4100, and 4175 are resource
  allocations and must not count as SQL routes.
- Captured unbound execute: lines 3243, 3501, 3756, 4004, 4104, and 4186 remain
  structural unknowns. Future production leaves must bind exact cursor,
  connection generation, SQL/asset ordinal, permit, and retirement.
- Cursor-seal wrapper line 3012 is a custom/injectable seam, not a native
  identity or P11 baseline-projection route.
- Reopened-audit lines 4505 through 4510 are fixed reads on a new connection
  after failure/close. Their connection role is `reopened-audit` and active
  P11 permit use is forbidden.
- Source-summary dispatch lines 5317 and 5355 cover a 12-family static table.
  They require a cardinality-bound expansion; the generic member sink remains
  unknown.
- Shared-validator lines 5586 through 5743 are context-ambiguous across
  inactive, active-owner, and reopened-audit invocations. Dynamic table reads
  require a frozen enum and canonical identifier expansion.
- Capture wrapper/probe lines 6370 through 6437 are the nearest future native
  projection source reads, but still permit legacy callers and do not prove
  P9/P11 composition or runtime-real cursor retirement.

## Required RM1 representation

Every entry must preserve its stable scanner/classifier identity and explicitly
record operation kind, logical edge, API stage, connection role, invocation
context, exact or unresolved SQL/parameter evidence, receiver proof, lower
edge, owner/composition/permit expectation, resource lifecycle, disposition,
authorization false, and a specific unresolved reason. The validator must
reject missing/duplicate/reordered identities, generic-sink authorization,
prepare/read double counting, cursor-allocation authorization, context
conflation, wrapper/native double counting, and any true runtime/native
projection authority flag.

## Nonclaims

This review does not claim selected-file unknown zero, 65 authorized routes,
native-source provenance, genuine zero, runtime-real retirement, mutation
writer hooks, P11-A/P11 completion, COMMIT, release readiness, or star/adoption
outcomes. Final RM1 acceptance requires a frozen implementation diff, hostile
tests, complete regression gates, and another independent disposition.

## Final frozen disposition

The final whole-diff read-only audit is `H0 / M0 / L0` within the RM1 scoped
inventory boundary. Dedicated callsite contract tests passed 6/6, route-map
tests passed 11/11, and the discovery/classifier/route combination passed
19/19. The live CLI joined 65 unique identities as TypeScript 18 plus Python
47, with 23 call families, 50 logical executions, and 50 resource lifecycles.

The audit independently reproduced source-root failure, per-role threat and
permit rules, cursor pairing, dynamic expansion digests, source blob hashes,
fixture raw/canonical hashes, Markdown hash, and CI uv availability. Every
entry remains `disposition=unknown`, `rm1PermitAvailable=false`,
`runtimeRouteAuthority=false`, and `nativeProjectionAuthority=false`;
`routeClosureClaimed=false` remains global. This disposition authorizes the
bounded RM1 inventory implementation for commit, not NP1 or any runtime route.

The master plan remains append-only: its first 23,225 lines retain SHA-256
`bc46ef2b6028b140a9531fec76b4d1f2268defce73a1faab3a9093fd721dc0bf`.
Section 31.37.96 extends it to 23,275 lines with SHA-256
`86dc338446b5a635c4575b908b8302301cef12a70d24787d69657e2fb15e9e07`.
