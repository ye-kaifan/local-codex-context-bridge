# Local Codex Context Bridge

[简体中文](README.zh-CN.md) · [Install with Codex](INSTALL.md) · [Security](docs/security.md) · [Protocol](PROTOCOL-ASSUMPTIONS.md)

Give ChatGPT **Chat and Dot read-only access to existing Codex sessions** on your own computers. The bridge uses the official `codex app-server`, preserves native turn/item pagination and source-device labels, and can run behind your own Secure MCP Tunnel. It cannot start, resume, execute, edit or delete Codex work.

This is an independent MIT-licensed derivative of [zoeynine/Local-Codex-Bridge](https://github.com/zoeynine/Local-Codex-Bridge), based on v2.3.4 commit [`5f20b249`](https://github.com/zoeynine/Local-Codex-Bridge/tree/5f20b24940ed3024ed10d6ca45498f30f9750ea9). The original copyright and license are retained. See [third-party notices](THIRD_PARTY_NOTICES.md) for the selected core, changes and dependency licenses. No Gemini or Antigravity integration is included.

## Give this to your Codex

```text
Install https://github.com/ye-kaifan/local-codex-context-bridge for read-only
Codex context in ChatGPT Chat and Dot. Read INSTALL.md and follow it end to end.
Detect my OS, actual Codex executable/home and existing connections; preserve
my current installation and settings. Build and test locally, then help connect
my own private Secure MCP Tunnel and configure Codex-local plugin isolation.
Pause for my login, secret entry or approval of new account permissions. Do not
create credentials, expose public ports, or change unrelated settings silently.
Verify real read-only search and native turn/item continuation; report what
passed and what still needs manual action.
```

## Local quick start

Install Git, Node.js **24 or later**, npm, and an official standalone Codex CLI first. Codex is not an npm dependency of this project. Use the account/home that actually contains your sessions.

```sh
git clone https://github.com/ye-kaifan/local-codex-context-bridge.git
cd local-codex-context-bridge
npm ci --ignore-scripts
npm run typecheck
npm test
npm run setup -- --id laptop --label "My laptop"
npm run smoke
```

Setup creates a **new** `.local/` directory with `device.json`, `mcp.json` and `command.json`. It detects Node, resolves Codex from `PATH` or `CODEX_EXE`, honors `CODEX_HOME`, and refuses to overwrite an existing directory. Use `--out NEW_DIRECTORY` for another configuration; use `--codex ABSOLUTE_PATH` and `--codex-home ABSOLUTE_PATH` when detection is insufficient. On Windows, provide the native `codex.exe` if only an npm `.cmd` shim is on `PATH`.

The generated `command.json` is the stdio command for your MCP client or Tunnel. Launch **Node directly**, never `npm start` behind MCP: npm's lifecycle output is not JSON-RPC. Local setup does not install a cloud plugin, start a background service, change Codex settings, or create credentials.

[INSTALL.md](INSTALL.md) covers Chat/Dot connection, multiple devices, optional macOS app lifecycle, Windows background setup, Codex isolation, uninstall and recovery.

## What it exposes

| Tool | Purpose |
| --- | --- |
| `codex_devices` | Identify this source and whether setup is pending. `configured` is not a native availability probe. |
| `codex_threads` | Native title/list filtering, lineage filters and metadata-only reads. |
| `codex_search` | Native full-text search and within-thread occurrence locators. |
| `codex_history` | Lossless native turn pages, then item pages for each turn. |

Each device runs its own reader/connection. Multi-device context is assembled by the client, with each device's results and unavailable status reported separately. There is no cross-device history store, local search index, or dependency on the maintainer's infrastructure.

**History and Search default to `protected`.** Secret-shaped or oversized content rejects the whole page. There is no silent truncation, redaction-as-success, full-thread fallback or automatic switch to `exact`. Explicit per-call `exact` is available but can expose sensitive content; it is not an access-control level. List/metadata responses use the upstream bounded sanitizer and are not lossless transcripts.

Keep the original source, query and cursor scope. Read turns, then items; only `nextCursor: null` ends a range. Empty pages can still have a continuation. Legacy history uses one full turn per page and has no item pagination.

## Compatibility and verification

| Component | Scope |
| --- | --- |
| macOS | Supported; native read-only qualification performed on Apple Silicon with Node 25.1.0 and Codex CLI 0.164.0. |
| Windows | Shared implementation and Windows CI regression coverage; real Codex installation, DPAPI/service and Chat/Dot acceptance still require verification on the target computer. |
| Linux / WSL | Not supported in this release; rejected explicitly. |
| Chat / Dot | Current portable schemas retain the deployed compatibility fixes. This new generic package requires end-to-end acceptance on each user's private connection. |

The required native methods/fields matter more than a version comparison. Run `npm run check:native-schema`; upgrading Codex may change its experimental APIs. [Protocol notes](PROTOCOL-ASSUMPTIONS.md) describe the contract and limits. [Verification](docs/verification.md) distinguishes deterministic, real-native and unexecuted checks.

## Development

```sh
npm run lint
npm run typecheck
npm test
npm run check:release
npm audit
npm pack
```

The lint command checks JavaScript syntax, whitespace and conflict markers; strict TypeScript checking is separate. CI runs on macOS and Windows with Node 24. Tests use synthetic data and do not need accounts or create native sessions. Live smoke tests are opt-in and print verification facts, not transcript content.

The repository contains source and install guidance. It is **not** a publicly hosted MCP endpoint, a shared Tunnel, or an OpenAI-endorsed product.

`npm pack` produces a runtime archive containing built code and setup helpers. For
development/build/tests use the Git checkout above. To use the unpacked runtime
archive, run `node scripts/setup.mjs` from its `package/` directory; no npm runtime
dependencies are needed. Generated `.local/` files are never included in the archive.
