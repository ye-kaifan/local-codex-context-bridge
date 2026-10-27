import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { encodeExactJson, MAX_EXACT_JSON_DEPTH } from "../src/exact-json.js";
import { hasSecretText } from "../src/redaction.js";
import { exactHistoryResponse, historyMcpBytes } from "../src/history.js";
import { exactSearchResponse } from "../src/search.js";
import { AppServerManager } from "../src/app-server.js";
import { RuntimeStore } from "../src/runtime.js";
import { ControlSurface } from "../src/tools.js";

test("exact JSON keeps wide/deep native data and has a deterministic low-stack serialization guard", () => {
  const response = { data: [{ items: Array.from({ length: 60 }, (_, id) => ({ id, text: "x".repeat(3000) })),
    fields: Object.fromEntries(Array.from({ length: 70 }, (_, i) => [String(i), i])),
    result: { structuredContent: { a: { b: { c: { d: { e: { f: { g: true } } } } } } } } }] };
  assert.strictEqual(exactHistoryResponse(response), response);
  assert.ok(historyMcpBytes(response, 1) < 256 * 1024);
  const deep = (n: number) => JSON.parse("[".repeat(n) + "0" + "]".repeat(n)) as unknown;
  assert.equal(encodeExactJson(deep(MAX_EXACT_JSON_DEPTH)).length, 513);
  assert.throws(() => encodeExactJson(deep(MAX_EXACT_JSON_DEPTH + 1)), /structure:/);
  const circular: unknown[] = []; circular.push(circular);
  for (const value of [circular, { a: undefined }, { a: Infinity }, { a: 1n }, new Date()]) {
    assert.throws(() => encodeExactJson(value), /structure:/);
  }
  const shared = { value: 1 }; assert.equal(encodeExactJson([shared, shared]), JSON.stringify([shared, shared]));
  const probe = spawnSync(process.execPath, ["--stack-size=200", "--input-type=module", "-e",
    `import { exactHistoryResponse, historyMcpBytes } from ${JSON.stringify(new URL("../src/history.js", import.meta.url).href)};
     let data = 0; for (let i=0; i<250; i++) data=[data]; historyMcpBytes(exactHistoryResponse({data}), 1);`
  ], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
});

test("protected detection is stateless across long/short strings and exact is per-call", () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(hasSecretText("padding ".repeat(30) + "password: fixture-long"), true);
    assert.equal(hasSecretText("password: x"), true);
    assert.equal(hasSecretText("ordinary code"), false);
    // Test both orders: a single matching sibling cannot hide behind regex state.
    for (const text of [["password: x", "ordinary"], ["ordinary", "password: x"]]) {
      assert.throws(() => encodeExactJson({ data: text }, "protected"), /content_policy:/);
    }
  }
  for (const item of [{ text: "interface Login { password: string }" }, { arguments: { page_token: "cursor" } }]) {
    const page = { data: [item] };
    assert.throws(() => exactHistoryResponse(page), /content_policy:/);
    assert.strictEqual(exactHistoryResponse(page, "exact"), page);
    assert.throws(() => exactHistoryResponse(page), /content_policy:/);
  }
  const snippet = "🌱 password: fixture-only";
  const page = { data: [{ turnId: "t", itemId: "i", turnCursor: "anchor", snippet,
    snippetMatchRange: { start: 3, end: 11 } }], nextCursor: "next" };
  assert.throws(() => exactSearchResponse(page, "occurrences", 1), /content_policy:/);
  assert.strictEqual(exactSearchResponse(page, "occurrences", 1, "exact"), page);
});

test("content policy validates before reads, is not forwarded natively and does not stick", async () => {
  class Native extends AppServerManager {
    calls: Array<{ method: string; params: unknown }> = [];
    override async request(method: string, params: any) {
      this.calls.push({ method, params });
      if (method === "thread/read") return { thread: { id: "t", historyMode: "legacy" } };
      if (method === "thread/turns/list") return { data: [{ id: "u", items: [{ text: "password: fixture" }] }], nextCursor: null, backwardsCursor: null };
      return { data: [{ thread: { id: "t" }, snippet: "password: fixture" }], nextCursor: null, backwardsCursor: null };
    }
  }
  const native = new Native(new RuntimeStore(), { executable: "unused-fixture" });
  const surface = new ControlSurface(native);
  for (const [tool, fields] of [["codex_history", { thread_id: "t", kind: "turns" }], ["codex_search", { kind: "threads", search_term: "password" }]] as const) {
    const before = native.calls.length;
    for (const content_policy of [null, "trusted_exact", 1]) await assert.rejects(surface.call(tool, { ...fields, content_policy }));
    assert.equal(native.calls.length, before);
    await assert.rejects(surface.call(tool, fields), /content_policy:/);
    await surface.call(tool, { ...fields, content_policy: "exact" });
    await assert.rejects(surface.call(tool, fields), /content_policy:/);
    assert.ok(native.calls.every(call => !Object.hasOwn(call.params as object, "content_policy")));
  }
});
