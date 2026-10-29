# dsh-usage-reminder — 技术说明

面向维护者的实现参考（中文）。用户向说明见 [../README.md](../README.md)（中文）/ [../README.en.md](../README.en.md)（English）。

## 一张图看注入位置

一次模型请求由宿主按时间顺序拼出：系统提示词 + 工具 schema + 完整消息历史（跨轮连续）。本插件只在历史尾部追加一条 `user/message`，不改任何已有消息。

```
请求 = [system] 系统提示词（固定）
        [tools ] 工具 schema（请求参数，不在消息里）
        消息历史（按提交时间排序）：
          ... 更早各轮：user → assistant → tool → ...
          本轮 turn N：
            user        用户消息
            user        [宿主内置 runtime-context 快照；内容变化时才有]
            user        [usage-reminder 注入 ← 第 1 步，紧跟用户消息]
            assistant   第 1 步回复 / 工具调用
            tool        第 1 步工具结果
            user        [usage-reminder 注入 ← 第 21 步，历史尾部]
            assistant   第 21 步回复
```

注入消息的 `source.kind = "usage-reminder"`，`role = "user"`，`content` 为一整行文本。它不是 inbox 消息：不唤醒 agent、不新开 turn、不占工具位；只是让下一次请求的历史多一条事实。

## 数据来源

宿主装了 `@deepseek-ai/dsh-token-meter` 时，`ctx.sessionProjections` 里有 `contextPressure` 投影，wire view 形如：

```json
{ "pressureTokens": 361846, "projectedTokens": 361846, "contextWindow": 1000000 }
```

插件通过 `ctx.sessionProjections.snapshot(session, ["contextPressure"]).values` 读取（宿主文档化的 client-visible 读数），只读不写：

- 已用 = `projectedTokens`（下一次请求的 prompt 成本，与界面上下文仪表同口径），缺失时退回 `pressureTokens`；
- 窗口上限 = `contextWindow`（最近一次 `request/context` 记录的模型路由容量）；
- 百分比 = `Math.round(已用 / 上限 * 100)`。

没有测量逻辑、没有额外模型调用、不改 token-meter 的结果。

## 注入文案

2026-10-29 确认的格式：k/M 缩写、整数百分比、不带余额。

```
Context window: 317k / 1M tokens used (32%)
```

格式全部在 `lib/usage-notice.js` 的纯函数里，单测锁定：

- 千位以下原样输出；1000 起四舍五入到 k（`24636` → `25k`，`999999` → `1M`）；百万以上保留一位小数（`1500000` → `1.5M`）。
- 百分比四舍五入到整数；不为 0%/100% 做特殊措辞。
- 取不到已用或窗口时返回 `undefined`，调用方静默跳过（无占位文本）。

## 注入时机

在 `agent/pre-step` waterfall 里判断，`(step - 1) % everySteps === 0`，即每轮第 1、21、41…步；其余步骤直接 `return next()`。

- 每轮第 1 步还要求本轮有真实输入（`payload.messages.length > 0`），避免给一个本来没有输入、不需要发请求的 turn 凭空加请求。
- 数字不可用（会话第一步尚无 `request/context`/usage、或 token-meter 未挂载）时静默跳过。
- `includeSubagents` 控制是否处理 `session.header.origin === "subagent"` 的会话。

## 去重

插件注册一个 host-only 投影 `usageReminder`（无 wire view），从已提交日志折叠"本轮上一次注入的文本"：

- `turn/start` 时清空；
- 遇到 `source.kind === "usage-reminder"` 的 `user/message` 时记录其文本；
- 其余事件返回同一 state 引用（不产生下游工作）。

注入前比较 `formatUsageNotice()` 的结果与 state：文本相同则跳过。因为状态来自会话日志，重新挂载、重启、fork 后规则仍然成立。

## 为什么不写系统提示词

系统提示词任何字节变化都会从第一个差异 token 起废掉整个前缀缓存。尾部追加 user 消息只增长尾部，已缓存前缀全部复用；且 `user/message` 的 `source.kind` 非 `user` 时，Chat UI 走既有的 context-injection 折叠行渲染（`ContextMessageNodeView` → `ContextInjectionRow`，与官方 `time-context` 插件同一路径），不会显示成用户发言。

插件不注册 `systemPrompt.section()` / `systemPrompt.context()`，所以 `system/message` 事件的内容和条数在插件开启前后逐字节一致（验证见下）。

## 代码结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 插件入口：注册 `usageReminder` 去重投影 + `agent/pre-step` 注入监听 |
| `lib/usage-notice.js` | 纯函数：文案、k/M 紧凑格式、整数百分比、注入步进、从日志消息回读文本（无依赖） |
| `test/usage-notice.test.js` | `node --test` 单测 |
| `cordis.patch.yml` | bundle patch：插入 `usage-reminder` 行 |
| `locale/{en,zh}.json` | Plugin Manager 显示名与描述 |
| `icon.svg` | 插件图标 |

## 配置

`cordis.patch.yml` 插入行不带 `config`，两个字段都有默认值。调整时在 profile 的 `cordis.patch.yml` 按 `id: usage-reminder` 覆盖（patch 是整段替换 config，需写全字段）：

```yaml
- id: usage-reminder
  name: '@itstartstosnow/dsh-usage-reminder'
  config:
    everySteps: 20
    includeSubagents: true
```

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `everySteps` | `20` | 同一轮内再次注入的步数间隔；`1` 表示每步都注入 |
| `includeSubagents` | `true` | 是否也向 subagent 会话注入 |

## 兼容性与依赖

- 目标环境：DeepSeek Harness 0.2.1-rc.x（Host 行，无 Client 半）。
- 用到的宿主 API：`ctx.sessionProjections`（register / stateOf / snapshot）、`agent/pre-step` waterfall、`@deepseek-ai/dsh-llm` 的 `createUserMessage`、schemastery `Config`、zod `stateSchema`。
- `package.json` 的 `peerDependencies` 全部标记 optional：只为让 Host 运行时解析器把宿主自带的 `@deepseek-ai/*` 包提供给本插件（linked 安装时必需），不会安装额外副本；profile 里以普通包安装时，运行时会直接把宿主自带的包路由给插件。
- `token-meter` 未挂载时插件不报错，只是永远跳过注入。

## 测试与验证

```sh
npm test    # 9/9
```

0.2.1-rc.3 / macOS 实测（旧四字段文案时期的数据，取值与步进逻辑不受文案影响）：

| 场景 | 结果 |
| --- | --- |
| 长回合 | 第 141、161 步各注入一次（间隔 20）；另在第 21 步观察过一次 |
| 新一轮第一步 | 用户消息之后注入；模型侧确实在上下文里看到该行 |
| 会话第一轮第一步 | 无 `request/context`/usage → 静默跳过 |
| 插件关闭的轮次 | 无注入，对话正常 |
| fork 会话第一步 | 拿不到数据 → 静默跳过 |
| 系统提示词 | 插件安装/启停前后 `system/message` 只有 1 条、字节数与 sha256 不变；新建会话同一系统提示词 |
| turn 数 | 注入不产生额外 turn、不触发回复 |

限制：验证时未能从外部浏览器取 Web GUI 实机截图（GUI 登录 token 只交给 Electron 壳），折叠行渲染结论来自宿主 renderer 源码路径；去重规则中"同值跳过"在真实对话里没有自然可观察场景（每 20 步上下文必然增长），由单测和投影实现保证。

## 已知限制

- 数字是宿主估算（与界面仪表同源），不是 provider billing 级精确值；对"还剩多少"足够。
- 注入发生在 `agent/pre-step`，本轮刚收到、尚未落盘的用户消息不计入数字。
- 不改变压缩策略、不做阈值提醒、不提供仪表盘（界面占用环是宿主自带 / `dsh-usage` 插件的事）。
