# Knot Workbench 产品模型与实施规划

状态：产品模型已对齐；Phase 1～3 已实现最小纵向闭环；不是已经冻结的外部公共协议
基线：CASE1 / CASE2 多项目 Workbench
范围：Library、Project、Assembly、Case、Generation、Session、Studio 与 Run
原则：不为不存在的边界付费；单一事实来源；不修改 Journal 内核来迁就产品功能

## 1. 产品定位

Knot Workbench 是一个面向 Journal-first Agent 的建模、运行、观察和验证环境。

最接近的产品类比是 MATLAB/Simulink：

| Knot | MATLAB/Simulink |
|---|---|
| Workbench | MATLAB/Simulink 桌面环境 |
| Component Library | Block Library |
| Project | MATLAB Project |
| Assembly | `.slx` 模型 |
| Case | Test Harness、输入数据和断言 |
| Assembly Generation | 已发布的不可变模型版本 |
| Session | 一次模型运行实例 |
| Journal | 一次运行的权威事件记录 |

Simulink 用显式连线连接 Block；Knot 由事件 Protocol、插件订阅和注册顺序推导关系。

Workbench 的主线是：

```text
Compose → Validate → Publish → Run → Inspect → Improve
```

Workbench 不是通用低代码平台、插件市场或托管 SaaS。当前目标是以尽可能少的框架代码，支持不同 Agent Assembly 使用同一个 Journal 内核运行并留下可复现证据。

## 2. 核心词汇

### 2.1 Plugin Definition：可复用行为元件

Plugin 的最小执行契约保持不变：

```ts
type Plugin = (journal: Journal) => void
```

Plugin Definition 把执行函数与开发时所需信息绑定在同一个声明中：

```ts
interface PluginDefinition<Context> {
  readonly metadata: PluginMetadata
  create(context: Context): Plugin
  inspect?(): PluginInspection
}
```

这是 Phase 1 的内部形状，不是外部插件包协议。`inspect` 只从同一声明投影 Studio 当前确实需要的 Prompt/Tool 信息；配置仍由定义闭包持有，尚未为不存在的通用 JSON 配置边界付费。`definePlugin` 只是类型/声明帮助函数，不增加新的运行时生命周期、依赖注入容器或调度层。

并非所有可复用组件都必须成为直接订阅 Journal 的顶层插件：

- Tool Definition 由 Tools Plugin 管理；
- Provider Adapter 由 LLM Provider Plugin 管理；
- 纯函数和 Schema 可以保持普通模块；
- 只有直接参与 Journal 反应链的能力才需要成为 Journal Plugin。

### 2.2 Component Library：可用元件索引

Component Library 回答：

> 当前 Project 可以使用哪些 Plugin Definition、Tool Definition 和 Provider Adapter？

第一阶段只需要本地索引：

```text
componentId → definition
```

来源可以是：

- Knot 内置组件；
- Project 本地组件；
- 未来导入的可信组件包。

当前明确不做在线 Marketplace、依赖求解、任意不可信代码加载和运行中热插拔。

### 2.3 Assembly：可执行 Agent 模型

Assembly 回答：

> 这个 Agent 由哪些插件实例组成，以什么顺序和配置运行？

Assembly 的核心内容是有序 Plugin Binding：

```ts
interface AssemblyDefinition {
  readonly description: DerivedAssemblyDescription
  create(options: AssemblyBuildOptions): AgentAssemblyFactory
}
```

CASE 内部仍以有序 Plugin Definition 声明为来源；`description` 的 Prompt、Tools、Protocols 和 fingerprint 均由 `defineAssembly` 投影。未来 Studio 真正编辑插件配置时，再引入可序列化 Binding，而不是 Phase 1 先制造一层空壳。

Assembly 不强制要求 System Prompt、LLM、Tools、Chat 输入或 Agent Loop。

- 安装 SystemPromptPlugin 才有系统提示词；
- 安装 ToolsPlugin 才有工具；
- 规则、有限候选选择器或非 LLM Content Provider 也可以独立组成 Assembly；
- Studio 展示的 Prompt、Tools 和 Protocol 必须从插件声明/配置派生，不能在 Assembly 元数据中复制维护。

`defineAssembly` 可以成为真实的薄边界，负责类型推导、最小静态校验、协议投影和 fingerprint 计算，但不能成为新的流程编排器。

### 2.4 Project：一个 Agent 产品的开发容器

Project 回答：

> 哪一个 Agent Assembly，以及验证、发布和运行它所需的资产属于同一个工程？

```text
Project
├── Assembly Draft
├── Generations
├── Cases
├── Local Components
├── Datasets / Fixtures
└── Project Settings
```

当前冻结为：**一个 Project 只拥有一个 Assembly Draft，但可以发布多个 Generation。**

这让 Project、Assembly 和 Session 各自只有一个核心职责：

- Project 管理一个 Agent 产品的开发资产；
- Assembly 描述这个 Agent 如何装配；
- Generation 保存一次发布身份；
- Session 运行某个 Generation。

Subagent 不是“一个 Project 必须包含多个 Assembly”的证据。当前子 Agent 仍运行同一个 Assembly；未来若出现插件拓扑完全不同的专家 Agent，优先把它建模为另一个 Project，并通过已发布 Generation 建立引用。只有真实场景证明多个 Assembly 必须原子编辑或发布时，才重新打开该边界。

Project 自身不处理用户 Query、不运行插件，也不拥有 Session Journal。

必须区分：

- `projectRoot`：Workbench 工程文件的位置；
- `runtimeWorkspace`：某个 Session 中 Agent 实际操作的目录。

两者不能继续统称为 workspace。

### 2.5 Case：可复现验证场景

Case 回答：

> 给某个 Assembly 什么输入、环境和边界，预期产生什么事实与指标？

```ts
interface Case {
  readonly id: string
  readonly generationId?: string
  readonly input: unknown
  readonly runtimeWorkspace?: string
  readonly fixtures?: unknown
  readonly mocks?: unknown
  readonly assertions: readonly Assertion[]
}
```

Case 不是 Agent，不拥有插件装配，也不直接运行插件。一次 Case Run 创建一个 Session，并保存断言和指标。

### 2.6 Assembly Generation：已发布的不可变版本

Studio 中可修改的是 Assembly Draft。Publish 产生不可变 Generation：

```ts
interface AssemblyGeneration {
  readonly id: string
  readonly projectId: string
  readonly fingerprint: string
  readonly snapshot: AssemblySnapshot
  readonly createdAt: string
}
```

目标语义：

- 新 Session 可选择或默认使用 Active Generation；
- 已有 Session 永远绑定创建时的 Generation；
- 修改 Draft 不影响已有 Session；
- 无内容变化时不产生新 Generation；
- 未完成可执行 snapshot 保存与恢复前，不能声称已经实现严格版本复现。

当前不增加 ProjectVersion。Project 源码版本交给 Git；运行身份由 Assembly Generation 表达。如果未来一个产品需要原子发布多个 Assembly，再基于真实需求增加 Project Release。

### 2.7 Session：一次持久运行实例

Session 回答：

> 某个 Assembly Generation 在什么运行环境中发生了哪些事实？

```ts
interface SessionDescriptor {
  readonly projectId: string
  readonly generationId: string
  readonly providerProfileId?: string
  readonly runtimeWorkspace?: string
  readonly journalPath: string
}
```

Session 拥有自己的 Journal。Subagent 是独立 Session，可以记录 `parentSessionId`，但不共享父 Session Journal。

自由对话 Session 不一定来自 Case；执行 Case 得到的 Run 一定关联一个 Session。

## 3. 对象关系

```text
Component Library
       │ resolve
       v
Project ── owns ──> Assembly Draft ── publish ──> Assembly Generation
   │                       │                              │
   │ owns                  │ validated by                 │ instantiated as
   v                       v                              v
 Cases ────────────────> Case Run ────────────────────> Session
                                                           │
                                                           v
                                                        Journal
```

最短记忆：

> Plugin 是行为元件。
> Assembly 是可执行 Agent 模型。
> Case 是验证 Assembly 的场景。
> Project 是保存一个 Assembly 及其开发资产的容器。
> Session 是某个 Assembly Generation 的一次持久运行。

## 4. Catalog 的定位

Catalog 是 Host 内部索引，不是新的产品实体。

当前 AssemblyCatalog 的目标语义是：

> 当前 Host 能够实例化哪些 AssemblyDefinition？

它最终只应注册和查询完整 AssemblyDefinition，不应 import CASE 的 Prompt、Tools 或插件内部实现来重新拼装描述。

```ts
createAssemblyCatalog([
  mobileAssistantAssembly,
  codingAgentAssembly,
])
```

未来可以由 Built-in Projects 和用户 Projects 共同提供 AssemblyDefinition；UI 主要展示 Projects、Cases、Generations 和 Sessions，不需要突出 Catalog 概念。当前 CASE1 与 CASE2 应理解为两个内置 Project，而不是同一个 Project 下的两个 Assembly。

## 5. Workbench 产品区域

```text
Workbench
├── Library
│   ├── Journal Plugins
│   ├── Tool Definitions
│   └── Provider Adapters
├── Projects
│   ├── Assembly Draft
│   ├── Generations
│   ├── Cases
│   ├── Datasets
│   └── Local Components
├── Studio
│   ├── Assembly inspection/editing
│   ├── Case authoring
│   ├── Test runs and comparison
│   └── Declared/observed flow
└── Run
    ├── Sessions
    ├── Runtime interactions
    ├── Journal / Trace
    └── User-facing input/output
```

### Studio

Studio 负责建模和验证，不直接承载日常 Agent 任务。它消费真实 Assembly Definition 和真实 Case Run，不维护平行的 Prompt、Tool 或插件清单。

### Run

Run 负责运行已选择/发布的 Assembly Generation，管理 Session、用户输入、流式展示、审批、Ask 和恢复。Run 不编辑插件编排。

### Library

Library 第一阶段是只读索引和本地开发入口。只有当 Project Assembly 编辑出现真实需求后，才增加安装、配置和导入能力。

## 6. Studio Flow 的目标形状

Studio 后续使用同一图表组件展示两种不同证据，不能混淆：

### Declared Topology

从 Plugin Metadata 的 `listens/emits` 派生可能路径。多个 emits 可以交互选择或展开全部分支。它不执行插件，也不写 Journal，必须明确标记为“可能路径”。

### Observed Sequence

从一次 Mock/Real Case Run 的真实 Journal 和运行观测生成，表示本次执行实际发生的路径。

不增加“假仿真插件”去驱动真实 Journal，因为它会成为插件声明和真实运行之外的第三套事实来源。

## 7. 代码预算

框架代码不包含测试、文档、CASE 示例、业务插件、Tool 实现和 Provider Adapter。

| 区域 | 目标额度 |
|---|---:|
| Journal 与基础 Protocol | ≤ 1k |
| Plugin / Assembly 定义与运行 | ≤ 1.5k |
| Project / Case / Generation 存储 | ≤ 1.5k |
| Session Host / Runtime | ≤ 2.5k |
| Web Run | ≤ 2k |
| Web Studio | ≤ 2.5k |
| 公共 UI 和工具 | ≤ 1k |
| 目标总量 | 10–12k |
| 硬警戒线 | 15k |

当前非 CASE 生产代码约 4.36k 行，仍有足够空间。额度是架构约束而非压缩格式指标，不能通过合并行、删除必要错误处理或减少测试来达成。

每阶段评审同时检查：

- 是否新增第二事实来源；
- 是否增加跨层依赖；
- 是否把业务判断移入 Host 或内核；
- 是否增加必选组件；
- 是否可以删除旧的转发层；
- 是否引入未被 Case 验证的边界；
- 新增外部依赖是否有明确所有者和长期价值。

## 8. 当前实现与目标差距

| 项目 | 当前状态 | 目标 |
|---|---|---|
| CASE1 / CASE2 | 各自导出完整 AssemblyDefinition | Phase 2 将二者建模为两个内置 Project |
| Plugin 元数据 | metadata/create 同一声明；Prompt/Tool inspection 同源 | 继续用真实 Case 验证字段后再冻结外部协议 |
| Assembly Description | Prompt、Tools、Protocols 已由插件声明派生且可为空 | Studio 编辑出现后再决定可序列化 Binding |
| Assembly Catalog | 只注册完整 AssemblyDefinition | 后续由 Project Store 提供用户 Project 定义 |
| Project | Host 持久化；CASE1/CASE2 是两个内置 Project；支持基于现有 Assembly 新建 Project | Assembly 可编辑能力仍未开放，projectRoot/runtimeWorkspace 已分离 |
| Case | 可创建并运行基本场景 | 明确绑定 Assembly/Generation、输入、Fixture 和断言 |
| Generation | 保存 fingerprint 和声明 snapshot；相同 fingerprint 不重复发布 | 可执行制品导出仍延后，`restorable` 明确表达当前代码能否解析 |
| Session | 已持久化并支持恢复；新 Session 记录 projectId，旧描述符由 assembly 推导 | 可执行制品完成后再提供严格历史代码恢复 |
| Studio | Project/Case/Generation 持久化；Mock/Real Run；声明拓扑与观测序列 | Assembly 编辑与外部组件导入延后 |

## 9. 分阶段实施规划

### Phase 0：共同评审并冻结产品词汇

目标：确认本文第 2～4 节，不改运行代码。

完成条件：

- Project、Assembly、Case、Generation、Session 没有语义重叠；
- 确认一个 Project 只拥有一个 Assembly Draft 和多个 Generation；
- 确认 projectRoot 与 runtimeWorkspace 分离；
- 确认 Catalog 只是 Host 内部索引；
- 确认 System Prompt 和 Tools 不是 Assembly 必填字段。

### Phase 1：Assembly 单一来源

目标：消除 Catalog、描述和可执行 Factory 之间的重复事实。

状态：已完成内部最小实现。

工作：

1. 引入最小内部 PluginDefinition 类型，暂不冻结外部包协议；
2. 引入薄 `defineAssembly`；
3. CASE1/CASE2 分别导出完整 AssemblyDefinition；
4. Catalog 只注册这些定义；
5. Prompt、Tools、Protocols 从插件定义/配置投影；
6. 删除 Catalog 内重复的描述构造；保留仍被 Host/测试直接使用的 Factory；
7. 增加单一来源和零 Prompt/零 Tools Assembly 测试。

非目标：动态插件安装、JSON Assembly 编辑、运行中热插拔、外部包版本管理。

### Phase 2：Project / Case / Generation 持久模型

目标：让 Studio 操作真实 Project，而不是浏览器 fixture。

状态：已完成最小持久模型。旧 Assembly-keyed Store 启动时备份为 `studio.json.v1.backup`，再迁移到 schema v2；Case、Generation、Run 和 Session ID 均保持不变。一个 Project 绑定一个 Assembly Definition，并可拥有多个 Generation、Case 和 Session。

工作：

1. 定义最小 Project Store；
2. 一个 Project 支持一个 Assembly Draft、多个 Generation 和多个 Case；
3. 区分 projectRoot 与 runtimeWorkspace；
4. Case 默认验证本 Project 的 Assembly Draft，也可固定到 Generation；
5. Publish 无变化时不生成新版本；
6. Generation 保存声明 snapshot，并通过 `restorable` 明确当前可执行定义是否匹配；完整可执行制品导出仍是后续边界；
7. 新 Session 使用 Active Generation，旧 Session 保持原绑定。

### Phase 3：Studio Flow 纵向闭环

目标：用真实声明和运行证据解释插件关系。

状态：已完成最小纵向闭环。

工作：

1. Declared Topology 从 Plugin metadata 的 listens/emits 投影，不执行 Assembly；
2. Observed Sequence 按需读取所选 Run 的真实 Journal，不复制进 Studio Store；
3. 观测事件用声明元数据标注可能的生产方和订阅方，不伪称记录了 handler 内部调用；
4. 当前以高密度协议/事件列表表达分支和循环，交互式图布局待真实使用后再决定；
5. 未修改 Journal 内核，也未新增仿真插件。

### Phase 4：Run 多模态最小验证

目标：用图片输入验证协议和 Provider 边界，不先建设完整附件平台。

工作：

1. `user.message` 增加可选 `attachments`；
2. 第一阶段只支持图片 URL/data URL；
3. ContextAssembler 投影为 Provider-neutral image part；
4. DeepSeek Flash Adapter 映射并完成真实验证；
5. Mock Provider 和恢复测试覆盖多轮历史；
6. 第二阶段再增加 Host 文件上传和 `attachment://id`，避免 base64 进入 Journal。

### Phase 5：CASE1 行为复刻与连续测试集

目标：复刻 Android Agent 的行为契约，而不是复制其工程结构。

工作：

1. 梳理真实 Mock 工具列表和输入输出；
2. 覆盖 Shortcut、动态 Context、CLI 工具目录、候选状态、Hint 和失败恢复；
3. 建立连续多轮 Case/Dataset；
4. 同一 Case 对比 Mock 与真实 Provider；
5. 记录路径、工具选择、参数、Token、缓存、时延和最终结果；
6. 只在真实边界出现后扩展公共协议。

### Phase 6：可编辑 Assembly 与 Project 本地组件

启动条件：Phase 1～5 已证明 Plugin Definition 和 Assembly 配置形状稳定。

可能工作：

- Studio 编辑插件顺序和声明配置；
- Project 本地组件注册；
- 保存 JSON/TS Assembly source；
- 下一 Session/Run 重新实例化；
- 组件导入与分享。

非目标仍包括活动 Session 中任意热插拔和不可信远程代码执行。

## 10. 下一步确认项

进入 Phase 2 前需要共同确认：

1. 一个 Project 只拥有一个 Assembly Draft 和多个 Generation；
2. Case 默认验证所属 Project 的 Assembly Draft，真实 Run 最终解析到一个 Generation；
3. System Prompt、Tools、LLM 都通过插件出现，不是 Assembly 顶层必填字段；
4. Plugin Definition 可以携带可检查静态配置，Studio 从同一声明投影；
5. 先保持代码定义 Assembly，不立即建设 JSON 编辑和动态包加载；
6. 框架目标 10–12k、硬警戒线 15k，业务插件和 Provider Adapter 单独计算；
7. Phase 1 已完成并通过全量测试；Phase 2 仍需单独评审后启动。
