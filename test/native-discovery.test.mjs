import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createNative } from '../bridge/native.mjs';
import { DARWIN_PLATFORM_POLICY } from '../dist/src/platform.js';

const page = () => ({ data: [], nextCursor: null, backwardsCursor: null });
const config = () => ({ executable_source: { kind: 'path', path: resolve('stable-codex') }, codex_home: resolve('fixed-home') });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('discovery waits for a valid read and concurrent reads share a single selected native manager', async () => {
  let resolutions = 0, managers = 0, closes = 0, requests = 0, release;
  const selected = config();
  const reader = createNative(selected, { platformPolicy: DARWIN_PLATFORM_POLICY,
    resolveExecutable: async (actual, env) => {
      resolutions++; assert.deepEqual(actual, selected); assert.equal(env.CODEX_HOME, selected.codex_home);
      await new Promise(resolve => { release = resolve; }); return { path: resolve('selected-codex') };
    },
    createManager: options => {
      managers++; assert.equal(options.executable, resolve('selected-codex')); assert.equal(options.environment.CODEX_HOME, selected.codex_home);
      assert.deepEqual(options.prefixArgs, ['-c', 'sandbox_mode="read-only"', '-c', 'analytics.enabled=false']);
      return { request: async () => { requests++; return page(); }, close: async () => { closes++; } };
    },
  });
  await assert.rejects(reader.call('turn/start', {}), /denied/);
  await assert.rejects(reader.call('codex_threads', { unexpected: true }));
  assert.equal(resolutions, 0);
  const first = reader.call('codex_threads', {}), second = reader.call('codex_threads', {});
  await tick(); assert.equal(resolutions, 1); assert.equal(managers, 0);
  release(); await Promise.all([first, second]);
  assert.equal(managers, 1); assert.equal(requests, 2);
  await Promise.all([reader.close(), reader.close()]); assert.equal(closes, 1);
  await assert.rejects(reader.call('codex_threads', {}), /closed/);
});

test('a failed pre-launch discovery is surfaced, not replayed, and a later read may resolve a repaired source', async () => {
  let resolutions = 0, managers = 0;
  const reader = createNative(config(), { platformPolicy: DARWIN_PLATFORM_POLICY,
    resolveExecutable: async () => { if (++resolutions === 1) throw new Error('source unavailable'); return { path: resolve('repaired') }; },
    createManager: () => { managers++; return { request: async () => page(), close: async () => {} }; },
  });
  await assert.rejects(reader.call('codex_threads', {}), /source unavailable/);
  assert.equal(resolutions, 1); assert.equal(managers, 0);
  await reader.call('codex_threads', {});
  assert.equal(resolutions, 2); assert.equal(managers, 1);
  await reader.close();
});

test('close during discovery prevents native creation and waits for that resolution', async () => {
  let release, managers = 0, closeDone = false;
  const reader = createNative(config(), { platformPolicy: DARWIN_PLATFORM_POLICY,
    resolveExecutable: () => new Promise(resolve => { release = () => resolve({ path: 'must-not-launch' }); }),
    createManager: () => { managers++; throw new Error('must not create'); },
  });
  const read = assert.rejects(reader.call('codex_threads', {}), /closed during/);
  await tick(); const closing = reader.close().then(() => { closeDone = true; });
  await tick(); assert.equal(closeDone, false);
  release(); await Promise.all([read, closing]); assert.equal(managers, 0);
});

test('native failure between history metadata and page reads never resolves or replays another generation', async () => {
  for (const failure of ['exited unexpectedly', 'invalid app-server JSONL', 'request timed out', 'native API rejected']) {
    let resolutions = 0, managers = 0; const methods = [];
    const reader = createNative(config(), { platformPolicy: DARWIN_PLATFORM_POLICY,
      resolveExecutable: async () => { resolutions++; return { path: resolve('selected') }; },
      createManager: () => { managers++; return {
        request: async method => {
          methods.push(method);
          if (methods.length === 1) return { thread: { id: 'thread', historyMode: 'paginated' } };
          throw new Error(failure);
        }, close: async () => {},
      }; },
    });
    await assert.rejects(reader.call('codex_history', { thread_id: 'thread', kind: 'turns' }), new RegExp(failure));
    assert.deepEqual(methods, ['thread/read', 'thread/turns/list']);
    await assert.rejects(reader.call('codex_threads', {}), new RegExp(failure));
    assert.equal(resolutions, 1); assert.equal(managers, 1);
    await reader.close();
  }
});

test('configuration is captured once and shutdown failure is not hidden or retried', async () => {
  const selected = config(), initial = structuredClone(selected); let closes = 0;
  const reader = createNative(selected, { platformPolicy: DARWIN_PLATFORM_POLICY,
    resolveExecutable: async actual => { assert.deepEqual(actual, initial); return { path: resolve('selected') }; },
    createManager: () => ({ request: async () => page(), close: async () => { closes++; throw new Error('shutdown uncertain'); } }),
  });
  selected.executable_source.path = resolve('different'); selected.codex_home = resolve('different-home');
  await reader.call('codex_threads', {});
  await assert.rejects(reader.close(), /shutdown uncertain/);
  await assert.rejects(reader.close(), /shutdown uncertain/); assert.equal(closes, 1);
});
