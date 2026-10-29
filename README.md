# dsh-usage-reminder

中文 | [English](README.en.md)

给 agent 的轻量上下文用量提醒，不是账号/套餐用量提醒。

DSH 不会在每轮对话里主动把模型上下文窗口用量注入给模型。模型有时会猜测剩余空间，e.g.，误以为上下文快满了所以偷工减料。本插件会在提示词中增加轻量提醒，告诉 agent 自己用了多少上下文：

```
Context window: 392k / 1M tokens used (39%)
```

❌ 仅关注上下文，不涉及账单、套餐、账号用量等 usage 数据。

适用于 DeepSeek Harness（dsh）0.2.1-rc.x，Host 插件，安装后对所有会话生效。

## 用前 / 用后

用前，模型看不到任何占用数据：

```
你：帮我重构这个模块
模型：（只能靠猜……"我读了不少文件，可能快满了"）
```

用后，你的消息后面多一条可折叠的上下文提示（模型可见，界面上是灰色的"上下文注入"行）：

```
你：帮我重构这个模块
   Context window: 392k / 1M tokens used (39%)   ← 新增，可折叠，不是你说的话
模型：……（知道还有约 60% 空间，可以按原计划做）
```

- 这条提示**不是用户消息**：不用回复、不占工具位、不产生新的对话轮次，只是让模型多知道一个事实。
- 插入位置在历史尾部：你的消息、之前的所有对话、系统提示词都不动。
- 同一轮里如果步骤很长，每 20 步会再补一条最新数字（第 1、21、41…步）；数字与上次完全相同时不重复。
- 拿不到占用数据时（比如会话第一步还没有上次请求的计量）就什么都不做，不会报错或留占位。

## 实现方案（简要）

1. 读取宿主现成的上下文占用（与界面占用环同源），不自己估算、不调模型。
2. 在每轮第一步、以及每 20 步，把「已用 / 上限 / 百分比」追加成一条独立的上下文消息。
3. 不改系统提示词、不改压缩策略、不做阈值提醒、不打断任务。
4. 取不到数字就静默跳过。

更细的接入点、数据字段、去重投影和验证记录见 [doc/technical.md](doc/technical.md)（中文）。

## 性能影响

- 每次注入约 13 token；每 20 步才一条。一个 80 步的长回合大约 4 条，总计不到 60 token。
- 只在对话尾部追加，系统提示词和已有历史的缓存前缀完全复用，不会让整段 prompt 重新计费/重算。
- 非注入步骤只多一次取模判断；没有额外模型请求、没有网络请求、没有可感知延迟。
- 不改变模型行为之外的任何东西：不触发回复、不新增轮次、不占工具。

## 安装

目前尚未发布到 npm。两种本地安装方式任选：

- 桌面端在会话里让 agent 执行：`plugin_manager install_bundle target: <本目录绝对路径>`
- CLI：`dsh plugin --profile <profile 名> install link:<本目录绝对路径>`

安装通常热生效；如果之后修改了本地代码，需要重启一次 DSH 让模块重新加载。发布 npm 之后会改成 `dsh plugin --profile <profile 名> install @itstartstosnow/dsh-usage-reminder`。

## 配置与关闭

默认每 20 步、也覆盖 subagent 会话。要调整就在 profile 的 `cordis.patch.yml` 里按行 id 覆盖：

```yaml
- id: usage-reminder
  name: '@itstartstosnow/dsh-usage-reminder'
  config:
    everySteps: 20
    includeSubagents: true
```

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `everySteps` | `20` | 同一轮内再次注入的步数间隔 |
| `includeSubagents` | `true` | 是否也向子代理会话注入 |

关闭：`plugin_manager set_plugin entryId: include:usage-reminder enabled: false`；彻底移除：`plugin_manager remove_bundle target: @itstartstosnow/dsh-usage-reminder`。

## 已知限制

- 数字是宿主估算（与界面占用环同源），不是 provider 账单级精确值，判断"还剩多少"足够。
- 不含本轮刚发出、尚未写入会话的那条消息本身，所以可能比最终请求略小一点。
- 只影响模型可见的上下文，不改变界面仪表、压缩策略或任何工具行为。

## 许可

MIT，见 [LICENSE](LICENSE)。
