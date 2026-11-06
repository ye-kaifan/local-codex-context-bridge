import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { validateConfig } from '../bridge/config.mjs';
import { findCodex, executableSource } from '../bridge/executable.mjs';
export { findCodex };

export async function setupNativeConfig(options, home, environment = process.env, dependencies = {}) {
  const env = { ...environment, CODEX_HOME: home };
  const codex = await (dependencies.findCodex || findCodex)(options.codex, env);
  const explicit = options.codex !== undefined || environment.CODEX_EXE !== undefined;
  const native = { codex_home: home };
  if (options['follow-updates']) native.executable_source = await (dependencies.executableSource || executableSource)(codex, env);
  else if (explicit) native.executable = codex.path;
  else native.executable_source = { kind: 'path', path: codex.launchPath };
  return { codex, native };
}

export async function setup(options = {}) {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('This release supports macOS and Windows; Linux is not qualified.');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const out = resolve(options.out || join(root, '.local'));
  const home = resolve(options['codex-home'] || process.env.CODEX_HOME || join(homedir(), '.codex'));
  await access(home);
  const { codex, native } = await setupNativeConfig(options, home);
  const config = validateConfig({ id: options.id || (process.platform === 'darwin' ? 'mac' : 'windows'),
    label: options.label || (process.platform === 'darwin' ? 'My Mac' : 'My Windows PC'), native });
  // One fresh directory per configuration; no overwriting an existing installation.
  await mkdir(out, { mode: 0o700 });
  const configPath = join(out, 'device.json');
  const command = { command: process.execPath, args: [join(root, 'bridge/server.mjs'), configPath], cwd: root };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(out, 'mcp.json'), JSON.stringify({ mcpServers: { ['codex-' + config.id]: { type: 'stdio', ...command } } }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(out, 'command.json'), JSON.stringify(command, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { directory: out, codex: codex.version, executable_selection: native.executable_source || { kind: 'pinned', path: native.executable }, config: configPath, command };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { ...Object.fromEntries(['id', 'label', 'codex', 'codex-home', 'out'].map(key => [key, { type: 'string' }])), 'follow-updates': { type: 'boolean' } } });
  console.log(JSON.stringify(await setup(values), null, 2));
}
