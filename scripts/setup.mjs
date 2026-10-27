import { access, mkdir, writeFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, delimiter, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { validateConfig } from '../bridge/config.mjs';

export async function findCodex(explicit, environment = process.env) {
  const candidate = explicit || environment.CODEX_EXE;
  const paths = candidate ? [resolve(candidate)] : (environment.PATH || '').split(delimiter).flatMap(dir =>
    process.platform === 'win32' ? [join(dir, 'codex.exe')] : [join(dir, 'codex')]);
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      const resolved = await realpath(path);
      if (/\.(cmd|bat|ps1)$/i.test(resolved)) continue;
      const result = spawnSync(resolved, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true, shell: false });
      if (result.status === 0 && /^codex-cli\s/m.test(result.stdout)) return { path: resolved, version: result.stdout.trim() };
    } catch { /* Try the next PATH entry, without running a shell. */ }
  }
  throw new Error('Official Codex executable not found. Install Codex separately or pass --codex /absolute/path/to/codex (Windows: the native codex.exe, not a .cmd shim).');
}
export async function setup(options = {}) {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('This release supports macOS and Windows; Linux is not qualified.');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const out = resolve(options.out || join(root, '.local'));
  const codex = await findCodex(options.codex);
  const home = resolve(options['codex-home'] || process.env.CODEX_HOME || join(homedir(), '.codex'));
  await access(home);
  const config = validateConfig({ id: options.id || (process.platform === 'darwin' ? 'mac' : 'windows'),
    label: options.label || (process.platform === 'darwin' ? 'My Mac' : 'My Windows PC'), native: { executable: codex.path, codex_home: home } });
  // One fresh directory per configuration; no overwriting an existing installation.
  await mkdir(out, { mode: 0o700 });
  const configPath = join(out, 'device.json');
  const command = { command: process.execPath, args: [join(root, 'bridge/server.mjs'), configPath], cwd: root };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(out, 'mcp.json'), JSON.stringify({ mcpServers: { ['codex-' + config.id]: { type: 'stdio', ...command } } }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(out, 'command.json'), JSON.stringify(command, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { directory: out, codex: codex.version, config: configPath, command };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: Object.fromEntries(['id', 'label', 'codex', 'codex-home', 'out'].map(key => [key, { type: 'string' }])) });
  console.log(JSON.stringify(await setup(values), null, 2));
}
