// Read-only subset derived from Local Codex Bridge v2.3.4; see THIRD_PARTY_NOTICES.md.
import { AppServerManager } from "./app-server.js";
import { sanitizeForTransport } from "./runtime.js";
import { platformPolicyFor, type PlatformPolicy } from "./platform.js";
import { exactHistoryResponse, validateHistoryPage } from "./history.js";
import { exactSearchResponse, SEARCH_PAGE_LIMIT } from "./search.js";

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

const HISTORY_TURN_LIMIT = 50;
const HISTORY_ITEM_LIMIT = 20;
const THREAD_SOURCE_KINDS = [
  "cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview",
  "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown",
] as const;
const THREAD_LIST_FIELDS = [
  "cwd", "search_term", "cursor", "limit", "parent_thread_id", "ancestor_thread_id", "source_kinds",
] as const;

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "codex_threads",
    title: "Codex Threads",
    description:
      "List/search persistent native threads or read one thread's metadata. Use codex_history for turns; include_turns:true errors. Capability and lineage fields are native metadata, not writer authorization. Include subagent source_kinds explicitly; native defaults to interactive sources. Metadata cannot reconstruct live Bridge state.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Read this exact thread instead of listing.",
        },
        include_turns: {
          type: "boolean",
          description: "Legacy: true errors; use codex_history.",
        },
        cwd: {
          type: "string",
          maxLength: 1000,
          description: "Exact absolute native cwd filter.",
        },
        parent_thread_id: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 200,
          pattern: "\\S",
          description: "Direct spawned children, not forks; select subagent sources separately.",
        },
        ancestor_thread_id: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 200,
          pattern: "\\S",
          description: "Spawned descendants at any depth, excluding the ancestor; not forks.",
        },
        source_kinds: {
          type: ["array", "null"],
          items: { type: "string", enum: THREAD_SOURCE_KINDS },
          maxItems: 100,
          description: "Omitted/null/[] keeps native interactive defaults; include subAgentThreadSpawn for spawned threads.",
        },
        search_term: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "Codex title substring filter.",
        },
        cursor: {
          type: "string",
          minLength: 1,
          maxLength: 10000,
          description: "Thread-list cursor only.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "Thread page size.",
        },
      },
      oneOf: [
        { not: { anyOf: [{ required: ["thread_id"] }, { required: ["include_turns"] }] } },
        { required: ["thread_id"], not: { anyOf: THREAD_LIST_FIELDS.map((key) => ({ required: [key] })) } },
      ],
      not: {
        required: ["parent_thread_id", "ancestor_thread_id"],
        properties: { parent_thread_id: { type: "string" }, ancestor_thread_id: { type: "string" } },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "Codex Threads",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "codex_history",
    title: "Codex History",
    description:
      "Read one lossless native persisted history page; this does not restore Bridge live state. Paginated mode supports turns or items within a turn; legacy mode supports one full turn, without item paging. Keep History cursors within the same thread/mode/kind/turn/sort scope; only nextCursor:null ends paging. Size, content-policy, or structure failure rejects the whole page without partial data or fallback.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" },
        kind: { type: "string", enum: ["turns", "items"] },
        content_policy: { type: "string", enum: ["protected", "exact"], default: "protected", description: "protected rejects secret-shaped content; exact exposes unchanged native text for this call. No fallback; neither value is an access-control level." },
        turn_id: { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" },
        cursor: { type: "string", minLength: 1, maxLength: 10_000, pattern: "\\S", description: "Native History cursor, not a thread-list, Search, or live Observe cursor." },
        limit: { type: "integer", minimum: 1, maximum: HISTORY_TURN_LIMIT, description: "Paginated turns default 20; items default 10/max 20; legacy turns require 1." },
        sort_direction: { type: "string", enum: ["asc", "desc"], description: "Turns default desc; items default asc. Use the opposite direction with a reverse cursor." },
      },
      required: ["thread_id", "kind"],
      oneOf: [
        { properties: { kind: { const: "turns" } }, not: { required: ["turn_id"] } },
        { properties: { kind: { const: "items" }, limit: { maximum: HISTORY_ITEM_LIMIT } }, required: ["turn_id"] },
      ],
      additionalProperties: false,
    },
    annotations: {
      title: "Codex History",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "codex_search",
    title: "Search Native Codex History",
    description:
      "Search native threads or locate message occurrences within one paginated thread; use codex_history to read content. Thread search differs from the codex_threads title filter and does not infer a workspace or ACL. Occurrences are case-insensitive literal matches in visible user and final assistant messages, not every item. Preserve query/scope/filters across Search pages; only nextCursor:null ends paging. An occurrence turnCursor anchors same-thread History, not Search continuation. Content-policy, size, or structure failure rejects the whole page without partial data/cursor. Results are locators, not a full history audit.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["threads", "occurrences"] },
        content_policy: { type: "string", enum: ["protected", "exact"], default: "protected", description: "protected rejects secret-shaped content; exact exposes unchanged native text for this call. No fallback; neither value is an access-control level." },
        search_term: { type: "string", minLength: 1, maxLength: 500, pattern: "\\S", description: "Native query, forwarded unchanged." },
        thread_id: { type: "string", minLength: 1, maxLength: 200, pattern: "\\S", description: "Occurrences: exact native paginated thread." },
        cursor: { type: "string", minLength: 1, maxLength: 10_000, pattern: "\\S", description: "Search continuation for the same query/scope/filters; never use occurrence turnCursor." },
        limit: { type: "integer", minimum: 1, maximum: SEARCH_PAGE_LIMIT, default: 20 },
        sort_key: { type: ["string", "null"], enum: ["created_at", "updated_at", "recency_at", null], description: "Threads only; omission/null uses native created_at." },
        sort_direction: { type: ["string", "null"], enum: ["asc", "desc", null], description: "Threads only; omission/null uses native descending order. Use the opposite direction with backwardsCursor." },
        source_kinds: { type: ["array", "null"], items: { type: "string", enum: THREAD_SOURCE_KINDS }, maxItems: 100, description: "Threads only; omitted/null/[] keeps native interactive defaults. Select subagents explicitly." },
        archived: { type: ["boolean", "null"], description: "Threads only; true selects archived threads." },
      },
      required: ["kind", "search_term"],
      oneOf: [
        { properties: { kind: { const: "threads" } }, not: { required: ["thread_id"] } },
        { properties: { kind: { const: "occurrences" } }, required: ["thread_id"], not: { anyOf: ["sort_key", "sort_direction", "source_kinds", "archived"].map(key => ({ required: [key] })) } },
      ],
      additionalProperties: false,
    },
    annotations: { title: "Search Native Codex History", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];
export const TOOL_NAMES = TOOL_DEFINITIONS.map(tool => tool.name);
function asObject(value: unknown, label = "arguments"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(args: Record<string, unknown>, allowed: readonly string[]): void {
  const extras = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new Error(`Unknown argument field: ${extras[0]}`);
  }
}

function requiredString(args: Record<string, unknown>, key: string, max = 200_000): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  if (value.length > max) {
    throw new Error(`${key} exceeds ${max} characters`);
  }
  return value;
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
  max = 200_000,
): string | undefined {
  if (args[key] === undefined) {
    return undefined;
  }
  return requiredString(args, key, max);
}

function optionalInteger(
  args: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function enumValue<T extends string>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${key} must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

function responseRecord(value: unknown, method: string): Record<string, unknown> {
  const record = asObject(value, `${method} response`);
  return record;
}

export class ControlSurface {
  constructor(private readonly appServer: AppServerManager,
    private readonly platformPolicy: PlatformPolicy = platformPolicyFor()) {}
  #cwd(args: Record<string, unknown>): string | undefined {
    const input = optionalString(args, "cwd", 1_000);
    return input ? this.platformPolicy.validateCwd(input) : undefined;
  }
  async call(name: string, rawArguments: unknown): Promise<unknown> {
    const args = asObject(rawArguments ?? {});
    switch (name) {
      case "codex_threads": return this.#threads(args);
      case "codex_history": return this.#history(args);
      case "codex_search": return this.#search(args);
      default: throw new Error("Read-only tool denied");
    }
  }
  async #history(args: Record<string, unknown>): Promise<unknown> {
    onlyKeys(args, ["thread_id", "kind", "turn_id", "cursor", "limit", "sort_direction", "content_policy"]);
    const policy = enumValue(args, "content_policy", ["protected", "exact"] as const) ?? "protected";
    const threadId = requiredString(args, "thread_id", 200);
    const kind = enumValue(args, "kind", ["turns", "items"]);
    if (kind === undefined) throw new Error("kind is required");
    if (kind === "turns" && Object.hasOwn(args, "turn_id")) {
      throw new Error("turn_id is valid only for items");
    }
    const turnId = kind === "items" ? requiredString(args, "turn_id", 200) : undefined;
    const cursor = optionalString(args, "cursor", 10_000);
    const requestedLimit = optionalInteger(args, "limit", 1, kind === "turns" ? HISTORY_TURN_LIMIT : HISTORY_ITEM_LIMIT);
    const sortDirection = enumValue(args, "sort_direction", ["asc", "desc"])
      ?? (kind === "turns" ? "desc" : "asc");

    // Native mode is read on demand, never cached in Bridge live state.
    const metadata = await this.appServer.request("thread/read", { threadId, includeTurns: false });
    const thread = asObject(responseRecord(metadata, "thread/read").thread, "thread/read result.thread");
    const historyMode = thread.historyMode;
    if (thread.id !== threadId || (historyMode !== "paginated" && historyMode !== "legacy")) {
      throw new Error("history_upstream_invalid: metadata must identify the requested thread and a supported historyMode");
    }
    if (historyMode === "legacy") {
      if (kind === "items") {
        throw new Error("history_legacy_item_paging_unsupported: use codex_history with kind:'turns' for native one-full-turn pages; legacy has no item cursor");
      }
      if (requestedLimit !== undefined && requestedLimit !== 1) {
        throw new Error("legacy history turn pages require limit:1");
      }
    }
    const limit = requestedLimit ?? (historyMode === "legacy" ? 1 : kind === "turns" ? 20 : 10);
    const itemsView = historyMode === "legacy" ? "full" : "notLoaded";
    const page = validateHistoryPage(await this.appServer.request(
      kind === "turns" ? "thread/turns/list" : "thread/items/list",
      {
        threadId,
        ...(turnId ? { turnId } : {}),
        ...(cursor ? { cursor } : {}),
        limit,
        sortDirection,
        ...(kind === "turns" ? { itemsView } : {}),
      },
    ), limit, kind);
    return exactHistoryResponse({
      source: "codex_app_server",
      mode: "history",
      coverage: "native_persisted_history",
      history_mode: historyMode,
      kind,
      page_granularity: kind === "turns" ? "turn" : "item",
      ...(kind === "turns" ? { items_view: itemsView } : {}),
      thread_id: threadId,
      ...(turnId ? { turn_id: turnId } : {}),
      data: page.data,
      nextCursor: page.nextCursor,
      backwardsCursor: page.backwardsCursor,
    }, policy);
  }

  async #search(args: Record<string, unknown>): Promise<unknown> {
    const kind = enumValue(args, "kind", ["threads", "occurrences"] as const);
    if (!kind) throw new Error("kind is required");
    const policy = enumValue(args, "content_policy", ["protected", "exact"] as const) ?? "protected";
    onlyKeys(args, ["kind", "search_term", "cursor", "limit", "content_policy", ...(kind === "threads"
      ? ["sort_key", "sort_direction", "source_kinds", "archived"] : ["thread_id"])]);
    const limit = optionalInteger(args, "limit", 1, SEARCH_PAGE_LIMIT) ?? 20;
    const params: Record<string, unknown> = { searchTerm: requiredString(args, "search_term", 500), limit };
    const cursor = optionalString(args, "cursor", 10_000);
    if (cursor !== undefined) params.cursor = cursor;
    if (kind === "occurrences") {
      params.threadId = requiredString(args, "thread_id", 200);
    } else {
      const sortKey = args.sort_key === null ? null : enumValue(args, "sort_key", ["created_at", "updated_at", "recency_at"] as const);
      const sortDirection = args.sort_direction === null ? null : enumValue(args, "sort_direction", ["asc", "desc"] as const);
      const archived = args.archived === null ? null : optionalBoolean(args, "archived");
      const sourceKinds = args.source_kinds;
      if (sourceKinds !== undefined && sourceKinds !== null && (
        !Array.isArray(sourceKinds) || sourceKinds.length > 100 ||
        sourceKinds.some(value => typeof value !== "string" || !(THREAD_SOURCE_KINDS as readonly string[]).includes(value))
      )) throw new Error("source_kinds must be null or an array of at most 100 native source kinds");
      if (sortKey !== undefined) params.sortKey = sortKey;
      if (sortDirection !== undefined) params.sortDirection = sortDirection;
      if (archived !== undefined) params.archived = archived;
      if (sourceKinds !== undefined) params.sourceKinds = sourceKinds;
    }
    const method = kind === "threads" ? "thread/search" : "thread/searchOccurrences";
    return exactSearchResponse(await this.appServer.request(method, params), kind, limit, policy);
  }

  async #threads(args: Record<string, unknown>): Promise<unknown> {
    onlyKeys(args, ["thread_id", "include_turns", ...THREAD_LIST_FIELDS]);
    const threadId = optionalString(args, "thread_id", 200);
    if (threadId) {
      if (THREAD_LIST_FIELDS.some((key) => Object.hasOwn(args, key))) {
        throw new Error("thread_id cannot be combined with list/search fields");
      }
      const includeTurns = optionalBoolean(args, "include_turns") ?? false;
      if (includeTurns) {
        throw new Error("include_turns:true is no longer supported; use codex_history(thread_id, kind:'turns') and native history mode guidance");
      }
      const result = await this.appServer.request("thread/read", {
        threadId,
        includeTurns: false,
      });
      return sanitizeForTransport({ source: "codex_app_server", mode: "read", ...responseRecord(result, "thread/read") });
    }
    if (Object.hasOwn(args, "include_turns")) {
      throw new Error("include_turns is valid only with thread_id");
    }
    const cwd = this.#cwd(args);
    const searchTerm = optionalString(args, "search_term", 500);
    const cursor = optionalString(args, "cursor", 10_000);
    const limit = optionalInteger(args, "limit", 1, 100) ?? 20;
    const parentThreadId = args.parent_thread_id === null ? null : optionalString(args, "parent_thread_id", 200);
    const ancestorThreadId = args.ancestor_thread_id === null ? null : optionalString(args, "ancestor_thread_id", 200);
    if (parentThreadId != null && ancestorThreadId != null) {
      throw new Error("parent_thread_id and ancestor_thread_id are mutually exclusive");
    }
    const sourceKinds = args.source_kinds;
    if (sourceKinds !== undefined && sourceKinds !== null && (
      !Array.isArray(sourceKinds) || sourceKinds.length > 100 ||
      sourceKinds.some((kind) => typeof kind !== "string" || !(THREAD_SOURCE_KINDS as readonly string[]).includes(kind))
    )) {
      throw new Error("source_kinds must be null or an array of at most 100 native source kinds");
    }
    const result = await this.appServer.request("thread/list", {
      limit,
      sortKey: "updated_at",
      sortDirection: "desc",
      ...(cwd ? { cwd } : {}),
      ...(searchTerm ? { searchTerm } : {}),
      ...(cursor ? { cursor } : {}),
      ...(parentThreadId !== undefined ? { parentThreadId } : {}),
      ...(ancestorThreadId !== undefined ? { ancestorThreadId } : {}),
      ...(sourceKinds !== undefined ? { sourceKinds } : {}),
    });
    const page = responseRecord(result, "thread/list");
    if (!Array.isArray(page.data)) {
      throw new Error("thread/list returned no data array");
    }
    return {
      source: "codex_app_server",
      mode: "list",
      nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null,
      backwardsCursor: typeof page.backwardsCursor === "string" ? page.backwardsCursor : null,
      data: page.data.map((thread) => sanitizeForTransport(thread, {
        maxStringChars: 4_000,
        maxDepth: 6,
        maxArrayItems: 20,
        maxObjectKeys: 60,
        totalCharBudget: 12_000,
      })),
    };
  }

}
