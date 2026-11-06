# Executable selection and application upgrades

An application upgrade can remove a versioned executable directory. The reader
must not silently switch to another Codex installation or OS account just because
the configured executable disappeared. This document covers **Codex CLI selection**,
not starting ChatGPT/Codex desktop apps or maintaining a private task supervisor.

## Selection contract

- Existing `native.executable` configurations are **strict pins**. They are not
  migrated or given a fallback. Explicit `--codex` and `CODEX_EXE` setup inputs
  remain pins unless `--follow-updates` is also supplied.
- New setup from PATH records the selected **absolute lexical path** in
  `native.executable_source`, not the symlink's versioned target. Empty and relative
  PATH entries are ignored. Only missing entries are skipped: a dangling symlink,
  denied file, directory, failed probe or wrong version banner stops discovery.
- A `path` source re-resolves **only that saved path** at reader startup. This
  follows an updated Homebrew symlink or an app replaced at the same macOS bundle
  path. Runtime PATH changes cannot redirect it. It does not discover an app moved
  to a different location or guess new hashed/versioned runtime directories.
- On Windows, setup with `--follow-updates` queries packages registered to the
  **current OS user**. If the selected native executable belongs to exactly one
  package, setup saves its exact PackageFamilyName and executable-relative path.
  Each reader startup queries registration again, verifies a single healthy match,
  resolves the new installation root, and checks canonical containment before
  launching. Other package families, other users and desktop executables are not
  substitutes. No filesystem scan, `-AllUsers` or elevated access is used.
- A non-package executable with `--follow-updates` gets a `path` source. Review the
  `executable_selection` printed by setup: a versioned path without a stable alias
  **still needs manual replacement** after an upgrade. A failed/denied package
  query is an error, not a reason to downgrade to a path source.
- Discovery requires an explicit, fixed `native.codex_home`. The source descriptor
  cannot change it. `executable` and `executable_source` are mutually exclusive.

The same resolver is used by the reader, schema qualification and direct native
comparison. Each process may resolve a newer installation if an upgrade occurs
between commands, so rerun qualification and acceptance after upgrades.

## Opt in safely

Keep the current configuration and generate a new private directory. Supply the
actual native CLI, not a launcher, npm command shim or a guessed sample path:

```sh
npm run setup -- --id laptop --label "My laptop" --codex ABSOLUTE_NATIVE_EXECUTABLE --codex-home ABSOLUTE_EXISTING_HOME --follow-updates --out NEW_PRIVATE_DIRECTORY
npm run check:native-schema -- --config NEW_PRIVATE_DIRECTORY/device.json
npm run smoke -- --config NEW_PRIVATE_DIRECTORY/device.json
```

Inspect the generated selector and keep the same device identity, native home,
connection and local-isolation settings. Only switch this installation's service
command after foreground tests pass. Do not overwrite unrelated configuration,
rotate tunnel credentials or install another Codex distribution as a side effect.

Examples of the two source forms (replace all example values with verified local
metadata; these snippets are not complete device configurations):

```json
{"executable_source":{"kind":"path","path":"/opt/homebrew/bin/codex"},"codex_home":"/Users/example/.codex"}
```

```json
{"executable_source":{"kind":"windows-appx","package_family":"OpenAI.Codex_2p2nqsd0c76g0","relative_path":"app\\resources\\codex.exe"},"codex_home":"C:\\Users\\example\\.codex"}
```

A registered `app\\Codex.exe` desktop UI is not the same binary as the package's
`app\\resources\\codex.exe` CLI. Package identity alone does not qualify its
experimental app-server protocol. Run the native schema and real read checks.

## Failure and recovery behavior

Discovery is lazy: invalid/denied public tools do not execute a version probe.
Concurrent valid reads share one discovery operation and native manager. Closing
during discovery prevents a later child launch.

If discovery fails before a native manager is created, the read returns an error.
A **later explicit read** may retry the same source after it has been repaired or
registration has finished updating. The failed read is never replayed, and an
unavailable source is never reported as an empty history/search result.

Once a manager exists, its existing fatal-error latch remains authoritative.
Unexpected exit, failed initialization and protocol corruption require restarting
this reader after resolving the cause. There is **no automatic child replacement**,
mid-history generation switch, timeout replay or seamless-upgrade guarantee. A
running older child is not terminated merely because a new version was installed.
If the executable disappears between probing and spawn, report the failure and
restart the reader when the upgrade completes. No second executable is attempted.

Missing or ambiguous registrations, access denial, canonical path escape, invalid
metadata and failed bounded probes all fail closed. Keep diagnostics private.
Probes use a filtered environment with the configured home; tunnel/API credentials
and `NODE_OPTIONS` are not passed. Version output is checked for compatibility,
**not cryptographic publisher authenticity**. This assumes a trusted OS user and
trusted selected installation paths; it does not defend against their owner or an
administrator replacing the executable between checks and launch.

## Local acceptance checklist

1. Verify the actual source, configured home and current CLI version. Retain a
   rollback checkout and private configuration; do not publish them.
2. Run the schema check and a known-session protected list/search/history read,
   including turn/item continuation, through the configured source.
3. After an actual supported app upgrade, restart only this reader and verify the
   new source and the same home/session. Confirm a missing/denied source returns an
   error rather than selecting a different installation.
4. Check ordinary Chat and Dot separately, then the local Codex isolation checks in
   INSTALL.md using a genuinely new local chat.
5. If a private Windows supervisor watches a versioned desktop executable, repair
   its app identity/lifecycle logic separately. This repository ships no Windows
   supervisor and cannot fix an old path inside one merely by updating the source.

Fixture-based macOS/Windows CI does not establish real Appx registration behavior,
installed-Codex compatibility, desktop lifecycle or account-specific acceptance.
