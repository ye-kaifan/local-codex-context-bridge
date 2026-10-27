import { AppServerManager } from '../dist/src/app-server.js';

export const READ_TOOLS = Object.freeze(['codex_threads', 'codex_history', 'codex_search']);
export const READ_METHODS = Object.freeze([
  'thread/list', 'thread/read', 'thread/turns/list', 'thread/items/list',
  'thread/search', 'thread/searchOccurrences',
]);

// Enforce below the public tool router, before even starting a native child.
export class ReadOnlyAppServer extends AppServerManager {
  async request(method, params) {
    if (!READ_METHODS.includes(method)) throw new Error('Read-only deployment: native method denied');
    if (method === 'thread/read' && params?.includeTurns !== false) {
      throw new Error('Read-only deployment requires metadata-only thread/read; use native pagination');
    }
    return super.request(method, params);
  }
  async respond() { throw new Error('Read-only deployment: native approvals denied'); }
}
