# Windows deployment notes

The Node reader uses the shared Windows platform implementation (no shell for the
native Codex process, hidden child window, tracked child termination). CI exercises
Windows regression tests, not a real desktop account or installed Codex service.

Use PowerShell 7 or Windows PowerShell for setup, in an interactive session of the
same user who owns the Codex home. Find the real native `codex.exe`; an npm `.cmd`
shim cannot be spawned directly by this reader. If necessary inspect the installed
`@openai/codex-*` package's vendor directory, then run that exact binary with
`--version` and `app-server --help` before passing it to setup.

For a registered package CLI, `--follow-updates` records the exact current-user
package family plus relative CLI path instead of the versioned install directory.
It does not watch or launch the desktop app. Hashed standalone runtime directories
without a stable alias still require manual path updates. See
[executable upgrades](../docs/executable-updates.md) before migrating an existing
strict pin; keep its home, credentials and local isolation unchanged.

For LOCAL Codex isolation, follow [INSTALL.md section 5](../INSTALL.md#5-isolate-the-reader-from-codexs-native-tools).
Disable only this reader's local plugin, related device connectors and bundled
skills; keep ordinary Chat/Dot connections and the background task/reader running.
Discover all actually installed plugin cache versions. Pass a fully qualified drive
or UNC path to each existing skill directory or `SKILL.md` file and quote spaces:

```powershell
node scripts/isolation.mjs --plugin ACTUAL_PLUGIN_ID --app ACTUAL_DEVICE_APP_ID --skill 'C:\Users\example\Plugin Cache\VERSION\skills\read-context' --skill 'C:\Users\example\Plugin Cache\OTHER_VERSION\skills\read-context\SKILL.md' --out .local/codex-isolation.toml
```

These paths are placeholders; replace them with discovered paths, not assumed cache
locations. Directory inputs become full `SKILL.md` paths in the fragment. Drive-relative
(`C:skill`) and root-relative (`\skill` or `/skill`) paths are rejected. Review the new
fragment, back up and merge only its targeted entries; the generator does not change
runtime settings. After upgrades that move the cache, rediscover paths and reverify.

Restart local Codex and open a genuinely new local chat to check that these tools
and skills are disabled and native history works. Separately check reader search
and turn/item continuation in ordinary cloud Chat and Dot. Report unrun checks as
not run. Windows path fixtures or an already-open chat do not prove this acceptance.

For optional background operation, first test the foreground Tunnel. Store its
runtime key using Windows Credential Manager or a SecureString encrypted with
current-user DPAPI (`ConvertFrom-SecureString` without an explicit key). Have the
user enter the key interactively with `Read-Host -AsSecureString`; never put it in
Codex chat or command-line arguments. The wrapper should decrypt it in memory,
export `CONTROL_PLANE_API_KEY` only to tunnel-client, and clear its local variable.
DPAPI files must remain private to that user and computer; they are not portable
configuration backups. Protect their directory with that user's ACL.

Create a task in **Task Scheduler**, scoped to that same user, triggered at logon,
with an absolute executable and working directory. Do not require elevation, copy
the key into task arguments, or use a machine-wide service account. Use the official
tunnel-client background guidance for your installed version. Configure a wrapper
that identifies the actual desktop app and current Windows session if
app-coupled start/stop is required. Do not freeze a versioned WindowsApps path:
resolve the verified current-user package family on each lifecycle check and handle
missing/ambiguous/denied registration explicitly. This reader's CLI resolver does
not update a private supervisor's desktop-app watcher. Do not guess the app name or stop unrelated Node
or Codex processes. Test: app absent, launch, exit, restart and process cleanup.

No Windows task installer or DPAPI reader is shipped in this release. These steps
must be completed and verified on the target Windows computer by its Codex/user.
Do not describe macOS lifecycle tests or Windows CI as Windows desktop acceptance.

Uninstall: stop and delete only the task created for this installation, remove its
private wrapper/config and DPAPI file only after confirming it is no longer used,
and remove the corresponding ChatGPT private connection. Preserve native Codex
sessions, authentication and unrelated tasks.
