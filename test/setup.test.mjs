import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { servicePlist } from '../scripts/macos-service.mjs';
import { buildPlugin } from '../scripts/plugin.mjs';

test('macOS service preserves Standard scheduling and XML-escapes detected paths', () => {
  const plist = servicePlist({ label: 'local.context-test', command: [resolve('example & directory', 'watcher'), 'a<b'], directory: resolve('example & directory') });
  assert.match(plist, /<key>ProcessType<\/key><string>Standard<\/string>/);
  assert.doesNotMatch(plist, /Background|LowPriorityIO|Nice/); assert.match(plist, /&amp;/); assert.match(plist, /a&lt;b/);
});

test('plugin generator references only supplied connections and refuses overwrite/duplicate identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'context-plugin-')); const out = join(root, 'plugin');
  try {
    await buildPlugin([{ name: 'laptop', id: 'example-registered-app' }], out);
    assert.deepEqual(JSON.parse(await readFile(join(out, '.app.json'), 'utf8')), { apps: { laptop: { id: 'example-registered-app', required: false } } });
    assert.match(await readFile(join(out, 'skills/read-codex-context/SKILL.md'), 'utf8'), /Never automatically switch to exact/);
    await assert.rejects(buildPlugin([{ name: 'laptop', id: 'example-registered-app' }], out), /EEXIST/);
    await assert.rejects(buildPlugin([{ name: 'x', id: 'one' }, { name: 'x', id: 'two' }], join(root, 'second')), /duplicate/);
  } finally { await rm(root, { recursive: true }); }
});
