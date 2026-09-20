# Knot 插件设计与最佳实践

本文总结 CASE1、CASE2、JSONL、Trace 和 Workbench 平台接线已经验证出的插件设计原则。它描述当前实践，不提前承诺插件 Marketplace 或冻结的 `definePlugin` API。

## 1. 最小契约

```ts
type Plugin = (journal: Journal) => void
```

插件安装就是调用一次函数。带配置时使用返回 Plugin 的普通函数：

```ts
function outputPlugin(write: (text: string) => void): Plugin {
  return journal => {
    journal.subscribe('assistant.message', event => {
      write((event.data as { content: string }).content)
    })
  }
}
```

不要仅为了统一外观增加基类、生命周期、容器或 `PluginContext`。当一个真实插件无法通过 Journal 和装配参数正确实现时，再讨论扩展接口。

## 2. 插件类型

这些类型是职责分类，不是内核中的继承体系。

### 业务插件

产生 Agent 语义行为，例如内容选择、模型生成、工具执行、Todo Guard 和压缩策略。它们订阅领域事件并追加领域事实。

### 平台插件

把 Journal 接到产品外围，但仍使用完全相同的插件契约。例如 Workbench 的 Journal 变更桥只订阅 `*`，通知 Host 重新读取权威快照。

平台插件不能获得内核私有 cursor、优先通道或生命周期特权。

### 持久化插件

JSONL Store 是普通通配订阅插件。它在事件交付位置记录事件和 Journal 外的观测时间。恢复由装配层在注册业务插件前加载历史，避免重放旧事件触发副作用。

持久化实现不改变 Journal Event 形状，也不把时间戳强塞给模型可见事实。

### Trace 插件

Trace 与其他插件相同：订阅 `*`，把事件投影到 sink。生产环境可以写 stderr，测试可以写数组，Workbench 可以从 JSONL 建立 Trace 读模型。

Trace 没有 observer 特权，也不是第二条事件通道。

### Presentation / Output 插件

订阅 `assistant.message` 等完成事实并输出到 CLI 或其他表面。逐 Token 流式内容属于瞬时外围端口；最终完成事实仍只提交一次。

## 3. 单一职责判据

一个插件的职责应该能用一句话描述，并能指出：

- 它订阅什么事实；
- 它为什么被触发；
- 它可能追加什么事实；
- 哪些事明确不属于它；
- 如何单独测试它。

代码行数不是硬指标，但无法清楚描述的插件通常承担了编排、策略和副作用等多个责任。复杂业务优先通过 Assembly 组合多个清晰节点，不要制造万能插件。

## 4. 事件粒度对齐一次决策

一次模型生成里的多个工具调用应是一条批事件，而不是 N 条独立事件：

```ts
tool.call { calls: [...] }
tool.result { results: [...] }
```

这样工具插件可以在内部并行执行，结果存在就代表整批完成，模型投影也天然合法。

判据：如果一个事实只有凑齐若干条才有意义，它通常应该从一开始就是一条事件，而不是靠下游实现 Join。

## 5. 事实、投影与 Manifest

Journal 存“发生了什么”和“如何重建”，不存可以重算的大型结果。

不要把完整 LLM messages、每轮重复工具 schema 或整份上下文快照反复写进 Journal。使用请求标识、Checkpoint 和 Manifest，在调用时由纯 Projection 重建模型输入。

任何窗口都必须两端封闭。起点和终点应使用 `requestId`、`turnId`、`callId` 等内容标识，而不是 Journal 数组下标。

## 6. 状态按所有者归位

| 状态所有者 | 放置位置 | 示例 |
|---|---|---|
| Journal 可推导的 Agent 信念 | Journal + Projection | Todo、Goal、最近一次工具观测 |
| 外部世界的真实状态 | 工具/设备/Host 持有 | 权限、Shell cwd、设备候选列表 |
| 插件内部纯机械状态 | 插件闭包 | 连接池、请求计数器、缓存 |
| 用户界面瞬时状态 | Web/Host | 未发送 follow-up、审批弹窗队列 |

不要把从 Journal 推导的 Agent 信念反向喂给工具，冒充外部世界的真实状态。信念和真相发生分歧时，工具应返回失败事实和纠错提示，由后续行为恢复。

## 7. 插件不直接依赖，不等于没有语义依赖

推荐：

```text
Plugin A → append protocol event → Plugin B reacts
```

避免：

```text
Plugin A imports Plugin B → calls B.handle()
```

插件可以共享：

- `protocol.ts` 中的事件名和 payload 类型；
- 纯 Projection、校验器和领域函数；
- 装配层明确注入的外部端口。

`llm.request` 没有 Provider、`tool.call` 没有 Executor 都是无效 Assembly。Journal 内核不会维护已知事件注册表；Assembly 校验和端到端 Case 应发现这类问题。

## 8. 注册顺序就是行为

同一事件的订阅者按注册顺序串行执行，因此 Assembly 中的顺序具有语义。

顺序只能在 Assembly 单一来源中出现一次。不要同时在：

- 实际插件数组；
- Studio Manifest；
- Web fixture；
- 测试辅助配置

维护四份顺序。

下一阶段的目标是让同一组 Assembly 节点同时提供实际安装行为和可序列化元数据，Host/Studio 只消费派生的只读描述。

CASE2 已经使用一个内部 `PluginNode = { plugin, metadata }` 形状验证了这个方向。它没有改变 `Plugin = (journal) => void`，也没有引入生命周期或依赖容器；在更多 Assembly 验证前，它仍是内部形状而非冻结接口。

## 9. 有序策略不是多个 Journal 插件

要求多方独立反应时，使用多个订阅者；要求有序 N 选一时，使用一个领域插件组合普通策略。

例如内容来源：

```ts
contentPlugin([
  shortcutSource,
  smallModelSource,
  llmSource,
])
```

`ContentSource` 只回答内容或返回 `undefined`，不需要知道 Journal、其他来源或自己的排序。不要让每个弃权来源追加 `content.no_match`，把局部 first-match 变成全局事件噪音。

工具定义同理：工具是 Tool Provider/Dispatcher 内部的领域项，不需要每个工具都成为顶层 Journal 插件。

## 10. 错误边界

- Handler 抛出的未处理异常中止本次 `runUntilIdle`，内核不重试也不吞错。
- 可预期的工具失败应转换成 `tool.result`，让模型能够定位和恢复。
- 网络、Provider 或压缩错误是否重试，由拥有该 Effect 的插件或外围策略决定。
- 具有不确定副作用的崩溃恢复尚未形成通用结算协议，不应在每个插件内各自猜测。

## 11. 测试就是另一套装配

测试不需要专用内核：

- 替换真实 LLM 为 Mock Provider；
- 替换真实工具为内存实现；
- 给 Trace 插件传入数组 sink；
- 使用同一业务插件和协议；
- 对最终 Journal 和外部效果断言。

一个成熟插件至少应验证：

1. 命中路径；
2. 合理的拒绝或失败路径；
3. 不应响应的事件保持沉默；
4. 追加事件的 payload 契约；
5. 与真实 Assembly 的一条端到端轨迹。

## 12. 可分享插件包：设计方向

当前没有冻结格式。目标是保持轻量，并确保元数据和执行代码只有一个来源。

可能的最小形状：

```text
my-plugin/
├── plugin.ts
├── plugin.test.ts
└── README.md
```

未来的定义可能包含：

- 稳定 id、名称和版本；
- 作者、联系方式与许可证；
- 单一职责和明确的非职责；
- 订阅/产出的协议；
- 配置 schema 和默认值；
- 运行环境要求；
- 源码入口；
- 聚焦测试或 Case。

`definePlugin(...)` 可以成为承载这些信息的薄辅助函数，但只有在它能同时驱动实际安装和 Studio 元数据、且不改变最小 Plugin 执行契约时才值得引入。

同样，`defineAssembly(...)` 只有在解决实际的单一来源问题时才成立。它不应演变成工作流 DSL、依赖求解器或新的 Runtime。

## 13. 提交插件前的检查表

- [ ] 职责能用一句话描述。
- [ ] 不直接导入另一个业务插件的实现。
- [ ] 事件粒度对应一次完整决策。
- [ ] 可重算的大对象没有进入 Journal。
- [ ] 状态有明确所有者。
- [ ] 注册顺序只在 Assembly 中定义一次。
- [ ] 可预期失败会形成模型或用户可见的业务结果。
- [ ] Mock 与真实实现使用同一协议边界。
- [ ] 至少有一个聚焦测试或可复现 Case。
- [ ] 没有要求修改 `src/journal.ts`；如果必须修改，已有真实 Case 证明旧契约无法表达该行为。
