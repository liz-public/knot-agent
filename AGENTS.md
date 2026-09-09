# knot-agent 开发约束

> 适用范围：本仓库全部代码。写新 case、改插件、评审实现之前先读这一份。
> 现状基线：内核 `src/journal.ts` 56 行，自 `7619936` 起零改动；`npm test` 23 项通过。
> 推导过程在 [docs/reviews/](docs/reviews/)，本文只给结论和可执行的检查项。

## 0. 这个项目在验证什么

一句话：**Journal 能否成为唯一的业务推进原语。**

```text
Journal = append-only Event[]
Event   = type + data
插件    = 订阅某类 Event -> 做自己的事 -> 追加或不追加新 Event
```

没有 AgentLoop。所谓"循环"是订阅关系形成了环；没有新事件就自然停下。**评价一次改动是否正确的首要标准不是"能跑"，而是"内核有没有被迫改动"。**

如果最小内核逐渐长成 Service Registry + 生命周期 + 具体 Loop，这个项目就不成立了。

---

## 1. 内核：唯一不可协商的部分

`src/journal.ts` 是全部内核。它的完整对外契约就是：

```ts
type Event = { readonly type: string; readonly data: unknown }
type Handler = (event: Event) => void | Promise<void>
type Plugin = (journal: Journal) => void

interface Journal {
  append(type: string, data: unknown): Event
  read(): readonly Event[]
  subscribe(type: string, handler: Handler): void
}

function createJournal(): { journal: Journal; runUntilIdle: () => Promise<void> }
```

投递语义，这六条是插件唯一可以依赖的保证：

1. append-only；一个事件恰好被投递一次。
2. 按 Journal 顺序投递。**handler 追加的事件排在当前所有待处理事件之后**，即广度优先。
3. 同一事件的订阅者按**注册顺序串行 await**。`*` 只是匹配符，占据它自己的注册位置，没有任何特权。
4. **零订阅者合法。** 内核不理解业务事件类型，无法判断某事件是否必须被消费。
5. handler 抛错则中止本次 drain，异常**原样**向上传播。不重试、不兜底、不追加错误事件。
6. `runUntilIdle` 只属于装配层，重入直接抛错。

订阅者列表在**每个事件投递开始时快照**，所以运行期新注册的订阅者从下一个事件开始生效。

### 禁止清单（出现任一项即视为偏离，应回退）

1. `src/journal.ts` 出现任何 `import`；
2. 内核出现任何业务事件类型字符串（`user.message`、`tool.call`、`session.start` …）；
3. 出现 `Runtime`、`Reactor`、`Dispatcher`、`Bus`、`Manager`、`Registry` 命名的内核实体；
4. 出现 `PluginContext` 或任何 invocation 作用域对象；
5. 出现 Trace / observer / hook / lifecycle 专用的回调或数据面；
6. 出现第二个可编程通道（公开的 signal / emit / on / dispatch）；
7. 内核出现 `priority`、`capability`、`endpoint`、`target`、`correlation`；
8. 深复制或深冻结 payload（envelope 的浅 `Object.freeze` 是允许的）；
9. `read()` 复制数组；
10. 通配订阅与具名订阅被分开存储或分开排序；
11. 零订阅者被当作错误；
12. System Prompt 通过构造参数进入任何插件；
13. 内核出现 `stream`、`delta`、`checkpoint`、`persist`、`session` 相关字段；
14. 测试直接读取内核私有状态，或不通过装配插件获得结论。

机械自查：

```sh
grep -n "import" src/journal.ts                                  # 必须为空
grep -niE "tool|trace|prompt|llm|session|priority|context|runtime" src/journal.ts   # 必须为空
```

---

## 2. 起手式：不要从默认模板复制业务插件

仓库里有两套东西，用途完全不同：

| 位置 | 是什么 | 该怎么用 |
|---|---|---|
| `src/main.ts` + `src/plugins/*` + `src/protocol.ts` | **内核契约的最小演示**，6 个事件类型 | 读它理解内核怎么用 |
| `src/cases/case1/*` | **一个真实 case 的形状**，16 个事件类型 | 写新 case 时参照它 |

**默认模板在若干处已经落后于 CASE1 的结论，直接复制会把已修掉的问题带回来：**

- `src/plugins/llm-openai.ts` 直接订阅 `user.message` 和 `tool.result` 触发生成，中间没有 `content.request` 这一层，工具调用也是**一条事件一个调用**。它靠 `throw new Error('parallel tool calls are not supported yet')` 兜着——一旦有人删掉这句 `throw` 想"支持并行"，立刻踩中 §4.1 的三个坑。要支持并行就照 CASE1 改成批事件。
- 工具 schema 由装配层同时喂给两个插件（`toolSchemas(tools)`）。CASE1 改成了 `tool.registry` 事件（见 §4.3）。
- 投影函数 `project()` 长在 LLM 插件内部。模板只有一类 Prompt 时这样最小，但 case 一旦有摘要、动态上下文、压缩窗口就必须拆出去（见 §4.4）。

模板**没有**的问题：它在调用时才投影，从不把 messages 写进 Journal，所以没有 §4.4 那个平方膨胀。这一点是对的，别改坏。

结论：**模板教内核，CASE1 教 case。新 case 的插件形状参照 `src/cases/case1/`。**

---

## 3. 一个 case 的标准形状

```text
src/cases/caseN/
  protocol.ts        纯声明：事件类型常量 + payload interface。零运行时逻辑
  caseN.ts           装配表 + start/submit。唯一能看到"这个 agent 由什么构成"的地方
  run.ts             CLI 入口：trace 写 stderr，答案写 stdout
  <plugin>.ts        每个插件一个文件，导出 (config) => Plugin
  projection.ts      纯函数：Journal + manifest -> 模型输入。不是插件
```

约定：

- **插件是函数**：`(journal) => void`。安装就是调用一次。私有状态用闭包，带配置用柯里化。
- **插件不导入其他插件的实现**。可以导入：协议（`protocol.ts`）、纯函数库（`projection.ts`、谓词）。
- **`protocol.ts` 不属于内核**，内核不导入它。文件里只能有 `const` 字符串和 `interface`。
- **装配期只注册订阅，不产生业务事件。** 全部插件安装完成后，装配层才追加第一个 seed 事件。
- 装配表里插件的**顺序有语义**（注册顺序 = 优先级），改顺序等于改行为。

---

## 4. 插件层契约：CASE1 换来的六条

这六条不是风格偏好，每一条背后都有一个已经发生过的 bug。

### 4.1 一个事件对应一次决策，不对应决策里的每一项

**事实的粒度选错了，下游所有插件都得写协调逻辑去补。**

CASE1 曾经把模型一次生成的 N 个工具调用拆成 N 条 `tool.call`。这是最直觉的写法，也是错的，代价有三层，而且都不报错：

1. **流程需要 join。** 一条 `tool.result` 只说明"这一个工具好了"。曾因此在并行调用时给用户发两条最终答复。更阴的是，因为追加的事件先全部进数组再逐条投递，"没有未完成的调用"这个条件对**每一条**结果都成立，所以还得再加一条"我是本轮最后追加的那条"——将近 20 行只为回答一个本不该被问的问题。
2. **并行度被内核吃掉。** 内核对每个事件是 `await` 完才投递下一个，所以 N 条 `tool.call` 事件**严格串行**执行。三个各 40ms 的工具要跑 120ms。模型请求并行调用本来就是为了省延迟，这样等于白请求。
3. **投影出畸形对话。** 每条 `tool.call` 投影成一条只带一个 `tool_calls` 的 assistant 消息，于是发给模型的是"assistant, assistant, assistant, tool, tool, tool"。API 要求 tool 消息必须紧接着请求它的那条 assistant 消息，这个结构真机会被拒。

正确的粒度是**模型的一次决策**：一条 `tool.call` 带 `calls: [...]`，一条 `tool.result` 带 `results: [...]`。于是 join 整段消失（`tool.result` 存在就意味着整批齐了）、工具插件可以自己 `Promise.all` 拿回并行度、投影天然是合法的一条 assistant 带全部 `tool_calls`。顺带 `assistantContent` 也回到批级别，不再被抄 N 份。

**判据：如果一个事实"只有凑齐若干条才有意义"，那它本来就该是一条事件。** 需要 join 是数据模型错了的信号，不是需要更聪明的插件。参照 `src/cases/case1/protocol.ts` 的 `ToolCall` / `ToolResult`。

### 4.2 引用事实要用内容标识，不要用位置

不要把 Journal 数组下标写进 payload。CASE1 曾用 `events.indexOf(event)` 作为压缩水位线并存进 `history.checkpoint`——这个下标只在当前这一个内存 Journal 实例里有意义，将来持久化裁剪、fork、replay 会让它**静默错位**而不是报错。

用已有的唯一标识（`requestId`、`callId`、`turnId`、`requirementId`）指向事实，需要位置时现场扫描定位。找不到就明确抛错。

### 4.3 可重算的东西不要当事实存

`llm.invoke` 曾把 materialize 好的完整 messages 数组存进 Journal，于是第 N 次生成把前 N 轮历史又抄一遍，Journal 对轮数呈**平方增长**：10/20/40 轮时 `llm.invoke` 占 Journal 的 67% / 74% / 81%，其余事件严格线性。

而这份 payload 是纯冗余——它本来就是从 Journal 推导出来的，Journal 当然能再推导一次。改成只存 manifest 后，`llm.invoke` 变成线性，占比稳定在 17%，40 轮 Journal 总量从 123.5KB 降到 28.8KB。

**Journal 存"发生了什么"和"怎么重建"，不存"重建的结果"。** 工具 schema 同理：放一条 `tool.registry` 事件，不要每次调用都抄一份。

### 4.4 任何"窗口"都要两端封闭

只钉起点的窗口，含义会随时间漂移：如果尾部是"到 Journal 末尾为止"，同一次调用半小时后重放会多出一截，manifest 就不可信了。

CASE1 的做法是两端都用内容标识钉住：起点是"某次生成之后"，终点是"正在服务的这次 invoke 之前"，后者通过自己的 `requestId` 定位。于是同一次调用对着任意更长的 Journal 重放，结果**字节一致**——`test/case1.test.ts` 里有专门的测试记录 provider 实际收到的 messages 再重建比对。

**新 case 只要引入窗口（压缩、分页、回溯、局部投影），就必须能通过这条"重放字节一致"的测试。**

### 4.5 有序多选一是一个领域操作，只能由一个插件拥有

`content.request` 不是允许多个插件各自反应的广播，而是“按顺序寻找第一个答案”的一次领域操作。把每个来源包装成订阅者，会把 first-match 藏进注册顺序和 Journal 回看；来源看似是插件，实际只是同一调度器里的候选策略。

正确形状与 `toolsPlugin(ToolDefinition[])` 对称：一个 `contentPlugin(ContentSource[])` 订阅 Journal，内部用普通 `for` 循环依次调用来源，第一个命中后立即返回，后续来源不再运行。

```ts
contentPlugin([
  shortcutSource,
  smallModelSource,
  llmContentSource, // 必中的末位来源
])
```

`ContentSource` 是普通策略函数，不是 Journal 插件：它只知道“回答或返回 `undefined`”，不知道其他来源、自己的顺序或 Journal 的投递机制。顺序只在装配表出现一次。

**判据：**允许 0～N 方独立反应才用多个 Journal 订阅者；要求 N 选一、有序 fallback 时，用一个领域插件组合 N 个策略。不要让弃权者各自追加 `x.no_match`，也不要把局部 first-match 强行事件化。

### 4.6 状态按**所有者**归位；Journal 记观测，不冒充外部真相

"插件必须无状态"这句话太粗，会误导。真正的问题不是"能不能有状态"，而是**这份状态的所有者是谁**：

| 所有者 | 放哪 | 例子 |
|---|---|---|
| 外部世界 | 工具的 ctx，但**必须如实命名为外部** | 设备候选列表、系统权限、shell cwd |
| agent 自己，且影响模型决策 | `tool.call` 的**参数**（模型看得见、Journal 记得住、replay 能重现） | 读文件的 offset、这是第几次重试 |
| agent 自己，纯机械 | 工具 ctx，无所谓 | 连接池、请求序号 |

CASE1 的候选列表属于第一类：`contact call` 让**设备**生成并持有候选，`select 1` 引用的是设备那一份，它可以在我们完全不知情时失效（应用重启、超时、用户干预）。所以它由装配期显式传入的 `AndroidDeviceSession` 持有——这就是"工具 ctx 里放 pending state"，区别只在于它**诚实地命名为设备**，而不是藏成一个 `let pendingContact` 让下一个人误以为这是 agent 的记忆、可以从 Journal 恢复。

唯一的硬规则只剩一条：**不要把 Journal 折叠出的 state 喂回工具让它做决策。** 那会造出第二份会静默漂移的状态模型，让工具依据"agent 以为的"而不是"外部实际持有的"行动。Journal 里的 state 是 agent 的**信念**，由 `tool.result` 观测累积，用于构建模型上下文完全正确，但对外部**没有权威性**。

**推论：信念与真相分歧是正常状况，不是异常。** 它的处理器就是工具的错误返回加 `hint`，驱动模型自我纠正。这类分支是必经路径，**必须有测试**，不是兜底代码。

---

## 5. 协议设计约定

- **事件名必须表达它承载的事实范围。** `content.no_match` 描述的是一个插件的局部结论，却被当成全局结论消费——名字骗了消费方。局部结论要么不追加事件（沉默即弃权），要么名字里带上"谁的"。
- **事件的粒度对齐产生它的那次决策。** 一次生成发出的所有工具调用是一条事件，不是 N 条（见 §4.1）。
- **payload 用 `data`，不用 `content`**（`content` 已被 `message.content` 占用，`event.content.content` 会持续制造歧义）。
- **payload 里带上归属标识**：`turnId` 用于把一轮内的事实关联起来，`requestId` / `callId` 用于指向具体一次生成或调用。这两个标识是 §4.1、§4.2 得以成立的基础。
- **callId 必须全局唯一**，不要跨生成复用。它是模型侧关联调用与结果的唯一凭据。
- **事件类型预算**：CASE1 用了 16 个。新 case 超过这个量级时，先检查有没有"纯转发事件"——只是给上一个事件加个字段再转发一次的，通常可以把字段前移一步、砍掉整个类型。
- **零订阅者合法是有代价的**：事件类型字符串打错会**静默失效**，内核不会报警。唯一的缓解手段是 trace 插件打印全部事件 + 端到端测试。不要为此在内核加"已知类型注册表"。

---

## 6. 装配与测试

- **测试就是另一套装配表。** 生产装真实 provider 和 CLI sink，测试装 mock provider 和数组 sink。差别只在装配表的几行。
- **不要发明 AssertionPlugin。** trace 插件的 sink 参数化就够了：生产传 `console.error`，测试传 `arr.push`。同一个插件，两种装配。
- **mock provider 要能被单独取用**（CASE1 导出了 `mockLlmProvider`），这样测试可以包一层记录 wrapper 而不重写业务逻辑。
- 每个 case 至少要有这几条测试：
  1. 一次 drain 跑通完整业务链（顺带证明零订阅者合法、投影不依赖物理顺序）；
  2. 两段 seed（`session.start` 先 drain 到 idle，再 append 用户输入）结果一致；
  3. 并行工具调用只恢复一次、并发执行、投影成一条 assistant 带全部调用（如果 case 有工具）；
  4. 每次模型输入都能从 Journal + manifest **字节一致**地重建（如果 case 有窗口）；
  5. 昂贵 provider 在前序命中时**一次都没被调用**（如果 case 有多个 provider）；
  6. 外部状态分歧后能自我纠正（如果 case 有外部有状态工具）；
  7. 真实 provider 的厂商字段（`model_provider`、`_lingxi_maf_enabled`、`reasoning`）原样透传。

---

## 7. 已经结清的结论：不要重新发明

CASE1 的五个问题，**没有一个的正确解法需要内核提供新能力**：

| 问题 | 曾经看起来需要 | 实际用什么解决 |
|---|---|---|
| 并行工具扇出 | barrier / join / correlation | 把粒度改对：一次决策一条事件，join 不存在 |
| 压缩水位线 | 内核 `seq` | 生成的 `requestId` |
| Journal 平方膨胀 | 瞬时 payload 通道 | manifest + 纯投影函数 |
| 内容仲裁 | priority / capability 注册表 | 一个 content 插件 + 有序 sources，LLM 是末位 source |
| 工具状态 | 给插件的状态注入面 | 按所有者归位，外部责任方装配期显式传入 |

另外这些已被明确否决，不要回头：

- **双通道（Journal + Signal 两套公开 API）**：Signal 相对 Journal Entry 多出来的只有一句自述，运行时不产生任何不同行为。
- **同步递归投递**：会变成深度优先，handler B 晚于 child event，栈深度不可控。
- **`seq` 进 Event**：目前用内容标识都能绕开（见 §4.2）。
- **Trace 特权**：Trace 就是 `subscribe('*', sink)`，一行。它看不到"不产生事件的 handler 是否运行过"，这是普通事件订阅的天然边界，第一版接受。
- **ContextAssembler 提前抽象**：只有一类 Prompt 生产者时，投影放在插件内部即可；出现摘要 + 动态上下文 + 压缩窗口之后才拆（CASE1 就是这个时点）。

---

## 8. 未决问题：不要擅自决定

遇到以下情况请先停下来讨论，不要顺手实现：

1. **内核 `seq`。** §4.2 和 §4.5 都出现过"我需要知道某个事实在 Journal 里的位置"（`events.indexOf`），目前都用内容标识绕开了。**如果 CASE2、CASE3 继续出现同样诉求，那才是加 `seq` 的第一个正当理由**——届时它的语义（数组下标？全局单调 id？跨 session 怎么办？）会有三个真实用例来约束，而不是靠猜。
2. **共享传输层。** `src/plugins/llm-openai.ts` 和 `src/cases/case1/llm-openai.ts` 里 fetch 加解析那段是实打实的重复。按现在只按 case 切分的方式，到 CASE3 会有第三份。建议方向：把 `chatCompletion(options, messages, tools)` 提成**零 Journal 知识、零协议知识**的纯传输函数，各 case 用自己的协议包成插件。动手前先定。
3. **失控循环保护。** 一个每次都返回工具调用的 provider 会让 Journal 无限增长直到 V8 OOM（写 CASE1 测试时撞到过）。这符合"由业务插件自己保证终止"的约定，但真机上需要一个普通插件来数轮数并追加终止事件。谁来做、终止事件叫什么，先定。
4. **流式输出**。第一版明确不做。真要做时先证明"追加普通 delta 事件"不可接受，再考虑内核。

---

## 9. 症状速查

| 看到这个现象 | 大概率是 |
|---|---|
| 用户收到多条最终答复 | §4.1 事件粒度比决策更细，或 §4.5 弃权者各自追加了事件 |
| 模型被多调用了几次，但结果看着"对" | 同上，静默扇出通常不报错 |
| 写了 join / barrier / "等齐了再继续" | §4.1 数据模型错了，改事件粒度而不是加协调逻辑 |
| 并行工具的总耗时等于各自之和 | §4.1 拆成了 N 条事件，被内核串行掉了 |
| 真机报 tool 消息没有对应的 tool_calls | §4.1 投影出了多条各带一个调用的 assistant 消息 |
| Journal / 内存增长明显快于轮数 | §4.3 把可重算结果当事实存了 |
| 重放或改动前缀后行为变了，但没报错 | §4.2 用了位置而不是内容标识 |
| 同一次调用两次重建结果不一致 | §4.4 窗口只封了一端 |
| 小模型 / 网络 provider 被无谓调用 | §4.5 缺自守卫 |
| 工具行为无法从 Journal 重现 | §4.6 外部状态被藏成了闭包变量而非显式的外部责任方 |
| 事件追加了但完全没反应 | 事件类型字符串打错（零订阅者合法，不报警），查 trace |
| 删掉的测试还在跑 | `tsc` 不清理 `dist/`；跑 `rm -rf dist` 再 `npm test` |
| `journal is already draining` | 有插件拿到了 `runUntilIdle`；它只属于装配层 |

---

## 10. 提交前自查

```sh
grep -n "import" src/journal.ts        # 空
git diff <base> -- src/journal.ts      # 空；非空则必须在 PR 里论证为什么内核必须改
rm -rf dist && npm test                # 全绿，且测试数量符合预期
npm run caseN -- '<真实输入>'           # 事件链人读一遍是否合理
```

四条硬指标：

1. 内核零改动（或有明确的、被真实案例逼出来的论证）；
2. 新增能力只靠新增插件和事件协议达成，没有修改无关插件；
3. §6 的必测清单该有的都有；
4. 生产代码规模没有失控——CASE1 全部插件 1215 行，内核仍是 56 行。
