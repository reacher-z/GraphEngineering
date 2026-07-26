# Graph Engineering 全量计划缺口审计

- 审计日期：2026-07-26（America/Vancouver）
- 审计基线：分支 `feat/pipeline-runtime`，`HEAD=d4de336eade9e468a219a595c45b6db8d20d74de`
- 权威计划：`codex_plans/Graph-Engineering-21-Day-Master-Plan.md`
- 控制面：`codex_logs/task-registry.json`、`master-plan-coverage-matrix.md`、
  `task-dependency-graph.md`、`release-checklist.md`、`agent-ownership-map.md`
- 本轮唯一写入：本文件；未修改 registry 或其他共享控制文档

## 1. 结论

当前只能准确称为**有大量可用本地切片的 source alpha**。稳定 v1 是明确
no-go；完整 Beta 和完整 RC 也尚不成立。理由不是“文件不够多”，而是：

1. 178 个 release-checklist 叶子全部仍为 `Open`，candidate coordinates 为空，
   且 178 个 `REL-*` ID 没有一个被机器映射到 live registry。
2. 审计期间 registry 从 90 项变为 91 项；最新状态为 35 `completed`、3
   `in_progress`、53 `planned`。新增的 critical `D9-REDACTION-039` 只证明风险
   已登记，不证明 redaction 已修复或验收。
3. 审计中捕获的 explicit-null `I01/X02/T05` 分歧已被本地修复，最新共享
   conformance 通过；但 `D2-BUILDERS-YAML-020` 仍在进行，且没有 immutable
   candidate/reviewer evidence，故该 P0 只能标为“本地修复待验收”。
4. durable 事件在保存完整 `data` 的同时写入 `redacted: true`；该 false signal
   已由 `D9-REDACTION-039` 登记为 critical，但实现、迁移、双语言 canary 扫描和
   独立安全复核仍未完成。
5. pipeline 的无限 stage iterable 同步阻塞在审计中被识别；当前工作树已出现
   双语言 `maxStages/max_stages=2048` 本地修复和恶意 iterator 测试，但 Python
   implementation task 虽已 completed，跨语言 join 仍在进行。最新 conformance
   已本地通过，但未绑定 candidate/reviewer。因此该 P0 仍是“本地修复待验收”。
6. 早期 30 个 completed 任务没有任何测试/完成证据；全部 35 个 completed
   任务都没有 `completed_at`。迁移截止时间可以解释历史数据格式，不能让这些
   状态成为候选版本 release evidence。
7. 发布依赖闭包允许 provenance/go-no-go、RC、文档或 pattern skeleton 在完整
   acceptance、十个完整 pattern、支持准备或最终 provenance 叶子之前被标记完成。
8. master plan 的主要 Day 10–15 能力、Day 17–21 外部/发布成果仍为 Open；
   coverage、三 OS、chaos、供应链、外部可用性、完整 CLI、全部 patterns 和支持
   操作均没有候选版本证据。

即使所有本地单测通过，也不能覆盖上述 conformance、安全、外部权限、矩阵、
provenance 或用户证据缺口。

## 2. 审计口径与实测快照

本审计完整读取了主计划，并逐项对照 91 项 live registry、coverage matrix、
dependency graph 和 178 项 release checklist。审计开始时 registry 为 90 项；
`D9-REDACTION-039` 在审计进行中加入，故以下结果以最新 91 项为准，并显式记录
控制文档的同步欠账。

证据判定规则：

- `planned`、目录、schema、enum、README 描述、scanner heartbeat 都不是完成证据。
- 本地 dirty worktree 上一次成功命令只证明该快照的局部行为，不是 immutable
  candidate、受保护 CI、独立 review、packed install 或发布 provenance。
- `completed` 只有在 source/spec revision、精确命令、结果、不可变报告、日期、
  reviewer、排除项齐全时，才可被 release gate 消费。
- 外部测试、registry/hosting 权限、独立签核、真实 provider 与 consent 不能由
  agent 或 mock 伪造。

本轮实测环境是 Linux x86_64、Node 22.23.1、pnpm 10.13.1、Python 3.14.0；
最新工作树有 45 个 modified/untracked 路径，因此以下结果不是 release evidence：

| 命令 | 结果 | 能证明什么 / 不能证明什么 |
|---|---|---|
| `corepack pnpm check:docs` | **最终复验失败** | 新增的 `content-calendar.md:7` 与 `launch-plan.md:96` 均链接到尚不存在的 `metrics-and-experiments.md`；较早一次在这些并行文件出现前曾通过 161 links。 |
| `corepack pnpm validate:fixtures` | 通过，24 JSON fixtures、1 graph hash、1 checkpoint hash、14 Durable JSON vectors | 证明 fixture 结构/静态 hash 检查；不能替代 native conformance。 |
| `corepack pnpm test` | 通过全部 workspace package tests | 证明当前本地 TS 切片；无 coverage、OS matrix、packed candidate 或 immutable report。 |
| `uv run --project python pytest -q` | 最新复验 584 passed、2 subtests passed | 原始数量超过 Q02，但没有 candidate-bound 分类报告、coverage 或支持版本/OS矩阵。 |
| `corepack pnpm test:conformance` | **最新复验通过** | 12 graph fixtures、runtime、persistence、durable、barrier/router 与 8 pipeline cases 均通过；仍非 candidate-bound evidence。 |
| TS/Python malicious-stage focused tests | 通过 | TS targeted 1 passed/114 skipped（full runtime 115）；Python `max_stages` selector 10 passed。证明本地 limit+1 行为，不关闭 release join。 |
| `corepack pnpm check:packages` | 顺序复验通过 | 7 个 npm manifests/tarballs 通过；不包含 canonical unscoped distribution、cross-OS clean install 或 trusted publish。 |
| `python3 scripts/check-python-artifacts.py` | 通过 | 本地 wheel/sdist 结构通过；不证明 supported-version/OS clean install、upgrade 或 PyPI provenance。 |

Registry 结构检查结果：91 个唯一 ID、无 dangling dependency、无图论环；但
`updated_at=2026-07-26T16:45:30Z` 早于 17:45 新增的 redaction task。D2 状态在
审计中已从 planned/started 不一致修正为 `in_progress`。

## 3. Day 1–21 逐日交叉核验

| Day | Live 判定 | 对应 registry | 仓库/验收事实 |
|---:|---|---|---|
| 1 | Partial | `D1-*`, `CTRL-PLAN-COVERAGE-001`, `CTRL-EVIDENCE-002`, `CTRL-DOCS-073` | 治理、schema、CI、scanner 存在；历史完成证据、growth 文档和候选 review 未闭合。新 architecture/research 文件虽已出现，仍是 untracked/未验收。 |
| 2 | Partial，P0 本地修复待验收 | `D2-BUILDERS-YAML-020` | 基础 canonical/hash 存在，explicit-null 分歧已本地修复且 conformance 通过；builders/YAML/typed ports 与 immutable review 仍未完成。 |
| 3 | Partial | `D3-CLI-002`, `D3-PY-CLI-021`, `D14-API-FREEZE-050` | TS 只有 `validate/plan/compile/visualize/doctor/init`；Python CLI、完整 envelopes/exit reference 和其余命令不存在。 |
| 4 | Partial | `D4-TRACE-SUBGRAPH-022`, `D15-EXPLORER-060` | 双语言 deterministic DAG 有实现；nested subgraph、reducer、stream/artifact edge activation、trace viewer 未完成。 |
| 5 | Partial，P0 待验收 | `D7-PIPELINE-*`, `D6-ROUTER-BARRIER-023` | standalone pipeline 与纯 barrier/router 存在。`maxStages` 本地修复已出现，但 join 未闭合；scheduler-integrated stream/router/barrier/deadline/replay 未完成。 |
| 6 | Partial | `D6-ROUTER-BARRIER-023`, `D11-VERIFY-*` | 结构化基础失败、retry/cancel 存在；完整 terminal set、runtime quorum/abstain/unknown/human gate 未完成。 |
| 7 | Partial | `D7-CYCLE-*` | 只有静态 finite constructor；runtime cycles、global seen set、semantic convergence、全维度 hard stop/replay exit 未完成。 |
| 8 | Partial | `D8-CHAOS-OPS-030` | runtime/pipeline retry/cancel 测试强；全 provider/tool 边界、chaos 和 operational CLI 未完成。 |
| 9 | Partial，critical redaction open | `D6-DURABLE-*`, `D9-REDACTION-039`, `D9-DURABLE-EXT-*` | local event-sourced DAG resume 存在；redaction flag 不真实，且 SQLite/Artifact/Lock/lease/replay/fork/approval/dual resume 未闭合。 |
| 10 | Open | `D10-*` | 只有 attempts/concurrency 狭窄边界；token/money/time/node budgets、reservation、models/pricing/cost UI 未完成。 |
| 11 | Open | `D11-*` | verified-fanout 只是 declarative constructor；votes/rubric/citation/panel/unknown gate 未实现。 |
| 12 | Open | `D12-*` | security architecture 文件出现不等于 enforcement；deny-by-default capabilities、worktree/process/container isolation 和 red team 未完成。 |
| 13 | Open | `D13-*` | 无 official adapters；mock/provider/tool contract、rate/circuit/fallback/cancel 和 score/badge 未完成。 |
| 14 | Open | `D14-*` | read-only alpha MCP 与四个 TS constructors 存在；API freeze、plugin SDK、mutation policy、十个跨语言 skeleton 未完成。 |
| 15 | Open | `D15-*` | 只有 memory/JSONL/file local stores；SQLite default、Postgres/S3、workers、OTel、Explorer、benchmark baseline 未完成。 |
| 16 | Partial | `D16-SECURITY-062`, `D9-REDACTION-039` | CodeQL/dependency review/Dependabot 存在；critical redaction、secret/license scans、SBOM、fuzz/chaos、policy/escape 与 signed disposition 未完成。 |
| 17 | Open / External | `D17-BETA-063` | 没有 immutable beta、五份外部报告、80%/5min、zero P0/P1 或 feedback retest。 |
| 18 | Open | `D18-COMPAT-BENCH-064`, `CTRL-ACCEPTANCE-070` | CI 仅 Linux；无 macOS/Windows、1k node、100 randomized faults、accepted coverage/benchmark/parity report。 |
| 19 | Open | `D19-RC-065` | 本地 pack/build 不等于 clean OS install/upgrade、signed RC、migration、candidate-bound docs。 |
| 20 | Open / External | `D20-PROVENANCE-066` | 无 trusted npm/PyPI identity evidence、SBOM/checksum/attestation、一致 artifact manifest 或可执行 go/no-go roll-up。 |
| 21 | Open / External | `D21-RELEASE-067`, `CTRL-*` | packages/site/content/support/incident/monitoring 均未闭合；任何 stable 标签均不被证据支持，完整 RC 也仍缺资产。 |

## 4. P0：立即阻塞集成或发布

### P0-01 — durable `redacted: true` 是 false security signal

- 任务：`D9-REDACTION-039`（planned, critical），并已被
  `D9-DURABLE-EXT-SPEC-031` 与 `D16-SECURITY-062` 依赖。
- 证据：`packages/runtime/src/durable.ts` 无条件写 `redacted: true`；
  `python/src/graph_engineering/durable.py` 同样写 `"redacted": True`；完整 `data`
  仍由 event stores 写盘。`spec/event.schema.json` 默认值、
  `spec/conformance/run-created.event.json` 也强化了该误导信号。
- 影响：`I06`, `T26`, `V1-02`, `Q08`, `SC07`, `SC12`, `SUP06`；日志、trace、
  checkpoint、artifact、CLI/support bundle 的用户都可能错误相信 payload 已脱敏。
- 控制缺口：当前 task owner 同时写 `main + TypeScript + Python + independent
  security reviewer`，并横跨 spec、两种实现与安全 join；这不满足 ownership map 的
  one-primary-owner/R2-R3 非自审规则，应按 9.1/9.2 拆 lane 与 conformance join。
- 机器验收：

```bash
corepack pnpm test:redaction
uv run --project python pytest -q python/tests/test_redaction.py
corepack pnpm test:conformance
node scripts/check-secret-canaries.mjs --manifest codex_logs/release-evidence/redaction/manifest.json
```

前三个新 redaction 入口/测试和最后一个 sink-byte canary 检查必须随任务落地；要求
journal、checkpoint、artifact、stdout、stderr、log、trace、error、support bundle
均无 canary，flag 与真实 wire bytes 一致，legacy 误标历史被明确拒绝或迁移，且
redaction 不改变 replay identity 或暗中授权工作。

### P0-02 — pipeline 无限 stage iterable：本地修复存在，release closure 不存在

- 任务：`D7-PIPELINE-SPEC-012`, `D7-TS-PIPELINE-012`,
  `D7-PY-PIPELINE-012`, `D7-PIPELINE-CONFORMANCE-013`。
- 初始证据：TS `normalizeStages` 曾对任意 `Iterable` 使用 `[...stages]`，恶意/无限
  iterator 会在 `runPipeline` 同步永久阻塞；旧 spec 只有“finite”前置声明而没有
  可执行上限。Python 的自定义 `Sequence` 也可通过永不 `StopIteration` 的
  `__getitem__` 无限推进。
- 当前修复证据：`spec/pipeline-semantics.md` 已规定 portable
  `maxStages=2048`；TS/Python 实现都只拉取 `limit+1`；两边已有无限 iterator/
  sequence 测试。Python implementation task 已 completed，conformance join 仍
  `in_progress`；最新 full conformance 本地通过，但工作树未绑定 candidate/reviewer。
- 机器验收：

```bash
timeout 10s corepack pnpm --filter @graph-engineering/runtime exec vitest run -t 'bounds an infinite stage iterable'
timeout 10s uv run --project python pytest -q python/tests/test_pipeline.py -k 'infinite_stage_sequence or max_stages'
corepack pnpm test:conformance
```

只有三条在同一 immutable revision 通过、共享 fixture 固定默认/最大值与错误投影、
对 overflow element 零属性访问、iterator 正常关闭、source 零推进后，P0 才可关闭。

### P0-03 — explicit-null conformance 分歧已本地修复，候选闭包仍未完成

- 任务：`D2-BUILDERS-YAML-020`, `D1-SPEC-001`, `CTRL-ACCEPTANCE-070`。
- 初始证据：`spec/conformance/invalid-null-metadata-description.graph.json`、
  `spec/conformance/expected.json`、`python/src/graph_engineering/models.py`、
  `tools/conformance/run.mjs`；本轮 `pnpm test:conformance` 报 Python validity
  `true !== false`。
- 当前证据：D2 已改为 `in_progress`，登记 27-field explicit-null parity 修复；最新
  `pnpm test:conformance` 通过 12 graph fixtures 及全部现有 runtime/persistence/
  pipeline joins。该结果来自 dirty worktree，D2 的 builders/YAML/typed-port 完整
  scope、completion evidence 与独立 review 仍为空。
- 影响：修复若未绑定 immutable candidate，`I01/I02`, `X02`, `T05` 仍不能从
  release Open 变 Green；`validate:fixtures` 单独通过也不能替代 native conformance。
- 机器验收：

```bash
corepack pnpm validate:fixtures
uv run --project python pytest -q python/tests/test_models.py python/tests/test_compiler.py
corepack pnpm --filter @graph-engineering/core test
corepack pnpm test:conformance
```

所有 optional known fields 的 explicit null 必须在两种语言得到相同稳定 code/path；
现有 `in_progress` 状态正确，只有 broader builder/YAML acceptance、immutable report
与 reviewer 齐全后才能 completed。

### P0-04 — 178 个 release leaf 没有 live-task 映射或 fail-closed roll-up

- 任务：`CTRL-ACCEPTANCE-070`, `D20-PROVENANCE-066`, `D21-RELEASE-067`。
- 证据：`release-checklist.md` 明确要求 `REL-*` 映射 live registry；当前 178 个
  unique `REL-*` 中 registry 直接命中为 0，也不存在机器可读映射 manifest。
  candidate coordinates 全空，所有 leaf 为 Open。
- 额外风险：`GR03-GR05` 是 non-blocking tracking，但 checklist 没有独立机器字段；
  一个朴素“全部 178 必须 Green”的 roll-up 会错误阻塞，反之又可能漏掉 `GR01`,
  `GR02`, `GR06`, `GR07` 的 mandatory conduct/assets。
- 机器验收：

```bash
node scripts/check-release-task-map.mjs \
  --checklist codex_plans/delivery/release-checklist.md \
  --registry codex_logs/task-registry.json \
  --map codex_plans/delivery/release-task-map.json
node --test scripts/tests/release-rollup.test.mjs
node scripts/release-rollup.mjs --candidate "$CANDIDATE_SHA" --fail-on-open-blocking
```

必须覆盖 178/178、只引用存在的 registry ID、显式 `blocking` boolean、检测 dangling/
duplicate/cycle，并用 Open/Partial/Blocked/Green 及 non-blocking growth negative fixtures
证明 fail closed。

### P0-05 — acceptance、provenance 与 go/no-go 的依赖闭包不成立

- 任务：`CTRL-ACCEPTANCE-070`, `D19-RC-065`, `D20-PROVENANCE-066`,
  `D21-RELEASE-067`, `CTRL-PATTERNS-071`, `CTRL-DOCS-073`,
  `CTRL-GROWTH-072`。
- 证据：`CTRL-ACCEPTANCE-070` 声称覆盖全部 mandatory thresholds，却不依赖
  D20，因此不能验收其自身需要的 `Q09/SC01-SC14` provenance；D20 又可在
  acceptance/pattern/docs/growth/support 之前完成并自称 go/no-go。D19 不依赖十个
  完整 pattern；`CTRL-DOCS-073` 零依赖，理论上可在 API/Explorer/security 尚未
  冻结时完成。
- 影响：registry 是 DAG，但语义上存在“消费者可先于证据生产者变 Green”的假闭包。
- 机器验收：

```bash
node scripts/check-task-graph.mjs --registry codex_logs/task-registry.json \
  --rules codex_plans/delivery/release-dependency-rules.json
node --test scripts/tests/release-invalidation.test.mjs
node scripts/release-rollup.mjs --candidate "$CANDIDATE_SHA" --explain-blockers
```

最终 roll-up 必须在 provenance 之后，D21 只能消费该 roll-up；任何 contract、
security、pattern、docs、package 或 provenance gate 重开都必须使下游 candidate
失效。

### P0-06 — 历史 completed 状态不能被 release gate 消费

- 任务：30 个无证据的早期 completed 任务、全部 35 个无 `completed_at` 的
  completed 任务、`CTRL-EVIDENCE-002`。
- 证据：`codex_logs/task-registry.json`。典型冲突是 `D1-BRAND-001` 的
  expected test 包含 registry availability/authenticated rehearsal，但 next action 又明确
  publication deferred；`D5-SECURITY-RELEASE-008` 也只有状态，没有 candidate-bound
  scan/review artifact。
- 影响：旧格式迁移豁免只能保留历史，不能为 release checklist 生成合格证据。
- 机器验收：

```bash
node scripts/check-task-registry.mjs --strict --candidate "$CANDIDATE_SHA"
node scripts/check-evidence-closure.mjs --registry codex_logs/task-registry.json \
  --root CTRL-RELEASE-ROLLUP-086 --candidate "$CANDIDATE_SHA"
```

允许保留旧 `completed` 原值，但必须增加 append-only candidate revalidation overlay，
包含 revision、spec hash、命令、环境、结果、immutable report、reviewer、排除项；
没有 overlay 的历史任务对发布闭包权重为零。

### P0-07 — canonical npm `graph-engineering` distribution 没有实现任务

- 任务：当前无精确实现任务；相关但不足的是 `D1-BRAND-001`, `D19-RC-065`,
  `D20-PROVENANCE-066`。
- 证据：root `package.json` 是 `private: true` 的 workspace；现有 publishable npm
  packages 都是 `@graph-engineering/*`，CLI binaries 位于 scoped
  `@graph-engineering/cli`。release `PKG02/PKG05/PKG13` 明确要求 canonical
  `graph-engineering` tarball 与 `graph`/`grapheng`。
- 影响：即使所有 scoped packages 通过，也不能满足主计划的 canonical npm 安装路径。
- 机器验收：

```bash
corepack pnpm check:packages
corepack pnpm check:packed-install
node scripts/check-canonical-distribution.mjs --name graph-engineering \
  --bins graph,grapheng --nodes 20,22
```

必须先记录 namespace/alias 与 package-boundary ADR；不得为占名发布空包。

## 5. P1：必须在 RC 前关闭的计划/依赖/证据缺口

### P1-01 — day spine 过度串行，且数个 task 混合了互相矛盾的前置条件

| 现有任务 | 问题 | 精确修正方向 |
|---|---|---|
| `D4-TRACE-SUBGRAPH-022` | 只依赖 builders，却会修改 runtime、checkpoint namespace 和 edge execution。 | 增加双语言 runtime 与 durable spec 前置；contract 可先行，checkpoint integration 另设 join。 |
| `D6-ROUTER-BARRIER-023` | 同一任务既含 scheduler routing/barrier，又含 durable route replay；后者实际依赖 D9。 | D6 只做 runtime conditional route/deadline/quorum，并依赖现有 router/barrier primitives；把 zero-rejudge replay 移到 D9 conformance。 |
| `D7-CYCLE-SPEC-024` | contract 被完整 D6 implementation 阻塞。 | spec 只依赖 canonical IR/state/failure contract；native lowering 再依赖 D6，允许提前冻结 bounds。 |
| `D8-CHAOS-OPS-030` | 混合 runtime chaos 与 status/watch/pause/resume；后半依赖 durable control，而 D9 又依赖整个 D8。 | 拆成 runtime fault/cancel campaign 与 D9 operational control 两项；原 030 仅作 join。 |
| `D9-DURABLE-EXT-SPEC-031` | 被完整 D8 ops 阻塞，延迟 lease/replay/approval contract。 | 只依赖 basic durable、redaction 和 cancellation semantics；CLI ops 在实现后消费它。 |
| `D10-BUDGET-SPEC-035` | portable budget contract 被全部 D9 conformance 阻塞。 | pricing/unit/reservation spec 可提前；只有 crash-safe reservation integration 依赖 D9。 |
| `D11-VERIFY-SPEC-040` | verifier semantics 被整个 budget implementation 阻塞。 | vote/rubric/unknown contract 依赖 failure/approval contract；model-cost execution 再依赖 D10。 |
| `D12-ISOLATION-SPEC-044` | threat/capability contract 等到 verifier 全完成，安全设计过晚。 | threat model/spec 提前依赖 cancellation、approval/redaction；implementation/human gate 分别 join D9/D11。 |
| `D18-COMPAT-BENCH-064` | 技术矩阵完全被外部 tester 时间阻塞。 | 拆分 Beta artifact 与 external usability；D18 依赖 immutable Beta artifact，不依赖报告收集完成。最终 release roll-up 再 join usability。 |

机器验收：`node scripts/check-task-graph.mjs --rules
codex_plans/delivery/release-dependency-rules.json`，并为每个拆分任务验证唯一 primary
owner、无循环、每个 expected test 的生产者位于消费者之前。

### P1-02 — adapters 缺少双语言独立 lane 与独立 conformance join

`D13-ADAPTERS-049` 同时由 TS + Python lanes 编写、还自带 conformance，违反
ownership map 的 one primary owner 与 non-self-review。应新增 TS、Python 两项，
将 049 收窄为 main + independent reviewer 的 join。Mock normal CI 与 vendor live
opt-in 必须分开，live credential 缺失不能使 mock gate 失败，也不能被 mock 冒充。

验收：

```bash
corepack pnpm test:adapters
uv run --project python pytest -q python/tests/adapters
corepack pnpm test:adapter-conformance
```

### P1-03 — 十个 pattern 的 live dependencies 与 dependency graph 自己的 P01–P10 表不一致

Registry 除 P05 外几乎全部只依赖 skeleton；因此可在真实能力不存在时标记 pattern
完成。至少增加：

| Pattern task | 必需依赖 |
|---|---|
| `PATTERN-01-RESEARCH` | pipeline/barrier、D9 durable ext、D10 budget |
| `PATTERN-02-CITED` | P01、D11 verifier、D13 adapter join |
| `PATTERN-03-AUTH` | D6 routing、D12 isolation、D16 security |
| `PATTERN-04-DIFF` | D6 quorum、D11 verifier、D12 isolation |
| `PATTERN-05-UNTIL-DRY` | D7 cycles、D10 budget、D11 verifier |
| `PATTERN-06-MIGRATION` | D9 resume、D12 worktree/merge、D16 escape tests |
| `PATTERN-07-CI` | D8 runtime chaos、D9 recovery、D12 process isolation、D13 shell adapter、approval spec |
| `PATTERN-08-DEPS` | D6 routing、D9 recovery、D12 isolation、D13 HTTP/shell、D16 license/security |
| `PATTERN-09-PR` | D6 quorum、D9 waits/approvals、D11 gates、D13/D14 MCP |
| `PATTERN-10-ECOSYSTEM` | D7 cycles、D9 recovery、D10 budget、D13 providers、D15 workers/storage |

验收：`node scripts/check-pattern-bundles.mjs --all --negative-fixture
scripts/fixtures/pattern-bundle-missing-resume.json` 后运行十个 TS/Python/YAML/JSON
mock E2E、failure/resume 和 capability denial。

### P1-04 — API freeze、storage、Explorer、security 与 RC 的关键 dependency 缺边

- `D14-API-FREEZE-050` 缺 `D4-TRACE-SUBGRAPH-022`，可在 subgraph/edge public
  surface 前冻结。
- `D14-PATTERN-SKELETONS-053` 缺 `D2-BUILDERS-YAML-020`，却要求 YAML/JSON。
- `D15-STORAGE-WORKERS-054` 缺 `D14-API-FREEZE-050`。
- `D15-EXPLORER-060` 应显式依赖 API freeze、operational state、replay/fork 和
  redaction envelope；不能只靠间接长链。
- `D15-PERFORMANCE-061` 缺 API/pattern surface 和 baseline enforcement producer；
  “first run under five minutes”应由外部 usability task 最终验收。
- `D16-SECURITY-062` 还应依赖 Explorer/observability attack surface；新增
  `D9-REDACTION-039` 依赖是正确的但尚未同步 dependency 文档。
- `D19-RC-065` 缺 `CTRL-PATTERNS-071`、完整 education assets 与 support preflight。

证据路径是 `codex_logs/task-registry.json` 各 `depends_on` 与
`task-dependency-graph.md` 的 D14–D20 rows。机器验收同 P1-01 的
`check-task-graph.mjs`，并以一个故意移除 API/pattern/security 前置的 negative DAG
证明 checker 会失败。

### P1-05 — I01–I10 跨切面状态

| Gate | 当前判定 | 主要任务/证据 |
|---|---|---|
| I01 canonical spec | Partial / local Green | `D2-BUILDERS-YAML-020`; latest conformance passes，candidate review open。 |
| I02 structured failures/no null | Partial | basic compiler/runtime/pipeline 有结构化失败；全 node/provider/tool/store 未闭合。 |
| I03 transforms vs model judgment | Partial | 文档/类型存在；model/verifier/policy runtime 未实现。 |
| I04 no implicit cycles/unbounded retry/fanout | Partial | DAG cycle、attempt/fanout 局部边界；dynamic patch/cycle/provider/worker 未闭合；pipeline cap 待 join。 |
| I05 at-least-once + idempotency/approval | Open/Partial | basic durable activity key；完整 approval/reconciliation/tool effects 未实现。 |
| I06 telemetry/capture default-off + redaction | **Red** | `D9-REDACTION-039`; false redacted flag，且 OTel/support bundle 未实现。 |
| I07 malicious dynamic patches bounded | Open | `D7-CYCLE-*`, `D12-*`, `D10-*`。 |
| I08 no authority expansion | Open | `D12-*`, `D14-MCP-PLUGINS-052`。 |
| I09 insufficient verifier quorum unknown/human | Open | `D11-*`。 |
| I10 evidence-limited release claims | Open | candidate/claim audit、external evidence 和 final sign-off 不存在。 |

### P1-06 — X01–X10 cross-language equality 状态

| Gate | 当前判定 | 缺口/命令 |
|---|---|---|
| X01 canonical bytes/hashes | Local subset present, release Open | `pnpm test:conformance` 必须在 candidate 通过。 |
| X02 compile verdict/codes | Local repair passes；release Open | explicit-null regression now passes full conformance；immutable report/reviewer open。 |
| X03 route + replay | Partial | pure route parity；runtime selection/replay open。 |
| X04 barrier/quorum | Partial | all/minimum/percentage evaluator；deadline/quorum runtime open。 |
| X05 event ordering | Partial | basic DAG/durable events；full terminal/replay/worker ordering open。 |
| X06 terminal/failure | Partial | basic scheduler/pipeline；all policies/providers/tools open。 |
| X07 retry/timeout/cancel accounting | Partial strong local | future provider/tool/cycle/worker and candidate report open。 |
| X08 resume/replay/fork | Partial | local cross-language resume；replay/fork/lease open。 |
| X09 CLI JSON/exit | Partial | TS subset only；Python/full operational CLI open。 |
| X10 adapter/storage | Partial | basic event/checkpoint stores；official adapters、SQLite/Postgres/S3/Artifact/Lock open。 |

### P1-07 — T01–T33 mandatory scenario 状态

| Gate | 当前判定 | 主要 task/control |
|---|---|---|
| T01 missing reference | Local implementation present；release Open | core/compiler conformance, `CTRL-ACCEPTANCE-070` |
| T02 duplicate identity | Local implementation present；release Open | core/compiler conformance |
| T03 unreachable | Local implementation present；release Open | core/compiler conformance |
| T04 invalid ports | Partial | `D2-BUILDERS-YAML-020` |
| T05 invalid schemas | Local repair passes；broader scope/release Open | `D2-BUILDERS-YAML-020` |
| T06 implicit cycle | Local DAG reject present；release Open | core/compiler |
| T07 incomplete router | Open | `D6-ROUTER-BARRIER-023` |
| T08 unbounded loops | Partial/static only | `D7-CYCLE-*` |
| T09 unauthorized transform/authority | Open | `D12-*`, `D16-SECURITY-062` |
| T10 100-way bounded runtime | Partial constructor boundary only | `D18-COMPAT-BENCH-064` |
| T11 all failure policies | Partial | pipeline/scheduler slices；quorum/partial/full matrix open，`D8`, `D11` |
| T12 real backpressure | Local pass，P0 cap join open | `D7-PIPELINE-CONFORMANCE-013` |
| T13 barrier deadline stats | Open/Partial evaluator | `D6-ROUTER-BARRIER-023` |
| T14 router replay no rejudge | Open | `D6` + `D9-DURABLE-EXT-CONFORMANCE-034` |
| T15 malicious patch/dry run | Open | `D7-CYCLE-*`, `D12`, `D16` |
| T16 verifier pass/reject/abstain | Open | `D11-*` |
| T17 global seen-set convergence | Open | `D7-CYCLE-*` |
| T18 every hard budget dimension | Partial attempts/fanout only | `D7`, `D10` |
| T19 every crash window | Partial local recovery only | `D9-DURABLE-EXT-CONFORMANCE-034` |
| T20 dual resume race | Open | `D9-DURABLE-EXT-CONFORMANCE-034`, `D15` |
| T21 replay/fork lineage | Open | `D9-*` |
| T22 stale approvals | Open | approval task + `D9`, `D11` |
| T23 worktree conflicts | Open | `D12-*` |
| T24 namespace isolation | Open | `D12-*`, `D16` |
| T25 provider fallback/circuit | Open | `D13-*` |
| T26 secret redaction | **Red / critical** | `D9-REDACTION-039`, `D16` |
| T27 cancel runtime/provider/tool | Partial native runtime/pipeline | `D8`, `D13` |
| T28 prompt injection/authority | Open | `D12`, `D16` |
| T29 complete CLI/MCP | Partial six TS commands/read-only MCP | `D3-PY-CLI-021`, `D8`, `D14`, `D19` |
| T30 Event/Checkpoint/Artifact/Lock + stores | Partial memory/JSONL/file | `D9`, `D15`, `D18` |
| T31 all 10 patterns x 3 forms | Open | pattern tasks + `CTRL-PATTERNS-071` |
| T32 1,000-node resource bound | Open | `D18-COMPAT-BENCH-064` |
| T33 kill/network/store/artifact chaos | Open | `D15`, `D16`, `D18` |

### P1-08 — Q01–Q11 quantitative gate 状态

| Gate | 当前判定 | 最小机器验收 |
|---|---|---|
| Q01 90% statements/85% branches per subsystem | Open | `pnpm coverage:release && uv run --project python coverage run -m pytest && node scripts/check-coverage-thresholds.mjs` |
| Q02 >=250 cases/language | Local raw counts pass；candidate report Open | `node scripts/test-inventory.mjs --exclude-skipped --candidate "$CANDIDATE_SHA"` |
| Q03 shared adapter/storage suite | Open/Partial basic persistence | `pnpm test:adapter-conformance && pnpm test:storage-conformance` |
| Q04 100 randomized failures | Open | `pnpm test:chaos -- --runs 100 --write-seeds codex_logs/release-evidence/chaos/seeds.json` |
| Q05 Linux/macOS/Windows matrix | Partial Linux only | `node scripts/check-ci-matrix.mjs .github/workflows/ci.yml` 加 immutable CI run URLs |
| Q06 mock default/live opt-in | Partial mock only | `node scripts/check-provider-ci-policy.mjs` 加 opt-in live reports |
| Q07 >10% perf gate | Open | `node scripts/check-bench-regression.mjs --threshold 0.10 --require-baseline-adr` |
| Q08 no high/critical + all scans | **Red/Open** | redaction、secret/license/SBOM/fuzz 未过；`pnpm security:release` |
| Q09 trusted publishing/provenance | Open/External | `node scripts/verify-release-provenance.mjs --manifest ...` |
| Q10 <=3 commands + 80% <=5min | Partial/External | `node scripts/check-usability-evidence.mjs --min-rate .8 --max-seconds 300` |
| Q11 zero P0/P1 + >=5 reports | Open/External | 同上加 immutable issue query 与 reviewer sign-off |

这里列出的新 script names 是所对应任务应新增的验收器；当前缺失本身就是 gap，
不能把“命令不存在”解释成免验收。

### P1-09 — security/supply-chain 只有基础 CI，没有 release-grade evidence

任务：`D9-REDACTION-039`, `D12-ISOLATION-REDTEAM-047`, `D16-SECURITY-062`,
`D20-PROVENANCE-066`。证据路径：`.github/workflows/{codeql,dependency-review}.yml`、
`SECURITY.md`，以及当前不存在的 `tests/security/`, `sbom/`, release reports。

当前存在 CodeQL、dependency review、Dependabot、`pnpm audit:prod` 与 package
content checks；不存在 accepted threat model review、secret scan、license inventory/
third-party notices、SBOM、fuzz/property/chaos、seeded-secret control、clean trusted
runner reproducibility、checksum/attestation 与 high/critical disposition。`D16` 单任务
覆盖面过大，且 external reviewer/法律责任/凭据门槛未显式登记。

机器验收：`corepack pnpm security:release && node
scripts/verify-release-provenance.mjs --candidate "$CANDIDATE_SHA"`，报告必须把每个
finding 映射为 accepted fixed/waived-by-authorized-reviewer；high/critical 不允许无声
waiver。

### P1-10 — privacy、external study 与 support readiness 粒度不足

任务：`D17-BETA-063`, `CTRL-GROWTH-072`, `D21-RELEASE-067`，以及建议新增的
`D16-PRIVACY-079`, `D17-USABILITY-076`, `D18-SUPPORT-READINESS-080`。证据路径：
release `UX09/DOC12/SUP01-SUP08` 与当前缺失的 usability/support manifests。

`D17-BETA-063` 提到 consent-safe script，但没有独立 retention、withdrawal、PII
redaction、gallery consent manifest 验收；`D21-RELEASE-067` 把 roster、incident、
rollback、deprecate/yank、support-bundle redaction 全放在发布当天。release checklist
的 `UX09`, `DOC12`, `SUP01-SUP08` 需要可在 publish 之前失败的独立任务。

机器验收：`node scripts/check-usability-evidence.mjs --require-consent && node
scripts/check-support-readiness.mjs --candidate "$CANDIDATE_SHA" --tabletop-required`。

## 6. D9-REDACTION-039 控制文档同步清单

新增 task 的依赖边已经进入 registry，但以下文档尚无 `D9-REDACTION-039` 字样，
因此目前控制面会漏报或错误归属风险：

| 文档 | 需要同步的精确位置 |
|---|---|
| `master-plan-coverage-matrix.md` | Day 9 行加入 false-signal/current critical gap 与 control；Day 16 control 加 D9；`Durable state`、`Security/isolation` capability 行；mandatory ledger 的 redaction/T26 对应行；Q08 证据说明。文档存在状态另见 P2-01。 |
| `task-dependency-graph.md` | D09 required deliverables/entry/exit；D16 hard entry；S03 durable、S05 policy/isolation、S06 observability；I06；T26；security escape/recovery reopening rule。明确 D9 durable-ext 与 D16 均硬依赖 redaction task。 |
| `release-checklist.md` | 将 `REL-V1-02`, `REL-I06`, `REL-T26`, `REL-SC07`, `REL-SC12`, `REL-SUP06` 映射到 D9 task；扩展 T26 为“wire flag truth + sink-before-write + legacy migration”，仍保持 Open，不能因 task 已登记而 Green。 |
| `agent-ownership-map.md` | Day 9 加 redaction contract 与 TS/Python/SRV R3 review；Day 16 加 hard dependency；S03/S05/S06 closure；current ownership gaps；明确 `spec/redaction-semantics.md` 由 INT 写、双 runtime 实现、PQG canary、独立 SRV 签核。 |

同步验收：

```bash
for f in \
  codex_plans/delivery/master-plan-coverage-matrix.md \
  codex_plans/delivery/task-dependency-graph.md \
  codex_plans/delivery/release-checklist.md \
  codex_plans/delivery/agent-ownership-map.md; do
  rg -q 'D9-REDACTION-039' "$f" || exit 1
done
corepack pnpm check:docs
```

## 7. 外部权限与不可伪造门槛

Registry 目前只有 5 项带 `external_gate`；下列门槛需要补充到对应 task。准备 mock、
fixture、dry-run 与 consent template 可以在仓库内完成，实际权限/人类证据不得推断。

| 外部门槛 | 影响 task/gate | 所需证据 | 当前登记情况 |
|---|---|---|---|
| 五名以上真实外部 tester、80%/5min、retest | `D17`, Q10/Q11, UX01-10 | consented/redacted reports、timing method、cohort、disposition、independent review | 已粗略登记，但需从 Beta artifact 拆出独立外部任务。 |
| OpenAI/Anthropic/Gemini/compatible live accounts and keys | `D13`, Q06, T25 | opt-in/nightly run IDs、rate/fallback/cancel evidence；零 secret 入库 | 未登记 external gate。 |
| npm/PyPI namespace ownership 与 OIDC trusted publisher admin | `D14 npm dist`, `D20`, SC01/02, PKG13 | 当前 lookup、owner/role、least-privilege identity、rehearsal | D20 只做聚合描述；需分 npm/PyPI 身份。 |
| GitHub repo admin：branch/tag/release/environment protection | `D19-D21`, SC05/14, RC02/06/07 | protection snapshot、signed tag/release、immutable run/artifact URLs | 未在 D19 明示。 |
| Hosting/domain/CDN 与 channel posting accounts | `CTRL-GROWTH`, `D20-D21`, DOC03/11-16 | deploy preview、DNS/hosting authority、current links、posting owner | D20 泛化为 hosting；growth 只登记 star 非保证。 |
| macOS/Windows runners 与 Actions capacity | `D18`, Q05 | 全 matrix immutable run，不能 allowed-failure | 未登记。 |
| Postgres/S3-compatible integration infra/credentials | `D15`, T30/T33 | disposable namespace、cleanup、race/chaos report；本地容器可作为无外权替代 | 未登记，需明确 local-vs-hosted fallback。 |
| 独立 security/go-no-go/release reviewer，必要时 legal/license reviewer | `D12`, `D16`, `D19-D21`, Q08 | distinct identity、scope、revision、findings/disposition、signature/date | owner 文本有 reviewer，external gate/availability 未登记。 |
| case study/adopter/gallery consent 与撤回/保留责任 | `D17`, docs/growth, UX09/DOC08/DOC12 | per-entry consent、redaction、retention/withdrawal、authentic source | 未独立登记。 |
| launch/support roster acknowledgement 与 registry yank/deprecate authority | support task, `D21`, SUP01-08 | UTC roster、escalation、dry-run、owner roles、non-destructive procedure | 仅埋在 D21 expected test。 |

机器只能验收证据引用的完整性，不能制造权限本身：

```bash
node scripts/check-external-authority-manifest.mjs \
  --candidate "$CANDIDATE_SHA" \
  --require-consent --require-expiry --require-reviewer --reject-secrets
```

缺失/过期/不可验证的权限必须输出 `Blocked`，而不是 `Green` 或空值。

## 8. P2：控制面精度与文档维护缺口

### P2-01 — coverage matrix 的 required-document snapshot 已过时

任务：`CTRL-DOCS-073`, `CTRL-GROWTH-072`, `CTRL-PLAN-COVERAGE-001`。证据路径：
`master-plan-coverage-matrix.md` 的 required-document table 与
`codex_plans/{research,architecture,growth}` 实际目录。

Matrix 仍把 competitor matrix 以及 graph IR/runtime/persistence/security 四份
architecture 文档写为 `Open`。当前这些路径已出现，但均为 untracked/未完成 review；
正确更新应是 `Present, unreviewed` 或 `Present, acceptance Open`，不能直接 Green。
growth 的 launch plan 与 content calendar 已出现，但 metrics/experiments 仍不存在，
并造成两条 broken links。验收应同时检查 presence、git identity、domain review 与
status-claim audit。

机器验收：`node scripts/check-plan-document-inventory.mjs && corepack pnpm check:docs`。

### P2-02 — registry 元数据没有原子更新

任务：`CTRL-EVIDENCE-002`, `CTRL-PLAN-COVERAGE-001`, `D9-REDACTION-039`。证据
路径：`codex_logs/task-registry.json` 根时间戳及每项 status/timestamps/evidence。

- registry `updated_at` 早于新 `D9-REDACTION-039.assigned_at`。
- completed tasks 全无 `completed_at`。
- 新 redaction task 已由下游依赖，但四份控制文档未同步。

应由 `scripts/check-task-registry.mjs --strict` 在 CI 拒绝上述状态，而不是依靠人工
发现。

### P2-03 — expected artifacts 过多使用目录或未来路径，不能唯一定位证据

任务：所有未来 implementation/release tasks，治理 owner 为 `CTRL-EVIDENCE-002`。
证据路径：`codex_logs/task-registry.json` 的 `expected_artifacts` 与
`release-checklist.md` 的 Evidence slots。

例如 `spec`、`packages/runtime`、`docs`、`.github/workflows`、`codex_logs/release-evidence`
都太宽；文件存在无法说明哪一 revision/command/reviewer 满足哪一 requirement。
后续 task 应给出 report manifest 路径、schema 与 content digest。

机器验收：`node scripts/check-evidence-schema.mjs --reject-directory-only-artifacts
--require-digests --require-reviewer`。

### P2-04 — docs check 只验证链接

任务：`CTRL-DOCS-073`, `D14-API-FREEZE-050`, `D18-EDUCATION-ASSETS-083`（建议
新增）。证据路径：`scripts/check-doc-links.mjs`、`docs/`、`codex_plans/growth/`。

现有 `scripts/check-doc-links.mjs` 当前还因缺失 growth metrics 文件而失败；即使修好，
它也不执行 snippets、不比对 CLI help/API exports、不检查 bilingual/version/claims，
也不验证 hosted assets。`CTRL-DOCS-073` 的
expected tests 需要拆为 links、snippets、API/CLI diff、status audit、bilingual、
deployed-link 六个机器报告。

机器验收：`corepack pnpm check:docs && node scripts/check-doc-snippets.mjs && node
scripts/check-doc-claims.mjs --candidate "$CANDIDATE_SHA"`。

### P2-05 — 本地版本与 release matrix 不能混用

任务：`D18-COMPAT-BENCH-064`, `CTRL-ACCEPTANCE-070`。证据路径：
`.github/workflows/ci.yml` 与未来 `codex_logs/release-evidence/matrix/`。

本轮 Python 是 3.14，而承诺矩阵是 3.11/3.12/3.13；本地 Node 22/Linux 成功不能
证明 Node 20、macOS、Windows。每个 report 必须记录 OS image、runtime、package
digest 和 candidate SHA。

机器验收：`node scripts/check-ci-matrix.mjs .github/workflows/ci.yml --require-os
linux,macos,windows --node 20,22 --python 3.11,3.12,3.13` 加每个 cell 的 immutable
run URL/digest manifest。

## 9. 精确 registry patch 建议（本审计不直接应用）

以下是 selector-based semantic patch；新增 ID 在当前 91 项中均未占用。每个新增
task 都应设置 `status: planned`、`started_at: null`、`evidence_required: true`，并遵守
单 primary owner。`assigned_at` 与 `last_heartbeat` 必须取实际 apply UTC，
`blocker: null`；不得回填本审计时间。Work packages 建议为：074/075/086/089
属于 `WP11-WP12`，076/079/080/083 属于 `WP10-WP12`，077/087/088 属于
`WP3-WP9-WP11`，078 属于 `WP10-WP11`，081/082 属于 `WP7-WP11`，084/085
属于 `WP4-WP11`。每项 `next_action` 必须是表中第一个尚未满足的 expected test，
而不是泛化“继续实现”。

### 9.1 必须新增的任务

| 新 ID | Title / owner / risk | depends_on | expected_artifacts | expected_tests / external_gate |
|---|---|---|---|---|
| `CTRL-RELEASE-MAP-074` | Machine-map every release leaf / INT primary，PQG review / critical | `CTRL-PLAN-COVERAGE-001` | `release-task-map.json`, checker + negative tests | 178/178 unique mapping、blocking classification、existing IDs、no dangling/cycle；无外部门槛 |
| `CTRL-EVIDENCE-BACKFILL-075` | Candidate revalidation overlay for historical completed tasks / INT primary，independent review / critical | `CTRL-EVIDENCE-002` | `codex_logs/release-evidence/task-revalidation.json` | every release-closure ancestor has revision/command/result/artifact/reviewer/exclusions |
| `D17-USABILITY-076` | External Beta usability and consent evidence / PQG primary，EXT evidence / critical | `D17-BETA-063`, `D16-PRIVACY-079` | `codex_logs/usability`, method/consent schemas | >=5 reports、>=80% <=300s、retest、zero P0/P1；external testers + elapsed time |
| `D9-APPROVAL-077` | Canonical approval/idempotency authority contract / INT / critical | `D6-DURABLE-SPEC-010`, `D9-REDACTION-039` | `spec/approval-semantics.md`, shared fixtures | approve/reject/revoke/expire、graph/run/revision binding、stale reject、idempotency key、redacted audit |
| `D14-NPM-DIST-078` | Canonical unscoped npm distribution / TS+PQG, TS primary / critical | `D14-API-FREEZE-050`, `D3-CLI-002` | explicit package path + distribution ADR | tarball clean install Node20/22、no workspace refs、`graph`/`grapheng`、nonempty real package；npm namespace authority only for live rehearsal |
| `D16-PRIVACY-079` | Telemetry/usability/gallery consent, retention and redaction / PQG primary，SRV review / high | `D9-REDACTION-039`, `D12-ISOLATION-REDTEAM-047` | `docs/PRIVACY.md`, evidence schemas | default-off、PII canary、minimal retention、withdrawal/deletion、gallery consent；human data owner/consent |
| `D18-SUPPORT-READINESS-080` | Pre-publish support and incident readiness / INT primary，PQG+SRV review / critical | `D16-SECURITY-062`, `D18-COMPAT-BENCH-064` | runbooks、roster、support-bundle tests | SUP01-08、rollback/deprecate/yank/forward-fix、incident tabletop；roster/registry authority |
| `D13-TS-ADAPTERS-081` | TS adapters / TS / high | `D13-ADAPTER-SPEC-048` | `packages/adapters` | mock/provider/http/shell/MCP focused suite；live vendor credentials opt-in |
| `D13-PY-ADAPTERS-082` | Python adapters / PY / high | `D13-ADAPTER-SPEC-048` | `python/src/graph_engineering/adapters` | same native suite；live vendor credentials opt-in |
| `D18-EDUCATION-ASSETS-083` | Course/case studies/demo/bilingual executable assets / PQG / high | `CTRL-PATTERNS-071`, `D15-EXPLORER-060`, `D17-BETA-063`, `D14-API-FREEZE-050` | course manifest、case/demo/launch manifests | 14 runnable steps、4 authentic cases incl failure、90s uncut demo、claim/version/bilingual checks；consent for external stories |
| `D8-RUNTIME-CHAOS-084` | Runtime retry/cancel/noncooperative chaos / PQG primary，native reviewers / high | `D7-CYCLE-CONFORMANCE-027`, `D7-PIPELINE-CONFORMANCE-013` | `tests/chaos/runtime` | bounded seeds、no deadlock/leak/unbounded retry、exact attempts |
| `D9-OPS-CONTROL-085` | Durable operational command surface / PQG / high | `D9-DURABLE-EXT-CONFORMANCE-034`, `D8-RUNTIME-CHAOS-084` | CLI/Python CLI/docs | status/watch/inspect/logs/pause/resume/cancel/retry JSON/exits/races |
| `CTRL-RELEASE-ROLLUP-086` | Final candidate-bound stable-vs-RC decision / INT primary，independent R3 review / critical | `D20-PROVENANCE-066`, `CTRL-ACCEPTANCE-070`, `CTRL-PATTERNS-071`, `CTRL-DOCS-073`, `CTRL-GROWTH-072`, `D17-USABILITY-076`, `D18-SUPPORT-READINESS-080`, `CTRL-EVIDENCE-BACKFILL-075`, `CTRL-RELEASE-MAP-074` | immutable roll-up、blocker manifest、signed decision | all blocking leaves Green or explicit full-RC/no-release; reopen invalidation; external reviewer + publishing authority only after decision |
| `D9-TS-REDACTION-087` | TS sink-before-write redaction / TS / critical | `D9-REDACTION-039` | `packages/persistence`, `packages/runtime` | flag truth、all TS sinks canary-free、identity preservation、legacy migration |
| `D9-PY-REDACTION-088` | Python sink-before-write redaction / PY / critical | `D9-REDACTION-039` | `python/src/graph_engineering` | same native acceptance and cleanup |
| `D9-REDACTION-CONFORMANCE-089` | Cross-language redaction/security join / INT primary，PQG canary + SRV review / critical | `D9-TS-REDACTION-087`, `D9-PY-REDACTION-088` | shared fixtures、canary report、signed disposition | identical flags/migration/identity、all sink-byte scans、independent security acceptance |

### 9.2 精确修改现有任务

1. `D13-ADAPTERS-049`：owner 改为 `main + independent conformance reviewer`；
   depends_on 改为 `D13-TS-ADAPTERS-081`, `D13-PY-ADAPTERS-082`；expected artifacts
   收窄到 shared fixtures/reports；不得再由两个 implementation lanes 自审。
2. `D17-BETA-063`：收窄为 immutable beta artifact/API docs/bug burn-down；移除外部
   timing/report completion；外部证据移到 `D17-USABILITY-076`。D18 仍依赖 Beta
   artifact，但不被 tester elapsed time 阻塞。
3. `D20-PROVENANCE-066`：title/exit 收窄为 provenance assembly and rehearsal，
   不再自称 final go/no-go；final decision 由 `CTRL-RELEASE-ROLLUP-086` 生产。
4. `D21-RELEASE-067`：depends_on 用 `CTRL-RELEASE-ROLLUP-086` 替代分散的控制项，
   并保留 D20；发布命令必须验证 roll-up candidate digest。
5. `D19-RC-065`：新增 dependencies
   `CTRL-PATTERNS-071`, `D18-EDUCATION-ASSETS-083`,
   `D18-SUPPORT-READINESS-080`。后者按上表依赖 D16+D18，不依赖 D19，故没有环；
   若 post-RC rehearsal 必须消费 RC artifact，应另建后置 evidence step，不能让
   pre-publish runbook/roster 被它阻塞。
6. `CTRL-DOCS-073`：增加 API freeze、Explorer/performance、security、patterns、
   education assets 前置，或拆成早期 planning docs 与 final candidate docs 两项；
   不能保持零依赖并作为 D19 gate。
7. `CTRL-ACCEPTANCE-070`：明确只汇总 implementation/quality/usability leaves，
   provenance leaves 由 D20 生产、最终由 086 汇总；不要声称自己在 D20 之前已经
   验收全部 178。
8. `D9-DURABLE-EXT-CONFORMANCE-034`：增加 router decision zero-rejudge replay、
   approval binding、redaction migration/canary joins。
9. `D16-SECURITY-062`：保留对 `D9-REDACTION-039` 的新依赖，并增加 Explorer/
   observability 完整 surface；按下一条拆分后改依赖
   `D9-REDACTION-CONFORMANCE-089`；补 external reviewer availability 与
   legal/license owner。
10. `D2-BUILDERS-YAML-020`：保留当前 `in_progress`；不得因 explicit-null 子缺口
    已修复就跳过 builders/YAML/typed-port 等完整 expected scope 或提前 completed。
11. `D9-REDACTION-039`：收窄为 INT-owned canonical redaction/migration contract；
    两种实现分别由 087/088 完成，089 做独立 join。`D9-DURABLE-EXT-SPEC-031`
    保留对 039 contract 的依赖；`D9-TS-DURABLE-EXT-032`/`D9-PY-DURABLE-EXT-033`
    分别增加 087/088；`D9-DURABLE-EXT-CONFORMANCE-034` 与
    `D16-SECURITY-062` 增加 089。
12. Registry 根 `updated_at`：每次 task/dependency/status/evidence 原子更新时同步；
    CI 拒绝小于任何 task timestamp 的值。

Pattern dependency 修改按 P1-03 表逐项加入，不用新增额外 pattern IDs。

## 10. 发布证据命令集

最终候选至少应从 clean checkout/packed artifacts 运行以下入口，并把原始结果与
digests 写入 `codex_logs/release-evidence/<candidate>/`。当前不存在的入口由上述任务
负责实现。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm validate:fixtures
corepack pnpm test:conformance
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
uv sync --project python --extra dev --locked
uv run --project python pytest
uv run --project python ruff check python/src python/tests
uv run --project python mypy --config-file python/pyproject.toml python/src
corepack pnpm check:packages
corepack pnpm check:packed-install
python3 scripts/check-python-artifacts.py
corepack pnpm check:docs
node scripts/check-doc-snippets.mjs
node scripts/check-task-registry.mjs --strict --candidate "$CANDIDATE_SHA"
node scripts/check-release-task-map.mjs --map codex_plans/delivery/release-task-map.json
node scripts/release-rollup.mjs --candidate "$CANDIDATE_SHA" --fail-on-open-blocking
```

CI 还必须为 Linux/macOS/Windows、Node 20/22、Python 3.11/3.12/3.13 生成不可变
run URLs；coverage、100 randomized faults、1,000-node、provider opt-in、security、
SBOM/checksum/attestation、external usability 与 support tabletop 均要有独立 artifact，
不能只把上面命令合并成一个“tests passed”摘要。

## 11. 退出条件

本审计可在以下条件同时满足后被标记 superseded，而不是被删除：

1. P0-01/P0-02/P0-03 在同一 immutable candidate 上通过双语言与 adversarial
   验收，critical findings 有独立 reviewer disposition；
2. 178 release leaves 100% 映射，blocking 分类机器可读，最终 roll-up fail closed；
3. registry evidence/dependency/status/updated_at checks 全 Green，历史任务有候选
   revalidation overlay；
4. I01-I10、X01-X10、T01-T33、Q01-Q11 与 package/security/pattern/docs/support
   rows 都有 candidate-bound evidence；
5. 外部权限与人类证据真实取得并脱敏，不能取得时选择明确的 full RC/no-release，
   不得降格 gate 或伪造 Green；
6. `corepack pnpm check:docs` 与更完整的 snippet/API/CLI/bilingual/claim checks 通过。

在此之前，正确的发布判定保持：**stable v1 no-go；完整 RC 仍 open；继续诚实维护
source alpha 与明确 exclusions。**
