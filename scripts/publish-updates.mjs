import { readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, join } from 'node:path';

const connection = JSON.parse(await readFile('src-tauri/private/connection.json', 'utf8'));
const origin = connection.updatesUrl.replace(/\/$/, '');
const mode = process.argv[2] || 'native';
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const upload = async (key, body, size) => {
  const response = await fetch(`${origin}/updates/upload/${key}`, { method: 'PUT', headers: { 'X-FlowBoard-Access': connection.appToken, 'Content-Length': String(size) }, body, duplex: 'half' });
  if (!response.ok) throw new Error(`Update upload failed: HTTP ${response.status}`);
};
const uploadFile = async (key, path) => upload(key, createReadStream(path), (await stat(path)).size);
if (mode === 'hot') {
  const version = process.env.HOT_UPDATE_VERSION;
  if (!version) throw new Error('HOT_UPDATE_VERSION is required.');
  const files = await readdir('dist/hot-update');
  for (const file of files.filter(name => name.endsWith('.tar.gz'))) await uploadFile(`v${version}/${file}`, join('dist/hot-update', file));
  await uploadFile('manifest.json.minisig', 'dist/hot-update/manifest.json.minisig');
  await uploadFile('manifest.json', 'dist/hot-update/manifest.json');
  console.log(`Signed frontend update ${version} published to private storage.`);
} else {
  const directory = join(process.env.CARGO_TARGET_DIR || 'src-tauri/target', 'universal-apple-darwin/release/bundle/macos');
  const archives = (await readdir(directory)).filter(name => name.endsWith('.app.tar.gz'));
  if (archives.length !== 1) throw new Error('Expected one universal macOS updater archive.');
  const archive = archives[0];
  const key = `v${config.version}/${archive}`;
  await uploadFile(key, join(directory, archive));
  const signature = (await readFile(join(directory, `${archive}.sig`), 'utf8')).trim();
  const platform = { signature, url: `${origin}/updates/${key}` };
  const manifest = JSON.stringify({ version: config.version, notes: `FlowBoard ${config.version}：行记：本地开发记录、知识库、统一 Skill 与低频 Hook。`, pub_date: new Date().toISOString(), platforms: { 'darwin-aarch64': platform, 'darwin-x86_64': platform } });
  await upload('latest.json', manifest, Buffer.byteLength(manifest));
  console.log(`Signed macOS update ${config.version} published to private storage (${basename(archive)}).`);
}
