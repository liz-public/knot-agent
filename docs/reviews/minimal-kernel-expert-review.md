# Knot Agent 最小 Journal-first 内核：专家评审材料

> 日期：2026-09-04
> 状态：问题陈述，不是设计规范，不代表方案已经冻结
> 目标读者：熟悉事件系统、Agent Harness、插件运行时、Event Sourcing 的架构评审者
> 评审目标：判断最小内核究竟需要什么，以及现有实现是否偏离第一性原理

## 1. 为什么需要这份材料

Knot Agent 想验证一个非常小的命题：

> 一个 Agent 是否可以仅由一个 append-only Journal、事件类型订阅和插件追加新事件构成；所谓 Loop 不是内核对象，而是事件之间自然形成的环。

讨论过程中先后出现了两个问题：

1. Python 原型和第一版 TypeScript 实现虽然都能运行，但两者合计引入了 Runtime、pending delivery/cursor、PluginContext、Trace callback、ContextView、Driver 等概念，开始偏离“先验证最小核心”的目标。
2. DSH 已经具备 append-only typed Session Journal、Context 投影、工具和模型 Registry，但其第一性运行时是 Cordis；若在 DSH 内实现 Journal Reactor，会形成 Cordis 插件系统内部的第二套插件系统，而不是让 DSH 原有插件天然变成 Journal subscriber。

因此当前不应继续实现功能，而应先请评审者回答：**最小、可运行、可演进的 Journal-first Kernel 到底是什么。**

本文件分为两部分：

- 正文：项目背景、已经确认的目标、候选最小模型和仍有争议的问题；
- 附录：从用户首次提出“事件队列架构”开始的全部用户 Query，按时间保留原始表述。

## 2. 项目背景

### 2.1 最初关注的问题

项目不是为了再做一个功能繁多的 Coding Agent，而是研究：

- 如何提高 LLM Context 的信息密度；
- 如何减少错误路径、无效工具调用和无效 token；
- 如何让 Agent 的认知—行动—交互路径可以 Trace、Eval、回放和纠错；
- 如何让插件职责足够原子、解耦，使人和 Coding Agent 都只需理解较小的代码范围；
- 如何让单轮分类、Chat、工具循环、Goal/Plan/Review 等行为由插件组合得到，而不是硬编码进一个中心 AgentLoop。

### 2.2 相关代码与材料

| 对象 | 路径 | 作用 |
|---|---|---|
| 当前 Knot TypeScript 仓库 | `/Users/lizhe/workspace/knot-agent` | 第一版 426 行生产代码；能运行，但正接受本次根本性评审 |
| Knot GitHub | `https://github.com/liz-public/knot-agent` | 当前独立仓库 |
| Python 原型 | `/Users/lizhe/workspace/journal-agent-kernel` | 更早的可运行机制实验 |
| Python 简要架构 | `/Users/lizhe/workspace/journal-agent-kernel/ARCHITECTURE.md` | 原型阶段结论 |
| 先前大设计文档 | `/Users/lizhe/workspace/journal-agent-kernel/docs/spec/` | 已被认为过度设计，只作为探索记录 |
| DSH 核查报告 | `/Users/lizhe/workspace/journal-agent-kernel/docs/research/dsh-architecture-comparison.md` | DSH 与 Journal-first 方案的源码级比较 |
| DSH 本地仓库 | `/Users/lizhe/workspace/deepseek-harness` | 完整插件化 Agent Harness 对照组 |
| Pi 本地仓库 | `/Users/lizhe/workspace/pi` | Coding Agent/AgentHarness 对照组 |
| Android Agent 设计基线 | `/Users/lizhe/AndroidStudioProjects/lz-refactor/.claude/worktrees/release-prep-20260717/docs/agent-decoupling/reference-points-frozen.md` | 既有 Android Agent 解耦经验 |

### 2.3 当前 TypeScript 实现

提交 `011d903` 包含：

- `src/core.ts`：Event、Journal、Plugin、PluginContext、Runtime、特殊 Trace callback；
- `src/protocol.ts`：`user.message/tool.call/tool.result/assistant.message`；
- `src/plugins/llm.ts`：Mock 与 OpenAI-compatible LLM；
- `src/plugins/tool.ts`：Tool registry/router/executor 的最小合并实现；
- `src/plugins/output.ts`：CLI 输出；
- `src/main.ts`：装配入口。

它能够运行：

```text
user.message
  -> llm.mock
  -> tool.call
  -> tool
  -> tool.result
  -> llm.mock
  -> assistant.message
  -> output
  -> idle
```

但“可以运行”不等于“验证了正确的最小抽象”。当前用户明确认为其味道不对、难以演进。

## 3. 必须回到的第一性原理

### 3.1 唯一第一等实体

候选命题是：

```text
Journal = 按追加顺序排列的 Event[]
Event   = type + content
```

Journal 数组位置已经定义顺序。`seq` 是否值得作为冗余但稳定的 Entry 字段保留，是待评审细节；`timestamp/source/correlation/target` 均不进入第一版内核。

Journal 是各方共同进行“结绳记事”的地方。用户、规则、LLM、工具、Trace、Hook、Goal、Loop 都不具有内核特权；它们只是：

1. 订阅某类 Event；
2. 收到 Event 后执行自己的业务；
3. 选择追加或不追加新的 Event。

### 3.2 Loop 不是实体

```text
user.message -> LLM -> tool.call -> Tool -> tool.result -> LLM
```

如果这些订阅和追加关系形成环，Agent 就持续运行；如果没有新事件，运行自然停下。单轮分类器不会形成环，也不需要 Loop。

### 3.3 Trace 没有特权

Trace 必须和其他插件使用完全相同的订阅与处理接口：

```text
TracePlugin subscribes *
  -> 收到普通 Event
  -> 在插件内部记录或打印
```

内核不得提供 `observer`、`TraceSink`、`onDelivery`、特殊 callback 或 Trace 专属数据面。第一版 Trace 默认不向 Journal 回写，避免 `*` 订阅自己的 trace event；将来若要回写，它也只能像任何普通插件一样通过事件类型自行避免自触发。若普通插件无法实现某种更强 Trace，应该先明确那是不是当前目标，而不是为 Trace 开后门。

### 3.4 插件不直接依赖其他插件

插件可以依赖：

- Journal 的公开接口；
- 它订阅和生产的事件协议；
- 自己完成业务所需的普通库或外部 API。

插件不应获取其他插件的对象、类、私有状态或专属调用接口。LLM、Tool、System Prompt、Trace、测试断言都应遵循同一注册方式。

### 3.5 第一版只验证不能再删的机制

第一版不应提前设计：

- 持久化和 Store Driver；
- 多 Session；
- Priority/Capability/Endpoint；
- RuntimePlan；
- Context checkpoint/compaction；
- 动态插件包协议；
- 并发、背压、流式输出；
- 权限、沙箱、远端插件；
- 特殊 Trace/Eval 通道。

只有扩展真实插件时出现无法绕开的瓶颈，才扩展内核。

### 3.6 本轮作者的删减判断

在专家给出意见前，当前判断先明确如下，避免把所有问题都悬空：

- **不要双通道**：公开模型只有一个 Journal；Event 被 append 后即可被订阅者处理。
- **不要 `PluginContext`**：插件安装时得到同一个 Journal；handler 得到当前 Event，通过闭包读写 Journal。
- **不要 `cloneData/deepFreeze`**：第一版以接口约定和 `readonly` 表达事件不可修改，不在运行时强制深快照。将来若出现不可信插件或持久化边界，再选择有明确数据语义的快照方案。
- **不要 Prompt 特权注入**：System Prompt 由普通插件写入 Journal，LLM 插件只负责读取所需事件、投影请求并生成新事件。
- **不要 Trace 特权**：Trace 只做普通的 `*` 订阅；第一版 Trace 的定义就是可还原 Journal 事件链，不要求它观察 handler 内部生命周期。
- **保留一个确定性投递机制**：注册顺序串行、Journal 顺序 FIFO、handler 新增事件排在已有待处理事件之后、异常停止。本项是事件能够驱动业务所不可删除的机制，不是 Agent 业务 Loop。
- **零订阅者默认合法**：内核不理解业务事件类型，因此不能判断某事件是否必须被处理。`need.content` 无 Provider 等错误由定义该协议的插件抛出或追加业务错误事件。
- **异常直接中止本次 drain**：handler throw/reject 原样向调用者传播；第一版不自动追加 `runtime.error`，不兜底，不承诺恢复或重试。

### 3.7 内核只固定结构协议，不固定业务协议

第一版内核只理解：

```text
Event = type + content
Subscription = type selector + handler
```

`user.message`、`system.prompt`、`need.content`、`tool.call`、`tool.result`、`assistant.message` 都由插件约定；内核没有 base Agent protocol。`*` 只是订阅匹配符，不是特殊事件类型。第一版也不需要 Plugin Manager、Capability Registry 或 Endpoint Registry：所谓安装插件，只是装配代码调用一次 `plugin(journal)`，由插件注册自己的 handler。

## 4. 当前实现为什么偏离

### 4.1 Trace 被内核特殊处理

`core.ts` 接受 Trace callback，生成 append、handler started/completed、duration、idle/stopped 文本。这直接违反“Trace 与普通插件相同”。见 [core.ts](/Users/lizhe/workspace/knot-agent/src/core.ts:18)。

### 4.2 cursor 的问题不是“存在一个整数”，而是语义没有先讲清楚

当前循环：

```ts
while (cursor < journal.length) {
  const event = journal.at(cursor)
  await dispatch(event)
  cursor += 1
}
```

用户质疑：如果本质是事件队列，为什么不直接消费队列；如果本质是 Journal，为什么它需要一个外部 cursor 才能运行。

从第一性原理看，一个既保留全部历史、又只投递一次的 append-only 队列必须知道“下一个未投递位置”。它只能用以下某种状态表达：

- Journal 数组中的 head/index；
- 另一个 pending queue；
- 每条 Event 的 processed 标记；
- 或完全不排队，改成同步递归 dispatch。

因此 `cursor` 不是天然错误。当前实现真正的问题是：它由额外的 Runtime 持有，且 append、投递、停止、零订阅者和错误的语义没有先被定义，导致一个实现细节看起来像隐含的 AgentLoop。若采用单 Journal 方案，最小做法可能恰恰是把一个私有 `nextDeliveryIndex` 放回 Journal 内部；它只是非破坏队列的 head，不是公开概念，也不是 Session checkpoint。

### 4.3 每次 handler 创建 PluginContext

当前每次调用插件都创建新的 `{append, read}` 对象，但第一版不存在 invocation-scoped 权限、取消、因果或事务。这是没有真实需求证明的抽象。见 [core.ts](/Users/lizhe/workspace/knot-agent/src/core.ts:101)。

### 4.4 `cloneData/deepFreeze` 提前解决了另一个问题

这两个函数防止调用方通过对象引用修改历史 payload。但需要区分：

```text
append-only sequence：不能删除或替换 Journal Entry
deep immutable payload：Entry 内的任意对象也不能被修改
```

不可修改是 Journal 的语义目标，但“必须由内核在第一版运行时深复制并递归冻结”并不能由此推出。当前 `JSON.stringify/parse` 还会改变 `undefined`、`NaN`、`Date` 等值的语义，并承担深复制、深冻结和重复读取开销。本轮建议删除这两个函数：先把不修改 Event 作为插件契约；等不可信插件、跨进程或持久化形成真实边界时，再定义允许的数据域和快照方式。

### 4.5 System Prompt 被注入 LLM 构造函数

当前 LLM 插件构造时接收 `system` 字符串，意味着 System Prompt 不是独立插件，也没有和其他内容生产者一样通过 Journal 协作。见 [llm.ts](/Users/lizhe/workspace/knot-agent/src/plugins/llm.ts:74) 与 [main.ts](/Users/lizhe/workspace/knot-agent/src/main.ts:19)。

### 4.6 测试仍然知道 Runtime 内部

虽然使用了 Mock LLM，但端到端测试自己构造 Runtime、运行、读取 Journal 并断言。用户期望的是：生产配置安装真实插件，测试配置替换为 Mock LLM 和 Assertion Plugin；测试结论也通过普通订阅关系获得，而不是特殊访问 Runtime 内部。

## 5. “双通道”为什么需要重新审查

讨论中一度提出：

```text
Journal channel：被动事实 append/read
Signal channel：主动 on/emit/dispatch
```

逻辑上可以区分“事实”与“触发”，但用户当前质疑：实现上若真的提供两套 API、两套数据结构、两种协议，会重新形成两个系统，并偏离“Journal 上的 Event 本身即可订阅”的起点。

需要区分三个候选，而不是把“双通道”当成既定结论。

### 候选 A：单一 Journal，append 自动成为待分发事件

```text
append(event)
  -> 保存到 Journal
  -> Journal 内部 drain 尚未投递的 Entry
  -> dispatch subscribers
```

公开模型只有 Journal。为了避免递归调用并确定 FIFO，Journal 内部需要一个非破坏性的 head/index，或保存相同 Event 引用的 pending queue；两者都是实现细节，不是第二个可编程通道。本轮更倾向只保留 Journal 数组和一个私有 head，避免复制第二份队列结构。

### 候选 B：Journal 与 Signal 是两套公开 API

```text
journal.append(fact)
signals.emit(message)
```

它允许 log-only fact 和 signal-only control，但插件必须决定何时写一份、何时写两份，以及两者如何关联。当前没有真实案例证明这项复杂度必要。

### 候选 C：同步 append 时立即递归调用订阅者

```text
append(event)
  -> handler A
     -> append(child)
        -> child handlers immediately
  -> handler B
```

它不需要 queue/cursor，但天然形成深度优先递归，可能让 handler B 晚于 child event，且异步 handler、长链和栈深度难以控制。

**当前最贴近用户原始需求的是候选 A。候选 B 应从第一版删除。** 候选 A 内部采用 head 还是 pending reference queue，仍可由评审者判断。

## 6. 候选最小 API（供批评，不是结论）

```ts
type Event = {
  readonly type: string
  readonly content: unknown
}

type Handler = (event: Event) => void | Promise<void>

interface Journal {
  append(type: string, content: unknown): Event
  read(): readonly Event[]
  subscribe(type: string, handler: Handler): void
}

type Plugin = (journal: Journal) => void

declare function createJournal(): {
  journal: Journal
  runUntilIdle(): Promise<void>
}
```

插件只拿到稳定、共享的 Journal handle：`append/read/subscribe`。`runUntilIdle` 是装配层持有的驱动函数，不放进每次 handler 的 Context，也不交给业务插件。这里没有 Runtime 类的必要性；`createJournal` 返回的驱动函数可以只是同一闭包里的十几行实现。

插件安装时获得同一个 Journal，不创建 invocation-scoped Context：

```ts
const toolPlugin: Plugin = journal =>
  journal.subscribe('tool.call', async event => {
    const result = await execute(event.content)
    journal.append('tool.result', result)
  })
```

Trace 不特殊：

```ts
const tracePlugin: Plugin = journal =>
  journal.subscribe('*', event => {
    console.error(event.type, event.content)
  })
```

System Prompt 不特殊：

```ts
const systemPromptPlugin = (content: string): Plugin => journal => {
  journal.subscribe('session.start', () => {
    journal.append('system.prompt', { content })
  })
}
```

动态注册在概念上已经成立：

```ts
const module = await import(path)
module.default(journal)
```

第一版仍由 `main.ts` 静态 import，并要求在 seed Event 前完成装配。虽然运行中再次调用 `plugin(journal)` 在语法上可行，但它对当前 Event 是否生效等语义暂不承诺；卸载、安全点和版本切换均不是第一版需求，因此 `subscribe()` 暂不返回 disposer。

## 7. 候选最小内部循环

如果采用候选 A，并且不复制一个 pending queue，内部可能只是：

```ts
append(type, content) {
  const event = { type, content }
  events.push(event)
  return event
}

async runUntilIdle() {
  while (nextDeliveryIndex < events.length) {
    const event = events[nextDeliveryIndex++]
    for (const handler of matchingHandlers(event.type)) {
      await handler(event)
    }
  }
}
```

`nextDeliveryIndex` 是保留历史的 FIFO head。它不对插件公开，不是 checkpoint，也不意味着每个插件各有一份消费状态。handler 追加的 Event 进入 Journal 尾部，因此默认是广度优先和注册顺序串行。

若连这个 index 也删除，只剩两种实质选择：用另一份 pending queue 表达同一状态，或 append 时同步递归并改成深度优先。请评审者判断这段循环是否已经是最小正确形状，以及它应属于 Journal 内部还是一个无业务知识的 Reactor；不应仅因变量名为 cursor 就判定其错误。

## 8. 仍需专家回答的问题

### R0：Event envelope 能否只剩 `type + content`？

Journal 数组位置已经提供顺序。第一版是否还必须把 `seq` 固化为 Event 字段？若保留，它解决的是当前哪一个无法由数组位置解决的场景？`timestamp/source/correlation/target` 暂不考虑。

### R1：Journal Entry 与待处理 Event 是否应该是同一个对象？

如果相同，单一模型最纯粹；如果不同，必须说明 Signal 比 Journal Entry 多了什么不可消除的语义。

### R2：是否需要 cursor？

若 Journal 同时保留历史并作为单一 FIFO，单个私有 head/index 是否就是最少状态？若改用 pending queue，获得了什么额外语义？这个 head 应属于 Journal，还是属于一个无业务知识、不可替换的 Reactor？

### R3：append-only 是否要求 payload 深度不可变？

需要在以下方案间选择：

- 第一版信任插件，不 clone/freeze；
- 只冻结 Event envelope；
- append 时 snapshot；
- read 时复制；
- 等持久 Store 自然序列化。

请区分语义完整性与当前实验必要性。

### R4：零订阅者是什么语义？

如果 `system.prompt`、审计记录、最终消息没有订阅者，是否应自然存在于 Journal；如果 `need.content` 没有 Provider，是否应报错？

当前建议是零订阅者对内核一律合法；由生产插件或协议插件判断业务上的 required consumer。请评审者确认这是否足够。Trace 的 `*` 订阅不得被特殊对待，因此不能靠“排除 Trace observer”解决。

### R5：同一 Event 的多个订阅者采用什么最小顺序？

当前倾向注册顺序串行。handler 追加的新 Event 放到 Journal 尾部，等当前 Event 的全部订阅者完成后处理。是否有更小且更自然的语义？

### R6：插件究竟需要收到什么？

候选是安装时只得到仅含 `append/read/subscribe` 的共享 Journal；handler 只得到 Event，并通过闭包使用 Journal。`runUntilIdle` 只由装配层持有。请判断是否已经足够，还是存在第一版就无法表达的必要能力。

### R7：Trace 如何在完全普通插件的条件下完成？

本轮把 Trace 契约限定为“完整看到并还原 Journal Event 顺序”。它看不到“某 handler 开始/结束/失败且没有输出”，这是普通 Event 订阅天然存在的边界，第一版接受该边界。请评审者判断这一契约是否足够支撑当前 Eval；无论答案如何，都不得增加 Trace 专属 callback。若未来确需 handler lifecycle，它也只能成为所有插件都能订阅的普通 Journal Event，并由真实需求推动加入。

### R8：System Prompt/Context 最小表达是什么？

候选是所有插件先完成订阅，随后由装配层追加 `session.start`；SystemPromptPlugin 订阅它并追加 `system.prompt`，LLM Plugin 每次从 Journal 投影。是否还能更小？是否需要更早引入 ContextAssembler，还是等出现第二类 Prompt/动态环境插件后再提炼？

### R9：端到端测试怎样证明“测试只是另一套插件装配”？

建议生产使用 RealLlmPlugin + CliOutputPlugin；测试替换为 MockLlmPlugin + AssertionPlugin。测试不读取 Runtime 私有状态，AssertionPlugin 通过普通订阅检查结果。核心单元测试可以直接验证 Journal 顺序。

## 9. 第一版建议验证的唯一业务链

```text
assembly installs every plugin first

main
  -> append session.start

SystemPromptPlugin subscribes session.start
  -> append system.prompt

drain reaches idle

main/user plugin
  -> append user.message

LlmPlugin subscribes user.message + tool.result
  -> append tool.call or assistant.message

ToolPlugin subscribes tool.call
  -> append tool.result

OutputPlugin subscribes assistant.message
  -> print and append nothing

TracePlugin subscribes *
  -> print and append nothing
```

装配期只注册订阅，不产生业务 Event；所有插件安装完成后才追加第一个 seed Event。这样普通 Trace 不会因为安装顺序漏掉 Prompt，也不需要 replay 特权。`session.start` 只是这一套插件装配约定的业务类型，内核并不知道它。第一版在启动用户请求前先把 `session.start` drain 到 idle，确保 Prompt 已经进入 Journal。

成功标准：

1. Core 不认识任何上述业务 Event type；
2. Core 没有 Trace、LLM、Tool、Prompt、Output 分支；
3. Trace 使用和 Tool 完全相同的 subscribe API；
4. 替换 Mock/Real LLM 不修改 Core；
5. 增加第二个普通插件不修改 Core；
6. 没有业务 AgentLoop；
7. 生产代码先控制在 300–500 行，Core 尽量控制在 50–100 行；
8. 暂不处理 stream、持久化和动态包加载。
9. 任一 handler 抛错时 `runUntilIdle()` 直接 reject，后续 Event 不再投递。

## 10. 如何演进，而不是提前设计

每次只用一个无法通过普通插件解决的真实案例推动 Core 变化：

| 真实压力 | 先尝试插件方案 | 只有何时才改 Core |
|---|---|---|
| 流式 LLM/token | 先看是否追加普通 delta Event 可接受 | Event 数量/内存/调度确有测量瓶颈时 |
| 超长 Session | 插件总结、读取窗口 | 普通 Journal API 无法避免全量内存时 |
| 动态 Prompt | Prompt 插件追加事件 | 多插件组合无法靠事件协议稳定表达时 |
| 动态注册 | 运行时 import 后调用 `plugin(journal)` | 真正需要卸载、安全点或版本切换时才扩展订阅句柄 |
| 多订阅竞争 | 注册顺序串行 | 真实插件需要 winner/barrier/并行 commit 时 |
| Trace handler 时延 | 第一版不采集，只记录 Event 链 | 先证明 Event-only Trace 无法完成目标；即使扩展也必须对所有插件同权 |
| 恢复未处理事件 | 重启重新运行实验 | 副作用重复后才设计持久 delivery frontier/checkpoint |

核心纪律：**不能因为预见到未来问题，就在问题出现前把解决方案写入内核。**

## 11. 与 DSH 的准确关系

以下结论基于本地 DSH 提交 `47f943859b` 的源码核查，而不只来自 README：

DSH 已经具备：

- append-only typed Session Journal；
- Session persistence/fork/resume/surface projection；
- 模型可见内容可从日志重建；
- Cordis 插件生命周期、Service、live event、Registry；
- Tool、LLM、System Prompt 等成熟领域服务；
- 可替换 AgentFactory。

但 DSH 的第一性插件模型是 Cordis。`session/event` 是 append 后的 observer feed，DSH 还禁止在该 publication 中同步重入 append；默认业务由 concrete AgentLoop 调用 Service 和 waterfall 推进。

关键证据：

- Session 模块自述为 append-only event-sourced session service；`Session` 内保存 `SessionEvent[]`：[session/index.ts](/Users/lizhe/workspace/deepseek-harness/packages/core/session/src/index.ts:1)、[session/index.ts](/Users/lizhe/workspace/deepseek-harness/packages/core/session/src/index.ts:425)。
- `session/event` 明确定义为 commit 后、fire-and-forget、observer failure 隔离的 feed：[session/index.ts](/Users/lizhe/workspace/deepseek-harness/packages/core/session/src/index.ts:65)。
- append 先写 log 再通知 observer，并拒绝通知期间同步 reentrant append：[session/index.ts](/Users/lizhe/workspace/deepseek-harness/packages/core/session/src/index.ts:604)。
- 默认 `AgentLoop` 自己执行 `while (true)`，主动派生消息、调用模型、执行工具并 append 结果：[agent.ts](/Users/lizhe/workspace/deepseek-harness/packages/core/agent-loop/src/agent.ts:245)、[agent.ts](/Users/lizhe/workspace/deepseek-harness/packages/core/agent-loop/src/agent.ts:332)。
- `AgentFactory` 可以被替换，但这只说明 DSH 可容纳另一种 Agent 实现，不说明已有插件都遵循 Journal-reactive 协议：[agent/index.ts](/Users/lizhe/workspace/deepseek-harness/packages/core/agent/src/index.ts:177)、[agent/index.ts](/Users/lizhe/workspace/deepseek-harness/packages/core/agent/src/index.ts:360)。
- 仓外插件的 required durable Event 还受已知事件类型恢复校验限制：[known-event-types.ts](/Users/lizhe/workspace/deepseek-harness/packages/core/session/src/known-event-types.ts:8)、[coordinator.ts](/Users/lizhe/workspace/deepseek-harness/packages/session/session-persistence/src/coordinator.ts:1051)。

最重要的区分是：

```text
Journal 是事实/上下文源       DSH 已实现
Journal 是业务推进的唯一原语   DSH 默认未实现
```

若在 DSH 中加入 JournalReactor：

```text
Cordis Runtime
  -> JournalReactor Cordis Plugin
      -> Journal-native Plugins
```

它可以验证行为，但形成嵌套插件系统。现有 DSH 插件不会自动变成 Journal subscriber，需要 LLM/Tool/Prompt/AgentFactory adapters。DSH 的外部插件 required durable event 注册也尚未完全开放。

因此独立仓库的目的不是复制 DSH 功能，而是隔离并验证：**Journal 能否成为唯一业务推进原语，而不是 Cordis 下的一个可选 Service。**

如果最终最小内核仍逐渐长成 Service Registry + live event + concrete Loop，则说明独立项目没有成立；如果普通 Journal 插件能够持续扩展而 Core 保持不变，实验才有价值。

## 12. Python 原型的价值与局限

Python 原型已经验证：

- 事件可以形成真实 LLM + Tool 闭环；
- Mock Provider 可以替换真实 Provider；
- 注册顺序、广度优先、pause/resume、target、delivery trace 可以实现；
- function calling/CLI DSL 都能映射成工具事件。

但它也提前加入：

- 独立 `Runtime` 与 pending delivery；
- 每次调用的 `PluginContext`；
- `TransientFrame` 和 `DeliveryTraceSink` 特殊观察面；
- Capability、Assembly、ContextViewStore；
- 大量目标设计文档。

所以 Python 原型是实验素材，不是新 TypeScript Core 的模板。尤其 Trace 的特殊 Sink 不符合当前更严格的“一切插件同权”要求。

源码核查入口：

- Event envelope 与 payload 深复制：[model.py](/Users/lizhe/workspace/journal-agent-kernel/src/journal_agent/model.py:10)
- 纯 Journal 数据结构：[journal.py](/Users/lizhe/workspace/journal-agent-kernel/src/journal_agent/journal.py:9)
- `PluginContext`/Plugin 协议：[plugin.py](/Users/lizhe/workspace/journal-agent-kernel/src/journal_agent/plugin.py:9)
- pending FIFO Runtime 与每次调用 `_Context`：[runtime.py](/Users/lizhe/workspace/journal-agent-kernel/src/journal_agent/runtime.py:46)、[runtime.py](/Users/lizhe/workspace/journal-agent-kernel/src/journal_agent/runtime.py:200)
- Trace 的普通 `*` 订阅与特殊 `on_frame/on_delivery` 旁路并存：[builtin.py](/Users/lizhe/workspace/journal-agent-kernel/src/journal_agent/builtin.py:309)
- System Prompt 作为 `ContextAssembler` 构造参数，而非普通 Journal 插件：[builtin.py](/Users/lizhe/workspace/journal-agent-kernel/src/journal_agent/builtin.py:77)

## 13. 对评审者的期望输出

请优先回答：

1. 第 6、7 节的候选模型是否已经最小；
2. 还能删除什么；
3. 哪个被删除的能力会导致第一条业务链无法正确运行；
4. 单 Journal + 私有 head 是否是最小的非破坏 FIFO，还是应采用其他投递语义；
5. 如何在不特判 Trace 的前提下处理 `*` 订阅和零消费者语义；
6. payload 深度不可变是否属于第一版不可删除的语义；
7. 测试插件化的验收方式是否合理。

请不要优先讨论数据库、分布式、远端协议、UI、权限或大规模性能；它们不是本次评审范围。

---

# 附录 A：用户 Query 原文的无损去重汇编（按时间顺序）

以下内容保留用户原始表述、术语和拼写，不代表文档作者已经同意其中每项判断。为方便评审，文件路径说明等元数据保留，系统生成的附件标记做了简化。Q18 再次完整引用 Q01 只是为了指定整理起点，因此正文只保留一次，并在 Q18 明确交叉引用；除这一处重复去除外，Q01–Q18 均完整保留。

## Q01：首次提出 Journal 事件队列架构

> 我思考了一下：想到了一个事件队列的架构。你来和我一起分析讨论下
>
> 1、这个Journal本身是记录日志，其实也是事件序列，是各方一起发起的结绳记事。
> 2、Journal上的事件，有不同的类型和内容，然后开放各方订阅即可，各方订阅到相关的消息可以在经过一系列自己内部的业务逻辑后，写入或不写入新的事件。
> 3、比如一个“loop”，它订阅的是user的消息，然后收到后启动自己的“loop”（这里的loop已经是概念了，并没有一个实例，是一系列注册插件的集合）
> 4、比如一个工具执行器，它订阅的是tool.call的消息，收到后就去执行，并把返回结果写回到Journal，供“loop”订阅并触发下一阶段的assistant
> 5、比如一个工具调用后做统计的hook，它本身也可以订阅tool.result事件，然后处理自己的统计打点然后结束，实现各类业务的hook机制（这个hook可以继续写事件，也可以不写）
> 6、比如LLM自己写了一个脚本和hook，可以注册进来订阅任意的消息类型并触发业务逻辑并回写或不回写事件
> 7、“loop”其实就变成了一个触发各类业务逻辑的选择器，比如他在收到user（在idle时收到的user，在running状态下收到的user其实也差不多，但稍微有点区别，需要等tool_call或者LLM生成完再触发，但这些也都是loop内的业务逻辑）的时候，就按需发出need.content的消息类型，然后LLMProvider、小模型、规则匹配等各类内容生成的插件订阅这个信号，订阅到了后按照处理优先级或者顺序依次处理这个消息，然后把生成内容（content/tool.call）重新加入事件队列。
>
> 所以其实除了这个日志事件队列外，其他都是订阅各类消息类型的插件，依然实现了一切皆插件，且各方竭尽所能的去解耦，因为各方订阅的都是事件队列上的事件类型，而非其他插件的生成结果，所有插件和事件队列交互，基本可以做到完全解耦，实际的业务逻辑完全靠插件注册，和插件自己本身的订阅和处理的业务逻辑来实现。
>
> 这样可以做到非常灵活，即loop或者goal或者其他任何可能的交互形式和逻辑都可以在这个插件系统上实现。（比如上面的loop，他的任务就变成了订阅user和tool.result，在收到这类消息后发出need.content的信号，这个信号只是事件，不带内容，所以LLM生成的时候也看不到，当然想看到也完全可以看到）
>
> 每个人的业务逻辑都原子化，解耦，变成了一条调用链，谁想在日志事件队列里面加入内容，上下文环境，动态匹配的各类机制，hook，甚至非LLM生成的内容，或者任何runtime插件的内容，或者LLM自己写的hook，都是完全可以的，实现了极度灵活且解耦的插件能力集合。
>
> 我想到的问题是：1）插件之间的优先级如何处理，所以这块需要的是一个调度器？当收到need.content的时候，依次发出召唤信号，召唤到谁了就谁回复，但很难，因为插件之间是不可见的，除非这个插件都注册到了这个调度器里，但调度器本身也是插件，不能和其他插件交互，建议还是发信号处理，所以需要在信号总线上加机制，发的是who is content provider，然后其他插件发自己的名字和优先级，召唤到了以后，直接指定处理的role，或者按照顺序依次调用，直到有内容生成为止。这种协议实体化的感觉，你觉得如何？2）并发如何处理，比如两个插件都订阅了tool.result，先后的处理顺序如何约定，是有个默认的优先级吗？先处理优先级0的，然后再处理之后注册的其他hook或者内容生成的插件？两者生成的插件按照顺序插入到队列，然后两者各自触发的新的事件的处理流程又是什么，这块你建议做异步吗？还是异步的机制放到插件内部，让插件自己处理，但的确存在同一个消息订阅的先后顺序和竞争关系，可以讨论下看看如何处理。
> 你也可以提一些相关的想法，或者潜在的问题，我觉得这个方案还是比较完整的，非常通用，非常base的底层机制，后面专注于把底层的性能做上去，然后剩下的全都是各个插件的业务逻辑了，感觉即便是有注册订阅的匹配环节和机制，也不会和直接写定制化的loop的方式性能差太多。

## Q02：初步收敛顺序、控制事件与原型计划

> 1、唯一执行的问题应该不大，这块即便有订阅，关系肯定也是可明确的。
> 2、控制面事件和用户面日志的确可以分开，不必强行合到一起，两边各自处理，各取所需；
> 3、隐藏的时序依赖这些不用关心，我理解这个不是基础平台关心的问题，而是插件和业务编排方甚至是用户，这种只要处理好trace和各类插件的关系即可，不用显式声明依赖，比如need.content信号触发content.generate，但是没有任何LLMProvider注册，那么ContentArbiter会直接报没有content.generator，然后停止事件队列处理即可，剩下的就是UI订阅事件，然后给用户回显报错，让用户自己定位问题，增加LLMProvider的配置。
> 4、时序竞争的问题，我理解是这个框架最严重的，理论上之前的个性化agent-loop里都有业务方来定义调用顺序，但是目前的这个框架，很难完全显式声明清楚，可以有优先级，但是优先级的也解决不了，事件追加是深度优先还是广度优先，或者哪种更好，要不当前先以注册顺序串行为主？还是在注册的时候给一个优先级。
> 5、事件循环失控，可以由业务插件自己保证终止，另外用户在页面上的停止按钮应该也有最高优先级，可以通过控制信号，触发优雅停止后续订阅，也可以通过点击继续按钮，恢复后续订阅，这个需要有两个全局控制信号。
> 6、who_is_content_provider装配阶段发现一次完全没有问题。
> 7、我理解每个插件都可以产生控制信号和日志内容追加，甚至还要考虑内容流式追加或者回显（因为LLM返回的结果，包括bash命令执行返回的结果应该是流式），看哪种负担轻。但不能限定某类插件只能读取，不能写入或者发送控制信号。
> 8、同一个事件消费，不同订阅方产出了冲突的控制信号如何处理（我理解先不用关注吧，但是可能）
> 9、所以控制信号是平台框架和插件共同消费的？最起码第5点里面的是这样的。
> 我理解我们的框架已经马上设计出来了，最后做一次这些问题结论的明确，然后开始写python的原型代码？还是其他的原型代码都可以。
> 在workspace下面建一个新路径，准备开始最初的验证吧

## Q03：控制面、Context 压缩、无状态和 ContentArbiter

> 1、我想确认下，那么现在消息订阅和触发完全走控制面了是吗？用户面的日志记录仅仅为业务处理需要上的记录和读取？
> 2、现在LLM的上下文压缩，压缩后的内容是保存在LLM Provider的插件内部吗？当需要压缩的时候再次触发，并记录用户query的索引，然后继续处理？
> 3、目前插件可以做成无状态的吗？像微服务的业务调用链一样，无状态化，尽量让业务逻辑单一无依赖。
> 4、刚刚的ContentArbiter的插件业务逻辑有点问题，我理解只有用户的query需要去经过ContentArbiter判断，而其他工具返回的结果，没有正则匹配或者小模型可言了，因为他不属于判断用户原始意图的部分，返回的工具结果可以直接调用LLM即可，所以ContentArbiter应该只是根据user来进行路由选择，如果是其他的消息类型，可以直接转给LLM即可。这块有点差别，但应该仅限在插件内部业务逻辑，影响应该不大。
> 是否是这样？

## Q04：日志/信号双通道、ContextAssembler 和 Loop 关系

> 1、我说的控制面也不是装配期的控制面，我表述有点错误。我的意思是journal实际上有两个通道，信号通道和日志通道，日志通道完全不控制，只是提供读取和写入的接口，而信号通道才是各类消息类型，订阅和消费的调度这些机制。是这样吗？
> 2、上下文压缩的确是应该单独的插件，然后自己判断是否超出门限，然后启动压缩，在journal中追加压缩完成后的checkpoint，而LLM则从journal中读取最近一个checkpoint到最近的消息开始持续的处理和生成。这套机制感觉没有问题，就是要把系统提示词的消息看是存在checkpoint内部，还是说LLM读取生成的时候每次拼接system prompt，我感觉每次拼接，混淆了LLM的纯粹的生成职责，但system prompt肯定也不在checkpoint内压缩的文本内容的范围里，这块可能得想想，包括各类环境上下文应该也是不压缩，压缩的应该只有用户交互和session生成的内容的语义。
> 3、`ContentArbiter`按照你说的调整职责即可，他对user和tool.result的处理机制不一样，另外loop是否也在`ContentArbiter`内部，还是loop是一个单独的插件，`ContentArbiter`和loop的关系是什么，感觉如果分成了两个分支，就没必要再loop和`ContentArbiter`各自维护，这俩插件可以合并？先给出方案吧，看看两者的关系如何
>
> 先不要修改，先评估分析现状吧

## Q05：ContextAssembler、测试、动态插件、DSH 定位与技术栈

> 1、`ContextAssembler`可以增加，这样职责更清晰一点。
> 2、signal bus之类的，我说是这么说，但也不太想搞的太复杂，最好就是一个数据结构的队列就可以，里面有类型和content的字段，还有seq，timestamp之类的，应该就够了，也不想搞的太复杂，实现上的，大多数都是根据消息的类型来触发订阅的插件即可。
> 3、目前的这个框架也非常适合测试，因为只要把LLM Provider换成Mock的LLMProvider即可实现完整的端到端测试，甚至检查点都可以设置成纯观测的插件，整个框架还是比较灵活的，少了很多线上和测试环境维护的差别。
> 4、目前的机制的确（怎么说，复杂度有了也可以，或者说有一定基础了也可以）成型了，该有的功能都有了且都是插件来实现的，后面一个session就是一个journal的数据结构的队列，然后可以在其上持续的运行。
> 5、我还想确认下，当前这种装配期的模式，LLM自己写的一个插件，是否可以直接加入到运行时，还是说需要触发重新装配？
> 6、目前的delta消息，是否只是为了UI更新订阅使用的，所有的sse的追加，应该都是一个delta的消息吧，不应该是增加很多delta消息，那样日志队列的污染也太严重了，或者有没有可能是个中间状态的传递呢？直接透传到UI的回显上？这块也可以再看看，不过现在在架构明确的情况下，先可以低优先级。
>
> 最后，我们的设计成型了以后，你觉得和dsh的一切皆插件的差别和定位在哪里，我们这边也是一切皆插件的设计模式，两者有什么区分，我觉得咱们当前以日志本位的设计的更像是一套围绕着日志和AI生成的系统，并不关注外围软件依赖，架构，而是专注于文本序列的内核，而给出一个设计的范式，你觉得这样的设计和dsh哪个更好？后面如果要精进咱们框架的性能，是不是单纯提高该序列的处理能力和性能即可？
>
> 你觉得目标的技术栈是什么，还是先在typescript上做验证？做一个类似于pi agent的架构的coding agent出来？我的架构，你觉得如果实现pi agent全功能，是不是代码量会更少一些，因为充分解耦，各司其职，一个管理体系的恰到好处运行，但问题也存在，隐形的依赖和时序问题，这块随着agent的使用逐步改进和增加定位和trace的手段吧。

## Q06：事件类型、内存、插件粒度和真实 LLM 原型

用户在本轮提供了以下参考文件：

- `/Users/lizhe/AndroidStudioProjects/lz-refactor/.claude/worktrees/host-sdk-integration/docs/agent-decoupling/smoke-runs/reports/20260707-145627/cases/CALL-01.md`
- `/Users/lizhe/AndroidStudioProjects/lz-refactor/.claude/worktrees/release-prep-20260717/app/src/main/assets/agent_config.example.json`

> 1、消息的类型都是插件自己定义的吗？还是说内核会有一版固定的base协议？这块我倾向于全让插件去搞，但是得有trace的插件可以完全还原整个链路出来，我看已经有了订阅所有消息的trace插件了。
> 2、内存肯定是个瓶颈，并发倒还好，主要的问题是作为一个开放的agent，编码或者其他编译运行的进程也会占用内存，本身对于session（journal）的内存如何管理才是最佳的？做成二进制是一种方式，更多的可能还是要优化数据和内存之间的披露关系，不能所有的东西都放到内存里（超长session根本撑不住），但问题又来了，UI上肯定是要全部显示的，发给LLM要从最近的checkpoint开始发送，所以这个还是要评估，比如说1000次query累计下来的journal，能不能到1GB的内存占用之类的性能指标，然后才好评估，这块后续再说吧，但主要是这个内存管理的机制不要依赖于任何插件。
> 3、插件的粒度如何控制，感觉还是不要太粗也不要太细，且要无状态，这个回头咱们再讨论下。
> 4、可以开始调整Python 原型。然后我给你一份数据，你可以参考着mock一下context和系统提示词，然后根据我给的API做一个真实LLM provider，然后验证下功能试一试。附件的md是部分session，用户query，动态匹配的context信息还有系统提示词，你可以看下。真实的LLMprovider，可以从json里面的模型3的线路里面选择，注意/Users/lizhe/AndroidStudioProjects/lz-refactor/.claude/worktrees/release-prep-20260717/agent-llm-openai/src/main/kotlin/com/example/terminalcontrol/agent/llm/openai/OpenAiCompatibleLlmProvider.kt，你可以让子智能体从这个release-prep-20260717找到这个API的使用方式，这个API需要带model_provider和maf的开关（maf的开关可以关闭掉）。第4点你可以拉起一个子智能体完成修改，然后你来在python上验证效果。

## Q07：Mock ToolRouter/Executor 的完整业务链验证

> 可以做个mock的`ToolRouter/Executor`让这个loop跑起来吗？可以返回一个列表，让LLM返回结果，然后mock一个user，选第一个，让其触发select 1，然后工具返回成功拨打的结果，然后LLM回复最终结果停止。可以这样吗？这样验证了这个架构是可以真实运行的场景能力，让我看到完整的trace轨迹，最好还有每轮的持续时长

## Q08：从 CLI DSL 改回 Function Call，并准备正式设计

> 越改越乱，哈哈哈，这块把cli改成functioncall就好了。这个cli的能力和解析，后面应该是不需要的了，需要兼容各个LLMProvider才行，不过这次也验证了，想要用这种DSL去做CLI的工具调用和解析，也是可行的，包括动态插入和卸载的上下文，理论上有些插件装配的上下文仅在本轮生效，不会写jounal。
> 这块插件实现的确有点乱了，不过也验证出来了一些结论，你上一轮没有改内核实现吧，只是在插件侧做了修改是吗？（除了时延打点）
>
> 接下来我们需要规划设计方案了，甚至拿出来目前的event的数据结构来评审，看哪些字段是必要的，不过这些都是细节。后续要思考看看，在ts的技术栈上如何实现，配合TUI和网页版，然后我们也要开代码仓了，你觉得这个项目起个什么名字好？

## Q09：Trace/Eval 与 Storage/Session 基础设施边界

> 我还想说，现在的trace支持eval吗？支持运行中的agent自己来检查自己或者其他人的trace，来实现eval吗？评估关键节点的LLM选择，是否要做成一个工具，是否就是纯插件侧实现就可以了，咱们目前的这个内核其实是稳定的？
> 另外存储和session的加载这套底层基础设施的选型和配置，是不是无法插件化了，是一些更底层的runtime的功能了，比如UI回显和用户的输入可以是插件，但session的选择，加载，继续，这些是不是就是底层的一些实现了？比如说通过存储接口来对接底层不同的存储实现，比如sqllite或者纯文本保存之类的？所以围绕着这个jounal 的内核，还是要在周边建一套配套的服务的，然后这套服务无法作为插件注册，是这样吗？这也是咱们这个项目和DSH最大的差别？是吗

## Q10：ToolRouter、ToolExecutor 与 Tool Provider 的边界

> 其实还有一个，toolRouter和ToolExecutor也是一个注册订阅的机制，之前在安卓项目里面做了一个dispatcher专门来处理安卓终端智能体的所有工具集的注册，接入，元数据的生成之类的部分。看起来tool这块也是一个小的插件合集，我想了解的是这块做成Router，把其他工具做成整个系统的插件，通过信号来交互，还是说tool这块专门分出来一个大的模块，做一个单独的调度器和整体的机制，和基础平台的日志调度分开？你觉得哪种好？我觉得两种都可以，Router的可能更清晰，但是每个工具的插件就和其他所有的插件都注册到一起，而且工具的发现机制上，也需要有个整体的管理方，便于注册工具，提供各个工具的元数据，json schema，或者是工具的简述，索引，以便于LLM可以动态发现等，整体的dispatcher可能这些处理的好一些，但在trace上内部对于总线和事件日志上不透明。这块也是有一些机制的。可以探讨下

## Q11：框架特征、认知成本、代码量与性能判断

> 可以的，tool provider就在tool包的内部就可以，到时候可以提供完整的工具服务即可。你觉得咱们整个项目的功能特性都有哪些，不是指的是插件的业务功能，而是整个框架相比于其他框架的特点。我理解现在github上，这种agent项目太多了，我们相比于他们的特色在哪里。你可以简单梳理下。
>
> 我觉得管理制度和机制上算一个吧，这种底层极简总线平台，划分插件领域和范围的机制，可以让每个人在最小认知成本的情况下在各自的领域可以持续构造和演进，哪怕在AI coding的时代，这样划分，以调用链来定位问题或者维护或者优化代码的方式，肯定也是最小化认知，最小化输入token，会有很大的优势，每个人都有各自的职责范围，不会互相碾压。职责清晰，每个人都发挥了价值，每个模块都按照预期的认知组织了起来有了实际的效用，而不是做个各个异常或者兜底的分支，没有触发，也无法测试验证。
>
> 所以我也感觉，因为极简内核的缘故，我其实是有信心在实现pi agent同等功能的情况下，代码量比他缩减至少20%的，除了庞大的第三方LLMprovider的配置外，其他的整体的业务功能的代码量我会比他少很多，因为机制和职责都纯粹，各个插件都是只写自己的业务功能和逻辑，且尽量保持无状态，没有其他的底层兼容等等，日志，平台机制，管理调度，注册订阅，这些全都在一个极简的平台上实现。唯一的问题我担心的还是在性能，因为比如在其他耦合的平台上，做一个正则匹配，匹配到了可以分发结果到各个业务模块来处理命中的业务逻辑，但目前拆分成插件后，每个模块可能都在自己handler的时候做匹配，会引入一些动作上的重复和冗余，但我也不打算改这个机制，为了这些一点点也许没什么效果的性能优化，如果有大量并发网络请求，这些应该由插件自身集中在一个节点上做异步和并发，而不是由平台提供什么机制罢了。
>
> 你评估下如何？我对这个项目的观点和认知你觉得如何？有没有较大的偏差？

## Q12：要求先写设计文档并核实与 DSH 的真实关系

> 还是先写文档吧。
> 1、请先参考安卓项目的/Users/lizhe/AndroidStudioProjects/lz-refactor/.claude/worktrees/release-prep-20260717/docs/agent-decoupling/reference-points-frozen.md形式，写一个目前咱们讨论的架构的spec和协议以及相关的设计文档，便于我来核实和阅读。就先落在python原型的这个路径即可，后续没什么问题了，我会去github上开仓。
> 2、请让子智能体去阅读一下DSH的docs里面的架构文档，开发指南等各类文档，给出一些架构的内容总结。因为我看到他们也是围绕着共享上下文，各类插件协同作用的机制，我感觉是有类似的机制的，感觉我目前想到的方案是DSH的子集，也请你让子智能体去阅读完以后核实下，我们当前项目的特点和与DSH的关系，而不是泛泛的说他们是围绕runtime来构造一切皆插件，需要讲清楚两边的实际差异才对。

## Q13：拒绝大而全，并要求确认是否只是 DSH 子集

> 1、首先文档写的太多了，有很多过度设计，理论上应该咱们先300-500行做出来个智能体出来，然后给他扩展插件，在扩展的过程中，发现journal内核需要扩充再扩充，而不是一上来搞大而全，或者起码把大而全留到后续的重构阶段，先让业务简单最小化非必要的跑起来，就是单纯的做出来这个journal驱动，然后相关业务逻辑放到插件的这个模式里面。各个插件理论上完全没有依赖，如果有先后依赖的顺序关系，没有，那么内核直接运行时停止下来即可，就像python的编译器一样，运行到哪行，有问题再报错。
> 2、DSH如果已经有append-only typed Session Journal和一系列的功能，是不是就可以说我们做的就是DSH的一个子集，那这样做还有必要吗？不是说有没有loop是差别，而是DSH也可以通过更换插件实现没有loop自然成环。即这个journal的本质的模式是不是完全被DSH覆盖了，如果是的话，那我们独立建仓的必要性肯定变小了好多，不如直接给DSH贡献代码。
>
> 请你认真的再次评估下这两点，尤其第二点，需要确认DSH到底包不包含咱们Journal-first的核心设计和概念。

## Q14：确认自建仓方向与 300–500 行最小形状

> 目前我看下来，感觉在DSH里面只能验证，而咱们想要的journal-first的内核和配套的插件系统，在DSH里面只是一个非常小的一个模块，甚至和DSH的其他插件都并不兼容，完全不是咱们预想的那种，以journal为基础，其他插件在其上订阅消息并生产事件的模式，甚至journal-reactor本身都变成了插件本身。只能在这个插件的外部继续外接，而不是把他做成一个core，所有插件在其上注册并发挥作用。这样即便可以在DSH里面贡献代码，他本身也无法成为核心。我理解的对吗，我不想做太多软件的外围实现，我只是想验证以journal为核心的智能体框架，目前看起来感觉还是得自建仓库，但是自建仓库的第一步也是一个300-500行的拥有完整核心，但是插件系统可以简化的这种最小化的agent模式，可以session在内存里，可以query预置，可以命令行运行，直接返回结果，这些都没问题，外围和底层的driver都可以一步一步添加上来。你觉得呢，问下你的意见

## Q15：创建 Knot Agent 仓库并要求最小实现

> ok，开仓，[https://github.com/liz-public/knot-agent.git](https://github.com/liz-public/knot-agent.git)，克隆这个仓库，然后写你的最小实现，这个仓库的凭据跟之前DSH的仓库的凭据应该都是一样的。你可以先试试，有问题可以找我

## Q16：第一次审视 TypeScript 文件职责

> 1、core.ts是journal的核心？我看里面还有trace的部分，trace不应该在core里面，trace是一个单独的插件；和你的python原型设计的有了偏差
> 2、llm.ts和tool.ts都是插件吧
> 3、main.ts就是装配层？
> 你每个文件负责什么职责，实现了什么功能，大概讲一讲吧。

## Q17：指出首版实现无法自然演进，要求重新对标核心

> 我感觉味道还是不对，你觉得咱俩需要对标一下吗？这个最小版本肯定是可以运行的，但又有很多跟我想的完全不一样，感觉有种没办法演进下去，甚至验证的感觉。
>
> 1、trace的咱们刚才说过了。
> 2、插件的注册靠import导入，的确简化了，然后约定了一个plugin的接口，按照接口实现handle即可，但后面怎么实现动态注册。但这些也都无所谓吧。系统提示词是靠声明llm实例的时候注入进去的，不是插件来拼装的吗？
> 3、**cloneData和**deepFreeze我感觉也看不出来什么必要性，你可以说一下。
> 4、你的this.#cursor < this.journal.length，这个while循环，我也不太能理解，为什么要维护一个cursor，不是消息队列吗？而且每次调用插件都要声明一个PluginContext吗？感觉就是有很多地方很奇怪，起码这个core.ts不是我太想要的实现。
>
> 我觉得这个可能不是我想要的最小的形状，但是又包含了很多不知道应该不应该算作必要的部分。我觉得我们得讨论一下，要不然很难推进下去，你应该重点给出推进或者演进的方法，或者我们先明确下这个core的业务逻辑，然后插件的职责，然后还有哪些你需要的必要的实现。
>
> 测试的感觉也不对，说好了测试通过mock插件，订阅相关消息结果来检查实现（和生产不同的插件配置），实际上是单独拉起运行时去断言。

## Q18：明确 Trace 无特权，并要求本评审文档

> 1、trace和其他插件完全一样，不要有任何特异性的实现，否则就是违背了这套框架，内核不会给他提供除了日志事件队列之外的任何东西，没有observer，需要trace自己实现
> 2、别的我就不说了，感觉你还是没有说到点上，你从第一性原理出发，思考思考真的需要cloneData和deepFreeze这些吗？还有提示词的插入，双通道的设计，为什么要有双通道的设计，逻辑上的确可以这么分，但实现上没有必要搞这些吧，还有context里面的on emit observe这些，必要性都不高，所以context里应该给插件传什么。最关键的就是你的core的循环处理的逻辑，还是奇怪。
>
> 你要不写篇文档吧，把从下面这个query的我的所有的query都带上，然后把路径，前因后果都说清楚，我们找专家看看评一评，到底这个最小实现方案应该是什么样的，我理解很容易就能做出来，后续就是逐步扩展插件，直到发现处理不了的瓶颈，比如流式传输之类的，然后才需要扩展内核能力。
> 从这个query开始的所有的query，都记录到文档上吧，作为原始的需求和待讨论项，注意写清楚整个项目的背景，和DSH的差别，还有python原型的方案和文档路径也都可以带上，要确认咱们这个项目的核心点。
>
> 随后完整引用了 Q01，作为本次整理的时间起点；原文已在 Q01 完整保留，此处不重复抄录。
