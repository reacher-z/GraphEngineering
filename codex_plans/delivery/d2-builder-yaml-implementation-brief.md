# D2 通用 Builder、Safe YAML、Typed Port 与初始 Revision 施工简报

- 状态：**Ready for contract freeze; implementation not started**
- 日期：2026-07-26（America/Vancouver）
- 对应任务：`D2-BUILDERS-YAML-020`
- 权威计划：`codex_plans/Graph-Engineering-21-Day-Master-Plan.md`
- 架构账本：`codex_plans/architecture/graph-ir-and-schema.md`
- 审计基线：`HEAD=d4de336`，分支 `feat/pipeline-runtime`，dirty worktree
- 本文作用：把 D2 剩余范围拆成可并行施工、可共享验收、不会过度宣称的契约。

本文是在完整阅读 355 行主计划后，对当前 TypeScript、Python、Graph IR、
CLI、共享 conformance 与发布控制做的只读审计。除本文外，本轮不修改实现、
schema、fixture、registry 或日志。

## 1. 结论与 P0 顺序

当前 D2 只能标为 **Partial / in_progress**。现有安全整数范围内的整图 canonical
JSON/hash、静态 DAG 编译、TS/Python GraphSpec 投影和 explicit-null 拒绝已经有
共享证据；下面四项仍未实现：

1. 任意 GraphSpec 的 TypeScript/Python 通用 builder；
2. 有明确安全子集与重复键策略的 YAML authoring；
3. 可证明、跨语言一致的 typed-port 编译诊断；
4. node/edge/schema 组件哈希和 revision-1 身份清单。

施工顺序必须是：

1. **P0-A：主 Agent 冻结本文第 3-6 节的规范选择和诊断码。** 未冻结前，TS、
   Python 不得各自发明 YAML 或端口规则。
2. **P0-B：先落共享正负 fixtures 与 expected 投影，再并行写双语言实现。**
3. **P0-C：TS builder/identity/port 与 Python builder/identity/port 并行；CLI/YAML
   集成只消费冻结 API。**
4. **P0-D：共享 conformance join 通过后，才补文档、pack/install 和不可变候选证据。**

`GraphPatched`、revision 2+、运行中修改图、patch 授权/预算、durable fold 均属于
`D7-CYCLE-*` 与后续 durable 任务，**不属于 D2**。D2 只建立 initial revision 1
身份和对不支持 revision 的 fail-closed 诊断，不能宣称动态 GraphPatch 已实现。

## 2. 当前可复现基线

### 2.1 已实现且必须保留

- `spec/graph.schema.json` 是唯一 Graph IR 语义源；CLI/MCP 内的 schema 是发布副本。
- `packages/core/src/canonical.ts` 与 Python canonical/portable JSON 边界产生一致的
  diamond hash，并拒绝非有限、非安全、hostile 或不可移植输入。
- `compileGraph` / `try_compile_graph` 对 identity、endpoint、entrypoint、reachability、
  cycle、maxFanOut 和 maxDepth 给出稳定诊断。
- node/edge 声明数组顺序是语义顺序和 hash 输入；不能由 builder 擅自排序。
- 4 个 explicit-null 共享 fixtures 已存在；Python 还覆盖 7 个模型的 27 个已知
  optional 字段。`config: null` 与未知 policy extension 中的 null 仍合法。
- CLI 的 `validate/compile/plan/visualize` 目前只通过 `JSON.parse` 读入 JSON。
- `@graph-engineering/patterns` 只有四个专用构造器，不等于通用 builder。
- durable runtime 当前固定 `graphRevision=1`；事件枚举中的 `GraphPatched` 只是保留词。

### 2.2 本轮只读验证

以下命令在 dirty worktree 上通过，只是施工前基线，不是 release candidate 证据：

```bash
corepack pnpm --filter @graph-engineering/core test
# 2 files, 41 tests passed

uv run --project python pytest -q \
  python/tests/test_models.py python/tests/test_compiler.py
# 69 passed

corepack pnpm test:conformance
# 12 graph fixtures；ready queue、invalid/cancel、barrier 8、router 12、
# persistence、durable、双向 terminal history 2、pipeline 8 全部通过
```

### 2.3 架构账本需要同步的事实

`graph-ir-and-schema.md` 中“Python 接受 optional explicit null”的描述已被当前
工作树修复。实施 D2 时应把该项改为 Green，但不得因此把 builders、YAML、typed
ports 或 revision identity 推断为已完成。

## 3. 必须先冻结的公共契约

### 3.1 源与输出边界

所有 authoring 路径必须汇入同一管线：

```text
JSON text ─ strict source decode ─┐
YAML text ─ safe source decode ──┼─ portable JSON snapshot ─ GraphSpec compile
TS builder ─ detached calls ─────┤                         ├─ canonicalGraph
Python builder ─ detached calls ─┘                         ├─ graphHash
                                                           └─ revision-1 identity
```

不可出现“YAML compiler”“builder compiler”和现有 core compiler 三套语义。source
decoder 和 builder 只生产 Graph IR；最终有效性、拓扑、端口、hash 与诊断均由 core
compiler 决定。

### 3.2 D2 新规范文件

主 Agent 先新增并审阅：

- `spec/authoring-semantics.md`：builder 顺序、snapshot、safe YAML、source error；
- `spec/compiled-identity.schema.json`：revision-1 组件身份清单；
- `spec/README.md`：把两者加入规范索引并明确 GraphPatch 排除项；
- 一个 ADR：采用“strict-exact typed ports”而不是未经证明的通用 JSON Schema
  assignability。

规范冻结应产生一条 ADR/decision 日志，记录 API version、诊断码、YAML 限制、
domain-separated hash preimage 与 GraphPatch 非目标。任何一边实现不允许先于该记录。

## 4. 通用 Builder 契约

### 4.1 建议公共 API

TypeScript：

```ts
const built = graphBuilder({ metadata, inputSchema, outputSchema, policies })
  .addNode(split)
  .addNode(merge)
  .addEdge(edge)
  .addEntrypoint("split")
  .addOutput("result", { node: "merge" })
  .build();

built.graph;
built.canonicalGraph;
built.graphHash;
built.identity;
```

Python 使用同一操作模型与 snake_case 名称：

```python
built = (
    graph_builder(metadata=metadata, input_schema=input_schema, output_schema=output_schema)
    .add_node(split)
    .add_node(merge)
    .add_edge(edge)
    .add_entrypoint("split")
    .add_output("result", {"node": "merge"})
    .build()
)
```

两边的 `BuiltGraph` 公开字段语义相同：GraphSpec snapshot、canonical text、整图
hash、initial identity。命名可以语言惯用，但导出的 JSON 结果必须完全一致。

### 4.2 Builder 不变量

1. constructor 必须显式接收 metadata、inputSchema、outputSchema；不得生成 graph
   name/version，不得根据节点推断 schema。
2. entrypoints 和 outputs 必须显式加入；不得按首节点、零入度或 sink 推断。
3. node/edge 按 `add*` 调用顺序保留；不得按 ID 排序。该顺序影响调度和 graphHash。
4. output map 的 key 重复、entrypoint 重复、node ID 重复、edge ID 重复在 builder
   层立即成为结构化错误；不得覆盖前值。
5. 每次 `add*` 时立即做 portable detached snapshot。调用者随后修改原对象不得改变
   builder；getters/proxies/custom mappings 不得被执行或泄漏内部异常。
6. optional 字段的“缺失”和 `null` 不得合并。已知 non-null optional 字段出现 null
   时失败；required `config: null` 原样保留。
7. `build()` 只能成功一次并 seal builder；后续 mutation 返回/抛出
   `GE_BUILDER_SEALED`，不能悄悄产生第二个身份不同的图。
8. `build()` 必须调用 canonical compiler；失败携带完整 compiler diagnostics，不能
   返回 null、部分 graph 或“best effort”结果。
9. 成功的 `BuiltGraph` 身份来自 compiler 的单次 detached capture。graph、canonical
   text、graphHash、component hashes 必须绑定同一 snapshot。
10. TS 返回深冻结 plain GraphSpec。Python 必须保证 `BuiltGraph` 内部 canonical
    snapshot 不被嵌套 dict/list 修改；若 Pydantic model 不能深冻结，则 `graph` 属性
    返回重新验证的副本，而身份字段永远从私有 canonical bytes 派生。
11. 不自动添加 capability、pattern、typed-port 或 revision 字段。strict typed port
    只由显式 policy helper 开启。
12. 不生成 node/edge ID。自动 ID 会把调用顺序、并发和语言实现差异写入 hash。

### 4.3 Builder 错误投影

两边异常/结果至少归一化为：

```json
{
  "code": "GE_BUILDER_DUPLICATE_NODE",
  "message": "...",
  "path": "#/nodes/1/id",
  "diagnostics": []
}
```

固定 builder code：

| Code | 触发 |
|---|---|
| `GE_BUILDER_INVALID_INPUT` | 非 portable、非法 null、非法 metadata/schema/endpoint |
| `GE_BUILDER_DUPLICATE_NODE` | 重复 node ID |
| `GE_BUILDER_DUPLICATE_EDGE` | 重复 edge ID |
| `GE_BUILDER_DUPLICATE_ENTRYPOINT` | 重复 entrypoint |
| `GE_BUILDER_DUPLICATE_OUTPUT` | 重复 public output name |
| `GE_BUILDER_MISSING_REQUIRED` | build 时缺 entrypoint/output 或必需 envelope |
| `GE_BUILDER_CORE_REJECTED` | canonical compiler 拒绝；附原始 diagnostics |
| `GE_BUILDER_SEALED` | build 后继续写 |

## 5. Safe YAML v1alpha1

### 5.1 输入格式和 CLI

- 文件扩展名 `.json`、`.yaml`、`.yml` 可在 `auto` 模式选择 decoder。
- stdin `-` 不做内容嗅探；默认保持 JSON，YAML 必须显式
  `--input-format yaml`。
- 现有 `visualize --format mermaid|dot` 保留；输入格式必须使用独立的
  `--input-format json|yaml|auto`，不能复用 `--format`。
- Node 读取 bytes 后用 fatal UTF-8 decoder；Python 使用 strict UTF-8。非法字节是
  source error，不能被 replacement character 悄悄替换。
- source decode error 使用 CLI input exit code 2；成功解析但 Graph IR 无效使用
  compiler exit code 1。

### 5.2 允许的 YAML 子集

允许 YAML 1.2 的单文档、JSON-compatible 数据模型：mapping、sequence、string、
finite number、boolean、null。comments、flow/block collection 与普通 block string
可用。mapping key 必须是 string；sequence 顺序严格保留。

必须拒绝：

- 第二个 document 或 document stream；
- duplicate mapping keys（任何深度、在构造 object 前检测）；
- anchors、aliases、merge key `<<`；
- explicit/custom tags、directives、schema 扩展；
- complex/non-string keys；
- timestamp/date/binary/set/ordered-map 等非 JSON 类型；
- `.nan`、`.inf`、非有限数、超出 JS safe integer 的整数；
- parser-specific YAML 1.1 coercion；`yes/no/on/off` 不能跨语言变成不同 boolean；
- cyclic/shared alias graph、超过 1 MiB source、100 层 nesting 或 100,000 AST nodes；
- parser warning 被忽略、unknown token 被恢复、partial document 被返回。

建议 TS 使用 `yaml` major 2 的 document AST，Python 使用具备 YAML 1.2 AST/event
能力的 `ruamel.yaml`；两边都先检查 AST，再构造 null-prototype/plain JSON，最后走
portable snapshot。依赖版本由 lockfile 固定并经过 production audit，不能依赖
`safeLoad` 名字就假设重复键、alias 或 YAML 1.1 coercion 已安全。

### 5.3 YAML source error

统一字段为 `code/format/message/path/line/column`，行列使用 1-based。固定 code：

| Code | 触发 |
|---|---|
| `GE_SOURCE_INVALID_UTF8` | 非法 UTF-8 |
| `GE_SOURCE_TOO_LARGE` | 超过 byte/node/depth bound |
| `GE_SOURCE_SYNTAX` | parser syntax error 或 trailing content |
| `GE_SOURCE_MULTIPLE_DOCUMENTS` | 多文档 |
| `GE_SOURCE_DUPLICATE_KEY` | 重复 key |
| `GE_SOURCE_UNSAFE_YAML_FEATURE` | tag/anchor/alias/merge/directive |
| `GE_SOURCE_NON_JSON_VALUE` | timestamp、complex key、非有限/不安全数字等 |

错误中不得包含整个 source、secret value、parser stack 或绝对用户路径。

## 6. Typed Port、组件哈希与 Revision-1 契约

### 6.1 为什么必须 opt-in 且保守

当前 diamond 等 graph 使用 `{ "type": "object" }`，没有 properties；若直接把完整
typed-port 检查改成默认，会破坏已发布 alpha。通用 JSON Schema assignability 又不是
简单深比较，未经规范的“兼容”会产生假安全。

D2 推荐新增 versioned policy extension：

```json
{
  "policies": {
    "graphengineering.reacher-z.github.io/typed-ports": {
      "apiVersion": "graphengineering.reacher-z.github.io/typed-ports/v1alpha1",
      "mode": "strict-exact"
    }
  }
}
```

未启用时维持现有 named-port runtime 语义，不宣称静态类型证明。启用后 fail closed。
Builder 提供显式 `enableStrictTypedPorts()` / `enable_strict_typed_ports()` helper，
只生成上述 policy，不改变 node/edge。

### 6.2 strict-exact 算法

1. entrypoint node `inputSchema` 必须与 graph `inputSchema` canonical-identical。
2. `edge.from.port` 存在时，producer `outputSchema` 必须是 object schema，包含
   `properties[port]`，并把 port 列入 `required`。
3. 没有 `from.port` 时，传输 schema 是 producer 的完整 `outputSchema`。
4. target binding key 是 `edge.to.port`，若省略则是 source node ID。consumer
   `inputSchema.properties[bindingKey]` 必须存在并在 `required` 中。
5. source transfer schema 与 target property schema 必须 canonical-identical。
   “语义近似”“integer 可赋给 number”等 widening 不在 v1alpha1；后续版本另写算法。
6. 若 edge 自带 `schema`，它必须与 source/target 两边 canonical-identical。
7. 同一 target 的两个 incoming edges 解析到相同 binding key，编译时失败。
8. public output endpoint 有 port 时，node output property 必须存在且 required；选中
   schema 必须与 `graph.outputSchema.properties[outputName]` identical，且 public
   output name 必须 required。
9. public output endpoint 无 port 时，node 完整 outputSchema 与 graph output property
   schema比较。
10. strict-exact 只接受 `value` 或省略 mode。`stream`、`artifact-ref` 当前没有 IR
    lowering，启用 strict typed ports 时必须明确失败，不能假装 value-compatible。
11. 参与比较的 root object/port schemas 必须通过 Draft 2020-12 meta-validation；
    strict-exact v1 拒绝 external `$ref`/`$dynamicRef`，避免两语言 resolution 差异。
12. 所有比较基于 detached canonical schema bytes；object key 插入顺序不影响结果。

### 6.3 新 compiler diagnostics

| Code | 稳定含义 |
|---|---|
| `GE1201_MISSING_SOURCE_PORT` | source/output endpoint port 未在 outputSchema 声明/required |
| `GE1202_MISSING_TARGET_PORT` | target binding key 未在 inputSchema 声明/required |
| `GE1203_PORT_SCHEMA_MISMATCH` | source、edge、target schema 不完全相同 |
| `GE1204_DUPLICATE_TARGET_BINDING` | 两条 edge 写同一 target input key |
| `GE1205_INVALID_PORT_SCHEMA` | strict profile schema 非 Draft 2020-12 或含不支持 ref |
| `GE1206_OUTPUT_SCHEMA_MISMATCH` | public output binding 与 graph outputSchema 不匹配 |
| `GE1207_ENTRYPOINT_SCHEMA_MISMATCH` | graph input 与 entrypoint input schema 不匹配 |
| `GE1208_UNSUPPORTED_TYPED_EDGE_MODE` | strict profile 使用 stream/artifact-ref |
| `GE1301_UNSUPPORTED_GRAPH_REVISION` | initial compiler/identity verifier 收到 revision != 1 |
| `GE1302_GRAPH_IDENTITY_MISMATCH` | identity manifest 的 graphHash 与 graph 不一致 |
| `GE1303_COMPONENT_IDENTITY_MISMATCH` | node/edge/schema hash 或顺序与 graph 不一致 |

诊断顺序固定：envelope/portable JSON → identity/reference → DAG → policies →
typed-port schema/profile → component/revision verification。TS/Python conformance 只比较
稳定 code、path、node/edge/output 标识，不比较 parser 或 validator 的英文消息。

### 6.4 Domain-separated component hashes

整图 `graphHash` 算法不变。新组件 hash 使用 UTF-8 domain separation，避免相同 JSON
在 node/edge/schema 角色间混淆：

```text
SHA256("graph-engineering/component/v1alpha1\0" + KIND + "\0" + canonical(value))
```

`KIND` 只能是 `node`、`edge`、`schema`。node/edge hash 覆盖其完整声明（包括 ID）；
schema hash 覆盖 schema object 本身，因此同一 schema 在不同 owner 可复用同一 hash。

`CompiledGraphIdentity` 至少包含：

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/compiled-identity/v1alpha1",
  "kind": "CompiledGraphIdentity",
  "graphRevision": 1,
  "graphHash": "<64 lowercase hex>",
  "nodes": [{ "id": "split", "index": 0, "contentHash": "...", "inputSchemaHash": "...", "outputSchemaHash": "..." }],
  "edges": [{ "id": "split-left", "index": 0, "contentHash": "...", "schemaHash": null }],
  "graphSchemas": { "input": "...", "output": "...", "state": null },
  "revisionHash": "<domain-separated hash of all prior fields>"
}
```

node/edge arrays保留声明顺序并带 index。`revisionHash` 的 preimage 使用独立
`graph-engineering/revision/v1alpha1\0` domain，覆盖除自身外的完整 canonical
identity。GraphSpec 本身仍没有 `graphRevision` 字段；往 GraphSpec 塞该字段继续是
`GE1007_INVALID_GRAPH`。

identity verifier 只接受 revision 1，并重算全部 hash。它不创建 revision 2，
不 emit `GraphPatched`，不改 durable history。未来 GraphPatch 必须新规范定义 parent
revisionHash、patchHash、授权和预算链路。

## 7. 共享 Fixtures（主 Agent 独占写）

### 7.1 Authoring/hash 正向 corpus

新增 `spec/conformance/authoring.case.json`，每个 case 指向明确文件并记录完整预期：

| Case | 输入/动作 | 必须相同的输出 |
|---|---|---|
| `equivalent-diamond` | JSON、YAML、TS builder、Python builder | exact GraphSpec、canonicalGraph、graphHash、identity |
| `typed-port-diamond` | strict-exact graph 的四种 authoring 路径 | diagnostics=[]、所有 component/revision hashes |
| `declaration-order` | 非字典序 node/edge 调用和 YAML sequence | 数组顺序、topological tie-break、hash |
| `explicit-null-config` | node `config:null` | null 保留且四路径 hash 相同 |
| `unicode-and-keys` | Unicode key、lone surrogate JSON vector、非 ASCII labels | canonical bytes/hash 一致 |
| `safe-integer-edges` | `±(2^53-1)` 与 timer ceiling | accepted bytes/hash 一致 |

推荐 fixture 文件：

```text
spec/conformance/authoring/
  equivalent.graph.json
  equivalent.graph.yaml
  typed-ports.graph.json
  typed-ports.graph.yaml
  declaration-order.graph.yaml
  yaml-scalars.case.json
  component-identity.expected.json
```

`component-identity.expected.json` 必须写死整图、每个 node、每个 edge、每类 schema、
revisionHash，不能运行时只比较“两边恰好一样”。

### 7.2 YAML 负向 corpus

`yaml-invalid.case.json` 引用单缺陷 source，并固定 source code 与位置类别：

- duplicate root key；duplicate nested node key；
- anchor；alias；merge key；custom tag；directive；multi-document；
- mapping 作 key；timestamp/non-JSON scalar；NaN/Infinity；unsafe integer；
- root sequence；超过 depth/node/byte limit；trailing invalid token；
- explicit null 放入 metadata.description、stateSchema、output.port、node.retry。

最后四项 parse 成 JSON 后必须继续得到现有 `GE1007_INVALID_GRAPH`，不能在 YAML 层
擅自改成成功或丢字段。

### 7.3 Typed-port/revision 负向 graph fixtures

每个 fixture 只引入一个缺陷并加入 `expected.json`：

```text
invalid-typed-missing-source-port.graph.json      -> GE1201
invalid-typed-missing-target-port.graph.json      -> GE1202
invalid-typed-schema-mismatch.graph.json          -> GE1203
invalid-typed-duplicate-binding.graph.json         -> GE1204
invalid-typed-schema-profile.graph.json            -> GE1205
invalid-typed-output-schema.graph.json             -> GE1206
invalid-typed-entrypoint-schema.graph.json         -> GE1207
invalid-typed-stream-mode.graph.json               -> GE1208
```

Revision cases放在 identity case 文件，不伪装 GraphSpec 字段：revision 0、2、unsafe
integer、graphHash mutation、node hash mutation、edge order mutation、schema hash mutation；
分别固定 GE1301/GE1302/GE1303。

### 7.4 Conformance reporter

新增 `tools/conformance/python_authoring_report.py`，并在 `run.mjs` 中生成 TS report。
标准 report：

```json
{
  "case": "equivalent-diamond",
  "sourceFormat": "yaml",
  "valid": true,
  "canonicalGraph": "...",
  "graphHash": "...",
  "identity": {},
  "diagnosticCodes": [],
  "sourceError": null
}
```

协调器必须同时比较 expected、TS、Python 三方；只比较 TS==Python 会让同样的 bug
误判为 conformance。

## 8. 文件级并行施工边界

### 8.1 Main/integration（唯一 shared writer）

- `spec/authoring-semantics.md`
- `spec/compiled-identity.schema.json`
- `spec/conformance/authoring/**`
- typed-port graph fixtures 与 `expected.json`
- `spec/README.md`、ADR/decision、最终 `tools/conformance/run.mjs` join
- 诊断码、hash vectors、policy extension 的最终签核

### 8.2 TypeScript lane

- `packages/core/src/builder.ts`
- `packages/core/src/source.ts`
- `packages/core/src/component-identity.ts`
- `packages/core/src/typed-ports.ts`
- `types.ts`、`compiler.ts`、`index.ts` 的受控扩展
- `packages/core/test/{builder,source,component-identity,typed-ports}.test.ts`
- `packages/core/package.json` 与 README

TS lane 不写 `spec/`、Python、CLI 或 conformance coordinator。现有 patterns 中的
portable snapshot/deep-freeze 逻辑应抽成 core 内部 helper 后由 patterns 消费或保持
独立；不得复制出第三套稍有不同的安全边界。

### 8.3 Python lane

- `python/src/graph_engineering/{builder,source,component_identity,typed_ports}.py`
- `models.py`、`compiler.py`、`__init__.py` 的受控扩展
- `python/tests/test_{builder,source,component_identity,typed_ports}.py`
- `python/pyproject.toml` 与 README

Python lane 不写 `spec/` 或 TS。Pydantic 的 shallow frozen 不能被误当成 nested
immutability；测试必须直接 mutation returned nested config/schema 并证明 identity
不漂移。

### 8.4 Platform/CLI lane

- `packages/cli/src/cli.ts` 或独立 `source-loader.ts`
- CLI help/README/tests；`.yaml/.yml` 与 `--input-format` 行为
- `scripts/validate-fixtures.mjs` 增加 YAML/case 引用完整性
- schema bundle byte-equality guard；packed-install smoke 加 YAML compile
- Python reporter 可以由 platform lane 新建，main 只做最终 join

CLI lane 不重新实现 parser policy；只调用 core source decoder。MCP 结构化 Graph
输入不自动获得 YAML 文本入口，除非另有明确 API/权限设计。

### 8.5 集成顺序

```text
contract + golden fixtures
        ├── TS builder/source/identity/ports ─┐
        ├── Python builder/source/identity ──┼── shared authoring conformance
        └── CLI input-format integration ────┘
                                               ├── docs/package/install gates
                                               └── independent review/evidence
```

TS 与 Python 可以最大并行；两边在 fixtures/diagnostics 未冻结前不得修改 shared
expected。CLI 可以在 source API 类型冻结后并行。最终 conformance、registry evidence
和 commit 由 main 串行完成。

## 9. 测试矩阵

### 9.1 Builder

- 四路径 exact document/canonical/hash/identity parity；
- insertion/declaration order；重复 IDs/outputs/entrypoints；缺必需字段；
- hostile getter/proxy/mapping 零执行；cyclic、sparse、class、Date、bigint/unsafe int；
- caller mutation before/after build；result nested mutation；build 后 sealed；
- optional absence/null；required config null；unknown policy extension null；
- reserved output names（`__proto__` 等）不污染原型且不被静默丢弃；
- compiler diagnostics 原样保留，无 silent null。

### 9.2 Source/YAML

- `.json/.yaml/.yml` auto；stdin explicit format；unknown extension；
- fatal UTF-8；1 MiB/100-depth/100k-node bounds；
- duplicate keys at every nesting；anchors/aliases/tags/merge/multi-doc；
- YAML 1.2 scalar traps；finite/safe numeric boundaries；
- comments/block strings/Unicode；line/column 1-based；错误不泄漏 source；
- valid YAML 与 JSON exact canonical/hash；invalid Graph YAML 仍走 GE1007。

### 9.3 Typed ports

- from.port、implicit target key、explicit target port、public output port；
- required/property 缺失；duplicate binding；edge.schema 三方一致/不一致；
- object key order不同但 schema canonical identical；
- external ref、invalid Draft 2020-12、stream/artifact；
- legacy non-opt-in diamond 仍通过且不产生虚假的 typed claim；
- TS/Python code/path/node/edge/output order完全一致。

### 9.4 Identity/revision

- golden domain-separated component hashes；重复 schema hash 复用；
- node/edge declaration order与 index；metadata-only change 只改变 graph/revision hash，
  不改变无关 node/edge content hash；
- node/edge/schema 单字段修改只改变预期 component 与 graph/revision hash；
- revision 1 default/explicit identical；revision 0/2/unsafe fail GE1301；
- manifest graph/component/order mutation fail GE1302/GE1303；
- GraphSpec 添加 graphRevision 继续 GE1007；durable revision-1 tests 不回归。

## 10. 验收命令

### 10.1 每个 lane 的 focused gate

```bash
corepack pnpm --filter @graph-engineering/core test
corepack pnpm --filter @graph-engineering/core typecheck

uv run --project python pytest -q \
  python/tests/test_builder.py \
  python/tests/test_source.py \
  python/tests/test_component_identity.py \
  python/tests/test_typed_ports.py \
  python/tests/test_models.py \
  python/tests/test_compiler.py
uv run --project python ruff check python/src python/tests \
  tools/conformance/python_authoring_report.py
uv run --project python mypy python/src/graph_engineering

corepack pnpm --filter @graph-engineering/cli test
```

### 10.2 Shared closure gate

```bash
corepack pnpm validate:fixtures
corepack pnpm test:conformance
corepack pnpm check:docs
```

报告必须明确打印 authoring cases、YAML negative cases、typed-port graph fixtures、
component hash vectors 与 revision negative cases 数量；不能只打印笼统“passed”。

### 10.3 完整仓库与发布 rehearsal

```bash
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm check:packages
corepack pnpm check:packed-install
corepack pnpm audit:prod

uv run --project python pytest -q
uv run --project python ruff check python/src python/tests tools/conformance
uv run --project python mypy python/src/graph_engineering
uv build --project python
python3 scripts/check-python-artifacts.py

git diff --check
```

packed install 必须从实际 tarball/wheel 导入 builder/source/identity API，并编译同一
YAML fixture；源码工作树 import 不算发布证据。新增 YAML/schema validator 依赖必须
出现在 tarball/wheel metadata 和 production audit 中。

## 11. Registry 与 completion evidence

`D2-BUILDERS-YAML-020` 的四条 expected test 应按下列证据关闭：

| Registry requirement | 最低完成证据 |
|---|---|
| builder hash parity | 四路径 golden case；TS/Python focused tests；packed imports |
| YAML/JSON equivalence | safe profile 正负 corpus；CLI file/stdin；三方 expected join |
| revision and typed-port diagnostics | GE1201-1208、GE1301-1303 fixtures；identity golden hashes |
| optional IR fields reject explicit null | 现有 4 shared fixtures + Python 27-field matrix + candidate conformance |

完成记录必须绑定：candidate commit SHA、spec/fixture hash、精确命令、平台/版本、
结果、不可变报告路径、独立 reviewer 与明确排除项。dirty worktree 的本地通过不能
直接把 task 标 completed。

建议完成产物：

```text
codex_logs/release-evidence/d2-authoring/<candidate-sha>/
  manifest.json
  ts-core.txt
  python-core.txt
  cli.txt
  conformance.txt
  package-install.txt
  dependency-audit.txt
  review.json
```

## 12. Definition of Done

D2 只有全部勾选才可从 `in_progress` 变为 `completed`：

- [ ] authoring、safe YAML、typed-port strict-exact、identity/revision-1 规范已审批；
- [ ] TS/Python 通用 builder 能构造任意当前 v1alpha1 GraphSpec；
- [ ] builder 无推断 root/output/ID、无覆盖重复值、无 mutation/hostile-input 漏洞；
- [ ] YAML 只接受冻结安全子集，所有危险结构 fail closed；
- [ ] JSON/YAML/TS/Python 四路径产出 exact canonicalGraph/graphHash；
- [ ] strict typed ports 产生 GE1201-1208，legacy graph 不回归也不虚假宣称；
- [ ] node/edge/schema/revision hashes 有 domain separation 与写死 golden vectors；
- [ ] initial identity verifier 对 revision/hash/order mutation fail closed；
- [ ] GraphPatch、revision 2+ 与 stream/artifact runtime 仍明确标为未实现；
- [ ] fixture validator、双语言 conformance、focused/full/package gates 全绿；
- [ ] CLI help/README、core/Python docs、architecture ledger 与 limitations 同步；
- [ ] candidate-bound evidence 和独立 review 已写入 registry/log；
- [ ] 没有把本地 green、enum、schema vocabulary 或文档当作运行时能力证明。

完成 D2 后可以解除 `D3-PY-CLI-021` 的 authoring 依赖，并为 D4 subgraph、D7
GraphPatch、D14 pattern skeleton 提供稳定入口；它本身不解除这些后续任务的任何
运行时、durability、安全或 release gate。
