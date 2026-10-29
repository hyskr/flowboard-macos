use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}};

const MANIFEST: &str = include_str!("../../integrations/flowboard-tasks/manifest.json");

fn root(target: &str) -> Result<PathBuf, String> {
    let home=dirs::home_dir().ok_or("无法找到用户目录")?;
    let base=match target {
        "codex"=>std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(||home.join(".codex")),
        "claude"=>home.join(".claude"),
        _=>return Err("请选择 Codex 或 Claude Code".into()),
    };
    Ok(base.join("skills/flowboard-tasks"))
}

fn version(value: &str) -> Option<[u64;3]> {
    let parts:Vec<_>=value.split('.').map(str::parse::<u64>).collect::<Result<_,_>>().ok()?;
    parts.try_into().ok()
}

fn status_at(root: &Path) -> Result<Value,String> {
    let bundled:Value=serde_json::from_str(MANIFEST).map_err(|e|e.to_string())?;
    let installed=fs::read(root.join(".flowboard-skill.json")).ok().and_then(|bytes|serde_json::from_slice::<Value>(&bytes).ok());
    let complete=["SKILL.md","agents/openai.yaml","scripts/flowboard"].iter().all(|file|root.join(file).is_file());
    let compatible=installed.as_ref().is_some_and(|value|complete && value["protocolVersion"]==bundled["protocolVersion"] &&
        value["version"].as_str().and_then(version).zip(bundled["minimumVersion"].as_str().and_then(version)).is_some_and(|(current,minimum)|current>=minimum));
    let state=if compatible {"compatible"} else if root.join("SKILL.md").exists() {"update_required"} else {"missing"};
    Ok(json!({"status":state,"path":root.to_string_lossy(),"version":installed.as_ref().and_then(|v|v["version"].as_str()),"bundledVersion":bundled["version"],"protocolVersion":bundled["protocolVersion"]}))
}

fn install_at(root: &Path, launcher: &str, update: bool) -> Result<Value,String> {
    let current=status_at(root)?;
    if current["status"]=="compatible" || current["status"]=="update_required" && !update {return Ok(current);}
    super::write_private(&root.join("SKILL.md"),include_bytes!("../../integrations/flowboard-tasks/SKILL.md"))?;
    super::write_private(&root.join("agents/openai.yaml"),include_bytes!("../../integrations/flowboard-tasks/agents/openai.yaml"))?;
    super::write_private(&root.join("scripts/flowboard"),launcher.as_bytes())?;
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(root.join("scripts/flowboard"),fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?;
    super::write_private(&root.join(".flowboard-skill.json"),MANIFEST.as_bytes())?;
    let mut result=status_at(root)?;result["status"]=json!("installed");Ok(result)
}

#[tauri::command]
pub fn skill_status(target:String)->Result<Value,String>{status_at(&root(&target)?)}

#[tauri::command]
pub fn install_skill(target:String,update:Option<bool>)->Result<Value,String>{
    let root=root(&target)?;
    let exe=std::env::current_exe().map_err(|e|e.to_string())?;
    let quoted=exe.to_string_lossy().replace('\'',"'\\''");
    let launcher=format!("#!/bin/sh\nAPP='/Applications/FlowBoard.app/Contents/MacOS/flowboard'\nif [ ! -x \"$APP\" ]; then APP='{quoted}'; fi\nexec \"$APP\" --skill \"$@\"\n");
    install_at(&root,&launcher,update.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installs_only_when_missing_or_explicitly_updated(){
        let root=std::env::temp_dir().join(format!("flowboard-skill-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        assert_eq!(status_at(&root).unwrap()["status"],"missing");
        assert_eq!(install_at(&root,"#!/bin/sh\n",false).unwrap()["status"],"installed");
        fs::write(root.join("SKILL.md"),"personal instructions").unwrap();
        assert_eq!(install_at(&root,"replacement",true).unwrap()["status"],"compatible");
        assert_eq!(fs::read_to_string(root.join("SKILL.md")).unwrap(),"personal instructions");
        fs::write(root.join(".flowboard-skill.json"),r#"{"version":"1.1.0","protocolVersion":4}"#).unwrap();
        assert_eq!(install_at(&root,"replacement",false).unwrap()["status"],"update_required");
        assert_eq!(fs::read_to_string(root.join("SKILL.md")).unwrap(),"personal instructions");
        assert_eq!(install_at(&root,"replacement",true).unwrap()["status"],"installed");
        fs::write(root.join(".flowboard-skill.json"),r#"{"version":"2.0.0","protocolVersion":4}"#).unwrap();
        assert_eq!(status_at(&root).unwrap()["status"],"compatible");
        fs::remove_file(root.join("scripts/flowboard")).unwrap();
        assert_eq!(status_at(&root).unwrap()["status"],"update_required");
        fs::remove_dir_all(root).unwrap();
    }
}
