import { mkdir, writeFile } from 'node:fs/promises';

const connection = JSON.parse(process.env.FLOWBOARD_CONNECTION_JSON || 'null');
if (!connection?.workerUrl || !connection?.appToken) throw new Error('Set the FLOWBOARD_CONNECTION_JSON repository secret before building.');
if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${connection.appToken}`);
await mkdir('src-tauri/private', { recursive: true });
await writeFile('src-tauri/private/connection.json', JSON.stringify(connection), { mode: 0o600 });
console.log('Private application connection configured.');
