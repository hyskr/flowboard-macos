import assert from 'node:assert/strict';
import worker from './index.js';
import { createDatabase } from './test-db.js';
import { materialize } from '../src/services/crdt.ts';

const { sql, env } = createDatabase();
const boardId='shared',keyHash='0'.repeat(64);
let n=0;
const op=(type,payload,baseVersion,baseValues)=>({opId:`edit-${++n}`,type,payload:{boardId,...payload},baseVersion,baseValues,ts:1,clientId:'test',boardId});
const call=async(path,extra={})=>{
  const reply=await worker.fetch(new Request(`https://test${path}`,{method:'POST',body:JSON.stringify({boardId,keyHash,protocolVersion:4,...extra})}),env);
  const data=await reply.json();assert.equal(reply.status,200,JSON.stringify(data));return data;
};
const sync=ops=>call('/api/sync/commit',{ops});
const card=state=>materialize(state).cards.find(c=>c.id==='card');
await sync([op('board.update',{id:boardId,name:'共享看板'}),op('column.create',{id:'todo',name:'待办',order:0}),op('column.create',{id:'doing',name:'进行中',order:1}),op('card.create',{id:'card',title:'原始标题',desc:'原说明',dueDate:null,columnId:'todo',order:0,completedAt:null})]);
let reached=0,release;
const barrier=new Promise(resolve=>{release=resolve;});
env.flowboard_db.beforeBatch=async statements=>{
  if(statements[0].query.startsWith('INSERT INTO crdt_snapshots') && reached<2){reached++;if(reached===2)release();await barrier;}
};
const [a,b]=await Promise.all([
  sync([op('card.update',{id:'card',desc:'新的说明'},1,{desc:'原说明'})]),
  sync([op('card.update',{id:'card',dueDate:'2026-11-06'},1,{dueDate:null})]),
]);
env.flowboard_db.beforeBatch=null;
assert.equal(a.conflicts.length+b.conflicts.length,0);
let state=(await sync([])).state;
assert.equal(card(state).desc,'新的说明');assert.equal(card(state).dueDate,'2026-11-06');assert.equal(card(state).version,3);
const base=card(state);
const edits=await Promise.all([
  sync([op('card.update',{id:'card',desc:'甲的说明'},base.version,{desc:base.desc})]),
  sync([op('card.update',{id:'card',desc:'乙的说明'},base.version,{desc:base.desc})]),
]);
assert.equal(edits.flatMap(r=>r.conflicts).length,1);
assert.ok(edits.flatMap(r=>r.conflicts)[0].local.desc);
state=(await sync([op('card.update',{id:'card',completedAt:Date.now()},1,{completedAt:null})])).state;
assert.equal(card(state).title,'原始标题');assert.equal(card(state).dueDate,'2026-11-06');assert.ok(card(state).completedAt);
const first=op('card.move',{id:'card',columnId:'todo',targetIndex:0});first.ts=Date.now()+999999;
await sync([first]);
const last=op('card.move',{id:'card',columnId:'doing',targetIndex:0});
state=(await sync([last])).state;
assert.equal(card(state).columnId,'doing');
assert.equal(materialize(state).activity.filter(e=>e.type==='moved').length,2);
assert.equal((await sync([last])).state.cards.card.version,state.cards.card.version,'retrying a move does not apply it twice');
await sync([op('card.delete',{id:'card'})]);
const deleted=await sync([op('card.update',{id:'card',desc:'离线草稿'},1,{desc:'原说明'})]);
assert.equal(deleted.conflicts[0].reason,'deleted');assert.equal(deleted.conflicts[0].local.desc,'离线草稿');assert.equal(card(deleted.state),undefined);
await sync([op('card.create',{id:'one',title:'一',desc:'一'}),op('card.create',{id:'two',title:'二',desc:'二'})]);
const different=await sync([op('card.update',{id:'one',desc:'一改'},1,{desc:'一'}),op('card.update',{id:'two',desc:'二改'},1,{desc:'二'})]);
assert.equal(different.conflicts.length,0);
sql.close();
console.log('Six conflict rules and simultaneous database commits passed.');
