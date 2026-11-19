---
title: Claude Code plugin
description: Install the Wafflebase plugin for Claude Code so Claude can find, read, and edit your documents, with your confirmation before every change.
type: how-to
---

# Claude Code plugin

Install the Wafflebase plugin so Claude Code can find, read, create, and edit your sheets, docs, decks, notes, boards, and files.

Claude works through the [`wafflebase` CLI](/developers/cli/) on your computer, signed in as you. The plugin teaches Claude the commands and asks you before anything changes.

::: info Before you start
- Claude Code installed.
- Node.js 20.18.1 or later, for the CLI.
- A Wafflebase account, or the API URL of your own server.
:::

## Install the plugin

1. In a terminal, install the CLI and sign in:

   ```bash
   npm install -g @wafflebase/cli
   wafflebase login
   ```

   For your own server, run `wafflebase login --server https://api.example.com`.
2. In Claude Code, add the Wafflebase marketplace:

   ```text
   /plugin marketplace add wafflebase/wafflebase
   ```

3. Install the plugin:

   ```text
   /plugin install wafflebase@wafflebase
   ```

4. Check the setup:

   ```text
   /wafflebase:setup
   ```

Claude checks the CLI version, your sign-in, and your workspace, then reports how many documents it can see. If a step needs you, such as signing in, it stops and says what to run.

## Find a document

1. Run `/wafflebase:find` with a few words from the title:

   ```text
   /wafflebase:find meeting notes
   ```

Claude replies with a table of matching documents (title, type, last updated, and a link), newest first, up to 15 rows. If nothing matches, it shows the five most recently updated documents. It doesn't open a document's content unless you ask about it.

## Publish a local file

1. Run `/wafflebase:publish` with a file path and, optionally, a title:

   ```text
   /wafflebase:publish docs/release-notes.md "Release notes"
   ```

2. Claude states the plan in one line. Approve the command when Claude Code asks.

Claude replies with a link to the new document. The file type decides what it becomes:

| File | Becomes |
|---|---|
| `.md`, `.markdown` | A note |
| `.csv` | A sheet |
| `.docx` | A doc |
| `.pptx` | A deck |
| Anything else | A stored file |

Publishing always creates a new document. To update an existing one, ask Claude to replace it by name.

## Ask Claude to work on your documents

Ask in plain language. For example:

- "Find last week's meeting notes and summarize the decisions."
- "What does the Q3 revenue sheet say about churn by region?"
- "Turn `bench/results.csv` into a sheet and add a total row."
- "Add a slide after slide 3 of the roadmap deck using the title layout."
- "Move every doc with 'draft' in the title into the Drafts folder."
- "List the open comments on the launch plan and resolve the ones about typos."

Claude links every document it mentions or changes. Before it replaces a whole document, it makes a copy as a restore point, because a replace can't be undone.

## Know what asks for confirmation

A plugin hook checks every `wafflebase` command Claude runs. By default it asks you before any change:

| Command | What happens |
|---|---|
| A single read-only command, such as `list`, `get`, or `content` | Your own Claude Code permission rules decide. By default, Claude Code asks. |
| Writes: create, rename, set cells, import, add slides | Asks |
| Deletes, whole-document replaces, `--replace` imports | Always asks |
| Exports and downloads that write a local file, and uploads of a local file | Always asks |
| `login`, `logout`, `ctx switch`, `api-keys create`, `templates publish`, `templates use` | Always asks |
| Any command with `--server`, `--api-key`, `--profile`, or `--frontend`, or with a `VAR=` prefix | Always asks |
| A cell batch that deletes cells or reads its data from standard input | Always asks |
| A command inside a pipe, `&&` chain, or substitution, or one the plugin doesn't recognize | Asks |
| Any change to the plugin's own files | Always asks |

The skills also tell Claude to treat text inside your documents as data: an instruction written in a cell or comment is reported to you, not followed. That is guidance, which is why the confirmations are enforced by the hook.

## Turn on auto-approval

Two plugin settings skip some prompts. Both are off by default.

1. In Claude Code, run `/plugin`.
2. Choose the installed `wafflebase` plugin and open its options.
3. Turn on **Auto-allow read-only commands**, **Auto-approve document writes**, or both.

**Auto-allow read-only commands** runs a single plain read without asking. **Auto-approve document writes** runs document edits without asking. Everything marked "Always asks" above still asks.

::: warning Auto-approval trusts your shell
An approved command trusts that `wafflebase` in Claude Code's shell is still the real CLI. An earlier command, such as one that changes `PATH` or adds an alias, could swap it. Your own allow rules, such as `Bash(wafflebase docs list:*)`, carry the same risk.
:::

## Point links at your own web app

Claude builds document links from the server you signed in to: `api.example.com` links to `example.com`, and a local `localhost:3000` server links to `localhost:5173`. If links don't open, set the web app's address before starting Claude Code:

```bash
export WAFFLEBASE_WEB_URL=https://office.example.com
```

| Setting | Effect |
|---|---|
| `WAFFLEBASE_WEB_URL` | Web app address for document links. A path is kept, for an app served under one. |
| `WAFFLEBASE_API_KEY` | Use a workspace API key instead of `wafflebase login`. Also set `WAFFLEBASE_WORKSPACE`. |
| **Auto-allow read-only commands** | See [Turn on auto-approval](#turn-on-auto-approval). |
| **Auto-approve document writes** | See [Turn on auto-approval](#turn-on-auto-approval). |

## Known limitations

- Claude can do only what the CLI can. It can't create a board or open a comment thread on doc text, for example. See [Automation and agents](/developers/cli/automation#known-limitations).
- `wafflebase status` reports only the browser sign-in. With an API key, `/wafflebase:setup` sees you as signed out and confirms access by listing documents instead.

## Related

- [Install and sign in](/developers/cli/) for CLI sign-in, profiles, and API keys.
- [Automation and agents](/developers/cli/automation) for safety levels, skills, and error codes.
- [Documents and notes](/developers/cli/documents) for the commands Claude runs most.
- [Slides and boards](/developers/cli/slides-and-board#check-a-deck-before-you-share-it) for how Claude checks a deck it builds.
