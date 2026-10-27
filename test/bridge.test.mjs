import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { DeviceReader } from '../bridge/server.mjs';
import { ReadOnlyAppServer, READ_METHODS } from '../bridge/readonly-policy.mjs';
import { nativeEnvironment } from '../bridge/native.mjs';
import { validateConfig } from '../bridge/config.mjs';
import { serveStdio } from '../bridge/stdio.mjs';
import { client } from '../scripts/mcp-client.mjs';

test('native read-only boundary denies every write family and approvals before child launch', async () => {
  const native = new ReadOnlyAppServer(undefined, { executable: 'must-not-launch' });
  for (const method of ['thread/start', 'thread/resume', 'turn/start', 'turn/steer', 'turn/interrupt', 'thread/archive', 'thread/goal/set', 'thread/queue/add', 'config/write', 'command/exec', 'fs/readFile', 'unknown']) {
    await assert.rejects(native.request(method, {}), /method denied/);
  }
  for (const params of [{}, { includeTurns: true }, null]) await assert.rejects(native.request('thread/read', params), /metadata-only/);
  await assert.rejects(native.respond('request', {}), /approvals denied/);
  assert.equal(READ_METHODS.length, 6); await native.close();
});

test('device routing preserves native pages and refuses wrong sources, invalid args and offline reads', async () => {
  const calls = []; let factories = 0;
  const data = { mode: 'history', data: [{ item: { text: '原始工具内容 🌱'.repeat(1000) } }], nextCursor: 'native-cursor', backwardsCursor: null };
  const reader = new DeviceReader({ id: 'laptop', label: 'Laptop' }, () => { factories++; return { call: async (name, args) => { calls.push({ name, args }); return data; }, close: async () => {} }; });
  assert.equal((await reader.call('codex_devices', {})).devices[0].status, 'configured');
  assert.equal(factories, 0);
  for (const [name, args] of [['codex_turn', {}], ['codex_history', { device_id: 'other' }], ['codex_history', []], ['codex_devices', { extra: true }]]) await assert.rejects(reader.call(name, args));
  assert.equal(factories, 0);
  const args = { device_id: 'Laptop', kind: 'items', thread_id: 'thread', turn_id: 'turn', cursor: 'native-cursor', limit: 1 };
  assert.deepEqual(await reader.call('codex_history', args), { device_id: 'laptop', device_name: 'Laptop', result: data });
  const { device_id, ...nativeArgs } = args; assert.deepEqual(calls, [{ name: 'codex_history', args: nativeArgs }]);
  await reader.close(); await assert.rejects(reader.call('codex_devices', {}), /closed/);
  const offline = new DeviceReader({ id: 'offline', label: 'Offline', offline_setup: true }, () => { throw new Error('must not launch'); });
  assert.equal((await offline.call('codex_devices', {})).devices[0].status, 'unavailable');
  await assert.rejects(offline.call('codex_threads', {}), /unavailable/); await offline.close();
});

test('configuration validates identities, paths and unknown fields; native env excludes credentials', () => {
  for (const config of [null, [], {}, { id: 'a', label: 'A', unknown: 1 }, { id: '../a', label: 'A' }, { id: 'a', label: '\n' }, { id: 'a', label: 'A', native: { executable: 'relative' } }]) assert.throws(() => validateConfig(config));
  const before = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'fixture-not-a-credential';
  try { assert.equal(nativeEnvironment().OPENAI_API_KEY, undefined); assert.equal(nativeEnvironment().CONTROL_PLANE_API_KEY, undefined); }
  finally { if (before === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = before; }
});

test('MCP stdout is protocol-clean, four read tools only, repeat initialization and clean EOF', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'context-mcp-'));
  const path = join(dir, 'device.json'); await writeFile(path, JSON.stringify({ id: 'test', label: 'Test', offline_setup: true }));
  const connection = client(process.execPath, [resolve('bridge/server.mjs'), path]);
  try {
    assert.ok((await connection.rpc('tools/list')).error);
    for (let n = 0; n < 2; n++) assert.ok((await connection.rpc('initialize', { protocolVersion: '2025-11-25' })).result);
    const tools = (await connection.rpc('tools/list')).result.tools;
    assert.deepEqual(tools.map(t => t.name), ['codex_devices', 'codex_threads', 'codex_history', 'codex_search']);
    assert.ok(tools.every(t => t.annotations.readOnlyHint));
    for (const name of ['codex_turn', 'codex_respond', 'codex_goal', 'codex_queue']) assert.equal((await connection.rpc('tools/call', { name, arguments: {} })).result.isError, true);
    assert.ok((await connection.rpc('tools/call', { name: 'codex_devices', arguments: {} })).result.structuredContent);
    assert.equal((await connection.rpc('tools/call', { name: 'codex_threads', arguments: {} })).result.isError, true);
  } finally { await connection.close(); await rm(dir, { recursive: true }); }
  assert.equal(connection.child.exitCode, 0);
});

test('MCP oversized history is a whole-page error without native data or cursor', async () => {
  const input = new PassThrough(), output = new PassThrough(); let text = '';
  output.on('data', data => { text += data; });
  const server = serveStdio({ call: async () => ({ result: { mode: 'history', data: ['x'.repeat(300000)], nextCursor: 'hidden-cursor' } }), close: async () => {} }, { input, output });
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'codex_history', arguments: {} } }) + '\n');
  await new Promise(resolve => setImmediate(resolve));
  const response = text.trim().split('\n').map(JSON.parse).find(r => r.id === 2);
  assert.equal(response.result.isError, true); assert.equal(response.result.structuredContent, undefined); assert.ok(!text.includes('hidden-cursor'));
  await server.close();
});
