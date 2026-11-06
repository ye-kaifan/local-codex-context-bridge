// Keep discovery probes and the native child on the same credential-free environment.
export function nativeEnvironment(config = {}, source = process.env) {
  const env = {};
  for (const key of ['PATH','HOME','USER','USERPROFILE','LOGNAME','LANG','LC_ALL','TMPDIR',
    'TEMP','TMP','SYSTEMROOT','SystemRoot','WINDIR','APPDATA','LOCALAPPDATA','PATHEXT']) {
    if (source[key]) env[key] = source[key];
  }
  if (config.codex_home) env.CODEX_HOME = config.codex_home;
  return env;
}
