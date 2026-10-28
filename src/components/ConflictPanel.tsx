import { useState } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { cx } from '../utils';
import ui from './ui.module.css';

const labels: Record<string,string> = {title:'标题',desc:'说明',dueDate:'日期',completedAt:'完成状态',priority:'优先级',tags:'标签',checklist:'清单',color:'颜色'};
const display = (value: unknown) => value == null ? '（空）' : typeof value === 'string' ? value : JSON.stringify(value);

export function ConflictPanel() {
  const conflicts = useFlowStore(st => st.conflicts);
  const resolve = useFlowStore(st => st.resolveConflict);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  if (!conflicts.length) return null;
  const draft = conflicts[0];
  const choose = async (choice:'local'|'remote') => {
    setBusy(true);setError('');
    try { await resolve(draft.opId,choice); } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  };
  return <section role="status" style={{margin:'0 24px 12px',padding:16,border:'1px solid var(--warning)',borderRadius:12,background:'var(--card)',maxHeight:'40vh',overflow:'auto'}}>
    <details><summary style={{cursor:'pointer',fontWeight:600}}>{draft.reason === 'deleted' ? '卡片已被删除，本地草稿已保留' : '这张卡片有冲突，本地草稿已保留'} · {conflicts.length} 项待处理</summary>
      <p style={{margin:'10px 0'}}>{draft.remote?.title || String(draft.local.title || draft.cardId)}</p>
      {Object.keys(labels).filter(key=>Object.hasOwn(draft.local,key)).map(key=><div key={key} style={{marginBottom:12}}><strong>{labels[key]}</strong><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:6}}><div><small>我的内容</small><pre style={{whiteSpace:'pre-wrap',userSelect:'text'}}>{display(draft.local[key])}</pre></div><div><small>云端内容</small><pre style={{whiteSpace:'pre-wrap'}}>{draft.remote ? display(draft.remote[key as keyof typeof draft.remote]) : '卡片已删除'}</pre></div></div></div>)}
      <div style={{display:'flex',gap:8}}>{draft.remote && draft.reason === 'fields_changed' && <button className={cx(ui.btn,ui.primary)} disabled={busy} onClick={()=>choose('local')}>使用我的改动</button>}<button className={cx(ui.btn,ui.secondary)} disabled={busy} onClick={()=>choose('remote')}>{draft.remote ? '使用云端内容' : '放弃此草稿'}</button></div>
      {error && <p role="alert" style={{color:'var(--danger)',marginTop:8}}>{error}</p>}
    </details>
  </section>;
}
