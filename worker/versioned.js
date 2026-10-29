import { applyOp, materialize, stripMeta } from '../src/services/crdt.ts';
import { validChatSource } from '../src/chatSource.ts';
import { planMove } from '../src/utils.ts';

const fields = ['title', 'desc', 'tags', 'color', 'priority', 'dueDate', 'checklist', 'completedAt'];
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function acceptChanges(state, boardId, incoming, knownIds = new Set()) {
  const accepted = [], conflicts = [], writes = [];
  let clock = Math.max(Date.now(), ...Object.values(state).flatMap(map => Object.values(map).map(row => (row.__ts || 0) + 1)));
  const emit = (op, payload, type = op.type, id = op.opId) => {
    const next = { ...op, opId: id, type, ts: clock++, payload };
    writes.push(next); applyOp(state, next);
  };
  const activity = (op, card, type, extra = {}) => emit(op, { id: crypto.randomUUID(), boardId, cardId: card.id, cardTitle: card.title, type, ts: clock, ...extra }, 'activity.create', crypto.randomUUID());
  for (const op of incoming) {
    if (knownIds.has(op.opId)) { accepted.push(op.opId); continue; }
    if (!op.type.startsWith('card.')) { emit(op, op.payload); accepted.push(op.opId); continue; }
    const id = op.payload.id, current = state.cards[id];
    const reject = (reason, names = []) => conflicts.push({ opId: op.opId, cardId: id, boardId, reason, fields: names, local: op.payload, remote: current && !current.__deleted ? stripMeta(current) : null });
    if (op.type !== 'card.create' && (!current || current.__deleted)) { reject('deleted'); continue; }
    if (op.type === 'card.create') {
      if (op.payload.sourceChat != null && !validChatSource(op.payload.sourceChat)) {reject('invalid_source');continue;}
      if (current?.__deleted && !op.restore) { reject('deleted'); continue; }
      if (current && !current.__deleted) { accepted.push(op.opId); continue; }
      const card = { ...op.payload, version: (current?.version || 0) + 1, updatedAt: Date.now() };
      emit(op, card); activity(op, card, 'created'); accepted.push(op.opId); continue;
    }
    if (op.type === 'card.delete') {
      emit(op, { id, boardId, version: (current.version || 0) + 1 });
      activity(op, current, 'deleted'); accepted.push(op.opId); continue;
    }
    if (op.type === 'card.move') {
      if (op.payload.columnId !== null && (!state.columns[op.payload.columnId] || state.columns[op.payload.columnId].__deleted)) { reject('column_deleted'); continue; }
      const cards = materialize(state).cards;
      const index = op.payload.targetIndex;
      if (!Number.isInteger(index) || index < 0) { reject('invalid_position'); continue; }
      const moved = planMove(cards, id, op.payload.columnId, index);
      for (const card of moved.values()) emit(op, { id: card.id, boardId, columnId: card.columnId, order: card.order, version: (state.cards[card.id]?.version || 0) + 1, updatedAt: Date.now() }, 'card.update', card.id === id ? op.opId : crypto.randomUUID());
      activity(op, current, 'moved', { fromColId: current.columnId, toColId: op.payload.columnId, fromColName: state.columns[current.columnId]?.name || '待整理', toColName: state.columns[op.payload.columnId]?.name || '待整理', toIndex: index });
      accepted.push(op.opId); continue;
    }
    const patch = Object.fromEntries(fields.filter(key => Object.hasOwn(op.payload, key)).map(key => [key, op.payload[key]]));
    if (patch.completedAt && current.completedAt) patch.completedAt = current.completedAt;
    const changed = Object.keys(patch).filter(key => !equal(patch[key], current[key]));
    const stale = op.baseVersion !== (current.version || 0);
    const collisions = changed.filter(key => stale && (!op.baseValues || !Object.hasOwn(op.baseValues, key) || !equal(op.baseValues[key], current[key])));
    if (collisions.length) { reject('fields_changed', collisions); continue; }
    if (changed.length) {
      if (patch.completedAt && !current.completedAt) patch.completedAt = Date.now();
      emit(op, { id, boardId, ...Object.fromEntries(changed.map(key => [key, patch[key]])), version: (current.version || 0) + 1, updatedAt: Date.now() });
      const type = changed.includes('completedAt') ? (patch.completedAt ? 'completed' : 'reopened') : 'updated';
      activity(op, state.cards[id], type);
    } else emit(op, { id, boardId }, 'card.update');
    accepted.push(op.opId);
  }
  return { accepted, conflicts, writes, state };
}

export async function commitVersioned(db, keyHash, boardId, loadHistory, makeOps) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { snap, ops, state } = await loadHistory();
    const planned = makeOps(state);
    const outcome = acceptChanges(state, boardId, planned.ops, new Set(ops.map(op => op.opId)));
    if (!outcome.writes.length) return { ...outcome, results: planned.results, revision: snap?.snap_ts ?? 0 };
    const encoded = JSON.stringify(state);
    const revision = Math.max(Date.now(), (snap?.snap_ts || 0) + 1);
    const statements = [db.prepare(`INSERT INTO crdt_snapshots (key_hash,snap,snap_ts,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(key_hash) DO UPDATE SET snap=excluded.snap,snap_ts=excluded.snap_ts,updated_at=excluded.updated_at
      WHERE crdt_snapshots.snap_ts=? AND crdt_snapshots.snap=?`).bind(keyHash, encoded, revision, Date.now(), snap?.snap_ts ?? null, snap?.snap ?? null)];
    for (const op of outcome.writes) statements.push(db.prepare(`INSERT OR IGNORE INTO crdt_ops (op_id,key_hash,type,ts,client_id,payload,updated_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM crdt_snapshots WHERE key_hash=? AND snap_ts=? AND snap=?)`).bind(op.opId,keyHash,op.type,op.ts,op.clientId ?? null,JSON.stringify(op.payload),Date.now(),keyHash,revision,encoded));
    const saved = await db.batch(statements);
    if (saved[0].meta.changes) return { ...outcome, results: planned.results, revision };
  }
  throw new Error('看板正在更新，请稍后重试。');
}
