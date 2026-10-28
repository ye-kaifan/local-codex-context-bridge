# Release verification

Evidence for the initial generic release, performed 2026-10-27. Private raw outputs,
source identifiers, generated device configs and transcripts are not published.

## Passed locally

- Clean allowlist extraction from the current installation, preserving the three
  known compatibility fixes; no private Git history imported.
- Pinned npm dependency installation; JavaScript syntax/whitespace lint; strict
  TypeScript typecheck and build.
- 46 deterministic tests: exact JSON/content policy, turn/item and legacy paging,
  error/size boundaries, source routing, native method denial, blocked approvals,
  MCP initialization/stdout/EOF, all eight portable-schema cases, platform process
  policy, plugin packaging and Standard scheduling.
- Native required-method/parameter schema check against official Codex CLI 0.164.0.
  It accepts that version's string-or-anchor item cursor union while continuing to
  expose only opaque string cursors. This is not a complete schema equivalence claim.
- **Real macOS Apple Silicon reads**, Node 25.1.0 / Codex CLI 0.164.0: native listing
  and continuation; protected full-text search and continuation; protected turn pages
  and continuation on a completed multi-turn session; protected item pages and
  continuation. These checks created/resumed/modified no native session.
- Direct comparison of a completed session's turn and item data plus forward/reverse
  cursors between the read-only bridge and official raw app-server responses: equal.
  No transcript content was printed or copied into fixtures.
- macOS AppKit lifecycle watcher compiled and passed its synthetic child-process
  test: absent app state, start, no duplicate child, stop, crash/retry, and relaunch.
- npm audit reported zero known dependency vulnerabilities at verification time.
- Package/source allowlist, common secret/personal path checks and unchanged-upstream
  SHA-256 checks. Gitleaks 8.30.1 found no leaks in the allowlisted source tree or
  unpacked runtime archive. Final Git history is scanned before push and by CI; scans
  are not proof that every possible secret is absent.

CI runs the deterministic checks, packaging and dependency audit on macOS and
Windows with Node 24. Inspect the workflow status for the **exact commit** you use:
https://github.com/ye-kaifan/local-codex-context-bridge/actions
Do not infer native Windows/desktop acceptance from a green fixture-based CI job.

## Not executed for this new generic package

- A new Chat/Dot cloud plugin/Tunnel was not created or installed on the maintainer's
  account, and its existing private installation was not replaced. Real Chat and Dot
  acceptance on a user's new connection is an installation step, not proven by old
  private deployment reports or the portable schema regression alone.
- Real Windows Codex history, Windows credential storage, background tasks and desktop
  lifecycle; Windows builds/tests are not a substitute for those checks.
- Linux/WSL, macOS Intel native reads, every possible query, all history modes on real
  accounts, or a full-corpus read. Legacy behavior has deterministic coverage.
- New macOS LaunchAgent registration or real cloud Tunnel lifecycle for this release.
  The compiled watcher self-test uses disposable synthetic children only.

## Initial issues resolved during preparation

The first extracted test suite retained references to upstream writer/observe tools;
those tests were removed/adapted to the explicitly read-only API. The first schema
checker assumed a direct string cursor type and failed on Codex's additive union;
reference/union traversal corrected the check without changing runtime pagination.
An npm pack attempt hit the task's cache sandbox restriction; using a task-local
cache resolved it without changing ownership or permissions in the user's home.

## Additional regression coverage

The follow-up tests exercise malformed list cursors and mismatched thread/turn
identities, payload-free comparison/parse failures, configured executable selection,
MCP broken pipes, split oversized frames and concurrency limits. A disposable native
process records the wire methods and verifies child exit without loading real sessions.
The mirror regression executes the workflow shell against local Git repositories
with network protocols disabled. These fixtures do not establish Windows desktop,
Chat/Dot cloud or live Gitee-write acceptance.
