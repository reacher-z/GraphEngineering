# Durable payload protection and redaction semantics v1alpha2

Status: **normative protocol contract; closed machine schemas and adversarial
corpus drafted; native implementation, integration, and release evidence
pending**

This document freezes the portable privacy contract for durable events,
checkpoints, protected payloads, recovery, and observational sinks. It defines
the required truth correction for existing
`scheduler-recovery/v1alpha1` histories and the protected payload contract for
`scheduler-recovery/v1alpha2`.

This document does not claim that either native runtime implements the contract.
The dedicated v1alpha2 schemas and redaction corpus named below are strict
Draft 2020-12 documents and are locally meta-schema/Ajv validation-clean. That
is contract-author evidence, not acceptance evidence. Until the schemas are
integrated into the shared validator, both native implementations pass the
same corpus, the packaged canary campaign passes, and an independent R3
security review reports no open P0/P1 findings, D9 redaction remains open.
Existing v1alpha1 JSONL journals and checkpoints must be treated as containing
plaintext application data.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative.

## 1. Scope and authority

This contract governs bytes emitted by a Graph Engineering runtime to:

- the durable event journal;
- scheduler and caller-created checkpoints;
- a protected payload or future artifact store;
- stdout, stderr, and runtime/application logs;
- trace and telemetry exporters;
- returned and serialized error envelopes;
- CLI, MCP, Explorer, and HTTP diagnostics;
- support bundles and migration manifests; and
- temporary files, batch buffers, caches, and transport bodies used before a
  final sink write.

`event.schema.json`, `checkpoint.schema.json`, and
`durable-recovery-semantics.md` continue to describe the currently implemented
v1alpha1 wire format. Where this document requires a v1alpha1 truth hotfix, the
schemas and native implementations must be changed before claiming compliance.
Where this document defines v1alpha2, a versioned schema must be added; an
implementation must not emit a v1alpha2 version string while validating only
the old open `data` shape.

The event journal remains the recovery source of truth. A checkpoint is a
rebuildable projection. A protected payload reference provides confidential,
authenticated value transport; it does not authorize scheduling on its own.

### 1.1 Machine-contract manifest

The following files form one versioned contract set. A native implementation
MUST NOT claim the contract by implementing only a subset:

| Contract surface | Machine artifact |
| --- | --- |
| Complete source classification | `capture-source.schema.json` |
| Complete sink inventory | `capture-sink.schema.json` |
| JSON Pointer transform rule | `redaction-rule.schema.json` |
| Transform proof | `redaction-receipt.schema.json` |
| Immutable effective policy | `capture-policy.schema.json` |
| Authoritative protected reference | `protected-value.schema.json` |
| Authenticated encrypted blob | `protected-blob.schema.json` |
| Occurrence-specific associated data | `protected-aad.schema.json` |
| Disposition/redaction truth pair | `payload-disposition.schema.json` |
| Guard audit projection | `sink-guard-decision.schema.json` |
| Protected-store operation envelope | `protected-store-envelope.schema.json` |
| Closed scheduler events | `event-v1alpha2.schema.json` |
| Closed scheduler checkpoint | `checkpoint-v1alpha2.schema.json` |
| Corpus shape | `redaction-conformance.schema.json` |
| Adversarial cases | `conformance/redaction.case.json` |
| Shared semantic validator | `conformance/redaction.validate.mjs` |

JSON Schema proves structural closure only. The shared semantic validator MUST
also enforce canonical pointer ordering, target existence, normalized-key
collisions, exact decoded crypto lengths, blob/reference consistency, adjacent
MAC equality, event/checkpoint state relations, policy/rule consistency, and
the guard authority rules in this document.

That validator is `conformance/redaction.validate.mjs`. It is imported and run
by `scripts/validate-fixtures.mjs`, so `pnpm validate:fixtures` fails when any
obligation above is violated. What it enforces today: strict-mode compilation of
all fourteen schemas, every `wireCases` document against its named schema, the
complete RFC 6901 pointer transform over every `pointerCases` entry, the
disposition truth table, receipt pointer ordering/count/crossing rules, AAD
record-kind relations, adjacent MAC equality, policy/rule consistency, the
deterministic source×sink join over every `flowCases` entry, and
inventory/Cartesian completeness against the closed enums. What it does not yet
enforce: the general `semanticCases` mutation oracle described in Section 12.
Twenty-six of the 106 cases run today; the other eighty declare symbolic
operators with no interpreter in this repository.

### 1.2 Closed source and sink inventories

Every value entering a runtime-controlled sink is classified as exactly one of
the 57 source classes in `capture-source.schema.json`. A name that sounds like metadata does not make its
contents safe:

| Default handling | Source classes |
| --- | --- |
| Authoritative; protect, never redact | `graph-input`, `graph-output`, `bound-node-input`, `node-output`, `node-result`, `run-result`, `event-data`, `checkpoint-state` |
| Untrusted application-derived control/metadata; protect or use a closed-field projection | `artifact-body`, `artifact-metadata`, `graph-metadata`, `node-metadata`, `edge-metadata`, `node-config`, `planner-output`, `router-output`, `verifier-evidence`, `approval-context` |
| Off by default; optional guarded redacted/protected observation only | `prompt`, `model-request`, `model-response`, `provider-request`, `provider-response`, `provider-usage`, `tool-request`, `tool-response`, `tool-error`, `provider-error` |
| Secret-bearing diagnostics; omit by default | `exception-message`, `exception-stack`, `filesystem-path`, `process-environment`, `secret-value`, `cli-argument` |
| Protocol, plugin, explorer, and isolation bodies; omit by default | `mcp-request`, `mcp-response`, `plugin-request`, `plugin-response`, `explorer-payload`, `worktree-output`, `process-output`, `container-output` |
| Database, export, recovery, support, migration, and evidence sources | `database-index-value`, `database-projection-value`, `backup-source`, `export-source`, `replay-report`, `fork-report`, `support-field`, `migration-source`, `test-failure-artifact`, `benchmark-artifact` |
| Closed allowlist only; application-derived fields still require guard | `trace-attribute`, `metrics-attribute`, `log-field` |
| Identifier treatment | `caller-controlled-identifier` is replaced with a runtime opaque identifier and its original is protected; `runtime-generated-identifier` may remain allowlisted metadata |

In particular, provider/tool/model request IDs, headers, URLs, body fragments,
usage metadata, finish reasons, error messages, exception names/stacks,
filesystem paths, environment names/values, CLI arguments, and free-form graph
or node metadata are secret-bearing until a closed schema proves otherwise.
Truncation, hashing, token counting, label changes, or a producer's `safe`
boolean does not reclassify them.

The guard's sink inventory is exactly the 54 locations in
`capture-sink.schema.json`:

| Sink family | Sink classes |
| --- | --- |
| Event/checkpoint persistence | `event-memory`, `event-journal-buffer`, `event-journal`, `checkpoint-memory`, `checkpoint-temporary`, `checkpoint-final` |
| Protected/artifact storage | `protected-blob-memory`, `protected-blob-temporary`, `protected-blob-final`, `artifact-memory`, `artifact-temporary`, `artifact-final` |
| Queues and transport | `retry-buffer`, `dead-letter`, `transport-buffer`, `provider-request-transport`, `provider-response-buffer`, `tool-request-transport`, `tool-response-buffer` |
| Process diagnostics | `stdout`, `stderr`, `runtime-log`, `application-log-adapter`, `trace-buffer`, `trace-export`, `metrics-buffer`, `metrics-export`, `error-envelope`, `error-aggregator` |
| User/protocol surfaces | `cli-json`, `cli-diagnostic`, `mcp-request-buffer`, `mcp-response`, `plugin-request`, `plugin-response`, `explorer-response`, `explorer-cache`, `http-response`, `network-export` |
| Isolation and database | `worktree-output`, `process-output`, `container-output`, `database-index`, `database-materialized-projection`, `database-backup` |
| Export, replay, fork, support, migration, and evidence | `export-report`, `replay-report`, `fork-report`, `support-bundle-staging`, `support-bundle-final`, `migration-manifest`, `test-failure-artifact`, `benchmark-artifact`, `release-evidence` |

Heap objects and temporary/staging bytes are sinks even when they are never
renamed to a final file. A new adapter, cache, queue, exporter, artifact class,
or diagnostic surface is denied until it is added to the next versioned
inventory with an explicit policy mapping. An implementation MUST NOT map an
unknown sink to the nearest known enum value.

Policy is the intersection of source and destination controls. All applicable
rows must allow the representation; no row may widen another:

| Control | Applies to |
| --- | --- |
| `durableValues` | Authoritative graph input, bound input, node output/result, and run result carried by event or recovery state |
| `checkpointValues` | Any application value projected into caller or scheduler checkpoint memory/temporary/final bytes |
| `events` | Observational event metadata/derivatives and the event envelope; it cannot override `durableValues` |
| `errors` | Error envelopes, aggregators, and any provider/tool/exception failure projection regardless of destination |
| `logs` | stdout, stderr, runtime/application log adapters, and log-shaped CLI diagnostics |
| `traces` | trace buffers/exports and trace-shaped network payloads |
| `prompts` | `prompt`, `model-request`, and provider request fields containing model input |
| `responses` | `model-response`, provider response, and model-output fields |
| `tools` | tool request/response/error bodies; the separate `errors` control also applies to error projections |
| `artifacts` | artifact bodies and metadata in memory, temporary, and final forms |
| `metrics` | metrics buffers and exporters; values remain a closed metadata allowlist |
| `mcp` | MCP request buffers and responses |
| `plugins` | plugin requests and responses |
| `isolationOutputs` | worktree, process, and container output |
| `database` | database indexes, materialized projections, and backups |
| `exports` | export, replay, fork, explorer/network, and migration reports |
| `supportBundles` | both support staging/final bytes and any support-field projection |
| `testArtifacts` | test-failure and benchmark artifacts plus release-evidence inputs |
| `identifiers` | caller-controlled replacement/protection and runtime-generated opaque metadata |
| `deny` | source classes that have no enabling policy mode in this version |

The destination families resolve as follows:

| Sink classes | Destination rule |
| --- | --- |
| Event memory/buffer/journal | `events`, intersected with `durableValues` for authority and the source-specific prompt/response/tool/error control |
| Checkpoint memory/temporary/final | `checkpointValues`, intersected with the source-specific control |
| Protected-blob memory/temporary/final | The originating authoritative or observational control; blob bytes still pass the protected-store guard |
| Artifact memory/temporary/final | Denied in this contract except when they are the internal protected-blob implementation; a future ArtifactStore policy must version this inventory |
| Retry buffer, dead letter, transport buffer | Inherit the eventual destination and source controls; queuing never relaxes them |
| stdout/stderr/runtime/application logs | `logs` plus the source-specific control |
| trace buffer/export | `traces` plus the source-specific control |
| error envelope/aggregator | `errors` plus the source-specific prompt/response/tool control |
| CLI JSON/diagnostic, MCP, plugin, Explorer/cache, HTTP response | Closed metadata projection plus every source-specific control; a redaction rule only transforms paths already allowed by that intersection |
| Network export | The exact target adapter's control; an unclassified target is off |
| Worktree/process/container output | `isolationOutputs` plus the source-specific control |
| Database index/projection/backup | `database` plus the source-specific control |
| Export/replay/fork reports | `exports` plus the source-specific control |
| Support staging/final | `supportBundles` plus every source-specific control |
| Migration manifest | Closed metadata only; legacy application bytes go only to an explicitly authorized sealed protected archive |
| Test/benchmark/release evidence | `testArtifacts`; closed metadata and synthetic canary identifiers only; no application body or unsafe API output |

The evaluator is the deterministic
`source-sink-intersection/v1alpha1` algorithm carried by the corpus. It reads
exactly one source row, exactly one sink row, and the named effective policy
control. Unknown source, sink, or control returns `failed` with
`REDACTION_POLICY_INVALID`. `policyEnabled` means the source row's control and
every control named by the sink row are enabled by the effective policy. A
false value or source control `deny` returns `suppressed`. Otherwise a
`metadata-only-allowlist` source requests `metadata-only`; both `off` (now
explicitly enabled) and `protected-ref` sources request `protected-ref`.
Caller-controlled identifiers first undergo the mandated opaque replacement
and request protection for the original. The requested representation is then
intersected with `acceptsProtected`/`acceptsMetadata`; incompatibility is
`suppressed` and never falls back or promotes. For the default matrix,
`policyEnabled` is true only when `defaultEnabled` is true and the source's
`defaultAction` is not `off`. The corpus
binds 57 source rows, 54 sink rows, and the complete 3,078-pair Cartesian
domain, with positive and denial examples for each of 18 destination families.
Adding or removing an enum without updating its one classification row, one
sink row, counts, and evaluator corpus is a conformance failure.

`process-environment` and `secret-value` use the `deny` control and cannot be
enabled in this version. Caller-controlled identifiers are never silently
safe metadata: the host replaces them with generated opaque identifiers and
protects the original before persistence. Adding a policy field or interpreting
an unrelated field as permission requires a new capture-policy version.

## 2. Terms and invariant distinctions

### 2.1 Application value

An **application value** is any graph input, bound node input, node output,
result snapshot, prompt, response, tool body, exception text, artifact body, or
other caller/provider/executor-derived content. A reversible encoding,
compression, encryption, digest, truncation, or tokenization of such content is
still application-derived.

### 2.2 Authoritative and observational values

An **authoritative value** is consumed by scheduling, input binding, routing,
budgeting, approval, replay, fork, output construction, or recovery. It must be
recoverable exactly. Redacted data can never be authoritative.

An **observational value** is emitted only for diagnostics, logs, traces,
metrics, user interfaces, or support. It cannot authorize work and cannot be
folded back into scheduler state.

### 2.3 Protected is not redacted

A **protected value** is encrypted and authenticated and is represented in a
sink by a `ProtectedValueRef`. Protection is reversible for an authorized
reader. Therefore:

- a protected reference or ciphertext MUST use `redacted: false`;
- encryption, base64, hashing, HMAC, compression, or moving a value to another
  store MUST NOT be called redaction; and
- the presence of `redacted: true` MUST NOT be interpreted as a claim about
  bytes in another sink.

A value is **redacted** only when a defined irreversible transform removes or
replaces application-derived material before the sink record is constructed,
and a valid receipt proves the transform. Redaction is allowed only for
observational values.

### 2.4 Metadata-only

A metadata-only record contains only fields from a closed, versioned allowlist.
No application value is read for inline capture. A digest or MAC of an
authoritative value may appear only where this contract explicitly permits it;
that fact does not turn the metadata back into scheduler authority.

## 3. Event wire truth

### 3.1 v1alpha1 truth hotfix

The current `events/v1alpha1` envelope permits an optional `redacted` field and
its JSON Schema supplies `default: true`. Current durable writers persist raw
Tagged Durable JSON while asserting `redacted: true`. That assertion is false.

The v1alpha1 truth hotfix MUST:

1. remove the schema default for `redacted`;
2. make absence remain absence in both native models and decoders;
3. make every newly written inline v1alpha1 durable event explicitly emit
   `redacted: false`;
4. update shared fixtures to the same truth;
5. keep `payloadHash` equal to SHA-256 of the exact inline `data` bytes under
   the existing canonicalization rule; and
6. reject a known raw scheduler-recovery/v1alpha1 payload shape whose
   `redacted` field is true or absent/defaulted before `RunResumed` and before
   any executor invocation, using `LEGACY_REDACTION_MISMATCH`.

This hotfix makes the wire statement truthful. It does not make the payload
safe, protected, or stable-v1 eligible. A v1alpha1 journal with
`redacted: false` remains inline-unredacted legacy data and requires explicit
legacy-inline authorization for any unsafe read or continuation.

### 3.2 v1alpha2 envelope

Every `events/v1alpha2` event MUST contain both:

```json
{
  "redacted": false,
  "payloadDisposition": "protected-ref"
}
```

Both fields are required facts; neither has a schema default. The envelope is a
closed object. `payloadDisposition` is exactly one of:

- `metadata-only`;
- `protected-ref`;
- `redacted`; or
- `inline-unredacted`.

The valid combinations are:

| Persisted condition | `payloadDisposition` | `redacted` | Default profile |
| --- | --- | ---: | --- |
| No application payload field was sourced | `metadata-only` | `false` | allowed |
| Authoritative application values appear only as validated protected refs | `protected-ref` | `false` | allowed |
| An irreversible transform was applied and a valid receipt is present | `redacted` | `true` | observational only |
| Plaintext application material remains | `inline-unredacted` | `false` | denied |

All other combinations are invalid. In particular:

- `protected-ref` with `redacted: true` is invalid;
- `redacted` with `redacted: false` is invalid;
- `redacted: true` without a valid `redactionReceipt` is invalid;
- a `redactionReceipt` on any other disposition is invalid;
- `metadata-only` containing an application payload or unapproved derivative is
  invalid; and
- `protected-ref` containing plaintext beside the reference is invalid.

A single event cannot mix a redacted observational derivative with protected
authoritative refs. The producer must keep the scheduler event
`protected-ref` and emit any permitted observational derivative through a
separate guarded record. This avoids a boolean that is true for one field being
misread as a statement about the whole event or another sink.

Envelope validation checks shape and conditional presence. The shared pre-sink
guard additionally verifies semantic classification, reference context, and a
redaction receipt against the candidate record.

### 3.3 Redaction receipt

A `redactionReceipt` is a closed object:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/redaction-receipt/v1alpha2",
  "policyHash": "<64 lowercase hex>",
  "sourceHash": "<64 lowercase hex keyed hash>",
  "resultHash": "<64 lowercase hex keyed hash>",
  "ruleSetHash": "<64 lowercase hex>",
  "transform": "json-pointer-rules/v1alpha2",
  "transformImplementationHash": "<64 lowercase hex>",
  "ruleRegistryHash": "<64 lowercase hex>",
  "ruleRegistryVersion": 7,
  "ruleResolutionId": "resolution-17",
  "authorityBindingHash": "<64 lowercase hex keyed hash>",
  "tenantScopeHash": "<64 lowercase hex keyed hash>",
  "sourceClass": "exception-message",
  "sink": "error-envelope",
  "decisionId": "decision-17",
  "runId": "run-17",
  "graphRevision": 3,
  "occurrenceKind": "sink-write",
  "occurrenceId": "write-17",
  "occurrenceSequence": 9,
  "occurredAt": "2026-07-26T00:00:00Z",
  "fieldPath": "/failure/message",
  "paths": ["/failure/message"],
  "replacementMode": "constant-token",
  "count": 1
}
```

Receipt rules are:

- `paths` contains canonical RFC 6901 JSON Pointers in strictly increasing
  Unicode code-point order after portable string normalization;
- each pointer addresses application-derived material in the pre-transform
  snapshot and is authorized by the immutable capture policy;
- `count` equals `paths.length`;
- `replacementMode` is `remove` or `constant-token`;
- `remove` may remove an object member, but cannot remove the document root or
  an array element;
- `constant-token` replaces the addressed value with the exact JSON string
  `"[REDACTED]"`;
- paths are evaluated against one immutable pre-transform snapshot, then
  applied deepest-first and, for equal depth, in reverse code-point order;
- every selected path must exist; duplicate resolved locations and overlapping
  ancestor/descendant paths make the transform invalid; and
- the receipt contains no removed value, reversible token, unkeyed digest, or
  value length.

The remaining fields bind the proof to one exact transform occurrence:

- `sourceHash` is
  `HMAC-SHA-256(runIdentityKey, canonicalTagged(["redaction-source/v1alpha2",
  sourceClass, sink, fieldPath, sourceSnapshot]))`;
- `resultHash` uses the same construction with domain
  `redaction-result/v1alpha2` and the exact transformed result;
- `ruleSetHash` is SHA-256 of canonical Tagged Durable JSON containing the
  ordered closed resolved rules, including each v1alpha2 `ruleId`,
  `registryVersion`, exact sink, paths, and replacement mode;
- `transformImplementationHash` is SHA-256 of the immutable implementation
  manifest named by the run; it is never derived from source or result bytes;
- `ruleRegistryHash` is SHA-256 of the complete canonical closed registry
  snapshot, while `ruleRegistryVersion` and `ruleResolutionId` identify the
  one resolution used for the write;
- `authorityBindingHash` and `tenantScopeHash` use the domain-separated keyed
  constructions in Section 5.5; and
- source class, exact 54-value sink, run/revision, occurrence kind/ID/sequence,
  persisted timestamp, and field path must equal the candidate write context.

The guard resolves one registry snapshot before transformation and pins its
hash/version/resolution through final sink authorization. A registry change or
mixed-version rule set during that interval fails atomically with
`CAPTURE_POLICY_MISMATCH`; no result, receipt, or dependent release is written.
Changing source, result, rule order, registry, transform identity, authority,
tenant, sink, occurrence, timestamp, or field path while retaining an old
receipt yields `REDACTION_RECEIPT_INVALID`.

`decisionId`, `ruleResolutionId`, and `occurredAt` are audit correlation, not
authorization. Store and sink authority comes only from unforgeable scoped
host capabilities. Serializing a valid receipt cannot authorize another write.

The guard deterministically replays the transform and compares the exact
persisted result. A caller-provided boolean or receipt without that comparison
is not proof of redaction.

#### 3.3.1 Exact pointer resolution and transform order

Pointer processing is identical in TypeScript and Python:

1. Snapshot the complete candidate as portable JSON before consulting any
   path. Combine valid UTF-16 surrogate pairs in keys and values using the
   repository portable-string rule. Reject the candidate before transformation
   if two object keys collide after that normalization.
2. Reject the empty pointer because root replacement/removal is not permitted.
   Every accepted pointer starts with `/`. Split only on literal `/`; for each
   reference token, decode `~1` as `/` and `~0` as `~`. A `~` followed by any
   other character or by end-of-token is invalid. Re-encoding the decoded token
   with `~` then `/` escaping MUST reproduce the input token exactly. After
   decoding, any token exactly equal to `__proto__`, `prototype`, or
   `constructor` invalidates the entire transform, at any depth and regardless
   of whether it is an own JSON member.
3. When the current value is an object, the decoded token is an exact,
   case-sensitive key. A numeric-looking object key remains an object key. When
   the current value is an array, the token is exactly `0` or a base-10 form
   matching `[1-9][0-9]*`; `-`, signs, whitespace, exponent notation, and
   leading zeroes are invalid. The parsed index must be less than the original
   array length. Object traversal uses only data properties materialized from
   the portable JSON snapshot. JavaScript implementations use null-prototype
   maps plus `Object.hasOwn`; Python uses exact built-in `dict` membership.
   Getters, proxies, custom mappings, prototypes, and inherited properties are
   never invoked or traversed.
4. Resolve every path against the same immutable snapshot. Every component and
   final target must exist. Before mutation, reject duplicate source strings,
   duplicate resolved locations, or any ancestor/descendant pair. Paths are
   stored in strict normalized Unicode code-point order; input in any other
   order is invalid rather than silently sorted.
5. For `constant-token`, replace exactly the addressed value—including an
   array element—with the JSON string `"[REDACTED]"`. For `remove`, remove only
   an object member; root and array removal are invalid. Apply valid operations
   from greatest depth to least depth and, at equal depth, reverse code-point
   order.
6. Validate the resulting value again as portable JSON. Construct the receipt
   from all fields in Section 3.3; then replay from the immutable snapshot and
   byte-compare the canonical result before a sink can be authorized.

Resolution and mutation use an explicit iterative work stack, never recursive
host traversal. Before work begins, enforce Section 11's canonical UTF-8 byte,
pointer-count, per-pointer token-count, per-token byte, value-depth, value-node,
container, object-member, transformed-byte, and aggregate-ref limits. Limit
failure wins before missing-target, overlap, or mutation checks and produces no
partial result. JSON Schema character limits are defense in depth only; the
normative limits count UTF-8 bytes and decoded tokens.

The transform is a total deterministic result operation over all inputs: it
returns either one transformed snapshot plus receipt or one structured
`REDACTION_POLICY_INVALID`/`REDACTION_RECEIPT_INVALID` denial. A malformed
pointer, missing target, normalization collision, unsupported value, or
internal exception never produces a partial candidate and never escapes into a
raw diagnostic. No model node participates in path resolution or plumbing.

## 4. Capture policy

### 4.1 Effective policy

One immutable effective capture policy is resolved before a durable run starts.
The default stable profile is:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/capture-policy/v1alpha2",
  "durableValues": "protected",
  "checkpointValues": "protected",
  "events": "metadata-or-protected",
  "artifacts": "off",
  "errors": "codes-and-sanitized-message",
  "logs": "metadata-only",
  "traces": "off",
  "metrics": "off",
  "prompts": "off",
  "responses": "off",
  "tools": "off",
  "mcp": "off",
  "plugins": "off",
  "isolationOutputs": "off",
  "database": "off",
  "exports": "off",
  "supportBundles": "off",
  "testArtifacts": "off",
  "identifiers": "generated-opaque-only",
  "maxDiagnosticUtf8Bytes": 1024,
  "redactionTransform": "json-pointer-rules/v1alpha2",
  "transformImplementationHash": "<64 lowercase hex>",
  "ruleRegistryVersion": 7,
  "ruleRegistryHash": "<64 lowercase hex>",
  "redactionRules": [],
  "keyRef": "operator-owned-key-reference"
}
```

The effective object is closed and all shown fields are required. One additional
field, `inlineRiskAuthorizationHash`, is conditionally allowed and is required
exactly when any sink selects `inline-unredacted`. It is a 64-lowercase-hex
digest of a separately authenticated operator authorization; the authorization
body is not embedded in the policy or an event. The field is forbidden when no
inline mode is selected.

The portable mode vocabulary is closed:

| Policy field | Allowed values |
| --- | --- |
| `durableValues`, `checkpointValues` | `protected`, `inline-unredacted` |
| `events` | `metadata-or-protected`, `allow-redacted`, `inline-unredacted` |
| `errors` | `codes-only`, `codes-and-sanitized-message`, `redacted`, `protected-evidence`, `inline-unredacted` |
| `logs`, `traces`, `metrics` | `off`, `metadata-only`, `redacted`, `protected`, `inline-unredacted` |
| `artifacts`, `prompts`, `responses`, `tools`, `mcp`, `plugins`, `isolationOutputs`, `database`, `exports`, `supportBundles`, `testArtifacts` | `off`, `metadata-only`, `redacted`, `protected`, `inline-unredacted` |
| `identifiers` | `generated-opaque-only`, `protected`, `inline-unredacted` |

`maxDiagnosticUtf8Bytes` is an integer in `0..1024`. A `redacted` mode
requires at least one matching `redactionRules` entry; a rule is invalid for a
sink whose mode is not `redacted` or `allow-redacted`. A `protected` mode
requires a compatible protected store and key authority. `metadata-only` does
not permit application values merely because a producer labels them metadata.

Policy input may use implementation-specific conveniences, but it MUST
normalize to this portable object before hashing or comparison.

`redactionRules` contains at most one closed rule per sink:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/redaction-rule/v1alpha2",
  "ruleId": "trace-query-v1",
  "registryVersion": 7,
  "sink": "trace-export",
  "paths": ["/attributes/query"],
  "replacementMode": "constant-token"
}
```

Valid sinks are the exact 54-value `capture-sink.schema.json` enum. Rules are
ordered by sink enum order, then `ruleId`; paths follow the receipt ordering
rules. Every rule's `registryVersion` equals the policy snapshot version. An
empty rule list means redacted capture is not enabled. A model, graph, tool,
provider, plugin, or diagnostic value cannot supply or mutate a rule.

Structural schema validation is followed by semantic policy validation. There
is at most one rule for each sink, rule sinks are in the enum order above, and
every rule contains at least one path. A rule is required exactly for each
selected `redacted` mode (and for `events: allow-redacted` when a redacted
event derivative is emitted) and is forbidden for an incompatible mode.
Unknown modes, duplicate sinks, reordered rules/paths, or an authorized path
that cannot be proved to select only observational material fail the complete
policy before its hash is computed.

The canonical `policyHash` is:

```text
SHA-256(canonical UTF-8 JSON(TaggedDurableJSON(effectivePolicy)))
```

It is emitted as 64 lowercase hexadecimal characters. `RunCreated` records the
hash, not the policy or `keyRef`. Resume must resolve the policy again and match
the hash exactly.

### 4.2 Defaults and failure behavior

Under the default profile:

- durable and checkpoint application values use protected refs;
- event data is closed metadata or protected refs;
- logs contain fixed allowlisted metadata only; trace and metrics capture are
  off unless explicitly enabled;
- prompts, model responses, tool bodies, and support bundles are absent;
- errors contain stable codes and fixed-template sanitized messages only;
- raw exception strings, provider bodies, environment values, and credentials
  are not passed to a sink serializer; and
- no network exporter is activated merely by starting a runtime.

If a durable start or checkpoint save would persist an authoritative
application value and a compatible `ProtectedPayloadStore` plus `KeyProvider`
are not configured, the operation fails with
`PAYLOAD_PROTECTION_REQUIRED` before the first event, checkpoint, log, error
payload, temporary plaintext file, or executor invocation. It MUST NOT generate
a key beside the ciphertext and MUST NOT fall back to inline capture.

`metadata-only` is invalid where recovery requires an exact value. Omitting an
authoritative value, substituting null, using a redaction token, or recording
only its MAC is a protection failure rather than a reduced-capture success.

### 4.3 Explicit high-risk inline mode

`inline-unredacted` exists only as an alpha compatibility/debug escape hatch.
It requires all of:

- an operator policy that explicitly selects inline capture for the named sink;
- a separately authenticated risk authorization whose 64-lowercase-hex digest
  is bound into the effective policy;
- `payloadDisposition: inline-unredacted` and `redacted: false` on each record
  written to that sink;
- a diagnostic warning that contains no application value; and
- a deployment policy that permits the mode.

Inline mode is a property of an observational sink record, never of the
`events/v1alpha2` scheduler envelope. `event-v1alpha2.schema.json` pins exactly
one disposition per event type — `metadata-only` or `protected-ref` — so
`inline-unredacted` is not merely denied by the default profile there, it is
unrepresentable. That is deliberate and must not be relaxed. Section 3.2 already
requires the producer to keep the scheduler event `protected-ref` and emit any
permitted observational derivative through a separate guarded record; widening
the envelope enum would readmit plaintext application material into the
authoritative durable stream, which is precisely the defect this contract
exists to eliminate. An earlier draft of this section said "on each event",
which read as a requirement implementers could not satisfy against any schema in
this repository; the requirement is on sink records, and the envelope is closed.

The stable production profile always denies it. Inline mode cannot satisfy D9,
the default-privacy canary gate, or stable release evidence. An untrusted graph
or child may never request inline mode.

### 4.4 Policy non-expansion

Policy selection is deterministic code outside model/tool output. The operator
maximum is intersected with runtime support and any narrower run request.
Missing or unknown information narrows capture or fails closed.

A graph, node, router, planner, verifier, provider, tool, resumed worker,
dynamic patch, or child graph may request less observational capture. It cannot:

- change `keyRef` or the policy hash;
- enable a disabled sink;
- change metadata-only to redacted, protected, or inline;
- change protected to inline;
- add a redaction path or increase the diagnostic byte bound; or
- remove protection from an authoritative durable value.

If less capture would make recovery impossible, the operation fails rather than
silently changing semantics. A policy change on resume is
`CAPTURE_POLICY_MISMATCH`.

## 5. Protected payload contract

### 5.1 Closed reference

The journal/checkpoint representation of an authoritative value is this exact
closed object:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/protected-value/v1alpha1",
  "ref": "pv_01J00000000000000000000000",
  "codec": "durable-json/v1alpha1",
  "ciphertextHash": "<64 lowercase hex>",
  "valueMac": "<64 lowercase hex>",
  "keyRefHash": "<64 lowercase hex>",
  "aadHash": "<64 lowercase hex>"
}
```

`ref` is an opaque identifier matching
`^pv_[A-Za-z0-9][A-Za-z0-9._-]{0,124}$`; `.` and `..` are not valid suffixes.
The four hash/MAC fields are exactly 64 lowercase hexadecimal characters.
Unknown properties, unknown versions/codecs, or an unsafe reference are
invalid.

The reference is not a capability URL. Possession does not bypass store read
authorization or key authority. It must not contain a filename, host path,
tenant name, key identifier, account identifier, or application-derived text.

`keyRefHash` is the Tagged Durable JSON SHA-256 of:

```text
["key-ref/v1alpha1", keyRef]
```

It identifies the configured reference without persisting it. A key reference
is not treated as a secret value, but operators should still use opaque,
non-personal identifiers.

### 5.2 Protected blob

Logical values are first encoded as canonical Tagged Durable JSON. The baseline
portable protected blob is canonical UTF-8 JSON for this closed object:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/protected-blob/v1alpha1",
  "algorithm": "A256GCM",
  "nonce": "<base64url without padding, exactly 12 decoded bytes>",
  "ciphertext": "<base64url without padding>",
  "tag": "<base64url without padding, exactly 16 decoded bytes>"
}
```

AES-256-GCM receives a 32-byte protection key, the canonical Tagged Durable
JSON bytes as plaintext, and the associated-data bytes defined below. A
production nonce comes from a cryptographically secure generator and MUST be
unique for a protection key. An untrusted caller cannot inject it.
Deterministic nonces and keys are allowed only in a clearly named test provider
used for fixed conformance vectors.

All three byte fields use canonical unpadded base64url. The semantic decoder
rejects padding, non-alphabet characters, a length congruent to one modulo
four, non-zero unused pad bits, or any spelling whose decode-then-re-encode
does not reproduce the input. The nonce decodes to exactly 12 bytes, the tag to
exactly 16 bytes, and ciphertext to at least one byte within the protected-value
limit. JSON Schema length/pattern checks are necessary but not sufficient for
these byte rules.

`ciphertextHash` is SHA-256 of the exact stored protected-blob bytes. It is an
integrity/address fact about ciphertext, not logical-value identity.

A production provider SHOULD use envelope encryption so a key-encryption key
can rotate without changing immutable blob bytes. Provider-owned wrapped-key
metadata is outside the event and protected blob, is access controlled, and
must never contain plaintext data keys. Rotation MUST NOT change an event,
`ref`, `ciphertextHash`, `valueMac`, `aadHash`, or activity identity.

### 5.3 Key provider

For each run, the operator-owned `KeyProvider` supplies:

- protection authority capable of encrypting/decrypting the protected blob;
- a 32-byte run identity key for HMAC-SHA-256; and
- a stable key-reference identity.

Protection and identity keys must be cryptographically independent. The
identity key remains stable for the lifetime of the run, including resume and
key wrapping rotation. A key, plaintext data key, identity key, nonce source,
or raw key-provider error MUST NOT appear in Graph IR, events, checkpoints,
artifacts, logs, traces, errors, support bundles, or committed evidence.

Production key derivation, KMS protocol, hardware boundary, escrow, and
rotation schedule are provider responsibilities. Shared conformance uses an
explicit test provider and does not prescribe a production root-key format.

### 5.4 Semantic value MAC

`valueMac` is the logical identity used in recovery comparisons. It is:

```text
HMAC-SHA-256(
  runIdentityKey,
  canonical UTF-8 JSON(
    TaggedDurableJSON([
      "value-mac/v1alpha1",
      semanticContext,
      logicalValue
    ])
  )
)
```

The result is lowercase hexadecimal. `semanticContext` is one of these closed
portable objects:

| Value | Required semantic context |
| --- | --- |
| Graph input | `{"kind":"graph-input","runId":R,"graphRevision":G}` |
| Bound node input | `{"kind":"node-input","runId":R,"graphRevision":G,"nodeId":N}` |
| Node output | `{"kind":"node-output","runId":R,"graphRevision":G,"nodeId":N}` |
| Settled node result | `{"kind":"node-result","runId":R,"graphRevision":G,"nodeId":N}` |
| Terminal run result | `{"kind":"run-result","runId":R,"graphRevision":G}` |
| Raw diagnostic evidence | `{"kind":"diagnostic-evidence","runId":R,"graphRevision":G,"nodeId":N,"attempt":A,"code":C}` |

Optional identity fields are omitted, never encoded as null. A node input MAC
deliberately excludes attempt and event type, so the same logical node input in
one run has one identity across retries and resume. Different runs use
different run identity keys and therefore do not expose a correlatable unkeyed
digest for low-entropy values.

### 5.5 Associated data

Encryption is bound to a persisted occurrence, separately from semantic
identity. The associated data is canonical UTF-8 JSON for Tagged Durable JSON
of this closed object:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/protected-aad/v1alpha1",
  "contractVersion": "scheduler-recovery/v1alpha2",
  "runId": "run-123",
  "graphRevision": 1,
  "recordKind": "event",
  "recordType": "NodeScheduled",
  "eventId": "event-17",
  "sequence": 17,
  "nodeId": "fetch",
  "attempt": 1,
  "fieldPath": "/data/inputRef",
  "capturePolicyHash": "<64 lowercase hex>",
  "keyRefHash": "<64 lowercase hex>",
  "authorityBindingHash": "<64 lowercase hex keyed hash>",
  "tenantScopeHash": "<64 lowercase hex keyed hash>",
  "codec": "durable-json/v1alpha1",
  "valueMac": "<64 lowercase hex>"
}
```

`recordKind` is `event` or `checkpoint`. `recordType` is the exact event type
or versioned checkpoint projection type. `nodeId`, `edgeId`, and `attempt` are
present only when the occurrence has them. Every event AAD requires the exact
persisted `eventId` and `sequence` and forbids `checkpointId`. Every checkpoint
AAD requires the exact persisted `checkpointId` and `sequence` and forbids
`eventId`. `fieldPath` is an RFC 6901 pointer to the field holding the ref in
that occurrence.

The host supplies opaque, non-caller-controlled `tenantScopeId`,
`authorityProviderId`, and `authoritySubjectId`. They never appear on wire.
The privacy-safe bindings are:

```text
tenantScopeHash = HMAC-SHA-256(
  runIdentityKey,
  canonicalTagged(["tenant-scope/v1alpha1", tenantScopeId])
)

authorityBindingHash = HMAC-SHA-256(
  runIdentityKey,
  canonicalTagged([
    "protected-authority/v1alpha1",
    authorityProviderId,
    authoritySubjectId,
    tenantScopeHash,
    runId,
    capturePolicyHash,
    keyRefHash
  ])
)
```

`canonicalTagged` means canonical UTF-8 JSON of Tagged Durable JSON. The scope
input is closed and ordered exactly as shown; optional fields do not exist.
Store operation permission is still checked separately by the opaque host
capability and is not inferred from either hash.

`aadHash` is SHA-256 of those exact bytes. The protector authenticates the same
bytes. Copying a blob/ref to another run, revision, event/checkpoint ID,
sequence, record type, node, edge, attempt, field, policy, key reference,
authority, tenant, codec, or semantic identity therefore fails.

A `ref` may be reused only when the complete associated-data object is
byte-identical. Otherwise the logical value may retain its `valueMac` but MUST
be protected into a new occurrence with a fresh production nonce.

### 5.6 Store behavior

A `ProtectedPayloadStore`:

- authorizes every put/get/delete by run/tenant and operation;
- atomically publishes private blob bytes;
- validates safe opaque references and exact ciphertext hashes;
- returns no value on missing, denied, truncated, or corrupt data;
- never logs request/response bodies, keys, plaintext, or raw provider errors;
- leaves no plaintext temporary file; and
- treats orphaned but successfully protected blobs as cleanup work, never as
  scheduler authority.

Decryption requires both store read authority and key authority. A successful
read authenticates the blob, decodes Tagged Durable JSON, recomputes
`valueMac`, and validates the expected logical context before exposing a
detached value to the recovery fold.

A narrow protected store satisfies only this D9 primitive. It is not a claim
that the future general ArtifactStore, production tenant storage, retention,
distributed worker, or backup contract exists.

The guarded store operation is the closed
`protected-store-envelope/v1alpha1` shape. It never accepts a logical plaintext
value, encryption key, nonce source, free-form metadata, or raw provider error.
For `put`, semantic validation recomputes the canonical blob
`ciphertextHash` and AAD `aadHash`; requires exact equality of envelope and AAD
`runId`, `capturePolicyHash`, `keyRefHash`, `authorityBindingHash`, and
`tenantScopeHash`; requires reference and AAD `keyRefHash` equality; requires
reference and AAD `valueMac` equality; and requires the authority-bound opaque
ref to identify the same published bytes. `get` and
`delete` require the same expected ref and AAD context; returned bytes are not
trusted until every authentication step in this section passes.

`authorityBindingHash` is an authenticated scope-binding fact, not a capability. Actual
put/get/delete authorization is an unforgeable host capability checked at the
operation boundary and scoped to operation, tenant/run, policy, and provider.
An operation ID is single-purpose: replay with a byte-identical envelope may
receive the idempotent prior result, while reuse with any changed operation or
field is rejected. A serialized envelope, reference, decision record, hash, or
graph-supplied object cannot manufacture store authority.

## 6. Durable event and checkpoint mapping

### 6.1 Scheduler event data

`scheduler-recovery/v1alpha2` replaces raw values and their unkeyed value hashes
as follows:

| Event field in v1alpha1 | v1alpha2 field | Required disposition |
| --- | --- | --- |
| `RunCreated.input` / `inputHash` | `inputRef` / `inputMac`, plus `capturePolicyHash`, `protectedStoreContract`, and `keyRefHash` | `protected-ref` |
| `NodeScheduled.input` / `inputHash` | `inputRef` / `inputMac` | `protected-ref` |
| `NodeStarted.inputHash` | `inputMac` | `metadata-only` |
| `NodeSucceeded.output` / `outputHash` | `outputRef` / `outputMac`; `inputMac` remains metadata | `protected-ref` |
| `EdgeEmitted.outputHash` | `outputMac` | `metadata-only` |
| `NodeAttemptFailed.failure.message` | stable code/template message; optional raw `evidenceRef` / `evidenceMac` only under explicit protected-evidence policy | `metadata-only` or `protected-ref` |
| `NodeSettledWithoutAttempt.result` | `resultRef` / `resultMac`; closed outcome metadata may remain inline | `protected-ref` |
| terminal `Run*.result` | `resultRef` / `resultMac` | `protected-ref` |

The event envelope `apiVersion` is exactly
`graphengineering.reacher-z.github.io/events/v1alpha2`.
`RunCreated.data.contractVersion` is exactly
`scheduler-recovery/v1alpha2`. `protectedStoreContract` is exactly
`protected-payload-store/v1alpha1` for this revision. Every inline metadata
field is defined by the event-type schema; arbitrary diagnostic properties are
invalid. Legacy field aliases such as `inputHash`, `outputHash`, and an
unkeyed logical `resultHash` are forbidden in a protected v1alpha2 payload.

For any ref/MAC pair, the adjacent `inputMac`, `outputMac`, `resultMac`, or
`evidenceMac` MUST equal the referenced object's `valueMac`. A mismatch is
corruption.

Beyond schema shape, event validation recomputes `payloadHash` from canonical
`data`, requires every event's `capturePolicyHash` to match `RunCreated`, checks
sequence/type/node/edge/attempt legality against the fold, and verifies each
reference under its exact event AAD before it can affect state. Trace and span
identities, when present, are lowercase fixed-width non-zero hexadecimal; a
parent span requires a valid surrounding trace/span relation. The
`NodeScheduled.sideEffects` classification is immutable for that node attempt
lineage and is not accepted from executor/model output. Graph IR omission is
normalized exactly once to the explicit v1alpha2 value `unspecified`, which is
serialized in `NodeScheduled`; it is never inferred as `none`. The only input
classifications are `none`, `idempotent`, `non-idempotent`, and omission.
Unknown strings fail with `REDACTION_POLICY_INVALID` before an event,
protected-store write, or executor call. Recovery always classifies an open
`unspecified` attempt as `in-doubt-effect`.

`RunStarted`, `RunResumed`, `NodeStarted`, `NodeRetried`, and
`EdgeEmitted` are metadata-only under the default profile. Identifiers,
attempts, times, stable structured codes, policy hashes, MACs, and activity
keys are permitted only in their event-type allowlists.

`NodeAttemptFailed` default messages are selected from versioned fixed
templates by stable code; they are not substrings of caught exceptions.
Host-specific cause names are omitted unless mapped through a closed safe
allowlist. Raw errors, stack traces, provider responses, prompts, paths, and
tool output are absent. Explicit raw diagnostic evidence uses a protected ref
and is never scheduler authority.

Future event types—including graph patches, routes, barriers, verification,
budgets, artifacts, and human decisions—inherit this contract. A reserved event
name does not permit inline application data. Their versioned schemas must
classify every field before implementation.

### 6.2 Checkpoints

A scheduler checkpoint for the protected contract uses
`graphengineering.reacher-z.github.io/checkpoints/v1alpha2` and contains:

- the last applied event sequence and history-prefix hash;
- graph revision/hash, implementation hash, and capture-policy hash;
- total attempts and closed node projections;
- protected refs and MACs needed to accelerate reconstruction; and
- no plaintext application value or redacted derivative used as authority.

`contentHash` covers the exact persisted checkpoint body containing refs and
metadata. It never hashes plaintext application state. Temporary and final
checkpoint bytes both contain only the guarded representation.

Every scheduler checkpoint creates a new checkpoint-bound protected occurrence
for each projected application value, with its own `checkpointId`, `sequence`,
field path, AAD, `aadHash`, and production nonce. The logical `valueMac` may
remain equal when semantic context/value is equal, but an event ref or prior
checkpoint ref is never copied into the new projection. Copying checkpoint A's
ref into checkpoint B fails authentication before fold or executor.

Missing, denied, stale, corrupt, ahead-of-tail, policy-mismatched, or
projection-inconsistent refs cause the checkpoint to be ignored or recovery to
fail according to event authority. They never authorize work, hide event
corruption, or become null.

A generic caller-created checkpoint that contains application values must pass
the same guard and use checkpoint-bound protected refs. Existing
`checkpoints/v1alpha1` arbitrary inline state is legacy-inline data.

Semantic checkpoint validation requires exactly one node projection for each
compiled graph node, in graph declaration order, with no duplicate/unknown
node IDs. Status-specific fields must match the authoritative fold at
`sequence`; `openAttempt`, `nextAttempt`, per-node `attempts`, and
`totalAttempts` must agree with the event prefix. Every adjacent `*Mac` equals
its reference `valueMac`, and every reference authenticates new
checkpoint-bound AAD at its exact field path. `historyPrefixHash` matches the
canonical accepted event prefix. `contentHash` is SHA-256 of canonical UTF-8
JSON for the entire closed checkpoint object with only `contentHash` omitted.
Schema shape alone cannot establish any of these projection relations.

## 7. Sink-before-write guard

Every default runtime sink MUST receive data only after one shared
deterministic guard has completed:

```text
immutable snapshot + portable validation
  -> classify field and sink
  -> compute keyed semantic identity for authoritative values
  -> apply immutable capture policy
  -> redact observational derivative OR protect authoritative bytes
  -> validate disposition, receipt, refs, and closed sink schema
  -> run canary/credential defense-in-depth scan
  -> canonicalize and hash the persisted representation
  -> write or export
```

For every classified source/sink pair, the guard is a total host-code function:
it returns `suppressed`, a structured failure, or one opaque in-memory
`PreparedSinkWrite`. It does not throw caller/provider text, return a partly
transformed object, or use `null` as failure. The prepared write binds the
single sink instance, canonical final bytes, payload hash, policy hash, and
decision identity. Its constructor is private to the guard, it cannot be
serialized or cloned, and the matching sink consumes it at most once. Changed
bytes, destination, policy, or decision require a new guard evaluation.

Before representation selection, the guard performs the corpus-defined total
source×sink evaluation: locate the unique 57-source row and 54-sink row, verify
the row's named policy control, deny every unknown or missing row, then
intersect source disposition, policy enablement, and sink acceptance without
promotion. This is a 3,078-entry domain even though the implementation is a
deterministic table join rather than a materialized 3,078-row file.

`sink-guard-decision/v1alpha1` is only a closed metadata-only audit projection.
Even a record with `writeAuthorized: true` is not the opaque capability and
cannot be passed to a sink, protected store, scheduler fold, or dependent
release gate. This distinction prevents a forged JSON object from bypassing
the transform. A `failed` decision always includes the stable `failureCode`,
exact `executorOutcome`, and `retryDisposition`; every non-failed decision
forbids those three failure-disposition fields.

There is no write-then-scrub path. Raw material MUST NOT be serialized to a
temporary file, batch journal, retry queue, trace buffer, crash report, or
debug log on the way to the guard.

If snapshotting, classification, policy resolution, encoding, MAC, encryption,
atomic publication, receipt validation, scanning, canonicalization, or sink
write fails:

- the failure is structured and does not echo the offending value;
- no plaintext fallback is attempted;
- no event/checkpoint reference to a failed or partial blob is committed;
- a multi-event commit is rejected as a unit before a dependent is released;
  and
- already atomically protected but unreferenced blobs are safe orphans queued
  for authorized cleanup.

The guard applies equally to journal, checkpoint, protected blob, stdout,
stderr, log, trace, error, CLI/MCP, Explorer/API, and support-bundle adapters.
It covers every memory, temporary, staging, final, queue, transport, export,
migration, and evidence class in the 54-entry sink inventory. An adapter cannot
opt out by calling a lower-level raw writer. The default runtime dependency
graph exposes only sinks whose public write method accepts a
`PreparedSinkWrite`; raw byte/file/network/store primitives are private
implementation details and receive only the already prepared bytes.

Embedding APIs that intentionally expose raw storage must be separately named
and typed `unsafe`, require an explicit host capability unavailable to graph,
node, tool, provider, plugin, and deserialized input code, and live outside the
default runtime construction path. Unsafe writes cannot append scheduler
authority, release dependents, satisfy approvals, produce release evidence, or
count toward D9 conformance. Tests must prove that passing a serialized guard
decision, store envelope, protected ref, forged structural object, or direct
adapter reference cannot reach a default sink write.

Trace and span IDs use their protocol-safe fixed format. Trace attributes come
from a closed metadata allowlist. Input, output, prompt, response, tool body,
raw exception, environment, and secret values are absent by default.

## 8. Hashes, activity identity, recovery, replay, and rotation

### 8.1 Required order

For each authoritative value, implementations perform this order:

1. take a detached immutable snapshot and validate the logical value;
2. encode canonical Tagged Durable JSON;
3. compute its semantic-context `valueMac`;
4. construct occurrence-specific AAD;
5. protect and atomically publish the blob;
6. persist only the validated `ProtectedValueRef` and allowed metadata;
7. compute event `payloadHash` over the exact persisted `data` containing refs;
8. commit the event before executor/dependent release; and
9. on recovery, authorize, authenticate, decrypt, decode, recompute the MAC,
   validate context, and only then expose a detached value to the fold.

`payloadHash` remains:

```text
SHA-256(canonical UTF-8 JSON(event.data))
```

It is byte-level event integrity, not logical replay identity. Moving from
inline fields to refs necessarily changes it.

### 8.2 Activity key

The v1alpha2 activity/idempotency key is:

```text
HMAC-SHA-256(
  runIdentityKey,
  canonical UTF-8 JSON(
    TaggedDurableJSON([
      "activity/v1alpha2",
      runId,
      graphRevision,
      nodeId,
      inputMac
    ])
  )
)
```

It is lowercase hexadecimal. Attempt is deliberately excluded. The same node
input in the same run keeps one activity key across retry and resume. A
different run, node, revision, input, or identity key yields a different key.
No unkeyed low-entropy input digest is exposed.

### 8.3 Resume

Before `RunResumed` or executor invocation, resume validates:

- stream/envelope/event semantics and payload hashes;
- graph, revision, implementation, and capture-policy identity;
- protected-store contract and key-reference hash;
- authorization for every required ref;
- ciphertext hash, AEAD authentication, AAD, codec, and `valueMac`; and
- terminal or projection consistency.

A missing key/blob, denied read, policy change, authentication error, MAC
mismatch, or unsupported version fails closed. Recovery MUST NOT substitute
null, an empty object, a redaction token, stale checkpoint value, or caller
replacement input.

Terminal resume may return a decrypted recorded result only after the same
checks and authorization. It appends no event and invokes no executor.

### 8.4 Replay and fork

Replay and fork implementation remain outside the immutable-DAG recovery
slice, but their privacy identity is frozen:

- a new execution uses a new run ID and new run-scoped identity key;
- an authorized migration reads the old protected value, validates it, and
  protects it again under new semantic/AAD context;
- refs, value MACs, activity keys, ciphertext, or approvals are never copied as
  authority across runs;
- provenance may retain only closed metadata and protected source references;
  and
- externally effectful or in-doubt work requires the later reconciliation and
  approval contract.

Observational redaction output can never seed replay or fork.

### 8.5 Derivative and projection inheritance

Every derivative is classified again and passes the guard for its own sink.
Protection, redaction, authorization, approval, or scanning of a source record
does not automatically bless a copy, projection, cache, export, or child run.
The effective policy may narrow for a derivative but never expand.

| Derivative | Required inheritance behavior |
| --- | --- |
| Scheduler checkpoint | Always create a new checkpoint-bound protected occurrence and AAD; never copy an event ref into a checkpoint field |
| Terminal run-result event | Create a new terminal-event occurrence; retain the logical result MAC only where semantic context is identical, never reuse incompatible AAD |
| Retry/resume of the same node input | Retain the run-scoped input MAC/activity identity; create a new protected occurrence whenever record type, attempt, field, or other AAD differs |
| Protected raw error evidence | Use a diagnostic-evidence semantic context and its own protected occurrence; it never becomes scheduler input |
| Log, trace, metric, Explorer, CLI/MCP, or HTTP projection | Omit by default or construct closed metadata only; any permitted redacted/protected observation is a separate guarded record and never scheduler authority |
| Support bundle, export, migration manifest, release evidence | Reclassify every field and guard both staging and final bytes; source authorization and redaction receipts do not transfer |
| Replay, fork, or child run | Allocate a new run ID, policy resolution, run identity key, semantic identities, AAD, and protected occurrences; copy no ref, MAC, activity key, approval, or write capability as authority |
| Redacted derivative of any kind | Observational only; cannot seed input binding, routing, budgeting, approval, recovery, result construction, replay, or fork |

Caches and in-memory projections follow the same table. Provenance may point to
closed source metadata or an independently authorized protected reference, but
it cannot become an ambient read capability. When a derivative cannot be
classified or protected under its destination context, the derivative is
suppressed or fails; it never falls back to source bytes.

### 8.6 Key rotation

Rotation rewraps provider-owned envelope-key material without rewriting the
append-only event stream or protected blob. The run identity key and semantic
MACs remain stable. If a rotation cannot preserve those identities, it is a
new-key migration requiring a new run/protected occurrence, not transparent
rotation.

## 9. Legacy histories and migration

### 9.1 Detection

A known misleading legacy history is:

```text
contractVersion == "scheduler-recovery/v1alpha1"
AND (redacted == true OR redacted was absent/defaulted)
AND a known inline input/output/result/failure payload shape is present
```

Known inline shapes include `RunCreated.input`, `NodeScheduled.input`,
`NodeSucceeded.output`, `NodeAttemptFailed.failure.message/causeName`,
`NodeSettledWithoutAttempt.result`, terminal `Run*.result`, and equivalent
checkpoint projections.

The default result is `LEGACY_REDACTION_MISMATCH` before `RunResumed`, before
append, and before any executor invocation. A terminal stream is not exempt.

A v1alpha1 history with `redacted: false` is truthful but still unsafe. Default
protected mode rejects continuation as `INLINE_CAPTURE_NOT_AUTHORIZED`.
Explicit legacy-inline authorization may permit a narrowly scoped unsafe
read/continuation during the truth-hotfix window, but it is never protected D9
evidence and is disabled by the stable production profile.

### 9.2 Prohibited repair

Implementations MUST NOT:

- flip a flag in place;
- add a default and reinterpret old bytes as protected;
- recompute hashes and rewrite JSONL;
- scrub or truncate the original history;
- copy a nonterminal stream under a new run ID while retaining refs, MACs, or
  activity keys; or
- automatically resume externally effectful/in-doubt work.

Such behavior would conceal exposed bytes, violate append-only audit
expectations, or reuse the wrong external-effect identity.

### 9.3 Supported outcomes

**Quarantine** preserves the original bytes read-only, restricts permissions,
records their SHA-256 digest and unsafe classification in a metadata-only
manifest, and blocks resume.

**Sealed archive** requires explicit operator authority. It encrypts the
complete legacy bytes into a protected archive and emits only a metadata
manifest containing source digest, destination ciphertext digest, migration
tool version, UTC time, disposition, and reviewer identity/reference. It never
contains source payloads, canary values, or unkeyed logical-value digests.

**New run/replay-fork** creates a v1alpha2 run ID with newly protected inputs.
Nonterminal or externally effectful history requires reconciliation and the
later approval contract. Conversion is never automatic.

An explicit unsafe inspection API may read a terminal legacy history only after
authorization and must return a prominent structured warning. It never
continues scheduling and never writes the raw value to another sink by default.

## 10. Stable failure codes and atomicity

### 10.1 Executor success followed by protection or sink failure

Executor return is not durable node success. `NodeSucceeded` becomes eligible
only after the detached output validates, its semantic MAC and protected
occurrence are complete, the candidate success batch passes the guard, and the
event append commits. No edge or dependent may observe the output before that
commit.

If the executor returns successfully but snapshotting, validation, MAC,
protection, publication, scanning, canonicalization, CAS, or success-event
write then fails:

- do not append `NodeSucceeded`, `EdgeEmitted`, a terminal event, checkpoint
  projection, or any output/reference-bearing record;
- do not append `NodeAttemptFailed`: that event's closed failure phase is
  `execute`, and claiming executor failure after a successful return would be
  false history;
- do not rewrite or close the already committed `NodeStarted`, and release no
  dependent;
- return/latch `PAYLOAD_PROTECTION_FAILED` as structured non-sensitive runtime
  state; the unresolved `NodeStarted` is the conservative durable open-attempt
  evidence used after a crash or resume;
- count the executor invocation against the attempt budget; never reuse the
  attempt number as though execution had not happened; and
- retain only atomically protected unreferenced blobs as safe orphans for a
  separately authorized cleanup path. Partial or plaintext bytes are destroyed
  without being treated as an orphan.

Recovery classifies that open attempt using the `sideEffects` value committed
with `NodeScheduled`. For `none`, recovery may reserve a **new** attempt and
invoke the pure executor again, subject to the ordinary finite attempt budget;
this is `safe-new-attempt`. For both `idempotent` and `non-idempotent`, the
state is `in-doubt-effect` and automatic retry is forbidden. `unspecified`
has the same conservative `in-doubt-effect` result. An unknown value is invalid
before any event, store write, or executor call; omission never becomes
`none`. A declaration of
idempotency does not prove what the external system observed after a known
successful return. Later reconciliation/approval work may authorize a new
action, but it may not fabricate the lost output or retroactively write
`NodeSucceeded`.

If all node outcomes are already durably committed and only terminal-result
protection/publication fails, no executor is rerun. The runtime retries only
the deterministic terminal projection/protection from authenticated committed
node outcomes, using a fresh occurrence as required. Until its terminal event
commits, terminal resume cannot claim or return success.

In the conformance corpus, write counters for an injected failure count writes
**after the injection point**. Pre-existing `RunCreated`, `NodeScheduled`, and
`NodeStarted` evidence is not included. Thus zero expected event writes after a
post-executor failure means no false outcome was appended; it does not mean the
executor ran without commit-before-start evidence.

The portable failure matrix is closed. Before executor start, each of
`snapshot`, `classification`, `policy`, `encode`, `mac`, `protect`,
`atomic-publish`, `receipt`, `scan`, `canonicalize`, `sink-write`, and
`compare-and-swap` failure produces zero raw/sink writes and zero executor
calls. After executor success, each of `encode`, `mac`, `protect`,
`atomic-publish`, `receipt`, `scan`, `canonicalize`, `sink-write`, and
`compare-and-swap` produces zero raw/sink outcome writes and no dependent
release; `none` is `safe-new-attempt`, while `idempotent`, `non-idempotent`,
and `unspecified` are `in-doubt-effect`. These 12 pre-executor plus 9×4
post-executor combinations are the corpus's exact 48-case declarative matrix.

| Code | Required trigger | Observable rule |
| --- | --- | --- |
| `REDACTION_POLICY_REQUIRED` | No capture policy can be resolved | no sink write; no executor |
| `REDACTION_POLICY_INVALID` | Unknown version/mode, malformed rule, unsafe bound, or inconsistent disposition | no sink write; no executor |
| `CAPTURE_POLICY_MISMATCH` | Resume policy hash differs from `RunCreated` | no append; no executor |
| `INLINE_CAPTURE_NOT_AUTHORIZED` | Inline mode lacks explicit authorization or deployment policy denies it | no sink write |
| `PAYLOAD_PROTECTION_REQUIRED` | Authoritative persistence lacks compatible store or key authority | no sink write; no executor |
| `PAYLOAD_PROTECTION_FAILED` | Snapshot/validate/encode/MAC/encrypt/blob publish/guarded authoritative sink publication fails | no event/checkpoint ref is committed; Section 10.1 applies after executor return |
| `PROTECTED_PAYLOAD_NOT_FOUND` | A referenced blob is missing | no executor; no null substitution |
| `PROTECTED_PAYLOAD_UNAUTHORIZED` | Store or key authority denies access | no executor; no sensitive details |
| `PROTECTED_PAYLOAD_CORRUPT` | Ciphertext hash, AEAD, codec, AAD, decode, or value MAC fails | no executor; preserve evidence |
| `REDACTION_RECEIPT_INVALID` | A claimed transform/receipt does not reproduce the candidate | reject before write or as corrupt history |
| `LEGACY_REDACTION_MISMATCH` | Known inline legacy shape claims/defaults to redacted | no resume/executor; quarantine path |
| `SECRET_CANARY_DETECTED` | Pre-sink scanner finds a seeded/credential pattern in a denied representation | reject write; report only canary ID and sink |

TypeScript and Python class names and prose may differ. Code, phase,
redacted-safe detail keys, and no-write/no-executor behavior are portable.
Failure details may contain stable run/node/attempt/sink identifiers, expected
contract versions, and safe digests. They MUST NOT contain offending bytes,
keys, plaintext, raw exception/provider messages, AAD containing unapproved
text, or the detected canary value.

Existing persistence corruption and compare-and-swap behavior remain intact.
Protection errors do not turn a stale CAS into a successful append, and
protection never weakens commit-before-release.

For an existing stream, identifier and persisted-byte/envelope corruption rules
from `persistence-semantics.md` run first. After a valid envelope is available,
a known misleading v1alpha1 shape returns `LEGACY_REDACTION_MISMATCH` before
policy or protection recovery. For a fresh v1alpha2 start, policy
required/validity checks precede store/key availability and protection work.
This precedence is portable and prevents one runtime from invoking an executor
while the other rejects the same history earlier.

## 11. Portable limits

These are hard v1alpha2 maxima; deployments may configure smaller bounds and
bind them into policy:

| Item | Maximum |
| --- | ---: |
| Effective capture-policy canonical UTF-8 bytes | 65,536 |
| Canonical Tagged Durable JSON bytes per protected value | 67,108,864 |
| Canonical transformed result UTF-8 bytes | 67,108,864 |
| Value depth (root is depth 0) | 128 |
| Total JSON value nodes, including each container and primitive | 1,000,000 |
| Total array plus object containers | 100,000 |
| Total object members across the value | 1,000,000 |
| Protected refs in one event or checkpoint projection | 1,024 |
| UTF-8 bytes in `ref` | 128 |
| UTF-8 bytes in an AAD `fieldPath` | 1,024 |
| Redaction rules in one policy | 54; at most one per sink |
| Paths in one rule or receipt | 1,024 |
| Decoded reference tokens in one pointer | 128 |
| UTF-8 bytes in one redaction path | 1,024 |
| UTF-8 bytes in one decoded reference token | 256 |
| Default and maximum persisted sanitized diagnostic bytes | 1,024 |

Byte bounds are measured after UTF-8 encoding, before a sink write. Over-limit
policy/receipt values are `REDACTION_POLICY_INVALID`; over-limit authoritative
values are `PAYLOAD_PROTECTION_FAILED` unless a future versioned artifact
contract explicitly replaces them. Implementations must reject before
unbounded allocation where the underlying API exposes a declared length.

The counters are semantic and cross-language. The root is one value node at
depth 0. Every array/object is both one value node and one container; every
primitive is one value node; every object entry increments the object-member
counter once. An empty decoded pointer token counts as one token. Every ref
occurrence counts toward the aggregate even if the serialized ref string is
repeated. `checkpoint-v1alpha2.protectedRefCount` MUST equal an iterative walk
of all reference-bearing fields and cannot exceed 1,024.

Implementations use explicit iterative stacks/queues with counters and may
reject earlier from a declared-length check. After valid JSON and portable
string normalization, resource-limit failure precedes pointer target/overlap
checks, transformation, hashing, encryption, or write. A hostile value never
causes recursive host-stack traversal, getter/proxy/custom-mapping execution,
partial mutation, partial receipt, or partial sink bytes. Existing persisted
over-limit protected records are `PROTECTED_PAYLOAD_CORRUPT`; an over-limit
observational transform/receipt is `REDACTION_RECEIPT_INVALID`.

Protected blob overhead, batch cardinality, storage quota, retention, and
concurrent crypto operations also require finite implementation limits. They
may be lower and provider-specific, but cannot silently truncate a logical
value or diagnostic to make recovery appear successful.

The fixed diagnostic bound is a maximum, not permission to persist arbitrary
exception prefixes. Default messages still come from safe templates.

## 12. Conformance and release evidence

Portable fixtures must cover:

- exact equality/order of the 57-source and 54-sink inventories, one source
  classification per source, one policy row per sink, the total 3,078-pair
  evaluator domain, and unknown source/sink/control denial;
- every disposition/redacted truth-table row and conditional receipt field;
- closed policy/ref/blob/AAD/receipt validation and unknown fields;
- fixed test key/nonce vectors for policy hash, key-ref hash, value MAC, AAD
  hash, ciphertext hash, payload hash, and activity key;
- Unicode, finite floats, negative zero normalization, null, nested
  arrays/objects, and low-entropy secrets;
- success, retry, timeout, cancellation, failure, crash/resume, and terminal
  resume;
- missing/denied/corrupt refs with zero executor calls;
- checkpoints containing only metadata/refs in temporary and final bytes;
- misleading-true, absent/defaulted, and truthful-inline legacy histories;
- the declarative 30-cell legacy field×shape×terminal matrix and 48-cell
  failure-point×side-effect matrix;
- positive/hostile semantic pairs for every rule carried by
  `semanticCases`, including all nineteen independently identified joins,
  occurrence/key/authority/tenant binding, bound receipts/registry atomicity,
  prototype rejection, side-effect normalization, and every resource bound;
- quarantine, sealed-archive manifest, and new-run behavior; and
- sink scanner negative and clean controls.

`semanticCases` is a durable executable descriptor format, not prose. Pair IDs
are globally unique and each pair has exactly one `positive` and one `hostile`
case for the same rule. The semantic oracle resolves `baseSection` and
`baseCaseId`, applies the named closed mutation operator, and compares validity,
stable code, raw/sink writes, executor calls, and dependent releases. A missing
base, unknown operator, duplicate global case ID, duplicate/missing polarity,
or source/sink coverage mismatch fails the corpus itself. Schema acceptance of
a cross-object hostile document is expected; the semantic oracle must reject
it according to the checked-in case rather than silently treating Ajv as the
semantic validator.

Array-backed bases resolve their exact globally unique `id`. The two singleton
bases use reserved IDs: `resourceLimits` resolves only
`redaction-resource-limits`, and `corpus` resolves only `redaction-corpus`.

Production nonce randomness is not compared byte-for-byte. Exact ciphertext
parity is limited to a clearly marked deterministic test provider. Normal
conformance compares semantics, hashes/MACs that should be stable, failure
codes, and no-write/no-executor behavior.

Candidate acceptance requires clean installed npm packages and Python
wheel/sdist packages. Seed distinct synthetic canaries into graph input, mock
prompt/input, executor output, thrown error, mock tool response, protected
value/artifact source, and support/log metadata. Scan event/checkpoint
temporary and final files, protected blobs, stdout, stderr, logs, traces/network
bytes, serialized errors, CLI/MCP diagnostics, Explorer/API caches, support
archives, migration manifests, and release evidence.

The scanner checks literal UTF-8 and obvious JSON, URL, base64, hexadecimal,
UTF-16 LE/BE, and compressed-member forms. It includes:

- an intentionally unsafe positive control that must fail;
- a clean control that must pass;
- a transformed-secret case documenting literal-scanner limits;
- exact candidate/package digests and scanner configuration; and
- implementer-independent review of raw machine reports.

A test count, source-only scan, in-memory fake, or `redacted` boolean alone does
not close D9. One immutable revision must pass shared conformance, focused
native tests, full workspace gates, package-content/install checks, the complete
canary matrix, and independent R3 security review.

### 12.1 Mandatory security join

The delivery dependency is a security boundary, not project-management
advice:

```text
D9-REDACTION-039 (this canonical contract)
  -> D9-TS-REDACTION-087
  -> D9-PY-REDACTION-088
  -> D9-REDACTION-CONFORMANCE-089 (shared parity + packaged canary + R3 review)

D9-REDACTION-CONFORMANCE-089 + D9-APPROVAL-077
  -> D9-DURABLE-EXT-SPEC-031
```

The two native lanes independently implement the same immutable contract and
fixtures; one implementation's unit tests cannot stand in for the other. The
089 join owns cross-language wire/migration/identity parity, scans bytes from
every sink class, binds reports to candidate/package digests, and requires an
independent security disposition. The durable extension MUST NOT expand the
event/checkpoint surface before both 089 and the approval contract are
accepted. Contract-author validation of these schemas does not mark 087, 088,
089, 031, or D9 complete.

## 13. Non-goals and honest claims

This contract does not:

- retrofit confidentiality into existing v1alpha1 files;
- erase secrets already copied to journals, backups, logs, terminals, provider
  systems, or third-party services;
- hide values from an authorized executor after decryption or from the runtime
  process memory needed to execute;
- make the current local file store authenticated, multi-tenant, symlink-safe,
  or a distributed lease;
- define a production KMS, tenant ACL, backup, retention, legal hold, or key
  escrow service;
- complete the general ArtifactStore, replay/fork API, approval/reconciliation
  system, trace exporter, Explorer, support-bundle, or production worker work;
- detect every transformed, fragmented, inferred, or externally exfiltrated
  secret;
- make an untrusted plugin, provider SDK, custom executor, container, host, or
  kernel safe;
- provide universal exactly-once external effects; or
- permit marketing claims such as “secret-safe,” “encrypted everywhere,”
  “production hardened,” or “D9 complete” without the candidate-bound evidence
  above.

Until implementation and acceptance are complete, operators must keep current
journal/checkpoint directories private, exclude them from galleries and
support bundles, avoid sensitive graph values, and treat every current
`redacted: true` durable event as a known unsafe assertion requiring migration
or quarantine.
