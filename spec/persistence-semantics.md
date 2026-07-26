# Persistence semantics v1alpha1

This document freezes the observable contract shared by the TypeScript and
Python local persistence implementations. Scheduler integration is specified
separately in `durable-recovery-semantics.md`; replay, fork, and distributed
leases remain later runtime work.

## Event stream versioning

An event stream belongs to exactly one `runId`. Its version is the `sequence`
of its last stored event, not a count:

- a missing or empty stream has version `-1`;
- the first event has sequence `0`;
- an append at version `V` must contain sequences `V + 1` through
  `V + events.length`, in array order;
- a successful append returns the new last sequence;
- every event's `runId` must equal the stream `runId`.

Event `sequence`, `graphRevision`, and `attempt` values are safe integers no
larger than `2^53-1`, so a stream cannot change identity when exchanged between
JavaScript and Python.

`append(runId, expectedVersion, events)` is compare-and-swap. If the stored
version differs from `expectedVersion`, it fails with `VERSION_CONFLICT` and
does not write. An empty event array is a CAS-checked no-op: it returns the
current version when the expectation matches and still reports
`VERSION_CONFLICT` when it does not.

Error precedence is portable. Implementations first validate the identifier,
safe-integer expectation, and event-container shape and take an immutable input
snapshot. Inside the per-run critical section they load and validate existing
storage, then compare versions. Existing corruption therefore wins over a
payload error, and a stale expectation returns `VERSION_CONFLICT` even when an
appended event would later fail envelope or sequence validation. Event payloads
are validated only after CAS matches and before any bytes are written.

`read(runId, fromSequence = 0)` is inclusive, ordered by sequence, and returns
an empty result for a missing stream or a starting sequence beyond its end. A
reader must reject a truncated, blank, non-UTF-8, non-JSON, wrong-run, invalid,
or non-contiguous record as `CORRUPT_EVENT_LOG`; it must never silently skip it.

The local JSONL implementation fsyncs successful appends. A torn final append
is detectable, but automatic repair is deliberately out of scope for this
version.

## Identifiers and filesystem boundaries

`runId` and `checkpointId` use this portable grammar:

```text
^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$
```

The values `.` and `..` are forbidden. Invalid identifiers fail with
`UNSAFE_IDENTIFIER`. Local stores derive filenames from SHA-256 identifier
hashes; caller-controlled identifiers never become path components. Symlink,
shared-directory, and hostile-local-user hardening are outside the alpha local
store threat model, so applications should use a private storage directory.

## Checkpoints

A stored checkpoint conforms to `checkpoint.schema.json`. `contentHash` is the
lowercase SHA-256 of canonical UTF-8 JSON for this body, with `contentHash`
itself excluded:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/checkpoints/v1alpha1",
  "runId": "run-123",
  "checkpointId": "after-fetch",
  "sequence": 7,
  "createdAt": "2026-07-26T10:00:00.000Z",
  "state": {}
}
```

Objects are recursively sorted by Unicode code point, arrays preserve order,
and serialization contains no insignificant whitespace. Checkpoint state
v1alpha1 intentionally uses a stricter number domain than Graph IR: it allows
only null, booleans, strings, arrays, objects, and integers in JavaScript's safe
range (`-(2^53-1)` through `2^53-1`). Encode decimals as strings or explicitly
scaled integers. Tagged Durable JSON separately preserves non-integer finite
binary64 runtime values by their exact bits. A checkpoint writer rejects other
numeric values with `PERSISTENCE_VALIDATION`; a reader treats them as
`CORRUPT_CHECKPOINT`.

Event `timestamp` and checkpoint `createdAt` use the same strict RFC 3339
calendar form: `YYYY-MM-DDTHH:MM:SS`, optional fractional seconds, then `Z` or
a `±HH:MM` offset. Dates and offsets must be real, hours are `00` through `23`,
and seconds are `00` through `59`; leap-second text is outside this alpha
profile.

Saving is atomic within the documented local-filesystem assumptions: write and
fsync a private temporary file, rename it over the destination, then fsync the
containing directory. Loading verifies envelope, identifiers, filename, state,
and content hash. Listing returns summaries without `state`, ordered by
`sequence` and then `checkpointId` by Unicode code point.

## Concurrency and process boundary

The alpha file stores serialize operations per run inside one process. Their
compare-and-swap guarantee does not extend across multiple orchestrator
processes, hosts, or network filesystems. Production multi-worker execution
requires the planned SQLite/PostgreSQL store and `LockManager`; callers must not
use this local adapter as a distributed lease.

## Stable error codes

- `PERSISTENCE_VALIDATION`: an API value is malformed or not portable JSON.
- `UNSAFE_IDENTIFIER`: a run or checkpoint identifier is unsafe.
- `VERSION_CONFLICT`: compare-and-swap expected a different stream version.
- `CORRUPT_EVENT_LOG`: persisted event bytes violate the event-stream contract.
- `CORRUPT_CHECKPOINT`: persisted checkpoint bytes, identity, or hash are invalid.
- `PERSISTENCE_IO`: an underlying filesystem operation failed.

Language-specific exception classes and explanatory messages may differ. Code,
field paths, expected/actual versions, and observable store behavior are the
portable contract.
