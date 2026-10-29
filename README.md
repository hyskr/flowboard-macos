# FlowBoard · 共事

macOS 共享任务看板。界面使用 Tauri 2 打包在应用内，Cloudflare Workers 和 D1 保存共享数据。

## 使用

1. 打开安装包，将 FlowBoard 拖入“应用程序”。
2. 首次打开填写 Cloudflare 服务地址和共享密钥。协作者填写相同配置，进入同一张共享看板。无需注册账号。
3. 在“安装 skill”中选择 Codex 或 Claude Code。新开对话后，已确认的待办及状态变化会按 skill 规则同步。

卡片支持编辑、拖动排序、跨栏目移动和勾选完成。右键卡片或点击三点按钮可打开卡片操作菜单。完成后保留卡片、完成时间和活动记录。离线修改保存在本机，恢复连接后继续同步。操作后自动上传，切回应用时立即同步；前台按设置的间隔检查版本（默认每分钟），后台暂停定时拉取。

## 冲突处理

修改只提交变更字段、卡片版本号和字段编辑前的值。不同卡片或同一卡片不同字段自动合并；同一字段内容不同时保留本地草稿，由用户选择自己的改动或云端内容。完成操作只修改完成状态。拖动采用服务器最后接受的位置并保留记录。已删除卡片的旧编辑会提示已删除，不会自动恢复。

冲突草稿保存在本机，重启应用后仍可处理。App 与 Worker 使用同步协议 4，需要一起发布。

## 访问方式

Cloudflare 仅提供同步接口，不托管网页。每个数据请求都需要共享密钥；安装包不内置生产服务地址或密钥。服务地址保存在应用数据目录，密钥保存在 macOS 钥匙串。设置中可以修改连接，保存后应用重新启动。切换服务会使用各自的本地数据缓存。

skill 通过应用命令复用本机连接，不需要另填密钥、运行后台服务或安装 Python。持有密钥的人也可以直接调用 API；共享密钥不区分个人或设备。更换 Worker 的 `APP_TOKEN` 后，所有设备都需要重新填写。

## 构建与发布

正式安装包由 GitHub Actions 的 **macOS release** 工作流生成，同时发布到私有 Release 和应用内更新通道。推送与配置版本一致的 `v*` tag，或从 Actions 页面手动运行。工作流提供通用 DMG 与签名更新包，Cloudflare Worker 构建产物单独保存为 `cloudflare-worker` artifact。

PR、main 检查和安装包构建不需要生产连接。`TAURI_SIGNING_PRIVATE_KEY` 用于签名更新包；`FLOWBOARD_CONNECTION_JSON` 仅在构建完成后用于上传到维护者的更新服务，不会编译进应用。私有连接和签名密钥不提交到 Git。

设置页显示当前应用版本、App 内置 skill 版本和 Codex／Claude Code 已安装的 skill 版本；同步检查间隔可在每 1 分钟至每 1 小时之间选择，保存在本机。

## 来源聊天与 skill 版本

Codex 创建任务时，应用内置命令自动读取 `CODEX_THREAD_ID`，记录 `codex://threads/<thread-id>` 来源。卡片与详情提供“打开来源聊天”；没有来源的旧卡片不显示入口。后续聊天修改任务时保留原来源。ChatGPT 和 Claude 的实际聊天链接也可以在新任务的 `sourceChat.url` 中明确提供。来源链接不会改变原聊天的账号、设备或访问权限。

应用设置先读取已安装 skill 的版本和协议。版本兼容时直接使用，不重复安装；缺失时提供安装按钮；版本未知、不兼容或文件缺失时提示更新，由用户点击后写入。版本元数据保存在 skill 目录的 `.flowboard-skill.json`，不依赖内容哈希。

## Cloudflare

`wrangler.jsonc` 声明 Worker 和 D1 绑定。部署自己的实例时替换账号与数据库 ID，并设置 `APP_TOKEN`。协作者首次连接时填写此密钥。`UPDATES_URL` 为可选的签名更新服务地址；不提供时禁用应用内更新。

```bash
npm run build:cloud
npx wrangler deploy
npx wrangler secret put APP_TOKEN
```

首次创建数据库使用 `worker/migrations/schema.sql` 初始化。首次通过 `/api/connection/info` 连接时自动创建共享看板，已有看板不变。共享看板 ID 为 `shared`，初始栏目为待办、进行中、已交付。

## 桌面插件

已注册 notification、updater、hot-update、window-state、single-instance 和 process。窗口位置与大小自动恢复；重复启动会激活已有窗口；`--skill` 命令仍独立执行。

设置中的“检查更新”先检查完整应用，再检查界面更新。完整更新由 Tauri 验签后安装，界面更新由 hot-update 验签后暂存；确认重启后生效。应用成功显示后确认界面包就绪，失败的界面包会回退。

## 私有发布与更新

当前 GitHub 仓库和 Release 为私有。1.3.0 起安装包不包含生产连接，可用于自部署分发。此前内置密钥的私有版本仅供原协作者使用。Actions 将完整应用上传到 GitHub Release，同时将签名更新包保存到私有 R2 bucket。独立的 `flowboard-updates` Worker 提供更新接口，并通过 `SHARED_SPACE` service binding 验证应用共享凭证。R2 不开放公开访问。

完整包使用请求头鉴权；界面包使用携带共享凭证的专属地址。更新接口关闭请求 URL 的 invocation logs。所有更新均验证签名；应用不包含 GitHub token 或签名私钥。

GitHub Actions：

- **Desktop checks**：提交到 main 或创建 PR 时，运行行为测试、前端构建和 Rust 检查。
- **macOS release**：推送 `v*` tag 或手动运行，构建 Apple Silicon / Intel 通用应用，发布私有 Release 并更新完整包分发清单。tag 版本应与 `tauri.conf.json` 和 `Cargo.toml` 一致。
- **Frontend hot update**：手动输入界面版本号，构建、签名并上传界面更新。版本号应高于此前界面版本；修改 Rust、权限或原生插件时发布完整应用。

Actions 需要仓库 Secrets：`FLOWBOARD_CONNECTION_JSON` 和 `TAURI_SIGNING_PRIVATE_KEY`。Tauri 公钥在配置中；签名私钥仅保存在本机 private 目录和 GitHub Secret 中，应备份并持续沿用。

更新 Worker 配置在 `wrangler.updates.jsonc`：

```bash
npx wrangler deploy --config wrangler.updates.jsonc
```

## 许可

保留 FlowBoard 原项目的 LGPL-2.1 许可，见 LICENSE。
