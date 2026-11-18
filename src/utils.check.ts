/// <reference types="node" />
// Run: node src/utils.check.ts
import assert from 'node:assert/strict';
import { DEFAULT_FILTERS, formatDue, hasFilters, matchesCard, planMove } from './utils.ts';
import { calendarMark, calendarTasksByDay, withCalendarStart, rememberColumn, previousColumn } from './taskDates.ts';
import { collectPlans, planMemberMoves, withPlan } from './plans.ts';
import { THEMES } from './constants.ts';
import type { Card } from './types';

const card = (id: string, boardId: string, columnId: string | null, order: number) =>
  ({ id, boardId, columnId, order, title: id, desc: '', tags: [], color: 'transparent', priority: 'medium', dueDate: null, createdAt: 0 }) as Card;

const cards = [
  card('a', 'b1', 'todo', 0), card('b', 'b1', 'todo', 1), card('c', 'b1', 'todo', 2),
  card('x', 'b1', null, 0), card('y', 'b1', null, 1),
  card('other', 'b2', null, 0),
];
const apply = (u: Map<string, Card>) => cards.map((c) => u.get(c.id) ?? c);
const order = (list: Card[], boardId: string, col: string | null) =>
  list.filter((c) => c.boardId === boardId && c.columnId === col).sort((p, q) => p.order - q.order).map((c) => c.id);

// Reorder within a column.
assert.deepEqual(order(apply(planMove(cards, 'a', 'todo', 2)), 'b1', 'todo'), ['b', 'c', 'a']);

// Column → backlog, then both lists are re-packed.
const moved = apply(planMove(cards, 'b', null, 1));
assert.deepEqual(order(moved, 'b1', null), ['x', 'b', 'y']);
assert.deepEqual(order(moved, 'b1', 'todo'), ['a', 'c']);
assert.deepEqual(moved.filter((c) => c.boardId === 'b1').map((c) => c.order).sort(), [0, 0, 1, 1, 2]);

// Another board's backlog card is never touched.
assert.equal(planMove(cards, 'b', null, 0).has('other'), false);

// A plan spans columns. Its active card takes priority, and completing it exposes the next due card.
const tags = withPlan(['学习'], '金融工程');
const week1 = { ...cards[0], tags, dueDate: '2026-11-29' };
const week2 = { ...cards[1], tags, dueDate: '2026-12-06', columnId: 'doing' };
const done = { ...cards[2], tags, completedAt: 1, columnId: 'done' };
const [plan] = collectPlans([week2, done, cards[3], week1], 'doing');
assert.deepEqual(plan.members.map(c => c.id), [week1.id, week2.id, done.id]);
assert.equal(plan.current?.id, week2.id);
assert.equal(plan.completed, 1);
assert.equal(collectPlans([week1, { ...week2, completedAt: 2 }], 'doing')[0].current?.id, week1.id);
assert.equal(collectPlans([done])[0].current, undefined);
assert.deepEqual(withPlan(tags, ''), ['学习']);
assert.deepEqual(withPlan(tags, '新计划'), ['学习', '计划：新计划']);

// Move a mixed-column plan before a real card, keeping completed weeks and their order.
const targetCard = card('anchor', 'b1', 'doing', 2);
let groupCards: Card[] = [week1, week2, done, targetCard];
for (const move of planMemberMoves(groupCards, plan, 'doing', targetCard.id)) {
  const updates = planMove(groupCards, move.id, move.columnId, move.targetIndex);
  groupCards = groupCards.map(c => updates.get(c.id) ?? c);
}
assert.deepEqual(order(groupCards, 'b1', 'doing'), [week1.id, week2.id, done.id, targetCard.id]);
assert.equal(groupCards.find(c => c.id === done.id)?.completedAt, 1);

// Due dates are calendar days in local time.
const d = new Date();
const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
assert.equal(formatDue(iso)?.state, 'today');

// Filters combine (AND), search is case-insensitive, and checklists are searchable.
const sample: Card = { ...cards[0], title: 'Review launch', priority: 'high', tags: ['Design'], dueDate: '2026-03-09', checklist: [{ id: 'task', title: 'Check contrast', done: false }] };
const now = new Date(2026, 2, 9, 23, 45);
assert.equal(matchesCard(sample, '  CONTRAST  ', { ...DEFAULT_FILTERS, priority: 'high', tag: 'Design', due: 'today', columnId: 'todo' }, now), true);
assert.equal(matchesCard(sample, '', { ...DEFAULT_FILTERS, priority: 'low', tag: 'Design' }, now), false);
assert.equal(matchesCard(sample, '', { ...DEFAULT_FILTERS, tag: 'Engineering' }, now), false);
assert.equal(matchesCard(sample, '', { ...DEFAULT_FILTERS, columnId: 'backlog' }, now), false);
assert.equal(matchesCard({ ...sample, columnId: null }, '', { ...DEFAULT_FILTERS, columnId: 'backlog' }, now), true);
assert.equal(matchesCard({ ...sample, dueDate: null }, '', { ...DEFAULT_FILTERS, due: 'none' }, now), true);
assert.equal(matchesCard({ ...sample, dueDate: null }, '', { ...DEFAULT_FILTERS, due: 'week' }, now), false);
assert.equal(matchesCard({ ...sample, dueDate: '2026-03-08' }, '', { ...DEFAULT_FILTERS, due: 'overdue' }, now), true);
assert.equal(matchesCard({ ...sample, dueDate: '2026-03-16' }, '', { ...DEFAULT_FILTERS, due: 'week' }, now), true);
assert.equal(matchesCard({ ...sample, dueDate: '2026-03-17' }, '', { ...DEFAULT_FILTERS, due: 'week' }, now), false);
assert.equal(matchesCard({ ...sample, completedAt: 1 }, '', { ...DEFAULT_FILTERS, due: 'overdue' }, now), false);
assert.equal(formatDue('2001-03-08', 1)?.state, 'later');
assert.equal(hasFilters(DEFAULT_FILTERS), false);
assert.equal(hasFilters({ ...DEFAULT_FILTERS, tag: 'Design' }), true);

const spanning = { ...sample, createdAt: new Date(2026, 2, 20).getTime(), dueDate: '2026-04-02', tags: withCalendarStart(tags, '2026-03-31') };
const dates = ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03'];
const visible = (c: Card) => [...calendarTasksByDay([c], dates).keys()];
assert.deepEqual(visible(spanning), dates.slice(1, 4));
assert.deepEqual(visible({ ...spanning, tags: withCalendarStart(spanning.tags, '') }), ['2026-04-02']);
assert.deepEqual(visible({ ...spanning, completedAt: 1 }), []);
assert.deepEqual(visible({ ...spanning, dueDate: null }), ['2026-03-31']);
assert.deepEqual(visible({ ...spanning, dueDate: null, tags: [] }), []);
assert.deepEqual(visible({ ...spanning, dueDate: '2026-03-30' }), ['2026-03-30']);
assert.equal(previousColumn(rememberColumn(tags, null)), '');
// Urgency follows today's date, whereas the flag follows the cell date.
assert.equal(calendarMark('2026-03-09', '2026-03-09', now).tone, 'dueToday');
assert.equal(calendarMark('2026-03-09', '2026-03-08', now).deadline, false);
assert.equal(calendarMark('2026-03-12', '2026-03-12', now).deadline, true);
assert.equal(calendarMark('2026-03-12', '2026-03-09', now).tone, 'dueSoon');
assert.equal(calendarMark('2026-03-13', '2026-03-09', now).tone, 'ordinary');
assert.equal(calendarMark('2026-03-13', '2026-03-13', now).tone, 'deadline');
assert.equal(calendarMark('2026-03-08', '2026-03-08', now).timing, '已逾期 1 天');
assert.equal(calendarMark(null, '2026-03-09', now).tone, 'ordinary');

// Undo insertion preserves the original position and repacks sibling orders after a deletion.
const removed = cards.filter((c) => c.id !== 'b');
const restoredUpdates = planMove([...removed, cards[1]], 'b', 'todo', 1);
const restored = [...removed, cards[1]].map((c) => restoredUpdates.get(c.id) ?? c);
assert.deepEqual(order(restored, 'b1', 'todo'), ['a', 'b', 'c']);
assert.equal(restoredUpdates.has('other'), false);

// Every theme keeps secondary text and primary-button text at WCAG AA (4.5:1) on all its surfaces.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
for (const t of THEMES) {
  for (const bg of [t.canvas, t.sidebar, t.surface, t.card]) {
    assert.ok(contrast(t.fgSubtle, bg) >= 4.5, `${t.id}: fgSubtle on ${bg}`);
    assert.ok(contrast(t.fgMuted, bg) >= 4.5, `${t.id}: fgMuted on ${bg}`);
  }
  assert.ok(contrast(t.accentFg, t.accent) >= 4.5, `${t.id}: accentFg on accent`);
}

console.log('utils checks passed');
