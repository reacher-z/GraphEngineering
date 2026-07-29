# Runtime capability truth final audit — 2026-07-29

## Scope

This review covers the shared `runtime-capability/v1alpha1` contract, its
seven-case literal corpus, TypeScript and Python ordinary/durable preflight,
public quickstarts/templates, pattern showcase and capability documentation.
It does not review or accept unrelated dirty D4, D9, budget, redaction,
subgraph, artifact or progress-scanner work in the shared worktree.

## Final disposition

- HIGH: 0
- MEDIUM: 0
- LOW: 0

## Closed findings

1. Non-empty schemas and every barrier were initially rejected. This broke
   public and conformance behavior. Schemas are now explicitly compile-only and
   static all-success barriers remain supported.
2. TypeScript initially masked foreign condition failures and inspected hostile
   graph input too early. Runtime failures now precede condition failures and
   input snapshot follows preflight.
3. The supported corpus case had `maxDepth: 1` for a two-node path. Both native
   compilers caught it; the case is corrected and the independent validator now
   has topology checks plus a hostile regression test.
4. Public quickstart graphs declared `maxDynamicNodes: 0`. The declaration was
   removed from all three byte-identical templates and the Python CLI canonical
   hash updated to `f9aaeffc991e6cec223c959dbf7737a8fff96e1eb1ea433343f45fe663697b50`.
5. The pattern showcase silently relied on generic executors for validator
   nodes. It now proves fail-closed behavior first and executes a separately
   hashed transform projection.
6. Routing, security and capability wording was stale. ROADMAP, concepts,
   failure modes, security, examples and both runtime READMEs now distinguish
   implemented narrow behavior from open semantics.
7. The quickstart README invoked ignored CLI build output on a fresh clone. It
   now builds the CLI first.
8. Unknown-policy order lacked hostile frozen data. Empty, prototype,
   constructor, Unicode, emoji, slash and tilde keys now have literal expected
   order and paths.

## Evidence

- shared corpus: 7 cases, 22 literal failures;
- shared semantic tests: 2/2;
- TypeScript runtime: 265/265;
- Python unique suite: 2,237/2,237;
- Python focused runtime/capability: 170/170;
- TypeScript CLI: 147/147;
- workspace TypeScript build/typecheck/lint: pass;
- Ruff format/lint and strict MyPy (56 source files): pass;
- fixtures: 77 JSON, 37 manifests: pass;
- documentation: 287 links: pass;
- npm package contents: eight packages: pass;
- JS/Python quickstarts and pattern showcase: pass;
- scoped whitespace/diff and append-only plan checks: pass.

## Residual non-claims

The gate does not implement the capabilities it rejects. Runtime schema
validation, non-static barriers, verifier/human semantics, subgraphs, state,
streaming, artifacts, caching, admission, isolation, jitter, dynamic growth,
deadlines, cost accounting and arbitrary extensions remain open. B3, D6 and the
remaining master plan are not accepted by this review.
