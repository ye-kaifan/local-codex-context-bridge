import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
async function files(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}
let count = 0;
for (const dir of ['src', 'bridge', 'scripts', 'test']) for (const path of await files(dir)) {
  const text = await readFile(path, 'utf8');
  if (/^(<<<<<<< |=======\s*$|>>>>>>> )/m.test(text)) throw new Error('Merge conflict marker: ' + path);
  if (/[ \t]+$/m.test(text)) throw new Error('Trailing whitespace: ' + path);
  if (path.endsWith('.mjs')) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  count++;
}
console.log(`Syntax and whitespace checks passed for ${count} source/test files. Type checking is a separate command.`);
