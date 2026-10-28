import { SYNC_PROTOCOL } from '../src/services/crdt.ts';
import { taskTools } from './tasks.js';

export async function handleMcp(request, execute) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  let rpc;
  try { rpc = await request.json(); } catch { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }, { status: 400 }); }
  const reply = result => Response.json({ jsonrpc: '2.0', id: rpc.id ?? null, result });
  if (rpc.method === 'server/discover') return reply({ supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, serverInfo: { name: 'flowboard', version: '1.0.0' } });
  if (rpc.method === 'initialize') return reply({ protocolVersion: rpc.params?.protocolVersion || '2026-07-28', capabilities: { tools: {} }, serverInfo: { name: 'flowboard', version: '1.0.0' } });
  if (rpc.method?.startsWith('notifications/')) return new Response(null, { status: 202 });
  if (rpc.method === 'ping') return reply({});
  if (rpc.method === 'tools/list') return reply({ tools: [...taskTools, { name: 'batch_tasks', description: '将本轮已确认的任务变化合并为一次提交。', inputSchema: { type: 'object', properties: { actions: { type: 'array', items: { type: 'object', properties: { action: { type: 'string' }, args: { type: 'object' } }, required: ['action', 'args'] }, maxItems: 20 } }, required: ['actions'] } }].map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, boardId: { type: 'string', description: '看板 ID，也可通过 X-FlowBoard-Board 请求头提供。' }, accessKey: { type: 'string', description: '看板访问密钥，也可通过 Authorization Bearer 请求头提供。' } } } })) });
  if (rpc.method !== 'tools/call') return Response.json({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: 'Method not found' } });
  const args = rpc.params?.arguments || {};
  const boardId = request.headers.get('X-FlowBoard-Board') || args.boardId;
  const keyHash = request.headers.get('Authorization')?.replace(/^Bearer /i, '') || args.accessKey;
  const name = rpc.params?.name;
  const route = name === 'read_board' ? '/api/tasks/read' : '/api/tasks/batch';
  const response = await execute(new Request(new URL(route, request.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boardId, keyHash, protocolVersion: SYNC_PROTOCOL, actions: name === 'batch_tasks' ? args.actions : [{ action: name, args }] }) }));
  const data = await response.json();
  return reply({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: !response.ok });
}
