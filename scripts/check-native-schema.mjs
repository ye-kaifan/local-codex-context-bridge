import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { findCodex } from './setup.mjs';
import { READ_METHODS } from '../bridge/readonly-policy.mjs';
const codex = await findCodex(process.argv[2]);
const dir = await mkdtemp(join(tmpdir(), 'context-schema-'));
try {
  const result = spawnSync(codex.path, ['app-server', 'generate-json-schema', '--experimental', '--out', dir], { encoding: 'utf8', timeout: 30000 });
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
  console.log(JSON.stringify({ codex: codex.version, read_methods: READ_METHODS.length, parameter_shapes: Object.keys(fields).length, result: 'passed', scope: 'required methods/fields/string cursors; not full schema equivalence' }, null, 2));
} finally { await rm(dir, { recursive: true }); }
