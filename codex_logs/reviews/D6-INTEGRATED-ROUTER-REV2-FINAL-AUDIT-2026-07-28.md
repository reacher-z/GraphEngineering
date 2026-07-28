# D6 integrated-router revision 2 final hostile audit

Date: 2026-07-28
Audit mode: independent, read-only review of the revision-2 contract
Disposition: **HIGH 0 / MEDIUM 0 / LOW 0**

## Reviewed files

- `spec/integrated-router-semantics.md`
- `spec/conformance/integrated-router.case.json`
- `codex_logs/reviews/D6-INTEGRATED-ROUTER-COMPILER-CONTRACT-2026-07-28.md`

No spec, implementation, test, plan, daily log, task registry or commit was
changed by this audit. This new audit log is the only review artifact.

## Final conclusion

Revision 2 closes every finding from
`D6-INTEGRATED-ROUTER-IMPLEMENTABILITY-PARITY-AUDIT-2026-07-28.md` at the
contract/corpus level. It is now an implementable atomic handoff for the
patterns package and the TypeScript/Python compiler lanes without changing the
already implemented scheduler terminal contract.

This acceptance is deliberately bounded. The current compilers do not yet
implement GE1401 through GE1407, and the current `routedBranches` constructor
does not yet lower `routePolicy`. The fixture correctly records required future
projections rather than presenting them as current implementation evidence.
Durable route decisions, replay, integrated barrier/quorum/deadline behavior,
human gates, trace and CLI visibility remain outside this contract tranche.

## Original HIGH findings

### H1 — published `routedBranches` compatibility: closed

The contract no longer assumes that the current constructor already emits a
direct policy. It freezes an atomic patterns/compiler migration:

1. normalize branch keys once in the same deterministic order used for nodes
   and edges;
2. validate an optional exact `routePolicy` and require ordered
   `allowedRoutes` equality with that normalized set;
3. synthesize a direct single policy for the published empty-classifier-config
   call;
4. preserve an already exact direct policy only when its ordered routes match;
   and
5. reject option/config conflicts, non-policy config and route mismatch before
   returning a Graph.

The compiler never infers a policy. The six lowering cases distinguish all
three successful paths and all three rejection classes. The existing patterns
implementation confirms that branch normalization is Unicode-code-point
ordered and that the published legacy classifier config is exact empty JSON,
so the proposed lowering has a concrete implementation path. Requiring the
patterns and compiler changes to ship atomically prevents an intermediate
release from rejecting the published constructor output.

### H2 — global condition capture: closed

Condition ownership is now an exact `(apiVersion, kind)` registry. D6 owns and
validates only `RouteEquals`. `LoopContinue`, `LoopDryVerdict` and
`LoopVerdictAtBound` remain registered to the loop pattern and are opaque to
the router pass. The 14-case condition matrix covers the exact router carrier,
all three loop kinds, missing/wrong discriminator fields, an unregistered
version/kind, missing/wrong/unsafe route keys and an extra field. The full
compiler graph carrying all three loop conditions is valid in both current
compilers. Current patterns tests also retain all three published loop shapes.

### H3 — unreachable lower-runtime bypass: closed

The unsupported-condition scheduler vector and `lowerLevelRuntimeOnly` marker
are absent from the corpus. The semantics explicitly prohibit both public and
private precompiled scheduler bypasses. Unsupported conditions are compiler or
validator cases plus a public zero-executor gate:

- TypeScript calls `runGraph(document, ...)`, which compiles before dispatch;
- Python calls `try_compile_graph(document)` and obtains no `CompiledGraph`,
  leaving prepared handlers at zero calls.

This matches the actual public surface difference. The Python scheduler's
fresh compile of the captured spec means a fabricated historical compiled
carrier is not an escape hatch. The retained runtime defense remains a defense,
not an unreachable release fixture.

## Original MEDIUM findings

### M1 — Graph-envelope diagnostic ownership: closed

The contract states the gate boundary without overlap:

- capture-hostile or non-portable values are GE1007;
- condition null/scalar/non-object is GE1007 at the Graph envelope;
- portable router config null/scalar/array is admitted by general Graph IR and
  becomes GE1401 at the router config root; and
- GE1402 owns only admitted portable condition objects.

Independent live probes agreed in both languages: current router config
null/scalar/array passes the general Graph gate, while condition null/scalar
is GE1007. TypeScript accessor config, proxy condition, sparse route array and
non-portable number probes were GE1007; the Python non-portable-number probe
was also GE1007. The future router pass therefore has an unambiguous GE1401
ownership boundary.

### M2 — exact validator matrices: closed

The policy corpus contains 29 cases. I independently passed every value through
the current authoritative TypeScript and Python route-selection primitive
policy validation and compared validity plus the first policy-relative path:
**29/29 matched in both languages**. This includes mathematical JSON `1.0`,
boolean rejection, required and unknown fields, empty/duplicate/unsafe routes,
null optionals, default membership, single/multi multicast rules, confidence
bounds and escalation membership.

An independent registry validator matched all **14/14** condition cases and
their first relative paths. Together these matrices prevent the two compiler
lanes from silently implementing materially different policy or RouteEquals
validators.

### M3 — pass order, within-category order and cascade suppression: closed

The semantics now fixes the complete pass boundary: Graph capture/envelope;
identity/reference; cycle; entrypoint/reachability; graph policy; router; then
strict typed ports. Router diagnostics are category-ordered GE1401 through
GE1407, with node or edge declaration order inside each category. Suppression
is local and explicitly enumerated.

During this final hostile review, the first revision-2 corpus still lacked a
literal multi-router/same-category ordering carrier. That was a real MEDIUM
gap: an implementation could have sorted nodes or edges and passed all existing
projections. Before final acceptance the corpus added two compiler graphs:

- two invalid routers declared `route-z` then `route-a`, expecting two GE1401
  diagnostics in that non-lexical node order; and
- two unsupported edges declared `z-first` then `a-second` across distinct
  routers, expecting two GE1402 diagnostics in that non-lexical edge order.

The identifiers deliberately defeat accidental lexical sorting. Existing
multi-diagnostic cases additionally freeze GE1401-before-GE1402 coexistence,
GE1402/GE1404/GE1405/GE1406 category order, incomplete-coverage suppression,
and router diagnostics before an independent typed-port diagnostic. Single
category cases freeze every diagnostic path and identity shape. The original
M3 is therefore closed after the ordering correction.

### M4 — runtime terminal coverage: closed

All 11 runtime cases execute on real named public surfaces over seven reachable
graphs. Independent TypeScript and Python runs matched every expected field:

- status and total attempts;
- output or explicit output absence;
- graph failure-code ordering;
- per-executor call counts;
- graph-node-order terminals;
- attempts, optional output, and `{code,retryable}` failure projection.

The cases cover selected diamond work, no-match, empty/unknown defaults,
confidence escalation, authoritative recomputation against a forged custom
router result, multicast policy order and limit, inactive descendant pruning,
active failure at a mixed join, and inactive named-output failure without an
invented node failure. Result: **TypeScript 11/11 and Python 11/11**.

## Original LOW finding

### L1 — projection omission semantics: closed

The diagnostic projection normatively visits `code`, `path`, `nodeIds`, and
`edgeId` in that order, copies only present fields, preserves diagnostic and
node-ID order, and never writes null for an absent field. The expected JSON
objects use that exact key order. Node-only GE1401/GE1407 diagnostics omit
`edgeId`; edge diagnostics include it. An independent corpus check found no
null projection fields, wrong key order, dangling node/edge identity or
category-order violation.

## Literal hashes and current cross-runtime projections

After the same-category ordering correction the corpus contains 18 compiler
graphs and seven runtime graphs. For all **25/25**:

- TypeScript and Python current compilers produced byte-identical
  `canonicalGraph` values;
- an independent SHA-256 calculation over those UTF-8 bytes matched each
  compiler result; and
- the lowercase 64-hex digest matched the fixture literal.

Current compiler projections were also inspected. Pre-integration compilers
still accept router-invalid cases by design; the typed-port coexistence graph
currently reports only its existing GE1202. This agrees with the review log's
explicit nonclaim and does not masquerade as GE1401..GE1407 implementation.

## Corpus integrity and verification evidence

Independent checks produced:

```text
strict duplicate-key JSON: PASS
unique names and references: PASS
pattern lowering cases: 6
policy validation cases: 29/29 TypeScript, 29/29 Python
condition registry cases: 14/14
Graph-envelope cases: 2
host-capture cases: 4
compiler cases: 18
reachable runtime cases: 11/11 TypeScript, 11/11 Python
runtime graphs: 7
literal canonical bytes and hashes: 25/25 TypeScript/Python
diagnostic projection/order/path/omit invariants: PASS
current patterns tests: 93 passed
Python router primitive plus scheduler tests: 188 passed
scoped git diff --check: PASS
```

## Acceptance

Final hostile disposition for the corrected revision-2 contract and corpus:
**HIGH 0 / MEDIUM 0 / LOW 0**.

Implementation acceptance remains a later gate. It must atomically land the
pattern lowering and both compiler passes, consume these literal cases, prove
zero execution on invalid input, preserve all current runtime projections and
keep existing patterns/core/runtime/durable suites green. This audit accepts
the contract's implementability and parity carriers, not unfinished D6 product
capabilities.
