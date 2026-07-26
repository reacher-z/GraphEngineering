# D9 durable redaction implementation brief

Status: **implementation brief / release-blocking contract proposal**
Task: `D9-REDACTION-039`
Prepared: 2026-07-26
Scope: TypeScript and Python durable events, checkpoints, future trace/export
sinks, legacy histories, and cross-language acceptance
Implementation status: **not implemented by this document**

This brief is subordinate to the canonical specifications under `spec/`. It
records the implementation decision that should be frozen in
`spec/redaction-semantics.md` before either native runtime is changed. It does
not mark `D9-REDACTION-039`, `I06`, `T26`, `Q08`, `SC07`, or `SC13` complete.

## 1. Required decision

The current `redacted` signal must not be repaired by merely documenting it.
The implementation should land in two explicit stages:

1. **Truth hotfix.** Existing v1alpha1 events that contain inline application
   values must be written with `redacted: false`; the JSON Schema default of
   `true` must be removed. Durable resume must reject legacy histories that say
   `redacted: true` while using the known raw v1alpha1 payload shapes. This
   immediately removes the false safety claim but does not complete D9.
2. **Protected durable payload contract.** A new recovery contract stores
   authoritative inputs, outputs, result snapshots, and optional diagnostic
   evidence behind authenticated encrypted `ProtectedValueRef` values. The
   journal and checkpoints contain references, policy identity, and keyed
   semantic identities—not plaintext application values. Default
   log/trace/error/prompt/tool/support capture remains off or metadata-only.
   D9 closes only after this path, both native implementations, legacy handling,
   packaged canary scans, and independent security review are green.

Encryption/protection and redaction are different facts. Ciphertext or a
protected reference is **not** described as redacted. An event is `redacted:
true` only when a defined irreversible redaction transform was actually applied
to material that otherwise would have appeared in that event's persisted
`data`. This narrow definition prevents the boolean from becoming a blanket
claim that every byte in every sink is secret-safe.

## 2. Read-only audit findings

### 2.1 Wire and schema mismatch

| Evidence | Actual behavior | Security consequence |
| --- | --- | --- |
| `spec/event.schema.json:7-39` | `redacted` is optional and has JSON Schema `default: true`; `data` is an unrestricted object. | Absence can be interpreted as true by a default-applying consumer even though no transform exists. |
| `packages/persistence/src/events.ts:35-52,103-154` | TypeScript models `redacted?: boolean` and validates only its type. It does not apply or verify redaction. | The flag is an unaudited caller assertion. |
| `python/src/graph_engineering/events.py:55-85` | Python gives `GraphEvent.redacted` a runtime default of `True`; validation checks shape, not payload treatment. | A Python-created event can claim redaction without a transform or receipt. |
| `packages/runtime/src/durable.ts:397-414` | Every scheduler event receives `redacted: true` while `data` is copied unchanged and `payloadHash` hashes those unchanged bytes. | Every TS durable event carries a false signal. |
| `python/src/graph_engineering/durable.py:217-236` | Every Python scheduler event likewise receives `"redacted": True` with the unchanged draft data. | The defect has native parity rather than native safety. |
| `spec/conformance/run-created.event.json:1-13` | The shared fixture explicitly expects `redacted: true`. | Conformance currently preserves the defect. |

### 2.2 Plaintext durable values are broader than two fields

The current security plan calls out `RunCreated.input` and
`NodeSucceeded.output`. The implementation audit finds five additional copies
or channels that the correction must cover.

| Event/data location | Concrete evidence | Plaintext or sensitive derivative persisted today |
| --- | --- | --- |
| `RunCreated.data.input` | TS `packages/runtime/src/durable.ts:1935-1956`; Python `python/src/graph_engineering/durable.py:1916-1941` | Complete tagged original graph input. |
| `NodeScheduled.data.input` | TS `packages/runtime/src/durable.ts:493-525`; Python `python/src/graph_engineering/durable.py:335-368` | Complete tagged bound input for every attempted node, including values derived from upstream output. |
| `NodeSucceeded.data.output` | TS `packages/runtime/src/durable.ts:587-616`; Python `python/src/graph_engineering/durable.py:441-474` | Complete tagged validated node output. |
| `NodeAttemptFailed.data.failure` | TS `packages/runtime/src/durable.ts:533-584` and `:209-221`; Python `python/src/graph_engineering/durable.py:375-439` and `:110-137` | Human error message and host cause name; thrown errors may contain prompts, tool responses, paths, tokens, or user data. |
| `NodeSettledWithoutAttempt.data.result` | TS `packages/runtime/src/durable.ts:619-628` plus `:244-253`; Python `python/src/graph_engineering/durable.py:476-490` plus `:140-153` | Tagged node result, including bound input and failure message. |
| terminal `Run*.data.result` | TS `packages/runtime/src/durable.ts:631-640` plus `:256-267`; Python `python/src/graph_engineering/durable.py:492-503` plus `:156-169` | A second complete snapshot of node inputs, node outputs, failures, and graph output. |
| hash/activity fields | `spec/durable-recovery-semantics.md:79-82,168-182` | Unkeyed input/output hashes and activity keys can disclose equality and permit dictionary guesses for low-entropy secrets. |

The recovery fold proves that these are not inert annotations. It decodes and
uses raw `RunCreated.input`, `NodeScheduled.input`, and `NodeSucceeded.output`
to reconstruct scheduling state (TS `packages/runtime/src/durable.ts:1363-1397,
1551-1594,1657-1689`; Python
`python/src/graph_engineering/durable.py:1315-1358,1517-1564,1625-1657`). A
redaction transform cannot replace these authoritative values inline without
changing replay behavior.

### 2.3 Stores persist exactly what they receive

| Sink | Concrete evidence | Current treatment |
| --- | --- | --- |
| TS JSONL events | `packages/persistence/src/jsonl-event-store.ts:107-137` | Canonicalizes the whole event and appends it as UTF-8 JSONL; no filter or redactor. |
| TS memory events | `packages/persistence/src/memory-event-store.ts:8-31` | Deep-clones the complete event into process memory. |
| Python JSONL events | `python/src/graph_engineering/persistence/event_store.py:221-247` | Canonicalizes the whole Pydantic event and writes raw UTF-8 JSONL; no filter or redactor. |
| Python memory events | `python/src/graph_engineering/persistence/event_store.py:107-145` | Deep-copies the complete event. |
| TS checkpoints | `packages/persistence/src/file-checkpoint-store.ts:215-254` | Deep-clones arbitrary `state`, includes it in `contentHash`, and writes it in full. There is no redaction/disposition field. |
| Python checkpoints | `python/src/graph_engineering/persistence/checkpoint_store.py:214-250` | Includes arbitrary checkpoint `state` in the canonical body/hash and writes it in full. There is no redaction/disposition field. |

Checkpoint state is currently a standalone caller-controlled storage primitive;
the durable scheduler does not use it. That limits the current scheduler leak
surface, but it does not make checkpoint bytes safe. A future scheduler
checkpoint would duplicate inputs and outputs unless the protected-reference
contract is frozen first.

### 2.4 Trace boundary

- `traceId`, `spanId`, and `parentSpanId` are optional event fields in
  `spec/event.schema.json:30-32`, TypeScript
  `packages/persistence/src/events.ts:43-45`, and Python
  `python/src/graph_engineering/events.py:76-78`. A generic JSONL store preserves
  them exactly.
- The durable writers do not currently populate those fields.
- The repository currently has no OpenTelemetry exporter, prompt/response
  capture implementation, or support-bundle implementation. This is an absent
  surface, not evidence that future trace capture is redacted.
- The shared event fixture places `traceId` beside the false `redacted: true`
  signal (`spec/conformance/run-created.event.json:9-10`), so it must be
  corrected with the wire contract.

## 3. Normative wire truth contract

### 3.1 Required event facts

The next event envelope revision should make both of these fields required:

```json
{
  "redacted": false,
  "payloadDisposition": "protected-ref"
}
```

`payloadDisposition` is one of:

- `metadata-only`: the event was designed to contain only an allowlisted
  metadata schema; no application value was sourced for inline capture;
- `protected-ref`: authoritative application values are represented only by
  validated `ProtectedValueRef` objects;
- `redacted`: one or more application-derived fields were irreversibly
  transformed under the recorded policy before this event was created;
- `inline-unredacted`: application values are present in plaintext after an
  explicit high-risk opt-in.

The truth table is conjunctive:

| Persisted condition | `payloadDisposition` | `redacted` | Allowed by default? |
| --- | --- | ---: | ---: |
| No application payload field exists | `metadata-only` | `false` | Yes |
| Authenticated encrypted reference exists; plaintext does not | `protected-ref` | `false` | Yes |
| Defined transform replaced/removed application-derived material and a valid receipt is present | `redacted` | `true` | Only for observational data, not scheduler authority |
| Any plaintext application value remains | `inline-unredacted` | `false` | No; explicit risk authorization required |
| Ciphertext/ref labeled redacted | invalid | `true` | Never; encryption is not redaction |
| `redacted: true` with no receipt/policy hash | invalid | `true` | Never |

For `payloadDisposition: redacted`, the event must include a `redactionReceipt`
containing only `policyHash`, transform version, transformed JSON Pointer paths,
replacement mode, and count. It must not contain the removed values or their
unkeyed hashes. Event validation checks that the receipt is structurally valid;
the sink guard checks that it matches the deterministic transform result.

### 3.2 v1alpha1 truth hotfix

Before the new protected contract lands:

- remove `"default": true` from `spec/event.schema.json`;
- require durable writers to emit `redacted: false` for every current inline
  v1alpha1 event;
- update the event fixture from `true` to `false`;
- make TS and Python defaults aligned: absence stays absence and is never
  interpreted as true;
- have the durable semantic fold reject a known v1alpha1 raw payload shape with
  `redacted: true` or an absent flag as `LEGACY_REDACTION_MISMATCH` before any
  executor invocation; and
- retain the raw `payloadHash` rule for the hotfix, because it truthfully hashes
  the bytes actually stored.

The hotfix is a truthful but still unsafe inline mode. Documentation and release
checks must continue to call D9 Open until the protected contract and canary
matrix pass.

## 4. Capture policy

One immutable policy is bound at run creation and reused on resume:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/capture-policy/v1alpha1",
  "durableValues": "protected",
  "checkpointValues": "protected",
  "events": "metadata-or-protected",
  "errors": "codes-and-sanitized-message",
  "logs": "metadata-only",
  "traces": "metadata-only",
  "prompts": "off",
  "responses": "off",
  "tools": "off",
  "supportBundles": "off",
  "maxDiagnosticUtf8Bytes": 1024,
  "redactionTransform": "json-pointer-rules/v1alpha1",
  "keyRef": "operator-owned-key-reference"
}
```

### Default behavior

- Non-durable runtime payload capture, prompt/response capture, tool body
  capture, traces, and support bundles remain off.
- Durable and checkpoint application values use `protected` mode.
- If no `ProtectedPayloadStore`/key authority is configured, a durable start or
  checkpoint save that would persist an application value fails **before the
  first event, checkpoint, log, or error payload is written** with
  `PAYLOAD_PROTECTION_REQUIRED`.
- Default errors persist only a stable code, node/attempt identity, retryability,
  and a bounded sanitizer-produced message. Raw exception strings and tool or
  provider response bodies are not persisted.
- No API silently falls back from protected to inline capture.

This fail-closed default is intentionally breaking for the alpha durable API.
Generating an encryption key beside ciphertext automatically would make the
byte scan look green while providing little confidentiality, so the runtime
must not do that.

### Explicit modes

- `protected`: stable-v1-supported authoritative mode. Requires a configured
  key provider and protected store.
- `metadata-only`: valid for observational sinks. It is invalid for a durable
  value that recovery must reconstruct.
- `redacted`: valid for derived logs/traces/errors after deterministic
  transformation. A redacted derivative never feeds scheduling, replay, routing,
  approval, or hash identity.
- `inline-unredacted`: compatibility/debug escape hatch only. It requires an
  explicit policy grant and risk acknowledgement, writes `redacted: false`, is
  disabled by stable production policy, and cannot satisfy D9 canary/release
  evidence.

Policy selection is deterministic code outside model/tool output. A graph,
node, planner, tool, provider, resumed worker, or child graph may request less
capture but cannot expand capture or change `keyRef`. The canonical policy hash
is recorded in `RunCreated` and bound into every protected value's associated
data. Resume under another policy fails closed.

## 5. Protected payload design

### 5.1 `ProtectedValueRef`

Authoritative values are encoded as Tagged Durable JSON, then protected using
AEAD. The journal/checkpoint representation is a closed object such as:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/protected-value/v1alpha1",
  "ref": "pv_01J...",
  "codec": "durable-json/v1alpha1",
  "ciphertextHash": "<64 lowercase hex>",
  "valueMac": "<64 lowercase hex>",
  "keyRefHash": "<64 lowercase hex>",
  "aadHash": "<64 lowercase hex>"
}
```

The protected blob uses a random production nonce and an authenticated cipher
available in both runtimes (AES-256-GCM is the baseline). The encryption key is
obtained from an operator-owned `KeyProvider`; it never appears in Graph IR,
events, checkpoints, artifacts, logs, traces, errors, or committed evidence.
File blobs are private and atomically published. Decryption requires both store
read authority and key authority.

Associated data binds at least contract version, run ID, graph revision, event
type, node/edge/attempt identity when present, logical field JSON Pointer,
capture-policy hash, codec, and `valueMac`. Copying a blob/ref to another
run/field therefore fails authentication.

`ciphertextHash` is SHA-256 over the persisted blob and is an integrity/address
fact. `valueMac` is HMAC-SHA-256 over context plus canonical Tagged Durable JSON
using a run-scoped identity key derived by the key provider. An unkeyed hash of
a low-entropy secret must not be exposed as its durable identity.

### 5.2 Event payload mapping

| Current field | Protected contract |
| --- | --- |
| `RunCreated.input` / `inputHash` | `inputRef` / `inputMac`; also bind capture-policy hash, protected-store contract, and key reference hash. |
| `NodeScheduled.input` / `inputHash` | `inputRef` / `inputMac`; a ref may be reused only when its AAD permits this exact logical field, otherwise create a new protected blob. |
| `NodeStarted.inputHash` | `inputMac`; no value or ref is needed. |
| `NodeSucceeded.output` / `outputHash` | `outputRef` / `outputMac`. |
| `EdgeEmitted.outputHash` | `outputMac`; consumers still require the authorized output ref from the producer projection. |
| `NodeAttemptFailed.failure.message` | Stable sanitized message inline; optional raw evidence may be stored only as a protected ref under explicit policy. |
| `NodeSettledWithoutAttempt.result` | `resultRef` / `resultMac`; stable outcome metadata may remain inline. |
| terminal `Run*.result` | `resultRef` / `resultMac`; no duplicate plaintext node/result data. |
| scheduler checkpoints | Metadata projection plus protected refs/MACs only; `contentHash` covers the persisted checkpoint body, never plaintext. |

A narrow `ProtectedPayloadStore` is a D9 security primitive, not a claim that
the complete Day-9 `ArtifactStore` or Day-15 production storage work is done.
The future ArtifactStore may implement this interface, but D9 should not wait
for or silently claim the broader artifact milestone.

## 6. Hash, activity-key, and replay rules

1. Snapshot and validate the logical value first.
2. Encode canonical Tagged Durable JSON.
3. Compute its context-bound `valueMac` before any redaction or encryption.
4. Protect the bytes and persist only `ProtectedValueRef` plus allowed metadata.
5. Compute event `payloadHash` over the exact persisted `data` containing refs.
6. On recovery, authorize read, authenticate/decrypt, decode, recompute
   `valueMac`, and only then expose the logical value to the fold.

Consequences:

- `payloadHash` changes when inline fields become refs. It remains a byte-level
  event integrity check and is never used as semantic replay identity.
- The v1alpha2 activity key is derived from the original logical input identity,
  not from a redacted derivative:

  ```text
  HMAC(runIdentityKey,
       tagged(["activity/v1alpha2", runId, graphRevision, nodeId, inputMac]))
  ```

- The same node input in the same run keeps one activity/idempotency key across
  retries and resume. Different runs do not expose a correlatable unkeyed input
  digest.
- A policy change, missing key, missing blob, authentication failure, MAC
  mismatch, or unauthorized ref fails before executor invocation. The fold must
  never substitute null, a redaction token, or an empty value.
- Observational redaction is one-way and cannot be read back into the scheduler.
  Redaction therefore cannot alter routing, budget, approval, output, replay, or
  fork identity and cannot authorize hidden work.
- Key rotation uses envelope-key rewrapping outside immutable events. It must not
  rewrite event bytes, change refs, or change `valueMac`/activity identity.

## 7. Sink-before-write pipeline

Every sink adapter must receive output only from one shared deterministic guard:

```text
snapshot + portable validation
  -> classify field and sink
  -> compute keyed semantic identity (authoritative values only)
  -> apply immutable capture policy
  -> redact derivative OR protect authoritative bytes
  -> validate disposition/receipt/ref
  -> canary/credential defense-in-depth scan
  -> canonicalize and hash persisted representation
  -> write/export
```

There is no write-then-scrub path. A transform, protector, scanner, serializer,
or sink error is structured, contains no offending value, and causes no partial
fallback write. Batch event commits fail as a unit before executor/dependent
release. Checkpoint temporary files must contain only the already-protected
representation.

The guard applies to journal, checkpoint, artifact/protected blob, stdout,
stderr, application/runtime log, trace exporter, error aggregator, CLI/MCP
diagnostic, Explorer response, and support bundle. Adapters cannot opt out by
calling a lower-level writer with raw values. Low-level storage interfaces may
remain available for embedding, but must be named/typed as unsafe and cannot be
used by default runtime paths or release evidence.

Trace IDs should be constrained to their protocol-safe format rather than
arbitrary user text. Trace/span attributes use a fixed metadata allowlist;
prompt, response, tool body, input, output, exception text, environment, and
secret values are absent by default.

## 8. Legacy histories and migration

Known legacy condition:

```text
scheduler-recovery/v1alpha1
AND redacted is true or defaulted/absent
AND an inline input/output/result/failure payload shape is present
```

Default behavior is `LEGACY_REDACTION_MISMATCH` before `RunResumed` and before
any executor invocation. Terminal history may be inspected only through an
explicit unsafe read/export API that returns a prominent structured warning and
never continues work.

The project must **not** silently flip the flag, recompute hashes, or rewrite the
JSONL in place. That would violate append-only audit expectations and conceal
which bytes were exposed. It also must not copy a nonterminal history under a
new run ID while retaining old activity keys, because activity identity includes
the run ID and external effects may already be in doubt.

Supported migration outcomes are:

1. **Quarantine:** preserve the original file read-only, restrict permissions,
   record its digest and unsafe classification, and block resume.
2. **Sealed archive:** with explicit operator authority, encrypt the complete
   legacy bytes into a protected archive and emit a metadata-only migration
   manifest containing source digest, destination ciphertext digest, tool
   version, time, and reviewer—never raw payloads.
3. **New run/replay-fork:** start a v1alpha2 run with a new run ID and protected
   inputs. Nonterminal or externally effectful histories require reconciliation
   and the later approval/replay contract; no automatic conversion is allowed.

An already created v1alpha1 history with `redacted: false` is truthful but still
inline unsafe. It may be read only under explicit legacy-inline authorization;
it is not accepted as protected D9 evidence.

## 9. Stable cross-language failure codes

| Code | Required trigger | Executor/write rule |
| --- | --- | --- |
| `REDACTION_POLICY_REQUIRED` | No capture policy can be resolved | No sink write; no executor |
| `REDACTION_POLICY_INVALID` | Unknown version/mode, invalid selector, inconsistent disposition | No sink write; no executor |
| `CAPTURE_POLICY_MISMATCH` | Resume policy hash differs from `RunCreated` | No append; no executor |
| `INLINE_CAPTURE_NOT_AUTHORIZED` | Inline mode lacks explicit policy/acknowledgement or production policy denies it | No sink write |
| `PAYLOAD_PROTECTION_REQUIRED` | Authoritative value needs persistence but no protected store/key is configured | No sink write; no executor |
| `PAYLOAD_PROTECTION_FAILED` | Encode/encrypt/atomic publish fails | No event/checkpoint reference is committed |
| `PROTECTED_PAYLOAD_NOT_FOUND` | Referenced blob is missing | No executor; do not replace with null |
| `PROTECTED_PAYLOAD_UNAUTHORIZED` | Store/key authority denies access | No executor; no sensitive detail |
| `PROTECTED_PAYLOAD_CORRUPT` | Ciphertext hash, AEAD authentication, codec, AAD, or value MAC fails | No executor; preserve evidence |
| `REDACTION_RECEIPT_INVALID` | `redacted: true` does not match a valid deterministic transform receipt | Reject before persistence or as corrupt history |
| `LEGACY_REDACTION_MISMATCH` | Known raw legacy shape claims/defaults to redacted | No resume/executor; quarantine path only |
| `SECRET_CANARY_DETECTED` | Defense-in-depth pre-sink scanner finds seeded/credential material in a disallowed representation | Reject write; report only canary ID and sink, never value |

TypeScript and Python exception class names may differ, but codes, phase,
redacted-safe detail keys, and no-write/no-executor behavior are portable.
Persisted-history violations should retain the corruption/invalid-history causal
chain without echoing offending bytes.

## 10. Shared fixture set

Add these canonical fixtures under `spec/conformance/`:

| Fixture | Purpose |
| --- | --- |
| `redaction-wire-truth.case.json` | Every truth-table row, missing/invalid receipt, encryption-not-redaction, and exact TS/Python envelope parity. |
| `redaction-policy.case.json` | Default policy, explicit protected/metadata/redacted/inline modes, forbidden expansion, immutable policy hash, and invalid policies. |
| `protected-value.case.json` | Tagged values, fixed test key/nonce only for deterministic fixture vectors, AAD binding, ciphertext hash, value MAC, Unicode/float/null values, and malformed refs. |
| `durable-protected-resume.case.json` | Success, retry, interruption, terminal resume, missing/denied/corrupt ref, stable activity key, and zero executor calls on protection failure. |
| `checkpoint-protected.case.json` | Metadata/ref-only state, content hash, missing/stale/corrupt ref behavior, and proof that no plaintext enters temp/final bytes. |
| `redaction-legacy.case.json` | Misleading true, absent/defaulted flag, truthful-but-inline false, terminal unsafe inspection, nonterminal rejection, and quarantine manifest. |
| `redaction-canary.case.json` | Synthetic unique canaries for every source category and obvious encoded variants. |

Production nonce generation is random and must not be injectable by untrusted
callers. Deterministic key/nonce vectors exist only in test providers clearly
labeled non-production. Normal conformance compares semantic results and
failure codes; exact ciphertext comparison is limited to those fixed vectors.

## 11. Canary sink matrix

Each language runs clean packaged success, retry, timeout, cancellation,
failure, crash/resume, terminal-resume, and protection-failure scenarios. Seed a
different canary in graph input, mock model prompt/input, executor output, thrown
error, mock tool response, artifact/protected value, and support/log metadata.

| Sink scanned as raw bytes | Default expected result | Explicit protected/capture check |
| --- | --- | --- |
| Event journal, including temp/torn tails | No raw or obvious encoded canary | Only refs/MACs/allowed metadata; flags/disposition exact |
| Checkpoint temp and final files | No raw or obvious encoded canary | Only protected refs; content hash valid |
| Protected payload/artifact blobs | No plaintext or obvious encoded canary | Authorized decrypt returns exact original; wrong key/AAD fails |
| stdout | No canary | Raw capture requires a separate explicitly authorized test and is never release-default evidence |
| stderr | No canary | Same |
| Runtime/application JSONL logs | No canary | Bounded allowlisted/redacted attributes only |
| Trace/export/network bytes | No canary and no exporter/network activity by default | Enabled trace has metadata/redaction receipt only |
| Returned/serialized error reports | No canary | Stable code, safe IDs/hashes, bounded sanitized message |
| CLI/MCP machine JSON and diagnostics | No canary | Safe structured envelope only |
| Explorer/API responses and persisted cache | No canary | Privileged protected fetch is separately authorized/audited |
| Support bundle/archive | No bundle by default, otherwise no canary | Explicit consent plus allowlist/redaction receipt |
| Migration manifest and release evidence | No canary | Digests, versions, disposition, reviewer only |

The scanner checks literal UTF-8 plus JSON escaping, URL encoding, base64,
hex, UTF-16 LE/BE, and compressed archive members. It records scanner
version/config, candidate and package digests, scenario, sink, canary ID,
result, and false-positive disposition. It never records canary values in the
committed report.

Every campaign includes:

- a positive negative-control file containing an intentionally seeded unsafe
  canary and proof that the scanner fails;
- a clean control proving the scanner does not fail every file;
- a transformed-secret case to document literal scanner limits;
- independent review of raw machine reports; and
- deletion/quarantine verification for temporary files after failures.

## 12. Complete acceptance matrix

| Area | Required acceptance evidence |
| --- | --- |
| Canonical contract | `spec/redaction-semantics.md`, revised event/persistence/durable/checkpoint specs, closed schemas, examples, truth table, policy and migration rules reviewed before implementation. |
| TS wire/store | Event validator rejects false combinations; writer never defaults true; store path receives guarded representation only; focused mutation, partial-write, hostile getter/error, and concurrency tests. |
| Python wire/store | Pydantic model has no implicit true; identical combinations/codes; guarded JSONL/checkpoint writes and focused adversarial tests. |
| Protected store | AEAD/AAD/key/ref validation, atomic publication, permission tests, wrong key/run/field, truncation/tamper, missing/denied value, no key logging, and cleanup. |
| Recovery | Committed success reuse, retry, crash windows, terminal idempotence, activity-key stability, no null substitution, and zero executor calls on policy/ref failures. |
| Hash parity | Same policy hash, value MAC, AAD hash, fixed-vector ciphertext hash, payload hash, and activity key under shared test keys. |
| Redaction semantics | Every event type and sink matches the truth table; `redacted: true` requires a receipt; protected refs are never mislabeled redacted. |
| Checkpoints | No raw application state in temp/final bytes; stale/corrupt/ahead/missing refs cannot authorize work; event authority preserved. |
| Trace/default privacy | Clean npm and wheel/sdist install proves no trace/prompt/response/tool/support capture or network export by default. |
| Legacy | Misleading histories fail before resume; unsafe read is explicit; quarantine/sealed archive manifests are safe; no silent byte rewrite or activity-key reuse. |
| Canary campaign | Every source x lifecycle x sink row passes in both packaged runtimes; encoded forms and negative/clean controls pass. |
| Packaging/docs | npm tarballs and wheel/sdist include required schemas/modules/docs and no keys, reports with canary values, raw fixtures, or accidental captures. |
| Independent R3 review | Exact source/package digests, commands, tool versions, raw reports, residual risks, reviewer independence, and explicit accepted/blocked verdict. |

No single unit-test count, source-only scan, or in-memory fake closes this task.
Candidate-bound clean-package evidence and an implementer-independent security
review are mandatory.

## 13. Concrete implementation map and ownership

Main/integration owns canonical files:

- new `spec/redaction-semantics.md` and protected-value schema;
- versioned event/checkpoint envelope decision;
- updates to `spec/durable-recovery-semantics.md`,
  `spec/persistence-semantics.md`, and shared fixtures;
- policy/hash/error/migration vocabulary; and
- the cross-language conformance join.

TypeScript lane owns:

- `packages/persistence/src/events.ts`, event/checkpoint validators and guarded
  stores;
- a narrow protected payload/key-provider interface and local encrypted adapter;
- `packages/runtime/src/durable.ts` and `durable-types.ts` integration;
- focused package tests and API documentation.

Python lane owns:

- `python/src/graph_engineering/events.py` and persistence validators/stores;
- native protected payload/key-provider implementation;
- `python/src/graph_engineering/durable.py` integration;
- focused native tests and API documentation.

Platform/quality owns the packaged byte scanner, sink inventory, negative
control, raw evidence manifest, and clean-install runs. The independent security
reviewer owns attack review and acceptance, not implementation.

Recommended executable split, matching the audited backlog:

```text
D9-REDACTION-039                  canonical contract + migration decision
  -> D9-TS-REDACTION-087         TS implementation
  -> D9-PY-REDACTION-088         Python implementation
  -> D9-REDACTION-CONFORMANCE-089 shared join + canary + R3 review
```

Hard dependencies/reopening rules:

- Keep `D6-DURABLE-CONFORMANCE-011` as the upstream frozen recovery baseline.
- Make `D9-DURABLE-EXT-SPEC-031` depend on the accepted redaction conformance
  join, not merely creation of the contract task; leases/replay/artifacts must
  not grow the unsafe schema.
- `D9-APPROVAL-077`, future trace/Explorer work, mutating adapters/MCP, and
  production storage consume the protected/redacted contracts and may not
  redefine them.
- `D16-SECURITY-062` independently reruns the complete canary campaign on the
  frozen candidate; D9 evidence does not substitute for Day-16 candidate review.
- Any change to event/checkpoint shape, capture policy, redaction transform,
  key/AAD derivation, codec, hash/MAC, activity key, sink inventory, package
  contents, or migration tool invalidates the affected D9/D16 evidence.

## 14. Definition of done for `D9-REDACTION-039`

The task is complete only when all of the following are true:

1. No default or durable writer can assert `redacted: true` without performing
   and proving the defined transform.
2. Default packaged durable execution never persists plaintext application
   values; missing protection fails before a sink write.
3. Authoritative recovery obtains exact values only through authenticated,
   authorized protected refs and never through redacted derivatives.
4. Hash/MAC/activity/replay behavior is specified and identical in TS/Python.
5. Existing misleading histories are rejected before executor invocation and
   have an explicit quarantine/archive/new-run path.
6. The complete canary source/lifecycle/sink matrix and its negative control pass
   for clean npm and Python artifacts.
7. Shared conformance, focused native suites, full workspace gates, package
   checks, and independent R3 review are green for one immutable revision.
8. Release language says exactly what is protected, redacted, disabled, and
   still outside the threat model; no stable claim relies on the boolean alone.

Until then, current JSONL/checkpoint directories must be treated as containing
raw application data, kept private, and excluded from trace galleries, support
bundles, and release evidence.
