pub mod hooks;
pub mod journal;
pub mod knowledge;
pub mod transfer;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub fn now() -> String {
    Utc::now().to_rfc3339()
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
pub fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    let v = text(value, key);
    if v.trim().is_empty() {
        Err(format!("需要填写 {key}").into())
    } else {
        Ok(v)
    }
}
pub fn atomic(path: &Path, body: &[u8]) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("{}.tmp", id()));
    let mut f = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&tmp)?;
    f.write_all(body)?;
    f.sync_all()?;
    fs::rename(tmp, path)?;
    Ok(())
}
pub struct Store {
    pub root: PathBuf,
    pub db: Connection,
}
impl Store {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root)?;
        let db = Connection::open(root.join("records.sqlite"))?;
        db.busy_timeout(Duration::from_secs(5))?;
        db.execute_batch("PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS revisions(kind TEXT,id TEXT,version INTEGER,data TEXT,at TEXT,PRIMARY KEY(kind,id,version));
          CREATE TABLE IF NOT EXISTS conflicts(id TEXT PRIMARY KEY,kind TEXT,target TEXT,data TEXT);
          CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,result TEXT);
          CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
          CREATE TABLE IF NOT EXISTS knowledge(path TEXT PRIMARY KEY,data TEXT);
          CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,data TEXT);")?;
        Ok(Self { root, db })
    }
    pub fn setting(&self, key: &str) -> Result<Value> {
        Ok(self
            .db
            .query_row("SELECT value FROM settings WHERE key=?", [key], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
            .map(|s| serde_json::from_str(&s))
            .transpose()?
            .unwrap_or(Value::Null))
    }
    pub fn set(&self, key: &str, value: &Value) -> Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO settings VALUES(?,?)",
            params![key, value.to_string()],
        )?;
        Ok(())
    }
    pub fn get(&self, table: &str, key: &str) -> Result<Option<Value>> {
        let sql = match table {
            "records" => "SELECT data FROM records WHERE id=?",
            "sessions" => "SELECT data FROM sessions WHERE id=?",
            "knowledge" => "SELECT data FROM knowledge WHERE path=?",
            _ => return Err("无效数据类型".into()),
        };
        self.db
            .query_row(sql, [key], |r| r.get::<_, String>(0))
            .optional()?
            .map(|s| Ok(serde_json::from_str(&s)?))
            .transpose()
    }
    pub fn all(&self, table: &str) -> Result<Vec<Value>> {
        let sql = match table {
            "records" => "SELECT data FROM records",
            "knowledge" => "SELECT data FROM knowledge",
            "sessions" => "SELECT data FROM sessions",
            _ => return Err("无效数据类型".into()),
        };
        let mut stmt = self.db.prepare(sql)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|s| Ok(serde_json::from_str(&s?)?)).collect()
    }
    pub fn put(&self, table: &str, key: &str, value: &Value) -> Result<()> {
        let sql = match table {
            "records" => "INSERT OR REPLACE INTO records VALUES(?,?)",
            "knowledge" => "INSERT OR REPLACE INTO knowledge VALUES(?,?)",
            "sessions" => "INSERT OR REPLACE INTO sessions VALUES(?,?)",
            _ => return Err("无效数据类型".into()),
        };
        self.db.execute(sql, params![key, value.to_string()])?;
        Ok(())
    }
    pub fn revision_key(&self, kind: &str, key: &str) -> Result<String> {
        Ok(if kind == "knowledge" {
            format!("{}::{key}", knowledge::root(self)?.to_string_lossy())
        } else {
            key.to_string()
        })
    }
    pub fn revision(&self, kind: &str, key: &str, v: &Value) -> Result<()> {
        let key = self.revision_key(kind, key)?;
        self.db.execute(
            "INSERT OR IGNORE INTO revisions VALUES(?,?,?,?,?)",
            params![
                kind,
                key,
                v["version"].as_i64().unwrap_or(1),
                v.to_string(),
                now()
            ],
        )?;
        Ok(())
    }
    pub fn conflict(
        &self,
        kind: &str,
        target: &str,
        proposed: &Value,
        current: &Value,
    ) -> Result<Value> {
        let key = id();
        let value = json!({"id":key,"kind":kind,"target":target,"proposed":proposed,"current":current,"createdAt":now()});
        self.db.execute(
            "INSERT INTO conflicts VALUES(?,?,?,?)",
            params![key, kind, target, value.to_string()],
        )?;
        Ok(json!({"status":"conflict","conflict":value}))
    }
    pub fn execute(&self, request: Value) -> Result<Value> {
        let op = required(&request, "op")?;
        if op == "backup.create" {
            return transfer::backup(self);
        }
        if op == "backup.restore" {
            return transfer::restore(self, &request);
        }
        let explicit = text(&request, "requestId");
        let generated = if explicit.is_empty()
            && ["checkpoint.save", "checkpoint.ack"].contains(&op)
            && !text(&request, "checkpointId").is_empty()
        {
            format!("{op}:{}", text(&request, "checkpointId"))
        } else {
            String::new()
        };
        let request_id = if explicit.is_empty() {
            generated.as_str()
        } else {
            explicit
        };
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if !request_id.is_empty() {
                if let Some(result) = self
                    .db
                    .query_row(
                        "SELECT result FROM requests WHERE id=?",
                        [request_id],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()?
                {
                    return Ok(serde_json::from_str(&result)?);
                }
            }
            let result = match op {
                "settings.get" => self.settings(),
                "settings.save" => self.save_settings(&request),
                "journal.list" => journal::list(self, &request),
                "journal.read" => journal::read(self, &request),
                "journal.save" => journal::save(self, &request),
                "journal.delete" => journal::delete(self, &request, false),
                "journal.restore" => journal::delete(self, &request, true),
                "knowledge.search" => knowledge::search(self, &request),
                "knowledge.read" => knowledge::read(self, &request),
                "knowledge.save" => knowledge::save(self, &request),
                "knowledge.delete" => knowledge::delete(self, &request, false),
                "knowledge.restore" => knowledge::delete(self, &request, true),
                "knowledge.refresh" => knowledge::refresh(self),
                "knowledge.asset" => knowledge::asset(self, &request),
                "history" => self.history(&request),
                "conflicts.list" => self.conflicts(),
                "conflicts.resolve" => self.resolve(&request),
                "journal.import" => transfer::import(self, &request),
                "journal.export" => transfer::export(self, &request),

                "checkpoint.ack" => hooks::ack(self, &request),
                "checkpoint.status" => hooks::status(self, &request),
                "checkpoint.save" => hooks::checkpoint_save(self, &request),
                _ => Err(format!("未知操作：{op}").into()),
            }?;
            if !request_id.is_empty() && result["status"] != "failed" {
                self.db.execute(
                    "INSERT INTO requests VALUES(?,?)",
                    params![request_id, result.to_string()],
                )?;
            }
            Ok(result)
        })();
        match result {
            Ok(value) => {
                self.db.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }
    pub fn settings(&self) -> Result<Value> {
        Ok(
            json!({"timezone":self.setting("timezone")?.as_str().unwrap_or("Asia/Shanghai"),"autoRecord":self.setting("autoRecord")?.as_bool().unwrap_or(true),"checkpointMinutes":self.setting("checkpointMinutes")?.as_i64().unwrap_or(60),"knowledgeDir":knowledge::root(self)?.to_string_lossy(),"exportDir":self.setting("exportDir")?,"hidePlaceholders":self.setting("hidePlaceholders")?.as_bool().unwrap_or(true),"dataDir":self.root.to_string_lossy()}),
        )
    }
    fn save_settings(&self, r: &Value) -> Result<Value> {
        if let Some(tz) = r["timezone"].as_str() {
            tz.parse::<chrono_tz::Tz>()
                .map_err(|_| "时区名称无效，例如 Asia/Shanghai")?;
            self.set("timezone", &json!(tz))?;
        }
        if let Some(m) = r["checkpointMinutes"].as_i64() {
            if ![0, 30, 60, 120].contains(&m) {
                return Err("请选择 30、60、120 分钟或仅手动".into());
            }
            self.set("checkpointMinutes", &json!(m))?;
        }
        for key in ["autoRecord", "hidePlaceholders"] {
            if let Some(value) = r.get(key) {
                if !value.is_boolean() {
                    return Err("开关值无效".into());
                }
                self.set(key, value)?;
            }
        }
        if let Some(dir) = r["knowledgeDir"].as_str() {
            let path = PathBuf::from(dir);
            if !path.is_absolute() || !path.is_dir() {
                return Err("请选择存在的知识库目录".into());
            }
            let path = path.canonicalize()?;
            if knowledge::root(self)? != path {
                self.set("knowledgeDir", &json!(path.to_string_lossy()))?;
                self.db.execute("DELETE FROM knowledge", [])?;
                knowledge::refresh(self)?;
            }
        }
        if let Some(dir) = r.get("exportDir") {
            if !dir.is_null() {
                let p = PathBuf::from(dir.as_str().ok_or("导出目录无效")?);
                if !p.is_absolute() || !p.is_dir() {
                    return Err("请选择存在的导出目录".into());
                }
            }
            self.set("exportDir", dir)?;
        }
        self.settings()
    }
    fn history(&self, r: &Value) -> Result<Value> {
        let mut stmt = self
            .db
            .prepare("SELECT data FROM revisions WHERE kind=? AND id=? ORDER BY version DESC")?;
        let rows = stmt.query_map(
            params![
                required(r, "kind")?,
                self.revision_key(required(r, "kind")?, required(r, "id")?)?
            ],
            |row| row.get::<_, String>(0),
        )?;
        Ok(json!(rows
            .map(|v| Ok(serde_json::from_str::<Value>(&v?)?))
            .collect::<Result<Vec<_>>>()?))
    }
    fn conflicts(&self) -> Result<Value> {
        let mut stmt = self
            .db
            .prepare("SELECT data FROM conflicts ORDER BY rowid DESC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        Ok(json!(rows
            .map(|v| Ok(serde_json::from_str::<Value>(&v?)?))
            .collect::<Result<Vec<_>>>()?))
    }
    fn resolve(&self, r: &Value) -> Result<Value> {
        let conflict: String = self.db.query_row(
            "SELECT data FROM conflicts WHERE id=?",
            [required(r, "id")?],
            |row| row.get(0),
        )?;
        let c: Value = serde_json::from_str(&conflict)?;
        if r["choice"] == "local" {
            let mut proposed = c["proposed"].clone();
            if c["kind"] == "knowledge"
                && c["current"]["directory"].as_str()
                    != Some(knowledge::root(self)?.to_string_lossy().as_ref())
            {
                return Err("此修改属于其他知识库，请先切回原目录".into());
            }
            if c["kind"] == "journal" {
                let current = self
                    .get("records", text(&c, "target"))?
                    .ok_or("记录不存在")?;
                if !current["deletedAt"].is_null() && proposed["op"] != "journal.restore" {
                    return Err("记录已删除，请先在回收站恢复".into());
                }
                proposed["baseVersion"] = current["version"].clone();
                for (key, value) in current.as_object().unwrap() {
                    if proposed.get(key).is_some() {
                        proposed["baseValues"][key] = value.clone();
                    }
                }
                if let Some(patches) = proposed["patches"].as_array_mut() {
                    for patch in patches {
                        patch["baseValue"] = json!(journal::section(
                            text(&current, "body"),
                            text(patch, "heading")
                        ));
                    }
                }
                if proposed["op"] == "journal.delete" {
                    journal::delete(self, &proposed, false)?;
                } else if proposed["op"] == "journal.restore" {
                    journal::delete(self, &proposed, true)?;
                } else {
                    journal::save(self, &proposed)?;
                }
            } else {
                let current = knowledge::read(self, &json!({"path":c["target"]}))?;
                proposed["baseBody"] = current["body"].clone();
                proposed["baseVersion"] = current["version"].clone();
                if proposed["op"] == "knowledge.delete" {
                    knowledge::delete(self, &proposed, false)?;
                } else if proposed["op"] == "knowledge.restore" {
                    knowledge::delete(self, &proposed, true)?;
                } else {
                    knowledge::save(self, &proposed)?;
                }
            }
        } else if r["choice"] != "cloud" {
            return Err("请选择 local 或 cloud（当前内容）".into());
        }
        self.db
            .execute("DELETE FROM conflicts WHERE id=?", [text(&c, "id")])?;
        Ok(json!({"status":"resolved"}))
    }
}
pub fn open() -> Result<Store> {
    Store::open(
        dirs::data_local_dir()
            .ok_or("无法找到应用数据目录")?
            .join("dev.gongshi.flowboard"),
    )
}
#[tauri::command]
pub async fn local_request(request: Value) -> std::result::Result<Value, String> {
    static REQUESTS: std::sync::Mutex<()> = std::sync::Mutex::new(());
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = REQUESTS
            .lock()
            .map_err(|_| "本地数据访问已中断，请重开应用")?;
        open()?.execute(request)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn choose_directory() -> std::result::Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .pick_folder()
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn open_path(path: String) -> std::result::Result<(), String> {
    let path = if path.starts_with("~/") {
        dirs::home_dir().ok_or("无法找到用户目录")?.join(&path[2..])
    } else {
        PathBuf::from(path)
    };
    if !path.is_absolute() || !path.exists() {
        return Err("路径不存在".into());
    }
    let status = std::process::Command::new("/usr/bin/open")
        .arg(path)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("无法打开此文件".into())
    }
}
#[cfg(test)]
mod tests;
