import assert from 'node:assert/strict';
import worker from './index.js';
import { createDatabase } from './test-db.js';
import { validChatUrl } from '../src/chatSource.ts';

assert.equal(validChatUrl('codex://threads/01a18277-7a1e-7b72-b4ea-392dd9afeaed'),true);
assert.equal(validChatUrl('https://chatgpt.com/c/1234-abcd'),true);
assert.equal(validChatUrl('https://claude.ai/chat/1234-abcd'),true);
for(const url of ['javascript:alert(1)','file:///tmp/task','codex://threads/new','https://example.com/c/1234','https://evil@chatgpt.com/c/1234']) assert.equal(validChatUrl(url),false);

const {sql,env}=createDatabase();
const boardId='source-board',keyHash='e'.repeat(64);
const request=async(path,data={})=>{
  const response=await worker.fetch(new Request(`https://test${path}`,{method:'POST',body:JSON.stringify({boardId,keyHash,protocolVersion:4,...data})}),env);
  return {status:response.status,data:await response.json()};
};
await request('/api/sync/commit',{ops:[{opId:'source-board',boardId,type:'board.update',ts:0,clientId:'test',payload:{id:boardId,boardId,name:'来源测试'}}]});
const sourceChat={url:'codex://threads/01a18277-7a1e-7b72-b4ea-392dd9afeaed'};
let reply=await request('/api/tasks/batch',{actions:[{action:'upsert_task',args:{sourceKey:'source-task',title:'来源任务',sourceChat}}]});
assert.equal(reply.status,200);
const card=reply.data.cards[0];assert.deepEqual(card.sourceChat,sourceChat);
reply=await request('/api/tasks/batch',{actions:[{action:'upsert_task',args:{cardId:card.id,title:'后续补充',baseVersion:card.version,baseValues:{title:card.title},sourceChat:{url:'https://chatgpt.com/c/new-chat'}}}]});
assert.equal(reply.status,200);assert.deepEqual(reply.data.cards[0].sourceChat,sourceChat,'later conversations keep the original source');
reply=await request('/api/tasks/batch',{actions:[{action:'upsert_task',args:{sourceKey:'invalid-source',title:'无效来源',sourceChat:{url:'file:///tmp/task'}}}]});
assert.equal(reply.status,400);
sql.close();console.log('Source chat creation, preservation and permitted destinations passed.');
