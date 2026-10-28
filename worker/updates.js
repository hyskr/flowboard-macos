export async function serveUpdates(request, env) {
  const path = new URL(request.url).pathname;
  const upload = path.startsWith('/updates/upload/');
  let key = path.slice('/updates/'.length);
  let credential = request.headers.get('X-FlowBoard-Access');
  if (upload) key = path.slice('/updates/upload/'.length);
  else if (!credential) {
    const separator = key.indexOf('/');
    credential = separator > 0 ? key.slice(0, separator) : '';
    key = key.slice(separator + 1);
  }
  let authorized = !!env.APP_TOKEN && credential === env.APP_TOKEN;
  if (credential && env.SHARED_SPACE) {
    const response = await env.SHARED_SPACE.fetch(new Request('https://shared/api/board/touch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FlowBoard-Access': credential }, body: '{}' }));
    authorized = response.ok;
  }
  if (!authorized) return new Response('Not found', { status: 404 });
  if (!key || key.includes('..') || !/^[a-zA-Z0-9_.\-/]+$/.test(key)) return new Response('Invalid filename', { status: 400 });
  if (upload && request.method === 'PUT') {
    await env.UPDATES.put(key, request.body, { httpMetadata: { contentType: key.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
    return Response.json({ ok: true });
  }
  if (upload || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  const object = await env.UPDATES.get(key);
  if (!object) return new Response(null, { status: key === 'latest.json' ? 204 : 404 });
  return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
    'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Length': String(object.size), 'Cache-Control': 'private, no-store',
  } });
}
