# D9 durable redaction contract audit — 2026-07-26

Status: **blocked; contract freeze only, implementation not accepted**

The independent security review read the complete 21-day master plan, the
durability/event schemas and implementations, the security architecture, the
D9 implementation brief, and the draft `spec/redaction-semantics.md`. The draft
is useful design work, but current durable stores can still persist raw data
while emitting a truthy `redacted` signal. No D9 implementation or completion
claim is accepted from document presence alone.

## Release-blocking findings

1. `redacted: true` is not yet tied to a total, sink-before-write transform. A
   partial transform or post-write transform can therefore overstate protection.
2. The contract does not yet distinguish source-field selection from every
   durable sink byte. JSONL, memory/checkpoint, derivative history, export, and
   diagnostic paths all require the same before-write guarantee.
3. JSON Pointer, mapping-key, array-index, absent-field, and replacement
   semantics need one canonical cross-language definition and collision rules.
4. Store APIs still permit callers to bypass the proposed transform and append
   raw event/checkpoint data directly.
5. Replay, fork, trace, terminal-result, checkpoint acceleration, and migration
   derivatives do not yet have a frozen inheritance/re-redaction rule.
6. Error messages, failure metadata, node/config metadata, and adapter/tool
   payloads remain potential secret-bearing fields outside the initial
   input/output examples.
7. A redaction failure after executor success must fail closed before any
   success/output byte becomes durable, without creating an unsafe retry or
   falsely terminal history.
8. Registry dependencies must prevent extended durability/replay work from
   bypassing the redaction security join.

## Required closure topology

- `D9-REDACTION-039` freezes the canonical truth table, pointer/transform
  semantics, authority model, migration behavior, and sink inventory only.
- `D9-TS-REDACTION-087` and `D9-PY-REDACTION-088` implement sink-before-write
  enforcement independently in both native stacks.
- `D9-REDACTION-CONFORMANCE-089` owns cross-language byte-level canaries,
  bypass/race/failure cases, legacy-history migration, and an independent
  security verdict.
- `D9-DURABLE-EXT-SPEC-031` and downstream replay/fork/export work must depend
  on the completed `089` security join rather than treating `039` as sufficient.

## Acceptance evidence still required

- frozen event-schema truth table proving when `redacted` is false, absent, or
  true;
- identical TypeScript/Python transforms and canonical replacement output;
- raw-secret canaries asserting absence from every persisted file, in-memory
  record, checkpoint, trace/export derivative, error, and machine envelope;
- direct-store and custom-adapter bypass attempts that fail closed;
- crash/race tests around executor success, transform failure, append CAS, and
  resume;
- deterministic legacy misleading-history classification and migration;
- independent security re-review with no open P0/P1 finding.

The draft specification remains uncommitted work in progress. This audit made
no durability implementation change and intentionally leaves all redaction
implementation and conformance tasks open.
