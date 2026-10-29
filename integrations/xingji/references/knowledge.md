# 知识使用与维护

`knowledge.search` 输入 `{query:"Typst 课程报告",limit:5}`，先返回标题、用途、关键词和少量片段；再 `knowledge.read` 输入 `{path:"相对文件.md"}`，需要时加 heading 只读某个二级章节。返回 version；本聊天没变化不重复读全文。按适用范围使用前确认真实路径和软件版本。

正文为本机 Markdown 唯一来源，可由 Obsidian 编辑。只有形成跨日期仍有用的方法时生成或更新：安装配置、重复流程、明确的协议架构、带原因和步骤的排障。普通进度和发布状态留在日记。知识保留命令、配置、代码、适用版本、维护步骤，不能只是日记摘要。

先搜索同主题，维护稳定 topic，标题可变，优先修改原章节并保留其他内容。版本适用范围不同时说明差异。更新前读取当前正文，基于原 body 改动：
```json
{"path":"typst-template.md","topic":"typst-template","baseBody":"读取的完整正文","baseVersion":2,"body":"完整的更新后 Markdown","usage":"新建个人 Typst 课程报告","topics":["Typst","模板","课程报告"],"sourceJournalIds":["稳定阶段ID"]}
```

执行 `knowledge.save`。新主题省略 path，由 topic 命名；已有文件保持路径。正文保留原代码块、图片、内部链接。外部文件改变时返回 conflict 并保留待处理修改；删除标记阻止旧请求恢复。App 默认显示当前正文，`history` 传 kind:"knowledge",id:相对路径 查看修订。

同次工作日记记事实，知识写完整做法；不要把同一份完整步骤复制到两处。知识正文和本机路径不上传看板。
