# ADR-0002: Use one strict authoring boundary and revision-1 identity

- Status: accepted for v1alpha1 implementation
- Date: 2026-07-26
- Owners: main, TypeScript core, Python core, CLI
- Canonical contract: `spec/authoring-semantics.md`

## Context

Graph Engineering already has a cross-language Graph IR compiler and canonical
whole-graph hash. It did not have a general builder, a safe YAML contract,
static typed-port proof, or a component identity that future graph revisions can
reference. Implementing each feature independently in two SDKs would create
multiple semantic entrypoints and could make identical source text compile to
different graphs.

General JSON Schema assignability is not a simple comparison. YAML parsers also
have materially different defaults for duplicate keys, aliases, tags, YAML 1.1
scalars, timestamps, and recovery. Treating a parser API named “safe” as the
security boundary would not establish a portable contract.

The current durable runtime fixes `graphRevision` at 1 and reserves the
`GraphPatched` event name without implementing patch semantics. Adding revision
fields to GraphSpec or accepting later revisions now would overstate the runtime.

## Decision

All authoring inputs converge on one detached portable-JSON snapshot and the
existing canonical compiler. Builders preserve explicit declaration order,
infer nothing, reject duplicate operations, and seal after one successful
build.

JSON decoding is strict. YAML uses a bounded YAML 1.2 JSON-compatible subset
with duplicate keys, aliases, anchors, merge keys, tags, directives,
multi-document streams, non-string keys, timestamps, non-finite numbers, and
unsafe integers rejected before construction.

Typed-port proof is opt-in through the exact
`graphengineering.reacher-z.github.io/typed-ports/v1alpha1` policy. Version 1
uses canonical-exact schema identity, Draft 2020-12 meta-validation, and no
`$ref` or `$dynamicRef`, including local fragments. This is conservative and
does not claim general schema assignability or reference resolution.

Initial graph identity uses domain-separated SHA-256 hashes for node, edge, and
schema declarations, preserves declaration indices, and binds the complete
manifest with a separate revision domain. The only supported revision is 1.
The manifest schema is `spec/compiled-identity.schema.json`.

Stable source, builder, typed-port, and identity diagnostics are frozen in the
authoring contract. Shared conformance compares both SDKs to committed golden
results, not only to each other.

Accepted finite binary64 values use ECMAScript's shortest-round-trip number
serialization, including `-0` normalization, closest-value selection,
round-to-even ties, and the `1e-6`/`1e21` fixed/scientific thresholds. This is
the number rule from RFC 8785 Section 3.2.2.3, not full JCS: Graph IR retains
Unicode-code-point key ordering. Integer-valued numbers outside the JavaScript
safe range and non-finite values remain outside the public portable boundary.

Python implements number rendering locally with exact rational arithmetic over
the IEEE-754 round-to-nearest-even interval. It does not shell out to Node,
depend on Python `repr`, or add a runtime package dependency. `Fraction` is
slower than the C JSON encoder, but the search is bounded by binary64's 17
significant digits and exactness is security-critical for identities. The
compiler hashes its one canonical string, builders reuse the compiler artifact,
and component identity rehydrates that trusted string instead of rendering the
whole graph again. A 1,000-node fractional builder/compiler/identity ceiling is
kept in the Python suite; the shared corpus also checks RFC vectors, 10,000
fixed-seed finite bit patterns against Node, JSON/YAML decoding, both builders,
component hashes, and the revision hash.

## Consequences

Users gain JSON/YAML/builder authoring without creating an alternate compiler.
The safety profile is predictable across Node and Python and remains bounded
under hostile input. Component identities give later patch work an explicit
parent without changing the v1alpha1 GraphSpec hash.

The strict typed-port mode rejects schemas that might be compatible under a
more powerful algorithm. YAML intentionally rejects common convenience
features. These constraints can be relaxed only through a new versioned policy
and conformance corpus.

The exact Python formatter carries measurable CPU cost for float-heavy graphs.
The accepted tradeoff is bounded deterministic work with no runtime oracle;
future optimization may replace the implementation only if the complete
binary64 corpus and identity bytes remain unchanged.

## Non-goals and follow-up

This decision does not implement `GraphPatched`, revision 2+, live graph
mutation, stream/artifact runtime lowering, external schema resolution, or
durable identity storage. Later work must define patch authorization, parent
revision binding, budgets, event folding, recovery, replay, and migration before
any runtime accepts a later graph revision.
