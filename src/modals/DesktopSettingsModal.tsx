import { useState } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { Modal } from './Modal';
import { cx } from '../utils';
import { installSkill } from '../desktop';
import ui from '../components/ui.module.css';
import { DesktopUpdates } from '../components/DesktopUpdates';

export function DesktopSettingsModal() {
  const connected = useFlowStore(st => st.workerStatus);
  const { exportData, importData, toast } = useFlowStore.getState();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const install = async (target: 'codex' | 'claude') => {
    setBusy(target); setMessage('');
    try { const result = await installSkill(target); setMessage(`已安装到 ${result.path}。新开 ${target === 'codex' ? 'Codex' : 'Claude Code'} 对话后即可自动保存任务。`); }
    catch (e) { setMessage(String(e)); }
    finally { setBusy(''); }
  };
  return <Modal title="设置与 skill" description="此应用已连接你们的共享看板。">
    <div className={ui.field}><strong>{connected ? '共享同步已连接' : '本地保存中，连接恢复后继续同步'}</strong><p className={ui.hint}>两台 Mac 打开应用即可管理同一张看板，修改后自动上传；前台每分钟检查更新，切回应用时立即同步。</p></div>
    <section style={{ margin: '24px 0' }}><h3 style={{ marginBottom: 8 }}>自动保存对话中的待办</h3><p style={{ color: 'var(--fg-muted)', marginBottom: 14 }}>仅在事情确定、要求变更或完成时更新卡片。一轮修改合并提交。</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className={cx(ui.btn, ui.primary)} disabled={!!busy} onClick={() => install('codex')}>{busy === 'codex' ? '正在安装…' : '安装到 Codex'}</button>
      <button className={cx(ui.btn, ui.secondary)} disabled={!!busy} onClick={() => install('claude')}>{busy === 'claude' ? '正在安装…' : '安装到 Claude Code'}</button>
    </div>{message && <p role="status" style={{ marginTop: 12, overflowWrap: 'anywhere', color: 'var(--fg-muted)' }}>{message}</p>}</section>
    <DesktopUpdates />
    <section><h3 style={{ marginBottom: 12 }}>备份</h3><div style={{ display: 'flex', gap: 8 }}><button className={cx(ui.btn, ui.secondary)} onClick={exportData}>导出看板</button><label className={cx(ui.btn, ui.secondary)}>导入备份<input type="file" accept=".json" hidden onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { await importData(await file.text()); } catch { toast('无法读取备份文件', '⚠'); } e.target.value = ''; }} /></label></div></section>
  </Modal>;
}
