# 开发记录

自动保存前按需读取一次 `settings.get`；`autoRecord:false` 时只响应用户明确的记录要求。当前聊天已经读取且未变化时不反复检查。

当前对话已经形成的结论是资料来源，不重收集整段工具历史。记录新增的成果、实质研究、排障和决定，不强制字数或固定栏目。概览由 App 从正文取主要进展，无需第二份摘要。

`journal.list` 支持 query/from/to，`journal.read` 传 id。先关联本聊天当天已有阶段；同阶段小补充更新对应段落，新功能完成或发布新版本新增稳定阶段 ID。跨天新成果建新阶段；保存发生时间 `occurredAt` 与保存时间分别记录。无法确定历史时间时省略 occurredAt，由本地日期归档，不猜测。

创建：
```json
{"id":"chat-id:release-2","sessionId":"实际聊天ID","title":"2.0 发布与本地记录","body":"# 实际成果标题\n\n完整成果、决策、步骤和验证。","source":"codex","project":"可选来源名称","sourceChat":"codex://threads/实际ID","artifacts":[{"label":"安装包","path":"/实际路径"}]}
```

执行 `journal.save`，同一请求重试沿用 `requestId`；ID 不随标题改变。支持手动改正文和标题；AI 更新优先传 `patches:[{heading:二级标题或空字符串,baseValue:原段落,value:新段落}]` 和读取的 baseVersion。同阶段其他章节自动保留；同段落冲突返回 conflict。整正文修改需要 baseValues:{body:原正文}。已删除返回 deleted，不重建。

Hook 给出检查点时，使用 `checkpoint.save`：
```json
{"sessionId":"实际聊天ID","checkpointId":"提示中的ID","journal":{"id":"稳定阶段ID","title":"具体成果","body":"已有正文"}}
```

正文写入成功才推进该范围。`checkpoint.ack` 使用相同 sessionId/checkpointId 表示明确跳过。`checkpoint.status` 可读 pending 和 prepared；失败后重试已有 prepared（checkpoint.save 不传 journal），不重新生成。主动保存也使用 checkpoint.save，未有 pending 时推进当前已观察范围。若同时保存知识和看板，分别执行；任一失败不掩盖其他成功。

`journal.delete/restore` 传 id/baseVersion。`history` 传 kind:"journal",id。`conflicts.list` 查看待处理修改，用户决定后 `conflicts.resolve` 传 id 和 choice:"local"（采用待处理）或 "cloud"（保留当前）。
