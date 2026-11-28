---
name: setup
description: Check and walk through Wafflebase CLI installation, login and workspace selection
disable-model-invocation: true
---

Walk the user through setting up Wafflebase for Claude Code. Check each
step and stop at the first one that needs the user.

1. `wafflebase --version`. Missing → ask the user to run
   `npm install -g @wafflebase/cli` (Node 20.18+). Do not run it for them.
2. `wafflebase status`. `auth` says what commands authenticate with;
   `loggedIn` only says whether a browser session exists.
   - `auth: "api-key"` → an API key (`WAFFLEBASE_API_KEY`, `--api-key` or a
     CLI profile) is in charge; report `workspaceId` and `server`, or relay
     `message` when no workspace is set, and skip step 3 — `ctx` reads only
     the browser session and fails without one.
   - `auth: "session"` → go on to step 3. `session: "expired"` refreshes
     itself on the next call; only if step 4 fails with `AUTH_ERROR`, ask
     for `! wafflebase login`.
   - `auth: "none"` → ask the user to run `! wafflebase login` (it opens a
     browser; pass `--server <url>` for a self-hosted server), or to set
     `WAFFLEBASE_API_KEY` and `WAFFLEBASE_WORKSPACE` for a workspace API
     key (Settings → API keys prints both lines when it creates the key)
     and restart Claude Code from that shell.
3. Session only: `wafflebase ctx list` → show the workspaces; mark the
   active one. Offer `wafflebase ctx switch <name-or-id>` if the user wants
   another.
4. `wafflebase docs list` → confirm access by reporting how many
   documents the workspace has.

Finish with what the plugin does on its own:

- Read-only `wafflebase` commands follow the user's own permission rules
  (a prompt by default). "Auto-allow read-only commands" for the
  wafflebase plugin in `/plugin` runs plain reads unprompted; explain
  the trade (an allowed call trusts the shell's `wafflebase`) before
  suggesting it.
- Every write asks first. Enabling "Auto-approve document writes" for the
  wafflebase plugin in `/plugin` lets document edits run unprompted;
  deletes, whole-document replaces, local file reads/writes, credential
  and sharing changes, and any `--server` / `--api-key` override always
  ask.
- Links use the web origin derived from the server; set
  `WAFFLEBASE_WEB_URL` if they do not open.
