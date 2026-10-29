# 共享待办

`tasks.read` 读取共享看板。`tasks.batch` 接收 `{"actions":[...]}`，每轮合并最多 20 项。首次在 App 配置服务和密钥；未连接时个人记录仍可使用。请求失败的批次保存在本机，用 `tasks.pending` 查看、`tasks.retry` 原样重试、`tasks.discard` 明确放弃。

只为用户确认的后续行动建卡，讨论中的设想、普通问答不建卡。关联已知 `cardId`；首次关联读取并按目标匹配。同一事项标题改变仍更新原卡；创建使用稳定 `sourceKey`，不靠标题去重。一个聊天的新阶段优先增补原卡的 checklist，不因版本发布重复建卡。

```json
{"actions":[{"action":"upsert_task","args":{"sourceKey":"stable-task-key","title":"发布应用","desc":"任务要求"}},{"action":"upsert_task","args":{"cardId":"existing-id","baseVersion":3,"baseValues":{"desc":"旧说明"},"desc":"新说明"}}]}
```

可改 `title/desc/dueDate/priority/tags/checklist/columnId`。日期为 YYYY-MM-DD 或 null。checklist 项为 `{id,title,done}`，保留原项 ID，新增项追加到数组末尾，App 倒序展示最新项。修改 checklist 先读原数组，保留未变项。

`complete_task` 参数 `cardId/completed/baseVersion/baseValues:{completedAt:旧值}`，只改变完成状态。`move_task` 参数 `cardId/columnId/index`。同字段冲突不自动覆盖，删除的卡片不自动恢复。Codex 新建卡片自动记录 `CODEX_THREAD_ID` 来源；其他客户端仅在有真实聊天链接时传 `sourceChat:{url:实际链接}`。

共享任务只放协作所需内容。个人日记、知识正文和本机文件清单存本地，不复制进卡片。
