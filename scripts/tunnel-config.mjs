import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { isAbsolute } from 'node:path';
const { values } = parseArgs({ options: { command: { type: 'string' }, 'tunnel-id': { type: 'string' }, out: { type: 'string' } } });
if (!values.command || !values.out || !/^[A-Za-z0-9_-]{3,200}$/.test(values['tunnel-id'] ?? '')) throw new Error('Supply --command, your existing --tunnel-id and a new --out file');
const command = JSON.parse(await readFile(values.command, 'utf8'));
if (!isAbsolute(command.command) || !Array.isArray(command.args) || !command.args.every(v => typeof v === 'string')) throw new Error('Use command.json produced by setup');
const quote = value => {
  if (/[\0\r\n]/.test(value)) throw new Error('Invalid command argument');
  if (process.platform === 'win32') {
    if (/["%&|<>^!]/.test(value)) throw new Error('Use Windows installation paths without shell metacharacters');
    return '"' + value + '"';
  }
  return "'" + value.replaceAll("'", "'\\''") + "'";
};
const line = [command.command, ...command.args].map(quote).join(' ');
const yaml = `config_version: 1\ncontrol_plane:\n  base_url: "https://api.openai.com"\n  tunnel_id: ${JSON.stringify(values['tunnel-id'])}\n  api_key: "env:CONTROL_PLANE_API_KEY"\nhealth:\n  listen_addr: "127.0.0.1:0"\nadmin_ui:\n  open_browser: false\nlog:\n  level: info\n  format: json\nmcp:\n  commands:\n    - channel: main\n      command: ${JSON.stringify(line)}\n`;
await writeFile(values.out, yaml, { flag: 'wx', mode: 0o600 });
console.log('Wrote local Tunnel configuration. No tunnel, credential or network service was created.');
