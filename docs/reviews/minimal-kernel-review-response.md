# 最小 Journal-first 内核：评审回复与落地方案

> 日期：2026-09-04
> 对应材料：`docs/reviews/minimal-kernel-expert-review.md`
> 核查基线：`011d903` 的 `src/core.ts`、`src/plugins/*`、`test/*`，以及 `journal-agent-kernel` 的 `ARCHITECTURE.md`
> 性质：评审结论 + 可直接实施的最小实现清单，不是又一份大设计文档

## 0. 总体判断

评审材料第 3 节的第一性原理是对的，第 6、7 节的候选模型方向也是对的，**但还没有到最小**。当前 `011d903` 的偏离不在于"多写了几个类"，而在于一个统一的根因：

> 内核为"尚不存在的边界"提前付了代价。

`cloneData/deepFreeze` 为不可信插件付费，`PluginContext` 为 invocation 作用域付费，`Runtime` + `#failure` 为可恢复运行时付费，`unhandled event` 报错为内核理解业务协议付费，Trace callback 为观测特权付费。这五件事都没有对应的真实需求。

我的裁决是：**采用候选 A，内核收敛到一个文件、一个工厂函数、约 45 行，没有 class，没有 Runtime，没有 Reactor，没有 Context。** 候选 B（双通道）删除，候选 C（同步递归）删除。

同时我对评审材料本身提出 7 处修正，见第 3 节。其中最重要的两处是：`read()` 也不应复制数组（否则"信任插件"这个决定只做了一半），以及 `*` 订阅必须与具名订阅共用同一个注册顺序列表（否则 Trace 在实现层仍有特权）。

---

## 1. R0–R9 逐条裁决

### R0：Event envelope 能否只剩 `type + content`？

**能，且必须。删除 `seq`。**

数组位置已经定义顺序，`seq` 是冗余状态。删它的真正理由不是省一个字段，而是：**一旦 Event 上有 `seq`，插件会立刻开始用它做水位线**（Python 原型的 `covers_through_seq` 就是这么长出来的），于是 checkpoint、压缩、持久化恢复的语义会在没有真实压力时被提前固化。而那时 `seq` 到底是"数组下标"还是"跨 session 全局单调 id"根本无法回答。

反驳"Trace 需要知道序号"：订阅 `*` 的插件按 FIFO 收到全部事件，自己计数即可，这是它的业务。

命名上建议 `data` 而不是 `content`：`content` 在 LLM 语境里已经被 `message.content` 占用，`event.content.content` 这种表达会持续制造歧义。

```ts
type Event = { readonly type: string; readonly data: unknown }
```

`timestamp/source/correlation/target` 一并不进第一版，同意材料判断。

### R1：Journal Entry 与待处理 Event 是否同一对象？

**同一对象。候选 B 删除。**

Signal 相对 Journal Entry 多出来的东西只有"我是控制流不是事实"这一句自述，而这句自述在运行时不产生任何不同行为。两套 API 会立刻产生三个新问题：插件何时写一份、何时写两份、两者如何关联。这三个问题在第一版一个都没有真实案例。

更重要的是：项目命题就是"Journal 是唯一业务推进原语"。提供第二个可编程通道等于在实验开始前就否定了命题。

### R2：是否需要 cursor？head 属于谁？

**需要，且它属于 Journal 本身。不要引入 Reactor。**

材料第 4.2 节的分析是正确的：既保留全部历史又只投递一次的结构，必须表达"下一个未投递位置"。单个私有整数是这个状态的最小表达，pending queue 是同一状态的更大表达（多一份引用数组 + 两个结构的同步问题），同步递归则改变了语义（深度优先 + 栈深度不可控 + handler B 晚于 child event）。

关键裁决是归属。**不要叫 Reactor，也不要单独建一个对象。** 理由是纯粹的演进防御：一旦存在一个名为 Reactor/Dispatcher 的实体，它就会长出配置项、中间件、并发策略、优先级——Python 原型的 `Dispatcher` 已经长出了 `priority`、`registration_order`、`observe_targeted`、`DeliveryTraceSink`。而"一个 append-only 日志知道自己的投递水位"是完全自洽的性质，就像 WAL 知道自己的 apply 位置，它不构成第二个实体。

`head` 不对插件公开，不是 checkpoint，不是每插件消费位点。

### R3：append-only 是否要求 payload 深度不可变？

**不要求。删除 `cloneData` 和 `deepFreeze`。保留 envelope 的浅 `Object.freeze`。**

材料 4.4 已经指出了 JSON round-trip 的语义损坏（`undefined/NaN/Date`），我补充一条更严重的：它把"payload 必须 JSON 可序列化"变成了内核级约束。第一版并没有持久化边界来正当化这条约束，但它已经排除了 payload 携带 `Error`、`AbortSignal`、流句柄、函数的可能——而这些在插件扩展期很可能出现。用一个不存在的持久化需求，去限制一个马上就会出现的插件需求，方向是反的。

保留浅冻结（`Object.freeze({ type, data })`）：它是 O(1)、零语义损失，且精确表达了 append-only 在第一版真正要保证的东西——**条目本身不可被替换**。payload 内部的不可变性降级为插件契约。

等出现真正的边界（不可信插件、跨进程、持久 Store）时，那个边界会自带明确的数据域定义，那时再选快照方案。

### R4：零订阅者是什么语义？

**一律合法。删除 `unhandled event` 报错。**

内核不理解业务事件类型，因此没有任何依据判断某事件"必须"被处理。当前实现里这行报错是内核在假装懂业务，而且它已经产生了具体伤害：它使得 `system.prompt`、审计记录、纯记录性事件无法存在于 Journal 中，直接阻断了材料第 9 节的目标业务链。

`need.content` 无 Provider 这类错误由定义该协议的插件自己检测并追加业务错误事件，材料 Q02 第 3 点的原始判断是对的。

**必须诚实说明代价**：事件类型字符串拼错会静默失效，内核不会报警。第一版接受这个边界，缓解手段是 Trace 插件打印全部事件 + 端到端测试。不要为此在内核加任何"已知类型注册表"。

### R5：多订阅者的最小顺序？

**注册顺序串行，广度优先，新事件追加到 Journal 尾部。材料判断正确。**

但有一个材料没有写、而实现层极易做错的细节，见第 3.3 节：`*` 必须和具名订阅在同一个列表里按注册顺序混排。

不引入 `priority`。Python 原型的 `priority` 已经被证明是伪需求——它自己的 `ARCHITECTURE.md` 第 2 节就承认"优先级不能代替业务依赖，有业务先后关系时应使用不同事件表达"。既然如此，第一版直接用后者。

### R6：插件需要收到什么？

**安装时收到共享 Journal handle（`append/read/subscribe`），handler 只收到 Event。材料判断正确，且已经最小。**

删除 `PluginContext`。当前每次调用都新建 `{append, read}` 对象，但第一版不存在 invocation 作用域的权限、取消、因果或事务，它是纯粹为假想需求付的税。闭包捕获 Journal 是更小且更直接的表达。

插件形态改为函数：

```ts
type Plugin = (journal: Journal) => void
```

好处不只是少写 class：`plugin(journal)` 本身就是"安装"这个动作，动态注册天然成立（`(await import(path)).default(journal)`），插件私有状态就是闭包变量，带配置的插件就是柯里化（`systemPromptPlugin(text)`）。`name`、`subscriptions` 声明字段全部删除——订阅关系由 `subscribe()` 调用表达，不需要再声明一次。

`runUntilIdle` 只由装配层持有，不进 Journal 接口，材料判断正确。

### R7：Trace 如何在完全普通插件的条件下完成？

**Event-only 契约足够，第一版接受"看不到无输出的 handler"这一边界。**

Trace 就是 `journal.subscribe('*', sink)`，一行。它不能证明某个不产生事件的 handler 是否运行过——这是普通事件订阅的天然边界，也正是项目要验证的约束本身。Python 原型的 `DeliveryTraceSink` 必须删除，它是特权观测面。

关于 handler 抛错的可观测性：drain 直接中止并把原始异常原样抛给 `await runUntilIdle()` 的调用者。**不要 wrap**（当前实现的 `new Error(\`plugin X failed on #N\`, {cause})` 反而埋掉了原始 stack 的可读性），原始异常的 stack 已经包含 handler 的文件和行号，定位足够。

这也意味着第一版不需要给 handler 起名字。

### R8：System Prompt / Context 的最小表达？

**装配层追加 `session.start`，`systemPromptPlugin` 订阅它并追加 `system.prompt`，LLM 插件每次从 Journal 投影。已经最小。**

删除 LLM 插件构造函数的 `system` 参数（`llm.ts:74`、`main.ts:19`）。这是当前实现里性质最严重的一处偏离——它意味着 System Prompt 不是一个可替换、可观测、可 Trace 的参与方，而是某个插件的私有配置。第一条业务链里，Prompt 必须和 tool.result 一样是 Journal 上的事实。

**不要引入 ContextAssembler。** 第一版只有一类 Prompt 生产者，投影逻辑放在 LLM 插件内部（20 行的 `project()` 函数）。等出现第二类动态环境上下文插件、且两者的组合无法靠事件协议稳定表达时，再把投影提炼出来。Python 原型的 `ContextAssembler + ContextViewStore + context_manifest` 是在没有第二个案例时提前建的，这也是它偏离的原因之一。

### R9：测试插件化的验收方式？

**方向正确，但"AssertionPlugin"是多余的新概念。**

不需要发明一种新插件。**把 Trace 插件的输出目标参数化就够了**：

```ts
const tracePlugin = (sink: (event: Event) => void): Plugin =>
  journal => journal.subscribe('*', sink)
```

生产装配传 `event => console.error(event.type, event.data)`，测试装配传 `event => collected.push(event)`，然后在 `await runUntilIdle()` 之后普通地断言 `collected`。同一个插件、两种装配，这比引入 AssertionPlugin 更有力地证明了论点：**测试与生产的差别只在装配表的两行**。

内核单元测试直接验证投递语义（FIFO、注册顺序、`*` 混排、零订阅者合法、异常中止）不算"知道内部"——这些就是内核的公开契约。当前 `test/core.test.ts` 的问题不是它测了内核，而是它测的契约本身是错的（`unhandled event` 报错、深冻结）。

---

## 2. 还能删除什么（对应期望输出第 2 点）

从 `011d903` 出发，以下全部删除：

| 删除项 | 位置 | 理由 |
|---|---|---|
| `seq` 字段 | `core.ts:2` | 数组位置已定序；留着会诱发提前的水位线设计 |
| `cloneData` / `deepFreeze` | `core.ts:20-30` | 为不存在的信任边界付费，且损坏 payload 语义 |
| `PluginContext` | `core.ts:7`, `core.ts:104` | 无 invocation 作用域需求 |
| `Plugin` 接口的 `name`/`subscriptions` | `core.ts:12` | 订阅由 `subscribe()` 表达，不需重复声明 |
| `Runtime` class | `core.ts:61` | 闭包足够；class 会吸引继承和配置 |
| `Trace` callback | `core.ts:18`, `core.ts:102` | 观测特权，直接违背核心命题 |
| `unhandled event` 报错 | `core.ts:97` | 内核假装理解业务协议 |
| `#failure` 粘性状态 | `core.ts:67` | 为"可恢复运行时"付费；异常原样抛出即可 |
| 错误 wrap | `core.ts:110` | 埋掉原始 stack，降低可定位性 |
| `read()` 的数组复制 | `core.ts:57` | 与"信任插件"决定不一致，见 3.2 |
| `Journal.at()` / `length` 公开 | `core.ts:35`, `core.ts:50` | 投递是 Journal 内部实现，不需要公开访问器 |
| `deliveries` 返回值 | `core.ts:85` | 无消费者；且它是投递内幕的泄漏 |
| 重名插件检查 | `core.ts:70` | 插件不再有 name |
| LLM 的 `system` 构造参数 | `llm.ts:77` | Prompt 必须走 Journal |
| `ingress` 与 `append` 的区分 | `core.ts:80` | 装配层和插件用同一个 `append` |

## 3. 我与评审材料的分歧（最重要的部分）

### 3.1 `session.start` 之后不需要单独 drain 一次

材料第 9 节要求"第一版在启动用户请求前先把 `session.start` drain 到 idle，确保 Prompt 已经进入 Journal"。

**这个要求不必要，而且它掩盖了一个应该被验证的性质。**

一次 drain 同样成立。追踪一下：装配层连续 append `session.start` 和 `user.message`，drain 开始，`head=0` 投递 `session.start`，`systemPromptPlugin` 把 `system.prompt` 追加到尾部（此时数组是 `[session.start, user.message, system.prompt]`），`head=1` 投递 `user.message`，LLM 插件此刻 `read()` 已经能看到 `system.prompt`。

它能成立，是因为 **LLM 的投影本来就不按物理顺序工作**——OpenAI 的 messages 数组要求 system 在首位，投影函数无论如何都要按角色归类而不是按 Journal 下标顺序照抄。

所以我建议：**`main.ts` 写成两段 drain**（因为真实 CLI/REPL 形态天然就是"启动 → drain → 等输入 → append → drain"），**但同时留一条一次 drain 也必须通过的测试**。这条测试的价值是充当试金石：一旦某个插件偷偷依赖了 Journal 的物理位置而不是事件的语义，它会立刻失败。

### 3.2 `read()` 不应该复制数组

材料 R3 讨论了 payload 深复制，但漏掉了 `read()` 自身。当前实现每次 `read()` 都做 `Object.freeze([...this.#events])`。

如果第一版的决定是"信任插件、payload 不深冻结"，那么**为数组复制付费就是自相矛盾**：一个能修改 payload 的插件，当然也能 `read() as Event[]` 之后修改数组。花 O(n) 的复制去防御一个已经决定不防御的攻击面，只是把决定做了一半。

而且在 drain 循环里每个 handler 都 `read()` 一次，这是 O(n²)。第一版事件少无所谓，但它会成为"内核性能不行"的错误结论来源。

`read()` 应该直接返回内部数组，靠 TS 的 `readonly Event[]` 表达编译期契约：

```ts
read(): readonly Event[] { return events }
```

### 3.3 `*` 必须和具名订阅共用同一个注册顺序列表

这是材料完全没有涉及、而实现层最容易做错的一点，也是 codex 大概率会做错的地方。

自然的写法是 `Map<string, Handler[]>` 加一个单独的 `starHandlers: Handler[]`，然后 `[...named, ...star]` 或 `[...star, ...named]`。**这两种写法都给了 `*` 特权**——通配订阅者被系统性地排在具名订阅者之前或之后，而不是按它在装配表里的位置。这在实现层重新引入了"Trace 是特殊的观察者"，只是换了个形式。

正确的最小结构是一个扁平数组：

```ts
const subscriptions: { type: string; handler: Handler }[] = []
// 投递时：
subscriptions.filter(s => s.type === '*' || s.type === event.type)
```

`*` 只是匹配符，不是一类订阅者。Trace 装在装配表第一行就先看到事件，装在最后一行就后看到——这才是"完全没有特权"。

顺带，用 `filter` 而不是 for 循环里判断，还免费得到了一个明确语义：**订阅者列表在每个事件投递开始时快照，运行期新注册的订阅者从下一个事件开始生效**。这消除了 `subscribe()` 在 drain 中被调用时的未定义行为。

### 3.4 保留可重入保护

材料没有讨论这一点。如果装配层把 `runUntilIdle` 传给了某个插件（未来的 REPL 插件很可能需要），嵌套 drain 会造成 `head` 被两个循环同时推进，事件被跳过或重复投递。

三行的布尔守卫把一个静默的语义灾难变成一个明确的错误，开荒期这个交易是划算的：

```ts
if (running) throw new Error('journal is already draining')
```

这是当前实现里少数应该保留的东西。

### 3.5 错误原样传播，不 wrap，不留粘性状态

材料 3.6 说"handler throw/reject 原样向调用者传播"，方向正确。但当前实现同时做了 wrap 和 `#failure` 记忆，两者都要删。

`#failure` 让 Runtime 在第一次失败后被永久毒化（`test/core.test.ts:56` 甚至在断言这个行为）。这是"可恢复运行时"的语义，第一版明确不承诺恢复，也就不该有这个状态。

### 3.6 `protocol.ts` 保留，但必须降级为纯声明

材料 3.7 说"内核只固定结构协议"，正确。但删不删 `protocol.ts` 材料没说。

我的判断：**保留单文件 `src/protocol.ts`，但里面只能有 `const` 字符串和 `interface`，零运行时逻辑**，且文件顶部注释必须写明"这是当前这套插件装配的约定，不是内核的一部分，内核不 import 它"。

理由是权衡：完全散落字符串字面量会拼错（而 R4 已经决定内核不报警），而中心化的 protocol 文件如果掺入逻辑就会变成隐形内核。纯声明文件不会。等插件多到一个文件放不下时，再按协议拆成 `src/protocols/tool.ts` 这样的小文件，那时"LLM 插件 import 工具协议、但不 import 工具实现"这条边界会自然浮现。

**验收标准：`src/journal.ts` 不出现 `import`。** 内核零依赖，包括零内部依赖。

### 3.7 命名：`createJournal`，不是 `createKernel`

材料用的就是 `createJournal`，我确认这个选择并给出理由：项目的全部命题是"Journal 是唯一第一等实体"。文件叫 `journal.ts`、工厂叫 `createJournal`，让命名承载哲学，是防止内核长胖的第一道防线——任何想往内核加东西的人都得先回答"这是 Journal 的性质吗"。

`core.ts` 这个名字反而是中性的，什么都能往里塞，当前 `core.ts` 里有 Trace 就是证明。**建议重命名 `core.ts` → `journal.ts`。**

---

## 4. 最小内核完整代码

这是全部内核，`src/journal.ts`，无 import，48 行：

```ts
export interface Event {
  readonly type: string
  readonly data: unknown
}

export type Handler = (event: Event) => void | Promise<void>

export interface Journal {
  append(type: string, data: unknown): Event
  read(): readonly Event[]
  subscribe(type: string, handler: Handler): void
}

export type Plugin = (journal: Journal) => void

export function createJournal(): {
  journal: Journal
  runUntilIdle: () => Promise<void>
} {
  const events: Event[] = []
  const subscriptions: { type: string; handler: Handler }[] = []
  let head = 0
  let running = false

  const journal: Journal = {
    append(type, data) {
      const event = Object.freeze({ type, data })
      events.push(event)
      return event
    },
    read: () => events,
    subscribe(type, handler) {
      subscriptions.push({ type, handler })
    },
  }

  async function runUntilIdle(): Promise<void> {
    if (running) throw new Error('journal is already draining')
    running = true
    try {
      while (head < events.length) {
        const event = events[head]!
        head += 1
        for (const { handler } of subscriptions.filter(
          s => s.type === '*' || s.type === event.type,
        )) {
          await handler(event)
        }
      }
    } finally {
      running = false
    }
  }

  return { journal, runUntilIdle }
}
```

对照材料期望输出第 3 点（"哪个被删除的能力会导致第一条业务链无法运行"），上面这段里**不可再删**的只有四样：

1. `head` —— 删掉就必须改成第二份 pending queue 或同步递归，两者都更大或改变语义；
2. `runUntilIdle` 里的 `await` —— LLM 和工具是异步的，删掉链就断在第一次网络调用；
3. `*` 匹配 —— 删掉 Trace 就必须枚举全部已知事件类型，"完整还原链路"的契约立刻失效；
4. 扁平的注册顺序订阅数组 —— 换成任何按类型分桶的结构都会给 `*` 或某类订阅者隐含特权。

`running` 守卫和 `Object.freeze` 严格说可删，但代价（静默的投递错乱 / 完全放弃 append-only 的运行时表达）远大于收益（3 行 + O(1)）。

---

## 5. 文件清单与行数预算

下面是已落地的实际行数：

```
src/journal.ts               56   内核。零 import。不认识任何业务事件类型
src/protocol.ts              34   纯声明：事件类型常量 + payload interface。内核不 import
src/plugins/trace.ts          4   subscribe('*', sink)，sink 由装配层注入
src/plugins/system-prompt.ts  8   subscribe('session.start') -> append('system.prompt')
src/plugins/llm-mock.ts      25   确定性 mock，供测试装配
src/plugins/llm-openai.ts   135   投影 + fetch + 解析。system 来自 Journal
src/plugins/tools.ts         56   工具注册表 + subscribe('tool.call') -> append('tool.result')
src/plugins/output.ts         8   subscribe('assistant.message') -> print
src/main.ts                  51   装配表 + seed
test/journal.test.ts        131   内核投递语义
test/agent.test.ts          116   端到端：mock 与 OpenAI 两套装配
                            ----
生产代码合计                 377   （目标 300–500）
内核                          56   （目标 50–100）
```

机械核对：`grep -n "import" src/journal.ts` 无输出，内核中也搜不到 `tool`/`trace`/`prompt`/`llm`/`session`/`priority`/`context`/`runtime` 任一词。

### 5.1 一处已知的不一致，留给 M2 决定

LLM 插件的 `system` 来自 Journal 事实，但 `tools` 仍来自装配层配置（`main.ts` 把 `toolSchemas(tools)` 同时喂给两个插件）。两者都是模型输入，来源却不同一。

第一版按本评审的原方案保留了装配层接线，因为它更小、且不引入未经评审的新事件类型。但更彻底的做法是让工具插件订阅 `session.start` 并追加一条 `tool.registry` 事件，由 LLM 插件从 Journal 投影——那样装配层就不再需要知道"LLM 需要工具清单"这件事，动态工具注册也天然成立（对应 Q10 的动态发现诉求）。

建议和 M2 的并行工具调用一起决定，因为两者会改动同一段投影代码。

装配层 `src/main.ts` 的形状：

```ts
const { journal, runUntilIdle } = createJournal()

for (const plugin of [
  tracePlugin(event => console.error(`[trace] ${event.type}`, event.data)),
  systemPromptPlugin('You are a concise assistant. Use demo_lookup before ...'),
  llm,
  toolsPlugin([demoLookupTool]),
  outputPlugin(text => console.log(text)),
]) plugin(journal)

journal.append('session.start', {})
await runUntilIdle()

journal.append('user.message', { content: query })
await runUntilIdle()
```

装配表是整个系统唯一一处能看到"这个 Agent 由什么构成"的地方，这正是目标形态。Trace 在表里排第一行，不是因为它特殊，只是因为想让它先打印。

## 6. 第一条业务链的验收测试

这一条测试同时验证五件事，建议作为第一个写的测试：

```ts
test('一次 drain 跑通完整业务链', async () => {
  const seen: Event[] = []
  const printed: string[] = []
  const { journal, runUntilIdle } = createJournal()

  for (const plugin of [
    tracePlugin(event => seen.push(event)),
    systemPromptPlugin('test prompt'),
    mockLlmPlugin(),
    toolsPlugin([demoLookupTool]),
    outputPlugin(text => printed.push(text)),
  ]) plugin(journal)

  journal.append('session.start', {})
  journal.append('user.message', { content: 'check knot-agent' })
  await runUntilIdle()

  assert.deepEqual(seen.map(e => e.type), [
    'session.start',
    'user.message',
    'system.prompt',
    'tool.call',
    'tool.result',
    'assistant.message',
  ])
  assert.match(printed[0] ?? '', /journal-driven/)
})
```

注意断言里 `system.prompt` 排在 `user.message` **之后**。这不是瑕疵，它恰好证明了：

- 广度优先 + 尾部追加确实生效；
- `system.prompt` 没有任何订阅者，却合法存在于 Journal（R4）；
- LLM 插件在处理 `user.message` 时已经能读到它，说明投影按语义而不是按物理位置工作（3.1）；
- Trace 用和其他插件完全相同的 `subscribe` 拿到了完整链路（R7）；
- 测试与生产的差别只是装配表里换了两个插件和两个 sink（R9）。

材料第 9 节的六条成功标准可以直接机械核对：内核文件里搜不到任何业务事件类型字符串，搜不到 `llm`/`tool`/`trace`/`prompt`/`output` 任一词。

## 7. 演进路线

**M1（本轮）**：上面的清单，跑通 mock 与真实 OpenAI-compatible 两套装配。目标是内核定型。

**M2（第一个真实压力测试，建议紧接着做）**：**并行多工具调用。**

这是当前实现用 `if (calls.length > 1) throw` 回避掉的问题（`llm.ts:127`），也是第一个能真正检验内核是否够用的案例。模型一次返回 3 个 tool call，插件追加 3 条 `tool.call`，工具插件产生 3 条 `tool.result`，而 LLM 插件订阅了 `tool.result` —— 朴素协议下它会被触发 3 次，发出 3 次模型请求。

**正确答案是插件内部做 join**：LLM 插件读 Journal，检查是否所有已发出的 `tool.call` 都有对应的 `tool.result`，没齐就直接返回不追加任何事件。**不要在内核加 barrier、join、correlation 或 target。**

M2 的价值就是把这个结论变成既成事实。如果它能只靠插件解决，"内核不需要调度语义"这个命题就得到了第一个非平凡的验证；如果解决不了，那才是第一个正当的内核扩展理由。

**M3 及之后**：按材料第 10 节的表推进。每次只能被一个真实的、无法用普通插件解决的案例推动。

## 8. 给实现者的禁止清单

第一版内核里出现下列任何一项，都应视为偏离并回退。这份清单的目的是让"偏离"变成可机械检查的事实，而不是口味之争：

1. `src/journal.ts` 出现任何 `import`；
2. 内核出现任何业务事件类型字符串（`user.message`、`tool.call`、`session.start` …）；
3. 出现 `Runtime`、`Reactor`、`Dispatcher`、`Bus`、`Manager`、`Registry` 任一命名的实体；
4. 出现 `PluginContext` 或任何 invocation 作用域对象；
5. 出现 Trace / observer / hook / lifecycle 专用的回调参数或数据面；
6. 出现第二个可编程通道（signal / emit / on / dispatch 的公开 API）；
7. 出现 `priority`、`capability`、`endpoint`、`target`、`correlation`；
8. 出现深复制或深冻结；
9. `read()` 复制数组；
10. 通配订阅与具名订阅被分开存储或分开排序；
11. 零订阅者被当作错误；
12. System Prompt 通过构造参数进入任何插件；
13. 内核出现 `stream`、`delta`、`checkpoint`、`persist`、`session` 相关的任何字段；
14. 测试直接读取内核私有状态，或不通过装配插件获得结论。

前三条建议后续固化成仓库的 `AGENTS.md` 或 `.cursor/rules`，让每次 AI 协作都带上这个护栏——这本身也是项目"最小认知成本"主张的一次自我验证。
