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

## Durable payload protection (D9, `events/v1alpha2`)

`JsonlEventStore` is the legacy v1alpha1 writer: it persists raw Tagged Durable
JSON payloads. `spec/redaction-semantics.md` forbids that, so this package also
ships the protected path.

```ts
import {
  DEFAULT_CAPTURE_POLICY,
  DeterministicTestKeyProvider,
  FileProtectedPayloadStore,
  ProtectedJsonlEventStore,
  SinkGuard,
  prepareProtectedEvent,
} from "@graph-engineering/persistence";

const keys = new DeterministicTestKeyProvider();
const guard = new SinkGuard({
  policy: DEFAULT_CAPTURE_POLICY,
  keys,
  store: new FileProtectedPayloadStore({ directory: ".graph-engineering" }),
  scope: { tenantScopeId, authorityProviderId, authoritySubjectId },
});
const journal = new ProtectedJsonlEventStore({ directory: ".graph-engineering" });

const decision = await prepareProtectedEvent(guard, journal, spec);
if (decision.kind === "prepared") {
  await journal.append(runId, -1, [decision.prepared]);
}
```

- `SinkGuard.prepare` is a total function over (snapshot, policy, sink). It
  returns `suppressed`, a structured failure, or one `PreparedSinkWrite`. It
  never throws provider text, never returns a partly transformed object, and
  never uses `null` as failure.
- `ProtectedJsonlEventStore` has no raw append. Its only write method accepts a
  `PreparedSinkWrite` bound to that exact instance, minted only by the guard and
  consumed at most once. A cloned, forged, serialized, or replayed write is
  refused with `GuardBypassError`.
- Authoritative application values are AES-256-GCM protected under
  occurrence-specific associated data and appear on the wire only as a closed
  `ProtectedValueRef` with `redacted: false` and
  `payloadDisposition: "protected-ref"`.
- `redactionTransform` implements the RFC 6901 transform of Section 3.3.1,
  including prototype-member rejection at any depth, canonical array indices,
  overlap/duplicate/order rejection, deepest-first application, and Section 11
  limits evaluated before target and overlap checks.
- `classifyLegacyHistory` reports `LEGACY_REDACTION_MISMATCH` for a v1alpha1
  history that claims or defaults to `redacted: true` over an inline payload, and
  `INLINE_CAPTURE_NOT_AUTHORIZED` for a truthful `redacted: false` one. Nothing
  in this package repairs a legacy journal.

`DeterministicTestKeyProvider` is a conformance vector generator, not a KMS. Its
keys and nonces are pure functions of `(keyRef, runId)` and it must not be used
in production.

### What this does not claim

The durable scheduler in `@graph-engineering/runtime` now writes
`events/v1alpha2` through this guard and fails closed with
`PAYLOAD_PROTECTION_REQUIRED` when no protected store and key provider are
configured. `JsonlEventStore` remains exported as the legacy v1alpha1 writer for
reading and quarantining existing journals; it is no longer reachable from the
durable write path. Existing v1alpha1 journals and checkpoints remain plaintext
application data and are not retrofitted. Checkpoints
(`FileCheckpointStore`, `checkpoints/v1alpha1`) are still unguarded and must not
be given application values. D9 is not closed by this package alone:
`redaction-semantics.md` Section 12.1 also requires the Python lane, shared
cross-language parity, the packaged canary campaign, and an independent security
review.

## Alpha limits

CAS and write serialization are safe among store instances in one Node.js
process. Two processes can both pass CAS and
append concurrently; this package does **not** claim cross-process correctness.
Cross-process file locks, SQLite/PostgreSQL stores, compaction, retention,
encryption, and distributed leases remain later-alpha work. JSONL batch append
is durable after a successful return, but a process or disk failure during the
append can leave a truncated tail; the next operation detects and reports it
instead of guessing or silently repairing history.
