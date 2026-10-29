use serde_json::{json,Value};
use std::{fs,path::{Path,PathBuf}};
const MANIFEST:&str=include_str!("../../integrations/xingji/manifest.json");
fn home(target:&str)->Result<PathBuf,String>{let home=dirs::home_dir().ok_or("无法找到用户目录")?;match target{"codex"=>Ok(std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or(home.join(".codex"))),"claude"=>Ok(home.join(".claude")),_=>Err("请选择 Codex 或 Claude Code".into())}}
fn root(target:&str)->Result<PathBuf,String>{Ok(home(target)?.join("skills/xingji"))}
fn version(v:&str)->Option<[u64;3]>{v.split('.').map(str::parse).collect::<Result<Vec<_>,_>>().ok()?.try_into().ok()}
fn status_at(root:&Path)->Result<Value,String>{
 let bundled:Value=serde_json::from_str(MANIFEST).map_err(|e|e.to_string())?;let installed=fs::read(root.join(".xingji-skill.json")).ok().and_then(|b|serde_json::from_slice::<Value>(&b).ok());
 let complete=["SKILL.md","agents/openai.yaml","scripts/xingji","references/tasks.md","references/journal.md","references/knowledge.md"].iter().all(|f|root.join(f).is_file());
 let compatible=installed.as_ref().is_some_and(|v|complete&&v["protocolVersion"]==bundled["protocolVersion"]&&v["version"].as_str().and_then(version).zip(bundled["minimumVersion"].as_str().and_then(version)).is_some_and(|(a,b)|a>=b));
 Ok(json!({"status":if compatible{"compatible"}else if root.join("SKILL.md").exists(){"update_required"}else{"missing"},"path":root.to_string_lossy(),"version":installed.as_ref().and_then(|v|v["version"].as_str()),"bundledVersion":bundled["version"],"protocolVersion":4}))
}
fn install_at(root:&Path,launcher:&str,update:bool)->Result<Value,String>{
 let current=status_at(root)?;if current["status"]=="compatible"||current["status"]=="update_required"&&!update{return Ok(current);}
 for (name,body) in [
  ("SKILL.md",include_str!("../../integrations/xingji/SKILL.md")),("agents/openai.yaml",include_str!("../../integrations/xingji/agents/openai.yaml")),
  ("references/tasks.md",include_str!("../../integrations/xingji/references/tasks.md")),("references/journal.md",include_str!("../../integrations/xingji/references/journal.md")),("references/knowledge.md",include_str!("../../integrations/xingji/references/knowledge.md")),("scripts/xingji",launcher),(".xingji-skill.json",MANIFEST)]{super::write_private(&root.join(name),body.as_bytes())?;}
 use std::os::unix::fs::PermissionsExt;fs::set_permissions(root.join("scripts/xingji"),fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?;let mut result=status_at(root)?;result["status"]=json!("installed");Ok(result)
}
#[tauri::command]
pub fn skill_status(target:String)->Result<Value,String>{status_at(&root(&target)?)}
#[tauri::command]
pub fn install_skill(target:String,update:Option<bool>)->Result<Value,String>{
 let exe=std::env::current_exe().map_err(|e|e.to_string())?;let exe=exe.to_string_lossy().replace('\'',"'\\''");
 let launcher=format!("#!/bin/sh\nAPP='/Applications/行记.app/Contents/MacOS/flowboard'\nif [ ! -x \"$APP\" ]; then APP='{exe}'; fi\nexec \"$APP\" --xingji \"$@\"\n");install_at(&root(&target)?,&launcher,update.unwrap_or(false))
}
fn hook_command(target:&str)->Result<String,String>{let path=root(target)?.join("scripts/xingji");Ok(format!("'{}' hook",path.to_string_lossy().replace('\'',"'\\''")))}
fn backup(path:&Path)->Result<(),String>{if path.exists(){let target=path.with_extension(format!("xingji-backup-{}",chrono::Utc::now().format("%Y%m%d-%H%M%S")));fs::copy(path,target).map_err(|e|e.to_string())?;}Ok(())}
#[tauri::command]
pub fn integration_status(target:String)->Result<Value,String>{
 let base=home(&target)?;let path=base.join(if target=="codex"{"config.toml"}else{"settings.json"});let config=fs::read_to_string(&path).unwrap_or_default();
 let hooks_configured=config.contains(&hook_command(&target)?);let old_skill=base.join("skills/flowboard-tasks").exists();
 let old_plugin=if target=="codex"{config.parse::<toml_edit::DocumentMut>().ok().and_then(|d|d["plugins"]["ai-development-journal@personal"]["enabled"].as_bool()).unwrap_or(false)}else{config.contains("ai-development-journal")||config.contains("journal.py")};
 let hook_trusted=if target=="codex"{Value::Null}else{json!(hooks_configured)};
 Ok(json!({"skill":status_at(&root(&target)?)?,"hooksConfigured":hooks_configured,"hookVersion":if hooks_configured{Some("1.0.0")}else{None},"hooksTrusted":hook_trusted,"oldTaskSkill":old_skill,"oldJournalEnabled":old_plugin,"configPath":path.to_string_lossy(),"reviewInstructions":if target=="codex"{"在 Codex CLI 运行 /hooks，审核并启用行记命令。安装文件不会代替宿主信任审核；重开聊天后生效。"}else{"重启 Claude Code，使用 /hooks 检查行记命令。"}}))
}
#[tauri::command]
pub fn takeover(target:String)->Result<Value,String>{
 let base=home(&target)?;let command=hook_command(&target)?;let events=["PostToolUse","Stop","PreCompact","SessionStart","UserPromptSubmit"];
 if target=="codex" {
  let path=base.join("config.toml");backup(&path)?;let mut config=fs::read_to_string(&path).unwrap_or_default().parse::<toml_edit::DocumentMut>().map_err(|e|e.to_string())?;
  if let Some(plugins)=config["plugins"].as_table_mut(){for (name,plugin) in plugins.iter_mut(){if name.starts_with("ai-development-journal@"){plugin["enabled"]=toml_edit::value(false);}}}
  for event in events {
   // Keep unrelated hooks and hook state untouched.
   let item=&mut config["hooks"][event];
   if let Some(groups)=item.as_array_of_tables_mut(){groups.retain(|group|!group.to_string().contains("scripts/xingji"));let mut handler=toml_edit::Table::new();handler["type"]=toml_edit::value("command");handler["command"]=toml_edit::value(&command);handler["timeout"]=toml_edit::value(5);let mut handlers=toml_edit::ArrayOfTables::new();handlers.push(handler);let mut group=toml_edit::Table::new();group["hooks"]=toml_edit::Item::ArrayOfTables(handlers);groups.push(group);}
   else{let mut groups=item.as_array().cloned().unwrap_or_default();groups.retain(|v|!v.to_string().contains("scripts/xingji"));let mut handler=toml_edit::InlineTable::new();handler.insert("type","command".into());handler.insert("command",command.clone().into());handler.insert("timeout",5_i64.into());let mut handlers=toml_edit::Array::new();handlers.push(handler);let mut group=toml_edit::InlineTable::new();group.insert("hooks",handlers.into());groups.push(group);*item=toml_edit::value(groups);}
  }
  super::write_private(&path,config.to_string().as_bytes())?;
 }else{
  let path=base.join("settings.json");backup(&path)?;let mut config:Value=if path.exists(){serde_json::from_slice(&fs::read(&path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?}else{json!({})};
  if let Some(hooks)=config["hooks"].as_object_mut(){for (_,groups) in hooks.iter_mut(){if let Some(groups)=groups.as_array_mut(){for group in groups.iter_mut(){if let Some(handlers)=group["hooks"].as_array_mut(){handlers.retain(|h|{let c=h["command"].as_str().unwrap_or("");!c.contains("ai-development-journal")&&!c.contains("journal.py")&&!c.contains("scripts/xingji")});}}groups.retain(|g|g["hooks"].as_array().is_some_and(|a|!a.is_empty()));}}}
  if !config["hooks"].is_object(){config["hooks"]=json!({});}
  for event in events{let mut groups=config["hooks"][event].as_array().cloned().unwrap_or_default();groups.push(json!({"hooks":[{"type":"command","command":command,"timeout":5}]}));config["hooks"][event]=json!(groups);}
  if let Some(plugins)=config["enabledPlugins"].as_object_mut(){for (name,enabled) in plugins{if name.starts_with("ai-development-journal@"){*enabled=json!(false);}}}
  super::write_private(&path,&serde_json::to_vec_pretty(&config).map_err(|e|e.to_string())?)?;
 }
 let old=base.join("skills/flowboard-tasks");if old.exists(){let archive=base.join("xingji-integration-backups").join(format!("flowboard-tasks-{}",chrono::Utc::now().format("%Y%m%d-%H%M%S")));fs::create_dir_all(archive.parent().unwrap()).map_err(|e|e.to_string())?;fs::rename(old,archive).map_err(|e|e.to_string())?;}
 install_skill(target.clone(),Some(true))?;
 integration_status(target)
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn compatible_skill_preserves_manual_changes(){let root=std::env::temp_dir().join(format!("xingji-skill-{}",super::super::local::id()));assert_eq!(install_at(&root,"#!/bin/sh\n",false).unwrap()["status"],"installed");fs::write(root.join("SKILL.md"),"personal rules").unwrap();assert_eq!(install_at(&root,"replacement",true).unwrap()["status"],"compatible");assert_eq!(fs::read_to_string(root.join("SKILL.md")).unwrap(),"personal rules");fs::remove_dir_all(root).unwrap();}
}
