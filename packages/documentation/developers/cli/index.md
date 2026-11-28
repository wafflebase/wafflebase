---
title: Install and sign in
description: Install the wafflebase command-line tool, sign in to your workspace, and set the options every command shares.
type: how-to
---

# Install and sign in

Install the `wafflebase` command-line tool, sign in, and pick the workspace your commands run against.

The CLI reads and edits the same documents you open in the browser: sheets, docs, decks, notes, boards, and stored files. Every command prints JSON by default, so you can pipe it into `jq`, a script, or an agent.

::: info Before you start
- Node.js 20.18.1 or later.
- A Wafflebase account. To use your own server, you need its API URL, for example `https://api.example.com`.
:::

## Install the CLI

1. Install the package globally:

   ```bash
   npm install -g @wafflebase/cli
   ```

2. Check that it runs:

   ```bash
   wafflebase --version
   ```

The command prints the CLI version.

To pin the CLI to one project instead, install it as a dev dependency with `npm install -D @wafflebase/cli` and run it with `npx wafflebase`.

## Sign in with your browser

1. Run:

   ```bash
   wafflebase login
   ```

   To sign in to your own server, add its API URL: `wafflebase login --server https://api.example.com`. `login` reads only the flag, not `WAFFLEBASE_SERVER`; later commands use the server you signed in to.
2. Your browser opens a page titled **Continue signing in to the Wafflebase CLI?** Click **Continue**.
3. Sign in with GitHub if the browser asks you to.
4. Back in the terminal, if you belong to more than one workspace, type the number of the one to use and press `Enter`.

The terminal prints `Logged in as <username>.` The session is saved in `~/.wafflebase/session.json` and refreshes itself when it expires. The browser has 5 minutes to finish the sign-in.

![Browser page asking to continue signing in to the Wafflebase CLI, with a Continue button](/images/developers/cli-login-confirm.png)

The CLI also prints the sign-in URL, so you can open it yourself if no browser appears. When the output isn't a terminal, such as in a CI log, it writes the URL to a private file and prints that file's path instead. Don't share the URL: it carries one-time secrets.

### Check who you are signed in as

```bash
wafflebase status
```

The output has `loggedIn`, `auth`, `user`, `email`, `server`, `workspaceId`, `workspaceName`, `session` (`valid` or `expired`), and `expiresAt`. An expired session refreshes itself on the next command. `loggedIn` says whether a browser session exists; `auth` says what your commands actually use — `session`, `api-key` (an API key wins over the session, and `workspaceId` is then the key's workspace) or `none`.

### Sign out

```bash
wafflebase logout
```

This deletes the saved session.

### Sign in to an older server

`--allow-unbound-callback` lets `wafflebase login` finish against a self-hosted server too old to support the current sign-in check. While it is on, the CLI accepts any sign-in callback without checking that it belongs to this login, so a program on your computer, or a web page you open while the login waits, can finish it with a sign-in of its choosing and leave you signed in as someone else. The CLI prints a warning when you use it. Upgrade the server instead when you can.

## Switch workspaces

1. List the workspaces you belong to:

   ```bash
   wafflebase ctx list --format table
   ```

2. Switch by name or ID:

   ```bash
   wafflebase ctx switch "Marketing"
   ```

The name must match exactly, ignoring case. You can also pass a full workspace ID, or the start of one if only one workspace ID starts that way. `ctx` works only with a browser session. To run a single command in another workspace without switching, add `--workspace <id>`.

## Use an API key instead

Use an API key in scripts and CI, where no browser is available. A key belongs to one workspace, so always pass the workspace ID with it.

1. Create a key in the web app under **Settings > API keys > Create API key**, or run `wafflebase api-keys create "CI"` while signed in. See [Automation and agents](/developers/cli/automation#create-and-revoke-api-keys).
2. Export it with the workspace ID or slug. The slug is the part after `/w/` in the web app's address.

   ```bash
   export WAFFLEBASE_API_KEY=wfb_your_key
   export WAFFLEBASE_WORKSPACE=your-workspace-id
   ```

3. Run a command to check it works:

   ```bash
   wafflebase docs list
   ```

A key from `--api-key` or `WAFFLEBASE_API_KEY` wins over a saved browser session. A few commands need the browser session and refuse a key: `api-keys`, `bots`, `templates publish`, `templates use`, and `slides render`. The `agent` commands use only a bot's stored key; see [Put a bot to work](/developers/bots#keep-its-key-safe).

::: danger Keep API keys secret
A key acts as the member who created it, with read and write access to that workspace. Store it in your CI secret store, never in a repository. Revoke a leaked key with `wafflebase api-keys revoke <key-id>`.
:::

## Save settings in a profile

Put settings you reuse in `~/.wafflebase/config.yaml`:

```yaml
profiles:
  default:
    server: https://api.wafflebase.io
    workspace: your-workspace-id
  selfhosted:
    server: https://api.example.com
    api-key: wfb_your_key
    workspace: another-workspace-id
```

Pick a profile with `--profile`:

```bash
wafflebase --profile selfhosted docs list
```

The CLI picks its credentials in this order, first match wins:

1. An API key from `--api-key` or `WAFFLEBASE_API_KEY`.
2. The saved browser session from `wafflebase login`.
3. The profile's `api-key`.

The server and workspace come from the command-line flag, then the environment variable, then the saved browser session, then the profile.

::: info A browser session hides a profile's API key
While you are signed in, `--profile selfhosted` still uses your browser session and its server. To use the profile's key, run `wafflebase logout` first, or pass the key with `WAFFLEBASE_API_KEY`.
:::

| Variable | What it sets |
|---|---|
| `WAFFLEBASE_SERVER` | API server URL. Default: `https://api.wafflebase.io`. |
| `WAFFLEBASE_API_KEY` | API key. When set, it is used instead of the browser session. |
| `WAFFLEBASE_WORKSPACE` | Workspace ID. |
| `WAFFLEBASE_CONFIG` | Path of the config file, in place of `~/.wafflebase/config.yaml`. |
| `WAFFLEBASE_SESSION` | Path of the saved browser session, in place of `~/.wafflebase/session.json`. |
| `WAFFLEBASE_FRONTEND_URL` | Web app URL for `slides render`, when it can't be worked out from the server. |

## Global options

These options work on every command. Put them before or after the command name.

| Flag | Description | Default |
|---|---|---|
| `--server <url>` | API server URL | `https://api.wafflebase.io` |
| `--api-key <key>` | API key | none |
| `--workspace <id>` | Workspace ID | the active workspace |
| `--profile <name>` | Profile in the config file | `default` |
| `--format <fmt>` | Output format: `json`, `table`, `csv`, or `yaml` | `json` |
| `--quiet` | Hide progress notices. Results and errors still print. | off |
| `--verbose` | Print more detail | off |
| `--dry-run` | Print the request instead of sending it | off |
| `-V`, `--version` | Print the CLI version | |
| `--help` | Show help for any command, for example `wafflebase sheets cells --help` | |

`--format` also takes `md` and `text` on the `content` commands, and `pdf`, `docx`, `pptx`, or `md` on the `export` commands. See each command for what it accepts.

## Command namespaces

Commands are grouped by what they act on. Singular forms work as aliases, so `wafflebase doc list` is the same as `wafflebase docs list`.

| Namespace | Aliases | What it does | Reference |
|---|---|---|---|
| `docs` | `doc`, `document`, `documents` | List, create, copy, move, and delete any document; read, import, and export docs | [Documents and notes](/developers/cli/documents) |
| `notes` | `note` | Markdown notes | [Documents and notes](/developers/cli/documents#notes) |
| `folders` | `folder` | Workspace folders | [Documents and notes](/developers/cli/documents#folders) |
| `comments` | `comment` | Comment threads | [Documents and notes](/developers/cli/documents#comments) |
| `templates` | `template` | Browse, publish, and use templates | [Documents and notes](/developers/cli/documents#templates) |
| `sheets` | `sheet`, `spreadsheet`, `spreadsheets` | Tabs, cells, rows and columns, formatting, charts | [Sheets](/developers/cli/sheets) |
| `slides` | `slide`, `deck` | Decks, slides, import and export, lint and render | [Slides and boards](/developers/cli/slides-and-board) |
| `board` | `boards` | Board elements, stickies, sections | [Slides and boards](/developers/cli/slides-and-board#boards) |
| `files` | `file` | Store any file as a document | [Files and images](/developers/cli/files-and-images) |
| `images` | `image` | Workspace images that documents embed | [Files and images](/developers/cli/files-and-images#workspace-images) |
| `api-keys` | `api-key` | Create, list, and revoke API keys | [Automation and agents](/developers/cli/automation#create-and-revoke-api-keys) |
| `bots` | `bot` | Create, list, and delete workspace bots; get a pairing code | [Put a bot to work](/developers/bots) |
| `agent` | | Connect this computer to a bot and answer its tasks | [Put a bot to work](/developers/bots#commands) |
| `schema` | | Describe any command's parameters and output | [Automation and agents](/developers/cli/automation#look-up-a-command-with-schema) |
| `login`, `logout`, `status`, `ctx` | | Sign-in and workspace selection | This page |

## Related

- [Documents and notes](/developers/cli/documents) to list, create, and convert documents.
- [Sheets](/developers/cli/sheets) to read and write cells from a script.
- [Automation and agents](/developers/cli/automation) for output formats, errors, and exit codes.
- [Claude Code plugin](/developers/claude-code-plugin) to let Claude run these commands for you.
- [Sign-in providers](/developers/self-hosting/sign-in) if CLI sign-in fails on your own server.
