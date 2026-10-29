# 行记

用共享看板安排事情，用个人开发记录回顾工作，用个人知识库复用方法。

基于 [BraveOPotato/FlowBoard](https://github.com/BraveOPotato/FlowBoard)，使用 Tauri 2、React 和 Rust 构建 macOS 应用。保留 LGPL-2.1 许可。

## 使用

从 [Releases](https://github.com/hyskr/flowboard-macos/releases/latest) 下载通用 macOS 安装包，将「行记」拖入应用程序。展示名称改变，应用标识和数据目录仍为 `dev.gongshi.flowboard`，旧看板数据继续使用。更新后从「行记」启动；旧版本 `FlowBoard.app` 可移出应用程序。

首次启动即可使用个人开发记录和知识库，不需要登录或联网。需要共享任务时，在设置填写 Worker 地址和共享访问密钥。安装包和 Skill 不包含服务密钥。访问密钥保存到 macOS 钥匙串，持有密钥的人也可以调用 API。

### 共享看板

保留新增、编辑、右键操作菜单、拖动排序、自定义栏目、跨栏目移动、勾选完成、划线和完成记录。Checklist 最新追加项显示在上方。

本地操作及时上传；切回应用或恢复网络时检查更新；前台检查间隔可选 1 分钟至 1 小时，后台暂停定时拉取。不同卡片各自保存，同卡不同字段合并；同字段冲突保留本地草稿并选择当前或自己的内容。完成仅修改完成状态，拖动按服务器最后接受的位置并保留记录。删除标记阻止旧请求恢复卡片。

每个空间共用一个密钥，无账号、负责人、成员筛选或单设备撤销。更改 `APP_TOKEN` 后所有设备重新填写。看板可共享，个人正文、本机路径与知识正文不会自动上传。

### 开发记录

每天按聊天分组，下面展示多个阶段。概览直接取正文开头的进展，不产生另一份模型摘要。展开可读完整 Markdown、产物入口和真实来源聊天。

阶段有稳定 ID、版本、发生时间与保存时间。相同请求 ID 重试返回原结果；小补充按章节修改，新功能完成或发布新增阶段。跨天新成果归入新日期，历史时间未知时按记录日期，不推测。不同章节的旧版本补丁可以合并，同章节修改保留待处理内容。删除可撤销，旧请求不重新生成记录。

支持搜索、手动新增、编辑、删除与回收站、历史修订、复制 Markdown、按日期范围导出。SQLite 是开发记录的主存储；可以自动导出到独立目录，该目录由 App 维护。要在 Obsidian 单独编辑，请另导出副本。

### 知识库

可在设置直接选择现有 References 目录，原 Markdown 是正文唯一来源，SQLite 只维护索引。保留代码块、图片、内部链接和旧文件名。支持按标题、用途、主题或正文检索，列表返回少量片段，选择后读取正文或章节。正文提供目录、复制代码和打开原文件入口。

选中知识库时每 30 秒检查外部修改，切回应用时刷新；每次读写前也检查。保存前比较读取的完整原文，发生变化时保留双方内容。默认展示当前版本，可查看历史修订。一个稳定主题维护一个条目，适用版本不同的用法应明确说明。

### 与 Obsidian、Dev Journal 并存

在设置中选择旧开发日记目录导入，不调用模型改写。保留原正文、日期、时间和记录 ID；重复导入跳过，源文件不修改。固定占位记录默认隐藏，可在设置重新显示。知识库直接连接 References，无需导入或重命名。

个人备份包含 SQLite、知识文件、修订和设置。恢复前自动保存当前内容，知识文件恢复到新的本地目录，不覆盖原 Obsidian 文件。共享看板有独立的导出入口。

## 统一 Skill 与 Hook

在设置分别检查 Codex 或 Claude Code 的内置／已安装 Skill 版本。兼容版本保留文件和用户修改，缺失或不兼容才提供安装／更新。仅安装 Skill 不等于自动记录已启用。

`integrations/xingji` 包含短主说明、看板／日记／知识三个参考文件和本机命令。它支持：

- 查：开始相关任务时先搜索知识，匹配后读取正文，已读且未变化的不重复加载。
- 做：把已确认的后续行动写入看板，同事项更新原卡。
- 记：增量保存有价值的成果、研究、排障和决定；长期方法独立维护为完整手册。

「由行记接管自动记录」会备份宿主配置，停用旧 Dev Journal 自动入口、归档旧任务 Skill，写入轻量 Hook。历史记录和旧插件文件保留，不修改插件缓存。Codex 需要在 CLI 的 `/hooks` 中审核并启用新定义；Claude Code 用 `/hooks` 检查。界面区分 Skill 安装与 Hook 配置，不能替代宿主的信任审核。参考 [Codex Hook 规范](https://learn.chatgpt.com/docs/hooks)。

Hook 只保存本会话的精简新增工作线索，默认 60 分钟检查，支持 30／60／120 分钟或仅手动；没有未处理工作就不提醒。压缩前可提前检查。同一检查点只继续一次普通 Stop，写入或明确跳过后推进范围。保存失败保留已生成正文，下一次重试不重新总结。窗口关闭或会话恢复时，待处理范围仍保留。不会在会话结束时另起模型。

自动捕获是尽力完成；侧栏保留「记录当前成果」「整理为知识」的明确指令入口。它们复制指令，供当前 AI 聊天使用，App 不单独调用模型。

### 本机命令

窗口关闭时仍可执行；个人命令不依赖共享服务。JSON 从标准输入读取。也可以使用已安装 Skill 的 `scripts/xingji`。

```bash
'/Applications/行记.app/Contents/MacOS/flowboard' --xingji knowledge.search <<'JSON'
{"query":"Typst 课程报告","limit":5}
JSON
```

操作协议见 [journal.md](integrations/xingji/references/journal.md)、[knowledge.md](integrations/xingji/references/knowledge.md) 和 [tasks.md](integrations/xingji/references/tasks.md)。每项命令独立返回实际结果：日记成功、知识失败、看板待同步可以同时存在。看板失败批次保存在本机，`tasks.pending/retry/discard` 处理。旧 `--skill read/batch/status/pending/retry/discard` 保留。

## 更新与构建

2.0 起应用检查和下载更新使用公开 GitHub Releases 的 `latest.json`，由 Tauri 验签后安装。无需 Cloudflare 分发应用。共享看板仍需要 Cloudflare Workers／D1；个人记录和知识库不需要服务器。

所有正式构建均在 GitHub Actions：

- **Desktop checks**：行为测试、TypeScript／Vite 构建、Rust 本地数据与集成测试。
- **macOS release**：推送与配置版本一致的 `v*` tag，生成 Apple Silicon／Intel 通用 DMG 和签名更新包。

发布需要 `TAURI_SIGNING_PRIVATE_KEY`，公钥随应用发布，私钥保存在维护者 Secrets。无签名密钥时可自行构建不启用自动更新的本地应用。

1.3 升级至 2.0 时，维护者向旧 Cloudflare 更新入口发布一次完整更新；2.0 以后仅用 GitHub 更新。此前内置生产密钥的私有安装包不在公开 Release 中分发。

```bash
npm ci
npm run tauri build -- --target universal-apple-darwin --bundles app,dmg
```

当前安装包未做 Apple 公证。

## 自部署共享看板

替换 `wrangler.jsonc` 中的账号与 D1 ID。初始化数据库使用 `worker/migrations/schema.sql`，然后设置自己的密钥：

```bash
npm ci
npm run build
npx wrangler deploy --config wrangler.jsonc
npx wrangler secret put APP_TOKEN --config wrangler.jsonc
```

服务同时托管网页版与同步 API。网页版首次输入服务地址和共享密钥，验证成功后保存在当前浏览器 localStorage，设置中可退出并清除。静态页面可公开访问，数据请求仍须密钥。macOS 的个人日记和知识库不上传到网页。`/api/connection/info` 验证密钥并在首次连接时创建 `shared` 看板和初始栏目；已有数据不变。App 中填写这个 Worker 地址与密钥即可。原服务的 `UPDATES_URL` 可保留供 1.3 及更早客户端升级，新版不使用它。
