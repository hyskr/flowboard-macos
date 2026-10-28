import assert from 'node:assert/strict';
import worker from './index.js';
import site from './site.js';
import { createDatabase } from './test-db.js';
import { SYNC_PROTOCOL } from '../src/services/crdt.ts';

const { sql, env } = createDatabase();
const boardId = 'shared', keyHash = 'b'.repeat(64);
const call = async (path, data = {}, hash = keyHash) => {
  const response = await worker.fetch(new Request(`https://board.test${path}`, { method: 'POST', body: JSON.stringify({ boardId, keyHash: hash, ...data }) }), env);
  return { status: response.status, data: await response.json() };
};
const batch = actions => call('/api/tasks/batch', { actions });
const action = (action, args) => ({ action, args });
const seed = [
  ['board.update', { id: boardId, boardId, name: 'Shared board' }],
  ['column.create', { id: 'todo', boardId, name: '待办', order: 0 }],
  ['column.create', { id: 'doing', boardId, name: '进行中', order: 1 }],
].map(([type, payload], i) => ({ opId: `seed-${i}`, clientId: 'test', type, ts: i + 1, payload }));
await call('/api/crdt/ops/push', { ops: seed, protocolVersion: SYNC_PROTOCOL });

const create = action('upsert_task', { sourceKey: 'launch', title: '发布网站', desc: '确认共享访问', dueDate: '2026-11-06' });
let saved = await batch([create]);
assert.equal(saved.status, 200);
const id = saved.data.results[0].card.id;
assert.equal(saved.data.results[0].created, true);
assert.equal((await batch([create])).data.operations, 0, 'retry keeps the same card and produces no extra activity');
saved = await batch([action('upsert_task', { cardId: id, title: '发布共享看板', dueDate: '2026-11-09' }), action('complete_task', { cardId: id })]);
assert.equal(saved.status, 200);
let board = (await call('/api/tasks/read')).data;
assert.equal(board.cards.length, 1);
assert.equal(board.cards[0].title, '发布共享看板');
assert.equal(board.cards[0].desc, '确认共享访问');
assert.ok(board.cards[0].completedAt);
assert.equal(board.activity.filter(e => e.type === 'completed').length, 1);
assert.equal((await batch([action('complete_task', { cardId: id })])).data.operations, 0);
await batch([action('complete_task', { cardId: id, completed: false })]);
board = (await call('/api/tasks/read')).data;
assert.equal(board.cards[0].completedAt, null);
assert.equal(board.activity.filter(e => e.type === 'completed').length, 1);
assert.equal(board.activity.filter(e => e.type === 'reopened').length, 1);

await batch([action('move_task', { cardId: id, columnId: null })]);
await batch([action('upsert_task', { cardId: id, desc: '补充验收标准' })]);
assert.equal((await call('/api/tasks/read')).data.cards[0].columnId, null, 'editing a backlog card keeps it in backlog');
await batch([action('move_task', { cardId: id, columnId: 'doing', index: 0 })]);
assert.equal((await batch([action('move_task', { cardId: id, columnId: 'doing', index: 0 })])).data.operations, 0);
const failed = await batch([action('upsert_task', { cardId: id, title: '不应写入' }), action('move_task', { cardId: id, columnId: 'missing' })]);
assert.equal(failed.status, 400);
assert.equal((await call('/api/tasks/read')).data.cards[0].title, '发布共享看板', 'invalid batches commit no partial edits');
assert.equal((await call('/api/tasks/read', {}, 'c'.repeat(64))).status, 404);

const rpc = async (method, params = {}, headers = {}) => {
  const response = await site.fetch(new Request('https://board.test/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), env);
  return response.json();
};
assert.ok((await rpc('tools/list')).result.tools.some(t => t.name === 'batch_tasks'));
assert.equal((await rpc('tools/call', { name: 'read_board', arguments: {} })).result.isError, true);
const mcp = await rpc('tools/call', { name: 'complete_task', arguments: { cardId: id } }, { 'X-FlowBoard-Board': boardId, Authorization: `Bearer ${keyHash}` });
assert.equal(mcp.result.isError, false);
board = (await call('/api/tasks/read')).data;
assert.ok(board.cards[0].completedAt, 'MCP writes reach the same board state used by browsers');

await call('/api/crdt/ops/push', { protocolVersion: SYNC_PROTOCOL, ops: [{ opId: 'delete-task', clientId: 'browser', type: 'card.delete', ts: Date.now() + 100, payload: { id, boardId } }] });
assert.equal((await batch([create])).status, 409, 'a retried creation never restores a deleted card');
sql.close();
console.log('task batching, completion history, retry deduplication and MCP checks passed');
