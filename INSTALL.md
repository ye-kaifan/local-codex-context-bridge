# Installation runbook for Codex and humans

This repository can be installed from its GitHub URL. Complete local preparation
first; then guide the owner through the few account-specific steps. Never substitute
a maintainer's paths, plugin IDs, credentials or Tunnel. Do not install a public MCP
listener. The source is public; each user's session-reading connection remains private.

## 1. Inspect and preserve

Read README.md, docs/security.md and any target-machine instructions. Identify OS,
architecture, Node/npm/Git, the **official standalone Codex executable**, the home
that actually contains the user's sessions, and existing Bridge/Tunnel installations.
Use supported Codex metadata/reading surfaces to verify the source; do not inspect or
copy raw session databases/JSONL files to bypass a policy refusal.

Support here is macOS and Windows. Linux/WSL is not qualified and fails explicitly.
Node >=24 is required. The release was live-qualified with Codex CLI 0.164.0 on macOS;
it requires the native read methods described in PROTOCOL-ASSUMPTIONS.md. Install
Codex separately from its official distribution. Do not replace a desktop-bundled
runtime or upgrade a working installation silently. If a prerequisite is missing,
explain the specific installation required and follow the user's permissions.

Clone into a new persistent directory. Inspect an existing checkout before updating,
keep uncommitted work, and do not reuse a running private installation as a build area.
Use a separate new directory when in doubt. No private Git history should be imported.

## 2. Build and configure this device

```sh
git clone https://github.com/ye-kaifan/local-codex-context-bridge.git
cd local-codex-context-bridge
npm ci --ignore-scripts
npm run lint
npm run typecheck
npm test
npm run setup -- --id laptop --label "My laptop"
npm run check:native-schema
npm run smoke
```

Setup creates `.local/` with owner-only permissions on POSIX. It refuses an existing
directory, including one left by an interrupted setup. Inspect that directory and
choose `--out NEW_DIRECTORY` to retry safely; do not delete it blindly. On Windows,
use a private user directory with appropriate ACLs.

Override detection with `--codex ABSOLUTE_EXECUTABLE`, `--codex-home ABSOLUTE_HOME`
or `--out NEW_DIRECTORY`. Native home defaults to `CODEX_HOME`, then `~/.codex`.
The home existing is not proof it contains the intended sessions: verify a known
session through the tools. Windows must use native `codex.exe`, not `codex.cmd`.
See [Windows notes](windows/README.md).

`.local/command.json` contains the absolute Node command, arguments and working
directory. `.local/mcp.json` is an example stdio MCP configuration. Always launch
Node directly for MCP. Do not add this reader to Codex's own MCP configuration for
normal use: its target is Chat and Dot, while Codex retains native session access.

For a completed existing session chosen by the owner, verify real body pagination:

```sh
node scripts/smoke.mjs --config .local/device.json --thread EXISTING_THREAD_ID --search "known phrase"
node scripts/compare-native.mjs --config .local/device.json --thread EXISTING_THREAD_ID
```

The second script compares one native turn/item page and cursors with the bridge
result without printing content. Choose a stable completed session because concurrent
edits can invalidate a comparison. Smoke follows at most one continuation in each
range; it does not claim a complete history audit. A protected failure is a real
verification limit; reduce the page size or report it, never change to exact implicitly.

## 3. Connect the owner's Chat and Dot

Consult the current official [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
and [custom MCP connection guide](https://developers.openai.com/api/docs/guides/custom-mcp-server).
Install the official [tunnel-client](https://github.com/openai/tunnel-client) separately;
inspect its current CLI help rather than assuming an old binary's flags still work.
The following profile format matches the integration this project derives from.

1. Have the owner sign into the intended Platform organization and ChatGPT workspace.
   Reuse a suitable existing Tunnel. Confirm its workspace association and permissions.
2. If new account permissions, a Tunnel or a runtime key are needed, present the exact
   proposed change and wait for the owner. The source install does not authorize creating
   persistent access credentials. Tunnel management and runtime use are separate privileges.
3. Use a restricted runtime key with Tunnels Read + Use when supported. Let the owner
   choose/approve its expiry. Receive it only via local hidden input and store it in the
   OS credential store, never in chat or command arguments. Do not silently rotate keys.
4. Generate a profile using the owner's existing Tunnel ID:

```sh
node scripts/tunnel-config.mjs --command .local/command.json --tunnel-id YOUR_EXISTING_TUNNEL_ID --out .local/tunnel.yaml
```

5. Run `tunnel-client run --config ABSOLUTE_PROFILE_PATH` through a private local wrapper
   that obtains the runtime key from the OS credential store and exports it as
   `CONTROL_PLANE_API_KEY`. The profile contains only an environment-variable reference.
   Confirm current CLI syntax with `tunnel-client run --help`. Do not redirect credentials
   to logs. The bridge strips them from the native Codex child's environment.
6. In ChatGPT's plugin UI, add a custom MCP server with Tunnel connection. Select this
   Tunnel in the intended workspace, review the requested access, and create a private
   plugin. Account availability and UI permissions require the owner/admin; they cannot
   be made universal by an installer. Do not submit the private session reader to a public
   plugin directory.
7. In a new ordinary Chat **and** a Dot with the private plugin enabled, identify the source,
   locate a known session, read a turn and an item, and follow their actual next cursors.
   Test native search as well. A healthy Tunnel alone is not this acceptance test.

If an account cannot create a private Tunnel connection, report that exact blocker.
Keep the working local stdio reader; do not open public inbound ports as a fallback.

## 4. Multiple computers and an optional unified plugin

Repeat the local install and private connection on **each** source computer, with a
unique device ID and label. Each device connects outbound independently. Devices can
be on different networks; one laptop does not forward another computer's sessions.

Single-device private plugins already work. To group existing connections, create a
private `.local/connections.json` containing only IDs obtained from the owner's actual
registered MCP connections:

```json
[
  {"name": "laptop", "id": "REPLACE_WITH_YOUR_REGISTERED_APP_ID"},
  {"name": "desktop", "id": "REPLACE_WITH_ANOTHER_REGISTERED_APP_ID"}
]
```

```sh
node scripts/plugin.mjs --connections .local/connections.json --out .local/private-plugin
```

The generator makes a portable manifest, registered-app mappings and a read-only
workflow skill. Import the generated folder/package using the current private-plugin
UI described in [plugin packaging](https://developers.openai.com/plugins/build/plugins).
It references existing connections; it does not create or authorize them. Keep this
**generated private package** out of the public repository. Inspect actual UI support
before choosing ZIP/folder import; do not claim an upload or cloud installation happened
because local files exist. Each unavailable device must be reported separately.

## 5. Isolate the reader from Codex's native tools

A cloud-installed plugin may also become visible in Codex. To prevent its broad
context-reading skill/tools from diverting Codex's native session access, disable
**only this installation's** plugin, registered device apps and bundled skills in
each computer's local Codex configuration. Keep the cloud Chat/Dot connection enabled.
Do not globally uninstall the plugin or disable unrelated apps/skills.

Resolve the actual local plugin identifier, device app IDs and installed skill folder
paths using supported plugin management and local configuration. Generate a fragment:

```sh
node scripts/isolation.mjs --plugin ACTUAL_PLUGIN_ID --app ACTUAL_DEVICE_APP_ID --skill ABSOLUTE_INSTALLED_SKILL_FOLDER --out .local/codex-isolation.toml
```

Repeat `--app`/`--skill` as needed. The script only writes a fragment. Back up the actual
Codex `config.toml` privately, then merge these exact `enabled=false` settings using a
TOML-aware editor. If matching tables/array entries exist, update them; **do not append
duplicate tables** or replace the full configuration. Consult the current
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
Record previous values for targeted recovery. No config or backup belongs in Git.

Open a fresh Codex process/chat and verify the plugin tools and skills are absent,
while supported native session reading still works. Then verify ordinary Chat and
Dot still use the private reader. Changing only a skill description is insufficient.

## 6. Optional background operation

Only configure a service after the foreground connection works. Use a user-level
service, the same account/home, absolute paths, private logs and the OS credential
store. Do not alter the existing production service during a parallel installation.

### macOS

The optional source watcher uses AppKit to follow a **detected bundle ID**, not a
hardcoded app name. The bundle differs between distributions; inspect the actual app's
`Info.plist` or supported app metadata. Do not assume a brand name identifies a bundle.

Prepare a private absolute `run-tunnel.sh` that reads the key from Keychain and ends
with `exec` of the official tunnel-client and its profile. No key should appear in
that script. Use Keychain Access or an approved interactive key-storage workflow;
`security add-generic-password -w SECRET` exposes the value in process arguments and
should not be used for unattended secret entry.

```sh
node scripts/macos-service.mjs --runner ABSOLUTE_RUN_TUNNEL_SCRIPT --bundle-id ACTUAL_BUNDLE_ID --out ABSOLUTE_NEW_SERVICE_DIRECTORY
```

This compiles the watcher, runs its synthetic lifecycle self-test and generates a
plist. Apple Command Line Tools are required. It does **not** load a service. Review
paths, then copy the plist into the user's `~/Library/LaunchAgents/` and load that exact
file with `launchctl bootstrap gui/USER_UID ABSOLUTE_PLIST_PATH`. Determine USER_UID
with `id -u`. To stop, `launchctl bootout gui/USER_UID ABSOLUTE_PLIST_PATH`.

The generated plist uses **ProcessType=Standard**. Keep it: Background can throttle
Codex CPU/I/O enough to cause search timeouts. Do not add `Nice` or `LowPriorityIO`.
After changing a plist, bootout/bootstrap it; kickstart alone does not reload all
properties. Test app absent, app launch, app exit, crash recovery and real searches
through the service. The watcher manages only its own child. Its synthetic self-test
is not an account/Tunnel end-to-end test.

### Windows

Follow [Windows deployment notes](windows/README.md). Background installation and
app lifecycle require target-machine validation. No Windows service installer is
shipped; do not present Windows CI as proof of a working desktop service.

## 7. Uninstall, restore and update

- Disconnect or disable only this reader's private ChatGPT connection/plugin.
- Stop and remove only this installation's LaunchAgent or scheduled task. On macOS,
  bootout the precise plist before deleting it. Never kill all Node/Codex processes.
- Remove the dedicated checkout and its private generated configuration only after
  checking for needed local changes. Never delete Codex's home, sessions, authentication
  or another installation. Delete/revoke a key only when its owner explicitly requests
  it and verifies nothing else uses it.
- Undo only the isolation entries introduced above, using recorded old values. A full
  backup restore is appropriate only if no later unrelated config edits would be lost.
- To update, retain the previous checkout/config until the new checkout passes local
  tests and private Chat/Dot acceptance. Regenerate commands with the new absolute path,
  then deliberately switch the service. To recover, stop the new service and point it
  back to the previous verified checkout/config. Do not roll back Standard scheduling
  merely to match an old plist.

Report the install directory, source/CLI versions, exact tests passed, account/UI steps
still pending and rollback paths. Never claim execution continuity from a context read.
