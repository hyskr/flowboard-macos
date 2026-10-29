use super::*;
use walkdir::WalkDir;
pub fn import(s:&Store,r:&Value)->Result<Value>{
    let root=PathBuf::from(required(r,"directory")?);if !root.is_dir(){return Err("请选择开发记录目录".into());}
    let mut imported=0;let mut skipped=0;
    for entry in WalkDir::new(root).into_iter().filter_entry(|e|e.file_name()!="References"&&e.file_name()!="bak"){
        let entry=entry?;if !entry.file_type().is_file()||entry.path().extension().and_then(|v|v.to_str())!=Some("md"){continue;}
        let (a,b)=super::journal::import_file(s,entry.path())?;imported+=a;skipped+=b;
    }Ok(json!({"imported":imported,"skipped":skipped}))
}
fn day(rows:&[Value],date:&str)->String{
    let mut out=format!("# {date} 开发记录\n\n");
    for r in rows{out.push_str(&format!("## {} · {}\n\n<!-- xingji:{} -->\n\n{}\n\n",text(r,"occurredAt"),text(r,"title"),text(r,"id"),text(r,"body")));}out
}
pub fn export_day(s:&Store,directory:&Path,date:&str)->Result<()> {
    let rows=super::journal::list(s,&json!({"from":date,"to":date}))?;atomic(&directory.join(format!("{date}.md")),day(rows.as_array().unwrap(),date).as_bytes())
}
pub fn export(s:&Store,r:&Value)->Result<Value>{
    let rows=super::journal::list(s,r)?;let path=dirs::download_dir().ok_or("找不到下载目录")?.join(format!("行记-开发记录-{}.md",Utc::now().format("%Y%m%d-%H%M%S")));
    let mut out=String::new();let mut dates=std::collections::BTreeMap::<String,Vec<Value>>::new();for row in rows.as_array().unwrap(){dates.entry(text(row,"date").into()).or_default().push(row.clone());}
    for (date,rows) in dates.iter().rev(){out.push_str(&day(rows,date));}atomic(&path,out.as_bytes())?;Ok(json!({"path":path.to_string_lossy()}))
}
pub fn backup(s:&Store)->Result<Value>{
    let directory=dirs::download_dir().ok_or("找不到下载目录")?.join(format!("行记-备份-{}",id()));fs::create_dir_all(&directory)?;
    let path=directory.join("records.sqlite");s.db.execute("VACUUM INTO ?",[path.to_str().ok_or("目录名称无效")?])?;
    let source=super::knowledge::root(s)?;if source.exists(){copy_tree(&source,&directory.join("knowledge"))?;}
    atomic(&directory.join("backup.json"),br#"{"format":"xingji","version":1}"#)?;Ok(json!({"path":directory.to_string_lossy()}))
}
fn copy_tree(source:&Path,dest:&Path)->Result<()>{for entry in WalkDir::new(source){let entry=entry?;let target=dest.join(entry.path().strip_prefix(source)?);if entry.file_type().is_dir(){fs::create_dir_all(target)?;}else if entry.file_type().is_file(){fs::copy(entry.path(),target)?;}}Ok(())}
pub fn restore(s:&Store,r:&Value)->Result<Value>{
    let directory=PathBuf::from(required(r,"directory")?);let metadata:Value=serde_json::from_slice(&fs::read(directory.join("backup.json"))?)?;if metadata["format"]!="xingji"||metadata["version"]!=1{return Err("这不是行记备份".into());}
    let path=directory.join("records.sqlite");let probe=Connection::open_with_flags(&path,rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    for table in ["records","revisions","conflicts","requests","settings","knowledge","sessions"]{probe.prepare(&format!("SELECT * FROM {table} LIMIT 1"))?;}drop(probe);
    let previous=backup(s)?;let knowledge=s.root.join(format!("restored-knowledge-{}",id()));if directory.join("knowledge").exists(){copy_tree(&directory.join("knowledge"),&knowledge)?;}else{fs::create_dir_all(&knowledge)?;}
    s.db.execute("ATTACH DATABASE ? AS restored",[path.to_str().ok_or("路径无效")?])?;
    let result=(||{s.db.execute_batch("BEGIN IMMEDIATE")?;for table in ["records","revisions","conflicts","requests","settings","knowledge","sessions"]{s.db.execute_batch(&format!("DELETE FROM main.{table};INSERT INTO main.{table} SELECT * FROM restored.{table};"))?;}s.set("knowledgeDir",&json!(knowledge.to_string_lossy()))?;s.db.execute_batch("COMMIT")?;Ok::<_,Box<dyn std::error::Error+Send+Sync>>(())})();
    if result.is_err(){let _=s.db.execute_batch("ROLLBACK");}let _=s.db.execute_batch("DETACH DATABASE restored");result?;
    Ok(json!({"status":"restored","previousBackup":previous["path"]}))
}
