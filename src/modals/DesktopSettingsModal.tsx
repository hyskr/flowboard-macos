import { useEffect, useState } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { Modal } from './Modal';
import { cx } from '../utils';
import { checkSkill, installSkill, type SkillStatus } from '../desktop';
import ui from '../components/ui.module.css';
import { DesktopUpdates } from '../components/DesktopUpdates';

type Target = 'codex' | 'claude';
const targets: {id:Target;name:string}[] = [{id:'codex',name:'Codex'},{id:'claude',name:'Claude Code'}];

export function DesktopSettingsModal() {
  const workerUrl=useFlowStore(st=>st.workerUrl);
  const syncError=useFlowStore(st=>st.syncError);
  const connected = useFlowStore(st => st.workerStatus);
  const syncInterval = useFlowStore(st => st.syncInterval);
  const setSyncInterval = useFlowStore(st => st.setSyncInterval);
  const [syncBusy,setSyncBusy] = useState(false);
  const { exportData, importData, toast, openModal } = useFlowStore.getState();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [statuses,setStatuses] = useState<Partial<Record<Target,SkillStatus>>>({});
  const [issues,setIssues] = useState<Partial<Record<Target,string>>>({});
  const refresh = async (target:Target) => {
    setIssues(values=>({...values,[target]:undefined}));
    try {const result=await checkSkill(target);setStatuses(values=>({...values,[target]:result}));}
    catch {setIssues(values=>({...values,[target]:'无法检查版本，请重试。'}));}
  };
  useEffect(()=>{void refresh('codex');void refresh('claude');},[]);
  const install = async (target:Target) => {
    setBusy(target);setMessage('');
    try {
      const result=await installSkill(target,statuses[target]?.status==='update_required');
      setStatuses(values=>({...values,[target]:result}));
      if(result.status==='compatible') setMessage(`skill ${result.version} 已兼容，无需更新。`);
      else if(result.status==='update_required') setMessage('检测到已安装版本不兼容，请点击“更新 skill”。');
      else setMessage(`skill ${result.version} 已就绪。新开 ${target==='codex'?'Codex':'Claude Code'} 对话后即可使用。`);
    } catch(e) {setMessage(String(e));}
    finally {setBusy('');}
  };
  const changeInterval = async (seconds:number) => {
    setSyncBusy(true);
    try {await setSyncInterval(seconds);toast('同步间隔已保存');} catch {toast('无法保存同步间隔，请重试。','⚠');}
    finally {setSyncBusy(false);}
  };
  const embeddedVersion=statuses.codex?.bundledVersion || statuses.claude?.bundledVersion;
  return <Modal title="设置与 skill" description="此应用已连接你们的共享看板。">
    <div className={ui.field}><p style={{overflowWrap:'anywhere',marginBottom:8}}>服务地址：{workerUrl}</p><button className={cx(ui.btn,ui.secondary)} onClick={()=>openModal('connection',{workerUrl})}>修改连接</button></div>
    <div className={ui.field}><strong>{connected?'共享同步已连接':'本地保存中，连接恢复后继续同步'}</strong><p className={ui.hint}>修改后自动上传，切回应用时立即同步。</p>{syncError&&<p role="alert" style={{color:'var(--danger)'}}>{syncError}</p>}
      <label className={ui.label} htmlFor="cloud-sync-interval" style={{marginTop:12}}>检查云端更新的间隔</label>
      <select id="cloud-sync-interval" className={ui.input} value={syncInterval} disabled={syncBusy} onChange={event=>void changeInterval(Number(event.target.value))}>
        {[{seconds:60,label:'每 1 分钟'},{seconds:120,label:'每 2 分钟'},{seconds:300,label:'每 5 分钟'},{seconds:600,label:'每 10 分钟'},{seconds:1800,label:'每 30 分钟'},{seconds:3600,label:'每 1 小时'}].map(item=><option key={item.seconds} value={item.seconds}>{item.label}</option>)}
      </select><p className={ui.hint}>只影响本机的定时检查；本机修改仍自动上传，切回应用时立即更新。</p>
    </div>
    <section style={{margin:'24px 0'}}><h3 style={{marginBottom:8}}>自动保存对话中的待办</h3><p style={{color:'var(--fg-muted)',marginBottom:14}}>先检查已安装版本；兼容时直接使用，不重复安装。</p><p className={ui.hint}>App 内置 skill 版本：{embeddedVersion || (issues.codex && issues.claude ? '无法读取' : '读取中…')}</p>
      {targets.map(({id,name})=>{
        const status=statuses[id];
        const compatible=status?.status==='compatible'||status?.status==='installed';
        return <div key={id} style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',padding:'12px 0',borderBottom:'1px solid var(--line)'}}>
          <div><strong>{name}</strong><p className={ui.hint}>{issues[id] || (!status?'正在检查…':compatible?`系统 skill 版本：${status.version} · 兼容`:status.status==='missing'?'系统 skill：尚未安装':`系统 skill 版本：${status.version || '未知'} · 需更新至 ${status.bundledVersion}`)}</p></div>
          {issues[id]?<button className={cx(ui.btn,ui.secondary)} onClick={()=>void refresh(id)}>重试检查</button>:<button className={cx(ui.btn,compatible?ui.secondary:ui.primary)} disabled={!!busy||!status||compatible} onClick={()=>void install(id)}>{busy===id?'正在安装…':compatible?'已兼容':status?.status==='update_required'?'更新 skill':'安装 skill'}</button>}
        </div>;
      })}
      {message&&<p role="status" style={{marginTop:12,color:'var(--fg-muted)'}}>{message}</p>}
    </section>
    <DesktopUpdates />
    <section><h3 style={{marginBottom:12}}>备份</h3><div style={{display:'flex',gap:8}}><button className={cx(ui.btn,ui.secondary)} onClick={exportData}>导出看板</button><label className={cx(ui.btn,ui.secondary)}>导入备份<input type="file" accept=".json" hidden onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{await importData(await file.text());}catch{toast('无法读取备份文件','⚠');}e.target.value='';}}/></label></div></section>
  </Modal>;
}
