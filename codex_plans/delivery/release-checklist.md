# Graph Engineering Stable-v1 Release Checklist

- Authority: [Graph Engineering 21-Day Master Plan](../Graph-Engineering-21-Day-Master-Plan.md)
- Dependency source: [21-Day Task Dependency Graph](task-dependency-graph.md)
- Operational status source: [task registry](../../codex_logs/task-registry.json)
- Release rule: ship stable v1 only when every mandatory row is Green; otherwise
  ship/support the accurately labeled complete RC and keep unmet work open

## 1. Checklist protocol

Every checklist row starts **Open**. This file intentionally records no current
Partial or Green claims. An alpha tag, a healthy progress scan, an existing
file, or an uncaptured local command is not stable-release evidence.

Allowed status values:

- **Open**: no qualifying evidence, or the check has not been executed against
  the release candidate.
- **Partial**: exact evidence exists, but a required language, platform,
  version, scenario, threshold, review, or artifact is still missing.
- **Green**: the entire row passed against the immutable candidate and the
  Evidence slot contains the required references.
- **Blocked**: an explicit dependency, defect, external authority, or external
  evidence gap prevents execution. Blocked is never equivalent to Green.

Every Evidence slot must eventually contain the source revision, exact command
and result, immutable CI/report URL or committed evidence path, artifact digest
where relevant, date, and independent reviewer. A mutable dashboard URL or a
summary without raw evidence is insufficient.

Owner codes are accountable lanes, not proof of assignment:

- **Integration**: canonical spec, cross-language joins, release decision.
- **TS runtime**: TypeScript/Node implementation and npm artifacts.
- **Python runtime**: Python implementation and PyPI artifacts.
- **Platform/quality**: CLI, MCP, Explorer, docs, examples, matrices, security,
  external testing, growth assets, and support operations.

`REL-*` IDs are checklist coordination IDs. They must be mapped to the live task
registry before execution; their presence here does not assert that a registry
task exists or is complete.

## 2. Candidate coordinates

Fill these fields before changing any row from Open:

```text
Candidate version:
Candidate source revision:
Canonical spec revision/hash:
TypeScript package digests:
Python wheel/sdist digests:
SBOM/checksum manifest:
CI matrix run:
Release manager:
Independent go/no-go reviewer:
Decision timestamp (UTC):
```

## 3. Stable-v1 decision joins

| Gate | Mandatory decision condition | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `V1-01` | Durable recovery: successful internal nodes never rerun; crash windows, leases/CAS, replay/fork, stale approvals, and storage races pass | Integration | `REL-V1-01` | Open | Add candidate-bound `T19-T22`, `T30`, and storage evidence. |
| `V1-02` | Security: no unaccepted high/critical issue; deny-by-default capability/isolation, redaction, prompt-injection, dependency/license/static scans pass | Integration | `REL-V1-02` | Open | Add signed security review referencing `T09`, `T15`, `T23-T28`, `Q08`, and supply-chain rows. |
| `V1-03` | Cross-language conformance: every `X01-X10` row is Green with no TS/Python divergence | Integration | `REL-V1-03` | Open | Add shared conformance report, fixture revision, both runtime revisions, and reviewer. |
| `V1-04` | Package provenance: trusted npm/PyPI publishing, SBOMs, checksums, attestations, and source-to-package identity all pass | Integration | `REL-V1-04` | Open | Add `Q09` plus all mandatory `SC-*` artifact and identity references. |
| `V1-05` | External usability: Quickstart is at most three commands, at least 80% finish in five minutes, at least five external reports, and no P0/P1 defects | Platform/quality | `REL-V1-05` | Open | Add anonymized tester cohort/results, timing method, issue query, and reviewer. |
| `V1-06` | All `T01-T33`, `Q01-Q11`, required platform jobs, package checks, ten patterns, and mandatory assets are Green | Integration | `REL-V1-06` | Open | Add generated gate roll-up that links every leaf row without suppressing Open/Partial/Blocked entries. |
| `V1-07` | All planned Day-21 assets exist and at least a complete Beta/RC is supportable | Integration | `REL-V1-07` | Open | Add release asset manifest, package manifests, support roster, exclusions, and reviewer. |
| `V1-08` | Final label decision is stable v1 only if `V1-01` through `V1-07` are Green; otherwise full RC | Integration | `REL-V1-08` | Open | Add signed go/no-go record, chosen label/channel, candidate digests, and fallback decision. |

## 4. Non-negotiable invariant checks

| Gate | Mandatory condition | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `I01` | Canonical `spec/` governs both native runtimes and shared fixtures | Integration | `REL-I01` | Open | Add spec revision, fixture manifest, TS/Python conformance runs, and review. |
| `I02` | Failures remain structured values/events and are never silently replaced by null | Integration | `REL-I02` | Open | Add invalid-input/output and terminal-envelope test reports for both runtimes. |
| `I03` | Deterministic transforms perform plumbing; model nodes perform judgment | Integration | `REL-I03` | Open | Add compiler/policy fixtures and architecture review against the candidate. |
| `I04` | Implicit cycles, unbounded retries, and unbounded dynamic fan-out are rejected | Integration | `REL-I04` | Open | Add compiler/runtime limit tests, randomized runs, and stable error-code evidence. |
| `I05` | External effects are documented at-least-once and require idempotency or approval | Integration | `REL-I05` | Open | Add activity contract tests, idempotency/approval examples, and docs review. |
| `I06` | Telemetry and prompt/response capture are off by default and redacted when enabled | Platform/quality | `REL-I06` | Open | Add clean-install configuration test, trace/redaction fixtures, and security review. |
| `I07` | Dynamic patches pass compiler, policy, permission, and budget gates with hard depth/fan-out/node/attempt caps | Integration | `REL-I07` | Open | Add malicious-patch/dry-run fixtures and both-runtime results. |
| `I08` | Planners cannot expand authority; shell/write/network/secret and MCP mutations are deny-by-default | Platform/quality | `REL-I08` | Open | Add capability escalation, MCP approval, shell, and network denial evidence. |
| `I09` | Insufficient verifier quorum is unknown or human-gated, never implicit pass | Integration | `REL-I09` | Open | Add pass/reject/abstain/quorum fixtures, retained-vote evidence, and review. |
| `I10` | Release claims avoid unsupported “battle-tested,” “production proven,” or exactly-once language | Platform/quality | `REL-I10` | Open | Add reviewed package, site, docs, demo, and channel-copy claim audit. |

## 5. Cross-language conformance checks

| Gate | TS/Python equality requirement | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `X01` | Canonical bytes and stable graph/node/edge/schema hashes | Integration | `REL-X01` | Open | Add shared fixture manifest and byte/hash diff report. |
| `X02` | Compilation verdicts, diagnostics, and stable error codes | Integration | `REL-X02` | Open | Add positive/negative corpus output diff and both commands. |
| `X03` | Router single/multicast decisions and durable replay | Integration | `REL-X03` | Open | Add route-selection and replay fixture results. |
| `X04` | Barrier all/minimum/percentage/quorum/deadline settlement | Integration | `REL-X04` | Open | Add barrier/quorum corpus results including missing/failure statistics. |
| `X05` | Event-ordering constraints and terminal-history envelopes | Integration | `REL-X05` | Open | Add normalized event-log comparison and allowed-order proof. |
| `X06` | Terminal states and structured failure envelopes | Integration | `REL-X06` | Open | Add all terminal/failure-policy fixture results. |
| `X07` | Retry, timeout, cancellation, and exact attempt accounting | Integration | `REL-X07` | Open | Add coordinated failure/cancellation corpus and count comparison. |
| `X08` | Resume, replay, and fork results/lineage | Integration | `REL-X08` | Open | Add bidirectional persisted-history interop and lineage report. |
| `X09` | Stable JSON envelopes, CLI machine output, and exit codes | Integration | `REL-X09` | Open | Add TS/Python CLI golden outputs and exit-code matrix. |
| `X10` | Adapter and Event/Checkpoint/Artifact/Lock/storage conformance | Integration | `REL-X10` | Open | Add shared adapter/storage suite output for every official implementation. |

## 6. Mandatory test scenarios

| Gate | Mandatory candidate test | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `T01` | Missing node references are rejected | Integration | `REL-T01` | Open | Add shared fixture IDs and TS/Python compiler results. |
| `T02` | Duplicate node identities are rejected | Integration | `REL-T02` | Open | Add shared fixture IDs and TS/Python compiler results. |
| `T03` | Unreachable nodes are rejected | Integration | `REL-T03` | Open | Add shared fixture IDs and TS/Python compiler results. |
| `T04` | Invalid ports are rejected | Integration | `REL-T04` | Open | Add invalid endpoint/port corpus and stable diagnostics. |
| `T05` | Invalid graph, edge, node-input, and node-output schemas are rejected before unsafe persistence | Integration | `REL-T05` | Open | Add compiler/runtime schema corpus and structured error events. |
| `T06` | Implicit graph cycles are rejected | Integration | `REL-T06` | Open | Add cycle fixtures and stable error codes. |
| `T07` | Incomplete router without exhaustive cases/default is rejected | Integration | `REL-T07` | Open | Add router compiler/runtime fixtures. |
| `T08` | Unbounded loops are rejected | Integration | `REL-T08` | Open | Add missing/unsafe-bound fixtures and hard-stop results. |
| `T09` | Unauthorized transforms and capability expansion are rejected | Platform/quality | `REL-T09` | Open | Add policy fixtures, escalation attempts, and denial events. |
| `T10` | 100-way parallel concurrency stays within configured bounds | Integration | `REL-T10` | Open | Add deterministic load command, utilization trace, and resource report. |
| `T11` | Every failure policy passes, including retry, drop, stop, dead-letter, fail-fast, partial, and quorum | Integration | `REL-T11` | Open | Add policy-by-policy TS/Python results and terminal envelopes. |
| `T12` | Streaming uses bounded buffers, demand, and real downstream backpressure without a whole-stage barrier | Integration | `REL-T12` | Open | Add slow-consumer/pull-ahead traces and shared pipeline corpus. |
| `T13` | Barrier timeout/deadline reports complete success/failure/missing statistics | Integration | `REL-T13` | Open | Add clock-controlled barrier fixtures for both runtimes. |
| `T14` | Router replay reuses the durable decision without re-judging | Integration | `REL-T14` | Open | Add original/replay event comparison and zero-provider-call proof. |
| `T15` | Malicious dynamic patches and unsafe dry runs are rejected | Platform/quality | `REL-T15` | Open | Add depth/fan-out/node/attempt/capability/budget attack corpus. |
| `T16` | Verifier pass, reject, and abstain/unknown paths retain votes/evidence and gate correctly | Integration | `REL-T16` | Open | Add panel/quorum/rubric fixtures and persisted verdicts. |
| `T17` | Global seen-set convergence is deterministic | Integration | `REL-T17` | Open | Add duplicate/discovery-order corpus and exit-reason comparison. |
| `T18` | Hard iteration, duration, cost, node, fan-out, and attempt limits stop scheduling | Integration | `REL-T18` | Open | Add one boundary and one over-limit test per budget dimension. |
| `T19` | Crash recovery passes at every checkpoint and commit/release window | Integration | `REL-T19` | Open | Add crash-point matrix, resumed history, and no-rerun proof. |
| `T20` | Dual-resume lease/CAS races cannot advance one run twice | Integration | `REL-T20` | Open | Add synchronized race test and durable winner/loser events. |
| `T21` | Replay and fork preserve traceable lineage and expected results | Integration | `REL-T21` | Open | Add replay/fork graph/event hashes and lineage report. |
| `T22` | Stale approvals are rejected | Integration | `REL-T22` | Open | Add graph/run/revision approval mismatch fixtures. |
| `T23` | Worktree lease, path, test-gate, and merge conflicts are structured failures | Platform/quality | `REL-T23` | Open | Add conflict/cleanup test artifacts and preserved-worktree evidence. |
| `T24` | Process/container ports, temp files, caches, and database namespaces remain isolated | Platform/quality | `REL-T24` | Open | Add concurrent escape/isolation matrix and cleanup report. |
| `T25` | Provider fallback, rate limit, retry, cancellation, and circuit breaker behavior conforms | Integration | `REL-T25` | Open | Add shared mock adapter suite and opt-in provider evidence. |
| `T26` | Secrets are redacted from errors, events, traces, prompts, tools, and support bundles | Platform/quality | `REL-T26` | Open; corrective `D9-REDACTION-039` | First correct the current raw-payload/`redacted: true` contradiction, then add positive/negative seeded-secret scans across journal, checkpoint, artifact, stdout/stderr, log, trace, error and support-bundle bytes in both languages. |
| `T27` | Cancellation before start and while running propagates across runtime/provider/tool boundaries | Integration | `REL-T27` | Open | Add pre/running cancellation tests and abort/attempt traces. |
| `T28` | Prompt injection cannot expand capabilities or bypass approval/policy | Platform/quality | `REL-T28` | Open | Add adversarial prompts, denial events, and independent security review. |
| `T29` | Complete CLI init/add, validate/compile/plan/run, status/watch/inspect/logs, pause/resume/cancel/retry, replay/fork, cost/doctor/score/badge/visualize, worktree/artifact/plugin, and MCP flow passes | Platform/quality | `REL-T29` | Open | Add command/JSON/error/exit-code matrix on packed artifacts. |
| `T30` | Shared Event/Checkpoint/Artifact/Lock and SQLite/PostgreSQL/S3 storage conformance passes | Integration | `REL-T30` | Open | Add implementation-by-operation matrix, race results, and artifact digests. |
| `T31` | All ten patterns pass end-to-end in YAML/JSON, TypeScript, and Python | Platform/quality | `REL-T31` | Open | Add `REL-PAT01` through `REL-PAT10` roll-up and shared E2E run. |
| `T32` | A 1,000-node graph stays within documented compiler/scheduler/worker resource bounds | Platform/quality | `REL-T32` | Open | Add versioned benchmark input, limits, wall time, CPU, and memory report. |
| `T33` | Kill, network, store, and artifact chaos completes without deadlock, unbounded spawn, or budget escape | Platform/quality | `REL-T33` | Open | Add fault matrix, seeds, traces, terminal states, and resource report. |

## 7. Quantitative quality thresholds

| Gate | Mandatory threshold | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `Q01` | Compiler, scheduler, event store, and policy each reach at least 90% statement and 85% branch coverage | Integration | `REL-Q01` | Open | Add per-language, per-subsystem coverage artifacts tied to the candidate. |
| `Q02` | At least 250 unit/integration cases per language | Integration | `REL-Q02` | Open | Add collected-case inventory separating TS and Python and excluding skipped tests. |
| `Q03` | One shared adapter/storage conformance suite passes every implementation | Integration | `REL-Q03` | Open | Add suite revision, adapter/store matrix, commands, and reports. |
| `Q04` | 100 randomized failure runs finish without deadlock, unbounded spawn, or budget escape | Platform/quality | `REL-Q04` | Open | Add all 100 seeds/results, timeout policy, resource traces, and zero-failure summary. |
| `Q05` | Linux/macOS/Windows; Node 20/22; Python 3.11/3.12/3.13 support matrix passes | Platform/quality | `REL-Q05` | Open | Add Green roll-up for every mandatory `REL-MX-*` row. |
| `Q06` | Deterministic mock providers run in normal CI; real providers run only opt-in/nightly | Platform/quality | `REL-Q06` | Open | Add CI definitions, default no-credential run, and isolated nightly/opt-in evidence. |
| `Q07` | No performance regression above 10% without an approved baseline ADR | Integration | `REL-Q07` | Open | Add candidate/baseline benchmark diff; link approved ADR for any permitted regression. |
| `Q08` | No unaccepted high/critical vulnerability; secret, dependency, license, and static-analysis scans pass | Platform/quality | `REL-Q08` | Open; depends on `D9-REDACTION-039` | Add scanner versions/reports, corrective redaction evidence, triage disposition, and independent security sign-off. |
| `Q09` | Trusted npm/PyPI publishing, SBOMs, checksums, and attestations pass | Integration | `REL-Q09` | Open | Add Green roll-up for required `REL-SC-*` rows and artifact identities. |
| `Q10` | Quickstart uses at most three commands and at least 80% of external testers finish within five minutes | Platform/quality | `REL-Q10` | Open | Add exact Quickstart, cohort/timing data, completion calculation, and raw reports. |
| `Q11` | No P0/P1 defects and at least five external usability reports exist before stable v1 | Platform/quality | `REL-Q11` | Open | Add release-blocker query snapshot and at least five anonymized report references. |

## 8. Cross-platform and runtime-version matrix

Each Node cell must perform a clean packed install, build/typecheck, normal unit
and integration tests, deterministic mock smoke run, and CLI smoke test. Each
Python cell must install the wheel into a clean environment, run unit/integration
tests, Ruff/mypy checks, deterministic mock smoke run, and Python CLI smoke
test. No allowed-failure cell can turn `Q05` Green.

| Matrix cell | Required environment | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `MX-N01` | Linux, Node 20 | TS runtime | `REL-MX-N01` | Open | Add OS image/version, Node/pnpm versions, packed-install command, CI run, and artifacts. |
| `MX-N02` | Linux, Node 22 | TS runtime | `REL-MX-N02` | Open | Add OS image/version, Node/pnpm versions, packed-install command, CI run, and artifacts. |
| `MX-N03` | macOS, Node 20 | TS runtime | `REL-MX-N03` | Open | Add macOS/Xcode image, Node/pnpm versions, packed-install command, CI run, and artifacts. |
| `MX-N04` | macOS, Node 22 | TS runtime | `REL-MX-N04` | Open | Add macOS/Xcode image, Node/pnpm versions, packed-install command, CI run, and artifacts. |
| `MX-N05` | Windows, Node 20 | TS runtime | `REL-MX-N05` | Open | Add Windows image/build, Node/pnpm versions, packed-install command, CI run, and artifacts. |
| `MX-N06` | Windows, Node 22 | TS runtime | `REL-MX-N06` | Open | Add Windows image/build, Node/pnpm versions, packed-install command, CI run, and artifacts. |
| `MX-P01` | Linux, Python 3.11 | Python runtime | `REL-MX-P01` | Open | Add OS image/version, Python/uv versions, wheel-install command, CI run, and artifacts. |
| `MX-P02` | Linux, Python 3.12 | Python runtime | `REL-MX-P02` | Open | Add OS image/version, Python/uv versions, wheel-install command, CI run, and artifacts. |
| `MX-P03` | Linux, Python 3.13 | Python runtime | `REL-MX-P03` | Open | Add OS image/version, Python/uv versions, wheel-install command, CI run, and artifacts. |
| `MX-P04` | macOS, Python 3.11 | Python runtime | `REL-MX-P04` | Open | Add macOS/Xcode image, Python/uv versions, wheel-install command, CI run, and artifacts. |
| `MX-P05` | macOS, Python 3.12 | Python runtime | `REL-MX-P05` | Open | Add macOS/Xcode image, Python/uv versions, wheel-install command, CI run, and artifacts. |
| `MX-P06` | macOS, Python 3.13 | Python runtime | `REL-MX-P06` | Open | Add macOS/Xcode image, Python/uv versions, wheel-install command, CI run, and artifacts. |
| `MX-P07` | Windows, Python 3.11 | Python runtime | `REL-MX-P07` | Open | Add Windows image/build, Python/uv versions, wheel-install command, CI run, and artifacts. |
| `MX-P08` | Windows, Python 3.12 | Python runtime | `REL-MX-P08` | Open | Add Windows image/build, Python/uv versions, wheel-install command, CI run, and artifacts. |
| `MX-P09` | Windows, Python 3.13 | Python runtime | `REL-MX-P09` | Open | Add Windows image/build, Python/uv versions, wheel-install command, CI run, and artifacts. |
| `MX-X01` | Combined TS/Python bidirectional conformance on Linux, macOS, and Windows using current supported versions | Integration | `REL-MX-X01` | Open | Add three-OS interop CI runs, fixture revision, normalized diffs, and artifacts. |
| `MX-X02` | Cross-platform path, newline, signal/cancellation, process, port, and filesystem behavior | Platform/quality | `REL-MX-X02` | Open | Add OS-specific regression suite and structured divergence report showing none. |

## 9. Package install, upgrade, and distribution checks

| Gate | Mandatory package check | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `PKG01` | Every publishable npm package packs only intended runtime files, types, README, license, and notices | TS runtime | `REL-PKG01` | Open | Add tarball manifests, sizes, digests, and package-content check output. |
| `PKG02` | The canonical npm `graph-engineering` distribution installs from its tarball outside the monorepo | TS runtime | `REL-PKG02` | Open | Add clean temporary-project install/build/run evidence on Node 20 and 22. |
| `PKG03` | Python wheel and sdist contain intended modules, `py.typed`, README, license, and notices | Python runtime | `REL-PKG03` | Open | Add wheel/sdist manifests, metadata validation, sizes, and digests. |
| `PKG04` | The canonical PyPI `graph-engineering` distribution installs outside the source tree | Python runtime | `REL-PKG04` | Open | Add clean-environment wheel and sdist install/run evidence on Python 3.11-3.13. |
| `PKG05` | Primary `graph` and documented `grapheng` compatibility executables resolve and report the candidate version | Platform/quality | `REL-PKG05` | Open | Add `which`/`where`, version, help, and smoke outputs for npm and Python installations. |
| `PKG06` | Supported npm prerelease-to-RC-to-candidate upgrade preserves documented config/state or performs explicit migration | TS runtime | `REL-PKG06` | Open | Add version path, before/after fixtures, commands, and rollback result. |
| `PKG07` | Supported PyPI prerelease-to-RC-to-candidate upgrade preserves documented config/state or performs explicit migration | Python runtime | `REL-PKG07` | Open | Add version path, before/after fixtures, commands, and rollback result. |
| `PKG08` | Clean install and upgrade pass on every supported OS/runtime matrix cell | Platform/quality | `REL-PKG08` | Open | Add roll-up linking `REL-MX-*` and package-specific install/upgrade jobs. |
| `PKG09` | Installed packages run the no-credential deterministic-mock Quickstart in no more than three commands | Platform/quality | `REL-PKG09` | Open | Add clean terminal transcripts, elapsed time, outputs, and produced trace/score. |
| `PKG10` | Full CLI machine-readable JSON, structured errors, and exit codes work from installed artifacts | Platform/quality | `REL-PKG10` | Open | Add packed/wheel CLI golden matrix and schema validation. |
| `PKG11` | Package versions, Graph IR/API version, release tag, docs, and generated assets agree | Integration | `REL-PKG11` | Open | Add automated version audit tied to candidate revision and artifact digests. |
| `PKG12` | Package imports/exports and public APIs match frozen Day-14 contracts; upgrade adds no undocumented break | Integration | `REL-PKG12` | Open | Add API diff, compatibility suite, and approved migration notes if needed. |
| `PKG13` | Registry namespace/alias audit is current; no empty squatting package is published | Integration | `REL-PKG13` | Open | Add registry lookup date/results and explicit ownership/alias decision. |

## 10. Supply chain, security, and provenance checks

| Gate | Mandatory supply-chain check | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `SC01` | npm trusted-publishing identity and least-privilege workflow rehearsal pass without long-lived release credentials | TS runtime | `REL-SC01` | Open | Add workflow revision, identity configuration, dry-run/rehearsal log, and reviewer. |
| `SC02` | PyPI trusted-publishing identity and least-privilege workflow rehearsal pass without long-lived release credentials | Python runtime | `REL-SC02` | Open | Add workflow revision, identity configuration, dry-run/rehearsal log, and reviewer. |
| `SC03` | SPDX or CycloneDX SBOM exists for source, npm artifacts, Python wheel/sdist, and deployable site/app artifacts | Platform/quality | `REL-SC03` | Open | Add SBOM filenames, formats, generation command, package mapping, and digests. |
| `SC04` | Published checksum manifest covers every release artifact | Platform/quality | `REL-SC04` | Open | Add checksum algorithm, signed manifest, artifact list, and verification run. |
| `SC05` | Build and publish attestations bind source revision, workflow identity, and each artifact digest | Integration | `REL-SC05` | Open | Add attestation URLs/files and independent verification output. |
| `SC06` | Source archive/tag, npm tarballs, Python artifacts, SBOM, checksums, and attestations all identify one candidate | Integration | `REL-SC06` | Open | Add source-to-artifact provenance map with no unexplained file/version drift. |
| `SC07` | Secret scan passes repository, history, packages, source maps, docs, traces, and support bundles | Platform/quality | `REL-SC07` | Open | Add scanner/version/config, report, seeded-secret control, and triage. |
| `SC08` | Production dependency scan passes or has no unaccepted high/critical finding | Platform/quality | `REL-SC08` | Open | Add npm/Python/system dependency reports and disposition references. |
| `SC09` | License scan passes and MIT license plus complete third-party notices ship where required | Platform/quality | `REL-SC09` | Open | Add license inventory, policy result, package manifests, and legal review owner. |
| `SC10` | Static analysis and CodeQL-equivalent checks pass the exact candidate | Platform/quality | `REL-SC10` | Open | Add workflow run, analyzer versions, findings, and dispositions. |
| `SC11` | Threat model covers providers, shell/MCP, dynamic patches, stores, worktrees, workers, Explorer, and publishing | Platform/quality | `REL-SC11` | Open | Add reviewed threat model revision and resolved/unaccepted-risk list showing none high/critical. |
| `SC12` | Fuzz and prompt-injection suites pass policy, parser, schema, redaction, and capability boundaries | Platform/quality | `REL-SC12` | Open | Add corpus/seeds, duration, crash list, minimized reproducers, and result. |
| `SC13` | Telemetry and prompt/response capture remain off by default in clean npm/PyPI installs | Platform/quality | `REL-SC13` | Open | Add network/trace/config observation from both clean package installations. |
| `SC14` | Release workflow produces reproducible or explained artifact manifests from a clean trusted runner | Integration | `REL-SC14` | Open | Add two clean build manifests/digests and reviewed explanation for permitted variance. |

## 11. External testing and usability checks

External evidence must come from people outside the maintainer group. Reports
must be consented, minimally retained, and redacted; raw prompts, credentials,
and user data are not release evidence.

| Gate | Mandatory external check | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `UX01` | The canonical Quickstart contains no more than three user commands | Platform/quality | `REL-UX01` | Open | Add exact published Quickstart revision and command count review. |
| `UX02` | At least 80% of the recorded external cohort reaches a successful first run within five minutes | Platform/quality | `REL-UX02` | Open | Add cohort size, start/stop definition, anonymized timings, failures, and calculation. |
| `UX03` | At least five external usability reports cover install, first run, comprehension, and next action | Platform/quality | `REL-UX03` | Open | Add five or more consented report IDs, environment, outcome, and disposition. |
| `UX04` | Deterministic mock Quickstart needs no provider account, credential, or product telemetry opt-in | Platform/quality | `REL-UX04` | Open | Add clean-machine network/credential/config observation and transcript. |
| `UX05` | Tester environments include more than one OS and both TS and Python entry paths | Platform/quality | `REL-UX05` | Open | Add anonymized OS/runtime/language cohort matrix. |
| `UX06` | No unresolved P0/P1 defect exists in the candidate or documented first-run path | Integration | `REL-UX06` | Open | Add timestamped issue/incident query and release-manager sign-off. |
| `UX07` | Beta feedback is triaged; release-blocking fixes are retested externally | Platform/quality | `REL-UX07` | Open | Add feedback-to-issue mapping, fix revisions, and external retest results. |
| `UX08` | First-run docs and errors return actionable top remediation steps where promised | Platform/quality | `REL-UX08` | Open | Add doctor/score/error transcripts and tester comprehension notes. |
| `UX09` | External reports and galleries have consent, redaction, and no fabricated adopter claims | Platform/quality | `REL-UX09` | Open | Add consent/redaction audit and source reference for each public entry. |
| `UX10` | At least five external reports and the 80% timing calculation are independently reviewed | Integration | `REL-UX10` | Open | Add reviewer identity/date, sampling notes, exclusions, and signed conclusion. |

## 12. Ten executable pattern checks

Every pattern must satisfy the shared bundle `PB`: YAML/JSON, TypeScript, and
Python implementations; deterministic fixtures and expected events; mock
execution; opt-in real-provider setup; architecture diagram; budgets;
permissions; structured failure and durable-resume demos; tests; and Claude
Code, Codex, MCP, and shell guides. A skeleton is not a passing pattern.

| Gate | Mandatory pattern check | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `PB` | Shared bundle schema/checker validates every required pattern artifact and rejects a missing component | Platform/quality | `REL-PAT00` | Open | Add bundle schema/check command, negative fixture, and ten-pattern manifest. |
| `P01` | Multi-source research diamond passes `PB` and cross-language E2E with settled source failures | Platform/quality | `REL-PAT01` | Open | Add artifact manifest, TS/Python/YAML runs, expected events, failure/resume trace, and guides. |
| `P02` | Cited deep research with citation verification passes `PB`; unsupported citations reject/unknown-gate | Platform/quality | `REL-PAT02` | Open | Add artifact manifest, citation fixtures/verdicts, cross-language E2E, resume trace, and guides. |
| `P03` | Route authentication security sweep passes `PB`; missing route/capability fails closed | Platform/quality | `REL-PAT03` | Open | Add artifact manifest, route/policy fixtures, cross-language E2E, denial trace, and guides. |
| `P04` | Diff risk router with diverse judge panel passes `PB`; votes/abstentions/evidence are retained | Platform/quality | `REL-PAT04` | Open | Add artifact manifest, panel/quorum fixtures, cross-language E2E, resume trace, and guides. |
| `P05` | Loop-until-dry bug discovery passes `PB`; hard-limit exhaustion is not called convergence | Platform/quality | `REL-PAT05` | Open | Add artifact manifest, seen-set/limit fixtures, cross-language E2E, exit reasons, and guides. |
| `P06` | File-by-file migration with worktrees and test gates passes `PB`; conflicts do not merge | Platform/quality | `REL-PAT06` | Open | Add artifact manifest, isolated migration E2E, conflict/test failure, resume trace, and guides. |
| `P07` | CI failure sweeper passes `PB`; external mutations are idempotent/approved and attempts are bounded | Platform/quality | `REL-PAT07` | Open | Add artifact manifest, fake CI fixtures, cross-language E2E, stop/resume trace, and guides. |
| `P08` | Dependency update sweeper passes `PB`; unsafe/conflicting updates remain isolated | Platform/quality | `REL-PAT08` | Open | Add artifact manifest, fake registry/update fixtures, security/test gates, resume trace, and guides. |
| `P09` | PR babysitter passes `PB`; stale approvals reject and writes are idempotent/approved | Platform/quality | `REL-PAT09` | Open | Add artifact manifest, fake PR fixtures, approval/replay E2E, resume trace, and guides. |
| `P10` | Scheduled ecosystem scan passes `PB`; schedule/fan-out/cost/duration are bounded | Platform/quality | `REL-PAT10` | Open | Add artifact manifest, fake ecosystem fixtures, chaos/resume E2E, resource report, and guides. |

## 13. Documentation and launch-asset checks

| Gate | Mandatory asset | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `DOC01` | Sixty-second, mock-first Quickstart aligned with `Q10` | Platform/quality | `REL-DOC01` | Open | Add published English/Chinese revisions, clean transcripts, video/time proof, and external result. |
| `DOC02` | Ninety-second uncut terminal demo with no hidden manual repair | Platform/quality | `REL-DOC02` | Open | Add source script, uncut media, candidate version, timestamp, and reproduction steps. |
| `DOC03` | Interactive linear-versus-graph visualization uses real topology/events and accurate limitations | Platform/quality | `REL-DOC03` | Open | Add deployed/source revision, fixture, smoke test, and screenshots/video. |
| `DOC04` | Fourteen-step executable roadmap covers all named topics and when not to use a graph | Platform/quality | `REL-DOC04` | Open | Add course manifest, fourteen runnable checks, docs-link report, and reviewer. |
| `DOC05` | Architecture essay accurately covers IR, execution, durability, at-least-once effects, safety, and limits | Integration | `REL-DOC05` | Open | Add reviewed essay revision and claim-to-spec cross-reference. |
| `DOC06` | Side-by-side TypeScript/Python examples remain behaviorally conformant | Platform/quality | `REL-DOC06` | Open | Add executable docs tests and `X01-X10` references. |
| `DOC07` | Performance and recovery benchmarks are reproducible with versioned inputs/environment/baseline | Platform/quality | `REL-DOC07` | Open | Add benchmark scripts, raw data, candidate/baseline revisions, reports, and ADR if needed. |
| `DOC08` | Four authentic case studies ship, including at least one failure story | Platform/quality | `REL-DOC08` | Open | Add four source/trace references, consent where needed, reproduction steps, and claim review. |
| `DOC09` | Graph Ready G0-G4 score and badge are deterministic and return top three remediation actions | Platform/quality | `REL-DOC09` | Open | Add scoring fixtures, CLI/site outputs, repeatability check, and badge asset. |
| `DOC10` | Pattern picker, anti-pattern, failure-mode, operations, and safety guides are complete | Platform/quality | `REL-DOC10` | Open | Add guide manifest, docs-link/tests report, pattern mapping, and security review. |
| `DOC11` | Interactive showcase and Explorer display topology, states, budget, critical path, utilization, waits, retries, verdicts, and replay/fork history | Platform/quality | `REL-DOC11` | Open | Add deployed/source revision, deterministic trace, UI smoke tests, and visual evidence. |
| `DOC12` | Adopter and trace galleries contain only consented, authentic entries | Platform/quality | `REL-DOC12` | Open | Add entry manifest, consent/redaction references, URLs, and reviewer. |
| `DOC13` | English canonical docs plus Chinese README/Quickstart/launch summary agree on version and claims | Platform/quality | `REL-DOC13` | Open | Add bilingual diff review, link check, version audit, and reviewer. |
| `DOC14` | Channel-specific GitHub, Hacker News, X, LinkedIn, Reddit, Dev.to, and Chinese-community material is ready | Platform/quality | `REL-DOC14` | Open | Add copy manifest, current links/version, claim audit, schedule, and owners. |
| `DOC15` | API, CLI/MCP machine-output, extension, provider, store, upgrade, security, and support references match the frozen candidate | Platform/quality | `REL-DOC15` | Open | Add documentation test/link reports, API diff, example runs, and reviewer. |
| `DOC16` | Site, release notes, changelog, package READMEs, and GitHub Release share one candidate identity and known-limit list | Platform/quality | `REL-DOC16` | Open | Add version/link/claim audit across every published surface. |

## 14. Growth and community checks

Stretch outcomes are tracked but do not waive or independently block technical
release gates. Organic conduct, truthful assets, and consent are mandatory.

| Gate | Classification and requirement | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `GR01` | **Mandatory conduct:** no paid stars, bots, mutual-star schemes, fake adopters, or undisclosed promotion | Platform/quality | `REL-GR01` | Open | Add channel/partner disclosure audit and release-manager attestation. |
| `GR02` | **Mandatory asset:** release/content beats are prepared for Alpha 1, recovery, verifier, Alpha 2, Explorer, Beta, RC/security, and release | Platform/quality | `REL-GR02` | Open | Add beat manifest, truthful evidence source, asset URL/path, and publication state. |
| `GR03` | **Tracking, non-blocking:** Day 7/13/17/21 star outcomes 300/1,000/2,000/6,000+ are reported as stretch, not guarantee | Platform/quality | `REL-GR03` | Open | Add timestamped public metrics and copy audit separating outcome from gate. |
| `GR04` | **Tracking, non-blocking:** 2,000 CLI downloads, 500 runs, ten adopters, ten contributors, twenty-five external PRs, response p50 under twelve hours, ten invitations | Platform/quality | `REL-GR04` | Open | Add metric definitions, source snapshots, deduplication method, and current values. |
| `GR05` | **Tracking, non-blocking:** weekly successful runs, seven-day retention, time to first success, adopters, and non-maintainer merged PRs have dashboards | Platform/quality | `REL-GR05` | Open | Add privacy-preserving metric queries/snapshots and definitions. |
| `GR06` | **Mandatory decision policy:** visits/stars/installs/runs/retention signals trigger positioning, Quickstart, promotion pause, or reliability work as specified | Integration | `REL-GR06` | Open | Add current funnel diagnosis, selected response, owner, and review date. |
| `GR07` | **Mandatory community:** contributor pathway, governance, code/security reporting guidance, and authentic adopter submission process are published | Platform/quality | `REL-GR07` | Open | Add document URLs/revisions, workflow smoke tests, and reviewer. |

## 15. Day-21 support readiness

| Gate | Mandatory support check | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `SUP01` | Named release manager and TS, Python, platform, security, and community responders cover launch/support window | Integration | `REL-SUP01` | Open | Add roster, UTC coverage, escalation path, and acknowledgements. |
| `SUP02` | GitHub issue/discussion triage, incident intake, security disclosure, and status communication paths work | Platform/quality | `REL-SUP02` | Open | Add end-to-end dry-run tickets, response timestamps, and escalation evidence. |
| `SUP03` | npm and PyPI owners can deprecate/yank only according to policy and publish a corrected version without rewriting history | Integration | `REL-SUP03` | Open | Add owner/role audit and non-destructive rehearsal or documented provider procedure. |
| `SUP04` | Release notes document known limits, supported matrices, fallback modes, at-least-once effects, privacy defaults, and upgrade path | Platform/quality | `REL-SUP04` | Open | Add reviewed release-note revision and claims checklist. |
| `SUP05` | Incident runbook covers security escape, duplicate side effect, corrupt store/artifact, provider outage, package defect, and site outage | Platform/quality | `REL-SUP05` | Open | Add runbook revision, tabletop record, actions, and independent review. |
| `SUP06` | Support diagnostics redact secrets/prompts by default and collect raw content only with explicit consent | Platform/quality | `REL-SUP06` | Open | Add support-bundle tests, consent flow, seeded-secret scan, and docs. |
| `SUP07` | Response-time measurement exists for the controlled p50-under-twelve-hours goal | Platform/quality | `REL-SUP07` | Open | Add metric definition, queue query/snapshot, and on-call ownership. |
| `SUP08` | Release rollback/deprecation, forward-fix, and RC continuation decisions are prewritten and executable | Integration | `REL-SUP08` | Open | Add dry-run decision record, commands/procedures, approval boundaries, and reviewer. |

## 16. RC fallback and no-go checklist

| Gate | Mandatory fallback condition/action | Owner | Task ID | Status | Evidence slot |
|---|---|---|---|---|---|
| `RC01` | Automated roll-up treats every Open, Partial, or Blocked mandatory row as stable-v1 no-go | Integration | `REL-RC01` | Open | Add roll-up implementation/test with one failing fixture for each non-Green state. |
| `RC02` | If any stable gate is not Green, stable npm/PyPI tags and stable GitHub Release are not published | Integration | `REL-RC02` | Open | Add signed no-go decision and channel/tag protection evidence. |
| `RC03` | The fallback release is explicitly labeled full RC and never implies stable/production-proven status | Platform/quality | `REL-RC03` | Open | Add RC package tags, version strings, site/docs copy, and claim audit. |
| `RC04` | RC blocker manifest lists every Open/Partial/Blocked gate, impact, owner, task ID, workaround, and re-entry evidence | Integration | `REL-RC04` | Open | Add generated blocker manifest and reconciliation against this checklist. |
| `RC05` | Day 21 still produces all planned assets and at least a complete Beta/RC; a missing asset keeps the plan open | Integration | `REL-RC05` | Open | Add asset manifest and explicit missing-asset report showing none for a complete RC. |
| `RC06` | Last verified prerelease remains available; failed artifacts are invalidated and rebuilt rather than silently replaced | Integration | `REL-RC06` | Open | Add artifact/channel inventory, invalidation/deprecation action, and replacement digests. |
| `RC07` | Post-publish defects use deprecation/forward fix and a new version; package history and attestations are never rewritten | Integration | `REL-RC07` | Open | Add registry policy, rehearsal/tabletop, and reviewer. |
| `RC08` | Recovery fallback never claims irreversible external side effects were rolled back; it uses idempotency, approval, or compensation | Integration | `REL-RC08` | Open | Add incident/recovery scenarios, event traces, and docs review. |
| `RC09` | A reopened contract, durability, isolation, security, compatibility, or provenance gate reopens all dependent rows/artifacts | Integration | `REL-RC09` | Open | Add dependency-aware invalidation test and sample reopened-gate report. |
| `RC10` | RC receives the same support, disclosure, security response, and evidence collection until stable re-entry | Integration | `REL-RC10` | Open | Add continuing support roster, blocker review cadence, and next decision date. |

## 17. Post-audit control-to-release overlay

This overlay prevents the 16 newly explicit tasks from becoming orphaned work.
It is not the final 178-row machine map: `CTRL-RELEASE-MAP-074` must still emit
and validate `release-task-map.json` before any candidate roll-up.

| Control | Release rows it must produce or review | Current state |
|---|---|---|
| `CTRL-RELEASE-MAP-074` | All 178 unique `REL-*` IDs, including explicit blocking/non-blocking classification | Open; no machine map yet. |
| `CTRL-EVIDENCE-BACKFILL-075` | Every blocking row whose producer was completed before evidence-policy cutoff | Open; historical status has zero candidate weight. |
| `D17-USABILITY-076` | `REL-UX01`-`REL-UX10`, `REL-Q10`, `REL-Q11`, adopter/case-study consent rows | Open/External; real reports required. |
| `D9-APPROVAL-077` | `REL-I05`, `REL-I08`, `REL-T22`, `REL-RC08`, stale approval and idempotency rows | Open. |
| `D14-NPM-DIST-078` | `REL-PKG02`, `REL-PKG05`, `REL-PKG13`, canonical install/bin rows | Open/External for namespace rehearsal. |
| `D16-PRIVACY-079` | `REL-I06`, `REL-UX09`, `REL-DOC12`, telemetry/capture/retention/withdrawal rows | Open/External for human data-owner approval. |
| `D18-SUPPORT-READINESS-080` | `REL-SUP01`-`REL-SUP08`, `REL-RC07`, rollback/yank/tabletop rows | Open/External for roster and registry authority. |
| `D13-TS-ADAPTERS-081`, `D13-PY-ADAPTERS-082`, join `D13-ADAPTERS-049` | `REL-X10`, `REL-T25`, `REL-T27`, `REL-Q03`, `REL-Q06`, adapter package/security rows | Open; mock evidence cannot impersonate live evidence. |
| `D18-EDUCATION-ASSETS-083` | Course, case-study, demo, bilingual and executable-doc rows including `REL-DOC01`-`REL-DOC16` where applicable | Open; existing plans are not executable assets. |
| `D8-RUNTIME-CHAOS-084` | `REL-T11`, `REL-T18`, `REL-T27`, `REL-Q04`, deadlock/leak/retry rows | Open. |
| `D9-OPS-CONTROL-085` | `REL-T29`, operational CLI JSON/exit/race rows and relevant support diagnostics | Open. |
| `CTRL-RELEASE-ROLLUP-086` | `REL-V1-01`-`REL-V1-08`, `REL-RC01`-`REL-RC10`, final candidate decision | Open; depends on every blocking evidence producer. |
| `D9-TS-REDACTION-087`, `D9-PY-REDACTION-088`, join `D9-REDACTION-CONFORMANCE-089` | `REL-V1-02`, `REL-I06`, `REL-T26`, `REL-Q08`, `REL-SC07`, `REL-SC12`, `REL-SUP06` | Open/Critical; raw payload plus `redacted: true` remains a release blocker. |

`REL-T26` accepts evidence only when the wire flag is truthful, protection occurs
before every sink write, legacy misleading histories follow the frozen migration
rule, and negative canary fixtures prove that the scanner detects a seeded leak.
Registering these tasks or writing their design documents does not change any
row from Open.

## 18. Final sign-off record

This block stays empty until `REL-V1-08` is decided. A signature without Green
leaf evidence does not authorize stable release.

```text
Decision: [ ] stable v1  [ ] full RC  [ ] no release
Candidate version:
Candidate revision:
Decision rationale:
Open/Partial/Blocked mandatory gates:
Artifact manifest and digests:
Release manager:
Independent reviewer:
Security reviewer:
Decision timestamp (UTC):
Next review date if RC/no release:
```
