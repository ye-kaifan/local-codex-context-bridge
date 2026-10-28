import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ControlSurface } from '../dist/src/tools.js';
import { serveStdio } from '../bridge/stdio.mjs';
import { selectSchemaCodex } from '../scripts/check-native-schema.mjs';
import { requireEqualPage } from '../scripts/compare-native.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const frame = (id, method, params = {}) => JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
const initialize = frame(1, 'initialize', { protocolVersion: '2025-11-25' });

test('thread lists reject malformed cursors and identities instead of reporting false exhaustion', async () => {
  const good = { data: [], nextCursor: null, backwardsCursor: null };
  for (const page of [
    ...['', ' ', 7, {}, false].map(nextCursor => ({ ...good, nextCursor })),
    { ...good, backwardsCursor: 7 }, { ...good, data: [{}] },
    { ...good, data: [{ id: 'a' }, { id: 'b' }] },
  ]) {
    const calls = [];
    const surface = new ControlSurface({ request: async method => { calls.push(method); return page; } });
    await assert.rejects(surface.call('codex_threads', { limit: 1 }));
    assert.deepEqual(calls, ['thread/list']);
  }
  const emptyContinuation = { ...good, nextCursor: 'opaque-empty-next', backwardsCursor: 'opaque-back' };
  const surface = new ControlSurface({ request: async () => emptyContinuation });
  const result = await surface.call('codex_threads', { limit: 1 });
  assert.equal(result.nextCursor, emptyContinuation.nextCursor);
  assert.equal(result.backwardsCursor, emptyContinuation.backwardsCursor);
  const optionalCursors = new ControlSurface({ request: async () => ({ data: [] }) });
  assert.equal((await optionalCursors.call('codex_threads', {})).nextCursor, null);
});

test('metadata and item pages fail closed on mismatched native identity, with no fallback', async () => {
  const calls = [];
  const surface = new ControlSurface({ request: async method => {
    calls.push(method);
    if (method === 'thread/read') return { thread: { id: 'thread', historyMode: 'paginated' } };
    return { data: [{ turnId: 'other-turn', item: { id: 'item', text: 'synthetic text' } }], nextCursor: 'not-delivered', backwardsCursor: null };
  } });
  await assert.rejects(surface.call('codex_history', { thread_id: 'thread', kind: 'items', turn_id: 'requested-turn' }), /requested turn/);
  assert.deepEqual(calls, ['thread/read', 'thread/items/list']);
  await assert.rejects(surface.call('codex_threads', { thread_id: 'different-thread' }), /requested thread/);
});

test('comparison failures disclose no actual/expected content or cursor in process stderr', () => {
  const marker = 'SYNTHETIC_PRIVATE_COMPARISON_MARKER';
  const moduleUrl = pathToFileURL(resolve('scripts/compare-native.mjs')).href;
  for (const key of ['data', 'nextCursor', 'backwardsCursor']) {
    const actual = { data: [], nextCursor: null, backwardsCursor: null, [key]: key === 'data' ? [{ text: marker }] : marker };
    const expected = { data: [], nextCursor: null, backwardsCursor: null };
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval',
      `import { requireEqualPage } from ${JSON.stringify(moduleUrl)}; requireEqualPage(${JSON.stringify(actual)},${JSON.stringify(expected)},'turns');`], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /comparison failed/);
    assert.ok(!(child.stdout + child.stderr).includes(marker));
  }
  requireEqualPage({ data: [{ future: [true, '🌱'] }], nextCursor: 'opaque', backwardsCursor: null }, { data: [{ future: [true, '🌱'] }], nextCursor: 'opaque', backwardsCursor: null }, 'items');
});

test('schema qualification selects the configured executable and never falls back after config errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'context-schema-choice-'));
  const config = join(dir, 'device.json');
  const chosen = join(dir, 'selected-codex');
  const calls = [];
  const finder = async path => { calls.push(path); return { path, version: 'synthetic' }; };
  try {
    await writeFile(config, JSON.stringify({ id: 'test', label: 'Test', native: { executable: chosen, codex_home: dir } }));
    assert.equal((await selectSchemaCodex({ config }, finder)).path, chosen);
    assert.deepEqual(calls, [chosen]);
    await assert.rejects(selectSchemaCodex({ config: join(dir, 'missing.json') }, finder));
    await writeFile(config, '{invalid');
    await assert.rejects(selectSchemaCodex({ config }, finder));
    await assert.rejects(selectSchemaCodex({ config, codex: chosen }, finder));
    assert.deepEqual(calls, [chosen]);
  } finally { await rm(dir, { recursive: true }); }
});

test('MCP output failure cancels in-flight work, closes the owned reader once and has no unhandled error', async () => {
  const input = new PassThrough();
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('synthetic broken pipe')); } });
  let closed = 0, calls = 0, cancel;
  const server = serveStdio({
    call: () => { calls++; return new Promise((_resolve, reject) => { cancel = reject; }); },
    close: async () => { closed++; cancel?.(new Error('cancelled')); },
  }, { input, output });
  input.write(initialize + frame(2, 'tools/call', { name: 'codex_threads' }));
  await assert.rejects(server.done, /synthetic broken pipe/);
  input.write(frame(3, 'tools/call', { name: 'codex_threads' }));
  assert.equal(calls, 1); assert.equal(closed, 1);
  await assert.rejects(server.close(), /synthetic broken pipe/);
  assert.equal(closed, 1);
});

test('MCP framing recovers after a split oversized line and never executes its suffix', async () => {
  const input = new PassThrough(), output = new PassThrough();
  let text = '', calls = 0, closed = 0;
  output.on('data', data => { text += data; });
  const server = serveStdio({ call: async () => { calls++; return {}; }, close: async () => { closed++; } }, { input, output });
  input.write(initialize);
  input.write('x'.repeat(40000)); input.write('x'.repeat(40000));
  input.write(frame(8, 'tools/call', { name: 'codex_threads' }) + frame(9, 'ping'));
  await tick();
  const responses = text.trim().split('\n').map(JSON.parse);
  assert.equal(responses.filter(r => r.error?.code === -32700).length, 1);
  assert.equal(responses.find(r => r.id === 8), undefined);
  assert.deepEqual(responses.find(r => r.id === 9).result, {});
  assert.equal(calls, 0);
  input.end(); await server.done; assert.equal(closed, 1);
});

test('MCP concurrency cap and duplicate IDs reject excess requests without starting native work', async () => {
  const input = new PassThrough(), output = new PassThrough();
  let text = '', calls = 0;
  output.on('data', data => { text += data; });
  const pending = [];
  const server = serveStdio({ call: () => { calls++; return new Promise(resolve => pending.push(resolve)); }, close: async () => {} }, { input, output });
  input.write(initialize); await tick();
  for (let id = 2; id < 18; id++) input.write(frame(id, 'tools/call', { name: 'codex_threads' }));
  input.write(frame(2, 'tools/call', { name: 'codex_threads' }));
  input.write(frame(18, 'tools/call', { name: 'codex_threads' }));
  await tick();
  assert.equal(calls, 16);
  assert.equal(text.trim().split('\n').map(JSON.parse).filter(r => r.error?.code === -32000).length, 2);
  for (const resolve of pending) resolve({ result: { data: [] } });
  await tick(); await server.close();
});
