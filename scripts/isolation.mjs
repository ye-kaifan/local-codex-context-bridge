import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
const { values } = parseArgs({ options: { plugin: { type: 'string', multiple: true }, app: { type: 'string', multiple: true }, skill: { type: 'string', multiple: true }, out: { type: 'string' } } });
if (!values.out || ![...(values.plugin ?? []), ...(values.app ?? []), ...(values.skill ?? [])].length) throw new Error('Supply actual --plugin/--app/--skill values and a new --out file');
let text = '# Merge only these settings into the existing Codex config; do not append duplicate TOML tables.\n# This fragment does not uninstall the cloud plugin or change other integrations.\n';
for (const [kind, ids] of [['plugins', values.plugin ?? []], ['apps', values.app ?? []]]) for (const id of new Set(ids)) {
  if (!id.trim() || id.length > 200 || /[\x00-\x1f]/.test(id)) throw new Error('Invalid integration id');
  text += `\n[${kind}.${JSON.stringify(id)}]\nenabled = false\n`;
}
for (const path of new Set(values.skill ?? [])) {
  if (!isAbsolute(path) || /[\x00-\x1f]/.test(path)) throw new Error('Use the actual absolute skill folder path');
  text += `\n[[skills.config]]\npath = ${JSON.stringify(path)}\nenabled = false\n`;
}
await writeFile(values.out, text, { flag: 'wx', mode: 0o600 });
console.log('Wrote isolation fragment; review and merge with a backup as described in INSTALL.md. No Codex settings were changed.');
