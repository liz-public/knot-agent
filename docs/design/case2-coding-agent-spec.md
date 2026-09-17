# CASE2：增量构建 Coding Agent

> 状态：CASE2.0～2.4 已验证。
>
> 唯一架构目标：不修改 `src/journal.ts`，通过替换和增加领域插件，把 CASE1 的生成—工具闭环演进为真实 Coding Agent。

## 1. 实施原则

1. 每个阶段只增加一种真实产品行为；
2. 先写端到端轨迹，再确定唯一所有者；
3. 能复用 CASE1 协议和插件时不复制；
4. 未被当前阶段触发的异常、恢复和兼容边界不进入实现；
5. 每阶段必须有真实副作用或可控端口的端到端测试；
6. 每阶段独立提交，完整测试通过后再进入下一阶段。

CASE2 不预先定义通用 Workflow Runtime、状态机 DSL、Signal Bus、服务注册表或新的 AgentLoop。循环仍由事件订阅关系自然形成。

## 2. 阶段总表

| 阶段 | 唯一新增行为 | 明确不做 |
|---|---|---|
| 2.0 | 在真实 cwd 中 read/write/edit/bash，完成修改并验证 | workflow 状态、审批、steering、子智能体 |
| 2.1 | 工具在执行前按策略直接放行、拒绝或通过端口询问；ask 作为工具 | 审批事件握手、超时框架 |
| 2.2 | todo.write 产生状态；下一次模型输入看到最新 todo | TodoStore、通用状态容器 |
| 2.3 | 运行中追加 steering；在事件边界优雅暂停和恢复 | Provider Mid-turn Steering、强制取消 |
| 2.4 | spawn_agent 作为同步工具运行独立子 Journal并返回摘要 | 后台子智能体、fan-out 调度平台 |

## 3. CASE2.0：真实 Coding 闭环

### 3.1 端到端轨迹

```text
user.message
  → context.dynamic(cwd)
  → content.request
  → llm.request
  → llm.invoke
  → llm.generated(toolCalls=[read])
  → tool.call
  → tool.result(file content)
  → llm.request
  → llm.generated(toolCalls=[edit])
  → tool.result(edit result)
  → llm.request
  → llm.generated(toolCalls=[bash tests])
  → tool.result(exitCode/stdout/stderr)
  → llm.request
  → llm.generated(no tools, final text)
  → assistant.message
  → idle
```

没有 `workflow.started/completed/finalizing`。在单用户串行 CASE2.0 中，`submit()` 返回且 Journal idle 就表示本轮完成；模型无工具调用时产生的文本直接交付。

### 3.2 插件与职责

| 插件 | 输入 | 输出 | 唯一职责 |
|---|---|---|---|
| CodingSystemPrompt | session.start | system.prompt | 声明稳定的 coding 行为约束 |
| WorkspaceContext | user.message | context.dynamic | 告诉本轮模型实际 cwd |
| AgentFlow（复用） | user.message/tool.result | content.request/llm.request | 推进生成—工具闭环 |
| Content（复用） | content.request | llm.request | 当前只有必中的 LLM source |
| ContextAssembler（复用） | llm.request | llm.invoke | 从 Journal 重建模型输入 |
| LLM（复用） | llm.invoke | llm.generated/tool.call/assistant.message | 调用模型并规范化完整结果 |
| Tools（复用） | tool.call | tool.result | 管理目录并完整处理一个批次 |
| Output/Trace（复用） | 语义事件/* | 无 | 展示与观察 |

### 3.3 四个工具

| 工具 | 输入 | 输出 |
|---|---|---|
| read | workspace-relative path | UTF-8 content |
| write | path + content | 写入字节数 |
| edit | path + unique oldText + newText | 替换结果；非唯一时返回失败 |
| bash | command | exitCode + stdout + stderr |

所有路径必须解析在 cwd 内。工具业务失败由既有 ToolsPlugin 转成 `tool.result`，不逃逸到 Journal。

### 3.4 验收

测试在临时真实工作区中：

1. 模型读取 `math.js`；
2. 精确增加 `multiply`；
3. 运行真实 `node --test`；
4. 测试通过后返回最终答复；
5. 断言磁盘文件、三批工具事件、四次模型调用和唯一最终回复。

## 4. CASE2.1：审批与 ask

只在工具领域扩展，不增加 Journal 控制循环。

```text
tool.call
  → PermissionPolicy(call)
      → allow：执行
      → deny：返回失败 tool.result
      → ask：await ApprovalPort.request；再执行或返回拒绝
```

`ask` 是普通 ToolDefinition，通过 AskPort 等待答案，答案作为对应 callId 的 `tool.result`。若真实测试没有审计消费需求，不增加 approval.requested/resolved 事件。

## 5. CASE2.2：Todo

`todo.write` 是普通工具，结果通过既有 state 字段记录完整列表：

```text
tool.result.state = { key: 'todo', value: [...] }
```

`tool.result.content` 已经位于后续模型历史中，因此首版不再复制一份 todo 动态上下文；`state` 保留给 Trace、UI 和未来真实折叠需求。首版不让 todo 阻止最终回复，不增加 reminder 或完成状态机。

## 6. CASE2.3：Steering 与暂停

这是第一个真正涉及投递时序的新阶段，必须单独设计和测试。

- running 时的新输入只 append，不重入 drain；
- 下一次模型请求必须同时看到已完成的工具结果和 steering；
- Projection 必须保证 assistant tool_calls 与对应 tool messages 相邻，不能按 Journal 物理顺序机械平铺；
- pause 不取消当前 handler；只在完整 Event 边界阻塞后续处理；
- pause/resume 是运行控制，不写 Journal。

实现前先用可控 Promise 复现：工具执行期间用户追加消息，以及模型生成期间用户追加消息。

## 7. CASE2.4：同步子智能体

`spawn_agent` 是普通工具：

```text
parent tool.call(spawn_agent)
  → factory 创建独立 child Journal
  → child 完成自己的生成—工具闭环
  → child 最终文本成为 parent tool.result
  → parent 继续生成
```

父 Journal 不复制子 Journal 事件；子智能体无后台运行、并行 fan-out 或恢复机制。

## 8. 延后项

- active/finalizing/completed 工作流状态；
- 为最终总结额外调用一次模型；
- plan/investigate/design/implement/verify 状态机；
- follow-up UI 队列；
- JSONL 在途恢复和 exactly-once；
- 动态插件热安装；
- 通用 Provider 兼容矩阵；
- 无限 session 的分页与内存治理。

只有真实 transcript 或测试证明“无这些能力就无法正确完成任务”时，才重新进入设计。
