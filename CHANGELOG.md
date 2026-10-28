# Changelog

## Unreleased

- Suppress transcript payloads in native comparison failures and malformed JSONL diagnostics.
- Close the owned reader on MCP stream failures; bound split-line framing and test concurrency limits.
- Reject invalid supplied list cursors and mismatched thread/turn identities without fallback.
- Qualify the configured Codex executable, including custom setup directories.
- Restrict Gitee synchronization to main/version tags and keep its credential helper off GitHub fetches.
- Add isolated process, negative-path and local Git mirror regressions; clarify installation and recovery.

## 1.0.0

Initial standalone read-only release derived from Local Codex Bridge v2.3.4.
Includes source-device routing, native list/search/turn/item pagination, protected
whole-page delivery, dual read-only boundaries, Chat/Dot schema compatibility,
macOS Standard service scheduling, portable configuration and private-plugin
helpers, Codex-local isolation guidance, CI and release checks.

No writer tools, Gemini/Antigravity extensions, private installation configuration,
real transcripts, screenshots, credentials or private commit history are included.
