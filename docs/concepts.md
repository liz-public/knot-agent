# Knot 核心概念

本文定义当前实现使用的概念模型（代码基线 `91f2200`，2026-10-04）。它不是公共数据格式，
也不会因为某个名词存在就要求内核新增实体。历史产品规划不代表当前功能。

## 1. 一条主线

```text
Journal → Projection → Reaction → Effect → Journal
```

### Journal

一个 Session 内权威的追加式业务事实序列。事件只有 `type` 和 `data`；内核不解释事件含义。

Journal 记录已经发生的事实，例如用户输入、模型生成、工具结果和压缩检查点，也记录影响
Session 的已生效控制配置：`inference.configured` 和 `approval.policy.configured`。
并非每条事实都必须进入模型上下文，零订阅者也合法。Journal 不保存可重算的完整模型
messages，不承担 UI 的逐 Token 流式状态；观测时间放在 JSONL envelope 元数据中。

### Projection

从 Journal 派生某个消费者需要的只读视图，例如：

- 发给模型的 messages；
- UI 对话记录；
- 当前 Todo 或 Goal；
- Trace、时延和 Token 统计。

Projection 不是第二个真相来源。相同的 Journal 和 Manifest 应当能够重建相同输入。

### Reaction

插件对某类事件的响应。它读取 Journal、执行自己的判断，然后追加新事件或保持沉默。

### Effect

与 Journal 外部交互的行为，包括模型请求、文件修改、Shell 命令、设备操作、用户审批和远程 API。Effect 完成后把对业务有意义的结果作为事实写回 Journal。

瞬时展示不一定是事实。模型 Token delta、命令实时 stdout 和审批弹窗队列可以通过外围端口传递，完成后的语义结果再进入 Journal。

## 2. 内核与循环

内核只提供：

```ts
append(type, data)
read()
subscribe(type, handler)
runUntilIdle()
```

Knot 不是“完全没有循环”，而是没有拥有所有业务知识的中央 AgentLoop。一次工具循环由事件关系形成：

```text
llm.generated → tool.call → tool.result → llm.request → llm.generated
```

当没有插件追加新事件时，`runUntilIdle` 返回。暂停和恢复由运行边界上方控制，不要求 Journal 理解用户界面状态。

## 3. Plugin、Protocol 与 Assembly

### Plugin

当前执行契约是：

```ts
type Plugin = (journal: Journal) => void
```

插件安装时注册订阅；运行时只通过 Journal 与其他行为协作。插件可以导入共享协议和纯函数，但不应导入另一个业务插件的实现并直接调用它。

### Protocol

Protocol 是插件之间对事件类型和 payload 语义的约定。它不属于 Journal 内核，也不是远程网络协议的同义词。

协议表达关系，但不会自动保证系统完整。例如 `llm.request` 存在并不意味着一定安装了 LLM Provider。Assembly 和端到端 Case 负责验证组合是否有效。

### Assembly

一个智能体的可执行定义，核心是有序的插件实例和配置。Assembly 不强制要求 System Prompt、LLM、Tools、Chat 输入或 Agent Loop：这些能力只有在对应插件被装配时才存在。

Assembly 包括：

- 插件及其注册顺序；
- 每个插件的声明配置；
- 与 Host/UI 的外围端口接线。

Prompt、工具 Schema 和 Protocol 必须从被装配插件的同一声明/配置派生，不能在 Assembly 元数据中复制维护。注册顺序具有语义，因此必须只有一个来源。CASE1/CASE2 已分别导出完整 AssemblyDefinition；Catalog 只负责注册，Studio 描述从对应定义投影。

内部已有薄 `defineAssembly` / `definePlugin`。前者派生描述并检查重复身份，后者保留定义
的类型绑定；都没有新增运行时层。它们仍是内部接口，不是已经冻结的插件包协议。

### Generation

Generation 是此前探索的不可变版本概念。由于声明指纹不能封存和恢复可执行源码，当前
已删除 Generation、Publish 与独立 Validation。它不属于现有 Session 运行契约。
需要源码版本时仍使用 Git；如未来重新引入运行制品版本，先讨论真实场景和恢复条件。

## 4. Project、Case、Session 与 Run

```text
Project
├── Assembly identity → 当前代码定义
├── Cases
│   └── Runs
└── Sessions
    └── Journals
```

### Project

长期维护一个 Agent 的工程边界。当前 Project 保存标题、工程根目录和一个已注册 Assembly
的身份，关联 Cases 和 Runs；不等于前端可编辑的 Assembly 工程。`projectRoot` 是工程位置，
Session 的 workspace 是其操作目录，两者不能混为一谈。当前 Subagent 使用同一个 Assembly。
本地组件库、工程文件编辑和多 Assembly Project 尚未形成产品契约。

### Case

可复现的测试或实验场景，描述输入、环境假设、Fixture、断言和测量方式。Case 不是智能体；它验证某个 Assembly。

### Session

Assembly 的一次持久运行实例。一个 Session 拥有一个 Journal，descriptor 记录身份、标题、
Assembly、工作目录、Journal 路径与父子关系，不记录模型或审批配置。Assembly 身份不是
历史代码快照。Subagent 是独立持久 Session，拥有自己的 Journal 和上下文。

页面配置先成为 pending；下一次 submit 才提交变化的配置事实。恢复时从 Journal 读取已
生效配置；缺失时采用 Host 默认值，不在加载或创建时补写，也不回退到旧 descriptor 配置。

### Run

执行某个 Case 所产生的一次 Session、Journal、断言结果和指标。用户自由对话创建的 Session 不一定来自 Case。

输入重建不等于执行重放：历史 `llm.invoke` 可以按封闭 manifest 重建当时的规范输入，
但不能据此声称恢复了旧 Provider、旧源码或外部设备/文件系统状态。

## 5. 三层边界

```text
Web / Host 产品层
        ↓ ports and DTOs
插件运行与 Journal 层
        ↓ protocols
业务插件层
```

### Web / Host 产品层

负责 Project/Session 管理、HTTP/SSE、待提交配置、流式展示、审批和 Ask 端口、只读检视。
DSH Web / Client Cordis 只处于这一层，不执行 Knot Journal 插件。早期 Web 保留 Studio
Case/Run；DSH 壳没有 Studio 编辑入口。导出运行制品仍是未实现的方向。

### 插件运行与 Journal 层

负责最小 Journal 契约、插件安装和事件投递语义，不认识 Coding Agent 或终端助手。

### 业务插件层

负责 Prompt、上下文、内容选择、工具、Guard、压缩和领域行为。CASE1 与 CASE2 的差异应主要停留在这一层。

## 6. 当前稳定度

| 概念 | 当前状态 |
|---|---|
| Journal 内核语义 | 已由 CASE1/CASE2 稳定验证 |
| `Plugin = (journal) => void` | 当前最小执行契约 |
| 事件 Protocol | 按 Case 演进，尚无全局版本标准 |
| Assembly 单一来源 | 已完成内部最小实现；外部格式未冻结 |
| Plugin metadata | 设计方向已明确，字段未冻结 |
| Case/Eval 格式 | Studio 已有最小持久化 Run 闭环，格式未冻结 |
| Project | 一个 Project 关联一个已注册 Assembly 的持久模型；不支持页面编辑装配 |
| Generation / 运行制品 | 原 Generation 功能已删除；可执行制品未实现 |
| CASE3 多 Journal 关系 | 待真实 Case 验证 |

冻结顺序遵循同一原则：先让真实 Case 暴露边界，再把已经反复出现且稳定的形状命名为公共契约。

当前 Workbench 能力和原生壳偏差见 [DSH 接线说明](../web-dsh-reference/README.md)。
