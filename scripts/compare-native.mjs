// Opt-in comparison of a stable existing thread. Prints only verification facts.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { ReadOnlyAppServer } from '../bridge/readonly-policy.mjs';
import { nativeEnvironment } from '../bridge/native.mjs';
import { readConfig } from '../bridge/config.mjs';
import { ControlSurface } from '../dist/src/tools.js';
const { values } = parseArgs({ options: { config: { type: 'string' }, thread: { type: 'string' } } });
if (!values.config || !values.thread) throw new Error('Supply --config and --thread for a stable existing thread');
const config = await readConfig(values.config);
const manager = new ReadOnlyAppServer(undefined, { executable: config.native?.executable, environment: nativeEnvironment(config.native), requestTimeoutMs: 20000, prefixArgs: ['-c', 'sandbox_mode="read-only"', '-c', 'analytics.enabled=false'] });
try {
  const surface = new ControlSurface(manager);
  const page = await surface.call('codex_history', { thread_id: values.thread, kind: 'turns', limit: 1, content_policy: 'protected' });
  const native = await manager.request('thread/turns/list', { threadId: values.thread, limit: 1, sortDirection: 'desc', itemsView: page.items_view });
  for (const key of ['data', 'nextCursor', 'backwardsCursor']) assert.deepEqual(page[key], native[key]);
  let items = false;
  if (page.history_mode === 'paginated' && page.data.length) {
    const params = { threadId: values.thread, turnId: page.data[0].id, limit: 1, sortDirection: 'asc' };
    const result = await surface.call('codex_history', { thread_id: values.thread, turn_id: params.turnId, kind: 'items', limit: 1, content_policy: 'protected' });
    const raw = await manager.request('thread/items/list', params);
    for (const key of ['data', 'nextCursor', 'backwardsCursor']) assert.deepEqual(result[key], raw[key]);
    items = true;
  }
  console.log(JSON.stringify({ native_turn_page_equal: true, native_item_page_equal: items, content_printed: false, creates_threads: false }, null, 2));
} finally { await manager.close(); }
