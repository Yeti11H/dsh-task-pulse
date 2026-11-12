# 浪费检测口径与验证边界

阶段 1 只增加纯逻辑引擎和状态字段，不显示告警、不停止 Agent、不注入提示词。检测结果是规则命中的估算，不是“这些调用没有价值”的事实判定。当前没有真实任务标注集，不能报告准确率、召回率或节省比例。

## 实际事件契约

实现前读取了安装的 DSH `0.2.2-rc.2` 类型定义：

- `dsh-session/lib/types/types.d.ts` 的 `SessionEventMap`：回合与步骤携带 `turn`、`step`；工具调用有 `callId`、`name`、原始 JSON 字符串 `arguments`。
- 工具结果的关联字段是 `message.toolCallId`；失败标记是可选的 `message.isError`。外层 `error` 只有 `name`、`code`、可选 `reason`，不能独立代替失败标记。
- `assistant/message` 外层具有可选 `usage`、持久化 `stream`；`assistant/attempt` 没有顶层 usage，表示没有提交 surface message 的尝试。尝试可能产生过片段，不等于模型完全没有输出。
- `dsh-llm/lib/types/types.d.ts` 的 `TokenUsage`：`inputTokens` **已经是非缓存输入**；`outputTokens` 为输出；缓存字段为 `cacheReadTokens`、`cacheWriteTokens`，另有可选 `totalTokens`、`reasoningTokens`。
- `dsh-llm/lib/types/assistant-stream.d.ts`：持久化流使用 `text-chunks`、`reasoning-chunks`、`tool-call-chunks` 或 `chunk`。并对照随包源码确认：首成员时间为 `time0`，之后逐项累加 `dt`，不是把 `dt` 当成绝对时间或从零开始的一一对应数组。
- Client 的临时片段为 `assistant/live-chunk`，具有 `attemptId`、`turn`、`step`、`chunk`。授权审计由 `dsh-user-approval` 扩展，使用 `approval/asked.id` 与 `approval/decided.id` 配对。

上述包只用于核对契约。`src/waste.ts` 与 `src/state.ts` 均不导入 DSH。

## 三条规则

| 规则 | 触发条件 | count 与合并方式 |
| --- | --- | --- |
| R1 | 本轮相同工具名和相同参数哈希出现第 3 次及以后；允许其他调用穿插。 | 首次 count=3，之后每次加 1；每个工具名与参数哈希组合只保留一条。 |
| R2 | 按结果到达顺序，同工具连续第 3 次及以后 `isError === true`；该工具成功即重置连续计数。 | 首次 count=3，继续失败每次加 1；成功后另一段连续失败再次达到阈值时加 3。其他工具的结果不打断该工具的连续失败。每个工具只保留一条。 |
| R3 | 同一步第 2 次及以后 `assistant/attempt`。 | 首次 count=2，之后每次加 1；另一步达到阈值后继续累加到本轮同一条 R3。`toolName=null`，不伪造工具名。 |

`firstAt` 为首次触发所对应的重复组、失败序列或尝试组的首个事件时间，`lastAt` 为最近一次命中时间。R2 的时间取工具结果事件，R3 取尝试结算事件。

每轮最多展示最先触发的 5 条 Finding；已有条目继续累加，后来的新条目不挤掉已有条目。隐藏条目的调用命中仍参与本轮 token 汇总。因此，达到上限时，可见条目金额之和可能小于本轮汇总。

## 参数哈希与隐私

对原始 `arguments` 字符串的 UTF-8 字节计算无符号 32 位 FNV-1a。不解析、重排或格式化 JSON，因此空格、键顺序不同会得到不同指纹。缺少 arguments 时不视为空字符串，不参与 R1。

状态只保留参数哈希、工具名、调用标识、计数、时间和数值 usage，不保存工具参数原文、输出、文件内容、流片段或推理正文。读取流时只提取首片段时间和数值 usage。32 位哈希有碰撞可能，也不是加密；它不能提供抵御枚举的保密性保证。

## 浪费 token 的计算

一个步骤必须同时满足：

1. 已有 `step/end`，或本轮已经 `turn/end`。
2. 至少请求了一个工具。
3. **该步骤每一个工具调用**在发生时命中 R1，或在结果到达时命中 R2。
4. 对应 `assistant/message.usage` 有有效的非负整数 `inputTokens` 和 `outputTokens`。

满足时，步骤的估算浪费量为：

```text
wastedTokens = inputTokens + outputTokens
```

`inputTokens` 已排除缓存，不再减 `cacheReadTokens`，也不把 `cacheWriteTokens` 加入浪费量。`reasoningTokens` 不额外加一次。只判断第 3 次及以后命中的调用，不因为之后达到阈值，就把前两次调用追溯标记为浪费。若一步同时请求了前两次和第三次调用，这一步不满足“所有调用命中”。

混合步骤、没有工具的步骤、缺失有效 usage 的步骤均计 0。缺失 usage 的 Finding 为 `estimated:false`。本引擎将 `estimated` 定义为“至少获得一次符合以上口径的步骤 usage 归因”；因此仅有混合步骤、R3 或尚未结算的命中也保持 false。`estimated:true` 表示使用报告的 usage 作出了规则估算，仍不代表真实浪费已经证实。有效 usage 为零时可以是 true 且浪费量为零。

同一步同时命中多个 Finding 时，只计算一次步骤预算。按 Finding id 稳定排序后均分整数 token，余数逐个分配。R1 与 R2 重叠不重复计费。隐藏条目也参与分配，不把它们的份额转移给可见条目。分配只用于归因展示，不表示不同规则具有同等因果贡献。

R3 本身没有“所有工具命中”的步骤归因依据，所以只报告次数，浪费 token 为 0；不编造空重试的消耗。

## totalTokens 的计算

按步骤汇总已提交的 `assistant/message.usage`，优先采用其 `totalTokens`；缺失时使用：

```text
inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
```

缓存字段缺失视为 0，不额外累加 `reasoningTokens`。同一步重复结算只替换 usage，不把相同 message 重复相加。没有 usage 的消息贡献 0。

对于 `assistant/attempt`，若持久化 stream 中包含 usage 帧，使用最后一帧的汇总计数；多个 usage 帧不相加。若没有，则贡献 0。临时 usage 帧不单独累计，避免它们被持久化结算替换后重复计数。

因此 `totalTokens` 是**已报告、可观测的汇总**，不是模型账单的完整保证。不能将“未报告 usage”解释成确实没有消耗。

## 五项时间

- 等模型：`step/start` 到本步第一个输出 token 片段。没有片段时计到 message 结算、步骤结束或当前已观察到的时间。
- 模型输出：本步第一个片段到 `assistant/message`。尚无 message 时计到步骤结束或当前已观察到的时间。一个步骤内的重试间隔包含在这个粗粒度区间中，没有声称能分离服务端排队和实际生成。
- 工具：`tool/call` 到对应 `tool/result`，所有区间取并集。未结束调用计到本轮结束或当前已观察到的时间。
- 等用户：`approval/asked` 到匹配的 `approval/decided`，多个等待取并集。未决定的请求计到本轮结束或当前已观察到的时间。
- 其他：本轮总时长减去以上四项。

第一个输出片段遵循核对过的 DSH token 定义：非空文本或推理 delta、非空工具参数 delta、带名称的工具 delta；usage、finish、空文本不算。刷新后从持久化 compact stream 恢复时间，状态不依赖临时片段一直存在。

为确保五项互斥，重叠时间的归属优先级为：**等用户 > 工具 > 模型输出 > 等模型**。这会从工具区间中扣除授权等待；并行的两个 10 秒工具只计 10 秒。授权发生在模型区间时也不会重复计算。所有区间裁剪到本轮范围。

已结束回合的总时长为 `turn/end - turn/start`；正常按时序输入时，五项之和与之相等。运行中的回合只计到最新已接受事件，不调用系统时钟，保证纯函数与重放确定性。缺失的历史事件不会凭空补出工具或模型时间；未识别区间归入其他。

## 生命周期与验证

`turn/start` 清空所有检测计数、命中、token、计时及分析元数据。既有的最近活动列表仍按原插件设计保留最多 12 项。分析只接收当前回合；新回合后迟到的旧回合事件不会进入分析。

内部保留本轮的数值步骤、调用及时间区间，用于准确计算区间并集和延迟到达的 usage；空间随本轮元数据数量增长，下一轮清空，不保存跨回合命令历史。显示 5 条的上限不是全部元数据的空间上限。没有长回合性能基准。

单元测试覆盖规则阈值、参数区分、失败重置、每步归因、重复结算、缓存口径、Finding 上限、并行区间、授权扣时、时间守恒、隐私以及刷新和增量事件重放。测试先运行失败，再完成实现。

这些是合成事件与模拟事件源的工程验证，不是真实任务准确率基准，也不是在 rc.1/rc.2 Host 中的浪费检测实测。合法轮询、重复确认、瞬时失败重试均可能命中规则；原始 JSON 格式变化会漏掉语义相同调用；部分历史和缺失 usage 会低估。当前阶段不得据此自动终止任务。
