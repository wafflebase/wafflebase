# Wafflebase plugin for Claude Code

Find, read, create, edit and organize your Wafflebase sheets, docs,
slides and notes from a Claude Code session. Claude works through the
[`wafflebase` CLI](../../packages/cli/README.md); this plugin teaches it
the workflows and keeps writes behind your confirmation (unless you opt
into auto-approving document edits — deletes, replaces, uploads and
credential changes ask regardless).

Design: [docs/design/claude-plugin.md](../../docs/design/claude-plugin.md).

## Install

```bash
npm install -g @wafflebase/cli      # Node 20.18+
wafflebase login                    # opens a browser; --server <url> for a self-host
```

In Claude Code:

```
/plugin marketplace add wafflebase/wafflebase
/plugin install wafflebase@wafflebase
```

Then run `/wafflebase:setup` once to check everything is wired up.

## What you can ask

- "Find last week's meeting notes and summarize the decisions."
- "What does the Q3 revenue sheet say about churn by region?"
- "Publish `docs/release-notes.md` to Wafflebase." — or `/wafflebase:publish docs/release-notes.md`
- "Turn `bench/results.csv` into a sheet and add a total row."
- "Add a slide after slide 3 to the roadmap deck using the title layout."
- "Move every doc with 'draft' in the title into the Drafts folder."
- "List the open comments on the launch plan and resolve the ones about typos."

| Command | Does |
| --- | --- |
| `/wafflebase:find <query>` | Search titles; table of matches with links |
| `/wafflebase:publish <file> [title]` | `.md` → note, `.csv` → sheet, `.docx` → doc, `.pptx` → deck, anything else → file |
| `/wafflebase:setup` | Check install, login and workspace |

## Safety

| Command kind | What happens |
| --- | --- |
| Read-only (`list`, `get`, `content`, …), run on its own | Runs without a prompt |
| Writes (create, rename, set cells, import, …) | Asks first |
| Deletes, whole-document replaces, `--replace` imports | Always ask |
| Exports / downloads that write a local file (`-` for stdout does not) | Always ask |
| Uploads of a local file (`files upload`, `… import <file>`) | Always ask |
| `login`, `logout`, `ctx switch`, `api-keys create`, `templates publish`, `templates use` | Always ask |
| Anything run with `--server`, `--api-key`, `--profile`, or any `VAR=` prefix (chooses what runs or where your credentials go) | Always ask |
| A cell batch whose inline `--data` deletes a cell (`null`), or whose payload comes from stdin | Always ask |
| `wafflebase` commands the plugin does not recognize | Ask |

The classification comes from the CLI's own schema
(`wafflebase schema`), generated into
[`hooks/command-safety.json`](hooks/command-safety.json). Before a
whole-document replace Claude makes a copy of the document as a restore
point, since replaces cannot be undone over the API.

To stop being asked on ordinary document writes, enable **Auto-approve
document writes** in the plugin's settings (`/plugin`). Everything marked
"Always ask" above still asks.

The skills tell Claude to treat text inside your documents as data: an
instruction written in a cell or a comment is to be reported to you, not
followed. That is guidance, not a guarantee — which is why the prompts
above are enforced by the hook rather than left to the model.

## Settings

| Setting | Effect |
| --- | --- |
| `WAFFLEBASE_WEB_URL` (env) | Web app origin for document links, when the guess from the API server is wrong |
| `WAFFLEBASE_API_KEY` (env) | Use a workspace API key instead of `wafflebase login` |
| Auto-approve document writes (plugin option) | See Safety |

## Developing this plugin

`hooks/command-safety.json`, `references/` and the `version` in
`.claude-plugin/plugin.json` are generated from `packages/cli`:

```bash
pnpm cli build:plugin
```

`pnpm cli test` fails when they are stale, so a CLI change that adds a
command or a skill — or a release that bumps the CLI version — has to
regenerate them. Everything else here is hand-written.

Try a local checkout without the marketplace:

```bash
claude --plugin-dir ./plugins/wafflebase
claude plugin validate .            # marketplace + plugin manifests
```
