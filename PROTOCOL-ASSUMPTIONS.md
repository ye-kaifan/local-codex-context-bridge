# Native protocol contract

This read-only derivative retains the relevant history/search boundary from Local
Codex Bridge v2.3.4, baseline commit `5f20b24940ed3024ed10d6ca45498f30f9750ea9`.
Qualification is version-sensitive; method presence alone is not full compatibility.

- The official child uses `codex app-server --listen stdio://` with initialization and
  experimental API capability, JSONL transport and bounded shutdown. The native request
  timeout is 20 seconds. No Bridge retry or fallback search is added after a timeout.
- Only `thread/list`, `thread/read`, `thread/turns/list`, `thread/items/list`,
  `thread/search`, and `thread/searchOccurrences` pass the native read guard.
  Metadata reads require `includeTurns:false`. Public input cannot call arbitrary RPCs.
- History reads mode metadata on demand. `paginated` uses `itemsView:notLoaded` turn
  pages (default 20, maximum 50) and separate item pages (default 10, maximum 20) with
  a required turn ID. `legacy` uses one `itemsView:full` turn and rejects item paging.
  Unknown modes, malformed metadata or responses fail without full hydration.
- Native opaque cursors are forwarded unchanged. Preserve device, thread, mode, kind,
  turn and sort scope. Empty results with nonnull cursors are not an end condition.
  An occurrence's `turnCursor` is a same-thread History anchor, not Search continuation.
- History success is lossless within a 256 KiB actual MCP-frame ceiling. The native
  envelope is validated, then the final device-wrapped frame is checked again. A
  protected, structural or size failure returns no partial data or cursor. Search
  uses a 256 KiB result-body bound and validates native identities/UTF-16 match ranges.
- Metadata/list projections use upstream bounded sanitization; they are distinct
  from lossless history. Search locates user/final-assistant text, not every tool item,
  and its filters are not workspace ACLs or semantic relevance ranking.
- MCP success lives in `structuredContent`, with a tiny text marker. Inputs are bounded
  JSONL; initialize may repeat. Tool schemas are flat for client compatibility, but
  conditional arguments and nonblank strings remain validated server-side. Eight
  redundant nonblank patterns are removed only from the published schema adapter.
- Device context stays in the wrapper. A native error/offline source is not a successful
  empty result. `codex_devices` reports configuration, not verified native availability.
- Writer/approval/Goal/Queue/Observe tools are absent. Internal shared upstream process
  and runtime code does not authorize the public reader to send mutations. Reading
  persisted content does not reconstruct a live execution state.

## Current qualification

macOS Apple Silicon, Node 25.1.0, official Codex CLI 0.164.0: live metadata, native
search with continuation, protected turns/items and their continuations, and direct
native-page comparisons are tested. See docs/verification.md for precise coverage.

`check:native-schema` exports the installed schema and checks six read methods and
required parameter fields. Codex 0.164.0 item cursors are an additive union of opaque
strings and item-anchor objects; this bridge deliberately continues using supported
opaque strings. The check follows schema references/unions and rejects loss of string
support. It does not claim exact equivalence of all schema fields or notifications.

The upstream `check:compact-schema` covers a live supervisory feature outside this
release; its historical full-match assumptions are not used as this reader's release
gate. On native upgrades, rerun deterministic tests, the read-specific schema check,
real protected pagination/comparison, and Chat/Dot acceptance. Do not assume a future
native release is qualified because its version number is higher.
