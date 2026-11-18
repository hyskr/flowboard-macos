import { useId } from 'react';
import { planName } from '../plans';
import { useFlowStore } from '../store/useFlowStore';
import ui from './ui.module.css';

export function PlanNameInput({ boardId, value, onChange }: { boardId: string; value: string; onChange: (value: string) => void }) {
  const cards = useFlowStore(st => st.cards);
  const listId = useId();
  const names = new Set(cards.filter(card => card.boardId === boardId).map(card => planName(card.tags)).filter(Boolean));
  return <>
    <input className={ui.input} aria-label="计划名称" list={listId} placeholder="输入或选择计划" value={value} onChange={event => onChange(event.target.value)} />
    <datalist id={listId}>{Array.from(names).sort().map(name => <option key={name} value={name} />)}</datalist>
  </>;
}
