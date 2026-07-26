# Cross-language conformance architecture

Status: executable pre-alpha baseline, with the next parity hardening tranche
listed below. This document is a delivery contract; the normative graph,
runtime, and persistence rules live under `spec/`.

## Objective

TypeScript and Python are native implementations of one protocol. Neither is a
wrapper around the other and neither implementation's incidental object model
is the specification. Given the same Graph IR, input, deterministic handlers,
clock/random fixtures, and injected failures, both runtimes must agree on the
portable observations defined here.

Byte-for-byte equality is required for canonical documents and machine JSON.
Human messages, stack traces, exception class names, collection wrapper types,
and wall-clock completion timing are explicitly not portable observations.

## Conformance layers

### C0 — document and canonicalization

Both implementations must agree on:

- accepted Graph IR envelopes and rejected unknown fields;
- explicit null versus an absent optional field;
- declaration and array order preservation;
- recursive object-key ordering by Unicode code point;
- canonical UTF-8 bytes and lowercase SHA-256;
- numeric-domain restrictions declared by each versioned hash contract.

Graph v1alpha1 freezes accepted finite-binary64 rendering with ECMAScript's
shortest-round-trip number algorithm. The shared canonical-number manifest
separates RFC 8785 Appendix B formatter tokens from public portable acceptance,
covers unsafe-integer/non-finite rejection and a fixed-seed live Node oracle,
and joins JSON, YAML, both compilers, both builders, component hashes, and the
revision hash. This adopts RFC 8785 Section 3.2.2.3 only; code-point key
ordering deliberately differs from full JCS. Checkpoint v1alpha1 remains
stricter: its canonical state format accepts only safe integers. Tagged Durable
JSON is a separate exact-bit codec.

### C1 — compiler

For each shared fixture, compare validity, graph hash, diagnostic-code sequence,
associated node/edge identifiers, entrypoints, and topological layers. Messages
may differ. Negative coverage must include malformed envelopes, duplicate
identities, missing endpoints, cycles, unlisted disconnected roots,
entrypoints with incoming edges, absent public outputs, max depth, and max
fan-out.

### C2 — ready-queue runtime

Run deterministic handler fixtures and normalize both results to one JSON
shape. Compare:

- terminal run and node status;
- node declaration sequence and scheduling order;
- bound node inputs and named public outputs;
- attempts and total-attempt budget consumption;
- stable failure codes, failed/skipped descendants, and upstream identifiers;
- maximum observed executor concurrency;
- ready-queue behavior proving there is no implicit visual-layer barrier.

Completion order is observable only when a fixture controls completion gates.
Uncontrolled wall-clock races must not become golden output.

### C3 — failure and lifecycle semantics

Fixtures inject executor lookup failures, invalid JSON output, thrown errors,
timeouts, retry exhaustion, duplicate input bindings, missing output ports,
cancellation before scheduling, cancellation while waiting, and attempt-budget
exhaustion. A timeout or cancellation is cooperative at any external side
effect boundary; no runtime may claim it can forcibly stop arbitrary user code.

### C4 — persistence

Exercise memory and disk adapters against the shared last-sequence contract:

- empty version `-1`, contiguous appends, inclusive reads, and CAS conflicts;
- CAS-checked empty no-op;
- restart reads and same-instance racing appends;
- wrong run ID, unsafe identifier, truncated JSONL, malformed event, and gaps;
- checkpoint save/load/list order, canonical content hash, restart, and
  corruption detection;
- the shared `checkpoint-basic.json` vector in both languages.

Local filesystem adapters are not tested or advertised as cross-process locks.
A future storage-provider suite will run the same cases against SQLite and
PostgreSQL, adding dual-process races and lease expiry.

### C5 — durable recovery

Once scheduler persistence integration exists, a fault-injection harness kills
the process after every durable event boundary. Resume must reuse committed
node results, preserve route/verifier decisions, never exceed retry/budget
limits, and require intervention before repeating a non-idempotent external
activity. Replay and fork must retain lineage and produce deterministic history
under mock executors.

## Harness design

`tools/conformance/run.mjs` is the language-neutral coordinator. JavaScript
and Python reporters emit only normalized JSON to stdout; diagnostics belong on
stderr. The coordinator must:

1. build/import both native runtimes independently;
2. run each named case with a hard process timeout;
3. validate each report shape before comparison;
4. compare exact portable observations and print a focused JSON-pointer diff;
5. fail on a missing implementation, skipped case, extra event, or protocol
   version mismatch;
6. write no golden output unless an explicit maintainer update command is used.

Randomized cases record their seed. Time, UUIDs, retry jitter, provider results,
and cancellation gates are injectable. A case that cannot be replayed locally
is evidence, not a conformance test.

## Current executable baseline

- Six compiler fixtures agree on validity and stable diagnostic codes.
- The diamond graph agrees on canonical SHA-256 and topological layers.
- The ready-queue case proves a fast downstream node starts while an unrelated
  slow peer is still running.
- Both schedulers execute the Quickstart diamond with observed concurrency two
  and the same named output shape.
- Event/checkpoint adapter suites are implemented in parallel and will join the
  shared coordinator after their package-local corruption tests pass.

## Next parity-hardening tranche

The following are release gates, not accepted permanent differences:

1. Normalize invalid executor output to `INVALID_OUTPUT` in both runtimes and
   reject non-JSON graph input consistently.
2. Add Python lifecycle cancellation matching the TypeScript run-level signal,
   including queued and descendant nodes.
3. Normalize output-binding failure fields and cancellation terminal status.
4. Add controlled simultaneous-completion and retry-delay cases.
5. Add shared event/checkpoint vectors and machine error-envelope comparison.
6. Add pipeline, barrier, router, verifier, and bounded-loop cases before those
   primitives can be marked implemented in the capability table.

No README capability becomes `Yes` solely because one language has code. It
must have a shared fixture, both reporters, a green coordinator, and an honest
failure-boundary note.
