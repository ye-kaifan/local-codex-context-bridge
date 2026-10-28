// Opt-in comparison of a stable existing thread. Prints only verification facts.
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ReadOnlyAppServer } from '../bridge/readonly-policy.mjs';
import { nativeEnvironment } from '../bridge/native.mjs';
import { readConfig } from '../bridge/config.mjs';
import { ControlSurface } from '../dist/src/tools.js';
// AssertionError includes actual/expected transcript data in stderr. Only report
// the fixed page/field name when comparison fails; never attach either payload.
export function requireEqualPage(actual, expected, kind) {
  for (const key of ['data', 'nextCursor', 'backwardsCursor']) {
    if (!isDeepStrictEqual(actual[key], expected[key])) {
      throw new Error(`Native ${kind === 'items' ? 'item' : 'turn'} comparison failed (${key}); no content printed.`);
    }
  }
}
async function main() {
  const { values } = parseArgs({ options: { config: { type: 'string' }, thread: { type: 'string' } } });
  if (!values.config || !values.thread) throw new Error('Supply --config and --thread for a stable existing thread');
  const config = await readConfig(values.config);
  const manager = new ReadOnlyAppServer(undefined, { executable: config.native?.executable, environment: nativeEnvironment(config.native), requestTimeoutMs: 20000, prefixArgs: ['-c', 'sandbox_mode="read-only"', '-c', 'analytics.enabled=false'] });
  try {
    const surface = new ControlSurface(manager);
    const page = await surface.call('codex_history', { thread_id: values.thread, kind: 'turns', limit: 1, content_policy: 'protected' });
    const native = await manager.request('thread/turns/list', { threadId: values.thread, limit: 1, sortDirection: 'desc', itemsView: page.items_view });
    requireEqualPage(page, native, 'turns');
    let items = false;
    if (page.history_mode === 'paginated' && page.data.length) {
      const params = { threadId: values.thread, turnId: page.data[0].id, limit: 1, sortDirection: 'asc' };
      const result = await surface.call('codex_history', { thread_id: values.thread, turn_id: params.turnId, kind: 'items', limit: 1, content_policy: 'protected' });
      const raw = await manager.request('thread/items/list', params);
      requireEqualPage(result, raw, 'items');
      items = true;
    }
    console.log(JSON.stringify({ native_turn_page_equal: true, native_item_page_equal: items, content_printed: false, creates_threads: false }, null, 2));
  } finally { await manager.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
