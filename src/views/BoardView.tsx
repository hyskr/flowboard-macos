import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor, TouchSensor,
  closestCenter, getFirstCollision, pointerWithin, rectIntersection, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useFlowStore } from '../store/useFlowStore';
import { SortableColumn, ColumnOverlay } from '../components/Column';
import { CardView } from '../components/Card';
import { Backlog, BACKLOG_ID } from '../components/Backlog';
import { PlanCard } from '../components/PlanSummary';
import { doneColumn } from '../taskDates';
import { collectPlans, planName, type Plan } from '../plans';
import { InlineInput } from '../components/InlineInput';
import { Icon, Logo } from '../components/Icon';
import { cx, hasFilters, matchesCard } from '../utils';
import type { Card } from '../types';
import s from './BoardView.module.css';
import ui from '../components/ui.module.css';

/** Container id (column id or BACKLOG_ID) → ordered visible card ids. */
type Items = Record<string, string[]>;

const byOrder = (a: Card, b: Card) => a.order - b.order;
const findContainer = (items: Items, id: UniqueIdentifier) =>
  id in items ? String(id) : Object.keys(items).find((k) => items[k].includes(String(id)));

export function BoardView() {
  const cards = useFlowStore((st) => st.cards);
  const allColumns = useFlowStore((st) => st.columns);
  const activeBoardId = useFlowStore((st) => st.activeBoardId);
  const backlogOpen = useFlowStore((st) => st.backlogOpen);
  const query = useFlowStore((st) => st.searchQuery).trim().toLowerCase();
  const filters = useFlowStore((st) => st.filters);
  const { moveCard, movePlan, reorderColumns, toggleBacklog, openModal } = useFlowStore.getState();

  const columns = useMemo(
    () => allColumns.filter((c) => c.boardId === activeBoardId).sort((a, b) => a.order - b.order),
    [allColumns, activeBoardId],
  );
  const columnIds = useMemo(() => new Set<UniqueIdentifier>(columns.map((c) => c.id)), [columns]);
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const doing = columns.find(col => col.id === 'column-1') ?? columns.find(col => col.name === '进行中');
  const boardCards = useMemo(() => cards.filter(card => card.boardId === activeBoardId), [cards, activeBoardId]);
  const archiveId = doneColumn(columns)?.id;
  const filtered = !!query || hasFilters(filters);
  const plans = useMemo(() => {
    const rows = new Map<string, Plan>();
    if (!filtered) for (const plan of collectPlans(boardCards, doing?.id)) {
      rows.set((plan.current ?? plan.members.find(card => card.columnId === archiveId) ?? plan.members[0]).id, plan);
    }
    return rows;
  }, [boardCards, doing?.id, filtered, archiveId]);
  const listCards = useMemo(() => {
    if (filtered) return boardCards;
    const ongoing = new Set([...plans.values()].filter(plan => plan.current).map(plan => plan.name));
    return boardCards.filter(card => {
      const name = planName(card.tags);
      return !name || plans.has(card.id) || (!!card.completedAt && card.columnId === archiveId && ongoing.has(name));
    });
  }, [filtered, boardCards, plans, archiveId]);
  const baseItems = useMemo(() => {
    const items: Items = { [BACKLOG_ID]: [] };
    for (const col of columns) items[col.id] = [];
    for (const c of listCards.filter((c) => matchesCard(c, query, filters)).sort(byOrder)) {
      items[c.columnId ?? BACKLOG_ID]?.push(c.id);
    }
    return items;
  }, [listCards, columns, query, filters]);

  // Keep a local layout during dragging and saving so cards never flash back to their old position.
  const [dragItems, setDragItems] = useState<Items | null>(null);
  const [active, setActive] = useState<{ id: string; type: 'Card' | 'Column' } | null>(null);
  const items = dragItems ?? baseItems;
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const recentlyMoved = useRef(false);

    useEffect(() => {
    const frame = requestAnimationFrame(() => { recentlyMoved.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [dragItems]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  // Multi-container strategy (from the dnd-kit examples): prefer the card under the pointer,
  // and when over a container, snap to its closest card so the insertion point is stable.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    if (active?.type === 'Column') {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => columnIds.has(c.id)) });
    }
    // Only keyboard drags (no pointer) use rect intersection. With a pointer in the gap between
    // columns, intersecting the dragged card's rect flips between both neighbours after every
    // move and loops forever, so we keep the last target instead.
    let overId = getFirstCollision(args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args), 'id');
    if (overId != null) {
      const inside = overId in items ? items[overId] : null;
      if (inside?.length) {
        overId = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => inside.includes(String(c.id))),
        })[0]?.id ?? overId;
      }
      lastOverId.current = overId;
      return [{ id: overId }];
    }
    if (recentlyMoved.current) lastOverId.current = args.active.id;
    return lastOverId.current ? [{ id: lastOverId.current }] : [];
  }, [active, items, columnIds]);

  const onDragStart = ({ active: a }: DragStartEvent) => {
    const type = a.data.current?.type === 'Column' ? 'Column' : 'Card';
    setActive({ id: String(a.id), type });
    lastOverId.current = null;
    if (type === 'Card') setDragItems(baseItems);
  };

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over || a.data.current?.type === 'Column') return;
    if (over.id === BACKLOG_ID && !backlogOpen) toggleBacklog();
    setDragItems((prev) => {
      if (!prev) return prev;
      const from = findContainer(prev, a.id);
      const to = findContainer(prev, over.id);
      if (!from || !to || from === to) return prev;
      const target = prev[to];
      let index = target.length;
      if (!(over.id in prev)) {
        const r = a.rect.current.translated;
        const after = r && (to === BACKLOG_ID
          ? r.left + r.width / 2 > over.rect.left + over.rect.width / 2
          : r.top + r.height / 2 > over.rect.top + over.rect.height / 2);
        const overIndex = target.indexOf(String(over.id));
        if (overIndex >= 0) index = overIndex + (after ? 1 : 0);
      }
      recentlyMoved.current = true;
      return {
        ...prev,
        [from]: prev[from].filter((id) => id !== a.id),
        [to]: [...target.slice(0, index), String(a.id), ...target.slice(index)],
      };
    });
  };

  const commitCard = (id: string, container: string, list: string[]) => {
    const card = cardsById.get(id);
    if (!card) return;
    const columnId = container === BACKLOG_ID ? null : container;
    // The visible list may be filtered by search, so anchor on the next visible card to find the real index.
    const nextId = list[list.indexOf(id) + 1];
    const plan = plans.get(id);
    if (plan) return movePlan(card.boardId, plan.name, columnId, nextId);
    const siblings = cards.filter((c) => c.boardId === card.boardId && c.columnId === columnId && c.id !== id).sort(byOrder);
    const found = nextId ? siblings.findIndex((c) => c.id === nextId) : -1;
    const index = found >= 0 ? found : siblings.length;
    const currentIndex = card.columnId === columnId
      ? cards.filter((c) => c.boardId === card.boardId && c.columnId === columnId).sort(byOrder).indexOf(card)
      : -1;
    if (index !== currentIndex) return moveCard(id, columnId, index);
  };

  // Let dnd-kit finish the drop only after the local layout has been persisted.
  const cancelDrop = async ({ active: a, over }: DragEndEvent) => {
    try {
      if (over && a.data.current?.type === 'Column') {
        const from = columns.findIndex((c) => c.id === a.id);
        const to = columns.findIndex((c) => c.id === over.id);
        if (from >= 0 && to >= 0 && from !== to) await reorderColumns(arrayMove(columns, from, to).map((c) => c.id));
      } else if (over && dragItems) {
        const container = findContainer(dragItems, a.id);
        if (container) {
          let list = dragItems[container];
          const from = list.indexOf(String(a.id));
          const to = list.indexOf(String(over.id));
          if (to >= 0 && from !== to) list = arrayMove(list, from, to);
          setDragItems({ ...dragItems, [container]: list });
          if (baseItems[container]?.indexOf(String(a.id)) !== list.indexOf(String(a.id))) {
            await commitCard(String(a.id), container, list);
          }
        }
      }
      return false;
    } catch {
      useFlowStore.getState().toast('Couldn’t save the move. Try again.', '⚠');
      return true;
    } finally {
      setActive(null);
      setDragItems(null);
    }
  };

  const onDragCancel = () => { setActive(null); setDragItems(null); };

  const cardsIn = (container: string) => (items[container] ?? []).map((id) => cardsById.get(id)).filter((c): c is Card => !!c);

  if (!activeBoardId) {
    return (
      <div className={s.welcome}>
        <Logo size={52} />
        <h2>一张看板，把事情放在一起。</h2>
        <p>保存待办，拖动进度，勾选完成。邀请他人，共同推进。</p>
        <button className={cx(ui.btn, ui.primary)} onClick={() => openModal('addBoard', {})}>
          <Icon name="plus" size={15} /> 创建共享看板
        </button>
      </div>
    );
  }

  const activeCol = active?.type === 'Column' ? columns.find((c) => c.id === active.id) : undefined;
  const activeCard = active?.type === 'Card' ? cardsById.get(active.id) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      cancelDrop={cancelDrop}
      onDragCancel={onDragCancel}
    >
        <div className={s.board}>
          {(hasFilters(filters) || query) && Object.values(baseItems).every((list) => !list.length) && <div className={s.noResults}><Icon name="search" size={16} /><span>No cards match these filters.</span><button className={cx(ui.btn, ui.ghost, ui.sm)} onClick={() => useFlowStore.getState().clearFilters()}>Clear filters</button></div>}
          <div className={s.columns}>
          <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
              {columns.map(col => <SortableColumn key={col.id} col={col} cards={cardsIn(col.id)} plans={plans}
                totalCount={boardCards.filter(c => c.columnId === col.id).length}
                listCount={listCards.filter(c => c.columnId === col.id).length} />)}
          </SortableContext>
          <AddColumn boardId={activeBoardId} />
        </div>
          <Backlog cards={cardsIn(BACKLOG_ID)} plans={plans} totalCount={listCards.filter(c => c.columnId === null).length} />
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {activeCol ? <ColumnOverlay col={activeCol} cards={cardsIn(activeCol.id)} plans={plans} columns={columns} />
            : activeCard && plans.has(activeCard.id) ? <PlanCard plan={plans.get(activeCard.id)!} columns={columns} variant="overlay" />
            : activeCard ? <CardView card={activeCard} variant="overlay" compact={activeCard.columnId === null} />
          : null}
      </DragOverlay>
    </DndContext>
  );
}

function AddColumn({ boardId }: { boardId: string }) {
  const createColumn = useFlowStore((st) => st.createColumn);
  const [adding, setAdding] = useState(false);
  if (!adding) {
    return (
      <button data-add-column className={s.addColumn} onClick={() => setAdding(true)}>
        <Icon name="plus" size={15} /> 添加栏目
      </button>
    );
  }
  return (
    <div className={s.newColumn}>
      <InlineInput
        className={ui.input}
        ariaLabel="New column name"
        placeholder="Column name…"
        value=""
        onCommit={(name) => { createColumn(boardId, name); setAdding(false); }}
        onCancel={() => setAdding(false)}
      />
      <p className={ui.hint}>Enter to create · Esc to cancel</p>
    </div>
  );
}
