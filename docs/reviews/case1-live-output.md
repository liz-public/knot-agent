# CASE1 Live Output：瞬态展示不是 Journal 事实

## 结论

流式和非流式生成对 Agent 具有相同语义。模型最终产生的完整内容、工具调用和 usage 才进入 Journal；生成过程中的 token delta 只供人类即时观看，不进入 Journal、上下文、trace 或 session 存储。

```text
语义面：Journal      唯一业务推进通道，保存最终事实
展示面：LiveOutput   可选、只写、瞬态、非权威
装配面：Assembly     把具体 UI adapter 的 LiveOutput 交给 LLM 插件
```

无论是否提供 LiveOutput，同一次生成在 Journal 上都是：

```text
llm.invoke -> llm.generated -> assistant.message | tool.call
```

## 为什么不用 delta 事件

delta 不参与模型下一步决策，也不需要重放。把它事件化会让 Journal、JSONL、trace 和恢复逻辑承受与输出 token 数量成正比的噪声；而当前内核串行 `await` handler，即使在 LLM handler 内 append delta，下游也只能在完整生成结束后收到它，并不能实时显示。

因此不增加 `assistant.delta`、`stream.start`、`stream.next` 或 `stream.end` 事件，也不修改 Journal 的投递语义。

## 接口与职责

`LiveOutput.open(meta)` 为一次生成创建可选的 `LiveChannel`。LLM 插件把 provider 的 typed update 转发给它；provider 不知道 Terminal、TUI、SSE 或 WebSocket。

当前只实现已经存在的两类增量：

- `content`：最终回答的文本预览；
- `reasoning`：思考内容的文本预览。

需要工具进度或行为标签时，再以真实 UI 需求扩展 update 类型，不提前定义。

终端 adapter 同时提供 transient live port 和现有 final output sinks。流式内容是 preview；最终 `assistant.message` 是 commit。若最终内容与已经显示的 preview 字节一致，终端不重复打印。

## 不变量

1. LiveOutput 不暴露 Journal，不能 append 事件或推进业务。
2. 不提供 LiveOutput 时，Agent 功能完整，仅在结束后显示 final。
3. LiveChannel 的断开或异常不能改变生成结果和 Journal；展示是 best-effort。
4. 压缩请求默认不创建展示通道。
5. tool-call 的流式 JSON 碎片只在 provider 内聚合，完整后才形成一条 `tool.call`。
6. 语义 trace 和 JSONL 不记录 delta。首 token 延迟、流速等若有需要，属于独立 telemetry。
7. 取消不是 LiveOutput 的职责，留给 CASE2 定义。

## 验证

CASE1 使用 Slow Mock 证明 update 在 `assistant.message` 产生前可见，并对比开启与关闭 LiveOutput 的完整 Journal 字节等价。OpenAI-compatible provider 另有 SSE 测试，证明多段 reasoning/content 最终只提交一个完整事实。两项验证都不修改 `src/journal.ts`。
