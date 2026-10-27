import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { client } from './mcp-client.mjs';

const { values } = parseArgs({ options: { config: { type: 'string' }, thread: { type: 'string' }, search: { type: 'string' } } });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const connection = client(process.execPath, [resolve(root, 'bridge/server.mjs'), resolve(values.config || '.local/device.json')], { cwd: root });
const checks = [];
async function call(name, args) {
  const response = await connection.rpc('tools/call', { name, arguments: args });
  if (response.error || response.result?.isError) throw new Error(`Smoke check failed for ${name}: ${JSON.stringify(response.error || response.result.content)}`);
  return response.result.structuredContent;
}
try {
  assert.ok((await connection.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'context-smoke', version: '1.0.0' } })).result);
  const tools = (await connection.rpc('tools/list')).result.tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['codex_devices', 'codex_history', 'codex_search', 'codex_threads']);
  for (const tool of tools) assert.equal(tool.annotations.readOnlyHint, true);
  const denied = await connection.rpc('tools/call', { name: 'codex_turn', arguments: {} });
  assert.equal(denied.result.isError, true); checks.push('catalog and write denial');
  await call('codex_devices', {});
  const listed = await call('codex_threads', { limit: 1 });
  checks.push('native metadata listing');
  if (listed.result.nextCursor !== null) { await call('codex_threads', { device_id: listed.device_id, limit: 1, cursor: listed.result.nextCursor }); checks.push('native list continuation'); }
  // Opt-in body reads: the caller supplies one known existing thread.
  if (values.thread) {
    const args = { thread_id: values.thread, kind: 'turns', limit: 1, content_policy: 'protected' };
    const turns = await call('codex_history', args); checks.push('protected turn page');
    if (turns.result.nextCursor !== null) { await call('codex_history', { ...args, cursor: turns.result.nextCursor }); checks.push('native turn continuation'); }
    if (turns.result.history_mode === 'paginated' && turns.result.data.length) {
      const itemArgs = { thread_id: values.thread, kind: 'items', turn_id: turns.result.data[0].id, limit: 1, content_policy: 'protected' };
      const items = await call('codex_history', itemArgs); checks.push('protected item page');
      if (items.result.nextCursor !== null) { await call('codex_history', { ...itemArgs, cursor: items.result.nextCursor }); checks.push('native item continuation'); }
    }
  }
  if (values.search) {
    const args = { kind: 'threads', search_term: values.search, limit: 1, content_policy: 'protected' };
    const found = await call('codex_search', args); checks.push('protected native search');
    if (found.result.nextCursor !== null) { await call('codex_search', { ...args, cursor: found.result.nextCursor }); checks.push('native search continuation'); }
  }
  // Never print transcript data, identifiers, paths, queries or credentials.
  console.log(JSON.stringify({ passed: checks, history_requested: Boolean(values.thread), search_requested: Boolean(values.search), creates_threads: false }, null, 2));
} finally { await connection.close(); }
