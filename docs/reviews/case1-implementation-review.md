# CASE1 实现评审

> 日期：2026-09-08
> 评审对象：提交 `d41537a` "feat: add Android CASE1 plugin assembly"
> 核查方式：全文阅读 + `npm test`（14 项通过）+ `npm run case1` + 两个一次性探针实验
> 结论：**流程设计成立，可以立项；但有 2 个必须在 CASE2 之前修掉的问题，其中 1 个是实验确认的活 bug**

## 0. 先说做对的部分

**内核零改动。** `git diff 7619936 HEAD -- src/journal.ts` 为空。整个 Android 终端控制流程——运行时上下文注入、规则短路、function calling、工具状态、历史压缩、reasoning 分流——全部由插件在 56 行内核上完成，没有一次需要回头改内核。这是本次最重要的信号，它比任何测试都更能回答"这个框架能不能承载真实 Agent"。

几个具体做得好的地方：

**`llm.request` / `llm.invoke` / `llm.generated` 三段式是这份实现最漂亮的设计。** 因为"想要一次生成"和"已经materialize好的一次调用"被拆成两个事件，`contextAssembler` 成为 `llm.request` 的唯一闸门，压缩插件才能在完全不修改 `agentFlow`、不修改 LLM 插件的前提下，把一次生成请求改道成"先压缩、再恢复原请求"。`CompressionLlmRequest.resume` 携带原始请求，压缩完成后原样重放。这正是框架承诺的"插入一个步骤而其他人不知情"，而且它是被真实需求逼出来的，不是提前设计的。

**零订阅者语义被真实用到了。** `context.dynamic` 和 `history.compaction.required` 都没有订阅者：前者是纯事实，由 `contextAssembler` 按需投影；后者是一个被动标记，由闸门轮询。当初把"零订阅者合法"作为内核语义，在这里第一次得到回报——如果内核仍然对无人消费的事件报错，这两个事件都无法存在。

**动态上下文的处理是正确的，而且正确得很微妙。** `context.dynamic` 每轮重建、只对当前 turn 可见、压缩时不进摘要（`semanticMessages` 在 compress 分支不传 `dynamic`）、但压缩之后仍然出现在下一次 agent 调用里。测试 `runtimeContextMessages[0] === runtimeContextMessages[1]` 正好锁死了这条性质。这与 Python 原型 `ARCHITECTURE.md` 第 4 节的结论一致："动态环境 Context 是当前轮事实，不被历史 Checkpoint 吞掉"。

**规则短路合成 `tool.call` 的做法是对的。** `shortcutPlugin` 命中后直接追加 `tool.call`，工具插件照常执行，`contextAssembler` 再把它投影成 `assistant(tool_calls)` + `tool` 两条消息。于是一个从未经过模型的规则动作，对模型呈现为一次正常的工具调用历史，模型可以无缝接着推理。这条路径省掉了一整次模型往返，正是项目最初想验证的"提高信息密度、减少无效 token"。

**Trace 和 output 都是普通插件，sink 由装配层注入。** `run.ts` 把 trace 写 stderr 并带时延打点，测试把同一个 trace 插件写进数组。生产与测试的差别仍然只是装配表。

---

## 1. 必须修：并行工具调用静默扇出

`llm.ts:37` 对 `toolCalls` 做了循环追加，所以一次生成可以产生多条 `tool.call`：

```ts
if (toolCalls.length > 0) {
  for (const call of toolCalls) {
    journal.append(TOOL_CALL, { ... })
  }
  return
}
```

而 `agent-flow.ts:27` 对每条 `tool.result` 都无条件请求一次新生成：

```ts
journal.subscribe(TOOL_RESULT, event => {
  const result = event.data as ToolResult
  journal.append(LLM_REQUEST, { purpose: 'agent', turnId: result.turnId })
})
```

**实验确认**：让 provider 在第一次生成返回 2 个 tool call，结果是 `llm.invoke=3`、`generations=3`、`assistant.message=2`。用户会收到两条最终答复，中间多花一次模型调用，而且全程没有任何报错。

这比上一版更危险。上一版 `src/plugins/llm-openai.ts` 有一句 `throw new Error('parallel tool calls are not supported yet')`，不支持是显式的；现在不支持变成了静默的错误行为。真实模型（尤其是 qwen3-coder 这类）返回并行 tool call 是常态，这个问题一定会在真机上出现。

**正确的修法是在 `agentFlow` 里做 join，不要动内核。** 它读 Journal，确认本轮所有已发出的 `tool.call` 都有对应 `tool.result`，没齐就什么都不追加：

```ts
journal.subscribe(TOOL_RESULT, event => {
  const result = event.data as ToolResult
  const events = journal.read()
  const calls = new Set<string>()
  for (const item of events) {
    if (item.type === TOOL_CALL && (item.data as ToolCall).turnId === result.turnId) {
      calls.add((item.data as ToolCall).callId)
    }
  }
  for (const item of events) {
    if (item.type === TOOL_RESULT && (item.data as ToolResult).turnId === result.turnId) {
      calls.delete((item.data as ToolResult).callId)
    }
  }
  if (calls.size > 0) return
  journal.append(LLM_REQUEST, { purpose: 'agent', turnId: result.turnId })
})
```

这件事的意义不只是修一个 bug。它是 [minimal-kernel-review-response.md](minimal-kernel-review-response.md) 第 7 节列为 M2 的那个压力测试：**内核到底需不需要 barrier / join / correlation？** 上面这段说明不需要——`turnId` + `callId` 已经足够让插件自己 join。请把它连同一条并行调用的回归测试一起补上，这个结论比 CASE1 本身更有价值。

## 2. 必须修（或至少必须知情）：`llm.invoke` 把全量 messages 写进 Journal

`context-assembler.ts:157` 把materialize好的完整 `messages` 数组作为事件 payload 追加：

```ts
journal.append(LLM_INVOKE, { requestId, request, messages, tools })
```

于是第 N 次生成会把前 N 轮历史再存一份，Journal 体积对轮数呈平方增长。

**实测**（默认 mock、无压缩、每轮一次生成，统计各事件 payload 的 JSON 字节数）：

| 轮数 | 事件数 | `llm.invoke` 字节 | 其余全部字节 | `llm.invoke` 占比 |
|---|---|---|---|---|
| 10 | 82 | 12 292 | 6 017 | 67.1% |
| 20 | 162 | 33 057 | 11 837 | 73.6% |
| 40 | 322 | 100 087 | 23 477 | 81.0% |

其余事件严格线性（6017 → 11837 → 23477，每次刚好 2 倍），`llm.invoke` 是唯一的平方项，40 轮时已经占掉 Journal 的 81%。这里的 mock 消息只有几十字节；换成真实的 4k-token 上下文，200 轮就是几百 MB，而且它是"事实"，将来持久化会全部落盘。

这正是 Python 原型 `ARCHITECTURE.md` 第 4 节明确避开的坑，原文写着"完整 materialized messages **不写 Journal**。否则第 N 次调用会重复保存前 N 次历史，使存储和内存接近 O(n²)"。原型为此建了 `ContextViewStore`。这一版把结论丢掉了。

三个选项，我不替你决定，因为这是架构级取舍：

**A. 现在就改成 manifest。** `llm.invoke` 只携带 `{ requestId, request, boundaries: { checkpointRequirementId, tailFrom }, toolCount }`，投影函数由装配层同时交给 assembler 和 LLM 插件（一个零 Journal 知识的纯函数，不构成插件间耦合）。代价是 trace 里看不到实际发出的 messages，调试变难。

**B. 保留 messages，但承认这是第一个实测到的瓶颈**，在 CASE2/CASE3 用真实上下文量一遍，等数字足够难看时再引入内核级的瞬时 payload 通道（Python 原型的 transient frame）。这符合"只有真实压力才改内核"的纪律，而且现在已经有了第一组测量数据。

**C. 折中**：`llm.invoke` 保留 messages，但由一个普通插件订阅 `llm.generated` 后追加 `llm.invoke.released` 之类的事件，把已完成调用的 messages 置空。这在 append-only 语义下是自欺欺人，不建议。

我倾向 **B**，但前提是把这张表和上面的结论写进 CASE2 的验收项，别让它悄悄过去。选 A 也合理，如果你希望 Journal 从第一天起就是可持久化的。

## 3. 重要：`throughIndex` 把删掉的 `seq` 从后门带回来了

`compress-history.ts:61`：

```ts
journal.append(HISTORY_COMPACTION_REQUIRED, {
  requirementId: `compact-${result.requestId}`,
  throughIndex: events.indexOf(event),
})
```

`throughIndex` 是 Journal 内部数组的物理下标，而且它被写进了 `history.checkpoint` 这条持久事实里，`contextAssembler` 后续用 `checkpoint.throughIndex + 1` 作为尾部起点。

上一轮我们刻意从 Event 上删掉了 `seq`，理由正是"一旦有它，插件会立刻拿它做水位线，从而在没有真实压力时提前固化 checkpoint 语义"。现在压缩插件用 `indexOf` 把这件事做了，而且做得比内核 `seq` 更糟：

- `indexOf` 依赖引用相等，O(n)，每次检测都扫全表；
- 这个下标只在当前这一个内存 Journal 实例里有意义。将来一旦有持久化裁剪、fork、replay，下标会静默错位，而不是报错；
- 它指向的是 `llm.generated` 事件本身，一个语义上很奇怪的边界（见下）。

**建议的插件级修法**：水位线用内容标识而不是位置。生成事件已经有唯一 `requestId`，所以记 `throughRequestId: result.requestId`，`contextAssembler` 扫描找到该 `requestId` 对应的 `llm.generated` 位置即可。扫描成本一样，但边界自描述、可跨持久化、trace 里一眼能看懂。

**同时这是一个值得记录的演进信号**：如果 CASE2、CASE3 都各自需要一个水位线，那才是给内核加 `seq` 的正当证据。到那时 `seq` 的语义（数组下标？全局单调 id？跨 session 怎么办？）会有三个真实约束来定义，而不是靠猜。现在先别加。

顺带说明边界本身是自洽的，我逐事件核对过：`llm.ts` 在同一个 handler 里先追加 `llm.generated` 再追加 `tool.call`，而压缩插件订阅 `llm.generated` 是在下一个投递波次，所以 `throughIndex` 指向 `llm.generated`(9)，而 `assistant.reasoning`(10)、`tool.call`(11)、`tool.result`(13) 落在尾部。摘要覆盖 `[0..9]`、尾部覆盖 `[10..]`，没有消息丢失也没有重复。压缩总是滞后一次工具往返，这反而是好事（不在工具调用中间截断）。

## 4. 重要：`content.no_match` 的仲裁语义只在"恰好一个 provider"时成立

现在的链路是 `content.request` → `shortcutPlugin` 不命中 → 追加 `content.no_match` → `agentFlow` → `llm.request`。

问题是 `content.no_match` 的语义实际上是"**我这个插件**没命中"，但它的名字和消费方式却把它当成"**没有任何 provider** 命中"。一旦装配表里出现第二个内容生产者（小模型分类器、缓存命中、更多规则包——这是 Q01 第 7 点的原始诉求），两个插件会各自追加一条 `content.no_match`，于是产生两次 `llm.request`，重演第 1 节那个扇出问题；如果两个都命中，则会产生两条冲突的输出而无人仲裁。

这就是 Q01/Q02 里"who is content provider"那个仲裁问题，现在只是因为恰好只有一个 provider 而没暴露。**在你准备做 3 个 case 并立项之前，这个协议缺口值得先补掉**，因为它决定了以后所有内容生产插件的写法。

一个 journal-native 的最小仲裁器：装配表里排在所有 provider **之后**注册一个 arbiter，订阅同一个 `content.request`。因为 handler 追加的事件是立即进数组的（只是还没投递），arbiter 可以直接看"本条 `content.request` 之后有没有人为这个 turnId 产出过东西"：

```ts
journal.subscribe(CONTENT_REQUEST, event => {
  const request = event.data as ContentRequest
  const events = journal.read()
  const produced = events
    .slice(events.indexOf(event) + 1)
    .some(item =>
      (item.type === TOOL_CALL || item.type === ASSISTANT_MESSAGE)
      && (item.data as { turnId: string }).turnId === request.turnId,
    )
  if (!produced) journal.append(LLM_REQUEST, { purpose: 'agent', turnId: request.turnId })
})
```

这样 `content.no_match` 这个事件类型可以整个删掉，provider 只需要"命中就产出、不命中就沉默"，注册顺序天然成为优先级，新增 provider 不需要改任何现有插件。注意它同样依赖 `events.indexOf(event)`——和第 3 节是同一个信号，说明"当前事件在 Journal 中的位置"确实是个反复出现的需求。

## 5. 重要：工具拿不到 Journal 派生状态，只能自己存

`tools.ts` 的 `ToolDefinition.execute(arguments_)` 只接受参数。于是 `mockAndroidBashTool` 只能用闭包变量保存待选联系人：

```ts
export function mockAndroidBashTool(): ToolDefinition {
  let pendingContact: string | undefined
  // ...
}
```

同时它又在 `tool.result` 里报告 `state: { key: 'pending.selection', value }`，而 `runtimeContextPlugin` 的 `activeState()` 会把这些 state 折叠出来注入动态上下文。

**于是待选状态有两份真相**：工具闭包里的 `pendingContact`，和 Journal 折叠出来的 `pending.selection`。工具完全不读后者。这直接违背你在 Q03 第 3 点提的"插件尽量无状态"，也意味着 replay 一遍 Journal 无法重建工具行为——这恰恰是 Journal-first 最该保住的性质。

**修法**：让 `execute` 收第二个参数，是从 Journal 折叠出来的只读状态，工具退化成 `(args, state) => result` 的纯函数：

```ts
execute(arguments_: Record<string, unknown>, state: Readonly<Record<string, unknown>>): ...
```

`toolsPlugin` 里复用 `activeState(journal.read())` 计算它即可。注意不要把 `journal` 本身交给工具——那会让工具能追加事件，绕过 `tool.result` 协议。

## 6. 重要：重复轨迹已经开始了

`src/plugins/` 和 `src/cases/case1/` 现在有 5 个同名文件：`llm-mock.ts`、`llm-openai.ts`、`output.ts`、`system-prompt.ts`、`tools.ts`。只有 `trace.ts` 是共用的。两个 `llm-openai.ts` 里 fetch + 解析响应那 50 行是实打实的复制。

按现在的切分方式（只按 case 切），到 CASE3 会有 4 份 OpenAI provider。真正与 case 无关的机制只有三样：HTTP 传输、trace、工具分发骨架；真正属于 case 的是协议、提示词、规则、工具实现和装配表。

**建议的切分**：把 `chatCompletion(options, messages, tools) => { reasoning, content, toolCalls, usage }` 提成一个零 Journal 知识、零协议知识的纯传输函数放进共享位置，各 case 用自己的协议把它包成插件。这样既消除重复，又不会让共享代码知道任何 case 的事件类型。

同时要决定 `src/main.ts` + `src/plugins/*`（上一版的最小 demo）还留不留。它现在是第二套并行插件集，README 里也是两套说明。我倾向：CASE1 定型后删掉旧 demo，让 `src/cases/*` 成为唯一的装配位置，`src/plugins/` 只放真正跨 case 的机制。

---

## 7. 小问题

**`shortcuts.ts:39` 会把所有规则都跑一遍。**

```ts
const output = ordered
  .map(rule => rule.match(request.query))
  .find(result => result !== undefined)
```

`.map` 是急求值，即使第一条规则已经命中，后面所有规则的 `match` 仍然会执行。当前都是正则所以无害，但 Q01 第 7 点设想的 provider 里有小模型分类，那时"依次处理直到有内容生成为止"就会变成"每次都把所有小模型都跑一遍"。改成 for 循环提前 break。

顺带一提：`ShortcutRule.priority` 不算违反禁止清单第 7 条——那条针对的是内核，插件在自己内部给自己的规则排序完全正当。只是目前只有一条规则，`priority` 是暂时的空转。

**`history.compress.request` 是一跳纯转发。** `contextAssembler` 追加它，`compressHistory` 只是加上 `instruction` 再转成 `llm.request`。如果 `compressHistory` 在追加 `history.compaction.required` 时就把 `instruction` 带上，`contextAssembler` 就能直接追加 `llm.request(purpose: 'history.compress')`，省掉一个事件类型和一次投递。17 个事件类型对一个 case 来说偏多，这是最容易砍的一个。

**mock 工具的两条错误分支没有测试。** `no_active_list` 和 `invalid_selection` 都不可达。case 里的不可达分支正是你在 Q11 批评过的"做个各个异常或者兜底的分支，没有触发，也无法测试验证"。要么补两条测试（模型选了不存在的序号、跳过 contact 直接 select），要么删掉。我建议补测试——这两条恰好能验证"工具用 hint 引导模型自我纠错"这条真实机制。

**`contextAssembler` 里动态上下文有两条发射路径。** 一条内联在 `semanticMessages` 遇到匹配 `turnId` 的 `user.message` 时发射，另一条在 `currentUserIsAfterCheckpoint` 为假时单独 push，两者靠一个布尔量协调（`context-assembler.ts:144`）。逻辑是必要的（压缩后用户消息已进摘要，动态上下文得单独补），但目前要读三处才能确认不会重复发射。建议把"尾部是否包含本轮 user.message"算成一个命名变量，并在两处都引用它，或者干脆合成一条路径。

---

## 8. 结论与建议的下一步

**可以立项。** 判断依据不是"测试通过"，而是内核在承载一个有运行时上下文注入、规则短路、function calling、工具状态、历史压缩、reasoning 分流的真实流程时，一行都没有改。三段式 LLM 协议让压缩能无侵入插入，这一点比 CASE1 本身更能说明框架的扩展方式是成立的。

立项前建议按这个顺序收口：

1. **修并行工具调用扇出**（第 1 节），连回归测试一起。这同时结清了 M2 那个"内核要不要 barrier"的悬案。
2. **决定 `llm.invoke` 的 payload 策略**（第 2 节）。选 A 就现在改，选 B 就把那张表写进 CASE2 验收项。
3. **把 `throughIndex` 换成 `throughRequestId`**（第 3 节），并把"是否需要内核 seq"挂起，等 3 个 case 的证据。
4. **补内容仲裁器、删掉 `content.no_match`**（第 4 节）。这条决定以后所有内容生产插件的写法，越早定越好。
5. 第 5、6、7 节可以放到 CASE2 一起做。

另外建议现在就把 [minimal-kernel-review-response.md](minimal-kernel-review-response.md) 第 8 节那 14 条禁止清单固化成 `AGENTS.md`。这一轮 codex 守住了内核边界，但第 3 节和第 4 节的 `events.indexOf(event)` 说明"当前事件在 Journal 中的位置"是个会反复出现的诉求；把边界写成可 `grep` 的规则，比每轮人工评审更省力。
