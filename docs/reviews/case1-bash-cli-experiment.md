# CASE1：直接 function tools 与单一 bash + CLI 目录对照

日期：2026-09-09

## 目的

验证以下替换是否改变 Journal 业务闭环，并观察真实模型的上下文成本：

- 旧版（`6fd7a65`）：模型直接看到 `bash` 和 8 个 Android function schema；
- 新版：模型只看到一个 `bash` schema，schema 内是固定的紧凑 CLI 目录；
- CLI 的完整 usage 和 example 只在用户 query 命中时写入本轮 `context.dynamic`；
- `bash` 内部解析一条 CLI 命令，再把结构化参数交给对应 Android mock tool。

两次实验使用同一真实模型、同一厂商参数、同一系统提示词、同一五条连续 query。密钥只从仓库外的 Android 配置读取，没有写入本仓库或实验记录。

## 结果

| 指标 | 直接 function tools | bash + CLI | 变化 |
|---|---:|---:|---:|
| 暴露给 LLM 的 function schema | 9 | 1 | -88.9% |
| Journal 事件 | 57 | 57 | 0 |
| LLM 调用 | 8 | 8 | 0 |
| 输入 token | 12,218 | 7,419 | -4,799（-39.3%） |
| 输出 token | 134 | 134 | 0 |
| 五轮累计耗时 | 4,652 ms | 4,446 ms | -206 ms（网络波动下仅供参考） |

| Query | 旧版输入 token | 新版输入 token | 新版调用 |
|---|---:|---:|---|
| 打开手电筒 | 1,320 | 712 | `bash({command: "flash on"})` |
| 把媒体音量调到30% | 2,814 | 1,629 | `bash({command: "sys.volume 30 --stream music"})` |
| 把屏幕亮度调到60% | 3,042 | 1,833 | `bash({command: "sys.brightness 60"})` |
| 把“明天下午三点开会”复制到剪贴板 | 3,271 | 2,081 | `bash({command: 'clip.write "明天下午三点开会"'})` |
| 关闭手电筒 | 1,771 | 1,164 | `bash({command: "flash off"})` |

五轮的工具选择、参数和最终回复均正确。

## Trace 对照

事件类型和数量没有发生变化。首轮包含 session 初始化：

```text
session.start -> system.prompt -> tool.registry
-> user.message -> context.dynamic -> content.request
-> tool.call -> tool.result
-> llm.request -> llm.invoke -> llm.generated -> assistant.message
```

由模型选择工具的中间三轮均为：

```text
user.message -> context.dynamic -> content.request
-> llm.request -> llm.invoke -> llm.generated
-> tool.call -> tool.result
-> llm.request -> llm.invoke -> llm.generated -> assistant.message
```

最后一轮再次由 shortcut 命中，与首轮去掉 session 初始化后的轨迹相同。新旧版本只有事件 payload 不同：

```text
旧 tool.registry: 9 个 function schema
新 tool.registry: 1 个 bash function schema

旧 tool.call: { name: "set_stream_volume", arguments: { percent: "30", stream: "music" } }
新 tool.call: { name: "bash", arguments: { command: "sys.volume 30 --stream music" } }

新 context.dynamic: 仅本轮命中的命令详细 usage/example
```

因此，这次变化只替换了工具插件域里的“模型接口与内部调度方式”，没有增加事件、改变 content source 的优先链，也没有触碰 Journal 内核。

## 当前结论

这个 case 支持当前假设：工具全集适合以固定、紧凑目录保持稳定的 prompt 形状，详细工具知识则按 query 动态注入。至少在本次五轮真实调用中，它以完全相同的 Journal 路径和模型调用次数完成任务，同时显著降低输入 token。

这仍不是对任意规模 CLI 的最终结论。后续扩充命令时，应继续观察紧凑目录本身的增长、动态匹配漏召回，以及模型生成 CLI 的语法错误率；在这些边界实际出现前，不扩展 Journal 内核。
