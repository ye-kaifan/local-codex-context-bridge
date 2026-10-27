import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const ignored = new Set(['.git', '.local', 'node_modules', 'dist']);
async function walk(dir = '.') {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).filter(e => !ignored.has(e.name) && !e.name.endsWith('.tgz')).map(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
}
const forbiddenName = /(?:^|\/)(?:auth\.json|config\.toml|\.env|sessions|logs)(?:\/|$)|\.(?:png|jpe?g|zip|db|sqlite|jsonl|log)$/i;
const secrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk-(?:proj-|admin-)?[A-Za-z0-9_-]{30,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\b(?:asdk_app_|tunnel_|org-)[a-f0-9]{24,}\b/,
  /\/Users\/(?!example(?:\/|\b)|<)[A-Za-z0-9._-]+\//,
  /[A-Z]:\\Users\\(?!example\\)[A-Za-z0-9._-]+\\/,
];
let count = 0;
for (const path of await walk()) {
  if (forbiddenName.test(path)) throw new Error('Private/runtime file in release tree: ' + path);
  const text = await readFile(path, 'utf8');
  if (text.includes('\0') || secrets.some(pattern => pattern.test(text))) throw new Error('Potential secret/personal path/binary in: ' + path);
  count++;
}
const manifest = JSON.parse(await readFile('upstream-files.json', 'utf8'));
for (const [path, expected] of Object.entries(manifest.unmodified_files_sha256)) {
  if (createHash('sha256').update(await readFile(path)).digest('hex') !== expected) throw new Error('Unexpected change to recorded upstream file: ' + path);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// npm.cmd needs the platform shell; all arguments here are fixed literals, no user input.
const packed = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', shell: process.platform === 'win32' }))[0];
for (const file of packed.files) {
  if (/^(?:\.local|node_modules|test|dist\/test|\.git)\//.test(file.path) || forbiddenName.test(file.path)) throw new Error('Private/test file in package: ' + file.path);
  const text = await readFile(file.path, 'utf8');
  if (secrets.some(pattern => pattern.test(text))) throw new Error('Potential secret in package: ' + file.path);
}
console.log(JSON.stringify({ source_files_checked: count, package_files_checked: packed.files.length, upstream_hashes_verified: Object.keys(manifest.unmodified_files_sha256).length, scan: 'passed', note: 'Pattern checks supplement manual review and do not prove absence of all secrets.' }, null, 2));
