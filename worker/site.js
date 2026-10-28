import backend from './index.js';
import { handleMcp } from './mcp.js';

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === '/mcp') return handleMcp(request, req => backend.fetch(req, env, ctx));
    if (path.startsWith('/api/')) return backend.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
