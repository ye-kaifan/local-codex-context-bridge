import { CATALOG, INSTRUCTIONS } from './catalog.mjs';
import { sanitizeForTransport } from '../dist/src/runtime.js';
import { writeWithBackpressure } from '../dist/src/app-server.js';

const MAX_INPUT_BYTES = 65536;
export function serveStdio(hub, { input = process.stdin, output = process.stdout, catalog = CATALOG, instructions = INSTRUCTIONS } = {}) {
  let initialized = false, closing = false, outputFailed = false;
  let writes = Promise.resolve(), closePromise;
  const active = new Set(), tasks = new Set();
  const completion = Promise.withResolvers();
  // Event-driven shutdown may happen before a caller starts awaiting done.
  void completion.promise.catch(() => {});
  const stop = error => { void close(error).catch(() => {}); };
  function send(value) {
    if (closing || outputFailed) return Promise.resolve();
    let body = JSON.stringify(value) + '\n';
    const limit = value.result?.structuredContent?.result?.mode === 'history' ? 256 * 1024 : 1024 * 1024;
    if (Buffer.byteLength(body) > limit) body = JSON.stringify({ jsonrpc: '2.0', id: value.id, result: { isError: true, content: [{ type: 'text', text: 'Response byte budget exceeded; reduce the page size. No partial content was returned.' }] } }) + '\n';
    writes = writes.then(() => {
      if (!closing && !outputFailed) return writeWithBackpressure(output, body);
    }).catch(error => { outputFailed = true; stop(error); });
    return writes;
  }
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  async function accept(line) {
    let value;
    try { value = JSON.parse(line); } catch { return error(null, -32700, 'Invalid JSON'); }
    const { id, method, params = {} } = value ?? {};
    if (value?.jsonrpc !== '2.0' || typeof method !== 'string') return error(id ?? null, -32600, 'Invalid Request');
    if (id === undefined) return; // Notifications never start tool work.
    if (typeof id !== 'string' && !(typeof id === 'number' && Number.isSafeInteger(id))) return error(null, -32600, 'Invalid ID');
    if (active.has(id) || active.size >= 16) return error(id, -32000, 'Duplicate request or busy');
    active.add(id);
    try {
      if (method === 'initialize') {
        if (!params || typeof params.protocolVersion !== 'string') return error(id, -32602, 'protocolVersion required');
        initialized = true;
        return send({ jsonrpc: '2.0', id, result: { protocolVersion: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'].includes(params.protocolVersion) ? params.protocolVersion : '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'local-codex-context', version: '1.0.0' }, instructions } });
      }
      if (!initialized) return error(id, -32002, 'Initialize first');
      if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
      if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: catalog } });
      if (method !== 'tools/call') return error(id, -32601, 'Method denied');
      const result = await hub.call(params.name, params.arguments ?? {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'structured result' }], structuredContent: result } });
    } catch (e) {
      return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: sanitizeForTransport(e instanceof Error ? e.message : 'Reader request failed', { maxStringChars: 700, totalCharBudget: 700 }) }) }] } });
    } finally { active.delete(id); }
  }
  function enqueue(line) {
    if (closing) return;
    const task = accept(line);
    tasks.add(task);
    void task.catch(stop).finally(() => tasks.delete(task));
  }
  // Retain at most one bounded line, including when a chunk contains a giant line
  // followed by another request. Discard through the oversized line's newline.
  let buffer = Buffer.alloc(0), discard = false;
  function onData(chunk) {
    if (closing) return;
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < data.length) {
      const newline = data.indexOf(10, offset);
      const end = newline === -1 ? data.length : newline;
      if (!discard) {
        if (buffer.length + end - offset > MAX_INPUT_BYTES) {
          buffer = Buffer.alloc(0); discard = true;
          void error(null, -32700, 'JSON line too large');
        } else buffer = Buffer.concat([buffer, data.subarray(offset, end)]);
      }
      if (newline === -1) break;
      if (!discard) enqueue(buffer.toString('utf8'));
      buffer = Buffer.alloc(0); discard = false; offset = newline + 1;
    }
  }
  function close(cause) {
    if (closePromise) return closePromise;
    closing = true;
    input.pause(); input.off('data', onData); buffer = Buffer.alloc(0);
    closePromise = Promise.resolve().then(async () => {
      let failure = cause;
      try { await hub.close(); } catch (error) { failure ??= error; }
      await Promise.allSettled([...tasks]);
      await writes;
      if (failure) throw failure;
    });
    void closePromise.then(completion.resolve, completion.reject);
    return closePromise;
  }
  output.on('error', err => { outputFailed = true; stop(err); });
  output.once('close', () => { if (!closing) { outputFailed = true; stop(new Error('MCP output closed')); } });
  input.on('data', onData);
  input.once('end', () => stop());
  input.once('error', stop);
  input.once('close', () => { if (!closing) stop(); });
  return { close, done: completion.promise };
}
