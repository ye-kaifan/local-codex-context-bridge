# Attribution and third-party licenses

## Local Codex Bridge

Derived from https://github.com/zoeynine/Local-Codex-Bridge at commit
`5f20b24940ed3024ed10d6ca45498f30f9750ea9` (package version 2.3.4).
The LICENSE at that exact commit was verified before publication:
https://github.com/zoeynine/Local-Codex-Bridge/blob/5f20b24940ed3024ed10d6ca45498f30f9750ea9/LICENSE

Copyright (c) 2026 Local Codex Bridge contributors. MIT License. The original
[LICENSE](LICENSE) is retained verbatim. New modifications are also MIT licensed:
Copyright (c) 2026 ye-kaifan and Local Codex Context Bridge contributors.

`upstream-files.json` records SHA-256 hashes of the unchanged shared core files.
`src/tools.ts` selects the three read-only schemas, validators and handlers from
upstream. Relevant exact JSON, history, search and platform tests are adapted;
writer/observe-only tests are excluded. Shared process/runtime support remains
internal; its mutation-capable public tool router and executable are not shipped.
The only published server constructs a read-only native manager.

Changes added here: device provenance and source checks; flat Chat/Dot schemas
with eight redundant nonblank regexes removed (server validation retained);
MCP and native-method allowlists; protected whole-page transport; portable setup,
private-plugin generation, Codex isolation fragments and macOS Standard scheduling;
release/security tests and installation documentation. No upstream assets,
screenshots, private Git history, real sessions or private extension binaries are
redistributed.

## Build dependencies

There are no third-party npm runtime dependencies. The pinned build/type packages
and their transitive packages are listed in `package-lock.json`:

| Package | Version | License | Included notice |
| --- | --- | --- | --- |
| TypeScript and optional `@typescript/typescript-*` native compiler packages | 7.0.2 | Apache-2.0; bundled notices retained | `licenses/typescript-LICENSE`, `licenses/typescript-NOTICE.txt` |
| `@types/node` | 24.13.3 | MIT | `licenses/node-types-LICENSE` |
| `undici-types` | 7.18.2 | MIT | `licenses/undici-types-LICENSE` |

Dependencies themselves are installed from their registry distributions and are
not bundled in the release archive. The compiler's own third-party notices are
preserved without removing nested notices. No new image, font or icon assets are
used. Node.js, the official Codex CLI and optional OpenAI tunnel-client are external
prerequisites; they are not copied into this repository or package. Install them
from their official distributions with their accompanying licenses. The optional
macOS watcher uses the system AppKit framework and includes no Apple binary.
