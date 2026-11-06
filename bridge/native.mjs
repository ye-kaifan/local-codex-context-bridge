import { RuntimeStore } from '../dist/src/runtime.js';
import { ControlSurface } from '../dist/src/tools.js';
import { ReadOnlyAppServer, READ_TOOLS } from './readonly-policy.mjs';
import { nativeEnvironment } from './environment.mjs';
import { resolveNativeExecutable } from './executable.mjs';

export { READ_TOOLS, nativeEnvironment };
export function createNative(config = {}, dependencies = {}) {
  // Resolve lazily, after the public allowlist. Concurrent reads share one start.
  // Failed discovery launches no child and may be retried by a later user read.
  // Once a manager exists, its fatal/protocol latch remains authoritative; no
  // failed call or partial multi-RPC history read is automatically replayed.
  const selectedConfig = structuredClone(config);
  const environment = nativeEnvironment(selectedConfig);
  let native, starting, closing;
  let closed = false;
  async function ready() {
    if (closed) throw new Error('Native reader is closed');
    if (native) return native;
    if (!starting) {
      starting = (async () => {
        const codex = await (dependencies.resolveExecutable || resolveNativeExecutable)(selectedConfig, environment);
        if (closed) throw new Error('Native reader was closed during executable discovery');
        const options = { executable: codex.path, environment, requestTimeoutMs: 20000,
          prefixArgs: ['-c', 'sandbox_mode="read-only"', '-c', 'analytics.enabled=false'] };
        native = dependencies.createManager ? dependencies.createManager(options) : new ReadOnlyAppServer(new RuntimeStore(), options);
        return native;
      })().finally(() => { starting = undefined; });
    }
    return starting;
  }
  const control = new ControlSurface({ request: async (method, params) => (await ready()).request(method, params) }, dependencies.platformPolicy);
  return {
    async call(name, args) {
      if (!READ_TOOLS.includes(name)) throw new Error('Read-only tool denied');
      if (closed) throw new Error('Native reader is closed');
      return control.call(name, args);
    },
    close() {
      closed = true;
      closing ??= (async () => {
        try { await starting; } catch { /* Discovery may have failed before creating a child. */ }
        await native?.close();
      })();
      return closing;
    },
  };
}
