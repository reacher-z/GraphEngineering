# Graph Engineering organic metrics and experiment protocol

Status: **Measurement design prepared; dashboard, observations, and experiment results are not yet implemented or collected**
Plan epoch: **2026-07-26, America/Vancouver**
Primary registry owner: `CTRL-GROWTH-072` (`planned`, dependency-blocked)
Document owner: `CTRL-DOCS-073` (`in_progress`)
Inputs: [master plan Section 7](../Graph-Engineering-21-Day-Master-Plan.md#7-organic-launch-and-6000-star-target), [release checklist](../delivery/release-checklist.md), [launch plan](./launch-plan.md), and [content calendar](./content-calendar.md)

## 1. Measurement objective and non-negotiable rules

Measurement exists to improve first success, repeated value, authentic adoption,
contribution, and support. It is not a justification for surveillance or
manufactured popularity.

1. Product telemetry and prompt/response capture remain **off by default**.
   This plan does not authorize enabling them. Mapping: `D16-SECURITY-062`,
   `CTRL-GROWTH-072`; `REL-GR05`, `REL-SUP06`.
2. Raw prompts, model responses, graph inputs/outputs, credentials,
   authorization headers, secrets, private support messages, and user data are
   not growth metrics. Mapping: `D16-SECURITY-062`; `REL-Q08`, `REL-SUP06`.
3. `6,000+` stars on Day 21 is an observed stretch outcome only. The Day
   7/13/17 checkpoints of 300/1,000/2,000 are also non-blocking. No stars are
   purchased, automated, reciprocated, rewarded, or fabricated. Mapping:
   `CTRL-GROWTH-072`; `REL-GR01`, `REL-GR03`.
4. Stable-v1 does not depend on stars. Security, recovery, cross-language
   conformance, provenance, external usability, and every mandatory checklist
   row remain conjunctive. Mapping: `D21-RELEASE-067`;
   `REL-RC01-RC10`, `REL-V1-01-V1-08`.
5. Every number has a definition, time window, source, query/manual method,
   deduplication rule, privacy class, owner, and timestamp. Unknown is reported
   as `not_available`, never zero and never estimated without a labeled model.
   Mapping: `CTRL-GROWTH-072`; `REL-GR03-GR05`.
6. External adoption, consent, account analytics, registry downloads, hosting
   logs, and elapsed seven-day retention cannot be generated from repository
   work. They remain `External` until real evidence exists. Mapping:
   `D17-BETA-063`, `D20-PROVENANCE-066`; `REL-Q09-Q11`, `REL-GR04-GR05`.

## 2. Status and result vocabulary

| Label | Meaning |
| --- | --- |
| `defined` | This document specifies the metric or experiment; no collection/result implied |
| `instrumented` | Collection/query is implemented, reviewed, and has positive/negative tests |
| `observed` | A timestamped value from an identified source exists |
| `validated` | Definition, source, deduplication, privacy, and candidate binding were independently reviewed |
| `not_available` | Source, permission, elapsed time, sample, or instrumentation does not exist |
| `invalid` | Data violated definition/privacy/integrity rules and is excluded with a reason |

All metrics and experiments in this file are currently `defined` only unless a
separate release-evidence record proves otherwise. The current public alpha and
existing Quickstart do not imply any install, run, retention, adopter, or
contributor result. Mapping: `CTRL-DOCS-073` versus `CTRL-GROWTH-072`;
`REL-GR03-GR05` remain Open.

## 3. Measurement hierarchy

### Tier 0 — mandatory guardrails

- zero manufactured/paid/reciprocal growth;
- zero known secret/prompt/user-data capture by growth collection;
- zero unsupported product/release/adoption claims;
- no unresolved P0/P1 defect during broad promotion;
- no unaccepted high/critical security finding; and
- support capacity within its stop thresholds.

Any Tier-0 breach stops the affected experiment or campaign regardless of
conversion. Mapping: `D16-SECURITY-062`, `D21-RELEASE-067`;
`REL-GR01`, `REL-GR06`, `REL-Q08`, `REL-Q11`, `REL-SUP01-SUP08`.

### Tier 1 — product north stars

1. weekly successful external graph runs;
2. seven-day retained repositories/cohort members;
3. time to first successful run;
4. authentic external adopters; and
5. non-maintainer merged PRs.

Mapping: `CTRL-GROWTH-072`; `REL-GR05`.

### Tier 2 — activation and community outcomes

- CLI/package downloads, successful or self-reported runs, external usability
  reports, outside contributors, external PRs, personalized trial invitations,
  and support-response p50.
- Master-plan targets: 2,000 downloads, 500 successful/self-reported runs, ten
  public adopters, ten outside contributors, twenty-five external PRs, ten
  manual personalized invitations, and response p50 below twelve hours.

These are influenceable goals, not guaranteed results. Mapping:
`CTRL-GROWTH-072`, `D17-BETA-063`; `REL-GR04`, `REL-Q10-Q11`,
`REL-SUP07`.

### Tier 3 — awareness diagnostics

Qualified repository/site visits, Quickstart link clicks, content referral
sessions, organic stars, forks, and discussion engagement help diagnose the
funnel. They do not prove installation, success, or retention. Mapping:
`CTRL-GROWTH-072`; `REL-GR03`, `REL-GR06`.

## 4. Metric dictionary

### 4.1 Guardrail and release metrics

| Metric ID | Definition / formula | Source and cadence | Privacy / integrity rule | Owner | Registry / rows |
| --- | --- | --- | --- | --- | --- |
| `M-GUARD-01 organic_conduct_breaches` | Count of confirmed paid, bot, reciprocal, reward-for-star, fake-adopter, spam, or undisclosed-promotion events; target `0` | Disclosure audit per beat and final attestation | Retain minimal incident facts; never normalize a breach as “campaign traffic” | `COMM`, `RM` | `CTRL-GROWTH-072`; `REL-GR01` |
| `M-GUARD-02 unsupported_claims` | Count of published statements that lack matching candidate evidence or strengthen target to implemented; target `0` | Content-manifest diff before publish and correction review daily | Store copy digest/URL and correction, not private drafting conversation | `INT`, `PQG` | `CTRL-DOCS-073`; `REL-DOC13-DOC16`, `REL-GR02` |
| `M-GUARD-03 open_p0_p1` | Open accepted P0/P1 product defects on candidate; broad-promotion threshold `0` | Candidate defect query at every launch checkpoint | Security issues reported only as redacted aggregate/status | `RM`, `SUP`, `SRV` | `D17-BETA-063`, `D21-RELEASE-067`; `REL-Q11`, `REL-SUP05` |
| `M-GUARD-04 high_critical_security` | Unaccepted high/critical findings; release/promotion threshold `0` | Candidate security report before D16/D20/D21 beats | Restricted raw report; public aggregate cannot expose exploit or secret | `SRV` | `D16-SECURITY-062`; `REL-Q08`, `REL-SUP05-SUP06` |
| `M-GUARD-05 support_capacity` | Issue/discussion response p50 and oldest ordinary unacknowledged launch item | Daily; `created_at` to first substantive maintainer response | Exclude bots; report private security queue separately without content | `SUP`, `COMM` | `D21-RELEASE-067`; `REL-GR04`, `REL-SUP01-SUP02`, `REL-SUP07` |

### 4.2 Awareness metrics

| Metric ID | Definition / formula | Source and deduplication | Privacy / caveat | Owner | Registry / rows |
| --- | --- | --- | --- | --- | --- |
| `M-AWR-01 qualified_visits` | Aggregate GitHub repository visitors plus site sessions that reach a technical/Quickstart surface; report sources separately, never sum incompatible uniques | Authorized GitHub Traffic snapshot and privacy-reviewed site aggregate, daily | GitHub window/permissions may limit history; no fingerprint or cross-site identity | `COMM` | `CTRL-GROWTH-072`; `REL-GR05-GR06` |
| `M-AWR-02 quickstart_clicks` | Aggregate navigation to canonical Quickstart by UTM content family | First-party aggregate event or hosting log after policy review; one event per session where available | No user ID, full IP, raw query, referrer path with sensitive data, or product telemetry | `COMM`, `SRV` | `CTRL-GROWTH-072`; `REL-GR05`, `REL-SUP06` |
| `M-AWR-03 organic_stars` | Public GitHub stargazer count at timestamp; checkpoints 300/1,000/2,000/6,000+ are stretch | Public count snapshot at Day 7/13/17/21; value is stock, change is difference between comparable snapshots | Awareness only; do not infer unique active users or causality | `COMM` | `CTRL-GROWTH-072`; `REL-GR03` |
| `M-AWR-04 forks` | Public fork count at timestamp and change over window | Public GitHub count snapshot | Fork is intent/experimentation, not success or retention | `COMM` | `CTRL-GROWTH-072`; `REL-GR05-GR06` |
| `M-AWR-05 channel_referrals` | Aggregate sessions/clicks grouped by allowed `utm_source`, `utm_medium`, campaign, and content ID | First-party aggregate only; unknown/direct retained separately | Never identify individual visitor or combine into behavioral profile | `COMM`, `SRV` | `CTRL-GROWTH-072`; `REL-GR05-GR06`, `REL-SUP06` |

### 4.3 Activation and usability metrics

| Metric ID | Definition / formula | Source and deduplication | Privacy / caveat | Owner | Registry / rows |
| --- | --- | --- | --- | --- | --- |
| `M-ACT-01 cli_downloads` | npm package download events plus PyPI file-download events during window, shown both separately and as a labeled arithmetic total; target total `2,000` | Official registry aggregate API/UI after legitimate publication; exclude maintainer/test downloads only when source supports it | Downloads are requests, not people, installs, or success; mirrors/caches/bots may inflate | `COMM`, package owners | `D20-PROVENANCE-066`; `REL-GR04`, `REL-Q09` |
| `M-ACT-02 accepted_first_run_attempts` | External participants/repositories that begin the frozen clean Quickstart under study protocol | Consented session form; one accepted attempt per participant/repository/candidate | Minimal cohort key held privately; public report aggregate/anonymized | `PQG`, `EXT` | `D17-BETA-063`; `REL-Q10-Q11`, `REL-GR04` |
| `M-ACT-03 first_run_success_rate` | `accepted attempts reaching documented success / accepted attempts`; stable gate >=80%, minimum five reports | Timed external study transcript/form; failures remain denominator | Exclude maintainer/agent/CI runs; publish sampling and confidence limitation | `PQG`, `EXT` | `D17-BETA-063`, `CTRL-ACCEPTANCE-070`; `REL-Q10-Q11` |
| `M-ACT-04 time_to_first_success` | Elapsed minutes from first documented command to first expected successful result; report median, p80, range, N | External stopwatch/session form, candidate-bound | Pause time only under predeclared study rule; never infer from web tracking | `PQG`, `EXT` | `D17-BETA-063`; `REL-GR05`, `REL-Q10` |
| `M-ACT-05 successful_or_self_reported_runs` | Disjoint sum of verified external study successes, consented public trace submissions, and explicit self-reports; target `500` | Source precedence prevents double count: study > trace > self-report. If cross-source identity cannot be resolved privately, report lower/upper bound instead of a false exact count | CI, maintainer, demo, generated, and duplicate reports excluded; no default runtime telemetry | `PQG`, `COMM`, `EXT` | `CTRL-GROWTH-072`, `D17-BETA-063`; `REL-GR04-GR05`, `REL-SUP06` |
| `M-ACT-06 activation_issue_rate` | Accepted first-run attempts with install/config/runtime failure divided by accepted attempts, categorized by stage | External cohort plus canonical launch-labeled issues | Error excerpts must be sanitized; raw prompts/data not requested | `SUP`, runtime owner | `D17-BETA-063`; `REL-Q10-Q11`, `REL-GR06`, `REL-SUP06` |

### 4.4 Retention, adoption, and contribution metrics

| Metric ID | Definition / formula | Source and deduplication | Privacy / caveat | Owner | Registry / rows |
| --- | --- | --- | --- | --- | --- |
| `M-RET-01 seven_day_eligible` | External repositories/participants with a verified first success at least seven full days before observation | Consented tester/adopter cohort or public repository evidence | Elapsed time cannot be accelerated; cohort inclusion frozen at Day 0 | `PQG`, `EXT` | `D17-BETA-063`, `CTRL-GROWTH-072`; `REL-GR05` |
| `M-RET-02 seven_day_retained` | Eligible cohort with a second useful successful run or maintained integration between Day 7 and Day 13 after first success | Consented follow-up or public commit/run evidence; one per repo/participant | A star, page visit, or unchanged dependency does not count as retained use | `PQG`, `EXT` | `CTRL-GROWTH-072`; `REL-GR05` |
| `M-RET-03 seven_day_retention_rate` | `seven_day_retained / seven_day_eligible`; report N and unavailable until cohort matures | Same frozen cohort; no survival-model estimate presented as observed | Do not chase non-consenting users or infer private repository activity | `PQG`, `EXT` | `CTRL-GROWTH-072`; `REL-GR05` |
| `M-ADOPT-01 public_adopters` | Distinct external people/organizations with public or explicitly consented evidence of a useful Graph Engineering integration/run; target `10` | Canonical public URL or scoped consent record; dedup by adopter, not posts | No fake placeholder, testimonial, logo, or inferred use from a star/fork/download | `COMM`, `EXT` | `D17-BETA-063`; `REL-DOC08`, `REL-DOC12`, `REL-GR04`, `REL-GR07` |
| `M-CONTRIB-01 outside_contributors` | Distinct non-maintainer, non-bot humans with an accepted issue reproduction, docs/code/pattern contribution, or merged PR; target `10` | GitHub actor and governance-defined contribution classes; one human once | Public account only; do not deanonymize or merge identities across accounts | `COMM` | `D21-RELEASE-067`; `REL-GR04`, `REL-GR07` |
| `M-CONTRIB-02 external_prs_opened` | PRs opened by non-maintainer/non-bot contributors during epoch; target `25`; report opened/closed/merged separately | GitHub PR metadata; dedup by PR number | Volume is not quality; automated dependency PRs excluded | `COMM` | `D21-RELEASE-067`; `REL-GR04-GR05`, `REL-GR07` |
| `M-CONTRIB-03 nonmaintainer_prs_merged` | External PRs merged after normal review, reported as count and rate over eligible external PRs | GitHub PR metadata and CODEOWNERS review evidence | Never lower review/safety bar to improve metric | `COMM`, lane owners | `CTRL-GROWTH-072`; `REL-GR05`, `REL-GR07` |
| `M-COMM-01 trial_invitations` | Manual, relevant, personalized opt-in invitations sent; target maximum and goal `10` | Consent-respecting outreach log with recipient category/reason/status, not message body | No scraping, purchased lists, bulk DM, repeat pressure, star ask, or assumed endorsement | `COMM` | `CTRL-GROWTH-072`; `REL-GR01`, `REL-GR04` |

## 5. UTM and referral contract

UTM exists only to compare aggregate channel/content families. It must never
carry a username, email, repository name, issue number tied to a private person,
message ID, prompt, experiment subject ID, secret, or free-form personal data.

### Allowed fields

| Field | Allowed values / pattern | Example | Rule |
| --- | --- | --- | --- |
| `utm_source` | `github`, `hackernews`, `x`, `linkedin`, `reddit`, `devto`, `cn_<approved-slug>`, `invite`, `direct` | `hackernews` | Lowercase controlled vocabulary; a community slug describes channel, not person |
| `utm_medium` | `owned`, `organic_social`, `community`, `tutorial`, `referral`, `manual_invite` | `community` | No `paid`, because paid promotion is outside this plan and undisclosed promotion is forbidden |
| `utm_campaign` | `ge_21d_2026_07` or versioned successor | `ge_21d_2026_07` | Shared campaign identifier, no user cohort identity |
| `utm_content` | content manifest ID matching `^[a-z0-9_]{1,64}$` | `d09_recovery_en_hn` | Identifies asset/language/channel variant only |
| `utm_term` | Omitted | — | No keywords, names, or audience microtargeting in this launch |

Mapping: `CTRL-GROWTH-072`; `REL-GR01`, `REL-GR05-GR06`,
`REL-SUP06`.

### Collection boundary

1. Prefer aggregate platform/source analytics and coarse daily counts.
2. If the project site is deployed, a privacy/security review must approve the
   hosting-log and aggregate-event path before collection. No cookies,
   fingerprinting, cross-site profile, or product-run telemetry is introduced
   by default.
3. Normalize and count allowed UTM values, then discard or redact raw query
   strings according to the approved retention policy. Unknown values become
   `other_invalid`; they are not stored verbatim.
4. Do not join UTM events to GitHub identities, package downloads, support
   messages, adopter records, or runtime data to reconstruct an individual
   journey.
5. Report attribution as directional. Last-click or source counts do not prove
   causality, and incomparable platform “impressions” remain separate.

Implementation is not current. It maps to `CTRL-GROWTH-072` after
`D15-EXPLORER-060`; privacy validation maps to `D16-SECURITY-062`;
`REL-GR05-GR06`, `REL-SUP06` remain Open.

## 6. Privacy, consent, retention, and access

| Data class | Examples | Collection rule | Retention / publication | Access | Mapping |
| --- | --- | --- | --- | --- | --- |
| `Public aggregate` | timestamped stars, forks, registry download totals, public PR counts | May collect from identified public source | Keep dated snapshots and source/method; publish aggregates | `COMM`, reviewers | `REL-GR03-GR05` |
| `Authorized aggregate` | GitHub Traffic, hosting aggregate, platform post analytics | Requires account authority and rule/privacy review | Retain minimal exported aggregate for campaign comparison; no raw visitor log in repo | Authorized `COMM`, `SRV` reviewer | `REL-GR05-GR06`, `REL-SUP06` |
| `Consented research` | timed Quickstart, success/failure, seven-day follow-up | Explicit purpose, scope, optional public use, withdrawal route | Restricted local evidence for approved period; publish anonymized aggregate; delete/withdraw as policy requires | Named study owner/reviewer | `D17-BETA-063`; `REL-Q10-Q11`, `REL-GR05` |
| `Consented public adoption` | adopter name/logo/quote/public trace | Separate scoped publication consent and redaction review | Publish only approved fields; record consent version and withdrawal action | `COMM`, `SRV`, adopter | `REL-DOC08`, `REL-DOC12`, `REL-GR07` |
| `Restricted support/security` | private issue details, vulnerability report, sanitized diagnostics | Collect only what is necessary under support/security policy | Never copy into growth dashboard; publish status/aggregate only | `SUP`/`SRV` need-to-know | `REL-SUP02`, `REL-SUP05-SUP06` |
| `Forbidden growth data` | raw prompts/outputs, credentials, auth headers, full IP/referrer/query logs, scraped/private contacts | Do not collect for growth | If accidentally captured, stop, isolate, follow incident/deletion policy | `SRV` | `D16-SECURITY-062`; `REL-Q08`, `REL-SUP06` |

Consent must be affirmative, purpose-specific, revocable, and separate from a
request to star, promote, or contribute. Declining cannot reduce support. An
adopter can approve aggregate study use without approving name/logo/quote. A
security reporter is never converted into a marketing lead. Mapping:
`CTRL-GROWTH-072`, `D17-BETA-063`; `REL-GR01`, `REL-GR07`,
`REL-SUP02`, `REL-SUP06`.

## 7. Evidence record and dashboard design

### Snapshot record

Every metric snapshot must provide these fields:

```text
snapshot_id
observed_at_utc
campaign_day
candidate_version
candidate_revision
metric_id
window_start_utc
window_end_utc
value | numerator+denominator | lower+upper_bound | not_available_reason
unit
source_name
source_url_or_restricted_reference
collection_method_revision
deduplication_revision
privacy_class
consent_basis_if_applicable
known_biases
collector
reviewer
supersedes
```

No raw personal/run/prompt content belongs in this record. The future dashboard
must expose definition and `N`, distinguish stock from flow, show missing data,
and retain prior snapshots instead of silently overwriting them. Mapping:
`CTRL-GROWTH-072`; `REL-GR03-GR05`, `REL-SUP06`.

### Dashboard panels

| Panel | Required display | Decision use | Mapping |
| --- | --- | --- | --- |
| Guardrails | conduct incidents, unsupported claims, P0/P1, security status, support age | Immediate stop/go | `REL-GR01`, `REL-GR06`, `REL-Q08`, `REL-Q11`, `REL-SUP07` |
| Awareness | qualified visits by source, Quickstart clicks, stars/forks as timestamped stocks and deltas | Positioning/channel diagnosis only | `REL-GR03`, `REL-GR05-GR06` |
| Activation | downloads by registry, accepted attempts, success rate, time-to-success, run evidence bounds, failure stage | Quickstart/package/reliability decisions | `REL-GR04-GR06`, `REL-Q10-Q11` |
| Retention | eligible cohort, retained count/rate, maturity date | Use-case/product-value decisions | `REL-GR05` |
| Adoption/contribution | adopters, contributors, PR opened/merged/closed, consent state | Community/product loop | `REL-GR04-GR05`, `REL-GR07` |
| Content/experiment | asset state, channel referrals, hypothesis, exposure, decision, stop reason | Stop weak/spammy work; prioritize evidence-backed content | `REL-GR01-GR02`, `REL-GR06` |
| Support | new/acknowledged/resolved, p50, oldest, severity, correction count | Capacity and crisis control | `REL-SUP01-SUP08` |

The dashboard is not implemented by this document. It remains under
`CTRL-GROWTH-072`; `REL-GR05` stays Open.

## 8. Checkpoint targets and controlled inputs

The team can control preparation and response inputs; it can only influence
independent user outcomes. Each checkpoint reports both.

| Checkpoint | Controlled inputs due | Influenceable outcomes to observe, never guarantee | Decision | Registry / rows |
| --- | --- | --- | --- | --- |
| Day 3 | Canonical Quickstart candidate, EN/ZH draft, clean internal transcript, consent form/study protocol | First external attempts if authority/cohort exists; no invented N | Fix command count/install friction before broader CTA | `D1-PLATFORM-001`, `D17-BETA-063`; `REL-DOC01`, `REL-Q10`, `REL-GR06` |
| Day 7 | Days 1-7 asset manifest, organic-conduct audit, support path, at least three carefully selected invitation candidates (send only if capacity/permission exists) | 300-star stretch snapshot, visits, downloads, reports | Reposition if visits do not reach Quickstart; repair activation before promotion | `D5-LAUNCH-READINESS-009`, `CTRL-GROWTH-072`; `REL-GR01-GR06` |
| Day 13 | Recovery/verifier/Alpha 2 evidence or honest holds, six cumulative invitation candidates, source-specific snapshots | 1,000-star stretch, downloads, successful reports, contributions | Shift to Quickstart/reliability/use-case based on funnel | `D13-DX-051`, `D14-API-FREEZE-050`; `REL-GR02-GR06` |
| Day 17 | Five or more accepted usability reports, exact sampling, ten total relevant invitation candidates, adopter consent workflow, support coverage | 2,000-star stretch, >=80% five-minute success if sample permits, adopters/retention as actually available | P0/P1 or <80% first success pauses broad promotion | `D17-BETA-063`; `REL-Q10-Q11`, `REL-GR01-GR07` |
| Day 21 | Every planned asset terminally accounted for, final claim/disclosure audit, support rota, dashboard snapshots, stable/RC decision | 6,000+ stretch, 2,000 downloads, 500 runs, 10 adopters/contributors/invitations, 25 PRs, p50 <12h—all reported honestly | Continue/narrow/pause regardless of star result; stable label follows gates only | `D21-RELEASE-067`, `CTRL-GROWTH-072`; `REL-GR01-GR07`, `REL-SUP01-SUP08`, `REL-RC01-RC10` |

## 9. Funnel diagnosis policy

The daily owner evaluates stages in order. A downstream metric cannot compensate
for an upstream safety or activation failure.

| Observed pattern | Interpretation to test | Required response | Promotion state | Registry / rows |
| --- | --- | --- | --- | --- |
| Low qualified visits across prepared channels | Concept/distribution mismatch or content gate holds | Interview consenting target users; tighten problem/use-case; test one relevant channel, not more spam | `narrow` | `CTRL-GROWTH-072`; `REL-GR01`, `REL-GR06` |
| High visits, low stars and low Quickstart clicks | Positioning/proof may not be compelling; stars alone are not the desired fix | Clarify concrete problem, current proof, audience, and CTA; run E01 | `continue` only within support capacity | `REL-GR03`, `REL-GR06` |
| Stars, low downloads | Awareness is not converting to trial; package/Quickstart coordinates may be unclear | Audit install links, candidate labels, package availability, command count; run E02 | `narrow` to onboarding | `D20-PROVENANCE-066`; `REL-GR03-GR06`, `REL-Q09-Q10` |
| Downloads, low accepted successful runs | Reliability/config/docs failure or downloads are noisy | **Pause broad promotion**, reproduce failure stages, repair package/Quickstart/runtime, repeat external cohort | `pause` | `D17-BETA-063`; `REL-GR04-GR06`, `REL-Q10-Q11` |
| Successful runs, low seven-day retention | Initial demo lacks recurring use-case/value or reliability | Interview consented successes, prioritize one repeated workflow/pattern; run E04 | `narrow` to use-case evidence | `CTRL-GROWTH-072`, `CTRL-PATTERNS-071`; `REL-GR05-GR06` |
| Retention, low public adoption | Users may need privacy-safe proof path or integration guidance | Offer opt-in anonymized/public case paths; never pressure logo/quote | `continue` | `D17-BETA-063`; `REL-DOC08`, `REL-DOC12`, `REL-GR07` |
| Contributions opened, few merged | Scope/docs/review latency or quality mismatch | Improve issue acceptance criteria, reviewer assignment, and feedback; do not merge for metric | `continue` or `narrow` | `D21-RELEASE-067`; `REL-GR04-GR07`, `REL-SUP07` |
| Support age/p50 above threshold | Campaign exceeds maintainer capacity | Stop next promotional beat; reassign content capacity to triage | `pause` | `REL-GR06`, `REL-SUP01-SUP02`, `REL-SUP07` |
| Any conduct/security/privacy/P0/P1 breach | Guardrail failure | Stop affected collection/promotion/release; incident and correction path | `stop` | `D16-SECURITY-062`, `D21-RELEASE-067`; `REL-GR01`, `REL-Q08`, `REL-Q11`, `REL-SUP05-SUP06` |

## 10. Experiment protocol

Every experiment is pre-registered before exposure with hypothesis, eligible
audience, exact variants, primary metric, guardrails, minimum observation,
maximum duration, stopping conditions, analysis method, owner, and candidate.
Only one material variable changes per comparison. Results are directional when
sample size is small; no statistical-significance theater or post-hoc metric
shopping is allowed.

Global experiment rules:

- no experiment varies safety language, known limits, release label, consent,
  price/access, or support quality;
- no individual tracking, dark patterns, deceptive countdowns, fake social
  proof, hidden paid placement, or required star;
- exposure follows community rules and account authority;
- stop immediately on Tier-0 guardrail breach;
- stop broad promotion on installs-without-success, P0/P1, support-capacity,
  security/privacy, or package/provenance thresholds; and
- publish a result only with exposure counts, source, window, candidate,
  limitations, and stopped/held variants.

Mapping for the protocol: `CTRL-GROWTH-072`, `D16-SECURITY-062`;
`REL-GR01`, `REL-GR05-GR06`, `REL-SUP06`.

### E01 — concept/positioning frame

| Field | Pre-registration |
| --- | --- |
| Hypothesis | A concrete “data dependencies form the graph” frame yields more qualified Quickstart visits than a broad “multi-agent framework” frame |
| Variants | A: problem + real/fake edge; B: native dual-language runtime + durable evidence. Both show identical limitations and CTA |
| Eligible exposure | Two comparable owned/content placements, not simultaneous duplicate posts in the same community |
| Primary metric | Quickstart clicks per qualified content session, by coarse aggregate source |
| Guardrails | Support load, correction rate, no stronger claims, no paid/automated exposure |
| Minimum / maximum | At least 100 aggregate sessions per variant where naturally available; maximum 72 hours. If unavailable, record inconclusive rather than extend spam |
| Stop | Any claim error/community complaint; >2x support capacity; candidate invalidation |
| Decision | Adopt a frame only if direction is consistent and activation quality does not fall; otherwise retain audience-specific frames |
| Map | `CTRL-GROWTH-072`; `REL-DOC14`, `REL-GR01`, `REL-GR05-GR06` |

### E02 — Quickstart CTA and language path

| Field | Pre-registration |
| --- | --- |
| Hypothesis | A direct language choice followed by one mock-first path reduces first-success time compared with a feature-heavy landing path |
| Variants | A: choose TypeScript/Python then exact Quickstart; B: concise overview then same choice. Commands and package identity remain identical |
| Eligible exposure | Consented external usability sessions; optional aggregate landing allocation only after privacy review |
| Primary metric | Five-minute success rate and time-to-first-success; clicks are secondary |
| Guardrails | Same known limits; no credential required; telemetry off; failures retained |
| Minimum / maximum | At least five total external reports for gate evidence, strive for ten across language paths; maximum through Day 17 |
| Stop | Any secret request, wrong package coordinate, P0/P1, or aggregate success below 80% once N>=5; pause promotion and fix |
| Decision | Select simpler path only with equal/greater success and no language exclusion; otherwise repair both |
| Map | `D17-BETA-063`, `D20-PROVENANCE-066`; `REL-DOC01`, `REL-DOC13`, `REL-Q09-Q11`, `REL-GR06` |

### E03 — recovery proof versus happy-path proof

| Field | Pre-registration |
| --- | --- |
| Hypothesis | An uncut crash/resume proof produces more qualified runs and fewer durability misconceptions than a happy-path-only demo |
| Variants | A: 90-second failure/recovery; B: same graph happy path. Both state current local-DAG scope and at-least-once effects |
| Eligible exposure | Technical tutorial/social audiences after exact recovery evidence passes |
| Primary metric | Accepted run reports per qualified referral; misconception/correction count as guardrail |
| Guardrails | No raw secrets/prompts in trace; no replay/fork/lease/exactly-once overclaim |
| Minimum / maximum | 72 hours or 100 qualified aggregate sessions per variant, whichever occurs first; inconclusive allowed |
| Stop | Redaction/privacy defect, corrupt/duplicate recovery, unsupported claim, or support overload |
| Decision | Use recovery proof only if it improves qualified activation without raising misconception/correction rate |
| Map | `D6-DURABLE-CONFORMANCE-011`, `D9-DURABLE-EXT-CONFORMANCE-034`; `REL-DOC02`, `REL-DOC05`, `REL-DOC08`, `REL-SUP04-SUP06` |

### E04 — recurring use-case path

| Field | Pre-registration |
| --- | --- |
| Hypothesis | A task-specific complete pattern produces better seven-day retained use than a generic graph demo |
| Variants | A: one complete pattern matching participant need; B: general research diamond. No incomplete skeleton enters A |
| Eligible exposure | Consented participants with first success and at least seven days elapsed |
| Primary metric | Seven-day retained count/rate; qualitative reason for repeat/non-repeat |
| Guardrails | Same support; no pressure to publish; no private-repo inference; hard graph budgets |
| Minimum / maximum | Report cohort N; maximum 14 elapsed days after inclusion. Small N remains directional |
| Stop | Pattern gate failure, unsafe external effect, consent withdrawal, or P0/P1 defect |
| Decision | Prioritize only a use case with observed recurring value and reliable execution; otherwise improve core onboarding/reliability |
| Map | `CTRL-PATTERNS-071`, `D17-BETA-063`; `REL-PAT00-PAT10`, `REL-GR05-GR07`, `REL-Q11` |

### E05 — bilingual activation parity

| Field | Pre-registration |
| --- | --- |
| Hypothesis | Native Chinese explanation with identical commands/limits improves Chinese-community first success without introducing claim drift |
| Variants | English canonical versus reviewed Chinese-native adaptation for consenting bilingual or respective-language cohorts; not random forced language |
| Eligible exposure | Authorized channels and external participants selecting language |
| Primary metric | First-success rate/time by language path; claim-diff defects are guardrail |
| Guardrails | Same version, commands, release label, privacy, security, at-least-once semantics; no stronger translation |
| Minimum / maximum | At least five accepted reports per reported language before comparison; otherwise descriptive only; through Day 21 |
| Stop | Any command/version/claim divergence or community rule issue |
| Decision | Keep language-native assets only when parity review stays Green; missing sample is not evidence of inferiority |
| Map | `CTRL-DOCS-073`, `D17-BETA-063`; `REL-DOC01`, `REL-DOC13-DOC14`, `REL-Q10` |

### E06 — interactive Explorer versus static trace

| Field | Pre-registration |
| --- | --- |
| Hypothesis | A real interactive topology/critical-path view increases successful inspection/replay tasks compared with a static diagram |
| Variants | A: tested Explorer; B: deterministic Mermaid/DOT plus textual trace; same graph/candidate |
| Eligible exposure | External usability sessions after D15 Explorer passes smoke/accessibility |
| Primary metric | Completion of a predefined “find failed/waiting/critical node” task and time |
| Guardrails | No fabricated/live data, no prompt capture, accessible fallback, same limitations |
| Minimum / maximum | Five accepted sessions per available variant; stop at Day 18 for launch decision |
| Stop | Data exposure, inaccessible core task, wrong event state, deployment failure, or candidate mismatch |
| Decision | Keep static fallback regardless; promote Explorer only if correct and usable |
| Map | `D5-CLI-VISUALIZE-005`, `D15-EXPLORER-060`; `REL-DOC03`, `REL-DOC11`, `REL-Q10`, `REL-SUP06` |

### E07 — contribution entry point

| Field | Pre-registration |
| --- | --- |
| Hypothesis | A scoped fixture/pattern issue with runnable acceptance evidence yields more reviewable outside contributions than a generic “contributions welcome” CTA |
| Variants | A: one scoped issue linked to fixture/test/owner; B: contribution guide landing. Same review bar |
| Eligible exposure | Organic repository visitors and manual relevant invitations, no bulk outreach |
| Primary metric | Eligible external PRs and accepted reproductions per CTA; merged count secondary |
| Guardrails | Review latency, contributor experience, no merge for metric, no star requirement |
| Minimum / maximum | Through Day 21; report counts/status, no significance claim required |
| Stop | Support p50 >12h, oldest item >24h, abusive/spam traffic, or maintainer capacity unavailable |
| Decision | Expand only scoped paths that receive timely, quality review; otherwise reduce intake and improve docs |
| Map | `CTRL-PATTERNS-071`, `D21-RELEASE-067`; `REL-GR04-GR07`, `REL-SUP01-SUP02`, `REL-SUP07` |

## 11. Experiment allocation and concurrency

No more than two public experiments run concurrently, and only one may affect
the Quickstart path. `RM`/`COMM` maintain an exposure ledger so a major release
beat, incident, or external news spike is not falsely attributed to a copy
variant. Experiments do not run during a SEV0/SEV1 incident, candidate
invalidation, security embargo, package rollback, or support-capacity pause.

Recommended dependency order:

1. E01 may run with truthful current-alpha content after channel/privacy review.
2. E02 requires real external study and package/link truth.
3. E03 requires accepted recovery/redaction boundaries.
4. E05 requires bilingual assets and real cohorts.
5. E06 waits for the Explorer.
6. E04 waits for complete patterns and seven elapsed days.
7. E07 runs only when reviewers have capacity.

Mapping: `CTRL-GROWTH-072`, source dependencies above;
`REL-GR01`, `REL-GR06`, `REL-SUP01-SUP08`.

## 12. Campaign-wide stopping and resumption conditions

| Condition | Required action | Resumption condition | Registry / rows |
| --- | --- | --- | --- |
| Any paid/bot/reciprocal/fake/undisclosed growth | Stop and quarantine campaign data/content; investigate and disclose as appropriate | Release-manager and independent conduct review; invalid traffic excluded; controls corrected | `CTRL-GROWTH-072`; `REL-GR01` |
| Secret/prompt/user-data appears in metric/log/support bytes | Stop collection and promotion, restrict evidence, invoke incident response | Canary regression proves absence across sinks; privacy/security review | `D16-SECURITY-062`; `REL-Q08`, `REL-SUP05-SUP06` |
| Wrong version/package/checksum/provenance link | Stop install CTA and affected content; do not silently edit historical package | Trusted rebuild/rehearsal, new digest, explicit correction | `D20-PROVENANCE-066`; `REL-Q09`, `REL-RC06-RC09` |
| Open P0/P1, unaccepted high/critical, data loss/corruption, duplicate unsafe effect | Stop broad promotion and release path; preserve redacted evidence | Fix plus candidate-bound regression/independent review; forward version if published | `D16-SECURITY-062`, `D21-RELEASE-067`; `REL-Q08`, `REL-Q11`, `REL-SUP05`, `REL-RC07-RC09` |
| First-success rate <80% at N>=5 | Pause broad campaign and run failure-stage diagnosis | New external cohort on corrected candidate meets gate | `D17-BETA-063`; `REL-Q10-Q11`, `REL-GR06` |
| Downloads rise but no credible successful-run evidence | Treat downloads as noisy; pause promotion rather than optimize downloads | Verified/self-reported run evidence and failure diagnosis | `CTRL-GROWTH-072`; `REL-GR04-GR06` |
| Support p50 >12h or oldest ordinary item >24h | Stop new beats; shift owners to support | Queue and roster review show restored capacity | `D21-RELEASE-067`; `REL-SUP01-SUP02`, `REL-SUP07`, `REL-GR06` |
| Consent withdrawn or collection purpose changes | Stop use/publication; remove affected public asset/data under policy | Fresh scoped consent or permanent exclusion | `D17-BETA-063`; `REL-DOC08`, `REL-DOC12`, `REL-SUP06` |
| Experiment sample/traffic too small by maximum duration | Stop as inconclusive; do not extend via spam/paid activity or claim a winner | New pre-registration and naturally available cohort, if still useful | `CTRL-GROWTH-072`; `REL-GR01`, `REL-GR06` |
| Star checkpoint missed | Record actual value and funnel diagnosis | No “recovery” requirement; continue only where activation/support gates justify | `CTRL-GROWTH-072`; `REL-GR03-GR06` |

## 13. External adoption evidence ladder

| Level | Evidence | May support | Cannot support |
| --- | --- | --- | --- |
| `E0 awareness` | Public star/fork/view/download aggregate | Awareness statement with timestamp/method | User, successful run, adopter, retention, production-readiness claim |
| `E1 interest` | Relevant issue/discussion, Quickstart click, opt-in invitation acceptance | Qualitative demand/problem evidence | Successful use or adoption |
| `E2 first success` | Consented timed session, reproducible public trace/report on exact candidate | External usability/run count, time-to-success | Seven-day retention or production use |
| `E3 repeated use` | Same consented/public repository performs useful second run after seven days | Retained cohort | Broader market adoption beyond cohort |
| `E4 adoption` | Public/consented integration with reproducible use and scope | Authentic adopter/case study/gallery | Endorsement beyond consent; production safety unless proven |
| `E5 contribution` | Non-maintainer accepted reproduction, contribution, or merged PR | Contributor/PR metrics | Adoption or retention by itself |

Stable external usability requires the checklist's real reports and success
thresholds, not E0/E1 proxies. Adopter/gallery claims require E4 consent.
Mapping: `D17-BETA-063`, `CTRL-ACCEPTANCE-070`;
`REL-Q10-Q11`, `REL-DOC08`, `REL-DOC12`, `REL-GR04-GR05`,
`REL-GR07`.

## 14. Anti-gaming and data-quality audit

At Days 7, 13, 17, and 21, an owner and independent reviewer check:

1. star/download/traffic spikes against public events and report anomalies
   without accusing users absent evidence;
2. maintainer, CI, bot, mirrored-cache, duplicate submission, and test traffic
   exclusions where the source permits them;
3. no contributor/adopter identity is counted twice across renamed accounts or
   multiple artifacts when a reviewed public/consented match exists;
4. bounded run counts are not presented as exact when cross-source duplication
   is unresolved;
5. deleted/withdrawn consented evidence is removed from future public totals
   according to policy, with aggregate corrections recorded;
6. missing source permissions/windows are `not_available`, not reconstructed;
7. no copied screenshot or social claim substitutes for source URL/query; and
8. campaign conduct remains organic and disclosed.

Mapping: `CTRL-GROWTH-072`; `REL-GR01`, `REL-GR03-GR05`,
`REL-SUP06`.

## 15. Review cadence and decision owners

| Cadence | Review | Required participants | Output | Mapping |
| --- | --- | --- | --- | --- |
| Per asset | Claim, version, link, UTM, disclosure, consent, accessibility | Technical owner, `PQG`, `COMM`; `SRV` when sensitive | `ready`/`hold` plus manifest digest | `CTRL-DOCS-073`, `CTRL-GROWTH-072`; `REL-DOC13-DOC16`, `REL-GR01-GR02` |
| Daily | Guardrails, funnel stage, support capacity, experiment exposure | `COMM`, `SUP`, one technical owner | Continue/narrow/pause/incident and next owner | `CTRL-GROWTH-072`; `REL-GR05-GR06`, `REL-SUP07` |
| Day 7/13/17/21 | Full metric snapshot, anti-gaming audit, star stretch observation, content state | `RM`, `COMM`, independent reviewer | Signed/superseding checkpoint | `REL-GR01-GR06` |
| Pre-Beta | Usability sample, consent, defects, time-to-success | `PQG`, `EXT`, runtime owners, `SRV` | Beta/no-go evidence | `D17-BETA-063`; `REL-Q10-Q11`, `REL-SUP06` |
| Pre-release | Candidate, security/provenance, support, complete asset/metric state | `RM`, `SRV`, independent go/no-go, all lanes | Stable/full-RC/no-release decision | `D20-PROVENANCE-066`, `D21-RELEASE-067`; `REL-RC01-RC10`, `REL-V1-01-V1-08` |
| T+24h / T+7d | Incidents, activation, support, corrections, matured retention cohort | `RM`, `COMM`, `SUP`, `EXT` as consented | Public aggregate update and next experiment | `D21-RELEASE-067`, `CTRL-GROWTH-072`; `REL-GR04-GR06`, `REL-SUP01-SUP08` |

## 16. Release-checklist reconciliation

| Checklist row | What this document supplies | Evidence still required before Green |
| --- | --- | --- |
| `REL-GR01` | Prohibited-conduct rules, disclosure and anti-gaming audit | Actual channel/partner audit and release-manager attestation |
| `REL-GR02` | Beat schedule, asset states, evidence-gated publication contract | Real asset manifest, paths/URLs, proof sources, publication states |
| `REL-GR03` | Stretch-only definition and snapshot method | Timestamped Day 7/13/17/21 public values and copy audit |
| `REL-GR04` | Stable definitions for downloads, runs, adopters, contributors, PRs, response, invitations | Source snapshots, dedup reports, current values |
| `REL-GR05` | North-star dictionary, dashboard design, privacy rules | Implemented queries/dashboard and real snapshots/cohorts |
| `REL-GR06` | Funnel decision and stop/resume policy | At least one current diagnosis, selected response, owner, review date |
| `REL-GR07` | Adoption/contribution/consent evidence rules | Published and smoke-tested contributor/community/adopter workflows |
| `REL-SUP06` | Data classification, forbidden fields, consent and sink rules | Support-bundle/collection implementation, seeded-secret negative scan, review |
| `REL-SUP07` | Response p50 definition and capacity stop line | Actual queue query/snapshot, coverage owner, current value |

No row is made Green by this plan. `CTRL-GROWTH-072` remains planned until its
dependencies and expected assets/tests are genuinely complete.

## 17. Completion conditions

The metric and experiment program is complete only when:

- every headline metric has an implemented, reviewed source/method or an honest
  `not_available` record;
- dashboards show definitions, windows, N, bounds, biases, candidate identity,
  and timestamped values without personal/raw runtime content;
- Day 7/13/17/21 stretch snapshots report actual stars without promise or
  manufacturing;
- external Quickstart/adoption/retention evidence is real, consented, and has
  elapsed for the claimed window;
- every experiment has a pre-registration, exposure record, guardrail review,
  decision, and inconclusive state where appropriate;
- at least one funnel diagnosis invokes the required positioning,
  Quickstart, pause, reliability, or retention response;
- support and crisis thresholds are operational; and
- an independent reviewer reconciles the evidence to `REL-GR01-GR07` and
  relevant documentation/support/release rows.

This document itself is only the definition layer. It contains no claim that
6,000 stars, 2,000 downloads, 500 runs, ten adopters, ten contributors,
twenty-five PRs, ten invitations, seven-day retention, or sub-twelve-hour
response p50 has been achieved.
