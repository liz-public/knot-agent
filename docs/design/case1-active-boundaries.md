# CASE1 当前边界与修复决定

> 本文件是 CASE1 当前唯一实施台账。只记录已经由真实运行、现有业务承诺或可复现测试触发的问题。
>
> 未遇到的问题不进入待办，不提前建设兼容、恢复或治理机制。

## 1. 状态

只使用四种状态：

- `NOW`：当前必须处理；
- `KEEP`：当前行为正确，冻结为约束；
- `DEFER`：已知但未遇到，不写实现；
- `OUT`：不属于 CASE1。

## 2. 当前实施表

| ID | 真实轨迹与原因 | 当前错误 | 唯一所有者 | 最小处理 | 验收证据 | 状态 |
|---|---|---|---|---|---|---|
| ARC-01 | 任意 handler 抛错 | 本次 drain 终止；该事件已经越过 head | Journal 契约 | 不改内核：异常原样上抛；以后再次 drain 从下一事件开始。预期业务失败必须由领域插件转成领域结果 | Journal 测试固定失败传播及下一次 drain 的起点 | `KEEP` |
| TOL-ERR | 未知工具，或一个工具实现抛异常 | `Promise.all` 整批 reject，模型看不到失败，也无法继续决策 | ToolsPlugin | 每个 call 单独封闭异常；成功和失败都进入同一条有序 `tool.result`；错误不逃出工具领域 | 一批包含成功、抛错和未知工具，模型收到三个结果并完成回复 | `NOW` |
| CMP-01 | 同一 session 正常触发第二次历史压缩 | 第二次摘要只压缩 checkpoint 后的 tail，旧摘要永久丢失 | ContextAssembler + Projection | `summary(n+1) = compress(summary(n) + new tail)`；不增加摘要树或新事件 | 第二次压缩输入包含第一次 checkpoint 摘要 | `NOW` |
| CMP-06 | Provider 不返回 token usage | 缺失值被伪造成 `0`，压缩策略得到错误事实 | Provider adapter + CompressHistory | usage 字段允许 unknown；缺失时不作门限判断，不伪造 0 | OpenAI-compatible 响应无 usage 时，Journal 中 usage 没有 token 字段且不触发压缩 | `NOW` |

## 3. 工具失败契约

工具执行失败是模型需要观察的业务结果，不是 Journal 的调度异常。

```text
tool.call
  → ToolsPlugin 并行执行每个 call
      → 成功：ToolExecution
      → 未知工具：结构化 unknown_tool
      → 工具抛错：结构化 tool_error
  → 一条 tool.result，结果顺序与 calls 一致
  → AgentFlow 发出 llm.request
  → 模型修正调用、重试或向用户解释
```

这与 Android `ToolDispatcher` 的冻结契约一致：dispatcher 不向 core 抛出工具业务异常，而是返回失败结果。CASE1 不承诺批次事务、回滚或 exactly-once。

## 4. 7.3 Projection 复核

`PRJ-01` 和 `PRJ-02` 依赖未来出现第二份 system prompt 或 tool registry。CASE1 当前只在 session 初始化时写入一次，因此没有真实问题，状态均为 `DEFER`，不修改投影接口。

DeepSeek 的历史 tool call 要求 `reasoning_content` 已真实遇到，但它属于 Provider 适配矩阵，当前集中延后处理。其余大工具结果、热装配漂移等也不进入 CASE1。

## 5. 7.4 Provider 复核

当前只处理 usage unknown，并与 `CMP-06` 合并。

- HTTP/TLS 失败继续原样上抛；CASE1 不增加重试；
- SSE error frame、异常 EOF、零参数 function arguments尚未由当前 case 触发，均 `DEFER`；
- UI 流式预览属于外围 adapter，当前不扩展其状态机；
- 不建设“所有 OpenAI-compatible API 自动兼容”的统一层。

## 6. 明确延后

- JSONL 损坏修复、未完成工具副作用恢复和自动续跑；
- UI/CLI 尚未确定的交互边界；
- steering、并发 query、动态插件热安装；
- 工具取消、权限、超时和 exactly-once；
- 无限 session 的分页、索引和有界内存。

这些内容再次由真实场景触发时，再以“轨迹 → 原因 → 所有者 → 最小行为 → 验收测试”的顺序进入本表。
