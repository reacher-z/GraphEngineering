# Security architecture

Graph Engineering can coordinate models, tools, filesystems, networks, and
external mutations. That makes the orchestration boundary a security boundary:
model output may propose work, but it must never define its own authority.

For vulnerability reporting and supported-version policy, see the repository
[security policy](../SECURITY.md). Do not put vulnerability details in a public
issue.

## Alpha warning

This project is **not production hardened**. Current packages establish Graph IR,
structural compilation, bounded native schedulers, and structured failures. They
do not yet provide a sandbox or a complete security policy engine.

In particular, today:

- a TypeScript `NodeExecutor` runs inside the host Node.js process;
- a Python node handler runs inside the host Python process;
- executor code can inherit the process environment, filesystem, network, and
  subprocess authority;
- Graph IR `resources`, `isolation`, and `sideEffects` fields are descriptive and
  are not capability enforcement;
- timeout and cancellation are cooperative controls, not containment boundaries;
- worktree, process, and container isolation providers are target-v1 work;
- scoped secret injection, payload redaction, human approval, authenticated
  audit policy, and mutating MCP permission enforcement are target-v1 work;
- there is no built-in telemetry exporter in the current runtime, but run results
  contain node inputs and outputs in memory and calling applications may log them.

Do not execute untrusted node code or untrusted tool commands with the alpha
runtime. Run only reviewed executors under an operating-system identity whose
ambient permissions are already acceptable for the job.

## Security objectives

Target v1 is designed to provide:

1. **least authority:** each node receives only the capabilities its job needs;
2. **policy outside judgment:** model output cannot grant or widen permissions;
3. **bounded execution:** fan-out, depth, attempts, time, cost, and dynamic growth
   have hard limits;
4. **failure containment:** one node cannot silently corrupt independent work or
   shared state;
5. **durable accountability:** important decisions and effects have tamper-evident
   identity, ordering, and evidence;
6. **data minimization:** sensitive payload capture is off by default and secrets
   are not graph data;
7. **honest effect semantics:** external mutations are at least once, never
   advertised as universally exactly once;
8. **safe recovery:** a resumed run cannot invisibly change graph revision,
   authority, or approval context.

These objectives reduce risk; they do not make arbitrary model-generated code,
third-party tools, or external services trustworthy.

## Threat model and trust boundaries

Treat the following as untrusted unless the deployment explicitly proves
otherwise:

- Graph IR documents and dynamic graph proposals;
- graph input and shared state values;
- prompts, model responses, embeddings, and retrieved documents;
- webpages, repository files, issue text, and generated patches;
- MCP servers and tool descriptions/responses;
- provider SDK responses and error messages;
- artifacts produced by another node or run;
- executor plugins and dependency packages;
- checkpoint, event, and artifact data loaded from a store;
- human-supplied approval text copied from an untrusted source.

Primary assets include source code, credentials, customer data, model/provider
budgets, package-signing authority, external accounts, durable histories, and the
integrity of published findings.

The major boundaries are:

```text
operator policy
      │ grants a bounded capability set
      ▼
graph compiler/policy gate ──> scheduler ──> executor isolation boundary
                                      │                 │
                                      │                 ├─ tools / MCP
                                      │                 ├─ filesystem / git
                                      │                 ├─ network / providers
                                      │                 └─ scoped secrets
                                      ▼
                              events / checkpoints / artifacts
```

The scheduler may select *when* authorized work runs. A router or planner may
select *which authorized path* is requested. Neither may enlarge the operator's
capability envelope.

## Controls implemented in alpha

Current controls are useful, but none is a substitute for process isolation:

- dependency-free Graph IR validation rejects malformed envelopes and unknown
  fields at defined structural levels;
- the compiler rejects missing references, duplicate IDs, unreachable nodes,
  incoming edges to entrypoints, and implicit cycles;
- compiler policies bound fan-out and depth;
- native ready-queue schedulers bound concurrency and total attempts;
- per-node retries and timeouts are bounded;
- failures and skipped descendants remain structured rather than disappearing;
- both native runtimes propagate cooperative cancellation signals to executors;
- graph hashing gives an immutable identity to a compiled document;
- native local event stores use last-sequence CAS, strict envelopes, safe opaque
  identifiers, fsync, and corruption detection;
- native checkpoint stores use safe identifiers, atomic replacement, strict
  portable state, and verified content hashes;
- the MCP server exposes only bounded validation, planning, and a fixed bundled
  schema over local stdio; it has no run, file, network, or shell tool.

Important limitations:

- declared node input/output JSON Schemas are not yet enforced for every runtime
  transition;
- both runtimes reject cyclic, non-finite, unsafe-integer, or otherwise
  non-portable JSON inputs and executor outputs, but this is not full declared
  JSON Schema validation;
- a non-cooperative executor may continue external work after timeout or
  cancellation;
- graph hashes provide identity, not author authenticity or authorization;
- an executor can bypass Graph IR metadata and directly use ambient process
  privileges;
- local JSONL history is durable after a successful fsync, but it is not
  authenticated or tamper-evident and is not connected to scheduler recovery.

## Capability model (target v1)

Capabilities are positive grants evaluated at the executor boundary. The default
is deny. Policy should express at least:

- allowed tool or MCP operation IDs;
- filesystem roots and separate read/write/create permissions;
- allowed executable identities and argument constraints;
- network protocols, hosts, ports, and request methods;
- secret references the node may resolve;
- artifact read/write namespaces;
- external account, tenant, or resource scopes;
- maximum process, memory, CPU, time, and concurrency resources;
- whether the activity may cause no, idempotent, or non-idempotent effects.

The effective node authority is the intersection of operator policy, graph policy,
executor/provider capability, and run-specific approval. Missing information
narrows authority; it never widens it.

### Capability invariants

- A planner can request a capability but cannot approve it.
- Model/tool output is data, never a policy document.
- Child graphs and dynamic graph patches cannot exceed the parent grant.
- Retry and resume reuse the original capability snapshot; they do not pick up
  newly available ambient credentials silently.
- A policy decision records graph hash, node ID, input hash, capability version,
  and relevant approval identity.
- A denied operation is a structured terminal or routable result, not a prompt to
  ask the model how to bypass policy.
- Tool discovery must not imply tool authorization.

## Filesystem safety and worktree isolation (target v1)

Path policy must operate on resolved paths, not string prefixes. Before any write:

1. start from a fixed, already resolved workspace root;
2. reject absolute or parent-traversal paths not explicitly granted;
3. resolve symlinks and verify the final target remains inside the allowed root;
4. avoid unresolved environment variables, globs, and command substitution as
   security selectors;
5. use atomic create/replace where appropriate;
6. recheck authority at the operation boundary to reduce time-of-check/time-of-use
   races;
7. record target identity without logging sensitive content.

Never let a model construct a recursive deletion target from `$HOME`, `~`, `/`, a
workspace root, an unresolved variable, or a broad glob.

For parallel code writers, the target worktree provider must:

- allocate a unique worktree, branch, temp directory, cache namespace, and ports;
- bind ownership to one run/node attempt with a lease;
- prevent writes outside declared paths;
- avoid copying secrets into tracked files or artifacts;
- treat repository hooks and configuration as untrusted execution inputs;
- require a clean status, tests, policy checks, and reviewed diff before merge;
- surface merge conflicts as structured failures;
- clean only a resolved worktree it created, never a broad parent directory;
- preserve evidence or quarantine the worktree after a security-relevant failure.

Worktrees isolate file histories; they do not isolate processes, environment,
network, ports, or the host kernel. Higher-risk executors need process or container
isolation as well.

## Process and container isolation (target v1)

An isolation provider should launch executors with:

- a minimal environment and no inherited credentials;
- explicit read-only/read-write mounts;
- a dedicated working and temporary directory;
- restricted user/group identity;
- network disabled or allowlisted;
- CPU, memory, process, file-descriptor, and wall-time limits;
- captured exit status and bounded stdout/stderr;
- a kill mechanism independent of cooperative model/tool code;
- cleanup keyed to a verified run/node resource ID.

Container isolation is not a complete trust boundary when the host runtime,
mounted sockets, privileged flags, or kernel are exposed. Do not mount a Docker
socket or cloud credential directory into an untrusted executor.

## Secrets and credentials

Secrets should be references, not Graph IR values, edge payloads, prompt text,
checkpoints, or artifacts. Target v1 resolves a reference only at the authorized
executor boundary and injects it through the narrowest supported channel.

Rules:

- grant secrets per node and per external account/tenant;
- prefer short-lived, audience-bound credentials;
- never send a secret to a model merely because a tool needs it;
- separate provider credentials from tool/service credentials;
- do not expose secret values in exception strings, subprocess arguments, or
  generated patches;
- revoke/rotate on suspected exposure and invalidate affected run capability
  snapshots;
- store only secret reference ID/version and access outcome in the audit record.

Applications using alpha must implement these controls themselves. Passing a
secret in graph input makes it visible to executor input/result handling and is
strongly discouraged.

## Redaction and observability (target v1)

Telemetry should default to metadata, not payloads. A run/node span can normally
record IDs, hashes, sizes, status, latency, attempts, token/cost totals, and policy
decisions without recording prompts or outputs.

Redaction must happen **before** data reaches an event store, log sink, trace
exporter, error aggregator, or artifact store. Redacting only the UI is too late.
Use multiple controls:

- payload capture off by default;
- field allowlists for structured events;
- known-secret and credential-pattern scanning;
- maximum field sizes and bounded error text;
- hashing or immutable artifact references instead of inline blobs;
- separate privileged access to sensitive artifacts;
- retention and deletion policy per data class;
- tests using canary secrets to prove they never reach persisted/exported output.

Redaction is not mathematically perfect: a model may transform a secret so a
literal matcher misses it. The primary control is not providing the secret to the
model or payload in the first place.

## Prompt injection and untrusted instructions

Retrieved text can say “ignore policy,” imitate a system message, request a secret,
or propose a dangerous tool call. Treat it as quoted data.

Target-v1 defenses are layered:

- prompts clearly separate instructions from untrusted content;
- tool calls are validated against typed arguments and capability policy;
- high-impact actions require deterministic checks or human approval;
- model-generated routes use validated enums with safe fallbacks;
- dynamic `GraphPatch` proposals are recompiled and reauthorized;
- citations identify evidence but do not grant authority;
- a verifier receives original evidence and cannot approve an unauthorized action;
- least-privilege executors limit damage when judgment fails.

No prompt technique alone is a sandbox.

## Tools and MCP

MCP servers and tool plugins are remote/local principals, not passive libraries.
Their descriptions and results may be malicious or compromised.

Target-v1 defaults:

- MCP exposure is read-only unless mutation is explicitly enabled;
- every tool has a stable identity and version/publisher metadata;
- tool arguments are schema-validated and size-bounded;
- mutations pass capability and approval gates;
- network/filesystem effects are enforced outside the tool's self-description;
- responses are untrusted payloads and redacted before persistence;
- server disconnect, timeout, or protocol error is `unknown`/failure, never tool
  success;
- tool lists are pinned or reviewed so a server cannot silently add authority.

Until those controls exist, applications must wrap tools in reviewed executors and
apply their own allowlists.

## External side effects and recovery

External mutation is at least once. A crash can occur after the remote service
commits but before the orchestrator records success. Target-v1 handling requires:

- one stable idempotency key per logical activity, reused across retries;
- an activity record linking request hash, remote identity, and result evidence;
- reconciliation after ambiguous timeout/disconnect;
- explicit compensation as a separate authorized action;
- human confirmation before repeating an unresolved non-idempotent effect;
- approval binding to graph revision, node, input hash, capability snapshot, and
  expiry.

An attempt number is useful audit metadata but is usually the wrong idempotency
key: changing it on every retry defeats deduplication.

The alpha runtime has no durable activity ledger or recovery approval gate.
Custom executors are responsible for idempotency today.

## Durable state and artifact integrity

The alpha local adapters implement CAS event append and content-hashed
checkpoint files for one process. They reject unsafe path identifiers and detect
truncated or modified records. They do not provide encryption, tenant
authorization, multi-process locking, leases, scheduler resume, or an artifact
store. Use a private directory owned by the least-privileged runtime identity.

The remaining target-v1 requirements are:

- Event appends use expected sequence/version to reject concurrent writers.
- One active orchestrator lease owns run progression; lease loss stops scheduling.
- Every run binds an immutable graph hash and implementation/version metadata.
- Checkpoints have schema/version and integrity metadata and can be rebuilt from
  event history.
- Artifact references are content-addressed where feasible and include size/media
  metadata.
- Stores enforce tenant/run namespace authorization independently of application
  object names.
- Encryption in transit and at rest is deployment/store responsibility and must
  be documented per adapter.
- Retention, legal deletion, backup, and restore are tested; “append-only” is not
  an excuse to retain secrets forever.
- Replay reads recorded nondeterministic results and must not silently repeat
  external mutations.

## Human approval

A human gate is meaningful only if the reviewer can see exactly what is being
authorized. Target-v1 approval records include:

- graph revision/hash and node ID;
- normalized action and target;
- input and proposed output/effect hashes;
- requested capabilities and side-effect class;
- relevant diff or evidence, with secret-safe presentation;
- approver identity, decision, timestamp, and expiry.

Any material input, target, graph, capability, or diff change invalidates the
approval. “Approve future actions like this” requires a separate, explicitly
scoped policy change.

## Dynamic graphs and bounded growth (target v1)

A planner may propose nodes and edges through a versioned graph patch. Before the
patch becomes executable it must pass:

- Graph IR and schema validation;
- cycle, reachability, and contract compilation;
- `maxDynamicNodes`, depth, fan-out, attempts, duration, and cost limits;
- capability intersection with the parent run;
- node-kind/provider/tool allowlists;
- side-effect and human-approval policy;
- an immutable revision append, never history rewrite.

Reject patches that use generated identifiers or nested subgraphs to evade total
limits. Budget accounting follows the whole run tree, not one patch in isolation.

## Supply-chain and plugin risk

Until stable signed releases exist, pin a reviewed commit and inspect changes
before use. Target-v1 release controls include locked dependency resolution,
dependency review, secret scanning, static analysis, license review, SBOM,
checksums, provenance/attestations, and trusted publishing for npm and PyPI.

Executor, provider, store, and MCP adapters are privileged code. A plugin manifest
does not prove safety. Review source/publisher, pin versions and integrity, minimize
capabilities, and test failure behavior before enabling an adapter.

## Alpha operator checklist

Before running the current code:

- use only trusted Graph IR and reviewed executor/handler code;
- run under a disposable, least-privileged OS account or environment;
- remove unrelated credentials from the environment;
- restrict filesystem and network outside Graph Engineering using OS/container
  controls you manage;
- set low `maxConcurrency`, `maxFanOut`, `maxDepth`, `maxTotalAttempts`, retry, and
  timeout limits;
- make every external mutation idempotent and reconcile ambiguous results;
- ensure TypeScript executors honor `AbortSignal` and Python handlers honor
  `CancellationSignal`;
- avoid raw secrets and personal data in graph inputs, node outputs, errors, and
  application logs;
- inspect the graph hash and validation diagnostics before execution;
- keep local event/checkpoint directories private and do not treat their hashes
  as signatures or their CAS as a distributed lock;
- assume a process crash requires a fresh run; durable resume is not available;
- do not expose alpha execution directly to untrusted multi-tenant users.

## Target-v1 security acceptance criteria

Stable security claims require evidence, including:

- path traversal, symlink escape, broad deletion, and worktree collision tests;
- capability-denial tests for every tool/filesystem/network/secret boundary;
- prompt-injection cases that request privilege expansion;
- canary-secret tests across logs, events, traces, checkpoints, and artifacts;
- timeout/cancellation tests with non-cooperative executors in killable isolation;
- crash-after-effect reconciliation and idempotency tests;
- concurrent resume/lease-loss tests;
- malicious/corrupt event, checkpoint, artifact, and dynamic-patch tests;
- resource exhaustion and budget bypass tests across nested/dynamic graphs;
- package provenance, dependency, license, and vulnerability gates;
- documented threat-model review before a stable release.

Until these controls are implemented and verified, the correct label remains
alpha rather than “secure by default.”

## Related documentation

- [Vulnerability reporting](../SECURITY.md)
- [Concepts and status boundary](./CONCEPTS.md)
- [Failure modes](./FAILURE_MODES.md)
- [Protocol and compiler diagnostics](../spec/README.md)
- [Runtime semantics](../spec/runtime-semantics.md)
