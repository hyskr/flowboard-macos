use super::*;

pub fn session_id(r:&Value)->String {r["sessionId"].as_str().or(r["session_id"].as_str()).map(str::to_owned).or_else(||std::env::var("CODEX_THREAD_ID").ok()).unwrap_or_else(||"manual".into())}
fn session(s:&Store,key:&str)->Result<Value>{Ok(s.get("sessions",key)?.unwrap_or_else(||json!({"id":key,"sequence":0,"acknowledged":0,"lastCheck":now(),"hints":[],"pending":null,"afterTurn":null}))) }
pub fn status(s:&Store,r:&Value)->Result<Value>{let key=session_id(r);session(s,&key)}
pub fn ack(s:&Store,r:&Value)->Result<Value>{
    let key=session_id(r);let mut value=session(s,&key)?;
    let checkpoint=text(r,"checkpointId");
    if !checkpoint.is_empty() && value["pending"]["id"]!=checkpoint{return Err("检查点已处理或不属于当前会话".into());}
    let through=value["pending"]["through"].as_i64().unwrap_or(value["sequence"].as_i64().unwrap_or(0));
    value.as_object_mut().unwrap().remove("prepared");
    value["acknowledged"]=json!(through);value["afterTurn"]=value["pending"]["throughTurn"].clone();value["pending"]=Value::Null;value["lastCheck"]=json!(now());
    if let Some(hints)=value["hints"].as_array_mut(){hints.retain(|h|h["sequence"].as_i64().unwrap_or(0)>through);}
    s.put("sessions",&key,&value)?;Ok(json!({"status":"acknowledged","through":through}))
}
pub fn checkpoint_save(s:&Store,r:&Value)->Result<Value>{
    let key=session_id(r);let mut state=session(s,&key)?;
    if let Some(journal)=r.get("journal"){state["prepared"]=journal.clone();s.put("sessions",&key,&state)?;}
    let mut journal=state["prepared"].clone();if !journal.is_object(){return Err("没有待保存正文；传入 journal 或先查看 checkpoint.status".into());}
    journal["sessionId"]=json!(key);
    let result=match super::journal::save(s,&journal){Ok(value)=>value,Err(error)=>return Ok(json!({"status":"failed","error":error.to_string(),"draftRetained":true}))};
    if result["status"]=="saved"{ack(s,&json!({"sessionId":key,"checkpointId":r["checkpointId"]}))?;let mut state=session(s,&key)?;state.as_object_mut().unwrap().remove("prepared");s.put("sessions",&key,&state)?;}
    Ok(result)
}
fn signal(r:&Value)->Option<String>{
    let tool=text(r,"tool_name");let input=&r["tool_input"];
    let raw=if input.is_string(){input.as_str().unwrap().to_string()}else{input.to_string()};
    if raw.contains("--xingji")||raw.contains("scripts/xingji")||raw.contains("journal.py")||raw.contains("scripts/flowboard"){return None;}
    if tool.to_lowercase().contains("write")||tool.to_lowercase().contains("edit")||tool.contains("apply_patch"){
        let paths=["file_path","path","file"].iter().filter_map(|k|input[k].as_str()).collect::<Vec<_>>().join(", ");
        return Some(if paths.is_empty(){format!("{tool} 修改文件")}else{format!("修改 {paths}")});
    }
    if tool.contains("exec")||tool.contains("Bash") {
        let command=input["cmd"].as_str().or(input["command"].as_str()).unwrap_or(&raw);
        let action=regex::Regex::new(r"(?m)(git (commit|push|merge)|npm run (build|test)|cargo (test|build)|wrangler deploy|gh release|python\d?\s+-\s*<<|\b(sed -i|cat\s*>|tee\s+))").ok()?;
        if action.is_match(command){let success=r["tool_response"]["exit_code"].as_i64();return Some(format!("{}{}",action.find(command).map(|m|m.as_str()).unwrap_or("开发操作"),success.map(|s|format!("（退出 {s}）")).unwrap_or_default()));}
    }
    None
}
pub fn handle(s:&Store,r:&Value)->Result<Value>{
    let event=text(r,"hook_event_name");let key=session_id(r);let mut state=session(s,&key)?;
    if event=="PostToolUse" {
        if let Some(hint)=signal(r){let seq=state["sequence"].as_i64().unwrap_or(0)+1;state["sequence"]=json!(seq);state["lastWorkAt"]=json!(now());state["lastTurn"]=r["turn_id"].clone();let mut hints=state["hints"].as_array().cloned().unwrap_or_default();hints.push(json!({"sequence":seq,"hint":hint}));if hints.len()>24{hints.remove(0);}state["hints"]=json!(hints);s.put("sessions",&key,&state)?;}
        return Ok(json!({}));
    }
    if !s.setting("autoRecord")?.as_bool().unwrap_or(true){return Ok(json!({}));}
    let minutes=s.setting("checkpointMinutes")?.as_i64().unwrap_or(60);
    if minutes==0{return Ok(json!({}));}
    let dirty=state["sequence"].as_i64().unwrap_or(0)>state["acknowledged"].as_i64().unwrap_or(0);
    if !dirty{return Ok(json!({}));}
    let elapsed=chrono::DateTime::parse_from_rfc3339(text(&state,"lastCheck")).map(|d|(Utc::now()-d.with_timezone(&Utc)).num_minutes()).unwrap_or(minutes);
    let compact=event=="PreCompact";
    if state["pending"].is_null() && (elapsed>=minutes||compact) {
        state["pending"]=json!({"id":id(),"since":state["lastCheck"],"afterTurn":state["afterTurn"],"through":state["sequence"],"throughTurn":state["lastTurn"],"hints":state["hints"],"notified":false});
    }
    if state["pending"].is_null(){s.put("sessions",&key,&state)?;return Ok(json!({}));}
    let resume=event=="SessionStart";
    if !resume && event!="Stop" && event!="PreCompact" {s.put("sessions",&key,&state)?;return Ok(json!({}));}
    if state["pending"]["notified"]==true && !resume {return Ok(json!({}));}
    let pending=state["pending"].clone();
    let prompt=format!("行记检查点：仅处理此范围内新增且有实质价值的成果、研究、排障或决定。利用当前对话，不重读整段工具历史。读取 xingji/references/journal.md 后，用 checkpoint.save 保存已有正文或 checkpoint.ack 明确跳过；失败时通过 checkpoint.status 取回正文重试，不重新总结。会话 {}，检查点 {}。范围与线索：{}",key,text(&pending,"id"),pending);
    state["pending"]["notified"]=json!(true);s.put("sessions",&key,&state)?;
    if event=="Stop" && r["stop_hook_active"]!=true {Ok(json!({"decision":"block","reason":prompt}))}
    else if event=="PreCompact" {Ok(json!({"continue":false,"stopReason":prompt}))}
    else if resume {Ok(json!({"hookSpecificOutput":{"hookEventName":event,"additionalContext":prompt}}))}
    else{Ok(json!({}))}
}
