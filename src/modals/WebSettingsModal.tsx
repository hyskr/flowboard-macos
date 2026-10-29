import { useState } from 'react';
import { Modal } from './Modal';
import { ConnectionForm } from '../components/ConnectionSetup';
import { browserConnection, forgetConnection } from '../desktop';
import { useFlowStore } from '../store/useFlowStore';
import { useDisplayPreferences } from '../displayPreferences';
import { cx } from '../utils';
import ui from '../components/ui.module.css';
export function WebSettingsModal(){
 const [editing,setEditing]=useState(false);const interval=useFlowStore(s=>s.syncInterval);const error=useFlowStore(s=>s.syncError);const zoom=useDisplayPreferences(s=>s.zoom);
 return <Modal title="网页设置" description="连接信息仅保存在当前浏览器。">
 <p style={{overflowWrap:'anywhere',marginBottom:14}}>{browserConnection()?.workerUrl}</p>
 <div style={{display:'flex',gap:8,marginBottom:18}}><button className={cx(ui.btn,ui.secondary)} onClick={()=>setEditing(v=>!v)}>修改连接</button><button className={cx(ui.btn,ui.ghost)} onClick={forgetConnection}>退出连接并清除密钥</button></div>
 {editing&&<ConnectionForm initialUrl={browserConnection()?.workerUrl||location.origin}/>}
 <label className={ui.label} htmlFor="web-sync">同步检查间隔</label><select id="web-sync" className={ui.input} value={interval} onChange={e=>void useFlowStore.getState().setSyncInterval(Number(e.target.value))}>{[60,120,300,600,1800,3600].map(v=><option key={v} value={v}>{v/60} 分钟</option>)}</select>
 {error&&<p role="alert">{error}</p>}
 <label className={ui.label} style={{marginTop:18}} htmlFor="web-zoom">页面缩放</label><select id="web-zoom" className={ui.input} value={zoom} onChange={e=>useDisplayPreferences.getState().setZoom(Number(e.target.value))}>{[75,80,90,100,110,125,150].map(v=><option key={v} value={v}>{v}%</option>)}</select>
 <p className={ui.hint} style={{marginTop:18}}>个人开发记录、知识库与 Skill 安装请在 macOS 应用中使用。</p>
 <button className={cx(ui.btn,ui.secondary)} style={{marginTop:14}} onClick={()=>void useFlowStore.getState().exportData()}>导出看板备份</button>
 </Modal>;
}
