import { parseArgs } from 'node:util';
import { stat, writeFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function resolveSkillPaths(inputs, { platform = process.platform, statPath = stat } = {}) {
  const paths = platform === 'win32' ? win32 : posix;
  const skills = new Map();
  for (const input of inputs) {
    // Windows root-relative paths depend on the current drive, even though isAbsolute accepts them.
    if (typeof input !== 'string' || !input.trim() || /[\x00-\x1f\x7f]/.test(input) || !paths.isAbsolute(input)
      || (platform === 'win32' && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/.test(input))) {
      throw new Error('Use an existing absolute skill directory or SKILL.md file path');
    }
    const normalized = paths.normalize(input);
    const entry = await statPath(normalized);
    const file = entry.isDirectory() ? paths.join(normalized, 'SKILL.md') : normalized;
    if (paths.basename(file) !== 'SKILL.md' || !(await statPath(file)).isFile()) {
      throw new Error('Skill path must identify a SKILL.md file or a directory containing that file');
    }
    const key = platform === 'win32' ? file.toLowerCase() : file;
    if (!skills.has(key)) skills.set(key, file);
  }
  return [...skills.values()];
}

export async function writeIsolationFragment(values) {
  if (!values.out || ![...(values.plugin ?? []), ...(values.app ?? []), ...(values.skill ?? [])].length) {
    throw new Error('Supply actual --plugin/--app/--skill values and a new --out file');
  }
  let text = '# Merge only these settings into the existing LOCAL Codex config; do not append duplicate TOML tables.\n# Keep the ordinary Chat/Dot plugin connection and background readers enabled.\n';
  for (const [kind, ids] of [['plugins', values.plugin ?? []], ['apps', values.app ?? []]]) for (const id of new Set(ids)) {
    if (!id.trim() || id.length > 200 || /[\x00-\x1f\x7f]/.test(id)) throw new Error('Invalid integration id');
    text += `\n[${kind}.${JSON.stringify(id)}]\nenabled = false\n`;
  }
  for (const path of await resolveSkillPaths(values.skill ?? [])) {
    text += `\n[[skills.config]]\npath = ${JSON.stringify(path)}\nenabled = false\n`;
  }
  await writeFile(values.out, text, { flag: 'wx', mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { plugin: { type: 'string', multiple: true }, app: { type: 'string', multiple: true }, skill: { type: 'string', multiple: true }, out: { type: 'string' } } });
  await writeIsolationFragment(values);
  console.log('Wrote isolation fragment; review and merge with a backup as described in INSTALL.md. No Codex settings were changed.');
}
