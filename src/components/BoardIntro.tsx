import { isDesktop } from '../desktop';
import { useFlowStore, sync } from '../store/useFlowStore';
import { boardPath } from '../boardRouting';
import { Icon } from './Icon';
import { cx } from '../utils';
import ui from './ui.module.css';
import s from './BoardIntro.module.css';

export function BoardIntro() {
  const boardId = useFlowStore(st => st.activeBoardId);
  const cards = useFlowStore(st => st.cards);
  const workerStatus = useFlowStore(st => st.workerStatus);
  const st = useFlowStore.getState();
  if (!boardId) return null;
  const current = cards.filter(c => c.boardId === boardId);
  const completed = current.filter(c => c.completedAt).length;
  const share = async () => {
    try {
      if (isDesktop) {
        await st.saveSettings({workerUrl:st.workerUrl,syncInterval:st.syncInterval});
        st.toast(useFlowStore.getState().workerStatus ? '共享看板已同步' : '连接尚未恢复，修改保留在本机', useFlowStore.getState().workerStatus ? '✓' : '⚠');
        return;
      }
      await st.saveSettings({ workerUrl: st.workerUrl, syncInterval: st.syncInterval });
      if (!useFlowStore.getState().workerStatus) throw new Error('同步尚未完成，请连接云端后重试。');
      const cred = await sync.getBoardCreds(boardId);
      if (!cred) throw new Error('找不到此看板的共享配置。');
      await navigator.clipboard.writeText(`${location.origin}${boardPath(boardId)}?invite=${encodeURIComponent(boardId)}`);
      st.toast('邀请链接已复制。对方打开后，输入看板密码即可加入。');
      st.openModal('settings', { tab: 'Boards' });
    } catch (e) { st.toast((e as Error).message, '⚠'); }
  };
  return <section className={s.intro} aria-label="看板概览">
    <div><div className={s.eyebrow}>FLOWBOARD / 共事</div><h2>让确定的事，向前一步。</h2><p>{current.length - completed} 件进行中 <span>·</span> {completed} 件已完成 <span>·</span> {workerStatus ? '已连接云端' : '正在本地保存'}</p></div>
    <div className={s.actions}>
      <button className={cx(ui.btn, ui.secondary)} onClick={() => st.openModal('connect', {})}><Icon name="sparkle" size={15} /> {isDesktop ? '安装 skill' : '连接 GPT'}</button>
      <button className={cx(ui.btn, ui.secondary)} onClick={share}><Icon name="users" size={15} /> {isDesktop ? '立即同步' : '邀请协作'}</button>
    </div>
  </section>;
}
