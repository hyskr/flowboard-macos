import { build } from 'esbuild';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const assets = {};
async function collect(dir, prefix = '') {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = `${prefix}/${item.name}`;
    if (item.isDirectory()) await collect(`${dir}/${item.name}`, name);
    else assets[name] = { type: types[extname(name)] || 'application/octet-stream', body: (await readFile(`${dir}/${item.name}`)).toString('base64') };
  }
}
await collect('dist/client');
await mkdir('dist/server', { recursive: true });
await build({
  stdin: { contents: `import site from './worker/site.js';
const assets = ${JSON.stringify(assets)};
async function staticFetch(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, {status:405});
  const path = new URL(request.url).pathname;
  const asset = assets[path] || (!path.split('/').pop().includes('.') ? assets['/index.html'] : null);
  if (!asset) return new Response('Not found', {status:404});
  const body = Uint8Array.from(atob(asset.body), c => c.charCodeAt(0));
  return new Response(request.method === 'HEAD' ? null : body, {headers:{'Content-Type':asset.type,'Cache-Control':path.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache'}});
}
export default { fetch(request, env, ctx) { return site.fetch(request, {...env, ASSETS:{fetch:staticFetch}}, ctx); } };
`, resolveDir: resolve('.'), sourcefile: 'site-build.js' },
  outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
});
console.log(`Worker packaged with ${Object.keys(assets).length} static assets`);
