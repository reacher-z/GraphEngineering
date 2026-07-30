# D6 集成 Barrier、Quorum、Deadline 与持久化决策重放施工简报

- 状态：**契约候选已冻结（`implementationClaim: false`）；双语言实现全部未开始**
- 日期：2026-07-30（America/Vancouver）
- 对应任务：`D6-ROUTER-BARRIER-023`
- 权威计划：`codex_plans/Graph-Engineering-21-Day-Master-Plan.md` §11.3、§31.35.12
- 规范源：`spec/integrated-barrier-semantics.md`
- 基线：分支 `feat/authoring-foundation`，`HEAD=3fea613`，工作区含 SQLite lane 未提交增量

## 0. 为什么这条 lane 现在才开

`D6-ROUTER-BARRIER-023` 的**路由一半**已经在 §31.35.12 记录的生产审计中被接受：
编译器诊断 `GE1401`–`GE1407`、`routedBranches` policy lowering、普通执行、
durable start/resume 前置能力闸门都已实现并通过 H0/M0 独立审查。

那次验收在结尾**明确排除**了以下内容，并说明 `D6-ROUTER-BARRIER-023` 因此仍然 open：

> dedicated durable `RouteSelected` identity, zero-rejudge decision replay,
> integrated all/minimum/percentage barriers, quorum, abstention, deadlines,
> late-arrival policy, cancellation propagation, barrier trace/CLI visibility
> or distributed coordination.

本简报覆盖的就是这被排除的另一半，**不重做**任何已验收的路由工作。

## 1. 当前真实边界（不得含糊）

`packages/runtime/src/scheduler.ts:982` 把 `barrier` 与 `transform` 并列，当作普通
确定性节点执行。也就是说：**当前 runtime 里 barrier 没有任何 barrier 语义**。
`packages/primitives/src/barrier.ts` 里的 `evaluateSettledBarrier` 是一个纯函数
evaluator，只支持 `all` / `minimum` / `percentage`，没有 quorum、没有 deadline、
没有 abstain/unknown、没有调度器集成、没有持久化决策。

这带来一个必须写进合约的安全事实：**一个声明了 barrier 策略的图，今天会被当成
普通 transform 执行，等于把一个未满足的 barrier 静默放行。** 因此在实现落地之前，
两个 runtime 都必须用既有的 pre-dispatch 能力闸门（与 foreign-condition preflight
同一机制）拒绝携带 exact policy 的 barrier 节点，零 executor 调用、零节点尝试、
零持久化副作用。这一条是本 lane 的第一个可交付项，先于任何 barrier 功能。

## 2. 已冻结的契约产物

| 文件 | 作用 |
|---|---|
| `spec/integrated-barrier-semantics.md` | 规范正文（唯一语义源） |
| `spec/integrated-barrier-policy.schema.json` | `barrier` 节点 `config` 的直接策略 |
| `spec/barrier-vote.schema.json` | quorum barrier 上游必须产出的投票载体 |
| `spec/barrier-decision.schema.json` | `BarrierSatisfied` 事件 `data` 的冻结文档 |
| `spec/route-decision.schema.json` | `RouteSelected` 事件 `data` 的冻结文档 |
| `spec/conformance/integrated-barrier.case.json` | 字面语料（构建中） |
| `spec/conformance/integrated-barrier.validate.mjs` | 可证伪校验器（构建中） |

契约里的几个不可让步点：

1. `onUnsatisfied` 与 `lateArrival` 对每种 kind 都是 **required，没有默认值**。
   一个被静默默认的未满足 barrier 正是本契约要消灭的缺陷。
2. 未满足的 barrier **永不 succeed、永不绑定输出**。三种 resolution
   （`fail` / `unknown` / `awaiting_human`）都不是通过。
3. quorum 的 `unknown` 票**始终计入 participant，永不计入 accept**。
   畸形票是 `INVALID_BARRIER_VOTE`，一次尝试后不可重试，**绝不降级为 abstain**。
4. 百分比与配额算术全部是精确安全整数乘法，**任何语言都不得出现浮点比值**。
5. deadline 只对注入的确定性时钟求值，**不读挂钟、不用定时器**，
   conformance 用脚本化 tick 列表驱动。
6. 已提交的决策**永久权威**。resume/replay/fork 时必须原样采纳，
   零 executor 调用、零重新求值、零第二次决策事件。

## 3. 施工顺序（P0 优先级，不得跳步）

- **P0-A（主 lane，已完成）**：冻结 §2 的规范与 schema。
- **P0-B（主 lane，进行中）**：产出字面语料与可证伪校验器；
  语料里的每个 `graphHash` / `policyHash` / `decisionId` 都必须由校验器独立重算，
  语料的算术期望值也必须由校验器按规范重算。语料写错必须让校验器失败。
- **P0-C（两条 lane 并行，互不写对方路径）**：
  - TS lane 拥有 `packages/core/`、`packages/runtime/`、`packages/primitives/`；
  - Python lane 拥有 `python/`。
  两边先各自实现**能力闸门**（§1），再实现编译器 pass，再实现调度器集成。
- **P0-D（主 lane）**：跨语言 join 落在 `tools/conformance/`，
  两侧各自独立重算，**禁止一侧 import 另一侧的期望值**。
- **P0-E**：文档、provider-free example、独立 hostile review（不得由实现者本人做）、
  registry evidence、覆盖矩阵更新，最后才提交。

## 4. TS lane 工作包

1. `packages/core/src/integrated-barrier.ts`（新）——照 `integrated-router.ts` 的形状写
   `validateBarrierPolicy`，返回判别联合，暴露 `IntegratedBarrierPolicySnapshot`。
   包根必须同时导出联合成员类型，避免出现不可命名的返回类型（§31.35.12 的 LOW-1）。
2. `packages/core/src/compiler.ts`——在 router pass 之后、strict typed ports 之前插入
   barrier pass，发出 `GE1421`–`GE1424`。分类顺序固定，类内按节点声明顺序。
   `GE1421` 只在**同一节点**上抑制 `GE1422`/`GE1424`，不抑制该节点的 `GE1423`，
   也不抑制任何其他节点或后续 pass。
3. `packages/runtime/src/barrier-runtime.ts`（新）——arming、disposition 归集、
   精确整数满足判定、deadline 求值、resolution、late arrival、取消传播。
4. `packages/runtime/src/scheduler.ts`——把 `barrier` 从第 982 行的 transform 分支拆出；
   先加能力闸门，再接入真实语义。新增终态 `unknown` 与 `awaiting_human`，
   下游继承 `UPSTREAM_UNKNOWN` 零尝试终态；`UPSTREAM_UNKNOWN` 与
   `ROUTE_NOT_SELECTED` 一样排除在图失败码之外。
5. `packages/runtime/src/durable.ts`——`RouteSelected` / `BarrierSatisfied` 决策的
   写入、折叠、采纳，以及 `DECISION_POLICY_DRIFT`、`DECISION_IDENTITY_MISMATCH`、
   `DUPLICATE_DECISION` 三个不可重试失败。
6. 时钟必须是构造期注入的单调毫秒源，测试用脚本化时钟。

## 5. Python lane 工作包

镜像 §4，落在 `python/src/graph_engineering/`：
`integrated_barrier.py`（新）、`compiler.py`、`barrier_runtime.py`（新）、
`scheduler.py`、`durable.py`。Pydantic 载体保持与 TS 相同的判别式、路径与快照语义。
诊断顺序必须与 TS **逐条相同**——§31.35.12 的 HIGH-3 就是因为 TS 按 router 分组而
Python 保留全局边顺序而被拒绝过一次，这里不得重演。

Python 不得通过调用 Node 或导入 TS 期望值来满足任何一条 conformance。

## 6. 验收门禁

```
corepack pnpm -r typecheck && corepack pnpm -r lint && corepack pnpm -r build && corepack pnpm -r test
uv run --project python pytest
uv run --project python ruff check python && uv run --project python ruff format --check python
uv run --project python mypy --strict python/src
node scripts/validate-fixtures.mjs
node tools/conformance/run.mjs
corepack pnpm check:release-map && corepack pnpm check:evidence-closure && corepack pnpm check:docs
git diff --check
```

外加 `spec/integrated-barrier-semantics.md` §"Conformance requirements" 的 13 条，
逐条对应到可执行证据。任何一条没有可执行证据，本任务不得标为 completed。

## 7. 明确非宣称

本 lane **不**交付：人工审批的恢复授权（属 `D9-APPROVAL-077`）、verifier rubric 与
judge panel（属 `D11-*`）、预算计费（属 `D10-*`）、分布式 barrier 协调（属
`D15-STORAGE-WORKERS-054`）、barrier 的 Explorer/CLI 可视化（属 `D13-DX-051` 与
`D15-EXPLORER-060`）、任何 provider 调用、任何挂钟计时。

契约冻结本身不是能力。在 P0-C 与 P0-D 的可执行证据出现之前，
`implementationClaim` 保持 `false`，覆盖矩阵里 Day 6 一行保持 Partial。
