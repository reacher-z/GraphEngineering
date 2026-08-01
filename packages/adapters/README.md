# @graph-engineering/adapters

Provider and tool adapters for the frozen
[`adapter-contract/v1alpha1`](../../spec/adapter-semantics.md) boundary.

Three adapters ship here.

| Adapter | Kind | Dispatches | Notes |
|---|---|---|---|
| `createMockAdapter` | `mock` | yes | Deterministic reference. Capability discovery, structured output, streaming, tool calls, usage reporting, cancellation and every dispatch code in the closed taxonomy, all by configuration. |
| `createHttpAdapter` | `http` | yes, through an **injected** transport | No default transport, no fallback to `globalThis.fetch`, no `node:http`. Every redirect hop is re-authorized against the descriptor allowlist. |
| `createShellAdapter` | `shell` | **no** | Declaration, capability set, error taxonomy and argument construction only. Execution refuses — see below. |

There is no OpenAI, Anthropic, Google Gemini or OpenAI-compatible client in this
package. Those kinds name intended boundary shapes in the contract; no request
has ever been sent to any of them by this code.

A mirrored native implementation ships in Python at
`python/src/graph_engineering/adapters/` — the same three adapters, the same
descriptor, preflight, usage, stream, tool, retry and circuit rules, checked
against the same conformance corpus. Neither lane is a client for the other.

## The four layers

adapter-semantics 2 gives a conforming adapter four ordered layers, and this
package implements each once and shares it across every adapter.

1. **Declaration** — `validateDescriptor` (`D-001`..`D-033`) and
   `validateDescriptorAgainstBudgetPolicy` (`D-029`).
2. **Preflight** — `preflight` (`P-001`..`P-029`). A capability a descriptor
   does not declare fails **here**, with `GE_ADAPTER_CAPABILITY_UNSUPPORTED`,
   before any external effect, and cannot be reached by any request shape.
3. **Dispatch** — at most one external attempt per call.
4. **Normalization** — `normalizeStream` (`S-###`), `validateUsage` (`U-###`),
   `validateToolCalls` (`T-###`) and `normalizedAdapterError` /
   `validateErrorEnvelope` (`E-###`).

`retryDecision` (`R-###`) and `CircuitBreaker` (`C-###`) take an **injected
clock**. Nothing in this package reads a wall clock.

## Properties the tests enforce

- **Meters, never money.** `composeUsage` cannot represent a currency, a
  minor-unit exponent or `money-nano-minor`. Money exists only after an
  immutable pricing snapshot is applied to these meters.
- **Retryability is a property of the code.** It is derived from the taxonomy,
  never from a message string, an HTTP status text or a provider payload.
  `normalizedAdapterError` derives `boundary`, `retryable`,
  `effectDisposition` and `usageDisposition` and then proves the envelope
  against `E-001`..`E-015` before returning it.
- **In doubt, not failed.** A call that may have succeeded reports
  `effectDisposition: "in-doubt"`. Exactly the in-doubt × external side-effect
  rows record a durable in-doubt identity, and a `non-idempotent` call is
  retried only when the effect provably did not occur.
- **No host I/O.** `test/no-host-io.test.ts` fails if any file in `src` or
  `test` imports `node:child_process`, `node:http`, `node:net` or any other
  network or process module, or reaches `globalThis.fetch`. The only
  `node:` imports anywhere in the package are `node:fs` and `node:url`, both in
  test scaffolding.

## Why the shell adapter refuses to execute

[`spec/isolation-semantics.md`](../../spec/isolation-semantics.md) §0 states
that no isolation provider, capability policy engine, merge gate or approval
runtime exists in this repository, and that a node executor runs with the
ambient authority of the host process. A working `exec` path would therefore
hand arbitrary command execution to graph-supplied content with nothing between
it and the host.

So `ShellAdapter` implements its descriptor obligations, its capability
declaration, its share of the error taxonomy and its argument-construction
logic — `buildProcessCall` and `planLaunch` authorize a command against
`P-023`..`P-027` without launching anything — and `call` refuses:

```text
code          GE_ADAPTER_POLICY_DENIED
denialReason  capability-approval
detail        blocking-task     = D12-TS-ISOLATION-045
              capability-domain = process
              isolation-code    = GE_ISO_PROVIDER_UNSUPPORTED
              rule              = none
```

`isolation-code` and `capability-domain` are members of
`capability-manifest.schema.json`'s closed vocabulary.
`GE_ADAPTER_CAPABILITY_UNSUPPORTED` is deliberately not used: the closed
sixteen-member capability inventory has no member denoting subprocess
execution, and that code's message format would have to name one. `rule` is
`none` because the rule register names no rule for this refusal and an
implementation may never invent a register identifier.

There is no `node:child_process` import in this package, so there is no code
path to enable — only one to add, once `D12-TS-ISOLATION-045` lands.

## Conformance

`corepack pnpm --filter @graph-engineering/adapters test` executes the literal
corpus in [`spec/conformance/adapter.case.json`](../../spec/conformance/adapter.case.json)
against this implementation: 12 descriptors, 35 descriptor cases, 31 preflight,
21 stream, 21 usage, 8 tool, 29 error, 13 retry, 7 circuit and 24 schema
negatives, plus the closed inventories, the recomputed taxonomy and the
cycle/budget composition matrices. Coverage is a hard failure: every one of the
131 registered rules must be exercised, and producing an unregistered rule
fails the run.

The corpus is the authority. Where this implementation disagreed with a corpus
literal, the implementation was changed.
