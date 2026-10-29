mod skills;
mod local;
mod connection;
use serde::Serialize;
use tauri::Manager;
use serde_json::{json, Value};
use std::{fs, io::{self, Read}, path::{Path, PathBuf}, time::Duration};

struct AppState { connection: Option<connection::Connection>, client: reqwest::Client }

fn app_state() -> Result<AppState, String> {
    Ok(AppState { connection: connection::load().unwrap_or(None), client: reqwest::Client::builder().timeout(Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())? })
}

#[derive(Serialize)]
struct ApiReply { status: u16, body: String }

async fn send(state: &AppState, path: &str, mut body: Value) -> Result<ApiReply, String> {
    if !path.starts_with("/api/") || path.contains("..") || path.contains('?') { return Err("无效的接口路径".into()); }
    body["protocolVersion"] = json!(4);
    let connection=state.connection.as_ref().ok_or("请先打开 FlowBoard，填写服务地址和共享密钥。")?;
    let response = state.client.post(format!("{}{}", connection.worker_url.trim_end_matches('/'), path))
        .header("X-FlowBoard-Access", &connection.app_token).json(&body).send().await
        .map_err(|_| "暂时无法连接共享空间，请检查地址和网络。".to_string())?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|_| "无法读取同步响应".to_string())?;
    Ok(ApiReply { status, body })
}

#[tauri::command]
async fn api_request(state: tauri::State<'_, AppState>, path: String, body: Value) -> Result<ApiReply, String> {
    send(&state, &path, body).await
}

fn write_private(path: &Path, content: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::io::Write;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let mut file = fs::OpenOptions::new().create(true).truncate(true).write(true).mode(0o600).open(path).map_err(|e| e.to_string())?;
    file.write_all(content).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_backup(data: Value, filename: String) -> Result<String, String> {
    if !filename.starts_with("flowboard-export-") || filename.contains('/') { return Err("无效的备份名称".into()); }
    let path = dirs::download_dir().ok_or("无法找到下载目录")?.join(filename);
    write_private(&path, &serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?)?;
    Ok(path.to_string_lossy().to_string())
}

fn pending_path() -> Result<PathBuf, String> {
    Ok(dirs::data_local_dir().ok_or("无法找到应用数据目录")?.join("dev.gongshi.flowboard/pending.json"))
}

async fn skill_request(state: &AppState, route: &str, data: Value) -> Result<Value, String> {
    let response = send(state, route, data).await?;
    let result: Value = serde_json::from_str(&response.body).map_err(|_| format!("共享空间返回 HTTP {}", response.status))?;
    if response.status >= 400 { return Err(result.to_string()); }
    Ok(result)
}

async fn run_skill(command: &str) -> Result<Value, String> {
    let pending = pending_path()?;
    match command {
        "status" => return Ok(json!({"configured":connection::load()?.is_some(),"pending":pending.exists(),"boardId":"shared"})),
        "pending" => return if pending.exists() { serde_json::from_slice(&fs::read(&pending).map_err(|e| e.to_string())?).map_err(|e| e.to_string()) } else { Ok(json!({"actions":[]})) },
        "discard" => { if pending.exists() { fs::remove_file(pending).map_err(|e| e.to_string())?; } return Ok(json!({"discarded":true})); },
        _ => (),
    }
    let state = app_state()?;
    let current=state.connection.as_ref().ok_or("请先打开 FlowBoard，填写服务地址和共享密钥。")?;
    if command == "read" { return skill_request(&state, "/api/tasks/read", json!({})).await; }
    let payload = match command {
        "batch" => {
            if pending.exists() { return Err("存在未同步操作。先用 pending 查看，再 retry 或 discard。".into()); }
            let mut input = String::new(); io::stdin().read_to_string(&mut input).map_err(|e| e.to_string())?;
            let mut actions: Value = serde_json::from_str(&input).map_err(|e| e.to_string())?;
            if !actions.as_array().is_some_and(|a| !a.is_empty() && a.len() <= 20) { return Err("标准输入需要 1–20 项操作的 JSON 数组。".into()); }
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
            let source = std::env::var("CODEX_THREAD_ID").ok().filter(|id| !id.is_empty() && id != "new" && id.chars().all(|ch|ch.is_ascii_alphanumeric() || ch=='-'))
                .map(|id|json!({"url":format!("codex://threads/{id}")}));
            for (index, action) in actions.as_array_mut().unwrap().iter_mut().enumerate() {
                if !action.is_object() { return Err("每项操作需要 action 和 args。".into()); }
                if action["action"]=="upsert_task" && action["args"].is_object() && action["args"].get("cardId").is_none() && action["args"].get("sourceChat").is_none() {
                    if let Some(ref source)=source {action["args"]["sourceChat"]=source.clone();}
                }
                if action.get("requestId").is_none() { action["requestId"] = json!(format!("{}-{}-{}", std::process::id(), stamp, index)); }
            }
            let payload = json!({"server":current.worker_url,"actions":actions});
            write_private(&pending, &serde_json::to_vec(&payload).map_err(|e| e.to_string())?)?;
            payload
        },
        "retry" => { if !pending.exists() { return Ok(json!({"ok":true,"operations":0})); } serde_json::from_slice(&fs::read(&pending).map_err(|e| e.to_string())?).map_err(|e| e.to_string())? },
        _ => return Err("支持 read、batch、status、pending、retry、discard。".into()),
    };
    if payload["server"].as_str()!=Some(current.worker_url.as_str()) {return Err("待同步批次属于其他服务或没有来源地址。请用 pending 查看，切回原服务处理，或确认内容后重新提交。".into());}
    let result = skill_request(&state, "/api/tasks/batch", payload).await?;
    if result["ok"] != true { return Err("共享空间尚未确认保存，操作已保留。".into()); }
    fs::remove_file(pending).map_err(|e| e.to_string())?;
    Ok(result)
}

fn valid_chat_url(value: &str) -> bool {
    let Ok(url)=reqwest::Url::parse(value) else {return false;};
    if !url.username().is_empty() || url.password().is_some() {return false;}
    let segments:Vec<_>=url.path().trim_matches('/').split('/').collect();
    let identifier=|value:&str| !value.is_empty() && value.chars().all(|c|c.is_ascii_alphanumeric() || c=='-');
    match (url.scheme(),url.host_str()) {
        ("codex",Some("threads"))=>segments.len()==1 && segments[0]!="new" && identifier(segments[0]),
        ("https",Some("chatgpt.com"))=>segments.len()==2 && ["c","share"].contains(&segments[0]) && identifier(segments[1]),
        ("https",Some("claude.ai"))=>segments.len()==2 && segments[0]=="chat" && identifier(segments[1]),
        _=>false,
    }
}

#[tauri::command]
fn open_source_chat(url:String)->Result<(),String>{
    if !valid_chat_url(&url) {return Err("来源聊天链接无效".into());}
    let result=std::process::Command::new("/usr/bin/open").arg(url).status().map_err(|e|e.to_string())?;
    if !result.success() {return Err("无法打开来源聊天，请确认已安装对应应用并使用原聊天的账号或设备。".into());}
    Ok(())
}

#[cfg(test)]
mod source_tests {
    use super::valid_chat_url;
    #[test]
    fn accepts_chat_destinations_only(){
        assert!(valid_chat_url("codex://threads/01a18277-7a1e-7b72-b4ea-392dd9afeaed"));
        assert!(valid_chat_url("https://chatgpt.com/c/1234-abcd"));
        assert!(!valid_chat_url("file:///tmp/task"));
        assert!(!valid_chat_url("codex://threads/new"));
        assert!(!valid_chat_url("https://example.com/c/1234"));
    }
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|a| a == "--xingji") {
        let mut input=String::new();io::stdin().read_to_string(&mut input).expect("Cannot read command input");
        let operation=args.get(2).map(String::as_str).unwrap_or("settings.get");
        let result=(||->local::Result<Value>{
            let mut request:Value=if input.trim().is_empty(){json!({})}else{serde_json::from_str(&input)?};
            if operation=="hook"{let store=local::open()?;store.db.execute_batch("BEGIN IMMEDIATE")?;let result=local::hooks::handle(&store,&request)?;store.db.execute_batch("COMMIT")?;return Ok(result);}
            if ["tasks.read","tasks.batch","tasks.pending","tasks.retry","tasks.discard"].contains(&operation) {
                let runtime=tokio::runtime::Runtime::new()?;
                if operation!="tasks.batch"{return runtime.block_on(run_skill(operation.trim_start_matches("tasks."))).map_err(Into::into);}
                return runtime.block_on(async{
                    let state=app_state()?;let connection=state.connection.as_ref().ok_or("请先连接共享看板")?;
                    let pending=pending_path()?;if pending.exists(){return Err("存在待同步批次，请先 tasks.pending 查看并 retry 或 discard。".into());}
                    let actions=request["actions"].as_array_mut().ok_or("需要 actions 数组")?;if actions.is_empty()||actions.len()>20{return Err("每批需要 1–20 项操作".into());}
                    for action in actions {
                        if action.get("requestId").is_none(){action["requestId"]=json!(local::id());}
                        if action["action"]=="upsert_task" && action["args"].get("cardId").is_none() && action["args"].get("sourceChat").is_none(){if let Ok(thread)=std::env::var("CODEX_THREAD_ID"){let url=format!("codex://threads/{thread}");if valid_chat_url(&url){action["args"]["sourceChat"]=json!({"url":url});}}}
                    }
                    request["server"]=json!(connection.worker_url);write_private(&pending,&serde_json::to_vec(&request).map_err(|e|e.to_string())?)?;
                    let result=skill_request(&state,"/api/tasks/batch",request).await?;if result["ok"]==true{fs::remove_file(pending).map_err(|e|e.to_string())?;}Ok::<_,String>(result)
                }).map_err(Into::into);
            }
            request["op"]=json!(operation);local::open()?.execute(request)
        })();
        match result{Ok(value)=>println!("{}",value),Err(error)=>{eprintln!("{}",json!({"status":"failed","error":error.to_string()}));std::process::exit(1);}}return;
    }
    if args.get(1).is_some_and(|a| a == "--skill") {
        let runtime = tokio::runtime::Runtime::new().expect("Cannot start runtime");
        match runtime.block_on(run_skill(args.get(2).map(String::as_str).unwrap_or("status"))) {
            Ok(value) => println!("{}", serde_json::to_string_pretty(&value).unwrap()),
            Err(error) => { eprintln!("{}", json!({"error":error})); std::process::exit(1); },
        }
        return;
    }
    let state = app_state().expect("Cannot load application connection");
    let mut context = tauri::generate_context!();
    context.config_mut().plugins.0.get_mut("updater").expect("Missing updater config")["endpoints"]=json!(["https://github.com/hyskr/flowboard-macos/releases/latest/download/latest.json"]);
    let builder=tauri::Builder::default()

        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state);
    builder.invoke_handler(tauri::generate_handler![connection::desktop_info, connection::save_connection, api_request, local::local_request, local::choose_directory, local::open_path, skills::integration_status, skills::takeover, skills::install_skill, skills::skill_status, open_source_chat, export_backup])
        .run(context).expect("Cannot start FlowBoard");
}
