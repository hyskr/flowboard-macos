use super::*;
use chrono::{DateTime, NaiveDate};
use regex::Regex;

pub fn section(body: &str, heading: &str) -> String {
    let chunks = sections(body);
    chunks
        .iter()
        .find(|(h, _)| h == heading)
        .map(|(_, b)| b.clone())
        .unwrap_or_default()
}
fn sections(body: &str) -> Vec<(String, String)> {
    let mut result = vec![(String::new(), String::new())];
    let mut fence = false;
    for line in body.lines() {
        if line.starts_with("```") || line.starts_with("~~~") {
            fence = !fence;
        }
        if !fence && line.starts_with("## ") {
            result.push((line[3..].trim().to_string(), String::new()));
        } else {
            let b = &mut result.last_mut().unwrap().1;
            b.push_str(line);
            b.push('\n');
        }
    }
    for (_, body) in &mut result {
        *body = body.trim_matches('\n').to_string();
    }
    result
}
fn apply(body: &str, patches: &[Value]) -> Result<String> {
    let mut parts = sections(body);
    for patch in patches {
        let heading = text(patch, "heading");
        let value = required(patch, "value")?;
        if let Some((_, body)) = parts.iter_mut().find(|(h, _)| h == heading) {
            *body = value.trim().to_string();
        } else {
            parts.push((heading.to_string(), value.trim().to_string()));
        }
    }
    Ok(parts
        .into_iter()
        .map(|(h, b)| {
            if h.is_empty() {
                b
            } else {
                format!("## {h}\n\n{b}")
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n"))
}
pub fn read(s: &Store, r: &Value) -> Result<Value> {
    s.get("records", required(r, "id")?)?
        .ok_or_else(|| "找不到记录".into())
}
pub fn list(s: &Store, r: &Value) -> Result<Value> {
    let q = text(r, "query").to_lowercase();
    let hide = s.setting("hidePlaceholders")?.as_bool().unwrap_or(true);
    let mut rows = s
        .all("records")?
        .into_iter()
        .filter(|v| {
            let deleted = !v["deletedAt"].is_null();
            deleted == r["deleted"].as_bool().unwrap_or(false)
                && (!hide || r["deleted"] == true || v["placeholder"] != true)
                && (text(r, "from").is_empty() || text(v, "date") >= text(r, "from"))
                && (text(r, "to").is_empty() || text(v, "date") <= text(r, "to"))
                && (q.is_empty()
                    || ["title", "body", "project"]
                        .iter()
                        .any(|k| text(v, k).to_lowercase().contains(&q)))
        })
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        (text(b, "date"), text(b, "occurredAt"), text(b, "savedAt")).cmp(&(
            text(a, "date"),
            text(a, "occurredAt"),
            text(a, "savedAt"),
        ))
    });
    Ok(json!(rows))
}
pub fn save(s: &Store, r: &Value) -> Result<Value> {
    let key = required(r, "id")?;
    let current = s.get("records", key)?;
    if current.as_ref().is_some_and(|c| !c["deletedAt"].is_null()) {
        return Ok(json!({"status":"deleted","id":key}));
    }
    let mut value=current.clone().unwrap_or_else(||json!({"id":key,"version":0,"deletedAt":null,"body":"","title":"","sessionId":"manual","source":"manual","project":"","sourceChat":null,"artifacts":[],"taskLinks":[],"placeholder":false}));
    if let Some(ref old) = current {
        let stale = r["baseVersion"] != old["version"];
        if stale {
            for field in [
                "title",
                "body",
                "sourceChat",
                "artifacts",
                "taskLinks",
                "project",
            ] {
                if let Some(proposed) = r.get(field) {
                    if proposed != &old[field] && r["baseValues"].get(field) != Some(&old[field]) {
                        return s.conflict("journal", key, r, old);
                    }
                }
            }
            if let Some(patches) = r["patches"].as_array() {
                for patch in patches {
                    if patch["baseValue"].as_str()
                        != Some(section(text(old, "body"), text(patch, "heading")).as_str())
                    {
                        return s.conflict("journal", key, r, old);
                    }
                }
            }
        }
    }
    let saved = now();
    if current.is_none() && text(&value, "sessionId") == "manual" {
        if let Ok(thread) = std::env::var("CODEX_THREAD_ID") {
            value["sessionId"] = json!(thread);
            value["source"] = json!("codex");
            value["sourceChat"] = json!(format!("codex://threads/{thread}"));
        }
    }
    if current.is_none() {
        let occurred = r["occurredAt"].as_str().unwrap_or(&saved);
        let when =
            DateTime::parse_from_rfc3339(occurred).map_err(|_| "发生时间需要带时区的 ISO 时间")?;
        let zone = s
            .setting("timezone")?
            .as_str()
            .unwrap_or("Asia/Shanghai")
            .parse::<chrono_tz::Tz>()?;
        let date = if let Some(date) = r["date"].as_str().filter(|d| !d.is_empty()) {
            NaiveDate::parse_from_str(date, "%Y-%m-%d")?;
            date.to_string()
        } else {
            when.with_timezone(&zone).format("%Y-%m-%d").to_string()
        };
        value["timezone"] = json!(zone.to_string());
        value["date"] = json!(date);
        value["occurredAt"] = json!(occurred);
        value["createdAt"] = json!(saved);
        for field in ["sessionId", "source", "placeholder", "importPath"] {
            if let Some(v) = r.get(field) {
                value[field] = v.clone();
            }
        }
    }
    for field in [
        "title",
        "body",
        "sourceChat",
        "artifacts",
        "taskLinks",
        "project",
    ] {
        if let Some(v) = r.get(field) {
            value[field] = v.clone();
        }
    }
    if let Some(patches) = r["patches"].as_array() {
        value["body"] = json!(apply(text(&value, "body"), patches)?);
    }
    if text(&value, "title").trim().is_empty() || text(&value, "body").trim().is_empty() {
        return Err("标题和正文不能为空".into());
    }
    value["version"] = json!(value["version"].as_i64().unwrap_or(0) + 1);
    value["savedAt"] = json!(saved);
    s.put("records", key, &value)?;
    s.revision("journal", key, &value)?;
    let export = if let Some(dir) = s.setting("exportDir")?.as_str() {
        match super::transfer::export_day(s, Path::new(dir), text(&value, "date")) {
            Ok(()) => json!({"status":"saved"}),
            Err(e) => json!({"status":"failed","error":e.to_string()}),
        }
    } else {
        Value::Null
    };
    Ok(json!({"status":"saved","record":value,"export":export}))
}
pub fn delete(s: &Store, r: &Value, restore: bool) -> Result<Value> {
    let key = required(r, "id")?;
    let mut v = read(s, r)?;
    if r["baseVersion"] != v["version"] {
        return s.conflict("journal", key, r, &v);
    }
    v["deletedAt"] = if restore { Value::Null } else { json!(now()) };
    v["version"] = json!(v["version"].as_i64().unwrap_or(0) + 1);
    v["savedAt"] = json!(now());
    s.put("records", key, &v)?;
    s.revision("journal", key, &v)?;
    if let Some(dir) = s.setting("exportDir")?.as_str() {
        let _ = super::transfer::export_day(s, Path::new(dir), text(&v, "date"));
    }
    Ok(json!({"status":if restore{"restored"}else{"deleted"},"record":v}))
}
pub fn import_file(s: &Store, path: &Path) -> Result<(usize, usize)> {
    let body = fs::read_to_string(path)?;
    let header = Regex::new(r"(?m)^#{2,3} (\d{2}:\d{2}) · (.*?) — (.*?) \^j([\w-]+)\s*$")?;
    let captures = header.captures_iter(&body).collect::<Vec<_>>();
    let mut imported = 0;
    let mut skipped = 0;
    let date_pattern = Regex::new(r"(?m)^(?:date:\s*|##\s+)(\d{4}-\d{2}-\d{2})")?;
    for (i, c) in captures.iter().enumerate() {
        let key = c[4].to_string();
        if s.get("records", &key)?.is_some() {
            skipped += 1;
            continue;
        }
        let before = &body[..c.get(0).unwrap().start()];
        let last_date = date_pattern
            .captures_iter(before)
            .last()
            .map(|c| c[1].to_string());
        let date = path
            .file_stem()
            .and_then(|s| s.to_str())
            .filter(|s| s.len() == 10)
            .or(last_date.as_deref())
            .unwrap_or("");
        if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            skipped += 1;
            continue;
        }
        let end = captures
            .get(i + 1)
            .map(|c| c.get(0).unwrap().start())
            .unwrap_or(body.len());
        let content = body[c.get(0).unwrap().end()..end].trim();
        let zone = s
            .setting("timezone")?
            .as_str()
            .unwrap_or("Asia/Shanghai")
            .parse::<chrono_tz::Tz>()?;
        use chrono::TimeZone;
        let naive =
            chrono::NaiveDateTime::parse_from_str(&format!("{date} {}", &c[1]), "%Y-%m-%d %H:%M")?;
        let occurred = zone
            .from_local_datetime(&naive)
            .earliest()
            .map(|d| d.to_rfc3339())
            .unwrap_or_else(|| now());
        let metadata = Regex::new(r"<!-- (?:ai-development-journal|dev-notes)-meta:(.*?) -->")?
            .captures(content)
            .and_then(|c| serde_json::from_str::<Value>(&c[1]).ok())
            .unwrap_or(json!({}));
        let source = metadata["source"]
            .as_str()
            .unwrap_or(if content.contains("Claude Code") {
                "claude"
            } else if content.contains("Codex") {
                "codex"
            } else {
                "import"
            });
        let session = metadata["session_id"]
            .as_str()
            .or(metadata["sessionId"].as_str())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("import:{}:{}", source, &c[2]));
        let chat=Regex::new(r"(?:codex://threads/[a-zA-Z0-9-]+|https://chatgpt.com/(?:c|share)/[a-zA-Z0-9-]+|https://claude.ai/chat/[a-zA-Z0-9-]+)")?.find(content).map(|m|m.as_str().to_string());
        let placeholder = content.contains("保存了可恢复记录") || content.contains("可恢复检查点");
        let out = save(
            s,
            &json!({"id":key,"title":&c[3],"body":content,"date":date,"occurredAt":occurred,"sessionId":session,"source":source,"sourceChat":chat,"importPath":path.to_string_lossy(),"project":&c[2],"placeholder":placeholder}),
        )?;
        if out["status"] == "saved" {
            imported += 1;
        }
    }
    Ok((imported, skipped))
}
