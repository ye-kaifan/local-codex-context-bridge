# Windows deployment notes

The Node reader uses the shared Windows platform implementation (no shell for the
native Codex process, hidden child window, tracked child termination). CI exercises
Windows regression tests, not a real desktop account or installed Codex service.

Use PowerShell 7 or Windows PowerShell for setup, in an interactive session of the
same user who owns the Codex home. Find the real native `codex.exe`; an npm `.cmd`
shim cannot be spawned directly by this reader. If necessary inspect the installed
`@openai/codex-*` package's vendor directory, then run that exact binary with
`--version` and `app-server --help` before passing it to setup.

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
that watches the actual desktop executable path and current Windows session if
app-coupled start/stop is required. Do not guess the app name or stop unrelated Node
or Codex processes. Test: app absent, launch, exit, restart and process cleanup.

No Windows task installer or DPAPI reader is shipped in this release. These steps
must be completed and verified on the target Windows computer by its Codex/user.
Do not describe macOS lifecycle tests or Windows CI as Windows desktop acceptance.

Uninstall: stop and delete only the task created for this installation, remove its
private wrapper/config and DPAPI file only after confirming it is no longer used,
and remove the corresponding ChatGPT private connection. Preserve native Codex
sessions, authentication and unrelated tasks.
