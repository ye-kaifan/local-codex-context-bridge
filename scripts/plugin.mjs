import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
export async function buildPlugin(connections, out) {
  if (!Array.isArray(connections) || !connections.length) throw new Error('Provide a nonempty array of your registered connections');
  const apps = {};
  for (const { name, id } of connections) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{3,160}$/.test(id) || Object.hasOwn(apps, name)) throw new Error('Invalid or duplicate connection name/id');
    apps[name] = { id, required: false };
  }
  await mkdir(out, { mode: 0o700 });
  const manifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'local-codex-context', version: '1.0.0', description: 'Read existing Codex context from configured computers; no execution.', license: 'MIT', extensions: { 'com.openai': { apps: './.app.json', interface: { displayName: 'Local Codex Context', shortDescription: 'Read Codex sessions by source device', category: 'Productivity', capabilities: ['Read'] } } } };
  await writeFile(join(out, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(out, '.app.json'), JSON.stringify({ apps }, null, 2) + '\n', { flag: 'wx' });
  const skill = join(out, 'skills/read-codex-context'); await mkdir(skill, { recursive: true });
  await copyFile(resolve(dirname(fileURLToPath(import.meta.url)), '../templates/read-codex-context/SKILL.md'), join(skill, 'SKILL.md'));
  return { directory: out, devices: connections.length, state: 'local_package_only' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { connections: { type: 'string' }, out: { type: 'string' } } });
  if (!values.connections || !values.out) throw new Error('Use --connections YOUR_LOCAL_FILE --out NEW_DIRECTORY');
  console.log(JSON.stringify(await buildPlugin(JSON.parse(await readFile(values.connections, 'utf8')), resolve(values.out)), null, 2));
}
