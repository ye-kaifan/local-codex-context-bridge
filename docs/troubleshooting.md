# Troubleshooting

| Symptom | Check and action |
| --- | --- |
| `codex` not found / Windows spawn fails | Use the official native binary and its absolute path. Windows `.cmd` shims are unsupported. GUI services have a different PATH; regenerate config after a binary path changes. |
| Setup says `EEXIST` | Existing configuration is protected. Inspect it and use a fresh `--out` directory; do not overwrite a running installation. |
| No expected sessions | Check OS account, `CODEX_HOME` and the intended device. Filters may exclude archives/subagents. Do not inspect raw storage to bypass policy. |
| Source unavailable | Report that device as unavailable; do not claim no matches or substitute another computer's history. |
| Native method missing / schema check fails | Check the executable selected in device.json; pass `--config` for a nondefault setup directory. Inspect its version and required APIs; install a compatible official standalone CLI with permission. Do not invent an alternative history parser. |
| Dot rejects IDs/cursors | Refresh the connection/tool schema. The published schema intentionally removes eight redundant nonblank regexes while retaining server validation. Preserve the entire original native cursor. |
| Search timeout on macOS | Confirm the loaded LaunchAgent uses Standard, not Background or low-priority I/O. Reload with bootout/bootstrap. Keep the 20 s request contract; very broad queries can still exceed it. |
| Protected content refusal | A whole page was refused; smaller pages can isolate the problem. Never auto-switch to exact. Exact is explicit per call and can disclose sensitive content. |
| Invalid native page/identity/cursor | Stop that range and report the native protocol mismatch. Do not invent an end cursor, combine a different turn, or fall back to a full-thread read. |
| Native comparison mismatch | Use a completed stable session and compatible CLI. Only the differing page/field is reported; do not paste transcript payloads into an issue. |
| MCP pipe closes | The reader stops accepting requests and closes its owned native child. Check the private Tunnel/client lifecycle before restarting this reader. |
| Page too large | Reduce limit in the same scope/cursor. A single oversized item/full legacy turn may remain unavailable. No chunking or silent truncation is provided. |
| Tunnel missing in ChatGPT | Confirm its intended workspace association, account permissions, and running foreground client using current official docs. |
| Healthy Tunnel but Chat/Dot fails | Inspect initialize/tools/list and real tools/call results, then refresh the private connection. Health alone does not prove tool or pagination compatibility. |
| LOCAL Codex starts using the reader plugin | Complete only this installation's local plugin/device-app/bundled-skill isolation in INSTALL.md section 5. Keep ordinary Chat/Dot connections and background readers enabled. Restart the local client and open a genuinely new local chat to test native history separately from cloud history. |
| Skill remains enabled after a directory-only override | Use the complete existing `SKILL.md` file path. The isolation generator accepts a directory but resolves and validates its file before writing. Refresh supported `skills/list` with `forceReload: true` for the actual cwd and check `enabled: false`; do not infer success from the fragment alone. |
| Plugin flag is false but its skill is still visible, or `pluginId` is null | Discover and disable each actual bundled `SKILL.md` path as well as this installation's plugin and device connectors. An old chat may retain context; verify in a newly opened local chat after restart. Do not globally uninstall the plugin. |
| Isolation stops working after plugin upgrade/reinstall | Rediscover all currently installed cache versions and file paths. Repeat `--skill` for each relevant discovered path, regenerate into a new fragment, merge with a backup and repeat local/cloud acceptance. An override for an old cache version does not automatically cover a new one. |
| Isolation generator rejects a path or output already exists | Supply a host-native absolute existing skill directory or its regular `SKILL.md` file; quote spaces. Relative paths, missing files, other filenames and `SKILL.md` directories are invalid. Use a new `--out` file; never overwrite a reviewed fragment blindly. |
| Service cannot read key | Unlock the current user's credential store and check only this wrapper's configured entry. Never print the key to diagnose it. |

Keep diagnostics private. A useful public issue contains OS/architecture, Node/Codex
versions, sanitized error class and synthetic reproduction—not a session transcript,
configuration file, Tunnel ID, account ID or screenshot containing credentials.
