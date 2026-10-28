import backend from './index.js';
import { handleMcp } from './mcp.js';

const desktop = {
  async fetch(request, env, ctx) {
    const supplied = request.headers.get('X-FlowBoard-Access');
    if (!env.APP_TOKEN || supplied !== env.APP_TOKEN) return new Response('Not found', { status: 404 });
    const path = new URL(request.url).pathname;
    if (path === '/mcp') return handleMcp(request, req => {
      const headers = new Headers(req.headers);
      headers.set('X-FlowBoard-Access', env.APP_TOKEN);
      return desktop.fetch(new Request(req, { headers }), env, ctx);
    });
    if (!path.startsWith('/api/') || request.method !== 'POST') return new Response('Not found', { status: 404 });
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request body' }, { status: 400 });
    const forwarded = new Request(request.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, boardId: 'shared', keyHash: '0'.repeat(64) }) });
    return backend.fetch(forwarded, env, ctx);
  },
};

export default desktop;
