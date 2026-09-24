# CASE1 CLI 契约与解析边界

> 状态：CASE1 CLI 冻结基线。本文只说明模型可见命令从 Catalog 到 handler 的路径，不设计自动发现、能力协商或远端传输。

## 1. 为什么存在 CLI

CASE1 只向模型暴露一个 `bash` function。模型从动态上下文获得相关 Android 命令的详细用法，再把一条 CLI 字符串交给 `bash`。CLI 是模型与移动端业务工具之间的稳定文本契约；Mock、ADB 和未来远端实现共享同一份契约，只在执行 handler 处分叉。

```text
LLM tool.call(bash, { command })
  -> tokenizer
  -> Catalog lookup
  -> argument binder
  -> ToolDispatcher(toolId, arguments)
  -> selected backend handler
  -> tool.result
```

## 2. 唯一运行时来源

`src/cases/case1/android-tool-catalog.ts` 是运行时 Catalog 的唯一事实来源。每个命令声明：

- `toolId`：Dispatcher 使用的稳定逻辑身份；
- `name`：模型使用的 CLI 命令；
- `summary`、`description`、`keywords`：工具目录和意图匹配信息；
- `arguments`：参数格式、类型、是否必填和字段说明；
- `examples`：符合该声明的少量典型调用。

`docs/case1/android-tool-catalog.metadata.json` 是便于人工逐项审核的快照，不参与运行。快照中的 `usage` 由参数声明推导，不是第二份可独立编辑的协议。

## 3. 参数的两个独立维度

参数格式与值类型互相独立：

| 维度 | 支持范围 | 含义 |
| --- | --- | --- |
| 格式 | `positional` | 按声明顺序绑定的位置参数 |
| 格式 | `flag` | `--name value` 形式的具名参数 |
| 格式 | `switch` | 只有 `--name`，出现即为 `true` |
| 类型 | `text` | 原样交给 handler 的字符串 |
| 类型 | `enum` | Catalog 声明的有限字符串集合 |

带空格的单个值必须使用单引号或双引号，例如：

```text
sms.send 18811026772 "今晚 回家吃饭"
```

不支持每个工具自定义解析器、剩余参数 `<text...>`、二选一表达式或隐式拼接。若一个命令难以用上述规则表达，应先简化命令交互，而不是扩张 parser。

## 4. 三层职责

### 4.1 Tokenizer：只识别 CLI 语法

`parseCliCommand` 只负责：

- 按空白切分 token；
- 处理单/双引号和反斜杠转义；
- 区分位置 token 与 `--flag`；
- 输出命令名、位置参数数组和 flag map。

它不知道 Catalog、Android、参数类型或业务含义。

### 4.2 Binder：把语法绑定到 Catalog

`bindCliArguments` 只负责结构契约：

- 位置参数依声明顺序绑定；
- flag 名称存在；
- 必填参数存在；
- switch 不携带值，普通 flag 必须携带值；
- enum 值属于声明集合；
- 没有多余位置参数。

结构错误统一成为 `bad_arguments`，不会进入 Dispatcher。

Binder 不解析数字、日期、手机号或百分比，也不检查数值范围。

### 4.3 Handler：验证业务值并执行副作用

Handler 收到字符串与布尔值组成的结构化参数后负责：

- 数值转换和范围检查，例如音量 `0-100`；
- 日期、号码、URI 等领域校验；
- 权限、设备状态与 pending state；
- 语义到后端协议的映射，例如 `map.nearby 地铁` 到具体 POI code；
- 调用 Mock、ADB 或远端服务并返回 `ToolExecution`。

业务失败是正常 `tool.result`，不能以异常打断 Journal。

## 5. Usage 的生成规则

`renderUsage` 从命令名和 `arguments` 生成 usage：

```text
required positional  -> <name> 或 <a|b>
optional positional  -> [<name>]
required flag        -> --name <value>
optional flag        -> [--name <value>]
switch               -> [--name]
```

因此不得在 Catalog 里再手写 usage。参数名应直接表达业务含义；取值范围写入 description，只有希望改变模型看到的占位名称时才使用 `label`。

## 6. Catalog 与执行后端的关系

Catalog 不按 Dispatcher 能力裁剪。缺失 handler 时，Dispatcher 返回 `unsupported_tool`，模型据此向用户说明当前环境不支持该能力。这样切换 Mock、ADB 或远端实现不会改变模型看到的意图空间。

后续补齐 CASE1 工具只需要两类修改：

1. 审核或修订 Catalog 契约；
2. 在目标 Dispatcher 中增加与 `toolId`、参数名和返回语义一致的 handler。

不应修改 parser、Journal 插件或动态上下文链路，除非真实业务出现现有参数语法无法表达的新边界。

## 7. 验证标准

- 命令名与 `toolId` 唯一；
- 每个 example 都能通过统一 parser/binder；
- metadata 审核快照与运行时 Catalog 内容一致；
- parser 只报告结构错误；
- handler 单测覆盖业务值校验和副作用结果；
- `npm test` 全量通过。
