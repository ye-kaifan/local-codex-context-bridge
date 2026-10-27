import { RuntimeStore } from '../dist/src/runtime.js';
import { ControlSurface } from '../dist/src/tools.js';
import { ReadOnlyAppServer, READ_TOOLS } from './readonly-policy.mjs';

export { READ_TOOLS };
export function nativeEnvironment(config = {}) {
  const env = {};
  for (const key of ['PATH','HOME','USER','USERPROFILE','LOGNAME','LANG','LC_ALL','TMPDIR',
    'TEMP','TMP','SYSTEMROOT','SystemRoot','WINDIR','APPDATA','LOCALAPPDATA','PATHEXT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if (config.codex_home) env.CODEX_HOME = config.codex_home;
  return env;
}
export function createNative(config = {}) {
  const native = new ReadOnlyAppServer(new RuntimeStore(), {
    ...(config.executable ? {executable:config.executable} : {}),
    environment:nativeEnvironment(config), requestTimeoutMs:20000,
    prefixArgs:['-c','sandbox_mode="read-only"','-c','analytics.enabled=false'],
  });
  const control = new ControlSurface(native);
  return {
    async call(name,args) {
      if (!READ_TOOLS.includes(name)) throw new Error('Read-only tool denied');
      return control.call(name,args);
    },
    close:()=>native.close(),
  };
}
