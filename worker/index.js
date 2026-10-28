/**
 * FlowBoard Cloudflare Worker — D1 backend
 *
 * Replaces KV with D1 (SQLite). API surface identical to KV version.
 * TTL enforced by scheduled cron (0 3 * * *) pruning boards idle for 90 days.
 *
 * ── Legacy endpoints (full-state sync, unchanged) ────────────────────────────
 *   POST /api/board/get               — fetch board  { boardId, keyHash }
 *   POST /api/board/put               — save board   { boardId, keyHash, data }
 *   POST /api/board/touch             — renew TTL    { boardId, keyHash }
 *   GET  /api/invite/:boardId         — returns boardId (for invite link resolution)
 *
 * ── CRDT endpoints (operation-log sync) ──────────────────────────────────────
 *   POST /api/crdt/ops/push           — append ops   { boardId, keyHash, ops: [...] }
 *   POST /api/crdt/ops/pull           — fetch ops    { boardId, keyHash, since: <ts> }
 *   POST /api/crdt/state/get          — materialized { boardId, keyHash }
 *   POST /api/crdt/state/snapshot     — force snapshot (GC old ops) { boardId, keyHash }
 *
 * D1 binding: flowboard_db  (configure in wrangler.toml)
 * Schema:     migrations/schema.sql
 */

const TTL_MS           = 90 * 24 * 60 * 60 * 1000;  // 90 days
const GC_MAX_AGE_MS    = 30 * 24 * 60 * 60 * 1000;  // prune ops > 30 days on snapshot
const SNAPSHOT_EVERY   = 200;                         // auto-snapshot every N ops

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}


// Shared conflict rules keep the server, local edits and remote reads convergent.
import { SYNC_PROTOCOL, applyOp, emptyState, materialize, settle, validId, validOp } from '../src/services/crdt.ts';
import { acceptChanges, commitVersioned } from './versioned.js';
import { TaskError, planTaskAction } from './tasks.js';

// Replay ops in ts order onto a state (empty by default)
function replayOps(ops, state = emptyState()) {
  for (const op of [...ops].sort((a, b) => a.ts - b.ts || (a.opId > b.opId ? 1 : -1))) applyOp(state, op);
  return settle(state);
}

// ── D1 helpers ────────────────────────────────────────────────────────────────

const now = () => Date.now();

// ---- Legacy boards table ----

async function boardGet(db, keyHash) {
  const row = await db.prepare(
    'SELECT data FROM boards WHERE key_hash = ?'
  ).bind(keyHash).first();
  return row ? JSON.parse(row.data) : null;
}

async function boardTouch(db, keyHash) {
  // A JSON null row records activity for CRDT-only boards without inventing a legacy copy.
  await db.prepare(`INSERT INTO boards (key_hash, data, updated_at)
    SELECT ?, 'null', ? WHERE EXISTS (SELECT 1 FROM boards WHERE key_hash = ?)
      OR EXISTS (SELECT 1 FROM crdt_ops WHERE key_hash = ?)
      OR EXISTS (SELECT 1 FROM crdt_snapshots WHERE key_hash = ?)
    ON CONFLICT(key_hash) DO UPDATE SET updated_at = excluded.updated_at`
  ).bind(keyHash, now(), keyHash, keyHash, keyHash).run();
}

// ---- CRDT ops table ----

// A D1 batch is a transaction: GC cannot occur between these two reads.
async function readHistory(db, keyHash) {
  const [snap, log] = await db.batch([
    db.prepare('SELECT snap, snap_ts FROM crdt_snapshots WHERE key_hash = ?').bind(keyHash),
    db.prepare('SELECT op_id, type, ts, client_id, payload FROM crdt_ops WHERE key_hash = ? ORDER BY ts ASC').bind(keyHash),
  ]);
  return { snap: snap.results[0], ops: log.results.map(r => ({
    opId: r.op_id, type: r.type, ts: r.ts, clientId: r.client_id, payload: JSON.parse(r.payload),
  })) };
}

async function opsGetSince(db, keyHash, since) {
  const { results } = await db.prepare(
    'SELECT op_id, type, ts, client_id, payload FROM crdt_ops WHERE key_hash = ? AND ts > ? ORDER BY ts ASC'
  ).bind(keyHash, since).all();
  return results.map(r => ({
    opId:     r.op_id,
    type:     r.type,
    ts:       r.ts,
    clientId: r.client_id,
    payload:  JSON.parse(r.payload),
  }));
}

async function opsCount(db, keyHash) {
  const row = await db.prepare(
    'SELECT COUNT(*) AS cnt FROM crdt_ops WHERE key_hash = ?'
  ).bind(keyHash).first();
  return row ? row.cnt : 0;
}

// Insert new ops — skip existing opIds (idempotent)
// Current map-state (null if the board has no CRDT data): snapshot + replay every stored op.
// Not just ops newer than the snapshot — op ts is the client's clock, so ops made offline can arrive
// after a snapshot with an older ts. Re-applying ops already in the snapshot is a no-op under LWW.
async function buildState(db, keyHash) {
  const { snap, ops } = await readHistory(db, keyHash);
  if (!snap && !ops.length) return null;
  return replayOps(ops, snap ? JSON.parse(snap.snap) : undefined);
}

// Force snapshot + prune old ops (GC). The snapshot carries the pruned history forward.
async function doSnapshot(db, keyHash) {
  const { snap, ops } = await readHistory(db, keyHash);
  if (!snap && !ops.length) return;
  const state = replayOps(ops, snap ? JSON.parse(snap.snap) : undefined);
  const encoded = JSON.stringify(state);
  const ts = Math.max(now(), (snap?.snap_ts ?? 0) + 1);
  // CAS rejects a snapshot based on superseded history. Snapshot and GC commit together.
  const writes = [db.prepare(`INSERT INTO crdt_snapshots (key_hash, snap, snap_ts, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key_hash) DO UPDATE SET snap = excluded.snap, snap_ts = excluded.snap_ts, updated_at = excluded.updated_at
    WHERE crdt_snapshots.snap_ts = ? AND crdt_snapshots.snap = ?`
  ).bind(keyHash, encoded, ts, now(), snap?.snap_ts ?? null, snap?.snap ?? null)];
  const prune = ops.filter(o => o.ts < now() - GC_MAX_AGE_MS);
  // Delete only captured IDs, never a time range containing newly arrived offline work.
  for (let i = 0; i < prune.length; i += 50) {
    const ids = prune.slice(i, i + 50).map(o => o.opId);
    writes.push(db.prepare(`DELETE FROM crdt_ops WHERE key_hash = ? AND op_id IN (${ids.map(() => '?').join(',')})
      AND EXISTS (SELECT 1 FROM crdt_snapshots WHERE key_hash = ? AND snap_ts = ? AND snap = ?)`
    ).bind(keyHash, ...ids, keyHash, ts, encoded));
  }
  await db.batch(writes);
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handleRequest(request, env) {
  const url  = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // Invite link — no auth needed, just echo boardId
  const inviteMatch = path.match(/^\/api\/invite\/([^/]+)$/);
  if (inviteMatch) return json({ boardId: decodeURIComponent(inviteMatch[1]) });

  if (request.method !== 'POST') return err('Method not allowed', 405);

  let body;
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 1024 * 1024) return err('Request too large', 413);
  try { body = JSON.parse(text); } catch { return err('Invalid JSON body'); }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return err('Invalid request body');
  const { boardId, keyHash } = body;
  if (!validId(boardId) || typeof keyHash !== 'string') return err('boardId and keyHash required');
  if (!/^[0-9a-f]{64}$/.test(keyHash)) return err('Invalid keyHash');

  // Old tabs must not bypass the current deletion rules. Failed writes leave their outboxes intact.
  if (['/api/crdt/ops/push', '/api/board/put'].includes(path) && body.protocolVersion !== SYNC_PROTOCOL) {
    return err('Reload FlowBoard to update before syncing changes.', 409);
  }

  const db = env.flowboard_db;

  const loadCurrent = async () => {
    const history = await readHistory(db, keyHash);
    return { ...history, state: replayOps(history.ops, history.snap ? JSON.parse(history.snap.snap) : undefined) };
  };
  if (path === '/api/sync/commit') {
    if (body.protocolVersion !== SYNC_PROTOCOL) return err('请更新应用后同步。', 409);
    if (!Array.isArray(body.ops) || body.ops.length > 100 || body.ops.some(op => !validOp(op, boardId))) return err('Invalid operations');
    const outcome = await commitVersioned(db,keyHash,boardId,loadCurrent,() => ({ops:body.ops}));
    return json({revision:outcome.revision,accepted:outcome.accepted,conflicts:outcome.conflicts,state:outcome.state,protocolVersion:SYNC_PROTOCOL});
  }
  if (path === '/api/sync/revision') {
    const row = await db.prepare('SELECT snap_ts FROM crdt_snapshots WHERE key_hash = ?').bind(keyHash).first();
    return json({ revision: row?.snap_ts ?? 0 });
  }
  if (path === '/api/tasks/read') {
    const state = (await loadCurrent()).state;
    if (!state.boards[boardId]) return err('找不到看板。',404);
    return json(planTaskAction(state,boardId,'read_board').value);
  }
  if (path === '/api/tasks/batch') {
    if (body.protocolVersion !== SYNC_PROTOCOL) return err('请更新 FlowBoard 应用和 skill 后提交。',409);
    if (!Array.isArray(body.actions) || !body.actions.length || body.actions.length > 20) return err('actions 需要包含 1–20 项操作。');
    const outcome = await commitVersioned(db,keyHash,boardId,loadCurrent,state => {
      const ops = [], results = [], draft = structuredClone(state);
      for (const item of body.actions) {
        const from = ops.length;
        const args = item.args || {};
        const op = {opId:item.requestId || crypto.randomUUID(),type:'card.update',ts:0,clientId:'flowboard-gpt',boardId,baseVersion:args.baseVersion,baseValues:args.baseValues,payload:{id:args.cardId,boardId}};
        if (item.action === 'complete_task') op.payload.completedAt = args.completed === false ? null : Date.now();
        else if (item.action === 'move_task') {op.type='card.move';op.payload={...op.payload,columnId:args.columnId,targetIndex:args.index ?? Object.values(draft.cards).filter(c => !c.__deleted && c.columnId === args.columnId).length};}
        else {
          const plan = planTaskAction(draft,boardId,item.action,args);
          const cardOp = plan.changes.find(change => change.type.startsWith('card.'));
          if (!cardOp) {results.push(plan.value);continue;}
          op.type=cardOp.type;
          op.payload=op.type === 'card.create' ? cardOp.payload : {id:cardOp.payload.id,boardId,...Object.fromEntries(['title','desc','tags','color','priority','dueDate','checklist'].filter(key=>Object.hasOwn(args,key)).map(key=>[key,args[key]]))};
          if (args.columnId !== undefined && op.type !== 'card.create') ops.push({...op,opId:crypto.randomUUID(),type:'card.move',payload:{id:op.payload.id,boardId,columnId:args.columnId,targetIndex:0}});
        }
        if (op.type === 'card.update' && !Number.isInteger(args.baseVersion)) throw new TaskError('更新任务需要读取卡片的 version，并传 baseVersion 和所改字段的 baseValues。',409);
        ops.push(op);
        results.push({cardId:op.payload.id});
        acceptChanges(draft,boardId,ops.slice(from));
      }
      return {ops,results};
    });
    return json({ok:!outcome.conflicts.length,results:outcome.results?.map(result => result.cardId ? {card:materialize(outcome.state).cards.find(card => card.id === result.cardId)} : result),conflicts:outcome.conflicts,operations:outcome.writes.length,cards:materialize(outcome.state).cards},outcome.conflicts.length ? 409 : 200);
  }

  // ── GET board ──────────────────────────────────────────
  // `data` is the legacy full-state row (possibly encrypted, and only as fresh as its last
  // full push) or, if there is none, the live CRDT state. `crdt` is always the live state,
  // for the client to apply on top of `data`.
  if (path === '/api/board/get') {
    await boardTouch(db, keyHash);
    const [legacy, mapState] = await Promise.all([boardGet(db, keyHash), buildState(db, keyHash)]);
    if (!legacy && !mapState) return json({ found: false, protocolVersion: SYNC_PROTOCOL });
    const crdt = mapState && materialize(mapState);
    // Compatibility with boards reconciled by older releases: never reapply their stale full-state rows.
    const reconciled = !!mapState?.boards[boardId]?.syncProtocol;
    return json({ found: true, data: reconciled ? crdt : legacy ?? crdt, crdt, state: mapState, protocolVersion: SYNC_PROTOCOL });
  }

  // ── PUT board ──────────────────────────────────────────
  if (path === '/api/board/put') return err('请使用带卡片版本的同步接口。',409);

  // ── TOUCH ──────────────────────────────────────────────
  if (path === '/api/board/touch') {
    await boardTouch(db, keyHash);
    if (!await boardGet(db, keyHash) && !await buildState(db, keyHash)) return json({ found: false });
    return json({ ok: true });
  }

  // ── CRDT push ops ──────────────────────────────────────
  if (path === '/api/crdt/ops/push') return err('请使用带卡片版本的同步接口。',409);
  // ── CRDT pull ops since ────────────────────────────────
  if (path === '/api/crdt/ops/pull') {
    await boardTouch(db, keyHash);
    const since = typeof body.since === 'number' ? body.since : 0;
    const ops   = await opsGetSince(db, keyHash, since);
    return json({ ops });
  }

  // ── CRDT materialized state ────────────────────────────
  if (path === '/api/crdt/state/get') {
    await boardTouch(db, keyHash);
    const mapState = await buildState(db, keyHash);
    return json(mapState ? { found: true, data: materialize(mapState), state: mapState, protocolVersion: SYNC_PROTOCOL } : { found: false, protocolVersion: SYNC_PROTOCOL });
  }

  // ── CRDT force snapshot ────────────────────────────────
  if (path === '/api/crdt/state/snapshot') {
    const count = await opsCount(db, keyHash);
    if (!count) return json({ ok: true, opsKept: 0 });
    await doSnapshot(db, keyHash);
    const kept = await opsCount(db, keyHash);
    return json({ ok: true, opsKept: kept });
  }

  return err('Not found', 404);
}

// ── Scheduled cron — prune rows older than 90 days ───────────────────────────

async function handleScheduled(env) {
  const cutoff = Date.now() - TTL_MS;
  const db = env.flowboard_db;
  // Expire CRDT boards whole, once idle for the TTL. Pruning individual old rows would
  // strip a live board of its oldest records (the board itself, its first cards).
  const live = 'SELECT key_hash FROM boards WHERE updated_at >= ? UNION SELECT key_hash FROM crdt_ops WHERE updated_at >= ? UNION SELECT key_hash FROM crdt_snapshots WHERE updated_at >= ?';
  await db.batch([
    db.prepare(`DELETE FROM crdt_ops WHERE key_hash NOT IN (${live})`).bind(cutoff, cutoff, cutoff),
    db.prepare(`DELETE FROM crdt_snapshots WHERE key_hash NOT IN (${live})`).bind(cutoff, cutoff, cutoff),
    db.prepare('DELETE FROM boards WHERE updated_at < ?').bind(cutoff),
  ]);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      if (e instanceof TaskError) return err(e.message, e.status);
      console.error(e);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
  },

  async scheduled(_event, env) {
    try {
      await handleScheduled(env);
    } catch (e) {
      console.error('Scheduled prune failed:', e);
    }
  },
};
