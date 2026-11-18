import { useState, type HTMLAttributes, type Ref } from 'react';
import type { Column } from '../types';
import type { Plan } from '../plans';
import { useFlowStore } from '../store/useFlowStore';
import { cx, parseDay } from '../utils';
import { Icon } from './Icon';
import s from './Card.module.css';

export function PlanCard({ plan, columns, variant, handle, handleRef }: {
  plan: Plan; columns: Column[]; variant?: 'overlay' | 'placeholder'; handle?: HTMLAttributes<HTMLElement>; handleRef?: Ref<HTMLElement>;
}) {
  const { openModal, updateCard, toast } = useFlowStore.getState();
  const [busy, setBusy] = useState(false);
  const card = plan.current;
  const status = columns.find(column => column.id === card?.columnId)?.name ?? 'Backlog';
  const complete = async () => {
    if (!card || busy) return;
    setBusy(true);
    const completedAt = Date.now();
    try {
      await updateCard(card.id, { completedAt }, card);
      toast(`已完成「${card.title}」`, '✓', { label: '撤销', run: async () => {
        const latest = useFlowStore.getState().cards.find(c => c.id === card.id);
        if (latest?.completedAt) await updateCard(card.id, { completedAt: null }, latest);
      } });
    } catch { toast('保存失败，请重试', '⚠'); }
    finally { setBusy(false); }
  };
  return <article aria-label={plan.name} className={cx(s.card, s.plan, variant && s[variant])}>
    <header ref={handleRef} {...handle} className={s.planHead}>
      <h4 className={s.title}>{plan.name}</h4>
      <span className={s.checklist} aria-label={`已完成 ${plan.completed} 项，共 ${plan.members.length} 项`}>{plan.completed}/{plan.members.length}</span>
    </header>
    {card ? <div className={s.planTask}>
      <input type="checkbox" aria-label={`完成 ${card.title}`} checked={false} disabled={busy} onChange={complete} />
      <div>
        <button className={s.planTitle} onClick={() => openModal('card', { card })}>{card.title}</button>
        <div className={s.planMeta}>
          <span>{status}</span>
          {card.dueDate && <time dateTime={card.dueDate}>{parseDay(card.dueDate).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}截止</time>}
        </div>
      </div>
    </div> : <span className={s.completedLabel}>全部完成</span>}
    <button className={s.planLink} onClick={() => openModal('planSchedule', { name: plan.name })}>
      查看全部 {plan.members.length} 项<Icon name="chevronRight" size={14} />
    </button>
  </article>;
}
