import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const version = process.env.HOT_UPDATE_VERSION;
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version || '')) throw new Error('HOT_UPDATE_VERSION must be a semantic version.');
const connection = JSON.parse(await readFile('src-tauri/private/connection.json', 'utf8'));
const shell = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8')).version;
await mkdir('dist/hot-update', { recursive: true });
const key = 'src-tauri/private/hot-update.key';
await writeFile(key, Buffer.from(process.env.TAURI_SIGNING_PRIVATE_KEY, 'base64'), { mode: 0o600 });
const command = spawnSync('hot-update-sign', ['--dist', 'dist/client', '--version', version, '--min-shell', shell, '--key', key, '--base-url', `${connection.updatesUrl.replace(/\/$/, '')}/updates/${connection.appToken}/v${version}`, '--out', 'dist/hot-update'], { env: { ...process.env, HOT_UPDATE_KEY_PASSWORD: '' }, encoding: 'utf8' });
if (command.status !== 0) throw new Error(`Frontend bundle signing failed (exit ${command.status}).`);
console.log(`Frontend bundle ${version} signed.`);
