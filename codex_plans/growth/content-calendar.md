# Graph Engineering 21-day evidence-gated content calendar

Status: **Calendar prepared; no publication is asserted by this document**
Campaign epoch: **Day 1 = 2026-07-26, America/Vancouver**
Campaign owner: `CTRL-GROWTH-072` (`planned`, blocked on `D13-DX-051` and `D15-EXPLORER-060`)
Document owner: `CTRL-DOCS-073` (`in_progress`)
Related plans: [organic launch plan](./launch-plan.md), [metrics and experiments](./metrics-and-experiments.md), [master plan Section 7](../Graph-Engineering-21-Day-Master-Plan.md#7-organic-launch-and-6000-star-target), and [release checklist](../delivery/release-checklist.md)

## 1. Calendar contract

This is a dependency-aware editorial queue, not an automatic scheduler and not
a record of already-published posts. A row becomes publishable only when its
evidence gate is accepted against the exact revision named in the asset. If the
gate is late, the content owner must choose one of three honest outcomes:

1. **hold** the draft without public implication;
2. **narrow** it to a build note about behavior already verified; or
3. **replace** it with a limitations, test-method, or contributor-request post.

The owner may never fill a calendar slot by upgrading a target to an
implemented claim. `6,000+` Day-21 stars and the intermediate 300/1,000/2,000
star checkpoints are stretch outcomes only. Do not buy, automate, exchange,
give rewards for, or coordinate stars. No post may ask users to star as a
condition of access, support, recognition, or giveaway. Mapping:
`CTRL-GROWTH-072`; `REL-GR01`, `REL-GR03`, `REL-GR06`.

## 2. Editorial states and owner codes

### Publication states

| State | Meaning | Permitted public wording |
| --- | --- | --- |
| `draft` | Copy or asset is being prepared; evidence may be absent | None; internal only |
| `evidence_wait` | Draft exists but a product, review, consent, authority, or candidate gate is Open | None, or a separately reviewed narrow build note |
| `ready` | Exact asset, evidence, claims, permissions, links, and support capacity are approved | Scheduled wording for the accepted candidate only |
| `published` | Authorized human published it and URL/time/copy digest were captured | Describe actual publication and current candidate |
| `held` | Owner intentionally did not publish due to a gate or capacity signal | “Not published”; no substitute success claim |
| `superseded` | A later correction or candidate invalidated the asset | Link correction; retain prior record rather than rewriting history |

All calendar rows begin `draft` or `evidence_wait`. This document does not move
any row to `ready` or `published`. Mapping: `CTRL-DOCS-073` versus
`CTRL-GROWTH-072`; `REL-GR02`, `REL-DOC14-DOC16`.

### Owner codes

| Code | Responsibility | Cannot self-approve |
| --- | --- | --- |
| `RM` | Release label, candidate identity, coordinated go/no-go | Security/provenance or external evidence |
| `INT` | Canonical semantics, claim-to-spec review, integration | Its own R3 release decision |
| `TSR` / `PYR` | Native implementation proof and executable snippets | Cross-language parity alone |
| `PQG` | Docs, demos, site, Explorer, accessibility, asset manifest | Unsupported runtime/security claims |
| `COMM` | Channel adaptation, moderation, outreach, consent, support queue | Account authority, adopter consent, or technical truth |
| `SRV` | Security/privacy/redaction review and incident escalation | Release-manager decision alone |
| `SUP` | Triage rota, support capacity, incident/status operation | Product-gate waivers |
| `EXT` | Real tester, adopter, contributor, account/registry/hosting authority | Cannot be simulated, generated, or inferred |

## 3. Content atom and manifest

Every planned item receives a content ID such as `GE-D09-RECOVERY-EN-X`. Before
it can be `ready`, its manifest must record:

- content ID, day/beat, canonical English source, translated/adapted variants;
- candidate version, source revision, fixture/trace/release evidence, and asset
  digest;
- exact current-versus-target capability table and known-limit paragraph;
- source links and third-party attribution/license status;
- channel, account owner, rule-check date, disclosure, publication window, and
  accessibility fields;
- UTM source/medium/campaign/content values with no personal identifier;
- technical, bilingual, security/privacy where applicable, and release-label
  approvals;
- publication state, actual URL/time if published, correction link if
  superseded, and reason if held; and
- support owner, stop condition, and review time.

Manifest production maps to `CTRL-GROWTH-072` and `CTRL-DOCS-073`;
acceptance maps to `REL-GR01-GR02`, `REL-DOC13-DOC16`, and the source-specific
rows named in the daily calendar.

## 4. Standard daily rhythm

This cadence is a capacity ceiling, not a quota. One strong canonical item may
be adapted only where it is genuinely native to the channel.

| Local time | Action | Owner | Required map |
| --- | --- | --- | --- |
| `08:30` | Inspect registry/dependency state, release checklist, overnight issues, security inbox owner signal, and previous funnel snapshot | `RM`, `COMM`, `SUP` | `CTRL-GROWTH-072`, `D21-RELEASE-067`; `REL-GR06`, `REL-SUP01-SUP02`, `REL-SUP05`, `REL-SUP07` |
| `09:00` | Decide `hold`/`narrow`/`ready`; bind content to a candidate and proof source | `RM`, technical owner | Source registry task; `REL-GR02`, `REL-DOC15-DOC16` |
| `10:00` | Technical and claim review; run snippets/links; compare English/Chinese limitations | `INT` or `TSR/PYR`, `PQG`, bilingual reviewer | `CTRL-DOCS-073`; `REL-DOC06`, `REL-DOC13-DOC16` |
| `11:00` | Channel-rule, disclosure, UTM, consent, accessibility, and support-capacity review | `COMM`, `SRV`, `SUP` | `CTRL-GROWTH-072`; `REL-GR01`, `REL-SUP01`, `REL-SUP06` |
| `12:00-15:00` | Authorized human publishes at most the approved channels, staggered; automation may prepare but not impersonate engagement | `COMM` + `EXT` authority | `D21-RELEASE-067`; `REL-GR01-GR02`, `REL-DOC14` |
| `+2h` | Capture aggregate snapshot; answer technical questions; stop if install/run/support/privacy thresholds fire | `COMM`, `SUP`, runtime owner | `CTRL-GROWTH-072`; `REL-GR04-GR06`, `REL-SUP02`, `REL-SUP06-SUP07` |
| `17:00` | Record decisions, corrections, missing data, and next experiment; no private message or raw user-run content in public evidence | `COMM`, `SRV` | `CTRL-GROWTH-072`; `REL-GR03-GR06`, `REL-SUP06` |

During Day 21, add `+6h` and `+24h` reviews. If support p50 exceeds twelve
hours, the oldest ordinary item exceeds twenty-four hours, any P0/P1 defect is
open, or a security/privacy/package-identity incident is suspected, new
promotion stops. Mapping: `D21-RELEASE-067`; `REL-GR06`, `REL-SUP01-SUP08`,
`REL-RC06-RC10`.

## 5. Twenty-one-day calendar

Target dates below are derived from the plan epoch. They do not override product
dependencies. “Channels” describes prepared adaptations, not guaranteed access
or publication. All external posts require current account and community-rule
authority.

### Days 1-6 — build in public without outrunning the alpha

| Day / target date | Canonical content and honest headline frame | Evidence gate and fallback | Channel adaptations / CTA | Owner | Registry IDs | Release rows | Initial state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `1` / Jul 26 | **Manifesto:** “Prompts describe work. Graphs define what depends on what.” Include product/non-product boundary and current alpha scope | Use canonical IR, governance, and current README. If repository identity is not verified, keep internal | GitHub README/release note; X concept card; LinkedIn design premise; Chinese concept summary. CTA: inspect IR and correct ambiguities | `INT`, `PQG`, `COMM` | `D1-SPEC-001`, `D1-BRAND-001`, `D1-DOCS-001`, `CTRL-DOCS-073` | `REL-DOC05`, `REL-DOC13-DOC14`, `REL-GR01-GR02` | `evidence_wait` |
| `2` / Jul 27 | **Contract lesson:** “An edge exists only when data crosses it.” Show nodes, explicit entrypoints, typed payload, and one rejected graph | Current compiler/fixture only. State that general builders/YAML and component-level hashes are planned. Fallback: fixture walkthrough | Dev.to/Chinese tutorial draft; Reddit only in a relevant programming/agent community. CTA: run validator or submit a negative fixture | `INT`, `TSR/PYR`, `PQG` | `D1-SPEC-001`, `D2-BUILDERS-YAML-020` | `REL-DOC04-DOC06`, `REL-DOC10`, `REL-DOC14`, `REL-GR07` | `evidence_wait` |
| `3` / Jul 28 | **Quickstart:** “See a deterministic research diamond locally.” Publish a 60-second walkthrough draft and command transcript | Internal clean checkout must pass; public five-minute/three-command claim remains gated on external `REL-Q10`. Fallback: explicitly labeled alpha setup guide | GitHub canonical guide; short video draft; EN/ZH command cards. CTA: opt into timed first-run study | `PQG`, `TSR/PYR`, `COMM` | `D1-PLATFORM-001`, `D3-CLI-002`, `D3-PY-CLI-021`, `D17-BETA-063` | `REL-DOC01`, `REL-DOC13`, `REL-GR04`, `REL-Q10` | `evidence_wait` |
| `4` / Jul 29 | **Diamond demo:** “Cut fake edges; let independent nodes run.” Show chain versus diamond and structured settled results | Bind to deterministic example and actual static output. Fallback: diagram-only source note with no speedup claim | X animation/static card; LinkedIn architecture note; Dev.to/Chinese walkthrough. CTA: share a linear workflow that may contain fake edges | `TSR/PYR`, `PQG` | `D4-TS-PRIMITIVES-003`, `D4-PY-PRIMITIVES-004`, `D4-PATTERNS-004`, `D5-CLI-VISUALIZE-005` | `REL-DOC03`, `REL-DOC06`, `REL-GR02` | `evidence_wait` |
| `5` / Jul 30 | **Pipeline method:** “Parallel is a barrier; pipeline lets each item advance.” Publish test design and backpressure/failure questions | `D7-PIPELINE-CONFORMANCE-013` must close for product claim; performance result waits for D15. Fallback: semantics/design note labeled in progress | HN/Reddit only after conformance; shorter X diagram; Chinese technical note. CTA: inspect bounded cases, not star | `TSR/PYR`, `INT`, `PQG` | `D7-PIPELINE-SPEC-012`, `D7-PIPELINE-CONFORMANCE-013`, `D15-PERFORMANCE-061` | `REL-DOC05`, `REL-DOC07`, `REL-Q07`, `REL-GR02` | `evidence_wait` |
| `6` / Jul 31 | **Failure/router lesson:** “A failed node is a structured result, never a silent null.” Include deterministic routing and current integrated-boundary limits | Current primitive/failure evidence only. Do not claim durable quorum/deadline/conditional scheduling before D6 follow-up. Fallback: failure taxonomy tutorial | GitHub Discussion for feedback; Dev.to/Chinese tutorial; X failure card. CTA: contribute a failure fixture | `INT`, `PQG`, `COMM` | `D5-TS-ROUTER-005`, `D5-PY-ROUTER-005`, `D6-ROUTER-BARRIER-023` | `REL-DOC05`, `REL-DOC10`, `REL-DOC14`, `REL-GR07` | `evidence_wait` |

### Days 7-13 — alpha, recovery, budgets, verification, and safety

| Day / target date | Canonical content and honest headline frame | Evidence gate and fallback | Channel adaptations / CTA | Owner | Registry IDs | Release rows | Initial state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `7` / Aug 1 | **Alpha 1 / discovery beat:** “The first source alpha is public; bounded discovery remains on the roadmap.” Capture organic milestone snapshot without promising 300 | Existing source release may be described by actual date/revision. Discovery/cycle demo waits for D7 cycle conformance. Fallback: transparent alpha retrospective and open blockers | GitHub Release recap; HN only if current runnable value and clear limitations justify it; EN/ZH summaries. CTA: run current Quickstart/report friction | `RM`, `PQG`, `COMM` | `D5-SECURITY-RELEASE-008`, `D5-LAUNCH-READINESS-009`, `D7-CYCLE-CONFORMANCE-027` | `REL-GR02-GR04`, `REL-DOC13-DOC16`, `REL-RC03` | `evidence_wait` |
| `8` / Aug 2 | **Chaos lesson:** “Retries, timeouts, and cancellation need hard ceilings.” Show one injected failure and exact exit | Publish only after deterministic chaos evidence shows no unbounded retry and cleanup. Fallback: adversarial test plan | Dev.to/Reddit technical post; X bounded-work card; Chinese test note. CTA: propose/reproduce a bounded failure | `TSR/PYR`, `SRV`, `PQG` | `D8-CHAOS-OPS-030` | `REL-DOC08`, `REL-DOC10`, `REL-Q08`, `REL-GR06` | `evidence_wait` |
| `9` / Aug 3 | **Crash/resume beat:** “What was committed survives; what was not is retried honestly.” Show current immutable-local-DAG recovery and at-least-once boundary | Current D6 conformance supports narrow claim; leases/replay/fork/approval/artifacts wait for D9 extension. Any redaction/privacy blocker narrows payload display | 90-second uncut demo draft; architecture article; EN/ZH recovery diagram. CTA: reproduce crash window locally | `TSR/PYR`, `INT`, `SRV`, `PQG` | `D6-DURABLE-CONFORMANCE-011`, `D9-DURABLE-EXT-CONFORMANCE-034` | `REL-DOC02`, `REL-DOC05`, `REL-DOC08`, `REL-SUP04`, `REL-GR02` | `evidence_wait` |
| `10` / Aug 4 | **Cost/budget method:** “A graph must reserve before it spends.” Explain hard limits, model tiering, and why cheaper is not automatically better | Wait for portable ledger/routing conformance. No cost-saving percentage without reproducible data. Fallback: contract proposal/request for review | LinkedIn architecture note; Dev.to/Chinese cost-contract tutorial; X ledger diagram. CTA: review budget edge cases | `INT`, `TSR/PYR`, `PQG` | `D10-BUDGET-SPEC-035`, `D10-BUDGET-CONFORMANCE-038` | `REL-DOC05`, `REL-DOC07`, `REL-GR02` | `evidence_wait` |
| `11` / Aug 5 | **Verifier beat:** “A finding must survive evidence-aware skeptics; insufficient quorum is unknown.” Demonstrate vote retention/citations/reflection | D11 conformance plus exact pattern fixture must pass. Fallback: rubric and unknown-state design note | X panel diagram; HN/Reddit technical demo if runnable; Chinese verifier tutorial. CTA: try to refute the fixture | `TSR/PYR`, `PQG`, `SRV` | `D11-VERIFY-CONFORMANCE-043`, `PATTERN-02-CITED`, `PATTERN-04-DIFF` | `REL-PAT02`, `REL-PAT04`, `REL-DOC04`, `REL-DOC08`, `REL-GR02` | `evidence_wait` |
| `12` / Aug 6 | **Security architecture:** “Metadata is not a sandbox.” Explain ambient authority, capability targets, and current read-only MCP boundary | Architecture may publish with explicit implemented/target table; enforcement claims wait for D12 red-team. Vulnerabilities use private path | Architecture essay/Discussion; LinkedIn threat-boundary narrative; Chinese safety summary. CTA: threat-model review, not exploit disclosure | `INT`, `SRV`, `PQG` | `D12-ISOLATION-SPEC-044`, `D12-ISOLATION-REDTEAM-047`, `D2-MCP-001` | `REL-DOC05`, `REL-DOC10`, `REL-GR07`, `REL-SUP02`, `REL-SUP05-SUP06` | `evidence_wait` |
| `13` / Aug 7 | **Dual-language Alpha 2 + Graph Ready preview:** “One graph contract, two native runtimes.” Capture 1,000-star stretch snapshot only as observed outcome | Candidate/version, API review, parity, doctor/score fixtures required. If absent, publish a cross-language progress report without Alpha 2/badge claim | GitHub Release draft; Show HN candidate only if substantial; X/LinkedIn/Reddit/Dev.to and EN/ZH variants. CTA: compare fixture outputs | `RM`, `TSR/PYR`, `PQG`, `COMM` | `D13-DX-051`, `D14-API-FREEZE-050`, `D18-COMPAT-BENCH-064` | `REL-DOC06`, `REL-DOC09`, `REL-DOC13-DOC16`, `REL-GR02-GR04` | `evidence_wait` |

### Days 14-18 — education, Explorer, Beta, adoption, and compatibility

| Day / target date | Canonical content and honest headline frame | Evidence gate and fallback | Channel adaptations / CTA | Owner | Registry IDs | Release rows | Initial state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `14` / Aug 8 | **Roadmap/pattern map:** “Fourteen graph-engineering steps, each executable or explicitly pending.” Publish course tranche and complete-bundle standard | Never count skeleton folders as complete. Each lesson/pattern claim needs its runnable artifact, tests, budget, permissions, failure/resume, and guides | Dev.to series hub; GitHub docs; Chinese course index; relevant Reddit tutorial. CTA: adopt one scoped pattern issue | `PQG`, `TSR/PYR`, `COMM` | `D14-PATTERN-SKELETONS-053`, `CTRL-PATTERNS-071`, `PATTERN-01-RESEARCH` through `PATTERN-10-ECOSYSTEM` | `REL-PAT00-PAT10`, `REL-DOC04`, `REL-DOC10`, `REL-GR07` | `evidence_wait` |
| `15` / Aug 9 | **Benchmarks + Explorer:** “See where the graph waited, retried, and recovered.” Publish real topology and reproducible latency/recovery data | Explorer smoke/a11y and benchmark raw data/revision/baseline required; >10% unexplained regression blocks. Fallback: local static visualization and benchmark protocol | Interactive site/GitHub; uncut clip; HN/X/LinkedIn/Chinese demo tailored per channel. CTA: replay exact fixture | `PQG`, `TSR/PYR`, `INT` | `D15-EXPLORER-060`, `D15-PERFORMANCE-061` | `REL-DOC03`, `REL-DOC07`, `REL-DOC11`, `REL-Q07`, `REL-GR02` | `evidence_wait` |
| `16` / Aug 10 | **Safety validation:** “How we try to break the candidate before asking you to trust it.” Share methods, not a blanket secure claim; recruit final tester slots | D16 reports must bind exact candidate; any canary leak/high/critical finding stops promotion. Fallback: state audit is ongoing and list disabled surfaces | Security methods post; EN/ZH known-limits draft; direct manual invitations 7-10 only if capacity exists. CTA: consented test or private disclosure | `SRV`, `PQG`, `COMM`, `SUP` | `D16-SECURITY-062`, `D17-BETA-063`, `CTRL-GROWTH-072` | `REL-Q08`, `REL-GR01`, `REL-GR04`, `REL-SUP02`, `REL-SUP05-SUP06` | `evidence_wait` |
| `17` / Aug 11 | **Tester-backed Beta:** “Real users tried the clean path; here is where they succeeded and failed.” Capture 2,000-star stretch snapshot only if observed | At least five external usability reports, no P0/P1 defect, consent, and accepted sampling; do not fabricate Beta/adopter/gallery evidence | GitHub Beta release; case-study thread/article; adopter/trace gallery preview; EN/ZH summary. CTA: use or report one real workflow | `RM`, `PQG`, `COMM`, `EXT` | `D17-BETA-063`, `CTRL-GROWTH-072` | `REL-Q10-Q11`, `REL-DOC08`, `REL-DOC12-DOC14`, `REL-GR02-GR05` | `evidence_wait` |
| `18` / Aug 12 | **Compatibility and cases:** “Same graph, tested across supported runtimes and platforms.” Publish one success and the required authentic failure story | Full matrix, randomized failures, raw reports, candidate IDs, consent/attribution required. Fallback: partial matrix with missing cells labeled | Technical report on GitHub/Dev.to; LinkedIn lessons; Chinese compatibility summary; community-specific Q&A | `INT`, `TSR/PYR`, `PQG`, `EXT` | `D18-COMPAT-BENCH-064`, `CTRL-ACCEPTANCE-070` | `REL-Q05-Q07`, `REL-DOC06-DOC08`, `REL-DOC13-DOC14`, `REL-GR06` | `evidence_wait` |

### Days 19-21 — RC, provenance, coordinated release, and support

| Day / target date | Canonical content and honest headline frame | Evidence gate and fallback | Channel adaptations / CTA | Owner | Registry IDs | Release rows | Initial state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `19` / Aug 13 | **RC + security story:** “Candidate frozen; here is what passed, what remains, and how recovery/safety actually work.” | Exact RC, clean install/upgrade/migration, security report, known-limit/blocker manifest. Never say stable unless final gate later passes | GitHub RC release; architecture/security essay; EN/ZH summaries; support prebrief. CTA: verify candidate/report defect | `RM`, `SRV`, `PQG`, `SUP` | `D19-RC-065`, `D16-SECURITY-062`, `CTRL-DOCS-073` | `REL-DOC05`, `REL-DOC15-DOC16`, `REL-GR02`, `REL-SUP01-SUP08`, `REL-RC01-RC10` | `evidence_wait` |
| `20` / Aug 14 | **Provenance and launch rehearsal:** “Trace source to package before installing.” Finalize channel-specific drafts but do not preannounce unverified coordinates | Trusted publisher identity, SBOM/checksum/attestation rehearsal, link/claim/bilingual audit, support dry run. Fallback: source-only RC and explicit publication blocker | GitHub provenance guide; technical social preview only after links resolve; personalized reminder only to opted-in testers | `RM`, `SRV`, `PQG`, `COMM`, `SUP` | `D20-PROVENANCE-066`, `CTRL-ACCEPTANCE-070`, `CTRL-GROWTH-072`, `CTRL-DOCS-073` | `REL-Q08-Q09`, `REL-DOC13-DOC16`, `REL-GR01-GR07`, `REL-SUP01-SUP08` | `evidence_wait` |
| `21` / Aug 15 | **Coordinated release or transparent complete RC:** “Graph Engineering [exact version/status]: build, inspect, recover, and contribute.” Report Day-21 6,000+ only if timestamped public count actually shows it | Stable requires all conjunctive rows Green and authority; otherwise complete RC with blocker manifest. If assets missing, do not call the RC complete. Stop on incident/support thresholds | Canonical GitHub/site first, then one technical community, then X/LinkedIn/Reddit/Dev.to/Chinese variants where authorized; staggered support. CTA: run verified Quickstart and share evidence—not a required star | `RM`, all technical lanes, `PQG`, `COMM`, `SUP`, `EXT` | `D21-RELEASE-067`, `CTRL-ACCEPTANCE-070`, `CTRL-PATTERNS-071`, `CTRL-GROWTH-072`, `CTRL-DOCS-073` | `REL-V1-01-V1-08`, `REL-GR01-GR07`, `REL-DOC01-DOC16`, `REL-SUP01-SUP08`, `REL-RC01-RC10` | `evidence_wait` |

## 6. Content-series production briefs

### Series S1 — “The shape of work” (Days 1-6)

Deliverables are a concept card, real/fake-edge worksheet, Quickstart clip,
diamond visualization, pipeline/barrier explanation, and failure/router
taxonomy. Each source example must run against the cited revision. No performance
claim may be inferred from a diagram. Owners: `INT`, `TSR/PYR`, `PQG`.
Mapping: `D1-SPEC-001`, `D4-PATTERNS-004`,
`D7-PIPELINE-CONFORMANCE-013`, `D6-ROUTER-BARRIER-023`;
`REL-DOC01`, `REL-DOC03-DOC07`, `REL-GR02`.

### Series S2 — “Graphs that fail honestly” (Days 8-12)

Deliverables are cancellation chaos, crash/resume trace, budget contract,
verifier/unknown demo, and ambient-authority threat boundary. Every post carries
one failure and one limit. Durable examples must say external effects are
at-least-once and must not expose raw secrets or prompts. Owners: `TSR/PYR`,
`INT`, `SRV`, `PQG`. Mapping: `D8-CHAOS-OPS-030`,
`D9-DURABLE-EXT-CONFORMANCE-034`, `D10-BUDGET-CONFORMANCE-038`,
`D11-VERIFY-CONFORMANCE-043`, `D12-ISOLATION-REDTEAM-047`;
`REL-DOC05`, `REL-DOC08`, `REL-DOC10`, `REL-SUP04-SUP06`.

### Series S3 — “One protocol, two native runtimes” (Days 13-18)

Deliverables are side-by-side code, Graph Ready output, course/pattern map,
Explorer walkthrough, external first-run report, and compatibility matrix. Any
missing platform/language/pattern cell remains visible. Owners: `TSR/PYR`,
`PQG`, `EXT`. Mapping: `D13-DX-051`, `D14-API-FREEZE-050`,
`CTRL-PATTERNS-071`, `D15-EXPLORER-060`, `D17-BETA-063`,
`D18-COMPAT-BENCH-064`; `REL-DOC04`, `REL-DOC06-DOC12`,
`REL-Q05-Q11`.

### Series S4 — “Proof before promotion” (Days 19-21)

Deliverables are RC/security story, source-to-package provenance, candidate
known-limit manifest, final launch summary, and a 24-hour evidence-based update.
The final update reports actual funnel data even if every stretch milestone is
missed. Owners: `RM`, `SRV`, `PQG`, `COMM`, `SUP`. Mapping:
`D19-RC-065`, `D20-PROVENANCE-066`, `D21-RELEASE-067`;
`REL-DOC15-DOC16`, `REL-GR01-GR06`, `REL-SUP01-SUP08`,
`REL-RC01-RC10`.

## 7. Bilingual production workflow

For each public launch asset:

1. `PQG` freezes the English canonical copy against a candidate and claim map.
   Mapping: `CTRL-DOCS-073`; `REL-DOC13`, `REL-DOC15-DOC16`.
2. A bilingual contributor translates meaning while retaining exact commands,
   code, versions, support level, security/privacy defaults, at-least-once
   semantics, and stable/RC label. Mapping: `CTRL-DOCS-073`;
   `REL-DOC13`.
3. The technical owner diffs claims, numbers, links, and limitations, not merely
   prose. Mapping: source registry task; `REL-DOC13-DOC16`.
4. A Chinese reviewer checks terminology and channel-native readability. Terms
   that identify contracts—Graph IR, node, edge, barrier, pipeline, checkpoint,
   replay, capability, idempotency—retain an English term at first use when a
   translation could be ambiguous. Mapping: `CTRL-GROWTH-072`;
   `REL-DOC13-DOC14`.
5. Both variants receive one shared content family ID and separate digests. A
   correction in either language reopens the pair. Mapping:
   `CTRL-DOCS-073`; `REL-DOC13`, `REL-RC09`.

Minimum reusable bilingual copy blocks:

| Block | English requirement | Chinese requirement | Mapping |
| --- | --- | --- | --- |
| Product identity | Vendor-neutral graph orchestration; not GraphRAG/GNN | 明确是多智能体工作流图编排，不是知识图谱、GraphRAG 或 GNN | `REL-DOC13`, `REL-DOC16` |
| Current scope | Exact alpha/RC/stable label and implemented subset | 使用同一版本和当前实现范围，不强化成熟度 | `REL-DOC13`, `REL-RC03` |
| Safety | Telemetry/prompt capture defaults and current authority limits | 保留默认隐私、ambient authority、外部副作用至少一次语义 | `REL-DOC13`, `REL-SUP04-SUP06` |
| Quickstart | Same verified commands and expected output | 命令、输出、包坐标与英文完全一致 | `REL-DOC01`, `REL-DOC13` |
| CTA | Run, inspect, report, contribute, or consent to test | 运行、检查、反馈、贡献或自愿参加测试；不以 star 为交换条件 | `REL-GR01`, `REL-GR07` |

## 8. Channel-ready copy frames

These are templates, not ready-to-publish claims. Bracketed fields must be
resolved from evidence; unresolved brackets force `evidence_wait`.

### GitHub release

```text
Graph Engineering [version] — [stable/full RC/source alpha]

What is verified in this candidate:
- [three evidence-linked capabilities]

What is not included or not yet proven:
- [known limits and blocker-manifest link]

Try it: [verified Quickstart]
Verify it: [tests/provenance/benchmark]
Get help or contribute: [support/contribution links]
```

Mapping: `D19-RC-065`, `D21-RELEASE-067`; `REL-DOC15-DOC16`,
`REL-SUP04`, `REL-RC03-RC05`.

### Hacker News / technical community

```text
Show HN: Graph Engineering — [specific verified differentiator]

We built [current scope] because [concrete problem]. The smallest reproducible
example is [link/commands]. The trade-off or missing piece is [limit]. We would
especially value feedback on [bounded technical question].
```

Mapping: `CTRL-GROWTH-072`; `REL-DOC14`, `REL-GR01-GR02`,
`REL-GR06-GR07`.

### X thread

```text
1/ The work is a graph when outputs—not prose order—create dependencies.
2/ [real topology visual with alt text]
3/ [uncut verified result and version]
4/ [failure/safety/current-scope limit]
5/ Reproduce it: [source link]
```

Mapping: source product task plus `CTRL-GROWTH-072`; `REL-DOC02-DOC03`,
`REL-DOC14`, `REL-GR01-GR02`.

### Chinese launch summary

```text
Graph Engineering [版本]：[准确的 alpha/RC/stable 标签]

已经验证：[三项带证据的当前能力]
尚未实现或尚未完成验证：[限制和 blocker]
五分钟复现：[经过验证的中文 Quickstart]
反馈与贡献：[支持、Issue、Discussion、安全报告路径]
```

Mapping: `CTRL-DOCS-073`, `D21-RELEASE-067`; `REL-DOC01`,
`REL-DOC13-DOC16`, `REL-GR07`.

## 9. Engagement and moderation playbook

### Response categories

| Incoming item | Response action | Owner | Mapping |
| --- | --- | --- | --- |
| Install or run failure | Ask for version, OS/runtime, exact sanitized command/error; reproduce; link one canonical issue; never request secrets/raw prompts by default | `SUP`, runtime owner | `D17-BETA-063`, `D21-RELEASE-067`; `REL-Q10-Q11`, `REL-SUP02`, `REL-SUP06-SUP07` |
| Technical criticism | Confirm the claim/evidence, correct publicly when wrong, or explain trade-off with source; do not argue from stars | `INT`, `COMM` | `CTRL-GROWTH-072`; `REL-GR03`, `REL-GR06` |
| Feature request | Clarify use case and constraints; map to issue/pattern; do not promise roadmap date | `COMM`, `INT` | `REL-GR07`, relevant registry task |
| Contribution | Acknowledge, reproduce/check scope, assign correct reviewer, preserve contributor credit without coercing promotion | `COMM`, lane owner | `CTRL-PATTERNS-071` or source task; `REL-GR04`, `REL-GR07`, `REL-SUP07` |
| Adoption/case-study offer | Request scoped consent, evidence, redaction, and withdrawal preference; publish only after review | `COMM`, `SRV`, `EXT` | `D17-BETA-063`; `REL-DOC08`, `REL-DOC12`, `REL-SUP06` |
| Security report | Move to private documented channel; acknowledge under security policy; never paste exploit/secret publicly | `SRV` | `D16-SECURITY-062`; `REL-SUP02`, `REL-SUP05-SUP06` |
| Abuse/harassment/spam | Apply Code of Conduct and moderation policy; retain minimal evidence; do not turn conflict into engagement content | `COMM`, `RM` | `D1-DOCS-001`; `REL-GR07`, `REL-SUP02` |

No automated system sends replies, likes, follows, direct messages, or community
submissions. Draft assistance is permitted only with human verification and
authorized publication. Mapping: `CTRL-GROWTH-072`; `REL-GR01`.

## 10. Stop, correction, and resumption rules

| Trigger | Calendar action | Resumption evidence | Mapping |
| --- | --- | --- | --- |
| Candidate/release gate reopens | Hold all candidate-specific content; mark previously published copy for correction/supersession | New candidate identity, rerun evidence, claim/link audit | `D19-RC-065`, `D21-RELEASE-067`; `REL-RC06`, `REL-RC09` |
| Security, privacy, provenance, package-integrity, or secret-canary failure | Stop promotion immediately; invoke incident/private disclosure path | Independent review, fixed candidate, exploit/canary regression, new provenance | `D16-SECURITY-062`, `D20-PROVENANCE-066`; `REL-Q08-Q09`, `REL-SUP05-SUP06` |
| P0/P1 defect, data loss, corrupt recovery, duplicate external effect | Stop affected CTA/release promotion; publish impact/workaround if authorized | Reproducer, fix, recovery/side-effect tests, forward version | `D17-BETA-063`, `D21-RELEASE-067`; `REL-Q11`, `REL-SUP04-SUP05`, `REL-RC07-RC08` |
| External Quickstart success below 80% after at least five accepted reports | Pause broad promotion; prioritize install/docs/reliability | Repeated cohort meets `REL-Q10` with sampling record | `D17-BETA-063`; `REL-Q10`, `REL-GR06` |
| Stars without installs or installs without successful runs | Shift CTA to Quickstart or pause promotion; do not intensify vanity campaign | Funnel diagnosis and improved activation evidence | `CTRL-GROWTH-072`; `REL-GR03-GR06` |
| Support p50 above 12h or oldest ordinary launch item above 24h | Hold next beats and move content capacity to triage | Queue snapshot shows restored coverage/capacity | `D21-RELEASE-067`; `REL-SUP01-SUP02`, `REL-SUP07`, `REL-GR06` |
| Community removes/flags post or rules were misunderstood | Stop that channel; contact moderators only if appropriate; no repost evasion | Rule review and explicit permission or permanent withdrawal | `CTRL-GROWTH-072`; `REL-GR01`, `REL-DOC14` |
| Adopter withdraws consent | Unpublish gallery/case/quote promptly and retain only minimal withdrawal record | New scoped consent required for any reuse | `D17-BETA-063`; `REL-DOC08`, `REL-DOC12`, `REL-SUP06` |
| Translation changes claim strength/version/limit | Hold both language variants and all derived channel assets | Bilingual technical diff and new digests | `CTRL-DOCS-073`; `REL-DOC13-DOC16`, `REL-RC09` |

## 11. Weekly editorial reviews

### End of Day 7

- Audit Days 1-7 publication states and prove any actual URLs; no blank is
  silently called published. Mapping: `CTRL-GROWTH-072`; `REL-GR02`.
- Capture Day-7 stars only as timestamped observed data; 300 remains stretch.
  Mapping: `REL-GR03`.
- Diagnose concept -> Quickstart interest using privacy-safe aggregates and
  qualitative issues. Mapping: `REL-GR05-GR06`.
- Decide whether Day 8-13 should emphasize positioning, onboarding, reliability,
  or use-case proof. Mapping: `REL-GR06`.

### End of Day 13

- Verify Alpha 2/Graph Ready wording against actual candidate; otherwise correct
  or withdraw it. Mapping: `D13-DX-051`, `D14-API-FREEZE-050`;
  `REL-DOC09`, `REL-DOC16`.
- Capture 1,000-star checkpoint only as an observed stretch outcome and report
  activation beside it. Mapping: `REL-GR03-GR05`.
- Rebalance channels by qualified Quickstart/start-report evidence, not raw
  impressions. Mapping: `REL-GR06`.

### End of Day 17

- Require real external Beta/usability evidence before “tester-backed,” adopter,
  or gallery language. Mapping: `D17-BETA-063`; `REL-Q10-Q11`,
  `REL-DOC08`, `REL-DOC12`.
- Capture 2,000-star checkpoint as non-blocking outcome. Mapping: `REL-GR03`.
- Stop promotion if successful-run or retention evidence is weak; allocate Days
  18-20 to reliability/Quickstart instead. Mapping: `REL-GR05-GR06`.

### End of Day 21

- Publish stable only if final conjunctive decision is Green; otherwise publish
  complete RC or no release according to evidence. Mapping:
  `D21-RELEASE-067`; `REL-RC01-RC10`, `REL-V1-01-V1-08`.
- Report actual 6,000+ result only if a timestamped public source shows it; a
  miss is diagnostic and never concealed. Mapping: `REL-GR03`.
- Publish a 24-hour update containing activation, retention availability,
  defects, corrections, support load, and next review—not only stars. Mapping:
  `CTRL-GROWTH-072`; `REL-GR04-GR06`, `REL-SUP07`.

## 12. Calendar completion gate

This calendar is operationally complete only after every row has:

- an honest terminal state (`published`, `held`, or `superseded`), with no
  implied publication from a draft;
- candidate/evidence/claim/translation/channel review;
- authorized URL and timestamp when published;
- disclosure, consent, UTM/privacy record, and accessibility fields;
- support/stop-condition review; and
- an aggregate metric snapshot or explicit `not_available` reason.

That evidence is expected under the future release-evidence structure and must
be reconciled with `REL-GR01-GR07`, `REL-DOC01-DOC16`, and
`REL-SUP01-SUP08`. The existence of this calendar closes none of those rows.
