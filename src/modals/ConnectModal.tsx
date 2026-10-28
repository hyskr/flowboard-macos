import { useState } from 'react';
import { useFlowStore, sync } from '../store/useFlowStore';
import { Modal } from './Modal';
import { cx } from '../utils';
import ui from '../components/ui.module.css';

export function ConnectModal() {
  const boardId = useFlowStore(st => st.activeBoardId);
  const workerUrl = useFlowStore(st => st.workerUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    if (!boardId) return;
    setBusy(true); setError('');
    try {
      const st = useFlowStore.getState();
      await st.saveSettings({ workerUrl, syncInterval: st.syncInterval });
      const cred = await sync.getBoardCreds(boardId);
      if (!st.boards.some(b => b.id === boardId) || !cred || !useFlowStore.getState().workerStatus) throw new Error('请先连接云端并同步看板，再下载配置。');
      const config = { workerUrl, boardId, keyHash: cred.keyHash };
      const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'flowboard-connection.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal title="连接 GPT" description="让对话里确定要做的事，直接保存到这张看板。">
    <p>安装 FlowBoard skill 后，在这里下载连接配置，交给 Codex 导入一次，即可用于后续对话。</p>
    <ol style={{ paddingLeft: 20, lineHeight: 1.9, margin: '16px 0' }}>
      <li>任务确定或内容变化时，自动保存。</li>
      <li>同一件事持续更新原卡片，一轮修改合并提交。</li>
      <li>讨论中的想法留在对话里；保存成功会有简短回执。</li>
    </ol>
    <button className={cx(ui.btn, ui.primary)} onClick={download} disabled={busy}>{busy ? '正在同步…' : '下载此看板的连接配置'}</button>
    <p className={ui.hint} style={{ marginTop: 12 }}>配置包含这张看板的编辑权限，请仅交给自己的 GPT 使用。</p>
    {error && <p role="alert" style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</p>}
  </Modal>;
}
