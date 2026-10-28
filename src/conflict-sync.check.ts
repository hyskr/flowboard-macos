import { DatabaseService } from './services/DatabaseService';
import { SyncService } from './services/SyncService';
import { applyOp, emptyState } from './services/crdt';
import type { CardConflict, CrdtOp } from './types';

async function run() {
  const boardId='browser-draft',keyHash='d'.repeat(64);
  const db=await new DatabaseService().open();
  const sync=new SyncService(db,location.origin,()=>{});
  const op=(type:string,payload:Record<string,unknown>,baseVersion?:number,baseValues?:Record<string,unknown>):CrdtOp=>({opId:crypto.randomUUID(),boardId,clientId:'browser',ts:Date.now(),type,payload:{boardId,...payload},baseVersion,baseValues});
  const send=async(ops:CrdtOp[])=>{
    const r=await fetch('/api/sync/commit',{method:'POST',body:JSON.stringify({boardId,keyHash,protocolVersion:4,ops})});
    if(!r.ok) throw new Error(await r.text());return r.json();
  };
  const seed=await send([op('board.update',{id:boardId,name:'共享'}),op('card.create',{id:'draft-card',title:'标题',desc:'原文',dueDate:null,columnId:null,order:0})]);
  await sync.saveBoardCreds(boardId,keyHash,'共享','');
  await db.reconcile(boardId,seed.state,[],[]);
  const local=op('card.update',{id:'draft-card',desc:'本地草稿'},1,{desc:'原文'});
  await db.updateSyncState(boardId,emptyState(),state=>{applyOp(state,local);return [local];});
  await send([op('card.update',{id:'draft-card',desc:'对方修改'},1,{desc:'原文'})]);
  const reply=await sync.synchronize(boardId);
  if(reply.conflicts[0]?.local.desc!=='本地草稿') throw new Error('Conflict draft missing');
  if(reply.state.cards['draft-card'].desc!=='对方修改') throw new Error('Cloud content was overwritten');
  if((await db.getSyncOutbox(boardId)).ops.length) throw new Error('Rejected operation would be retried automatically');
  const reopened=await new DatabaseService().open();
  const saved=await reopened.get<{value:CardConflict[]}>('settings','syncConflicts');
  if(saved?.value[0]?.local.desc!=='本地草稿') throw new Error('Draft did not survive reopening IndexedDB');
  const date=op('card.update',{id:'draft-card',dueDate:'2026-11-06'},1,{dueDate:null});
  await db.updateSyncState(boardId,emptyState(),state=>{applyOp(state,date);return [date];});
  const merged=await sync.synchronize(boardId);
  if(merged.state.cards['draft-card'].desc!=='对方修改'||merged.state.cards['draft-card'].dueDate!=='2026-11-06') throw new Error('Independent field update was lost');
  if(await sync.hasRemoteChanges(boardId)) throw new Error('Unchanged board should not require a full read');
  return ['Real IndexedDB preserves conflict drafts across reopening','Rejected writes leave the retry outbox and retain the local draft','A different field merges without overwriting cloud text','Unchanged server revision skips full-board synchronization'];
}
run().then(results=>fetch('/sync-result',{method:'POST',body:JSON.stringify({ok:true,results})})).catch(error=>fetch('/sync-result',{method:'POST',body:JSON.stringify({ok:false,error:String(error)})}));
