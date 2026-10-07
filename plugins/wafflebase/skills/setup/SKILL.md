---
description: Check and walk through Wafflebase CLI installation, login and workspace selection
disable-model-invocation: true
---

Walk the user through setting up Wafflebase for Claude Code. Check each
step and stop at the first one that needs the user.

1. `wafflebase --version`. Missing → ask the user to run
   `npm install -g @wafflebase/cli` (Node 20.18+). Do not run it for them.
2. `wafflebase status`. It reports the browser-login session only; an API
   key (`WAFFLEBASE_API_KEY`, or one saved in a CLI profile) authenticates
   without one and wins over it.
   - `loggedIn: false` but the session context says an API key is in use,
     or `wafflebase docs list` succeeds → authenticated; go on to step 3.
   - `loggedIn: false` otherwise → ask the user to run `! wafflebase login` (it
     opens a browser; pass `--server <url>` for a self-hosted server), or
     to set `WAFFLEBASE_API_KEY` for a workspace API key.
   - `session: "expired"` → the CLI refreshes it on the next call; only
     if step 4 fails with `AUTH_ERROR`, ask for `! wafflebase login`.
3. `wafflebase ctx list` → show the workspaces; mark the active one. Offer
   `wafflebase ctx switch <id>` if the user wants another.
4. `wafflebase docs list` → confirm access by reporting how many
   documents the workspace has.

Finish with what the plugin does on its own:

- Read-only `wafflebase` commands run without a prompt.
- Every write asks first. Enabling "Auto-approve document writes" for the
  wafflebase plugin in `/plugin` lets document edits run unprompted;
  deletes, whole-document replaces, local file reads/writes, credential
  and sharing changes, and any `--server` / `--api-key` override always
  ask.
- Links use the web origin derived from the server; set
  `WAFFLEBASE_WEB_URL` if they do not open.
