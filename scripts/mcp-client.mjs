import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

export function client(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...options });
  const pending = new Map(); let sequence = 0; let errorText = '';
  child.stderr.on('data', data => { errorText = (errorText + data).slice(-4000); });
  function fail(error) { for (const call of pending.values()) { clearTimeout(call.timer); call.reject(error); } pending.clear(); }
  child.on('error', fail);
  child.on('exit', () => fail(new Error('MCP process exited: ' + errorText)));
  createInterface({ input: child.stdout }).on('line', line => {
    let response;
    try { response = JSON.parse(line); } catch { fail(new Error('Non-JSON output on MCP stdout')); return; }
    const call = pending.get(response.id);
    if (call) { clearTimeout(call.timer); pending.delete(response.id); call.resolve(response); }
  });
  return {
    child,
    rpc(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP request timeout')); }, options.timeout ?? 30000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const ended = once(child, 'exit'); child.stdin.end();
      const timer = setTimeout(() => child.kill(), 6000);
      try { await ended; } finally { clearTimeout(timer); }
    },
  };
}
