import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { cx } from '../utils';
import ui from './ui.module.css';

export function DesktopUpdates({enabled = true}:{enabled?:boolean}) {
  const [version,setVersion] = useState('');
  useEffect(()=>{void getVersion().then(setVersion).catch(()=>setVersion('无法读取'));},[]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [update, setUpdate] = useState<Update | null>(null);
  const checkUpdates = async () => {
    setBusy(true); setMessage('正在检查更新…');
    try {
      const next = await check();
      if (next) { setUpdate(next); setMessage(`发现新版本 ${next.version}，安装后将重启应用。`); return; }
      setMessage('当前已是最新版本。');
    } catch { setMessage('暂时无法检查更新，请稍后重试。'); }
    finally { setBusy(false); }
  };
  const install = async () => {
    setBusy(true); setMessage('正在下载并验证更新…');
    try { if (update) await update.downloadAndInstall(); await relaunch(); }
    catch { setMessage('更新未能完成，当前版本继续可用。'); setBusy(false); }
  };
  return <section style={{ margin: '24px 0' }}><h3 style={{ marginBottom: 10 }}>应用更新</h3>
    <p className={ui.hint} style={{marginBottom:12}}>当前应用版本：{version || '读取中…'}</p>
    <button className={cx(ui.btn, ui.secondary)} disabled={busy || !enabled} onClick={update ? install : checkUpdates}>{busy ? '处理中…' : update ? '安装更新并重启' : '检查更新'}</button>
    {!enabled && <p className={ui.hint}>可以从 GitHub Releases 下载新版应用。</p>}
    {message && <p role="status" style={{ marginTop: 10, color: 'var(--fg-muted)' }}>{message}</p>}
  </section>;
}
