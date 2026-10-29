import backend from './index.js';
import { handleMcp } from './mcp.js';

const desktop = {
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname;
    if(!path.startsWith('/api/')&&path!=='/mcp'&&env.ASSETS)return env.ASSETS.fetch(request);
    if(request.method==='OPTIONS')return new Response(null,{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-FlowBoard-Access'}});
    const response=await this.api(request,env,ctx);const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','*');headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers});
  },
  async api(request, env, ctx) {
    const supplied = request.headers.get('X-FlowBoard-Access');
    if (!env.APP_TOKEN || supplied !== env.APP_TOKEN) return Response.json({error:'共享密钥无效'}, { status: 401 });
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
    if (path === '/api/connection/info') {
      const call = (path, data = {}) => backend.fetch(new Request(new URL(path,request.url), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,boardId:'shared',keyHash:'0'.repeat(64),protocolVersion:4})}),env,ctx);
      const current=await call('/api/board/get');
      if (!current.ok) return current;
      if ((await current.json()).found === false) {
        const ts=Date.now();
        const records=[{type:'board.update',payload:{id:'shared',boardId:'shared',name:'共事看板',createdAt:ts}},...['待办','进行中','已交付'].map((name,i)=>({type:'column.create',payload:{id:`column-${i}`,boardId:'shared',name,order:i,color:['#c2410c','#0369a1','#15803d'][i]}}))];
        const initialized=await call('/api/sync/commit',{ops:records.map((record,i)=>({...record,opId:`setup-shared-${i}`,boardId:'shared',clientId:'setup',ts:0}))});
        if (!initialized.ok) return initialized;
      }
      return Response.json({boardId:'shared',updatesUrl:env.UPDATES_URL || null,protocolVersion:4});
    }
    const forwarded = new Request(request.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, boardId: 'shared', keyHash: '0'.repeat(64) }) });
    return backend.fetch(forwarded, env, ctx);
  },
};

export default desktop;
