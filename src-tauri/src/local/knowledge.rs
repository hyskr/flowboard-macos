use super::*;
use regex::Regex;
use walkdir::WalkDir;
pub fn root(s: &Store) -> Result<PathBuf> {
    Ok(s.setting("knowledgeDir")?
        .as_str()
        .map(PathBuf::from)
        .unwrap_or_else(|| s.root.join("knowledge")))
}
fn resolve(s: &Store, value: &str) -> Result<PathBuf> {
    let root = root(s)?;
    fs::create_dir_all(&root)?;
    let root = root.canonicalize()?;
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|p| matches!(p, std::path::Component::ParentDir))
    {
        return Err("知识条目路径必须位于选定目录内".into());
    }
    let full = root.join(path);
    if full.exists() && !full.canonicalize()?.starts_with(&root) {
        return Err("文件不在知识库目录内".into());
    }
    Ok(full)
}
fn content(body: &str) -> &str {
    body.strip_prefix("---\n")
        .and_then(|s| s.split_once("\n---\n"))
        .map(|(_, body)| body)
        .unwrap_or(body)
}
fn meta(body: &str, path: &str) -> Value {
    let front = body
        .strip_prefix("---\n")
        .and_then(|s| s.split_once("\n---"))
        .and_then(|(h, _)| serde_yaml::from_str::<Value>(h).ok())
        .unwrap_or(json!({}));
    let title = front["title"]
        .as_str()
        .or_else(|| body.lines().find_map(|l| l.strip_prefix("# ")))
        .unwrap_or(path)
        .to_string();
    let headings = body
        .lines()
        .filter_map(|l| l.strip_prefix("## "))
        .map(|s| json!(s))
        .collect::<Vec<_>>();
    let topics = front["topics"]
        .as_array()
        .cloned()
        .unwrap_or_else(|| headings.iter().take(6).cloned().collect());
    let usage = front["usage"]
        .as_str()
        .or_else(|| {
            content(body).lines().find(|l| {
                !l.trim().is_empty()
                    && !l.starts_with(['#', '-', '<', '`', '*'])
                    && !l.contains(": ")
            })
        })
        .unwrap_or("")
        .to_string();
    json!({"title":title,"topic":front["topic"].as_str().unwrap_or(path),"topics":topics,"usage":usage,"project":front["project"].as_str().unwrap_or(""),"headings":headings,"sourceJournalIds":front["sourceJournalIds"].as_array().cloned().unwrap_or_else(||Regex::new(r"\^j([a-zA-Z0-9-]+)").unwrap().captures_iter(body).map(|c|json!(&c[1])).collect())})
}
pub fn refresh(s: &Store) -> Result<Value> {
    let root = root(s)?;
    fs::create_dir_all(&root)?;
    let mut present = std::collections::HashSet::new();
    let mut changed = 0;
    for entry in WalkDir::new(&root).into_iter().filter_entry(|e| {
        e.file_name() != ".xingji-trash" && !e.file_name().to_string_lossy().starts_with('.')
    }) {
        let entry = entry?;
        if !entry.file_type().is_file()
            || entry.path().extension().and_then(|s| s.to_str()) != Some("md")
        {
            continue;
        }
        let path = entry
            .path()
            .strip_prefix(&root)?
            .to_string_lossy()
            .to_string();
        present.insert(path.clone());
        let body = fs::read_to_string(entry.path())?;
        let current = s.get("knowledge", &path)?;
        if current
            .as_ref()
            .is_some_and(|c| text(c, "body") == body && c["deletedAt"].is_null())
        {
            let mut indexed = current.unwrap();
            let metadata = meta(&body, &path);
            for (key, value) in metadata.as_object().unwrap() {
                indexed[key] = value.clone();
            }
            s.put("knowledge", &path, &indexed)?;
            continue;
        }
        let previous = if let Some(ref c) = current {
            c["version"].as_i64().unwrap_or(0)
        } else {
            s.db.query_row(
                "SELECT COALESCE(MAX(version),0) FROM revisions WHERE kind='knowledge' AND id=?",
                [s.revision_key("knowledge", &path)?],
                |r| r.get::<_, i64>(0),
            )?
        };
        let mut value = meta(&body, &path);
        value["directory"] = json!(root.to_string_lossy());
        value["path"] = json!(path);
        value["body"] = json!(body);
        value["version"] = json!(previous + 1);
        value["deletedAt"] = Value::Null;
        value["updatedAt"] =
            json!(chrono::DateTime::<Utc>::from(entry.metadata()?.modified()?).to_rfc3339());
        s.put("knowledge", &path, &value)?;
        s.revision("knowledge", &path, &value)?;
        changed += 1;
    }
    for mut value in s.all("knowledge")? {
        let key = text(&value, "path").to_string();
        if !present.contains(&key) && value["deletedAt"].is_null() {
            value["deletedAt"] = json!(now());
            value["version"] = json!(value["version"].as_i64().unwrap_or(0) + 1);
            s.put("knowledge", &key, &value)?;
            s.revision("knowledge", &key, &value)?;
        }
    }
    Ok(json!({"changed":changed}))
}
pub fn search(s: &Store, r: &Value) -> Result<Value> {
    refresh(s)?;
    let q = text(r, "query").to_lowercase();
    let tokens = q.split_whitespace().collect::<Vec<_>>();
    let mut values = s
        .all("knowledge")?
        .into_iter()
        .filter(|v| (!v["deletedAt"].is_null()) == r["deleted"].as_bool().unwrap_or(false))
        .filter_map(|mut v| {
            let title = format!(
                "{} {} {} {}",
                text(&v, "title"),
                text(&v, "usage"),
                v["topics"],
                text(&v, "path")
            )
            .to_lowercase();
            let body = text(&v, "body").to_lowercase();
            if !tokens.iter().all(|t| title.contains(t) || body.contains(t)) {
                return None;
            }
            let score = tokens.iter().filter(|t| title.contains(**t)).count();
            v["snippet"] = json!(content(text(&v, "body"))
                .lines()
                .filter(|l| tokens.iter().any(|t| l.to_lowercase().contains(t)))
                .take(3)
                .collect::<Vec<_>>()
                .join("\n")
                .chars()
                .take(600)
                .collect::<String>());
            v.as_object_mut().unwrap().remove("body");
            Some((score, v))
        })
        .collect::<Vec<_>>();
    values.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| text(&b.1, "updatedAt").cmp(text(&a.1, "updatedAt")))
    });
    let limit = r["limit"].as_u64().unwrap_or(100) as usize;
    Ok(json!(values
        .into_iter()
        .take(limit)
        .map(|(_, v)| v)
        .collect::<Vec<_>>()))
}
pub fn read(s: &Store, r: &Value) -> Result<Value> {
    refresh(s)?;
    let path = required(r, "path")?;
    let mut v = s.get("knowledge", path)?.ok_or("找不到知识条目")?;
    if let Some(heading) = r["heading"].as_str() {
        v["body"] = json!(super::journal::section(text(&v, "body"), heading));
    }
    Ok(v)
}
pub fn save(s: &Store, r: &Value) -> Result<Value> {
    refresh(s)?;
    let topic = required(r, "topic")?;
    let existing = s
        .all("knowledge")?
        .into_iter()
        .find(|v| v["topic"] == topic);
    let path = if let Some(path) = r["path"].as_str() {
        path.to_string()
    } else if let Some(v) = &existing {
        text(v, "path").to_string()
    } else {
        if topic.contains('/') || topic.contains("..") {
            return Err("新主题标识不能包含路径".into());
        }
        format!("{topic}.md")
    };
    let current = s.get("knowledge", &path)?;
    if let Some(ref current) = current {
        if !current["deletedAt"].is_null() {
            return Ok(json!({"status":"deleted","path":path}));
        }
        if r["baseBody"].as_str() != Some(text(current, "body")) {
            return s.conflict("knowledge", &path, r, current);
        }
    }
    let body = required(r, "body")?;
    let full = resolve(s, &path)?;
    if let Some(ref old) = current {
        if fs::read_to_string(&full)? != text(old, "body") {
            return s.conflict("knowledge", &path, r, old);
        }
    }
    atomic(&full, body.as_bytes())?;
    refresh(s)?;
    let mut value = s.get("knowledge", &path)?.ok_or("索引未更新")?;
    value["topic"] = json!(topic);
    for field in ["title", "usage", "topics", "project", "sourceJournalIds"] {
        if let Some(v) = r.get(field) {
            value[field] = v.clone();
        }
    }
    s.put("knowledge", &path, &value)?;
    // The Markdown frontmatter keeps discovery fields available after rebuilding the index.
    let original = fs::read_to_string(&full)?;
    let (mut front, mut content) = if let Some((header, content)) = original
        .strip_prefix("---\n")
        .and_then(|s| s.split_once("\n---\n"))
    {
        (
            serde_yaml::from_str::<Value>(header).unwrap_or(json!({})),
            content.trim_start().to_string(),
        )
    } else {
        (json!({}), original.clone())
    };
    for key in ["title", "topic", "usage", "topics", "sourceJournalIds"] {
        if let Some(v) = value.get(key) {
            front[key] = v.clone();
        }
    }
    if let Some(title) = r["title"].as_str().filter(|v| !v.trim().is_empty()) {
        content = Regex::new(r"(?m)^# [^\n]+$")?
            .replace(&content, format!("# {title}"))
            .to_string();
    }
    let complete = format!("---\n{}---\n\n{}", serde_yaml::to_string(&front)?, content);
    if complete != original {
        atomic(&full, complete.as_bytes())?;
        value["body"] = json!(complete);
        s.put("knowledge", &path, &value)?;
    }
    s.db.execute(
        "INSERT OR REPLACE INTO revisions VALUES('knowledge',?,?,?,?)",
        params![
            s.revision_key("knowledge", &path)?,
            value["version"].as_i64().unwrap_or(1),
            value.to_string(),
            now()
        ],
    )?;
    Ok(json!({"status":"saved","record":value}))
}
pub fn delete(s: &Store, r: &Value, restore: bool) -> Result<Value> {
    let key = required(r, "path")?;
    let value = read(s, r)?;
    if r["baseVersion"] != value["version"] {
        return s.conflict("knowledge", key, r, &value);
    }
    let full = resolve(s, key)?;
    let trash = root(s)?.join(".xingji-trash").join(key);
    if restore {
        if full.exists() {
            return Err("原路径已有文件，请先处理同名内容".into());
        }
        if let Some(p) = full.parent() {
            fs::create_dir_all(p)?;
        }
        fs::rename(trash, &full)?;
    } else {
        if let Some(p) = trash.parent() {
            fs::create_dir_all(p)?;
        }
        fs::rename(full, trash)?;
    }
    refresh(s)?;
    Ok(json!({"status":if restore{"restored"}else{"deleted"}}))
}
pub fn asset(s: &Store, r: &Value) -> Result<Value> {
    let root = root(s)?;
    let raw = Path::new(required(r, "path")?);
    if raw.is_absolute() {
        return Err("图片路径应相对于知识库".into());
    }
    let path = root.join(raw).canonicalize()?;
    let allowed = root
        .ancestors()
        .find(|p| p.join(".obsidian").is_dir())
        .unwrap_or(&root);
    if !path.starts_with(allowed.canonicalize()?) {
        return Err("图片不在知识库或 Obsidian 库内".into());
    }
    let extension = path.extension().and_then(|p| p.to_str()).unwrap_or("");
    let mime = match extension {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return Err("不支持的图片格式".into()),
    };
    use base64::Engine;
    Ok(json!(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(fs::read(path)?)
    )))
}
