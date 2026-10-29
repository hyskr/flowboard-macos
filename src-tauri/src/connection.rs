use security_framework::passwords::{get_generic_password, set_generic_password};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

const KEYCHAIN_SERVICE: &str = "dev.gongshi.flowboard.connection";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    worker_url: String,
    updates_url: Option<String>,
}

pub struct Connection {
    pub worker_url: String,
    pub app_token: String,
    pub updates_url: Option<String>,
}

fn path() -> Result<PathBuf, String> {
    Ok(dirs::data_local_dir()
        .ok_or("无法找到应用数据目录")?
        .join("dev.gongshi.flowboard/connection.json"))
}

fn settings() -> Result<Option<Settings>, String> {
    match fs::read(path()?) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "连接配置无法读取，请重新连接。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn load() -> Result<Option<Connection>, String> {
    let Some(settings) = settings()? else {
        return Ok(None);
    };
    let token = get_generic_password(KEYCHAIN_SERVICE, &settings.worker_url)
        .map_err(|_| "无法读取钥匙串中的共享密钥，请解锁钥匙串或重新连接。".to_string())?;
    let app_token =
        String::from_utf8(token).map_err(|_| "共享密钥无法读取，请重新连接。".to_string())?;
    Ok(Some(Connection {
        worker_url: settings.worker_url,
        updates_url: settings.updates_url,
        app_token,
    }))
}

pub fn endpoint(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value.trim())
        .map_err(|_| "请输入完整的服务地址，例如 https://your-worker.workers.dev".to_string())?;
    let local = url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if (url.scheme() != "https" && !local)
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("服务地址应为 HTTPS 根地址，不包含账号、路径或查询参数。".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

#[tauri::command]
pub fn desktop_info() -> Result<Value, String> {
    let current = settings()?;
    let (configured, error) = match load() {
        Ok(value) => (value.is_some(), None),
        Err(error) => (false, Some(error)),
    };
    Ok(
        json!({"configured":configured,"workerUrl":current.as_ref().map(|c|&c.worker_url),"updatesUrl":current.as_ref().and_then(|c|c.updates_url.as_ref()),"boardId":"shared","error":error}),
    )
}

#[tauri::command]
pub async fn save_connection(
    state: tauri::State<'_, super::AppState>,
    worker_url: String,
    app_token: String,
) -> Result<Value, String> {
    let worker_url = endpoint(&worker_url)?;
    let app_token = app_token.trim();
    if app_token.is_empty() {
        return Err("请输入共享密钥。".into());
    }
    let response = state
        .client
        .post(format!("{worker_url}/api/connection/info"))
        .header("X-FlowBoard-Access", app_token)
        .json(&json!({}))
        .send()
        .await
        .map_err(|_| "无法连接此服务，请检查地址和网络。".to_string())?;
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Err("共享密钥无效，请检查后重试。".into());
    }
    if !response.status().is_success() {
        return Err("连接失败，请检查服务地址、共享密钥和服务端版本。".into());
    }
    let reply: Value = response
        .json()
        .await
        .map_err(|_| "此地址未返回有效的 FlowBoard 连接信息。".to_string())?;
    if reply["boardId"] != "shared" {
        return Err("此地址不是可用的共享看板服务。".into());
    }
    let updates_url = reply["updatesUrl"]
        .as_str()
        .filter(|url| !url.is_empty())
        .map(endpoint)
        .transpose()?;
    set_generic_password(KEYCHAIN_SERVICE, &worker_url, app_token.as_bytes())
        .map_err(|_| "无法保存共享密钥，请允许 FlowBoard 访问系统钥匙串。".to_string())?;
    let settings = Settings {
        worker_url,
        updates_url,
    };
    super::write_private(
        &path()?,
        &serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )?;
    Ok(json!({"saved":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_service_roots_and_keeps_credentials_out_of_metadata() {
        assert_eq!(
            endpoint(" https://example.workers.dev/ ").unwrap(),
            "https://example.workers.dev"
        );
        assert!(endpoint("http://example.com").is_err());
        assert!(endpoint("https://key@example.com").is_err());
        assert!(endpoint("https://example.com/api").is_err());
        assert!(endpoint("https://example.com?key=secret").is_err());
        assert!(endpoint("http://127.0.0.1:8787").is_ok());
        let data = serde_json::to_value(Settings {
            worker_url: "https://example.workers.dev".into(),
            updates_url: None,
        })
        .unwrap();
        assert!(data.get("appToken").is_none());
    }
}
