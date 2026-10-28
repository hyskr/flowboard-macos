---
name: flowboard-tasks
description: 自动把对话中已确认、需要后续跟进的待办保存到 FlowBoard，并在要求、日期、栏目或完成状态变化时更新原卡片。适用于“就按这个做”“下周交付”“这个做完了”等任务变化；单纯问答、设想和未采纳的建议不建卡。
---

# FlowBoard 任务保存

在正常回复结束前，将本轮已确认的任务变化合并保存。用户无需额外说“记录”。仅在存在任务变化或用户请求看板信息时使用接口；没有变化就继续对话。

## 判断与关联

- 用户明确提出待办，或采纳一个需要后续跟进的行动时建卡。仅问答、当场即可交付的短改写、讨论中的可能性、GPT 单方面提出的下一步不建卡。
- 用户补充要求、调整日期或状态、明确完成时更新原卡。执行成功且已有相关卡片时可以标记完成；计划做、开始做不等于完成。
- 本对话已知的卡片使用原 `cardId`。跨对话或首次关联时读取看板，根据事项的目标和上下文匹配；标题更改仍是原任务。确有歧义才询问用户。
- 新任务给一个稳定 `sourceKey`，如 `website-launch`；本轮重试、后续补充沿用它和返回的 `cardId`。不同事项使用不同标识。优先更新匹配的原卡，不依赖标题自动创建重复卡片。
- 更新已有卡片时，传 `baseVersion`（读取的卡片 `version`，缺省为 0）和 `baseValues`（只包含所改字段在编辑前的值）。说明冲突时保留本地修改并请用户选择；不要自动重新读取版本后强行覆盖。
- 一轮内同一张卡片的多次修改合并成最终值；未变化的字段不发送。同轮多个任务用一个 `batch` 请求提交。

## 使用

入口是本 skill 目录内的 `scripts/flowboard`。它调用已安装的 FlowBoard macOS 应用内置命令，无需 Python、账号或额外连接配置。以下 `<skill-dir>` 替换为本文件所在目录的绝对路径。

应用中点击“安装到 Codex”或“安装到 Claude Code”后即可使用。

读取看板：

```bash
<skill-dir>/scripts/flowboard read
```

保存已合并的任务变化，用标准输入传 JSON，避免 shell 解释正文：

```bash
<skill-dir>/scripts/flowboard batch <<'FLOWBOARD'
[
  {"action":"upsert_task","args":{"sourceKey":"website-launch","title":"发布网站","desc":"完成部署并确认共享访问","dueDate":"2026-11-06"}},
  {"action":"complete_task","args":{"cardId":"existing-card-id","completed":true,"baseVersion":1,"baseValues":{"completedAt":null}}}
]
FLOWBOARD
```

`upsert_task` 更新传 `cardId`；可改 `title`、`desc`、`dueDate`（YYYY-MM-DD 或 null）、`priority`（low/medium/high）、`tags`、`checklist`、`columnId`（null 是待整理）。`move_task` 传 `cardId`、`columnId` 和可选的从 0 开始的 `index`。`complete_task` 的 `completed:false` 重新打开，保留此前记录。

## 成功与未同步

只在接口确认成功后，用一句简短回执说明实际保存结果，例如“已更新「发布网站」：截止日期改为周一。”无变化不提示。

应用不可用时说明未同步，不宣称已保存。请求失败会保留本次批次；用 `pending` 读取未同步操作。下一次相关任务操作时，确认内容仍符合用户最新意图后使用 `retry`；若已被新要求取代，使用 `discard` 后提交最终内容。不要重复循环重试，不运行定时检查，不为保存再启动一个模型。

共享空间已由应用配置，不需要读取或输出访问凭证。上下文压缩摘要保留关联的卡片 ID、sourceKey 和未同步事项。
