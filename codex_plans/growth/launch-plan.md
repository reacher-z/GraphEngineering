# Graph Engineering 21-day organic launch plan

Status: **Approved planning artifact; launch execution is not complete**
Plan epoch: **Day 1 = 2026-07-26, America/Vancouver**
Primary registry owner: `CTRL-GROWTH-072` (`planned`, dependency-blocked)
Document-production owner: `CTRL-DOCS-073` (`in_progress`)
Canonical inputs: [master plan Section 7](../Graph-Engineering-21-Day-Master-Plan.md#7-organic-launch-and-6000-star-target), [release checklist](../delivery/release-checklist.md), [dependency ledger](../delivery/task-dependency-graph.md), and [current source review](../research/graph-engineering-source-review.md)

## 1. Outcome, boundaries, and claim discipline

The launch objective is to make a technically credible Graph Engineering
release easy to understand, try, verify, reuse, and contribute to. The desired
loop is exactly:

```text
clear concept
  -> sixty-second demo
  -> five-minute successful run
  -> shareable trace or Graph Ready score
  -> user pattern or adapter
  -> authentic case study
  -> new user
```

`6,000+` GitHub stars by Day 21 is a **stretch awareness outcome**. It is not a
promise, release gate, forecast, or result the project can manufacture. The
dated popularity-parity reference is 9,416 stars for Loop Engineering on
2026-07-26; it is a moving benchmark and must not be presented as current
without a fresh, timestamped source. Stable-v1 eligibility is controlled by
recovery, security, conformance, provenance, external usability, and every
mandatory release row—not stars.

The following are prohibited without exception:

- purchasing stars, followers, traffic, reviews, downloads, or testimonials;
- bots, scripted account actions, click farms, giveaway-for-star campaigns,
  reciprocal or coordinated star rings, and fake adopters;
- bulk unsolicited direct messages, scraped contact lists, repeated
  cross-posting against a community's rules, or undisclosed sponsorship;
- implying an endorsement by Anthropic, Andrew Ng, OpenAI, a tester, adopter,
  or community that has not explicitly granted it;
- calling an unexecuted demo, benchmark, case study, security property,
  production adapter, or release gate complete; and
- treating high reach or star counts as proof of successful runs, retention,
  safety, or production readiness.

These conduct rules are mandatory under `REL-GR01`; the channel disclosure and
release-manager attestation remain **Open**. Every action in this document is
organic and must be cancelled if it cannot meet that row.

## 2. Status truth table

This table prevents a prepared plan from being confused with executed launch
work. “Verified current” refers only to repository-local or already-recorded
evidence; it does not turn an open release-checklist row Green.

| Surface | Current state on 2026-07-26 | Evidence and limitation | Registry / release rows |
| --- | --- | --- | --- |
| Public source repository and source release | **Verified current** | The public repository and `v0.1.0-alpha.1` source release are recorded in the [master plan](../Graph-Engineering-21-Day-Master-Plan.md); package-registry publication is not inferred | `D1-BRAND-001`, `D5-SECURITY-RELEASE-008`; `REL-SC01-SC14` remain governed separately |
| Current concept and five-minute guide | **Implemented in alpha, gate not accepted** | [README](../../README.md), [Quickstart](../../docs/QUICKSTART.md), deterministic graph fixture, and native example scripts exist; no accepted external 80% five-minute cohort yet | `D1-DOCS-001`, `D1-PLATFORM-001`, `D5-DX-RELEASE-AUDIT-007`; `REL-DOC01`, `REL-Q10` Open |
| Native TypeScript/Python alpha and local durable start/resume | **Verified current, bounded scope** | Current docs and registry show both runtimes and immutable local-DAG durable recovery; later leases/replay/fork/adapters are not implemented | `D1-TS-001`, `D1-PY-001`, `D6-DURABLE-CONFORMANCE-011`; `REL-DOC05-DOC06` Open |
| Alpha 1 release beat | **Artifact exists; campaign publication unverified** | A release artifact is not evidence that channel-specific Alpha 1 launch posts or metrics snapshots ran | `D5-LAUNCH-READINESS-009`, `CTRL-GROWTH-072`; `REL-GR02-GR05` Open |
| Pipeline milestone | **In progress** | Native/conformance completion and release gates are not yet closed | `D7-PY-PIPELINE-012`, `D7-PIPELINE-CONFORMANCE-013`; relevant claims must wait |
| Graph Ready, adapters, Explorer, benchmarks, Beta, RC, stable release | **Planned / not implemented or not accepted** | These are downstream dependencies, not content-ready facts | `D13-DX-051`, `D13-ADAPTERS-049`, `D15-EXPLORER-060`, `D15-PERFORMANCE-061`, `D17-BETA-063`, `D19-RC-065`, `D21-RELEASE-067`; `REL-DOC02-DOC16`, `REL-GR02` Open |
| Organic metrics and experiments | **Planned / not collected by this plan** | No dashboard, timestamped funnel snapshot, experiment result, or 6,000-star result is asserted here | `CTRL-GROWTH-072`; `REL-GR03-GR06` Open |
| Community and support operation | **Foundation exists; launch operation Open** | Governance, contribution, support, and security files exist, but launch roster, dry runs, response evidence, and adopter workflow are not accepted | `D1-DOCS-001`, `D21-RELEASE-067`; `REL-GR07`, `REL-SUP01-SUP08` Open |

`CTRL-GROWTH-072` depends on `D13-DX-051` and `D15-EXPLORER-060` and is
currently `planned`. Writing these three growth plans is allowed under the
unblocked `CTRL-DOCS-073`; it does not satisfy the growth task's implementation,
site, asset, metric, external-evidence, or support requirements.

## 3. Success hierarchy

When objectives conflict, use this order:

1. **Safety and truth:** no unsafe release, secret disclosure, false claim,
   fabricated proof, prohibited promotion, or missing attribution.
2. **First success:** a qualified visitor can select the correct language,
   install from a verified source, run the deterministic mock, and understand
   the output in five minutes.
3. **Repeated value:** the repository runs a useful graph again at least seven
   days later, with failure/recovery behavior understood.
4. **Authentic adoption:** users publish consented usage, patterns, traces, case
   studies, issues, or integrations.
5. **Healthy contribution:** outside contributors can find, validate, submit,
   and receive a timely response to meaningful work.
6. **Awareness:** visits, shares, and organic stars grow because the earlier
   layers are useful.

The controlled leading goals from the master plan are 2,000 CLI downloads, 500
successful or explicitly self-reported runs, ten public adopters, ten outside
contributors, twenty-five external PRs, response-time p50 below twelve hours,
and ten personalized trial invitations. These are targets, not facts or
guarantees. The measurement contract is in
[metrics-and-experiments.md](./metrics-and-experiments.md).

## 4. Audience and evidence-backed positioning

### A1 — Agent and framework builders

- Problem: multi-step agents become implicit linear chains, lose failure
  structure, and mix orchestration with model judgment.
- Present-alpha proof: typed graph IR, explicit entrypoints, native schedulers,
  structured failures, deterministic parallel graph example, and local durable
  start/resume.
- Future proof required before claim: dynamic bounded cycles, verifier panels,
  official provider adapters, budgets, and isolation.
- CTA: run the deterministic Quickstart, inspect the graph, then file a concrete
  missing-contract issue.
- Mapping: `D1-SPEC-001`, `D4-PATTERNS-004`, `D6-DURABLE-CONFORMANCE-011`,
  later `D7-CYCLE-CONFORMANCE-027`/`D11-VERIFY-CONFORMANCE-043`;
  `REL-DOC01`, `REL-DOC04-DOC06`, `REL-GR06-GR07`.

### A2 — TypeScript and Python platform teams

- Problem: orchestration semantics drift across SDKs and failures become
  language-specific surprises.
- Positioning: one portable Graph IR and shared fixtures, with native runtimes
  rather than a thin client in one language.
- Proof required: candidate-bound `X01-X10` conformance, executable side-by-side
  examples, and platform matrices; current alpha is narrower.
- CTA: reproduce the same fixture in both languages and report any divergence.
- Mapping: `D1-TS-001`, `D1-PY-001`, `D7-PIPELINE-CONFORMANCE-013`, later
  `D18-COMPAT-BENCH-064`; `REL-DOC06`, `REL-X01-X10`, `REL-Q05`.

### A3 — Reliability, security, and developer-tool maintainers

- Problem: retries, resume, shell/network access, and parallel writers make
  agent demos unsafe when failure boundaries are vague.
- Present-alpha proof: structured failures, bounded scheduler attempts, local
  persistence integrity, read-only MCP, and explicit current limitations.
- Claims withheld: worktree/process/container isolation, distributed leases,
  secret-safe durable payloads, mutating MCP, and production security are
  targets until their gates pass.
- CTA: review threat/failure contracts, reproduce a fixture, or contribute a
  negative test—never test a vulnerability in public issues.
- Mapping: `D2-MCP-001`, `D6-DURABLE-CONFORMANCE-011`, later
  `D12-ISOLATION-REDTEAM-047`/`D16-SECURITY-062`; `REL-DOC05`, `REL-DOC10`,
  `REL-SUP02`, `REL-SUP05-SUP06`.

### A4 — Educators, researchers, and technical creators

- Problem: graph architecture is compelling conceptually but hard to teach as
  reproducible, bounded software.
- Positioning: a fourteen-step executable path from fake-edge audit to bounded
  self-routing, with “when not to use a graph.”
- Proof required: runnable checks and attribution review; inspiration is not an
  endorsement or private API compatibility claim.
- CTA: try one lesson or pattern and publish an independent result with its
  version and limitations.
- Mapping: `D14-PATTERN-SKELETONS-053`, `CTRL-PATTERNS-071`,
  `CTRL-DOCS-073`; `REL-DOC04`, `REL-PAT00-PAT10`, `REL-GR07`.

### A5 — Open-source contributors and early adopters

- Problem: promising projects often lack scoped issues, response expectations,
  reproducible failures, and recognition grounded in real work.
- Positioning: explicit governance, security path, pattern requests, review
  gates, and honest RC fallback.
- CTA: choose a labeled issue, submit a reproducible pattern/trace, or join a
  consented usability session.
- Mapping: `D1-DOCS-001`, `D17-BETA-063`, `D21-RELEASE-067`;
  `REL-GR07`, `REL-SUP01-SUP08`, `REL-Q10-Q11`.

## 5. Message architecture and bilingual contract

### One-sentence concept

English:

> Prompts describe work; loops repeat work; Graph Engineering makes branching,
> verification, durable state, and convergence explicit and portable.

Chinese:

> Prompt 描述工作，loop 重复工作；Graph Engineering 把分支、验证、持久状态和收敛变成显式且可移植的图协议。

### Proof stack

Every public asset uses the same sequence:

1. state the user problem without attacking a competitor;
2. show one real graph and the exact candidate/version;
3. show the command and unedited result or reproducible fixture;
4. name the failure/recovery/safety boundary;
5. distinguish current behavior from target-v1 behavior;
6. offer one useful CTA: run, inspect, report, contribute, or opt into a study;
7. link to source, not a cropped result alone.

English is canonical for technical contracts. Chinese launch copy must preserve
version, commands, support level, known limits, security language, at-least-once
effect semantics, telemetry default, and RC/stable label. Translation may adapt
examples and idiom but cannot strengthen claims. One English reviewer, one
Chinese reviewer, and the relevant technical owner approve the pair. Any source
change invalidates both variants. Mapping: `CTRL-DOCS-073`,
`CTRL-GROWTH-072`; `REL-DOC13-DOC16`, `REL-GR02`.

## 6. Asset dependency and acceptance matrix

No asset publishes merely because a calendar slot arrives. “Ready” means the
listed product evidence exists, the claim review passes, and the exact asset is
recorded in the launch manifest.

| Asset | Earliest evidence dependency | Required acceptance evidence | Owner | Registry / release rows | Current status |
| --- | --- | --- | --- | --- | --- |
| 60-second Quickstart | Current mock-first CLI/fixture plus external study | At most three user commands; clean install transcript; English/Chinese parity; at least 80% of accepted tester cohort succeeds within five minutes | `PQG` + `TSR/PYR` + `EXT` | `D1-PLATFORM-001`, `D17-BETA-063`; `REL-DOC01`, `REL-Q10` | Source guide exists; asset/gate **Open** |
| 90-second uncut terminal demo | Frozen candidate and clean packaged install | Uncut recording, source script, timestamp, candidate digest, no hidden repair | `PQG` + `INT` | `D19-RC-065`; `REL-DOC02`, `REL-DOC16` | **Open** |
| Linear-versus-graph visualization | Real topology/event fixture; Explorer only when implemented | Source/deploy revision, deterministic fixture, smoke/accessibility evidence, limitations | `PQG` | `D5-CLI-VISUALIZE-005`, later `D15-EXPLORER-060`; `REL-DOC03`, `REL-DOC11` | Static CLI visualization exists; interactive asset **Open** |
| Fourteen-step executable roadmap | Runtime prerequisites and all lesson checks | Course manifest, fourteen runnable checks, failure paths, “when not to use,” attribution audit | `PQG` + domain owners | `D14-PATTERN-SKELETONS-053`, `CTRL-PATTERNS-071`; `REL-DOC04`, `REL-PAT00-PAT10` | **Open** |
| Architecture essay | API/IR freeze and security/recovery truth | Claim-to-spec cross-reference, independent review, explicit target/current labels | `INT` + `SRV` | `D14-API-FREEZE-050`, `D16-SECURITY-062`; `REL-DOC05`, `REL-SUP04` | **Open** |
| Side-by-side TS/Python examples | Shared fixture and candidate parity | Executable docs test and `X01-X10` evidence | `TSR/PYR` + `PQG` | `D18-COMPAT-BENCH-064`; `REL-DOC06`, `REL-X01-X10` | Narrow examples exist; gate **Open** |
| Performance/recovery benchmark | Storage/Explorer candidate and stable baseline | Script, raw data, environment, revision, baseline, variance, failure cases; >10% regression handled | `PQG` + runtime owners | `D15-PERFORMANCE-061`, `D18-COMPAT-BENCH-064`; `REL-DOC07`, `REL-Q07` | **Open** |
| Four case studies, one failure | Reproducible trace and consent when external | Source/trace, reproduction, limits, consent, claim review; failure not sanitized away | `PQG` + `EXT` | `D11-VERIFY-CONFORMANCE-043`, `D17-BETA-063`; `REL-DOC08`, `REL-DOC12` | **Open/External** |
| Graph Ready G0-G4 badge | Deterministic score implementation | Repeatability fixtures, top three remediation actions, badge output | `PQG` | `D13-DX-051`; `REL-DOC09` | **Open** |
| Pattern picker and guides | Ten complete bundles | Bundle manifest, verified failure/resume, budgets/permissions, reviewer | `PQG` + native lanes | `D14-PATTERN-SKELETONS-053`, `CTRL-PATTERNS-071`; `REL-DOC10`, `REL-PAT00-PAT10` | **Open** |
| Interactive showcase | Explorer and deterministic examples | Source/deploy revision, smoke/a11y tests, accurate state/budget/replay views | `PQG` | `D15-EXPLORER-060`; `REL-DOC11` | **Open** |
| Adopter and trace galleries | Real opt-in submissions | Consent scope/date, redacted entry, current URL, withdrawal path, reviewer | `COMM` + `EXT` | `D17-BETA-063`, `CTRL-GROWTH-072`; `REL-DOC12`, `REL-GR07`, `REL-SUP06` | **Open/External** |
| EN/ZH launch summaries | Frozen candidate/known-limit list | Bilingual diff, version/link audit, technical owner sign-off | `PQG` + bilingual reviewer | `D19-RC-065`, `CTRL-DOCS-073`; `REL-DOC13`, `REL-DOC16` | **Open** |
| Channel-specific launch set | Every referenced asset is accepted | Copy manifest, channel-rule check, UTM audit, disclosure, schedule, owner | `COMM` + `RM` | `CTRL-GROWTH-072`, `D21-RELEASE-067`; `REL-DOC14`, `REL-GR01-GR02` | **Open** |

## 7. Channel adaptation and organic distribution

One canonical evidence packet may be adapted; identical spam blasts are not an
acceptable distribution plan. Before posting, the owner must verify current
community rules and account permissions. “External” means the repository cannot
prove or perform the action alone.

| Channel | Native format and audience fit | First CTA | Adaptation rule | Organic/permission guardrail | UTM source | Mapping |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub repository/release | Durable source of truth: README hero, release notes, demo, discussions, issues | Run deterministic Quickstart | Put commands, version, limitations, and contribution route before marketing copy | Requires repository/release authority; never rewrite release history or hide RC label | `github` | `D19-RC-065`, `D21-RELEASE-067`; `REL-DOC01`, `REL-DOC16`, `REL-GR07`, `REL-SUP02` |
| Hacker News | Concise “Show HN” with problem, implementation, trade-offs, technical evidence | Inspect/run source | Lead with what works today and invite technical criticism; no engagement pod or vote solicitation | Follow current Show HN rules; disclose affiliation; one canonical submission, no brigading | `hackernews` | `CTRL-GROWTH-072`; `REL-DOC14`, `REL-GR01-GR02`, `REL-GR06` |
| X | Short visual thread: concept, topology, uncut clip, limit, source | Watch then run | Use one idea per post and alt text; replies answer evidence questions, not repeat CTA | Requires authorized account; no automated replies/likes/follows/DMs, paid amplification, or copied third-party media | `x` | `CTRL-GROWTH-072`; `REL-DOC02-DOC03`, `REL-DOC14`, `REL-GR01-GR02` |
| LinkedIn | Engineering narrative and architectural decision with measured result | Read architecture/case | Explain team/reliability implications; avoid inflated “revolutionary” claims | Disclose maintainer relationship and any employer/community connection; no automated outreach | `linkedin` | `D14-API-FREEZE-050`; `REL-DOC05`, `REL-DOC08`, `REL-DOC14`, `REL-GR01` |
| Reddit | Community-specific technical write-up and reproducible example | Discuss trade-offs / run fixture | Select only genuinely relevant communities; rewrite for their rules and answer in-thread | Check self-promotion ratio and moderator rules; no mass cross-post or vote request | `reddit` | `CTRL-GROWTH-072`; `REL-DOC06`, `REL-DOC10`, `REL-DOC14`, `REL-GR01` |
| Dev.to | Searchable tutorial with complete code and failure path | Complete one pattern | Teach first; canonical link and version at top; update stale commands | Respect canonical/AI-content/disclosure rules; do not duplicate copyrighted source text | `devto` | `CTRL-DOCS-073`, `CTRL-PATTERNS-071`; `REL-DOC04`, `REL-DOC10`, `REL-DOC14` |
| Chinese developer communities | Chinese-native explainer/tutorial for communities such as Juejin, V2EX, SegmentFault, Zhihu, or WeChat where permitted | 中文 Quickstart / 复现实验 | Translate meaning, not only words; retain exact CLI/version/security limits and link canonical English contract | Verify each community's rules and account authority; do not scrape/contact users or imply endorsement | `cn_<community>` | `CTRL-DOCS-073`, `CTRL-GROWTH-072`; `REL-DOC13-DOC14`, `REL-GR01-GR02` |
| Direct maintainer/creator invitations | One-to-one, relevant, personalized request to test a specific workflow | Opt into a trial; no star ask | State why the person's public work makes the trial relevant and offer an easy decline | Maximum ten in plan; manual only; no scraped private data, repeat follow-up, or expectation of coverage/star | `invite` | `D17-BETA-063`, `CTRL-GROWTH-072`; `REL-GR01`, `REL-GR04`, `REL-Q10-Q11` |

## 8. Twenty-one-day execution schedule

The day number is a dependency-aware campaign slot, not permission to publish an
unverified claim. If a product gate slips, replace the intended release claim
with an honest build note or leave the slot empty. Historical milestones may be
documented retrospectively only with their actual date and evidence.

| Day | Organic action and deliverable | Publish condition / fallback | Owner | Registry IDs | Release rows |
| ---: | --- | --- | --- | --- | --- |
| `1` | Freeze concept sentence, audiences, conduct policy, source links, channel accounts/permissions, and bilingual glossary | Publish only a repository-foundation note backed by current files; otherwise prepare internally | `INT`, `PQG`, `COMM` | `D1-SPEC-001`, `D1-BRAND-001`, `D1-DOCS-001`, `CTRL-DOCS-073` | `REL-GR01`, `REL-GR07`, `REL-DOC05`, `REL-DOC13` |
| `2` | Show nodes, typed data edges, explicit entrypoints, and cross-language contract; solicit one contract review | Use current canonical fixture; do not claim general builders/YAML or component hashes until `D2-BUILDERS-YAML-020` | `INT`, `TSR/PYR`, `PQG` | `D1-SPEC-001`, `D2-BUILDERS-YAML-020` | `REL-DOC05-DOC06`, `REL-GR02` |
| `3` | Run the current Quickstart internally from a clean checkout; draft EN/ZH 60-second script and tester form | Public “under five minutes” claim waits for `REL-Q10`; failures become onboarding issues | `PQG`, `TSR/PYR` | `D1-PLATFORM-001`, `D3-CLI-002`, `D3-PY-CLI-021` | `REL-DOC01`, `REL-Q10`, `REL-GR06` |
| `4` | Demonstrate chain versus diamond and explain real versus fake edges; capture deterministic topology | Use actual fixture/events; label static visualization versus future Explorer | `PQG`, `TSR/PYR` | `D4-TS-PRIMITIVES-003`, `D4-PY-PRIMITIVES-004`, `D5-CLI-VISUALIZE-005` | `REL-DOC03`, `REL-DOC06`, `REL-GR02` |
| `5` | Teach pipeline versus barrier and publish benchmark method before results | Release result only after pipeline conformance and reproducibility review; otherwise explain test design | `TSR/PYR`, `PQG` | `D7-PIPELINE-CONFORMANCE-013`, `D15-PERFORMANCE-061` | `REL-DOC07`, `REL-Q07`, `REL-GR02` |
| `6` | Explain structured failures, deterministic routing, and why null is not a failure value; open scoped feedback thread | Claim only implemented primitive/runtime behavior; integrated durable quorum waits remain withheld | `INT`, `PQG` | `D5-TS-ROUTER-005`, `D5-PY-ROUTER-005`, `D6-ROUTER-BARRIER-023` | `REL-DOC05`, `REL-DOC10`, `REL-GR07` |
| `7` | Alpha 1 + discovery/loop concept beat; record star/install/run snapshots as outcomes | Source alpha exists, but bounded cycles/discovery demo publish only after its exact fixture passes; otherwise retrospective alpha note | `RM`, `PQG`, `COMM` | `D5-LAUNCH-READINESS-009`, `D7-CYCLE-CONFORMANCE-027` | `REL-GR02-GR04`, `REL-DOC14`, `REL-RC03` |
| `8` | Publish bounded retry/cancellation failure injection and invite adversarial reproductions | Wait for chaos evidence; any unbounded path pauses promotion and opens P0/P1 incident | `TSR/PYR`, `SRV`, `PQG` | `D8-CHAOS-OPS-030` | `REL-DOC08`, `REL-DOC10`, `REL-Q08`, `REL-GR06` |
| `9` | Crash/resume beat with an unedited failure-and-recovery trace and explicit local-DAG scope | Current narrow recovery may be shown if revision-bound; lease/replay/fork claims wait for D9 extension | `TSR/PYR`, `PQG` | `D6-DURABLE-CONFORMANCE-011`, `D9-DURABLE-EXT-CONFORMANCE-034` | `REL-DOC02`, `REL-DOC05`, `REL-DOC08`, `REL-GR02` |
| `10` | Explain budget/model-routing contract and publish cost methodology, not speculative savings | No savings/performance claim until shared budget fixtures and provider accounting pass | `INT`, `TSR/PYR`, `PQG` | `D10-BUDGET-CONFORMANCE-038` | `REL-DOC05`, `REL-DOC07`, `REL-GR02` |
| `11` | Verifier/reflection/citation demo; ask users to try to refute one finding | Publish only candidate-bound votes/evidence including unknown/abstention; otherwise design note | `TSR/PYR`, `PQG`, `SRV` | `D11-VERIFY-CONFORMANCE-043`, `PATTERN-02-CITED`, `PATTERN-04-DIFF` | `REL-PAT02`, `REL-PAT04`, `REL-DOC08`, `REL-GR02` |
| `12` | Security/isolation architecture note and threat-model review invitation | Never present target capability/worktree/process/container controls as implemented; private disclosure path only for vulnerabilities | `INT`, `SRV`, `PQG` | `D12-ISOLATION-SPEC-044`, `D12-ISOLATION-REDTEAM-047` | `REL-DOC05`, `REL-DOC10`, `REL-GR07`, `REL-SUP02` |
| `13` | Dual-language Alpha 2 beat, side-by-side TS/Python run, Graph Ready preview, outcome snapshot | Alpha 2 label and Graph Ready badge require exact candidate and passing gates; otherwise parity progress note | `RM`, `TSR/PYR`, `PQG` | `D13-DX-051`, `D14-API-FREEZE-050` | `REL-DOC06`, `REL-DOC09`, `REL-GR02-GR04` |
| `14` | Release executable roadmap tranche and ten-pattern map; invite scoped pattern contributions | Label skeleton versus complete bundle; no directory-count success claim | `PQG`, `TSR/PYR`, `COMM` | `D14-PATTERN-SKELETONS-053`, `CTRL-PATTERNS-071`, `PATTERN-01-RESEARCH` through `PATTERN-10-ECOSYSTEM` | `REL-PAT00-PAT10`, `REL-DOC04`, `REL-DOC10`, `REL-GR07` |
| `15` | Benchmarks + Explorer beat with interactive linear/graph and recovery views | Publish only reproducible candidate-bound data and tested deployment; >10% unexplained regression blocks | `PQG`, `TSR/PYR` | `D15-EXPLORER-060`, `D15-PERFORMANCE-061` | `REL-DOC03`, `REL-DOC07`, `REL-DOC11`, `REL-Q07`, `REL-GR02` |
| `16` | Share security-testing method and known-limit draft; recruit last external usability sessions | No “secure” blanket claim; seeded-secret or high/critical failure stops campaign and invokes incident path | `SRV`, `PQG`, `COMM` | `D16-SECURITY-062`, `D17-BETA-063` | `REL-Q08`, `REL-SUP05-SUP06`, `REL-GR06` |
| `17` | Tester-backed Beta beat, first-success cohort results, authentic adopter/trace entries, outcome snapshot | Requires real consented testers and no P0/P1 defect; otherwise continue private/RC testing without “tester-backed” claim | `RM`, `PQG`, `EXT` | `D17-BETA-063`, `CTRL-GROWTH-072` | `REL-Q10-Q11`, `REL-DOC08`, `REL-DOC12`, `REL-GR02-GR05` |
| `18` | Publish compatibility/scale report and one success plus one failure case; finish channel drafts | Candidate matrix, raw benchmark data, consent, and claim audit required | `INT`, `TSR/PYR`, `PQG` | `D18-COMPAT-BENCH-064`, `CTRL-DOCS-073` | `REL-Q05-Q07`, `REL-DOC07-DOC08`, `REL-DOC13-DOC14` |
| `19` | RC + security story, known-limit manifest, clean install/upgrade evidence; prebrief support | Stable language forbidden; use RC unless every stable gate is Green | `RM`, `SRV`, `PQG`, `SUP` | `D19-RC-065`, `D16-SECURITY-062` | `REL-DOC15-DOC16`, `REL-GR02`, `REL-SUP01-SUP08`, `REL-RC01-RC10` |
| `20` | Provenance explainer, source-to-package verification, final bilingual/channel audit, launch rehearsal | No package/install CTA to unverified coordinates; external registry/site authority must be demonstrated | `RM`, `SRV`, `PQG` | `D20-PROVENANCE-066`, `CTRL-ACCEPTANCE-070`, `CTRL-DOCS-073` | `REL-Q08-Q09`, `REL-DOC13-DOC16`, `REL-GR01-GR07`, `REL-SUP01-SUP08` |
| `21` | Coordinated GitHub/site/content/community release or transparent complete-RC launch; staff support; capture outcome snapshot | Publish stable only on conjunctive Green decision; otherwise say complete RC and list blockers. Report 6,000+ only if observed | `RM`, `COMM`, `SUP`, all lanes | `D21-RELEASE-067`, `CTRL-GROWTH-072`, `CTRL-ACCEPTANCE-070`, `CTRL-PATTERNS-071` | `REL-GR01-GR07`, `REL-SUP01-SUP08`, `REL-RC01-RC10`, `REL-V1-01-V1-08` |

## 9. Launch-day operating sequence

Each step below is an action, not a current completion claim.

### T minus 24 hours

1. `RM` freezes candidate revision, version, artifact manifest, known-limit list,
   and stable/RC decision input. Mapping: `D19-RC-065`,
   `D20-PROVENANCE-066`; `REL-DOC16`, `REL-RC01-RC09`.
2. `SRV` verifies security/provenance evidence and confirms there is no open
   accepted-high/critical exception hidden from copy. Mapping:
   `D16-SECURITY-062`, `D20-PROVENANCE-066`; `REL-Q08-Q09`, `REL-SUP05-SUP06`.
3. `PQG` reruns every published command/link and bilingual claim against the
   frozen identity. Mapping: `CTRL-DOCS-073`, `CTRL-ACCEPTANCE-070`;
   `REL-DOC01-DOC16`.
4. `COMM` validates channel rules, owners, disclosure, accessibility, UTM
   values, and scheduled-copy identity. Mapping: `CTRL-GROWTH-072`;
   `REL-GR01-GR02`, `REL-DOC14`.
5. `SUP` acknowledges coverage and performs issue/discussion/incident/security
   route dry runs. Mapping: `D21-RELEASE-067`; `REL-SUP01-SUP08`.

### Launch window

1. Publish GitHub Release and canonical site/README first, using stable or RC
   exactly as decided. Mapping: `D21-RELEASE-067`; `REL-DOC16`,
   `REL-RC02-RC06`.
2. Verify every install link and checksum from an unauthenticated clean
   environment before external amplification. Mapping: `D20-PROVENANCE-066`;
   `REL-Q09`, `REL-PKG01-PKG11`.
3. Release channel posts in a staggered order so support can observe failures:
   owned GitHub, one primary technical community, then social/tutorial channels.
   Mapping: `CTRL-GROWTH-072`; `REL-GR01-GR02`, `REL-GR06`.
4. Pin one limitations/support message and answer technical questions with links
   to exact evidence. Mapping: `D21-RELEASE-067`; `REL-SUP02`, `REL-SUP04`.
5. Record aggregate, timestamped snapshots; do not store raw prompt/run content
   or private messages. Mapping: `CTRL-GROWTH-072`; `REL-GR03-GR05`,
   `REL-SUP06`.

### T plus 2, 6, and 24 hours

At each checkpoint `RM`, `COMM`, `SUP`, and one runtime owner review install
failures, successful runs, open P0/P1 defects, support age, security reports,
channel moderation, and privacy complaints. They choose exactly one state:

- **continue:** candidate and funnel health meet thresholds;
- **narrow:** pause weak channels and focus on supported use cases;
- **pause promotion:** installs do not become successful runs, support is
  overloaded, or evidence is ambiguous;
- **incident:** safety, security, data loss, corrupt artifact, package defect,
  or false candidate identity is suspected; or
- **retract/supersede copy:** a claim or link is false even when code is sound.

Mapping: `D21-RELEASE-067`, `CTRL-GROWTH-072`; `REL-GR06`,
`REL-SUP01-SUP08`, `REL-RC06-RC10`.

## 10. External authority and consent gates

Planning does not confer account access or consent.

| External action | Minimum authority/evidence before action | If absent | Mapping |
| --- | --- | --- | --- |
| Push/tag/GitHub Release/change repository settings | Authenticated repository role, protected-branch/release policy, exact candidate decision | Prepare draft only; do not imply publication | `D19-RC-065`, `D21-RELEASE-067`; `REL-SC01`, `REL-RC02` |
| Publish npm/PyPI | Verified package ownership/trusted publisher and provenance rehearsal | Link source install only if truthful; do not publish/squat | `D20-PROVENANCE-066`; `REL-Q09`, `REL-SUP03` |
| Deploy site/showcase | Hosting authority, candidate-bound deployment, smoke/accessibility/privacy check | Keep source-local preview; no live URL claim | `D15-EXPLORER-060`, `D21-RELEASE-067`; `REL-DOC03`, `REL-DOC11`, `REL-DOC16` |
| Post to social/community accounts | Authorized human owner, current rules reviewed, disclosure accepted | Save draft; do not automate or impersonate | `CTRL-GROWTH-072`; `REL-GR01-GR02`, `REL-DOC14` |
| Publish adopter logo/name/quote/trace | Explicit scoped consent, redaction review, source/URL, withdrawal contact | Omit entry; never create a placeholder that looks real | `D17-BETA-063`; `REL-DOC08`, `REL-DOC12`, `REL-GR07`, `REL-SUP06` |
| Send a personalized invitation | Publicly relevant contact route or prior consent; manual individualized message | Do not scrape, buy, infer private address, or repeatedly follow up | `CTRL-GROWTH-072`; `REL-GR01`, `REL-GR04` |
| Publish external tester result | Consent for aggregate/public use, sampling notes, anonymization, exact candidate | Report “evidence not available”; stable remains blocked where required | `D17-BETA-063`; `REL-Q10-Q11`, `REL-GR04-GR05` |
| Publish security finding/resolution | Security owner approval and disclosure timeline; no live exploit/secret | Use private security path and generic status message | `D16-SECURITY-062`; `REL-SUP02`, `REL-SUP05-SUP06` |

## 11. Support, crisis, and reputation response

### Severity and first response

| Severity | Trigger | Immediate action | Public posture | Registry / rows |
| --- | --- | --- | --- | --- |
| `SEV0` | Credential/secret exposure, isolation escape, malicious package, active supply-chain compromise | Stop all promotion and affected distribution; preserve redacted evidence; rotate/revoke through authorized humans; security incident lead takes control | Short verified status only; no exploit details before coordinated disclosure | `D16-SECURITY-062`, `D20-PROVENANCE-066`; `REL-Q08-Q09`, `REL-SUP02`, `REL-SUP05-SUP06`, `REL-RC06-RC09` |
| `SEV1` | Data loss/corruption, duplicate non-idempotent effect, unusable package, widespread install/run failure, false stable identity | Pause campaign; deprecate/disable safely; publish workaround/known limit; open incident | Acknowledge impact, scope, workaround, next update; no blame or false ETA | `D21-RELEASE-067`; `REL-SUP03-SUP05`, `REL-SUP08`, `REL-RC06-RC10` |
| `SEV2` | Reproducible functional defect or major docs mismatch with bounded workaround | Stop the affected CTA/channel; triage owner and fix/forward version | Correct the claim/link and connect reports to one canonical issue | `D18-COMPAT-BENCH-064`, `D21-RELEASE-067`; `REL-GR06`, `REL-SUP02`, `REL-SUP04` |
| `SEV3` | Question, feature request, isolated confusion, civil criticism | Triage, reproduce, answer with evidence, label/route | Thank reporter, avoid defensiveness, state current boundary | `CTRL-GROWTH-072`; `REL-GR07`, `REL-SUP07` |

Security reports never move to public issues merely to improve response metrics.
Harassment, doxxing, or code-of-conduct violations are moderated under the
published governance path and excluded from growth experiments. Response p50
below twelve hours is a controlled support goal; it does not authorize rushed,
unsafe fixes. If p50 exceeds twelve hours or the oldest ordinary launch item
exceeds twenty-four hours, stop new promotional beats until the queue returns
to capacity. Mapping: `D21-RELEASE-067`; `REL-SUP01-SUP02`, `REL-SUP05`,
`REL-SUP07`, `REL-GR06-GR07`.

## 12. Launch decision and evidence packet

The launch owner creates one immutable/superseding evidence packet per beat. It
must contain:

- beat ID, candidate version/revision, asset digest, and actual publication
  timestamp or explicit `not_published` state;
- proof source for every feature, benchmark, adoption, or security claim;
- English/Chinese/channel copy revisions and claim-review identities;
- channel URL, disclosure, rules-check date, authorized owner, and UTM values;
- aggregate metric snapshot, data source, query/collection method, dedup rule,
  privacy/retention notes, and missing-data label;
- support/incident state and whether any pause/stop condition fired;
- external consent/authority references without embedding private messages,
  secrets, raw prompts, or user data; and
- reviewer, decision, exceptions, next review, and superseded packet link.

Expected evidence belongs under the future
`codex_logs/release-evidence/growth/` structure defined by the delivery
controls; this plan does not create or fabricate those records. Mapping:
`CTRL-GROWTH-072`, `CTRL-ACCEPTANCE-070`, `D21-RELEASE-067`;
`REL-GR01-GR07`, `REL-DOC12-DOC16`, `REL-SUP01-SUP08`.

## 13. Exit conditions

### Growth-plan execution is complete only when

- every required asset has an accepted evidence packet or is explicitly listed
  as missing; `REL-GR02` and `REL-DOC01-DOC16` cannot become Green from a draft;
- `REL-GR01` has an organic-conduct/disclosure attestation;
- `REL-GR03-GR05` have timestamped, privacy-safe snapshots with stable metric
  definitions and honest missing values;
- `REL-GR06` has at least one recorded funnel diagnosis and owner decision;
- `REL-GR07` and `REL-SUP01-SUP08` have workflow dry-run/operation evidence;
- external adopters, galleries, usability reports, and permissions are real and
  consented; and
- the stable/RC label matches the final conjunctive release decision.

### It is not complete merely because

- these documents exist;
- a release tag or social draft exists;
- the repository receives any particular number of stars;
- a maintainer successfully runs the project;
- a skeleton, mock, screenshot, or generated testimonial resembles adoption; or
- an external account/registry could theoretically be accessed.

If Day 21 arrives with a sound candidate but incomplete stable evidence, the
correct launch is an accurately labeled complete RC with a blocker manifest and
continuing support. If required launch assets themselves are incomplete, even
the complete-RC asset gate stays Open. Mapping: `D21-RELEASE-067`;
`REL-RC01-RC10`, `REL-V1-01-V1-08`.
