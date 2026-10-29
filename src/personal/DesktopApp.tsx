import { useEffect, useState } from 'react';
import { App } from '../App';
import { desktopInfo, type DesktopInfo } from '../desktop';
import { Records } from './Records';
import { KnowledgeView } from './KnowledgeView';
import { Settings } from './Settings';
import { ConnectionForm } from '../components/ConnectionSetup';
import { Icon, Logo, type IconName } from '../components/Icon';
import { cx } from '../utils';
import s from './Personal.module.css';
type Page='board'|'journal'|'knowledge'|'settings';
const pages:{id:Page;label:string;icon:IconName}[]=[{id:'board',label:'共享看板',icon:'board'},{id:'journal',label:'开发记录',icon:'activity'},{id:'knowledge',label:'知识库',icon:'text'},{id:'settings',label:'设置',icon:'settings'}];
export function DesktopApp(){
 const [page,setPage]=useState<Page>(()=>{const value=localStorage.getItem('xingji-page');return pages.some(p=>p.id===value)?value as Page:'journal';});const [connection,setConnection]=useState<DesktopInfo|null>(null);const [query,setQuery]=useState('');const [journalId,setJournalId]=useState('');const [message,setMessage]=useState('');
 useEffect(()=>{void desktopInfo().then(setConnection).catch(e=>setMessage(String(e)));},[]);
 const go=(next:Page)=>{setPage(next);localStorage.setItem('xingji-page',next);};
 const wiki=(target:string)=>{const journal=target.match(/\^j([\w-]+)/);if(journal){setJournalId(journal[1]);go('journal');}else{setQuery(target.split('#')[0].split('/').pop()||target);go('knowledge');}};
 return <div className={s.shell}><aside className={s.nav} aria-label="行记导航"><div className={s.brand}><Logo size={30}/>行记</div>{pages.map(p=><button key={p.id} aria-current={page===p.id?'page':undefined} onClick={()=>go(p.id)}><Icon name={p.icon}/>{p.label}</button>)}<small>事情一起安排<br/>工作自己回顾<br/>方法长期复用</small><button style={{fontSize:12}} onClick={()=>void navigator.clipboard.writeText('使用 $xingji 记录当前对话尚未保存的成果。').then(()=>setMessage('已复制记录指令，可粘贴到当前 AI 聊天。'))}>记录当前成果</button><button style={{fontSize:12}} onClick={()=>void navigator.clipboard.writeText('使用 $xingji 把当前对话中可复用的方法整理为知识，先查找并更新原主题。').then(()=>setMessage('已复制整理指令，可粘贴到当前 AI 聊天。'))}>整理为知识</button></aside><main className={s.workspace}>
 {message&&<div role="status" className={s.notice}>{message}<button onClick={()=>setMessage('')}>关闭</button></div>}
 {connection?.configured&&<div className={cx(s.board,page!=='board'&&s.hidden)}><App/></div>}
 {page==='board'&&!connection?.configured&&<div className={s.empty}><h2>连接共享看板</h2><p>个人记录与知识库已经可以使用。需要一起安排事情时，再填写共享服务地址和密钥。</p><ConnectionForm initialUrl={connection?.workerUrl||''} initialError={connection?.error||''}/></div>}
 {page==='journal'&&<Records initialId={journalId} onWiki={wiki}/>}
 {page==='knowledge'&&<KnowledgeView initialQuery={query} onJournal={id=>{setJournalId(id);go('journal');}} onSettings={()=>go('settings')}/>}
 {page==='settings'&&<Settings connection={connection}/>}
 </main></div>;
}
