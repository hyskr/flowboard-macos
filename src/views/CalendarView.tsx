import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { Menu } from '../components/Menu';
import { Icon } from '../components/Icon';
import { cx, matchesCard, parseDay } from '../utils';
import { calendarMark, calendarStart, calendarTasksByDay, dateKey, withCalendarStart } from '../taskDates';
import type { Card } from '../types';
import s from './CalendarView.module.css';
import ui from '../components/ui.module.css';

const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
type CardAction = (card: Card) => void;

function AddTaskButton({ candidates, onAdd }: { candidates: Card[]; onAdd: (id: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [search, setSearch] = useState('');
  const term = search.trim().toLocaleLowerCase();
  const matches = candidates.filter(card => card.title.toLocaleLowerCase().includes(term));
  const choose = (card: Card) => {
    setAnchor(null);
    anchor?.focus();
    onAdd(card.id);
  };
  return <>
    <button type="button" className={cx(ui.btn, ui.sm, s.addButton)} aria-label="从这天加入已有任务"
      title={candidates.length ? '从这天加入已有任务' : '没有可加入的任务'} aria-haspopup="menu"
      aria-expanded={!!anchor} disabled={!candidates.length} onClick={event => {
        setSearch('');
        setAnchor(anchor ? null : event.currentTarget);
      }}>
      <Icon name="plus" size={14} strokeWidth={2} />加入
    </button>
    {anchor && <Menu anchor={anchor} onClose={() => setAnchor(null)}>
      <div className={s.picker}>
        <label className={s.pickerSearch}><Icon name="search" size={15} />
          <input type="search" aria-label="搜索已有任务" placeholder="搜索已有任务" value={search}
            onChange={event => setSearch(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && matches.length === 1) {
                event.preventDefault();
                choose(matches[0]);
              }
            }} />
        </label>
        <div className={s.pickerList}>
          {matches.map(card => <button key={card.id} type="button" role="menuitem" className={s.choice}
            onClick={() => choose(card)}>
            <span>{card.title}</span>
            {card.dueDate && <time dateTime={card.dueDate} title={`截止日期 ${card.dueDate}`}>{Number(card.dueDate.slice(5, 7))}/{Number(card.dueDate.slice(8))}</time>}
          </button>)}
          {!matches.length && <p className={s.noMatch}>没有匹配的任务</p>}
        </div>
      </div>
    </Menu>}
  </>;
}

function TaskRow({ card, cellDay, today, compact, complete, open }: {
  card: Card; cellDay: string; today: Date; compact?: boolean; complete: CardAction; open: CardAction;
}) {
  const mark = calendarMark(card.dueDate, cellDay, today);
  const high = card.priority === 'high';
  const meaning = [mark.dayLabel, mark.timing, high ? '手动 High' : ''].filter(Boolean).join(' · ');
  return <div className={cx(s.task, compact && s.compact, high && s.highPriority, mark.deadline && s.deadlineOccurrence, s[mark.tone])}
    style={{ '--card-marker': card.color || 'transparent' } as CSSProperties}>
    <input type="checkbox" aria-label={`完成 ${card.title}`} checked={false} onChange={() => complete(card)} />
    <button className={s.taskTitle} title={`${card.title} · ${meaning}`} aria-description={meaning}
      onClick={() => open(card)}>{card.title}</button>
    <span className={cx(s.dayMark, s[mark.tone])} role="img" aria-label={meaning} title={meaning}>
      {mark.deadline ? <Icon name="flag" size={13} strokeWidth={2} /> : <i />}
    </span>
    {!compact && mark.tone === 'pastDue' && <small className={s.overdue}>{mark.timing}</small>}
  </div>;
}

function CalendarLegend() {
  return <div id="calendar-mark-key" className={s.legendKey} aria-label="日历图例">
      <span><i className={s.ordinary} />安排日</span>
      <span><Icon name="flag" size={13} />截止日</span>
      <span><i className={s.dueToday} />今天截止</span>
      <span><i className={s.dueSoon} />未来 3 天截止</span>
      <span><i className={s.pastDue} />已逾期</span>
      <span><b>手动 High</b></span>
      <span><em />卡片自选色</span>
  </div>;
}

function DayCell({ date, today, selected, inMonth, tasks, limit, select, complete, open }: {
  date: Date; today: Date; selected: boolean; inMonth: boolean; tasks: Card[]; limit: number;
  select: (date: Date) => void; complete: CardAction; open: CardAction;
}) {
  const key = dateKey(date);
  const isToday = key === dateKey(today);
  const extra = tasks.length - limit;
  const hiddenDeadline = tasks.slice(limit).find(card => card.dueDate === key);
  const hiddenMark = hiddenDeadline && calendarMark(hiddenDeadline.dueDate, key, today);
  return <div data-date={key} className={cx(s.cell, !inMonth && s.outside, selected && s.selected)}
    onClick={event => { if (!(event.target as HTMLElement).closest('button,input')) select(date); }}>
    <div className={s.dayHead}>
      <button className={cx(s.dayNum, isToday && s.today)} aria-label={key} aria-current={isToday ? 'date' : undefined}
        aria-pressed={selected} onClick={() => select(date)}>{date.getDate()}</button>
      {extra > 0 && <button className={cx(s.more, tasks.slice(limit).some(card => card.priority === 'high') && s.moreUrgent)}
        aria-label={`查看 ${key} 全部 ${tasks.length} 项任务`} title={`查看全部 ${tasks.length} 项`}
        onClick={() => select(date)}>{hiddenMark && <Icon name="flag" size={10} className={s[hiddenMark.tone]} />}
        {limit ? '+' + extra : tasks.length + '项'}</button>}
    </div>
    {tasks.slice(0, limit).map(card => <TaskRow key={card.id} card={card} cellDay={key} today={today} compact complete={complete} open={open} />)}
  </div>;
}

export function CalendarView() {
  const [legendOpen, setLegendOpen] = useState(false);
  const selected = useFlowStore(st => st.calendarDate);
  const cards = useFlowStore(st => st.cards);
  const board = useFlowStore(st => st.activeBoardId);
  const query = useFlowStore(st => st.searchQuery);
  const filters = useFlowStore(st => st.filters);
  const { setCalendarDate, openModal, toggleCardComplete, updateCard, toast } = useFlowStore.getState();
  const [todayKey, setTodayKey] = useState(() => dateKey(new Date()));
  useEffect(() => {
    const refresh = () => setTodayKey(dateKey(new Date()));
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = window.setTimeout(refresh, next.getTime() - now.getTime());
    window.addEventListener('focus', refresh);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', refresh); };
  }, [todayKey]);
  const today = parseDay(todayKey);
  const year = selected.getFullYear(), month = selected.getMonth();
  const selectedKey = dateKey(selected);
  const days = useMemo(() => {
    const offset = new Date(year, month, 1).getDay();
    const weeks = Math.ceil((offset + new Date(year, month + 1, 0).getDate()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => new Date(year, month, 1 + i - offset));
  }, [year, month]);
  const gridRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(2);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // Keep overflow reachable from the date header; don't scroll individual days.
    const fit = () => {
      const rowHeight = grid.clientHeight / (days.length / 7);
      setLimit(grid.clientWidth / 7 < 68 ? 0 : Math.max(0, Math.min(3, Math.floor((rowHeight - 42) / 23))));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [days]);
  const openCards = useMemo(() => cards.filter(card =>
    card.boardId === board && !card.completedAt && matchesCard(card, query, filters)), [cards, board, query, filters]);
  const byDay = useMemo(() => calendarTasksByDay(openCards, days.map(dateKey)), [openCards, days]);
  const candidates = openCards.filter(card => {
    const start = calendarStart(card.tags);
    if (!card.dueDate) return start !== selectedKey;
    return card.dueDate >= selectedKey && (!start || start > selectedKey);
  }).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title, 'zh-CN'));
  const addToDay = async (id: string) => {
    const card = candidates.find(item => item.id === id);
    if (!card) return;
    try { await updateCard(id, { tags: withCalendarStart(card.tags, selectedKey) }, card); }
    catch { toast('加入日历失败，请重试', '⚠'); }
  };
  const tasks = byDay.get(selectedKey) ?? [];
  const complete = (card: Card) => { void toggleCardComplete(card.id).catch(() => toast('保存失败，请重试', '⚠')); };
  const open = (card: Card) => openModal('card', { card });
  return (
    <div className={s.calendar}>
      <div className={s.layout}>
        <section className={s.month} aria-label="月历">
          <header className={s.toolbar}>
            <h2 aria-label={`${year}年${month + 1}月`}>
              <span className={s.monthNumber}>{month + 1}<small>月</small></span>
              <span className={s.year}>{year}</span>
            </h2>
            <div className={s.nav}>
              <button type="button" className={cx(ui.btn, ui.sm, ui.ghost, s.legendButton)}
                aria-expanded={legendOpen} aria-controls="calendar-mark-key" onClick={() => setLegendOpen(open => !open)}>图例</button>
              <button className={ui.iconBtn} aria-label="上个月" onClick={() => setCalendarDate(new Date(year, month - 1, 1))}><Icon name="chevronLeft" size={15} /></button>
              <button className={cx(ui.btn, ui.sm, s.goToday)} onClick={() => setCalendarDate(new Date())}>今天</button>
              <button className={ui.iconBtn} aria-label="下个月" onClick={() => setCalendarDate(new Date(year, month + 1, 1))}><Icon name="chevronRight" size={15} /></button>
            </div>
          </header>
          {legendOpen && <CalendarLegend />}
          <div className={s.weekdays}>{weekdays.map(d => <span key={d}>周{d}</span>)}</div>
          <div ref={gridRef} className={s.grid} style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0,1fr))` }}>
            {days.map(date => <DayCell key={dateKey(date)} date={date} today={today} inMonth={date.getMonth() === month}
              selected={dateKey(date) === selectedKey} tasks={byDay.get(dateKey(date)) ?? []}
              limit={limit} select={setCalendarDate} complete={complete} open={open} />)}
          </div>
        </section>
        <aside className={s.agenda} aria-label="当天任务">
          <header className={s.agendaHead}>
            <div className={s.agendaDate}>
              <h3>{selected.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</h3>
              <span>{selected.toLocaleDateString('zh-CN', { weekday: 'long' })}</span>
            </div>
            <AddTaskButton key={selectedKey} candidates={candidates} onAdd={addToDay} />
          </header>
          {tasks.length ? tasks.map(card => <TaskRow key={card.id} card={card} cellDay={selectedKey} today={today} complete={complete} open={open} />)
            : <p className={s.emptyAgenda}>当天没有任务</p>}
        </aside>
      </div>
    </div>
  );
}
