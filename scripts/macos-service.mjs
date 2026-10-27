import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, isAbsolute, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function servicePlist({ label, command, directory }) {
  if (!/^[a-zA-Z0-9.-]+$/.test(label) || !command.length || !command.every(v => typeof v === 'string') || !isAbsolute(command[0]) || !isAbsolute(directory)) throw new Error('Invalid service definition');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${command.map(v => `<string>${xml(v)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(directory)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ProcessType</key><string>Standard</string>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(join(directory, 'service.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(directory, 'service.stderr.log'))}</string>
</dict></plist>\n`;
}
export async function renderService({ runner, out, bundleId, label = 'local.codex-context-bridge' }) {
  if (process.platform !== 'darwin') throw new Error('macOS service generator only');
  if (!runner || !isAbsolute(runner) || !out || !isAbsolute(out) || !bundleId || !/^[A-Za-z0-9.-]+$/.test(bundleId)) throw new Error('Supply absolute --runner, a new absolute --out directory and the actual --bundle-id');
  await mkdir(out, { mode: 0o700 });
  const binary = join(out, 'app-lifecycle');
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../macos/AppLifecycle.m');
  const compile = spawnSync('/usr/bin/clang', ['-fobjc-arc', '-fblocks', '-framework', 'AppKit', source, '-o', binary], { encoding: 'utf8' });
  if (compile.status !== 0) throw new Error('Lifecycle watcher build failed; install Apple Command Line Tools. ' + compile.stderr);
  const test = spawnSync(binary, ['--self-test'], { encoding: 'utf8', timeout: 15000 });
  if (test.status !== 0) throw new Error('Lifecycle watcher self-test failed');
  const file = join(out, label + '.plist');
  await writeFile(file, servicePlist({ label, command: [binary, runner, join(out, 'state.json'), bundleId], directory: out }), { mode: 0o600, flag: 'wx' });
  return { file, state: 'rendered_only', label, lifecycle_self_test: 'passed', process_type: 'Standard' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: Object.fromEntries(['runner', 'out', 'bundle-id', 'label'].map(key => [key, { type: 'string' }])) });
  console.log(JSON.stringify(await renderService({ runner: values.runner, out: values.out, bundleId: values['bundle-id'], label: values.label }), null, 2));
}
