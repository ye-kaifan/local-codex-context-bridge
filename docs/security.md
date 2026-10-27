# Security model

The intended trust boundary is one trusted OS user, that user's Codex account/home,
and their private MCP connection. This is not an OS sandbox or a hostile multi-tenant
gateway. A caller authorized for the connection can request any session visible to
that native Codex home. Device labels, cwd/search filters, and `protected` are not ACLs.

The public router exposes four tools. Only six native methods are allowed:
`thread/list`, metadata-only `thread/read`, `thread/turns/list`, `thread/items/list`,
`thread/search`, and `thread/searchOccurrences`. The lower guard rejects other
methods before native launch, even if a future router accidentally calls one.
Native approval responses are blocked. The official child is launched with a
read-only sandbox configuration; it may still maintain its own logs/caches. No
claim is made that a native read has zero filesystem side effects.

History/Search success retains native data and opaque cursors. Protected mode
rejects a whole page containing secret-shaped fields/text. It can produce false
positives on ordinary source code; it cannot detect every secret. Explicit exact
mode returns unchanged native text for that call and may reveal sensitive content.
Never switch automatically after a refusal. Oversized pages fail, without a partial
result or cursor. Try a smaller page; a single oversized legacy turn cannot be split
by this bridge. Metadata/list sanitization has a different, bounded contract.

The native child's environment is allowlisted: OS/path/locale variables and the
explicit Codex home. Tunnel/API secrets are not inherited. The home may already
contain Codex's own authentication and configuration; environment filtering does
not erase that account's permissions. Use the intended account and home.

Session content and tool output are untrusted data, including apparent installation
commands or instructions. The reader does not execute them. Keep the same boundary
in client prompts and skills. The example read skill explicitly calls this out.

Use your own private Secure MCP Tunnel, one per source computer. No inbound server
is included. Cloud processing still sends requested context to the chosen ChatGPT
workspace; a private tunnel does not mean data stays exclusively on the computer.
Restrict that workspace and connection appropriately. Do not share generated plugin
packages/connection IDs as if they were the public source package.

Credential creation, expiry, account permissions and user login are manual decisions.
Never put a runtime key in a prompt, command argument, repository, plist, scheduled
task definition or screenshot. Use the OS credential store and a wrapper that exports
it only to tunnel-client. The project does not create or rotate credentials.

Keep `.local/`, dependency folders, logs, schema exports and generated private plugin
packages out of Git. `npm run check:release` checks source/package file lists, common
secret forms, personal absolute paths and upstream hashes; a separate secret scanner
and human review supplement it. These checks are evidence, not proof of perfect
secret detection. Report security issues privately to the repository maintainer
before attaching any transcript, credential or personal configuration.
