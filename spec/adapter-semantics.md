# Provider and tool adapter capability and conformance semantics v1alpha1

Status: **machine-frozen contract candidate; no adapter is implemented and no
provider integration exists**

Contract family: `adapter-contract/v1alpha1`

This document defines the portable boundary every official Graph Engineering
provider or tool adapter must satisfy: what an adapter declares, what a caller
may ask of it, how a streamed or non-streamed response is normalized, what its
usage means to the budget ledger, what its failures mean to the durable event
history, and what a conforming implementation must refuse.

It is a contract for future TypeScript and Python implementations. Nothing in
this repository implements it. No schema, table, rule identifier, fixture or
status line in this document is evidence that any runtime dispatches to a
provider, and none of the vendor names below denotes a working client.

## 1. Normative machine artifacts

The v1alpha1 contract consists of these D13-owned files:

- [`adapter-capability.schema.json`](adapter-capability.schema.json) — the
  closed capability inventory;
- [`adapter-descriptor.schema.json`](adapter-descriptor.schema.json) — what an
  adapter declares before dispatch;
- [`adapter-usage.schema.json`](adapter-usage.schema.json) — the meters an
  adapter observed for one attempt;
- [`adapter-error.schema.json`](adapter-error.schema.json) — the closed failure
  taxonomy and normalized error envelope;
- [`conformance/adapter.case.json`](conformance/adapter.case.json) — the
  deterministic corpus; and
- [`conformance/adapter.validate.mjs`](conformance/adapter.validate.mjs) — the
  executable oracle, exporting `validateAdapterFixture()`.

The adjacent contracts this one composes with, and does not modify, are
[`budget-semantics.md`](budget-semantics.md),
[`cycle-semantics.md`](cycle-semantics.md) and
[`runtime-capability-semantics.md`](runtime-capability-semantics.md).

## 2. Normative language and processing model

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT and MAY are
normative.

A conforming adapter has four ordered layers:

1. **Declaration.** Publish a descriptor and prove it is internally consistent.
2. **Preflight.** Refuse, before any external effect, every request the
   descriptor does not authorize.
3. **Dispatch.** Perform at most one external attempt, carrying request and
   idempotency identity.
4. **Normalization.** Convert whatever came back — response, stream, error or
   silence — into exactly one portable outcome.

Shape validity never implies semantic validity. A descriptor that validates
against its schema and violates section 5 is `GE_ADAPTER_DESCRIPTOR_INVALID`,
and no request may be dispatched through it.

## 3. Official v1 adapters

The closed set of official adapter kinds is:

`anthropic`, `google-gemini`, `http`, `mcp`, `mock`, `openai`,
`openai-compatible`, `shell`.

`mock` is the deterministic reference. It is implemented first, it is the only
adapter the candidate gate uses, and every other kind is defined by the same
boundary the mock already satisfies. Breadth of vendor logos is explicitly a
lower priority than semantic consistency, security and useful failure handling.

### 3.1 Agent-harness integrations are documented, not claimed

Claude Code, Codex and generic agent harnesses are documented as *uses* of two
official adapters, never as adapters of their own:

| Integration | Mechanism | Official v1 adapter | Private API claimed |
|---|---|---|---|
| `claude-code` | `shell` | no | no |
| `codex` | `shell` | no | no |
| `generic-agent-harness` | `mcp` | no | no |

A harness reached through `shell` runs under the same explicit executable
identity, argument vector, environment allowlist, stdin policy and output bounds
as any other subprocess. A harness reached through `mcp` is read-only by
default. No private, undocumented or reverse-engineered API is used, referenced
or claimed anywhere in this contract, and none of these three names appears in
the official adapter-kind enum. The oracle asserts all four facts.

## 4. Capability discovery

A capability is a declaration of what an adapter supports at its boundary. The
inventory is closed at sixteen members:

`attachments`, `cached-input-usage-reporting`, `cancellation`,
`content-filter-reporting`, `deterministic-replay`, `fault-injection`,
`idempotency-key`, `parallel-tool-calls`, `provider-request-id`,
`rate-limit-reporting`, `reasoning-usage-reporting`, `retry-after-hint`,
`streaming`, `structured-output`, `tool-calling`, `usage-reporting`.

### 4.1 A missing capability fails before dispatch, never mid-call

If a request requires a capability the descriptor does not declare, the adapter
MUST fail with `GE_ADAPTER_CAPABILITY_UNSUPPORTED` before performing any
external effect. This mirrors
[`runtime-capability-semantics.md`](runtime-capability-semantics.md): capability
refusal is a preflight fact, so the call performs zero provider requests, zero
usage and zero ledger writes, and a caller cannot reach an undeclared capability
by any request shape.

Missing capabilities are reported in Unicode code-point order and the first is
named in the message. The exact message is:

```text
Adapter capability '<capability>' required by request '<requestId>' is not declared by adapter '<adapterId>'
```

Requiring a capability is both explicit (`requiredCapabilities`) and implied by
the request: streaming implies `streaming`, structured output implies
`structured-output`, tool definitions imply `tool-calling`, attachments imply
`attachments`, a cancellable call implies `cancellation`, and an idempotency key
implies `idempotency-key`. Rules `P-001` through `P-006` and `P-029` are
distinct so that deleting any one of them is observable.

### 4.2 Capabilities constrain the descriptor itself

Capabilities are not free-standing labels. `cached-input-usage-reporting` and
`reasoning-usage-reporting` require `usage-reporting`; `parallel-tool-calls`
requires `tool-calling`; `retry-after-hint` requires `rate-limit-reporting`;
`deterministic-replay` and `fault-injection` require
`evidenceClass: "deterministic-mock"`, which is what stops a real provider from
claiming determinism it cannot deliver. Bounds must agree with capabilities: an
adapter without `tool-calling` bounds tool definitions and tool calls at zero,
and an adapter without `attachments` bounds attachments at zero.

## 5. Descriptor obligations

The complete set of descriptor rules is in the rule register of section 12. The
obligations worth stating in prose are the boundary ones.

### 5.1 HTTP and model adapters

A network profile MUST declare an allowlisted scheme, host and port set, DNS and
IP rebinding defense, credential isolation and a TLS floor. Redirects are
refused unless both `allowRedirects` and `redirectReauthorization` are true, and
a redirect target is re-authorized against the same allowlist as the original.
Plaintext `http` may be allowlisted only for non-routable hosts (`localhost` and
the RFC 2606 / RFC 6761 `.invalid` and `.test` names). A redirect may never
downgrade the transport to plaintext.

### 5.2 Shell and subprocess adapters

A process profile MUST declare an explicit executable identity, an argument
vector whose first member is that executable, a working directory, an
environment allowlist, an stdin policy, and duration, output, process and memory
limits. `shellExpansion` is `false` by construction: there is no implicit shell
and the argument vector is executed directly. A call MUST carry the declared
argument vector as an exact prefix, MUST name only allowlisted environment
variables, MUST respect the stdin policy, and MUST NOT contain a NUL byte in any
argument.

### 5.3 Cancellation and isolation

An adapter that accepts cancellable work declares `cancellation` and a cancel
signal. Cancellation is a caller fact: see section 8.3.

### 5.4 MCP adapters

An MCP adapter is read-only by default. `mode: "mutating"` additionally requires
approval, an idempotency gate and an exact non-empty tool allowlist. A read-only
MCP adapter MUST NOT declare `non-idempotent` side effects. Tool descriptions
and model-generated arguments never grant authority: a tool call outside the
server allowlist is `GE_ADAPTER_TOOL_VALIDATION_FAILED`, whatever the tool
description says.

### 5.5 Capture

`capture.enabled` and a non-`none` retention disposition must agree. Capture is
opt-in; there is no implicit retention.

## 6. Structured output, streaming and tool calls

Structured output, streaming, tool calling and usage reporting share one
conformance surface: each is a declared capability, each is preflighted, and
each is normalized into the same outcome vocabulary.

### 6.1 Stream frames

A stream is a sequence of frames drawn from `start`, `text-delta`, `tool-call`,
`usage`, `finish`. It MUST open with exactly one `start`, number frames from
zero increasing by exactly one, carry at most one `usage` frame, and close with
exactly one `finish` after which no frame may arrive. Duplicate frames, gapped
frames and late frames are all `GE_ADAPTER_MALFORMED_RESPONSE` through the
sequence rule, and so are oversized frames, oversized accumulated text and
excess tool calls.

An oversized *response* is deliberately not `GE_ADAPTER_BOUNDS_EXCEEDED`. Bounds
violations that the adapter detects in its own request are pre-dispatch; a
provider that exceeds the declared response bound has already performed work, so
the outcome is `GE_ADAPTER_MALFORMED_RESPONSE`, which is a dispatch code with a
conservative usage disposition.

### 6.2 Provider disconnect

A stream that ends without a `finish` frame is `GE_ADAPTER_TRANSPORT_FAILURE`,
not a malformed protocol. The provider may have completed the work and lost the
connection, so the effect is in doubt.

### 6.3 Finish reasons

The closed set is `cancelled`, `content-filter`, `max-output`, `stop`,
`tool-calls`. `finishReason: "cancelled"` is never producible by a provider —
cancellation is a caller fact, so a provider that sends it is malformed.
`finishReason: "tool-calls"` requires at least one tool call, and
`finishReason: "content-filter"` requires `content-filter-reporting`.

A completed response with `finishReason: "content-filter"` is a *success* with
partial content. `GE_ADAPTER_CONTENT_FILTERED` is the different case: the
provider processed the request and returned no usable content at all.

### 6.4 Tool-call validation before execution

Every model-emitted tool call is validated before the tool runs: the name must
be one the caller declared, arguments must satisfy the declared required and
allowed argument sets, identifiers must be unique, the count must be within
bounds, and the tool must be authorized by policy. Authority comes from policy
and never from the model or from a tool description.

## 7. Usage and the budget contract

This section is the composition point with
[`budget-semantics.md`](budget-semantics.md), and the oracle enforces it by
reading that document and `budget-vector.schema.json` on every run rather than
by restating their contents.

### 7.1 An adapter reports meters, never money

An `AdapterUsage` envelope has no `currency`, no `minorUnitExponent` and no
`money-nano-minor` entry. Money is produced only by applying an immutable
pricing snapshot to these meters, under the rounding rule of
budget-semantics 7.3. An adapter that reports a cost would bypass the snapshot
and silently become a pricing authority; the schema makes that unrepresentable
and rule `U-005` makes it a normalization failure.

### 7.2 The reportable meters

| Adapter meter | Unit | Aggregation |
|---|---|---|
| `audio-units` | `usage-unit` | `sum` |
| `cached-input-units` | `usage-unit` | `sum` |
| `image-units` | `usage-unit` | `sum` |
| `input-units` | `usage-unit` | `sum` |
| `output-units` | `usage-unit` | `sum` |
| `provider-calls` | `count` | `sum` |
| `reasoning-units` | `usage-unit` | `sum` |
| `tool-calls` | `count` | `sum` |
| `transport-bytes` | `byte` | `sum` |

Every one of these is a resource of `budget-vector.schema.json` and carries
exactly the unit and aggregation given by the budget-semantics 4.1 table. Every
one is `sum`-aggregated, because budget-semantics 4.4 makes durable reservation
vectors contain only `sum` entries and makes `maximum` resources monotonic gates
that are never spendable credit. The sixteen remaining budget resources —
including `money-nano-minor` and every `maximum` resource such as `elapsed-ms`,
`in-flight-bytes`, `memory-bytes`, `depth` and `fan-out` — are deliberately not
adapter-reportable. This is why an adapter cannot report wall-clock time as
usage, which is also what keeps the corpus free of clock dependence.

A zero meter is represented by absence, matching budget-semantics 3.2's single
canonical zero. Provider-specific meters go in `providerSpecific`, must be in
the descriptor allowlist, and that allowlist must be a subset of the active
budget policy's `allowedProviderMetrics`. An adapter narrows the policy and can
never widen it; an unlisted metric is never silently bucketed.

### 7.3 Trust maps onto the public cost states

| Adapter trust | Budget public cost state |
|---|---|
| `provider-reported` | `provider-reported` |
| `adapter-conservative` | `estimated` |
| `unknown` | `unknown` |

These are three of the seven public cost states budget-semantics 7.5 requires be
kept distinct. An adapter can produce only these three: it can never assert
`reserved`, `reconciled`, `disputed` or `economically compensated`, because
those are ledger facts and not observations at the provider boundary. The oracle
recomputes the mapping and checks each target against the parsed 7.5 list.

An adapter that does not declare `usage-reporting` MUST report
`trust: "unknown"` and MUST NOT report any usage-unit meter. It still reports
`provider-calls`, because a dispatch-boundary envelope always records at least
one provider call.

### 7.4 Settlement

Each taxonomy row names the ledger action its usage disposition requires.
`release-reservation` is permitted only where the adapter can assert zero
external usage; everywhere else the caller MUST commit conservatively. This is
budget-semantics 6.10 step 6 — "release only capacity proven unused" — expressed
as a property of the code.

**No conflict was found between this contract and the frozen budget contract.**
The unit vocabulary, the aggregation semantics, the canonical zero, the
provider-metric allowlist discipline and the public cost states all compose
without contradiction, and each is checked mechanically rather than asserted.

## 8. Failure taxonomy

### 8.1 Retryability is a property of the code

#### Closed adapter failure taxonomy

| Code | Boundary | Retryable | External effect | Usage | Ledger action | Meaning |
|---|---|---|---|---|---|---|
| `GE_ADAPTER_AUTHENTICATION` | dispatch | no | not-applied | none | release-reservation | the provider refused the credential before performing work |
| `GE_ADAPTER_BOUNDS_EXCEEDED` | pre-dispatch | no | not-applied | none | release-reservation | the request violated a declared bound and was never dispatched |
| `GE_ADAPTER_CANCELLED` | dispatch | no | in-doubt | conservative | commit-conservative | the caller cancelled a call that had already crossed the dispatch boundary |
| `GE_ADAPTER_CAPABILITY_UNSUPPORTED` | pre-dispatch | no | not-applied | none | release-reservation | the request required a capability the adapter does not declare |
| `GE_ADAPTER_CONTENT_FILTERED` | dispatch | no | applied | conservative | commit-conservative | the provider processed the request and refused to return content |
| `GE_ADAPTER_DESCRIPTOR_INVALID` | pre-dispatch | no | not-applied | none | release-reservation | the adapter descriptor is not a valid declaration |
| `GE_ADAPTER_INVALID_REQUEST` | dispatch | no | not-applied | none | release-reservation | the provider rejected the request as malformed |
| `GE_ADAPTER_MALFORMED_RESPONSE` | dispatch | yes | applied | conservative | commit-conservative | the provider returned a response this contract cannot normalize |
| `GE_ADAPTER_POLICY_DENIED` | pre-dispatch | no | not-applied | none | release-reservation | a boundary policy refused the call before any external effect |
| `GE_ADAPTER_QUOTA_EXCEEDED` | dispatch | no | not-applied | none | release-reservation | the account has no remaining provider quota |
| `GE_ADAPTER_RATE_LIMITED` | dispatch | yes | not-applied | none | release-reservation | the provider refused the call and asked for backoff |
| `GE_ADAPTER_TIMEOUT` | dispatch | yes | in-doubt | conservative | commit-conservative | no trusted response arrived within the declared bound |
| `GE_ADAPTER_TOOL_VALIDATION_FAILED` | pre-dispatch | no | not-applied | none | release-reservation | a tool declaration or model-emitted tool call failed validation |
| `GE_ADAPTER_TRANSPORT_FAILURE` | dispatch | yes | in-doubt | conservative | commit-conservative | the transport failed after the request may have been delivered |

Nine codes describe an attempt at the external boundary. Five —
`GE_ADAPTER_BOUNDS_EXCEEDED`, `GE_ADAPTER_CAPABILITY_UNSUPPORTED`,
`GE_ADAPTER_DESCRIPTOR_INVALID`, `GE_ADAPTER_POLICY_DENIED`,
`GE_ADAPTER_TOOL_VALIDATION_FAILED` — are pre-dispatch refusals, and every one
of them is non-retryable with a provably absent external effect.

No implementation may read a message string, an HTTP status text or a provider
payload to decide whether to retry. Exactly four codes are retryable. The usage
disposition and the ledger action are *derived*, not declared:

```text
usageDisposition = effectDisposition == "not-applied" ? "none" : "conservative"
ledgerAction     = usageDisposition == "none" ? "release-reservation" : "commit-conservative"
```

The oracle recomputes both for every row and compares the result against the
corpus and against the table printed above, so a table that describes a rule the
oracle does not apply fails the gate.

`GE_ADAPTER_POLICY_DENIED` carries a closed `denialReason` — one of
`capability-approval`, `circuit-open`, `egress-not-allowlisted`,
`environment-not-allowlisted`, `executable-not-authorized`,
`idempotency-key-missing`, `mcp-mutation-not-approved`,
`mcp-tool-not-allowlisted`, `redirect-not-reauthorized`, `stdin-policy`,
`tls-policy` — so the code stays portable while the reason stays diagnostic. No
other code carries one.

### 8.2 At-least-once external effects and the cycle contract

External providers are at-least-once unless their own protocol offers something
stronger. A call that may have succeeded is `in-doubt`, never "failed".

This composes with [`cycle-semantics.md`](cycle-semantics.md) 13.4, whose
side-effect vocabulary — `none`, `idempotent`, `non-idempotent` — this contract
adopts unchanged. The oracle asserts the adapter enum equals
`cycle-controller.schema.json#/$defs/activity/properties/sideEffects` exactly,
so the two contracts cannot drift apart.

#### In-doubt composition matrix

| External effect | Side-effect class | Records an in-doubt identity | Retry permitted by class |
|---|---|---|---|
| `applied` | `none` | no | yes |
| `applied` | `idempotent` | no | yes |
| `applied` | `non-idempotent` | no | no |
| `in-doubt` | `none` | no | yes |
| `in-doubt` | `idempotent` | yes | yes |
| `in-doubt` | `non-idempotent` | yes | no |
| `not-applied` | `none` | no | yes |
| `not-applied` | `idempotent` | no | yes |
| `not-applied` | `non-idempotent` | no | yes |

Two rules, both recomputed by the oracle rather than read:

1. An in-doubt outcome records a durable in-doubt identity only for an external
   side-effect class. cycle-semantics 13.4 states this directly: "`none` creates
   no in-doubt evidence, while an external `idempotent` or `non-idempotent`
   claim retains one in-doubt identity."
2. A `non-idempotent` call is retried only when the effect provably did not
   occur. cycle-semantics 13.4 states this as "`none` and `idempotent` may retry
   with the same stable activity key; `non-idempotent` stops after its first
   ambiguous timeout". "Ambiguous" is exactly `effectDisposition != "not-applied"`,
   so a `non-idempotent` call refused by a rate limit — which never reached the
   provider's work — may still be retried, while the same call timing out may
   not.

The adapter never writes the durable event. It reports the outcome; the cycle
controller decides what to append. In particular, an adapter reporting
`GE_ADAPTER_CANCELLED` does not cause an `ActivityFailed`, because
cycle-semantics 13.4 states that "cancellation is a controller fact and MUST NOT
append `ActivityFailed`".

**No conflict was found between this contract and the frozen cycle contract.**
The vocabularies are identical by construction and both composition rules are
transcriptions of cycle-semantics 13.4, checked mechanically.

### 8.3 Cancellation

`GE_ADAPTER_CANCELLED` is produced only for a call that had already crossed the
dispatch boundary; that is why it is a dispatch code with an `in-doubt` effect.
A cancellation that arrives before dispatch produces no adapter error at all —
nothing was sent, so there is nothing to normalize — which is the same
linearization cycle-semantics 13.3 gives for a caller cancellation before
`ActivityStarted`.

### 8.4 Rate limits, retry and the circuit breaker

Backoff is integer arithmetic with no jitter, because
[`runtime-capability-semantics.md`](runtime-capability-semantics.md) admits
retry without jitter only and a jittered schedule is not reproducible across two
runtimes:

```text
computed(n)  = min(maxBackoffMs, floor(initialBackoffMs * multiplierMilli^(n-1) / 1000^(n-1)))
effective(n) = retryAfterMs == null ? computed(n) : max(computed(n), retryAfterMs)
```

A provider hint above the local ceiling abandons the attempt rather than
truncating it. Truncating would re-dispatch inside exactly the window the
provider refused, which is the failure mode a retry-after header exists to
prevent.

The circuit breaker is a three-state machine driven by an injected clock:
`closed` opens after `consecutiveFailureThreshold` consecutive *retryable
dispatch* failures; `open` admits nothing and half-opens only once
`openDurationMs` has elapsed on that clock; `half-open` admits exactly one probe
and closes on success or reopens on failure. Pre-dispatch refusals and
non-retryable dispatch codes never move the breaker — a malformed request is the
caller's fault, not the provider's health.

An open circuit refuses with `GE_ADAPTER_POLICY_DENIED` and reason
`circuit-open`, which keeps the taxonomy closed while preserving the
distinction.

### 8.5 Errors carry no secrets

An error message is operator-facing and never load-bearing. `message` and every
provider-safe detail field MUST NOT carry credentials, prompts or unredacted
provider payloads. Detail field names are unique and ordered. Redaction at the
request, response, log, trace and support sinks is owned by
[`redaction-semantics.md`](redaction-semantics.md); this contract adds only the
boundary obligation that the normalized envelope is a redaction sink like any
other.

## 9. Conformance

### 9.1 The mock is the gate

Normal conformance runs entirely against the deterministic mock. The corpus
performs no network access, requires no credential and reads no clock; the only
time it contains is the injected `nowMs` of the circuit-breaker scripts. Every
host named anywhere in the corpus is `localhost` or an RFC 2606 / RFC 6761
`.invalid` or `.test` name, so it could not resolve even if an implementation
tried, and the oracle asserts that, asserts the corpus contains no absolute URL,
and scans it for credential-shaped material.

### 9.2 Live-provider evidence is separate and cannot substitute

`evidenceClass: "live-provider"` marks an adapter whose evidence needs a real
account. Such evidence is opt-in, quarantined, budget-limited, secret-safe and
non-release-blocking, and it is retained separately from the deterministic
candidate gate. It can never replace mock conformance. The oracle asserts that
no descriptor in the shipped corpus is `live-provider`.

### 9.3 Corpus contents

The checked corpus contains:

- four D13 schemas under strict Draft 2020-12 meta-validation and Ajv
  compilation;
- twelve adapter descriptors covering all eight official kinds and all three
  side-effect classes;
- thirty-five descriptor cases;
- thirty-one preflight cases;
- twenty-one stream cases;
- twenty-one usage cases;
- eight tool-validation cases;
- twenty-nine normalized-error cases, of which fourteen are one positive per
  taxonomy code;
- thirteen retry-decision cases and seven circuit-breaker fold cases; and
- twenty-four schema-negative mutations.

Deleting a section fails the gate rather than shrinking it silently: the corpus
publishes `declaredCounts`, the oracle recomputes every count from the sections
actually shipped, and every section is asserted non-empty.

### 9.4 Coverage is a hard failure

The oracle fails, rather than warns, when any of the following is not covered:

- every one of the sixteen capabilities is declared by at least one descriptor
  **and** named by at least one case;
- every one of the eight adapter kinds has a descriptor;
- every one of the fourteen error codes is produced by at least one case;
- every one of the eleven denial reasons is produced by at least one case;
- every one of the five finish reasons is exercised;
- every one of the nine reportable meters is exercised; and
- every rule in the register of section 12 is exercised by at least one vector.

The oracle also fails if it produces a rule the register does not contain.

### 9.5 Mutation adequacy

A corpus that only re-derives one golden run is not evidence. The binding
obligation is stated as a mutation criterion:

> For every rejection rule the oracle implements, at least one vector must exist
> that isolates it — neutralizing that rule in the oracle must make the shipped
> corpus fail.

Two design consequences follow.

First, **every rejection carries a stable rule identifier as well as a portable
code**, and the corpus asserts both. Fourteen codes cannot distinguish 131
rules, so a code-only assertion would leave most rules shadowed by a neighbour
reporting the same code — the exact defect the D4 contract review found. The
rule identifier is therefore normative: an implementation SHOULD report it as
the `rule` provider-safe detail field. It is a diagnostic fact, never an
authorization fact.

Second, some rules are implemented as table rows rather than as distinct source
statements — capability implications, mock-only capabilities and
capability-gated meters. Neutralization must therefore delete table rows as well
as guard statements, or those rules would appear untested. The measurement in
section 12.1 does both.

## 10. Security requirements

- Deny by default. An adapter performs no egress, no subprocess and no mutation
  that its descriptor does not name.
- A planner or model cannot expand adapter authority: a request may never
  escalate beyond the side-effect class the descriptor authorizes, and a model
  selecting a tool does not authorize it.
- Credentials are host-isolated, never logged and never placed in an error.
- Every external byte is bounded in both directions.
- The MCP default posture is read-only; mutation requires the exact server and
  tool, schema, capability, policy, approval, budget, timeout, output, redaction
  and idempotency gates.
- Shell adapters have no implicit shell, no argument-string interpolation and no
  ambient environment.

## 11. Versioning

`adapter-contract/v1alpha1` is frozen by the artifacts in section 1. A change to
the capability inventory, the error taxonomy, the denial-reason set, the
reportable meter set, the finish-reason set, a derivation rule, or the meaning
of any rule identifier is a new contract version, not an edit. Adding a rule
identifier for a newly isolated obligation, or narrowing a bound within an
existing rule, is a compatible refinement provided the register, the corpus and
the oracle move together.

## 12. Rule register

Every rule the oracle implements appears here exactly once. The register, the
corpus and the oracle are compared on every run and all three must agree.

A rule has one of two kinds. A **rejection** rule (families `D`, `E`, `P`, `S`,
`T`, `U`) refuses a document or a call and reports a portable code; the corpus
asserts both the code and the rule. A **decision** rule (families `C`, `R`)
chooses a next step — a backoff, a retry, a breaker transition — and reports no
code at all; it is asserted through a recomputed projection instead. Recording
a decision rule with a portable code would misdescribe the contract, so the
oracle refuses a register that does so.

#### Rule register

| Rule | Kind | Code | Denial reason | Obligation |
|---|---|---|---|---|
| `C-001` | decision | none | none | consecutive retryable dispatch failures open the circuit |
| `C-002` | decision | none | none | a success resets the consecutive failure counter |
| `C-003` | decision | none | none | an open circuit half-opens only after the injected-clock window |
| `C-004` | decision | none | none | an open circuit admits no dispatch |
| `C-005` | decision | none | none | a half-open success closes the circuit |
| `C-006` | decision | none | none | a half-open failure reopens the circuit |
| `C-007` | decision | none | none | pre-dispatch and non-retryable failures do not move the circuit |
| `D-001` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | capabilities are ordered by Unicode code point |
| `D-002` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a deterministic-mock adapter allowlists no routable host |
| `D-003` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a mock adapter declares no network, process or MCP profile |
| `D-004` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | an http adapter declares exactly one network profile |
| `D-005` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a shell adapter declares exactly one process profile |
| `D-006` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | an mcp adapter declares exactly one MCP profile |
| `D-007` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a model adapter declares exactly one network profile |
| `D-008` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | an idempotent adapter declares idempotency-key |
| `D-009` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | cached-input-usage-reporting requires usage-reporting |
| `D-010` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | reasoning-usage-reporting requires usage-reporting |
| `D-011` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | parallel-tool-calls requires tool-calling |
| `D-012` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | retry-after-hint requires rate-limit-reporting |
| `D-013` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | deterministic-replay requires deterministic-mock evidence |
| `D-014` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | fault-injection requires deterministic-mock evidence |
| `D-015` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | maxBackoffMs is not below initialBackoffMs |
| `D-016` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | capture.enabled agrees with a non-none retention disposition |
| `D-017` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a network adapter declares DNS and IP rebinding defense |
| `D-018` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a network adapter isolates headers and credentials |
| `D-019` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | redirects require redirect re-authorization |
| `D-020` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | plaintext http is allowlisted only for non-routable hosts |
| `D-021` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | schemes, hosts and ports are canonically ordered |
| `D-022` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | argumentVector[0] is the explicit executable identity |
| `D-023` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | environmentAllowlist is canonically ordered |
| `D-024` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a mutating MCP adapter requires approval |
| `D-025` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a mutating MCP adapter requires an idempotency gate |
| `D-026` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a mutating MCP adapter names its exact tools |
| `D-027` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a read-only MCP adapter is not non-idempotent |
| `D-028` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | allowedProviderMetrics are unique and canonically ordered |
| `D-029` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | allowedProviderMetrics are a subset of the budget policy allowlist |
| `D-030` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | a streaming adapter admits at least a start and a finish frame |
| `D-031` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | tool bounds are zero without tool-calling |
| `D-032` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | attachment bounds are zero without attachments |
| `D-033` | rejection | `GE_ADAPTER_DESCRIPTOR_INVALID` | none | one stream frame cannot exceed the whole response bound |
| `E-001` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | retryability equals the taxonomy row |
| `E-002` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | boundary equals the taxonomy row |
| `E-003` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | effect disposition equals the taxonomy row |
| `E-004` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | usage disposition is derived from the effect disposition |
| `E-005` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a denial reason accompanies only GE_ADAPTER_POLICY_DENIED |
| `E-006` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a pre-dispatch refusal carries no provider request identity |
| `E-007` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a provider request identity requires provider-request-id |
| `E-008` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a backoff hint requires a retryable code |
| `E-009` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a backoff hint requires retry-after-hint |
| `E-010` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a not-applied refusal carries no usage |
| `E-011` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | attached usage binds the same adapter and request |
| `E-012` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | the attempt index is within the declared ceiling |
| `E-013` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | an error cannot escalate the adapter side-effect class |
| `E-014` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | an error carries no credential, prompt or unredacted payload |
| `E-015` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | provider-safe detail names are unique and ordered |
| `P-001` | rejection | `GE_ADAPTER_CAPABILITY_UNSUPPORTED` | none | a required capability must be declared |
| `P-002` | rejection | `GE_ADAPTER_CAPABILITY_UNSUPPORTED` | none | streaming requires the streaming capability |
| `P-003` | rejection | `GE_ADAPTER_CAPABILITY_UNSUPPORTED` | none | structured output requires the structured-output capability |
| `P-004` | rejection | `GE_ADAPTER_CAPABILITY_UNSUPPORTED` | none | tool definitions require the tool-calling capability |
| `P-005` | rejection | `GE_ADAPTER_CAPABILITY_UNSUPPORTED` | none | attachments require the attachments capability |
| `P-006` | rejection | `GE_ADAPTER_CAPABILITY_UNSUPPORTED` | none | cancellation requires the cancellation capability |
| `P-007` | rejection | `GE_ADAPTER_POLICY_DENIED` | `capability-approval` | a request cannot escalate the adapter side-effect class |
| `P-008` | rejection | `GE_ADAPTER_BOUNDS_EXCEEDED` | none | request bytes are bounded |
| `P-009` | rejection | `GE_ADAPTER_BOUNDS_EXCEEDED` | none | attachment count is bounded |
| `P-010` | rejection | `GE_ADAPTER_BOUNDS_EXCEEDED` | none | attachment bytes are bounded per item and in total |
| `P-011` | rejection | `GE_ADAPTER_BOUNDS_EXCEEDED` | none | tool definition count is bounded |
| `P-012` | rejection | `GE_ADAPTER_TOOL_VALIDATION_FAILED` | none | tool definition names are unique |
| `P-013` | rejection | `GE_ADAPTER_POLICY_DENIED` | `circuit-open` | an open circuit admits nothing |
| `P-014` | rejection | `GE_ADAPTER_POLICY_DENIED` | `egress-not-allowlisted` | the target scheme is allowlisted |
| `P-015` | rejection | `GE_ADAPTER_POLICY_DENIED` | `egress-not-allowlisted` | the target host is allowlisted |
| `P-016` | rejection | `GE_ADAPTER_POLICY_DENIED` | `egress-not-allowlisted` | the target port is allowlisted |
| `P-017` | rejection | `GE_ADAPTER_POLICY_DENIED` | `redirect-not-reauthorized` | a redirect target is re-authorized |
| `P-018` | rejection | `GE_ADAPTER_POLICY_DENIED` | `egress-not-allowlisted` | redirects are followed only when declared |
| `P-019` | rejection | `GE_ADAPTER_POLICY_DENIED` | `tls-policy` | a redirect cannot downgrade the transport to plaintext |
| `P-020` | rejection | `GE_ADAPTER_POLICY_DENIED` | `mcp-tool-not-allowlisted` | the MCP tool is allowlisted |
| `P-021` | rejection | `GE_ADAPTER_POLICY_DENIED` | `mcp-mutation-not-approved` | a read-only MCP adapter refuses a mutating call |
| `P-022` | rejection | `GE_ADAPTER_POLICY_DENIED` | `mcp-mutation-not-approved` | a mutating MCP call carries an approval token |
| `P-023` | rejection | `GE_ADAPTER_POLICY_DENIED` | `executable-not-authorized` | the call names the declared executable identity |
| `P-024` | rejection | `GE_ADAPTER_POLICY_DENIED` | `executable-not-authorized` | the declared argument vector is an exact prefix |
| `P-025` | rejection | `GE_ADAPTER_POLICY_DENIED` | `environment-not-allowlisted` | environment variables are allowlisted |
| `P-026` | rejection | `GE_ADAPTER_POLICY_DENIED` | `stdin-policy` | stdin bytes require an explicit stdin policy |
| `P-027` | rejection | `GE_ADAPTER_POLICY_DENIED` | `executable-not-authorized` | an argument vector member carries no NUL byte |
| `P-028` | rejection | `GE_ADAPTER_POLICY_DENIED` | `idempotency-key-missing` | an idempotent request carries a stable idempotency key |
| `P-029` | rejection | `GE_ADAPTER_CAPABILITY_UNSUPPORTED` | none | an idempotency key requires the idempotency-key capability |
| `R-001` | decision | none | none | the integer backoff schedule is recomputed and clamped |
| `R-002` | decision | none | none | a provider backoff hint dominates the computed backoff |
| `R-003` | decision | none | none | a hint above the local ceiling abandons rather than truncates |
| `R-004` | decision | none | none | the attempt ceiling ends retry |
| `R-005` | decision | none | none | a non-retryable code is never retried |
| `R-006` | decision | none | none | a non-idempotent call is not retried while its effect is uncertain |
| `S-001` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a stream opens with a start frame |
| `S-002` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a stream carries exactly one start frame |
| `S-003` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | stream sequence starts at zero |
| `S-004` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | stream sequence increases by exactly one |
| `S-005` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | no frame follows the finish frame |
| `S-006` | rejection | `GE_ADAPTER_TRANSPORT_FAILURE` | none | a stream that never finishes is a transport failure |
| `S-007` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a frame is bounded by maxStreamFrameBytes |
| `S-008` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a stream is bounded by maxStreamFrames |
| `S-009` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a stream carries at most one usage frame |
| `S-010` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a usage frame requires usage-reporting |
| `S-011` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a tool-call frame requires tool-calling |
| `S-012` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | tool-call frames are bounded by maxToolCallsPerResponse |
| `S-013` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | streamed text is bounded by maxResponseBytes |
| `S-014` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | finishReason tool-calls requires a tool call |
| `S-015` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | cancelled is never a provider finish reason |
| `S-016` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a second tool call requires parallel-tool-calls |
| `S-017` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | finishReason content-filter requires content-filter-reporting |
| `T-001` | rejection | `GE_ADAPTER_TOOL_VALIDATION_FAILED` | none | a tool call names a declared tool |
| `T-002` | rejection | `GE_ADAPTER_TOOL_VALIDATION_FAILED` | none | tool call arguments satisfy the declared argument contract |
| `T-003` | rejection | `GE_ADAPTER_TOOL_VALIDATION_FAILED` | none | tool calls are bounded by maxToolCallsPerResponse |
| `T-004` | rejection | `GE_ADAPTER_TOOL_VALIDATION_FAILED` | none | tool call identifiers are unique |
| `T-005` | rejection | `GE_ADAPTER_TOOL_VALIDATION_FAILED` | none | authority comes from policy and never from the model |
| `T-006` | rejection | `GE_ADAPTER_TOOL_VALIDATION_FAILED` | none | a tool description cannot widen the MCP allowlist |
| `U-001` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | usage quantities are ordered by resource |
| `U-002` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | usage resources are unique |
| `U-003` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | each resource carries its fixed unit |
| `U-004` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | an adapter reports only sum-aggregated resources |
| `U-005` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | an adapter reports meters and never money |
| `U-006` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | budgetCostState is derived from trust |
| `U-007` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a dispatch-boundary envelope records at least one provider call |
| `U-008` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | provider-reported trust requires usage-reporting |
| `U-009` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | cached-input-units requires cached-input-usage-reporting |
| `U-010` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | reasoning-units requires reasoning-usage-reporting |
| `U-011` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | image-units and audio-units require attachments |
| `U-012` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | tool-calls requires tool-calling |
| `U-013` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a provider request identity requires provider-request-id |
| `U-014` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | provider metrics are unique and canonically ordered |
| `U-015` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a provider metric is never silently bucketed |
| `U-016` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | usage amounts are positive portable integers |
| `U-017` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | a content-filter finish reason requires content-filter-reporting |
| `U-018` | rejection | `GE_ADAPTER_MALFORMED_RESPONSE` | none | an adapter without usage-reporting reports unknown trust and no usage-unit meter |

### 12.1 Measured guard-neutralization survivability

Two campaigns were run against the shipped corpus. Both numbers are measured,
not asserted.

**Guard neutralization — 126 of 126 held, zero survivors.** The harness
neutralizes exactly one rejection at a time and requires the shipped corpus to
fail. It covers 109 `fail(...)` rejection sites and 17 table-driven rule rows —
the capability implications, the mock-only capabilities, the capability-gated
meters and the implied-capability table inside preflight — because a rule
expressed as a table row cannot be isolated by deleting a source statement.

Two survivors found during this measurement were closed rather than disclosed,
and both are worth recording because each was a real shadowing defect:

- the trust half of `U-018` was shadowed by its own meter half, so a vector now
  exists whose envelope carries no usage-unit meter at all; and
- the `image-units` and `audio-units` rows of the capability-gated meter table
  shadowed each other, so each now has a vector in which only one of the two is
  present.

**Corpus-literal mutation — 1,503 of 1,556 held; 53 survivors, all disclosed.**
Every expected literal the oracle claims to recompute is perturbed in turn and
the run must fail. The 53 survivors are:

- 20 case identifiers. These are labels; the oracle asserts they are canonical
  and globally unique, which catches deletion and duplication but not renaming.
- 6 `retryCases[].attempt` values in cases whose decision short-circuits before
  the attempt ceiling is read (`R-003`, `R-005`, `R-006`). The ceiling itself is
  pinned from below by `retry-third-backoff`.
- 2 `retryCases[].retryAfterMs` values that stay on the same side of a boundary
  already pinned exactly by `retry-hint-at-ceiling`.
- 25 `circuitCases[].script[].nowMs` timestamps at steps that do not read the
  clock. The one timestamp that decides a transition is pinned exactly by
  `circuit-open-at-window-boundary`, where 1019 and 1020 produce different
  projections.

**Document mutation — 8 of 8 held.** Flipping a retryability, an effect
disposition or a ledger action in the taxonomy table, deleting a taxonomy row,
changing a rule's kind, code or denial reason in the register, and deleting a
register row each fail the gate. This is the check that a document cannot
describe a rule the oracle does not apply.

## 13. Implementation boundary and non-claims

This contract is a specification. To be explicit about what does **not** exist:

1. No runtime in this repository implements this contract. There is no
   TypeScript adapter and no Python adapter.
2. No provider integration exists. `openai`, `anthropic`, `google-gemini` and
   `openai-compatible` name intended boundary shapes, not working clients, and
   no request has ever been sent to any of them by this code.
3. The deterministic mock is likewise unimplemented. `mock` is the kind the
   corpus models; the corpus is a fixture, not a running adapter.
4. This corpus is deterministic-mock evidence only. It proves that the contract
   is internally consistent, composes with the frozen budget and cycle
   contracts, and is falsifiable. It proves nothing about any provider.
5. Live-provider evidence is opt-in, separately gated and non-release-blocking.
   Its absence is not a gap in this contract, and its presence could never
   substitute for the deterministic gate.
6. Claude Code, Codex and generic agent-harness integrations are documented
   through published command-line and MCP surfaces only. No private,
   undocumented or reverse-engineered API is claimed.
7. `implementationClaim` in the corpus is the literal boolean `false`, and the
   oracle asserts both its value and its type.

This contract unblocks `D13-TS-ADAPTERS-081`, `D13-PY-ADAPTERS-082` and
`D13-ADAPTERS-049`. It closes none of them.
