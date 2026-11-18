import { collectPlans } from '../plans';
import { useFlowStore } from '../store/useFlowStore';
import { Icon } from '../components/Icon';
import { Modal } from './Modal';
import s from './Modal.module.css';

export function PlanScheduleModal({ name }: { name: string }) {
  const cards = useFlowStore(st => st.cards);
  const columns = useFlowStore(st => st.columns);
  const boardId = useFlowStore(st => st.activeBoardId);
  const openModal = useFlowStore(st => st.openModal);
  const plan = collectPlans(cards.filter(card => card.boardId === boardId)).find(item => item.name === name);
  return <Modal title={name} description={plan && `已完成 ${plan.completed} / ${plan.members.length} 项`}>
    {plan ? plan.members.map(card => <button key={card.id} className={s.listRow} onClick={() => openModal('card', { card })}>
      <Icon name={card.completedAt ? 'check' : 'circle'} size={14} />
      <span className={s.scheduleTitle}>{card.title}<small>{card.completedAt ? '已完成' : columns.find(col => col.id === card.columnId)?.name ?? 'Backlog'}</small></span>
      <time className={s.scheduleDate}>{card.dueDate}</time>
    </button>) : <p>此计划中已没有任务。</p>}
  </Modal>;
}
