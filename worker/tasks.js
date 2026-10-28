import { generationOf, materialize } from '../src/services/crdt.ts';
import { planMove } from '../src/utils.ts';

export class TaskError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const taskTools = [
  { name: 'read_board', description: '读取共享看板、栏目、卡片和完成记录。在创建任务前读取现有卡片，更新同一张卡片。', inputSchema: { type: 'object', properties: {} } },
  { name: 'find_tasks', description: '按标题或内容搜索现有任务。', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'upsert_task', description: '创建或补充一件已确定要做的事。更新使用 cardId；新建使用稳定的 sourceKey，重试沿用原值。', inputSchema: { type: 'object', properties: { baseVersion: {type:'integer',description:'读取到的卡片 version'}, baseValues: {type:'object',description:'本次修改字段在编辑前的值'}, cardId: { type: 'string' }, sourceKey: { type: 'string' }, title: { type: 'string' }, desc: { type: 'string' }, columnId: { type: ['string', 'null'] }, priority: { type: 'string', enum: ['low', 'medium', 'high'] }, dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' }, tags: { type: 'array', items: { type: 'string' } } } } },
  { name: 'complete_task', description: '完成或重新打开卡片，保留历史记录。重复完成不会重复记账。', inputSchema: { type: 'object', properties: { baseVersion: {type:'integer',description:'读取到的卡片 version'}, baseValues: {type:'object',description:'本次修改字段在编辑前的值'}, cardId: { type: 'string' }, completed: { type: 'boolean', default: true } }, required: ['cardId'] } },
  { name: 'move_task', description: '调整任务所在栏目及顺序。', inputSchema: { type: 'object', properties: { baseVersion: {type:'integer',description:'读取到的卡片 version'}, baseValues: {type:'object',description:'本次修改字段在编辑前的值'}, cardId: { type: 'string' }, columnId: { type: ['string', 'null'] }, index: { type: 'integer', minimum: 0 } }, required: ['cardId', 'columnId'] } },
];

export function planTaskAction(state, boardId, action, args = {}) {
  const data = materialize(state);
  const board = data.boards.find(b => b.id === boardId);
  if (!board) throw new TaskError('找不到看板，请检查看板 ID 和访问密钥。', 404);
  const cards = data.cards.filter(c => c.boardId === boardId);
  const columns = data.columns.filter(c => c.boardId === boardId).sort((a, b) => a.order - b.order);
  const changes = [];
  let clock = Math.max(Date.now(), ...Object.values(state).flatMap(map => Object.values(map).map(row => (row.__ts || 0) + 1)));
  const change = (type, payload) => changes.push({ opId: crypto.randomUUID(), type, ts: clock++, clientId: 'flowboard-gpt', boardId, payload: { ...payload, boardId } });
  const activity = (card, type, extra = {}) => change('activity.create', { id: crypto.randomUUID(), cardId: card.id, cardTitle: card.title, type, ts: clock, ...extra });
  const find = id => {
    const card = cards.find(c => c.id === id);
    if (!card) throw new TaskError(state.cards[id]?.__deleted ? '这张卡片已删除，不能自动恢复。' : '找不到卡片，请重新读取看板。', 409);
    return card;
  };
  const column = id => {
    if (id !== null && !columns.some(c => c.id === id)) throw new TaskError('找不到目标栏目，请重新读取看板。');
  };
  const result = value => ({ value, changes, generation: generationOf(state, boardId) });

  if (action === 'read_board') return result({ board, columns, cards: cards.sort((a, b) => a.order - b.order), activity: data.activity.filter(e => e.boardId === boardId).sort((a, b) => b.ts - a.ts) });
  if (action === 'find_tasks') {
    const q = String(args.query || '').trim().toLowerCase();
    return result({ cards: cards.filter(c => `${c.title}\n${c.desc}`.toLowerCase().includes(q)) });
  }
  if (action === 'complete_task') {
    const card = find(args.cardId);
    if (args.completed !== undefined && typeof args.completed !== 'boolean') throw new TaskError('completed 必须为布尔值。');
    const completed = args.completed !== false;
    if (!!card.completedAt === completed) return result({ card, changed: false });
    const next = { ...card, completedAt: completed ? Date.now() : null, updatedAt: Date.now() };
    change('card.update', next);
    activity(next, completed ? 'completed' : 'reopened');
    return result({ card: next, changed: true });
  }
  if (action === 'move_task') {
    const card = find(args.cardId);
    column(args.columnId);
    const siblings = cards.filter(c => c.id !== card.id && c.columnId === args.columnId).sort((a, b) => a.order - b.order);
    const index = args.index ?? siblings.length;
    if (!Number.isInteger(index) || index < 0) throw new TaskError('index 必须是非负整数。');
    const currentIndex = cards.filter(c => c.columnId === card.columnId).sort((a, b) => a.order - b.order).findIndex(c => c.id === card.id);
    if (card.columnId === args.columnId && currentIndex === Math.min(index, siblings.length)) return result({ card, changed: false });
    const updates = planMove(cards, card.id, args.columnId, index);
    const next = { ...updates.get(card.id), updatedAt: Date.now() };
    updates.set(card.id, next);
    for (const c of updates.values()) change(c.id === card.id ? 'card.move' : 'card.update', c);
    if (card.columnId !== next.columnId) activity(next, 'moved', { fromColId: card.columnId, toColId: next.columnId, fromColName: columns.find(c => c.id === card.columnId)?.name || '待整理', toColName: columns.find(c => c.id === next.columnId)?.name || '待整理' });
    return result({ card: next, changed: true });
  }
  if (action !== 'upsert_task') throw new TaskError('未知操作。', 404);
  if (args.sourceKey !== undefined && (typeof args.sourceKey !== 'string' || !args.sourceKey.trim() || args.sourceKey.length > 180)) throw new TaskError('sourceKey 必须是 1–180 个字符的稳定标识。');
  const existing = args.cardId ? find(args.cardId) : cards.find(c => args.sourceKey && c.sourceKey === args.sourceKey);
  if (!existing && !args.sourceKey) throw new TaskError('创建任务需要 sourceKey；更新任务请使用 cardId。');
  const id = existing?.id || `task:${args.sourceKey}`;
  if (state.cards[id]?.__deleted) throw new TaskError('这张卡片已删除，请确认是否需要建立新的任务。', 409);
  const details = {};
  for (const key of ['title', 'desc', 'tags', 'color', 'priority', 'dueDate', 'checklist', 'columnId']) if (args[key] !== undefined) details[key] = args[key];
  if (details.title !== undefined && (typeof details.title !== 'string' || !details.title.trim())) throw new TaskError('标题不能为空。');
  if (details.title) details.title = details.title.trim();
  if (details.desc !== undefined && typeof details.desc !== 'string') throw new TaskError('desc 必须是文本。');
  if (details.tags !== undefined && (!Array.isArray(details.tags) || details.tags.some(t => typeof t !== 'string'))) throw new TaskError('tags 必须是文本数组。');
  if (details.priority !== undefined && !['low', 'medium', 'high'].includes(details.priority)) throw new TaskError('priority 必须为 low、medium 或 high。');
  if (details.dueDate !== undefined && details.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(details.dueDate)) throw new TaskError('截止日期格式为 YYYY-MM-DD。');
  if (details.checklist !== undefined && (!Array.isArray(details.checklist) || details.checklist.some(t => !t || typeof t.id !== 'string' || typeof t.title !== 'string' || typeof t.done !== 'boolean'))) throw new TaskError('清单条目需要 id、title 和 done。');
  const columnId = details.columnId !== undefined ? details.columnId : (existing ? existing.columnId : columns[0]?.id ?? null);
  column(columnId);
  if (existing && Object.keys(details).every(key => JSON.stringify(existing[key]) === JSON.stringify(details[key]))) return result({ card: existing, created: false, changed: false });
  if (!existing && !details.title) throw new TaskError('新任务需要标题。');
  const card = { id, boardId, columnId, title: '', desc: '', tags: [], color: 'transparent', priority: 'medium', dueDate: null, checklist: [], order: 0, createdAt: Date.now(), completedAt: null, sourceKey: args.sourceKey, ...existing, ...details, updatedAt: Date.now() };
  if (!existing || existing.columnId !== columnId) card.order = Math.max(-1, ...cards.filter(c => c.columnId === columnId && c.id !== id).map(c => c.order)) + 1;
  change(existing ? 'card.update' : 'card.create', card);
  activity(card, existing ? 'updated' : 'created', { toColId: columnId, toColName: columns.find(c => c.id === columnId)?.name || '待整理' });
  return result({ card, created: !existing, changed: true });
}
