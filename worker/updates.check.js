import assert from 'node:assert/strict';
import { serveUpdates } from './updates.js';

const objects = new Map();
const env = { APP_TOKEN: 'test-shared-credential', UPDATES: {
  async put(key, body, options) { const data = await new Response(body).arrayBuffer(); objects.set(key, { body: data, size: data.byteLength, httpMetadata: options.httpMetadata }); },
  async get(key) { return objects.get(key); },
} };
const call = (path, options = {}) => serveUpdates(new Request(`https://updates.test${path}`, options), env);
assert.equal((await call('/updates/latest.json')).status, 404);
assert.equal((await call('/updates/latest.json', { headers: { 'X-FlowBoard-Access': env.APP_TOKEN } })).status, 204);
assert.equal((await call('/updates/upload/latest.json', { method: 'PUT', body: '{}' })).status, 404);
const manifest = JSON.stringify({ version: '1.0.0' });
assert.equal((await call('/updates/upload/latest.json', { method: 'PUT', headers: { 'X-FlowBoard-Access': env.APP_TOKEN }, body: manifest })).status, 200);
assert.equal(await (await call('/updates/latest.json', { headers: { 'X-FlowBoard-Access': env.APP_TOKEN } })).text(), manifest);
assert.equal(await (await call(`/updates/${env.APP_TOKEN}/latest.json`)).text(), manifest);
assert.equal((await call('/updates/wrong-credential/latest.json')).status, 404);
assert.equal((await call(`/updates/${env.APP_TOKEN}/latest.json`, { method: 'HEAD' })).headers.get('Cache-Control'), 'private, no-store');
console.log('private update upload and download authorization checks passed');
