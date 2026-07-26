# `@graph-engineering/persistence`

Local, dependency-free persistence primitives for Graph Engineering on Node.js
20 and newer. The package contains a strict v1alpha1 event envelope, an
optimistic event stream, and content-addressed atomic file checkpoints.

```ts
import { JsonlEventStore, FileCheckpointStore } from "@graph-engineering/persistence";

const events = new JsonlEventStore({ directory: ".graph-engineering" });
const lastSequence = await events.append("run-1", -1, [runCreated]);

const checkpoints = new FileCheckpointStore({ directory: ".graph-engineering" });
await checkpoints.save({
  runId: "run-1",
  checkpointId: "after-research",
  sequence: lastSequence,
  state: { completed: ["research"] },
});
```

## Event version contract

- `expectedVersion` is the current final event sequence; an empty run is `-1`.
- appended events must start at `expectedVersion + 1` and be contiguous;
- append returns the new final sequence;
- an empty append still performs CAS, writes nothing, and returns the current version;
- `read(runId, fromSequence)` includes `fromSequence` and defaults to zero.

`JsonlEventStore` writes one canonical JSON event per newline, calls `fsync`,
and validates the complete stream before every append/read. Missing final
newlines, malformed UTF-8/JSON, invalid envelopes, wrong run IDs, and sequence
gaps are reported as `CORRUPT_EVENT_LOG`. Run IDs are allow-listed and filenames
are SHA-256-derived, so caller text never becomes a path segment.
`pathForRun` and `pathForCheckpoint` expose those opaque resolved paths for
local diagnostics without weakening identifier validation.

## Checkpoints

`FileCheckpointStore` writes a temporary file in the destination directory,
fsyncs it, atomically renames it, then fsyncs the directory. `contentHash` is
SHA-256 over canonical JSON of `{ apiVersion, runId, checkpointId, sequence,
createdAt, state }`; it excludes the hash field itself. `load` returns `null`
when a checkpoint is absent and rejects corrupt/truncated/hash-mismatched files.
Checkpoint state numbers are restricted to JavaScript safe integers so hashes
remain portable across runtimes; represent decimals as strings or explicitly
scaled integers.

## Alpha limits

CAS and write serialization are safe among store instances in one Node.js
process. Two processes can both pass CAS and
append concurrently; this package does **not** claim cross-process correctness.
Cross-process file locks, SQLite/PostgreSQL stores, compaction, retention,
encryption, and distributed leases remain later-alpha work. JSONL batch append
is durable after a successful return, but a process or disk failure during the
append can leave a truncated tail; the next operation detects and reports it
instead of guessing or silently repairing history.
