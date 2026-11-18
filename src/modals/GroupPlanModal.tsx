import { useState } from 'react';
import { PlanNameInput } from '../components/PlanNameInput';
import { useFlowStore } from '../store/useFlowStore';
import { cx, matchesQuery } from '../utils';
import { Modal } from './Modal';
import s from './Modal.module.css';
import ui from '../components/ui.module.css';

export function GroupPlanModal({ columnId }: { columnId: string }) {
  const boardId = useFlowStore(st => st.activeBoardId)!;
  const cards = useFlowStore(st => st.cards).filter(card => card.boardId === boardId && card.columnId === columnId);
  const { assignPlan, closeModal, toast } = useFlowStore.getState();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visible = cards.filter(card => matchesQuery(card, query.trim().toLowerCase()));
  const allSelected = visible.length > 0 && visible.every(card => selected.has(card.id));
  const chosen = cards.filter(card => selected.has(card.id));
  const toggle = (ids: string[], checked: boolean) => setSelected(current => {
    const next = new Set(current);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    return next;
  });
  const save = async () => {
    if (busy || !name.trim() || !chosen.length) return;
    const modal = useFlowStore.getState().modal;
    setBusy(true);
    try {
      await assignPlan(boardId, chosen, name.trim());
      toast(`已将 ${chosen.length} 张卡片归入「${name.trim()}」`);
      if (useFlowStore.getState().modal === modal) closeModal();
    } catch {
      setError('保存失败，请重试。');
      setBusy(false);
    }
  };
  return <Modal title="批量归入计划" onSubmit={save} footer={<>
    <button type="button" className={cx(ui.btn, ui.secondary)} onClick={closeModal}>取消</button>
    <button type="submit" className={cx(ui.btn, ui.primary)} disabled={busy || !name.trim() || !chosen.length}>归入计划（{chosen.length}）</button>
  </>}>
    <div className={ui.field}>
      <span className={ui.label}>计划名称</span>
      <PlanNameInput boardId={boardId} value={name} onChange={setName} />
    </div>
    <div className={ui.field}>
      <label className={ui.label} htmlFor="plan-search">栏目内的卡片</label>
      <input id="plan-search" className={ui.input} value={query} onChange={e => setQuery(e.target.value)} placeholder="按标题、标签或内容查找" />
    </div>
    {visible.length > 0 ? <>
      <label className={cx(s.listRow, s.selectAll)}><input type="checkbox" checked={allSelected} onChange={e => toggle(visible.map(card => card.id), e.target.checked)} />全选当前结果（{visible.length}）</label>
      {visible.map(card => <label key={card.id} className={s.listRow}>
        <input type="checkbox" checked={selected.has(card.id)} onChange={e => toggle([card.id], e.target.checked)} />
        {card.title}
      </label>)}
    </> : <p className={ui.hint}>没有匹配的卡片</p>}
    {error && <p role="alert" className={s.error}>{error}</p>}
  </Modal>;
}
