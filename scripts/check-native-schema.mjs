import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { findCodex, resolveNativeExecutable } from '../bridge/executable.mjs';
import { nativeEnvironment } from '../bridge/environment.mjs';
import { READ_METHODS } from '../bridge/readonly-policy.mjs';
import { readConfig } from '../bridge/config.mjs';
export async function selectSchemaCodex(options = {}, finder = findCodex, resolver = resolveNativeExecutable) {
  if (options.codex && options.config) throw new Error('Choose --config or --codex, not both');
  const initialEnvironment = nativeEnvironment({ codex_home: process.env.CODEX_HOME });
  if (options.codex) return { ...await finder(options.codex, initialEnvironment), environment: initialEnvironment };
  const configPath = options.config || resolve(dirname(fileURLToPath(import.meta.url)), '../.local/device.json');
  let config;
  try { config = await readConfig(configPath); }
  catch (error) {
    if (error.code !== 'ENOENT' || options.config) throw error;
    return { ...await finder(process.env.CODEX_EXE, initialEnvironment), environment: initialEnvironment }; // No installation yet.
  }
  if (!config.native?.executable && !config.native?.executable_source) throw new Error('Device config must identify the actual native executable');
  const environment = nativeEnvironment(config.native);
  if (config.native.executable_source) return { ...await resolver(config.native, environment), environment };
  return { ...await finder(config.native.executable, environment), environment };
}
export async function checkNativeSchema(codex) {
  const dir = await mkdtemp(join(tmpdir(), 'context-schema-'));
  try {
    const result = spawnSync(codex.path, ['app-server', 'generate-json-schema', '--experimental', '--out', dir], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, shell: false, windowsHide: true, env: codex.environment || nativeEnvironment() });
    if (result.status !== 0) throw new Error('Native schema export failed');
    const request = JSON.parse(await readFile(join(dir, 'ClientRequest.json'), 'utf8'));
    const methods = new Set();
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      const method = value.properties?.method;
      for (const item of method?.enum ?? []) methods.add(item);
      if (method?.const) methods.add(method.const);
      for (const child of Object.values(value)) visit(child);
    }
    visit(request);
    for (const method of READ_METHODS) if (!methods.has(method)) throw new Error('Missing native read method: ' + method);
    const fields = {
      ThreadListParams: ['limit', 'cursor', 'cwd', 'searchTerm', 'sourceKinds', 'parentThreadId', 'ancestorThreadId'],
      ThreadReadParams: ['threadId', 'includeTurns'],
      ThreadTurnsListParams: ['threadId', 'cursor', 'limit', 'itemsView', 'sortDirection'],
      ThreadItemsListParams: ['threadId', 'turnId', 'cursor', 'limit', 'sortDirection'],
      ThreadSearchParams: ['searchTerm', 'cursor', 'limit', 'sourceKinds', 'archived'],
      ThreadSearchOccurrencesParams: ['threadId', 'searchTerm', 'cursor', 'limit'],
    };
    for (const [name, keys] of Object.entries(fields)) {
      const schema = JSON.parse(await readFile(join(dir, 'v2', name + '.json'), 'utf8'));
      for (const key of keys) if (!Object.hasOwn(schema.properties, key)) throw new Error(`Missing ${name}.${key}`);
      if (keys.includes('cursor')) {
        function acceptsString(value, seen = new Set()) {
          if (!value || seen.has(value)) return false;
          seen.add(value);
          if (value.type === 'string' || (Array.isArray(value.type) && value.type.includes('string'))) return true;
          if (value.$ref?.startsWith('#/definitions/')) return acceptsString(schema.definitions[value.$ref.slice(14)], seen);
          return [...(value.anyOf ?? []), ...(value.oneOf ?? [])].some(child => acceptsString(child, seen));
        }
        if (!acceptsString(schema.properties.cursor)) throw new Error(name + ' cursor no longer accepts opaque strings');
      }
    }
    return { codex: codex.version, read_methods: READ_METHODS.length, parameter_shapes: Object.keys(fields).length, result: 'passed', scope: 'required methods/fields/string cursors; not full schema equivalence' };
  } finally { await rm(dir, { recursive: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { config: { type: 'string' }, codex: { type: 'string' } } });
  if (positionals.length > 1 || (positionals.length && (values.codex || values.config))) throw new Error('Use --config DEVICE_JSON or --codex EXECUTABLE');
  console.log(JSON.stringify(await checkNativeSchema(await selectSchemaCodex({ ...values, ...(positionals.length ? { codex: positionals[0] } : {}) })), null, 2));
}
