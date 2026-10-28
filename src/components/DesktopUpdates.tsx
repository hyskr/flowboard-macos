import { useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { download as downloadFrontend } from 'tauri-plugin-hot-update-api';
import { cx } from '../utils';
import ui from './ui.module.css';

export function DesktopUpdates() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [update, setUpdate] = useState<Update | null>(null);
  const [ready, setReady] = useState(false);
  const checkUpdates = async () => {
    setBusy(true); setMessage('正在检查更新…');
    try {
      const next = await check();
      if (next) { setUpdate(next); setMessage(`发现新版本 ${next.version}，安装后将重启应用。`); return; }
      const frontend = await downloadFrontend();
      if (frontend.status === 'staged' || frontend.status === 'alreadyStaged') { setReady(true); setMessage('界面更新已下载，重启应用后生效。'); }
      else if (frontend.status === 'blacklisted') setMessage('此界面更新曾启动失败，已保留当前可用版本。');
      else if (frontend.status === 'shellTooOld') setMessage('界面更新需要更高版本的应用，请安装完整版本更新。');
      else setMessage('当前已是最新版本。');
    } catch { setMessage('暂时无法检查更新，请稍后重试。'); }
    finally { setBusy(false); }
  };
  const install = async () => {
    setBusy(true); setMessage('正在下载并验证更新…');
    try { if (update) await update.downloadAndInstall(); await relaunch(); }
    catch { setMessage('更新未能完成，当前版本继续可用。'); setBusy(false); }
  };
  return <section style={{ margin: '24px 0' }}><h3 style={{ marginBottom: 10 }}>应用更新</h3>
    <button className={cx(ui.btn, ui.secondary)} disabled={busy} onClick={update || ready ? install : checkUpdates}>{busy ? '处理中…' : update ? '安装更新并重启' : ready ? '重启以应用更新' : '检查更新'}</button>
    {message && <p role="status" style={{ marginTop: 10, color: 'var(--fg-muted)' }}>{message}</p>}
  </section>;
}
