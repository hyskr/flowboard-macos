import { useState } from 'react';
import { relaunch } from '@tauri-apps/plugin-process';
import { saveConnection } from '../desktop';
import { Logo } from './Icon';
import { cx } from '../utils';
import ui from './ui.module.css';

export function ConnectionForm({initialUrl='',initialError=''}:{initialUrl?:string;initialError?:string}){
  const [url,setUrl]=useState(initialUrl);
  const [key,setKey]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(initialError);
  const [message,setMessage]=useState('');
  const connect=async()=>{
    if(busy)return;
    setBusy(true);setError('');setMessage('正在连接…');
    try{await saveConnection(url,key);setKey('');setMessage('连接已保存，正在重新打开应用…');await relaunch();}
    catch(error){setMessage('');setError(String(error));setBusy(false);}
  };
  return <div onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void connect();}}}>
    <div className={ui.field}><label className={ui.label} htmlFor="connection-url">服务地址</label><input id="connection-url" className={ui.input} type="url" placeholder="https://your-worker.workers.dev" value={url} onChange={event=>setUrl(event.target.value)} autoFocus disabled={busy}/></div>
    <div className={ui.field}><label className={ui.label} htmlFor="connection-key">共享密钥</label><input id="connection-key" className={ui.input} type="password" autoComplete="off" placeholder="输入你们共用的密钥" value={key} onChange={event=>setKey(event.target.value)} disabled={busy}/></div>
    <p className={ui.hint} style={{margin:'12px 0'}}>密钥保存在本机系统钥匙串。共享看板和 skill 使用同一份连接。</p>
    {error&&<p role="alert" style={{color:'var(--danger)',marginBottom:12}}>{error}</p>}
    {message&&<p role="status" style={{color:'var(--fg-muted)',marginBottom:12}}>{message}</p>}
    <button className={cx(ui.btn,ui.primary)} disabled={busy||!url.trim()||!key.trim()} onClick={()=>void connect()}>{busy?'正在连接…':'连接并打开看板'}</button>
  </div>;
}

export function ConnectionSetup({initialUrl='',initialError=''}:{initialUrl?:string;initialError?:string}){
  return <main style={{height:'100dvh',display:'grid',placeItems:'center',padding:24,overflow:'auto'}}><section style={{width:'100%',maxWidth:420,padding:30,border:'1px solid var(--line)',borderRadius:16,background:'var(--card)',boxShadow:'var(--shadow-md)'}}>
    <Logo size={36}/><h1 style={{fontSize:25,margin:'20px 0 10px'}}>连接共享看板</h1><p style={{color:'var(--fg-muted)',marginBottom:24}}>填写一次服务地址和共享密钥，与你的协作者管理同一张看板。</p>
    <ConnectionForm initialUrl={initialUrl} initialError={initialError}/>
  </section></main>;
}
