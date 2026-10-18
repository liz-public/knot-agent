# 装配、检查与入口边界

本轮只收敛已出现的边界，不修改 Journal 内核，不创建新的 Manifest、Manager 或插件总线。

## 职责和依赖

| 所有者 | 内容 | 消费者 |
|---|---|---|
| Journal | 追加、读取、按注册顺序投递事实 | 所有插件 |
| Agent 通用契约 | 通用事件、模型输出、Ask/审批端口 | Case 与入口 |
| Device 契约 | 原生设备能力调用端口 | 设备相关 Case 与 Host 设备桥 |
| Case 领域 | 提示词、CLI Catalog、流程、业务参数与结果 | 该 Case 的装配和执行后端 |
| 执行后端 | Mock、ADB、原生设备的实际操作 | 该 Case 的工具 |
| Case 装配 | 安装插件、追加 seed、持有 drain 与执行资源 | CLI、Workbench 等入口 |
| Workbench | 选择 Assembly、绑定外部资源、排队用户输入、处理交互和观测 | Web、手机等客户端 |

入口可以了解多个 Case，插件不能依赖入口。设备端口不属于 CASE1 私有实现；通用 Agent 协议不吸收某个手机业务的专属 payload。ADB 与原生执行器共用的 App 目标和 URI 构造属于领域函数，不应通过导入对方的 handler 来复用。

## 定义只有一个来源

- CASE1 的命令描述、参数、usage 和 intent 来自 `android-tool-catalog.ts`。审核 JSON 是受测试约束的快照。
- Mock、ADB、原生设备使用同一目录。Dispatcher 不过滤目录；缺少 handler 返回明确的不支持结果，不能改变模型可见的意图空间。
- 工具的 Schema 与执行代码在同一工具模块中维护。检查面读 Schema，不构造假 Provider、假 Ask、假子 Agent 或命令执行资源。
- 插件的订阅/产出声明与创建函数放在同一声明中，并通过测试核对实际订阅。没有 Prompt、工具的 Assembly 合法，但有这些插件却描述为空是不正确的。
- Catalog 描述可装配的能力，不是每个 Session 的权限或启用状态。具体 Session 的实际工具集来自 `tool.registry`；例如没有绑定子 Agent 工厂时，不注册 `spawn_agent`。

## 配置与控制

装配期绑定 Provider Resolver、设备端口、Ask/审批及展示端口；运行时配置事实来自 Journal。密钥、连接和进程资源不因此进入 Journal。

默认配置是入口的建议，pending 是尚未提交的用户选择，Journal 配置是已生效事实：生命周期不同，不应通过删除其中某一层来假装消除重复来源。

只有装配层持有 `runUntilIdle`。启动、提交、重命名共用同一个 drain；并发提交在入口边界明确拒绝。Host 不自行推进业务步骤。暂停请求、业务实际暂停和发送队列是不同职责，不能把它们强行折叠成一个变量。

## 本轮明确不扩展

- 不改变审批对象、Ask 的交互端口，不把交互改成 Journal 握手。
- 不处理失败轮次恢复、悬空工具调用、插话的不同业务语义，留待对应边界方案确认。
- 不改 Subagent 类型归属、LLM 的 `commitAssistantMessage`、双 JSONL 读模型。
- 不统一所有 Case 为一个 BaseAgent，不把只被 CASE2 使用的命令资源抽到通用层。
- 不修改前端，不更改云端鉴权、安全沙箱、业务执行成功与否的判定。
