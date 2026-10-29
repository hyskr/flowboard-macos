use super::*;
fn store()->Store{Store::open(std::env::temp_dir().join(format!("xingji-test-{}",id()))).unwrap()}
#[test]
fn journal_retry_date_sections_conflicts_and_tombstones(){
 let s=store();let request=json!({"op":"journal.save","requestId":"retry-1","id":"phase-1","title":"发布","body":"## 实现\n\nA\n\n## 验证\n\nB","occurredAt":"2026-10-28T18:30:00Z","sessionId":"chat-1"});
 let a=s.execute(request.clone()).unwrap();assert_eq!(a["record"]["date"],"2026-10-29");assert_eq!(s.execute(request).unwrap(),a);
 s.execute(json!({"op":"journal.save","id":"phase-1","baseVersion":1,"patches":[{"heading":"实现","baseValue":"A","value":"本地修改"}]})).unwrap();
 assert_eq!(s.execute(json!({"op":"journal.save","id":"phase-1","baseVersion":1,"patches":[{"heading":"验证","baseValue":"B","value":"通过"}]})).unwrap()["status"],"saved");
 let conflict=s.execute(json!({"op":"journal.save","id":"phase-1","baseVersion":1,"patches":[{"heading":"实现","baseValue":"A","value":"旧 AI 修改"}]})).unwrap();assert_eq!(conflict["status"],"conflict");
 s.execute(json!({"op":"journal.delete","id":"phase-1","baseVersion":3})).unwrap();
 assert_eq!(s.execute(json!({"op":"journal.save","id":"phase-1","title":"复活","body":"旧请求"})).unwrap()["status"],"deleted");
 assert_eq!(s.execute(json!({"op":"journal.list"})).unwrap().as_array().unwrap().len(),0);
 s.execute(json!({"op":"journal.restore","id":"phase-1","baseVersion":4})).unwrap();assert_eq!(s.execute(json!({"op":"journal.list"})).unwrap().as_array().unwrap().len(),1);
 fs::remove_dir_all(s.root.clone()).unwrap();
}
#[test]
fn markdown_external_edits_are_indexed_and_not_overwritten(){
 let s=store();let path=knowledge::root(&s).unwrap();fs::create_dir_all(&path).unwrap();fs::write(path.join("typst.md"),"# Typst 模板\n\n适用：课程报告\n\n## 安装\n\ntypst init @local/course-report:0.1.0").unwrap();
 let found=s.execute(json!({"op":"knowledge.search","query":"Typst 课程报告","limit":5})).unwrap();assert_eq!(found.as_array().unwrap().len(),1);
 let old=s.execute(json!({"op":"knowledge.read","path":"typst.md"})).unwrap();
 fs::write(path.join("typst.md"),"# Typst 模板\n\nObsidian 手动修改").unwrap();
 assert_eq!(s.execute(json!({"op":"knowledge.save","path":"typst.md","topic":"typst-template","baseBody":old["body"],"body":"# AI 旧内容"})).unwrap()["status"],"conflict");
 let current=s.execute(json!({"op":"knowledge.read","path":"typst.md"})).unwrap();assert!(text(&current,"body").contains("Obsidian"));
 s.execute(json!({"op":"knowledge.delete","path":"typst.md","baseVersion":current["version"]})).unwrap();assert_eq!(s.execute(json!({"op":"knowledge.save","path":"typst.md","topic":"typst-template","body":"old"})).unwrap()["status"],"deleted");
 fs::remove_dir_all(s.root.clone()).unwrap();
}
#[test]
fn checkpoint_is_incremental_once_and_keeps_failed_body(){
 let s=store();let key="chat-test";let mut state=hooks::status(&s,&json!({"sessionId":key})).unwrap();state["lastCheck"]=json!("2020-01-01T00:00:00Z");s.put("sessions",key,&state).unwrap();
 assert_eq!(hooks::handle(&s,&json!({"hook_event_name":"Stop","session_id":key})).unwrap(),json!({}));
 hooks::handle(&s,&json!({"hook_event_name":"PostToolUse","session_id":key,"tool_name":"Write","tool_input":{"file_path":"src/main.rs"}})).unwrap();
 let prompt=hooks::handle(&s,&json!({"hook_event_name":"Stop","session_id":key})).unwrap();assert_eq!(prompt["decision"],"block");
 assert_eq!(hooks::handle(&s,&json!({"hook_event_name":"Stop","session_id":key})).unwrap(),json!({}));
 let pending=hooks::status(&s,&json!({"sessionId":key})).unwrap()["pending"].clone();
 assert_eq!(s.execute(json!({"op":"checkpoint.save","sessionId":key,"checkpointId":pending["id"],"journal":{"id":"phase-1","title":"记录","body":""}})).unwrap()["status"],"failed");
 assert!(hooks::status(&s,&json!({"sessionId":key})).unwrap()["prepared"].is_object());
 s.execute(json!({"op":"checkpoint.ack","sessionId":key,"checkpointId":pending["id"]})).unwrap();
 assert_eq!(hooks::handle(&s,&json!({"hook_event_name":"Stop","session_id":key})).unwrap(),json!({}));
 fs::remove_dir_all(s.root.clone()).unwrap();
}
#[test]
fn import_is_repeatable_and_keeps_source(){
 let s=store();let source=s.root.join("legacy");fs::create_dir_all(&source).unwrap();let body="---\ndate: 2026-10-15\n---\n# 日记\n\n## 18:43 · 数据科学与工程 — 完成模板库 ^jstable-id\n\n<!-- dev-notes:stable-id -->\n\n完整正文与代码。\n";let path=source.join("2026-10-15.md");fs::write(&path,body).unwrap();
 assert_eq!(journal::import_file(&s,&path).unwrap(),(1,0));assert_eq!(journal::import_file(&s,&path).unwrap(),(0,1));assert_eq!(fs::read_to_string(path).unwrap(),body);
 let rows=s.execute(json!({"op":"journal.list"})).unwrap();assert_eq!(rows[0]["id"],"legacy:stable-id");assert_eq!(rows[0]["date"],"2026-10-15");fs::remove_dir_all(s.root.clone()).unwrap();
}
