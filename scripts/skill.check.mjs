import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import worker from '../worker/index.js';
import { createDatabase } from '../worker/test-db.js';

const dir = await mkdtemp(join(tmpdir(), 'flowboard-skill-'));
const { sql, env } = createDatabase();
const boardId = 'skill-board', keyHash = 'd'.repeat(64);
const connection = join(dir, 'import.json');
const cli = resolve('integrations/flowboard-tasks/scripts/flowboard.py');
let failWrites = false;
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  if (failWrites && req.url === '/api/tasks/batch') { res.writeHead(503); res.end('{"error":"Temporarily unavailable"}'); return; }
  const reply = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, body: body || undefined }), env);
  res.writeHead(reply.status, Object.fromEntries(reply.headers)); res.end(await reply.text());
});
const run = (args, input = '') => new Promise((resolve, reject) => {
  const child = spawn('python3', [cli, ...args], { env: { ...process.env, FLOWBOARD_CONFIG: join(dir, 'connection.json') } });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  child.on('error', reject); child.on('close', code => { try { resolve({ code, result: JSON.parse(stdout || stderr) }); } catch { reject(new Error(stderr || stdout)); } });
  child.stdin.end(input);
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const workerUrl = `http://127.0.0.1:${server.address().port}`;
  await worker.fetch(new Request(`${workerUrl}/api/crdt/ops/push`, { method: 'POST', body: JSON.stringify({ boardId, keyHash, protocolVersion: 3, generation: '', ops: [{ opId: 'board', type: 'board.update', ts: 1, payload: { boardId, id: boardId, name: 'Skill test' } }] }) }), env);
  await writeFile(connection, JSON.stringify({ workerUrl, boardId, keyHash }));
  assert.equal((await run(['connect', connection])).result.connected, true);
  const actions = [{ action: 'upsert_task', args: { sourceKey: 'follow-up', title: '确认部署' } }];
  failWrites = true;
  assert.equal((await run(['batch'], JSON.stringify(actions))).code, 1);
  assert.deepEqual((await run(['pending'])).result.actions, actions);
  assert.equal((await run(['batch'], JSON.stringify(actions))).code, 1, 'new writes cannot silently replace unsynced tasks');
  failWrites = false;
  assert.equal((await run(['retry'])).result.ok, true);
  assert.equal((await run(['status'])).result.pending, false);
  assert.equal((await run(['read'])).result.cards.length, 1);
  assert.equal((await run(['batch'], JSON.stringify(actions))).result.operations, 0, 'retrying an acknowledged creation keeps one card');
  console.log('skill connection, batched writes, failed-write preservation and retry checks passed');
} finally {
  await new Promise(resolve => server.close(resolve)); sql.close(); await rm(dir, { recursive: true, force: true });
}
