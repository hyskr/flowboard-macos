import { useEffect, useRef, useState } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useFlowStore } from '../store/useFlowStore';
import { CARD_COLORS } from '../constants';
import { cx } from '../utils';
import { Icon } from './Icon';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu';
import { InlineInput } from './InlineInput';
import { PlanCard } from './PlanSummary';
import type { Plan } from '../plans';
import { CardView, SortableCard } from './Card';
import type { Card, Column } from '../types';
import s from './Column.module.css';
import ui from './ui.module.css';

export function SortableColumn({ col, cards, totalCount, listCount, plans }: { col: Column; cards: Card[]; totalCount: number; listCount: number; plans: Map<string, Plan> }) {
  const { openModal, updateColumn, deleteColumn, toast } = useFlowStore.getState();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: col.id,
    data: { type: 'Column' },
  });
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [point,setPoint]=useState<{x:number;y:number}|undefined>();

  const confirmDelete = () => openModal('confirm', {
    title: `Delete “${col.name}”?`,
    message: totalCount ? `Its ${totalCount} card${totalCount === 1 ? '' : 's'} will move to the backlog.` : 'This column is empty.',
    confirmLabel: 'Delete column',
    onConfirm: async () => { await deleteColumn(col.id); toast('Column deleted', '🗑'); },
  });

  return (
    <section
      onContextMenu={event=>{if((event.target as HTMLElement).closest('input,textarea'))return;event.preventDefault();event.stopPropagation();setPoint({x:event.clientX,y:event.clientY});setMenu(event.currentTarget);}}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx(s.column, isDragging && s.placeholder)}
      aria-label={col.name}
    >
      <header className={s.header}>
        <div className={s.handle} {...attributes} {...listeners} aria-roledescription="Draggable column">
          <span className={s.dot} style={{ background: col.color }} />
          {renaming ? (
            <InlineInput
              className={s.renameInput}
              ariaLabel="Column name"
              value={col.name}
              onCommit={(name) => { updateColumn(col.id, { name }); setRenaming(false); }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <h3 className={s.name} onDoubleClick={() => setRenaming(true)} title="Double-click to rename">{col.name}</h3>
          )}
          <span className={ui.count} title={`${totalCount} cards in this column`}>{cards.length === listCount ? cards.length : `${cards.length}/${listCount}`}</span>
        </div>
        <button className={cx(ui.iconBtn, ui.small, s.action, menu && s.actionActive)} onClick={(e) => {setPoint(undefined);setMenu(menu ? null : e.currentTarget);}} aria-label={`Options for ${col.name}`} aria-haspopup="menu">
          <Icon name="more" size={15} />
        </button>
      </header>

      <div className={s.list}>
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => <SortableCard key={card.id} card={card} plan={plans.get(card.id)} />)}
        </SortableContext>
        {cards.length === 0 && !adding && <div className={s.empty}><Icon name={listCount ? 'filter' : 'plus'} size={18} /><span>{listCount ? 'No matching cards' : 'No cards yet'}</span><small>{listCount ? 'Adjust your filters to see more.' : 'Drag a card here or add one below.'}</small></div>}
        {adding && <QuickAdd boardId={col.boardId} columnId={col.id} onDone={() => setAdding(false)} />}
      </div>

      {!adding && (
        <button className={s.addCard} onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} /> 新增卡片
        </button>
      )}

      {menu && (
        <Menu anchor={menu} point={point} onClose={() => setMenu(null)}>
          <MenuItem icon="pencil" onClick={() => { setMenu(null); setRenaming(true); }}>Rename</MenuItem>
          <MenuItem icon="plus" onClick={() => { setMenu(null); setAdding(true); }}>Add card</MenuItem>
          {totalCount > 0 && <MenuItem icon="checklist" onClick={() => { setMenu(null); openModal('groupPlan', { columnId: col.id }); }}>批量归入计划…</MenuItem>}
          <MenuSeparator />
          <MenuLabel>Color</MenuLabel>
          <div className={cx(ui.swatches, s.menuSwatches)}>
            {CARD_COLORS.filter((c) => c.value !== 'transparent').map((c) => (
              <button
                key={c.value}
                className={cx(ui.swatch, col.color === c.value && ui.selected)}
                style={{ background: c.value }}
                aria-label={c.name}
                onClick={() => updateColumn(col.id, { color: c.value })}
              />
            ))}
          </div>
          <MenuSeparator />
          <MenuItem icon="trash" danger onClick={() => { setMenu(null); confirmDelete(); }}>Delete column</MenuItem>
        </Menu>
      )}
    </section>
  );
}

function QuickAdd({ boardId, columnId, onDone }: { boardId: string; columnId: string | null; onDone: () => void }) {
  const createCard = useFlowStore((st) => st.createCard);
  const [title, setTitle] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }); }, [title]);

  const submit = async () => {
    if (!title.trim()) return onDone();
    await createCard(boardId, columnId, { title: title.trim() });
    setTitle('');
  };

  return (
    <div className={s.quickAdd}>
      <textarea
        ref={ref}
        autoFocus
        rows={2}
        className={s.quickInput}
        placeholder="Card title…"
        aria-label="New card title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && onDone()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.stopPropagation(); onDone(); }
        }}
      />
      <div className={s.quickActions}>
        <button className={cx(ui.btn, ui.primary, ui.sm)} onMouseDown={(e) => e.preventDefault()} onClick={submit}>Add card</button>
        <button className={cx(ui.btn, ui.ghost, ui.sm)} onClick={onDone}>Cancel</button>
        <span className={s.quickHint}><kbd className={ui.kbd}>↵</kbd> to add</span>
      </div>
    </div>
  );
}

export function ColumnOverlay({ col, cards, plans, columns }: { col: Column; cards: Card[]; plans: Map<string, Plan>; columns: Column[] }) {
  return (
    <section className={cx(s.column, s.overlay)}>
      <header className={s.header}>
        <div className={s.handle}>
          <span className={s.dot} style={{ background: col.color }} />
          <h3 className={s.name}>{col.name}</h3>
          <span className={ui.count}>{cards.length}</span>
        </div>
      </header>
      <div className={s.list}>
        {cards.map(card => {
          const plan = plans.get(card.id);
          return plan ? <PlanCard key={card.id} plan={plan} columns={columns} /> : <CardView key={card.id} card={card} />;
        })}
      </div>
    </section>
  );
}
